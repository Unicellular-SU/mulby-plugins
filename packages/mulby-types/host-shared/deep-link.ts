/**
 * deep-link.ts — Deep Link（启动链接）类型定义
 *
 * 定义 mulby:// 自定义协议的路由、参数和结果类型。
 */

/** 支持的 Deep Link 动作 */
export type DeepLinkAction =
  | 'plugin/run'
  | 'plugin/install'
  | 'plugin/view'
  | 'settings'
  | 'search'
  | 'store'

/** 解析后的 Deep Link 路由 */
export interface DeepLinkRoute {
  action: DeepLinkAction
  /** 插件 ID（plugin/* 路由时有值） */
  pluginId?: string
  /** 功能入口 code（plugin/run 路由时有值） */
  featureCode?: string
  /** 设置页 section（settings 路由时有值） */
  section?: string
  /** 查询参数 */
  params: Record<string, string>
}

/** Deep Link 处理结果 */
export interface DeepLinkHandleResult {
  success: boolean
  action: DeepLinkAction | 'unknown'
  /** 错误信息 */
  error?: string
  /** 是否经过用户确认 */
  confirmed?: boolean
}

/**
 * 无风险操作列表（跳过用户确认弹窗）
 *
 * 这些操作仅在应用内导航，不涉及插件执行或安装，
 * 因此无需额外安全确认。
 */
export const SAFE_ACTIONS: ReadonlySet<DeepLinkAction> = new Set([
  'settings',
  'search',
  'store',
  'plugin/view'
])

/** Deep Link URL 最大允许长度（防止畸形 URL 攻击） */
export const MAX_DEEP_LINK_URL_LENGTH = 2048

/** 速率限制：同一操作的最短间隔（毫秒） */
export const RATE_LIMIT_INTERVAL_MS = 5000
