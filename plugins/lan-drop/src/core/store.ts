import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import {
  host,
  log,
  logError,
  PROTOCOL_VERSION,
  RECEIVE_PORT,
} from './runtime'
import { localIPv4Addresses } from './netutil'
import {
  deriveFileKey,
  deriveSharedKey,
  fingerprint,
  generateIdentity,
  isFreshTimestamp,
  isValidIdentity,
  matchesFingerprint,
  SIG_TTL_MS,
  type Identity,
} from './crypto'
import type {
  AppState,
  IncomingRequest,
  RemoteDevice,
  Settings,
  Transfer,
} from './types'

const STORAGE_KEY_SETTINGS = 'settings'
const STORAGE_KEY_IDENTITY = 'identity'
const STORAGE_KEY_HISTORY = 'history'

const MAX_TRANSFERS = 200
const HISTORY_LIMIT = 100

function defaultDownloadDir(): string {
  // 退化策略：home/Downloads/LanDrop（init 时会尝试用宿主 downloads 路径覆盖）
  return path.join(os.homedir(), 'Downloads', 'LanDrop')
}

function defaultSettings(): Settings {
  return {
    deviceName: os.hostname() || 'Mulby Device',
    downloadDir: defaultDownloadDir(),
    receiveMode: 'ask',
    discoveryEnabled: true,
    verifyIntegrity: true,
    encrypt: true,
    trustedDevices: [],
  }
}

/**
 * 进程内单例：持有全部运行时状态，并负责设置/历史的持久化。
 */
class Store {
  deviceId = ''
  publicKey = ''
  private privateKey = ''
  settings: Settings = defaultSettings()

  private devices = new Map<string, RemoteDevice>()
  private incoming = new Map<string, IncomingRequest>()
  private transfers: Transfer[] = []
  private sharedKeyCache = new Map<string, Buffer>()
  private seenNonces = new Map<string, number>()

  // 在线/错误标志改为访问器：外部赋值即触发 bump()，驱动 UI 推送。
  private _receiveOnline = false
  private _discoveryOnline = false
  private _serverError: string | undefined

  get receiveOnline(): boolean {
    return this._receiveOnline
  }
  set receiveOnline(v: boolean) {
    if (v === this._receiveOnline) return
    this._receiveOnline = v
    this.bump()
  }

  get discoveryOnline(): boolean {
    return this._discoveryOnline
  }
  set discoveryOnline(v: boolean) {
    if (v === this._discoveryOnline) return
    this._discoveryOnline = v
    this.bump()
  }

  get serverError(): string | undefined {
    return this._serverError
  }
  set serverError(v: string | undefined) {
    if (v === this._serverError) return
    this._serverError = v
    this.bump()
  }

  // UI 推送：状态修订号 + 长轮询等待者集合
  private rev = 0
  private waiters = new Set<() => void>()

  private historyTimer: ReturnType<typeof setTimeout> | null = null
  private inited = false

  async init(): Promise<void> {
    if (this.inited) return
    this.inited = true

    // 身份密钥（持久化，重启保持稳定）。deviceId = 公钥指纹，身份自证不可伪造。
    let identity: Identity | null = null
    try {
      const saved = (await host()?.storage?.get(STORAGE_KEY_IDENTITY)) as Identity | undefined
      if (isValidIdentity(saved)) identity = saved
    } catch {
      /* 读取失败则重新生成 */
    }
    if (!identity) {
      identity = generateIdentity()
      try {
        await host()?.storage?.set(STORAGE_KEY_IDENTITY, identity)
      } catch (err) {
        logError('persist identity failed', err)
      }
    }
    this.publicKey = identity.publicKeyB64
    this.privateKey = identity.privateKeyB64
    this.deviceId = fingerprint(this.publicKey)

    // 设置
    try {
      const saved = (await host()?.storage?.get(STORAGE_KEY_SETTINGS)) as Partial<Settings> | undefined
      this.settings = { ...defaultSettings(), ...(saved || {}) }
    } catch {
      this.settings = defaultSettings()
    }

    // 用宿主下载目录修正默认保存路径（仅在用户未自定义时）
    try {
      const dl = (await host()?.system?.getPath?.('downloads')) as string | undefined
      if (dl && this.settings.downloadDir === defaultDownloadDir()) {
        this.settings.downloadDir = path.join(dl, 'LanDrop')
      }
    } catch {
      /* 忽略，沿用默认 */
    }

    this.ensureDownloadDir()

    // 加载历史（把上次未完成的标记为中断失败）
    try {
      const hist = (await host()?.storage?.get(STORAGE_KEY_HISTORY)) as Transfer[] | undefined
      if (Array.isArray(hist)) {
        this.transfers = hist.map((t) =>
          t.status === 'active' || t.status === 'pending'
            ? { ...t, status: 'failed', error: '上次会话中断' }
            : t,
        )
      }
    } catch {
      /* 忽略 */
    }

    log('store initialized', { deviceId: this.deviceId, downloadDir: this.settings.downloadDir })
  }

