import * as http from 'node:http'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'

import {
  APP_TAG,
  MAX_HASH_BYTES,
  PROGRESS_THROTTLE_MS,
  log,
  logError,
  notify,
} from './runtime'
import { newNonce, resumeKey, signTransfer } from './crypto'
import { FrameEncryptor } from './cipher'
import { store } from './store'
import type { FileMeta, Transfer } from './types'

const ROUTE_TRANSFER = `/${APP_TAG}/transfer`
const CONNECT_TIMEOUT_MS = 12000

interface Job {
  transferId: string
  targetId: string
  file: FileMeta
  batchId: string
}

interface ActiveHandle {
  req: http.ClientRequest
  rs: fs.ReadStream
}

/**
 * 流式发送方：按目标设备分队列。
 * 同一目标内串行（避免对单机打满），不同目标之间并行（多设备同时发送互不排队）。
 */
class Sender {
  private queues = new Map<string, Job[]>()
  private runningTargets = new Set<string>()
  private active = new Map<string, ActiveHandle>()
  private canceled = new Set<string>()

  /** 入队并返回创建的传输 id 列表。 */
  enqueue(targetId: string, files: FileMeta[]): string[] {
    const target = store.getDevice(targetId)
    const batchId = files.length > 1 ? randomUUID() : ''
    const ids: string[] = []
    const queue = this.queues.get(targetId) ?? []

    for (const file of files) {
      const transferId = randomUUID()
      ids.push(transferId)
      const t: Transfer = {
        id: transferId,
        dir: 'send',
        name: file.name,
        size: file.size,
        transferred: 0,
        status: 'pending',
        speed: 0,
        peerId: targetId,
        peerName: target?.name || targetId,
        peerIp: target?.ip,
        batchId: batchId || undefined,
        startedAt: Date.now(),
      }
      store.addTransfer(t)
      queue.push({ transferId, targetId, file, batchId })
    }

    this.queues.set(targetId, queue)
    void this.pumpTarget(targetId)
    return ids
  }

  cancel(transferId: string): void {
    this.canceled.add(transferId)
    const handle = this.active.get(transferId)
    if (handle) {
      try {
        handle.rs.destroy()
      } catch {
        /* ignore */
      }
      try {
        handle.req.destroy()
      } catch {
        /* ignore */
      }
    } else {
      // 仍在队列中：直接标记取消（pumpTarget 出队时会跳过）
      const t = store.getTransfer(transferId)
      if (t && (t.status === 'pending' || t.status === 'active')) {
        store.updateTransfer(transferId, { status: 'canceled', error: '已取消' })
      }
    }
  }

  /** 顺序抽干某个目标的队列；不同目标的 pumpTarget 并发执行。 */
  private async pumpTarget(targetId: string): Promise<void> {
    if (this.runningTargets.has(targetId)) return
    this.runningTargets.add(targetId)
    try {
      for (;;) {
        const queue = this.queues.get(targetId)
        const job = queue?.shift()
        if (!job) break
        if (this.canceled.has(job.transferId)) {
          store.updateTransfer(job.transferId, { status: 'canceled', error: '已取消' })
          continue
        }
        await this.sendOne(job)
      }
    } finally {
      this.runningTargets.delete(targetId)
      const queue = this.queues.get(targetId)
      if (!queue || queue.length === 0) {
        this.queues.delete(targetId)
      } else {
        // 抽干期间又有新任务入队：补一次驱动，避免漏跑。
        void this.pumpTarget(targetId)
      }
    }
  }

  private async sendOne(job: Job): Promise<void> {
    const { transferId, file, batchId } = job
    const target = store.getDevice(job.targetId)
    if (!target) {
      store.updateTransfer(transferId, { status: 'failed', error: '目标设备不可用' })
      return
    }
    store.updateTransfer(transferId, {
      status: 'active',
      peerName: target.name,
      peerIp: target.ip,
    })

    // 重新 stat，确保大小与存在性准确
    let size = file.size
    try {
      const st = fs.statSync(file.path)
      if (!st.isFile()) throw new Error('不是有效文件')
      size = st.size
      store.updateTransfer(transferId, { size })
    } catch (err) {
      store.updateTransfer(transferId, {
        status: 'failed',
        error: `读取文件失败：${(err as Error).message}`,
      })
      return
    }

    // 可选哈希预计算
    let sha = ''
    if (store.settings.verifyIntegrity && size <= MAX_HASH_BYTES) {
      try {
        sha = await hashFile(file.path)
      } catch (err) {
        logError('hash file failed (skipping integrity)', err)
      }
    }

    // 断点续传：询问对端已收字节（失败/不可用则从 0 开始）。
    const rkey = resumeKey(store.deviceId, file.name, size)
    let offset = 0
    try {
      const got = await probeOffset(target.ip, target.port, rkey)
      if (got > 0 && got < size) offset = got
    } catch {
      offset = 0
    }

    await this.transmit({
      transferId,
      targetId: job.targetId,
      target,
      file,
      size,
      sha,
      batchId,
      resumeKey: rkey,
      offset,
    })
  }

