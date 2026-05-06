import {
  AppWindow,
  Check,
  ChevronDown,
  Clock3,
  Crop,
  Film,
  Gauge,
  Keyboard,
  LoaderCircle,
  Mic,
  Minus,
  Monitor,
  MousePointer2,
  Pause,
  Play,
  RefreshCcw,
  Save,
  Settings2,
  Square,
  Timer,
  Video,
  Volume2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMulby } from './hooks/useMulby'

const PLUGIN_ID = 'screen-recorder'
const SETTINGS_KEY = 'screen-recorder-settings'

type RecorderStatus = 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'processing' | 'complete' | 'error'
type RecordMode = 'fullscreen' | 'window' | 'region'
type ClickTheme = 'default' | 'minimal' | 'fun' | 'professional'
type KeystrokePosition = 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center'

interface Region {
  x: number
  y: number
  width: number
  height: number
  displayId?: number
  scaleFactor?: number
}

interface OverlayTarget {
  x: number
  y: number
  width: number
  height: number
  displayId?: number
  scaleFactor?: number
}

interface CaptureBounds {
  x: number
  y: number
  width: number
  height: number
}

interface RecorderSettings {
  mode: RecordMode
  displaySourceId: string
  windowSourceId: string
  frameRate: 30 | 60
  bitrateMbps: number
  systemAudio: boolean
  microphone: boolean
  startDelay: 0 | 3 | 5
  autoStopEnabled: boolean
  autoStopMinutes: number
  overlay: {
    mouseTrail: boolean
    clickEffect: boolean
    keystroke: boolean
    clickTheme: ClickTheme
    leftEmoji: string
    rightEmoji: string
    keyPosition: KeystrokePosition
  }
}

interface RecorderMetrics {
  durationSec: number
  fileSize: number
  progressLabel: string
  lastOutputPath: string
}

interface StreamBundle {
  stream: MediaStream
  cleanup?: () => void
}

interface InputMonitorEvent {
  type?: string
  x?: number
  y?: number
  key?: string
  keyCode?: number
  button?: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  timestamp?: number
}

interface OverlayConfig {
  mouseTrail: boolean
  clickEffect: boolean
  keystroke: boolean
  clickTheme: ClickTheme
  leftEmoji: string
  rightEmoji: string
  keyPosition: KeystrokePosition
}

interface ClickEffect {
  id: string
  x: number
  y: number
  button: string
  color: string
  label: string
  timestamp: number
}

interface TrailPoint {
  x: number
  y: number
  timestamp: number
}

interface KeyBubble {
  id: string
  label: string
  timestamp: number
}

const DEFAULT_SETTINGS: RecorderSettings = {
  mode: 'fullscreen',
  displaySourceId: '',
  windowSourceId: '',
  frameRate: 30,
  bitrateMbps: 5,
  systemAudio: false,
  microphone: false,
  startDelay: 3,
  autoStopEnabled: false,
  autoStopMinutes: 5,
  overlay: {
    mouseTrail: true,
    clickEffect: true,
    keystroke: true,
    clickTheme: 'default',
    leftEmoji: 'L',
    rightEmoji: 'R',
    keyPosition: 'bottom-center'
  }
}

const EMPTY_METRICS: RecorderMetrics = {
  durationSec: 0,
  fileSize: 0,
  progressLabel: '',
  lastOutputPath: ''
}

const MODE_OPTIONS: Array<{ id: RecordMode; label: string; description: string; icon: typeof Monitor }> = [
  { id: 'fullscreen', label: '全屏', description: '录制显示器', icon: Monitor },
  { id: 'window', label: '窗口', description: '录制单个窗口', icon: AppWindow },
  { id: 'region', label: '区域', description: '框选范围', icon: Crop }
]

const START_DELAY_OPTIONS: Array<0 | 3 | 5> = [0, 3, 5]
const AUTO_STOP_OPTIONS = [1, 3, 5, 10, 30]
const BITRATE_OPTIONS = [3, 5, 8, 12]
const CLICK_MARKER_TTL_MS = 650
const TRAIL_POINT_TTL_MS = 2000
const MAX_TRAIL_POINTS = 120
const MAX_CLICK_MARKERS = 24
const MAX_KEY_BUBBLES = 8
const KEY_BUBBLE_TTL_MS = 2600
const KEY_REPEAT_MERGE_MS = 120
const OVERLAY_INPUT_THROTTLE_MS = 33
const OVERLAY_CANVAS_DPR_CAP = 1.25

function trimOldest<T>(items: T[], maxLength: number) {
  if (items.length > maxLength) {
    items.splice(0, items.length - maxLength)
  }
}

function pruneExpiredItems<T extends { timestamp: number }>(items: T[], now: number, ttlMs: number) {
  const originalLength = items.length
  let writeIndex = 0
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (now - item.timestamp < ttlMs) {
      items[writeIndex] = item
      writeIndex += 1
    }
  }
  items.length = writeIndex
  return items.length !== originalLength
}

function isOverlayEnabled(overlay: OverlayConfig) {
  return overlay.mouseTrail || overlay.clickEffect || overlay.keystroke
}

function normalizeCaptureBounds(value: unknown): CaptureBounds | null {
  if (!value || typeof value !== 'object') return null
  const bounds = value as Partial<CaptureBounds>
  const { x, y, width, height } = bounds
  if ([x, y, width, height].every((item) => typeof item === 'number' && Number.isFinite(item)) && width! > 0 && height! > 0) {
    return { x: x!, y: y!, width: width!, height: height! }
  }
  return null
}

function getCaptureSourceBounds(source?: CaptureSource | null) {
  const candidate = source as (CaptureSource & {
    bounds?: unknown
    windowBounds?: unknown
    captureBounds?: unknown
  }) | null | undefined
  return normalizeCaptureBounds(candidate?.bounds) ?? normalizeCaptureBounds(candidate?.windowBounds) ?? normalizeCaptureBounds(candidate?.captureBounds)
}

function mergeSettings(saved: Partial<RecorderSettings> | undefined): RecorderSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(saved ?? {}),
    overlay: {
      ...DEFAULT_SETTINGS.overlay,
      ...(saved?.overlay ?? {})
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatFileSize(bytes: number) {
  if (bytes <= 0) return '0 MB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function joinPath(base: string, name: string) {
  return `${base.replace(/[\\/]$/, '')}/${name}`
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return 'video/webm'
  }

  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm'
  ]
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? 'video/webm'
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '操作失败，请稍后重试。'
}

function formatPermissionStatus(status?: string) {
  const labels: Record<string, string> = {
    authorized: '已授权',
    granted: '已授权',
    denied: '已拒绝',
    restricted: '受系统策略限制',
    limited: '受限访问',
    'not-determined': '尚未决定',
    unknown: '未知'
  }
  return status ? labels[status] ?? status : '未知'
}

function normalizeClickMarkerLabel(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  if (!trimmed) return fallback

  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => {
      segment(input: string): Iterable<{ segment: string }>
    }
  }).Segmenter

  if (Segmenter) {
    const first = new Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)[Symbol.iterator]().next()
    return first.done ? fallback : first.value.segment
  }

  return Array.from(trimmed)[0] ?? fallback
}

function isSystemMediaPermissionError(error: unknown) {
  const message = toErrorMessage(error).toLowerCase()
  return (
    message.includes('permission denied') ||
    message.includes('notallowederror') ||
    message.includes('not allowed') ||
    message.includes('denied by system')
  )
}

function createScreenPermissionMessage(error: unknown, screenStatus?: string, retriedWithoutSystemAudio = false) {
  const retryText = retriedWithoutSystemAudio
    ? '系统声音失败后已尝试降级为仅录制画面，但桌面视频流仍被拒绝。'
    : ''
  const rawMessage = toErrorMessage(error)
  const missingManifest = rawMessage.includes('manifest.permissions.screen')
  return [
    missingManifest
      ? '录屏权限不足：插件未声明 manifest.permissions.screen（屏幕录制权限）。'
      : '录屏被拒绝：插件已声明 manifest.permissions.screen，但桌面媒体流被宿主或系统拒绝。',
    `当前系统屏幕录制状态：${formatPermissionStatus(screenStatus)}。`,
    '如果宿主日志出现 requested media permission without a concrete audio/video type，说明 Electron 没带 media details 时没有匹配到 pending desktop capture，需要宿主按插件或窗口维度关联这次桌面录制请求。',
    retryText,
    `原始错误：${rawMessage}`
  ].filter(Boolean).join('')
}

function createMicrophonePermissionMessage(error?: unknown, microphoneStatus?: string) {
  return [
    '麦克风权限不足：需要 manifest.permissions.microphone（麦克风权限）。',
    `当前系统麦克风状态：${formatPermissionStatus(microphoneStatus)}。`,
    error ? `原始错误：${toErrorMessage(error)}` : ''
  ].filter(Boolean).join('')
}

function buildShortcutLabel(event: InputMonitorEvent) {
  const parts: string[] = []
  if (event.meta) parts.push(navigator.platform.includes('Mac') ? 'Cmd' : 'Win')
  if (event.ctrl) parts.push('Ctrl')
  if (event.alt) parts.push(navigator.platform.includes('Mac') ? 'Option' : 'Alt')
  if (event.shift) parts.push('Shift')
  const key = event.key || (typeof event.keyCode === 'number' ? String(event.keyCode) : '')
  const normalizedKey = key.replace(/^Key/, '')
  const modifierKeyAliases = new Set(['Command', 'Cmd', 'Meta', 'Win', 'Control', 'Ctrl', 'Alt', 'Option', 'Shift'])
  if (normalizedKey && !modifierKeyAliases.has(normalizedKey) && !parts.includes(normalizedKey)) {
    parts.push(normalizedKey)
  }
  return parts.join(' + ')
}

