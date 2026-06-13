import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'

import {
  APP_TAG,
  DISK_SPACE_MARGIN,
  MAX_CONCURRENT_RECEIVES,
  MAX_PENDING_CONFIRMS,
  PROGRESS_THROTTLE_MS,
  PROTOCOL_VERSION,
  RECEIVE_PORT,
  host,
  log,
  logError,
  notify,
} from './runtime'
import { isFreshTimestamp, isResumeKey, matchesFingerprint, verifyTransfer } from './crypto'
import { FrameDecryptor } from './cipher'
import { isLanAddress } from './netutil'
import { store } from './store'
import type { Transfer } from './types'

const ROUTE_INFO = `/${APP_TAG}/info`
const ROUTE_TRANSFER = `/${APP_TAG}/transfer`
const ROUTE_OFFSET = `/${APP_TAG}/offset`

function header(req: http.IncomingMessage, key: string): string | undefined {
  const v = req.headers[key]
  return Array.isArray(v) ? v[0] : v
}

function decodeHeader(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function remoteIp(req: http.IncomingMessage): string {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** 流式把已有分片喂入哈希（续传时保证全文哈希连续）。 */
function hashExistingPart(filePath: string, hash: crypto.Hash): Promise<void> {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath)
    rs.on('data', (c) => hash.update(c))
    rs.on('error', reject)
    rs.on('end', () => resolve())
  })
}

/** 同名文件自动追加序号，避免覆盖。 */
function dedupePath(target: string): string {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  let i = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
    i += 1
  }
}

export class ReceiveServer {
  private server: http.Server | null = null
  private activeReceives = 0
  private pendingConfirms = 0
  // 正在写入的可续传分片 key，避免同一文件并发写入同一 .part。
  private activePartKeys = new Set<string>()

  start(): void {
    if (this.server) return
    const server = http.createServer((req, res) => this.onRequest(req, res))

    server.on('error', (err) => {
      logError('receive server error', err)
      store.receiveOnline = false
      store.serverError = `接收端口绑定失败: ${(err as Error).message}`
      this.server = null
    })

    server.on('listening', () => {
      store.receiveOnline = true
      if (store.serverError?.includes('接收端口')) store.serverError = undefined
      log(`receive server listening on tcp/${RECEIVE_PORT}`)
    })

    server.listen(RECEIVE_PORT, '0.0.0.0')
    this.server = server
  }

  stop(): void {
    if (this.server) {
      try {
        this.server.close()
      } catch {
        /* ignore */
      }
      this.server = null
    }
    store.receiveOnline = false
  }

  private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // P1：收敛暴露面 —— 只服务局域网/本机来源，拒绝公网请求。
    if (!isLanAddress(remoteIp(req))) {
      this.sendJson(res, 403, { ok: false, reason: 'forbidden: non-LAN source' })
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      return
    }

    const url = (req.url || '').split('?')[0]

    if (req.method === 'GET' && url === ROUTE_INFO) {
      this.sendJson(res, 200, {
        ok: true,
        app: APP_TAG,
        protocol: PROTOCOL_VERSION,
        deviceId: store.deviceId,
        deviceName: store.settings.deviceName,
        os: process.platform,
        port: RECEIVE_PORT,
        publicKey: store.publicKey,
      })
      return
    }

    if (req.method === 'GET' && url === ROUTE_OFFSET) {
      this.handleOffset(req, res)
      return
    }

    if (req.method === 'POST' && url === ROUTE_TRANSFER) {
      void this.handleTransfer(req, res)
      return
    }

