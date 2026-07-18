/**
 * Storage V2 类型定义
 *
 * 在现有 storage API 上扩展的高级能力：分页遍历、批量操作、CAS 并发控制、事务、追加写、变更订阅。
 * 供主进程、渲染进程、插件类型三层共享。
 */

// ====== 错误码 ======
export type StorageErrorCode =
  | 'E_CONFLICT'         // CAS 版本冲突
  | 'E_NOT_FOUND'        // 键不存在
  | 'E_QUOTA_EXCEEDED'   // 空间不足
  | 'E_INVALID_KEY'      // key 不合法
  | 'E_INVALID_VALUE'    // value 不可序列化
  | 'E_TX_ABORTED'       // 事务失败已回滚
  | 'E_RATE_LIMITED'     // 高频写入被限流
  | 'E_UNSUPPORTED'      // 当前平台不支持某能力

// ====== 附件存储（storage.attachment）======

/**
 * 单个附件文件大小上限（50MB）。主进程与 preload 共用此常量：
 * preload 先做预检，避免超大 payload 跨 IPC 序列化进主进程内存。
 */
export const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024

/** 附件写入错误码（attachment.put 用，区别于 KV 的 StorageErrorCode） */
export type AttachmentErrorCode =
  | 'E_TOO_LARGE'    // 超过单文件 50MB 上限
  | 'E_INVALID_ID'   // id 非法（路径穿越 / Windows 保留名 / 控制字符 / 结尾点空格 / 超长等）
  | 'E_IO'           // 文件写入或重命名失败
  | 'E_META'         // 元数据写入失败（对应文件已回滚删除）

/** 附件写入结果：成功 `{ ok: true }`，失败 `{ ok: false, error }` */
export interface AttachmentPutResult {
  ok: boolean
  error?: AttachmentErrorCode
}

// ====== list：按前缀分页遍历 ======

export interface StorageListOptions {
  /** 键前缀过滤（如 'chat:s:' 可遍历所有会话） */
  prefix?: string
  /** 分页游标：从该 key 之后开始（不含该 key 本身） */
  startsAfter?: string
  /** 每页数量，默认 50，上限 500 */
  limit?: number
  /** 排序方向，默认 'asc' */
  order?: 'asc' | 'desc'
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
}

export interface StorageListItem {
  key: string
  /** value 的字节数 */
  size: number
  updatedAt: number
  version: number
}

export interface StorageListResult {
  items: StorageListItem[]
  /** 下一页游标（传入下次的 startsAfter），undefined 表示已到末尾 */
  nextCursor?: string
}

// ====== getMany：批量读取 ======

export interface StorageGetManyItem {
  key: string
  found: boolean
  value?: unknown
  version?: number
  updatedAt?: number
}

// ====== setMany：批量写入 ======

export interface StorageSetManyItem {
  key: string
  value: unknown
  /** CAS：期望的版本号。null 表示仅在 key 不存在时写入。undefined 表示无条件写入 */
  expectedVersion?: number | null
}

export interface StorageSetManyOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** 是否原子执行（默认 true：任一失败则全回滚） */
  atomic?: boolean
}

export interface StorageSetManyResultItem {
  key: string
  ok: boolean
  version?: number
  error?: StorageErrorCode
}

export interface StorageSetManyResult {
  success: boolean
  results: StorageSetManyResultItem[]
}

// ====== getMeta：获取值 + 元数据 ======

export interface StorageMetaResult {
  found: boolean
  value?: unknown
  version?: number
  updatedAt?: number
}

// ====== setWithVersion：CAS 写入 ======

export interface StorageSetVersionOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** CAS：期望的版本号。null 表示仅在 key 不存在时写入。undefined 表示无条件写入 */
  expectedVersion?: number | null
}

export interface StorageSetVersionResult {
  ok: boolean
  /** 写入成功后的新版本号 */
  version?: number
  /** 冲突时返回当前版本号 */
  conflict?: { currentVersion: number }
  /** 失败原因（如写保留前缀键返回 E_INVALID_KEY） */
  error?: StorageErrorCode
}

// ====== removeWithVersion：CAS 删除 ======

export interface StorageRemoveVersionOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** CAS：期望的版本号 */
  expectedVersion?: number
}

export interface StorageRemoveVersionResult {
  ok: boolean
  error?: StorageErrorCode
}

// ====== transaction：原子事务 ======

export interface StorageTransactionOp {
  op: 'set' | 'remove'
  key: string
  value?: unknown
  /** CAS：期望的版本号。null 表示仅在 key 不存在时写入 */
  expectedVersion?: number | null
}

export interface StorageTransactionOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
}

export interface StorageTransactionResult {
  success: boolean
  /** 成功提交的操作数（失败时为 0） */
  committed: number
  /** 冲突键列表（仅失败时返回） */
  conflicts?: Array<{ key: string; currentVersion: number }>
}

// ====== append：追加写入（JSON 数组） ======

export interface StorageAppendOptions {
  /** 命名空间（UI 侧使用，后端自动填充） */
  namespace?: string
  /** 自动滚动窗口：数组超过该长度时，从头部截断 */
  maxItems?: number
}

export interface StorageAppendResult {
  ok: boolean
  /** 追加后数组的新长度 */
  newLength: number
  /** 新版本号 */
  version: number
}

// ====== watch：变更订阅 ======

export interface StorageWatchOptions {
  /** 命名空间过滤 */
  namespace?: string
  /** 键前缀过滤 */
  prefix?: string
}

export interface StorageWatchEvent {
  type: 'set' | 'remove' | 'clear'
  key: string
  namespace: string
  version?: number
  updatedAt: number
  /**
   * 变更来源通道，省略时按 'kv' 处理。
   * - 'kv'：普通键值（key 为业务键）
   * - 'attachment'：附件文件（key 为附件 id，需用 attachment.get 读取）
   * - 'encrypted'：加密项（key 为业务键，需用 encrypted.get 读取）
   */
  source?: 'kv' | 'attachment' | 'encrypted'
}
