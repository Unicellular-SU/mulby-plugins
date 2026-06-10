// Mulby API 类型定义

type Disposable = () => void

interface ResolvedIcon {
  type: 'url' | 'svg' | 'data-url' | 'emoji'
  value: string
}

type InputAttachmentKind = 'file' | 'image'

interface CaptureRegionInfo {
  x: number
  y: number
  width: number
  height: number
  displayId?: number
  scaleFactor?: number
}

interface CaptureDisplayInfo {
  id: number
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  isPrimary: boolean
}

interface InputAttachmentCaptureInfo {
  type: 'region' | 'fullscreen'
  region?: CaptureRegionInfo
  display?: CaptureDisplayInfo
}

interface InputAttachment {
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

interface ActiveWindowInfo {
  app: string
  title: string
  pid?: number
  bundleId?: string
}

interface InputPayload {
  text: string
  attachments: InputAttachment[]
  activeWindow?: ActiveWindowInfo
}

interface ClipboardFileInfo {
  path: string
  name: string
  size: number
  isDirectory: boolean
}

interface MulbyClipboard {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  readImage(): Promise<ArrayBuffer | null>
  writeImage(image: string | ArrayBuffer): Promise<void>
  readFiles(): Promise<ClipboardFileInfo[]>
  writeFiles(files: string | string[]): Promise<boolean>
  getFormat(): Promise<'text' | 'image' | 'files' | 'html' | 'empty'>
}

interface MulbyInput {
  hideMainWindowPasteText(text: string): Promise<boolean>
  hideMainWindowPasteImage(image: string | ArrayBuffer): Promise<boolean>
  hideMainWindowPasteFile(filePaths: string | string[]): Promise<boolean>
  hideMainWindowTypeString(text: string): Promise<boolean>
  restoreWindows(): Promise<boolean>
  simulateKeyboardTap(key: string, ...modifiers: string[]): Promise<boolean>
  simulateMouseMove(x: number, y: number): Promise<boolean>
  simulateMouseClick(x: number, y: number): Promise<boolean>
  simulateMouseDoubleClick(x: number, y: number): Promise<boolean>
  simulateMouseRightClick(x: number, y: number): Promise<boolean>
}

interface MulbyNotification {
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): Promise<void>
}

interface BrowserWindowProxy {
  id: number
  show(): Promise<void>
  hide(): Promise<void>
  close(): Promise<void>
  destroy(): Promise<void>
  focus(): Promise<void>
  showInactive(): Promise<void>
  setTitle(title: string): Promise<void>
  setSize(width: number, height: number): Promise<void>
  setPosition(x: number, y: number): Promise<void>
  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): Promise<boolean>
  getBounds(): Promise<{ x: number; y: number; width: number; height: number }>
  setOpacity(opacity: number): Promise<void>
  setBackgroundThrottling(allowed: boolean): Promise<boolean>
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): Promise<void>
  setAlwaysOnTop(flag: boolean, level?: string): Promise<void>
  setVisibleOnAllWorkspaces(flag: boolean, options?: { visibleOnFullScreen?: boolean }): Promise<void>
  setFullScreen(flag: boolean): Promise<void>
  postMessage(channel: string, ...args: unknown[]): Promise<void>
}