function displayToOverlayTarget(display: DisplayInfo): OverlayTarget {
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    displayId: display.id,
    scaleFactor: display.scaleFactor
  }
}

function getClockNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function getClickEffectPresentation(button: string | undefined, config: OverlayConfig) {
  const isRight = button === 'right' || button === '2'
  const color = config.clickTheme === 'professional' ? '75, 85, 99' : isRight ? '209, 73, 91' : '31, 122, 140'
  const label =
    config.clickTheme === 'minimal' ? '' : normalizeClickMarkerLabel(isRight ? config.rightEmoji : config.leftEmoji, isRight ? 'R' : 'L')
  return { color, label }
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const maxRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + maxRadius, y)
  context.lineTo(x + width - maxRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + maxRadius)
  context.lineTo(x + width, y + height - maxRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - maxRadius, y + height)
  context.lineTo(x + maxRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - maxRadius)
  context.lineTo(x, y + maxRadius)
  context.quadraticCurveTo(x, y, x + maxRadius, y)
  context.closePath()
}

function drawTrail(context: CanvasRenderingContext2D, trail: TrailPoint[], now: number) {
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (let index = 1; index < trail.length; index += 1) {
    const previous = trail[index - 1]
    const point = trail[index]
    const age = now - point.timestamp
    const alpha = Math.max(0, 1 - age / TRAIL_POINT_TTL_MS)
    context.strokeStyle = `rgba(31, 122, 140, ${alpha * 0.72})`
    context.lineWidth = 3
    context.beginPath()
    context.moveTo(previous.x, previous.y)
    context.lineTo(point.x, point.y)
    context.stroke()
  }
}

function drawClickMarker(context: CanvasRenderingContext2D, click: ClickEffect, theme: ClickTheme) {
  const radius = theme === 'minimal' ? 16 : 18

  context.strokeStyle = `rgb(${click.color})`
  context.lineWidth = theme === 'minimal' ? 2 : 3
  context.beginPath()
  context.arc(click.x, click.y, radius, 0, Math.PI * 2)
  context.stroke()

  if (theme !== 'minimal' && click.label) {
    context.fillStyle = `rgb(${click.color})`
    context.font = '600 20px "Apple Color Emoji", "Segoe UI Emoji", -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(click.label, click.x, click.y - 42)
  }
}

function drawKeyBubbles(
  context: CanvasRenderingContext2D,
  keys: KeyBubble[],
  position: KeystrokePosition,
  width: number,
  height: number,
  now: number
) {
  if (keys.length === 0) return

  context.save()
  context.font = '800 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  context.textBaseline = 'middle'

  const gap = 8
  const bubbleHeight = 34
  const paddingX = 12
  const bubbles = keys.map((key) => ({
    key,
    width: Math.max(34, Math.ceil(context.measureText(key.label).width + paddingX * 2))
  }))
  const totalWidth = bubbles.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, bubbles.length - 1)
  const margin = 48
  const startX =
    position === 'bottom-left'
      ? margin
      : position === 'bottom-right'
        ? Math.max(margin, width - margin - totalWidth)
        : Math.max(margin, (width - totalWidth) / 2)
  const y = position === 'top-center' ? margin : Math.max(margin, height - margin - bubbleHeight)

  let cursorX = startX
  for (const bubble of bubbles) {
    const age = now - bubble.key.timestamp
    const fade = Math.min(1, Math.max(0, (KEY_BUBBLE_TTL_MS - age) / 400))
    context.globalAlpha = fade
    drawRoundedRect(context, cursorX, y, bubble.width, bubbleHeight, 17)
    context.fillStyle = 'rgba(9, 16, 20, 0.76)'
    context.fill()
    context.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    context.lineWidth = 1
    context.stroke()
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.fillText(bubble.key.label, cursorX + bubble.width / 2, y + bubbleHeight / 2)
    cursorX += bubble.width + gap
  }

  context.restore()
}

function App() {
  const routeView = useMemo(() => new URLSearchParams(window.location.search).get('view') ?? 'main', [])

  if (routeView === 'region-selector') {
    return <RegionSelector />
  }

  if (routeView === 'overlay') {
    return <OverlayView />
  }

  return <RecorderPanel />
}

