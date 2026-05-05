# 操作回放录制器插件 — 实现方案

> 版本: v1.0
> 日期: 2026-05-04
> 状态: 设计稿（供插件开发者实现）

---

## 1. 产品概述

操作回放录制器（Macro Recorder）让用户录制一段鼠标和键盘操作序列，保存为可命名的宏脚本，之后可以一键回放、循环执行或定时触发。类似"按键精灵"，但更轻量、现代化，深度集成 Mulby 生态。

### 核心能力

| 功能 | 说明 |
|------|------|
| 录制操作 | 记录鼠标移动/点击/滚轮和键盘按键序列 |
| 精确回放 | 按原始时间间隔重新执行所有操作 |
| 变速回放 | 0.5x / 1x / 2x / 5x / 即时（无延迟）速度 |
| 循环执行 | 指定循环次数或无限循环 |
| 宏管理 | 保存、重命名、删除、导入/导出宏脚本 |
| 定时触发 | 通过调度器定时执行宏 |
| 可视化编辑 | 查看和编辑录制的操作序列（删除/调整步骤） |
| 录制预览 | 回放时用 Overlay 高亮显示即将执行的操作 |
| 安全控制 | 紧急停止快捷键、敏感输入过滤 |

---

## 2. manifest.json

```json
{
  "name": "macro-recorder",
  "version": "1.0.0",
  "displayName": "操作回放录制器",
  "description": "录制鼠标和键盘操作，一键回放自动化重复工作",
  "type": "productivity",
  "author": "Mulby Team",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "🔄",
  "permissions": {
    "inputMonitor": true
  },
  "features": [
    {
      "code": "macro",
      "explain": "操作回放录制器",
      "mode": "detached",
      "cmds": [
        { "type": "keyword", "value": "宏" },
        { "type": "keyword", "value": "macro" },
        { "type": "keyword", "value": "回放" }
      ]
    },
    {
      "code": "macro-quick",
      "explain": "快速录制/回放",
      "mode": "silent",
      "cmds": [
        { "type": "keyword", "value": "快速录制" },
        { "type": "keyword", "value": "quick macro" }
      ]
    }
  ],
  "window": {
    "width": 480,
    "height": 600,
    "type": "borderless",
    "titleBar": false,
    "alwaysOnTop": true,
    "minWidth": 400,
    "minHeight": 500
  },
  "pluginSetting": {
    "single": true,
    "background": true,
    "idleTimeoutMs": "never",
    "maxRuntime": 0
  }
}
```

**说明**：
- 两个 feature：`macro` 打开完整管理面板，`macro-quick` 快速录制/回放（silent 模式）
- `inputMonitor: true` — 录制全局鼠标/键盘操作
- `background: true` — 后台运行回放

---

## 3. 架构设计

```
┌─────────────────────────────────────────────────────────┐
│                    后端 main.js                          │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  录制引擎     │  │  回放引擎     │  │  宏存储管理   │  │
│  │              │  │              │  │              │  │
│  │ inputMonitor │  │ input API    │  │ storage API  │  │
│  │ → 事件序列   │  │ → 模拟操作   │  │ → CRUD       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  │
│         │                 │                             │
│         └────────┬────────┘                             │
│                  │ IPC                                  │
│  ┌───────────────▼─────────────────────────────────┐   │
│  │              管理面板 UI                          │   │
│  │  · 宏列表  · 录制控制  · 序列编辑器  · 设置     │   │
│  └─────────────────────────────────────────────────┘   │
│                  │                                      │
│  ┌───────────────▼─────────────────────────────────┐   │
│  │          Overlay 子窗口（回放预览）               │   │
│  │  · 高亮即将执行的坐标点  · 进度指示               │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型

### 4.1 宏事件

```typescript
interface MacroEvent {
  id: string
  type: MacroEventType
  timestamp: number       // 距离录制开始的偏移量 (ms)
  data: MacroEventData
}

