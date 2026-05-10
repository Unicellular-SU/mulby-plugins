# Mulby API Demo

`mulby-demo` is a reference Mulby plugin for third-party plugin developers. It demonstrates public plugin APIs with runnable examples and marks host-internal or settings-scoped APIs as documentation-only boundaries.

`mulby-demo` 是面向第三方插件开发者的 Mulby API 参考插件。它以安全可运行示例展示公开插件 API，并将宿主内部或仅限设置页使用的 API 标记为只读边界说明。界面内置 English / 中文切换，模块简介、注意事项和示例说明均提供双语内容。

## Features

- Browse Mulby public plugin APIs by module category.
- Run renderer examples through `window.mulby.*`.
- Run backend examples through `window.mulby.host.call('mulby-demo', ...)`, with RPC-safe delayed backend API resolution.
- Inspect manifest, lifecycle, host RPC, dynamic features, scheduler callbacks, and Plugin Tools.
- Exercise method-level public API coverage, including guarded calls for environment-mutating APIs such as Plugin Store install/update.
- Review restricted APIs that are intentionally excluded from runnable third-party examples.
- Switch between English and Chinese documentation in the UI.
- Use Live Playground controls for visible APIs such as windows, tray, dialogs, clipboard, screen capture, shell actions, InBrowser, and shortcuts. These controls keep observable resources alive until an explicit cleanup action.

## 功能

- 按模块分类浏览 Mulby 对第三方插件开放的公开 API。
- 通过 `window.mulby.*` 运行渲染端示例。
- 通过 `window.mulby.host.call('mulby-demo', ...)` 运行后端示例，并使用适配 RPC 的后端 API 延迟解析。
- 查看 manifest、生命周期、Host RPC、动态功能、调度器回调和 Plugin Tools 示例。
- 覆盖公开 API 的方法级示例，包括对会改变环境的 API 使用受控目标或错误捕获保护。
- 查看被排除在可运行第三方示例之外的内部或设置专属 API 边界。
- 在界面中切换英文和中文说明。
- 对窗口、托盘、对话框、剪贴板、屏幕捕获、Shell 操作、InBrowser 和快捷键等可见 API 使用实时演示控件；可观察资源会保持到用户显式点击清理操作。

## Commands

- `mulby demo`, `mulby api`, `插件 API 示例`: open the reference UI.
- `mulby demo detached`: open the reference UI in a detached window.
- `mulby demo smoke`: run a silent coverage smoke demo.
- `mulby dynamic demo`: static placeholder that pairs with the dynamic features example.

## Public API Scope

The runnable modules cover:

- Manifest, lifecycle, Host RPC, Plugin Tools
- Storage V1/V2, encrypted storage, attachments, filesystem, clipboard, clipboard history
- HTTP, network, shell policy/audit/commands, desktop search, InBrowser
- Dialog, notification, window, sub input, theme, menu, tray
- Plugin discovery, run, preferences, command shortcuts, background/process controls, dynamic features, messaging, scheduler
- System, permissions, power events, screen, media, input, input monitor, shortcut, security, geolocation
- AI, TTS, Sharp, FFmpeg, Log diagnostics

Each public method in `src/shared/api-catalog.ts` must appear in at least one runnable example. The `test/method-coverage.test.mjs` test enforces this.

## 公开 API 范围

可运行模块覆盖：

- Manifest、生命周期、Host RPC、Plugin Tools
- Storage V1/V2、加密存储、附件、文件系统、剪贴板、剪贴板历史
- HTTP、网络、Shell 策略/审计/命令、桌面搜索、InBrowser
- 对话框、通知、窗口、子输入、主题、菜单、托盘
- 插件发现、运行、偏好、命令快捷键、后台/进程控制、动态功能、消息和调度器
- 插件商店读取、更新检查，以及受控安装/更新调用
- 系统、权限、电源事件、屏幕、媒体、输入、输入监听、全局快捷键、安全和地理位置
- AI、TTS、Sharp、FFmpeg 和日志诊断

`src/shared/api-catalog.ts` 中的每个公开方法都必须出现在至少一个可运行示例中，`test/method-coverage.test.mjs` 会强制检查这一点。

## Excluded Boundary APIs

The plugin documents but does not run examples for APIs that are internal, settings-scoped, or too environment-mutating for a third-party reference demo:

- `settings`
- `developer`
- `systemPlugin`
- `systemPage`
- `superPanel`
- `trayMenu`
- host navigation-oriented `app` events
- AI global MCP/web-search/plugin-tool settings
- undocumented host internals such as `onboarding` and `openclaw`

## Project Structure

```text
mulby-demo/
|- manifest.json
|- package.json
|- README.md
|- icon.png
|- assets/icon.svg
|- src/
|  |- main.ts
|  |- shared/api-catalog.ts
|  |- types/mulby.d.ts
|  `- ui/
|     |- App.tsx
|     |- i18n.ts
|     |- styles.css
|     |- examples/
|     |  |- registry.ts
|     |  |- types.ts
|     |  `- *.example.ts
|     `- hooks/useMulby.ts
`- test/
   |- i18n.test.mjs
   |- layout.test.mjs
   |- backend-rpc.test.mjs
   |- method-coverage.test.mjs
   `- registry.test.mjs
```

## Live Playground Architecture

Each module can define an optional `playground` in its `src/ui/examples/*.example.ts` entry. A playground contains:

- `controls`: user-triggered actions with labels, method coverage, safety labels, optional cleanup markers, and runnable handlers.
- `resultViews`: the result shapes developers should expect, such as status, preview, table, external UI, log, or JSON.
- `code`: short reference snippets shown under a collapsible code section.

The UI discovers these definitions from the same registry as the API examples. Adding a new interactive API demo should not require editing `App.tsx`; add the module metadata and handler next to the module example instead.

Long-lived examples must split create/update/read/cleanup into separate controls. For example, `window.create` creates and keeps a child window open, while a separate close action disposes it. Tray, shortcut, sub-input, and browser examples follow the same rule.

## 实时演示架构

每个模块都可以在自己的 `src/ui/examples/*.example.ts` 条目中定义可选 `playground`。实时演示包含：

- `controls`：由用户触发的操作，包含标签、方法覆盖、安全标签、可选清理标记和可运行处理函数。
- `resultViews`：开发者应关注的结果形态，例如状态、预览、表格、外部界面、日志或 JSON。
- `code`：放在折叠代码区内的短参考片段。

UI 会从与 API 示例相同的注册表中自动发现这些定义。新增交互式 API 演示时，不应修改 `App.tsx`；只需要在对应模块示例旁补充元数据和处理函数。

长生命周期示例必须拆分为创建、更新、读取、清理等独立控件。例如 `window.create` 只负责创建并保持子窗口打开，关闭由单独的 close 操作完成。托盘、快捷键、子输入和浏览器示例也遵循同样规则。

## Development

```bash
pnpm install
pnpm --filter mulby-demo test
pnpm --filter mulby-demo build
```

If the Mulby CLI is installed:

```bash
pnpm --filter mulby-demo pack
```

## Adding a New API Example

1. Add or update the API entry in `src/shared/api-catalog.ts`.
2. Add a focused module in `src/ui/examples/*.example.ts`.
3. Export that module list from `src/ui/examples/registry.ts`.
4. Add backend support in `src/main.ts` only when the API must run in backend context.
5. Add Chinese module and example text in `src/ui/i18n.ts`.
6. Run `pnpm --filter mulby-demo test` to confirm registry, layout, bilingual coverage, backend RPC safety, and method-level API coverage.
7. Run `pnpm --filter mulby-demo build` to verify the plugin bundle.

Example modules should include summary, methods, contexts, permissions, notes, runnable snippets, and a clear safety label. For visible APIs, also add a `playground` with real controls and an explicit cleanup action when the API creates persistent state.

## 新增 API 示例

1. 在 `src/shared/api-catalog.ts` 添加或更新 API 条目。
2. 在 `src/ui/examples/*.example.ts` 添加聚焦的模块示例。
3. 在 `src/ui/examples/registry.ts` 导出新的模块列表。
4. 只有 API 必须在后端上下文运行时，才在 `src/main.ts` 添加后端支持。
5. 在 `src/ui/i18n.ts` 补充中文模块说明和示例说明。
6. 运行 `pnpm --filter mulby-demo test` 检查注册表、布局、双语覆盖、后端 RPC 安全性和方法级 API 覆盖。
7. 运行 `pnpm --filter mulby-demo build` 验证插件打包产物。

每个示例模块应包含功能简介、方法列表、运行上下文、权限、注意事项、可运行代码片段和明确的安全标签。对于可见 API，还应添加带真实控件的 `playground`，并在 API 创建持久状态时提供显式清理操作。