interface MulbyWindow {
  invalidate(): void
  hide(isRestorePreWindow?: boolean): void
  show(): void
  showInactive(): void
  focus(): void
  setTitle(title: string): void
  setSize(width: number, height: number): void
  setPosition(x: number, y: number): void
  setBounds(bounds: { x?: number; y?: number; width?: number; height?: number }): Promise<boolean>
  getBounds(): Promise<{ x: number; y: number; width: number; height: number } | null>
  setExpendHeight(height: number, allowResize?: boolean): void
  center(): void
  create(url: string, options?: {
    width?: number; height?: number; title?: string;
    loadMode?: 'route' | 'file';
    preload?: string;
    type?: 'default' | 'borderless' | 'fullscreen';
    titleBar?: boolean;
    fullscreen?: boolean;
    alwaysOnTop?: boolean;
    alwaysOnTopLevel?: string;
    resizable?: boolean;
    movable?: boolean;
    minimizable?: boolean;
    maximizable?: boolean;
    fullscreenable?: boolean; // 默认 true；子窗口默认可全屏
    focusable?: boolean;
    skipTaskbar?: boolean; // 请求不出现在 Dock/任务栏；macOS 仍可能显示 Mulby 应用级 Dock 图标
    enableLargerThanScreen?: boolean;
    x?: number; y?: number;
    minWidth?: number; minHeight?: number;
    maxWidth?: number; maxHeight?: number;
    inheritWindowSizeLimits?: boolean;
    opacity?: number;
    transparent?: boolean;
    backgroundThrottling?: boolean;
    visibleOnAllWorkspaces?: boolean;
    visibleOnFullScreen?: boolean;
    ignoreMouseEvents?: boolean;
    forwardMouseEvents?: boolean;
    params?: Record<string, string>;
  }): Promise<BrowserWindowProxy | null>
  close(): void
  terminatePlugin(): Promise<{ success: boolean; error?: string }>
  showPluginMenu(point?: { x: number; y: number }): Promise<boolean>
  detach(): void
  setAlwaysOnTop(flag: boolean, level?: string): void
  setOpacity(opacity: number): Promise<void>
  getOpacity(): Promise<number>
  setBackgroundThrottling(allowed: boolean): Promise<boolean>
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void
  setVisibleOnAllWorkspaces(flag: boolean, options?: { visibleOnFullScreen?: boolean }): void
  setFullScreen(flag: boolean): void
  getMode(): Promise<'attached' | 'detached'>
  getWindowType(): Promise<'main' | 'detach'>
  minimize(): void
  maximize(): void
  getState(): Promise<{ isMaximized: boolean; isAlwaysOnTop: boolean; opacity: number }>
  resizeDrag(payload: {
    edge: 'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
    startX: number
    startY: number
    currentX: number
    currentY: number
    baseBounds: { x: number; y: number; width: number; height: number }
  }): void
  reload(): void
  sendToParent(channel: string, ...args: unknown[]): void
  /** 监听子窗口消息。内置事件 'child-window-closed' 在子窗口关闭时自动推送，payload: { id, pluginId, featureCode, at } */
  onChildMessage(callback: (channel: string, ...args: unknown[]) => void): Disposable
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<number>
  stopFindInPage(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  startDrag(filePath: string | string[]): void
}

interface MulbySubInput {
  set(placeholder?: string, isFocus?: boolean, options?: { forwardKeys?: string[] }): Promise<boolean>
  remove(): Promise<boolean>
  setValue(text: string): void
  focus(): void
  blur(): void
  select(): void
  onChange(callback: (data: { text: string }) => void): Disposable
  onKeyDown(callback: (data: { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }) => void): Disposable
}

type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeInfo {
  mode: ThemeMode
  actual: 'light' | 'dark'
}

interface MulbyTheme {
  get(): Promise<ThemeInfo>
  set(mode: ThemeMode): Promise<ThemeInfo>
  getActual(): Promise<'light' | 'dark'>
}

type PluginCmd =
  | { type: 'keyword'; value: string; explain?: string }
  | { type: 'regex'; match: string; explain?: string; label?: string; minLength?: number; maxLength?: number }
  | { type: 'files'; exts?: string[]; fileType?: 'file' | 'directory' | 'any'; match?: string; minLength?: number; maxLength?: number }
  | { type: 'img'; exts?: string[] }
  | { type: 'over'; label?: string; exclude?: string; minLength?: number; maxLength?: number }
  | { type: 'window'; app?: string; title?: string; bundleId?: string; label?: string }

type CommandKind = 'launch' | 'match'

interface PluginCommandItem {
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

interface PluginCommandShortcutBinding {
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

type PluginCommandShortcutBindingState =
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

interface PluginCommandShortcutBindingRecord extends PluginCommandShortcutBinding {
  state: PluginCommandShortcutBindingState
  pluginDisplayName?: string
  featureExplain?: string
  cmdType?: PluginCmd['type']
}

interface PluginCommandShortcutBindInput {
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  commandLabel: string
  accelerator: string
}

interface PluginCommandShortcutBindResult {
  success: boolean
  error?: string
  state?: PluginCommandShortcutBindingState
  binding?: PluginCommandShortcutBindingRecord
}

interface PluginCommandShortcutValidationResult {
  ok: boolean
  error?: string
  state?: PluginCommandShortcutBindingState
}

interface PluginCommandRunInput {
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  input?: string | InputPayload
}

interface PluginCommandDisabledToggleInput {
  pluginId: string
  featureCode: string
  cmdId: string
  cmdSignature: string
  disabled: boolean
}

interface PluginCommandDisabledToggleResult {
  success: boolean
  disabled: boolean
  error?: string
}

interface PluginInfo {
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
    type?: 'default' | 'borderless' | 'fullscreen'
    titleBar?: boolean
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
    alwaysOnTop?: boolean
    focusable?: boolean
    opacity?: number
    transparent?: boolean
    visibleOnAllWorkspaces?: boolean
    visibleOnFullScreen?: boolean
    ignoreMouseEvents?: boolean
    forwardMouseEvents?: boolean
    skipTaskbar?: boolean // 请求不出现在 Dock/任务栏；macOS 仍可能显示 Mulby 应用级 Dock 图标
    backgroundThrottling?: boolean
    position?: 'default' | 'capture-region'
    fit?: 'default' | 'capture-region' | 'capture-region-with-toolbar'
    captureToolbarHeight?: number
  }
  icon?: ResolvedIcon
  path?: string
  builtin?: boolean
  isDev?: boolean
  features: Array<{
    code: string
    explain: string
    cmds: PluginCmd[]
    mode?: 'ui' | 'silent' | 'detached'
    route?: string
    icon?: ResolvedIcon
    mainPush?: boolean
    mainHide?: boolean
    preCapture?: 'region' | 'fullscreen'
  }>
  enabled: boolean
}

interface PluginSearchResult {
  pluginId: string
  pluginName: string
  displayName: string
  featureCode: string
  featureExplain: string
  featureRoute?: string
  hasUI?: boolean
  featureMode?: 'ui' | 'silent' | 'detached'
  matchType: 'keyword' | 'regex' | 'files' | 'img' | 'over' | 'window'
  icon?: ResolvedIcon
  mainPushItems?: MainPushItem[]
}

type PluginLaunchMode = 'normal' | 'attached' | 'detached'

interface PluginLaunchOnStartupState {
  enabled: boolean
  featureCode: string
  mode: PluginLaunchMode
  updatedAt: number
}

interface PluginAlwaysOpenDetachedState {
  enabled: boolean
  updatedAt: number
}

interface PluginRendererCapabilities {
  webview: boolean
}

interface BackgroundPluginInfo {
  pluginId: string
  pluginName: string
  displayName: string
  runMode: 'background' | 'active'
  startedAt?: number
  uptime?: number
  memoryUsage?: number
  cpuUsage?: number
  requestCount?: number
  errorCount?: number
  healthy?: boolean
  lastHeartbeat?: number
  missedHeartbeats?: number
}

interface OpenSystemPluginPayload {
  pluginId: string
  params?: Record<string, unknown>
}

interface SystemPluginBeforeAttachPayload {
  requestId: string
  pluginId: string
}

interface MainWindowShowEvent {
  autoPasteScheduled: boolean
}

interface MulbyApp {
  onOpenSystemPlugin(callback: (payload: OpenSystemPluginPayload) => void): Disposable
  onSystemPluginBeforeAttach(callback: (payload: SystemPluginBeforeAttachPayload) => void | Promise<void>): Disposable
  onOpenAiSettings(callback: () => void): Disposable
  onOpenAiMcpSettings(callback: () => void): Disposable
  onOpenAiSkillsSettings(callback: () => void): Disposable
  onOpenAiToolsSettings(callback: () => void): Disposable
  onOpenPluginStore(callback: () => void): Disposable
  onOpenPluginManager(callback: (pluginId?: string) => void): Disposable
  onOpenBackgroundPlugins(callback: () => void): Disposable
  onOpenTaskScheduler(callback: () => void): Disposable
  onOpenLogViewer(callback: () => void): Disposable
  onOpenStorageExplorer(callback: () => void): Disposable
  onOpenCommandShortcuts(callback: (payload?: { cmdLabel?: string }) => void): Disposable
  onSetSearchText(callback: (text: string) => void): Disposable
  onMainWindowShow(callback: (event: MainWindowShowEvent) => void): Disposable
}

interface MulbySystemPlugin {
  setActive(pluginId: string | null): Promise<boolean>
  notifyReadyForAttach(requestId: string): Promise<boolean>
  getActive(): Promise<string | null>
}

interface MulbySystemPageState {
  open: boolean
  mode: 'none' | 'attached' | 'detached'
  page: string | null
  title: string
}

interface MulbySystemPage {
  open(payload: {
    page: 'settings' | 'plugin-manager' | 'plugin-store' | 'background-plugins' | 'task-scheduler' | 'log-viewer' | 'storage-explorer' | 'ai-settings' | 'ai-mcp-settings' | 'ai-tools-settings' | 'ai-skills-settings'
    settingsSection?: 'dashboard' | 'general' | 'superPanel' | 'shortcuts' | 'commandQuickLaunch' | 'commandAll' | 'permissions' | 'security' | 'openclaw' | 'developer' | 'about'
    shortcutCommandHint?: string
    detailsPluginId?: string
  }): Promise<boolean>
  close(): Promise<boolean>
  detach(): Promise<boolean>
  reload(): Promise<boolean>
  showMenu(point?: { x: number; y: number }): Promise<boolean>
  getMode(): Promise<'none' | 'attached' | 'detached'>
  getState(): Promise<MulbySystemPageState>
  onStateChange(callback: (state: MulbySystemPageState) => void): Disposable
}

interface MulbyPlugin {
  prewarm(pluginId: string): Promise<void>
  getAll(): Promise<PluginInfo[]>
  listCommands(pluginId?: string): Promise<PluginCommandItem[]>
  search(query: string | InputPayload): Promise<PluginSearchResult[]>
  run(name: string, featureCode: string, input?: string | InputPayload): Promise<{ success: boolean; hasUI?: boolean; error?: string }>
  runCommand(input: PluginCommandRunInput): Promise<{ success: boolean; hasUI?: boolean; error?: string }>
  getRecentUsed(limit?: number): Promise<PluginSearchResult[]>
  getSearchPreferences(): Promise<unknown>
  pinFeature(pluginId: string, featureCode: string): Promise<{ success: boolean }>
  unpinFeature(pluginId: string, featureCode: string): Promise<{ success: boolean }>
  hideFeature(pluginId: string, featureCode: string): Promise<{ success: boolean }>
  unhideFeature(pluginId: string, featureCode: string): Promise<{ success: boolean }>
  removeRecentUsage(pluginId: string, featureCode: string): Promise<{ success: boolean }>
  getLaunchOnStartup(pluginId: string): Promise<PluginLaunchOnStartupState | undefined>
  setLaunchOnStartup(
    pluginId: string,
    enabled: boolean,
    target?: { featureCode: string; mode?: PluginLaunchMode }
  ): Promise<{ success: boolean; state?: PluginLaunchOnStartupState; error?: string }>
  getAlwaysOpenDetached(pluginId: string): Promise<PluginAlwaysOpenDetachedState | undefined>
  setAlwaysOpenDetached(
    pluginId: string,
    enabled: boolean
  ): Promise<{ success: boolean; state?: PluginAlwaysOpenDetachedState; error?: string }>
  resolveDroppedFilePaths(files: File[]): string[]
  install(filePath: string): Promise<{
    success: boolean
    pluginName?: string
    pluginId?: string
    action?: 'installed' | 'updated' | 'already-installed' | 'downgrade-blocked'
    isUpdate?: boolean
    oldVersion?: string
    newVersion?: string
    error?: string
  }>
  enable(name: string): Promise<{ success: boolean; error?: string }>
  disable(name: string): Promise<{ success: boolean; error?: string }>
  uninstall(name: string): Promise<{ success: boolean; error?: string }>
  getReadme(name: string): Promise<string | null>
  redirect(label: string | [string, string], payload?: unknown): Promise<boolean | { candidates: { name: string; displayName: string }[] }>
  outPlugin(isKill?: boolean): Promise<boolean>
  mainPushSelect(pluginName: string, action: { code: string; type: string; payload: string; option: MainPushItem }): Promise<boolean>
  getMainPushPlugins(): Promise<Array<{ pluginId: string; displayName: string }>>
  listBackground(): Promise<BackgroundPluginInfo[]>
  startBackground(pluginId: string): Promise<{ success: boolean; error?: string }>
  stopBackground(pluginId: string): Promise<{ success: boolean }>
  getBackgroundInfo(pluginId: string): Promise<BackgroundPluginInfo | null>
  stopPlugin(pluginId: string): Promise<{ success: boolean }>
  listCommandShortcuts(pluginId?: string): Promise<PluginCommandShortcutBindingRecord[]>
  bindCommandShortcut(input: PluginCommandShortcutBindInput): Promise<PluginCommandShortcutBindResult>
  unbindCommandShortcut(bindingId: string): Promise<{ success: boolean }>
  validateCommandShortcut(accelerator: string, bindingId?: string): Promise<PluginCommandShortcutValidationResult>
  setCommandDisabled(input: PluginCommandDisabledToggleInput): Promise<PluginCommandDisabledToggleResult>
}

interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  rotation: number
  isPrimary: boolean
}

interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

interface CaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
  bounds?: CaptureBounds
}

interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

type CommandExecutionProfile = 'sandbox' | 'workspace' | 'trusted'
type CommandSandboxLevel = 'os' | 'policy' | 'none'
type CommandSandboxBackendMode = 'auto' | 'policy' | 'os'
type CommandSandboxBackendName = 'policy' | 'macos-sandbox-exec' | 'windows-job-object' | 'linux-namespace'
type CommandAuditStatus = 'allowed' | 'blocked' | 'error' | 'timeout'
type PluginDirectoryAccessMode = 'read' | 'readwrite'

interface CommandRule {
  id: string
  mode: 'exact' | 'prefix'
  value: string
  enabled?: boolean
}

interface CommandCallerIdentity {
  kind: 'app' | 'plugin' | 'ai' | 'openclaw' | 'system'
  host?: 'app' | 'plugin' | 'openclaw' | 'system'
  actor?: 'human' | 'ai' | 'remote' | 'system'
  pluginId?: string
  pluginType?: string
  requestId?: string
  model?: string
  skillIds?: string[]
}

interface CommandSandboxSettings {
  enabled: boolean
  backendMode: CommandSandboxBackendMode
  fallbackToPolicy: boolean
  allowedRoots: string[]
  writableRoots: string[]
  networkAllowed: boolean
}

interface CommandTrustRecord {
  prefix: string
  matchMode?: 'executable' | 'commandLineExact'
  source: 'app' | 'plugin'
  pluginId?: string
  command: string
  args?: string[]
  shell?: boolean
  createdAt: number
  lastUsedAt: number
}

