import type { FloatingBallIconId } from '../floating-ball-icons'

export type AppShortcutAction =
  | 'toggleWindow'
  | 'openSettings'

export interface AppShortcutSettings {
  toggleWindow: string
  openSettings: string
}

export interface StoreSource {
  id: string
  name: string
  url: string
  enabled: boolean
  priority: number
  lastSyncAt?: number
  lastError?: string
}

export type CommandRuleMode = 'exact' | 'prefix'

export interface CommandRule {
  id: string
  mode: CommandRuleMode
  value: string
  enabled?: boolean
}

export type CommandCallerSource = 'app' | 'plugin'

export type CommandExecutionProfile = 'sandbox' | 'workspace' | 'trusted'

export type CommandSandboxLevel = 'os' | 'policy' | 'none'

export type CommandSandboxBackendMode = 'auto' | 'policy' | 'os'

export type CommandSandboxBackendName =
  | 'policy'
  | 'macos-sandbox-exec'
  | 'windows-job-object'
  | 'linux-namespace'

export interface CommandCallerIdentity {
  kind: 'app' | 'plugin' | 'ai' | 'openclaw' | 'system'
  host?: 'app' | 'plugin' | 'openclaw' | 'system'
  actor?: 'human' | 'ai' | 'remote' | 'system'
  pluginId?: string
  pluginType?: string
  requestId?: string
  model?: string
  skillIds?: string[]
}

export interface CommandSandboxSettings {
  enabled: boolean
  backendMode: CommandSandboxBackendMode
  fallbackToPolicy: boolean
  allowedRoots: string[]
  writableRoots: string[]
  networkAllowed: boolean
}

export interface CommandTrustRecord {
  prefix: string
  matchMode?: 'executable' | 'commandLineExact'
  source: CommandCallerSource
  pluginId?: string
  command: string
  args?: string[]
  shell?: boolean
  createdAt: number
  lastUsedAt: number
}

export type CommandAuditStatus = 'allowed' | 'blocked' | 'error' | 'timeout'

export interface CommandAuditItem {
  id: string
  timestamp: number
  source: CommandCallerSource
  pluginId?: string
  caller?: CommandCallerIdentity
  executionProfile?: CommandExecutionProfile
  sandboxLevel?: CommandSandboxLevel
  sandboxBackend?: CommandSandboxBackendName
  sandboxFallbackReason?: string
  elevatedFrom?: CommandExecutionProfile
  networkAllowed?: boolean
  rootScope?: string[]
  command: string
  args?: string[]
  envKeys?: string[]
  cwd?: string
  shell?: boolean
  timeoutMs?: number
  durationMs?: number
  exitCode?: number | null
  signal?: string | null
  status: CommandAuditStatus
  reason?: string
  success?: boolean
  timedOut?: boolean
  truncated?: boolean
}

export interface CommandRunnerSettings {
  enabled: boolean
  requireConsent: boolean
  allowShell: boolean
  defaultTimeoutMs: number
  maxTimeoutMs: number
  maxOutputBytes: number
  maxConcurrent: number
  maxQueueSize: number
  denyEnvKeys: string[]
  maskEnvKeysInAudit: string[]
  allowList: CommandRule[]
  denyList: CommandRule[]
  trustedFingerprints: CommandTrustRecord[]
  sandbox: CommandSandboxSettings
  audit: {
    maxItems: number
    records: CommandAuditItem[]
  }
}

export type PluginDirectoryAccessMode = 'read' | 'readwrite'

export interface PluginDirectoryAccessGrant {
  id: string
  pluginId: string
  path: string
  mode: PluginDirectoryAccessMode
  source: 'picker' | 'path-confirmation'
  reason?: string
  createdAt: number
  lastUsedAt?: number
}

export interface PluginDirectoryAccessSettings {
  grants: PluginDirectoryAccessGrant[]
}

export interface AiToolFilesystemSettings {
  allowedRoots: string[]
  maxReadBytes: number
  maxEntries: number
  maxSearchHits: number
  maxSearchFileBytes: number
}

export interface AiToolPatchSettings {
  allowedRoots: string[]
  maxPatchBytes: number
  requireDryRunFirst: boolean
}

export interface AiToolHttpSettings {
  timeoutMs: number
  maxResponseBytes: number
  denyHosts: string[]
  denyCidrs: string[]
  denyUrlPrefixes: string[]
}

export interface AiToolScriptEntry {
  id: string
  command: string
  args?: string[]
  cwd?: string
  timeoutMs?: number
  allowEnvKeys?: string[]
}

export interface AiToolRunScriptSettings {
  entries: AiToolScriptEntry[]
  defaultTimeoutMs: number
  maxTimeoutMs: number
}

export interface AiToolGitSettings {
  allowedRepoRoots: string[]
  maxDiffBytes: number
}

