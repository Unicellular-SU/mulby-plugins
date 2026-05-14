# Mulby Showcase

**综合展示 Mulby 所有 API 能力的示例插件**

![Mulby Showcase](./icon.png)

## 功能特性

这个插件是 Mulby 平台的完整功能展示，涵盖了所有 20+ 个 API 模块：

| 模块 | 涵盖的 API | 功能描述 |
|------|-----------|---------|
| **系统信息** | system, power, geolocation, network | 系统/应用信息、电源状态、位置信息、网络状态 |
| **剪贴板** | clipboard, notification | 剪贴板读写、格式检测、图片和文件支持 |
| **输入控制** | input | 隐藏主窗口后粘贴文本/图片/文件或模拟键入 |
| **文件管理** | filesystem, dialog, shell | 文件操作、对话框、系统打开、Finder 定位 |
| **网络与HTTP** | http, network | HTTP 请求测试、网络状态监控 |
| **屏幕与捕获** | screen, media, window | 显示器信息、区域截图、多窗口协作、媒体权限 |
| **媒体与音频** | tts, shell | 语音合成、系统提示音 |
| **高级设置** | theme, window, shortcut, tray, menu | 主题切换、窗口控制、快捷键、托盘、菜单 |
| **安全与存储** | security, storage | 加密存储、数据持久化 |

## 触发方式

插件支持多种触发关键词：

- `showcase` / `demo` / `示例` - 打开功能展示面板
- `sysinfo` / `系统信息` - 直接进入系统信息模块
- `cb` / `剪贴板` - 直接进入剪贴板管理
- `input` / `输入` - 直接进入输入控制
- `files` / `文件` - 直接进入文件管理
- `http` / `网络` - 直接进入网络测试
- `screenshot` / `截图` / `screen` - 直接进入截图功能
- `tts` / `语音` / `朗读` - 直接进入语音合成
- `settings` / `设置` - 直接进入高级设置

## 开发

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm run dev
```

### 构建

```bash
pnpm run build
```

### 打包

```bash
pnpm run pack
```

## 项目结构

```
mulby-showcase/
├── manifest.json              # 插件配置
├── package.json
├── src/
│   ├── main.ts                # 后端入口
│   └── ui/
│       ├── App.tsx            # 主应用
│       ├── styles.css         # 全局样式
│       ├── components/        # 通用组件
│       │   ├── Sidebar.tsx
│       │   ├── PageHeader.tsx
│       │   ├── Card.tsx
│       │   ├── Button.tsx
│       │   ├── StatusBadge.tsx
│       │   └── CodeBlock.tsx
│       ├── hooks/             # 自定义 Hooks
│       │   ├── useTheme.ts
│       │   ├── useNotification.ts
│       │   └── useMulby.ts
│       └── modules/           # 功能模块
│           ├── SystemInfo/
│           ├── Clipboard/
│           ├── Input/
│           ├── FileManager/
│           ├── Network/
│           ├── Screen/
│           ├── Media/
│           ├── Settings/
│           └── Security/
├── dist/                      # 后端构建输出
└── ui/                        # UI 构建输出
```

## API 覆盖

此插件完整展示了 Mulby 的以下 API：

### 基础 API
- `[已覆盖]` `clipboard` - 剪贴板操作
- `[已覆盖]` `input` - 输入与粘贴模拟
- `[已覆盖]` `notification` - 系统通知
- `[已覆盖]` `storage` - 数据存储
- `[已覆盖]` `window` - 窗口控制
- `[已覆盖]` `http` - HTTP 请求
- `[已覆盖]` `filesystem` - 文件系统

### 系统 API
- `[已覆盖]` `theme` - 主题管理
- `[已覆盖]` `screen` - 屏幕信息与截图
- `[已覆盖]` `shell` - 系统操作
- `[已覆盖]` `dialog` - 对话框
- `[已覆盖]` `system` - 系统信息
- `[已覆盖]` `power` - 电源状态

### 高级 API
- `[已覆盖]` `shortcut` - 全局快捷键
- `[已覆盖]` `security` - 加密存储
- `[已覆盖]` `media` - 媒体权限
- `[已覆盖]` `tray` - 系统托盘
- `[已覆盖]` `network` - 网络状态
- `[已覆盖]` `menu` - 右键菜单
- `[已覆盖]` `geolocation` - 地理位置
- `[已覆盖]` `tts` - 语音合成
- `[已覆盖]` `window` - 多窗口管理 (create/show/close)

## 典型案例：区域截图与编辑流程

本项目实现了一个经典的"区域截图 -> 独立窗口编辑 -> 回传主窗口"的工作流，展示了多窗口协作与数据传递的最佳实践。

```mermaid
sequenceDiagram
    participant U as 用户
    participant Main as 主窗口(Screen模块)
    participant IPC as 主进程
    participant Overlay as 截图覆盖层
    participant Editor as 图片编辑器

    U->>Main: 点击"区域截图"
    Main->>IPC: 调用 screen.screenCapture()
    Note over Main: 主窗口自动隐藏(失焦)
    
    IPC->>Overlay: 创建全屏透明窗口
    U->>Overlay: 拖拽选择区域
    Overlay->>IPC: 完成选择
    IPC->>Overlay: 关闭覆盖层
    IPC->>Main: 返回截图数据(Base64)
    
    Main->>Editor: window.create('/image-editor')
    Note right of Main: 使用 BroadcastChannel 建立连接
    
    Editor-->>Main: 发送 READY 消息
    Main->>Editor: 发送 INIT_IMAGE (原图)
    
    U->>Editor: 绘制/编辑图片
    U->>Editor: 点击"确认使用"
    
    Editor->>Main: 发送 SAVE_IMAGE (编辑后图片)
    Editor->>Editor: 关闭窗口
    
    Main->>Main: 更新预览区域
    Main->>Main: window.show() 恢复显示
```

### 关键技术点

1.  **多窗口管理**：使用 `window.mulby.window.create` 创建独立的编辑器窗口，互不干扰。
2.  **窗口通信**：使用 Web 标准 `BroadcastChannel` 实现主窗口与编辑器窗口的直接通信，无需经过主进程中转，高效且低延迟。
3.  **可见性控制**：利用 `window.show()` 确保截图流程结束后主窗口能正确恢复显示。

## 许可证

MIT License
