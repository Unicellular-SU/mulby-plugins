# AI Translator

基于 Mulby 系统内置 AI 的翻译插件。

## 已实现能力

- 源语言可选，默认 `自动检测`
- 目标语言可选
- 翻译使用系统内置 `window.mulby.ai.call`
- 内置翻译系统提示词（仅输出译文、保留格式、语义一致）
- 设置页支持：
  - 选择系统可用模型（来自 `ai.allModels()`）
  - 设置默认目标语言（持久化到插件存储）

## 创建命令

此插件由以下命令创建：

```bash
node ../packages/mulby-cli/dist/index.js create ai-translator
```

## 触发方式

- `ai-translator` / `翻译` / `translate`：打开翻译页
- `翻译设置` / `translator-settings`：打开设置页

## 开发与打包

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run pack
```