function RecorderPanel() {
  const {
    dialog,
    filesystem,
    ffmpeg,
    media,
    notification,
    permission,
    screen,
    storage,
    system,
    window: mulbyWindow
  } = useMulby(PLUGIN_ID)

  const [settings, setSettings] = useState<RecorderSettings>(DEFAULT_SETTINGS)
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [metrics, setMetrics] = useState<RecorderMetrics>(EMPTY_METRICS)
  const [screenSources, setScreenSources] = useState<CaptureSource[]>([])
  const [windowSources, setWindowSources] = useState<CaptureSource[]>([])
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('准备就绪。')
  const [sourcesLoading, setSourcesLoading] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const overlayCleanupRef = useRef<(() => void) | null>(null)
  const overlayTargetRef = useRef<OverlayTarget | null>(null)
  const resetCompositeOverlayRef = useRef<(() => void) | null>(null)
  const durationTimerRef = useRef<number | null>(null)
  const startedAtMsRef = useRef(0)
  const accumulatedDurationMsRef = useRef(0)
  const backgroundThrottlingDisabledRef = useRef(false)
  const cancelStartRef = useRef(false)
  const settingsReadyRef = useRef(false)
  const statusRef = useRef<RecorderStatus>('idle')

  const activeScreenSource = useMemo(
    () => screenSources.find((source) => source.id === settings.displaySourceId) ?? screenSources[0],
    [screenSources, settings.displaySourceId]
  )

  const activeWindowSource = useMemo(
    () => windowSources.find((source) => source.id === settings.windowSourceId) ?? windowSources[0],
    [settings.windowSourceId, windowSources]
  )

  const autoStopSeconds = settings.autoStopEnabled ? settings.autoStopMinutes * 60 : 0
  const canStart = status === 'idle' || status === 'complete' || status === 'error'
  const isBusy = status === 'preparing' || status === 'countdown' || status === 'processing'
  const isRecording = status === 'recording'
  const isPaused = status === 'paused'
  const shouldShowSources = settings.mode === 'fullscreen' || settings.mode === 'window'

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')
    const disposeTheme = window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.(() => {
      void mulbyWindow.setAlwaysOnTop?.(true)
    })

    return () => {
      if (typeof disposeTheme === 'function') disposeTheme()
    }
  }, [mulbyWindow])

  useEffect(() => {
    let mounted = true

    async function loadSettings() {
      try {
        const saved = await storage.get(SETTINGS_KEY)
        if (mounted && saved && typeof saved === 'object') {
          setSettings(mergeSettings(saved as Partial<RecorderSettings>))
        }
      } catch (error) {
        console.warn('[screen-recorder] load settings failed', error)
      } finally {
        settingsReadyRef.current = true
      }
    }

    void loadSettings()

    return () => {
      mounted = false
    }
  }, [storage])

  useEffect(() => {
    if (!settingsReadyRef.current) return
    const timer = window.setTimeout(() => {
      void storage.set(SETTINGS_KEY, settings).catch((error: unknown) => {
        console.warn('[screen-recorder] save settings failed', error)
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [settings, storage])

  const refreshSources = useCallback(async () => {
    setSourcesLoading(true)
    try {
      const [screens, windows] = await Promise.all([
        screen.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } }),
        screen.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 180 } })
      ])

      const nextScreens = screens ?? []
      const nextWindows = windows ?? []
      setScreenSources(nextScreens)
      setWindowSources(nextWindows)
      setSettings((current) => ({
        ...current,
        displaySourceId: nextScreens.some((source) => source.id === current.displaySourceId)
          ? current.displaySourceId
          : nextScreens[0]?.id ?? '',
        windowSourceId: nextWindows.some((source) => source.id === current.windowSourceId)
          ? current.windowSourceId
          : nextWindows[0]?.id ?? ''
      }))
      setNotice(nextScreens.length > 0 ? '录制源已更新。' : '未发现可录制屏幕，请检查系统录屏权限。')
    } catch (error) {
      const screenStatus = await permission?.getStatus?.('screen').catch(() => undefined)
      const message = isSystemMediaPermissionError(error)
        ? createScreenPermissionMessage(error, screenStatus)
        : toErrorMessage(error)
      setErrorMessage(`刷新录制源失败：${message}`)
      notification.show('刷新录制源失败', 'error')
    } finally {
      setSourcesLoading(false)
    }
  }, [notification, permission, screen])

  useEffect(() => {
    void refreshSources()
  }, [refreshSources])

  const getElapsedDurationSec = useCallback(() => {
    let elapsedMs = accumulatedDurationMsRef.current
    if (startedAtMsRef.current > 0) {
      elapsedMs += Math.max(0, getClockNow() - startedAtMsRef.current)
    }
    return Math.max(0, Math.floor(elapsedMs / 1000))
  }, [])

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      window.clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }

    if (startedAtMsRef.current > 0) {
      accumulatedDurationMsRef.current += Math.max(0, getClockNow() - startedAtMsRef.current)
      startedAtMsRef.current = 0
    }

    const elapsed = Math.floor(accumulatedDurationMsRef.current / 1000)
    setMetrics((current) => ({ ...current, durationSec: Math.max(current.durationSec, elapsed) }))
  }, [])

  const disableControlPanelThrottling = useCallback(() => {
    if (backgroundThrottlingDisabledRef.current || !mulbyWindow.setBackgroundThrottling) return
    backgroundThrottlingDisabledRef.current = true
    void mulbyWindow.setBackgroundThrottling(false).catch((error: unknown) => {
      backgroundThrottlingDisabledRef.current = false
      console.warn('[screen-recorder] disable background throttling failed', error)
    })
  }, [mulbyWindow])

  const restoreControlPanelThrottling = useCallback(() => {
    if (!backgroundThrottlingDisabledRef.current) return
    backgroundThrottlingDisabledRef.current = false
    void mulbyWindow.setBackgroundThrottling?.(true).catch((error: unknown) => {
      console.warn('[screen-recorder] restore background throttling failed', error)
    })
  }, [mulbyWindow])

  const cleanupSession = useCallback(() => {
    stopDurationTimer()
    overlayCleanupRef.current?.()
    overlayCleanupRef.current = null
    cleanupRef.current?.()
    cleanupRef.current = null
    stopStream(streamRef.current)
    stopStream(micStreamRef.current)
    streamRef.current = null
    micStreamRef.current = null
    recorderRef.current = null
    overlayTargetRef.current = null
    resetCompositeOverlayRef.current = null
    restoreControlPanelThrottling()
  }, [restoreControlPanelThrottling, stopDurationTimer])

  useEffect(() => {
    return () => {
      cancelStartRef.current = true
      cleanupSession()
    }
  }, [cleanupSession])

  const updateSetting = useCallback(<K extends keyof RecorderSettings>(key: K, value: RecorderSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }, [])

  const updateOverlaySetting = useCallback(
    <K extends keyof RecorderSettings['overlay']>(key: K, value: RecorderSettings['overlay'][K]) => {
      setSettings((current) => ({
        ...current,
        overlay: { ...current.overlay, [key]: value }
      }))
    },
    []
  )

  const requestInputFocus = useCallback(
    (element: HTMLInputElement) => {
      mulbyWindow.focus?.()
      window.setTimeout(() => {
        if (document.activeElement !== element) {
          element.focus()
        }
      }, 0)
    },
    [mulbyWindow]
  )

  const getMicrophoneStream = useCallback(async () => {
    const microphoneStatus = await media.getAccessStatus('microphone').catch(() => undefined)
    const hasAccess = await media.hasMicrophoneAccess()
    if (!hasAccess) {
      const granted = await media.askForAccess('microphone')
      if (!granted) {
        throw new Error(createMicrophonePermissionMessage(undefined, microphoneStatus))
      }
    }

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch (error) {
      if (isSystemMediaPermissionError(error)) {
        const latestStatus = await media.getAccessStatus('microphone').catch(() => microphoneStatus)
        throw new Error(createMicrophonePermissionMessage(error, latestStatus))
      }
      throw error
    }
  }, [media])

  const mixAudioStreams = useCallback((videoStream: MediaStream, microphoneStream: MediaStream) => {
    const audioContext = new AudioContext()
    const destination = audioContext.createMediaStreamDestination()

    if (videoStream.getAudioTracks().length > 0) {
      const systemSource = audioContext.createMediaStreamSource(new MediaStream(videoStream.getAudioTracks()))
      const systemGain = audioContext.createGain()
      systemGain.gain.value = 1
      systemSource.connect(systemGain).connect(destination)
    }

    const micSource = audioContext.createMediaStreamSource(microphoneStream)
    const micGain = audioContext.createGain()
    micGain.gain.value = 1
    micSource.connect(micGain).connect(destination)

    const mixedStream = new MediaStream()
    videoStream.getVideoTracks().forEach((track) => mixedStream.addTrack(track))
    destination.stream.getAudioTracks().forEach((track) => mixedStream.addTrack(track))

    return {
      stream: mixedStream,
      cleanup: () => {
        void audioContext.close().catch(() => {})
      }
    }
  }, [])

  const getDisplayFallback = useCallback(async () => {
    const displays = await screen.getAllDisplays()
    const cursor = await screen.getCursorScreenPoint().catch(() => null)
    if (cursor) {
      return screen.getDisplayNearestPoint(cursor).catch(() => displays.find((display) => display.isPrimary) ?? displays[0])
    }
    return displays.find((display) => display.isPrimary) ?? displays[0] ?? screen.getPrimaryDisplay()
  }, [screen])

  const getDisplayForSource = useCallback(
    async (source?: CaptureSource | null) => {
      const displays = await screen.getAllDisplays()
      if (source?.displayId) {
        const matched = displays.find((display) => String(display.id) === String(source.displayId))
        if (matched) return matched
      }
      return getDisplayFallback()
    },
    [getDisplayFallback, screen]
  )

  const getDisplayForRegion = useCallback(
    async (region: Region) => {
      const displays = await screen.getAllDisplays()
      if (region.displayId) {
        const matched = displays.find((display) => String(display.id) === String(region.displayId))
        if (matched) return matched
      }

      return screen
        .getDisplayMatching({ x: region.x, y: region.y, width: region.width, height: region.height })
        .catch(() => screen.getDisplayNearestPoint({ x: region.x, y: region.y }))
    },
    [screen]
  )

  const createSourceStream = useCallback(
    async (sourceId: string): Promise<StreamBundle> => {
      if (!sourceId) {
        throw new Error('未选择录制源。')
      }

      const requestDesktopStream = async (audio: boolean) => {
        const constraints = await screen.getMediaStreamConstraints({
          sourceId,
          audio,
          frameRate: settings.frameRate
        })
        return navigator.mediaDevices.getUserMedia(constraints as MediaStreamConstraints)
      }

      const createScreenPermissionError = async (error: unknown, retriedWithoutSystemAudio = false) => {
        const screenStatus = await permission?.getStatus?.('screen').catch(() => undefined)
        return new Error(createScreenPermissionMessage(error, screenStatus, retriedWithoutSystemAudio))
      }

      try {
        const stream = await requestDesktopStream(settings.systemAudio)
        return { stream }
      } catch (error) {
        if (!isSystemMediaPermissionError(error)) {
          throw error
        }

        console.warn('[screen-recorder] desktop capture getUserMedia failed', error)

        if (!settings.systemAudio) {
          throw await createScreenPermissionError(error)
        }

        console.warn('[screen-recorder] system audio capture failed, retrying without audio', error)
        setNotice('系统声音采集被系统拒绝，已降级为仅录制画面。')
        try {
          const stream = await requestDesktopStream(false)
          return { stream }
        } catch (retryError) {
          if (isSystemMediaPermissionError(retryError)) {
            throw await createScreenPermissionError(retryError, true)
          }
          throw retryError
        }
      }
    },
    [permission, screen, settings.frameRate, settings.systemAudio]
  )

  const createRegionStream = useCallback(
    async (region: Region): Promise<StreamBundle> => {
      const display = await getDisplayForRegion(region)
      const bounds = display.bounds
      const source = screenSources.find((item) => item.displayId && String(item.displayId) === String(display?.id)) ?? activeScreenSource

      if (!source) {
        throw new Error('未找到区域所在屏幕源。')
      }

      const fullScreenBundle = await createSourceStream(source.id)
      const fullStream = fullScreenBundle.stream
      const videoTrack = fullStream.getVideoTracks()[0]
      const trackSettings = videoTrack.getSettings()
      const sourceWidth = trackSettings.width ?? bounds.width
      const sourceHeight = trackSettings.height ?? bounds.height
      const scaleX = sourceWidth / Math.max(1, bounds.width)
      const scaleY = sourceHeight / Math.max(1, bounds.height)

      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      const ready = new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve()
      })
      video.srcObject = fullStream
      await ready
      await video.play()

      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(region.width))
      canvas.height = Math.max(1, Math.round(region.height))
      const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
      if (!context) {
        throw new Error('无法创建区域裁剪画布。')
      }

      const sx = Math.max(0, Math.round((region.x - bounds.x) * scaleX))
      const sy = Math.max(0, Math.round((region.y - bounds.y) * scaleY))
      const sw = Math.max(1, Math.round(region.width * scaleX))
      const sh = Math.max(1, Math.round(region.height * scaleY))
      let frameId = 0
      let lastFrameMs = 0
      const frameIntervalMs = 1000 / settings.frameRate

      const drawFrame = (timestamp = getClockNow()) => {
        if (lastFrameMs > 0 && timestamp - lastFrameMs < frameIntervalMs - 1) {
          frameId = window.requestAnimationFrame(drawFrame)
          return
        }
        lastFrameMs = timestamp
        context.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
        frameId = window.requestAnimationFrame(drawFrame)
      }
      drawFrame()

      const stream = canvas.captureStream(settings.frameRate)
      fullStream.getAudioTracks().forEach((track) => stream.addTrack(track))

      return {
        stream,
        cleanup: () => {
          window.cancelAnimationFrame(frameId)
          video.pause()
          video.srcObject = null
          stopStream(fullStream)
        }
      }
    },
    [activeScreenSource, createSourceStream, getDisplayForRegion, screenSources, settings.frameRate]
  )

  const createWindowCompositedStream = useCallback(
    async (source: CaptureSource | undefined, sourceStream: MediaStream, sourceCleanup?: () => void): Promise<StreamBundle> => {
      const videoTrack = sourceStream.getVideoTracks()[0]
      if (!videoTrack) {
        return { stream: sourceStream, cleanup: sourceCleanup }
      }

      const sourceBounds =
        (source?.id ? normalizeCaptureBounds(await screen.getWindowBounds?.(source.id).catch(() => null)) : null) ?? getCaptureSourceBounds(source)
      const wantsMouseOverlay = settings.overlay.mouseTrail || settings.overlay.clickEffect
      if (!sourceBounds && wantsMouseOverlay) {
        setNotice('窗口源未提供 bounds，窗口录制暂时只能内嵌显示键盘按键。请确认宿主支持 screen.getWindowBounds(sourceId)。')
      }

      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      const ready = new Promise<void>((resolve) => {
        video.onloadedmetadata = () => resolve()
      })
      video.srcObject = sourceStream
      await ready
      await video.play()

      const trackSettings = videoTrack.getSettings()
      const width = Math.max(1, Math.round(video.videoWidth || trackSettings.width || sourceBounds?.width || 1280))
      const height = Math.max(1, Math.round(video.videoHeight || trackSettings.height || sourceBounds?.height || 720))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: false, desynchronized: true })
      if (!context) {
        throw new Error('无法创建窗口录制合成画布。')
      }

      const trail: TrailPoint[] = []
      const clicks: ClickEffect[] = []
      const keys: KeyBubble[] = []
      const compositeStream = canvas.captureStream(settings.frameRate)
      sourceStream.getAudioTracks().forEach((track) => compositeStream.addTrack(track))

      let frameId = 0
      let lastFrameMs = 0
      let sessionId: string | null = null
      let disposeInput: Disposable | undefined
      const frameIntervalMs = 1000 / settings.frameRate
      const inputMonitor = window.mulby?.inputMonitor
      const scaleX = sourceBounds ? width / sourceBounds.width : 1
      const scaleY = sourceBounds ? height / sourceBounds.height : 1

      const resetOverlayState = () => {
        trail.length = 0
        clicks.length = 0
        keys.length = 0
        context.clearRect(0, 0, width, height)
        context.drawImage(video, 0, 0, width, height)
      }
      resetCompositeOverlayRef.current = resetOverlayState

      const toWindowPoint = (event: InputMonitorEvent) => {
        if (!sourceBounds || typeof event.x !== 'number' || typeof event.y !== 'number') return null
        const localX = (event.x - sourceBounds.x) * scaleX
        const localY = (event.y - sourceBounds.y) * scaleY
        const tolerance = 10
        if (localX < -tolerance || localY < -tolerance || localX > width + tolerance || localY > height + tolerance) {
          return null
        }
        return {
          x: Math.min(width, Math.max(0, localX)),
          y: Math.min(height, Math.max(0, localY))
        }
      }

      const appendTrailPoint = (x: number, y: number, now: number) => {
        const previous = trail[trail.length - 1]
        if (previous) {
          const dx = x - previous.x
          const dy = y - previous.y
          if (dx * dx + dy * dy < 4) return
        }
        trail.push({ x, y, timestamp: now })
        trimOldest(trail, MAX_TRAIL_POINTS)
      }

      const appendClickMarker = (event: InputMonitorEvent, x: number, y: number, now: number) => {
        const presentation = getClickEffectPresentation(event.button, settings.overlay)
        clicks.push({
          id: `${now}-${clicks.length}`,
          x,
          y,
          button: event.button ?? 'left',
          color: presentation.color,
          label: presentation.label,
          timestamp: now
        })
        trimOldest(clicks, MAX_CLICK_MARKERS)
      }

      const appendKeyBubble = (event: InputMonitorEvent, now: number) => {
        const label = buildShortcutLabel(event)
        if (!label) return
        const previous = keys[keys.length - 1]
        if (previous?.label === label && now - previous.timestamp < KEY_REPEAT_MERGE_MS) return
        keys.push({ id: `${now}-${label}`, label, timestamp: now })
        trimOldest(keys, MAX_KEY_BUBBLES)
      }

      const handleInputEvent = (event: InputMonitorEvent) => {
        const now = Date.now()
        const type = (event.type ?? '').toLowerCase()
        if (type === 'mousemove' && settings.overlay.mouseTrail) {
          const point = toWindowPoint(event)
          if (point) appendTrailPoint(point.x, point.y, now)
          return
        }

        if (type === 'mousedown' && settings.overlay.clickEffect) {
          const point = toWindowPoint(event)
          if (point) appendClickMarker(event, point.x, point.y, now)
          return
        }

        if (settings.overlay.keystroke && (event.key || event.keyCode) && type === 'keydown') {
          appendKeyBubble(event, now)
        }
      }

      const drawFrame = (timestamp = getClockNow()) => {
        if (lastFrameMs > 0 && timestamp - lastFrameMs < frameIntervalMs - 1) {
          frameId = window.requestAnimationFrame(drawFrame)
          return
        }
        lastFrameMs = timestamp
        const now = Date.now()
        pruneExpiredItems(trail, now, TRAIL_POINT_TTL_MS)
        pruneExpiredItems(clicks, now, CLICK_MARKER_TTL_MS)
        pruneExpiredItems(keys, now, KEY_BUBBLE_TTL_MS)

        context.clearRect(0, 0, width, height)
        context.drawImage(video, 0, 0, width, height)

        if (settings.overlay.mouseTrail) {
          drawTrail(context, trail, now)
        }
        if (settings.overlay.clickEffect) {
          clicks.forEach((click) => drawClickMarker(context, click, settings.overlay.clickTheme))
        }
        if (settings.overlay.keystroke) {
          drawKeyBubbles(context, keys, settings.overlay.keyPosition, width, height, now)
        }

        frameId = window.requestAnimationFrame(drawFrame)
      }

      async function startInputMonitor() {
        if (!inputMonitor) {
          setNotice('窗口内嵌 Overlay 已启用，但当前 Mulby 运行时未暴露 inputMonitor。')
          return
        }

        try {
          const available = await inputMonitor.isAvailable()
          if (!available) {
            setNotice('窗口内嵌 Overlay 已启用，但全局输入监听原生模块不可用。')
            return
          }

          const hasAccess = await inputMonitor.requireAccessibility()
          if (!hasAccess) {
            setNotice('窗口内嵌 Overlay 已启用，但未获得辅助功能权限，无法合成鼠标和键盘效果。')
            return
          }

          sessionId = await inputMonitor.start({
            mouse: wantsMouseOverlay,
            keyboard: settings.overlay.keystroke,
            throttleMs: OVERLAY_INPUT_THROTTLE_MS
          })
          if (!sessionId) {
            setNotice('窗口内嵌 Overlay 已启用，但 inputMonitor 会话启动失败。')
            return
          }

          disposeInput = inputMonitor.onEvent(handleInputEvent)
          setNotice(sourceBounds ? '窗口模式将把鼠标和键盘效果内嵌合成到录制视频。' : '窗口模式将把键盘效果内嵌合成到录制视频。')
        } catch (error) {
          setNotice(`窗口内嵌 Overlay 输入监听未启用：${toErrorMessage(error)}`)
        }
      }

      drawFrame()
      await startInputMonitor()

      return {
        stream: compositeStream,
        cleanup: () => {
          if (frameId) {
            window.cancelAnimationFrame(frameId)
          }
          disposeInput?.()
          if (sessionId && inputMonitor) {
            void inputMonitor.stop(sessionId).catch(() => {})
          }
          if (resetCompositeOverlayRef.current === resetOverlayState) {
            resetCompositeOverlayRef.current = null
          }
          video.pause()
          video.srcObject = null
          stopStream(compositeStream)
          sourceCleanup?.()
          stopStream(sourceStream)
        }
      }
    },
    [screen, settings.frameRate, settings.overlay]
  )

  const selectRegion = useCallback(async () => {
    const display = await getDisplayFallback()
    const params = new URLSearchParams({
      view: 'region-selector',
      displayId: String(display.id),
      displayX: String(display.bounds.x),
      displayY: String(display.bounds.y),
      scaleFactor: String(display.scaleFactor)
    })

    const childWindow = await mulbyWindow.create(`/index.html?${params.toString()}`, {
      type: 'borderless',
      titleBar: false,
      transparent: true,
      alwaysOnTop: true,
      alwaysOnTopLevel: 'screen-saver',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: true,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      visibleOnAllWorkspaces: true,
      visibleOnFullScreen: true,
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    })

    if (!childWindow) {
      throw new Error('区域选择窗口创建失败。')
    }

    await Promise.allSettled([
      childWindow.setAlwaysOnTop(true, 'screen-saver'),
      childWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }),
      childWindow.setBounds(display.bounds)
    ])

    return new Promise<Region | null>((resolve) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        void childWindow.close().catch(() => {})
        resolve(null)
      }, 120000)

      const cleanup = mulbyWindow.onChildMessage((channel: string, payload: unknown) => {
        if (channel !== 'region-selected' && channel !== 'region-cancelled') return
        window.clearTimeout(timeout)
        cleanup?.()
        void childWindow.close().catch(() => {})
        resolve(channel === 'region-selected' ? (payload as Region) : null)
      })
    })
  }, [getDisplayFallback, mulbyWindow])

  const ensureRegion = useCallback(async () => {
    if (selectedRegion) return selectedRegion
    setNotice('请拖拽选择录制区域。')
    const region = await selectRegion()
    if (!region) {
      throw new Error('已取消区域选择。')
    }
    setSelectedRegion(region)
    return region
  }, [selectRegion, selectedRegion])

  const startOverlay = useCallback(async () => {
    const overlayEnabled = settings.overlay.mouseTrail || settings.overlay.clickEffect || settings.overlay.keystroke
    if (!overlayEnabled) return () => {}

    const target = overlayTargetRef.current ?? displayToOverlayTarget(await getDisplayForSource(activeScreenSource))
    const params = new URLSearchParams({
      view: 'overlay',
      config: encodeURIComponent(JSON.stringify(settings.overlay)),
      inputThrottleMs: String(OVERLAY_INPUT_THROTTLE_MS),
      displayId: String(target.displayId ?? ''),
      displayX: String(target.x),
      displayY: String(target.y),
      displayWidth: String(target.width),
      displayHeight: String(target.height),
      scaleFactor: String(target.scaleFactor ?? 1)
    })
    const childWindow = await mulbyWindow.create(`/index.html?${params.toString()}`, {
      type: 'borderless',
      titleBar: false,
      transparent: true,
      alwaysOnTop: true,
      alwaysOnTopLevel: 'screen-saver',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: true,
      focusable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      visibleOnAllWorkspaces: true,
      visibleOnFullScreen: true,
      ignoreMouseEvents: true,
      forwardMouseEvents: true,
      x: target.x,
      y: target.y,
      width: target.width,
      height: target.height
    })

    if (!childWindow) {
      setNotice('Overlay 已跳过：覆盖窗口创建失败。')
      return () => {}
    }

    await Promise.allSettled([
      childWindow.setBounds({ x: target.x, y: target.y, width: target.width, height: target.height }),
      childWindow.setAlwaysOnTop(true, 'screen-saver'),
      childWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }),
      childWindow.setIgnoreMouseEvents(true, { forward: true }),
      childWindow.showInactive()
    ])

    const disposeOverlayStatus = mulbyWindow.onChildMessage((channel: string, payload: unknown) => {
      if (channel === 'overlay-status' && typeof payload === 'string') {
        setNotice(payload)
      }
    })
    setNotice(`Overlay 已显示，覆盖 ${Math.round(target.width)} x ${Math.round(target.height)}。`)

    return () => {
      disposeOverlayStatus?.()
      void childWindow.destroy().catch(() => {})
    }
  }, [activeScreenSource, getDisplayForSource, mulbyWindow, settings.overlay])

  const buildRecordingStream = useCallback(async () => {
    let videoBundle: StreamBundle

    if (settings.mode === 'fullscreen') {
      overlayTargetRef.current = displayToOverlayTarget(await getDisplayForSource(activeScreenSource))
      videoBundle = await createSourceStream(activeScreenSource?.id ?? '')
    } else if (settings.mode === 'window') {
      overlayTargetRef.current = displayToOverlayTarget(await getDisplayForSource(activeWindowSource))
      const sourceBundle = await createSourceStream(activeWindowSource?.id ?? '')
      videoBundle = isOverlayEnabled(settings.overlay)
        ? await createWindowCompositedStream(activeWindowSource, sourceBundle.stream, sourceBundle.cleanup)
        : sourceBundle
    } else {
      const region = await ensureRegion()
      overlayTargetRef.current = displayToOverlayTarget(await getDisplayForRegion(region))
      videoBundle = await createRegionStream(region)
    }

    let finalStream = videoBundle.stream
    const sourceCleanup = videoBundle.cleanup ?? null
    cleanupRef.current = sourceCleanup

    if (settings.microphone) {
      const microphoneStream = await getMicrophoneStream()
      micStreamRef.current = microphoneStream

      if (finalStream.getAudioTracks().length > 0) {
        const mixedBundle = mixAudioStreams(finalStream, microphoneStream)
        finalStream = mixedBundle.stream
        cleanupRef.current = () => {
          sourceCleanup?.()
          mixedBundle.cleanup()
        }
      } else {
        microphoneStream.getAudioTracks().forEach((track) => finalStream.addTrack(track))
      }
    }

    return finalStream
  }, [
    activeScreenSource?.id,
    activeWindowSource?.id,
    activeWindowSource,
    createWindowCompositedStream,
    createRegionStream,
    createSourceStream,
    ensureRegion,
    getDisplayForRegion,
    getDisplayForSource,
    getMicrophoneStream,
    mixAudioStreams,
    activeScreenSource,
    settings.microphone,
    settings.mode,
    settings.overlay
  ])

  const finalizeRecording = useCallback(
    async (blob: Blob) => {
      const timestamp = makeTimestamp()
      const buffer = await blob.arrayBuffer()
      const tempDir = await system.getPath('temp')
      const tempWebm = joinPath(tempDir, `mulby-recording-${timestamp}.webm`)
      const tempMp4 = joinPath(tempDir, `mulby-recording-${timestamp}.mp4`)

      setMetrics((current) => ({ ...current, progressLabel: '写入临时文件' }))
      await filesystem.writeFile(tempWebm, buffer)

      try {
        if (!ffmpeg?.isAvailable || !ffmpeg?.download || !ffmpeg?.run) {
          throw new Error('FFmpeg API 不可用。')
        }

        const available = await ffmpeg.isAvailable()
        if (!available) {
          setMetrics((current) => ({ ...current, progressLabel: '下载 FFmpeg' }))
          const result = await ffmpeg.download((progress: { phase?: string; percent?: number }) => {
            const percent = typeof progress.percent === 'number' ? `${Math.round(progress.percent)}%` : ''
            setMetrics((current) => ({ ...current, progressLabel: `下载 FFmpeg ${percent}`.trim() }))
          })
          if (!result?.success) {
            throw new Error(result?.error || 'FFmpeg 下载失败。')
          }
        }

        setMetrics((current) => ({ ...current, progressLabel: '转码为 MP4' }))
        const task = ffmpeg.run(
          [
            '-i',
            tempWebm,
            '-c:v',
            'libx264',
            '-preset',
            'fast',
            '-crf',
            '23',
            '-tag:v',
            'avc1',
            '-movflags',
            'faststart',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-map',
            '0:v',
            '-map',
            '0:a?',
            tempMp4
          ],
          (progress: { percent?: number; time?: string }) => {
            const percent = typeof progress.percent === 'number' ? `${Math.round(progress.percent)}%` : progress.time ?? ''
            setMetrics((current) => ({ ...current, progressLabel: `转码中 ${percent}`.trim() }))
          }
        )
        await task.promise

        const savePath = await dialog.showSaveDialog({
          title: '保存录屏',
          defaultPath: `录屏-${timestamp}.mp4`,
          buttonLabel: '保存',
          filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
        })

        if (savePath) {
          await filesystem.copy(tempMp4, savePath)
          setMetrics((current) => ({ ...current, progressLabel: '已保存', lastOutputPath: savePath }))
          notification.show('录屏已保存', 'success')
        } else {
          setMetrics((current) => ({ ...current, progressLabel: '已取消保存' }))
          notification.show('已取消保存录屏', 'warning')
        }
      } catch (error) {
        console.warn('[screen-recorder] mp4 conversion failed, fallback to webm', error)
        const savePath = await dialog.showSaveDialog({
          title: '保存 WebM 录屏',
          defaultPath: `录屏-${timestamp}.webm`,
          buttonLabel: '保存',
          filters: [{ name: 'WebM 视频', extensions: ['webm'] }]
        })
        if (savePath) {
          await filesystem.writeFile(savePath, buffer)
          setMetrics((current) => ({ ...current, progressLabel: '已保存 WebM', lastOutputPath: savePath }))
          notification.show('MP4 转码不可用，已保存 WebM', 'warning')
        } else {
          setMetrics((current) => ({ ...current, progressLabel: '已取消保存' }))
        }
      } finally {
        await Promise.all([
          filesystem.unlink(tempWebm).catch(() => {}),
          filesystem.unlink(tempMp4).catch(() => {})
        ])
      }
    },
    [dialog, ffmpeg, filesystem, notification, system]
  )

  const startDurationTimer = useCallback(() => {
    if (durationTimerRef.current) window.clearInterval(durationTimerRef.current)
    startedAtMsRef.current = getClockNow()

    const updateDuration = () => {
      const elapsed = getElapsedDurationSec()
      setMetrics((current) => ({ ...current, durationSec: elapsed }))
      mulbyWindow.invalidate?.()
      if (autoStopSeconds > 0 && elapsed >= autoStopSeconds && statusRef.current === 'recording') {
        stopDurationTimer()
        setStatus('processing')
        setMetrics((current) => ({ ...current, progressLabel: '正在整理录制数据' }))
        recorderRef.current?.stop()
      }
    }

    updateDuration()
    durationTimerRef.current = window.setInterval(updateDuration, 1000)
  }, [autoStopSeconds, getElapsedDurationSec, mulbyWindow, stopDurationTimer])

  const startRecording = useCallback(async () => {
    if (!canStart) return

    cancelStartRef.current = false
    chunksRef.current = []
    startedAtMsRef.current = 0
    accumulatedDurationMsRef.current = 0
    setErrorMessage('')
    setMetrics(EMPTY_METRICS)
    setStatus('preparing')
    setNotice('正在准备录制源。')

    try {
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('当前运行环境不支持 MediaRecorder。')
      }

      disableControlPanelThrottling()

      if (settings.overlay.mouseTrail || settings.overlay.clickEffect || settings.overlay.keystroke) {
        const trusted = await permission?.isAccessibilityTrusted?.().catch(() => true)
        if (trusted === false) {
          setNotice('请在系统设置中授予 Mulby 辅助功能权限，以启用鼠标和键盘效果。')
        }
      }

      const stream = await buildRecordingStream()
      streamRef.current = stream

      if (cancelStartRef.current) {
        cleanupSession()
        setStatus('idle')
        return
      }

      if (settings.startDelay > 0) {
        setStatus('countdown')
        for (let remaining = settings.startDelay; remaining > 0; remaining -= 1) {
          if (cancelStartRef.current) {
            cleanupSession()
            setCountdown(0)
            setStatus('idle')
            return
          }
          setCountdown(remaining)
          mulbyWindow.invalidate?.()
          await sleep(1000)
        }
        setCountdown(0)
      }

      if (cancelStartRef.current) {
        cleanupSession()
        setStatus('idle')
        return
      }

      const useVisibleOverlay = settings.mode !== 'window' && isOverlayEnabled(settings.overlay)
      if (useVisibleOverlay) {
        setStatus('preparing')
        setNotice('正在显示 Overlay。')
        const overlayCleanup = await startOverlay()
        if (cancelStartRef.current) {
          overlayCleanup()
          cleanupSession()
          setStatus('idle')
          return
        }
        overlayCleanupRef.current = overlayCleanup
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: getSupportedMimeType(),
        videoBitsPerSecond: settings.bitrateMbps * 1_000_000
      })

      recorder.ondataavailable = (event) => {
        if (event.data.size <= 0) return
        chunksRef.current.push(event.data)
        const elapsed = getElapsedDurationSec()
        setMetrics((current) => ({
          ...current,
          durationSec: Math.max(current.durationSec, elapsed),
          fileSize: current.fileSize + event.data.size
        }))
        mulbyWindow.invalidate?.()
      }

      recorder.onerror = () => {
        restoreControlPanelThrottling()
        setErrorMessage('录制过程中发生错误。')
        setStatus('error')
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        cleanupSession()
        void finalizeRecording(blob)
          .then(() => {
            setStatus('complete')
          })
          .catch((error: unknown) => {
            setErrorMessage(`处理录屏失败：${toErrorMessage(error)}`)
            notification.show('处理录屏失败', 'error')
            setStatus('error')
          })
      }

      recorderRef.current = recorder
      resetCompositeOverlayRef.current?.()
      recorder.start(1000)
      setStatus('recording')
      setNotice('录制中。')
      startDurationTimer()
    } catch (error) {
      cleanupSession()
      const message = toErrorMessage(error)
      setErrorMessage(message)
      setStatus('error')
      notification.show(message, 'error')
    }
  }, [
    buildRecordingStream,
    canStart,
    cleanupSession,
    disableControlPanelThrottling,
    finalizeRecording,
    getElapsedDurationSec,
    mulbyWindow,
    notification,
    permission,
    restoreControlPanelThrottling,
    settings.bitrateMbps,
    settings.mode,
    settings.overlay.clickEffect,
    settings.overlay.keystroke,
    settings.overlay.mouseTrail,
    settings.overlay,
    settings.startDelay,
    startDurationTimer,
    startOverlay
  ])

  const stopRecording = useCallback(() => {
    if (status === 'preparing' || status === 'countdown') {
      cancelStartRef.current = true
      cleanupSession()
      setCountdown(0)
      setStatus('idle')
      return
    }

    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    stopDurationTimer()
    setStatus('processing')
    setMetrics((current) => ({ ...current, progressLabel: '正在整理录制数据' }))
    recorder.stop()
  }, [cleanupSession, status, stopDurationTimer])

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'recording') return
    recorder.pause()
    stopDurationTimer()
    setStatus('paused')
    setNotice('录制已暂停。')
  }, [stopDurationTimer])

  const resumeRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== 'paused') return
    recorder.resume()
    setStatus('recording')
    setNotice('录制中。')
    startDurationTimer()
  }, [startDurationTimer])

  const handleRegionPick = useCallback(async () => {
    try {
      const region = await selectRegion()
      if (!region) {
        setNotice('已取消区域选择。')
        return
      }
      setSelectedRegion(region)
      updateSetting('mode', 'region')
      setNotice(`已选择区域 ${Math.round(region.width)} x ${Math.round(region.height)}。`)
    } catch (error) {
      setErrorMessage(`区域选择失败：${toErrorMessage(error)}`)
    }
  }, [selectRegion, updateSetting])

  const openLastOutput = useCallback(() => {
    if (!metrics.lastOutputPath) return
    void window.mulby?.shell?.showItemInFolder?.(metrics.lastOutputPath)
  }, [metrics.lastOutputPath])

  return (
    <div className="recorder-shell">
      <header className="titlebar">
        <div className="titlebar-drag">
          <span className="app-mark">
            <Film size={18} />
          </span>
          <div>
            <h1>录屏助手</h1>
            <p>{status === 'recording' ? '正在录制屏幕' : '屏幕、窗口和区域录制'}</p>
          </div>
        </div>
        <div className="window-actions">
          <button className="icon-button" title="刷新录制源" onClick={refreshSources} disabled={sourcesLoading || isBusy}>
            <RefreshCcw size={15} className={sourcesLoading ? 'spin' : ''} />
          </button>
          <button className="icon-button" title="最小化" onClick={() => mulbyWindow.minimize?.()}>
            <Minus size={15} />
          </button>
          <button className="icon-button danger" title="关闭" onClick={() => mulbyWindow.close?.()}>
            <X size={15} />
          </button>
        </div>
      </header>

      <main className="panel-scroll">
        <section className="status-strip" data-status={status}>
          <div className="record-dot" />
          <div>
            <strong>{statusLabel(status, countdown)}</strong>
            <span>{notice}</span>
          </div>
          <time>{formatDuration(metrics.durationSec)}</time>
        </section>

        {errorMessage ? <div className="notice error">{errorMessage}</div> : null}

        {canStart ? (
          <>
            <section className="section-block">
              <div className="section-title">
                <Video size={15} />
                <span>录制模式</span>
              </div>
              <div className="mode-grid">
                {MODE_OPTIONS.map((mode) => {
                  const Icon = mode.icon
                  return (
                    <button
                      key={mode.id}
                      className={`mode-button ${settings.mode === mode.id ? 'active' : ''}`}
                      onClick={() => updateSetting('mode', mode.id)}
                    >
                      <Icon size={18} />
                      <span>{mode.label}</span>
                      <small>{mode.description}</small>
                    </button>
                  )
                })}
              </div>
            </section>

            {shouldShowSources ? (
              <section className="section-block">
                <div className="section-title">
                  {settings.mode === 'fullscreen' ? <Monitor size={15} /> : <AppWindow size={15} />}
                  <span>{settings.mode === 'fullscreen' ? '显示器' : '窗口'}</span>
                </div>
                <SourcePicker
                  sources={settings.mode === 'fullscreen' ? screenSources : windowSources}
                  value={settings.mode === 'fullscreen' ? settings.displaySourceId : settings.windowSourceId}
                  onChange={(sourceId) =>
                    settings.mode === 'fullscreen'
                      ? updateSetting('displaySourceId', sourceId)
                      : updateSetting('windowSourceId', sourceId)
                  }
                  emptyLabel={settings.mode === 'fullscreen' ? '未发现屏幕源' : '未发现窗口源'}
                />
              </section>
            ) : (
              <section className="section-block">
                <div className="section-title">
                  <Crop size={15} />
                  <span>录制区域</span>
                </div>
                <button className="region-button" onClick={handleRegionPick}>
                  <Crop size={17} />
                  <span>{selectedRegion ? `${Math.round(selectedRegion.width)} x ${Math.round(selectedRegion.height)}` : '选择录制区域'}</span>
                  <ChevronDown size={15} />
                </button>
              </section>
            )}

            <section className="section-block two-column">
              <ToggleRow
                icon={<Volume2 size={16} />}
                label="系统声音"
                checked={settings.systemAudio}
                onChange={(checked) => updateSetting('systemAudio', checked)}
              />
              <ToggleRow
                icon={<Mic size={16} />}
                label="麦克风"
                checked={settings.microphone}
                onChange={(checked) => updateSetting('microphone', checked)}
              />
            </section>

            <section className="section-block">
              <div className="section-title">
                <MousePointer2 size={15} />
                <span>Overlay 效果</span>
              </div>
              <div className="toggle-list">
                <ToggleRow
                  icon={<MousePointer2 size={16} />}
                  label="鼠标轨迹"
                  checked={settings.overlay.mouseTrail}
                  onChange={(checked) => updateOverlaySetting('mouseTrail', checked)}
                />
                <ToggleRow
                  icon={<MousePointer2 size={16} />}
                  label="点击标记"
                  checked={settings.overlay.clickEffect}
                  onChange={(checked) => updateOverlaySetting('clickEffect', checked)}
                />
                <ToggleRow
                  icon={<Keyboard size={16} />}
                  label="键盘显示"
                  checked={settings.overlay.keystroke}
                  onChange={(checked) => updateOverlaySetting('keystroke', checked)}
                />
              </div>
              <div className="inline-grid">
                <label>
                  <span>主题</span>
                  <select
                    value={settings.overlay.clickTheme}
                    onChange={(event) => updateOverlaySetting('clickTheme', event.target.value as ClickTheme)}
                  >
                    <option value="default">默认</option>
                    <option value="minimal">极简</option>
                    <option value="fun">醒目</option>
                    <option value="professional">专业</option>
                  </select>
                </label>
                <label>
                  <span>左键标志</span>
                  <input
                    className="emoji-input"
                    value={settings.overlay.leftEmoji}
                    maxLength={8}
                    placeholder="👆"
                    onMouseDown={(event) => requestInputFocus(event.currentTarget)}
                    onChange={(event) => updateOverlaySetting('leftEmoji', event.target.value)}
                  />
                </label>
              </div>
              <div className="inline-grid">
                <label>
                  <span>右键标志</span>
                  <input
                    className="emoji-input"
                    value={settings.overlay.rightEmoji}
                    maxLength={8}
                    placeholder="👉"
                    onMouseDown={(event) => requestInputFocus(event.currentTarget)}
                    onChange={(event) => updateOverlaySetting('rightEmoji', event.target.value)}
                  />
                </label>
                <label>
                  <span>键盘位置</span>
                  <select
                    value={settings.overlay.keyPosition}
                    onChange={(event) => updateOverlaySetting('keyPosition', event.target.value as KeystrokePosition)}
                  >
                    <option value="bottom-center">底部居中</option>
                    <option value="bottom-left">左下</option>
                    <option value="bottom-right">右下</option>
                    <option value="top-center">顶部居中</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="section-block">
              <div className="section-title">
                <Settings2 size={15} />
                <span>输出参数</span>
              </div>
              <div className="segmented-row">
                <span>帧率</span>
                <SegmentedControl
                  values={[30, 60]}
                  value={settings.frameRate}
                  label={(value) => `${value}fps`}
                  onChange={(value) => updateSetting('frameRate', value as 30 | 60)}
                />
              </div>
              <div className="segmented-row">
                <span>码率</span>
                <SegmentedControl
                  values={BITRATE_OPTIONS}
                  value={settings.bitrateMbps}
                  label={(value) => `${value}M`}
                  onChange={(value) => updateSetting('bitrateMbps', value)}
                />
              </div>
              <div className="segmented-row">
                <span>开录倒计时</span>
                <SegmentedControl
                  values={START_DELAY_OPTIONS}
                  value={settings.startDelay}
                  label={(value) => (value === 0 ? '无' : `${value}s`)}
                  onChange={(value) => updateSetting('startDelay', value as 0 | 3 | 5)}
                />
              </div>
            </section>

            <section className="section-block">
              <ToggleRow
                icon={<Timer size={16} />}
                label="自动停止"
                checked={settings.autoStopEnabled}
                onChange={(checked) => updateSetting('autoStopEnabled', checked)}
              />
              {settings.autoStopEnabled ? (
                <SegmentedControl
                  values={AUTO_STOP_OPTIONS}
                  value={settings.autoStopMinutes}
                  label={(value) => `${value}m`}
                  onChange={(value) => updateSetting('autoStopMinutes', value)}
                />
              ) : null}
            </section>
          </>
        ) : (
          <RecordingState
            metrics={metrics}
            autoStopSeconds={autoStopSeconds}
            settings={settings}
            status={status}
            onOpenLastOutput={openLastOutput}
          />
        )}
      </main>

      <footer className="control-bar">
        {isRecording ? (
          <>
            <button className="secondary-action" onClick={pauseRecording}>
              <Pause size={16} />
              暂停
            </button>
            <button className="stop-action" onClick={stopRecording}>
              <Square size={16} />
              停止
            </button>
          </>
        ) : isPaused ? (
          <>
            <button className="primary-action" onClick={resumeRecording}>
              <Play size={16} />
              继续
            </button>
            <button className="stop-action" onClick={stopRecording}>
              <Square size={16} />
              停止
            </button>
          </>
        ) : isBusy ? (
          <button className="stop-action full" onClick={stopRecording}>
            <X size={16} />
            取消
          </button>
        ) : (
          <button className="primary-action full" onClick={startRecording} disabled={!canStart || sourcesLoading}>
            <Play size={16} />
            开始录制
          </button>
        )}
      </footer>
    </div>
  )
}

