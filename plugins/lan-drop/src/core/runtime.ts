// 运行时常量与宿主 API 访问器。
// 后端运行在 Mulby 注入的 Node.js UtilityProcess 中，全局 `mulby` 由宿主注入。

export const APP_TAG = 'mulby-landrop'
// v2：引入 x25519 身份密钥 + 传输签名（自证身份，修复信任绕过）。
export const PROTOCOL_VERSION = 2
export const PLUGIN_ID = 'lan-drop'

// 端口（局域网内固定，便于手动输入 IP 直连）；可用环境变量覆盖（便于多实例/测试）
export const DISCOVERY_PORT = Number(process.env.LANDROP_DISCOVERY_PORT) || 52800
export const RECEIVE_PORT = Number(process.env.LANDROP_RECEIVE_PORT) || 52801

// 设备发现节奏
export const BEACON_INTERVAL_MS = 3000
export const DEVICE_TTL_MS = 12000

// 传输相关
export const PROGRESS_THROTTLE_MS = 350
// 超过该大小则跳过 sha256 预计算，避免大文件二次读盘（仍以字节数校验完整性）
export const MAX_HASH_BYTES = 1024 * 1024 * 1024 // 1 GiB

// 接收端抗滥用 / 容量保护（P1/P2）
export const MAX_CONCURRENT_RECEIVES = 8 // 同时落盘的接收数上限（超出返回 503）
export const MAX_PENDING_CONFIRMS = 5 // 同时等待用户确认的未验证请求上限（防弹窗刷屏 DoS）
export const DISK_SPACE_MARGIN = 16 * 1024 * 1024 // 落盘前要求保留的额外空闲余量（16 MiB）

export type HostApi = any

/** 惰性获取宿主注入的全局 mulby 代理（模块加载早于注入时也安全）。 */
export function host(): HostApi {
  return (globalThis as any).mulby
}

/** 安全发送系统通知。 */
export async function notify(
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'info',
): Promise<void> {
  try {
    await host()?.notification?.show(message, type)
  } catch {
    /* 通知失败不影响主流程 */
  }
}

// 后端插件 API 没有 `log` 命名空间（那是前端 API 才有的）。早期实现误调 host().log，
// 由于后端 mulby 代理会把它变成一次异步 RPC 并被宿主以「Unknown API namespace: log」
// 拒绝，且返回的 Promise 未被 await/catch，导致启动时刷 UnhandledPromiseRejection。
// 宿主会把插件的 console 输出捕获为插件日志（即日志里的 `[lan-drop]` 前缀），故仅用 console。

/** 统一日志（console 输出会被宿主捕获为插件日志）。 */
export function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[lan-drop]', ...args)
}

export function logError(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.error('[lan-drop]', ...args)
}
