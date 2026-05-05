# 录屏助手插件 — 实现方案

> 版本: v1.0
> 日期: 2026-05-04
> 状态: 设计稿（供插件开发者实现）

---

## 1. 产品概述

录屏助手是一个 Mulby 插件，提供 **全屏 / 窗口 / 自定义区域** 三种录制模式，并支持以下可选增强功能：

| 功能 | 说明 | 可选 |
|------|------|------|
| 鼠标轨迹录制 | 记录鼠标移动路径，绘制轨迹线 | ✅ |
| 鼠标左/右键标记 | 可视化区分左键和右键点击 | ✅ |
| 自定义鼠标效果 | 用 emoji 或自定义图标表示点击（如 👆 表示左键，✌️ 表示右键） | ✅ |
| 键盘输入记录 | 实时显示按键和组合键 | ✅ |
| 电脑声音录制 | 录制系统音频 | ✅ |
| 麦克风声音录制 | 录制麦克风旁白 | ✅ |
| 录屏倒计时自动停止 | 设定录制时长，到时自动结束 | ✅ |

---

## 2. 插件配置

### 2.1 manifest.json

```json
{
  "name": "screen-recorder",
  "version": "1.0.0",
  "displayName": "录屏助手",
  "description": "全屏/窗口/自定义区域录制，支持鼠标轨迹标记、键盘输入显示、音频录制",
  "type": "media",
  "author": "Mulby Team",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "🎬",
  "permissions": {
    "inputMonitor": true
  },
  "features": [
    {
      "code": "record",
      "explain": "录屏助手",
      "mode": "detached",
      "cmds": [
        { "type": "keyword", "value": "录屏" },
        { "type": "keyword", "value": "screen record" }
      ]
    }
  ],
  "window": {
    "width": 380,
    "height": 520,
    "type": "borderless",
    "titleBar": false,
    "alwaysOnTop": true,
    "resizable": false
  },
  "pluginSetting": {
    "single": true,
    "background": true,
    "idleTimeoutMs": "never",
    "maxRuntime": 0
  }
}
```

**关键配置说明：**
- `permissions.inputMonitor: true` — 鼠标轨迹 / 键盘显示必需
- `mode: "detached"` — 独立窗口，录屏控制面板不嵌入搜索框
- `alwaysOnTop: true` — 控制面板在录屏时保持置顶
- `background: true` — 允许后台录制（用户可以切到其他窗口操作）
- `idleTimeoutMs: "never"` — 录屏期间不自动销毁

---

## 3. 核心架构

```
┌────────────────────────────────────────────────┐
│                  插件主控制面板                     │
│   ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│   │ 模式选择  │ │ 音频设置  │ │  Overlay 设置   │  │
│   └──────────┘ └──────────┘ └────────────────┘  │
│   ┌──────────────────────────────────────────┐  │
│   │   开始录制 / 暂停 / 停止 / 倒计时        │  │
│   └──────────────────────────────────────────┘  │
└──────────────────────┬─────────────────────────┘
                       │ postMessage / IPC
            ┌──────────┴──────────┐
            │                     │
    ┌───────▼───────┐    ┌───────▼───────┐
    │  Overlay 子窗口  │    │  后端 main.js  │
    │  (透明全屏置顶)  │    │               │
    │  · 鼠标涟漪     │    │ · inputMonitor │
    │  · 轨迹线       │    │ · 事件转发     │
    │  · 键盘气泡     │    │ · 文件管理     │
    └───────────────┘    └───────────────┘
```

### 数据流

```
原生事件 → inputMonitor → 后端 main.js → IPC → 主面板
                                              ↓ postMessage
                                        Overlay 子窗口 → Canvas 渲染
```

---

## 4. 功能实现详解

### 4.1 录制模式

#### 4.1.1 全屏录制

```typescript
async function startFullScreenRecording(displayId?: string) {
  const sources = await mulby.screen.getSources({ types: ['screen'] })
  const source = displayId
    ? sources.find(s => s.displayId === displayId)
    : sources[0]

  const constraints = await mulby.screen.getMediaStreamConstraints({
    sourceId: source.id,
    audio: settings.systemAudio,  // 系统音频
    frameRate: settings.frameRate  // 默认 30fps
  })

  const videoStream = await navigator.mediaDevices.getUserMedia(constraints)
  return videoStream
}
```

#### 4.1.2 窗口录制