function statusLabel(status: RecorderStatus, countdown: number) {
  switch (status) {
    case 'preparing':
      return '准备中'
    case 'countdown':
      return `${countdown}s 后开始`
    case 'recording':
      return '录制中'
    case 'paused':
      return '已暂停'
    case 'processing':
      return '处理中'
    case 'complete':
      return '录制完成'
    case 'error':
      return '需要处理'
    case 'idle':
    default:
      return '待录制'
  }
}

function SourcePicker({
  emptyLabel,
  onChange,
  sources,
  value
}: {
  emptyLabel: string
  onChange(sourceId: string): void
  sources: CaptureSource[]
  value: string
}) {
  if (sources.length === 0) {
    return <div className="empty-source">{emptyLabel}</div>
  }

  return (
    <div className="source-list">
      {sources.slice(0, 5).map((source) => (
        <button
          key={source.id}
          className={`source-row ${source.id === value ? 'active' : ''}`}
          onClick={() => onChange(source.id)}
        >
          <img src={source.thumbnailDataUrl} alt="" />
          <span>{source.name}</span>
          {source.id === value ? <Check size={15} /> : null}
        </button>
      ))}
    </div>
  )
}

function ToggleRow({
  checked,
  icon,
  label,
  onChange
}: {
  checked: boolean
  icon: React.ReactNode
  label: string
  onChange(checked: boolean): void
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">
        {icon}
        {label}
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch" />
    </label>
  )
}

