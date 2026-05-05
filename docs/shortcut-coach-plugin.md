# 快捷键教练插件 — 实现方案

> 版本: v1.0
> 日期: 2026-05-04
> 状态: 设计稿（供插件开发者实现）

---

## 1. 产品概述

快捷键教练（Shortcut Coach）是一个智能快捷键学习助手。它在后台监测用户操作，当用户通过鼠标点击菜单完成某个操作时，自动弹出提示"下次可以用 ⌘+S 更快"，帮助用户逐步养成快捷键习惯，提升操作效率。

### 核心能力

| 功能 | 说明 |
|------|------|
| 菜单点击检测 | 检测用户是否通过鼠标点击了菜单栏操作 |
| 快捷键提示 | 弹出浮窗告知对应的快捷键 |
| 应用快捷键库 | 内置常用应用的快捷键数据库 |
| 学习进度追踪 | 记录用户的快捷键使用进步 |
| 每日统计 | 统计节省的时间和快捷键使用频率 |
| 练习模式 | 引导用户练习某个应用的核心快捷键 |
| 免打扰 | 智能控制提示频率，避免频繁打扰 |
| AI 辅助 | 根据当前应用智能推荐最该学的快捷键 |

---

## 2. manifest.json

```json
{
  "name": "shortcut-coach",
  "version": "1.0.0",
  "displayName": "快捷键教练",
  "description": "智能检测低效操作，推荐快捷键，帮你养成高效键盘习惯",
  "type": "productivity",
  "author": "Mulby Team",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "⌨️",
  "permissions": {
    "inputMonitor": true
  },
  "features": [
    {
      "code": "coach",
      "explain": "快捷键教练",
      "mode": "detached",
      "cmds": [
        { "type": "keyword", "value": "快捷键" },
        { "type": "keyword", "value": "shortcut" },
        { "type": "keyword", "value": "键盘" }
      ]
    },
    {
      "code": "coach-bg",
      "explain": "后台快捷键监测",
      "mode": "silent",
      "cmds": [
        { "type": "keyword", "value": "快捷键监测" }
      ]
    }
  ],
  "window": {
    "width": 420,
    "height": 560,
    "type": "borderless",
    "titleBar": false,
    "alwaysOnTop": false,
    "minWidth": 380,
    "minHeight": 480
  },
  "pluginSetting": {
    "single": true,
    "background": true,
    "persistent": true,
    "idleTimeoutMs": "never",
    "maxRuntime": 0
  }
}
```

**说明**：
- 两个 feature：`coach` 打开仪表盘，`coach-bg` 开启后台监测
- `persistent: true` — 重启后自动恢复监测
- `background: true` + `idleTimeoutMs: "never"` — 常驻后台

---

## 3. 架构设计

```
┌──────────────────────────────────────────────────────────┐
│                     后端 main.js                          │
│                                                          │
│  ┌─────────────────┐  ┌─────────────────┐               │
│  │  inputMonitor    │  │  应用检测模块    │               │
│  │  (鼠标+键盘)     │  │  (前台窗口识别)  │               │
│  └────────┬────────┘  └────────┬────────┘               │
│           │                    │                         │
│           ▼                    ▼                         │
│  ┌──────────────────────────────────────┐               │
│  │         行为分析引擎                   │               │
│  │                                      │               │
│  │  · 菜单点击检测（坐标在菜单栏区域）   │               │
│  │  · 操作模式识别（鼠标点击 vs 快捷键）  │               │
│  │  · 快捷键知识库匹配                   │               │
│  └───────────────┬──────────────────────┘               │
│                  │                                       │
│         ┌────────┴────────┐                             │
│         ▼                 ▼                             │
│  ┌──────────────┐  ┌──────────────────┐                │
│  │ 提示浮窗(子窗口)│  │  统计 & 进度追踪  │                │
│  │  (透明置顶)    │  │  (storage)       │                │
│  └──────────────┘  └──────────────────┘                │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                仪表盘 UI (主窗口)                  │   │
│  │  · 今日统计  · 学习进度  · 练习模式  · 设置      │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 4. 快捷键知识库

### 4.1 数据结构

```typescript
interface ShortcutEntry {
  action: string            // 操作名称，如 "保存", "复制", "全选"
  shortcut: ShortcutCombo   // 快捷键组合
  category: string          // 分类，如 "编辑", "文件", "窗口"
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  priority: number          // 学习优先级 1-10，越高越重要
}