  ensureDownloadDir(): void {
    try {
      fs.mkdirSync(this.settings.downloadDir, { recursive: true })
    } catch (err) {
      logError('mkdir downloadDir failed', err)
    }
  }

  // ── 设备注册表 ───────────────────────────────────────────────
  upsertDevice(
    d: Omit<RemoteDevice, 'lastSeen' | 'trusted' | 'verified'> & { lastSeen?: number },
  ): void {
    if (!d.id || d.id === this.deviceId) return
    const prev = this.devices.get(d.id)
    // 公钥仅在「其指纹与自报 id 相符」时采纳，杜绝注册表投毒（伪造他人 id + 自己的公钥）。
    let pubKey = prev?.pubKey
    if (d.pubKey && matchesFingerprint(d.id, d.pubKey)) {
      if (pubKey !== d.pubKey) this.sharedKeyCache.delete(d.id)
      pubKey = d.pubKey
    }
    this.devices.set(d.id, {
      ...prev,
      ...d,
      pubKey,
      manual: d.manual ?? prev?.manual,
      lastSeen: d.lastSeen ?? Date.now(),
    })
    this.bump()
  }

  pruneDevices(ttlMs: number): void {
    const now = Date.now()
    // 正在传输（active/pending）的对端永不剔除：大文件传输会饱和链路，导致对端的 UDP 广播
    // 信标丢包；若仍按 TTL 剔除，就会出现「传输进行中却看不到对端、但文件仍在传/已成功」。
    const activePeers = this.activeTransferPeers()
    let changed = false
    for (const [id, d] of this.devices) {
      // 手动添加 / 正在传输的设备不因超时被剔除
      if (d.manual || activePeers.has(id)) continue
      if (now - d.lastSeen > ttlMs) {
        this.devices.delete(id)
        changed = true
      }
    }
    if (changed) this.bump()
  }

  /** 当前正在收发（active/pending）的对端 id 集合。 */
  private activeTransferPeers(): Set<string> {
    const peers = new Set<string>()
    for (const t of this.transfers) {
      if (t.status === 'active' || t.status === 'pending') peers.add(t.peerId)
    }
    return peers
  }

  /** 已知设备去重后的 IP 列表（供发现服务向已知对端单播保活——单播比广播可靠）。 */
  deviceAddresses(): string[] {
    const ips = new Set<string>()
    for (const d of this.devices.values()) {
      if (d.ip) ips.add(d.ip)
    }
    return [...ips]
  }

  getDevice(id: string): RemoteDevice | undefined {
    return this.devices.get(id)
  }

  isTrusted(deviceId: string): boolean {
    return this.settings.trustedDevices.includes(deviceId)
  }

  /** 该设备身份是否可验证（已掌握其公钥且公钥指纹与其 id 自洽）。 */
  isVerifiable(deviceId: string): boolean {
    const dev = this.devices.get(deviceId)
    return !!dev?.pubKey && matchesFingerprint(deviceId, dev.pubKey)
  }

  /** 取与对端的 ECDH 共享密钥（按 deviceId 缓存）；未知/非法公钥返回 null。 */
  sharedKeyFor(deviceId: string): Buffer | null {
    const cached = this.sharedKeyCache.get(deviceId)
    if (cached) return cached
    const dev = this.devices.get(deviceId)
    if (!dev?.pubKey || !matchesFingerprint(deviceId, dev.pubKey)) return null
    const key = this.sharedKeyForPub(dev.pubKey)
    if (key) this.sharedKeyCache.set(deviceId, key)
    return key
  }

  /** 由对端公钥直接派生共享密钥（接收端用 header 内自证公钥时调用）。 */
  sharedKeyForPub(pubKey: string): Buffer | null {
    try {
      return deriveSharedKey(this.privateKey, pubKey)
    } catch (err) {
      logError('derive shared key failed', err)
      return null
    }
  }

  /** 由对端公钥 + 随机 salt 派生文件加密密钥（接收端用 header 内自证公钥）。 */
  fileKeyForPub(pubKey: string, salt: Buffer): Buffer | null {
    try {
      return deriveFileKey(this.privateKey, pubKey, salt)
    } catch (err) {
      logError('derive file key failed', err)
      return null
    }
  }

  /** 由目标设备（已知且指纹自洽的公钥）+ 随机 salt 派生文件加密密钥。 */
  fileKeyForPeer(deviceId: string, salt: Buffer): Buffer | null {
    const dev = this.devices.get(deviceId)
    if (!dev?.pubKey || !matchesFingerprint(deviceId, dev.pubKey)) return null
    return this.fileKeyForPub(dev.pubKey, salt)
  }

  /** 防重放：时间戳新鲜且 nonce 从未用过 → 记录并放行；否则拒绝。 */
  acceptNonce(nonce: string, ts: number): boolean {
    if (!nonce || !isFreshTimestamp(ts)) return false
    const now = Date.now()
    for (const [n, exp] of this.seenNonces) {
      if (exp <= now) this.seenNonces.delete(n)
    }
    if (this.seenNonces.has(nonce)) return false
    this.seenNonces.set(nonce, now + SIG_TTL_MS)
    return true
  }

