# Mulby API Lab

Mulby API Lab 是面向插件开发者的模块化 API 示例插件。当前版本采用 showcase 风格结构：左侧按 Mulby API 文档模块导航，右侧只展示当前模块的功能、状态、可操作控件、API 覆盖表和原始输出。

图标规范：UI 内使用 `lucide-react` 或本地 SVG，插件图标使用 `assets/icon.svg` 栅格化得到的 `icon.png`，不使用 emoji 图标。

## 页面结构

- 左侧导航按 `D:\Node.js\mulby\docs\apis` 的模块逐项列出，包括 `system`、`window`、`inbrowser`、`system-plugin`、`app-events`、`plugin-store`、`manifest` 等。
- 右侧模块页固定结构为：页面头部、状态摘要、功能区、API 覆盖表、原始输出折叠区。
- 启动上下文和生命周期事件在顶部“上下文”折叠抽屉中展示，不固定在右侧。
- 每个 API 文档方法至少在覆盖表中有一行，标明端点、风险、演示策略和说明。

## 重点模块

| 模块 | 实际能力 |
| --- | --- |
| `system` | 读取系统、宿主、资源占用、路径和动态指令摘要。 |
| `window` | 读取窗口状态，执行页面查找，创建子窗口，控制 `ChildWindowHandle.show/hide/focus/setTitle/setSize/postMessage/close`，演示 `sendToParent/onChildMessage` 父子通信和 `startDrag` 安全文件拖拽。 |
| `inbrowser` | 使用安全 URL 执行页面标题提取、Markdown 抽取、截图、Cookie 检查、PDF 保存和下载；文件写入限制在系统临时目录 `mulby-api-lab/inbrowser`。 |
| `manifest` | 展示当前插件 features、permissions、tools、pluginSetting、启动输入和附件。 |
| `filesystem` | 只在系统临时目录 `mulby-api-lab` 下创建和读取示例文件。 |
| `storage` | 只写入 `api-lab:*` 和已知示例键。 |
| `shell` | 只执行固定安全命令，并展示命令策略。 |
| `scheduler` | 创建、查看和记录本插件示例任务。 |
| `features` | 查看和刷新 API Lab 动态指令，覆盖 MainPush。 |
| `sharp` | 在内存中生成小图，读取 metadata/stats，不默认写任意文件。 |
| `ffmpeg` | 检查可用性、版本和路径；下载和转码只在覆盖表说明。 |

## 触发方式

| 功能 | 触发 |
| --- | --- |
| 总览 | `api lab`, `mulby api`, `api实验室`, `api-lab` |
| API 搜索 | `api search`, 正则 `api ...` |
| 文件和图片附件 | `api files`, 拖入文件或图片 |
| 划词输入 | 选中文字后选择 API Lab |
| 截图预捕获 | `api capture`, `api截图` |
| 静默自检 | `api smoke`, `api自检` |
| MainPush | `api push`, 正则 `api-push ...` |
| 独立窗口 | `api window`, 当前窗口上下文入口 |

## AI 工具

插件在 `manifest.tools` 中声明并在后端 `onLoad` 注册三个公开工具：

| 工具 | 说明 |
| --- | --- |
| `echo` | 回显 JSON 兼容消息，并演示进度上报。 |
| `summarize_api_module` | 返回 API Lab 中某个模块的简短说明。 |
| `safe_file_probe` | 对路径做元数据检查，不读取文件内容。 |

## 敏感 API 策略

- `shell.runCommand` 只执行固定安全命令，不提供任意命令输入。
- 文件写入只发生在系统临时目录下的 `mulby-api-lab` 文件夹。
- Storage 场景只写 `api-lab:*` 和已知示例键，清理时只删除这些键。
- 通知、TTS、主题切换、定位、取色、窗口分离、系统页打开、子窗口创建等会影响系统或宿主状态的操作需要二次确认。
- 插件安装、卸载、批量更新、清空历史、删除任意文件等破坏性能力不提供直通按钮。
- FFmpeg 下载和转码、InBrowser 下载/PDF 写入属于长任务或文件写入能力，默认说明或限制到插件临时目录。

## 开发

```bash
pnpm install
pnpm run icon
pnpm exec tsc --noEmit
pnpm run build
node ..\..\scripts\validate-mulby-api-lab.mjs
pnpm run pack
```

构建产物：

- 后端：`dist/main.js`
- UI：`ui/index.html`
- 图标：`icon.png`
- 插件包：`mulby-api-lab-1.0.0.inplugin`

## Mulby 内验收清单

1. 使用 `api lab` 打开插件，确认左侧能看到所有 API 文档模块。
2. 点击 `window`，确认页面包含当前窗口控制和子窗口实验区。
3. 在 `window` 中创建子窗口，并测试 show、hide、focus、setTitle、setSize、postMessage、close、子窗口发送给父窗口、示例文件拖拽。
4. 点击 `inbrowser`，用 `https://example.com` 完成标题提取、截图、PDF 保存或安全下载示例。
5. 点击 `manifest`，确认 features、permissions、tools、启动上下文和附件可查看。
6. 每个模块页底部都有 API 覆盖表和原始输出折叠区。
7. 顶部“上下文”可展开、收起、清空生命周期事件。
8. 确认危险操作不会影响插件临时目录和示例存储之外的数据。
