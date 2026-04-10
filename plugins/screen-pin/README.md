# 截图置顶 (Screen Pin)

区域截图后将截图钉在屏幕最上层，支持拖动、透明度调节、右键菜单、多窗口共存。

## 功能特性

- **区域截图** — 通过 `preCapture: "region"` 在插件启动前完成交互式框选，体验流畅
- **置顶显示** — 截图以无边框 (`borderless`) + 置顶 (`alwaysOnTop`) 子窗口展示
- **自由拖动** — CSS `-webkit-app-region: drag` 实现窗口级拖动
- **窗口透明度** — 右键菜单调用 `window.setOpacity()` 原生 API，支持 100%/80%/50% 三档
- **右键菜单** — 复制图片 / 保存图片 / 调节透明度 / 关闭
- **双击关闭** — 双击截图窗口即可关闭
- **多窗口共存** — `single: false`，每次截图创建独立子窗口，互不干扰

## 触发方式

| 关键词 | 说明 |
|--------|------|
| `截图置顶` | 中文触发 |
| `贴图` | 快捷触发 |
| `screen pin` | 英文触发 |
| `pin截图` | 混合触发 |

## 使用的 Mulby API

| API | 用途 |
|-----|------|
| `screen.screenCapture()` | preCapture 区域截图 |
| `window.create()` | 创建无边框置顶子窗口 |
| `window.setOpacity()` | 窗口透明度控制 |
| `window.setAlwaysOnTop()` | 确保窗口置顶 |
| `window.close()` | 关闭窗口 |
| `menu.showContextMenu()` | 原生右键菜单 |
| `clipboard.writeImage()` | 复制图片到剪贴板 |
| `dialog.showSaveDialog()` | 保存文件对话框 |
| `filesystem.writeFile()` | 写入图片文件 |

## 开发

```bash
npm install   # 安装依赖
npm run build # 构建
npm run pack  # 打包 .inplugin
```

## 项目结构

```
screen-pin/
├── manifest.json          # 插件配置（borderless / single=false / preCapture）
├── icon.png               # 插件图标 (512x512)
├── assets/icon.svg        # 图标源文件
├── src/
│   ├── main.ts            # 后端入口（生命周期日志）
│   ├── ui/
│   │   ├── App.tsx        # 核心 UI（CaptureHost + PinView 双模式）
│   │   ├── styles.css     # 样式（拖动区域、边框装饰）
│   │   ├── main.tsx       # UI 入口
│   │   └── index.html     # HTML 模板
│   └── types/
│       └── mulby.d.ts     # Mulby API 类型定义
├── dist/                  # 后端构建输出
└── ui/                    # UI 构建输出
```

## 许可证

MIT License