type MacroEventType =
  | 'mouseMove'
  | 'mouseClick'          // 左键单击
  | 'mouseDoubleClick'    // 左键双击
  | 'mouseRightClick'     // 右键点击
  | 'mouseScroll'
  | 'keyTap'              // 键盘按键（含修饰键）
  | 'keyType'             // 文字输入（批量）
  | 'delay'               // 手动插入的等待

type MacroEventData =
  | MouseMoveData
  | MouseClickData
  | MouseScrollData
  | KeyTapData
  | KeyTypeData
  | DelayData

interface MouseMoveData {
  x: number
  y: number
}

interface MouseClickData {
  x: number
  y: number
  button: 'left' | 'right'
  clickCount: 1 | 2
}

interface MouseScrollData {
  x: number
  y: number
  deltaX: number
  deltaY: number
}

interface KeyTapData {
  key: string             // 键名，如 'a', 'Enter', 'F5'
  modifiers: string[]     // 修饰键数组 ['ctrl', 'shift']
}

interface KeyTypeData {
  text: string            // 批量输入的文本
}

interface DelayData {
  duration: number        // 等待时间 (ms)
}
```

### 4.2 宏脚本

```typescript
interface Macro {
  id: string
  name: string
  description?: string
  events: MacroEvent[]
  createdAt: number
  updatedAt: number
  totalDuration: number   // 总时长 (ms)
  eventCount: number
  tags?: string[]

  // 回放配置
  playbackConfig: PlaybackConfig
}

interface PlaybackConfig {
  speed: 0.5 | 1 | 2 | 5 | 0   // 0 = 即时（无延迟）
  repeatCount: number            // 循环次数，0 = 无限
  repeatDelay: number            // 每次循环间隔 (ms)
  stopOnError: boolean           // 遇到错误时停止
}
```

---

## 5. 录制引擎

### 5.1 事件采集

```typescript
class MacroRecorder {
  private events: MacroEvent[] = []
  private startTime = 0
  private sessionId: string | null = null
  private isRecording = false

  // 智能过滤配置
  private config = {
    recordMouseMove: true,
    mouseMoveThrottle: 50,      // ms，鼠标移动采样间隔
    mouseMoveMinDistance: 10,    // px，最小移动距离（过滤抖动）
    mergeKeystrokes: true,       // 合并连续击键为 keyType 文本
    filterPasswords: true,       // 过滤疑似密码输入
  }

  async startRecording(api: PluginAPI): Promise<void> {
    this.events = []
    this.startTime = Date.now()
    this.isRecording = true

    this.sessionId = await api.inputMonitor.start(
      { mouse: true, keyboard: true, throttleMs: this.config.mouseMoveThrottle },
      (event) => this.handleEvent(event)
    )
  }

  stopRecording(api: PluginAPI): Macro {
    if (this.sessionId) {
      api.inputMonitor.stop(this.sessionId)
      this.sessionId = null
    }
    this.isRecording = false

    // 后处理：合并、优化事件序列
    const optimized = this.optimizeEvents(this.events)

    return {
      id: generateId(),
      name: `录制 ${new Date().toLocaleString()}`,
      events: optimized,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      totalDuration: optimized.length > 0
        ? optimized[optimized.length - 1].timestamp
        : 0,
      eventCount: optimized.length,
      playbackConfig: {
        speed: 1,
        repeatCount: 1,
        repeatDelay: 1000,
        stopOnError: false
      }
    }
  }

