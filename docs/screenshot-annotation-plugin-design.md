# 截图标注插件产品与技术方案

## 目标

截图标注插件用于提供类似微信、QQ 截图后的快速处理体验：用户触发插件后先选择截图区域，截图完成后打开一个由插件拥有的无边框透明窗口。窗口主体展示刚截取的图片，图片下方展示标注工具条，用户可快速添加箭头、矩形、文字、马赛克，并复制、保存或拖拽导出结果。

这个插件不应运行在 Mulby 附着面板内。它需要使用 detached 窗口，并由插件自己渲染截图画布和工具条。

## 交互流程

1. 用户通过关键词或快捷键触发 `annotate` 功能。
2. Mulby 在打开插件窗口前执行区域截图。
3. 截图结果作为 `attachments[0]` 注入插件 UI。
4. Mulby 根据截图区域元数据打开 detached 窗口：
   - 窗口左上角贴到截图区域左上角。
   - 窗口宽度等于截图区域宽度。
   - 窗口高度等于截图区域高度加工具条高度。
5. 插件 UI 在窗口内渲染截图图片、标注画布和底部工具条。
6. 用户完成后可复制到剪贴板、保存到文件、拖拽到其他应用，或按 Esc 关闭窗口。

## Manifest 配置

推荐使用 React 模板，因为插件需要复杂 UI 和 canvas 状态管理。

```json
{
  "id": "screenshot-annotator",
  "name": "screenshot-annotator",
  "displayName": "截图标注",
  "version": "1.0.0",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "features": [
    {
      "code": "annotate",
      "explain": "截图标注",
      "mode": "detached",
      "preCapture": "region",
      "cmds": [
        { "type": "keyword", "value": "截图标注" },
        { "type": "keyword", "value": "screenshot" }
      ]
    }
  ],
  "window": {
    "type": "borderless",
    "titleBar": false,
    "transparent": true,
    "alwaysOnTop": true,
    "position": "capture-region",
    "fit": "capture-region-with-toolbar",
    "captureToolbarHeight": 56,
    "minWidth": 240,
    "minHeight": 120
  }
}
```

## 前端数据入口

插件 UI 通过 `window.mulby.onPluginInit()` 读取截图。

```ts
window.mulby.onPluginInit((data) => {
  const image = data.attachments?.find((item) => item.kind === 'image')
  if (!image?.dataUrl) return

  const capture = image.capture
  const region = capture?.region

  renderEditor({
    dataUrl: image.dataUrl,
    region,
    toolbarHeight: 56
  })
})
```

`image.capture.region` 是屏幕逻辑坐标，可用于二次校准窗口位置。插件必须允许它缺失，并回退到普通窗口布局。

## 需要调用的 Mulby API

- `window.mulby.onPluginInit(callback)`：接收截图 attachment 和 capture metadata。
- `window.mulby.window.setBounds(bounds)`：当插件需要根据图片实际尺寸或工具条展开状态微调窗口时调用。
- `window.mulby.window.setAlwaysOnTop(true)`：必要时重新保持置顶。
- `window.mulby.window.close()`：完成、取消或 Esc 后关闭窗口。
- `window.mulby.clipboard.writeImage(image)`：复制最终标注图片。
- `window.mulby.dialog.showSaveDialog()`：选择保存路径。
- `window.mulby.filesystem.writeFile()`：保存 PNG/JPEG 文件。
- `window.mulby.window.startDrag(filePath)`：把导出的临时文件拖拽到聊天窗口或设计工具。
- `window.mulby.notification.show(message, type)`：保存、复制失败时提示。

## 技术路线

前端建议使用一个固定尺寸根容器：上方是图片编辑区，下方是工具条。编辑区用 canvas 渲染：

- 底图层：截图图片。
- 标注层：箭头、矩形、画笔、文字、马赛克等对象。
- 交互层：选中框、控制点、光标提示。

状态建议保存为对象数组，而不是直接破坏底图像素。导出时再把底图和标注对象绘制到离屏 canvas，生成 PNG。

工具条建议至少包含：选择、矩形、箭头、画笔、文字、马赛克、撤销、重做、复制、保存、关闭。工具条高度固定，例如 56px，和 manifest 的 `captureToolbarHeight` 保持一致。

## 边界与回退

- 如果 `capture.region` 缺失，窗口无法贴回截图原位置，插件应居中显示编辑器。
- 如果截图区域太小，工具条可能无法完整展示，插件应折叠为图标按钮或横向滚动。
- 多显示器场景下应使用 `capture.display.scaleFactor` 处理高清屏导出尺寸。
- 透明窗口中根节点必须显式设置透明背景；图片和工具条区域再各自绘制可见背景。
- Esc 应关闭窗口；复制成功后是否自动关闭由插件设置决定。

## 最小可用版本

第一版只做区域截图、矩形、箭头、画笔、复制、保存、关闭。文字、马赛克、历史记录和拖拽导出可以作为后续增强。
