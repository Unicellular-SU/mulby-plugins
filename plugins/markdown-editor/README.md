# Markdown 编辑器

一个轻量的 Mulby Markdown 编辑插件，默认进入接近 Typora 的普通模式，直接在可视化排版结果上编辑，并保留源代码模式入口。

## 功能

- 默认普通模式：直接在排版结果上编辑正文
- 提供源代码模式入口：切回纯 Markdown 编辑
- 基础工具栏：撤销/重做、标题、粗体、斜体、链接、引用、代码、列表、任务列表、分割线
- 撤销 / 重做：工具栏按钮 + 快捷键（`Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y` 重做）
- 文件工作流：新建空白文档、打开文件（绑定路径）、保存到原文件、另存为
  - `Ctrl/Cmd+S`：已打开文件时保存到该文件，未绑定文件时保存草稿；`Ctrl/Cmd+Shift+S` 另存为
  - 标题栏显示文件名、`•` 脏标记，以及当前是「文件」还是「草稿」
- 查找 / 替换：`Ctrl/Cmd+F` 查找、`Ctrl/Cmd+H` 替换，支持区分大小写、全词匹配、命中计数与上一处/下一处跳转、替换当前/全部替换
- 自动草稿保存到插件存储（未绑定文件时），也支持手动保存
- 支持从剪贴板粘贴、从本地打开 Markdown/TXT 文件、导出 `.md` 文件
- 支持通过划词把外部文本直接带入编辑器

## 触发方式

- 关键词：`markdown` / `markdown 编辑` / `Markdown 编辑器`
- 划词动作：`用 Markdown 编辑`

## 开发

```bash
cd plugins/markdown-editor
pnpm run build
pnpm run pack
```