  private handleEvent(event: GlobalInputEvent) {
    if (!this.isRecording) return

    const elapsed = Date.now() - this.startTime

    switch (event.type) {
      case 'mouseMove':
        if (!this.config.recordMouseMove) return
        // 距离过滤
        const lastMove = this.getLastEvent('mouseMove')
        if (lastMove) {
          const dist = distance(
            { x: event.x, y: event.y },
            { x: (lastMove.data as MouseMoveData).x, y: (lastMove.data as MouseMoveData).y }
          )
          if (dist < this.config.mouseMoveMinDistance) return
        }
        this.pushEvent(elapsed, 'mouseMove', { x: event.x, y: event.y })
        break

      case 'mouseDown':
        if (event.button === 'left') {
          if (event.clickCount === 2) {
            this.pushEvent(elapsed, 'mouseDoubleClick', {
              x: event.x, y: event.y, button: 'left', clickCount: 2
            })
          } else {
            this.pushEvent(elapsed, 'mouseClick', {
              x: event.x, y: event.y, button: 'left', clickCount: 1
            })
          }
        } else if (event.button === 'right') {
          this.pushEvent(elapsed, 'mouseRightClick', {
            x: event.x, y: event.y, button: 'right', clickCount: 1
          })
        }
        break

      case 'mouseScroll':
        this.pushEvent(elapsed, 'mouseScroll', {
          x: event.x, y: event.y,
          deltaX: event.scrollDeltaX ?? 0,
          deltaY: event.scrollDeltaY ?? 0
        })
        break

      case 'keyDown':
        // 修饰键组合
        const modifiers: string[] = []
        if (event.meta) modifiers.push('command')
        if (event.ctrl) modifiers.push('ctrl')
        if (event.alt) modifiers.push('alt')
        if (event.shift && event.key && event.key.length > 1) modifiers.push('shift')

        if (event.key) {
          this.pushEvent(elapsed, 'keyTap', {
            key: event.key,
            modifiers
          })
        }
        break
    }
  }

  private pushEvent(timestamp: number, type: MacroEventType, data: MacroEventData) {
    this.events.push({ id: generateId(), type, timestamp, data })
  }

  private getLastEvent(type: MacroEventType): MacroEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].type === type) return this.events[i]
    }
  }
}
```

### 5.2 事件优化

录制完成后对事件序列进行智能优化：

```typescript
function optimizeEvents(events: MacroEvent[]): MacroEvent[] {
  let result = [...events]

  // 1. 合并连续的单字符 keyTap 为 keyType
  result = mergeConsecutiveKeys(result)

  // 2. 简化冗余的鼠标移动路径（Douglas-Peucker 算法）
  result = simplifyMousePath(result)

  // 3. 移除首尾无意义的鼠标移动
  result = trimEdgeMovements(result)

  return result
}

function mergeConsecutiveKeys(events: MacroEvent[]): MacroEvent[] {
  const result: MacroEvent[] = []
  let textBuffer = ''
  let textStartTime = 0

  for (const event of events) {
    if (
      event.type === 'keyTap' &&
      (event.data as KeyTapData).modifiers.length === 0 &&
      (event.data as KeyTapData).key.length === 1  // 单字符
    ) {
      if (textBuffer === '') textStartTime = event.timestamp
      textBuffer += (event.data as KeyTapData).key
      continue
    }

    // 遇到非单字符事件，刷出已缓存文本
    if (textBuffer) {
      result.push({
        id: generateId(),
        type: 'keyType',
        timestamp: textStartTime,
        data: { text: textBuffer }
      })
      textBuffer = ''
    }
    result.push(event)
  }

  if (textBuffer) {
    result.push({
      id: generateId(),
      type: 'keyType',
      timestamp: textStartTime,
      data: { text: textBuffer }
    })
  }

  return result
}

function simplifyMousePath(events: MacroEvent[]): MacroEvent[] {
  // 将连续的 mouseMove 事件视为路径，用 Ramer-Douglas-Peucker 简化
  const result: MacroEvent[] = []
  let moveBatch: MacroEvent[] = []

  for (const event of events) {
    if (event.type === 'mouseMove') {
      moveBatch.push(event)
    } else {
      if (moveBatch.length > 0) {
        const simplified = rdpSimplify(moveBatch, 5) // epsilon=5px
        result.push(...simplified)
        moveBatch = []
      }
      result.push(event)
    }
  }

  if (moveBatch.length > 0) {
    result.push(...rdpSimplify(moveBatch, 5))
  }

  return result
}
```

---

## 6. 回放引擎

### 6.1 核心回放逻辑

```typescript
class MacroPlayer {
  private macro: Macro | null = null
  private currentIndex = 0
  private isPlaying = false
  private isPaused = false
  private currentRepeat = 0
  private abortController: AbortController | null = null

