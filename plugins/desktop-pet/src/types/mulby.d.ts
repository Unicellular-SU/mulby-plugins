// Mulby API 类型定义

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
  getFormat(): Promise<'text' | 'image' | 'files' | 'empty'>
}

interface ClipboardHistoryItem {
  id: string
  type: 'text' | 'image' | 'files'
  content: string
  plainText?: string
  files?: string[]
  timestamp: number
  size: number
  favorite: boolean
  tags?: string[]
}

interface ClipboardHistoryStats {
  total: number
  text: number
  image: number
  files: number
  favorite: number
}

interface MulbyClipboardHistory {
  query(options?: {
    type?: 'text' | 'image' | 'files'
    search?: string
    favorite?: boolean
    limit?: number
    offset?: number
  }): Promise<ClipboardHistoryItem[]>
  get(id: string): Promise<ClipboardHistoryItem | null>
  copy(id: string): Promise<{ success: boolean; error?: string }>
  toggleFavorite(id: string): Promise<{ success: boolean }>
  delete(id: string): Promise<{ success: boolean }>
  clear(): Promise<{ success: boolean }>
  stats(): Promise<ClipboardHistoryStats>
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
  show(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void
}

interface BrowserWindowProxy {
  id: number
  show(): Promise<void>
  hide(): Promise<void>
  close(): Promise<void>
  focus(): Promise<void>
  setTitle(title: string): Promise<void>
  setSize(width: number, height: number): Promise<void>
  setPosition(x: number, y: number): Promise<void>
  setOpacity(opacity: number): Promise<void>
  postMessage(channel: string, ...args: unknown[]): Promise<void>
}

interface MulbyWindow {
  hide(isRestorePreWindow?: boolean): void
  show(): void
  setSize(width: number, height: number): void
  setPosition(x: number, y: number): void
  setExpendHeight(height: number): void
  center(): void
  focus(): void
  terminatePlugin(): void
  create(url: string, options?: {
    width?: number
    height?: number
    title?: string
    type?: 'default' | 'borderless' | 'fullscreen'
    titleBar?: boolean
    fullscreen?: boolean
    alwaysOnTop?: boolean
    resizable?: boolean
    x?: number
    y?: number
    minWidth?: number
    minHeight?: number
    maxWidth?: number
    maxHeight?: number
    opacity?: number
    transparent?: boolean
    focusable?: boolean
    skipTaskbar?: boolean
    ignoreMouseEvents?: boolean
    forwardMouseEvents?: boolean
    visibleOnAllWorkspaces?: boolean
    visibleOnFullScreen?: boolean
  }): Promise<BrowserWindowProxy | null>
  close(): void
  detach(): void
  setAlwaysOnTop(flag: boolean): void
  setOpacity(opacity: number): Promise<void>
  getOpacity(): Promise<number>
  getMode(): Promise<'attached' | 'detached'>
  getWindowType(): Promise<'main' | 'detach'>
  minimize(): void
  maximize(): void
  getState(): Promise<{ isMaximized: boolean; isAlwaysOnTop: boolean; opacity: number }>
  reload(): void
  sendToParent(channel: string, ...args: unknown[]): void
  onChildMessage(callback: (channel: string, ...args: unknown[]) => void): void
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean; matchCase?: boolean }): Promise<number>
  stopFindInPage(action?: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  startDrag(filePath: string | string[]): void
}

interface MulbySubInput {
  set(placeholder?: string, isFocus?: boolean): Promise<boolean>
  remove(): Promise<boolean>
  setValue(text: string): void
  focus(): void
  blur(): void
  select(): void
  onChange(callback: (data: { text: string }) => void): void
}

interface MulbyTheme {
  get(): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  set(mode: 'light' | 'dark' | 'system'): Promise<{ mode: 'light' | 'dark' | 'system'; actual: 'light' | 'dark' }>
  getActual(): Promise<'light' | 'dark'>
}

interface PluginInfo {
  id: string
  name: string
  displayName: string
  description?: string
  features: Array<{ code: string; explain?: string }>
  enabled: boolean
}

