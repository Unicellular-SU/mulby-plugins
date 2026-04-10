# Mulby 插件开发完整指南

> 本文档包含 Mulby 插件开发所需的全部信息，包括 Manifest 配置规范和 API 参考。
> - **UI/渲染进程**：`window.mulby.{模块名}`
> - **插件后端**：`context.api.{模块名}`

---

# 第一部分：Manifest 配置规范

## manifest.json 基本结构

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "type": "utility",
  "displayName": "我的插件",
  "description": "插件描述",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "icon": "icon.png",
  "pluginSetting": {
    "single": true,
    "height": 400
  },
  "window": {
    "width": 800,
    "height": 600
  },
  "features": [
    {
      "code": "main",
      "explain": "主功能",
      "cmds": [{ "type": "keyword", "value": "关键词" }]
    }
  ]
}
```

## 顶层字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| name | string | ✓ | 插件唯一标识 |
| version | string | ✓ | 版本号 |
| type | string | | 类型（utility/productivity/developer/system/media/network/ai/entertainment/other） |
| displayName | string | ✓ | 显示名称 |
| description | string | | 插件描述 |
| main | string | ✓ | 后端入口文件 |
| ui | string | | UI 入口文件 |
| preload | string | | 自定义 preload 脚本（可使用 Node.js） |
| icon | string/object | | 插件图标（路径/URL/SVG） |
| features | array | ✓ | 功能入口列表 |
| pluginSetting | object | | 插件行为设置 |
| window | object | | 独立窗口配置 |

## PluginSetting 配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| single | boolean | true | 单例模式（不允许多开） |
| height | number | - | 初始高度 |

## Window 配置

| 字段 | 默认值 | 说明 |
|------|--------|------|
| width | 500 | 默认宽度 |
| height | 400 | 默认高度 |
| minWidth | 300 | 最小宽度 |
| minHeight | 200 | 最小高度 |
| maxWidth | - | 最大宽度 |
| maxHeight | - | 最大高度 |

## Feature 字段

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| code | string | ✓ | 功能代码 |
| explain | string | ✓ | 功能说明 |
| cmds | array | ✓ | 触发命令列表 |
| mode | string | | 模式（ui/silent/detached） |
| route | string | | UI 路由路径 |
| icon | string/object | | 功能独立图标 |
| mainHide | boolean | | 触发时隐藏主窗口 |
| mainPush | boolean | | 向搜索框推送内容 |

## Cmd 命令类型

| type | 触发方式 | 可用字段 |
|------|----------|----------|
| keyword | 关键词匹配 | `value`（关键词） |
| regex | 正则匹配 | `match`（正则）, `explain?`, `label?`（指令名称）, `minLength?`, `maxLength?` |
| files | 文件拖入 | `exts?`, `fileType?`（file/directory/any, 默认 any）, `match?`（文件名正则, 与 exts 二选一）, `minLength?`, `maxLength?` |
| img | 图片拖入 | `exts?` |
| over | 选中文本 | `label?`（指令名称）, `exclude?`（排除正则）, `minLength?`, `maxLength?`（默认 10000） |

### 示例

```json
{
  "features": [
    {
      "code": "format",
      "explain": "格式化 JSON",
      "cmds": [
        { "type": "keyword", "value": "json" },
        { "type": "regex", "match": "^\\s*[{\\[]", "explain": "检测到 JSON" }
      ]
    },
    {
      "code": "process-pdf",
      "explain": "处理 PDF 文件",
      "cmds": [
        { "type": "files", "exts": [".pdf"], "minLength": 1, "maxLength": 10 }
      ]
    },
    {
      "code": "folder-tool",
      "explain": "文件夹工具",
      "cmds": [
        { "type": "files", "fileType": "directory" }
      ]
    }
  ]
}
```

## Icon 图标配置

```json
// 字符串简写
"icon": "icon.png"
"icon": "https://example.com/icon.png"
"icon": "<svg>...</svg>"

