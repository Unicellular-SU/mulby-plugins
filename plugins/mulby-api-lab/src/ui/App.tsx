import { useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  Activity,
  AppWindow,
  Bell,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Code2,
  Compass,
  Copy,
  Database,
  Eraser,
  Eye,
  FileText,
  FolderOpen,
  Gauge,
  Globe2,
  HardDrive,
  ImageIcon,
  Keyboard,
  Layers,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  MessageSquare,
  Monitor,
  MousePointerClick,
  Network,
  Package,
  PanelTop,
  Play,
  PlugZap,
  Power,
  Radio,
  RefreshCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Volume2,
  Wand2,
  Wifi,
  Wrench,
  XCircle,
  type LucideIcon
} from 'lucide-react'
import { apiGroups, apiRegistry, type ApiMethodSpec, type ApiModuleSpec, type ApiRisk } from './apiRegistry'

const PLUGIN_ID = 'mulby-api-lab'

type RunStatus = 'idle' | 'running' | 'success' | 'error'

interface RunRecord {
  status: RunStatus
  title: string
  message?: string
  raw?: unknown
  error?: string
  updatedAt?: number
}

interface Metric {
  label: string
  value: string | number | boolean | null | undefined
}

interface CapabilityProps {
  title: string
  icon: LucideIcon
  description: string
  children: React.ReactNode
}

type ChildWindowHandleLike = {
  id: number
  show: () => Promise<void>
  hide: () => Promise<void>
  focus: () => Promise<void>
  close: () => Promise<void>
  destroy?: () => Promise<void>
  setTitle: (title: string) => Promise<void>
  setSize: (width: number, height: number) => Promise<void>
  setPosition?: (x: number, y: number) => Promise<void>
  setBounds?: (bounds: { x?: number; y?: number; width?: number; height?: number }) => Promise<boolean>
  getBounds?: () => Promise<{ x: number; y: number; width: number; height: number }>
  setOpacity?: (opacity: number) => Promise<void>
  setBackgroundThrottling?: (allowed: boolean) => Promise<boolean>
  setIgnoreMouseEvents?: (ignore: boolean, options?: { forward?: boolean }) => Promise<void>
  setAlwaysOnTop?: (flag: boolean, level?: string) => Promise<void>
  setVisibleOnAllWorkspaces?: (flag: boolean, options?: { visibleOnFullScreen?: boolean }) => Promise<void>
  setFullScreen?: (flag: boolean) => Promise<void>
  postMessage: (channel: string, ...args: unknown[]) => Promise<void>
}

function mulby() {
  return window.mulby
}

function hasMulby() {
  return typeof window !== 'undefined' && Boolean(window.mulby)
}

async function hostCall(method: string, ...args: unknown[]) {
  const result = await mulby().host.call(PLUGIN_ID, method, ...args)
  return result?.data ?? result
}

function stringify(value: unknown) {
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function clampText(text: string, max = 2600) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n... truncated ${text.length - max} chars`
}

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === 'object' ? value as AnyRecord : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textOf(value: unknown, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return clampText(stringify(value), 220)
}

function bytesToHuman(value: unknown) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let index = 0
  let current = size
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index += 1
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function buildDataUrl(input: unknown, mime = 'image/png') {
  if (typeof input === 'string' && input.startsWith('data:')) return input
  const candidate = input as { data?: number[] }
  let bytes: Uint8Array | null = null
  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input)
  } else if (ArrayBuffer.isView(input as ArrayBufferView)) {
    const view = input as Uint8Array
    bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  } else if (Array.isArray(candidate.data)) {
    bytes = new Uint8Array(candidate.data)
  }
  if (!bytes) return ''
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${window.btoa(binary)}`
}

function readLaunchRoute(data: PluginInitData): string {
  const route = data.route || ''
  const featureCode = data.featureCode || ''
  if (route.includes('search')) return 'plugin'
  if (route.includes('attachments')) return 'manifest'
  if (route.includes('input')) return 'input'
  if (route.includes('screen')) return 'screen'
  if (route.includes('window')) return 'window'
  if (route.includes('child-window')) return 'window'
  if (route.includes('storage')) return 'storage'
  if (featureCode === 'lab-mainpush') return 'features'
  return 'system'
}