interface MulbyScreen {
  getAllDisplays(): Promise<DisplayInfo[]>
  getPrimaryDisplay(): Promise<DisplayInfo>
  getDisplayNearestPoint(point: { x: number; y: number }): Promise<DisplayInfo>
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): Promise<DisplayInfo>
  getCursorScreenPoint(): Promise<{ x: number; y: number }>
  getSources(options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }): Promise<CaptureSource[]>
  getWindowBounds(sourceId: string): Promise<CaptureBounds | null>
  capture(options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  captureRegion(region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  getMediaStreamConstraints(options: { sourceId: string; audio?: boolean; frameRate?: number }): Promise<object>
  screenCapture(): Promise<string | null>
  colorPick(): Promise<ColorPickResult | null>
  screenToDipPoint(point: { x: number; y: number }): Promise<{ x: number; y: number }>
  dipToScreenPoint(point: { x: number; y: number }): Promise<{ x: number; y: number }>
  screenToDipRect(rect: { x: number; y: number; width: number; height: number }): Promise<{ x: number; y: number; width: number; height: number }>
  dipToScreenRect(rect: { x: number; y: number; width: number; height: number }): Promise<{ x: number; y: number; width: number; height: number }>
}

interface CommandAuditItem {
  id: string
  timestamp: number
  source: 'app' | 'plugin'
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

interface CommandRunnerSettings {
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

interface RunCommandInput {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  shell?: boolean
  executionProfile?: CommandExecutionProfile
  network?: boolean
  writableRoots?: string[]
}

interface RunCommandResult {
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

interface PluginDirectoryAccessGrant {
  id: string
  pluginId: string
  path: string
  mode: PluginDirectoryAccessMode
  source: 'picker' | 'path-confirmation'
  reason?: string
  createdAt: number
  lastUsedAt?: number
}

interface PluginDirectoryAccessRequestInput {
  path?: string
  mode?: PluginDirectoryAccessMode
  title?: string
  message?: string
  reason?: string
}

interface MulbyShell {
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  openFolder(path: string): Promise<string>
  trashItem(path: string): Promise<void>
  beep(): Promise<void>
  runCommand(input: RunCommandInput): Promise<RunCommandResult>
  getRunCommandPolicy(): Promise<CommandRunnerSettings>
  updateRunCommandPolicy(patch: Partial<CommandRunnerSettings>): Promise<CommandRunnerSettings>
  listRunCommandAudit(limit?: number): Promise<CommandAuditItem[]>
  clearRunCommandAudit(): Promise<CommandRunnerSettings>
  clearRunCommandTrusted(): Promise<CommandRunnerSettings>
}

interface MulbyDirectoryAccess {
  request(input?: PluginDirectoryAccessRequestInput): Promise<PluginDirectoryAccessGrant | null>
  list(): Promise<PluginDirectoryAccessGrant[]>
  revoke(grantIdOrPath: string): Promise<boolean>
}

interface MulbyDialog {
  showOpenDialog(options?: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
    properties?: ('openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles')[]
  }): Promise<string[]>
  showSaveDialog(options?: {
    title?: string
    defaultPath?: string
    buttonLabel?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null>
  showMessageBox(options: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    title?: string
    message: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }): Promise<{ response: number; checkboxChecked: boolean }>
  showErrorBox(title: string, content: string): Promise<void>
}

interface SystemInfo {
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

interface AppInfo {
  name: string
  version: string
  locale: string
  isPackaged: boolean
  userDataPath: string
}

interface AppResourceProcessUsage {
  pid: number
  type: string
  name?: string
  cpuPercent: number
  workingSetBytes: number
}

interface AppResourceDiskUsage {
  userDataPath: string
  userDataBytes: number
  fileCount: number
  directoryCount: number
  truncated: boolean
  scannedAt: number
}

interface AppResourceUsage {
  sampledAt: number
  cpuPercent: number
  memoryBytes: number
  processCount: number
  disk: AppResourceDiskUsage
  processes: AppResourceProcessUsage[]
}

interface MulbySystem {
  getSystemInfo(): Promise<SystemInfo>
  getAppInfo(): Promise<AppInfo>
  getAppResourceUsage(): Promise<AppResourceUsage>
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'): Promise<string>
  getEnv(name: string): Promise<string | undefined>
  getIdleTime(): Promise<number>
  getFileIcon(filePath: string, options?: { size?: number; kind?: 'app' | 'file' }): Promise<string>
  getFileIcons(
    requests: Array<{ key: string; path: string; kind?: 'app' | 'file'; size?: number }>,
    options?: { size?: number; concurrency?: number }
  ): Promise<Array<{ key: string; path: string; kind: 'app' | 'file'; icon: string }>>
  getNativeId(): Promise<string>
  isDev(): Promise<boolean>
  isMacOS(): Promise<boolean>
  isWindows(): Promise<boolean>
  isLinux(): Promise<boolean>
}

interface MulbyPermission {
  getStatus(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  request(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<'authorized' | 'granted' | 'denied' | 'not-determined' | 'restricted' | 'limited' | 'unknown'>
  canRequest(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  openSystemSettings(type: 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'): Promise<boolean>
  isAccessibilityTrusted(): Promise<boolean>
}

type BackendPermissionType = 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'

interface MulbyShortcut {
  register(accelerator: string): Promise<boolean>
  unregister(accelerator: string): Promise<void>
  unregisterAll(): Promise<void>
  isRegistered(accelerator: string): Promise<boolean>
  onTriggered(callback: (accelerator: string) => void): Disposable
}

interface MulbySecurity {
  isEncryptionAvailable(): Promise<boolean>
  encryptString(plainText: string): Promise<ArrayBuffer>
  decryptString(encrypted: ArrayBuffer): Promise<string>
}

interface MulbyMedia {
  getAccessStatus(mediaType: 'microphone' | 'camera'): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  askForAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>
  hasCameraAccess(): Promise<boolean>
  hasMicrophoneAccess(): Promise<boolean>
}

interface MulbyPower {
  getSystemIdleTime(): Promise<number>
  getSystemIdleState(idleThreshold: number): Promise<'active' | 'idle' | 'locked' | 'unknown'>
  isOnBatteryPower(): Promise<boolean>
  getCurrentThermalState(): Promise<'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'>
  onSuspend(callback: () => void): Disposable
  onResume(callback: () => void): Disposable
  onAC(callback: () => void): Disposable
  onBattery(callback: () => void): Disposable
  onLockScreen(callback: () => void): Disposable
  onUnlockScreen(callback: () => void): Disposable
}

interface MulbyTray {
  create(options: { icon: string; tooltip?: string; title?: string }): Promise<boolean>
  destroy(): Promise<void>
  setIcon(icon: string): Promise<void>
  setTooltip(tooltip: string): Promise<void>
  setTitle(title: string): Promise<void>
  exists(): Promise<boolean>
}

interface MulbyNetwork {
  isOnline(): Promise<boolean>
  onOnline(callback: () => void): void
  onOffline(callback: () => void): void
}

interface ContextMenuItem {
  label: string
  type?: 'normal' | 'separator' | 'checkbox' | 'radio'
  checked?: boolean
  enabled?: boolean
  id?: string
  submenu?: ContextMenuItem[]
}

interface ActionMenuItem {
  id: string
  label: string
  separator?: boolean
  danger?: boolean
  disabled?: boolean
  checked?: boolean
}

interface ActionMenuPoint {
  x: number
  y: number
}

interface MulbyMenu {
  showContextMenu(items: ContextMenuItem[]): Promise<string | null>
  showActionMenu(items: ActionMenuItem[], point?: ActionMenuPoint): Promise<string | null>
}

interface GlobalInputEvent {
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

interface MulbyInputMonitor {
  isAvailable(): Promise<boolean>
  requireAccessibility(): Promise<boolean>
  start(options?: { mouse?: boolean; keyboard?: boolean; throttleMs?: number }): Promise<string | null>
  stop(sessionId: string): Promise<void>
  onEvent(callback: (event: GlobalInputEvent) => void): Disposable
}

interface MulbyGeolocation {
  getAccessStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  requestAccess(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  canGetPosition(): Promise<boolean>
  openSettings(): Promise<void>
  getCurrentPosition(options?: {
    desiredAccuracy?: 'best' | 'balanced' | 'coarse'
    allowFallback?: boolean
    timeoutMs?: number
  }): Promise<{
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

interface MulbyTTS {
  speak(text: string, options?: { lang?: string; rate?: number; pitch?: number; volume?: number }): Promise<void>
  stop(): void
  pause(): void
  resume(): void
  getVoices(): { name: string; lang: string; default: boolean; localService: boolean }[]
  isSpeaking(): boolean
}

interface MulbyStorage {
  get(key: string, namespace?: string): Promise<unknown>
  set(key: string, value: unknown, namespace?: string): Promise<boolean>
  remove(key: string, namespace?: string): Promise<boolean>
  getAll(namespace?: string): Promise<unknown>
  getAllWithMeta(namespace: string): Promise<unknown>
  listNamespaces(): Promise<unknown>
  clear(namespace: string): Promise<unknown>
  // V2 methods
  list(options?: { prefix?: string; startsAfter?: string; limit?: number; order?: 'asc' | 'desc'; namespace?: string }): Promise<{ items: { key: string; size: number; updatedAt: number; version: number }[]; nextCursor?: string }>
  getMany(keys: string[], options?: { namespace?: string }): Promise<{ key: string; found: boolean; value?: unknown; version?: number; updatedAt?: number }[]>
  setMany(items: { key: string; value: unknown; expectedVersion?: number | null }[], options?: { namespace?: string; atomic?: boolean }): Promise<{ success: boolean; results: { key: string; ok: boolean; version?: number; error?: string }[] }>
  getMeta(key: string, options?: { namespace?: string }): Promise<{ found: boolean; value?: unknown; version?: number; updatedAt?: number }>
  setWithVersion(key: string, value: unknown, options?: { namespace?: string; expectedVersion?: number | null }): Promise<{ ok: boolean; version?: number; conflict?: { currentVersion: number } }>
  removeWithVersion(key: string, options?: { namespace?: string; expectedVersion?: number }): Promise<{ ok: boolean; error?: string }>
  transaction(ops: { op: 'set' | 'remove'; key: string; value?: unknown; expectedVersion?: number | null }[], options?: { namespace?: string }): Promise<{ success: boolean; committed: number }>
  append(key: string, chunk: unknown, options?: { namespace?: string; maxItems?: number }): Promise<{ ok: boolean; newLength: number; version: number }>
  watch(options: { namespace?: string; prefix?: string }, callback: (event: { type: 'set' | 'remove' | 'clear'; key: string; namespace: string; version?: number; updatedAt: number }) => void): () => void
  encrypted: {
    set(key: string, value: unknown): Promise<boolean>
    get(key: string): Promise<unknown | undefined>
    remove(key: string): Promise<boolean>
    has(key: string): Promise<boolean>
  }
  attachment: {
    put(id: string, data: ArrayBuffer | Uint8Array, mimeType: string): Promise<boolean>
    get(id: string): Promise<Uint8Array | null>
    getType(id: string): Promise<string | null>
    remove(id: string): Promise<boolean>
    list(prefix?: string): Promise<{ id: string; mimeType: string; size: number }[]>
  }
}

interface MainPushItem {
  icon?: string
  title: string
  text: string
  [key: string]: unknown
}

interface Task {
  id: string
  name?: string
  pluginId?: string
  status?: string
  type?: string
  [key: string]: unknown
}

interface TaskExecution {
  id: string
  taskId: string
  status?: string
  [key: string]: unknown
}

interface TaskSchedulerEvent {
  type: string
  taskId?: string
  executionId?: string
  [key: string]: unknown
}

interface MulbyScheduler {
  schedule(task: {
    name: string
    type: 'once' | 'repeat' | 'delay'
    callback: string
    time?: number
    cron?: string
    delay?: number
    payload?: any
    maxRetries?: number
    retryDelay?: number
    timeout?: number
    description?: string
    endTime?: number
    maxExecutions?: number
  }): Promise<Task>
  cancelTask(taskId: string): Promise<{ success: boolean }>
  pauseTask(taskId: string): Promise<{ success: boolean }>
  resumeTask(taskId: string): Promise<{ success: boolean }>
  listTasks(filter?: { pluginId?: string; status?: string; type?: string; limit?: number; offset?: number }): Promise<Task[]>
  getTaskCount(filter?: { status?: string; type?: string }): Promise<number>
  getTask(taskId: string): Promise<Task | null>
  deleteTasks(taskIds: string[]): Promise<{ success: boolean; deletedCount: number }>
  cleanupTasks(olderThan?: number): Promise<{ success: boolean; deletedCount: number }>
  getExecutions(taskId: string, limit?: number): Promise<TaskExecution[]>
  validateCron(expression: string): Promise<boolean>
  getNextCronTime(expression: string, after?: Date): Promise<Date>
  describeCron(expression: string): Promise<string>
  subscribe(): Promise<{ success: boolean; error?: string }>
  unsubscribe(): Promise<{ success: boolean; error?: string }>
  onEvent(callback: (event: TaskSchedulerEvent) => void): Disposable
}

interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  data: string
}

interface MulbyHttp {
  request(options: {
    url: string
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'
    headers?: Record<string, string>
    body?: unknown
    timeout?: number
  }): Promise<HttpResponse>
  get(url: string, headers?: Record<string, string>): Promise<HttpResponse>
  post(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse>
  put(url: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse>
  delete(url: string, headers?: Record<string, string>): Promise<HttpResponse>
}

interface ShortcutStatusMap {
  [accelerator: string]: boolean
}

interface AppSettings {
  [key: string]: unknown
}

interface StartupOpenAtLoginState {
  supported: boolean
  enabled: boolean
}

type UpdateCenterStatus = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'downloading' | 'downloaded' | 'error'

interface UpdateCenterState {
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
  downloadProgress?: {
    bytesPerSecond: number
    percent: number
    transferred: number
    total: number
  }
}

interface MulbySettings {
  get(): Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
  update(partial: Partial<AppSettings>): Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
  reset(): Promise<{ settings: AppSettings; shortcutStatus: ShortcutStatusMap }>
  pauseShortcuts(): Promise<ShortcutStatusMap>
  resumeShortcuts(): Promise<ShortcutStatusMap>
  setShortcutRecordingActive(active: boolean): Promise<boolean>
  onShortcutCaptured(callback: (accelerator: string) => void): Disposable
  getOpenAtLoginState(): Promise<StartupOpenAtLoginState>
  setOpenAtLogin(enabled: boolean): Promise<StartupOpenAtLoginState>
  getUpdateCenterState(): Promise<UpdateCenterState>
  checkAppUpdates(): Promise<UpdateCenterState>
  openUpdateReleasePage(): Promise<boolean>
  downloadUpdate(): Promise<UpdateCenterState>
  installUpdate(): Promise<boolean>
  onUpdateStateChanged(callback: (state: UpdateCenterState) => void): Disposable
  onShortcutStatusChanged(callback: (status: ShortcutStatusMap) => void): Disposable
}

interface MulbyDeveloper {
  addPluginPath(path: string): Promise<{ success: boolean; error?: string }>
  removePluginPath(path: string): Promise<{ success: boolean }>
  reloadPlugins(): Promise<{ success: boolean }>
  selectDirectory(): Promise<string | null>
  addPluginProject(args: { path: string; source?: 'added' | 'imported' | 'created' | 'migrated' }): Promise<{ success: boolean; error?: string }>
  removePluginProject(args: { id?: string; path?: string }): Promise<{ success: boolean; error?: string }>
  reloadPlugin(pluginId: string): Promise<{ success: boolean; error?: string }>
  reloadPluginByPath(path: string): Promise<{ success: boolean; error?: string }>
  validatePlugin(path: string): Promise<{ valid: boolean; errors?: string[] }>
  listPluginProjects(): Promise<any[]>
  createPlugin(args: { targetDir: string; name: string; template?: 'react' | 'basic' }): Promise<{ success: boolean; path?: string; error?: string }>
  buildPlugin(path: string): Promise<{ success: boolean; error?: string }>
  packPlugin(path: string): Promise<{ success: boolean; outputPath?: string; error?: string }>
  openPluginDir(path: string): Promise<boolean>
  updateProjectMeta(args: { id: string; lastOpenedAt?: number; label?: string }): Promise<{ success: boolean; error?: string }>
}

interface DesktopFileSearchResult {
  name: string
  path: string
  isDirectory: boolean
  size?: number
}

interface DesktopAppSearchResult {
  name: string
  path: string
  kind: 'application' | 'shortcut' | 'executable'
  iconPath?: string
}

interface MulbyDesktop {
  searchFiles(query: string, limit?: number): Promise<DesktopFileSearchResult[]>
  searchApps(query: string, limit?: number): Promise<DesktopAppSearchResult[]>
}

interface PluginStoreFetchResult {
  success?: boolean
  plugins?: unknown[]
  error?: string
  [key: string]: unknown
}

interface PluginStoreInstallFromUrlInput {
  url: string
  enabled?: boolean
}

interface PluginStoreInstallResult {
  success: boolean
  pluginId?: string
  error?: string
  [key: string]: unknown
}

interface InstalledPluginUpdateResult {
  updates?: unknown[]
  error?: string
  [key: string]: unknown
}

interface PluginStoreBatchUpdateResult {
  success: boolean
  error?: string
  updatedPluginIds?: string[]
  [key: string]: unknown
}

interface MulbyPluginStore {
  fetch(): Promise<PluginStoreFetchResult>
  installFromUrl(input: PluginStoreInstallFromUrlInput): Promise<PluginStoreInstallResult>
  checkUpdatesInstalled(): Promise<InstalledPluginUpdateResult>
  updateAll(pluginIds?: string[]): Promise<PluginStoreBatchUpdateResult>
}

interface TrayMenuRecentItem {
  id: string
  type: 'plugin' | 'command'
  title: string
  subtitle: string
  timestamp: number
  pluginId?: string
  featureCode?: string
}

interface TrayMenuState {
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

interface MulbyTrayMenu {
  getState(): Promise<TrayMenuState>
  action(action: string, payload?: Record<string, unknown>): Promise<{ success: boolean; state?: TrayMenuState; error?: string }>
  close(): Promise<{ success: boolean }>
  onState(callback: (state: TrayMenuState) => void): Disposable
}

interface SuperPanelItem {
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
}

interface SuperPanelPinnedItem {
  pluginId: string
  featureCode: string
  displayName: string
  pluginIcon?: string
  pinnedAt: number
}

interface SuperPanelTranslation {
  text: string
  loading: boolean
  error?: string
}

interface SuperPanelState {
  capturedText: string
  items: SuperPanelItem[]
  visible: boolean
  mode: 'match' | 'pinned'
  pinnedItems?: SuperPanelPinnedItem[]
  translation?: SuperPanelTranslation
}

interface MulbySuperPanel {
  getState(): Promise<SuperPanelState>
  action(action: string, payload?: Record<string, unknown>): Promise<{ success: boolean; error?: string }>
  close(): Promise<{ success: boolean }>
  setIgnoreBlur(ignore: boolean): Promise<unknown>
  onState(callback: (state: SuperPanelState) => void): Disposable
}

interface LogEntry {
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

interface MulbyLog {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
  getLogs(options?: { pluginId?: string; level?: string; limit?: number }): Promise<LogEntry[]>
  clear(pluginId?: string): Promise<{ success: boolean }>
  getLogsDir(): Promise<string>
  subscribe(): Promise<{ success: boolean }>
  onLog(callback: (entry: LogEntry) => void): Disposable
}

type CommandCallerIdentity = {
  kind: 'app' | 'plugin' | 'ai' | 'openclaw' | 'system'
  host?: 'app' | 'plugin' | 'openclaw' | 'system'
  actor?: 'human' | 'ai' | 'remote' | 'system'
  pluginId?: string
  pluginType?: string
  requestId?: string
  model?: string
  skillIds?: string[]
}
type AiSkillSource = 'manual' | 'local-dir' | 'zip' | 'npx' | 'json' | 'builtin' | 'system'
type AiSkillTrustLevel = 'untrusted' | 'reviewed' | 'trusted'
type AiSkillSelectionMeta = {
  id: string
  source: AiSkillSource
  trustLevel: AiSkillTrustLevel
}
type AiCapabilityDebugInfo = {
  requested: string[]
  allowed: string[]
  denied: string[]
  reasons: string[]
  selectedSkills?: AiSkillSelectionMeta[]
}
type AiPolicyDebugInfo = {
  skills: {
    requested?: AiSkillSelection
    selectedSkillIds: string[]
    selectedSkillNames: string[]
    reasons: string[]
  }
  mcp: {
    requested?: AiMcpSelection
    resolved?: AiMcpSelection
  }
  toolContext: {
    requested?: AiToolContext
    resolved?: AiToolContext
  }
  capabilities: {
    requested: string[]
    resolved: string[]
  }
  internalTools: {
    requested: string[]
    resolved: string[]
  }
}

type AiMessage = {
  role: 'system' | 'user' | 'assistant'
  content?: string | AiMessageContent[]
  reasoning_content?: string
  chunkType?: 'meta' | 'text' | 'reasoning' | 'tool-call' | 'tool-progress' | 'tool-result' | 'error' | 'end'
  capability_debug?: AiCapabilityDebugInfo
  policy_debug?: AiPolicyDebugInfo
  tool_call?: { id: string; name: string; args?: unknown }
  tool_progress?: { id?: string; name: string; progress: number; total?: number; message?: string }
  tool_result?: { id: string; name: string; result?: unknown }
  error?: { message: string; code?: string; category?: string; retryable?: boolean; statusCode?: number }
  usage?: AiTokenBreakdown
}
type AiMessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; attachmentId: string; mimeType?: string }
  | { type: 'file'; attachmentId: string; mimeType?: string; filename?: string }
type AiTool = {
  type: 'function'
  function?: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
      additionalProperties?: boolean
    }
    required?: string[]
  }
}
type AiModelParameters = {
  contextWindow?: number
  temperatureEnabled?: boolean
  topPEnabled?: boolean
  maxOutputTokensEnabled?: boolean
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  seed?: number
}
type AiMcpSelection = { mode?: 'off' | 'manual' | 'auto'; serverIds?: string[]; allowedToolIds?: string[] }
type AiSkillSelection = {
  mode?: 'off' | 'manual' | 'progressive'
  skillIds?: string[]
  variables?: Record<string, string>
}
type AiOption = {
  model?: string
  messages: AiMessage[]
  tools?: AiTool[]
  capabilities?: string[]
  internalTools?: string[]
  toolingPolicy?: {
    enableInternalTools?: boolean
    capabilityAllowList?: string[]
    capabilityDenyList?: string[]
  }
  mcp?: AiMcpSelection
  skills?: AiSkillSelection
  params?: AiModelParameters
  toolContext?: AiToolContext
  maxToolSteps?: number
}
type AiEndpointType = 'openai' | 'openai-response' | 'anthropic' | 'gemini' | 'image-generation' | 'jina-rerank'
type AiModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'
type AiModelCapability = { type: AiModelType; isUserSelected?: boolean }
type AiModel = {
  id: string
  label: string
  description: string
  icon?: string
  providerRef?: string
  providerLabel?: string
  endpointType?: AiEndpointType
  supportedEndpointTypes?: AiEndpointType[]
  params?: AiModelParameters
  capabilities?: AiModelCapability[]
}
type AiModelsFilter = {
  /** 按端点类型筛选（单值或多值）。 */
  endpointType?: AiEndpointType | AiEndpointType[]
  /** 按能力筛选（单值或多值），满足任意一个即包含。 */
  capability?: AiModelType | AiModelType[]
  /** 按 Provider 实例 ID 精确筛选。 */
  providerId?: string
}
type AiProviderConfig = {
  id: string
  type?: string
  label?: string
  enabled: boolean
  apiKey?: string
  baseURL?: string
  apiVersion?: string
  anthropicBaseURL?: string
  headers?: Record<string, string>
  defaultModel?: string
  defaultParams?: AiModelParameters
}
type AiMcpServer = {
  id: string
  name: string
  type: 'stdio' | 'sse' | 'streamableHttp'
  isActive: boolean
  description?: string
  baseUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  timeoutSec?: number
  longRunning?: boolean
  disabledTools?: string[]
  disabledAutoApproveTools?: string[]
  installSource?: 'manual' | 'protocol' | 'builtin'
  isTrusted?: boolean
  trustedAt?: number
  installedAt?: number
}
type AiMcpSettings = {
  servers: AiMcpServer[]
  defaults?: { timeoutMs?: number; longRunningMaxMs?: number; approvalMode?: 'always' | 'auto-approved-only' | 'never' }
}
type AiMcpTool = {
  id: string
  name: string
  description?: string
  serverId: string
  serverName: string
  inputSchema?: unknown
  outputSchema?: unknown
}
type AiMcpServerLogEntry = {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  source?: string
  data?: unknown
}
type AiSkillMcpPolicy = {
  serverIds?: string[]
  allowedToolIds?: string[]
  blockedToolIds?: string[]
}
type AiSkillMulbyExtensions = {
  mode?: 'manual' | 'auto' | 'both'
  triggerPhrases?: string[]
  capabilities?: string[]
  internalTools?: string[]
  mcpPolicy?: AiSkillMcpPolicy
}
type AiSkillDescriptor = {
  id: string
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  promptTemplate?: string
  mulbyExtensions?: AiSkillMulbyExtensions
  mode?: 'manual' | 'auto' | 'both'
  triggerPhrases?: string[]
  capabilities?: string[]
  internalTools?: string[]
  mcpPolicy?: AiSkillMcpPolicy
}
type AiSkillRecord = {
  id: string
  source: AiSkillSource
  origin?: 'system' | 'app'
  readonly?: boolean
  sourceRef?: string
  installPath?: string
  skillMdPath?: string
  contentHash: string
  enabled: boolean
  trustLevel: AiSkillTrustLevel
  installedAt: number
  updatedAt: number
  descriptor: AiSkillDescriptor
}
type AiSkillSettings = {
  enabled: boolean
  activeSkillIds: string[]
  records: AiSkillRecord[]
}
type AiSkillPreview = {
  selected: AiSkillRecord[]
  systemPrompt: string
  mcpImpact: { serverIds?: string[]; allowedToolIds?: string[]; blockedToolIds?: string[] }
  reasons: string[]
}
type AiSkillResolveResult = {
  selectedSkillIds: string[]
  selectedSkillNames: string[]
  selectedSkills?: AiSkillSelectionMeta[]
  availableSkillsPrompt?: string
  systemPrompts: string[]
  mergedMcp?: AiMcpSelection
  toolContextPatch?: AiToolContext['mcpScope']
  capabilities?: string[]
  internalTools?: string[]
  reasons?: string[]
}
type AiSkillCreateModelOption = {
  id: string
  label: string
  providerRef?: string
  providerLabel?: string
}
type AiSkillCreateWithAiInput = {
  requirements: string
  model: string
  previousRawText?: string
  replaceSkillId?: string
  enabled?: boolean
  trustLevel?: AiSkillTrustLevel
}
type AiSkillCreateWithAiResult = {
  record: AiSkillRecord
  generation: { model: string; rawText: string; notes?: string[] }
}
type AiSkillCreateProgressChunk = {
  type: 'status' | 'content' | 'reasoning'
  text: string
  stage?: 'generating' | 'parsing' | 'validating' | 'writing' | 'completed'
  stageStatus?: 'start' | 'done' | 'error'
}
type AiToolContext = {
  pluginName?: string
  internalTag?: string
  caller?: CommandCallerIdentity
  requestId?: string
  mcpScope?: { allowedServerIds?: string[]; allowedToolIds?: string[] }
}
type AiSettings = {
  providers: AiProviderConfig[]
  models?: AiModel[]
  defaultModel?: string
  defaultParams?: AiModelParameters
  mcp?: AiMcpSettings
  skills?: AiSkillSettings
}
type AiAttachmentRef = { attachmentId: string; mimeType: string; size: number; filename?: string; expiresAt?: string; purpose?: string }
type AiTokenBreakdown = { inputTokens: number; outputTokens: number }
type AiImageGenerateProgressChunk = {
  type: 'status' | 'preview'
  stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback'
  message?: string
  image?: string
  index?: number
  received?: number
  total?: number
}
type AiPromiseLike<T> = Promise<T> & { abort: () => void }

interface MulbyAi {
  call(option: AiOption, onChunk?: (chunk: AiMessage) => void): AiPromiseLike<AiMessage>
  allModels(filter?: AiModelsFilter): Promise<AiModel[]>
  abort(requestId: string): Promise<void>
  skills: {
    list(): Promise<AiSkillRecord[]>
    refresh(): Promise<AiSkillRecord[]>
    listEnabled(): Promise<AiSkillRecord[]>
    get(skillId: string): Promise<AiSkillRecord | null>
    install(input: {
      source: 'local-dir' | 'zip' | 'npx'
      ref: string
      skills?: string[]
      command?: string
      trustLevel?: AiSkillTrustLevel
      enabled?: boolean
    }): Promise<AiSkillRecord[]>
    remove(skillId: string): Promise<void>
    enable(skillId: string): Promise<AiSkillRecord>
    disable(skillId: string): Promise<AiSkillRecord>
    preview(input: { option?: Partial<AiOption>; skillIds?: string[]; prompt?: string }): Promise<AiSkillPreview>
    resolve(option: AiOption): Promise<AiSkillResolveResult>
  }
  tokens: {
    estimate(input: { model?: string; messages: AiMessage[]; attachments?: AiAttachmentRef[]; outputText?: string }): Promise<AiTokenBreakdown>
  }
  attachments: {
    upload(input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }): Promise<AiAttachmentRef>
    get(attachmentId: string): Promise<AiAttachmentRef | null>
    delete(attachmentId: string): Promise<void>
    uploadToProvider(input: {
      attachmentId: string
      model?: string
      providerId?: string
      purpose?: string
    }): Promise<{ providerId: string; fileId: string; uri?: string }>
  }
  images: {
    generate(input: { model: string; prompt: string; size?: string; count?: number }): Promise<{ images: string[]; tokens: AiTokenBreakdown }>
    generateStream(
      input: { model: string; prompt: string; size?: string; count?: number },
      onChunk: (chunk: AiImageGenerateProgressChunk) => void
    ): AiPromiseLike<{ images: string[]; tokens: AiTokenBreakdown }>
    edit(input: { model: string; imageAttachmentId: string; prompt: string }): Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  }
  models: {
    fetch(input: { providerId: string; baseURL?: string; apiKey?: string }): Promise<{ models: AiModel[]; message?: string }>
  }
  testConnection(input?: { providerId?: string; model?: string; baseURL?: string; apiKey?: string }): Promise<{ success: boolean; message?: string }>
  testConnectionStream(
    input: { providerId?: string; model?: string; baseURL?: string; apiKey?: string },
    onChunk: (chunk: { type: 'reasoning' | 'content'; text: string }) => void
  ): AiPromiseLike<{ success: boolean; message?: string; reasoning?: string }>
  settings: {
    get(): Promise<AiSettings>
    update(next: Partial<AiSettings>): Promise<AiSettings>
  }
  mcp: {
    listServers(): Promise<AiMcpServer[]>
    getServer(serverId: string): Promise<AiMcpServer | null>
    upsertServer(server: AiMcpServer): Promise<AiMcpServer>
    removeServer(serverId: string): Promise<void>
    activateServer(serverId: string): Promise<AiMcpServer>
    deactivateServer(serverId: string): Promise<AiMcpServer>
    restartServer(serverId: string): Promise<AiMcpServer>
    checkServer(serverId: string): Promise<{ ok: boolean; message?: string }>
    listTools(serverId: string): Promise<AiMcpTool[]>
    abort(callId: string): Promise<boolean>
    getLogs(serverId: string): Promise<AiMcpServerLogEntry[]>
  }
  tooling: {
    webSearch: {
      /** 获取当前网络搜索原始配置 */
      get(): Promise<Record<string, unknown>>
      /** 更新网络搜索配置（部分更新） */
      update(partial: Record<string, unknown>): Promise<Record<string, unknown>>
      /** 获取当前网络搜索配置（含可用 provider 列表） */
      getSettings(): Promise<{
        activeProvider: string
        providers: Array<{ id: string; name: string; type: 'local' | 'api' | 'custom' }>
      }>
      /** 修改当前激活的搜索 provider */
      setActiveProvider(providerId: string): Promise<{ success: boolean; activeProvider: string }>
    }
    pluginTools: {
      /** 获取当前被禁用的插件工具列表 */
      getDisabled(): Promise<string[]>
      /** 设置被禁用的插件工具列表（全量替换） */
      setDisabled(disabledList: string[]): Promise<string[]>
    }
  }
  mcpServer: {
    getState(): Promise<{
      status: 'stopped' | 'starting' | 'running' | 'error'
      port: number
      address?: string
      toolCount: number
      error?: string
      startedAt?: number
    }>
    start(): Promise<unknown>
    stop(): Promise<unknown>
    restart(): Promise<unknown>
    regenerateToken(): Promise<{ token: string }>
    getTools(): Promise<Array<{
      mcpToolName: string
      pluginId: string
      toolName: string
      pluginName: string
    }>>
    getClientConfig(): Promise<{
      claudeDesktop: object
      cursor: object
      generic: object
    }>
    refreshTools(): Promise<unknown>
    getConfig(): Promise<{
      enabled: boolean
      port: number
      token: string
      stdioBridgePath: string
    }>
    updatePort(port: number): Promise<unknown>
  }
}

interface FileStat {
  name: string
  path: string
  size: number
  isFile: boolean
  isDirectory: boolean
  createdAt: number
  modifiedAt: number
}

interface MulbyFilesystem {
  readFile(path: string, encoding?: 'utf-8' | 'base64'): Promise<string | ArrayBuffer>
  writeFile(path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64'): Promise<void>
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
  readdir(path: string): Promise<string[]>
  mkdir(path: string): Promise<void>
  stat(path: string): Promise<FileStat | null>
  copy(src: string, dest: string): Promise<void>
  move(src: string, dest: string): Promise<void>
}

interface MulbyHost {
  invoke(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>
  call(pluginName: string, method: string, ...args: unknown[]): Promise<{ success: boolean; data: unknown }>
  status(pluginName: string): Promise<{ ready: boolean; active: boolean }>
  restart(pluginName: string): Promise<boolean>
}

interface FFmpegRunProgress {
  bitrate: string
  fps: number
  frame: number
  percent?: number
  q: number | string
  size: string
  speed: string
  time: string
}

interface FFmpegDownloadProgress {
  phase: 'downloading' | 'extracting' | 'done'
  percent: number
  downloaded?: number
  total?: number
}

interface FFmpegTask {
  promise: Promise<void>
  kill(): void
  quit(): void
}

interface MulbyFFmpeg {
  isAvailable(): Promise<boolean>
  getVersion(): Promise<string | null>
  getPath(): Promise<string | null>
  download(onProgress?: (progress: FFmpegDownloadProgress) => void): Promise<{ success: boolean; error?: string }>
  run(args: string[], onProgress?: (progress: FFmpegRunProgress) => void): FFmpegTask
}

type Attachment = InputAttachment

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  attachments?: Attachment[]
  mode?: string
  capabilities?: PluginRendererCapabilities
  nonce?: number
  route?: string
  params?: Record<string, string>
  windowType?: string
}

interface PluginLaunchStartEvent {
  requestId: string
  pluginName: string
  displayName: string
  featureCode: string
  startedAt: number
}

interface PluginLaunchEndEvent {
  requestId: string
  pluginName: string
  featureCode: string
  reason: 'finished' | 'failed' | 'cancelled' | 'skipped'
}

type DoubleTapModifier = 'Command' | 'Ctrl' | 'Alt' | 'Shift'
type SuperPanelTriggerType = 'mouse_click' | 'mouse_longpress' | 'keyboard' | 'double_tap'
type SuperPanelMouseButton = 'middle' | 'back' | 'forward' | 'right'

interface SuperPanelTriggerSettings {
  type: SuperPanelTriggerType
  mouseButton?: SuperPanelMouseButton
  longPressMs?: number
  accelerator?: string
  modifier?: DoubleTapModifier
}

interface SuperPanelSettings {
  enabled: boolean
  trigger: SuperPanelTriggerSettings
  blockedApps: string[]
  clipboardPollDelayMs: number
  maxItems: number
  instantTranslation: boolean
  translationMaxLength?: number
}

interface MulbyOnboarding {
  getSettings(): Promise<unknown>
  updateShortcut(action: string, accelerator: string): Promise<unknown>
  updateTheme(mode: string): Promise<unknown>
  updateAiProvider(provider: {
    id: string
    type?: string
    label?: string
    enabled: boolean
    apiKey?: string
    baseURL?: string
  }): Promise<unknown>
  updateStoreSources(sources: {
    id: string
    name: string
    url: string
    enabled: boolean
    priority: number
  }[]): Promise<unknown>
  updateSuperPanel(superPanel: SuperPanelSettings): Promise<unknown>
  complete(): Promise<unknown>
  onClose(callback: () => void): Disposable
}

interface MulbyAPI {
  onboarding: MulbyOnboarding
  app: MulbyApp
  systemPlugin: MulbySystemPlugin
  systemPage: MulbySystemPage
  clipboard: MulbyClipboard
  input: MulbyInput
  inputMonitor: MulbyInputMonitor
  notification: MulbyNotification
  window: MulbyWindow
  subInput: MulbySubInput
  plugin: MulbyPlugin
  pluginStore: MulbyPluginStore
  directoryAccess: {
    request(input?: { path?: string; mode?: 'read' | 'readwrite'; title?: string; message?: string; reason?: string }): Promise<{ id: string; pluginId: string; path: string; mode: 'read' | 'readwrite'; source: string; reason?: string; createdAt: number; lastUsedAt?: number } | null>
    list(): Promise<{ id: string; pluginId: string; path: string; mode: 'read' | 'readwrite'; source: string; reason?: string; createdAt: number; lastUsedAt?: number }[]>
    revoke(grantIdOrPath: string): Promise<boolean>
  }
  theme: MulbyTheme
  ai: MulbyAi
  screen: MulbyScreen
  shell: MulbyShell
  directoryAccess: MulbyDirectoryAccess
  desktop: MulbyDesktop
  dialog: MulbyDialog
  system: MulbySystem
  permission: MulbyPermission
  shortcut: MulbyShortcut
  security: MulbySecurity
  settings: MulbySettings
  developer: MulbyDeveloper
  media: MulbyMedia
  power: MulbyPower
  tray: MulbyTray
  trayMenu: MulbyTrayMenu
  superPanel: MulbySuperPanel
  network: MulbyNetwork
  menu: MulbyMenu
  geolocation: MulbyGeolocation
  tts: MulbyTTS
  storage: MulbyStorage
  http: MulbyHttp
  filesystem: MulbyFilesystem
  scheduler: MulbyScheduler
  host: MulbyHost
  log: MulbyLog
  onPluginInit(callback: (data: PluginInitData) => void): Disposable
  onPluginAttach(callback: (data: {
    pluginName: string
    displayName: string
    featureCode: string
    input: string
    attachments?: Attachment[]
    mode: 'panel'
    launchRequestId?: string
  }) => void): Disposable
  onPluginDetached(callback: () => void): Disposable
  onPluginOut(callback: (isKill: boolean) => void): Disposable
  onPluginLaunchStart(callback: (data: PluginLaunchStartEvent) => void): Disposable
  onPluginLaunchEnd(callback: (data: PluginLaunchEndEvent) => void): Disposable
  onThemeChange(callback: (theme: 'light' | 'dark') => void): Disposable
  onWindowStateChange(callback: (state: { isMaximized: boolean }) => void): Disposable
  inbrowser: {
    goto: (url: string, headers?: Record<string, string>, timeout?: number) => any
    useragent: (ua: string) => any
    device: (name: string) => any
    viewport: (width: number, height: number) => any
    show: () => any
    hide: () => any
    evaluate: (func: string | Function, ...params: any[]) => any
    wait: (msOrSelector: number | string) => any
    click: (selector: string) => any
    mousedown: (selector: string) => any
    mouseup: (selector: string) => any
    scroll: (selector: string | number, y?: number) => any
    devTools: (mode?: 'right' | 'bottom' | 'undocked' | 'detach') => any
    paste: (text: string) => any
    file: (selector: string, payload: string | string[]) => any
    end: () => any
    type: (selector: string, text: string) => any
    press: (key: string, modifiers?: string[]) => any
    check: (selector: string, checked: boolean) => any
    value: (selector: string, val: string) => any
    focus: (selector: string) => any
    when: (selector: string | Function, ...params: any[]) => any
    css: (css: string) => any
    pdf: (options?: any, savePath?: string) => any
    cookies: (nameOrFilter?: string | any) => any
    clearCookies: (url?: string) => any
    input: (selectorOrText: string, text?: string) => any
    dblclick: (selector: string) => any
    hover: (selector: string) => any
    screenshot: (target?: any, savePath?: string) => any
    drop: (selector: string, payload: any) => any
    download: (urlOrFunc: string | Function, savePath?: string, ...params: any[]) => any
    removeCookies: (name: string) => any
    setCookies: (nameOrCookies: any, value?: string) => any
    markdown: (selector?: string) => any
    getIdleInBrowsers: () => Promise<any[]>
    setInBrowserProxy: (config: any) => Promise<boolean>
    clearInBrowserCache: () => Promise<boolean>
    run: (idOrOptions?: number | any, options?: any) => Promise<any[]>
  }
  openclaw: {
    getSettings(): Promise<unknown>
    updateSettings(partial: unknown): Promise<unknown>
    connect(): Promise<unknown>
    disconnect(): Promise<unknown>
    getStatus(): Promise<unknown>
    testConnection(settings: unknown): Promise<unknown>
    onStatusChanged(callback: (status: unknown) => void): Disposable
    onInvoked(callback: (data: unknown) => void): Disposable
    getLogs(): Promise<unknown>
    clearLogs(): Promise<unknown>
    onLog(callback: (entry: unknown) => void): Disposable
    onLogsCleared(callback: () => void): Disposable
  }
  sharp: MulbySharpFunction
  getSharpVersion: () => Promise<{ sharp: Record<string, string>; format: Record<string, any> }>
  ffmpeg: MulbyFFmpeg
}

interface BackendClipboardHistoryItem {
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

interface BackendClipboardHistoryStats {
  total: number
  text: number
  image: number
  files: number
  favorite: number
}

interface BackendClipboardHistory {
  query(options?: {
    type?: 'text' | 'image' | 'files'
    search?: string
    favorite?: boolean
    sourceApp?: string
    limit?: number
    offset?: number
  }): Promise<BackendClipboardHistoryItem[]>
  get(id: string): Promise<BackendClipboardHistoryItem | null>
  copy(id: string): Promise<{ success: boolean; error?: string }>
  toggleFavorite(id: string): Promise<{ success: boolean }>
  delete(id: string): Promise<{ success: boolean }>
  clear(): Promise<{ success: boolean }>
  stats(): Promise<BackendClipboardHistoryStats>
}

interface PluginMessage {
  id: string
  from: string
  to?: string
  type: string
  payload: unknown
  timestamp: number
}

interface BackendMessaging {
  send(targetPluginId: string, type: string, payload: unknown): Promise<void>
  broadcast(type: string, payload: unknown): Promise<void>
  on(handler: (message: PluginMessage) => void | Promise<void>): void
  off(handler?: (message: PluginMessage) => void | Promise<void>): void
}

interface BackendScheduler {
  schedule(task: {
    name: string
    type: 'once' | 'repeat' | 'delay'
    callback: string
    time?: number
    cron?: string
    delay?: number
    payload?: any
    maxRetries?: number
    retryDelay?: number
    timeout?: number
    description?: string
    endTime?: number
    maxExecutions?: number
  }): Promise<any>
  cancel(taskId: string): Promise<void>
  pause(taskId: string): Promise<void>
  resume(taskId: string): Promise<void>
  get(taskId: string): Promise<any>
  list(filter?: { status?: string; type?: string; limit?: number }): Promise<any[]>
  getExecutions(taskId: string, limit?: number): Promise<any[]>
  validateCron(expression: string): boolean
  getNextCronTime(expression: string, after?: Date): Date
  describeCron(expression: string): string
}

interface BackendMulbyAi {
  call(option: AiOption, onChunk?: (chunk: AiMessage) => void): AiPromiseLike<AiMessage>
  allModels(filter?: AiModelsFilter): Promise<AiModel[]>
  abort(requestId: string): void
  skills: {
    listEnabled(): Promise<AiSkillRecord[]>
    previewForCall(input: { option?: Partial<AiOption>; skillIds?: string[]; prompt?: string }): Promise<AiSkillPreview>
  }
  attachments: {
    upload(input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }): Promise<AiAttachmentRef>
    get(attachmentId: string): Promise<AiAttachmentRef | null>
    delete(attachmentId: string): Promise<void>
    uploadToProvider(input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }): Promise<{ providerId: string; fileId: string; uri?: string }>
  }
  tokens: {
    estimate(input: { model?: string; messages: AiMessage[]; outputText?: string }): Promise<AiTokenBreakdown>
  }
  images: {
    generate(input: { prompt: string; model: string; size?: string; count?: number }): Promise<{ images: string[]; tokens: AiTokenBreakdown }>
    generateStream(
      input: { prompt: string; model: string; size?: string; count?: number },
      onChunk: (chunk: AiImageGenerateProgressChunk) => void
    ): AiPromiseLike<{ images: string[]; tokens: AiTokenBreakdown }>
    edit(input: { imageAttachmentId: string; prompt: string; model: string }): Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  }
}

interface BackendPluginAPIDirect {
  clipboard: {
    readText(): string
    writeText(text: string): Promise<void>
    readImage(): Uint8Array | null
    writeImage(buffer: Uint8Array): void
    readFiles(): Array<{ path: string; name: string; size: number; isDirectory: boolean }>
    getFormat(): 'text' | 'image' | 'files' | 'empty'
  }
  clipboardHistory: BackendClipboardHistory
  notification: MulbyNotification
  storage: {
    get(key: string): unknown
    set(key: string, value: unknown): unknown
    remove(key: string): unknown
    clear(): unknown
    keys(): string[]
    has(key: string): boolean
    getAll(): Record<string, unknown>
    bulkSet(entries: Record<string, unknown>): void
    // V2 methods
    list(options?: { prefix?: string; startsAfter?: string; limit?: number; order?: 'asc' | 'desc' }): { items: { key: string; size: number; updatedAt: number; version: number }[]; nextCursor?: string }
    getMany(keys: string[]): { key: string; found: boolean; value?: unknown; version?: number; updatedAt?: number }[]
    setMany(items: { key: string; value: unknown; expectedVersion?: number | null }[], options?: { atomic?: boolean }): { success: boolean; results: { key: string; ok: boolean; version?: number; error?: string }[] }
    getMeta(key: string): { found: boolean; value?: unknown; version?: number; updatedAt?: number }
    setWithVersion(key: string, value: unknown, expectedVersion?: number | null): { ok: boolean; version?: number; conflict?: { currentVersion: number } }
    removeWithVersion(key: string, expectedVersion?: number): { ok: boolean; error?: string }
    transaction(ops: { op: 'set' | 'remove'; key: string; value?: unknown; expectedVersion?: number | null }[]): { success: boolean; committed: number }
    append(key: string, chunk: unknown, options?: { maxItems?: number }): { ok: boolean; newLength: number; version: number }
  }
  filesystem: {
    readFile(path: string, encoding?: 'utf-8' | 'base64'): Promise<string | Uint8Array>
    writeFile(path: string, data: string | Uint8Array, encoding?: 'utf-8' | 'base64'): Promise<void>
    exists(path: string): Promise<boolean>
    unlink(path: string): Promise<void>
    readdir(path: string): Promise<string[]>
    mkdir(path: string): Promise<void>
    stat(path: string): Promise<any>
    copy(src: string, dest: string): Promise<void>
    move(src: string, dest: string): Promise<void>
    extname(path: string): string
    join(...paths: string[]): string
    dirname(path: string): string
    basename(path: string, ext?: string): string
    getDataPath(...subPaths: string[]): string
  }
  http: MulbyHttp
  sharp: {
    execute(payload: {
      input?: string | ArrayBuffer | Uint8Array | object | any[]
      options?: object
      operations: Array<{ method: string; args: unknown[] }>
    }): Promise<unknown>
  }
  screen: {
    getAllDisplays(): Promise<any[]>
    getPrimaryDisplay(): Promise<any>
    getDisplayNearestPoint(point: { x: number; y: number }): Promise<any>
    getCursorScreenPoint(): Promise<{ x: number; y: number }>
    getSources(options?: any): Promise<any[]>
    getWindowBounds(sourceId: string): Promise<any>
    capture(options?: any): Promise<Uint8Array>
    captureRegion(region: { x: number; y: number; width: number; height: number }, options?: any): Promise<Uint8Array>
    getMediaStreamConstraints(options: any): Promise<any>
  }
  shell: {
    openPath(path: string): Promise<string>
    openExternal(url: string): Promise<void>
    showItemInFolder(path: string): void
    openFolder(path: string): Promise<string>
    trashItem(path: string): Promise<void>
    beep(): void
    runCommand(input: RunCommandInput): Promise<RunCommandResult>
    getRunCommandPolicy(): Promise<Pick<CommandRunnerSettings, 'enabled' | 'requireConsent' | 'allowShell' | 'allowList' | 'denyList'>>
    listRunCommandAudit(limit?: number): Promise<CommandAuditItem[]>
  }
  directoryAccess: MulbyDirectoryAccess
  dialog: MulbyDialog
  system: {
    getSystemInfo(): Promise<any>
    getAppInfo(): Promise<any>
    getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'): Promise<string>
    getEnv(name: string): Promise<string>
    getIdleTime(): Promise<number>
    isMacOS(): boolean
    isWindows(): boolean
    isLinux(): boolean
    onActiveWindowChange(callback: (info: { app: string; title: string; pid?: number; bundleId?: string }) => void): () => void
    getCachedActiveWindow(): ActiveWindowInfo | null
    getActiveWindow(): Promise<ActiveWindowInfo | null>
  }
  shortcut: {
    register(accelerator: string, callback: () => void): boolean
    unregister(accelerator: string): void
    unregisterAll(): void
    isRegistered(accelerator: string): boolean
  }
  security: {
    isEncryptionAvailable(): boolean
    encryptString(plainText: string): Uint8Array
    decryptString(encrypted: Uint8Array | ArrayBuffer): string
  }
  media: {
    getAccessStatus(mediaType: 'microphone' | 'camera'): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
    askForAccess(mediaType: 'microphone' | 'camera'): Promise<boolean>
    hasCameraAccess(): Promise<boolean>
    hasMicrophoneAccess(): Promise<boolean>
  }
  power: {
    getSystemIdleTime(): number
    getSystemIdleState(idleThreshold: number): 'active' | 'idle' | 'locked' | 'unknown'
    isOnBatteryPower(): boolean
    getCurrentThermalState(): 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical'
  }
  tray: {
    create(options: { icon: string; tooltip?: string; title?: string }): boolean
    destroy(): void
    setIcon(icon: string): void
    setTooltip(tooltip: string): void
    setTitle(title: string): void
    exists(): boolean
  }
  network: {
    isOnline(): boolean
  }
  input: {
    hideMainWindowPasteText(text: string): Promise<boolean>
    hideMainWindowPasteImage(image: string | Uint8Array | ArrayBuffer): Promise<boolean>
    hideMainWindowPasteFile(filePaths: string | string[]): Promise<boolean>
    hideMainWindowTypeString(text: string): Promise<boolean>
    restoreWindows(): Promise<boolean>
    simulateKeyboardTap(key: string, ...modifiers: string[]): Promise<boolean>
    simulateMouseMove(x: number, y: number): Promise<boolean>
    simulateMouseClick(x: number, y: number): Promise<boolean>
    simulateMouseDoubleClick(x: number, y: number): Promise<boolean>
    simulateMouseRightClick(x: number, y: number): Promise<boolean>
  }
  inputMonitor: {
    isAvailable(): boolean
    requireAccessibility(): Promise<boolean>
    start(options?: { mouse?: boolean; keyboard?: boolean; throttleMs?: number }, callback?: (event: GlobalInputEvent) => void): Promise<string | null>
    stop(sessionId: string): void
    onEvent(sessionId: string, callback: (event: GlobalInputEvent) => void): void
  }
  permission: {
    getStatus(type: BackendPermissionType): any
    request(type: BackendPermissionType): Promise<any>
    canRequest(type: BackendPermissionType): any
    openSystemSettings(type: BackendPermissionType): Promise<any>
    isAccessibilityTrusted(): boolean
  }
  features: {
    getFeatures(codes?: string[]): Array<{ code: string }>
    setFeature(feature: {
      code: string
      explain?: string
      icon?: string
      platform?: string | string[]
      mode?: 'ui' | 'silent' | 'detached'
      route?: string
      mainHide?: boolean
      mainPush?: boolean
      cmds: Array<
        | string
        | { type: 'keyword'; value: string; explain?: string }
        | { type: 'regex'; match: string; explain?: string; label?: string; minLength?: number; maxLength?: number }
        | { type: 'files'; exts?: string[]; fileType?: 'file' | 'directory' | 'any'; match?: string; minLength?: number; maxLength?: number }
        | { type: 'img'; exts?: string[] }
        | { type: 'over'; label?: string; exclude?: string; minLength?: number; maxLength?: number }
        | { type: 'window'; app?: string; title?: string; bundleId?: string; label?: string }
      >
    }): void
    removeFeature(code: string): boolean
    redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): void
    redirectAiModelsSetting(): void
    onMainPush(callback: (action: { code: string; type: string; payload: string }) => MainPushItem[] | Promise<MainPushItem[]>): void
    onMainPushSelect(callback: (action: { code: string; type: string; payload: string; option: MainPushItem }) => boolean | Promise<boolean>): void
  }
  messaging: BackendMessaging
  ai: BackendMulbyAi
  scheduler: BackendScheduler
  tools: {
    register(name: string, handler: (args: unknown) => unknown | Promise<unknown>): void
    unregister(name: string): void
  }
}

type Asyncify<T> = {
  [K in keyof T]:
    T[K] extends (...args: infer Args) => infer Result
      ? (...args: Args) => Promise<Awaited<Result>>
      : T[K] extends object
        ? Asyncify<T[K]>
        : T[K]
}

type BackendPluginAPI = Asyncify<BackendPluginAPIDirect>

interface BackendPluginContext {
  api: BackendPluginAPI
  featureCode?: string
  input?: string
  attachments?: Attachment[]
}

interface MulbySharpProxy {
  resize(width?: number, height?: number, options?: object): MulbySharpProxy
  extend(options: object): MulbySharpProxy
  extract(options: { left: number; top: number; width: number; height: number }): MulbySharpProxy
  trim(options?: object): MulbySharpProxy
  rotate(angle?: number, options?: object): MulbySharpProxy
  flip(): MulbySharpProxy
  flop(): MulbySharpProxy
  affine(matrix: number[][], options?: object): MulbySharpProxy
  median(size?: number): MulbySharpProxy
  blur(sigma?: number): MulbySharpProxy
  sharpen(options?: object): MulbySharpProxy
  flatten(options?: object): MulbySharpProxy
  gamma(gamma?: number): MulbySharpProxy
  negate(options?: object): MulbySharpProxy
  normalise(options?: object): MulbySharpProxy
  normalize(options?: object): MulbySharpProxy
  clahe(options: object): MulbySharpProxy
  convolve(options: object): MulbySharpProxy
  threshold(threshold?: number, options?: object): MulbySharpProxy
  linear(a?: number | number[], b?: number | number[]): MulbySharpProxy
  recomb(inputMatrix: number[][]): MulbySharpProxy
  modulate(options?: object): MulbySharpProxy
  tint(color: string | object): MulbySharpProxy
  greyscale(greyscale?: boolean): MulbySharpProxy
  grayscale(grayscale?: boolean): MulbySharpProxy
  pipelineColorspace(colorspace: string): MulbySharpProxy
  toColorspace(colorspace: string): MulbySharpProxy
  removeAlpha(): MulbySharpProxy
  ensureAlpha(alpha?: number): MulbySharpProxy
  extractChannel(channel: number | 'red' | 'green' | 'blue' | 'alpha'): MulbySharpProxy
  joinChannel(images: string | ArrayBuffer | Uint8Array | Array<string | ArrayBuffer | Uint8Array>, options?: object): MulbySharpProxy
  bandbool(boolOp: 'and' | 'or' | 'eor'): MulbySharpProxy
  composite(images: object[]): MulbySharpProxy
  png(options?: object): MulbySharpProxy
  jpeg(options?: object): MulbySharpProxy
  webp(options?: object): MulbySharpProxy
  gif(options?: object): MulbySharpProxy
  tiff(options?: object): MulbySharpProxy
  avif(options?: object): MulbySharpProxy
  heif(options?: object): MulbySharpProxy
  raw(options?: object): MulbySharpProxy
  withMetadata(options?: object): MulbySharpProxy
  keepExif(): MulbySharpProxy
  withExif(exif: object): MulbySharpProxy
  keepIccProfile(): MulbySharpProxy
  withIccProfile(icc: string, options?: object): MulbySharpProxy
  timeout(options: { seconds: number }): MulbySharpProxy
  tile(options?: object): MulbySharpProxy
  clone(): MulbySharpProxy
  toBuffer(options?: object): Promise<ArrayBuffer>
  toFile(fileOut: string): Promise<{ format: string; width: number; height: number; channels: number; size: number }>
  metadata(): Promise<{ format?: string; width?: number; height?: number; channels?: number; space?: string; depth?: string; density?: number; hasAlpha?: boolean; orientation?: number }>
  stats(): Promise<object>
}

type MulbySharpFunction = (
  input?: string | ArrayBuffer | Uint8Array | object | any[],
  options?: object
) => MulbySharpProxy

interface Window {
  mulby: MulbyAPI
}