// 对象形式
"icon": { "type": "file", "value": "assets/logo.png" }
"icon": { "type": "url", "value": "https://example.com/icon.png" }
"icon": { "type": "svg", "value": "<svg>...</svg>" }
```

## Preload 预加载脚本 ⭐ 核心概念

> [!IMPORTANT]
> **Preload 是 Mulby 插件访问 Node.js 能力的核心机制。** 对于需要在渲染进程（UI）中使用 Node.js API、第三方 npm 模块或 Electron 渲染进程 API 的插件来说，Preload 是**必不可少**的。

### 什么是 Preload？

Preload 脚本是一个特殊的 JavaScript 文件，在**渲染进程加载之前**执行，具有以下特点：

| 特性 | 说明 |
|------|------|
| 🔧 **Node.js 完整支持** | 可以使用 `require()` 导入任何 Node.js 原生模块和 npm 包 |
| 🖥️ **Electron API 访问** | 可以调用 Electron 渲染进程 API |
| 🌉 **桥接能力** | 通过 `window.xxx` 将原生能力暴露给前端 React/Vue 组件 |
| ⚡ **同步执行** | 在页面 DOM 加载前执行，确保 API 可用 |
| 📄 **使用 .cjs 扩展名** | 由于项目使用 `type: module`，preload 必须命名为 `*.cjs` |

### 适用场景

以下场景**需要使用** Preload：

- 📂 使用 `pdf-lib`、`sharp`、`ffmpeg` 等需要 Node.js 环境的 npm 包
- 🔐 调用 Node.js 加密模块 (`crypto`)、子进程 (`child_process`)
- 📁 需要比 `window.mulby.filesystem` 更底层的文件操作
- 🔗 与本地数据库交互 (SQLite、LevelDB 等)
- 🎯 任何需要原生能力但又想在前端统一调用的场景

---

### 配置方式

在 `manifest.json` 中添加 `preload` 字段，指定预加载脚本路径：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "我的插件",
  "main": "dist/main.js",
  "ui": "ui/index.html",
  "preload": "preload.cjs",  // 👈 使用 .cjs 扩展名，放在根目录
  "features": [...]
}
```

> [!WARNING]
> **必须使用 `.cjs` 扩展名！** 由于模板使用 `"type": "module"`，所有 `.js` 文件会被当作 ES Module 处理。使用 `.cjs` 扩展名可确保文件始终被视为 CommonJS。

> [!IMPORTANT]
> **preload 不需要打包！** 直接使用源码文件，放在项目根目录。这样 `node_modules` 中的依赖可以正常解析。

---

### preload.cjs 编写规范

```javascript
// preload.cjs - 必须使用 CommonJS 规范和 .cjs 扩展名
const fs = require('fs')
const os = require('os')
const path = require('path')
const { PDFDocument } = require('pdf-lib')  // 可使用 npm 包

/**
 * 通过 window 对象暴露 API 给前端
 * 命名建议：window.{插件名}Api 或 window.{功能名}Api
 */
window.myPluginApi = {
  // 同步方法
  getHomeDir: () => os.homedir(),
  getPlatform: () => process.platform,
  
  // 异步方法
  readFile: async (filePath) => {
    return fs.promises.readFile(filePath, 'utf-8')
  },
  
  // 复杂功能封装
  mergePDFs: async (pdfPaths, outputPath) => {
    const mergedPdf = await PDFDocument.create()
    for (const pdfPath of pdfPaths) {
      const pdfBytes = fs.readFileSync(pdfPath)
      const pdf = await PDFDocument.load(pdfBytes)
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
      pages.forEach(page => mergedPdf.addPage(page))
    }
    const bytes = await mergedPdf.save()
    fs.writeFileSync(outputPath, bytes)
    return outputPath
  }
}

console.log('[Preload] API 已挂载到 window.myPluginApi')
```

---

### 前端调用示例

```tsx
// 在 React 组件中调用
import { useEffect, useState } from 'react'

// 类型声明（推荐单独放在 types.d.ts）
declare global {
  interface Window {
    myPluginApi?: {
      getHomeDir: () => string
      getPlatform: () => string
      readFile: (path: string) => Promise<string>
      mergePDFs: (paths: string[], output: string) => Promise<string>
    }
  }
}

export function MyComponent() {
  const [homeDir, setHomeDir] = useState('')
  
  useEffect(() => {
    // 使用可选链确保安全访问
    if (window.myPluginApi) {
      setHomeDir(window.myPluginApi.getHomeDir())
    }
  }, [])
  
  const handleMerge = async () => {
    const result = await window.myPluginApi?.mergePDFs(
      ['/path/to/1.pdf', '/path/to/2.pdf'],
      '/path/to/merged.pdf'
    )
    console.log('合并完成:', result)
  }
  
  // 核心 API 仍然可用
  const handleCopy = async () => {
    const text = await window.mulby.clipboard.readText()
    console.log('剪贴板内容:', text)
  }
  
  return <div>Home: {homeDir}</div>
}
```