interface ShortcutCombo {
  mac: string      // macOS 显示格式，如 '⌘+S'
  win: string      // Windows 显示格式，如 'Ctrl+S'
  keys: {          // 结构化表示
    key: string
    modifiers: string[]
  }
}

interface AppShortcutSet {
  appName: string           // 应用名（如 "Visual Studio Code"）
  appIdentifiers: string[]  // 匹配标识 ["Code", "VSCode", "com.microsoft.VSCode"]
  platform: 'all' | 'mac' | 'win' | 'linux'
  shortcuts: ShortcutEntry[]
}
```

### 4.2 内置快捷键数据库

```typescript
const UNIVERSAL_SHORTCUTS: ShortcutEntry[] = [
  // 文件操作
  {
    action: '保存',
    shortcut: { mac: '⌘+S', win: 'Ctrl+S', keys: { key: 's', modifiers: ['command'] } },
    category: '文件', difficulty: 'beginner', priority: 10
  },
  {
    action: '另存为',
    shortcut: { mac: '⌘+⇧+S', win: 'Ctrl+Shift+S', keys: { key: 's', modifiers: ['command', 'shift'] } },
    category: '文件', difficulty: 'beginner', priority: 7
  },
  {
    action: '新建',
    shortcut: { mac: '⌘+N', win: 'Ctrl+N', keys: { key: 'n', modifiers: ['command'] } },
    category: '文件', difficulty: 'beginner', priority: 8
  },
  {
    action: '打开',
    shortcut: { mac: '⌘+O', win: 'Ctrl+O', keys: { key: 'o', modifiers: ['command'] } },
    category: '文件', difficulty: 'beginner', priority: 8
  },
  {
    action: '打印',
    shortcut: { mac: '⌘+P', win: 'Ctrl+P', keys: { key: 'p', modifiers: ['command'] } },
    category: '文件', difficulty: 'beginner', priority: 6
  },

  // 编辑操作
  {
    action: '撤销',
    shortcut: { mac: '⌘+Z', win: 'Ctrl+Z', keys: { key: 'z', modifiers: ['command'] } },
    category: '编辑', difficulty: 'beginner', priority: 10
  },
  {
    action: '重做',
    shortcut: { mac: '⌘+⇧+Z', win: 'Ctrl+Y', keys: { key: 'z', modifiers: ['command', 'shift'] } },
    category: '编辑', difficulty: 'beginner', priority: 8
  },
  {
    action: '复制',
    shortcut: { mac: '⌘+C', win: 'Ctrl+C', keys: { key: 'c', modifiers: ['command'] } },
    category: '编辑', difficulty: 'beginner', priority: 10
  },
  {
    action: '粘贴',
    shortcut: { mac: '⌘+V', win: 'Ctrl+V', keys: { key: 'v', modifiers: ['command'] } },
    category: '编辑', difficulty: 'beginner', priority: 10
  },
  {
    action: '剪切',
    shortcut: { mac: '⌘+X', win: 'Ctrl+X', keys: { key: 'x', modifiers: ['command'] } },
    category: '编辑', difficulty: 'beginner', priority: 9
  },
  {
    action: '全选',
    shortcut: { mac: '⌘+A', win: 'Ctrl+A', keys: { key: 'a', modifiers: ['command'] } },
    category: '编辑', difficulty: 'beginner', priority: 9
  },
  {
    action: '查找',
    shortcut: { mac: '⌘+F', win: 'Ctrl+F', keys: { key: 'f', modifiers: ['command'] } },
    category: '编辑', difficulty: 'beginner', priority: 9
  },
  {
    action: '替换',
    shortcut: { mac: '⌘+H', win: 'Ctrl+H', keys: { key: 'h', modifiers: ['command'] } },
    category: '编辑', difficulty: 'intermediate', priority: 7
  },

  // 窗口操作
  {
    action: '关闭窗口',
    shortcut: { mac: '⌘+W', win: 'Ctrl+W', keys: { key: 'w', modifiers: ['command'] } },
    category: '窗口', difficulty: 'beginner', priority: 8
  },
  {
    action: '最小化',
    shortcut: { mac: '⌘+M', win: 'Win+D', keys: { key: 'm', modifiers: ['command'] } },
    category: '窗口', difficulty: 'intermediate', priority: 5
  },
  {
    action: '切换标签页',
    shortcut: { mac: '⌘+⇧+[/]', win: 'Ctrl+Tab', keys: { key: 'Tab', modifiers: ['ctrl'] } },
    category: '窗口', difficulty: 'intermediate', priority: 7
  },

  // 浏览器
  {
    action: '刷新页面',
    shortcut: { mac: '⌘+R', win: 'Ctrl+R', keys: { key: 'r', modifiers: ['command'] } },
    category: '浏览器', difficulty: 'beginner', priority: 8
  },
  {
    action: '新建标签页',
    shortcut: { mac: '⌘+T', win: 'Ctrl+T', keys: { key: 't', modifiers: ['command'] } },
    category: '浏览器', difficulty: 'beginner', priority: 8
  },
  {
    action: '地址栏',
    shortcut: { mac: '⌘+L', win: 'Ctrl+L', keys: { key: 'l', modifiers: ['command'] } },
    category: '浏览器', difficulty: 'intermediate', priority: 7
  },
]

