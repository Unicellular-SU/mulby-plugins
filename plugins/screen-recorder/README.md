# 录屏助手

录屏助手是一个 Mulby 媒体插件，用于录制全屏、指定窗口或自定义屏幕区域。插件控制面板以独立置顶窗口运行，录制结束后优先转码保存为 MP4；如果当前运行时没有 FFmpeg，则回退保存 WebM。

## 支持功能

- 全屏录制：从 Mulby Screen API 获取屏幕源并调用 `MediaRecorder` 录制。
- 窗口录制：列出可捕获窗口，选择目标窗口后录制。
- 区域录制：打开透明全屏选择器，框选区域后通过 Canvas 实时裁剪录制。
- 音频录制：支持系统声音和麦克风；两路音频同时启用时在 UI 侧混音。默认关闭系统声音，避免在不支持系统音频的环境中阻断画面录制。
- 自动停止：支持 1、3、5、10、30 分钟自动停止。
- Overlay 效果：使用 Mulby child window 高级窗口 API 创建透明、置顶、鼠标穿透的覆盖层，并通过 `inputMonitor` 显示鼠标轨迹、点击标记和键盘输入。
- 设置持久化：录制参数、音频开关、Overlay 开关会保存到 Mulby Storage。

## 触发方式

- `录屏`
- `屏幕录制`
- `screen record`
- `screen recorder`

## 使用示例

1. 在 Mulby 中输入 `录屏` 打开插件。
2. 选择 `全屏`、`窗口` 或 `区域`。
3. 根据需要开启系统声音、麦克风、Overlay 和自动停止。
4. 点击 `开始录制`，录制完成后选择保存位置。

## 权限和平台说明

- macOS 录屏需要系统屏幕录制权限。
- 麦克风录制需要麦克风权限。
- 鼠标轨迹和键盘显示依赖 Mulby 运行时的 `inputMonitor` 能力；插件已在 `manifest.permissions.inputMonitor` 中声明权限。如果当前版本未暴露该能力或原生模块不可用，核心录屏仍可使用。
- Overlay 窗口依赖 `window.create()` 的 `ignoreMouseEvents`、`forwardMouseEvents`、`focusable: false`、`skipTaskbar` 和 `alwaysOnTopLevel: "screen-saver"` 等能力，避免覆盖层阻止点击后方应用。
- macOS 系统声音通常依赖系统音频驱动或虚拟声卡；Windows 通常可直接录制系统声音。开启系统声音后如果桌面流被系统拒绝，插件会自动降级为仅录制画面。
- MP4 输出依赖 Mulby FFmpeg API。不可用时会保存 WebM。

## 开发

```bash
pnpm install
pnpm run build
pnpm run pack
```

## 项目结构

```text
plugins/screen-recorder/
|- manifest.json
|- icon.png
|- assets/icon.svg
|- src/main.ts
|- src/ui/App.tsx
|- src/ui/styles.css
|- src/ui/hooks/useMulby.ts
`- src/types/mulby.d.ts
```
