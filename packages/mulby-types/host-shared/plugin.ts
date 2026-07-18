import type {
  AiAttachmentRef,
  AiImageGenerateProgressChunk,
  AiMessage,
  AiModel,
  AiModelsFilter,
  AiOption,
  AiPromiseLike,
  AiSkillPreview,
  AiSkillRecord,
  AiTokenBreakdown
} from './ai'
import type {
  CommandAuditItem,
  CommandRunnerSettings,
  PluginDirectoryAccessGrant,
  PluginDirectoryAccessMode
} from './settings'
import type {
  StorageListOptions,
  StorageListResult,
  StorageGetManyItem,
  StorageSetManyItem,
  StorageSetManyResult,
  StorageMetaResult,
  StorageSetVersionResult,
  StorageRemoveVersionResult,
  StorageTransactionOp,
  StorageTransactionResult,
  StorageAppendOptions,
  StorageAppendResult
} from './storage-v2'

// 插件类型
export type PluginType =
  | 'utility'      // 实用工具（计算器、格式转换）
  | 'productivity' // 效率工具（剪贴板管理、快捷启动）
  | 'developer'    // 开发者工具（JSON 格式化、编码转换）
  | 'system'       // 系统工具（系统信息、进程管理）
  | 'media'        // 媒体工具（图片处理、视频转换）
  | 'network'      // 网络工具（API 测试、网络诊断）
  | 'ai'           // AI 工具（翻译、文本生成）
  | 'entertainment' // 休闲娱乐
  | 'other'        // 其他

// 图标类型
export interface IconUrl {
  type: 'url'
  value: string
}

export interface IconSvg {
  type: 'svg'
  value: string
}

export interface IconFile {
  type: 'file'
  value?: string  // 相对路径，默认为 'icon.png'
}

export interface IconEmoji {
  type: 'emoji'
  value: string
}

export type PluginIconObject = IconUrl | IconSvg | IconFile | IconEmoji

// 支持简写：字符串会自动解析为对应类型
export type PluginIcon = PluginIconObject | string

// 解析后的图标数据（传递给渲染进程）
export interface ResolvedIcon {
  type: 'url' | 'svg' | 'data-url' | 'emoji'
  value: string
}

// 输入附件
export type InputAttachmentKind = 'file' | 'image'

export interface CaptureRegionInfo {
  x: number
  y: number
  width: number
  height: number
  displayId?: number
  scaleFactor?: number
}

export interface CaptureDisplayInfo {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  isPrimary: boolean
}

export interface InputAttachmentCaptureInfo {
  type: 'region' | 'fullscreen'
  region?: CaptureRegionInfo
  display?: CaptureDisplayInfo
}

export interface InputAttachment {
  id: string
  name: string
  size: number
  kind: InputAttachmentKind
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
  capture?: InputAttachmentCaptureInfo
}

/** 系统前台窗口信息 */
export interface ActiveWindowInfo {
  /** 应用名称 (如 "Safari", "Visual Studio Code") */
  app: string
  /** 窗口标题 */
  title: string
  /** 进程 ID */
  pid?: number
  /** macOS Bundle ID (如 "com.apple.Safari") */
  bundleId?: string
}

export interface InputPayload {
  text: string
  attachments: InputAttachment[]
  /** 搜索时的系统前台窗口上下文 */
  activeWindow?: ActiveWindowInfo
}

// Phase 4: 插件间通信消息
export interface PluginMessage {
  id: string              // 消息 ID
  from: string            // 发送者插件 ID
  to?: string             // 接收者插件 ID（可选，不指定则为广播）
  type: string            // 消息类型
  payload: unknown        // 消息内容
  timestamp: number       // 时间戳
}

// 命令类型
export interface CmdKeyword {
  type: 'keyword'
  value: string
}

export interface CmdRegex {
  type: 'regex'
  match: string
  explain?: string
  label?: string       // 指令名称（显示在搜索结果中）
  minLength?: number   // 最少字符数
  maxLength?: number   // 最多字符数
}

// 文件类型过滤
export type FileType = 'file' | 'directory' | 'any'

export interface CmdFiles {
  type: 'files'
  label?: string          // 指令名称
  exts?: string[]         // 文件扩展名（可选）
  fileType?: FileType     // 文件类型过滤（默认 'any'）
  match?: string          // 匹配文件(夹)名称的正则表达式（与 exts 二选一）
  minLength?: number      // 最少文件数
  maxLength?: number      // 最多文件数
}

