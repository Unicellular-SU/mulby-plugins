# 截图标注

区域截图后打开一个透明、无边框的独立窗口，用画布直接标注截图并导出结果。当前版本实现设计文档中的最小可用范围：矩形、箭头、画笔、撤销、重做、复制、保存和关闭。

## 功能

- 区域截图：触发 `annotate` 功能前由 Mulby 执行 `preCapture: "region"`。
- 贴合截图区域：窗口使用 `position: "capture-region"` 和 `fit: "capture-region-with-toolbar"`，工具条高度固定为 56px；小截图会保留截图原尺寸画布，但窗口宽度至少为 760px 以完整显示工具栏。
- 标注工具：矩形、箭头、画笔，支持颜色和线宽调整。
- 导出操作：复制最终 PNG 到剪贴板，或选择路径保存 PNG 文件。
- 快捷关闭：按 Esc 或点击关闭按钮退出窗口。

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
├── src/ui/App.tsx
├── src/ui/styles.css
└── src/types/mulby.d.ts
```