---

### 模块引入方法

Preload 脚本支持多种模块引入方式：

#### 1. 引入 Node.js 原生模块

```javascript
// preload.cjs
const fs = require('fs')           // 文件系统
const os = require('os')           // 操作系统信息
const path = require('path')       // 路径操作
const crypto = require('crypto')   // 加密
const { spawn } = require('child_process')  // 子进程

window.nodeApi = {
  homeDir: os.homedir(),
  platform: process.platform,
  cpus: os.cpus().length,
  hash: (text) => crypto.createHash('md5').update(text).digest('hex')
}
```

#### 2. 引入自编写模块

```javascript
// preload.cjs
// 相对于 preload.js 文件的路径
const utils = require('./lib/utils')           // 同级 lib 目录
const helpers = require('./helpers/format')    // 同级 helpers 目录
const shared = require('../shared/constants')  // 上级目录

window.myApi = {
  format: utils.formatData,
  constants: shared.APP_NAME
}
```

> [!NOTE]
> 自编写模块也必须使用 CommonJS 格式（`module.exports`），路径相对于 `preload.cjs` 文件位置。

#### 3. 引入第三方模块

**方式 A：通过 npm 安装**

```bash
# 在插件目录安装依赖
cd my-plugin
npm install pdf-lib lodash dayjs
```

```javascript
// preload.cjs
const { PDFDocument } = require('pdf-lib')
const _ = require('lodash')
const dayjs = require('dayjs')

window.pdfApi = {
  mergePDFs: async (paths) => { /* ... */ },
  formatDate: (date) => dayjs(date).format('YYYY-MM-DD')
}
```

**方式 B：通过源码引入**

将第三方库源码放入插件目录：

```
my-plugin/
├── preload.cjs
├── vendor/
│   ├── lodash.min.js
│   └── crypto-js.js
```

```javascript
// preload.cjs
const _ = require('./vendor/lodash.min.js')
const CryptoJS = require('./vendor/crypto-js.js')
```

#### 4. 引入 Electron 渲染进程 API

```javascript
// preload.cjs
const { 
  ipcRenderer,      // 进程通信
  clipboard,        // 剪贴板（直接访问，无需 IPC）
  shell,            // 打开外部链接/文件
  nativeImage,      // 图片处理
  contextBridge     // 上下文桥接（自定义 preload 模式下不需要）
} = require('electron')

window.electronApi = {
  // 剪贴板操作
  readClipboard: () => clipboard.readText(),
  writeClipboard: (text) => clipboard.writeText(text),
  readImage: () => clipboard.readImage().toDataURL(),
  
  // 打开外部资源
  openExternal: (url) => shell.openExternal(url),
  showInFolder: (path) => shell.showItemInFolder(path),
  
  // 自定义 IPC 通信（与主进程交互）
  send: (channel, data) => ipcRenderer.send(channel, data),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args))
  }
}
```

> [!TIP]
> 虽然可以直接使用 Electron API，但建议优先使用 `window.mulby` 封装的 API，它们提供了更好的跨平台兼容性和错误处理。

---

### 与 Main 后端的区别

| 对比项 | Preload 脚本 | Main 后端 (main.js) |
|--------|--------------|---------------------|
| 执行环境 | 渲染进程（带 Node.js 权限） | 独立 Worker 进程 |
| 调用方式 | `window.xxxApi.method()` | `window.mulby.host.invoke()` |
| 适合场景 | 同步操作、UI 紧密相关的原生功能 | 后台任务、长时间运行的操作 |
| 进程通信 | 无需 IPC，直接调用 | 需要 IPC，异步调用 |
| 生命周期 | 随 UI 窗口创建/销毁 | 独立管理，可持久化 |

> [!TIP]
> **选择建议**：如果功能与 UI 紧密相关且需要快速响应，使用 **Preload**；如果是后台任务或需要在无 UI 时运行，使用 **Main 后端**。

---

### 注意事项