const APP_SHORTCUTS: AppShortcutSet[] = [
  {
    appName: 'Visual Studio Code',
    appIdentifiers: ['Code', 'VSCode', 'com.microsoft.VSCode'],
    platform: 'all',
    shortcuts: [
      {
        action: '命令面板',
        shortcut: { mac: '⌘+⇧+P', win: 'Ctrl+Shift+P', keys: { key: 'p', modifiers: ['command', 'shift'] } },
        category: 'VSCode', difficulty: 'beginner', priority: 10
      },
      {
        action: '快速打开文件',
        shortcut: { mac: '⌘+P', win: 'Ctrl+P', keys: { key: 'p', modifiers: ['command'] } },
        category: 'VSCode', difficulty: 'beginner', priority: 10
      },
      {
        action: '切换终端',
        shortcut: { mac: '⌃+`', win: 'Ctrl+`', keys: { key: '`', modifiers: ['ctrl'] } },
        category: 'VSCode', difficulty: 'intermediate', priority: 9
      },
      {
        action: '多光标',
        shortcut: { mac: '⌥+Click', win: 'Alt+Click', keys: { key: 'click', modifiers: ['alt'] } },
        category: 'VSCode', difficulty: 'advanced', priority: 7
      },
      // ... 更多 VSCode 快捷键
    ]
  },
  {
    appName: 'Chrome',
    appIdentifiers: ['Google Chrome', 'Chrome', 'com.google.Chrome'],
    platform: 'all',
    shortcuts: [
      {
        action: '开发者工具',
        shortcut: { mac: '⌘+⌥+I', win: 'Ctrl+Shift+I', keys: { key: 'i', modifiers: ['command', 'alt'] } },
        category: 'Chrome', difficulty: 'intermediate', priority: 8
      },
      // ... 更多 Chrome 快捷键
    ]
  },
  // Figma, Slack, Terminal, Finder/Explorer 等
]
```

---

## 5. 行为分析引擎

### 5.1 菜单点击检测

检测用户是否通过鼠标点击了应用的菜单栏：

```typescript
interface MenuClickDetector {
  isMenuBarClick(event: GlobalInputEvent, display: DisplayInfo): boolean
  isToolbarClick(event: GlobalInputEvent): boolean
  getClickContext(events: GlobalInputEvent[]): ClickContext
}