```typescript
async function startWindowRecording(windowId: string) {
  const constraints = await mulby.screen.getMediaStreamConstraints({
    sourceId: windowId,
    audio: settings.systemAudio,
    frameRate: settings.frameRate
  })

  const videoStream = await navigator.mediaDevices.getUserMedia(constraints)
  return videoStream
}
```

#### 4.1.3 自定义区域录制

自定义区域录制通过 **全屏采集 + Canvas 实时裁剪** 实现：

```typescript
async function startRegionRecording(region: Region) {
  // Step 1: 获取全屏流
  const fullStream = await startFullScreenRecording(region.displayId)
  const videoTrack = fullStream.getVideoTracks()[0]
  const trackSettings = videoTrack.getSettings()
  const sourceWidth = trackSettings.width!
  const sourceHeight = trackSettings.height!

  // Step 2: 创建视频元素用于读取帧
  const video = document.createElement('video')
  video.srcObject = fullStream
  video.muted = true
  await video.play()

  // Step 3: OffscreenCanvas 实时裁剪
  const canvas = new OffscreenCanvas(region.width, region.height)
  const ctx = canvas.getContext('2d')!

  // 需要考虑 Retina 等 scaleFactor
  const display = await mulby.screen.getPrimaryDisplay()
  const scale = display.scaleFactor

  function cropFrame() {
    if (!isRecording) return
    ctx.drawImage(
      video,
      region.x * scale, region.y * scale,
      region.width * scale, region.height * scale,
      0, 0,
      region.width, region.height
    )
    requestAnimationFrame(cropFrame)
  }
  cropFrame()

  // Step 4: 从 Canvas 获取裁剪后的流
  const croppedStream = (canvas as any).captureStream(settings.frameRate)
  return croppedStream
}
```

**区域选择 UI 方案**：

创建一个全屏透明子窗口用于区域选择：

```typescript
async function selectRegion(): Promise<Region | null> {
  return new Promise((resolve) => {
    const regionWindow = await mulby.window.create('region-selector', {
      type: 'borderless',
      fullscreen: true,
      transparent: true,
      alwaysOnTop: true,
      titleBar: false,
      opacity: 0.3
    })

    // 子窗口绘制十字准线和拖拽框选
    // 选择完成后通过 sendToParent 回传区域坐标
    mulby.window.onChildMessage((channel, data) => {
      if (channel === 'region-selected') {
        regionWindow.close()
        resolve(data as Region)
      }
      if (channel === 'region-cancelled') {
        regionWindow.close()
        resolve(null)
      }
    })
  })
}
```

### 4.2 音频录制

#### 4.2.1 系统音频

通过 `getMediaStreamConstraints` 的 `audio: true` 参数获取系统音频：

```typescript
const constraints = await mulby.screen.getMediaStreamConstraints({
  sourceId: source.id,
  audio: true,  // 启用系统音频
  frameRate: 30
})
```

> **平台说明**：macOS 系统音频需要第三方驱动（如 BlackHole / Soundflower），Electron 层面 `audio: true` 在 macOS 上可能不生效。Windows 上通常可以直接采集系统音频（WASAPI loopback）。

#### 4.2.2 麦克风音频

```typescript
async function getMicrophoneStream(): Promise<MediaStream | null> {
  const hasAccess = await mulby.media.hasMicrophoneAccess()
  if (!hasAccess) {
    const granted = await mulby.media.askForAccess('microphone')
    if (!granted) return null
  }
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
}
```

#### 4.2.3 音频混合

当同时录制系统音频和麦克风时，需要混合两路音频流：

```typescript
function mixAudioStreams(
  videoStream: MediaStream,
  micStream: MediaStream
): MediaStream {
  const audioContext = new AudioContext()

  // 从视频流提取系统音频
  const systemSource = audioContext.createMediaStreamSource(
    new MediaStream(videoStream.getAudioTracks())
  )

  // 麦克风音频
  const micSource = audioContext.createMediaStreamSource(micStream)

  // 混合到同一个 destination
  const destination = audioContext.createMediaStreamDestination()

  // 可以分别设置增益
  const systemGain = audioContext.createGain()
  systemGain.gain.value = 1.0
  systemSource.connect(systemGain).connect(destination)

  const micGain = audioContext.createGain()
  micGain.gain.value = 1.0
  micSource.connect(micGain).connect(destination)

  // 合成最终流：视频轨道 + 混合音频轨道
  const mixedStream = new MediaStream()
  videoStream.getVideoTracks().forEach(t => mixedStream.addTrack(t))
  destination.stream.getAudioTracks().forEach(t => mixedStream.addTrack(t))

  return mixedStream
}
```

