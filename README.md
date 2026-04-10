# Mulby Plugins

Mulby 插件集合仓库。每个插件位于 `plugins/<plugin-name>/`，支持统一构建、打包，并通过 GitHub Release 分发 `.inplugin` 产物。

## 当前发布策略

- `.inplugin` 统一作为 GitHub Release 资产发布。
- 发布 tag 使用时间格式：`vYYYY.MM.DD-HHmm`。
- `plugins.json` 用于插件索引。
- `releases/` 仅作为 CI 或本地构建时的临时输出目录（已在 `.gitignore` 忽略）。

## Mulby CLI 简要说明

- `mulby-cli` 用于插件脚手架创建、构建与打包，常见命令包括 `create`、`build`、`pack`。
- 若仓库内提供包装脚本（如 `scripts/invoke_mulby_cli.mjs`），可优先使用；当前仓库可直接使用全局 `mulby` 或 `npx mulby-cli@latest`。
- 创建插件时按场景选择模板：`react` 适合有可见 UI 的插件，`basic` 适合命令式或后台型插件。
- 打包前需先构建：通常先执行 `npm run build`，再执行 `npm run pack` 产出 `.inplugin`。
- 在 AI 代写流程中不建议使用 `mulby create --ai`。

## 仓库结构

- `plugins/`：所有插件源码目录（每个插件独立维护）。
- `scripts/`：构建、截图、索引生成脚本。
- `.github/workflows/build.yml`：主发布工作流（`push main` 触发）。
- `plugins.json`：插件索引文件（包含下载地址、图标、截图、元数据）。
- `build-local.sh`：本地一键构建脚本（用于本地预检，不参与 CI 必需流程）。

## 分支与开发流程（推荐）

建议使用 `dev` + feature 分支，避免在 `main` 直接开发：

1. 从 `dev` 拉出功能分支：
   - `feature/<plugin-or-topic>`
2. 功能完成后合并回 `dev` 做集成验证。
3. 准备发布时，将 `dev` 合并到 `main`。
4. `push main` 后由 GitHub Actions 自动打包并发布 Release。

## scripts 目录脚本说明

### `scripts/build-all-plugins.js`

- 作用：遍历 `plugins/` 下插件，执行 `npm run build`。
- 特点：只做“构建”，不打包、不生成 `plugins.json`。
- 用途：快速检查多个插件是否可编译通过。
- 命令：`npm run build-all`

### `scripts/screenshot-plugin-ui.js`

- 作用：为有 UI 的插件自动构建并截取首屏图，输出到 `plugins/<name>/screenshots/1.png`，同时补充 `1.txt` caption。
- 依赖：根目录安装 `puppeteer`。
- 用途：用于补齐插件商店截图资源。
- 命令：
  - `npm run screenshot-plugins`（全部）
  - `npm run screenshot-plugins -- <plugin-name>`（指定插件）

### `scripts/build-plugin-index-entry.js`

- 作用：根据单个插件 `manifest`/`README` 生成一条 `plugins.json` 索引记录（JSON line）。
- 关键能力：
  - 计算 `.inplugin` 的 `sha256`
  - 生成 icon/screenshot 链接
  - 生成下载链接（Release 资产地址）
- 主要由 CI 工作流调用，不建议手工频繁调用。

## `build-local.sh` 

常用示例：

- `./build-local.sh`
- `./build-local.sh --repo Unicellular-SU/mulby-plugins`
- `./build-local.sh --dry-run`
- `./build-local.sh --no-cleanup`

## 新增插件最小要求

在 `plugins/<new-plugin>/` 中至少包含：

- `manifest.json`
- `package.json`（含 `build` / `pack` 脚本）
- `src/main.ts`（后端入口）
- `src/ui/*`（如为 UI 插件）
- `README.md`
- `icon.png`（建议保留可编辑 SVG 源）

## License

MIT