    this.sendJson(res, 404, { ok: false, reason: 'not found' })
  }

  /** 断点续传预检：返回某分片 key 已落盘的字节数（正在写入则视为 0）。 */
  private handleOffset(req: http.IncomingMessage, res: http.ServerResponse): void {
    const query = (req.url || '').split('?')[1] || ''
    const key = new URLSearchParams(query).get('key') || ''
    if (!isResumeKey(key)) {
      this.sendJson(res, 400, { ok: false, reason: 'bad key' })
      return
    }
    let offset = 0
    try {
      const p = path.join(store.settings.downloadDir, `.${key}.part`)
      if (!this.activePartKeys.has(key) && fs.existsSync(p)) {
        offset = fs.statSync(p).size
      }
    } catch {
      offset = 0
    }
    this.sendJson(res, 200, { ok: true, offset })
  }

  private sendJson(res: http.ServerResponse, code: number, body: unknown): void {
    if (res.headersSent) return
    const data = JSON.stringify(body)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(data)
  }

  /**
   * 校验对端身份签名（P0 核心）：
   * 1) 自报 deviceId 必须等于其公钥指纹（身份自证）；
   * 2) 时间戳新鲜（防重放 + 容忍时钟漂移）；
   * 3) ECDH 共享密钥对传输元数据的 HMAC 校验通过（证明对端持有私钥）；
   * 4) nonce 未被使用过（仅在签名通过后才登记，避免污染防重放表）。
   */
  private verifyIdentity(input: {
    peerId: string
    peerPubKey: string
    transferId: string
    signedName: string
    size: number
    ts: number
    nonce: string
    sig: string
  }): boolean {
    const { peerId, peerPubKey, transferId, signedName, size, ts, nonce, sig } = input
    if (!peerPubKey || !sig || !nonce) return false
    if (!matchesFingerprint(peerId, peerPubKey)) return false
    if (!isFreshTimestamp(ts)) return false
    const key = store.sharedKeyForPub(peerPubKey)
    if (!key) return false
    const ok = verifyTransfer(
      key,
      { transferId, senderId: peerId, name: signedName, size, ts, nonce },
      sig,
    )
    if (!ok) return false
    return store.acceptNonce(nonce, ts)
  }

  /** 弹窗向用户确认是否接收（仅在非自动接收路径调用）。 */
  private async confirmWithUser(meta: {
    name: string
    size: number
    peerId: string
    peerName: string
    peerIp: string
    verified: boolean
  }): Promise<boolean> {
    const idLine = meta.verified
      ? '✅ 身份已验证'
      : '⚠️ 身份未验证（无法确认对方真实身份）'
    try {
      const result = await host()?.dialog?.showMessageBox({
        type: 'question',
        title: '闪传 LanDrop · 收到文件',
        message: `${meta.peerName} 想向你发送文件`,
        detail: `${meta.name}\n${formatSize(meta.size)}\n来自 ${meta.peerIp}\n${idLine}`,
        // 仅在身份已验证时才提供「信任」选项：信任一个无法验证的身份没有安全意义。
        buttons: meta.verified ? ['接收', '拒绝', '信任并接收'] : ['接收', '拒绝'],
        defaultId: 0,
        cancelId: 1,
      })
      const response = result?.response ?? 1
      if (meta.verified && response === 2) {
        await store.setTrusted(meta.peerId, true)
        return true
      }
      return response === 0
    } catch (err) {
      logError('confirm dialog failed, rejecting by default', err)
      return false
    }
  }

  /** P2：落盘前预检目标分区可用空间（statfs 不可用时跳过，不阻断）。 */
  private async checkDiskSpace(
    dir: string,
    size: number,
  ): Promise<{ ok: boolean; reason?: string }> {
    if (!size || size <= 0) return { ok: true }
    try {
      const st = await fs.promises.statfs(dir)
      const free = Number(st.bavail) * Number(st.bsize)
      if (free >= size + DISK_SPACE_MARGIN) return { ok: true }
      return {
        ok: false,
        reason: `磁盘空间不足（需 ${formatSize(size)}，可用 ${formatSize(free)}）`,
      }
    } catch {
      return { ok: true }
    }
  }

  private async handleTransfer(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const transferId = header(req, 'x-ld-transfer-id') || randomUUID()
    const peerId = header(req, 'x-ld-device-id') || 'unknown'
    const peerName = decodeHeader(header(req, 'x-ld-device-name')) || '未知设备'
    const peerOs = header(req, 'x-ld-os') || 'unknown'
    const rawName = decodeHeader(header(req, 'x-ld-file-name'))
    // basename 防目录穿越
    const name = path.basename(rawName).replace(/[\\/]/g, '') || `file-${Date.now()}`
    const size = parseInt(header(req, 'x-ld-file-size') || '0', 10) || 0
    const sha = (header(req, 'x-ld-file-sha256') || '').toLowerCase()
    const batchId = header(req, 'x-ld-batch-id') || undefined
    const peerIp = remoteIp(req)

    // 身份鉴权头（v2）
    const peerPubKey = header(req, 'x-ld-pubkey') || ''
    const sig = header(req, 'x-ld-sig') || ''
    const ts = parseInt(header(req, 'x-ld-ts') || '0', 10) || 0
    const nonce = header(req, 'x-ld-nonce') || ''

    // 加密头（v2，方案 A）
    const encRequested = (header(req, 'x-ld-enc') || '') === 'aes-256-gcm'
    const encSaltHex = header(req, 'x-ld-enc-salt') || ''

    // 断点续传头（v2）
    const resumeKeyHdr = header(req, 'x-ld-resume-key') || ''
    const offsetReq = parseInt(header(req, 'x-ld-offset') || '0', 10) || 0

    // 即便发现服务未发现该设备，也登记一下（手动直连场景）；公钥经指纹校验后才采纳
    store.upsertDevice({
      id: peerId,
      name: peerName,
      os: peerOs,
      ip: peerIp,
      port: RECEIVE_PORT,
      pubKey: peerPubKey || undefined,
    })

    // 校验对端身份（签名通过 = 确实持有其私钥）。签名串用「传输的原始文件名」，与发送端一致。
    const verified = this.verifyIdentity({
      peerId,
      peerPubKey,
      transferId,
      signedName: rawName,
      size,
      ts,
      nonce,
      sig,
    })

    // 确认期间可能被发送方中断
    let aborted = false
    const onEarlyAbort = () => {
      aborted = true
    }
    req.on('aborted', onEarlyAbort)
    req.on('error', onEarlyAbort)

    // 仅「身份已验证 + 已信任」或「全自动接收」走免确认；其余弹窗确认。
    const autoAccept =
      (verified && store.isTrusted(peerId)) || store.settings.receiveMode === 'accept-all'

    // P1：未验证/需确认请求做并发上限，防止恶意设备刷确认弹窗 DoS。
    if (!autoAccept && this.pendingConfirms >= MAX_PENDING_CONFIRMS) {
      this.sendJson(res, 429, { ok: false, reason: 'too many pending confirmations' })
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      return
    }

    let accept = autoAccept
    if (!autoAccept) {
      this.pendingConfirms += 1
      try {
        accept = await this.confirmWithUser({ name, size, peerId, peerName, peerIp, verified })
      } finally {
        this.pendingConfirms -= 1
      }
    }

    if (aborted) return

    if (!accept) {
      this.sendJson(res, 403, { ok: false, reason: 'rejected' })
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      this.recordTerminal({
        id: transferId,
        dir: 'recv',
        name,
        size,
        peerId,
        peerName,
        peerIp,
        batchId,
        status: 'rejected',
        error: '已拒绝',
      })
      return
    }

    // P2：接收并发上限，避免被大量并发连接拖垮 / 打满磁盘。
    if (this.activeReceives >= MAX_CONCURRENT_RECEIVES) {
      this.sendJson(res, 503, { ok: false, reason: 'busy: too many concurrent receives' })
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      this.recordTerminal({
        id: transferId,
        dir: 'recv',
        name,
        size,
        peerId,
        peerName,
        peerIp,
        batchId,
        status: 'failed',
        error: '接收繁忙，请稍后重试',
      })
      return
    }

    store.ensureDownloadDir()

    // 加密协商（方案 A）：声明加密则必须能用对端「自证公钥」派生文件密钥，否则拒绝。
    let decryptor: FrameDecryptor | null = null
    if (encRequested) {
      const fileKey =
        peerPubKey && encSaltHex && matchesFingerprint(peerId, peerPubKey)
          ? store.fileKeyForPub(peerPubKey, Buffer.from(encSaltHex, 'hex'))
          : null
      if (!fileKey) {
        this.sendJson(res, 400, { ok: false, reason: 'encryption handshake failed' })
        try {
          req.destroy()
        } catch {
          /* ignore */
        }
        this.recordTerminal({
          id: transferId,
          dir: 'recv',
          name,
          size,
          peerId,
          peerName,
          peerIp,
          batchId,
          status: 'failed',
          error: '加密协商失败',
        })
        return
      }
      decryptor = new FrameDecryptor(fileKey, Buffer.from(transferId))
    }

    if (aborted) return
    req.off('aborted', onEarlyAbort)
    req.off('error', onEarlyAbort)

    this.activeReceives += 1

    const downloadDir = store.settings.downloadDir
    const finalPath = dedupePath(path.join(downloadDir, name))

    // 断点续传决策：仅当 key 合法且当前未被占用时使用稳定 .part 名，否则用一次性临时名。
    let ownsKey = false
    let tmpPath: string
    let resume = false
    let startOffset = 0
    if (isResumeKey(resumeKeyHdr) && !this.activePartKeys.has(resumeKeyHdr)) {
      this.activePartKeys.add(resumeKeyHdr)
      ownsKey = true
      tmpPath = path.join(downloadDir, `.${resumeKeyHdr}.part`)
      if (offsetReq > 0 && offsetReq < size) {
        let existing = -1
        try {
          existing = fs.existsSync(tmpPath) ? fs.statSync(tmpPath).size : -1
        } catch {
          existing = -1
        }
        if (existing === offsetReq) {
          resume = true
          startOffset = offsetReq
        }
      }
    } else {
      tmpPath = path.join(downloadDir, `.${name}.${transferId}.part`)
    }
    const releaseKey = () => {
      if (ownsKey) {
        this.activePartKeys.delete(resumeKeyHdr)
        ownsKey = false
      }
    }
    // 非续传起始：清掉可能残留的旧分片，从头写。
    if (!resume) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
    }

    // P2：落盘前磁盘空间预检（按本次实际写入的剩余字节）。
    const space = await this.checkDiskSpace(downloadDir, size - startOffset)
    if (!space.ok) {
      this.activeReceives -= 1
      releaseKey()
      this.sendJson(res, 507, { ok: false, reason: space.reason })
      try {
        req.destroy()
      } catch {
        /* ignore */
      }
      this.recordTerminal({
        id: transferId,
        dir: 'recv',
        name,
        size,
        peerId,
        peerName,
        peerIp,
        batchId,
        status: 'failed',
        error: space.reason || '磁盘空间不足',
      })
      return
    }

    const now = Date.now()
    const transfer: Transfer = {
      id: transferId,
      dir: 'recv',
      name,
      size,
      transferred: startOffset,
      status: 'active',
      speed: 0,
      peerId,
      peerName,
      peerIp,
      batchId,
      startedAt: now,
      encrypted: encRequested,
    }
    store.addTransfer(transfer)

    const ws = fs.createWriteStream(tmpPath, resume ? { flags: 'a' } : { flags: 'w' })
    const hash =
      store.settings.verifyIntegrity && sha ? crypto.createHash('sha256') : null

    let received = startOffset
    let lastBytes = startOffset
    let lastTime = Date.now()
    let lastEmit = 0
    let settled = false

    const fail = (msg: string) => {
      if (settled) return
      settled = true
      this.activeReceives -= 1
      try {
        ws.destroy()
      } catch {
        /* ignore */
      }
      // 续传分片（ownsKey）在中途失败时保留，便于下次从断点继续；一次性临时文件则清理。
      if (!ownsKey) {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
        } catch {
          /* ignore */
        }
      }
      releaseKey()
      store.updateTransfer(transferId, { status: 'failed', error: msg, transferred: received })
      this.sendJson(res, 500, { ok: false, reason: msg })
      void notify(`接收失败：${name}（${msg}）`, 'error')
      logError('receive failed', name, msg)
    }

    // 续传：先把已有分片喂入哈希，保证最终全文哈希连续。失败则放弃本次（保留分片下次再试）。
    if (hash && resume) {
      try {
        await hashExistingPart(tmpPath, hash)
      } catch {
        fail('读取已有分片失败')
        return
      }
    }

    req.on('data', (chunk: Buffer) => {
      if (settled) return
      // 加密路径：解帧解密（tag 不符即抛错）；明文路径：原样。
      let plains: Buffer[]
      if (decryptor) {
        try {
          plains = decryptor.push(chunk)
        } catch {
          fail('解密失败，数据可能被篡改')
          try {
            req.destroy()
          } catch {
            /* ignore */
          }
          return
        }
      } else {
        plains = [chunk]
      }

      let canWrite = true
      for (const pt of plains) {
        received += pt.length
        // P2：流式硬上限（按明文计）—— 超过声明大小立即中止，防止打满磁盘。
        if (size && received > size) {
          fail('发送超出声明的文件大小')
          try {
            req.destroy()
          } catch {
            /* ignore */
          }
          return
        }
        if (hash) hash.update(pt)
        canWrite = ws.write(pt)
      }
      // 背压：写盘跟不上时暂停接收，drain 后恢复。
      if (!canWrite) {
        req.pause()
        ws.once('drain', () => req.resume())
      }

      const t = Date.now()
      if (t - lastEmit >= PROGRESS_THROTTLE_MS) {
        const dt = (t - lastTime) / 1000
        const speed = dt > 0 ? (received - lastBytes) / dt : 0
        store.updateTransfer(transferId, { transferred: received, speed })
        lastBytes = received
        lastTime = t
        lastEmit = t
      }
    })

    req.on('end', () => {
      if (settled) return
      // 加密流：尾部不应残留半帧，否则视为不完整。
      if (decryptor && decryptor.pending > 0) {
        fail('传输不完整（残留分片）')
        return
      }
      ws.end()
    })

    req.on('aborted', () => fail('发送方中断了传输'))
    req.on('error', (err) => fail(`传输中断：${err.message}`))
    ws.on('error', (err) => fail(`写入失败：${err.message}`))

    ws.on('finish', () => {
      if (settled) return
      if (size && received !== size) {
        fail(`文件大小不符（${received}/${size}）`)
        return
      }
      if (hash && sha && hash.digest('hex') !== sha) {
        // 完整但哈希不符 = 内容损坏/被改，续传无意义 → 删除分片。
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
        } catch {
          /* ignore */
        }
        fail('哈希校验失败，文件可能损坏')
        return
      }
      try {
        fs.renameSync(tmpPath, finalPath)
      } catch {
        // 跨分区回退：复制 + 删除
        try {
          fs.copyFileSync(tmpPath, finalPath)
          fs.unlinkSync(tmpPath)
        } catch (e2) {
          fail(`落盘失败：${(e2 as Error).message}`)
          return
        }
      }
      settled = true
      this.activeReceives -= 1
      releaseKey()
      store.updateTransfer(transferId, {
        status: 'done',
        transferred: received,
        savePath: finalPath,
      })
      this.sendJson(res, 200, { ok: true, received, name })
      void notify(`已接收 ${name}`, 'success')
      log('received', name, '->', finalPath)
    })

    // 手动消费 req（见上方 data/end 处理），不再使用 req.pipe，以便插入解密与背压控制。
  }

  private recordTerminal(input: {
    id: string
    dir: Transfer['dir']
    name: string
    size: number
    peerId: string
    peerName: string
    peerIp: string
    batchId?: string
    status: Transfer['status']
    error?: string
  }): void {
    store.addTransfer({
      id: input.id,
      dir: input.dir,
      name: input.name,
      size: input.size,
      transferred: 0,
      status: input.status,
      speed: 0,
      peerId: input.peerId,
      peerName: input.peerName,
      peerIp: input.peerIp,
      batchId: input.batchId,
      error: input.error,
      startedAt: Date.now(),
      endedAt: Date.now(),
    })
  }
}

export const receiveServer = new ReceiveServer()