  private transmit(args: {
    transferId: string
    targetId: string
    target: { ip: string; port: number; name: string }
    file: FileMeta
    size: number
    sha: string
    batchId: string
    resumeKey: string
    offset: number
  }): Promise<void> {
    const { transferId, targetId, target, file, size, sha, batchId, resumeKey: rkey, offset } = args

    return new Promise<void>((resolve) => {
      let settled = false
      const done = (status: Transfer['status'], error?: string, savePath?: string) => {
        if (settled) return
        settled = true
        const handle = this.active.get(transferId)
        this.active.delete(transferId)
        if (handle) {
          try {
            handle.rs.destroy()
          } catch {
            /* ignore */
          }
        }
        store.updateTransfer(transferId, {
          status,
          error,
          savePath,
          transferred: status === 'done' ? size : store.getTransfer(transferId)?.transferred,
        })
        if (status === 'done') {
          void notify(`已发送 ${file.name} → ${target.name}`, 'success')
        } else if (status === 'rejected') {
          void notify(`${target.name} 拒绝了 ${file.name}`, 'warning')
        } else if (status === 'failed') {
          void notify(`发送失败：${file.name}（${error || ''}）`, 'error')
        }
        resolve()
      }

      // 端到端加密（方案 A）：开关开启且掌握对端公钥时启用 AES-256-GCM 分帧加密。
      let encryptor: FrameEncryptor | null = null
      const encSalt = crypto.randomBytes(16)
      const fileKey = store.settings.encrypt ? store.fileKeyForPeer(targetId, encSalt) : null

      const remaining = size - offset

      const headers: Record<string, string> = {
        'content-type': 'application/octet-stream',
        'x-ld-transfer-id': transferId,
        'x-ld-device-id': store.deviceId,
        'x-ld-device-name': encodeURIComponent(store.settings.deviceName),
        'x-ld-os': process.platform,
        'x-ld-file-name': encodeURIComponent(file.name),
        'x-ld-file-size': String(size),
        // 始终携带续传 key：即使本次从 0 开始，对端也用稳定 .part 名，便于后续中断重连续传。
        'x-ld-resume-key': rkey,
      }
      if (offset > 0) headers['x-ld-offset'] = String(offset)
      if (fileKey) {
        // 密文+分帧开销使长度不可预知 → 走 chunked；明文则保留精确 content-length（剩余字节）。
        headers['x-ld-enc'] = 'aes-256-gcm'
        headers['x-ld-enc-salt'] = encSalt.toString('hex')
        encryptor = new FrameEncryptor(fileKey, Buffer.from(transferId))
        store.updateTransfer(transferId, { encrypted: true })
      } else {
        headers['content-length'] = String(remaining)
      }
      if (sha) headers['x-ld-file-sha256'] = sha
      if (batchId) headers['x-ld-batch-id'] = batchId

      // 身份签名（v2）：掌握对端公钥时附带，证明本机持有私钥，供对端判定「受信任自动接收」。
      const sharedKey = store.sharedKeyFor(targetId)
      if (sharedKey) {
        const ts = Date.now()
        const nonce = newNonce()
        headers['x-ld-pubkey'] = store.publicKey
        headers['x-ld-ts'] = String(ts)
        headers['x-ld-nonce'] = nonce
        headers['x-ld-sig'] = signTransfer(sharedKey, {
          transferId,
          senderId: store.deviceId,
          name: file.name,
          size,
          ts,
          nonce,
        })
      }

      const req = http.request(
        { host: target.ip, port: target.port, path: ROUTE_TRANSFER, method: 'POST', headers },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (c) => {
            body += c
          })
          res.on('end', () => {
            const code = res.statusCode || 0
            if (code === 200) {
              done('done')
            } else if (code === 403) {
              done('rejected', '对方已拒绝')
            } else {
              let reason = `HTTP ${code}`
              try {
                const parsed = JSON.parse(body)
                if (parsed?.reason) reason = String(parsed.reason)
              } catch {
                /* ignore */
              }
              done('failed', reason)
            }
          })
        },
      )

      // 仅对“建立连接”设超时，避免等待对方确认/慢速上传被误杀
      const connectTimer = setTimeout(() => {
        done('failed', '连接超时，对方可能不在线')
        try {
          req.destroy()
        } catch {
          /* ignore */
        }
      }, CONNECT_TIMEOUT_MS)

      req.on('socket', (socket) => {
        const clear = () => clearTimeout(connectTimer)
        if (!socket.connecting) clear()
        else socket.once('connect', clear)
      })

      req.on('error', (err) => {
        clearTimeout(connectTimer)
        if (this.canceled.has(transferId)) done('canceled', '已取消')
        else done('failed', (err as Error).message)
      })

      const rs = offset > 0 ? fs.createReadStream(file.path, { start: offset }) : fs.createReadStream(file.path)
      if (offset > 0) store.updateTransfer(transferId, { transferred: offset })
      let sent = offset
      let lastBytes = offset
      let lastTime = Date.now()
      let lastEmit = 0

      rs.on('data', (chunk: Buffer | string) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
        sent += buf.length
        if (encryptor) {
          if (req.destroyed) {
            try {
              rs.destroy()
            } catch {
              /* ignore */
            }
            return
          }
          const frame = encryptor.encrypt(buf)
          if (!req.write(frame)) {
            rs.pause()
            req.once('drain', () => rs.resume())
          }
        }
        const t = Date.now()
        if (t - lastEmit >= PROGRESS_THROTTLE_MS) {
          const dt = (t - lastTime) / 1000
          const speed = dt > 0 ? (sent - lastBytes) / dt : 0
          store.updateTransfer(transferId, { transferred: sent, speed })
          lastBytes = sent
          lastTime = t
          lastEmit = t
        }
      })

