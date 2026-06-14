// 手机网关：在现有 RECEIVE_PORT 上额外托管「移动端网页」并提供 /w/* HTTP 接口，
// 让没有原生 App 的手机浏览器经扫码（令牌）即可与桌面双向互传。
//
// 设计要点：
// - 信任载体 = 二维码令牌：能扫到码 ⇒ 物理看到了桌面屏幕 ⇒ 授权。令牌短时有效。
// - 会话 = HttpOnly Cookie（ld_sess）：/w/info 用配对令牌换取会话 Cookie，之后
//   EventSource(SSE) 与 <a download> 会自动带上 Cookie，无需把令牌暴露在 URL/日志。
// - 上行（手机→桌面）：POST /w/upload 流式落盘，复用与设备协议同一套净化/容量/硬上限逻辑。
// - 下行（桌面→手机）：桌面侧登记 offer + SSE 推送，手机 GET /w/download 拉取。
// - 全部请求仍受 receive-server 入口的 isLanAddress 公网拦截保护。
// - 明文传输（与「未配对设备→明文」回退同级安全边界）；浏览器 http:// 无 WebCrypto，
//   端到端加密需打包 JS 密码学库，作为后续硬化项（见 README）。

import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { Transform } from 'node:stream'
import * as yazl from 'yazl'

import {
  MAX_PENDING_CONFIRMS,
  MAX_TEXT_BYTES,
  MAX_WEB_UPLOAD_CONCURRENT,
  PROGRESS_THROTTLE_MS,
  RECEIVE_PORT,
  WEB_DEVICE_PREFIX,
  WEB_SESSION_TTL_MS,
  WEB_TOKEN_TTL_MS,
  host,
  log,
  logError,
  notify,
} from './runtime'
import { localIPv4Addresses } from './netutil'
import { isResumeKey, resumeKey } from './crypto'
import {
  checkDiskSpace,
  decodeHeader,
  dedupePath,
  formatSize,
  header,
  resolveWithinDownloadDir,
  safeRelPath,
} from './receive-util'
import { store } from './store'
import { MOBILE_PAGE_HTML } from './mobile-page'
import type { FileMeta, MobileGatewayInfo, Transfer } from './types'

/** zip 内一个条目（保留文件夹层级）。 */
interface ZipEntry {
  filePath: string
  /** zip 内条目路径（POSIX，已净化防穿越解压）。 */
  entryPath: string
  size: number
}

/** 桌面→手机的待下载条目：单文件直传，或文件夹/多文件打包成单个 ZIP 流。 */
interface Offer {
  id: string
  transferId: string
  kind: 'file' | 'zip'
  /** 展示名 + 下载文件名（zip 时形如 "folder.zip"）。 */
  name: string
  /** 字节数；zip 为各源文件大小之和（用于进度/展示）。 */
  size: number
  // kind === 'file'
  filePath?: string
  relPath?: string
  // kind === 'zip'
  entries?: ZipEntry[]
}

/** 一台已配对手机的会话。 */
interface WebSession {
  token: string // 会话 Cookie 值
  deviceId: string // web:xxxx，用于在设备列表中表示该手机
  name: string
  os: string
  ip: string
  connectedAt: number
  lastSeen: number
  sse: http.ServerResponse | null
  outbox: Map<string, Offer>
}

interface Pairing {
  token: string
  pin: string
  createdAt: number
  expiresAt: number
}

function sixDigitPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

/** 选取最适合作为手机入口的局域网 IP（优先 192.168 → 10 → 172.16-31 → 其它）。 */
function pickLanIp(): string {
  const ips = localIPv4Addresses()
  const score = (ip: string): number => {
    if (ip.startsWith('192.168.')) return 3
    if (ip.startsWith('10.')) return 2
    const m = /^172\.(\d+)\./.exec(ip)
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 1
    return 0
  }
  return [...ips].sort((a, b) => score(b) - score(a))[0] || '127.0.0.1'
}

/** 常量时间比较两个字符串（防计时侧信道）。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length || ba.length === 0) return false
  return crypto.timingSafeEqual(ba, bb)
}

/** 从 UA 粗略判定移动端系统，用于设备名/图标展示。 */
function osFromUA(ua: string): string {
  const s = ua.toLowerCase()
  if (/iphone|ipad|ipod/.test(s)) return 'ios'
  if (/android/.test(s)) return 'android'
  if (/mac os x/.test(s)) return 'darwin'
  if (/windows/.test(s)) return 'win32'
  if (/linux/.test(s)) return 'linux'
  return 'web'
}

function defaultPhoneName(os: string): string {
  switch (os) {
    case 'ios':
      return 'iPhone / iPad'
    case 'android':
      return 'Android 手机'
    default:
      return '手机浏览器'
  }
}

/** zip 内条目路径净化：POSIX 分隔、剔除 .. / 绝对前缀 / 非法字符，防穿越解压（zip-slip）。 */
export function safeZipEntryPath(rel: string): string {
  return rel
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => s.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[ .]+$/g, ''))
    .filter((s) => s.length > 0)
    .join('/')
}

