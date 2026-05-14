type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

interface InputAttachment {
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
  input: string
  mode?: string
  route?: string
  params?: Record<string, string>
  windowType?: string
  attachments?: InputAttachment[]
  capabilities?: Record<string, unknown>
}

interface DynamicFeatureInput {
  code: string
  explain?: string
  icon?: string
  platform?: string | string[]
  mode?: 'ui' | 'silent' | 'detached'
  route?: string
  mainHide?: boolean
  mainPush?: boolean
  cmds: Array<string | Record<string, unknown>>
}

interface MainPushAction {
  code: string
  type: string
  payload: string
}

interface MainPushItem {
  icon?: string
  title: string
  text: string
  [key: string]: unknown
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
  bounds?: { x: number; y: number; width: number; height: number }
}

interface TaskLike {
  id: string
  pluginId?: string
  name: string
  type: 'once' | 'repeat' | 'delay'
  status: string
  callback: string
  nextRunTime?: number
  executionCount?: number
  createdAt?: number
  updatedAt?: number
  payload?: unknown
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

interface BackendPluginContext {
  api: BackendMulbyAPI
  featureCode?: string
  input?: string
  attachments?: InputAttachment[]
}

interface BackendMulbyAPI {
  ai: AnyRecord
  clipboard: AnyRecord
  clipboardHistory: AnyRecord
  dialog: AnyRecord
  features: {
    getFeatures(codes?: string[]): Promise<DynamicFeatureInput[]>
    setFeature(feature: DynamicFeatureInput): Promise<void>
    removeFeature(code: string): Promise<boolean>
    onMainPush(callback: (action: MainPushAction) => MainPushItem[] | Promise<MainPushItem[]>): Promise<unknown>
    onMainPushSelect(callback: (action: MainPushAction & { option: MainPushItem }) => boolean | Promise<boolean>): Promise<unknown>
    redirectHotKeySetting(cmdLabel: string, autocopy?: boolean): Promise<void>
    redirectAiModelsSetting(): Promise<void>
  }
  filesystem: AnyRecord
  http: AnyRecord
  host: AnyRecord
  input: AnyRecord
  inputMonitor: AnyRecord
  media: AnyRecord
  messaging: AnyRecord
  network: AnyRecord
  notification: { show(message: string, type?: string): Promise<void> | void }
  permission: AnyRecord
  plugin: AnyRecord
  power: AnyRecord
  scheduler: AnyRecord
  screen: AnyRecord
  security: AnyRecord
  shell: AnyRecord
  storage: AnyRecord
  system: AnyRecord
  theme: AnyRecord
  tools: {
    register(name: string, handler: (args: AnyRecord, ctx?: { sendProgress?(progress: { progress: number; total?: number; message?: string }): void }) => unknown | Promise<unknown>): void
    unregister(name: string): void
  }
  tray: AnyRecord
}

interface RendererMulbyAPI {
  ai: AnyRecord
  app: AnyRecord
  clipboard: AnyRecord
  clipboardHistory: AnyRecord
  desktop: AnyRecord
  developer: AnyRecord
  dialog: AnyRecord
  filesystem: AnyRecord
  ffmpeg: AnyRecord
  geolocation: AnyRecord
  host: {
    call(pluginName: string, method: string, ...args: unknown[]): Promise<{ data: unknown }>
    invoke(pluginName: string, method: string, ...args: unknown[]): Promise<unknown>
    status(pluginName: string): Promise<{ ready: boolean; active: boolean }>
    restart(pluginName: string): Promise<boolean>
  }
  http: AnyRecord
  inbrowser: AnyRecord
  input: AnyRecord
  inputMonitor: AnyRecord
  log: AnyRecord
  media: AnyRecord
  menu: AnyRecord
  network: AnyRecord
  notification: { show(message: string, type?: string): void | Promise<void> }
  openclaw?: AnyRecord
  permission: AnyRecord
  plugin: AnyRecord
  pluginStore: AnyRecord
  power: AnyRecord
  scheduler: AnyRecord
  screen: AnyRecord
  security: AnyRecord
  settings: AnyRecord
  shell: AnyRecord
  shortcut: AnyRecord
  storage: AnyRecord
  superPanel: AnyRecord
  system: AnyRecord
  systemPage: AnyRecord
  systemPlugin: AnyRecord
  theme: AnyRecord
  tray: AnyRecord
  trayMenu: AnyRecord
  tts: AnyRecord
  window: AnyRecord
  sharp: (...args: any[]) => AnyRecord
  getSharpVersion?: () => Promise<unknown>
  onPluginInit(callback: (data: PluginInitData) => void): () => void
  onPluginAttach?(callback: (data: AnyRecord) => void): () => void
  onPluginDetached?(callback: () => void): () => void
  onPluginLaunchStart?(callback: (data: AnyRecord) => void): () => void
  onPluginLaunchEnd?(callback: (data: AnyRecord) => void): () => void
  onThemeChange?(callback: (theme: 'light' | 'dark') => void): () => void
}

type AnyRecord = Record<string, any>

declare const mulby: BackendMulbyAPI

interface Window {
  mulby: RendererMulbyAPI
}