interface PluginSearchResult {
  pluginId: string
  pluginName: string
  displayName: string
  featureCode: string
  featureExplain?: string
  matchType: 'keyword' | 'regex' | 'prefix' | 'exact' | string
  icon?: string
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

interface MulbyPlugin {
  getAll(): Promise<PluginInfo[]>
  search(query: string): Promise<PluginSearchResult[]>
  run(name: string, featureCode: string, input?: string): Promise<{ success: boolean; hasUI?: boolean; error?: string }>
  install(filePath: string): Promise<{ success: boolean; pluginName?: string; error?: string }>
  enable(name: string): Promise<{ success: boolean; error?: string }>
  disable(name: string): Promise<{ success: boolean; error?: string }>
  uninstall(name: string): Promise<{ success: boolean; error?: string }>
  getReadme(name: string): Promise<string | null>
  redirect(label: string | [string, string], payload?: unknown): Promise<boolean | { candidates: { name: string; displayName: string }[] }>
  outPlugin(isKill?: boolean): Promise<boolean>
  listBackground(): Promise<BackgroundPluginInfo[]>
  startBackground(pluginId: string): Promise<{ success: boolean; error?: string }>
  stopBackground(pluginId: string): Promise<{ success: boolean }>
  getBackgroundInfo(pluginId: string): Promise<BackgroundPluginInfo>
  stopPlugin(pluginId: string): Promise<void>
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

interface CaptureSource {
  id: string
  name: string
  thumbnailDataUrl: string
  displayId?: string
  appIconDataUrl?: string
}

interface ColorPickResult {
  hex: string
  rgb: string
  r: number
  g: number
  b: number
}

interface MulbyScreen {
  getAllDisplays(): Promise<DisplayInfo[]>
  getPrimaryDisplay(): Promise<DisplayInfo>
  getDisplayNearestPoint(point: { x: number; y: number }): Promise<DisplayInfo>
  getDisplayMatching(rect: { x: number; y: number; width: number; height: number }): Promise<DisplayInfo>
  getCursorScreenPoint(): Promise<{ x: number; y: number }>
  getSources(options?: { types?: ('screen' | 'window')[]; thumbnailSize?: { width: number; height: number } }): Promise<CaptureSource[]>
  capture(options?: { sourceId?: string; format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  captureRegion(region: { x: number; y: number; width: number; height: number }, options?: { format?: 'png' | 'jpeg'; quality?: number }): Promise<ArrayBuffer>
  getMediaStreamConstraints(options: { sourceId: string; audio?: boolean; frameRate?: number }): Promise<object>
  screenCapture(): Promise<string | null>
  colorPick(): Promise<ColorPickResult | null>
}

interface MulbyShell {
  openPath(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): Promise<void>
  openFolder(path: string): Promise<string>
  trashItem(path: string): Promise<void>
  beep(): Promise<void>
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

interface MulbySystem {
  getSystemInfo(): Promise<SystemInfo>
  getAppInfo(): Promise<AppInfo>
  getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'): Promise<string>
  getEnv(name: string): Promise<string | undefined>
  getIdleTime(): Promise<number>
  getFileIcon(filePath: string): Promise<string>
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

interface MulbyShortcut {
  register(accelerator: string): Promise<boolean>
  unregister(accelerator: string): Promise<void>
  unregisterAll(): Promise<void>
  isRegistered(accelerator: string): Promise<boolean>
  onTriggered(callback: (accelerator: string) => void): void
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
  onSuspend(callback: () => void): void
  onResume(callback: () => void): void
  onAC(callback: () => void): void
  onBattery(callback: () => void): void
  onLockScreen(callback: () => void): void
  onUnlockScreen(callback: () => void): void
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
}

interface MulbyMenu {
  showContextMenu(items: {
    label: string
    type?: 'normal' | 'separator' | 'checkbox' | 'radio'
    checked?: boolean
    enabled?: boolean
    id?: string
    submenu?: any[]
  }[]): Promise<string | null>
}

interface MulbyGeolocation {
  getAccessStatus(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  requestAccess(): Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
  canGetPosition(): Promise<boolean>
  openSettings(): Promise<void>
  getCurrentPosition(): Promise<{
    latitude: number
    longitude: number
    accuracy: number
    altitude?: number | null
    altitudeAccuracy?: number | null
    heading?: number | null
    speed?: number | null
    timestamp: number
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
  set(key: string, value: unknown, namespace?: string): Promise<void>
  remove(key: string, namespace?: string): Promise<void>
}

interface MulbyMessaging {
  send(targetPluginId: string, type: string, payload: unknown): Promise<void>
  broadcast(type: string, payload: unknown): Promise<void>
  on(handler: (message: {
    id: string
    from: string
    to?: string
    type: string
    payload: unknown
    timestamp: number
  }) => void | Promise<void>): void
  off(handler?: (message: any) => void): void
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
  }): Promise<any>
  cancelTask(taskId: string): Promise<void>
  pauseTask(taskId: string): Promise<void>
  resumeTask(taskId: string): Promise<void>
  listTasks(filter?: { status?: string; type?: string; limit?: number; offset?: number }): Promise<any[]>
  getTaskCount(filter?: { status?: string; type?: string }): Promise<number>
  getTask(taskId: string): Promise<any>
  deleteTasks(taskIds: string[]): Promise<{ success: boolean; deletedCount: number }>
  cleanupTasks(olderThan?: number): Promise<{ success: boolean; deletedCount: number }>
  getExecutions(taskId: string, limit?: number): Promise<any[]>
  validateCron(expression: string): boolean
  getNextCronTime(expression: string, after?: Date): Date
  describeCron(expression: string): string
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

type AiSkillSource = 'manual' | 'local-dir' | 'zip' | 'json' | 'builtin' | 'system'
type AiSkillTrustLevel = 'untrusted' | 'reviewed' | 'trusted'

type AiMessage = {
  role: 'system' | 'user' | 'assistant'
  content?: string | AiMessageContent[]
  reasoning_content?: string
  chunkType?: 'meta' | 'text' | 'reasoning' | 'tool-call' | 'tool-result' | 'error' | 'end'
  capability_debug?: {
    requested: string[]
    allowed: string[]
    denied: string[]
    reasons: string[]
    selectedSkills?: Array<{ id: string; source: AiSkillSource; trustLevel: AiSkillTrustLevel }>
  }
  policy_debug?: {
    skills: {
      requested?: AiSkillSelection
      selectedSkillIds: string[]
      selectedSkillNames: string[]
      reasons: string[]
    }
    mcp: { requested?: AiMcpSelection; resolved?: AiMcpSelection }
    toolContext: { requested?: AiToolContext; resolved?: AiToolContext }
    capabilities: { requested: string[]; resolved: string[] }
    internalTools: { requested: string[]; resolved: string[] }
  }
  tool_call?: { id: string; name: string; args?: unknown }
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
  mode?: 'off' | 'manual' | 'auto'
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
  descriptor: {
    id: string
    name: string
    description?: string
    version?: string
    author?: string
    tags?: string[]
    triggerPhrases?: string[]
    mode?: 'manual' | 'auto' | 'both'
    promptTemplate?: string
    mcpPolicy?: AiSkillMcpPolicy
    capabilities?: string[]
    internalTools?: string[]
  }
}
type AiSkillSettings = {
  enabled: boolean
  activeSkillIds: string[]
  autoSelect?: { enabled?: boolean; maxSkillsPerCall?: number; minScore?: number }
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
  selectedSkills?: Array<{ id: string; source: AiSkillSource; trustLevel: AiSkillTrustLevel }>
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
  modePreference?: 'manual' | 'auto' | 'both'
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
  allModels(): Promise<AiModel[]>
  abort(requestId: string): Promise<void>
  skills: {
    list(): Promise<AiSkillRecord[]>
    refresh(): Promise<AiSkillRecord[]>
    listEnabled(): Promise<AiSkillRecord[]>
    get(skillId: string): Promise<AiSkillRecord | null>
    listCreateModels(): Promise<AiSkillCreateModelOption[]>
    createWithAi(input: AiSkillCreateWithAiInput): Promise<AiSkillCreateWithAiResult>
    createWithAiStream(
      input: AiSkillCreateWithAiInput,
      onChunk: (chunk: AiSkillCreateProgressChunk) => void
    ): AiPromiseLike<AiSkillCreateWithAiResult>
    create(input: {
      id?: string
      name: string
      description?: string
      promptTemplate?: string
      tags?: string[]
      triggerPhrases?: string[]
      mode?: 'manual' | 'auto' | 'both'
      capabilities?: string[]
      internalTools?: string[]
      enabled?: boolean
      trustLevel?: AiSkillTrustLevel
      mcpPolicy?: AiSkillMcpPolicy
    }): Promise<AiSkillRecord>
    install(input: { source: 'local-dir' | 'zip'; ref: string; trustLevel?: AiSkillTrustLevel; enabled?: boolean }): Promise<AiSkillRecord[]>
    importFromJson(input: { json: string; trustLevel?: AiSkillTrustLevel; enabled?: boolean }): Promise<AiSkillRecord[]>
    update(skillId: string, patch: Partial<AiSkillRecord>): Promise<AiSkillRecord>
    remove(skillId: string): Promise<void>
    enable(skillId: string): Promise<AiSkillRecord>
    disable(skillId: string): Promise<AiSkillRecord>
    preview(input: { option?: Partial<AiOption>; skillIds?: string[]; prompt?: string }): Promise<AiSkillPreview>
    resolve(option: AiOption): Promise<AiSkillResolveResult>
  }
  tokens: {
    estimate(input: { model?: string; messages: AiMessage[]; outputText?: string }): Promise<AiTokenBreakdown>
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
  mcp?: {
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
  call(pluginName: string, method: string, ...args: unknown[]): Promise<{ data: any }>
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

interface Attachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  feature?: string
  input: string
  mode?: string
  route?: string
  attachments?: Attachment[]
}

interface MulbyInputMonitor {
  isAvailable(): Promise<boolean>
  requireAccessibility(): Promise<void>
  start(options: { mouse?: boolean; keyboard?: boolean; throttleMs?: number }): Promise<string | null>
  stop(sessionId: string): void
  onEvent(callback: (event: any) => void): void
}

interface MulbyAPI {
  clipboard: MulbyClipboard
  clipboardHistory: MulbyClipboardHistory
  input: MulbyInput
  inputMonitor: MulbyInputMonitor
  notification: MulbyNotification
  window: MulbyWindow
  subInput: MulbySubInput
  plugin: MulbyPlugin
  theme?: MulbyTheme
  ai: MulbyAi
  screen: MulbyScreen
  shell: MulbyShell
  dialog: MulbyDialog
  system: MulbySystem
  permission: MulbyPermission
  shortcut: MulbyShortcut
  security: MulbySecurity
  media: MulbyMedia
  power: MulbyPower
  tray: MulbyTray
  network: MulbyNetwork
  menu: MulbyMenu
  geolocation: MulbyGeolocation
  tts: MulbyTTS
  storage: MulbyStorage
  http: MulbyHttp
  filesystem: MulbyFilesystem
  messaging: MulbyMessaging
  scheduler: MulbyScheduler
  host?: MulbyHost
  onPluginInit(callback: (data: PluginInitData) => void): void
  onPluginAttach?(callback: (data: { pluginName: string; displayName: string; featureCode: string; input: string; uiPath: string; preloadPath: string }) => void): void
  onPluginDetached?(callback: () => void): void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): void
  onWindowStateChange?(callback: (state: { isMaximized: boolean }) => void): void
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
  sharp: MulbySharpFunction
  getSharpVersion: () => Promise<{ sharp: Record<string, string>; format: Record<string, any> }>
  ffmpeg: MulbyFFmpeg
}

type BackendPermissionType = 'geolocation' | 'camera' | 'microphone' | 'notifications' | 'screen' | 'accessibility' | 'contacts' | 'calendar'

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
  allModels(): Promise<AiModel[]>
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

interface BackendPluginAPI {
  clipboard: {
    readText(): string
    writeText(text: string): Promise<void>
    readImage(): Uint8Array | null
    writeImage(buffer: Uint8Array): void
    readFiles(): Array<{ path: string; name: string; size: number; isDirectory: boolean }>
    getFormat(): 'text' | 'image' | 'files' | 'empty'
  }
  clipboardHistory: MulbyClipboardHistory
  notification: MulbyNotification
  storage: {
    get(key: string): unknown
    set(key: string, value: unknown): unknown
    remove(key: string): unknown
    clear(): unknown
    keys(): string[]
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
  }
  http: MulbyHttp
  screen: {
    getAllDisplays(): Promise<any[]>
    getPrimaryDisplay(): Promise<any>
    getDisplayNearestPoint(point: { x: number; y: number }): Promise<any>
    getCursorScreenPoint(): Promise<{ x: number; y: number }>
    getSources(options?: any): Promise<any[]>
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
    runCommand(input: {
      command: string
      args?: string[]
      cwd?: string
      env?: Record<string, string>
      timeoutMs?: number
      shell?: boolean
    }): Promise<any>
    getRunCommandPolicy(): Promise<{
      enabled: boolean
      requireConsent: boolean
      allowShell: boolean
      allowList?: string[]
      denyList?: string[]
    }>
    listRunCommandAudit(limit?: number): Promise<any[]>
  }
  dialog: MulbyDialog
  system: {
    getSystemInfo(): Promise<any>
    getAppInfo(): Promise<any>
    getPath(name: 'home' | 'appData' | 'userData' | 'temp' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'): Promise<string>
    getEnv(name: string): Promise<string>
    getIdleTime(): Promise<number>
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
  input: Record<string, (...args: any[]) => any>
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
      >
    }): void
    removeFeature(code: string): boolean
    redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): void
    redirectAiModelsSetting(): void
  }
  messaging: MulbyMessaging
  ai: BackendMulbyAi
  scheduler: BackendScheduler
}

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
  blur(sigma?: number): MulbySharpProxy
  sharpen(options?: object): MulbySharpProxy
  flatten(options?: object): MulbySharpProxy
  gamma(gamma?: number): MulbySharpProxy
  negate(options?: object): MulbySharpProxy
  normalize(options?: object): MulbySharpProxy
  threshold(threshold?: number, options?: object): MulbySharpProxy
  modulate(options?: object): MulbySharpProxy
  tint(color: string | object): MulbySharpProxy
  greyscale(greyscale?: boolean): MulbySharpProxy
  grayscale(grayscale?: boolean): MulbySharpProxy
  composite(images: object[]): MulbySharpProxy
  png(options?: object): MulbySharpProxy
  jpeg(options?: object): MulbySharpProxy
  webp(options?: object): MulbySharpProxy
  gif(options?: object): MulbySharpProxy
  tiff(options?: object): MulbySharpProxy
  avif(options?: object): MulbySharpProxy
  withMetadata(options?: object): MulbySharpProxy
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
