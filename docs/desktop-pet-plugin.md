# 桌面宠物插件 — 实现方案

> 版本: v1.0
> 日期: 2026-05-04
> 状态: 设计稿（供插件开发者实现）

---

## 1. 产品概述

桌面宠物是一个常驻在桌面上的虚拟角色，能感知用户的鼠标移动和点击行为并做出反应（追逐光标、被点击时跳起、闲置时打瞌睡等）。纯趣味性插件，为日常工作增添活力。

### 核心行为

| 行为 | 触发条件 | 表现 |
|------|---------|------|
| 闲逛 | 无用户交互 > 10s | 角色随机走动 |
| 追逐光标 | 鼠标移动 | 跑向鼠标位置 |
| 被点击跳起 | 鼠标左键点击角色附近 | 跳跃 + 开心表情 |
| 被右键点击 | 鼠标右键点击角色附近 | 受惊 + 躲闪 |
| 打瞌睡 | 无用户交互 > 60s | 坐下 → 闭眼 → Zzz |
| 好奇张望 | 鼠标在角色附近缓慢移动 | 头转向鼠标方向 |
| 快速打字 | 键盘连续输入 | 鼓掌/加油动作 |
| 滚轮 | 鼠标滚轮 | 被"风"吹得摇晃 |
| 庆祝 | 特定组合键（⌘+S 保存） | 撒花 / 竖拇指 |

---

## 2. manifest.json

```json
{
  "name": "desktop-pet",
  "version": "1.0.0",
  "displayName": "桌面宠物",
  "description": "一只活泼的桌面伴侣，能感知你的鼠标和键盘操作并做出有趣反应",
  "type": "entertainment",
  "author": "Mulby Team",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "🐱",
  "permissions": {
    "inputMonitor": true
  },
  "features": [
    {
      "code": "pet",
      "explain": "桌面宠物",
      "mode": "detached",
      "mainHide": true,
      "cmds": [
        { "type": "keyword", "value": "宠物" },
        { "type": "keyword", "value": "pet" }
      ]
    }
  ],
  "window": {
    "width": 120,
    "height": 120,
    "type": "borderless",
    "titleBar": false,
    "transparent": true,
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

**说明**：
- 窗口很小（120x120），只包含角色精灵
- `transparent: true` — 背景透明，只看到角色
- `alwaysOnTop: true` — 始终在桌面最上层
- `background: true` + `idleTimeoutMs: "never"` — 常驻不销毁
- `inputMonitor: true` — 感知全局鼠标/键盘

---

## 3. 架构设计

```
┌─────────────────────────────────────────────┐
│               后端 main.js                    │
│                                             │
│  inputMonitor.start()                       │
│       │                                     │
│       ▼                                     │
│  事件 → 行为决策引擎 → 指令                  │
│                          │                  │
│                    IPC postMessage           │
│                          │                  │
│                          ▼                  │
│  ┌───────────────────────────────────────┐  │
│  │         宠物窗口 (120x120)             │  │
│  │                                       │  │
│  │   Canvas / Sprite 动画引擎            │  │
│  │   · 状态机驱动动画帧                  │  │
│  │   · setBounds() 移动窗口位置          │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### 数据流

```
原生鼠标/键盘事件
    │
    ▼
inputMonitor (后端)
    │
    ▼
行为决策引擎 ── 分析事件模式 → 产出行为指令
    │
    ▼ (IPC → 渲染进程)
精灵动画状态机 ── 播放对应动画帧序列
    │
    ▼
Canvas 渲染 + window.setBounds() 移动窗口
```

---

## 4. 角色与精灵系统

### 4.1 精灵表（Sprite Sheet）

使用经典的精灵表方案，一张 PNG 包含所有动画帧：