### 4.3 鼠标轨迹与点击标记

#### 4.3.1 事件采集

```typescript
// useInputMonitor.ts
function useInputMonitor(options: InputMonitorOptions) {
  const [events, setEvents] = useState<InputEvent[]>([])
  const sessionRef = useRef<string | null>(null)

  useEffect(() => {
    if (!options.enabled) return

    let cleanup: (() => void) | undefined

    async function start() {
      const sid = await mulby.inputMonitor.start({
        mouse: options.mouse ?? true,
        keyboard: options.keyboard ?? true,
        throttleMs: options.throttleMs ?? 16
      })
      sessionRef.current = sid

      cleanup = mulby.inputMonitor.onEvent((event) => {
        setEvents(prev => {
          const next = [...prev, event]
          // 保留最近 N 个事件避免内存泄漏
          return next.length > 500 ? next.slice(-500) : next
        })
      })
    }

    start()

    return () => {
      if (sessionRef.current) mulby.inputMonitor.stop(sessionRef.current)
      cleanup?.()
    }
  }, [options.enabled])

  return events
}
```

#### 4.3.2 鼠标轨迹渲染

在 Overlay 子窗口中使用 Canvas 渲染轨迹线：

```typescript
// MouseTrail — 渐隐的轨迹线
function renderMouseTrail(ctx: CanvasRenderingContext2D, trail: Point[]) {
  if (trail.length < 2) return

  const now = Date.now()
  const FADE_DURATION = 2000 // 轨迹 2 秒后消失

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  for (let i = 1; i < trail.length; i++) {
    const age = now - trail[i].timestamp
    if (age > FADE_DURATION) continue

    const alpha = 1 - age / FADE_DURATION
    ctx.strokeStyle = `rgba(59, 130, 246, ${alpha * 0.6})`
    ctx.lineWidth = 2

    ctx.beginPath()
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y)
    ctx.lineTo(trail[i].x, trail[i].y)
    ctx.stroke()
  }
}
```

#### 4.3.3 鼠标点击标记

点击事件触发涟漪动画 + emoji/图标标记：

```typescript
interface ClickEffect {
  x: number
  y: number
  button: 'left' | 'right' | 'middle'
  timestamp: number
  emoji: string
}

function createClickEffect(event: GlobalInputEvent, config: ClickConfig): ClickEffect {
  return {
    x: event.x,
    y: event.y,
    button: event.button ?? 'left',
    timestamp: Date.now(),
    emoji: event.button === 'right'
      ? config.rightClickEmoji   // 默认 '✌️'
      : config.leftClickEmoji    // 默认 '👆'
  }
}

function renderClickEffect(
  ctx: CanvasRenderingContext2D,
  click: ClickEffect,
  config: ClickConfig
) {
  const age = Date.now() - click.timestamp
  const CLICK_DURATION = 800

  if (age > CLICK_DURATION) return

  const progress = age / CLICK_DURATION
  const alpha = 1 - progress
  const rippleRadius = 20 + progress * 30

  // 涟漪圆环
  const color = click.button === 'right'
    ? config.rightClickColor   // 默认 '#ef4444'（红色）
    : config.leftClickColor    // 默认 '#3b82f6'（蓝色）

  ctx.strokeStyle = color.replace(')', `, ${alpha})`)
                        .replace('rgb', 'rgba')
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(click.x, click.y, rippleRadius, 0, Math.PI * 2)
  ctx.stroke()

  // emoji 标记（可选）
  if (config.showEmoji) {
    ctx.globalAlpha = alpha
    ctx.font = `${24 - progress * 8}px serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(click.emoji, click.x, click.y - rippleRadius - 10)
    ctx.globalAlpha = 1
  }
}
```

#### 4.3.4 自定义鼠标效果配置

```typescript
interface ClickConfig {
  // 左键效果
  leftClickEmoji: string       // 默认 '👆'，用户可自定义
  leftClickColor: string       // 默认 'rgb(59, 130, 246)'（蓝色）

  // 右键效果
  rightClickEmoji: string      // 默认 '✌️'，用户可自定义
  rightClickColor: string      // 默认 'rgb(239, 68, 68)'（红色）

  // 双击效果
  doubleClickEmoji: string     // 默认 '👆👆'

