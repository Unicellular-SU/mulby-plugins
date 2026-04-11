# 文本/代码对比（text-compare）

在 Mulby 中并排对比两段文本或代码，高亮差异、支持语法高亮与从剪贴板/文件载入。

## 功能

- 左右分栏 **Merge** 视图，行级差异与变更块对齐
- **语言模式**：纯文本、JavaScript/TypeScript、JSON、HTML、CSS、Markdown、Python、XML
- **工具栏**：剪贴板贴到左/右、从文件载入左/右、交换两侧、复制左/右全文、清空
- **启动输入拆分**：若 Mulby 传入的内容中包含分隔符 `<<<DIFF_SPLIT>>>`，则分隔符**之前**为左侧文本，**之后**为右侧文本（不包含分隔符本身）
- **主题**：随 Mulby 宿主明暗主题切换
- 语言选择在本地持久化（同一插件存储键）

## 触发方式

在 Mulby 中可通过以下方式打开本插件：

- 关键词：`diff`、`对比`、`compare`
- 正则：至少 10 个字符的多行文本（与其他插件一致，避免误触）

## 使用示例

### 从启动输入同时传入两段文本

将以下内容作为输入（中间为固定分隔符）：

```text
第一版代码或文案
<<<DIFF_SPLIT>>>
第二版代码或文案
```

打开插件后左侧为第一版，右侧为第二版。

### 仅一段文本

若输入中**没有** `<<<DIFF_SPLIT>>>`，则整段进入**左侧**，右侧为空，可在界面中粘贴或打开文件补充右侧。

## 插件图标

矢量稿为 [`assets/icon.svg`](assets/icon.svg)。根目录 [`icon.png`](icon.png)（512×512，供 `manifest.icon` 与打包使用）由 **generate-electron-icons** 流程从 SVG 栅格化生成。

在插件目录执行（需已 `pnpm install` 以安装 `sharp`，需系统 `python3` 与 Pillow `PIL`）：

```bash
cd plugins/text-compare
pnpm install
pnpm run icons
```

脚本默认调用 `~/.cursor/skills/generate-electron-icons/scripts/generate_electron_icons.py`；若 skill 不在该路径，可设置环境变量 `GENERATE_ELECTRON_ICONS_SCRIPT` 指向 `generate_electron_icons.py`，再将 `generated-icons/text-compare/build/icon.png` 复制为根目录 `icon.png`（`pnpm run icons` 已自动完成复制）。

修改 `assets/icon.svg` 后请重新执行 `pnpm run icons` 再执行 `pnpm run pack`。

## 构建与打包

```bash
cd plugins/text-compare
pnpm install
pnpm run build
pnpm run pack
```

生成物：`text-compare-1.0.0.inplugin`（版本以 `manifest.json` 为准）。

## 依赖与体积说明

- UI 使用 CodeMirror 6 `@codemirror/merge`，首次加载脚本体积较大属正常现象。
- 若两侧文本合计过大（例如数十万字符），可能出现卡顿；工具栏会提示「内容较大」。

## 在 Mulby 中手动验收建议

1. 使用关键词 `diff` 或 `对比` 打开插件，确认窗口尺寸与工具栏正常。
2. 分别在左右输入不同文本，确认差异高亮与滚动对齐。
3. 切换语言为 JSON/JavaScript，确认语法高亮正常。
4. 使用「贴左」「贴右」从剪贴板载入；使用「左文件」「右文件」从磁盘载入（需宿主授权文件访问）。
5. 点击「交换」，确认左右内容互换。
6. 切换 Mulby 明暗主题，确认编辑器主题跟随。
7. 执行 `pnpm run pack` 后安装 `.inplugin`，确认可正常加载。

## 仓库信息

本插件位于 `mulby_plugins` 仓库的 `plugins/text-compare` 目录，主页见 `manifest.json` 中的 `homepage` 字段。