```typescript
interface SpriteSheet {
  image: HTMLImageElement
  frameWidth: number      // 单帧宽度 (如 64px)
  frameHeight: number     // 单帧高度 (如 64px)
  animations: Record<AnimationName, SpriteAnimation>
}

interface SpriteAnimation {
  frames: number[]        // 帧索引序列 [0, 1, 2, 3, 2, 1]
  fps: number             // 播放帧率
  loop: boolean           // 是否循环
  next?: AnimationName    // 播放完成后切换到的下一个动画
}

type AnimationName =
  | 'idle'          // 站立/眨眼
  | 'walk_left'     // 向左走
  | 'walk_right'    // 向右走
  | 'run_left'      // 向左跑
  | 'run_right'     // 向右跑
  | 'jump'          // 跳跃
  | 'sit'           // 坐下
  | 'sleep'         // 打瞌睡
  | 'surprised'     // 受惊
  | 'happy'         // 开心
  | 'cheer'         // 鼓掌/加油
  | 'look_left'     // 左看
  | 'look_right'    // 右看
  | 'wobble'        // 摇晃（被风吹）
  | 'celebrate'     // 庆祝（撒花）
```

### 4.2 精灵动画引擎

```typescript
class SpriteAnimator {
  private sheet: SpriteSheet
  private currentAnim: AnimationName = 'idle'
  private frameIndex = 0
  private elapsed = 0
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D

  constructor(canvas: HTMLCanvasElement, sheet: SpriteSheet) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.sheet = sheet
  }

  play(animation: AnimationName) {
    if (this.currentAnim === animation) return
    this.currentAnim = animation
    this.frameIndex = 0
    this.elapsed = 0
  }

  update(deltaMs: number) {
    const anim = this.sheet.animations[this.currentAnim]
    if (!anim) return

    this.elapsed += deltaMs
    const frameDuration = 1000 / anim.fps

    if (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration
      this.frameIndex++

      if (this.frameIndex >= anim.frames.length) {
        if (anim.loop) {
          this.frameIndex = 0
        } else {
          this.frameIndex = anim.frames.length - 1
          if (anim.next) this.play(anim.next)
        }
      }
    }
  }

  render() {
    const anim = this.sheet.animations[this.currentAnim]
    if (!anim) return

    const frameIdx = anim.frames[this.frameIndex]
    const cols = Math.floor(this.sheet.image.width / this.sheet.frameWidth)
    const sx = (frameIdx % cols) * this.sheet.frameWidth
    const sy = Math.floor(frameIdx / cols) * this.sheet.frameHeight

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.drawImage(
      this.sheet.image,
      sx, sy, this.sheet.frameWidth, this.sheet.frameHeight,
      0, 0, this.canvas.width, this.canvas.height
    )
  }
}
```

### 4.3 替代方案：Lottie / CSS 动画

如果不想画精灵表，也可以用 Lottie 动画：

```typescript
import lottie from 'lottie-web'

const animation = lottie.loadAnimation({
  container: document.getElementById('pet')!,
  renderer: 'canvas',
  loop: true,
  autoplay: true,
  path: './animations/idle.json'
})

function switchAnimation(name: string) {
  animation.destroy()
  lottie.loadAnimation({
    container: document.getElementById('pet')!,
    renderer: 'canvas',
    loop: ANIM_CONFIG[name].loop,
    autoplay: true,
    path: `./animations/${name}.json`
  })
}
```

---

## 5. 行为决策引擎

### 5.1 状态机

```
                    ┌─────────┐
           ┌───────│  idle    │◄──────────────────────────┐
           │       └────┬────┘                            │
           │            │                                 │
    鼠标远距离移动  鼠标附近缓慢    无交互>10s       动画结束
           │            │            │                    │
    ┌──────▼─────┐ ┌────▼───┐ ┌─────▼──────┐  ┌─────────┴──┐
    │   chase    │ │  look  │ │   wander   │  │   happy    │
    │  (追逐)    │ │ (张望)  │ │  (闲逛)    │  │  (开心)    │
    └──────┬─────┘ └────┬───┘ └─────┬──────┘  └────────────┘
           │            │           │                  ▲
      到达目标      鼠标离开     无交互>60s         左键点击
           │            │           │
           ▼            ▼    ┌──────▼──────┐
         idle         idle   │    sit      │
                             │   (坐下)    │
                             └──────┬──────┘
                                    │ 继续无交互>30s
                             ┌──────▼──────┐
                             │   sleep     │
                             │  (打瞌睡)   │
                             └──────┬──────┘
                                    │ 任何鼠标/键盘事件
                                    ▼
                              surprised → idle
```

