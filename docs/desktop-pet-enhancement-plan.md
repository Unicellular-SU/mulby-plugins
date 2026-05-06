# 桌面宠物功能增强计划

## 概述

在现有幽灵宠物基础上，结合 Mulby AI 能力，打造更丰富有趣的桌面伴侣体验。
保持单一幽灵形象不变，通过行为、互动和数据系统增加深度。

## 实施状态

| 模块 | 状态 | 完成时间 |
|------|------|----------|
| 亲密度系统 | ✅ 完成 | 2026-05-06 |
| 番茄钟专注模式 | ✅ 完成 | 2026-05-06 |
| 定时提醒 | ✅ 完成 | 2026-05-06 |
| 快捷问答 | ✅ 完成（通过点击互动） | 2026-05-06 |
| 剪贴板翻译 | ✅ 完成 | 2026-05-06 |
| 统计面板 | ✅ 完成 | 2026-05-06 |
| 设置页面整合 | ✅ 完成 | 2026-05-06 |
| 记忆系统 | ✅ 完成 | 2026-05-06 |

---

## 模块一：亲密度系统

### 数据模型

```typescript
interface PetStats {
  intimacy: number            // 亲密度 0-100
  totalInteractions: number   // 累计互动次数
  totalFocusMinutes: number   // 累计专注分钟数
  streakDays: number          // 连续签到天数
  lastSignInDate: string      // YYYY-MM-DD
  mood: 'happy' | 'neutral' | 'sad' | 'sleepy'
  createdAt: number           // 宠物诞生时间戳
  pomodoroToday: number       // 今日完成番茄数
  pomodoroTotal: number       // 累计番茄数
}
```

### 亲密度规则

| 行为 | 变化 | 限制 |
|------|------|------|
| 每日签到 | +3 | 每天一次 |
| 完成番茄钟 | +5 | 无限制 |
| 连续签到 | +1/天额外 | 上限 +7 |
| 点击互动 | +1 | 每 5 分钟一次 |
| AI 对话 | +1 | 每 10 分钟一次 |
| 超过 2 天不登录 | -2/天 | — |

### 亲密度影响

- 0-20：宠物较冷淡，少主动说话
- 20-50：正常频率互动
- 50-80：更多鼓励性台词、主动卖萌
- 80-100：特殊亲密台词、偶尔彩蛋

### API 依赖

- `mulby.storage` → 持久化 PetStats
- `mulby.power.onResume` → 检测离线天数

---

## 模块二：番茄钟专注模式

### 流程

1. 右键菜单 → "开始专注" 或快捷键
2. 气泡显示倒计时 `🍅 24:59`
3. 专注中：宠物 sleepy 表情，安静浮动
4. 完成：excited 动画 + 鼓励语 + 亲密度 +5
5. 休息 5 分钟：happy 表情 + 休息提示
6. 中途放弃：sad 表情 + 安慰语

### 技术方案

- 倒计时 `setInterval(1000)` 更新气泡文本
- 状态存到 `mulby.storage` 防刷新丢失
- `inputMonitor` 检测键盘活动（判断是否在工作）
- 完成后更新 `PetStats.pomodoroToday/Total/totalFocusMinutes`

### 设置项（整合到现有设置页）

- 专注时长：15/25/45/60 分钟
- 休息时长：5/10/15 分钟
- 自动开始下一轮：开/关
- 完成提示音：开/关（`mulby.shell.beep`）

---

## 模块三：定时提醒

### 默认提醒

| 类型 | 间隔 | 宠物表情 | 台词示例 |
|------|------|---------|---------|
| 喝水 | 45 分钟 | neutral | "该喝水啦~" |
| 休息眼睛 | 90 分钟 | sleepy | "眼睛累了，看看远处~" |

### 技术方案

- 使用 `setInterval` 在 UI 层计时
- 仅在用户活跃时触发（通过 `inputMonitor` 判断）
- 设置页可开关各类提醒、调整间隔

---

## 模块四：快捷问答

### 流程

1. 全局快捷键（默认 `Cmd+Shift+P`）→ 宠物窗口顶部出现输入框
2. 用户输入问题 → AI 回答 → 气泡显示
3. Enter 发送，Esc 关闭

### 技术方案

- `mulby.shortcut.register('CommandOrControl+Shift+P')` 注册快捷键
- 输入框直接在宠物窗口上方渲染（调整窗口高度）
- 复用 `AIChatController` 的上下文和模型设置
- AI 回答限制 50 字以内，超出时气泡显示摘要

---

## 模块五：剪贴板翻译

### 触发条件

- 剪贴板内容变化
- 内容为英文（非中文字符 > 70%）
- 长度 > 20 字符

### 流程

1. 检测到英文内容 → 宠物 surprised + "要翻译吗？"
2. 用户点击宠物 → AI 翻译 → 气泡显示中文结果
3. 可选：自动写回剪贴板

### 技术方案

- 3 秒轮询 `mulby.clipboard.readText()`
- 设置中可开关此功能
- 冷却时间 30 秒（防频繁触发）

---

## 模块六：统计面板

### 内容

- 今日专注时间 / 番茄数
- 亲密度等级和进度
- 连续签到天数
- 本周专注趋势（简单柱状图）

### 技术方案

- 右键菜单 → "今日统计" → `mulby.window.create` 打开面板窗口
- 或整合到现有设置页面的新 Tab

---

## 设置页面整合

在现有 `SettingsView.tsx` 中增加 Tab：

