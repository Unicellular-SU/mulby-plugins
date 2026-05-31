# mulby-ai-image

插件描述

## 功能特性

- 功能 1
- 功能 2
- 功能 3

## 触发方式

- `mulby-ai-image` - 主功能

## 命令执行权限

默认模板不会开启命令执行权限。只有插件后端确实需要调用 `context.api.shell.runCommand` 或全局 `mulby.shell.runCommand` 时，才在 `manifest.json` 中声明 `commandExecution.direct`：

```json
{
  "permissions": {
    "commandExecution": {
      "direct": {
        "enabled": true,
        "defaultProfile": "workspace",
        "maxProfile": "workspace"
      }
    }
  }
}
```

调用时可用 `executionProfile` 请求 `sandbox`、`workspace` 或 `trusted`，但不能超过 manifest 允许的 `maxProfile`。如果插件承载自己的 AI，并希望这个 AI 使用 Mulby 内置命令型能力，需要单独声明 `commandExecution.ai`；旧版 `runCommand: true` 只兼容插件自身直接调命令，不授权 AI 生成命令。

## 目录授权

插件可以在运行时申请用户确认的目录访问权限，不需要在 manifest 中预声明。获得 `readwrite` 授权后，该目录会扩展当前插件的命令 workspace root；但命令执行本身仍需要 `commandExecution.direct` 或 `commandExecution.ai`。

```ts
const grant = await context.api.directoryAccess.request({
  mode: 'readwrite',
  reason: '在用户选择的项目目录中运行命令'
})

if (grant) {
  await context.api.shell.runCommand({
    command: 'git',
    args: ['status'],
    cwd: grant.path,
    executionProfile: 'workspace'
  })
}
```

## 插件通信

后端可以使用 `context.api.messaging` 或全局 `mulby.messaging` 与其他插件通信。需要长期接收消息时，把订阅注册在后端，并让 UI 通过 `window.mulby.host.call(...)` 读取后端缓存；不要把消息缓存只放在前端。

```ts
let messageHandler: ((message: PluginMessage) => void | Promise<void>) | null = null
const recentMessages: PluginMessage[] = []

function registerMessaging(api: BackendPluginAPI) {
  if (messageHandler) api.messaging.off(messageHandler)
  messageHandler = (message) => {
    recentMessages.unshift(message)
    recentMessages.splice(50)
  }
  api.messaging.on(messageHandler)
}

export function onLoad(context?: BackendPluginContext) {
  if (context) registerMessaging(context.api)
}

export function onBackground(context?: BackendPluginContext) {
  if (context) registerMessaging(context.api)
}

export const rpc = {
  getRecentMessages() {
    return recentMessages
  }
}
```

如果插件没有打开 UI 时也要接收消息，在 `manifest.json` 中启用后台运行。是否跟随 Mulby 启动由用户在插件窗口菜单或搜索结果右键菜单中勾选：

```json
{
  "pluginSetting": {
    "background": true,
    "persistent": true,
    "idleTimeoutMs": "never"
  }
}
```

## 窗口与截图

React 模板适合可视化插件。需要独立窗口时，将功能配置为 `mode: "detached"`；需要截图后打开标注界面时，可组合 `preCapture: "region"` 和窗口配置 `type: "borderless"`、`transparent: true`、`position: "capture-region"`、`fit: "capture-region-with-toolbar"`。

macOS 上，独立插件窗口会使用 Mulby 的应用级 Dock 图标表示。Dock 图标会优先显示“宿主图标 + 最近聚焦插件图标”的组合样式，多窗口时显示数量徽标。Dock 右键菜单可用于切换或关闭插件窗口；系统 Dock 的“退出”仍然退出宿主应用。

`skipTaskbar` 只表示请求隐藏具体窗口的任务栏/Dock 呈现，不能作为隐藏 Mulby 应用级 Dock 图标的开关。

## 旧插件兼容窗口

新插件优先使用单入口 UI + 前端路由。迁移 zTools/uTools 风格插件时，如果必须打开不同 HTML 文件并为窗口指定独立 preload，可以使用 `window.mulby.window.create(path, { loadMode: "file" })`。

```ts
const regionWindow = await window.mulby.window.create('region/index.html?key=abc', {
  loadMode: 'file',
  preload: 'region/preload.cjs',
  width: 640,
  height: 480
})
```

文件模式只允许加载插件目录内的相对 HTML 文件，`preload` 只允许插件目录内的 `.js` / `.cjs` 文件。额外 HTML、窗口专属 preload、`.node` 原生模块和外部二进制不会自动进入包内，需要写入 `manifest.assets`：

```json
{
  "assets": [
    "region",
    "effect",
    "countdown.html",
    "region/preload.cjs",
    "addon-darwin-arm64.node",
    "bin/aperture"
  ]
}
```

## 开发

> **💡 提示**: 推荐使用 [pnpm](https://pnpm.io/) 进行依赖管理。若插件放置于基于 pnpm workspace 的父仓库（如 `plugins/<name>/` 目录），通常建议直接在**仓库根目录**执行一次 `pnpm install`。也可以在当前插件目录单独执行。

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
mulby-ai-image/
├── manifest.json              # 插件配置
├── package.json
├── src/
│   ├── main.ts                # 后端入口
│   ├── types/
│   │   └── mulby.d.ts         # 类型定义（含 BackendPluginContext）
│   ├── ui/
│   │   ├── App.tsx            # 主应用
│   │   ├── main.tsx           # UI 入口
│   │   ├── index.html         # HTML 模板
│   │   ├── styles.css         # 全局样式
│   │   ├── hooks/
│   │   │   └── useMulby.ts    # Mulby API Hook
│   ├── legacy/                # 可选：旧插件兼容 HTML/preload 源文件
├── dist/                      # 后端构建输出
├── ui/                        # UI 构建输出
├── assets/                    # 可选：manifest.assets 打包资源
└── icon.png                   # 插件图标
```

## 许可证

MIT License