/** 内置 API Provider ID */
export type AiToolWebSearchBuiltinApiProvider = 'tavily' | 'jina'

/**
 * 本地搜索引擎配置
 *
 * 通过隐藏 BrowserWindow 加载搜索引擎页面，用 CSS 选择器解析搜索结果。
 * 无需 API Key，零成本方案。
 */
export interface LocalSearchEngineConfig {
  /** 唯一标识，内置的为 'local-bing' / 'local-google' */
  id: string
  /** 显示名称 */
  name: string
  /** URL 模板，%s 会被替换为 encodeURIComponent(query) */
  urlTemplate: string
  /** 搜索结果容器选择器 */
  resultSelector: string
  /** 标题选择器（相对于 resultSelector） */
  titleSelector: string
  /** 链接选择器（相对于 resultSelector） */
  linkSelector: string
  /** 摘要/描述选择器（相对于 resultSelector），用于提取搜索引擎给出的结果摘要 */
  snippetSelector?: string
  /** 可选的 URL 解码策略，如 Bing 需要 'bing-redirect' */
  urlDecoder?: string
  /** 是否内置（不可删除） */
  builtin?: boolean
}

/**
 * 自定义搜索 API 配置
 *
 * 用户可添加任意兼容的搜索 API 接口。
 */
export interface CustomSearchApiConfig {
  /** 唯一标识 */
  id: string
  /** 显示名称 */
  name: string
  /** API 基础 URL */
  apiHost: string
  /** API Key（可选） */
  apiKey?: string
  /** HTTP 方法 */
  method: 'GET' | 'POST'
  /** GET 时的查询参数名，如 'q' */
  queryParam?: string
  /** POST 时的请求体 JSON 模板，%s 会被替换为搜索词 */
  bodyTemplate?: string
  /** 响应中结果数组的 JSON path，如 'data' 或 'results' */
  resultsPath?: string
  /** 标题字段名，默认 'title' */
  titleField?: string
  /** URL 字段名，默认 'url' */
  urlField?: string
  /** 内容字段名，默认 'content' */
  contentField?: string
}

export interface AiToolWebSearchSettings {
  /** 当前激活的 Provider ID（local-bing / local-google / tavily / jina / custom-xxx） */
  activeProvider: string
  /** 搜索最大结果数 */
  maxResults: number
  /** web_fetch 返回内容最大字符数 */
  maxContentLength: number
  /** 搜索/抓取超时（毫秒） */
  timeoutMs: number
  /** 内置 API Provider 的独立 Key 存储 */
  providerKeys: {
    tavily?: string
    jina?: string
  }
  /** Tavily 自定义 Host（可选，默认 https://api.tavily.com） */
  tavilyApiHost?: string
  /** 本地搜索引擎列表（内置 + 用户自定义） */
  localEngines: LocalSearchEngineConfig[]
  /** 用户自定义 API Provider 列表 */
  customApis: CustomSearchApiConfig[]
  /** 本地搜索是否自动获取各结果链接正文（默认 true） */
  fetchContent?: boolean
  /** 每条结果正文最大字符数（默认 2000） */
  maxContentPerResult?: number
  /** 搜索结果域名黑名单（匹配的 URL 将被过滤，如 ['pinterest.com'] ） */
  resultDenyHosts?: string[]

  // ---- 旧字段（仅用于迁移，归一化后丢弃） ----
  /** @deprecated 使用 activeProvider 替代 */
  provider?: string
  /** @deprecated 使用 providerKeys.jina 替代 */
  jinaApiKey?: string
  /** @deprecated 使用 providerKeys.tavily 替代 */
  tavilyApiKey?: string
}

export type AiToolCapabilityGrantDecision = 'allow' | 'deny'

export interface AiToolCapabilityGrant {
  id: string
  capability: string
  decision: AiToolCapabilityGrantDecision
  createdAt?: number
  updatedAt?: number
  expiresAt?: number
}

export interface AiToolCapabilityPolicySettings {
  defaultAppCapabilities: string[]
  /**
   * Canonical grant list: global capability allow/deny rules.
   */
  globalGrants: AiToolCapabilityGrant[]
}

export interface AiToolingSettings {
  enabled: boolean
  filesystem: AiToolFilesystemSettings
  patch: AiToolPatchSettings
  http: AiToolHttpSettings
  runScript: AiToolRunScriptSettings
  git: AiToolGitSettings
  webSearch: AiToolWebSearchSettings
  capabilityPolicy: AiToolCapabilityPolicySettings
  /** 用户禁用的插件工具列表，格式 "pluginId:toolName" */
  disabledPluginTools?: string[]
}

// ==================== MCP Server 设置 ====================

/** MCP Server 配置（将插件工具暴露给外部 AI 工具） */
export interface McpServerSettings {
  /** 是否启用 MCP Server（默认 false） */
  enabled: boolean
  /** HTTP 监听端口（默认 18790） */
  port: number
  /** Bearer Token 认证（首次启用时自动生成） */
  token: string
}