| Tab | 内容 |
|-----|------|
| 性格设置 | 现有：名字、性格、AI 模型、频率、触发器 |
| 专注设置 | 新增：番茄钟时长、休息时长、自动循环 |
| 提醒设置 | 新增：喝水/休息提醒开关和间隔 |
| 助手设置 | 新增：剪贴板翻译开关、快捷键配置 |
| 我的宠物 | 新增：亲密度、统计、签到天数 |

---

## 右键菜单设计

```
💬 问一问
🍅 开始专注 (25分钟)
📋 翻译剪贴板
──────────────
📊 今日统计
⚙️ 设置
──────────────
😴 暂时隐藏
❌ 退出宠物
```

---

## 实施顺序

1. **P0** 亲密度系统（数据模型 + 签到 + 存储）
2. **P0** 番茄钟（倒计时 + 表情切换 + 气泡显示）
3. **P1** 定时提醒（喝水/休息）
4. **P1** 右键菜单扩展
5. **P1** 快捷问答
6. **P2** 剪贴板翻译
7. **P2** 统计面板 / 设置页整合

---

## 模块七：记忆系统

### 设计理念

宠物需要"记住"与用户互动的关键信息，形成持续性人格和上下文，而非每次对话都像陌生人。

### 记忆分层架构

```
┌─────────────────────────────────────────┐
│ Layer 3: 长期记忆 (Long-term Memory)      │
│ - 用户习惯/偏好/重要事件                    │
│ - 永久存储，AI 每次对话时注入 system prompt │
│ - 最多 20 条，超出时 AI 压缩合并            │
├─────────────────────────────────────────┤
│ Layer 2: 短期对话 (Chat History)          │
│ - 最近 100 条对话记录                      │
│ - 已实现：传递 50 条给 AI                  │
├─────────────────────────────────────────┤
│ Layer 1: 即时状态 (Current Context)       │
│ - 当前时间、亲密度、番茄钟状态              │
│ - 实时计算，不存储                         │
└─────────────────────────────────────────┘
```

### 长期记忆数据模型

```typescript
interface PetMemory {
  id: string
  type: 'fact' | 'preference' | 'event' | 'habit'
  content: string        // 记忆内容
  createdAt: number
  importance: number     // 1-5
  lastUsedAt: number
  pinned: boolean        // 是否固定（始终注入上下文）
  tags: string[]         // 关键词标签，用于检索
}
```

### 记忆分类

| 类型 | 说明 | 示例 | 默认重要性 |
|------|------|------|-----------|
| fact | 用户基本信息 | "用户是前端程序员"、"用户叫小明" | 4 |
| preference | 偏好和态度 | "用户不喜欢被催促"、"喜欢喝奶茶" | 3 |
| event | 重要事件 | "用户 5 月完成了大项目" | 2 |
| habit | 行为习惯 | "用户通常晚上 11 点下线" | 3 |

### 记忆存储策略（无限容量 + 检索）

**存储**：全部记忆保存在 `mulby.storage`，无数量上限。

**检索策略**（参考 Aura / AgeMem）：
1. **Pinned（固定记忆）**：始终注入 system prompt，不超过 10 条
2. **按相关性检索**：每次对话前，根据当前 trigger reason + 最近对话关键词，
   从全部记忆中检索最相关的 5 条非固定记忆
3. **按时间衰减**：最近 7 天内创建的记忆优先级 +1

**检索算法**（无向量数据库，基于标签匹配）：
```typescript
function retrieveMemories(allMemories, context) {
  const pinned = allMemories.filter(m => m.pinned)
  const candidates = allMemories.filter(m => !m.pinned)

  // 打分：标签命中 +3，最近7天 +1，importance +1，最近使用 +1
  const scored = candidates.map(m => ({
    ...m,
    score: tagMatchScore(m.tags, context.keywords) * 3
           + (isRecent(m, 7) ? 1 : 0)
           + m.importance
           + (recentlyUsed(m) ? 1 : 0)
  }))

  return [...pinned, ...scored.sort((a,b) => b.score - a.score).slice(0, 5)]
}
```

### 记忆采集

**被动采集**（每次对话后）：
- 条件：对话包含用户主动输入（user_click）
- 方法：单独 AI 调用，prompt 要求提取 0-1 条有价值记忆
- 输入：最近 3 条对话
- 输出：`{ type, content, importance, tags } | null`

**主动整理**（每 20 次对话后）：
- AI 审查最近的 event 记忆，合并/删除过时的
- 将重复出现的 event 提升为 habit

### 注入方式

```typescript
function buildSystemPrompt(personality, memories) {
  let prompt = '...'  // 原有人设
  if (memories.length > 0) {
    prompt += '\n\n## 你对用户的记忆\n'
    memories.filter(m => m.pinned).forEach(m => {
      prompt += `[重要] ${m.content}\n`
    })
    memories.filter(m => !m.pinned).forEach(m => {
      prompt += `- ${m.content}\n`
    })
    prompt += '\n请在对话中自然体现你记得这些信息，但不要刻意提及。'
  }
  return prompt
}
```

### API 依赖

- `mulby.storage` → 持久化全部记忆（无限容量）
- `mulby.ai.call` → 记忆提取 / 整理 / 检索打分

### 实现步骤

1. 创建 `pet-memory.ts`（存储、检索、采集逻辑）
2. 修改 `ai-chat.ts` 注入记忆到 system prompt
3. 对话结束后异步触发记忆提取
4. 设置页面增加"记忆"Tab（查看/Pin/删除）