const moduleIcons: Record<string, LucideIcon> = {
  ai: Bot,
  'app-events': Activity,
  clipboard: Clipboard,
  'clipboard-history': Layers,
  desktop: Compass,
  developer: Wrench,
  dialog: MessageSquare,
  features: PlugZap,
  ffmpeg: Gauge,
  filesystem: FolderOpen,
  geolocation: Compass,
  host: Code2,
  http: Globe2,
  inbrowser: Globe2,
  input: Keyboard,
  'input-monitor': Radio,
  log: FileText,
  manifest: FileText,
  media: Volume2,
  menu: MousePointerClick,
  messaging: MessageSquare,
  network: Wifi,
  notification: Bell,
  permission: ShieldCheck,
  plugin: Package,
  'plugin-store': Package,
  power: Power,
  scheduler: CalendarClock,
  screen: Monitor,
  security: LockKeyhole,
  settings: Settings,
  sharp: ImageIcon,
  shell: Terminal,
  shortcut: Keyboard,
  storage: Database,
  'super-panel': PanelTop,
  system: HardDrive,
  'system-page': AppWindow,
  'system-plugin': AppWindow,
  theme: Sparkles,
  tray: PanelTop,
  'tray-menu': PanelTop,
  tts: Volume2,
  window: AppWindow
}

const riskLabels: Record<ApiRisk, string> = {
  safe: '可直接运行',
  permission: '权限相关',
  'writes-lab-data': '写入示例数据',
  confirm: '需确认',
  destructive: '破坏性',
  'long-running': '长任务',
  'docs-only': '说明模式'
}

function riskClass(risk: ApiRisk) {
  return `risk risk-${risk}`
}

function SafetyBadge({ risk }: { risk: ApiRisk }) {
  return <span className={riskClass(risk)}>{riskLabels[risk]}</span>
}

function RawOutputDrawer({ value, title = '原始输出' }: { value: unknown; title?: string }) {
  return (
    <details className="raw-output">
      <summary>
        <Code2 size={15} />
        <span>{title}</span>
      </summary>
      <pre>{clampText(stringify(value))}</pre>
    </details>
  )
}

function MetricGrid({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="metric-grid">
      {metrics.map((metric) => (
        <div className="metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{textOf(metric.value)}</strong>
        </div>
      ))}
    </div>
  )
}