export interface CmdImg {
  type: 'img'
  label?: string
  exts?: string[]
}

export interface CmdOver {
  type: 'over'
  label?: string       // 指令名称
  exclude?: string     // 排除的正则表达式
  minLength?: number   // 最少字符数
  maxLength?: number   // 最多字符数（默认 10000）
}

export interface CmdWindow {
  type: 'window'
  app?: string         // 应用名称匹配（"/正则/" 或精确匹配，忽略大小写）
  title?: string       // 窗口标题匹配（"/正则/" 或精确匹配，忽略大小写）
  bundleId?: string    // macOS Bundle ID 精确匹配（如 "com.apple.Safari"）
  label?: string       // 指令名称
}

export type PluginCmd = CmdKeyword | CmdRegex | CmdFiles | CmdImg | CmdOver | CmdWindow
export type CommandKind = 'launch' | 'match'

export interface PluginCommandItem {
  pluginId: string
  pluginName: string
  pluginDisplayName: string
  featureCode: string
  featureExplain: string
  cmdId: string
  cmdType: PluginCmd['type']
  cmdSignature: string
  commandKind: CommandKind
  displayLabel: string
  explain?: string
  bindable: boolean
  disabled: boolean
}

export interface PluginCommandShortcutBinding {
  id: string
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  commandLabel: string
  accelerator: string
  createdAt: number
  updatedAt: number
}

export type PluginCommandShortcutBindingState =
  | 'active'
  | 'plugin-disabled'
  | 'plugin-missing'
  | 'feature-missing'
  | 'command-missing'
  | 'command-not-bindable'
  | 'command-disabled'
  | 'system-reserved-shortcut'
  | 'shortcut-conflict'
  | 'invalid-shortcut'

export interface PluginCommandShortcutBindingRecord extends PluginCommandShortcutBinding {
  state: PluginCommandShortcutBindingState
  pluginDisplayName?: string
  featureExplain?: string
  cmdType?: PluginCmd['type']
}

export interface PluginCommandShortcutBindInput {
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  commandLabel: string
  accelerator: string
}

export interface PluginCommandShortcutBindResult {
  success: boolean
  error?: string
  state?: PluginCommandShortcutBindingState
  binding?: PluginCommandShortcutBindingRecord
}

export interface PluginCommandShortcutValidationResult {
  ok: boolean
  error?: string
  state?: PluginCommandShortcutBindingState
}

export interface PluginCommandRunInput {
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  input?: string | InputPayload
}

export interface PluginRunResult {
  success: boolean
  hasUI?: boolean
  uiMode?: 'attached' | 'detached'
  error?: string
}

export interface PluginCommandDisabledToggleInput {
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  disabled: boolean
}

export interface PluginCommandDisabledToggleResult {
  success: boolean
  disabled: boolean
  error?: string
}

export type DynamicCmdInput = string | PluginCmd

