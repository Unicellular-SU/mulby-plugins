// 后端 ↔ UI 之间共享的数据结构（通过 host.call 序列化为 JSON）。

export type OsName = 'win32' | 'darwin' | 'linux' | string

/** 本机信息。 */
export interface SelfInfo {
  deviceId: string
  deviceName: string
  os: OsName
  ips: string[]
  port: number
  version: number
  receiveOnline: boolean
  discoveryOnline: boolean
  serverError?: string
  /** 本机 x25519 身份公钥（SPKI DER, base64）。deviceId 即其指纹。 */
  publicKey?: string
}

/** 局域网内发现的对端设备。 */
export interface RemoteDevice {
  id: string
  name: string
  os: OsName
  ip: string
  port: number
  lastSeen: number
  manual?: boolean
  trusted?: boolean
  /** 对端 x25519 身份公钥（SPKI DER, base64）。 */
  pubKey?: string
  /** 已掌握其公钥且公钥指纹与其自报 id 相符（身份可验证）。 */
  verified?: boolean
  /** 通过扫码网关接入的手机会话（浏览器，无原生身份）。id 形如 web:xxxx。 */
  web?: boolean
}

export type TransferDir = 'send' | 'recv'
export type TransferStatus =
  | 'pending'
  | 'active'
  | 'done'
  | 'failed'
  | 'rejected'
  | 'canceled'

/** 单个文件的传输记录（收发通用）。 */
export interface Transfer {
  id: string
  dir: TransferDir
  name: string
  size: number
  transferred: number
  status: TransferStatus
  speed: number // bytes / second（瞬时）
  peerId: string
  peerName: string
  peerIp?: string
  error?: string
  savePath?: string
  batchId?: string
  startedAt: number
  endedAt?: number
  /** 本次传输是否启用了端到端加密（AES-256-GCM）。 */
  encrypted?: boolean
}

/** 收件待确认项（用于 UI 模式确认；默认走系统弹窗确认）。 */
export interface IncomingRequest {
  id: string
  name: string
  size: number
  peerId: string
  peerName: string
  peerIp: string
}

// 'ask' = 非信任设备弹窗确认；'accept-all' = 自动接收所有。信任设备始终自动接收。
export type ReceiveMode = 'ask' | 'accept-all'

/** 用户可配置项。 */
export interface Settings {
  deviceName: string
  downloadDir: string
  receiveMode: ReceiveMode
  discoveryEnabled: boolean
  verifyIntegrity: boolean
  /** 对可验证身份的对端启用端到端加密（AES-256-GCM）。默认开启。 */
  encrypt: boolean
  trustedDevices: string[]
  /** 手机网关（扫码直传）总开关。默认开启；关闭后 /m 与 /w/* 全部拒绝。 */
  mobileGatewayEnabled: boolean
  /** 已通过有效扫码令牌的手机上传是否免确认（扫码=物理授权）。默认开启。 */
  mobileAutoAccept: boolean
}

/** 手机网关配对信息（供桌面 UI 渲染二维码 / PIN / 已连手机）。 */
export interface MobileGatewayInfo {
  enabled: boolean
  /** 网页入口完整 URL（含令牌 fragment），二维码即编码此串。 */
  url: string
  /** 不含令牌的展示用基础地址（host:port）。 */
  baseUrl: string
  /** 本机用于该地址的局域网 IP。 */
  ip: string
  port: number
  /** 6 位数字 PIN（不便扫码时手动输入配对）。 */
  pin: string
  /** 令牌过期时间戳（ms）。 */
  expiresAt: number
  /** 当前已连接的手机数量。 */
  connectedCount: number
}

/** getState 返回的完整快照。 */
export interface AppState {
  self: SelfInfo
  devices: RemoteDevice[]
  transfers: Transfer[]
  incoming: IncomingRequest[]
  settings: Settings
  /** 手机网关状态（用于桌面 UI 二维码面板）。 */
  mobile?: MobileGatewayInfo
}

/** 待发送的文件描述。 */
export interface FileMeta {
  path: string
  name: string
  /**
   * 相对路径（POSIX 分隔符）。发送文件夹时保留层级（如 "myfolder/sub/a.txt"），
   * 供接收端重建目录结构；缺省时等同于 name（平铺到下载目录）。
   */
  relPath?: string
  size: number
}