interface ClickContext {
  isMenuArea: boolean       // 是否点击了菜单区域
  sequencePattern: string   // 操作模式，如 "menu-click-click"（二级菜单）
  timeSinceLastKey: number  // 距离上次键盘操作的时间
}

function isMenuBarClick(event: GlobalInputEvent, display: DisplayInfo): boolean {
  if (event.type !== 'mouseDown' || event.button !== 'left') return false

  const menuBarHeight = process.platform === 'darwin' ? 25 : 30

  // macOS: 菜单栏在屏幕最顶部（y < 25px）
  // Windows: 每个窗口顶部区域
  if (process.platform === 'darwin') {
    return event.y >= display.bounds.y && event.y <= display.bounds.y + menuBarHeight
  }

  // Windows: 窗口标题栏下方约 25-60px 区域通常是菜单栏
  // 这个需要更精确的检测，简单版先用区域估算
  return event.y >= 30 && event.y <= 60
}
```

### 5.2 操作模式识别

分析一段操作序列，识别"用鼠标点击菜单完成了一个本可以用快捷键的操作"：

```typescript
interface OperationPattern {
  type: 'menu_save' | 'menu_copy' | 'menu_paste' | 'menu_undo' | 'menu_find' | 'toolbar_click' | 'unknown'
  confidence: number   // 0-1
  matchedShortcut?: ShortcutEntry
}

function analyzeRecentPattern(
  events: GlobalInputEvent[],
  currentApp: string,
  shortcuts: ShortcutEntry[]
): OperationPattern | null {
  // 模式 1: 菜单栏 → 下拉菜单 → 点击（两次连续的菜单区域点击）
  const recentClicks = events
    .filter(e => e.type === 'mouseDown' && e.button === 'left')
    .slice(-5)

  if (recentClicks.length >= 2) {
    const [first, second] = recentClicks.slice(-2)
    const timeDiff = second.timestamp - first.timestamp

    // 两次点击间隔 200ms-3000ms，且第一次在菜单栏区域
    if (timeDiff > 200 && timeDiff < 3000) {
      // 检测到菜单操作模式
      // 根据前台应用和上下文猜测操作类型
      return inferMenuOperation(first, second, currentApp, shortcuts)
    }
  }

  // 模式 2: 右键点击 → 上下文菜单选择
  const rightClick = events.findLast(e => e.type === 'mouseDown' && e.button === 'right')
  if (rightClick) {
    const afterRight = events.filter(e =>
      e.timestamp > rightClick.timestamp &&
      e.type === 'mouseDown' &&
      e.button === 'left'
    )
    if (afterRight.length === 1) {
      const timeDiff = afterRight[0].timestamp - rightClick.timestamp
      if (timeDiff > 100 && timeDiff < 5000) {
        return { type: 'toolbar_click', confidence: 0.6 }
      }
    }
  }

  return null
}
```

### 5.3 智能提示触发

```typescript
class CoachEngine {
  private recentEvents: GlobalInputEvent[] = []
  private eventWindow = 30       // 保留最近 30 个事件
  private lastTipTime = 0
  private tipCooldown = 30000    // 同一提示至少间隔 30 秒
  private shownTips = new Map<string, number>()  // shortcut key → 已提示次数

