# 截图置顶 (Screen Pin)

区域截图后将截图钉在屏幕最上层，支持拖动、透明度调节、右键菜单、双击关闭、多窗口共存。

## 功能特性

- **区域截图** — 通过 `preCapture: "region"` 在插件启动前完成交互式框选，体验流畅
- **贴合截图区域** — 窗口使用 `position: "capture-region"` 和 `fit: "capture-region"`，直接以 detached 透明窗口显示截图
- **大图可见性保护** — 按截图区域和当前屏幕 `workArea` 主动修正 `window.setBounds()`，接近全屏的大图会自动留出 24px 边距，避免窗口跑到可见区域外或与底层画面完全重合
- **自由拖动** — 使用 `window.getBounds()` / `window.setPosition()` 实现截图窗口拖动，避免原生 drag 区域吞掉双击事件
- **无临时 Loading 窗口** — 参照截图标注插件，图片未准备好时只渲染透明空状态，不显示加载面板
- **窗口透明度** — 右键菜单调用 `window.setOpacity()` 原生 API，支持 100%/80%/50% 三档
- **右键菜单** — 复制图片 / 保存图片 / 调节透明度 / 关闭
- **双击关闭** — 双击截图窗口即可关闭
- **多窗口共存** — `single: false`，每次截图创建独立 detached 窗口，互不干扰

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
| `window.getBounds()` / `window.setPosition()` | 拖动截图窗口 |
| `window.setBounds()` | 按截图区域修正大图窗口位置和尺寸 |
| `window.setOpacity()` | 窗口透明度控制 |
| `window.setAlwaysOnTop()` | 确保窗口置顶 |
| `window.close()` | 关闭窗口 |
| `menu.showContextMenu()` | 原生右键菜单 |
| `clipboard.writeImage()` | 复制图片到剪贴板 |
| `dialog.showSaveDialog()` | 保存文件对话框 |
| `filesystem.writeFile()` | 写入图片文件 |

## 开发

```bash
pnpm install   # 安装依赖
pnpm run build # 构建
pnpm run pack  # 打包 .inplugin
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
│   │   ├── App.tsx        # 核心 UI（preCapture 附件 + PinView）
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