| 项目 | 说明 |
|------|------|
| 📄 文件扩展名 | **必须使用 `.cjs`** 扩展名，放在项目根目录 |
| 📝 文件格式 | **必须是 CommonJS** 格式，使用 `require()` 导入模块 |
| 📦 不需要打包 | 直接使用源码文件，不要用 esbuild/webpack 打包 |
| 🔍 代码规范 | 必须是清晰可读的源码，**禁止压缩/混淆**（安全审查需要） |
| 📦 可用模块 | Node.js 原生模块 + 已安装的 npm 包 |
| 🌐 API 暴露 | 通过 `window.xxx` 暴露，建议使用 `window.{插件名}Api` 命名 |
| 🔧 核心 API | `window.mulby` 核心 API 在 Preload 环境中**仍然可用** |
| ⚠️ 安全性 | 拥有完整 Node.js 权限，**请谨慎处理用户输入** |
| 📦 打包 | `mulby pack` 会自动包含 preload 及其依赖 |

> [!CAUTION]
> Preload 脚本拥有完整的 Node.js 权限，可以访问文件系统、网络等敏感资源。请确保代码安全，避免执行不可信的用户输入。

---

### 开发流程

使用 preload 的插件开发流程与普通插件略有不同：

#### 项目结构

```
my-plugin/
├── manifest.json          # 配置 preload 字段
├── package.json           # 依赖列表（含 type: module）
├── preload.cjs            # 👈 Preload 脚本（根目录，不打包）
├── lib/                   # 可选：自编写模块
│   └── utils.cjs
├── src/
│   ├── main.ts            # 后端入口
│   └── ui/                # React UI
├── dist/                  # 构建输出（main.js）
├── ui/                    # UI 构建输出
└── node_modules/          # npm 依赖
```

#### CLI 命令说明

| 命令 | Preload 处理方式 |
|------|-----------------|
| `mulby create` | 创建项目模板，手动添加 `preload.cjs` |
| `mulby dev` | 无需处理，preload 使用源码直接运行 |
| `mulby build` | 无需处理，preload **不需要打包** |
| `mulby pack` | **自动打包** preload 文件 + node_modules 生产依赖 |

#### 开发步骤

```bash
# 1. 创建插件
cd plugins
npx mulby create my-plugin --template react

# 2. 手动创建 preload.cjs
touch preload.cjs

# 3. 在 manifest.json 中配置
# "preload": "preload.cjs"

# 4. 安装第三方依赖（如需要）
npm install pdf-lib lodash

# 5. 编写 preload.cjs（使用 require）

# 6. 开发调试
npm run dev

# 7. 构建
npm run build

# 8. 打包发布
npm run pack
```

#### 打包后的结构

`mulby pack` 会生成包含以下内容的 `.inplugin` 文件：

```
my-plugin-1.0.0.inplugin
├── manifest.json
├── main.js                # 后端（打包后）
├── preload.cjs            # Preload 源码
├── ui/                    # UI 构建产物
├── node_modules/          # 👈 自动包含生产依赖
│   ├── pdf-lib/
│   └── (依赖的依赖...)
├── icon.png
└── README.md
```

> [!NOTE]
> 只有 `package.json` 中 `dependencies`（生产依赖）会被打包。`devDependencies` 不会包含在内。

---

# 第二部分：API 参考

## 1. 剪贴板 (clipboard)

| 方法 | 环境 | 说明 |
|------|------|------|
| `readText()` | R/B | 读取文本 → `string` |
| `writeText(text)` | R/B | 写入文本 |
| `readImage()` | R/B | 读取图片 → `Buffer | null` |
| `writeImage(image)` | R/B | 写入图片（路径/Buffer/DataURL） |
| `writeFiles(paths)` | R | 写入文件路径 |
| `readFiles()` | R/B | 读取文件列表 → `ClipboardFileInfo[]` |
| `getFormat()` | R/B | 获取格式 → `'text' | 'image' | 'files' | 'html' | 'empty'` |

---

## 2. 文件系统 (filesystem)

