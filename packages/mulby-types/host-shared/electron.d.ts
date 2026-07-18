import { InBrowser } from './inbrowser'
import type {
  BackgroundPluginInfo,
  InputAttachment,
  InputPayload,
  PluginCommandDisabledToggleInput,
  PluginCommandDisabledToggleResult,
  PluginCommandItem,
  PluginCommandRunInput,
  PluginRunResult,
  PluginCommandShortcutBindInput,
  PluginCommandShortcutBindResult,
  PluginCommandShortcutBindingRecord,
  PluginCommandShortcutValidationResult,
  PluginDirectoryAccessRequestInput,
  PluginRendererCapabilities
} from './plugin'
import type { AiApi } from './ai'
import type {
  StorageListOptions,
  StorageListResult,
  StorageGetManyItem,
  StorageSetManyItem,
  StorageSetManyOptions,
  StorageSetManyResult,
  StorageMetaResult,
  StorageSetVersionOptions,
  StorageSetVersionResult,
  StorageRemoveVersionOptions,
  StorageRemoveVersionResult,
  StorageTransactionOp,
  StorageTransactionOptions,
  StorageTransactionResult,
  StorageAppendOptions,
  StorageAppendResult,
  StorageWatchOptions,
  StorageWatchEvent,
  AttachmentPutResult
} from './storage-v2'
import type {
  AppSettings,
  CommandAuditItem,
  CommandRunnerSettings,
  PluginDirectoryAccessGrant,
  ShortcutStatusMap,
  OpenClawSettings,
  SuperPanelSettings
} from './settings'
import type { NodeStatusInfo } from './openclaw-protocol'
import type {
  InstalledPluginUpdateResult,
  PluginStoreBatchUpdateResult,
  PluginStoreFetchResult,
  PluginStoreInstallResult,
  PluginStoreInstallFromUrlInput
} from './plugin-store'
import type { Task, TaskExecution, TaskSchedulerEvent } from './task'

// 日志条目接口
export interface LogEntry {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'crash'
  pluginId: string
  message: string
  args?: unknown[]
  crashDetails?: {
    reason: string
    exitCode?: number
    windowId?: number
  }
}

export interface FileInfo {
  path: string
  name: string
  size: number
  type: string
  isDirectory: boolean
}

export type ClipboardContentFormat = 'text' | 'image' | 'files' | 'html' | 'empty'

export interface AutoPasteClipboardPayload {
  format: ClipboardContentFormat
  text?: string
  image?: Buffer | ArrayBuffer | Uint8Array | null
  files?: FileInfo[]
}

export interface MainWindowShowEvent {
  autoPasteScheduled: boolean
}

// 剪贴板历史条目
export interface ClipboardHistoryItem {
  id: string
  type: 'text' | 'image' | 'files'
  content: string
  plainText?: string
  files?: string[]
  timestamp: number
  size: number
  favorite: boolean
  tags?: string[]
  sourceApp?: string
  sourceTitle?: string
}

// 剪贴板历史统计
export interface ClipboardHistoryStats {
  total: number
  text: number
  image: number
  files: number
  favorite: number
}

// MainPush 推送项
export interface MainPushItem {
  icon?: string
  title: string
  text: string
  [key: string]: unknown
}

// 搜索结果项（功能入口）
export interface SearchResultItem {
  pluginId: string
  pluginName: string
  displayName: string
  featureCode: string
  featureExplain: string
  featureRoute?: string
  builtin?: boolean
  hasUI?: boolean
  supportsBackground?: boolean
  featureMode?: 'ui' | 'silent' | 'detached'
  matchType: 'keyword' | 'regex' | 'files' | 'img' | 'over' | 'window'
  icon?: {
    type: 'url' | 'svg' | 'data-url' | 'emoji'
    value: string
  }
  /** 最后使用时间戳（毫秒），仅 getRecentUsed 返回时有值 */
  lastUsedAt?: number
  /** 使用次数，仅 getRecentUsed 返回时有值 */
  useCount?: number
  /** MainPush 推送项，仅搜索结果中 mainPush feature 匹配时有值 */
  mainPushItems?: MainPushItem[]
}

export interface DesktopFileSearchResult {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

export interface DesktopAppSearchResult {
  name: string
  path: string
  kind: 'application' | 'shortcut' | 'executable'
  iconPath?: string
}

export type SystemIconKind = 'app' | 'file'

export interface SystemIconRequest {
  key: string
  path: string
  kind?: SystemIconKind
  size?: number
}

export interface SystemIconResult {
  key: string
  path: string
  kind: SystemIconKind
  icon: string
}

export interface ContextMenuItem {
  label: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  enabled?: boolean
  id?: string
  submenu?: ContextMenuItem[]
}

export interface ActionMenuItem {
  id: string
  label: string
  separator?: boolean
  danger?: boolean
  disabled?: boolean
  checked?: boolean
}

export interface ActionMenuPoint {
  x: number
  y: number
}

export interface PluginInfo {
  id: string
  name: string
  displayName: string
  description: string
  version?: string
  author?: string
  homepage?: string
  main?: string
  ui?: string
  window?: {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
    opacity?: number
    transparent?: boolean
  }
  icon?: {
    type: 'url' | 'svg' | 'data-url' | 'emoji'
    value: string
  }
  path?: string
  builtin?: boolean
  isDev?: boolean
  /** 当本插件覆盖了同 id 的另一来源插件时，记录被覆盖的插件路径（用于冲突提示） */
  overriddenInstallPath?: string
  features: {
    code: string
    explain: string
    cmds: {
      type: 'keyword' | 'regex' | 'files' | 'img' | 'over' | 'window' | string
      value?: string
      match?: string
      explain?: string
      label?: string
      exts?: string[]
      fileType?: 'file' | 'directory' | 'any'
      minLength?: number
      maxLength?: number
      exclude?: string
      app?: string       // CmdWindow: 应用名称匹配
      title?: string     // CmdWindow: 窗口标题匹配
      bundleId?: string  // CmdWindow: macOS Bundle ID
    }[]
    mode?: 'ui' | 'silent' | 'detached'
    route?: string
    icon?: {
      type: 'url' | 'svg' | 'data-url' | 'emoji'
      value: string
    }
  }[]
  enabled: boolean
  tools?: {
    name: string
    description: string
  }[]
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface ThemeInfo {
  mode: ThemeMode
  actual: 'light' | 'dark'
}

// Screen API 类型
export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  isPrimary: boolean
}

export interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
  bounds?: CaptureBounds
}