function SegmentedControl<T extends string | number>({
  label,
  onChange,
  value,
  values
}: {
  label(value: T): string
  onChange(value: T): void
  value: T
  values: readonly T[]
}) {
  return (
    <div className="segmented">
      {values.map((item) => (
        <button key={String(item)} className={item === value ? 'active' : ''} onClick={() => onChange(item)}>
          {label(item)}
        </button>
      ))}
    </div>
  )
}

function RecordingState({
  autoStopSeconds,
  metrics,
  onOpenLastOutput,
  settings,
  status
}: {
  autoStopSeconds: number
  metrics: RecorderMetrics
  onOpenLastOutput(): void
  settings: RecorderSettings
  status: RecorderStatus
}) {
  const remaining = autoStopSeconds > 0 ? Math.max(0, autoStopSeconds - metrics.durationSec) : 0

  return (
    <section className="recording-card">
      <div className="recording-time">
        <Clock3 size={18} />
        <strong>{formatDuration(metrics.durationSec)}</strong>
        {autoStopSeconds > 0 ? <span>剩余 {formatDuration(remaining)}</span> : null}
      </div>
      <div className="recording-stats">
        <span>
          <Gauge size={14} />
          {formatFileSize(metrics.fileSize)}
        </span>
        <span>
          <Video size={14} />
          {settings.frameRate}fps / {settings.bitrateMbps}M
        </span>
        <span>
          <Volume2 size={14} />
          {settings.systemAudio ? '系统音' : '无系统音'}
        </span>
        <span>
          <Mic size={14} />
          {settings.microphone ? '麦克风' : '无麦克风'}
        </span>
      </div>
      {metrics.progressLabel ? (
        <div className="processing-line">
          {status === 'processing' ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
          {metrics.progressLabel}
        </div>
      ) : null}
      {metrics.lastOutputPath ? (
        <button className="region-button" onClick={onOpenLastOutput}>
          <Save size={16} />
          <span>{metrics.lastOutputPath}</span>
          <ChevronDown size={15} />
        </button>
      ) : null}
    </section>
  )
}

function RegionSelector() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const displayX = Number(params.get('displayX') ?? 0)
  const displayY = Number(params.get('displayY') ?? 0)
  const displayId = Number(params.get('displayId') ?? 0)
  const scaleFactor = Number(params.get('scaleFactor') ?? 1)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null)

  const rect = useMemo(() => {
    if (!dragStart || !dragEnd) return null
    const x = Math.min(dragStart.x, dragEnd.x)
    const y = Math.min(dragStart.y, dragEnd.y)
    const width = Math.abs(dragEnd.x - dragStart.x)
    const height = Math.abs(dragEnd.y - dragStart.y)
    return { x, y, width, height }
  }, [dragEnd, dragStart])

  const cancel = useCallback(() => {
    window.mulby?.window?.sendToParent?.('region-cancelled')
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancel])

  const commit = useCallback(() => {
    if (!rect || rect.width < 24 || rect.height < 24) {
      cancel()
      return
    }
    window.mulby?.window?.sendToParent?.('region-selected', {
      x: displayX + Math.round(rect.x),
      y: displayY + Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      displayId,
      scaleFactor
    })
  }, [cancel, displayId, displayX, displayY, rect, scaleFactor])

  return (
    <div
      className="region-root"
      onPointerDown={(event) => {
        setDragStart({ x: event.clientX, y: event.clientY })
        setDragEnd({ x: event.clientX, y: event.clientY })
      }}
      onPointerMove={(event) => {
        if (dragStart) setDragEnd({ x: event.clientX, y: event.clientY })
      }}
      onPointerUp={commit}
    >
      <div className="region-hint">拖拽选择录制区域，按 Escape 取消</div>
      {rect ? (
        <div
          className="region-selection"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height
          }}
        >
          <span>
            {Math.round(rect.width)} x {Math.round(rect.height)}
          </span>
        </div>
      ) : null}
      <button className="region-cancel" onClick={cancel}>
        <X size={15} />
        取消
      </button>
    </div>
  )
}