### 5.2 实现

```typescript
interface PetState {
  behavior: BehaviorType
  position: { x: number; y: number }
  velocity: { vx: number; vy: number }
  facing: 'left' | 'right'
  idleTimer: number       // 无交互计时器 (ms)
  lastMousePos: Point
  lastKeyTime: number
  keyBurstCount: number   // 连续击键计数
}

type BehaviorType = 'idle' | 'chase' | 'look' | 'wander' | 'sit' | 'sleep'
                  | 'jump' | 'surprised' | 'happy' | 'cheer' | 'wobble' | 'celebrate'

function decideBehavior(state: PetState, event: GlobalInputEvent | null): BehaviorType {
  const { behavior, position, idleTimer } = state

  // 事件驱动行为
  if (event) {
    state.idleTimer = 0

    if (behavior === 'sleep') return 'surprised'

    switch (event.type) {
      case 'mouseMove': {
        const dist = distance(position, { x: event.x, y: event.y })
        if (dist > 300) return 'chase'
        if (dist < 150 && dist > 50) return 'look'
        return behavior === 'chase' ? 'idle' : behavior
      }

      case 'mouseDown': {
        const dist = distance(position, { x: event.x, y: event.y })
        if (dist < 100) {
          return event.button === 'right' ? 'surprised' : 'happy'
        }
        return behavior
      }

      case 'mouseScroll':
        return 'wobble'

      case 'keyDown': {
        state.keyBurstCount++
        if (state.keyBurstCount > 20) {
          state.keyBurstCount = 0
          return 'cheer'
        }
        // ⌘+S 检测
        if (event.key === 's' && (event.meta || event.ctrl)) {
          return 'celebrate'
        }
        return behavior
      }
    }
  }

  // 定时衰减
  if (event?.type !== 'keyDown') {
    state.keyBurstCount = Math.max(0, state.keyBurstCount - 1)
  }

  // 时间驱动行为
  if (idleTimer > 60000 && behavior !== 'sleep') return 'sit'
  if (idleTimer > 90000 && behavior === 'sit') return 'sleep'
  if (idleTimer > 10000 && behavior === 'idle') return 'wander'

  return behavior
}
```

### 5.3 移动逻辑

宠物窗口通过 `window.setPosition()` 在屏幕上移动：

```typescript
const MOVE_SPEED = 3       // 像素/帧（走路）
const RUN_SPEED = 8        // 像素/帧（追逐）
const WANDER_SPEED = 1.5   // 像素/帧（闲逛）

function updatePosition(state: PetState, display: DisplayInfo): PetState {
  let { x, y } = state.position
  const { vx, vy } = state.velocity

  x += vx
  y += vy

  // 边界约束：不让宠物走出屏幕
  const bounds = display.workArea
  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - 120))
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - 120))

  // 默认贴底部（像站在任务栏上方）
  if (state.behavior === 'idle' || state.behavior === 'wander') {
    y = bounds.y + bounds.height - 120
  }

  return { ...state, position: { x, y } }
}

function getVelocity(state: PetState): { vx: number; vy: number } {
  switch (state.behavior) {
    case 'chase': {
      const dx = state.lastMousePos.x - state.position.x - 60
      const dy = state.lastMousePos.y - state.position.y - 60
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 30) return { vx: 0, vy: 0 }
      const speed = dist > 200 ? RUN_SPEED : MOVE_SPEED
      return {
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed
      }
    }

    case 'wander': {
      // 随机方向，到达随机目标点后换方向
      return {
        vx: state.facing === 'right' ? WANDER_SPEED : -WANDER_SPEED,
        vy: 0
      }
    }

    default:
      return { vx: 0, vy: 0 }
  }
}
```

