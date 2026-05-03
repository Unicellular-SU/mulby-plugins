# VS Code History (Mulby Plugin)

快速搜索 VS Code 及基于 VS Code 开发的 IDE 的历史项目，支持在对应 IDE 中打开。

原 uTools 插件，已迁移至 Mulby 平台。

## 功能

- **搜索历史项目**: 输入 IDE 名称（如 `cursor`、`vsc`）搜索该 IDE 的历史打开项目
- **打开项目**: 点击项目在对应 IDE 中打开
- **删除历史记录**: 使用 `-rm` 模式删除不需要的历史记录
- **多 IDE 支持**: 支持所有基于 VS Code 开发的 IDE（Cursor、Windsurf 等）
- **动态新增 IDE**: 通过 `vsc-add-ide` 或 `新增 IDE` 指令新增自定义 IDE

## 使用说明

### 搜索项目
在 Mulby 输入框中输入已配置的 IDE 名称（如 `cursor`、`vsc`），即可搜索该 IDE 的历史项目。

### 管理 IDE
- 输入 `vsc-ide` 查看已有 IDE 列表，可进行搜索、设置、删除操作
- 输入 `vsc-add-ide` 或 `新增 IDE` 新增 IDE
- 输入 `<ide名称>-setting`（如 `cursor-setting`）修改 IDE 配置

### 删除历史
在搜索页面点击 `-rm` 按钮进入删除模式，点击项目即可删除该历史记录。

### 配置项
每个 IDE 支持以下配置：
- **code**: IDE 唯一标识
- **图标**: IDE 图标路径（png 格式）
- **终端环境**: shell 环境配置（Windows 用户留空）
- **执行命令**: IDE 的命令行命令
- **数据库配置**: IDE 的 state.vscdb 文件路径
- **超时时间**: 命令执行超时时间（毫秒）

## 迁移说明

本插件由原 uTools 插件迁移至 Mulby 平台。

### API 映射

| uTools API | Mulby API | 说明 |
|---|---|---|
| `utools.dbStorage.setItem/getItem` | `context.api.storage.set/get` | 配置持久化 |
| `utools.setFeature/removeFeature/getFeatures` | `context.api.features.*` | 动态指令注册 |
| `utools.showNotification` | `context.api.notification.show` / `window.mulby.notification.show` | 通知 |
| `utools.hideMainWindow` | `window.mulby.window.hide` | 隐藏窗口 |
| `utools.outPlugin` | `window.mulby.plugin.outPlugin` | 退出插件 |
| `utools.setExpendHeight` | `manifest.pluginSetting.height` | 面板高度（静态配置） |
| `utools.getPath("appData")` | 手动解析（Node.js process.env） | 应用数据目录 |
| `utools.getNativeId` | 无需等价物（Mulby storage 已按插件隔离） | 插件标识 |
| `utools.setSubInputValue` | 迁移至插件自有 UI 搜索框 | 子输入框 |
| `child_process.exec` | `context.api.shell.runCommand` / 原生 Node.js | 命令执行 |

### 已知差异
- 原插件使用 uTools 宿主搜索 UI 展示结果，Mulby 版本使用插件自有 UI
- 原插件的子输入框由 uTools 宿主提供，Mulby 版本在插件 UI 内实现搜索

## 开发

```bash
npm install
npm run build
npm run pack
```

## 开源地址

https://github.com/mohuishou/utools