function OverlayView() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const config = useMemo<OverlayConfig>(() => {
    const encoded = params.get('config')
    if (!encoded) return DEFAULT_SETTINGS.overlay
    try {
      return mergeSettings({ overlay: JSON.parse(decodeURIComponent(encoded)) }).overlay
    } catch {
      return DEFAULT_SETTINGS.overlay
    }
  }, [params])
  const overlayBounds = useMemo(
    () => ({
      x: Number(params.get('displayX') ?? 0),
      y: Number(params.get('displayY') ?? 0),
      width: Number(params.get('displayWidth') ?? window.innerWidth),
      height: Number(params.get('displayHeight') ?? window.innerHeight),
      displayId: params.get('displayId') ?? ''
    }),
    [params]
  )
  const overlayDebug = params.get('debug') === '1'
  const inputThrottleMs = Math.max(16, Number(params.get('inputThrottleMs') ?? OVERLAY_INPUT_THROTTLE_MS) || OVERLAY_INPUT_THROTTLE_MS)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const trailRef = useRef<TrailPoint[]>([])
  const clicksRef = useRef<ClickEffect[]>([])
  const drawRef = useRef<(() => void) | null>(null)
  const keysRef = useRef<KeyBubble[]>([])
  const keyRenderFrameRef = useRef(0)
  const lastKeyRef = useRef({ label: '', timestamp: 0 })
  const [keys, setKeys] = useState<KeyBubble[]>([])

  const scheduleKeysRender = useCallback(() => {
    if (keyRenderFrameRef.current) return
    keyRenderFrameRef.current = window.requestAnimationFrame(() => {
      keyRenderFrameRef.current = 0
      setKeys([...keysRef.current])
    })
  }, [])

  useEffect(() => {
    return () => {
      if (keyRenderFrameRef.current) {
        window.cancelAnimationFrame(keyRenderFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d', { alpha: true, desynchronized: true })
    if (!canvas || !context) return

    let animationId = 0
    let canvasWidth = window.innerWidth
    let canvasHeight = window.innerHeight

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, OVERLAY_CANVAS_DPR_CAP)
      canvasWidth = window.innerWidth
      canvasHeight = window.innerHeight
      canvas.width = Math.max(1, Math.round(canvasWidth * dpr))
      canvas.height = Math.max(1, Math.round(canvasHeight * dpr))
      canvas.style.width = `${canvasWidth}px`
      canvas.style.height = `${canvasHeight}px`
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const drawClickMarker = (click: ClickEffect) => {
      const radius = config.clickTheme === 'minimal' ? 16 : 18

      context.strokeStyle = `rgb(${click.color})`
      context.lineWidth = config.clickTheme === 'minimal' ? 2 : 3
      context.beginPath()
      context.arc(click.x, click.y, radius, 0, Math.PI * 2)
      context.stroke()

      if (config.clickTheme !== 'minimal' && click.label) {
        context.fillStyle = `rgb(${click.color})`
        context.font = '600 20px "Apple Color Emoji", "Segoe UI Emoji", -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(click.label, click.x, click.y - 42)
      }
    }

    const hasVisibleOverlay = () =>
      (config.mouseTrail && trailRef.current.length > 1) || (config.clickEffect && clicksRef.current.length > 0)

    const draw = () => {
      animationId = 0
      const now = Date.now()
      pruneExpiredItems(trailRef.current, now, TRAIL_POINT_TTL_MS)
      pruneExpiredItems(clicksRef.current, now, CLICK_MARKER_TTL_MS)

      context.clearRect(0, 0, canvasWidth, canvasHeight)

      if (config.mouseTrail) {
        context.lineCap = 'round'
        context.lineJoin = 'round'
        for (let index = 1; index < trailRef.current.length; index += 1) {
          const previous = trailRef.current[index - 1]
          const point = trailRef.current[index]
          const age = now - point.timestamp
          const alpha = Math.max(0, 1 - age / TRAIL_POINT_TTL_MS)
          context.strokeStyle = `rgba(31, 122, 140, ${alpha * 0.72})`
          context.lineWidth = 3
          context.beginPath()
          context.moveTo(previous.x, previous.y)
          context.lineTo(point.x, point.y)
          context.stroke()
        }
      }

      if (config.clickEffect) {
        clicksRef.current.forEach(drawClickMarker)
      }

      if (hasVisibleOverlay()) {
        animationId = window.requestAnimationFrame(draw)
      }
    }

    const scheduleDraw = () => {
      if (animationId) return
      animationId = window.requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    drawRef.current = scheduleDraw
    scheduleDraw()

    return () => {
      window.removeEventListener('resize', resize)
      if (drawRef.current === scheduleDraw) {
        drawRef.current = null
      }
      if (animationId) {
        window.cancelAnimationFrame(animationId)
      }
    }
  }, [config.clickEffect, config.clickTheme, config.mouseTrail])

  useEffect(() => {
    const toLocalPoint = (event: InputMonitorEvent) => {
      if (typeof event.x !== 'number' || typeof event.y !== 'number') return null

      const localX = event.x - overlayBounds.x
      const localY = event.y - overlayBounds.y
      const tolerance = 96
      const insideDisplay =
        localX >= -tolerance &&
        localY >= -tolerance &&
        localX <= overlayBounds.width + tolerance &&
        localY <= overlayBounds.height + tolerance

      if (insideDisplay) {
        return { x: localX, y: localY }
      }

      const alreadyLocal =
        event.x >= -tolerance &&
        event.y >= -tolerance &&
        event.x <= window.innerWidth + tolerance &&
        event.y <= window.innerHeight + tolerance

      return alreadyLocal ? { x: event.x, y: event.y } : null
    }

    const sendStatus = (message: string) => {
      window.mulby?.window?.sendToParent?.('overlay-status', message)
    }

    const appendTrailPoint = (x: number, y: number, now: number) => {
      const trail = trailRef.current
      const previous = trail[trail.length - 1]
      if (previous) {
        const dx = x - previous.x
        const dy = y - previous.y
        if (dx * dx + dy * dy < 4) return
      }
      trail.push({ x, y, timestamp: now })
      trimOldest(trail, MAX_TRAIL_POINTS)
      drawRef.current?.()
    }

    const appendClickMarker = (event: InputMonitorEvent, x: number, y: number, now: number) => {
      const isRight = event.button === 'right' || event.button === '2'
      const color = config.clickTheme === 'professional' ? '75, 85, 99' : isRight ? '209, 73, 91' : '31, 122, 140'
      const label =
        config.clickTheme === 'minimal' ? '' : normalizeClickMarkerLabel(isRight ? config.rightEmoji : config.leftEmoji, isRight ? 'R' : 'L')

      clicksRef.current.push({
        id: `${now}-${clicksRef.current.length}`,
        x,
        y,
        button: event.button ?? 'left',
        color,
        label,
        timestamp: now
      })
      trimOldest(clicksRef.current, MAX_CLICK_MARKERS)
      drawRef.current?.()
    }

    const appendKeyBubble = (event: InputMonitorEvent, now: number) => {
      const label = buildShortcutLabel(event)
      if (!label) return

      const lastKey = lastKeyRef.current
      if (lastKey.label === label && now - lastKey.timestamp < KEY_REPEAT_MERGE_MS) return
      lastKeyRef.current = { label, timestamp: now }

      keysRef.current.push({ id: `${now}-${label}`, label, timestamp: now })
      trimOldest(keysRef.current, MAX_KEY_BUBBLES)
      scheduleKeysRender()
    }

    const handleInputEvent = (event: InputMonitorEvent) => {
      const now = Date.now()
      const type = (event.type ?? '').toLowerCase()

      if (type === 'mousemove' && config.mouseTrail) {
        const point = toLocalPoint(event)
        if (point) appendTrailPoint(point.x, point.y, now)
        return
      }

      if (type === 'mousedown' && config.clickEffect) {
        const point = toLocalPoint(event)
        if (point) appendClickMarker(event, point.x, point.y, now)
        return
      }

      if (config.keystroke && (event.key || event.keyCode) && type === 'keydown') {
        appendKeyBubble(event, now)
      }
    }

    const disposeChildMessage = window.mulby?.window?.onChildMessage?.((channel: string, ...args: unknown[]) => {
      if (channel !== 'input-event') return
      handleInputEvent(args[0] as InputMonitorEvent)
    })

    const parseMessage = (event: MessageEvent) => {
      const data = event.data as { channel?: string; args?: unknown[]; payload?: unknown } | unknown[]
      if (Array.isArray(data) && data[0] === 'input-event') {
        handleInputEvent(data[1] as InputMonitorEvent)
        return
      }
      if (!Array.isArray(data) && data && typeof data === 'object' && 'channel' in data && data.channel === 'input-event') {
        const payload = data.payload ?? data.args?.[0]
        handleInputEvent(payload as InputMonitorEvent)
      }
    }

    const inputMonitor = window.mulby?.inputMonitor
    let cancelled = false
    let sessionId: string | null = null
    let disposeInput: Disposable | undefined

    async function startInputMonitor() {
      if (!inputMonitor) {
        sendStatus('Overlay 已显示，但当前 Mulby 运行时未暴露 inputMonitor。')
        return
      }

      try {
        const available = await inputMonitor.isAvailable()
        if (!available) {
          sendStatus('Overlay 已显示，但全局输入监听原生模块不可用。')
          return
        }

        const hasAccess = await inputMonitor.requireAccessibility()
        if (!hasAccess) {
          sendStatus('Overlay 已显示，但未获得辅助功能权限，无法显示点击和键盘效果。')
          return
        }

        sessionId = await inputMonitor.start({
          mouse: config.mouseTrail || config.clickEffect,
          keyboard: config.keystroke,
          throttleMs: inputThrottleMs
        })
        if (!sessionId) {
          sendStatus('Overlay 已显示，但 inputMonitor 会话启动失败。')
          return
        }

        if (cancelled) {
          await inputMonitor.stop(sessionId).catch(() => {})
          return
        }

        disposeInput = inputMonitor.onEvent(handleInputEvent)
        sendStatus(`Overlay 输入效果已启用，事件采样 ${inputThrottleMs}ms。`)
      } catch (error) {
        sendStatus(`Overlay 输入监听未启用：${toErrorMessage(error)}`)
      }
    }

    window.addEventListener('message', parseMessage)
    void startInputMonitor()

    return () => {
      cancelled = true
      disposeInput?.()
      if (sessionId && inputMonitor) {
        void inputMonitor.stop(sessionId).catch(() => {})
      }
      disposeChildMessage?.()
      window.removeEventListener('message', parseMessage)
    }
  }, [
    config.clickEffect,
    config.clickTheme,
    config.keystroke,
    config.leftEmoji,
    config.mouseTrail,
    config.rightEmoji,
    inputThrottleMs,
    overlayBounds.height,
    overlayBounds.width,
    overlayBounds.x,
    overlayBounds.y,
    scheduleKeysRender
  ])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      if (pruneExpiredItems(keysRef.current, now, KEY_BUBBLE_TTL_MS)) {
        scheduleKeysRender()
      }
    }, 300)
    return () => window.clearInterval(timer)
  }, [scheduleKeysRender])

  return (
    <div className="overlay-root">
      <canvas ref={canvasRef} />
      {overlayDebug ? (
        <div className="overlay-debug-frame" aria-hidden="true">
          <span className="overlay-corner top-left">TL</span>
          <span className="overlay-corner top-right">TR</span>
          <span className="overlay-corner bottom-left">BL</span>
          <span className="overlay-corner bottom-right">BR</span>
          <span className="overlay-debug-meta">
            {overlayBounds.displayId ? `屏幕 ${overlayBounds.displayId} · ` : ''}
            {Math.round(overlayBounds.x)}, {Math.round(overlayBounds.y)} · {Math.round(overlayBounds.width)} x{' '}
            {Math.round(overlayBounds.height)}
          </span>
        </div>
      ) : null}
      <div className={`key-bubbles ${config.keyPosition}`}>
        {keys.map((key) => (
          <span key={key.id}>{key.label}</span>
        ))}
      </div>
    </div>
  )
}

export default App
