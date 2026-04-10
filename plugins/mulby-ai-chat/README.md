# mulby-ai-chat · AI 助手插件

支持多轮对话的 AI 聊天助手，参考 Cherry Studio 交互风格，集成 Mulby 内置 AI 全部能力。

## 功能特性

| 功能 | 说明 |
|------|------|
| 多模型切换 | 顶栏下拉选择所有已配置模型（allModels） |
| 流式输出 | 实时打字效果，onChunk 回调 + 打字光标动画 |
| 多轮对话 | 完整历史上下文，持久化到 Mulby storage |
| 会话管理 | 左侧列表，支持新建 / 切换 / 删除，最多保存 50 条 |
| 附件上传 | 支持图片（vision）和文件，通过 ai.attachments.upload 上传 |
| AI Skills | 弹出面板选择启用的 Skills，支持手动 / 自动模式 |
| Markdown 渲染 | react-markdown + remark-gfm，代码块语法高亮 |
| 主题跟随 | 监听 onThemeChange，light/dark 双色板 CSS 变量实时切换 |
| Liquid Glass UI | iOS 26 风格毛玻璃+高斯模糊+半透明卡片+高光边框 |

## 触发方式

在 Mulby 搜索栏输入以下任一关键词：

- `ai`
- `chat`  
- `助手`

## 界面说明

```
┌─ 顶栏（拖拽移动）─────────────────────────────┐
│  [Logo] AI 助手   [模型选择器▼]        [✕]   │
├─ 侧边栏 240px ─┬─ 对话区 ─────────────────────┤
│  [+ 新建对话]  │  消息列表（弹入动画）          │
│  会话 1 ✕     │  ···                          │
│  会话 2 ✕     │                               │
│  ···          ├─ 输入区 ─────────────────────┤
│               │  [附件预览]                   │
│               │  ┌────────────────────────┐  │
│               │  │ textarea (Shift+Enter) │  │
│               │  │            [📎][⚡][▶]│  │
│               │  └────────────────────────┘  │
└───────────────┴──────────────────────────────┘
```

## 快捷键

| 按键 | 动作 |
|------|------|
| `Enter` | 发送消息 |
| `Shift+Enter` | 文本框换行 |

## 依赖

- `react-markdown` + `remark-gfm` — Markdown 渲染
- `react-syntax-highlighter` — 代码高亮

## 构建

```bash
npm install
npm run build
npm run pack   # 打包为 .inplugin
```

## 注意事项

- 需要在 Mulby 中配置至少一个 AI Provider 才能正常使用
- 附件上传依赖 Mulby AI 附件 API，图片自动使用 vision 模式
- 会话历史每条会话最多保留 100 条消息