| 方法 | 环境 | 说明 |
|------|------|------|
| `readFile(path, encoding?)` | R/B | 读取文件 → `Buffer | string` |
| `writeFile(path, data, encoding?)` | R/B | 写入文件 (`data`: `string \| Buffer \| ArrayBuffer`) |
| `exists(path)` | R/B | 检查是否存在 → `boolean` |
| `unlink(path)` | R/B | 删除文件 |
| `readdir(path)` | R/B | 读取目录 → `string[]` |
| `mkdir(path)` | R/B | 创建目录（递归） |
| `stat(path)` | R/B | 获取文件信息 → `FileStat` |
| `copy(src, dest)` | R/B | 复制文件 |
| `move(src, dest)` | R/B | 移动/重命名文件 |
| `extname(path)` | B | 获取扩展名 |
| `join(...paths)` | B | 拼接路径 |
| `dirname(path)` | B | 获取目录名 |
| `basename(path, ext?)` | B | 获取文件名 |

---

## 3. 存储 (storage)

| 方法 | 环境 | 说明 |
|------|------|------|
| `get(key, namespace?)` | R/B | 获取数据 |
| `set(key, value, namespace?)` | R/B | 存储数据 |
| `remove(key, namespace?)` | R/B | 删除数据 |
| `clear()` | B | 清空存储 |
| `keys()` | B | 获取所有键 |

---

## 4. 对话框 (dialog)

| 方法 | 环境 | 说明 |
|------|------|------|
| `showOpenDialog(options?)` | R/B | 打开文件对话框 → `string[]` |
| `showSaveDialog(options?)` | R/B | 保存文件对话框 → `string | null` |
| `showMessageBox(options)` | R/B | 消息框 → `{ response, checkboxChecked }` |
| `showErrorBox(title, content)` | R/B | 错误框（同步） |

**OpenDialogOptions**: `title`, `defaultPath`, `buttonLabel`, `filters`, `properties`  
**properties**: `'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'`

---

## 5. 通知 (notification)

| 方法 | 环境 | 说明 |
|------|------|------|
| `show(message, type?)` | R/B | 显示通知（`type='error'` 时不静音） |

---

## 6. Shell

| 方法 | 环境 | 说明 |
|------|------|------|
| `openPath(path)` | R/B | 用默认应用打开文件 |
| `openExternal(url)` | R/B | 用浏览器打开 URL |
| `showItemInFolder(path)` | R/B | 在文件管理器中显示 |
| `openFolder(path)` | R/B | 打开文件所在目录 |
| `trashItem(path)` | R/B | 移动到回收站 |
| `beep()` | R/B | 播放系统提示音 |

---

## 7. HTTP 请求 (http)

| 方法 | 环境 | 说明 |
|------|------|------|
| `request(options)` | R/B | 发起请求 (`body`: `string \| object \| Buffer \| ArrayBuffer`) → `HttpResponse` |
| `get(url, headers?)` | R/B | GET 请求 |
| `post(url, body?, headers?)` | R/B | POST 请求 (`body`: `string \| object \| Buffer \| ArrayBuffer`) |
| `put(url, body?, headers?)` | R/B | PUT 请求 (`body`: `string \| object \| Buffer \| ArrayBuffer`) |
| `delete(url, headers?)` | R/B | DELETE 请求 |

**HttpRequestOptions**: `url`, `method`, `headers`, `body`, `timeout`  
**HttpResponse**: `{ status, statusText, headers, data }`

---

## 8. 系统 (system)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getSystemInfo()` | R/B | 获取系统信息 → `SystemInfo` |
| `getAppInfo()` | R/B | 获取应用信息 → `AppInfo` |
| `getPath(name)` | R/B | 获取特定路径 |
| `getEnv(name)` | R/B | 获取环境变量 |
| `getIdleTime()` | R/B | 获取空闲时间（秒） |
| `getFileIcon(path)` | R/B | 获取文件图标 → base64 DataURL |
| `getNativeId()` | R/B | 获取设备唯一标识 |
| `isDev()` | R/B | 是否开发环境 |
| `isMacOS() / isWindows() / isLinux()` | R/B | 判断操作系统 |

**getPath 支持**: `'home' | 'appData' | 'userData' | 'temp' | 'exe' | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos' | 'logs'`

---

## 9. 屏幕 (screen)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAllDisplays()` | R/B | 获取所有显示器 → `DisplayInfo[]` |
| `getPrimaryDisplay()` | R/B | 获取主显示器 |
| `getDisplayNearestPoint(point)` | R/B | 获取坐标位置的显示器 |
| `getCursorScreenPoint()` | R/B | 获取鼠标位置 |
| `getSources(options?)` | R/B | 获取捕获源列表 |
| `capture(options?)` | R/B | 截取屏幕 → `Buffer` |
| `captureRegion(region, options?)` | R/B | 截取指定区域 |
| `screenCapture()` | R | 交互式区域截图 → DataURL |
| `colorPick()` | R | 屏幕取色 → `{ hex, rgb, r, g, b }` |
| `getMediaStreamConstraints(options)` | R/B | 获取录屏约束配置 |