export interface CaptureOptions {
  types?: ('screen' | 'window')[]
  thumbnailSize?: { width: number; height: number }
  fetchWindowIcons?: boolean
}

export interface ScreenshotOptions {
  sourceId?: string
  format?: 'png' | 'jpeg'
  quality?: number
}

export interface RecordingOptions {
  sourceId: string
  audio?: boolean
  frameRate?: number
}

// Color Picker API 类型
export interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

// FFmpeg API 类型
export interface FFmpegRunProgress {
  bitrate: string
  fps: number
  frame: number
  percent?: number
  q: number | string
  size: string
  speed: string
  time: string
}

export interface FFmpegDownloadProgress {
  phase: 'downloading' | 'extracting' | 'done'
  percent: number
  downloaded?: number
  total?: number
}

export type FFmpegRunProgressCallback = (progress: FFmpegRunProgress) => void
export type FFmpegDownloadProgressCallback = (progress: FFmpegDownloadProgress) => void

export interface FFmpegTask {
  promise: Promise<void>
  kill(): void
  quit(): void
}

// Dialog API 类型
export interface OpenDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
  properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  buttonLabel?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface MessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning'
  title?: string
  message: string
  detail?: string
  buttons?: string[]
  defaultId?: number
  cancelId?: number
}

export interface TrayMenuRecentItem {
  id: string
  type: 'plugin' | 'command'
  title: string
  subtitle: string
  timestamp: number
  pluginId?: string
  featureCode?: string
}

export interface TrayMenuState {
  platform: string
  openAtLogin: {
    supported: boolean
    enabled: boolean
  }
  status: {
    backgroundPluginCount: number
    activeHostCount: number
    runningTaskCount: number
    pendingTaskCount: number
    pausedTaskCount: number
  }
  recentActions: TrayMenuRecentItem[]
}

export interface SuperPanelItem {
  id: string
  pluginId: string
  pluginName: string
  pluginDisplayName: string
  pluginIcon?: string
  featureCode: string
  featureExplain: string
  featureIcon?: string
  matchType: string
  score: number
  /** 上下文加权分（当前应用匹配 window cmd 时 > 0） */
  contextBoost: number
}

export interface SuperPanelPinnedItem {
  pluginId: string
  featureCode: string
  displayName: string
  pluginIcon?: string
  pinnedAt: number
}

/** 固定列表分组 */
export interface SuperPanelGroup {
  id: string
  name: string
  boundApp?: string
  items: SuperPanelPinnedItem[]
}

export interface SuperPanelTranslation {
  text: string
  loading: boolean
  error?: string
  expanded?: boolean
  expandedHeight?: number
}

export interface SuperPanelState {
  capturedText: string
  items: SuperPanelItem[]
  visible: boolean
  mode: 'match' | 'pinned'
  pinnedItems?: SuperPanelPinnedItem[]
  /** 分组化的固定列表（mode='pinned' 时有效） */
  pinnedGroups?: SuperPanelGroup[]
  translation?: SuperPanelTranslation
  /** 当前前台应用上下文（用于前端展示上下文标签） */
  activeApp?: { app: string; bundleId?: string }
}

export interface StartupOpenAtLoginState {
  supported: boolean
  enabled: boolean
}

export type UpdateCenterStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateCenterState {
  status: UpdateCenterStatus
  currentVersion: string
  latestVersion?: string
  hasUpdate: boolean
  releasePageUrl: string
  latestReleaseApiUrl: string
  releaseName?: string
  releasePublishedAt?: string
  releaseNotes?: string
  message?: string
  lastCheckedAt?: number
  installMode?: 'resource' | 'manual'
  manualInstallReason?: string
  downloadProgress?: {
    bytesPerSecond: number
    percent: number
    transferred: number
    total: number
  }
}

export interface PluginLaunchStartEvent {
  requestId: string
  pluginName: string
  displayName: string
  featureCode: string
  startedAt: number
}

export interface PluginLaunchEndEvent {
  requestId: string
  pluginName: string
  featureCode: string
  reason: 'finished' | 'failed' | 'cancelled' | 'skipped'
}

export interface RunCommandInput {
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

export interface RunCommandResult {
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

// System API 类型
export interface SystemInfo {
  platform: string
  arch: string
  hostname: string
  username: string
  homedir: string
  tmpdir: string
  cpus: number
  totalmem: number
  freemem: number
  uptime: number
  osVersion: string
  osRelease: string
}

export interface AppInfo {
  name: string
  version: string
  locale: string
  isPackaged: boolean
  userDataPath: string
}

export interface AppResourceProcessUsage {
  pid: number
  type: string
  name?: string
  cpuPercent: number
  workingSetBytes: number
}

export interface AppResourceDiskUsage {
  userDataPath: string
  userDataBytes: number
  fileCount: number
  directoryCount: number
  truncated: boolean
  scannedAt: number
}

export interface AppResourceUsage {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
  processCount: number
  disk: AppResourceDiskUsage
  processes: AppResourceProcessUsage[]
}

export interface OpenSystemPluginPayload {
  pluginId: string
  params?: Record<string, unknown>
}

export interface SystemPluginBeforeAttachPayload {
  requestId: string
  pluginId: string
}

export interface ChildWindowCreateOptions {
  width?: number
  height?: number
  title?: string
  loadMode?: 'route' | 'file'
  preload?: string
  type?: 'default' | 'borderless' | 'fullscreen'
  titleBar?: boolean
  fullscreen?: boolean
  alwaysOnTop?: boolean
  alwaysOnTopLevel?: string
  resizable?: boolean
  movable?: boolean
  minimizable?: boolean
  maximizable?: boolean
  fullscreenable?: boolean
  focusable?: boolean
  skipTaskbar?: boolean
  enableLargerThanScreen?: boolean
  x?: number
  y?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  inheritWindowSizeLimits?: boolean
  opacity?: number
  transparent?: boolean
  backgroundThrottling?: boolean
  visibleOnAllWorkspaces?: boolean
  visibleOnFullScreen?: boolean
  ignoreMouseEvents?: boolean
  forwardMouseEvents?: boolean
  params?: Record<string, string>
}

export interface ChildWindowHandle {
  id: number
  show: () => Promise<void>
  hide: () => Promise<void>
  close: () => Promise<void>
  destroy: () => Promise<void>
  focus: () => Promise<void>
  showInactive: () => Promise<void>
  setTitle: (title: string) => Promise<void>
  setSize: (width: number, height: number) => Promise<void>
  setPosition: (x: number, y: number) => Promise<void>
  setBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) => Promise<boolean>
  getBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  setOpacity: (opacity: number) => Promise<void>
  setBackgroundThrottling: (allowed: boolean) => Promise<boolean>
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => Promise<void>
  setAlwaysOnTop: (flag: boolean, level?: string) => Promise<void>
  setVisibleOnAllWorkspaces: (flag: boolean, options?: { visibleOnFullScreen?: boolean }) => Promise<void>
  setFullScreen: (flag: boolean) => Promise<void>
  postMessage: (channel: string, ...args: unknown[]) => Promise<void>
}

export interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  attachments?: InputAttachment[]
  mode?: string
  capabilities?: PluginRendererCapabilities
  nonce?: number
  route?: string
  params?: Record<string, string>
  windowType?: string
}

