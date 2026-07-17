# 截图标注

区域截图后打开一个透明、无边框的独立窗口，用画布直接标注截图并导出结果。

## 功能

- 区域截图：触发 `annotate` 功能前由 Mulby 执行 `preCapture: "region"`。
- 贴合截图区域：窗口使用 `position: "capture-region"` 和 `fit: "capture-region-with-toolbar"`，工具条使用 96px 双排布局；小截图会保留截图原尺寸画布，但窗口宽度至少为 1080px 以完整显示增强工具条。
- 透明窗口缩放：插件自绘边缘拖拽热区并调用宿主 `window.resizeDrag`，保证透明无边框窗口仍可调整尺寸。
- 图片尺寸回退：如果截图区域元数据缺失（如 macOS 系统截图不返回选区坐标），插件先解码图片拿到自然尺寸，再按屏幕缩放比例一次性调整窗口并预置视口，避免按猜测尺寸渲染预览造成的闪动。
- 标注工具：直线、矩形、圆形、箭头、画笔、高亮、文字、编号、马赛克、模糊和橡皮擦，支持颜色和线宽调整。
- 历史操作：支持撤销、重做和清空全部标注。
- 导出操作：复制最终 PNG 到剪贴板，或选择路径保存 PNG 文件；复制/保存成功后自动关闭标注窗口。
- 钉图：工具栏「钉图」把标注后的截图钉在屏幕最上层（参考 screen-pin 插件）：无边框透明置顶窗口，支持拖动移动、拖边缩放、右键菜单（复制/保存/透明度/关闭）、双击或 Esc 关闭；钉图成功后标注窗口自动关闭。
- 快捷关闭：按 Esc 或点击关闭按钮退出窗口。
- **问 AI**：工具栏「问 AI」按钮会在截图旁边弹出一个**无边框浮窗**（置顶、可拖动标题区、可拖边缩放、高度随内容自适应、自带关闭按钮），把当前截图（带标注或原图可切换）发给系统多模态模型；截图标注窗口尺寸/比例完全不受影响：
  - **解释这是什么** / **解题·回答** / **提取文字（OCR）** / **翻译图中文字**：流式返回文字，按 Markdown 渲染，可一键复制。
  - **AI 修图**：按指令做图生图，结果可**替换截图**（回传到截图窗口作为新底图继续标注）、复制到剪贴板或下载保存。
  - 标注会引导模型注意力——先用箭头/方框圈出重点再提问，回答更聚焦。
  - 文字动作自动选用支持视觉的模型，修图选用 image-generation 模型；模型选择会被记住。

## 问 AI 的实现要点

- 独立浮窗：点击「问 AI」时把当前截图快照（带标注 = `exportPng(image, annotations)`，原图 = `image.dataUrl`）写入 `ai-handoff-{id}` 存储键，再用 `mulby.window.create('/index.html?mode=ai&aiHandoff={id}', { type:'borderless', titleBar:false, alwaysOnTop:true, x,y 定位到截图旁 })` 打开浮窗；`main.tsx` 按 `mode=ai` 渲染 `AiView`，读取并清理交接键。
- 浮窗交互：无边框窗口的拖动/缩放由 `useFloatingWindow`（`mulby.window.setBounds` / `resizeDrag`，与截图窗同款）实现；`AiPanel` 通过 `onContentHeight` 上报内容自然高度，`AiView` 据此调用 `setBounds` 让窗口高度随内容自适应（用户手动缩放后停止自适应）。
- 经 `mulby.ai.attachments.upload({ purpose: 'vision' | 'image-edit' })` 上传为附件，拿到 `attachmentId`。
- 文字动作走 `mulby.ai.call`，消息 `content` 携带 `{ type: 'image', attachmentId }`，流式累积增量。
- 修图走 `mulby.ai.images.edit({ model, imageAttachmentId, prompt })`。
- 替换截图：AI 浮窗经 `window.mulby.window.sendToParent('apply-edited-image', dataUrl)` 把结果回传父窗口，截图窗口用 `onChildMessage` 接收后调用 `loadTransformedImage` 作为新底图载入。
- Markdown 渲染使用 `react-markdown` + `remark-gfm`（`src/ui/components/MdRenderer.tsx`），不解析原始 HTML，天然免 XSS。
- 服务层位于 `src/ui/services/aiVision.ts`（动作预设、提示词、模型过滤、运行器均为可单测的纯函数 + 薄封装）。

## 触发方式

- `截图标注`
- `screenshot`
- `annotate`

## 使用示例

1. 在 Mulby 输入 `截图标注`。
2. 框选屏幕区域。
3. 在弹出的标注窗口中选择箭头、矩形或画笔。
4. 点击复制或保存导出标注后的截图。

## 依赖与前提

- 需要 Mulby 宿主支持 `preCapture: "region"`、detached 窗口和截图 attachment 注入。
- UI 依赖 React、Vite 和 lucide-react。
- 不引入 `sharp` npm 包。需要高性能图片处理时应使用宿主提供的 `window.mulby.sharp` API。
- 当前版本的标注导出由浏览器 canvas 合成 PNG，不依赖宿主 sharp。

## 开发

```bash
pnpm install
pnpm run build
pnpm run pack
```

## 项目结构

```text
plugins/screenshot-annotator/
├── assets/icon.svg
├── icon.png
├── manifest.json
├── src/main.ts
├── src/ui/App.tsx                       # 标注窗口组件（状态/交互/窗口管理）
├── src/ui/styles.css
├── src/ui/AiView.tsx                    # 独立「问 AI」浮窗视图
├── src/ui/PinView.tsx                   # 置顶贴图窗口视图（参考 screen-pin）
├── src/ui/HistoryView.tsx               # 截图历史视图
├── src/ui/history.ts                    # 历史记录存储（索引/图片文件/缩略图）
├── src/ui/annotations/                  # 标注领域模块（纯函数）
│   ├── types.ts                         # 标注与窗口类型定义
│   ├── constants.ts                     # 颜色/尺寸/历史上限等常量
│   ├── textLayout.ts                    # 文字度量与换行
│   ├── geometry.ts                      # 几何计算与标注变换
│   ├── hitTest.ts                       # 命中测试与编辑手柄
│   ├── render.ts                        # canvas 绘制与 PNG 导出
│   └── normalize.ts                     # 历史数据归一化
├── src/ui/utils/
│   ├── image.ts                         # dataURL/base64/文件名等工具
│   ├── launch.ts                        # 启动参数解析
│   └── display.ts                       # 显示尺寸与窗口边界计算
├── src/ui/hooks/useMulby.ts             # 宿主 API 封装
├── src/ui/hooks/useFloatingWindow.ts    # 无边框浮窗拖动/缩放（标注窗与 AI 窗共用）
├── src/ui/components/Toolbar.tsx        # 底部标注工具栏
├── src/ui/components/InlineEditors.tsx  # 画布内联文字/编号编辑器
├── src/ui/components/AiPanel.tsx        # 问 AI 主体（动作/提问/结果）
├── src/ui/components/MdRenderer.tsx     # react-markdown 渲染器
├── src/ui/services/aiVision.ts          # 视觉问答 / 修图服务层
└── src/types/mulby.d.ts
```