---

## 10. 输入 (input)

| 方法 | 环境 | 说明 |
|------|------|------|
| `hideMainWindowPasteText(text)` | R/B | 粘贴文本到焦点应用 |
| `hideMainWindowPasteImage(image)` | R/B | 粘贴图片到焦点应用 (`image`: `Path \| Buffer \| DataURL \| ArrayBuffer`) |
| `hideMainWindowPasteFile(paths)` | R/B | 粘贴文件到焦点应用 |
| `hideMainWindowTypeString(text)` | R/B | 模拟键入文本 |
| `simulateKeyboardTap(key, ...modifiers)` | R/B | 模拟按键 |
| `simulateMouseMove(x, y)` | R/B | 移动鼠标 |
| `simulateMouseClick(x, y)` | R/B | 左键单击 |
| `simulateMouseDoubleClick(x, y)` | R/B | 左键双击 |
| `simulateMouseRightClick(x, y)` | R/B | 右键点击 |

**修饰键**: `'ctrl' | 'alt' | 'shift' | 'command'`

---

## 11. 窗口 (window)

| 方法 | 环境 | 说明 |
|------|------|------|
| `hide(restorePreWindow?)` | R | 隐藏窗口 |
| `show()` | R | 显示窗口 |
| `setSize(width, height)` | R | 设置尺寸 |
| `setExpendHeight(height)` | R | 调整高度 |
| `center()` | R | 窗口居中 |
| `setAlwaysOnTop(flag)` | R | 设置置顶 |
| `detach()` | R | 分离为独立窗口 |
| `close()` | R | 关闭窗口 |
| `reload()` | R | 重新加载 |
| `getMode()` | R | 获取模式 → `'attached' | 'detached'` |
| `getWindowType()` | R | 获取类型 → `'main' | 'detach'` |
| `getState()` | R | 获取状态 |
| `minimize() / maximize()` | R | 最小化/最大化 |
| `create(url, options?)` | R | 创建子窗口 → `ChildWindowHandle` |
| `sendToParent(channel, ...args)` | R | 向父窗口发消息 |
| `onChildMessage(callback)` | R | 监听子窗口消息 |
| `findInPage(text, options?)` | R | 页面内查找 |
| `startDrag(filePath)` | R | 触发文件拖拽 |

### 子输入框 (subInput)

| 方法 | 说明 |
|------|------|
| `set(placeholder?, isFocus?)` | 显示子输入框 |
| `remove()` | 移除子输入框 |
| `setValue(text)` | 设置内容 |
| `focus() / blur() / select()` | 焦点控制 |
| `onChange(callback)` | 监听变化 |

---

## 12. 主题 (theme)

| 方法 | 环境 | 说明 |
|------|------|------|
| `get()` | R | 获取主题信息 → `{ mode, actual }` |
| `set(mode)` | R | 设置主题 → `'light' | 'dark' | 'system'` |
| `getActual()` | R | 获取实际主题 → `'light' | 'dark'` |
| `onThemeChange(callback)` | R | 监听主题变化 |

---

## 13. 插件管理 (plugin)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAll()` | R | 获取所有插件 |
| `search(query)` | R | 搜索插件功能 |
| `run(name, featureCode, input?)` | R | 执行插件功能 |
| `install(filePath)` | R | 安装插件 |
| `enable(name) / disable(name)` | R | 启用/禁用插件 |
| `uninstall(name)` | R | 卸载插件 |
| `getReadme(name)` | R | 获取 README |
| `redirect(label, payload?)` | R | 跳转到其他插件 |
| `outPlugin(isKill?)` | R | 退出当前插件 |

### 事件

| 事件 | 说明 |
|------|------|
| `onPluginInit(callback)` | 插件初始化 |
| `onPluginAttach(callback)` | 插件附着 |
| `onPluginDetached(callback)` | 插件分离 |

---

## 14. 动态指令 (features)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getFeatures(codes?)` | B | 获取动态指令 |
| `setFeature(feature)` | B | 注册动态指令 |
| `removeFeature(code)` | B | 删除动态指令 |