---

## 6. 主循环

```typescript
// 后端 main.ts
async function run(context: PluginContext) {
  const { inputMonitor, screen } = context.api

  let petState: PetState = {
    behavior: 'idle',
    position: { x: 200, y: 600 },
    velocity: { vx: 0, vy: 0 },
    facing: 'right',
    idleTimer: 0,
    lastMousePos: { x: 0, y: 0 },
    lastKeyTime: 0,
    keyBurstCount: 0
  }

  const display = await screen.getPrimaryDisplay()

  // 启动输入监听
  const sessionId = await inputMonitor.start(
    { mouse: true, keyboard: true, throttleMs: 50 },
    (event) => {
      // 更新状态
      if (event.type === 'mouseMove') {
        petState.lastMousePos = { x: event.x, y: event.y }
      }
      const newBehavior = decideBehavior(petState, event)
      if (newBehavior !== petState.behavior) {
        petState.behavior = newBehavior
        // 通知 UI 切换动画
        context.sendToUI('behavior-change', { behavior: newBehavior, event })
      }
    }
  )

  // 主循环 tick（每 50ms 一次）
  setInterval(() => {
    petState.idleTimer += 50

    // 时间驱动行为检查
    const newBehavior = decideBehavior(petState, null)
    if (newBehavior !== petState.behavior) {
      petState.behavior = newBehavior
      context.sendToUI('behavior-change', { behavior: newBehavior })
    }

    // 更新位置
    petState.velocity = getVelocity(petState)
    petState = updatePosition(petState, display)

    // 更新朝向
    if (petState.velocity.vx > 0) petState.facing = 'right'
    if (petState.velocity.vx < 0) petState.facing = 'left'

    // 通知 UI 更新位置
    context.sendToUI('position-update', {
      x: petState.position.x,
      y: petState.position.y,
      facing: petState.facing
    })
  }, 50)
}
```

### UI 端主循环

```typescript
// App.tsx
function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animatorRef = useRef<SpriteAnimator>()
  let lastTime = 0

  useEffect(() => {
    // 加载精灵表
    const img = new Image()
    img.src = './sprites/cat.png'
    img.onload = () => {
      animatorRef.current = new SpriteAnimator(canvasRef.current!, {
        image: img,
        frameWidth: 64,
        frameHeight: 64,
        animations: CAT_ANIMATIONS
      })
      requestAnimationFrame(gameLoop)
    }

    // 监听后端消息
    mulby.onBackendMessage('behavior-change', ({ behavior }) => {
      const animName = BEHAVIOR_TO_ANIM[behavior]
      animatorRef.current?.play(animName)
    })

    mulby.onBackendMessage('position-update', async ({ x, y, facing }) => {
      await mulby.window.setPosition(Math.round(x), Math.round(y))
      animatorRef.current?.setFlipped(facing === 'left')
    })
  }, [])

  function gameLoop(timestamp: number) {
    const delta = timestamp - lastTime
    lastTime = timestamp

    animatorRef.current?.update(delta)
    animatorRef.current?.render()

    requestAnimationFrame(gameLoop)
  }

  return (
    <canvas
      ref={canvasRef}
      width={120}
      height={120}
      style={{ background: 'transparent' }}
    />
  )
}
```

---

## 7. 角色选择

支持多个角色主题，用户可在设置中切换：

```typescript
interface PetCharacter {
  id: string
  name: string
  spriteSheet: string   // 精灵表 PNG 路径
  frameSize: number     // 帧尺寸（正方形）
  animations: Record<AnimationName, SpriteAnimation>
  sounds?: Record<string, string>  // 可选音效
}

const CHARACTERS: PetCharacter[] = [
  {
    id: 'cat',
    name: '小猫咪 🐱',
    spriteSheet: './sprites/cat.png',
    frameSize: 64,
    animations: { /* ... */ }
  },
  {
    id: 'dog',
    name: '小狗狗 🐶',
    spriteSheet: './sprites/dog.png',
    frameSize: 64,
    animations: { /* ... */ }
  },
  {
    id: 'pixel',
    name: '像素人 👾',
    spriteSheet: './sprites/pixel.png',
    frameSize: 32,
    animations: { /* ... */ }
  },
  {
    id: 'penguin',
    name: '企鹅 🐧',
    spriteSheet: './sprites/penguin.png',
    frameSize: 64,
    animations: { /* ... */ }
  }
]
```