  processEvent(event: GlobalInputEvent, currentApp: string) {
    this.recentEvents.push(event)
    if (this.recentEvents.length > this.eventWindow) {
      this.recentEvents.shift()
    }

    // 检测快捷键使用（正面反馈）
    if (this.isShortcutUsage(event)) {
      this.recordShortcutUsage(event, currentApp)
      return
    }

    // 检测菜单操作（提示机会）
    const pattern = analyzeRecentPattern(
      this.recentEvents,
      currentApp,
      this.getShortcutsForApp(currentApp)
    )

    if (pattern && pattern.matchedShortcut && pattern.confidence > 0.5) {
      this.maybeShowTip(pattern.matchedShortcut, currentApp)
    }
  }

  private isShortcutUsage(event: GlobalInputEvent): boolean {
    if (event.type !== 'keyDown') return false
    const hasModifier = event.meta || event.ctrl || event.alt
    return hasModifier && !!event.key
  }

  private maybeShowTip(shortcut: ShortcutEntry, app: string) {
    const now = Date.now()
    const tipKey = `${app}:${shortcut.action}`

    // 冷却检查
    if (now - this.lastTipTime < this.tipCooldown) return

    // 已提示次数检查（同一快捷键最多提示 5 次）
    const count = this.shownTips.get(tipKey) ?? 0
    if (count >= 5) return

    // 触发提示
    this.lastTipTime = now
    this.shownTips.set(tipKey, count + 1)
    this.showTip(shortcut, app)
  }

  private showTip(shortcut: ShortcutEntry, app: string) {
    // 通过 IPC 通知 UI 显示提示浮窗
    this.emit('show-tip', {
      action: shortcut.action,
      shortcut: process.platform === 'darwin' ? shortcut.shortcut.mac : shortcut.shortcut.win,
      app,
      difficulty: shortcut.difficulty
    })
  }
}
```

---

## 6. 提示浮窗

提示浮窗是一个小型透明子窗口，出现在屏幕右上角或鼠标附近：

### 6.1 创建提示窗口

```typescript
async function showTipWindow(tip: TipData): Promise<void> {
  const display = await mulby.screen.getPrimaryDisplay()
  const tipWidth = 300
  const tipHeight = 80

  const tipWindow = await mulby.window.create('tip', {
    type: 'borderless',
    width: tipWidth,
    height: tipHeight,
    x: display.bounds.x + display.bounds.width - tipWidth - 20,
    y: display.bounds.y + 40,
    transparent: true,
    alwaysOnTop: true,
    titleBar: false,
    opacity: 0,  // 初始透明，渐入
    params: {
      action: tip.action,
      shortcut: tip.shortcut,
      app: tip.app
    }
  })

  // 渐入动画
  for (let i = 0; i <= 10; i++) {
    await sleep(30)
    await tipWindow.setOpacity(i / 10)
  }

  // 5 秒后渐出
  await sleep(5000)
  for (let i = 10; i >= 0; i--) {
    await sleep(30)
    await tipWindow.setOpacity(i / 10)
  }
  await tipWindow.close()
}
```

### 6.2 提示 UI 组件

```typescript
function TipBubble() {
  const params = usePluginParams()

  return (
    <div className="tip-bubble">
      <div className="tip-icon">💡</div>
      <div className="tip-content">
        <div className="tip-message">
          <span className="tip-action">{params.action}</span> 可以用
        </div>
        <div className="tip-shortcut">
          <kbd>{params.shortcut}</kbd>
        </div>
      </div>
      <div className="tip-dismiss" onClick={() => mulby.window.close()}>✕</div>
    </div>
  )
}
```

**提示样式：**

```css
.tip-bubble {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(12px);
  border-radius: 12px;
  color: white;
  font-size: 14px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  animation: slideIn 0.3s ease;
}

.tip-shortcut kbd {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(59, 130, 246, 0.3);
  border: 1px solid rgba(59, 130, 246, 0.5);
  border-radius: 6px;
  font-family: -apple-system, monospace;
  font-size: 16px;
  font-weight: 600;
  color: #60a5fa;
}

