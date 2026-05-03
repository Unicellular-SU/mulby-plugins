# AGENTS

本文件用于记录面向代理/自动化编码助手的仓库级约束，避免后续会话重复踩坑。

## Electron / WebView 兼容性约束

- Mulby 内置 Electron / WebView 对部分新 CSS 特性支持不稳定，尤其是 `color-mix()`。
- 如果关键界面（尤其右侧黄历面板）依赖 `color-mix()` 生成边框、浅底色、高亮色、阴影，可能出现：网页版正常，但 Mulby 插件内样式失效或明显退化。
- 对关键 UI 不要直接依赖运行时 `color-mix()`；优先在 JS 中预计算派生色，再通过 CSS 变量写回，例如在 `applyTheme()` 中生成 `--almanac-line`、`--almanac-gold`、`--almanac-board-bg` 等变量。
- 如果必须使用新 CSS 语法，先提供兼容回退，再做渐进增强。
- 每次涉及主题色、黄历右栏、Mulby 专属视图的样式调整后，都必须同时验证：
  1. 普通浏览器 dev 页面
  2. Mulby 插件开发模式页面
  3. `npm run build` 构建结果

## Mulby 插件约束

- `manifest.json` 为插件契约和唯一真相源，修改功能或工具时必须同步更新
- 后端入口 `src/main.ts`，前端入口 `src/main.js` → `src/App.vue` → `src/Calendar/index.vue`
- 构建产物：`dist/main.js`（后端）、`ui/index.html`（前端）
- `tyme4ts` 因使用 `createRequire(import.meta.url)` 无法被 esbuild 打包，需通过 `--external:tyme4ts` 外部化，运行时依赖 `node_modules` 中的包（由 `preload.cjs` 触发打包包含）
- 工具注册在 `src/main.ts` 的 `onLoad()` 中通过 `context.api.tools.register()` 完成
- 存储操作通过 `window.mulby.storage`（异步），同时写入 `localStorage` 作为降级方案