      rs.on('error', (err) => {
        clearTimeout(connectTimer)
        try {
          req.destroy()
        } catch {
          /* ignore */
        }
        done('failed', `读取文件失败：${(err as Error).message}`)
      })

      this.active.set(transferId, { req, rs })
      log('sending', file.name, '->', `${target.ip}:${target.port}`, encryptor ? '(encrypted)' : '')
      if (encryptor) {
        // 加密路径：手动分帧写入，读完后显式结束请求体。
        rs.on('end', () => {
          try {
            req.end()
          } catch {
            /* ignore */
          }
        })
      } else {
        rs.pipe(req)
      }
    })
  }
}

/** 流式计算文件 sha256（低内存）。 */
function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const rs = fs.createReadStream(filePath)
    rs.on('data', (c) => hash.update(c))
    rs.on('error', reject)
    rs.on('end', () => resolve(hash.digest('hex')))
  })
}

export const sender = new Sender()

/** 通过 GET /info 探测一个手动 IP，返回设备信息。 */
export function probeDevice(
  ip: string,
  port: number,
): Promise<{
  deviceId: string
  deviceName: string
  os: string
  port: number
  publicKey?: string
} | null> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: ip, port, path: `/${APP_TAG}/info`, method: 'GET', timeout: 5000 },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            const info = JSON.parse(body)
            if (info?.app === APP_TAG && info.deviceId) {
              resolve({
                deviceId: info.deviceId,
                deviceName: info.deviceName || ip,
                os: info.os || 'unknown',
                port: info.port || port,
                publicKey: typeof info.publicKey === 'string' ? info.publicKey : undefined,
              })
            } else {
              resolve(null)
            }
          } catch {
            resolve(null)
          }
        })
      },
    )
    req.on('timeout', () => {
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      resolve(null)
    })
    req.on('error', () => resolve(null))
    req.end()
  })
}

/** 询问对端某分片 key 已收字节数（断点续传预检）。失败/不可用返回 0。 */
export function probeOffset(ip: string, port: number, key: string): Promise<number> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: ip, port, path: `/${APP_TAG}/offset?key=${key}`, method: 'GET', timeout: 5000 },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            const info = JSON.parse(body)
            const n = Number(info?.offset)
            resolve(Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
          } catch {
            resolve(0)
          }
        })
      },
    )
    req.on('timeout', () => {
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      resolve(0)
    })
    req.on('error', () => resolve(0))
    req.end()
  })
}