---

## 8. 右键菜单

用户右键点击宠物窗口时弹出菜单：

```typescript
const petMenu = [
  { label: '切换角色...', click: () => showCharacterPicker() },
  { label: '设置...', click: () => showSettings() },
  { type: 'separator' },
  { label: '小猫加油！', click: () => triggerBehavior('cheer') },
  { label: '休息一下', click: () => triggerBehavior('sleep') },
  { type: 'separator' },
  { label: '暂时隐藏', click: () => mulby.window.hide() },
  { label: '退出宠物', click: () => mulby.window.close() }
]
```

---

## 9. 设置面板

```typescript
interface PetSettings {
  character: string        // 角色 ID
  size: 'small' | 'medium' | 'large'  // 60 / 120 / 180 px
  speed: 'slow' | 'normal' | 'fast'
  gravity: boolean         // 是否贴底部"行走"
  interactionSensitivity: number  // 1-10, 对鼠标的灵敏度
  sleepTimeout: number     // 多久后打瞌睡 (ms)
  soundEnabled: boolean    // 是否播放音效
  startWithMulby: boolean  // 是否随 Mulby 自动启动
}
```

---

## 10. 开发步骤

### Phase 1: 基础角色

1. 搭建项目，创建透明小窗口
2. 绘制或获取一套 cat 精灵表（至少 idle / walk / jump 动画）
3. 实现 SpriteAnimator 精灵动画引擎
4. 实现窗口位置移动（`window.setPosition`）
5. 实现 idle → walk 基础状态切换

### Phase 2: 输入感知

6. 集成 `inputMonitor`
7. 实现追逐光标行为
8. 实现被点击跳起/受惊反应
9. 实现键盘连击检测 → 加油动作
10. 实现滚轮 → 摇晃效果

### Phase 3: 行为丰富化

11. 实现闲逛（随机走动）
12. 实现坐下 → 打瞌睡 → 唤醒链
13. 实现好奇张望（头转向）
14. 实现庆祝动作（⌘+S 触发）
15. 边界碰撞检测（不走出屏幕）

### Phase 4: 可定制

16. 角色选择功能
17. 设置面板
18. 右键菜单
19. 设置持久化
20. 可选的随 Mulby 启动

### Phase 5: 精雕细琢

21. 更多角色精灵
22. 音效系统（可选）
23. 多屏幕支持
24. 交互动画过渡（不突兀跳切）
25. 粒子效果（庆祝时的撒花）

---

## 11. 美术资源建议

| 方案 | 说明 | 适合 |
|------|------|------|
| 像素风精灵 | 32x32 或 48x48 像素画 | 简单易制作，复古风 |
| 矢量卡通 | SVG / Lottie 动画 | 高清，支持缩放 |
| AI 生成 | 用 AI 生成精灵表 | 快速原型 |
| 开源精灵 | itch.io / OpenGameArt | 免费素材 |

推荐先用像素风做 MVP，后续增加更多高清角色。

---

## 12. 性能优化

| 环节 | 建议 |
|------|------|
| inputMonitor 频率 | `throttleMs: 50`（20fps 足够），不需要 60fps 级实时性 |
| 窗口移动 | 批量合并 position 更新，避免每帧都 IPC |
| 精灵渲染 | Canvas 只渲染一个 64-180px 的小画面，开销极低 |
| 内存 | 精灵表 PNG 通常 < 500KB，无内存压力 |
| CPU | 主循环 50ms tick + rAF 渲染，CPU 占用 < 1% |