  async play(macro: Macro, api: PluginAPI, callbacks: PlayerCallbacks): Promise<void> {
    this.macro = macro
    this.currentIndex = 0
    this.currentRepeat = 0
    this.isPlaying = true
    this.isPaused = false
    this.abortController = new AbortController()

    const { speed, repeatCount, repeatDelay } = macro.playbackConfig
    const totalRepeats = repeatCount === 0 ? Infinity : repeatCount

    try {
      while (this.currentRepeat < totalRepeats && this.isPlaying) {
        callbacks.onRepeatStart?.(this.currentRepeat + 1, totalRepeats)

        await this.playOnce(api, speed, callbacks)

        this.currentRepeat++

        if (this.currentRepeat < totalRepeats && repeatDelay > 0) {
          await this.sleep(repeatDelay)
        }

        this.currentIndex = 0
      }
    } finally {
      this.isPlaying = false
      callbacks.onComplete?.()
    }
  }

  private async playOnce(api: PluginAPI, speed: number, callbacks: PlayerCallbacks) {
    const events = this.macro!.events

    for (let i = 0; i < events.length && this.isPlaying; i++) {
      // 暂停检查
      while (this.isPaused && this.isPlaying) {
        await this.sleep(100)
      }
      if (!this.isPlaying) break

      this.currentIndex = i
      const event = events[i]
      const prevEvent = i > 0 ? events[i - 1] : null

      // 计算等待时间
      if (prevEvent && speed > 0) {
        const delay = (event.timestamp - prevEvent.timestamp) / speed
        if (delay > 0) {
          await this.sleep(Math.min(delay, 10000)) // 最长等 10 秒
        }
      }

      // 执行事件
      callbacks.onEventStart?.(i, event)
      await this.executeEvent(api, event)
      callbacks.onEventComplete?.(i, event)
    }
  }

  private async executeEvent(api: PluginAPI, event: MacroEvent): Promise<void> {
    switch (event.type) {
      case 'mouseMove': {
        const { x, y } = event.data as MouseMoveData
        await api.input.simulateMouseMove(x, y)
        break
      }

      case 'mouseClick': {
        const { x, y } = event.data as MouseClickData
        await api.input.simulateMouseClick(x, y)
        break
      }

      case 'mouseDoubleClick': {
        const { x, y } = event.data as MouseClickData
        await api.input.simulateMouseDoubleClick(x, y)
        break
      }

      case 'mouseRightClick': {
        const { x, y } = event.data as MouseClickData
        await api.input.simulateMouseRightClick(x, y)
        break
      }

      case 'mouseScroll': {
        // Mulby input API 暂无 scroll 模拟
        // 可通过 simulateKeyboardTap 模拟方向键滚动
        // 或等待 scroll 模拟 API
        break
      }

      case 'keyTap': {
        const { key, modifiers } = event.data as KeyTapData
        await api.input.simulateKeyboardTap(key, ...modifiers)
        break
      }

      case 'keyType': {
        const { text } = event.data as KeyTypeData
        await api.input.hideMainWindowTypeString(text)
        break
      }

      case 'delay': {
        const { duration } = event.data as DelayData
        await this.sleep(duration)
        break
      }
    }
  }

  pause() { this.isPaused = true }
  resume() { this.isPaused = false }
  stop() {
    this.isPlaying = false
    this.isPaused = false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms)
      // 支持中断
      if (this.abortController) {
        this.abortController.signal.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        })
      }
    })
  }
}

interface PlayerCallbacks {
  onRepeatStart?: (current: number, total: number) => void
  onEventStart?: (index: number, event: MacroEvent) => void
  onEventComplete?: (index: number, event: MacroEvent) => void
  onComplete?: () => void
  onError?: (error: Error, event: MacroEvent) => void
}
```

---

## 7. 宏存储管理

```typescript
const MACROS_KEY = 'macro-recorder:macros'