**DynamicFeatureInput**:
- `code` - 指令代码
- `explain` - 说明文字
- `icon` - 图标（路径/SVG/URL）
- `platform` - 平台限制
- `mode` - 模式：`'ui' | 'silent' | 'detached'`
- `route` - 路由路径
- `mainHide` - 触发时隐藏主窗口
- `mainPush` - 向搜索框推送内容
- `cmds` - 命令数组

### cmds 命令类型

| 类型 | 字段 | 说明 |
|------|------|------|
| `keyword` | `value` | 关键词匹配 |
| `regex` | `match`, `explain?`, `label?`, `minLength?`, `maxLength?` | 正则匹配 |
| `files` | `exts?`, `fileType?`, `match?`, `minLength?`, `maxLength?` | 文件匹配 |
| `img` | `exts?` | 图片匹配 |
| `over` | `label?`, `exclude?`, `minLength?`, `maxLength?` | 覆盖匹配 |

**files 特殊字段**:
- `fileType`: `'file' | 'directory' | 'any'` - 文件类型过滤 (默认 'any')
- `match`: 匹配文件名的正则表达式 (与 `exts` 二选一)
- `minLength` / `maxLength`: 文件数量限制

**regex / over 特殊字段**:
- `minLength` / `maxLength`: 输入文本长度限制 (over 默认为 10000)
- `exclude`: 排除的正则表达式（仅 over）

---

## 15. 快捷键 (shortcut)

| 方法 | 环境 | 说明 |
|------|------|------|
| `register(accelerator)` | R/B | 注册全局快捷键 |
| `unregister(accelerator)` | R/B | 注销快捷键 |
| `unregisterAll()` | R/B | 注销所有快捷键 |
| `isRegistered(accelerator)` | R/B | 检查是否已注册 |
| `onTriggered(callback)` | R | 监听触发事件 |

**accelerator 格式**: `CommandOrControl+Shift+X`, `Alt+P`, `F12`

---

## 16. 权限 (permission)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getStatus(type)` | R/B | 获取权限状态 |
| `request(type)` | R/B | 请求权限 |
| `canRequest(type)` | R/B | 是否可请求 |
| `openSystemSettings(type)` | R/B | 打开系统设置 |
| `isAccessibilityTrusted()` | R/B | macOS 辅助功能权限 |

**type**: `'accessibility' | 'screen' | 'camera' | 'microphone' | 'geolocation' | 'notifications' | 'contacts' | 'calendar'`

---

## 17. 安全存储 (security)

| 方法 | 环境 | 说明 |
|------|------|------|
| `isEncryptionAvailable()` | R/B | 检查加密可用性 |
| `encryptString(plainText)` | R/B | 加密字符串 → `Buffer` |
| `decryptString(encrypted)` | R/B | 解密字符串 (`encrypted`: `Buffer \| ArrayBuffer`) → `string` |

---

## 18. 托盘 (tray)

| 方法 | 环境 | 说明 |
|------|------|------|
| `create(options)` | R/B | 创建托盘图标 |
| `destroy()` | R/B | 销毁托盘 |
| `setIcon(icon)` | R/B | 更新图标 |
| `setTooltip(tooltip)` | R/B | 设置提示 |
| `setTitle(title)` | R/B | 设置标题（macOS） |
| `exists()` | R/B | 检查是否存在 |

**TrayOptions**: `icon`, `tooltip`, `title`

---

## 19. 菜单 (menu)

| 方法 | 环境 | 说明 |
|------|------|------|
| `showContextMenu(items)` | R | 显示右键菜单 → `id | null` |

**MenuItemOptions**: `label`, `type`, `checked`, `enabled`, `id`, `submenu`

---

## 20. 网络状态 (network)

| 方法 | 环境 | 说明 |
|------|------|------|
| `isOnline()` | R/B | 检查是否在线 |
| `onOnline(callback)` | R | 网络恢复事件 |
| `onOffline(callback)` | R | 网络断开事件 |

---

## 21. 电源 (power)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getSystemIdleTime()` | R/B | 获取空闲时间 |
| `getSystemIdleState(threshold)` | R/B | 获取空闲状态 |
| `isOnBatteryPower()` | R/B | 是否电池供电 |
| `getCurrentThermalState()` | R/B | 获取热状态（macOS） |
| `onSuspend / onResume` | R | 休眠/唤醒事件 |
| `onAC / onBattery` | R | 电源切换事件 |
| `onLockScreen / onUnlockScreen` | R | 锁屏事件 |