/** 文件名净化（用于 zip 下载名 / basename 兜底）。 */
export function safeFileName(name: string): string {
  const n = name
    .replace(/[\\/]/g, '')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '_')
    .replace(/[ .]+$/g, '')
    .trim()
  return n || 'download'
}

/** 若所有文件共享同一顶层文件夹则返回其名，否则 null（用于 zip 命名）。 */
export function commonTopFolder(files: FileMeta[]): string | null {
  let root: string | null = null
  for (const f of files) {
    const rel = (f.relPath || f.name).replace(/\\/g, '/')
    const idx = rel.indexOf('/')
    if (idx <= 0) return null // 顶层散文件 → 无公共文件夹
    const top = rel.slice(0, idx)
    if (root === null) root = top
    else if (root !== top) return null
  }
  return root
}

export class WebGateway {
  private pairing: Pairing | null = null
  private sessions = new Map<string, WebSession>()
  private activeUploads = 0
  private pendingConfirms = 0
  // 正在写入的可续传上传分片 key，避免同一文件并发写入同一 .part。
  private activeWebPartKeys = new Set<string>()
  private pruneTimer: ReturnType<typeof setInterval> | null = null

  /** 启动：注册状态提供者 + 周期清理离线会话。幂等。 */
  start(): void {
    store.setMobileInfoProvider(() => this.getInfo())
    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(() => this.pruneSessions(), 15000)
    }
  }

  stop(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
      this.pruneTimer = null
    }
    for (const s of this.sessions.values()) {
      try {
        s.sse?.end()
      } catch {
        /* ignore */
      }
      store.removeDevice(s.deviceId)
    }
    this.sessions.clear()
    store.setMobileInfoProvider(null)
  }

  // ── 路由分发（由 receive-server 在 LAN 校验后调用） ───────────────
  /** 处理网关相关请求，返回 true 表示已接管该请求。 */
  handle(req: http.IncomingMessage, res: http.ServerResponse, ip: string): boolean {
    const url = (req.url || '').split('?')[0]
    const isOurs = url === '/m' || url.startsWith('/w/')
    if (!isOurs) return false

    if (!store.settings.mobileGatewayEnabled) {
      this.sendJson(res, 403, { ok: false, reason: '手机网关已关闭' })
      return true
    }

    if (req.method === 'GET' && url === '/m') {
      this.servePage(res)
      return true
    }
    if (req.method === 'GET' && url === '/w/info') {
      this.handleInfo(req, res, ip)
      return true
    }
    if (req.method === 'POST' && url === '/w/pair') {
      void this.handlePair(req, res, ip)
      return true
    }
    if (req.method === 'POST' && url === '/w/upload') {
      void this.handleUpload(req, res, ip)
      return true
    }
    if (req.method === 'POST' && url === '/w/text') {
      void this.handleWebText(req, res, ip)
      return true
    }
    if (req.method === 'GET' && url === '/w/offset') {
      this.handleWebOffset(req, res)
      return true
    }
    if (req.method === 'GET' && url === '/w/events') {
      this.handleEvents(req, res)
      return true
    }
    if (req.method === 'GET' && url === '/w/outbox') {
      this.handleOutbox(req, res)
      return true
    }
    if (req.method === 'GET' && url === '/w/download') {
      void this.handleDownload(req, res)
      return true
    }

    this.sendJson(res, 404, { ok: false, reason: 'not found' })
    return true
  }

  // ── 配对令牌 ─────────────────────────────────────────────────
  /** 确保存在一个有效的配对令牌（仅在用户打开「手机互传」面板时被调用而生成）。 */
  ensurePairing(): Pairing {
    const now = Date.now()
    if (!this.pairing || this.pairing.expiresAt <= now) {
      this.pairing = {
        token: crypto.randomBytes(32).toString('base64url'),
        pin: sixDigitPin(),
        createdAt: now,
        expiresAt: now + WEB_TOKEN_TTL_MS,
      }
      store.bump()
    }
    return this.pairing
  }

  regenPairing(): void {
    this.pairing = null
    this.ensurePairing()
  }

  private isValidPairingToken(t: string | undefined): boolean {
    if (!t || !this.pairing) return false
    if (this.pairing.expiresAt <= Date.now()) return false
    return safeEqual(t, this.pairing.token)
  }

  private isValidPin(p: string | undefined): boolean {
    if (!p || !this.pairing) return false
    if (this.pairing.expiresAt <= Date.now()) return false
    return safeEqual(p, this.pairing.pin)
  }

  // ── 信息快照 ─────────────────────────────────────────────────
  /** 当前网关状态（store.getState 的提供者；不会主动创建令牌）。 */
  getInfo(): MobileGatewayInfo {
    const ip = pickLanIp()
    const base = `${ip}:${RECEIVE_PORT}`
    const p = this.pairing && this.pairing.expiresAt > Date.now() ? this.pairing : null
    return {
      enabled: store.settings.mobileGatewayEnabled,
      url: p ? `http://${base}/m#t=${p.token}` : '',
      baseUrl: base,
      ip,
      port: RECEIVE_PORT,
      pin: p ? p.pin : '',
      expiresAt: p ? p.expiresAt : 0,
      connectedCount: this.countConnected(),
    }
  }

  /** 打开面板时调用：确保令牌存在后返回完整信息（含二维码 URL / PIN）。 */
  getInfoEnsured(): MobileGatewayInfo {
    if (store.settings.mobileGatewayEnabled) this.ensurePairing()
    return this.getInfo()
  }

  private countConnected(): number {
    let n = 0
    for (const s of this.sessions.values()) if (s.sse) n += 1
    return n
  }

  // ── 会话管理 ─────────────────────────────────────────────────
  private parseCookie(req: http.IncomingMessage): string | undefined {
    const cookie = header(req, 'cookie') || ''
    const m = /(?:^|;\s*)ld_sess=([^;]+)/.exec(cookie)
    return m?.[1]
  }

  private getSession(req: http.IncomingMessage): WebSession | null {
    const tok = this.parseCookie(req)
    if (!tok) return null
    const s = this.sessions.get(tok)
    if (!s) return null
    s.lastSeen = Date.now()
    return s
  }

  private sessionByDeviceId(deviceId: string): WebSession | null {
    for (const s of this.sessions.values()) {
      if (s.deviceId === deviceId) return s
    }
    return null
  }

  /**
   * 设备 id 由「配对令牌（二维码）」派生，而非随机会话令牌：
   * 同一张二维码（含 PIN，二者同属一个 pairing）无论在微信内置浏览器还是系统浏览器打开，
   * 都解析到同一个 deviceId —— 桌面只会出现一台手机。二维码轮换后新连接得到新 id，
   * 已连旧会话各自保留创建时的 id，互不影响。
   */
  private deviceIdForPairing(): string {
    const seed = this.pairing ? this.pairing.token : 'no-pairing'
    const h = crypto.createHash('sha256').update(seed).digest('hex')
    return WEB_DEVICE_PREFIX + h.slice(0, 8)
  }

  private createSession(req: http.IncomingMessage, ip: string): WebSession {
    const token = crypto.randomBytes(24).toString('hex')
    const os = osFromUA(header(req, 'user-agent') || '')
    const declared = decodeHeader(header(req, 'x-ld-name'))
    const name = declared.trim() || defaultPhoneName(os)
    const deviceId = this.deviceIdForPairing()

    // 同一二维码在另一浏览器重开（典型：微信扫码 → 再用系统浏览器打开）：旧会话被新会话接管，
    // 继承其待下载队列，避免桌面短暂出现两台“同一手机”，且让能下载的浏览器接手 offer。
    const inheritedOutbox = new Map<string, Offer>()
    for (const [tok, old] of this.sessions) {
      if (old.deviceId !== deviceId) continue
      for (const [k, v] of old.outbox) inheritedOutbox.set(k, v)
      try {
        old.sse?.end()
      } catch {
        /* ignore */
      }
      this.sessions.delete(tok)
      log('mobile session superseded by new browser', deviceId)
    }

    const session: WebSession = {
      token,
      deviceId,
      name,
      os,
      ip,
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      sse: null,
      outbox: inheritedOutbox,
    }
    this.sessions.set(token, session)
    this.touchDevice(session)
    log('mobile session paired', session.deviceId, name, ip)
    return session
  }

  /** 把手机会话登记/刷新为设备列表中的一台设备（带 web 标记，UDP 超时不剔除）。 */
  private touchDevice(s: WebSession): void {
    store.upsertDevice({
      id: s.deviceId,
      name: s.name,
      os: s.os,
      ip: s.ip,
      port: RECEIVE_PORT,
      web: true,
    })
  }

  private pruneSessions(): void {
    const now = Date.now()
    for (const [tok, s] of this.sessions) {
      // SSE 在线则保活；断开且超过 TTL 才剔除。
      if (s.sse) {
        this.touchDevice(s)
        continue
      }
      if (now - s.lastSeen > WEB_SESSION_TTL_MS) {
        this.sessions.delete(tok)
        store.removeDevice(s.deviceId)
        log('mobile session expired', s.deviceId)
      }
    }
  }

  // ── 页面与基础接口 ───────────────────────────────────────────
  private servePage(res: http.ServerResponse): void {
    const body = Buffer.from(MOBILE_PAGE_HTML, 'utf8')
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      'content-length': String(body.length),
    })
    res.end(body)
  }

  private bearerOrQueryToken(req: http.IncomingMessage): string | undefined {
    const auth = header(req, 'authorization') || ''
    const m = /^Bearer\s+(.+)$/i.exec(auth)
    if (m) return m[1].trim()
    const q = (req.url || '').split('?')[1] || ''
    const t = new URLSearchParams(q).get('t')
    return t || undefined
  }

  private setSessionCookie(res: http.ServerResponse, token: string): void {
    // HttpOnly：JS 不需要读取，浏览器在 SSE / 下载请求中自动携带；SameSite=Lax 足够（同源）。
    res.setHeader(
      'Set-Cookie',
      `ld_sess=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
    )
  }

  private handleInfo(req: http.IncomingMessage, res: http.ServerResponse, ip: string): void {
    let s = this.getSession(req)
    if (!s) {
      if (!this.isValidPairingToken(this.bearerOrQueryToken(req))) {
        this.sendJson(res, 401, { ok: false, reason: '配对失效，请重新扫码' })
        return
      }
      s = this.createSession(req, ip)
      this.setSessionCookie(res, s.token)
      store.bump()
    } else {
      s.ip = ip
      const declared = decodeHeader(header(req, 'x-ld-name')).trim()
      if (declared) s.name = declared
      this.touchDevice(s)
    }
    this.sendJson(res, 200, {
      ok: true,
      desktopName: store.settings.deviceName,
      os: process.platform,
      deviceId: s.deviceId,
      name: s.name,
    })
  }

  private async handlePair(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ip: string,
  ): Promise<void> {
    const body = await this.readBody(req, 4096)
    let pin = ''
    try {
      pin = String(JSON.parse(body || '{}').pin || '')
    } catch {
      pin = ''
    }
    if (!this.isValidPin(pin)) {
      this.sendJson(res, 401, { ok: false, reason: 'PIN 不正确或已失效' })
      return
    }
    const s = this.createSession(req, ip)
    this.setSessionCookie(res, s.token)
    store.bump()
    this.sendJson(res, 200, {
      ok: true,
      desktopName: store.settings.deviceName,
      os: process.platform,
      deviceId: s.deviceId,
      name: s.name,
    })
  }

  /** 上传续传分片落盘路径（按 (会话设备, 相对路径, 大小) 派生的稳定 key）。 */
  private webPartPath(rkey: string): string {
    return path.join(store.settings.downloadDir, `.web-${rkey}.part`)
  }

  /** 断点续传预检：返回手机该文件已落盘字节数（正在写入或无效则视为 0）。 */
  private handleWebOffset(req: http.IncomingMessage, res: http.ServerResponse): void {
    const s = this.getSession(req)
    if (!s) {
      this.sendJson(res, 401, { ok: false, reason: 'unauthorized' })
      return
    }
    const params = new URLSearchParams((req.url || '').split('?')[1] || '')
    const rawName = params.get('name') || ''
    const name = path.basename(rawName).replace(/[\\/]/g, '')
    const relName = safeRelPath(params.get('rel') || '') || name
    const size = parseInt(params.get('size') || '0', 10) || 0
    let offset = 0
    if (size > 0 && relName) {
      const rkey = resumeKey(s.deviceId, relName, size)
      if (isResumeKey(rkey)) {
        try {
          const p = this.webPartPath(rkey)
          if (!this.activeWebPartKeys.has(rkey) && fs.existsSync(p)) offset = fs.statSync(p).size
        } catch {
          offset = 0
        }
        if (offset >= size) offset = 0
      }
    }
    this.sendJson(res, 200, { ok: true, offset })
  }

  // ── 上行：手机→桌面 上传 ─────────────────────────────────────
  private async handleUpload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ip: string,
  ): Promise<void> {
    const s = this.getSession(req)
    if (!s) {
      this.sendJson(res, 401, { ok: false, reason: '未配对，请重新扫码' })
      this.destroy(req)
      return
    }

    const transferId = header(req, 'x-ld-transfer-id') || randomUUID()
    const rawName = decodeHeader(header(req, 'x-ld-file-name'))
    const name = path.basename(rawName).replace(/[\\/]/g, '') || `file-${Date.now()}`
    const relName = safeRelPath(decodeHeader(header(req, 'x-ld-rel-path'))) || name
    const size = parseInt(header(req, 'x-ld-file-size') || '0', 10) || 0
    const batchId = header(req, 'x-ld-batch-id') || undefined
    const offsetReq = parseInt(header(req, 'x-ld-offset') || '0', 10) || 0

    s.ip = ip
    this.touchDevice(s)

    // 确认期间可能被手机中断
    let aborted = false
    const onEarlyAbort = () => {
      aborted = true
    }
    req.on('aborted', onEarlyAbort)
    req.on('error', onEarlyAbort)

    // 扫码授权的手机默认免确认；否则弹窗（带并发上限防刷屏）。
    let accept = store.settings.mobileAutoAccept
    if (!accept) {
      if (this.pendingConfirms >= MAX_PENDING_CONFIRMS) {
        this.sendJson(res, 429, { ok: false, reason: 'too many pending confirmations' })
        this.destroy(req)
        return
      }
      this.pendingConfirms += 1
      try {
        accept = await this.confirmWithUser({ name, size, peerName: s.name, peerIp: ip })
      } finally {
        this.pendingConfirms -= 1
      }
    }

    if (aborted) return
    if (!accept) {
      this.sendJson(res, 403, { ok: false, reason: 'rejected' })
      this.destroy(req)
      this.recordTerminal(transferId, name, size, s, ip, batchId, 'rejected', '已拒绝')
      return
    }

    if (this.activeUploads >= MAX_WEB_UPLOAD_CONCURRENT) {
      this.sendJson(res, 503, { ok: false, reason: '接收繁忙，请稍后重试' })
      this.destroy(req)
      this.recordTerminal(transferId, name, size, s, ip, batchId, 'failed', '接收繁忙')
      return
    }

    store.ensureDownloadDir()
    const downloadDir = store.settings.downloadDir
    const space = await checkDiskSpace(downloadDir, size)
    if (!space.ok) {
      this.sendJson(res, 507, { ok: false, reason: space.reason })
      this.destroy(req)
      this.recordTerminal(transferId, name, size, s, ip, batchId, 'failed', space.reason || '磁盘空间不足')
      return
    }

    req.off('aborted', onEarlyAbort)
    req.off('error', onEarlyAbort)
    this.activeUploads += 1

    const finalPath = dedupePath(resolveWithinDownloadDir(downloadDir, relName, name))

    // 断点续传：按 (会话设备, 相对路径, 大小) 稳定标识 .part；客户端先 GET /w/offset 取已收字节，
    // 再带 x-ld-offset 续传。仅当该 key 当前未被占用且已落字节恰等于声明偏移时才追加，否则从头写。
    const rkey = size > 0 ? resumeKey(s.deviceId, relName, size) : ''
    let ownsKey = false
    let resume = false
    let startOffset = 0
    let tmpPath: string
    if (rkey && !this.activeWebPartKeys.has(rkey)) {
      this.activeWebPartKeys.add(rkey)
      ownsKey = true
      tmpPath = this.webPartPath(rkey)
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
      tmpPath = path.join(downloadDir, `.web-${transferId}.part`)
    }
    const releaseKey = () => {
      if (ownsKey) {
        this.activeWebPartKeys.delete(rkey)
        ownsKey = false
      }
    }
    if (!resume) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch {
        /* ignore */
      }
    }

    const now = Date.now()
    const transfer: Transfer = {
      id: transferId,
      dir: 'recv',
      name: relName,
      size,
      transferred: startOffset,
      status: 'active',
      speed: 0,
      peerId: s.deviceId,
      peerName: s.name,
      peerIp: ip,
      batchId,
      startedAt: now,
    }
    store.addTransfer(transfer)

    const ws = fs.createWriteStream(tmpPath, resume ? { flags: 'a' } : { flags: 'w' })
    let received = startOffset
    let lastBytes = startOffset
    let lastTime = Date.now()
    let lastEmit = 0
    let settled = false

    const fail = (msg: string) => {
      if (settled) return
      settled = true
      this.activeUploads -= 1
      try {
        ws.destroy()
      } catch {
        /* ignore */
      }
      // 续传分片（ownsKey）失败时保留，便于下次从断点继续；一次性临时文件才清理。
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
      logError('web upload failed', name, msg)
    }

    req.on('data', (chunk: Buffer) => {
      if (settled) return
      received += chunk.length
      // 流式硬上限（按声明大小），防打满磁盘。
      if (size && received > size) {
        fail('发送超出声明的文件大小')
        this.destroy(req)
        return
      }
      const canWrite = ws.write(chunk)
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
      ws.end()
    })
    req.on('aborted', () => fail('手机中断了上传'))
    req.on('error', (err) => fail(`传输中断：${err.message}`))
    ws.on('error', (err) => fail(`写入失败：${err.message}`))

    ws.on('finish', () => {
      if (settled) return
      if (size && received !== size) {
        fail(`文件大小不符（${received}/${size}）`)
        return
      }
      try {
        fs.mkdirSync(path.dirname(finalPath), { recursive: true })
      } catch {
        /* renameSync 会暴露真实错误 */
      }
      try {
        fs.renameSync(tmpPath, finalPath)
      } catch {
        try {
          fs.copyFileSync(tmpPath, finalPath)
          fs.unlinkSync(tmpPath)
        } catch (e2) {
          fail(`落盘失败：${(e2 as Error).message}`)
          return
        }
      }
      settled = true
      this.activeUploads -= 1
      releaseKey()
      store.updateTransfer(transferId, { status: 'done', transferred: received, savePath: finalPath })
      this.sendJson(res, 200, { ok: true, received, name })
      void notify(`已接收 ${name}（来自 ${s.name}）`, 'success')
      log('web received', name, '->', finalPath)
    })
  }

  private async confirmWithUser(meta: {
    name: string
    size: number
    peerName: string
    peerIp: string
  }): Promise<boolean> {
    try {
      const result = await host()?.dialog?.showMessageBox({
        type: 'question',
        title: '闪传 LanDrop · 手机发来文件',
        message: `${meta.peerName} 想向你发送文件`,
        detail: `${meta.name}\n${formatSize(meta.size)}\n来自手机 ${meta.peerIp}\n📱 扫码授权`,
        buttons: ['接收', '拒绝'],
        defaultId: 0,
        cancelId: 1,
      })
      return (result?.response ?? 1) === 0
    } catch (err) {
      logError('mobile confirm dialog failed', err)
      return false
    }
  }

  // ── 下行：桌面→手机 推送 + 下载 ──────────────────────────────
  /**
   * 桌面把文件「发送」给已连接手机：登记 offer + 记录传输 + SSE 推送。
   * 单文件直传；多文件 / 文件夹打包为单个 ZIP（保留层级，手机一次下载即还原）。
   */
  offerToDevice(
    deviceId: string,
    files: FileMeta[],
  ): { ok: boolean; ids: string[]; error?: string } {
    const s = this.sessionByDeviceId(deviceId)
    if (!s) return { ok: false, ids: [], error: '手机未连接或已离线' }
    if (files.length === 0) return { ok: false, ids: [], error: '没有可发送的文件' }

    const transferId = randomUUID()
    const offerId = randomUUID()
    let offer: Offer

    if (files.length === 1) {
      const f = files[0]
      offer = {
        id: offerId,
        transferId,
        kind: 'file',
        name: f.name,
        size: f.size,
        filePath: f.path,
        relPath: f.relPath || f.name,
      }
    } else {
      // 文件夹 / 多文件 → 单个 ZIP。
      const totalSize = files.reduce((a, f) => a + (f.size || 0), 0)
      const root = commonTopFolder(files)
      const zipName = safeFileName(root ? `${root}.zip` : `LanDrop_${files.length}个文件.zip`)
      const entries: ZipEntry[] = files.map((f) => ({
        filePath: f.path,
        entryPath: safeZipEntryPath(f.relPath || f.name) || safeFileName(f.name),
        size: f.size || 0,
      }))
      offer = { id: offerId, transferId, kind: 'zip', name: zipName, size: totalSize, entries }
    }

    store.addTransfer({
      id: transferId,
      dir: 'send',
      name: offer.kind === 'file' ? offer.relPath || offer.name : offer.name,
      size: offer.size,
      transferred: 0,
      status: 'pending',
      speed: 0,
      peerId: deviceId,
      peerName: s.name,
      peerIp: s.ip,
      startedAt: Date.now(),
    })
    s.outbox.set(offerId, offer)
    this.sendOffers(s)
    const label = offer.kind === 'zip' ? `「${offer.name}」（${files.length} 个文件）` : offer.name
    void notify(`已向 ${s.name} 推送 ${label}，等待手机下载`, 'info')
    return { ok: true, ids: [transferId] }
  }

  // ── 文本消息（手机 ↔ 桌面） ─────────────────────────────────
  /** 手机→桌面发文本（POST /w/text）。接受后写入内存消息列表（不落盘）。 */
  private async handleWebText(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ip: string,
  ): Promise<void> {
    const s = this.getSession(req)
    if (!s) {
      this.sendJson(res, 401, { ok: false, reason: '未配对，请重新扫码' })
      this.destroy(req)
      return
    }
    const body = await this.readBody(req, MAX_TEXT_BYTES + 1024)
    let text = ''
    try {
      const parsed = JSON.parse(body || '{}')
      text = typeof parsed.text === 'string' ? parsed.text : ''
    } catch {
      text = body
    }
    text = text.trim()
    if (!text) {
      this.sendJson(res, 400, { ok: false, reason: '文本为空' })
      return
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) {
      this.sendJson(res, 413, { ok: false, reason: '文本过长' })
      return
    }

    s.ip = ip
    this.touchDevice(s)

    // 扫码授权的手机默认免确认；否则弹窗（带并发上限防刷屏）。
    let accept = store.settings.mobileAutoAccept
    if (!accept) {
      if (this.pendingConfirms >= MAX_PENDING_CONFIRMS) {
        this.sendJson(res, 429, { ok: false, reason: 'too many pending confirmations' })
        return
      }
      this.pendingConfirms += 1
      try {
        accept = await this.confirmTextWithUser(text, s.name, ip)
      } finally {
        this.pendingConfirms -= 1
      }
    }
    if (!accept) {
      this.sendJson(res, 403, { ok: false, reason: 'rejected' })
      return
    }

    store.addMessage({
      id: randomUUID(),
      dir: 'recv',
      text,
      peerId: s.deviceId,
      peerName: s.name,
      peerIp: ip,
      via: 'web',
      createdAt: Date.now(),
    })
    this.sendJson(res, 200, { ok: true })
    void notify(`收到 ${s.name} 的文字消息`, 'info')
  }

  /** 桌面→手机推文本：经 SSE 实时下发（需手机在线）。写入内存消息列表。 */
  sendTextToDevice(deviceId: string, text: string): { ok: boolean; error?: string } {
    const s = this.sessionByDeviceId(deviceId)
    if (!s) return { ok: false, error: '手机未连接或已离线' }
    const t = (text || '').trim()
    if (!t) return { ok: false, error: '文本为空' }
    if (Buffer.byteLength(t, 'utf8') > MAX_TEXT_BYTES) return { ok: false, error: '文本过长' }
    if (!s.sse) return { ok: false, error: '手机不在线（无活动连接），无法推送文字' }
    try {
      s.sse.write(
        `event: text\ndata: ${JSON.stringify({ id: randomUUID(), text: t, from: store.settings.deviceName, ts: Date.now() })}\n\n`,
      )
    } catch {
      return { ok: false, error: '推送失败，手机可能已断开' }
    }
    store.addMessage({
      id: randomUUID(),
      dir: 'send',
      text: t,
      peerId: deviceId,
      peerName: s.name,
      peerIp: s.ip,
      via: 'web',
      createdAt: Date.now(),
    })
    void notify(`已向 ${s.name} 发送文字`, 'success')
    return { ok: true }
  }

  private async confirmTextWithUser(text: string, peerName: string, ip: string): Promise<boolean> {
    const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text
    try {
      const result = await host()?.dialog?.showMessageBox({
        type: 'question',
        title: '闪传 LanDrop · 手机发来文字',
        message: `${peerName} 发来一段文字`,
        detail: `${preview}\n\n来自手机 ${ip}`,
        buttons: ['接收', '拒绝'],
        defaultId: 0,
        cancelId: 1,
      })
      return (result?.response ?? 1) === 0
    } catch (err) {
      logError('web text confirm dialog failed', err)
      return false
    }
  }

  /** offer 列表的对外快照（SSE 与轮询共用）。 */
  private offerList(s: WebSession): Array<Record<string, unknown>> {
    return [...s.outbox.values()].map((o) => ({
      id: o.id,
      name: o.name,
      relPath: o.relPath || o.name,
      size: o.size,
      kind: o.kind,
      count: o.kind === 'zip' ? o.entries?.length || 0 : 1,
    }))
  }

  private sendOffers(s: WebSession): void {
    if (!s.sse) return
    try {
      s.sse.write(`event: offers\ndata: ${JSON.stringify(this.offerList(s))}\n\n`)
    } catch {
      /* SSE 可能已断开 */
    }
  }

  private handleEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
    const s = this.getSession(req)
    if (!s) {
      res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, reason: 'unauthorized' }))
      return
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write('retry: 3000\n\n')
    res.write(`event: hello\ndata: ${JSON.stringify({ name: s.name })}\n\n`)
    s.sse = res
    this.touchDevice(s)
    store.bump()
    this.sendOffers(s)

    const hb = setInterval(() => {
      try {
        res.write(': ping\n\n')
        s.lastSeen = Date.now()
        this.touchDevice(s)
      } catch {
        /* ignore */
      }
    }, 10000)

    const close = () => {
      clearInterval(hb)
      if (s.sse === res) s.sse = null
      s.lastSeen = Date.now()
      store.bump()
    }
    req.on('close', close)
    req.on('error', close)
  }

  private handleOutbox(req: http.IncomingMessage, res: http.ServerResponse): void {
    const s = this.getSession(req)
    if (!s) {
      this.sendJson(res, 401, { ok: false, reason: 'unauthorized' })
      return
    }
    this.sendJson(res, 200, { ok: true, offers: this.offerList(s) })
  }

  private async handleDownload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const s = this.getSession(req)
    if (!s) {
      this.sendJson(res, 401, { ok: false, reason: 'unauthorized' })
      return
    }
    const q = (req.url || '').split('?')[1] || ''
    const id = new URLSearchParams(q).get('id') || ''
    const offer = s.outbox.get(id)
    if (!offer) {
      this.sendJson(res, 404, { ok: false, reason: 'offer not found' })
      return
    }

    if (offer.kind === 'zip') {
      this.streamZip(s, offer, res)
      return
    }

    let size = offer.size
    if (!offer.filePath) {
      this.sendJson(res, 410, { ok: false, reason: 'file gone' })
      return
    }
    const filePath = offer.filePath
    try {
      const st = fs.statSync(filePath)
      if (!st.isFile()) throw new Error('not a file')
      size = st.size
    } catch {
      s.outbox.delete(id)
      this.sendOffers(s)
      store.updateTransfer(offer.transferId, { status: 'failed', error: '源文件已不可用' })
      this.sendJson(res, 410, { ok: false, reason: 'file gone' })
      return
    }

    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(size),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(offer.name)}`,
      'cache-control': 'no-store',
    })
    store.updateTransfer(offer.transferId, { status: 'active', size, transferred: 0 })

    const rs = fs.createReadStream(filePath)
    let sent = 0
    let lastBytes = 0
    let lastTime = Date.now()
    let lastEmit = 0
    let settled = false

    const finish = (status: Transfer['status'], error?: string) => {
      if (settled) return
      settled = true
      try {
        rs.destroy()
      } catch {
        /* ignore */
      }
      if (status === 'done') {
        s.outbox.delete(id)
        this.sendOffers(s)
        store.updateTransfer(offer.transferId, { status: 'done', transferred: size })
        void notify(`${s.name} 已下载 ${offer.name}`, 'success')
      } else {
        store.updateTransfer(offer.transferId, { status, error, transferred: sent })
      }
    }

    rs.on('data', (chunk: Buffer | string) => {
      sent += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
      const t = Date.now()
      if (t - lastEmit >= PROGRESS_THROTTLE_MS) {
        const dt = (t - lastTime) / 1000
        const speed = dt > 0 ? (sent - lastBytes) / dt : 0
        store.updateTransfer(offer.transferId, { transferred: sent, speed })
        lastBytes = sent
        lastTime = t
        lastEmit = t
      }
    })
    rs.on('error', (err) => finish('failed', `读取失败：${err.message}`))
    rs.pipe(res)
    res.on('finish', () => finish('done'))
    res.on('close', () => {
      // 客户端在完成前断开 → 视为失败（保留 offer 以便重试）。
      if (!settled) finish('failed', '手机中断了下载')
    })
  }

  /** 文件夹 / 多文件：流式打包 ZIP（store 模式，逐文件读盘不占内存）推送给手机。 */
  private streamZip(s: WebSession, offer: Offer, res: http.ServerResponse): void {
    const entries = (offer.entries || []).filter((e) => {
      try {
        return fs.statSync(e.filePath).isFile()
      } catch {
        return false
      }
    })
    if (entries.length === 0) {
      s.outbox.delete(offer.id)
      this.sendOffers(s)
      store.updateTransfer(offer.transferId, { status: 'failed', error: '源文件已不可用' })
      this.sendJson(res, 410, { ok: false, reason: 'files gone' })
      return
    }

    // 流式 ZIP 无法预知总长度 → 走分块传输（不设 content-length）。
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(offer.name)}`,
      'cache-control': 'no-store',
    })

    const total = offer.size || entries.reduce((a, e) => a + e.size, 0)
    store.updateTransfer(offer.transferId, { status: 'active', size: total, transferred: 0 })

    const zip = new yazl.ZipFile()
    let sent = 0
    let lastBytes = 0
    let lastTime = Date.now()
    let lastEmit = 0
    let settled = false

    const finish = (status: Transfer['status'], error?: string) => {
      if (settled) return
      settled = true
      if (status === 'done') {
        s.outbox.delete(offer.id)
        this.sendOffers(s)
        store.updateTransfer(offer.transferId, { status: 'done', transferred: total })
        void notify(`${s.name} 已下载「${offer.name}」`, 'success')
      } else {
        store.updateTransfer(offer.transferId, { status, error, transferred: Math.min(sent, total) })
        try {
          zip.outputStream.unpipe()
        } catch {
          /* ignore */
        }
      }
    }

    // 计数透传：尊重背压，统计已发送字节用于进度（store 模式下输出≈源大小）。
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        sent += chunk.length
        const t = Date.now()
        if (t - lastEmit >= PROGRESS_THROTTLE_MS) {
          const dt = (t - lastTime) / 1000
          const speed = dt > 0 ? (sent - lastBytes) / dt : 0
          store.updateTransfer(offer.transferId, { transferred: Math.min(sent, total), speed })
          lastBytes = sent
          lastTime = t
          lastEmit = t
        }
        cb(null, chunk)
      },
    })

    zip.outputStream.on('error', (err: Error) => finish('failed', `打包失败：${err.message}`))
    zip.outputStream.pipe(counter).pipe(res)

    for (const e of entries) {
      // compress:false（store）：局域网带宽充足，省 CPU、便于流式与进度估算。
      zip.addFile(e.filePath, e.entryPath, { compress: false })
    }
    zip.end()

    res.on('finish', () => finish('done'))
    res.on('close', () => {
      if (!settled) finish('failed', '手机中断了下载')
    })
  }

  // ── 工具 ─────────────────────────────────────────────────────
  private recordTerminal(
    transferId: string,
    name: string,
    size: number,
    s: WebSession,
    ip: string,
    batchId: string | undefined,
    status: Transfer['status'],
    error?: string,
  ): void {
    store.addTransfer({
      id: transferId,
      dir: 'recv',
      name,
      size,
      transferred: 0,
      status,
      speed: 0,
      peerId: s.deviceId,
      peerName: s.name,
      peerIp: ip,
      batchId,
      error,
      startedAt: Date.now(),
      endedAt: Date.now(),
    })
  }

  private readBody(req: http.IncomingMessage, limit: number): Promise<string> {
    return new Promise((resolve) => {
      let data = ''
      let len = 0
      req.on('data', (c: Buffer) => {
        len += c.length
        if (len > limit) {
          this.destroy(req)
          resolve(data)
          return
        }
        data += c.toString('utf8')
      })
      req.on('end', () => resolve(data))
      req.on('error', () => resolve(data))
    })
  }

  private destroy(req: http.IncomingMessage): void {
    try {
      req.destroy()
    } catch {
      /* ignore */
    }
  }

  private sendJson(res: http.ServerResponse, code: number, body: unknown): void {
    if (res.headersSent) return
    const data = JSON.stringify(body)
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(data)
  }
}

export const webGateway = new WebGateway()