class MacroStorage {
  async list(): Promise<Macro[]> {
    const raw = await mulby.storage.getItem(MACROS_KEY)
    return raw ? JSON.parse(raw) : []
  }

  async save(macro: Macro): Promise<void> {
    const macros = await this.list()
    const index = macros.findIndex(m => m.id === macro.id)
    if (index >= 0) {
      macros[index] = { ...macro, updatedAt: Date.now() }
    } else {
      macros.push(macro)
    }
    await mulby.storage.setItem(MACROS_KEY, JSON.stringify(macros))
  }

  async delete(id: string): Promise<void> {
    const macros = await this.list()
    await mulby.storage.setItem(
      MACROS_KEY,
      JSON.stringify(macros.filter(m => m.id !== id))
    )
  }

  async exportMacro(macro: Macro): Promise<string> {
    return JSON.stringify(macro, null, 2)
  }

  async importMacro(json: string): Promise<Macro> {
    const macro = JSON.parse(json) as Macro
    macro.id = generateId() // 生成新 ID 避免冲突
    macro.createdAt = Date.now()
    macro.updatedAt = Date.now()
    await this.save(macro)
    return macro
  }
}
```

---

## 8. UI 设计

### 8.1 主面板布局

```
┌────────────────────────────────────────────────┐
│  🔄 操作回放录制器                        ─ □ x │
├────────────────────────────────────────────────┤
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  🔴 录制新宏     ▶️ 快速回放上一次        │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ─── 我的宏 (5) ───────────────── 🔍 搜索 ── │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ 📋 填写日报                               │  │
│  │ 12 步操作 · 8.5s · 创建于 5/3            │  │
│  │              [▶️ 回放] [✏️ 编辑] [⋮ 更多] │  │
│  ├──────────────────────────────────────────┤  │
│  │ 📋 Git 提交流程                           │  │
│  │ 6 步操作 · 3.2s · 创建于 5/1             │  │
│  │              [▶️ 回放] [✏️ 编辑] [⋮ 更多] │  │
│  ├──────────────────────────────────────────┤  │
│  │ 📋 打卡签到                               │  │
│  │ 4 步操作 · 2.1s · 创建于 4/28            │  │
│  │              [▶️ 回放] [✏️ 编辑] [⋮ 更多] │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ─── 回放设置 ──────────────────────────────── │
│  速度: [0.5x] [1x] [2x] [5x] [⚡即时]         │
│  循环: [1次] [3次] [5次] [∞无限]               │
│  ⏱️ 循环间隔: [1000] ms                        │
│                                                │
└────────────────────────────────────────────────┘
```

### 8.2 录制中面板

```
┌────────────────────────────────────────────────┐
│  🔴 录制中    00:05.3                          │
├────────────────────────────────────────────────┤
│                                                │
│  已录制 23 个操作                              │
│                                                │
│  最近操作:                                     │
│  · 🖱️ 点击 (450, 320)                         │
│  · ⌨️ 输入 "hello world"                      │
│  · 🖱️ 移动 → (600, 400)                       │
│  · ⌨️ 按键 ⌘+S                                │
│                                                │
│  ┌────────┐  ┌────────┐  ┌────────────────┐   │
│  │ ⏸ 暂停  │  │ ⏹ 停止  │  │ 🗑️ 取消录制    │   │
│  └────────┘  └────────┘  └────────────────┘   │
│                                                │
│  💡 按 Esc 或 ⌘+⇧+R 停止录制                  │
└────────────────────────────────────────────────┘
```

### 8.3 序列编辑器

```
┌────────────────────────────────────────────────┐
│  ✏️ 编辑: 填写日报                     [保存]   │
├────────────────────────────────────────────────┤
│  # │ 时间    │ 操作          │ 详情           │
│ ───┼─────────┼───────────────┼────────────── │
│  1 │ 0.0s   │ 🖱️ 点击       │ (450, 320)     │
│  2 │ 0.5s   │ ⌨️ 输入       │ "张三"          │
│  3 │ 1.2s   │ ⌨️ 按键       │ Tab             │
│  4 │ 1.8s   │ ⌨️ 输入       │ "完成了需求A"   │
│  5 │ 2.5s   │ 🖱️ 点击       │ (600, 400)     │
│  6 │ 3.0s   │ ⌨️ 按键       │ ⌘+Enter        │
│ ───┼─────────┼───────────────┼────────────── │
│     [+ 插入延迟] [+ 插入按键] [+ 插入点击]   │
│                                                │
│  选中步骤: [🗑️ 删除] [⏱️ 调整延迟] [📋 复制]  │
└────────────────────────────────────────────────┘
```

---

## 9. 回放预览 Overlay

回放执行时创建一个透明 Overlay 窗口，预览即将执行的操作：

```typescript
async function createPlaybackOverlay(display: DisplayInfo): Promise<ChildWindowHandle> {
  return mulby.window.create('overlay', {
    type: 'borderless',
    width: display.bounds.width,
    height: display.bounds.height,
    x: display.bounds.x,
    y: display.bounds.y,
    transparent: true,
    alwaysOnTop: true,
    titleBar: false
  })
}
```

**Overlay 渲染内容：**

```typescript
function PlaybackOverlay({ currentEvent, nextEvent, progress }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx || !currentEvent) return

    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    // 在即将点击的位置显示脉冲圈
    if (currentEvent.type === 'mouseClick' || currentEvent.type === 'mouseDoubleClick') {
      const { x, y } = currentEvent.data as MouseClickData
      drawPulsingCircle(ctx, x, y, '#3b82f6')
    }

    // 鼠标移动时显示运动轨迹预测线
    if (currentEvent.type === 'mouseMove' && nextEvent?.type === 'mouseMove') {
      const from = currentEvent.data as MouseMoveData
      const to = nextEvent.data as MouseMoveData
      drawDashedLine(ctx, from, to, '#94a3b8')
    }

    // 键盘输入时在屏幕中下方显示即将输入的内容
    if (currentEvent.type === 'keyTap' || currentEvent.type === 'keyType') {
      const text = currentEvent.type === 'keyTap'
        ? formatKeyCombo(currentEvent.data as KeyTapData)
        : `"${(currentEvent.data as KeyTypeData).text}"`
      drawKeystrokePreview(ctx, text, ctx.canvas.width / 2, ctx.canvas.height - 80)
    }

  }, [currentEvent, nextEvent])

  return (
    <div style={{ pointerEvents: 'none', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight} />
      <ProgressBar progress={progress} />
    </div>
  )
}
```

---

## 10. 安全与防护

### 10.1 紧急停止

全局快捷键 `Esc` 或 `⌘+⇧+.`（macOS）/ `Ctrl+Shift+.`（Windows）立即停止回放：

```typescript
// 在后端注册紧急停止监听
inputMonitor.onEvent(sessionId, (event) => {
  if (event.type === 'keyDown' && event.key === 'Escape') {
    player.stop()
    overlay?.close()
    notification.show('回放已紧急停止')
  }
})
```

### 10.2 敏感输入过滤

录制时检测并标记可能包含密码的输入：

```typescript
function isSensitiveContext(events: MacroEvent[], index: number): boolean {
  // 检查前几个事件是否包含 Tab 键（表单跳转到密码框）
  // 检查录制的文本是否看起来像密码
  const event = events[index]
  if (event.type !== 'keyType') return false

  const text = (event.data as KeyTypeData).text

  // 简单启发式：短文本 + 混合字符 = 可能是密码
  if (text.length >= 6 && text.length <= 30) {
    const hasUpper = /[A-Z]/.test(text)
    const hasLower = /[a-z]/.test(text)
    const hasDigit = /\d/.test(text)
    const hasSpecial = /[!@#$%^&*]/.test(text)
    if ([hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length >= 3) {
      return true // 标记为可疑
    }
  }
  return false
}
```

标记为可疑的事件在保存时会提示用户确认或移除。

### 10.3 坐标安全检查

回放前检查目标坐标是否在屏幕范围内：

```typescript
async function validateCoordinates(events: MacroEvent[], displays: DisplayInfo[]): Promise<string[]> {
  const warnings: string[] = []

  for (const event of events) {
    if ('x' in event.data && 'y' in event.data) {
      const { x, y } = event.data as { x: number; y: number }
      const inBounds = displays.some(d =>
        x >= d.bounds.x && x <= d.bounds.x + d.bounds.width &&
        y >= d.bounds.y && y <= d.bounds.y + d.bounds.height
      )
      if (!inBounds) {
        warnings.push(`步骤 ${event.id}: 坐标 (${x}, ${y}) 超出当前屏幕范围`)
      }
    }
  }

  return warnings
}
```

---

## 11. 定时执行

通过 Mulby Scheduler API 设定定时执行宏：

```typescript
async function scheduleMacro(macroId: string, schedule: ScheduleConfig) {
  await mulby.scheduler.register({
    name: `macro-${macroId}`,
    cron: schedule.cron,           // 如 '0 9 * * 1-5' (周一到周五早上9点)
    handler: async () => {
      const macro = await storage.get(macroId)
      if (macro) {
        await player.play(macro, api, {
          onComplete: () => notification.show(`宏"${macro.name}"执行完成`)
        })
      }
    }
  })
}
```

---

## 12. 状态机

```
┌──────────┐
│   idle   │◄──────────────────────────────────┐
└────┬─────┘                                   │
     │ 开始录制                                │
┌────▼─────┐                                   │
│recording │──── 停止 ───► postProcess ────►   │
│          │◄─── 恢复 ──── paused_rec   save ──┘
└──────────┘
     │
     │ 开始回放
┌────▼─────┐
│ playing  │──── 停止/完成 ────────────────►idle
│          │◄─── 恢复 ──── paused_play
└──────────┘
```

---

## 13. 开发步骤

### Phase 1: 录制核心（MVP）

1. 搭建项目骨架
2. 集成 `inputMonitor`，实现事件录制
3. 实现基础录制控制（开始/停止）
4. 实现事件优化（合并连续按键、路径简化）
5. 宏保存到 storage

### Phase 2: 回放引擎

6. 实现 `MacroPlayer` 回放核心
7. 集成 `input` API（simulateKeyboardTap / simulateMouseClick 等）
8. 实现变速回放
9. 实现暂停/恢复
10. 实现循环执行

### Phase 3: 管理 UI

11. 宏列表界面
12. 录制状态界面
13. 回放设置面板
14. 宏重命名/删除

### Phase 4: 高级编辑

15. 序列编辑器（查看/删除步骤）
16. 手动插入延迟/按键/点击
17. 调整步骤延迟
18. 导入/导出功能

### Phase 5: Overlay & 安全

19. 回放预览 Overlay
20. 紧急停止快捷键
21. 敏感输入检测
22. 坐标范围校验

### Phase 6: 打磨

23. 定时执行集成
24. 搜索和标签管理
25. 回放统计（成功/失败次数）
26. 键盘快捷键（快速录制/回放）

---

## 14. 挑战与注意事项

| 挑战 | 应对策略 |
|------|---------|
| 坐标漂移 | 录制的坐标在不同分辨率/缩放下可能偏移。考虑使用相对坐标或图像匹配定位 |
| 窗口位置变化 | 如果目标窗口位置变了，回放会点到错误位置。后续可增加"锚定窗口"功能 |
| 滚轮模拟 | Mulby input API 暂无 scroll 模拟，可用方向键替代或等待 API 扩展 |
| 密码安全 | 录制可能包含敏感信息，需要警示和过滤机制 |
| 回放时机 | 某些操作需要等待页面加载，固定延迟可能不够。后续可增加"等待图像出现"条件 |
| 跨平台按键差异 | macOS 用 `command`，Windows 用 `ctrl`，导出的宏需要标注平台 |