  // 通用
  showEmoji: boolean           // 是否显示 emoji，默认 true
  showRipple: boolean          // 是否显示涟漪，默认 true
  rippleDuration: number       // 涟漪持续时间 ms，默认 800
  trailEnabled: boolean        // 是否显示轨迹线，默认 true
  trailDuration: number        // 轨迹线持续时间 ms，默认 2000
  trailColor: string           // 轨迹线颜色
}

// 预设主题
const PRESETS: Record<string, Partial<ClickConfig>> = {
  default: {
    leftClickEmoji: '👆',
    rightClickEmoji: '✌️',
    showEmoji: true,
    showRipple: true
  },
  minimal: {
    showEmoji: false,
    showRipple: true,
    rippleDuration: 500
  },
  fun: {
    leftClickEmoji: '🎯',
    rightClickEmoji: '🔥',
    doubleClickEmoji: '💥',
    showEmoji: true,
    showRipple: true
  },
  professional: {
    showEmoji: false,
    showRipple: true,
    leftClickColor: 'rgb(107, 114, 128)',
    rightClickColor: 'rgb(107, 114, 128)',
    trailEnabled: false
  }
}
```

### 4.4 键盘输入显示

```typescript
interface KeystrokeConfig {
  enabled: boolean
  position: 'bottom-center' | 'bottom-left' | 'bottom-right' | 'top-center'
  maxVisible: number     // 同时显示的最大按键数，默认 8
  fadeDelay: number       // 按键显示后多久开始消失 ms，默认 2000
  showModifiers: boolean  // 是否显示修饰键
  fontSize: number        // 字体大小，默认 16
  style: 'pill' | 'rounded' | 'minimal'  // 显示风格
}

// 键盘按键渲染组件
function KeystrokeDisplay({ events, config }: Props) {
  const activeKeys = useMemo(() => {
    const now = Date.now()
    return events
      .filter(e => e.type === 'keyDown' && e.key)
      .filter(e => now - e.timestamp < config.fadeDelay + 500)
      .slice(-config.maxVisible)
      .map(e => ({
        id: `${e.timestamp}-${e.key}`,
        key: e.key,
        modifiers: formatModifiers(e),
        timestamp: e.timestamp,
        age: now - e.timestamp
      }))
  }, [events, config])

  return (
    <div className={`keystroke-container ${config.position}`}>
      {activeKeys.map(k => (
        <KeyBadge
          key={k.id}
          label={k.modifiers ? `${k.modifiers} ${k.key}` : k.key}
          opacity={Math.max(0, 1 - (k.age - config.fadeDelay) / 500)}
          style={config.style}
        />
      ))}
    </div>
  )
}