@keyframes slideIn {
  from { transform: translateX(20px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
```

---

## 7. 学习进度追踪

### 7.1 数据模型

```typescript
interface LearningProgress {
  userId: string
  shortcuts: ShortcutProgress[]
  dailyStats: DailyStats[]
  streak: number              // 连续使用天数
  level: 'beginner' | 'intermediate' | 'advanced' | 'master'
  totalShortcutsLearned: number
  totalTimeSaved: number      // 累计节省的秒数
}

interface ShortcutProgress {
  app: string
  action: string
  shortcutKey: string
  // 学习状态
  status: 'unseen' | 'reminded' | 'learning' | 'mastered'
  // 统计
  menuClickCount: number      // 通过鼠标点击的次数
  shortcutUseCount: number    // 使用快捷键的次数
  reminderCount: number       // 被提醒的次数
  lastRemindedAt: number
  lastUsedAt: number
  firstUsedAt: number
  // 连续使用快捷键的天数
  consecutiveDays: number
}

interface DailyStats {
  date: string                // YYYY-MM-DD
  menuClicks: number          // 当日鼠标菜单操作次数
  shortcutUses: number        // 当日快捷键使用次数
  tipsDismissed: number       // 当日忽略的提示次数
  tipsFollowed: number        // 当日采纳的提示次数（提示后 30s 内使用了快捷键）
  newShortcutsLearned: number // 当日新学会的快捷键
  estimatedTimeSaved: number  // 当日估算节省的时间（秒）
}
```

### 7.2 进度判定

```typescript
function updateShortcutStatus(progress: ShortcutProgress): void {
  const ratio = progress.shortcutUseCount / (progress.menuClickCount + progress.shortcutUseCount + 1)

  if (progress.shortcutUseCount === 0) {
    if (progress.reminderCount > 0) {
      progress.status = 'reminded'
    } else {
      progress.status = 'unseen'
    }
  } else if (ratio < 0.5 || progress.consecutiveDays < 3) {
    progress.status = 'learning'
  } else if (ratio >= 0.8 && progress.consecutiveDays >= 5) {
    progress.status = 'mastered'
  } else {
    progress.status = 'learning'
  }
}

function estimateTimeSaved(shortcutUseCount: number): number {
  // 每次使用快捷键比鼠标点击菜单平均节省 3 秒
  return shortcutUseCount * 3
}
```

---

## 8. 仪表盘 UI

### 8.1 主面板布局

```
┌────────────────────────────────────────────────┐
│  ⌨️ 快捷键教练                           ─ □ x │
├────────────────────────────────────────────────┤
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  🔥 连续 12 天      🏆 Level: 进阶      │  │
│  │                                          │  │
│  │  今日快捷键使用: 47 次                   │  │
│  │  今日节省时间:  ~2 分 21 秒              │  │
│  │  ████████████████████░░░░  80% 效率      │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ─── 正在学习 (3) ──────────────────────────── │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ ⌘+⇧+P  命令面板 (VSCode)                │  │
│  │ ████████░░  使用 8/10 次                 │  │
│  ├──────────────────────────────────────────┤  │
│  │ ⌘+K ⌘+S  键盘快捷方式 (VSCode)          │  │
│  │ ███░░░░░░  使用 3/10 次                  │  │
│  ├──────────────────────────────────────────┤  │
│  │ ⌘+⌥+I  开发者工具 (Chrome)               │  │
│  │ █░░░░░░░░  使用 1/10 次                  │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ─── 已掌握 (15) ─────────────── [查看全部 →] │
│  ⌘+S ⌘+C ⌘+V ⌘+Z ⌘+A ⌘+F ⌘+W ...          │
│                                                │
│  ─── 推荐学习 ─────────────────────────────── │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │ 💡 在 VSCode 中，你经常通过鼠标打开终端   │  │
│  │    试试 ⌃+`，一键切换！                   │  │
│  │                     [开始练习] [稍后再说]  │  │
│  └──────────────────────────────────────────┘  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │     [📊 统计报告]    [🎯 练习模式]        │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### 8.2 统计报告页

```
┌────────────────────────────────────────────────┐
│  📊 学习统计                         [← 返回]  │
├────────────────────────────────────────────────┤
│                                                │
│  ─── 本周趋势 ──────────────────────────────── │
│                                                │
│  快捷键 vs 鼠标操作                            │
│  100%│ ██                                      │
│   75%│ ██ ██                                   │
│   50%│ ██ ██ ██ ██                             │
│   25%│ ██ ██ ██ ██ ██ ██ ██                    │
│    0%│──────────────────                       │
│      │ 一  二  三  四  五  六  日              │
│                                                │
│  ─── 应用 TOP 5 ────────────────────────────── │
│                                                │
│  1. VSCode        ████████████  89 次          │
│  2. Chrome        ████████░░░  56 次           │
│  3. Figma         ████░░░░░░░  23 次           │
│  4. Terminal      ███░░░░░░░░  18 次           │
│  5. Finder        ██░░░░░░░░░  12 次           │
│                                                │
│  ─── 成就 ──────────────────────────────────── │
│  🏅 快捷键新手      ✅ 首次使用快捷键          │
│  🏅 一周坚持        ✅ 连续 7 天使用           │
│  🏅 效率达人        ✅ 单日快捷键使用 > 50     │
│  🏅 全能选手        ⬜ 掌握 30 个快捷键        │
│  🏅 速度之王        ⬜ 月度效率 > 90%          │
│                                                │
└────────────────────────────────────────────────┘
```

### 8.3 练习模式

交互式练习，引导用户按下指定快捷键：

```typescript
function PracticeMode({ app, shortcuts }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [score, setScore] = useState(0)
  const [attempts, setAttempts] = useState(0)
  const current = shortcuts[currentIndex]

  // 监听键盘事件判断用户是否按对
  useEffect(() => {
    const cleanup = mulby.inputMonitor.onEvent((event) => {
      if (event.type !== 'keyDown') return

      setAttempts(a => a + 1)
      const isCorrect = matchesShortcut(event, current.shortcut.keys)

      if (isCorrect) {
        setScore(s => s + 1)
        // 正确动画
        showFeedback('correct')
        setTimeout(() => setCurrentIndex(i => i + 1), 800)
      } else {
        // 错误提示
        showFeedback('wrong')
      }
    })

    return cleanup
  }, [currentIndex])

  return (
    <div className="practice-mode">
      <div className="practice-prompt">
        <div className="practice-action">{current.action}</div>
        <div className="practice-hint">请按下对应的快捷键</div>
        {attempts > 2 && (
          <div className="practice-answer">
            提示: <kbd>{current.shortcut.mac}</kbd>
          </div>
        )}
      </div>
      <div className="practice-progress">
        {currentIndex + 1} / {shortcuts.length}
      </div>
      <div className="practice-score">
        正确率: {Math.round(score / Math.max(attempts, 1) * 100)}%
      </div>
    </div>
  )
}

function matchesShortcut(event: GlobalInputEvent, expected: { key: string; modifiers: string[] }): boolean {
  if (event.key?.toLowerCase() !== expected.key.toLowerCase()) return false

  const eventMods = new Set<string>()
  if (event.meta) eventMods.add('command')
  if (event.ctrl) eventMods.add('ctrl')
  if (event.alt) eventMods.add('alt')
  if (event.shift) eventMods.add('shift')

  const expectedMods = new Set(expected.modifiers)
  if (eventMods.size !== expectedMods.size) return false

  for (const mod of expectedMods) {
    if (!eventMods.has(mod)) return false
  }

  return true
}
```

---

## 9. 免打扰策略

```typescript
interface QuietConfig {
  maxTipsPerHour: number        // 每小时最多提示次数，默认 5
  cooldownAfterDismiss: number  // 用户关闭提示后冷却时间 (ms)，默认 120000 (2分钟)
  maxTipsPerShortcut: number    // 同一快捷键最多提示次数，默认 5
  quietHours: {                 // 免打扰时段
    enabled: boolean
    start: string               // "22:00"
    end: string                 // "09:00"
  }
  disabledApps: string[]        // 不监测的应用列表
  onlyShowForNew: boolean       // 只对未学过的快捷键提示
}
```

---

## 10. 前台应用检测

通过 `window` 类型 cmd 匹配或系统 API 获取当前前台应用：

```typescript
// 后端可以通过 Mulby system API 获取前台应用信息
async function getCurrentApp(): Promise<string> {
  // 方案 1: 通过 Mulby 已有的窗口匹配能力
  // features 中的 window cmd 类型可以匹配前台应用

  // 方案 2: 通过 Electron 的 BrowserWindow.getFocusedWindow()
  // 但这只能获取 Mulby 自己的窗口

  // 方案 3: 通过系统命令获取（最可靠）
  if (process.platform === 'darwin') {
    // AppleScript: tell app "System Events" to get name of first application process whose frontmost is true
    const result = await mulby.shell.exec(
      'osascript -e \'tell application "System Events" to get name of first application process whose frontmost is true\''
    )
    return result.stdout.trim()
  }

  // Windows: PowerShell
  if (process.platform === 'win32') {
    const result = await mulby.shell.exec(
      'powershell -command "(Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Sort-Object -Property CPU -Descending | Select-Object -First 1).ProcessName"'
    )
    return result.stdout.trim()
  }

  return 'unknown'
}
```

---

## 11. 开发步骤

### Phase 1: 基础监测

1. 搭建项目骨架
2. 集成 `inputMonitor`，监听鼠标和键盘
3. 实现前台应用检测
4. 实现菜单区域点击检测
5. 内置通用快捷键数据库

### Phase 2: 提示系统

6. 实现行为分析引擎（菜单操作 → 快捷键匹配）
7. 创建提示浮窗子窗口
8. 实现提示渐入渐出动画
9. 实现免打扰策略（冷却、频率限制）
10. 实现快捷键使用检测（正面反馈）

### Phase 3: 学习进度

11. 进度数据模型和存储
12. 快捷键状态追踪（unseen → reminded → learning → mastered）
13. 仪表盘主界面
14. 正在学习和已掌握列表

### Phase 4: 统计 & 练习

15. 每日统计数据采集
16. 统计报告页（趋势图、应用 TOP5）
17. 成就系统
18. 交互式练习模式

### Phase 5: 应用扩展

19. 添加 VSCode 专用快捷键集
20. 添加 Chrome/Safari 专用快捷键集
21. 添加 Figma/Slack/Terminal 等
22. 支持用户自定义快捷键条目

### Phase 6: 智能化

23. AI 辅助推荐（基于使用模式推荐最该学的快捷键）
24. 自适应提示频率（根据用户接受度调整）
25. 周报/月报生成
26. 导出学习报告

---

## 12. 挑战与注意事项

| 挑战 | 应对策略 |
|------|---------|
| 菜单操作识别准确率 | 初版用坐标区域估算，后续可结合 Accessibility API 精确检测 |
| 操作意图判断 | 并非所有菜单点击都需要快捷键替代（如浏览菜单），需要智能过滤 |
| 前台应用检测 | macOS 可用 AppleScript，Windows 用 PowerShell，有性能开销需缓存 |
| 提示时机 | 用户操作完成后再提示，不要在操作中途打断 |
| 隐私顾虑 | 键盘监听可能引发隐私担忧，需要透明说明只统计快捷键模式不记录内容 |
| 跨平台快捷键差异 | 同一操作 macOS 和 Windows 快捷键不同，数据库需要双平台条目 |
| 自定义快捷键 | 用户可能修改了应用的默认快捷键，需支持自定义覆盖 |