---

## 22. 媒体 (media)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAccessStatus(type)` | R/B | 获取权限状态 |
| `askForAccess(type)` | R/B | 请求权限 |
| `hasCameraAccess()` | R/B | 检查摄像头权限 |
| `hasMicrophoneAccess()` | R/B | 检查麦克风权限 |

**type**: `'camera' | 'microphone'`

---

## 23. 地理位置 (geolocation)

| 方法 | 环境 | 说明 |
|------|------|------|
| `getAccessStatus()` | R | 获取权限状态 |
| `requestAccess()` | R | 请求权限 |
| `canGetPosition()` | R | 是否可获取位置 |
| `openSettings()` | R | 打开系统设置 |
| `getCurrentPosition()` | R | 获取当前位置 → `GeolocationPosition` |

---

## 24. TTS 语音合成 (tts)

| 方法 | 环境 | 说明 |
|------|------|------|
| `speak(text, options?)` | R | 朗读文本 |
| `stop()` | R | 停止朗读 |
| `pause() / resume()` | R | 暂停/恢复 |
| `getVoices()` | R | 获取语音列表 |
| `isSpeaking()` | R | 是否正在朗读 |

**options**: `lang`, `rate`, `pitch`, `volume`

---

## 25. Host 调用 (host)

| 方法 | 环境 | 说明 |
|------|------|------|
| `invoke(pluginName, method, ...args)` | R | 调用插件后端方法 |
| `status(pluginName)` | R | 获取 Host 状态 |
| `restart(pluginName)` | R | 重启 Host 进程 |

---

## 26. Sharp 图像处理 (sharp)

| 方法 | 说明 |
|------|------|
| `sharp(input?, options?)` | 创建实例 |
| `.resize(w?, h?, opts?)` | 调整尺寸 |
| `.extract({ left, top, width, height })` | 裁剪区域 |
| `.rotate(angle?)` | 旋转 |
| `.flip() / .flop()` | 翻转 |
| `.blur(sigma?) / .sharpen()` | 模糊/锐化 |
| `.grayscale() / .negate()` | 灰度/反相 |
| `.modulate({ brightness, saturation, hue })` | 调整色彩 |
| `.composite(images)` | 合成 |
| `.png() / .jpeg() / .webp()` | 设置格式 |
| `.toBuffer()` | 输出 ArrayBuffer |
| `.toFile(path)` | 输出文件 |
| `.metadata()` | 获取元数据 |

---

## 27. FFmpeg 音视频 (ffmpeg)

| 方法 | 环境 | 说明 |
|------|------|------|
| `isAvailable()` | R | 检查是否已安装 |
| `getVersion()` | R | 获取版本 |
| `getPath()` | R | 获取可执行文件路径 |
| `download(onProgress?)` | R | 下载 FFmpeg |
| `run(args, onProgress?)` | R | 执行命令 → `{ promise, kill, quit }` |

---

## 28. InBrowser 自动化 (inbrowser)

| 方法 | 说明 |
|------|------|
| `.goto(url, headers?, timeout?)` | 导航 |
| `.click(selector) / .dblclick(selector)` | 点击 |
| `.input(selector, text) / .type(selector, text)` | 输入 |
| `.press(key, modifiers?)` | 按键 |
| `.hover(selector) / .focus(selector)` | 悬停/聚焦 |
| `.wait(ms) / .wait(selector)` | 等待 |
| `.evaluate(func, ...args)` | 执行脚本 |
| `.screenshot(target?, savePath?)` | 截图 |
| `.pdf(options?, savePath?)` | 导出 PDF |
| `.cookies(filter?)` | 获取 Cookie |
| `.setCookies(...) / .clearCookies()` | 设置/清除 Cookie |
| `.viewport(w, h)` | 设置视口 |
| `.show() / .hide() / .end()` | 窗口控制 |
| `.run(options?)` | 执行队列 |

---

## 环境标识说明

- **R** = 渲染进程可用 (`window.mulby.xxx`)
- **B** = 插件后端可用 (`context.api.xxx`)
- **R/B** = 两者都可用