export interface ElectronAPI {
  window: {
    hide: () => void
    show: () => void
    showInactive: () => void
    setSize: (width: number, height: number) => void
    setTitle: (title: string) => void
    setPosition: (x: number, y: number) => void
    setBounds: (bounds: { x?: number; y?: number; width?: number; height?: number }) => Promise<boolean>
    getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>
    setExpendHeight: (height: number, allowResize?: boolean) => void
    invalidate: () => void
    center: () => void
    detach: () => void
    close: () => void
    terminatePlugin: () => Promise<{ success: boolean; error?: string }>
    showPluginMenu: (point?: { x: number; y: number }) => Promise<boolean>
    reload: () => void
    setAlwaysOnTop: (flag: boolean, level?: string) => void
    setOpacity: (opacity: number) => Promise<void>
    getOpacity: () => Promise<number>
    setBackgroundThrottling: (allowed: boolean) => Promise<boolean>
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => void
    setVisibleOnAllWorkspaces: (flag: boolean, options?: { visibleOnFullScreen?: boolean }) => void
    setFullScreen: (flag: boolean) => void
    getMode: () => Promise<'attached' | 'detached'>
    getWindowType: () => Promise<string>
    getState: () => Promise<{ isMaximized: boolean; isAlwaysOnTop: boolean; opacity: number; canMaximize: boolean }>
    minimize: () => void
    maximize: () => void
    resizeDrag: (payload: {
      edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
      startX: number
      startY: number
      currentX: number
      currentY: number
      baseBounds: { x: number; y: number; width: number; height: number }
    }) => void
    create: (url: string, options?: ChildWindowCreateOptions) => Promise<ChildWindowHandle | null>
    sendToParent: (channel: string, ...args: unknown[]) => void
    onChildMessage: (callback: (channel: string, ...args: unknown[]) => void) => () => void
    findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }) => Promise<number>
    stopFindInPage: (action?: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
    startDrag: (filePath: string | string[]) => void
  }
  theme: {
    get: () => Promise<ThemeInfo>
    set: (mode: ThemeMode) => Promise<ThemeInfo>
    getActual: () => Promise<'light' | 'dark'>
  }
  onThemeChange: (callback: (theme: 'light' | 'dark') => void) => () => void
  onWindowStateChange: (callback: (state: { isMaximized: boolean; canMaximize?: boolean }) => void) => () => void
  ai: AiApi
  app: {
    onOpenSystemPlugin: (callback: (payload: OpenSystemPluginPayload) => void) => () => void
    onSystemPluginBeforeAttach: (callback: (payload: SystemPluginBeforeAttachPayload) => void | Promise<void>) => () => void
    onOpenAiSettings: (callback: () => void) => () => void
    onOpenAiMcpSettings: (callback: () => void) => () => void
    onOpenAiToolsSettings: (callback: () => void) => () => void
    onOpenAiSkillsSettings: (callback: () => void) => () => void
    onOpenPluginStore: (callback: (filter?: 'updatable') => void) => () => void
    onOpenPluginManager: (callback: (pluginId?: string) => void) => () => void
    onOpenBackgroundPlugins: (callback: () => void) => () => void
    onOpenTaskScheduler: (callback: () => void) => () => void
    onOpenLogViewer: (callback: () => void) => () => void
    onOpenStorageExplorer: (callback: () => void) => () => void
    onOpenCommandShortcuts: (callback: (payload?: { cmdLabel?: string }) => void) => () => void
    onSetSearchText: (callback: (query: string) => void) => () => void
    onMainWindowShow: (callback: (event: MainWindowShowEvent) => void) => () => void
  }
  systemPlugin: {
    setActive: (pluginId: string | null) => Promise<boolean>
    notifyReadyForAttach: (requestId: string) => Promise<boolean>
    getActive: () => Promise<string | null>
  }
  systemPage: {
    open: (payload: {
      page: 'settings' | 'plugin-manager' | 'plugin-store' | 'background-plugins' | 'task-scheduler' | 'log-viewer' | 'ai-settings' | 'ai-mcp-settings' | 'ai-tools-settings' | 'ai-skills-settings' | 'storage-explorer'
      settingsSection?: 'dashboard' | 'general' | 'floatingBall' | 'superPanel' | 'shortcuts' | 'commandQuickLaunch' | 'commandAll' | 'permissions' | 'security' | 'openclaw' | 'developer' | 'about'
      shortcutCommandHint?: string
      detailsPluginId?: string
      storeFilter?: 'updatable'
    }) => Promise<boolean>
    close: () => Promise<boolean>
    detach: () => Promise<boolean>
    reload: () => Promise<boolean>
    showMenu: (point?: { x: number; y: number }) => Promise<boolean>
    getMode: () => Promise<'none' | 'attached' | 'detached'>
    getState: () => Promise<{ open: boolean; mode: 'none' | 'attached' | 'detached'; page: string | null; title: string }>
    onStateChange: (callback: (state: { open: boolean; mode: 'none' | 'attached' | 'detached'; page: string | null; title: string }) => void) => () => void
  }
  clipboard: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<void>
    readImage: () => Promise<Buffer | null>
    writeImage: (image: string | Buffer | ArrayBuffer | Uint8Array) => Promise<boolean>
    readFiles: () => Promise<FileInfo[]>
    writeFiles: (files: string | string[]) => Promise<boolean>
    getFormat: () => Promise<'text' | 'image' | 'files' | 'html' | 'empty'>
  }
  clipboardHistory: {
    query: (options?: {
      type?: 'text' | 'image' | 'files'
      search?: string
      favorite?: boolean
      sourceApp?: string
      limit?: number
      offset?: number
    }) => Promise<ClipboardHistoryItem[]>
    get: (id: string) => Promise<ClipboardHistoryItem | null>
    copy: (id: string) => Promise<{ success: boolean; error?: string }>
    toggleFavorite: (id: string) => Promise<{ success: boolean }>
    delete: (id: string) => Promise<{ success: boolean }>
    clear: () => Promise<{ success: boolean }>
    stats: () => Promise<ClipboardHistoryStats>
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
    show: (message: string, type?: string) => Promise<void>
  }
  onboarding: {
    getSettings: () => Promise<{
      shortcuts: { toggleWindow: string; openSettings: string }
      storeSources: { id: string; name: string; url: string; enabled: boolean; priority: number }[]
      superPanel: SuperPanelSettings
      theme: string
      aiProviders: { id: string; type?: string; label?: string; enabled: boolean; apiKey?: string; baseURL?: string }[]
      onboardingCompleted: boolean
    }>
    updateShortcut: (action: string, accelerator: string) => Promise<boolean>
    updateTheme: (mode: string) => Promise<boolean>
    updateAiProvider: (provider: {
      id: string
      type?: string
      label?: string
      enabled: boolean
      apiKey?: string
      baseURL?: string
    }) => Promise<boolean>
    updateStoreSources: (sources: {
      id: string
      name: string
      url: string
      enabled: boolean
      priority: number
    }[]) => Promise<boolean>
    updateSuperPanel: (superPanel: SuperPanelSettings) => Promise<boolean>
    complete: () => Promise<boolean>
    onClose: (callback: () => void) => () => void
  }
  storage: {
    get: (key: string, namespace?: string) => Promise<unknown>
    set: (key: string, value: unknown, namespace?: string) => Promise<boolean>
    remove: (key: string, namespace?: string) => Promise<boolean>
    getAll?: (namespace?: string) => Promise<Record<string, unknown>>
    getAllWithMeta: (namespace: string) => Promise<{ key: string; value: unknown; rawValue: string; updatedAt: number }[]>
    listNamespaces: () => Promise<{ plugin_id: string; count: number; lastUpdated: number }[]>
    clear: (namespace: string) => Promise<boolean>
    // V2 扩展方法
    list: (options?: StorageListOptions) => Promise<StorageListResult>
    getMany: (keys: string[], options?: { namespace?: string }) => Promise<StorageGetManyItem[]>
    setMany: (items: StorageSetManyItem[], options?: StorageSetManyOptions) => Promise<StorageSetManyResult>
    getMeta: (key: string, options?: { namespace?: string }) => Promise<StorageMetaResult>
    setWithVersion: (key: string, value: unknown, options?: StorageSetVersionOptions) => Promise<StorageSetVersionResult>
    removeWithVersion: (key: string, options?: StorageRemoveVersionOptions) => Promise<StorageRemoveVersionResult>
    transaction: (ops: StorageTransactionOp[], options?: StorageTransactionOptions) => Promise<StorageTransactionResult>
    append: (key: string, chunk: unknown, options?: StorageAppendOptions) => Promise<StorageAppendResult>
    watch: (options: StorageWatchOptions, callback: (event: StorageWatchEvent) => void) => () => void
    encrypted: {
      set: (key: string, value: unknown) => Promise<boolean>
      get: (key: string) => Promise<unknown | undefined>
      remove: (key: string) => Promise<boolean>
      has: (key: string) => Promise<boolean>
    }
    attachment: {
      put: (id: string, data: ArrayBuffer | Uint8Array, mimeType: string) => Promise<AttachmentPutResult>
      get: (id: string) => Promise<Uint8Array | null>
      getType: (id: string) => Promise<string | null>
      remove: (id: string) => Promise<boolean>
      list: (prefix?: string) => Promise<{ id: string; mimeType: string; size: number }[]>
    }
  }
  settings: {
    get: () => Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
    update: (partial: Partial<AppSettings>) => Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
    reset: () => Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
    pauseShortcuts: () => Promise<ShortcutStatusMap>
    resumeShortcuts: () => Promise<ShortcutStatusMap>
    setShortcutRecordingActive: (active: boolean) => Promise<boolean>
    onShortcutCaptured: (callback: (accelerator: string) => void) => () => void
    getOpenAtLoginState: () => Promise<StartupOpenAtLoginState>
    setOpenAtLogin: (enabled: boolean) => Promise<StartupOpenAtLoginState>
    getUpdateCenterState: () => Promise<UpdateCenterState>
    checkAppUpdates: () => Promise<UpdateCenterState>
    openUpdateReleasePage: () => Promise<boolean>
    downloadUpdate: () => Promise<UpdateCenterState>
    installUpdate: () => Promise<boolean>
    onUpdateStateChanged: (callback: (state: UpdateCenterState) => void) => () => void
    onShortcutStatusChanged: (callback: (status: ShortcutStatusMap) => void) => () => void
  }
  developer: {
    // LEGACY
    addPluginPath: (path: string) => Promise<{ success: boolean; error?: string }>
    removePluginPath: (path: string) => Promise<{ success: boolean }>
    reloadPlugins: () => Promise<{ success: boolean }>
    selectDirectory: () => Promise<string | null>
    // NEW（pluginProjects[] 模型）
    addPluginProject: (args: {
      path: string
      source?: import('./settings').PluginProjectSource
    }) => Promise<import('./developer').AddPluginProjectResult>
    removePluginProject: (args: {
      id?: string
      path?: string
    }) => Promise<import('./developer').DeveloperOpResult>
    reloadPlugin: (pluginId: string) => Promise<import('./developer').DeveloperOpResult>
    reloadPluginByPath: (path: string) => Promise<import('./developer').DeveloperOpResult>
    validatePlugin: (path: string) => Promise<import('./developer').PluginValidationResult>
    listPluginProjects: () => Promise<import('./developer').PluginProjectStatus[]>
    createPlugin: (args: {
      targetDir: string
      name: string
      template?: 'react' | 'basic'
    }) => Promise<import('./developer').CreatePluginResult>
    buildPlugin: (path: string) => Promise<import('./developer').BuildPluginResult>
    packPlugin: (path: string) => Promise<import('./developer').PackPluginResult>
    openPluginDir: (path: string) => Promise<import('./developer').DeveloperOpResult>
    updateProjectMeta: (args: {
      id: string
      lastOpenedAt?: number
      label?: string
    }) => Promise<import('./developer').DeveloperOpResult>
  }
  plugin: {
    getAll: () => Promise<PluginInfo[]>
    listCommands: (pluginId?: string) => Promise<PluginCommandItem[]>
    search: (query: string | InputPayload) => Promise<SearchResultItem[]>
    run: (name: string, featureCode: string, input?: string | InputPayload, launchStart?: number) => Promise<PluginRunResult>
    prewarm: (pluginId: string) => Promise<void>
    prewarmUi: (pluginId: string, featureCode?: string, route?: string) => Promise<void>
    runCommand: (input: PluginCommandRunInput) => Promise<PluginRunResult>
    getRecentUsed: (limit?: number) => Promise<SearchResultItem[]>
    removeRecentUsage: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>
    getSearchPreferences: () => Promise<import('./plugin').SearchPreferenceState>
    pinFeature: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>
    unpinFeature: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>
    hideFeature: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>
    unhideFeature: (pluginId: string, featureCode: string) => Promise<{ success: boolean }>
    getLaunchOnStartup: (pluginId: string) => Promise<import('./plugin').PluginLaunchOnStartupState | undefined>
    setLaunchOnStartup: (
      pluginId: string,
      enabled: boolean,
      target?: { featureCode?: string; route?: string; mode?: import('./plugin').PluginLaunchMode | 'background'; uiMode?: 'attached' | 'detached' }
    ) => Promise<{ success: boolean; state?: import('./plugin').PluginLaunchOnStartupState; error?: string }>
    getAlwaysOpenDetached: (pluginId: string) => Promise<import('./plugin').PluginAlwaysOpenDetachedState | undefined>
    setAlwaysOpenDetached: (
      pluginId: string,
      enabled: boolean
    ) => Promise<{ success: boolean; state?: import('./plugin').PluginAlwaysOpenDetachedState; error?: string }>
    mainPushSelect: (pluginName: string, action: { code: string; type: string; payload: string; option: MainPushItem }) => Promise<boolean>
    getMainPushPlugins: () => Promise<Array<{ pluginId: string; displayName: string }>>
    resolveDroppedFilePaths: (files: File[]) => string[]
    install: (filePath: string) => Promise<{ success: boolean; pluginName?: string; pluginId?: string; action?: 'installed' | 'updated' | 'already-installed' | 'downgrade-blocked'; isUpdate?: boolean; oldVersion?: string; newVersion?: string; error?: string }>
    enable: (name: string) => Promise<{ success: boolean; error?: string }>
    disable: (name: string) => Promise<{ success: boolean; error?: string }>
    uninstall: (name: string, options?: { purgeData?: boolean }) => Promise<{ success: boolean; error?: string }>
    /** 插件存储数据统计（卸载确认时展示），kvCount 不含附件元数据键与加密项 */
    getDataStats: (name: string) => Promise<{ kvCount: number; encryptedCount: number; attachmentCount: number; attachmentBytes: number }>
    getReadme: (name: string) => Promise<string | null>
    // 后台插件管理
    listBackground: () => Promise<BackgroundPluginInfo[]>
    stopBackground: (pluginId: string) => Promise<{ success: boolean }>
    getBackgroundInfo: (pluginId: string) => Promise<BackgroundPluginInfo | null>
    startBackground: (pluginId: string) => Promise<{ success: boolean }>
    // 停止运行中的插件（包括 UI 插件和后台插件）
    stopPlugin: (pluginId: string) => Promise<{ success: boolean }>
    listCommandShortcuts: (pluginId?: string) => Promise<PluginCommandShortcutBindingRecord[]>
    bindCommandShortcut: (input: PluginCommandShortcutBindInput) => Promise<PluginCommandShortcutBindResult>
    unbindCommandShortcut: (bindingId: string) => Promise<{ success: boolean }>
    validateCommandShortcut: (accelerator: string, bindingId?: string) => Promise<PluginCommandShortcutValidationResult>
    setCommandDisabled: (input: PluginCommandDisabledToggleInput) => Promise<PluginCommandDisabledToggleResult>
  }
  pluginStore: {
    fetch: () => Promise<PluginStoreFetchResult>
    installFromUrl: (input: PluginStoreInstallFromUrlInput) => Promise<PluginStoreInstallResult>
    checkUpdatesInstalled: () => Promise<InstalledPluginUpdateResult>
    updateAll: (pluginIds?: string[]) => Promise<PluginStoreBatchUpdateResult>
  }
  directoryAccess: {
    request: (input?: PluginDirectoryAccessRequestInput) => Promise<PluginDirectoryAccessGrant | null>
    list: () => Promise<PluginDirectoryAccessGrant[]>
    revoke: (grantIdOrPath: string) => Promise<boolean>
  }
  scheduler: {
    listTasks: (filter?: { pluginId?: string; status?: string; type?: string; limit?: number; offset?: number }) => Promise<Task[]>
    getTaskCount: (filter?: { pluginId?: string; status?: string; type?: string }) => Promise<number>
    getTask: (taskId: string) => Promise<Task | null>
    schedule: (task: Record<string, unknown>) => Promise<Task>
    cancelTask: (taskId: string) => Promise<{ success: boolean }>
    pauseTask: (taskId: string) => Promise<{ success: boolean }>
    resumeTask: (taskId: string) => Promise<{ success: boolean }>
    deleteTasks: (taskIds: string[]) => Promise<{ success: boolean; deletedCount: number }>
    cleanupTasks: (olderThan?: number) => Promise<{ success: boolean; deletedCount: number }>
    getExecutions: (taskId: string, limit?: number) => Promise<TaskExecution[]>
    validateCron: (expression: string) => Promise<boolean>
    getNextCronTime: (expression: string, after?: Date) => Promise<Date>
    describeCron: (expression: string) => Promise<string>
    subscribe: () => Promise<{ success: boolean; error?: string }>
    unsubscribe: () => Promise<{ success: boolean; error?: string }>
    onEvent: (callback: (event: TaskSchedulerEvent) => void) => () => void
  }
  onPluginInit: (callback: (data: PluginInitData) => void) => () => void
  onPluginAttach: (callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; attachments?: InputAttachment[]; mode: 'panel'; launchRequestId?: string }) => void) => () => void
  onPluginDetached: (callback: () => void) => () => void
  onModeChange: (callback: (data: { mode: 'attached' | 'detached'; windowType?: string; pluginName?: string }) => void) => () => void
  onPluginLaunchStart: (callback: (data: PluginLaunchStartEvent) => void) => () => void
  onPluginLaunchEnd: (callback: (data: PluginLaunchEndEvent) => void) => () => void
  screen: {
    getAllDisplays: () => Promise<DisplayInfo[]>
    getPrimaryDisplay: () => Promise<DisplayInfo>
    getDisplayNearestPoint: (point: { x: number; y: number }) => Promise<DisplayInfo>
    getDisplayMatching: (rect: { x: number; y: number; width: number; height: number }) => Promise<DisplayInfo>
    getCursorScreenPoint: () => Promise<{ x: number; y: number }>
    getSources: (options?: CaptureOptions) => Promise<CaptureSource[]>
    getWindowBounds: (sourceId: string) => Promise<CaptureBounds | null>
    capture: (options?: ScreenshotOptions) => Promise<Buffer>
    captureRegion: (
      region: { x: number; y: number; width: number; height: number },
      options?: Omit<ScreenshotOptions, 'sourceId'>
    ) => Promise<Buffer>
    getMediaStreamConstraints: (options: RecordingOptions) => Promise<object>
    screenCapture: () => Promise<string | null>
    colorPick: () => Promise<ColorPickResult | null>
  }
  shell: {
    openPath: (path: string) => Promise<string>
    openExternal: (url: string) => Promise<void>
    showItemInFolder: (path: string) => Promise<void>
    openFolder: (path: string) => Promise<string>
    trashItem: (path: string) => Promise<void>
    beep: () => Promise<void>
    runCommand: (input: RunCommandInput) => Promise<RunCommandResult>
    getRunCommandPolicy: () => Promise<CommandRunnerSettings>
    updateRunCommandPolicy: (patch: Partial<CommandRunnerSettings>) => Promise<CommandRunnerSettings>
    listRunCommandAudit: (limit?: number) => Promise<CommandAuditItem[]>
    clearRunCommandAudit: () => Promise<CommandRunnerSettings>
    clearRunCommandTrusted: () => Promise<CommandRunnerSettings>
  }
  desktop: {
    searchFiles: (query: string, limit?: number) => Promise<DesktopFileSearchResult[]>
    searchApps: (query: string, limit?: number) => Promise<DesktopAppSearchResult[]>
  }
  dialog: {
    showOpenDialog: (options?: OpenDialogOptions) => Promise<string[]>
    showSaveDialog: (options?: SaveDialogOptions) => Promise<string | null>
    showMessageBox: (options: MessageBoxOptions) => Promise<{ response: number; checkboxChecked: boolean }>
    showErrorBox: (title: string, content: string) => Promise<void>
  }
  system: {
    getSystemInfo: () => Promise<SystemInfo>
    getAppInfo: () => Promise<AppInfo>
    getAppResourceUsage: () => Promise<AppResourceUsage>
    getPath: (name: 'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs') => Promise<string>
    getEnv: (name: string) => Promise<string | undefined>
    getIdleTime: () => Promise<number>
    getFileIcon: (filePath: string, options?: { size?: number; kind?: SystemIconKind }) => Promise<string>
    getFileIcons: (
      requests: SystemIconRequest[],
      options?: { size?: number; concurrency?: number }
    ) => Promise<SystemIconResult[]>
    getNativeId: () => Promise<string>
    isDev: () => Promise<boolean>
    isMacOS: () => Promise<boolean>
    isWindows: () => Promise<boolean>
    isLinux: () => Promise<boolean>
  }
  permission: {
    getStatus: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'input-monitoring' | 'contacts' | 'calendar') => Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
    request: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'input-monitoring' | 'contacts' | 'calendar') => Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
    canRequest: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'input-monitoring' | 'contacts' | 'calendar') => Promise<boolean>
    openSystemSettings: (type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'input-monitoring' | 'contacts' | 'calendar') => Promise<boolean>
    isAccessibilityTrusted: () => Promise<boolean>
  }
  shortcut: {
    register: (accelerator: string) => Promise<boolean>
    unregister: (accelerator: string) => Promise<void>
    unregisterAll: () => Promise<void>
    isRegistered: (accelerator: string) => Promise<boolean>
    onTriggered: (callback: (accelerator: string) => void) => () => void
  }
  security: {
    isEncryptionAvailable: () => Promise<boolean>
    encryptString: (plainText: string) => Promise<Buffer>
    decryptString: (encrypted: Buffer) => Promise<string>
  }
  media: {
    getAccessStatus: (mediaType: 'microphone' | 'camera') => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
    askForAccess: (mediaType: 'microphone' | 'camera') => Promise<boolean>
    hasCameraAccess: () => Promise<boolean>
    hasMicrophoneAccess: () => Promise<boolean>
  }
  power: {
    getSystemIdleTime: () => Promise<number>
    getSystemIdleState: (idleThreshold: number) => Promise<'active' | 'idle' | 'locked' | 'unknown'>
    isOnBatteryPower: () => Promise<boolean>
    getCurrentThermalState: () => Promise<'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'>
    onSuspend: (callback: () => void) => () => void
    onResume: (callback: () => void) => () => void
    onAC: (callback: () => void) => () => void
    onBattery: (callback: () => void) => () => void
    onLockScreen: (callback: () => void) => () => void
    onUnlockScreen: (callback: () => void) => () => void
  }
  tray: {
    create: (options: { icon: string; tooltip?: string; title?: string }) => Promise<boolean>
    destroy: () => Promise<void>
    setIcon: (icon: string) => Promise<void>
    setTooltip: (tooltip: string) => Promise<void>
    setTitle: (title: string) => Promise<void>
    exists: () => Promise<boolean>
  }
  trayMenu: {
    getState: () => Promise<TrayMenuState>
    action: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; state?: TrayMenuState; error?: string }>
    close: () => Promise<{ success: boolean }>
    onState: (callback: (state: TrayMenuState) => void) => () => void
  }
  superPanel: {
    getState: () => Promise<SuperPanelState>
    action: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
    close: () => Promise<{ success: boolean }>
    setIgnoreBlur: (ignore: boolean) => Promise<unknown>
    onState: (callback: (state: SuperPanelState) => void) => () => void
  }
  network: {
    isOnline: () => Promise<boolean>
    onOnline: (callback: () => void) => void
    onOffline: (callback: () => void) => void
  }
  menu: {
    showContextMenu: (items: ContextMenuItem[]) => Promise<string | null>
    showActionMenu: (items: ActionMenuItem[], point?: ActionMenuPoint) => Promise<string | null>
  }
  geolocation: {
    getAccessStatus: () => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
    requestAccess: () => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
    canGetPosition: () => Promise<boolean>
    openSettings: () => Promise<void>
    getCurrentPosition: (options?: {
      desiredAccuracy?: 'best' | 'balanced' | 'coarse'
      allowFallback?: boolean
      timeoutMs?: number
    }) => Promise<{
      latitude: number
      longitude: number
      accuracy: number
      source: 'native' | 'web' | 'ip'
      provider: 'macos-corelocation' | 'windows-location-service' | 'linux-geoclue' | 'electron-web' | 'ip' | 'freegeoip.app' | 'ip-api.com' | 'ipwho.is'
      altitude?: number | null
      altitudeAccuracy?: number | null
      heading?: number | null
      speed?: number | null
      timestamp: number
      fallbackUsed: boolean
      attempts: Array<{
        provider: 'macos-corelocation' | 'windows-location-service' | 'linux-geoclue' | 'electron-web' | 'ip' | 'freegeoip.app' | 'ip-api.com' | 'ipwho.is'
        source: 'native' | 'web' | 'ip'
        status: 'success' | 'skipped' | 'error'
        accuracy?: number
        message?: string
      }>
    }>
  }
  tts: {
    speak: (text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }) => Promise<void>
    stop: () => void
    pause: () => void
    resume: () => void
    getVoices: () => { name: string; lang: string; default: boolean; localService: boolean }[]
    isSpeaking: () => boolean
  }
  openclaw: {
    getSettings: () => Promise<OpenClawSettings>
    updateSettings: (partial: Partial<OpenClawSettings>) => Promise<OpenClawSettings>
    connect: () => Promise<{ ok: boolean; error?: string }>
    disconnect: () => Promise<void>
    getStatus: () => Promise<NodeStatusInfo>
    testConnection: (settings: OpenClawSettings) => Promise<{ ok: boolean; error?: string }>
    onStatusChanged: (callback: (status: NodeStatusInfo) => void) => () => void
    onInvoked: (callback: (data: { command: string; success: boolean; timestamp: number }) => void) => () => void
    getLogs: () => Promise<Array<{ id: number; level: string; time: number; tag: string; message: string; detail?: string }>>
    clearLogs: () => Promise<void>
    onLog: (callback: (entry: { id: number; level: string; time: number; tag: string; message: string; detail?: string }) => void) => () => void
    onLogsCleared: (callback: () => void) => () => void
  }
  inbrowser: {
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => InBrowser
  }
  // Sharp 图像处理 API
  sharp: SharpFunction
  getSharpVersion: () => Promise<{ sharp: Record<string, string>; format: Record<string, unknown> }>
  // FFmpeg 音视频处理 API
  ffmpeg: {
    isAvailable: () => Promise<boolean>
    getVersion: () => Promise<string | null>
    getPath: () => Promise<string | null>
    download: (onProgress?: FFmpegDownloadProgressCallback) => Promise<{ success: boolean; error?: string }>
    run: (args: string[], onProgress?: FFmpegRunProgressCallback) => FFmpegTask
  }
  // 日志 API
  log: {
    debug: (message: string, ...args: unknown[]) => void
    info: (message: string, ...args: unknown[]) => void
    warn: (message: string, ...args: unknown[]) => void
    error: (message: string, ...args: unknown[]) => void
    getLogs: (options?: { pluginId?: string; level?: string; limit?: number }) => Promise<LogEntry[]>
    clear: (pluginId?: string) => Promise<{ success: boolean }>
    getLogsDir: () => Promise<string>
    subscribe: () => Promise<{ success: boolean }>
    onLog: (callback: (entry: LogEntry) => void) => () => void
  }
}