function CapabilitySection({ title, icon: Icon, description, children }: CapabilityProps) {
  return (
    <section className="capability-section">
      <div className="section-head">
        <span className="section-icon"><Icon size={18} /></span>
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function RunResult({ record }: { record: RunRecord }) {
  if (record.status === 'idle') return null
  if (record.status === 'running') {
    return (
      <div className="run-result loading-result">
        <RefreshCcw size={17} />
        <span>运行中</span>
      </div>
    )
  }
  if (record.status === 'error') {
    return (
      <div className="run-result error-result">
        <XCircle size={17} />
        <div>
          <strong>{record.title}</strong>
          <p>{record.error}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="run-result success-result">
      <CheckCircle2 size={17} />
      <div>
        <strong>{record.title}</strong>
        {record.message ? <p>{record.message}</p> : null}
        <RawOutputDrawer value={record.raw} />
      </div>
    </div>
  )
}

function StructuredPreview({ value }: { value: unknown }) {
  const data = asRecord(value)
  const entries = Object.entries(data)
  if (!entries.length) return null

  const scalarEntries = entries
    .filter(([, item]) => item === null || ['string', 'number', 'boolean'].includes(typeof item))
    .slice(0, 6)
  const arrayEntries = entries
    .filter(([, item]) => Array.isArray(item))
    .slice(0, 3)
  const objectEntries = entries
    .filter(([, item]) => item && typeof item === 'object' && !Array.isArray(item))
    .slice(0, 4)

  return (
    <div className="structured-preview">
      {scalarEntries.length ? (
        <MetricGrid metrics={scalarEntries.map(([label, item]) => ({ label, value: item as Metric['value'] }))} />
      ) : null}
      {arrayEntries.map(([label, item]) => (
        <div className="preview-block" key={label}>
          <strong>{label}</strong>
          <span>{asArray(item).length} 条</span>
          <div className="preview-list">
            {asArray(item).slice(0, 5).map((entry, index) => (
              <code key={`${label}-${index}`}>{textOf(entry)}</code>
            ))}
          </div>
        </div>
      ))}
      {objectEntries.map(([label, item]) => (
        <div className="preview-block" key={label}>
          <strong>{label}</strong>
          <div className="preview-list">
            {Object.entries(asRecord(item)).slice(0, 5).map(([key, entry]) => (
              <div className="preview-row" key={key}>
                <span>{key}</span>
                <code>{textOf(entry)}</code>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ApiMethodTable({ methods }: { methods: ApiMethodSpec[] }) {
  return (
    <section className="method-table-wrap">
      <div className="table-title">
        <ListChecks size={18} />
        <h3>API 覆盖表</h3>
        <span>{methods.length} methods</span>
      </div>
      <div className="method-table">
        <div className="method-row method-head">
          <span>方法</span>
          <span>端点</span>
          <span>风险</span>
          <span>演示策略</span>
          <span>说明</span>
        </div>
        {methods.map((item) => (
          <div className="method-row" key={item.name}>
            <code>{item.name}</code>
            <span>{item.endpoint}</span>
            <SafetyBadge risk={item.risk} />
            <span>{item.demoMode}</span>
            <p>{item.note}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActionButton({ children, icon: Icon, onClick, disabled, variant = 'ghost' }: {
  children: React.ReactNode
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost'
}) {
  return (
    <button className={variant === 'primary' ? 'primary-button' : 'ghost-button'} onClick={onClick} disabled={disabled}>
      <Icon size={16} />
      <span>{children}</span>
    </button>
  )
}

function GenericModuleDemo({ module }: { module: ApiModuleSpec }) {
  const [record, setRecord] = useState<RunRecord>({ status: 'idle', title: '' })

  const run = async () => {
    setRecord({ status: 'running', title: '读取中' })
    try {
      let raw: unknown = { module: module.id, note: '该模块以覆盖表和安全说明为主。' }
      if (!hasMulby()) {
        raw = { module: module.id, preview: true }
      } else if (module.id === 'power') {
        raw = {
          idleTime: await mulby().power.getSystemIdleTime(),
          idleState: await mulby().power.getSystemIdleState(60),
          battery: await mulby().power.isOnBatteryPower(),
          thermal: await mulby().power.getCurrentThermalState()
        }
      } else if (module.id === 'permission') {
        raw = await hostCall('getPermissionSnapshot')
      } else if (module.id === 'theme') {
        raw = await mulby().theme.get()
      } else if (module.id === 'network') {
        raw = { online: await mulby().network.isOnline() }
      } else if (module.id === 'media') {
        raw = {
          camera: await mulby().media.getAccessStatus('camera'),
          microphone: await mulby().media.getAccessStatus('microphone'),
          hasCamera: await mulby().media.hasCameraAccess(),
          hasMicrophone: await mulby().media.hasMicrophoneAccess()
        }
      } else if (module.id === 'plugin') {
        raw = {
          plugins: await mulby().plugin.getAll(),
          recent: await mulby().plugin.getRecentUsed?.(8),
          background: await mulby().plugin.listBackground?.()
        }
      } else if (module.id === 'plugin-store') {
        raw = await mulby().pluginStore.checkUpdatesInstalled()
      } else if (module.id === 'tray-menu') {
        raw = await mulby().trayMenu.getState()
      } else if (module.id === 'tray') {
        raw = { exists: await mulby().tray.exists() }
      } else if (module.id === 'super-panel') {
        raw = await mulby().superPanel.getState()
      } else if (module.id === 'settings') {
        raw = {
          settings: await mulby().settings.get(),
          updateCenter: await mulby().settings.getUpdateCenterState()
        }
      } else if (module.id === 'log') {
        raw = {
          dir: await mulby().log.getLogsDir(),
          logs: await mulby().log.getLogs({ pluginId: PLUGIN_ID, limit: 8 })
        }
      } else if (module.id === 'ai') {
        raw = {
          toolStatus: await hostCall('getAiToolStatus'),
          models: await mulby().ai.allModels()
        }
      } else if (module.id === 'host') {
        raw = await mulby().host.status(PLUGIN_ID)
      } else if (module.id === 'features') {
        raw = await hostCall('getDynamicFeatures')
      } else if (module.id === 'scheduler') {
        raw = await hostCall('listOwnTasks')
      } else if (module.id === 'messaging') {
        raw = await hostCall('sendLoopbackMessage', { source: 'module-page' })
      } else if (module.id === 'desktop') {
        raw = {
          apps: await mulby().desktop.searchApps('code', 5),
          files: await mulby().desktop.searchFiles('README', 5)
        }
      } else if (module.id === 'screen') {
        raw = await hostCall('getScreenSnapshot')
      } else if (module.id === 'ffmpeg') {
        raw = {
          available: await mulby().ffmpeg.isAvailable(),
          version: await mulby().ffmpeg.getVersion(),
          path: await mulby().ffmpeg.getPath()
        }
      } else if (module.id === 'sharp') {
        const image = await mulby().sharp({
          create: { width: 96, height: 60, channels: 4, background: { r: 15, g: 118, b: 110, alpha: 1 } }
        }).png().toBuffer()
        raw = {
          imageUrl: buildDataUrl(image),
          metadata: await mulby().sharp(image).metadata(),
          stats: await mulby().sharp(image).stats(),
          version: await mulby().getSharpVersion?.()
        }
      } else if (module.id === 'filesystem') {
        raw = await hostCall('prepareSampleFile')
      } else if (module.id === 'storage') {
        raw = await hostCall('saveStorageNote', { note: 'API Lab module page note' })
      } else if (module.id === 'shell') {
        raw = {
          policy: await mulby().shell.getRunCommandPolicy(),
          command: await hostCall('runSafeCommand')
        }
      } else if (module.id === 'clipboard') {
        raw = {
          format: await mulby().clipboard.getFormat(),
          text: await mulby().clipboard.readText().catch(() => ''),
          files: await mulby().clipboard.readFiles().catch(() => [])
        }
      } else if (module.id === 'clipboard-history') {
        raw = await mulby().clipboardHistory.query({ limit: 8 })
      } else if (module.id === 'system-page') {
        raw = await mulby().systemPage.getState()
      } else if (module.id === 'system-plugin') {
        raw = { active: await mulby().systemPlugin.getActive() }
      } else if (module.id === 'security') {
        const available = await mulby().security.isEncryptionAvailable()
        const encrypted = await mulby().security.encryptString('mulby-api-lab')
        raw = { available, encryptedBytes: encrypted?.byteLength ?? encrypted?.length, decrypted: await mulby().security.decryptString(encrypted) }
      } else if (module.id === 'shortcut') {
        raw = { registered: await mulby().shortcut.isRegistered('CommandOrControl+Shift+Y') }
      } else if (module.id === 'input-monitor') {
        raw = {
          available: await mulby().inputMonitor.isAvailable(),
          accessibility: await mulby().inputMonitor.requireAccessibility?.()
        }
      } else if (module.id === 'http') {
        const response = await mulby().http.get('https://example.com')
        raw = { ...response, data: clampText(response.data || '', 500) }
      } else if (module.id === 'geolocation') {
        raw = {
          access: await mulby().geolocation.getAccessStatus(),
          canGetPosition: await mulby().geolocation.canGetPosition()
        }
      } else if (module.id === 'notification') {
        await mulby().notification.show('API Lab notification sample', 'success')
        raw = { sent: true }
      } else if (module.id === 'tts') {
        raw = {
          voices: mulby().tts.getVoices(),
          speaking: mulby().tts.isSpeaking()
        }
      } else if (module.id === 'menu') {
        raw = await mulby().menu.showContextMenu([{ label: 'API Lab', id: 'api-lab' }, { label: module.title, id: module.id }])
      } else if (module.id === 'dialog') {
        raw = await mulby().dialog.showMessageBox({ type: 'info', message: 'Mulby API Lab dialog sample', buttons: ['OK'] })
      } else if (module.id === 'manifest') {
        raw = await hostCall('getManifestContract')
      }
      setRecord({
        status: 'success',
        title: `${module.title} 快照已更新`,
        message: '结果已写入本模块的原始输出区域。',
        raw,
        updatedAt: Date.now()
      })
    } catch (error) {
      setRecord({ status: 'error', title: `${module.title} 运行失败`, error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  return (
    <CapabilitySection
      title="模块功能快照"
      icon={moduleIcons[module.id] || ListChecks}
      description="运行本模块的安全示例，页面下方会保留原始输出和方法覆盖表。"
    >
      <div className="action-row">
        <ActionButton icon={Play} variant="primary" onClick={run} disabled={record.status === 'running'}>
          运行模块示例
        </ActionButton>
      </div>
      <RunResult record={record} />
      {record.status === 'success' ? <StructuredPreview value={record.raw} /> : null}
      {module.id === 'sharp' && asRecord(record.raw).imageUrl ? (
        <div className="image-preview">
          <img src={String(asRecord(record.raw).imageUrl)} alt="Sharp preview" />
        </div>
      ) : null}
    </CapabilitySection>
  )
}

function SystemModuleDemo() {
  const [record, setRecord] = useState<RunRecord>({ status: 'idle', title: '' })
  const [report, setReport] = useState<AnyRecord | null>(null)

  const run = async () => {
    setRecord({ status: 'running', title: '读取系统信息' })
    try {
      const raw = hasMulby() ? await hostCall('getEnvironmentReport') : { preview: true }
      setReport(asRecord(raw))
      setRecord({ status: 'success', title: '系统信息已读取', raw, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '系统信息读取失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  const appInfo = asRecord(report?.appInfo)
  const systemInfo = asRecord(report?.systemInfo)
  const resource = asRecord(report?.resourceUsage)

  return (
    <>
      <CapabilitySection title="系统摘要" icon={HardDrive} description="展示当前宿主、系统、资源和路径状态。">
        <div className="action-row">
          <ActionButton icon={RefreshCcw} variant="primary" onClick={run} disabled={record.status === 'running'}>刷新系统信息</ActionButton>
        </div>
        {report ? (
          <>
            <MetricGrid metrics={[
              { label: '宿主版本', value: appInfo.version },
              { label: '平台', value: `${textOf(systemInfo.platform)} ${textOf(systemInfo.arch)}` },
              { label: 'CPU 核心', value: systemInfo.cpus },
              { label: '内存占用', value: bytesToHuman(resource.memoryBytes) },
              { label: '插件数量', value: report.pluginCount },
              { label: '动态指令', value: asArray(report.dynamicFeatures).length }
            ]} />
            <div className="info-list">
              {Object.entries(asRecord(report.paths)).map(([key, value]) => (
                <div className="info-row" key={key}>
                  <span>{key}</span>
                  <code>{textOf(value)}</code>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <RunResult record={record} />
      </CapabilitySection>
    </>
  )
}

function WindowModuleDemo() {
  const [record, setRecord] = useState<RunRecord>({ status: 'idle', title: '' })
  const [child, setChild] = useState<ChildWindowHandleLike | null>(null)
  const [childTitle, setChildTitle] = useState('API Lab Child Window')
  const [findText, setFindText] = useState('API')
  const [messages, setMessages] = useState<string[]>([])
  const [dragFile, setDragFile] = useState('')
  const isChildWindow = window.location.hash.includes('child-window')

  useEffect(() => {
    if (!hasMulby() || !mulby().window.onChildMessage) return undefined
    return mulby().window.onChildMessage((channel: string, ...args: unknown[]) => {
      const message = `[${new Date().toLocaleTimeString()}] ${channel}: ${clampText(stringify(args), 360)}`
      setMessages((prev) => [...prev.slice(-9), message])
    })
  }, [])

  const sendToParent = async () => {
    setRecord({ status: 'running', title: '发送父窗口消息' })
    try {
      await mulby().window.sendToParent('api-lab:child-ready', {
        title: document.title,
        href: window.location.href,
        at: Date.now()
      })
      setRecord({ status: 'success', title: '消息已发送给父窗口', raw: { channel: 'api-lab:child-ready', at: Date.now() }, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '发送父窗口消息失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  const inspect = async () => {
    setRecord({ status: 'running', title: '读取窗口状态' })
    try {
      const raw = hasMulby() ? {
        mode: await mulby().window.getMode(),
        type: await mulby().window.getWindowType(),
        bounds: await mulby().window.getBounds(),
        state: await mulby().window.getState(),
        opacity: await mulby().window.getOpacity?.()
      } : { preview: true }
      setRecord({ status: 'success', title: '窗口状态已读取', raw, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '读取窗口失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  const createChild = async () => {
    if (!window.confirm('创建一个 API Lab 子窗口？')) return
    setRecord({ status: 'running', title: '创建子窗口' })
    try {
      const handle = await mulby().window.create('child-window', {
        title: childTitle,
        width: 520,
        height: 420,
        loadMode: 'route',
        params: { source: 'api-lab', demo: 'child-window' }
      })
      setChild(handle)
      setRecord({ status: 'success', title: '子窗口已创建', message: `ChildWindowHandle id=${handle?.id}`, raw: { id: handle?.id }, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '创建子窗口失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  const childAction = async (label: string, action: (handle: ChildWindowHandleLike) => Promise<void>) => {
    if (!child) return
    setRecord({ status: 'running', title: label })
    try {
      await action(child)
      setRecord({ status: 'success', title: `${label} 已执行`, raw: { childId: child.id, action: label }, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: `${label} 失败`, error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  const find = async () => {
    try {
      const count = await mulby().window.findInPage(findText, { forward: true, findNext: false })
      setRecord({ status: 'success', title: '页面查找已执行', raw: { findText, count }, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '页面查找失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  const prepareDragFile = async () => {
    setRecord({ status: 'running', title: '生成拖拽文件' })
    try {
      const raw = await hostCall('prepareWindowDragFile')
      const filePath = String(asRecord(raw).filePath || '')
      setDragFile(filePath)
      setRecord({ status: 'success', title: '拖拽文件已生成', message: filePath, raw, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '生成拖拽文件失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  const startDrag = async (event?: DragEvent<HTMLDivElement>) => {
    event?.preventDefault()
    if (!dragFile) {
      await prepareDragFile()
      return
    }
    try {
      await mulby().window.startDrag(dragFile)
      setRecord({ status: 'success', title: '拖拽已交给宿主', raw: { filePath: dragFile }, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '启动拖拽失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  if (isChildWindow) {
    return (
      <>
        <CapabilitySection title="子窗口通信台" icon={Send} description="当前页面由 window.create 打开。这里演示子窗口向父窗口 sendToParent，父窗口通过 onChildMessage 接收。">
          <div className="action-row">
            <ActionButton icon={Send} variant="primary" onClick={sendToParent}>发送给父窗口</ActionButton>
            <ActionButton icon={Eye} onClick={inspect}>读取本窗口状态</ActionButton>
          </div>
          <RunResult record={record} />
          <div className="message-panel">
            <strong>收到的父窗口消息</strong>
            {messages.length ? messages.map((message, index) => <code key={`${message}-${index}`}>{message}</code>) : <p className="empty-text">等待父窗口 postMessage</p>}
          </div>
        </CapabilitySection>
      </>
    )
  }

  return (
    <>
      <CapabilitySection title="当前窗口控制" icon={AppWindow} description="读取当前窗口状态，演示页面查找和窗口基础控制。">
        <div className="form-row">
          <input value={findText} onChange={(event) => setFindText(event.target.value)} />
          <ActionButton icon={Search} onClick={find}>查找文本</ActionButton>
          <ActionButton icon={Eye} variant="primary" onClick={inspect}>读取窗口</ActionButton>
        </div>
        <RunResult record={record} />
      </CapabilitySection>
      <CapabilitySection title="子窗口实验区" icon={Layers} description="覆盖 window.create 和 ChildWindowHandle 的 show/hide/focus/title/size/message/close。">
        <div className="form-row">
          <input value={childTitle} onChange={(event) => setChildTitle(event.target.value)} />
          <ActionButton icon={AppWindow} variant="primary" onClick={createChild}>创建子窗口</ActionButton>
        </div>
        <div className="action-row">
          <ActionButton icon={Eye} disabled={!child} onClick={() => childAction('show', (handle) => handle.show())}>show</ActionButton>
          <ActionButton icon={Eye} disabled={!child} onClick={() => childAction('hide', (handle) => handle.hide())}>hide</ActionButton>
          <ActionButton icon={MousePointerClick} disabled={!child} onClick={() => childAction('focus', (handle) => handle.focus())}>focus</ActionButton>
          <ActionButton icon={Sparkles} disabled={!child} onClick={() => childAction('setTitle', (handle) => handle.setTitle(childTitle))}>setTitle</ActionButton>
          <ActionButton icon={AppWindow} disabled={!child} onClick={() => childAction('setSize', (handle) => handle.setSize(560, 440))}>setSize</ActionButton>
          <ActionButton icon={Send} disabled={!child} onClick={() => childAction('postMessage', (handle) => handle.postMessage('api-lab:child-message', { at: Date.now() }))}>postMessage</ActionButton>
          <ActionButton icon={XCircle} disabled={!child} onClick={() => childAction('close', (handle) => handle.close())}>close</ActionButton>
        </div>
        <div className="message-panel">
          <strong>子窗口消息</strong>
          {messages.length ? messages.map((message, index) => <code key={`${message}-${index}`}>{message}</code>) : <p className="empty-text">创建子窗口后点击子窗口里的发送按钮</p>}
        </div>
      </CapabilitySection>
      <CapabilitySection title="安全文件拖拽" icon={FolderOpen} description="后端在 temp/mulby-api-lab 生成示例文件，然后用 window.startDrag 交给宿主启动拖拽。">
        <div className="action-row">
          <ActionButton icon={FileText} variant="primary" onClick={prepareDragFile}>生成拖拽文件</ActionButton>
        </div>
        <div className="drag-target" draggable={Boolean(dragFile)} onDragStart={startDrag}>
          <FolderOpen size={22} />
          <span>{dragFile ? '从这里拖出示例文件' : '先生成拖拽文件'}</span>
          {dragFile ? <code>{dragFile}</code> : null}
        </div>
      </CapabilitySection>
    </>
  )
}

function InBrowserModuleDemo() {
  const [record, setRecord] = useState<RunRecord>({ status: 'idle', title: '' })
  const [url, setUrl] = useState('https://example.com')

  const runRecipe = async (recipe: 'extract' | 'markdown' | 'screenshot' | 'cookies' | 'pdf' | 'download') => {
    if (!window.confirm(`启动 InBrowser 执行 ${recipe} 示例？`)) return
    setRecord({ status: 'running', title: `InBrowser ${recipe}` })
    try {
      let raw: unknown
      if (!hasMulby()) {
        raw = { preview: true, recipe, url }
      } else if (recipe === 'extract') {
        raw = await mulby().inbrowser
          .goto(url, {}, 15000)
          .viewport(1100, 760)
          .evaluate(() => ({ title: document.title, text: document.body.innerText.slice(0, 500), href: location.href }))
          .run()
      } else if (recipe === 'markdown') {
        raw = await mulby().inbrowser.goto(url, {}, 15000).markdown('body').run()
      } else if (recipe === 'screenshot') {
        raw = await mulby().inbrowser.goto(url, {}, 15000).viewport(1100, 760).screenshot().run()
      } else if (recipe === 'pdf') {
        const paths = asRecord(await hostCall('getInBrowserSandboxPaths'))
        raw = await mulby().inbrowser.goto(url, {}, 15000).viewport(1100, 760).pdf({}, String(paths.pdfPath)).run()
      } else if (recipe === 'download') {
        const paths = asRecord(await hostCall('getInBrowserSandboxPaths'))
        raw = await mulby().inbrowser.download(url, String(paths.downloadPath)).run()
      } else {
        raw = await mulby().inbrowser.goto(url, {}, 15000).cookies().run()
      }
      setRecord({ status: 'success', title: `InBrowser ${recipe} 完成`, message: `目标：${url}`, raw, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: `InBrowser ${recipe} 失败`, error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  return (
    <CapabilitySection title="InBrowser Recipe 区" icon={Globe2} description="使用 example.com 等安全页面演示链式浏览器自动化。下载和写文件能力只在覆盖表说明。">
      <div className="form-row">
        <input value={url} onChange={(event) => setUrl(event.target.value)} />
      </div>
      <div className="action-row">
        <ActionButton icon={Search} variant="primary" onClick={() => runRecipe('extract')}>标题提取</ActionButton>
        <ActionButton icon={FileText} onClick={() => runRecipe('markdown')}>Markdown 抽取</ActionButton>
        <ActionButton icon={ImageIcon} onClick={() => runRecipe('screenshot')}>截图</ActionButton>
        <ActionButton icon={Database} onClick={() => runRecipe('cookies')}>Cookie 检查</ActionButton>
        <ActionButton icon={FileText} onClick={() => runRecipe('pdf')}>保存 PDF</ActionButton>
        <ActionButton icon={FolderOpen} onClick={() => runRecipe('download')}>安全下载</ActionButton>
      </div>
      <RunResult record={record} />
    </CapabilitySection>
  )
}

function ManifestModuleDemo({ initData }: { initData: PluginInitData | null }) {
  const [record, setRecord] = useState<RunRecord>({ status: 'idle', title: '' })

  const inspect = async () => {
    setRecord({ status: 'running', title: '读取插件契约' })
    try {
      const raw = hasMulby() ? await hostCall('getManifestContract') : { preview: true }
      setRecord({ status: 'success', title: '插件契约已读取', raw: { contract: raw, initData }, updatedAt: Date.now() })
    } catch (error) {
      setRecord({ status: 'error', title: '读取插件契约失败', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() })
    }
  }

  return (
    <CapabilitySection title="插件契约与启动输入" icon={FileText} description="展示 manifest features、tools、permissions 以及当前启动上下文。">
      <div className="action-row">
        <ActionButton icon={Eye} variant="primary" onClick={inspect}>读取契约</ActionButton>
      </div>
      {initData?.attachments?.length ? (
        <div className="info-list">
          {initData.attachments.map((item) => (
            <div className="info-row" key={item.id}>
              <span>{item.name}</span>
              <code>{item.kind} / {bytesToHuman(item.size)}</code>
            </div>
          ))}
        </div>
      ) : null}
      <RunResult record={record} />
    </CapabilitySection>
  )
}

function ApiModulePage({ module, initData }: { module: ApiModuleSpec; initData: PluginInitData | null }) {
  const Icon = moduleIcons[module.id] || LayoutDashboard
  const risky = module.methods.filter((item) => item.risk !== 'safe').length
  const live = module.methods.filter((item) => item.demoMode === 'live' || item.demoMode === 'sandboxed').length

  return (
    <main className="module-page">
      <div className="page-header">
        <div className="page-icon"><Icon size={25} /></div>
        <div>
          <span className="eyebrow">{module.group}</span>
          <h2>{module.title}</h2>
          <p>{module.summary}</p>
        </div>
      </div>
      <MetricGrid metrics={[
        { label: '方法覆盖', value: module.methods.length },
        { label: '可运行/沙盒', value: live },
        { label: '需谨慎', value: risky },
        { label: '模块 ID', value: module.id }
      ]} />

      {module.id === 'system' ? <SystemModuleDemo /> : null}
      {module.id === 'window' ? <WindowModuleDemo /> : null}
      {module.id === 'inbrowser' ? <InBrowserModuleDemo /> : null}
      {module.id === 'manifest' ? <ManifestModuleDemo initData={initData} /> : null}
      {!['system', 'window', 'inbrowser', 'manifest'].includes(module.id) ? <GenericModuleDemo module={module} /> : null}

      <ApiMethodTable methods={module.methods} />
    </main>
  )
}

function CollapsibleContextPanel({
  initData,
  events,
  open,
  onToggle,
  onClear
}: {
  initData: PluginInitData | null
  events: AnyRecord[]
  open: boolean
  onToggle: () => void
  onClear: () => void
}) {
  return (
    <section className={open ? 'context-drawer open' : 'context-drawer'}>
      <button className="context-toggle" onClick={onToggle}>
        <Activity size={16} />
        <span>启动上下文与生命周期</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open ? (
        <div className="context-content">
          <div className="context-card">
            <div className="context-card-title">
              <Activity size={16} />
              <strong>启动上下文</strong>
            </div>
            <RawOutputDrawer value={initData || { waiting: true }} title="查看上下文 JSON" />
          </div>
          <div className="context-card">
            <div className="context-card-title">
              <Bell size={16} />
              <strong>生命周期事件</strong>
              <button className="mini-button" onClick={onClear}>清空</button>
            </div>
            <div className="event-list">
              {events.length ? events.slice(-8).reverse().map((event, index) => (
                <div className="event-row" key={`${event.type}-${event.at}-${index}`}>
                  <span>{textOf(event.type)}</span>
                  <small>{new Date(Number(event.at || Date.now())).toLocaleTimeString()}</small>
                </div>
              )) : <p className="empty-text">等待生命周期事件</p>}
            </div>
            <RawOutputDrawer value={events.slice(-12)} title="查看事件 JSON" />
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default function App() {
  const [activeModuleId, setActiveModuleId] = useState('system')
  const [query, setQuery] = useState('')
  const [initData, setInitData] = useState<PluginInitData | null>(null)
  const [events, setEvents] = useState<AnyRecord[]>([])
  const [contextOpen, setContextOpen] = useState(false)

  useEffect(() => {
    const disposers: Array<() => void> = []
    if (window.mulby?.onPluginInit) {
      disposers.push(window.mulby.onPluginInit((data) => {
        setInitData(data)
        setActiveModuleId(readLaunchRoute(data))
        if (data.input?.trim().toLowerCase().startsWith('api ')) {
          setQuery(data.input.replace(/^api\s+/i, ''))
        }
        setEvents((prev) => [...prev, { type: 'init', at: Date.now(), data }])
      }))
    }
    if (window.mulby?.onPluginAttach) {
      disposers.push(window.mulby.onPluginAttach((data) => setEvents((prev) => [...prev, { type: 'attach', at: Date.now(), data }])))
    }
    if (window.mulby?.onPluginDetached) {
      disposers.push(window.mulby.onPluginDetached(() => setEvents((prev) => [...prev, { type: 'detached', at: Date.now() }])))
    }
    if (window.mulby?.onPluginLaunchStart) {
      disposers.push(window.mulby.onPluginLaunchStart((data) => setEvents((prev) => [...prev, { type: 'launch-start', at: Date.now(), data }])))
    }
    if (window.mulby?.onPluginLaunchEnd) {
      disposers.push(window.mulby.onPluginLaunchEnd((data) => setEvents((prev) => [...prev, { type: 'launch-end', at: Date.now(), data }])))
    }
    return () => disposers.forEach((dispose) => dispose())
  }, [])

  const filteredRegistry = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return apiRegistry
    return apiRegistry.filter((module) => {
      const haystack = [module.id, module.title, module.group, module.summary, ...module.methods.map((method) => method.name)].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [query])

  const activeModule = apiRegistry.find((module) => module.id === activeModuleId) || apiRegistry[0]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Code2 size={24} /></div>
          <div>
            <h1>Mulby API Lab</h1>
            <p>模块化 API 实验室</p>
          </div>
        </div>
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 API 模块或方法" />
        </label>
        <nav className="nav-list">
          {apiGroups.map((group) => {
            const modules = filteredRegistry.filter((module) => module.group === group)
            if (!modules.length) return null
            return (
              <div className="nav-group" key={group}>
                <div className="nav-group-title">
                  <Layers size={15} />
                  <span>{group}</span>
                </div>
                {modules.map((module) => {
                  const Icon = moduleIcons[module.id] || LayoutDashboard
                  return (
                    <button
                      key={module.id}
                      className={module.id === activeModule.id ? 'nav-item active' : 'nav-item'}
                      onClick={() => setActiveModuleId(module.id)}
                    >
                      <Icon size={16} />
                      <span>{module.id}</span>
                      <small>{module.methods.length}</small>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </nav>
      </aside>
      <div className="content">
        <div className="topbar">
          <div className="status-strip">
            <span>{apiRegistry.length} modules</span>
            <span>{apiRegistry.reduce((sum, module) => sum + module.methods.length, 0)} methods</span>
            <span>lucide-react icons</span>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={() => setContextOpen((value) => !value)}>
              <Activity size={16} />
              <span>上下文</span>
            </button>
            <button className="ghost-button" onClick={() => window.mulby?.window?.reload?.()}>
              <RefreshCcw size={16} />
              <span>刷新 UI</span>
            </button>
          </div>
        </div>
        <CollapsibleContextPanel
          initData={initData}
          events={events}
          open={contextOpen}
          onToggle={() => setContextOpen((value) => !value)}
          onClear={() => setEvents([])}
        />
        <div className="work-area">
          <ApiModulePage module={activeModule} initData={initData} />
        </div>
      </div>
    </div>
  )
}