function formatModifiers(event: GlobalInputEvent): string {
  const parts: string[] = []
  if (event.meta) parts.push(navigator.platform.includes('Mac') ? '⌘' : 'Win')
  if (event.ctrl) parts.push(navigator.platform.includes('Mac') ? '⌃' : 'Ctrl')
  if (event.alt) parts.push(navigator.platform.includes('Mac') ? '⌥' : 'Alt')
  if (event.shift) parts.push('⇧')
  return parts.join(' ')
}
```

**按键气泡样式（pill style）：**

```css
.key-badge-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  margin: 0 4px;
  border-radius: 20px;
  background: rgba(0, 0, 0, 0.75);
  color: white;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-weight: 500;
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: opacity 0.3s ease;
}
```

### 4.5 录屏倒计时自动停止

```typescript
// useCountdown.ts
function useCountdown(durationSec: number, onComplete: () => void) {
  const [remaining, setRemaining] = useState(durationSec)
  const [isActive, setIsActive] = useState(false)
  const intervalRef = useRef<number>()

  function start() {
    setRemaining(durationSec)
    setIsActive(true)
  }

  function stop() {
    setIsActive(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  useEffect(() => {
    if (!isActive) return

    intervalRef.current = window.setInterval(() => {
      setRemaining(prev => {
        if (prev <= 1) {
          stop()
          onComplete()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isActive])

  return {
    remaining,
    isActive,
    start,
    stop,
    formattedTime: formatTime(remaining)
  }
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
```

**倒计时 UI 组件：**

```typescript
function CountdownTimer({ config, onStart, onComplete }) {
  const presets = [
    { label: '1 分钟', value: 60 },
    { label: '3 分钟', value: 180 },
    { label: '5 分钟', value: 300 },
    { label: '10 分钟', value: 600 },
    { label: '30 分钟', value: 1800 },
    { label: '自定义', value: -1 }
  ]

  return (
    <div className="countdown-settings">
      <label className="toggle-row">
        <span>自动停止</span>
        <Switch checked={config.enabled} onChange={/* ... */} />
      </label>
      {config.enabled && (
        <div className="preset-grid">
          {presets.map(p => (
            <button
              key={p.value}
              className={config.duration === p.value ? 'active' : ''}
              onClick={() => setDuration(p.value)}
            >
              {p.label}
            </button>
          ))}
          {config.duration === -1 && (
            <input
              type="number"
              placeholder="输入秒数"
              onChange={e => setCustomDuration(+e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  )
}
```

### 4.6 Overlay 子窗口

Overlay 是一个 **全屏透明置顶** 的子窗口，用于在屏幕上层渲染鼠标效果和键盘显示。录屏时它不会被录制进去（因为它覆盖在采集层之上）。

**创建方式：**

```typescript
async function createOverlayWindow(display: DisplayInfo): Promise<ChildWindowHandle> {
  const overlay = await mulby.window.create('overlay', {
    type: 'borderless',
    width: display.bounds.width,
    height: display.bounds.height,
    x: display.bounds.x,
    y: display.bounds.y,
    transparent: true,
    alwaysOnTop: true,
    titleBar: false,
    opacity: 1.0,
    params: {
      displayId: String(display.id)
    }
  })
  return overlay
}
```

> **重要**: Overlay 子窗口使用 `transparent: true`，需要 CSS 设置 `body { background: transparent; }` 使背景完全透明，只渲染 Canvas 上的效果元素。Overlay 窗口需要设置为 **鼠标穿透**（`pointer-events: none`），否则会拦截用户的正常操作。

**Overlay 页面结构：**

```typescript
function OverlayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseTrail = useRef<Point[]>([])
  const clickEffects = useRef<ClickEffect[]>([])
  const keystrokes = useRef<KeystrokeEvent[]>([])

  useEffect(() => {
    // 接收来自主窗口的输入事件
    mulby.window.onParentMessage((channel, data) => {
      if (channel === 'input-event') handleInputEvent(data)
      if (channel === 'config-update') updateConfig(data)
      if (channel === 'stop') cleanup()
    })
  }, [])

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return

    let animId: number

    function draw() {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

      // 渲染层序：轨迹线 → 涟漪 → emoji → 键盘气泡
      if (config.trailEnabled) {
        renderMouseTrail(ctx, mouseTrail.current)
      }
      clickEffects.current.forEach(c => renderClickEffect(ctx, c, config))
      // 键盘显示通过 React DOM 渲染，不走 Canvas

      // 清理过期效果
      const now = Date.now()
      mouseTrail.current = mouseTrail.current
        .filter(p => now - p.timestamp < config.trailDuration)
      clickEffects.current = clickEffects.current
        .filter(c => now - c.timestamp < config.rippleDuration)

      animId = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animId)
  }, [config])

  return (
    <div style={{ pointerEvents: 'none', width: '100vw', height: '100vh' }}>
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        style={{ position: 'fixed', top: 0, left: 0 }}
      />
      <KeystrokeDisplay events={keystrokes.current} config={config.keystroke} />
    </div>
  )
}
```

> **关于 Overlay 是否被录进视频**：
>
> - `desktopCapturer` 采集的是屏幕/窗口的像素内容
> - 使用 `alwaysOnTop` 的透明 Overlay 窗口 **会被** 全屏录制捕获到
> - 如果需要 Overlay 不被录入，可以在采集后将 Overlay 窗口置于采集层之下，但这会导致用户无法看到效果反馈
> - **推荐方案**：对于教学录屏类场景，鼠标效果和按键显示 **应该被录入** 视频中，这正是这个功能的核心价值

### 4.7 录制引擎

```typescript
// useRecorder.ts
interface RecorderState {
  status: 'idle' | 'preparing' | 'countdown' | 'recording' | 'paused' | 'processing'
  duration: number
  fileSize: number
}

function useRecorder() {
  const [state, setState] = useState<RecorderState>({ status: 'idle', duration: 0, fileSize: 0 })
  const recorderRef = useRef<MediaRecorder>()
  const chunksRef = useRef<Blob[]>([])

  async function startRecording(settings: RecordSettings) {
    setState(s => ({ ...s, status: 'preparing' }))

    // 1. 获取视频流
    let videoStream: MediaStream
    switch (settings.mode) {
      case 'fullscreen':
        videoStream = await startFullScreenRecording()
        break
      case 'window':
        videoStream = await startWindowRecording(settings.windowId!)
        break
      case 'region':
        videoStream = await startRegionRecording(settings.region!)
        break
    }

    // 2. 获取麦克风流（可选）
    let micStream: MediaStream | null = null
    if (settings.microphone) {
      micStream = await getMicrophoneStream()
    }

    // 3. 混合音频（如果同时有系统音频和麦克风）
    let finalStream = videoStream
    if (micStream && videoStream.getAudioTracks().length > 0) {
      finalStream = mixAudioStreams(videoStream, micStream)
    } else if (micStream) {
      micStream.getAudioTracks().forEach(t => videoStream.addTrack(t))
      finalStream = videoStream
    }

    // 4. 启动 inputMonitor（如果需要 Overlay）
    if (settings.overlay.mouseTrail || settings.overlay.clickEffect || settings.overlay.keystroke) {
      await startInputMonitoring(settings.overlay)
      await createOverlayWindow(currentDisplay)
    }

    // 5. 创建 MediaRecorder
    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(finalStream, {
      mimeType,
      videoBitsPerSecond: settings.bitrate ?? 5_000_000 // 默认 5Mbps
    })

    chunksRef.current = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = async () => {
      await processRecording()
    }

    // 6. 开始录制（支持 3 秒倒计时）
    if (settings.countdownSec > 0) {
      setState(s => ({ ...s, status: 'countdown' }))
      await countdown(settings.countdownSec)
    }

    recorder.start(1000) // 每秒触发一次 dataavailable
    recorderRef.current = recorder
    setState(s => ({ ...s, status: 'recording' }))
  }

  function pauseRecording() {
    recorderRef.current?.pause()
    setState(s => ({ ...s, status: 'paused' }))
  }

  function resumeRecording() {
    recorderRef.current?.resume()
    setState(s => ({ ...s, status: 'recording' }))
  }

  function stopRecording() {
    recorderRef.current?.stop()
    setState(s => ({ ...s, status: 'processing' }))
  }

  return { state, startRecording, pauseRecording, resumeRecording, stopRecording }
}

function getSupportedMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm'
  ]
  return candidates.find(c => MediaRecorder.isTypeSupported(c)) ?? 'video/webm'
}
```

### 4.8 后处理 — WebM 转 MP4

录制结束后使用 FFmpeg 将 WebM 转为更通用的 MP4：

```typescript
async function processRecording() {
  const blob = new Blob(chunksRef.current, { type: 'video/webm' })
  const buffer = await blob.arrayBuffer()

  // 保存临时 WebM
  const tempDir = await mulby.system.getTempPath()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const tempWebm = `${tempDir}/mulby-recording-${timestamp}.webm`
  const outputMp4 = `${tempDir}/mulby-recording-${timestamp}.mp4`

  await mulby.filesystem.writeFile(tempWebm, new Uint8Array(buffer))

  // FFmpeg 转码
  const ffmpegAvailable = await mulby.ffmpeg.isAvailable()
  if (!ffmpegAvailable) {
    await mulby.ffmpeg.download((p) => {
      updateProgress(`下载 FFmpeg: ${p.percent}%`)
    })
  }

  const task = mulby.ffmpeg.run(
    [
      '-i', tempWebm,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-tag:v', 'avc1',
      '-movflags', 'faststart',
      '-c:a', 'aac',
      '-b:a', '128k',
      outputMp4
    ],
    (progress) => {
      updateProgress(`转码中: ${progress.percent ?? 0}%`)
    }
  )

  await task.promise

  // 清理临时文件
  await mulby.filesystem.deleteFile(tempWebm)

  // 通知用户
  mulby.notification.show(`录制完成: ${outputMp4}`)

  // 询问用户保存位置
  const savePath = await mulby.dialog.showSaveDialog({
    defaultPath: `录屏-${timestamp}.mp4`,
    filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
  })

  if (savePath) {
    await mulby.filesystem.copyFile(outputMp4, savePath)
    await mulby.filesystem.deleteFile(outputMp4)
    mulby.notification.show(`已保存至: ${savePath}`)
  }
}
```

---

## 5. 用户设置面板

### 5.1 数据模型

```typescript
interface RecordSettings {
  // 录制模式
  mode: 'fullscreen' | 'window' | 'region'
  windowId?: string
  region?: Region
  displayId?: string

  // 视频
  frameRate: 30 | 60
  bitrate: number           // bps, 默认 5_000_000

  // 音频
  systemAudio: boolean      // 默认 true
  microphone: boolean       // 默认 false

  // Overlay 效果
  overlay: {
    mouseTrail: boolean     // 默认 true
    clickEffect: boolean    // 默认 true
    keystroke: boolean      // 默认 true
    clickConfig: ClickConfig
    keystrokeConfig: KeystrokeConfig
  }

  // 倒计时
  countdown: {
    enabled: boolean        // 默认 false
    durationSec: number     // 默认 300 (5 分钟)
  }

  // 录制前倒计时
  startDelay: 0 | 3 | 5    // 秒，默认 3
}
```

### 5.2 设置持久化

使用 Mulby Storage API 持久化用户偏好：

```typescript
const SETTINGS_KEY = 'recorder-settings'

async function loadSettings(): Promise<RecordSettings> {
  const saved = await mulby.storage.getItem(SETTINGS_KEY)
  return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS
}

async function saveSettings(settings: RecordSettings) {
  await mulby.storage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
```

---

## 6. 主面板 UI 布局

```
┌─────────────────────────────────────┐
│  🎬 录屏助手                    ─ □ x │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────┐┌─────────┐┌─────────┐ │
│  │  全屏   ││  窗口   ││  区域   │ │
│  └─────────┘└─────────┘└─────────┘ │
│                                     │
│  ─── 音频 ──────────────────────── │
│  🔊 系统声音              [开关]   │
│  🎙️ 麦克风                [开关]   │
│                                     │
│  ─── 鼠标效果 ─────────────────── │
│  🖱️ 鼠标轨迹              [开关]   │
│  👆 点击标记              [开关]   │
│     └─ 左键 emoji: [👆] [选择]    │
│     └─ 右键 emoji: [✌️] [选择]    │
│  🎨 效果主题 [默认 ▼]             │
│                                     │
│  ─── 键盘 ─────────────────────── │
│  ⌨️  键盘按键显示          [开关]   │
│     └─ 显示位置 [底部居中 ▼]      │
│                                     │
│  ─── 自动停止 ─────────────────── │
│  ⏱️  倒计时录制            [开关]   │
│     └─ [1m] [3m] [5m] [10m] [30m] │
│                                     │
│  ┌─────────────────────────────────┐│
│  │        ⏺ 开始录制 (3s 倒计时)   ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

**录制中状态：**

```
┌─────────────────────────────────────┐
│  🔴 录制中  00:05:23        ⏱ 4:37 │
├─────────────────────────────────────┤
│                                     │
│  ┌──────┐  ┌──────┐  ┌──────────┐ │
│  │ ⏸ 暂停│  │ ⏹ 停止│  │ 🖊 标注... │ │
│  └──────┘  └──────┘  └──────────┘ │
│                                     │
│  🔊 系统 ✓  🎙️ 麦克风 ✓           │
│  🖱️ 轨迹 ✓  ⌨️ 键盘 ✓             │
└─────────────────────────────────────┘
```

---

## 7. 状态机

```
                  ┌──────────────┐
                  │     idle     │
                  └──────┬───────┘
                         │ startRecording()
                  ┌──────▼───────┐
                  │  preparing   │ ← 获取源、权限、创建流
                  └──────┬───────┘
                         │
            ┌────────────┼────────────┐
            │ startDelay > 0          │ startDelay = 0
    ┌───────▼────────┐       ┌───────▼───────┐
    │   countdown    │       │   recording   │◄──────┐
    │  (3/5s 倒计时)  │       │               │       │
    └───────┬────────┘       └───┬──────┬────┘       │
            │                    │      │             │
            │                    │pause │ resume      │
            └──► recording ◄─────┘  ┌───▼────┐       │
                                    │ paused  │───────┘
                     │              └────────┘
                     │ stop / 倒计时到 / 手动
              ┌──────▼───────┐
              │  processing  │ ← FFmpeg 转码
              └──────┬───────┘
                     │
              ┌──────▼───────┐
              │   complete   │ ← 保存文件
              └──────┬───────┘
                     │
                     └──► idle
```

---

## 8. 需要关注的 API 清单

| API | 用途 | 文档 |
|-----|------|------|
| `screen.getSources()` | 获取屏幕/窗口源列表 | [screen.md](../apis/screen.md) |
| `screen.getMediaStreamConstraints()` | 获取录制约束 | [screen.md](../apis/screen.md) |
| `screen.getAllDisplays()` | 多屏幕信息 | [screen.md](../apis/screen.md) |
| `inputMonitor.start()` | 启动输入监听 | [input-monitor.md](../apis/input-monitor.md) |
| `inputMonitor.onEvent()` | 接收输入事件 | [input-monitor.md](../apis/input-monitor.md) |
| `media.askForAccess('microphone')` | 麦克风权限 | [media.md](../apis/media.md) |
| `ffmpeg.run()` | WebM → MP4 转码 | [ffmpeg.md](../apis/ffmpeg.md) |
| `window.create()` | 创建 Overlay/区域选择子窗口 | [window.md](../apis/window.md) |
| `window.setAlwaysOnTop()` | 控制面板置顶 | [window.md](../apis/window.md) |
| `storage.getItem() / setItem()` | 设置持久化 | [storage.md](../apis/storage.md) |
| `dialog.showSaveDialog()` | 保存文件对话框 | [dialog.md](../apis/dialog.md) |
| `notification.show()` | 通知用户 | [notification.md](../apis/notification.md) |
| `filesystem.writeFile()` | 写入临时文件 | [filesystem.md](../apis/filesystem.md) |

---

## 9. 开发步骤建议

### Phase 1: 基础录制（MVP）

1. 搭建插件项目骨架（`mulby create screen-recorder`）
2. 实现全屏录制（MediaStream + MediaRecorder）
3. 实现窗口录制（带源选择 UI）
4. 实现基本的开始/停止/保存流程
5. 集成 FFmpeg 后处理（WebM → MP4）

### Phase 2: 自定义区域

6. 实现区域选择子窗口（透明全屏 + 拖拽框选）
7. 实现 Canvas 实时裁剪录制
8. 处理多屏幕和 Retina 缩放

### Phase 3: 鼠标效果

9. 集成 inputMonitor API
10. 实现 Overlay 子窗口（透明置顶）
11. 实现鼠标轨迹线渲染
12. 实现点击涟漪动画
13. 实现 emoji 标记（左键/右键区分）
14. 实现效果配置面板

### Phase 4: 键盘显示

15. 实现键盘按键气泡组件
16. 实现修饰键格式化
17. 实现按键位置和风格配置

### Phase 5: 音频 & 倒计时

18. 集成麦克风录制（含权限流程）
19. 实现音频混合（系统 + 麦克风）
20. 实现倒计时自动停止
21. 实现录制前倒计时（3/5 秒）

### Phase 6: 打磨

22. 设置持久化
23. 快捷键支持（全局快捷键开始/停止）
24. 性能优化（Canvas 渲染、事件节流）
25. 错误处理和边界情况
26. 多语言支持

---

## 10. 性能注意事项

| 环节 | 风险 | 建议 |
|------|------|------|
| Canvas 区域裁剪 | CPU 占用 | `requestAnimationFrame` 锁帧率；考虑 WebGL 加速 |
| Overlay 渲染 | 重绘频率 | 独立 Canvas 层，只在有变化时重绘 |
| inputMonitor 事件 | mouseMove 量大 | `throttleMs: 16`（60fps）或 `33`（30fps） |
| MediaRecorder 编码 | 卡顿 | 使用 VP9/H264 硬件编码；合理码率 |
| FFmpeg 转码 | 耗时 | 使用 `-preset fast`；显示进度条 |
| 内存 | 事件和帧缓存 | 定期清理过期数据，限制历史长度 |

---

## 11. 平台差异

| 功能 | macOS | Windows | Linux |
|------|-------|---------|-------|
| 全屏录制 | ✅ | ✅ | ✅ |
| 窗口录制 | ✅ | ✅ | ✅ |
| 自定义区域 | ✅ | ✅ | ✅ |
| 系统音频 | ⚠️ 需第三方驱动 | ✅ WASAPI | ⚠️ PulseAudio |
| 麦克风 | ✅ | ✅ | ✅ |
| 鼠标轨迹 | ✅ CGEventTap | ✅ SetWindowsHookEx | ❌ 待实现 |
| 键盘显示 | ✅ CGEventTap | ✅ SetWindowsHookEx | ❌ 待实现 |
| 辅助功能权限 | ✅ 需申请 | 不需要 | 不需要 |