  // ── UI 推送（长轮询） ─────────────────────────────────────────
  /** 任何可见状态变更后调用：递增修订号并唤醒所有等待者。 */
  bump(): void {
    this.rev++
    if (this.waiters.size === 0) return
    const fns = [...this.waiters]
    this.waiters.clear()
    for (const fn of fns) {
      try {
        fn()
      } catch {
        /* ignore */
      }
    }
  }

  /** 长轮询：rev 已前进则立即返回，否则挂起到下次 bump 或超时。 */
  waitForChange(
    sinceRev: number,
    timeoutMs: number,
  ): Promise<{ rev: number; state: AppState }> {
    if (this.rev > sinceRev) {
      return Promise.resolve({ rev: this.rev, state: this.getState() })
    }
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        this.waiters.delete(finish)
        clearTimeout(timer)
        resolve({ rev: this.rev, state: this.getState() })
      }
      const timer = setTimeout(finish, timeoutMs)
      this.waiters.add(finish)
    })
  }

  // ── 收件待确认 ───────────────────────────────────────────────
  addIncoming(req: IncomingRequest): void {
    this.incoming.set(req.id, req)
    this.bump()
  }

  removeIncoming(id: string): void {
    if (this.incoming.delete(id)) this.bump()
  }

  // ── 传输记录 ─────────────────────────────────────────────────
  addTransfer(t: Transfer): void {
    this.transfers.unshift(t)
    if (this.transfers.length > MAX_TRANSFERS) {
      this.transfers.length = MAX_TRANSFERS
    }
    this.bump()
  }

  getTransfer(id: string): Transfer | undefined {
    return this.transfers.find((t) => t.id === id)
  }

  updateTransfer(id: string, patch: Partial<Transfer>): void {
    const t = this.getTransfer(id)
    if (!t) return
    Object.assign(t, patch)
    const terminal: Transfer['status'][] = ['done', 'failed', 'rejected', 'canceled']
    if (patch.status && terminal.includes(patch.status)) {
      if (t.endedAt === undefined) t.endedAt = Date.now()
      t.speed = 0
      // 传输刚结束即刷新对端在线时间：避免长传输期间错过的信标，让对端在传输结束、
      // 下一次保活心跳到达之前的窗口里被 TTL 误剔除。
      const dev = this.devices.get(t.peerId)
      if (dev) dev.lastSeen = Date.now()
      this.scheduleHistorySave()
    }
    this.bump()
  }

  clearHistory(): void {
    this.transfers = this.transfers.filter(
      (t) => t.status === 'active' || t.status === 'pending',
    )
    this.scheduleHistorySave()
    this.bump()
  }

  private scheduleHistorySave(): void {
    if (this.historyTimer) clearTimeout(this.historyTimer)
    this.historyTimer = setTimeout(() => {
      this.historyTimer = null
      const terminalOnly = this.transfers
        .filter((t) => t.status !== 'active' && t.status !== 'pending')
        .slice(0, HISTORY_LIMIT)
      host()
        ?.storage?.set(STORAGE_KEY_HISTORY, terminalOnly)
        ?.catch?.(() => {})
    }, 800)
  }

  async setSettings(patch: Partial<Settings>): Promise<Settings> {
    const next: Settings = { ...this.settings, ...patch }
    // 规范化受信任设备列表
    if (patch.trustedDevices) {
      next.trustedDevices = [...new Set(patch.trustedDevices.filter(Boolean))]
    }
    this.settings = next
    if (patch.downloadDir) this.ensureDownloadDir()
    try {
      await host()?.storage?.set(STORAGE_KEY_SETTINGS, this.settings)
    } catch (err) {
      logError('persist settings failed', err)
    }
    this.bump()
    return this.settings
  }

  setTrusted(deviceId: string, trusted: boolean): Promise<Settings> {
    const set = new Set(this.settings.trustedDevices)
    if (trusted) set.add(deviceId)
    else set.delete(deviceId)
    return this.setSettings({ trustedDevices: [...set] })
  }

  // ── 快照 ─────────────────────────────────────────────────────
  getState(): AppState {
    const devices = [...this.devices.values()]
      .map((d) => ({
        ...d,
        trusted: this.isTrusted(d.id),
        verified: this.isVerifiable(d.id),
      }))
      .sort((a, b) => b.lastSeen - a.lastSeen)

    return {
      self: {
        deviceId: this.deviceId,
        deviceName: this.settings.deviceName,
        os: process.platform,
        ips: localIPv4Addresses(),
        port: RECEIVE_PORT,
        version: PROTOCOL_VERSION,
        receiveOnline: this.receiveOnline,
        discoveryOnline: this.discoveryOnline,
        serverError: this.serverError,
        publicKey: this.publicKey,
      },
      devices,
      transfers: this.transfers.slice(0, MAX_TRANSFERS),
      incoming: [...this.incoming.values()],
      settings: this.settings,
    }
  }
}

export const store = new Store()
