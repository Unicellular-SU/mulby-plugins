# 浏览器历史记录搜索

Mulby 插件，用于快速搜索 Chrome、Edge 等 Chromium 浏览器的历史记录。支持多个关键词筛选，点击结果后使用系统默认浏览器打开对应 URL。

原始版本来自 uTools 插件 `chrome-history`，本目录已迁移为 Mulby 插件结构。

## 功能

- 搜索 Chrome/Edge 历史记录标题和 URL。
- 支持空格分隔多个关键词，例如 `openai docs`。
- 自动读取默认 Chrome Profile。
- 可选择或拖入自定义 Chrome Profile 目录，适合切换 Edge、Chrome Canary 或其他 Chromium 浏览器。
- 读取 Chrome SQLite `History` 与 `Favicons` 数据库，并在存在 WAL 文件时合并快照读取。

## 命令

- `ch`：打开历史记录搜索面板。
- `edge`：打开历史记录搜索面板。
- `Chrome历史记录` / `Edge历史记录`：打开历史记录搜索面板。
- 选中文字后选择「搜索浏览器历史记录」：使用选中文字作为搜索词。
- 拖入一个目录并选择「设置为 Chrome Profile 目录」：保存该目录为历史记录来源。
- `ch 关键词`：打开搜索面板并使用关键词搜索。

## 使用示例

1. 在 Mulby 输入 `ch` 打开搜索面板。
2. 在面板输入多个关键词，例如 `github login`。
3. 点击结果打开网页。
4. 搜索 Edge 历史记录时，点击面板里的 `Profile` 选择 Edge Profile 目录，或拖入 Profile 目录触发设置命令。

浏览器 Profile 路径可在浏览器地址栏访问 `chrome://version` 或 `edge://version` 查看。

## 开发

```bash
npm install
npm run build
npm run pack
```

构建产物：

- 后端入口：`dist/main.js`
- UI 入口：`ui/index.html`
- 插件图标：`icon.png`
- 打包文件：`chrome-history-2.2.0.inplugin`

## Migration Notes

uTools API 迁移情况：

| uTools API | Mulby 替代 |
| --- | --- |
| `utools.db.get/put` | `mulby.storage.get/set` |
| `utools.getPath("appData")` | 后端按平台从环境变量推导 appData 路径 |
| `utools.shellOpenExternal` | `mulby.shell.openExternal` |
| `utools.showNotification` | `mulby.notification.show` |
| 文件目录触发 `cmds.files` | Mulby `files` 指令 |
| `utools.onMainPush` 动态候选 | Mulby UI 面板搜索结果 |

已知差异：

- Mulby 文档中 `mainPush` 当前为保留字段，不能完全复刻 uTools 主输入框动态候选列表，所以搜索结果在插件面板中展示。
- 原 uTools preload 已移除；Mulby 版使用 `src/main.ts` 后端和 `src/ui` React 面板。

## Mulby 验收清单

1. 安装 `chrome-history-2.2.0.inplugin`。
2. 输入 `ch`，确认搜索面板打开。
3. 输入关键词，确认能看到历史记录结果。
4. 点击一条结果，确认系统默认浏览器打开该 URL。
5. 拖入 Edge 或 Chrome Profile 目录，选择「设置为 Chrome Profile 目录」，再搜索确认数据源切换成功。