/**
 * Sharp 图像处理代理接口
 * 支持链式调用，在调用终结方法时触发实际执行
 */
export interface SharpProxy {
  // 尺寸调整
  resize(width?: number, height?: number, options?: { fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'; position?: string; background?: string | object }): SharpProxy
  extend(options: { top?: number; bottom?: number; left?: number; right?: number; background?: string | object }): SharpProxy
  extract(options: { left: number; top: number; width: number; height: number }): SharpProxy
  trim(options?: { threshold?: number; lineArt?: boolean }): SharpProxy

  // 变换
  rotate(angle?: number, options?: { background?: string | object }): SharpProxy
  flip(): SharpProxy
  flop(): SharpProxy
  affine(matrix: number[][], options?: { background?: string | object; idx?: number; idy?: number; odx?: number; ody?: number }): SharpProxy

  // 图像处理
  median(size?: number): SharpProxy
  blur(sigma?: number): SharpProxy
  sharpen(options?: { sigma?: number; m1?: number; m2?: number; x1?: number; y2?: number; y3?: number }): SharpProxy
  flatten(options?: { background?: string | object }): SharpProxy
  gamma(gamma?: number, gammaOut?: number): SharpProxy
  negate(options?: { alpha?: boolean }): SharpProxy
  normalise(options?: { lower?: number; upper?: number }): SharpProxy
  normalize(options?: { lower?: number; upper?: number }): SharpProxy
  clahe(options: { width: number; height: number; maxSlope?: number }): SharpProxy
  convolve(options: { width: number; height: number; kernel: number[]; scale?: number; offset?: number }): SharpProxy
  threshold(threshold?: number, options?: { greyscale?: boolean }): SharpProxy
  linear(a?: number | number[], b?: number | number[]): SharpProxy
  recomb(inputMatrix: number[][]): SharpProxy
  modulate(options?: { brightness?: number; saturation?: number; hue?: number; lightness?: number }): SharpProxy

  // 颜色处理
  tint(color: string | object): SharpProxy
  greyscale(greyscale?: boolean): SharpProxy
  grayscale(grayscale?: boolean): SharpProxy
  pipelineColorspace(colorspace: string): SharpProxy
  toColorspace(colorspace: string): SharpProxy

  // 通道操作
  removeAlpha(): SharpProxy
  ensureAlpha(alpha?: number): SharpProxy
  extractChannel(channel: number | 'red' | 'green' | 'blue' | 'alpha'): SharpProxy
  joinChannel(images: string | Buffer | ArrayBuffer | Uint8Array | (string | Buffer | ArrayBuffer | Uint8Array)[], options?: { raw?: { width: number; height: number; channels: number } }): SharpProxy
  bandbool(boolOp: 'and' | 'or' | 'eor'): SharpProxy

  // 合成
  composite(images: { input: string | Buffer | { create?: { width: number; height: number; channels: number; background?: string | object }; text?: { text: string; width?: number; height?: number; channels?: number; rgba?: boolean } }; gravity?: string; top?: number; left?: number; tile?: boolean; blend?: string; density?: number; raw?: { width: number; height: number; channels: number } }[]): SharpProxy

  // 输出格式
  png(options?: { progressive?: boolean; compressionLevel?: number; palette?: boolean; quality?: number; effort?: number; colors?: number; dither?: number }): SharpProxy
  jpeg(options?: { quality?: number; progressive?: boolean; chromaSubsampling?: string; optimiseCoding?: boolean; mozjpeg?: boolean; trellisQuantisation?: boolean; overshootDeringing?: boolean; optimiseScans?: boolean; quantisationTable?: number }): SharpProxy
  webp(options?: { quality?: number; alphaQuality?: number; lossless?: boolean; nearLossless?: boolean; smartSubsample?: boolean; effort?: number; loop?: number; delay?: number | number[] }): SharpProxy
  gif(options?: { reuse?: boolean; progressive?: boolean; colors?: number; effort?: number; dither?: number; interFrameMaxError?: number; interPaletteMaxError?: number; loop?: number; delay?: number | number[]; force?: boolean }): SharpProxy
  tiff(options?: { quality?: number; force?: boolean; compression?: string; predictor?: string; pyramid?: boolean; tile?: boolean; tileWidth?: number; tileHeight?: number; xres?: number; yres?: number; resolutionUnit?: string; bitdepth?: number }): SharpProxy
  avif(options?: { quality?: number; lossless?: boolean; effort?: number; chromaSubsampling?: string }): SharpProxy
  heif(options?: { quality?: number; compression?: string; lossless?: boolean; effort?: number; chromaSubsampling?: string }): SharpProxy
  raw(options?: { depth?: string }): SharpProxy

  // 元数据
  withMetadata(options?: { orientation?: number; icc?: string; exif?: object; density?: number }): SharpProxy
  keepExif(): SharpProxy
  withExif(exif: object): SharpProxy
  keepIccProfile(): SharpProxy
  withIccProfile(icc: string, options?: { attach?: boolean }): SharpProxy

  // 其他
  timeout(options: { seconds: number }): SharpProxy
  tile(options?: { size?: number; overlap?: number; angle?: number; background?: string | object; depth?: string; skipBlanks?: number; container?: string; layout?: string; centre?: boolean; id?: string; basename?: string }): SharpProxy
  clone(): SharpProxy

  // 终结方法 - 触发实际执行
  toBuffer(options?: { resolveWithObject?: boolean }): Promise<Buffer | { data: Buffer; info: { format: string; width: number; height: number; channels: number; premultiplied: boolean; size: number } }>
  toFile(fileOut: string, callback?: (err: Error | null, info: { format: string; width: number; height: number; channels: number; premultiplied: boolean; size: number }) => void): Promise<{ format: string; width: number; height: number; channels: number; premultiplied: boolean; size: number }>
  metadata(): Promise<{ format?: string; size?: number; width?: number; height?: number; space?: string; channels?: number; depth?: string; density?: number; chromaSubsampling?: string; isProgressive?: boolean; pages?: number; pageHeight?: number; loop?: number; delay?: number[]; hasProfile?: boolean; hasAlpha?: boolean; orientation?: number; exif?: Buffer; icc?: Buffer; iptc?: Buffer; xmp?: Buffer; tifftagPhotoshop?: Buffer }>
  stats(): Promise<{ channels: { min: number; max: number; sum: number; squaresSum: number; mean: number; stdev: number; minX: number; minY: number; maxX: number; maxY: number }[]; isOpaque: boolean; entropy: number; sharpness: number; dominant: { r: number; g: number; b: number } }>
}

/**
 * Sharp 构造函数类型
 */
export type SharpFunction = (
  input?: string | Buffer | ArrayBuffer | Uint8Array | { create?: { width: number; height: number; channels: number; background?: string | object; noise?: { type: 'gaussian'; mean?: number; sigma?: number } }; text?: { text: string; width?: number; height?: number; channels?: number; rgba?: boolean } } | unknown[],
  options?: { raw?: { width: number; height: number; channels: number }; create?: { width: number; height: number; channels: number; background?: string | object }; text?: { text: string; width?: number; height?: number; channels?: number; rgba?: boolean }; animated?: boolean; limitInputPixels?: number; failOn?: 'error' | 'warning' | 'none'; density?: number; ignoreIcc?: boolean; pages?: number; page?: number; subifd?: number; level?: number; pdfBackground?: string | object }
) => SharpProxy

declare global {
  interface Window {
    mulby: ElectronAPI
    mulbyMain?: {
      subInput: {
        onEnabled: (callback: (data: { placeholder: string; isFocus: boolean; forwardKeys?: string[] }) => void) => () => void
        onDisabled: (callback: () => void) => () => void
        onSetValue: (callback: (text: string) => void) => () => void
        onFocus: (callback: () => void) => () => void
        onBlur: (callback: () => void) => () => void
        onSelect: (callback: () => void) => () => void
        sendKeyDown: (key: string, modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) => void
        sendChange: (text: string) => void
      }
      clipboard: {
        onAutoPaste: (callback: (payload?: AutoPasteClipboardPayload) => void) => () => void
      }
    }
  }
}

export { }