// ==================== OpenClaw Node 设置 ====================

/** 命令执行安全模式 */
export type OpenClawSecurityMode = 'deny' | 'allowlist' | 'full'

/** 审批询问模式 */
export type OpenClawAskMode = 'off' | 'on-miss' | 'always'

/** OpenClaw Gateway 连接配置 */
export interface OpenClawGatewayConfig {
  host: string
  port: number
  useTls: boolean
  tlsFingerprint?: string
}

/** OpenClaw 认证配置 */
export interface OpenClawAuthConfig {
  token?: string
  /** 配对后 Gateway 颁发的 device token（自动管理，用户不可编辑） */
  deviceToken?: string
}

/** OpenClaw Node 标识配置 */
export interface OpenClawNodeConfig {
  displayName: string
  autoConnect: boolean
}

/** OpenClaw 安全策略配置 */
export interface OpenClawSecurityConfig {
  execMode: OpenClawSecurityMode
  execAsk: OpenClawAskMode
  allowedCommands: string[]
  /** 是否暴露 Mulby 插件调用能力 */
  exposePlugins: boolean
  /** 是否暴露剪贴板读写能力 */
  exposeClipboard: boolean
  /** 是否暴露搜索能力 */
  exposeSearch: boolean
}

/** OpenClaw Node 完整设置 */
export interface OpenClawSettings {
  enabled: boolean
  gateway: OpenClawGatewayConfig
  auth: OpenClawAuthConfig
  node: OpenClawNodeConfig
  security: OpenClawSecurityConfig
}

// ==================== 应用更新设置 ====================

/** 应用更新设置 */
export interface UpdateSettings {
  /** 是否自动检查更新（默认 true） */
  autoCheck: boolean
  /** 自动检查间隔（小时，1-168，默认 6） */
  checkIntervalHours: number
  /** 发现新版本时弹系统通知（默认 true） */
  notifyOnUpdate: boolean
}

// 日志级别类型
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// 鼠标触发设置（P2-A）
export type MouseTriggerButton = 'middle' | 'back' | 'forward'
export type MouseTriggerAction = 'click' | 'longpress'

export interface MouseTriggerSettings {
  enabled: boolean
  button: MouseTriggerButton
  action: MouseTriggerAction
  longPressMs: number  // 默认 500
}

// 双击修饰键设置（P2-B）
export type DoubleTapModifier = 'Command' | 'Ctrl' | 'Alt' | 'Shift'

export interface DoubleTapSettings {
  enabled: boolean
  modifier: DoubleTapModifier
}

// 搜索设置
export interface SearchSettings {
  enableApps: boolean             // 搜索框是否搜索本机应用
  enableFiles: boolean            // 搜索框是否搜索本机文件
  enableMainPush: boolean         // 搜索框是否展示插件推送结果（全局开关）
  disabledMainPushPlugins: string[]  // 禁用推送的插件 ID 列表
}

// 输入设置
export interface InputSettings {
  autoPasteOnShow: boolean       // 窗口唤起时自动粘贴剪贴板内容
  autoPasteMaxAge: number         // 剪贴板内容最大有效期（毫秒），默认 5000
}

// 开发项目类型：single=目录直接含 manifest.json；collection=父目录扫子插件
export type PluginProjectType = 'single' | 'collection'

// 开发项目来源
export type PluginProjectSource = 'added' | 'imported' | 'created' | 'migrated'

// 单个开发项目记录（决策 B：pluginProjects[] 设置模型）
export interface PluginProjectEntry {
  id: string                    // 稳定 id，如 `proj-<timestamp>-<rand>`
  path: string                  // path.resolve 后的绝对路径
  type: PluginProjectType       // single / collection
  source: PluginProjectSource   // 添加来源
  label?: string                // 可选展示名（缺省回退 manifest.displayName / basename）
  createdAt: number
  lastOpenedAt?: number
}

// 开发者模式设置
export interface DeveloperSettings {
  enabled: boolean                      // 是否启用开发者模式
  pluginPaths: string[]                 // LEGACY：外部插件开发目录列表，保留只读，仅作迁移来源
  pluginProjects: PluginProjectEntry[]  // NEW：开发项目的唯一事实来源
  autoReload: boolean                   // 是否自动热重载
  showDevTools: boolean                 // 是否自动打开 DevTools
  logLevel: LogLevel                    // 日志级别
}

// 窗口设置
export interface WindowSettings {
  width: number
  height?: number
  x?: number
  y?: number
}

export type TrayClickAction = 'toggleWindow' | 'openMenu'

export interface TraySettings {
  enabled: boolean
  closeToTray: boolean
  clickAction: TrayClickAction
}