export interface DynamicFeatureInput {
  code: string
  explain?: string
  icon?: string
  platform?: string | string[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  mainHide?: boolean
  mainPush?: boolean
  cmds: DynamicCmdInput[]
}

export interface DynamicFeature {
  code: string
  explain: string
  icon?: string
  platform?: string | string[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  mainHide?: boolean
  mainPush?: boolean
  cmds: PluginCmd[]
}

// 功能入口
export interface PluginFeature {
  code: string
  explain: string
  cmds: PluginCmd[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  icon?: PluginIcon     // 功能独立图标（支持路径/svg/网络链接）
  mainPush?: boolean    // 是否向搜索框推送内容
  mainHide?: boolean    // 触发该功能时不显示主窗口
  preCapture?: 'region' | 'fullscreen'  // 在启动插件前先执行截图，截图数据作为 attachment 传入
}

// 窗口类型
export type WindowType = 'default' | 'borderless' | 'fullscreen'

// 独立窗口配置
export interface WindowOptions {
  width?: number       // 默认宽度
  height?: number      // 默认高度
  minWidth?: number    // 最小宽度
  minHeight?: number   // 最小高度
  maxWidth?: number    // 最大宽度
  maxHeight?: number   // 最大高度
  type?: WindowType    // 窗口类型：default(带标题栏)、borderless(无边框)、fullscreen(全屏)
  titleBar?: boolean   // 是否显示 Mulby 标题栏（default 类型默认 true，其他类型默认 false）
  alwaysOnTop?: boolean // detached 窗口初始置顶状态
  alwaysOnTopLevel?: string // Electron setAlwaysOnTop 的 level（如 screen-saver）；未设时 Windows 会补默认
  resizable?: boolean  // 是否可调整大小；与透明窗口尺寸钉扎逻辑配合
  fullscreenable?: boolean // 是否允许进入系统全屏/缩放；默认 true，macOS 上也影响最大化能力
  focusable?: boolean  // 是否可获取焦点（默认 true）；设为 false 时窗口不会成为 key window
  opacity?: number     // 窗口透明度（0.0 完全透明 ~ 1.0 完全不透明，运行时可调）
  transparent?: boolean // 窗口背景透明（配合 CSS background: transparent 实现穿透效果，仅创建时生效）
  visibleOnAllWorkspaces?: boolean // 是否在所有桌面/工作区可见（macOS Mission Control / Windows 虚拟桌面）
  visibleOnFullScreen?: boolean    // 配合 visibleOnAllWorkspaces 使用，全屏应用上方可见（macOS）
  ignoreMouseEvents?: boolean      // detached 窗口初始是否忽略鼠标事件
  forwardMouseEvents?: boolean     // ignoreMouseEvents 为 true 时是否继续转发鼠标移动事件
  skipTaskbar?: boolean            // 请求从任务栏/Dock 隐藏该窗口；macOS 仍可能显示 Mulby 应用级 Dock 图标
  backgroundThrottling?: boolean // 是否允许后台节流；false 可让后台/遮挡窗口继续刷新 timer/repaint
  position?: 'default' | 'capture-region' // preCapture 区域截图后，按截图区域定位窗口
  fit?: 'default' | 'capture-region' | 'capture-region-with-toolbar' // preCapture 区域截图后，按截图区域调整窗口大小
  captureToolbarHeight?: number // fit 为 capture-region-with-toolbar 时追加的工具条高度
}

// Phase 4: 资源限制配置
export interface ResourceLimits {
  maxMemoryMB?: number           // 最大内存使用（MB）
  maxRequestsPerMinute?: number  // 每分钟最大请求数
  maxErrorsPerMinute?: number    // 每分钟最大错误数
  memoryLeakThresholdMBPerMinute?: number  // 内存泄漏阈值（MB/分钟）
}

// 资源限制预设
export type ResourceLimitPreset = 'low' | 'medium' | 'high' | 'unlimited'

// 插件行为设置
export interface PluginSetting {
  single?: boolean          // 是否单例模式运行（默认 true）
  height?: number           // 插件初始高度
  defaultDetached?: boolean // 是否默认以独立窗口运行（默认 false）
  background?: boolean      // 是否允许后台运行（默认 false）
  persistent?: boolean      // 是否在重启后恢复上次后台运行状态（默认 false）
  maxRuntime?: number       // 最大运行时间（毫秒，0 表示无限制，默认 0）
  resourceLimits?: ResourceLimits | ResourceLimitPreset  // 资源限制配置或预设
  /**
   * 宿主进程空闲超时后自动销毁的等待时间（毫秒）。
   * - 不设置：使用默认值（5 分钟）
   * - 0 / 'never'：永不自动销毁（适合需要持久连接的后台调度插件）
   */
  idleTimeoutMs?: number | 'never'
}

export interface PluginPermissions {
  runCommand?: boolean
  commandExecution?: {
    direct?: {
      enabled?: boolean
      defaultProfile?: 'sandbox' | 'workspace' | 'trusted'
      maxProfile?: 'sandbox' | 'workspace' | 'trusted'
    }
    ai?: {
      enabled?: boolean
      defaultProfile?: 'sandbox' | 'workspace' | 'trusted'
      maxProfile?: 'sandbox' | 'workspace' | 'trusted'
    }
  }
  webview?: boolean
  /**
   * 允许插件访问麦克风。插件 UI 使用 getUserMedia({ audio: true })
   * 或调用 media/permission 的麦克风权限 API 时必须声明。
   */
  microphone?: boolean
  /**
   * 允许插件访问摄像头。插件 UI 使用 getUserMedia({ video: true })
   * 或调用 media/permission 的摄像头权限 API 时必须声明。
   */
  camera?: boolean
  /**
   * 允许插件访问屏幕录制/截图能力。插件 UI 使用 screen API 或
   * getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } })
   * 进行桌面捕获时必须声明。
   */
  screen?: boolean
  /**
   * 允许插件读写系统剪贴板和剪贴板历史。
   */
  clipboard?: boolean
  /**
   * 允许插件发送系统通知。
   */
  notification?: boolean
  /**
   * 允许插件访问定位权限 API 和获取当前位置。
   */
  geolocation?: boolean
  /**
   * 允许插件检查/请求系统辅助功能权限。
   */
  accessibility?: boolean
  /**
   * 允许插件检查/请求通讯录权限。
   */
  contacts?: boolean
  /**
   * 允许插件检查/请求日历权限。
   */
  calendar?: boolean
  /**
   * 全局输入事件监听（鼠标/键盘）
   *
   * 启用后插件可调用 inputMonitor API 监听全局鼠标点击轨迹和键盘输入。
   * macOS 需要辅助功能权限 (Accessibility)，首次使用时自动引导授权。
   */
  inputMonitor?: boolean
  /**
   * 命令执行时允许继承的环境变量名列表
   *
   * - 未声明 / 空数组：仅继承内置安全基线（PATH、HOME、LANG 等）
   * - `['JAVA_HOME', 'GOPATH']`：在安全基线之上额外继承指定变量
   * - `'*'`：继承主进程全部环境变量（高风险，仅可信插件使用）
   *
   * 仅在命令执行权限启用时生效（legacy `runCommand` 或 `commandExecution`）。
   */
  envKeys?: string[] | '*'
}

export type PluginPermissionStatus =
  | 'authorized'
  | 'granted'
  | 'denied'
  | 'not-determined'
  | 'restricted'
  | 'limited'
  | 'unknown'

export interface PluginRendererCapabilities {
  webview: boolean
}

// 插件 AI Tool 声明（在 manifest 中声明，供 AI Agent 发现和调用）
export interface PluginToolSchema {
  name: string                   // tool 名称（插件范围内唯一，仅允许 [a-zA-Z0-9_-]）
  description: string            // tool 描述（AI 用来理解功能）
  inputSchema: {                 // 输入参数 JSON Schema
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
  outputSchema?: {               // 输出 JSON Schema（可选，提升 AI 理解）
    type: 'object'
    properties: Record<string, unknown>
  }
}

// 插件 Tool 进度上报
export interface PluginToolProgress {
  progress: number
  total?: number
  message?: string
}

// 插件 Tool 执行上下文
export interface PluginToolCallContext {
  callId?: string
  abortSignal?: AbortSignal
  sendProgress: (progress: PluginToolProgress) => void
}

// 插件 Tool Handler 函数签名
export type PluginToolHandler = (args: unknown, ctx?: PluginToolCallContext) => unknown | Promise<unknown>

// 插件清单
export interface PluginManifest {
  id?: string  // 唯一标识符（推荐格式：@scope/name 或 com.example.name）
  name: string
  version: string
  type?: PluginType  // 插件类型
  author?: string
  homepage?: string
  displayName: string
  description: string
  /**
   * 平台限制（可选）。未设置表示全平台兼容。
   * 可设置单个平台（如 "darwin"）或多个平台（如 ["win32", "linux"]）。
   * 可选值："darwin" | "win32" | "linux"
   */
  platform?: string | string[]
  main: string
  ui?: string  // UI 文件路径（可选）
  preload?: string  // 自定义 preload 脚本路径（可选）
  assets?: string[]  // 打包时额外包含的文件或目录（可选）
  icon?: PluginIcon  // 插件图标（可选）
  permissions?: PluginPermissions  // 权限声明（可选）
  features: PluginFeature[]
  tools?: PluginToolSchema[]     // 插件声明的 AI 工具（可选，供 AI Agent 调用）
  window?: WindowOptions  // 独立窗口配置（可选）
  pluginSetting?: PluginSetting  // 插件行为设置（可选）
}

export interface PluginRunCommandInput {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  shell?: boolean
  executionProfile?: 'sandbox' | 'workspace' | 'trusted'
  network?: boolean
  writableRoots?: string[]
}

export interface PluginRunCommandResult {
  success: boolean
  command: string
  args: string[]
  cwd?: string
  shell: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  durationMs: number
  timedOut: boolean
  truncated: boolean
}

export interface PluginDirectoryAccessRequestInput {
  path?: string
  mode?: PluginDirectoryAccessMode
  title?: string
  message?: string
  reason?: string
}

// 插件实例
export interface Plugin {
  id: string  // 解析后的唯一标识符（优先使用 manifest.id，否则使用 manifest.name）
  manifest: PluginManifest
  path: string
  enabled: boolean
  resolvedIcon?: ResolvedIcon  // 解析后的图标数据
  isDev?: boolean  // 是否为开发目录的插件
  /**
   * 当同 id 出现冲突且本插件胜出时，记录被其“覆盖/接管”的另一来源插件路径。
   * 典型场景：开发者模式下，开发目录插件覆盖了已安装的同 id 插件，此处记录被覆盖的已安装版路径。
   * 用于 UI 冲突提示，告知用户当前实际生效的是哪个版本。
   */
  overriddenInstallPath?: string
}

// 插件生命周期钩子
export interface PluginHookContext {
  api: PluginAPI
}

export interface PluginLifecycleHooks {
  onLoad?: (context?: PluginHookContext) => void | Promise<void>
  onIdleLoad?: (context?: PluginHookContext) => void | Promise<void>
  onUnload?: (context?: PluginHookContext) => void | Promise<void>
  onEnable?: (context?: PluginHookContext) => void | Promise<void>
  onDisable?: (context?: PluginHookContext) => void | Promise<void>
  onBackground?: (context?: PluginHookContext) => void | Promise<void>  // 进入后台时
  onForeground?: (context?: PluginHookContext) => void | Promise<void>  // 从后台恢复时
}

// 插件模块导出
export interface PluginModule extends PluginLifecycleHooks {
  run: (context: PluginContext) => void | Promise<void>
}

// 插件执行上下文
export interface PluginContext {
  api: PluginAPI
  featureCode: string
  input: string
  attachments?: InputAttachment[]
}

// 剪贴板文件信息
export interface ClipboardFileInfo {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

// 插件 API 类型
export interface PluginAPI {
  clipboard: {
    readText: () => string
    writeText: (text: string) => Promise<void>
    readImage: () => Buffer | null
    writeImage: (buffer: Buffer) => void
    readFiles: () => ClipboardFileInfo[]
    getFormat: () => 'text' | 'image' | 'files' | 'empty'
  }
  input: {
    hideMainWindowPasteText: (text: string) => Promise<boolean>
    hideMainWindowPasteImage: (image: string | Buffer | ArrayBuffer | Uint8Array) => Promise<boolean>
    hideMainWindowPasteFile: (filePaths: string | string[]) => Promise<boolean>
    hideMainWindowTypeString: (text: string) => Promise<boolean>
    restoreWindows: () => Promise<boolean>
    simulateKeyboardTap: (key: string, ...modifiers: string[]) => Promise<boolean>
    simulateMouseMove: (x: number, y: number) => Promise<boolean>
    simulateMouseClick: (x: number, y: number) => Promise<boolean>
    simulateMouseDoubleClick: (x: number, y: number) => Promise<boolean>
    simulateMouseRightClick: (x: number, y: number) => Promise<boolean>
  }
  notification: {
    show: (message: string, type?: string) => void
  }
  storage: {
    get: (key: string) => unknown
    set: (key: string, value: unknown) => void
    remove: (key: string) => void
    clear: () => void
    keys: () => string[]
    has: (key: string) => boolean
    getAll: () => Record<string, unknown>
    bulkSet: (entries: Record<string, unknown>) => void
    // V2 扩展方法
    list: (options?: StorageListOptions) => StorageListResult
    getMany: (keys: string[]) => StorageGetManyItem[]
    setMany: (items: StorageSetManyItem[], options?: { atomic?: boolean }) => StorageSetManyResult
    getMeta: (key: string) => StorageMetaResult
    setWithVersion: (key: string, value: unknown, expectedVersion?: number | null) => StorageSetVersionResult
    removeWithVersion: (key: string, expectedVersion?: number) => StorageRemoveVersionResult
    transaction: (ops: StorageTransactionOp[]) => StorageTransactionResult
    append: (key: string, chunk: unknown, options?: StorageAppendOptions) => StorageAppendResult
  }
  filesystem: {
    readFile: (path: string, encoding?: 'utf-8' | 'base64') => string | Buffer
    writeFile: (path: string, data: string | Buffer, encoding?: 'utf-8' | 'base64') => void
    exists: (path: string) => boolean
    unlink: (path: string) => void
    readdir: (path: string) => string[]
    mkdir: (path: string) => void
    stat: (path: string) => FileStat | null
    copy: (src: string, dest: string) => void
    move: (src: string, dest: string) => void
    extname: (path: string) => string
    join: (...paths: string[]) => string
    dirname: (path: string) => string
    basename: (path: string, ext?: string) => string
  }
  http: {
    request: (options: HttpRequestOptions) => Promise<HttpResponse>
    get: (url: string, headers?: Record<string, string>) => Promise<HttpResponse>
    post: (url: string, body?: string | object, headers?: Record<string, string>) => Promise<HttpResponse>
    put: (url: string, body?: string | object, headers?: Record<string, string>) => Promise<HttpResponse>
    delete: (url: string, headers?: Record<string, string>) => Promise<HttpResponse>
  }
  shell: {
    openPath: (path: string) => Promise<string>
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (path: string) => void
    openFolder: (path: string) => Promise<string>
    trashItem: (path: string) => Promise<void>
    beep: () => void
    runCommand: (input: PluginRunCommandInput) => Promise<PluginRunCommandResult>
    getRunCommandPolicy: () => Promise<Pick<CommandRunnerSettings, 'enabled' | 'requireConsent' | 'allowShell' | 'allowList' | 'denyList'>>
    listRunCommandAudit: (limit?: number) => Promise<CommandAuditItem[]>
  }
  directoryAccess: {
    request: (input?: PluginDirectoryAccessRequestInput) => Promise<PluginDirectoryAccessGrant | null>
    list: () => Promise<PluginDirectoryAccessGrant[]>
    revoke: (grantIdOrPath: string) => Promise<boolean>
  }
  media: {
    getAccessStatus: (mediaType: 'microphone' | 'camera') => PluginPermissionStatus
    askForAccess: (mediaType: 'microphone' | 'camera') => Promise<boolean>
    hasCameraAccess: () => boolean
    hasMicrophoneAccess: () => boolean
  }
  permission: {
    getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'screen' | 'accessibility' | 'contacts' | 'calendar' | 'notifications') => PluginPermissionStatus
    request: (type: 'geolocation' | 'camera' | 'microphone' | 'screen' | 'accessibility' | 'contacts' | 'calendar' | 'notifications') => Promise<PluginPermissionStatus>
    canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'screen' | 'accessibility' | 'contacts' | 'calendar' | 'notifications') => boolean
    openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'screen' | 'accessibility' | 'contacts' | 'calendar' | 'notifications') => boolean
    isAccessibilityTrusted: () => boolean
  }
  features: {
    getFeatures: (codes?: string[]) => DynamicFeature[]
    setFeature: (feature: DynamicFeatureInput) => void
    removeFeature: (code: string) => boolean
    redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => void
    redirectAiModelsSetting: () => void
  }
  messaging: {
    send: (targetPluginId: string, type: string, payload: unknown) => Promise<void>
    broadcast: (type: string, payload: unknown) => Promise<void>
    on: (handler: (message: PluginMessage) => void | Promise<void>) => void
    off: (handler: (message: PluginMessage) => void | Promise<void>) => void
  }
  ai: {
    call: (option: AiOption, onChunk?: (chunk: AiMessage) => void) => AiPromiseLike<AiMessage>
    allModels: (filter?: AiModelsFilter) => Promise<AiModel[]>
    abort: (requestId: string) => void
    skills: {
      listEnabled: () => Promise<AiSkillRecord[]>
      previewForCall: (input: { option?: Partial<AiOption>; skillIds?: string[]; prompt?: string }) => Promise<AiSkillPreview>
    }
    attachments: {
      upload: (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<AiAttachmentRef>
      get: (attachmentId: string) => Promise<AiAttachmentRef | null>
      delete: (attachmentId: string) => Promise<void>
      uploadToProvider: (input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }) => Promise<{ providerId: string; fileId: string; uri?: string }>
    }
    tokens: {
      estimate: (input: { model?: string; messages: AiMessage[]; outputText?: string }) => Promise<AiTokenBreakdown>
    }
    images: {
      generate: (input: { prompt: string; model: string; size?: string; count?: number }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
      generateStream: (
        input: { prompt: string; model: string; size?: string; count?: number },
        onChunk: (chunk: AiImageGenerateProgressChunk) => void
      ) => AiPromiseLike<{ images: string[]; tokens: AiTokenBreakdown }>
      edit: (input: { imageAttachmentId: string; prompt: string; model: string }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
    }
  }
  inputMonitor: {
    isAvailable: () => boolean
    requireAccessibility: () => Promise<boolean>
    start: (options?: {
      mouse?: boolean
      keyboard?: boolean
      throttleMs?: number
    }, callback?: (event: GlobalInputEventData) => void) => Promise<string | null>
    stop: (sessionId: string) => void
    onEvent: (sessionId: string, callback: (event: GlobalInputEventData) => void) => void
  }
  tools: {
    register: (name: string, handler: PluginToolHandler) => void   // 注册 tool handler（需先在 manifest.tools 中声明）
    unregister: (name: string) => void                              // 注销 tool handler
  }
}

export interface GlobalInputEventData {
  type: 'mouseMove' | 'mouseDown' | 'mouseUp' | 'mouseScroll' | 'keyDown' | 'keyUp'
  timestamp: number
  x: number
  y: number
  button?: 'left' | 'right' | 'middle'
  clickCount?: number
  scrollDeltaX?: number
  scrollDeltaY?: number
  keyCode?: number
  key?: string
  shift: boolean
  ctrl: boolean
  alt: boolean
  meta: boolean
}

// 插件状态配置
export interface PluginStateConfig {
  [pluginName: string]: {
    enabled: boolean
    installedAt?: number
    updatedAt?: number
    backgroundRunning?: boolean      // 是否在后台运行
    backgroundStartedAt?: number     // 后台启动时间
    backgroundRestartCount?: number  // 重启次数
    launchOnStartup?: PluginLaunchOnStartupState // 用户配置的跟随 Mulby 启动
    alwaysOpenDetached?: PluginAlwaysOpenDetachedState // 用户配置的始终以独立窗口运行
  }
}

export type PluginLaunchMode = 'normal' | 'attached' | 'detached'

export interface PluginLaunchOnStartupState {
  enabled: boolean
  mode: 'background'
  featureCode?: string
  route?: string
  uiMode?: 'attached' | 'detached'
  updatedAt: number
}

export interface PluginAlwaysOpenDetachedState {
  enabled: boolean
  updatedAt: number
}

// 搜索偏好配置
export interface PinnedFeature {
  pluginId: string
  featureCode: string
  pinnedAt: number
}

export interface HiddenFeature {
  pluginId: string
  featureCode: string
  hiddenAt: number
}

export interface SearchPreferenceState {
  pinnedFeatures: PinnedFeature[]
  hiddenFeatures: HiddenFeature[]
}

// 最近使用的插件功能
export interface RecentPluginUsageEntry {
  pluginId: string
  featureCode: string
  lastUsedAt: number
  useCount: number
}

// 文件信息
export interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

// HTTP 请求选项
export interface HttpRequestOptions {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
  headers?: Record<string, string>
  body?: string | object
  timeout?: number
}

// HTTP 响应
export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  data: string
}

// 后台插件信息
export interface BackgroundPluginInfo {
  pluginId: string
  pluginName: string
  displayName: string
  startedAt: number              // 启动时间戳
  uptime: number                 // 运行时长（毫秒）
  persistent: boolean            // 是否持久化
  maxRuntime: number             // 最大运行时间

  // 资源使用情况（来自 Watchdog）
  memoryUsage: number            // 宿主进程内存（MB，来自 Watchdog 的 Host RSS）
  rendererMemoryUsage?: number   // 插件 UI 渲染进程内存（MB，按进程归属聚合；无 UI 时为 0）
  cpuUsage: number               // CPU 使用率（%）
  requestCount: number           // 请求计数
  errorCount: number             // 错误计数

  // 健康状态
  healthy: boolean               // 是否健康
  lastHeartbeat: number          // 最后心跳时间
  missedHeartbeats: number       // 丢失心跳次数

  // 运行模式
  runMode: 'background' | 'active'  // background: 后台运行, active: 活跃运行（独立窗口/面板）
}
