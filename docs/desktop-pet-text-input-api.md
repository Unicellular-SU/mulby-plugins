# 宿主 API 需求：`mulby.inputMonitor.onTextInput`

## 背景

桌面宠物插件需要感知用户在其他应用中正在输入的文本内容，以便基于宠物性格对用户的输入做出个性化回应（吐槽、评论、建议等）。

## 当前状态

`mulby.inputMonitor` 已支持：
- `mouseMove` — 鼠标坐标
- `mouseDown` / `mouseUp` — 鼠标点击
- `keyDown` / `keyUp` — 键盘按键事件（只有键码，没有文本内容）

**缺失能力**：无法获取用户实际输入的文本内容（如输入法组合后的中文、完整的单词等）。

## 需求

### API 定义

```typescript
interface TextInputEvent {
  text: string          // 用户输入的文本片段（如"你好"、"hello"）
  timestamp: number     // 时间戳
  source?: string       // 可选：来源应用名称（如 "WeChat"、"Chrome"）
}

mulby.inputMonitor.onTextInput(
  callback: (event: TextInputEvent) => void
): void
```

### 技术实现建议

macOS 方案：
- 利用 `CGEventTap` + `kCGEventKeyDown` 的 `CGEventKeyboardGetUnicodeString`
- 或使用 macOS Accessibility API（`AXUIElementCopyAttributeValue` 获取 focused element 的 value）
- 或监听 Input Method 的 committed text（`NSTextInputClient`）

Windows 方案：
- 使用 `SetWindowsHookEx` 的 `WH_KEYBOARD_LL` 配合 `ToUnicodeEx` 获取实际字符
- 或通过 UI Automation 获取 focused text field 内容

### 使用场景

1. 用户在微信输入"今天好累" → 宠物基于性格回应"切，才干了多久就喊累"
2. 用户在代码编辑器写代码 → 宠物观察到在写代码，适时鼓励或吐槽
3. 用户在搜索引擎输入关键词 → 宠物好奇"你在搜什么呀？"

### 隐私考虑

- 建议增加白名单/黑名单设置，用户可选择哪些应用的输入被监控
- 插件需声明 `"textInput": true` 权限
- 文本不做持久化存储，仅用于实时 AI 上下文

### 替代方案（当前已有）

如果此 API 短期内无法实现，插件已通过剪贴板监控 (`mulby.clipboard.readText()`) 实现部分功能：
- 用户复制的内容可以被读取和响应
- 但覆盖面有限，只能响应"复制"操作

---

## 优先级

**中等** — 有此 API 可大幅提升宠物的"存在感"和互动趣味性，但不是核心功能的阻塞项。