// ==================== 悬浮球设置 ====================

export interface FloatingBallPosition {
  x: number
  y: number
  displayId?: number
}

export interface FloatingBallCommandTarget {
  pluginId: string
  featureCode: string
  cmdId?: string
  cmdSignature?: string
  commandLabel?: string
}

export type FloatingBallGesture = 'click' | 'doubleClick' | 'longPress'
export type FloatingBallBuiltinAction = 'toggleMulby' | 'captureRegion'
export type FloatingBallActionBinding =
  | { type: 'builtin'; action: FloatingBallBuiltinAction }
  | { type: 'command'; target: FloatingBallCommandTarget }
  | { type: 'inheritClick' }

export interface FloatingBallActionSettings {
  click: FloatingBallActionBinding
  doubleClick: FloatingBallActionBinding
  longPress: FloatingBallActionBinding
}

export type FloatingBallLongPressAction = 'captureRegion'
export type FloatingBallDropAction = 'openMatches'

export interface FloatingBallSettings {
  enabled: boolean
  position?: FloatingBallPosition
  label: string
  iconId: FloatingBallIconId
  customIconSvg?: string
  size: number
  opacity: number
  snapToEdge: boolean
  actions: FloatingBallActionSettings
  /** @deprecated use actions.doubleClick */
  doubleClickCommand?: FloatingBallCommandTarget
  /** @deprecated use actions.longPress */
  longPressAction?: FloatingBallLongPressAction
  dropAction: FloatingBallDropAction
}

// ==================== 超级面板设置 ====================

/** 超级面板触发方式 */
export type SuperPanelTriggerType = 'mouse_click' | 'mouse_longpress' | 'keyboard' | 'double_tap'

/** 超级面板鼠标按键（扩展支持右键） */
export type SuperPanelMouseButton = 'middle' | 'back' | 'forward' | 'right'

/** 超级面板触发配置 */
export interface SuperPanelTriggerSettings {
  /** 触发类型 */
  type: SuperPanelTriggerType
  /** 鼠标按键（mouse_click / mouse_longpress 模式） */
  mouseButton?: SuperPanelMouseButton
  /** 长按阈值（毫秒），仅 mouse_longpress 模式生效 */
  longPressMs?: number
  /** 键盘快捷键加速器（keyboard 模式），如 'Alt+Q' */
  accelerator?: string
  /** 双击修饰键（double_tap 模式） */
  modifier?: DoubleTapModifier
}

/** 超级面板设置 */
export interface SuperPanelSettings {
  /** 是否启用超级面板（默认 false） */
  enabled: boolean
  /** 触发配置 */
  trigger: SuperPanelTriggerSettings
  /** 屏蔽的应用列表（macOS: bundleId/app, Win: exe 名, Linux: WM_CLASS） */
  blockedApps: string[]
  /** 剪贴板轮询等待时间（毫秒），默认 80 */
  clipboardPollDelayMs: number
  /** 面板最大显示条目数，默认 10 */
  maxItems: number
  /** 即时翻译：是否启用（默认 true，但需 AI 已配置才生效） */
  instantTranslation: boolean
  /** 即时翻译：最大文本长度（超过此长度不触发翻译），默认 5000 */
  translationMaxLength?: number
}

export interface AppSettings {
  shortcuts: AppShortcutSettings
  mouseTrigger: MouseTriggerSettings
  doubleTap: DoubleTapSettings
  storeSources: StoreSource[]
  developer: DeveloperSettings
  commandRunner: CommandRunnerSettings
  pluginDirectoryAccess: PluginDirectoryAccessSettings
  aiTooling: AiToolingSettings
  window?: WindowSettings
  search: SearchSettings
  input: InputSettings
  tray: TraySettings
  floatingBall: FloatingBallSettings
  onboardingCompleted?: boolean
  mcpServer: McpServerSettings
  openclaw: OpenClawSettings
  superPanel: SuperPanelSettings
  updates: UpdateSettings
  /** 应用级权限相关的用户偏好（记录用户对系统权限提示的选择，非系统权限状态本身） */
  permissions?: AppPermissionPreferences
}

/** 应用级权限相关的用户偏好 */
export interface AppPermissionPreferences {
  /** 用户已忽略「输入监控」权限提示，不再自动弹出（仍可在权限管理中手动开启） */
  inputMonitoringPromptDismissed?: boolean
}

export interface ShortcutStatus {
  ok: boolean
  reason?: ShortcutStatusReason
  /** 快捷键生效方式：'hook' 表示通过底层键盘钩子接管（其余情况走系统 globalShortcut，无需 via） */
  via?: 'hook'
}

export type ShortcutStatusReason = 'duplicate' | 'in-use' | 'invalid' | 'system-reserved' | 'permission'

export type ShortcutStatusMap = Record<AppShortcutAction, ShortcutStatus>
