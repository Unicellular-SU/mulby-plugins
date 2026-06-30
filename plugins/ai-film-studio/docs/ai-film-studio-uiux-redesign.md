# AI 影视工坊（ai-film-studio）· UI/UX 现代化重设计方案

> **设计语言：Aurora Glass** —— AI 原生「渐变 + 玻璃拟态」，原生支持亮色 / 暗色双主题。
> 本方案为**纯视觉 / 交互重设计**：不改变任何功能、数据流、props、store 接线、节点图行为或宿主（`window.mulby`）API 调用。
> 覆盖范围：整个插件的两套子应用 —— **节点画布编辑器（画布）** 与 **Toonflow 式结构化工作台（Studio）** —— 以及全部页面 / 设置 / 组件 / 浮层。

文档形态为**双语**：章节叙述与设计取舍用中文，技术规格（设计令牌、CSS、组件锚点、ASCII 线框、映射表）以可直接落地的英文/代码原样给出，避免精度损失。

---

## 实施进度（Implementation Status）

> 落地分支：`feat/ui-aurora-glass`（基于 `dev`）。按第 9 节路线图分阶段推进，**每完成一次改造即更新此表并提交**。验收基线：`CI=true npm run build:ui` 通过、功能 1:1 不变。

| 阶段 | 改造 | 状态 | 说明 |
| --- | --- | --- | --- |
| 0 | CSS 令牌底座（Aurora Glass tokens + `.afs-glass`/`.afs-glow` 工具类 + 可访问性降级 + aurora sRGB 兜底） | ✅ 已完成 | `styles.css` 头部整块替换；旧令牌名全部保留并重指向；**反回归**：`--afs-panel-2`=内陷面、`--afs-dot`=可见滚动条色、新增 `--afs-surface-3`/`--afs-grid-dot`；补齐此前未定义的 `--afs-text-dim`（修复亮色）。`build:ui` 通过。 |
| 1 | 组件库 P0 · **Button** | ✅ 已完成 | 合并此前两套冲突的 `.afs-btn` 基定义 + 散落的 `--stop`/`--mini`；变体 `secondary/primary/gradient(招牌AI)/ghost/danger/stop` 全走令牌；accent 上文字由 `#fff` 改 `--afs-on-accent`（修复暗色 accent 偏亮导致的低对比）；Toolbar **运行→gradient**、**保存→solid** 区分主操作，停止→danger。`build:ui` 通过。 |
| 1 | 组件库 P0 · **Input / Textarea / Select 触发器**（令牌化重塑） | ✅ 已完成 | `.afs-field__input`、`.afs-toolbar__select/__name`、`.afs-form__row input/select` 统一为：内陷面 `--afs-surface-sunken` + 悬停 `--afs-border-strong` + 聚焦 accent 边框与 2px 焦点环 + 占位符 `--afs-text-dim`；原生 `<select>` 去 OS 箭头并贴自绘 chevron（**纯 CSS、零 markup 改动、零新依赖**，全应用输入框/下拉触发器一次性统一）。注：select 选项弹层仍为系统级，待后续自定义 Select（需 headless）接管。`build:ui` 通过。 |
| 1 | 组件库 P0 · **IconButton** + **AppRail 导航令牌化** | ✅ 已完成 | 新增 `.afs-iconbtn` 原语（方形热区/中性·`aria-pressed`激活·危险变体/焦点环/按压缩放），Toolbar 三个图标按钮（适应画布/项目风格/工程快照）改用并补 `aria-label`；AppRail 品牌标记由硬编码琥珀 `#f59e0b` 换成 `--afs-grad-brand` 渐变芯片（消除琥珀/靛蓝撞色），rail 底改 `--afs-panel` 实色。`build:ui` 通过。 |
| 1 | 组件库 P0 · **Segmented / Tabs**（子导航一致性） | ✅ 已完成 | `.afs-scope`（本工程/全局默认）升级为内陷轨 + 招牌渐变激活胶囊的分段控件，并修复其 `#fff`→`--afs-on-accent` 对比债；`.afs-studio__tab` 补 hover + 过渡。其余下划线/染色 tab（`.afs-subtab`/`.afs-dock__tab`）经阶段 0 已令牌正确。纯 CSS、零 markup 改动。`build:ui` 通过。 |
| 1 | 组件库 P0 · **自定义 Select（Radix 玻璃弹层）组件 + Toolbar 迁移** | ✅ 已完成 | 引入 `@radix-ui/react-select`，新建 `components/ui/Select.tsx`（封装：`'' ↔ 哨兵` 映射绕过 Radix 空值限制，对外保持 `value:string`/`onChange(v:string)` 与原生一致；玻璃弹层 portal、键盘/ARIA 由 Radix 提供）+ `.afs-select__*` 令牌化样式（内陷触发器 + 焦点环 + 玻璃弹层 + reduced-transparency/motion 降级）。先迁移 Toolbar 文本/图像模型两处下拉（带前导图标）作端到端验证。`tsc --noEmit` + `build:ui` 通过。 |
| 1 | 组件库 P0 · Select 迁移 · **GlobalSettings（5 处，含并发非连续选项）** | ✅ 已完成 | 成片体量/画幅/对白语言/风格包/并发上限 5 个原生 select 全换 `<Select block>`；并发的非连续选项(1/2/3/4/6/8)与风格包的空值「不使用」均经哨兵正确处理；`<Select>` 新增 `block`(整宽)变体。`tsc`+`build` 通过，GlobalSettings 已无原生 `<select>`。 |
| 1 | 组件库 P0 · Select 迁移 · **ProviderSettings（2 处）** | ✅ 已完成 | 预设「快速填充」动作选择器（受控 `value=""` 始终显占位，选择即 `applyPreset`，逐项 `title=hint`）+ 类型(fal/custom-http) 换 `<Select block>`；`<Select>` 增加逐项 `title` 与 flex 行内整宽。`tsc`+`build` 通过，ProviderSettings 无原生 `<select>`。 |
| 1 | 组件库 P0 · Select 迁移 · **ProjectHome + AssetsView（2 处）** | ✅ 已完成 | ProjectHome「从模板新建」动作选择器（占位 + 逐项 `title=desc`）+ AssetsView 逐卡「移动到合集」（`size=sm`，空值=未分组经哨兵）换 `<Select>`。`tsc`+`build` 通过，两文件均无原生 `<select>`。 |
| 1 | 组件库 P0 · Select 迁移 · **Studio 批次1：模型设置弹层（5 处）** | ✅ 已完成 | StudioEditor 模型弹层的 文本模型/图像模型/视频供应商/视频模式/分辨率 5 个 `.afs-field__input` select 换 `<Select block>`（空值「未选/自动选第一个」经哨兵；视频供应商标签含 ` · model` 后缀）。`tsc`+`build` 通过。 |
| 1 | 组件库 P0 · Select 迁移 · **Studio 批次2：StudioEditor 余 7 处** | ✅ 已完成 | 顶栏 artStyle/videoRatio（保 `.afs-studio__sel` min-width）、配音音色 + 角色绑定音色（block）、分镜 景别/运镜（`size=sm` 行内）、整片转场 全换 `<Select>`。**StudioEditor 已无原生 `<select>`（12/12 完成）。** `tsc`+`build` 通过。 |
| 1 | 组件库 P0 · Select 迁移 · **StudioSettings + PromptLibrary（各 1 处）** | ✅ 已完成 | StudioSettings 按-Agent 模型选择（空值=用全局）+ PromptLibrary 片段分组选择 换 `<Select block>`。`tsc`+`build` 通过。 |
| 1 | 组件库 P0 · Select 迁移 · **Inspector 收官（5 处，含 optgroup）** | ✅ 已完成 | 为 `<Select>` 增加 `groups`（optgroup）支持 + `.afs-select__group-label`；迁移 nodeDefs 参数 select、文本/图像模型覆盖、供应商覆盖、片段插入器（按 `SNIPPET_GROUPS` 分组、过滤空组）。`tsc`+`build` 通过。 |
| 1 | ✅ **里程碑：全仓原生 `<select>` 清零** | ✅ 已完成 | 9 个文件 28+ 处原生下拉全部换成主题化玻璃弹层 `<Select>`（Toolbar/GlobalSettings/ProviderSettings/ProjectHome/AssetsView/StudioEditor/StudioSettings/PromptLibrary/Inspector）。暗色下系统白色弹层（#1 视觉断点）彻底消除；选项弹层键盘/ARIA 由 Radix 提供。 |
| 1 | 组件库 P0 · **Checkbox 组件 + 迁移** | ✅ 已完成 | 新建 `components/ui/Checkbox.tsx`（视觉隐藏原生 input + 自绘方框 + 渐变勾 + 焦点环，无新依赖）；迁移 ProviderSettings 5 个能力复选框 + StudioSettings「高级」开关。`tsc`+`build` 通过。 |
| 1 | ✅ **里程碑：全仓原生表单控件清零** | ✅ 已完成 | 原生 `<select>` 与 `<input type=checkbox>` 均已替换为主题化组件（默认供应商「单选」本就是自绘按钮）；用户诉求「原生输入框/选择框/下拉框」已全部消除。 |
| 4 | 残留琥珀清理 + emoji 全仓核验 | ✅ 已完成 | 删除孤儿 `.afs-toolbar__logo`/`__brand`；4 处真·警告态（`.afs-prov__nokey`、advbanner 条、studio `is-missing`/`sberr`）`#f59e0b`→`--afs-warning`（主题正确）；**刻意保留** `.afs-themecard__sw--light` 的琥珀（亮色主题预览色板「太阳」，非警告）。全仓核验：除 Studio/FilmNode 外无残留图标 emoji，余下 `→/←` 均为中文流程文案/键盘提示。`build:ui` 通过。 |
| 3 | 节点头重设计 + 分类色桥接（FilmNode 头/图标/选中环） | ✅ 已完成（仅构建验证） | 满铺高饱和头 + `#fff` 文字 → **低饱和渐变色头**（内联 `color-mix(in srgb, var(--afs-cat-{category}) 24%/8%, var(--afs-panel-2))`）+ 文字 `--afs-text`（明暗皆达标）+ 头底分隔线；图标/选中环用 `var(--afs-cat-*)`；锁定环 `#f59e0b`→`--afs-warning`；移除 `CATEGORY_META` 内联色依赖。**未做可视验证。** `tsc`+`build` 通过。 |
| 3 | 端口色 + NodeLibrary 分类色桥接（DOM） | ✅ 已完成（仅构建验证） | FilmNode 4 处端口 Handle `PORT_COLORS[type]`→内联 `var(--afs-type-${type})`（移除 `PORT_COLORS` 导入）；NodeLibrary 分组点 + 节点图标 `meta.color`→`var(--afs-cat-${cat})`（保留 `meta.label`）。全部主题感知。`tsc`+`build` 通过。 |
| 3 | FlowCanvas SVG 桥接（点阵/遮罩/小地图） | ✅ 已完成（仅构建验证） | `dotColor`→`--afs-grid-dot` 等值、`maskColor`→`--afs-scrim` 等值（按 theme 分支）；`miniMapColor` 移入组件，用 `getComputedStyle` 读 `--afs-cat-*`（`useMemo([theme])` 随主题重算），移除 `CATEGORY_META` 导入。`tsc`+`build` 通过。 |
| 3 | ✅ **里程碑：内联注入色全部令牌化** | ✅ 已完成 | 节点头/图标/选中环/端口/库分类点/画布点阵·遮罩·小地图——全仓不再有硬编码分类/端口色内联，明暗主题切换全程一致（含 React Flow SVG 经 getComputedStyle 桥接）。 |
| 4 | 遗留 `#fff`-on-accent 对比债清零 | ✅ 已完成 | 实测仅 3 处真·文字落在 `var(--afs-accent)` 实色上：节点属性面板「运行此节点」按钮、灯箱/输入发送按钮、Studio 用户消息气泡——全部 `#fff`→`--afs-on-accent`（暗色 accent 偏亮，深墨文字才达标）。`.afs-rail__item.is-active::before` 为指示条无文字。`build:ui` 通过。 |
| 2 | 高频原生控件屏 · **Studio 表单控件令牌化** | ✅ 已完成 | 文件末尾追加 `.afs-studio select`（去 OS 箭头 + 自绘 chevron + 焦点环）与 `.afs-studio input/textarea::placeholder`（`--afs-text-dim`），一次性覆盖 StudioEditor 全部 12+ 原生 select 的触发器外观（源序置末以胜过各 `.afs-studio__* select` 的 `background` 简写）；刻意不动无缝标题与 chip 内联输入。纯 CSS、零依赖。`build:ui` 通过。 |
| 2 | 高频原生控件屏 · **Studio emoji → Lucide** | ✅ 已完成 | StudioEditor 的图标 emoji 全部替换：🛠→`Wrench`、🎬→`Clapperboard`（两个 toggle 补 `aria-pressed`+`aria-label`+激活态）、⚠→`AlertCircle`(warning 色)、✓(完成/当选)→`Check`(success 色)；🎙 在原生 `<option>` 内无法放图标，按设计去除前缀。`tsc --noEmit` + `build:ui` 均通过（markup 改动用 tsc 校验导入）。 |
| 2/3 | 节点/浮层 emoji → Lucide（**FilmNode**） | ✅ 已完成 | FilmNode 失败瓦片 `✗`→`<X>`（红，`aria-label`）、媒体帧播放 `▶`→`<Play fill>`；`×{count}` 计数标签为字面文本保留。LightboxHost 经核查无图标 emoji（`←/→` 仅为 title 内键盘提示）。`tsc --noEmit` + `build:ui` 通过。 |
| 2 | 高频原生控件屏 · 余下：设置（ProviderSettings 14 字段 / 原生 checkbox / radio）→ Inspector 重塑 | ⏳ 待办 | ProviderSettings 原生 checkbox/radio 需 Checkbox/Radio 组件（markup 层）。 |
| 3 | 灯箱 + ResultViewer chrome 收尾 | ✅ 已完成（仅构建验证） | 灯箱恒为暗场（白控件保留正确），但：`is-on` 由随机蓝 `#3b82f6`→品牌靛蓝 `#6d7cff`；关闭/导航/连看控件加 `1px` 细描边（媒体上仍可见，回应审查）；ResultViewer 面板圆角/阴影令牌化（`--afs-r-xl`/`--afs-elev-4`，**保留其刻意不加 backdrop-filter 的性能决定**）。`build` 通过。 |
| 4 | 状态色速赢令牌化（节点状态点/底部状态文字/进度条/供应商key） | ✅ 已完成 | 节点状态点 5 色 → `--afs-text-dim/--afs-warning/--afs-info/--afs-success/--afs-danger`；底部状态文字 3 色 → 同语义令牌；进度条轨道 → `--afs-surface-sunken`、填充 → `--afs-grad-progress`；`.afs-prov__key` `#4ade80`→`--afs-success`。修复这些「亮色下保持暗调」的破相。`build` 通过。 |
| — | **完整性审计（8-agent 工作流）** | 📋 已出清单 | 核验出剩余 **107 项（高29/中37/低41）**。关键缺口：① `.afs-glass/.afs-glow` 工具类**应用到 0 元素**（仅 Select 弹层是玻璃）；② 多数**逐屏结构重设计未做**（ProjectHome 英雄卡/Studio 玻璃顶栏+三栏/设置竖 Tabs/Inspector 抽屉）；③ ~25 处硬编码 danger/状态色；④ 缺 Switch/统一 Input/Number Stepper/in-app 确认弹窗；⑤ 无 skeleton/shimmer/breathing（令牌已定义、`@keyframes` 缺）。详见审计输出。后续按 A速赢→B玻璃→C逐屏 推进。 |
| B | **玻璃落地 · 浮动 Inspector 抽屉** | ✅ 已完成（仅构建验证） | `.afs-app__right--float`（已浮于画布上）改玻璃强配方：`--afs-glass-fill-strong` + `backdrop-filter` 模糊背后画布 + `--afs-glass-border` + `--afs-elev-4`/`--afs-glass-highlight` + `--afs-dur-overlay`/`emphasized` 入场；带 `@supports not(backdrop-filter)` 与 `prefers-reduced-transparency` 降级。**这是第一处真正的玻璃 chrome**（此前仅 Select 弹层）。`build` 通过。 |
| B | 玻璃落地 · Studio 设置抽屉 + Studio 模型弹层 + 灯箱信息面板 | ✅ 已完成（仅构建验证） | 三个已浮于内容之上的浮层改玻璃强配方（`--afs-glass-fill-strong` + 模糊 + `--afs-glass-border` + `--afs-elev-3/4`/highlight），Studio 抽屉遮罩 `rgba(0,0,0,.45)`→`--afs-scrim`；共用一段 `@supports`/`reduced-transparency` 降级。`build` 通过。 |
| B/3 | **画布 Toolbar chrome 升级**（玻璃条 + 品牌芯片 + 状态点 + 保存 spinner） | ✅ 已完成（仅构建验证） | `.afs-toolbar` 改玻璃强配方（半透明 + `backdrop-filter` + `--afs-glass-border` + `--afs-glass-highlight` + 降级）；新增 `.afs-toolbar__brandmark`（`--afs-grad-brand` 渐变芯片，Clapperboard）补回左组品牌；状态文字加 `.afs-toolbar__statusdot`（saved=success/dirty=warning/saving=info）+ 保存中 `Loader2` 旋转。注：工具栏未重叠画布，磨砂效果较弱（真磨砂需画布延伸至栏下的布局改动，仍留作结构步骤）。`tsc`+`build` 通过。 |
| B/3 | **Studio re-skin 批**：顶栏玻璃 + 阶段 Tabs 渐变下划线 + cand-badge 对比 | ✅ 已完成（仅构建验证） | `.afs-studio__topbar` 玻璃强配方 + 降级（第 7 处玻璃 chrome）；`.afs-studio__tab.is-active` 由实色边框下划线改 `::after` 的 `--afs-grad-brand` 渐变下划线（内缩 8px）；`.afs-studio__cand-badge` `#fff`→`--afs-on-accent`。**On-media 暗 pill（sbnum/imgthumb 等）刻意保留固定深色**——白字叠媒体需恒定深底，不应随主题变浅。`build` 通过。 |
| 3 | 招牌渐变主操作 CTA | ✅ 已完成（仅构建验证） | `.afs-inspector__run` 实色 accent → `--afs-grad-accent` 渐变；Studio 四个主操作（一键成片/合成成片/生成并设为关键帧/Agent 发送）`--primary`→`--gradient`。**暂不加 `.afs-glow` 辉光**：辉光是大尺寸 blur ::after，在滚动面板内易被裁切，盲改风险高，留待可视验证。`tsc`+`build` 通过。 |
| 4 | 速赢清债 + **Switch 原子** | ✅ 已完成 | Inspector 节点头/徽标 = 全仓最后一处内联分类色 → `var(--afs-cat-*)`（**内联分类/端口色 100% 桥接**）；OptimizableField AI 按钮/chip/retry hover/prov-ok/audio 占位 5 处暗色硬编码 → 令牌；NodeLibrary 行 + 项目卡封面键盘可达（`role=button`/`tabIndex`/Enter·Space）；新建 `components/ui/Switch.tsx`（role=switch + 渐变轨 + 弹簧拇指），StudioSettings「高级」由 Checkbox→Switch。`tsc`+`build` 通过。 |
| — | **二次完整性审计**：剩余约 24 项 | 📋 已出清单 | 三类大块仍在：① 6 屏结构重写；② 缺失原子（Number Stepper/Dropdown/Tooltip/Toast/Popover/Combobox + **app 内 Confirm 弹窗替换 14 处 `window.confirm`**，需同步→异步）；③ 动效（skeleton/shimmer/breathing keyframes 缺；`.afs-glow` 未接 CTA，盲改易裁切）。均建议**有可视验证再做**。 |
| 4 | 打磨：微交互 / 动效 / skeleton / 空状态 + 全量明暗与 a11y 回归 | ⏳ 待办 | — |

---

## 目录

- 0. 摘要（Executive Summary）
- 1. 现状诊断（为什么要改）
- 2. 设计语言：Aurora Glass
- 3. 设计令牌（Design Tokens）
- 4. CSS 变量底座（可直接粘贴）
- 5. 组件库（统一替换原生控件与 emoji）
- 6. 逐屏重设计（10 个界面）
- 7. 可访问性与降级（Accessibility & Fallbacks）
- 8. 实施风险与注意事项
- 9. 实施路线图（分阶段落地）
- 10. 参考来源（业界优秀设计）
- 附录：本方案的产出方法

---

## 0. 摘要（Executive Summary）

当前插件 UI 的核心问题是**不统一、视觉传统、且与「AI 影视创作工具」的气质不匹配**：大量原生 `<select>`/`<input>`/原生下拉在暗色下渲染成刺眼的系统白色弹窗、emoji 当图标、内联硬编码颜色导致亮色模式不可靠、按钮有多套互相冲突的定义、主操作（运行）与次操作（保存）无法区分。

本方案给出一套名为 **Aurora Glass** 的完整设计系统来根治这些问题，要点：

- **一套语义令牌，双主题不共享**：颜色 / 玻璃 / 边框 / 层级 / 强调色 / 阴影按亮暗各自调校（玻璃在亮色下也能成立），用 CSS 自定义属性切换，杜绝「暗色专用硬编码色」。保留全部 10 个旧 `--afs-*` 令牌名（重新指向新色阶），让 JS 注入的节点头/徽标/端口色继续工作。
- **一条招牌渐变，克制使用**：indigo→violet→azure 极光渐变（OKLCH 插值，避免发灰）只出现在品牌、主操作、激活/选中/运行态，绝不铺满每个面板。
- **玻璃只用于浮层 chrome，内容区一律实色**：工具栏 / 下拉 / 菜单 / 命令面板 / 灯箱控件 / 生成中卡片用玻璃；节点体 / 时间线 / 数据卡 / 长文本保持近不透明，保证可读性与画布平移缩放性能。
- **用 42 个组件**（Form & input controls + Containers, overlays & feedback）统一替换所有原生控件，并把全部 emoji 映射到 Lucide 线性图标。所有自定义控件以 headless 行为原语（Radix / React Aria）实现，**只换皮、不改语义**，保持原有 `value/onChange` 与宿主调用 1:1。
- **可访问性内建**：正文 ≥4.5:1、UI/图标 ≥3:1、焦点环 ≥3:1；为 `prefers-reduced-transparency` / `prefers-reduced-motion` / `forced-colors` / 不支持 `backdrop-filter` 提供完整降级。

---

## 1. 现状诊断（为什么要改）

通读全部 UI 源码（约 50 个 `.tsx` + 3690 行手写 `styles.css`，两套子应用）后，量化的「视觉债」如下：

| 问题 | 量级 | 重灾区 |
| --- | --- | --- |
| 原生 `<select>`（暗色下渲染系统白色弹窗） | **30 处 / 9 文件** | `StudioEditor`(12)、`Inspector`(5)、`GlobalSettings`(5)、`Toolbar`(2)、`ProviderSettings`(2) |
| 原生 `<input>`（无统一聚焦/错误态） | **51 处 / 14 文件** | `ProviderSettings`(14)、`StudioEditor`(13)、`Inspector`(5)、`GlobalSettings`(5)、`AssetsView`(5) |
| emoji 当图标（🎨🛠🎬🎙⚠✓✗×→▶ 等） | **25+ 处 / 11 文件** | `StudioEditor`(9)、`FilmNode`(5)、`LightboxHost`(3) |
| 内联 `style={{}}` 硬编码（无法被主题令牌重着色） | **35 处 / 6 文件** | `FilmNode`(22)、`GlobalSettings`(4)、`AssetsView`(3) |

其余结构性问题（来自各屏诊断）：

- `.afs-btn` 有两套互相冲突的定义（`styles.css:182` 与 `:3398`），且 运行 与 保存 共用同一 accent 填充，主/次操作不可分。
- 品牌色双轨：品牌标记用硬编码琥珀 `#f59e0b`，而所有激活/聚焦用靛蓝 `--afs-accent`，撞色。
- 节点头是**满铺高饱和分类色**（视频用红色，像报错），`#fff` 硬编码文字，2018 年开发者工具既视感。
- 亮色模式不可靠：存在被引用却**未定义**的令牌（如 `--afs-text-dim`），回退成深灰，在白底上不可读。
- 灯箱 / 控件大量 `rgba(255,255,255,…)` 白底硬编码，完全不响应 `html.light`。
- 两套并存的字段系统（`afs-field` 堆叠式 与 `afs-form__row` 内联式）+ 多种按钮写法，整体不统一。

---

## 2. 设计语言：Aurora Glass

**概念陈述（Concept）**

> Aurora Glass is an AI-native, gradient-and-glass design language for a dense professional film/video workbench. Its thesis: glass is reserved for floating CHROME (toolbars, inspectors, popovers, lightbox controls, the agent rail, generation-in-progress cards) layered over a calm, deliberately-static aurora gradient backdrop; everything text-dense or canvas-heavy (node bodies, timeline tracks, data cards) stays on near-opaque, legible surfaces that only LOOK glassy via gradient headers, hairline borders, and layered elevation. A single indigo→violet→azure signature gradient (interpolated in OKLCH so it never goes muddy-gray) carries brand and AI-action identity; it appears only on active/selected/primary affordances, never on idle controls. The system ships first-class LIGHT and DARK themes as theme-asymmetric tokens — glass fill, border direction, elevation mechanism, accent saturation, and shadow are all re-tuned per theme, never shared — and degrades gracefully under prefers-reduced-transparency, prefers-reduced-motion, forced-colors, and no-backdrop-filter support. It supersedes the legacy flat --afs-* palette while keeping all 10 legacy token names alive (so JS-injected node-header/badge/dot colors keep working) and the html.light toggle mechanism intact. The result reads as premium, modern, generative-AI, and cohesive — disciplined like Linear's ProKit, not gimmicky — and stays sharp at high information density.

**设计原则（Principles）**

1. Glass on chrome, solids under content. backdrop-filter only on the handful of static floating surfaces (toolbar, inspector, popover, command palette, agent rail, lightbox controls, in-progress cards). Node bodies, timeline tracks, tables, code, long text, and data cards stay near-opaque for legibility and pan/zoom performance.
2. Theme-asymmetric glass. Light and dark never share glass values: light glass uses a white tint, a darker hairline edge, and leans on shadow for separation; dark glass uses a deep blue-black tint, a faint white hairline, and conveys elevation through lighter surfaces, not shadow.
3. One signature gradient, used sparingly. The indigo→violet→azure OKLCH gradient marks brand, primary actions, and active/selected/running states only — never idle controls, never every panel. Gradients interpolate in OKLCH with an sRGB fallback so there is no gray dead-zone.
4. Density signals capability. 8px spacing grid, compact 28–32px control rows, 11–14px UI type, tight 6–8px control radii. Breathing room is spent on asset grids and empty states, not inspectors. Reserve 14–16px radii for floating glass cards only.
5. Restraint over decoration. Calm low-chroma chrome lets the user's media be the brightest thing on screen; the aurora backdrop is a static, low-opacity garnish (the substrate the glass blurs), never animated wallpaper behind dense work.
6. Tokens are the single source of truth. Every surface, text, border, accent step, status hue, glass layer, shadow, radius, duration, and easing is a semantic CSS custom property swapped per theme — no per-component theme branching, no hardcoded dark-only hexes. The legacy --afs-* names are preserved and re-pointed at the new ramp.
7. Accessibility is built-in, not bolted-on. Body text ≥4.5:1 and UI/icons ≥3:1 measured against the worst-case blurred backdrop; alpha is flattened before contrast is trusted; focus-visible rings ≥3:1 and ≥2px; full fallbacks for reduced-transparency, reduced-motion, forced-colors, and unsupported backdrop-filter.
8. Two AI states, never one spinner. Distinguish PROCESSING (breathing/skeleton, no output yet) from GENERATING/STREAMING (shimmer sweep on in-flight text, determinate progress bar for media renders) with a 1s minimum loader and specific copy.

---

## 3. 设计令牌（Design Tokens）

所有令牌为语义化 CSS 自定义属性，按主题整体替换；组件只引用令牌名，不出现裸色值。下表为**暗色（默认 `:root`）/ 亮色（`html.light`）**对照。

### 3.1 颜色 · 暗色（Dark）

| Token | Value | 用途 |
| --- | --- | --- |
| `--afs-bg` | `#0a0e16` | App canvas / page base. Near-black-blue, never pure #000, so glass + aurora gradient have something to blur and the elevation ramp reads. |
| `--afs-surface-sunken` | `#0d121a` | Inset wells: timeline track lanes, input field interiors, node body inner surface. |
| `--afs-panel` | `#11161f` | Primary opaque panel surface (dock, inspector body, toolbar base). ~5–7% white-overlay elevation step. |
| `--afs-panel-2` | `#161c28` | Raised cards / panel headers / node body alt. Legacy token re-pointed (was equal to bg); now a true second elevation step. |
| `--afs-surface-3` | `#1e2533` | Popovers, menus, dropdown bodies (the opaque base under glass). ~12% overlay step. |
| `--afs-node-bg` | `#11161f` | Node card BODY fill — solid/near-opaque, NOT glass, for legibility and canvas perf. |
| `--afs-border` | `#252d3d` | Default 1px hairline divider/border. Low-contrast so the dock doesn't read as a grid of boxes. |
| `--afs-border-strong` | `#37415a` | Stronger separators: ruler/track-header dividers, focused field outer edge, hover borders. |
| `--afs-text` | `#e8eaf0` | Primary text/icon high-emphasis (~87% white). Off-white, never pure #fff, to avoid halation. |
| `--afs-muted` | `#9aa3b5` | Secondary text, labels, inactive tab/segment text, port labels (~60% emphasis). |
| `--afs-text-dim` | `#6b7383` | Tertiary/disabled/placeholder (~38% emphasis). DEFINES the previously-undefined token that broke the studio block in light mode. |
| `--afs-hover` | `#1c2433` | Hover fill for buttons, rail items, list rows, segmented track. |
| `--afs-dot` | `rgba(255,255,255,0.07)` | Canvas dot-grid color. Very low alpha on dark or the field looks like static. |
| `--afs-accent` | `#8b9bff` | Brand/primary accent SOLID fallback — deliberately lighter + desaturated for dark so it doesn't vibrate on dark surfaces. Legacy token re-pointed from #6366f1. |
| `--afs-accent-strong` | `#6d7cff` | Stronger accent for borders/fills where more saturation is wanted on dark. |
| `--afs-on-accent` | `#0a0e16` | Text/icon color placed ON the accent gradient fill (dark ink reads on the luminous dark-theme accent). |
| `--afs-ring` | `#9db2ff` | Focus-visible ring color; lighter accent so it clears 3:1 on dark surfaces. |
| `--afs-success` | `#34d399` | Done / has-key / success status (emerald, lightened for dark). |
| `--afs-warning` | `#fbbf24` | Queued / no-key / model-incomplete warning (amber, lightened for dark). |
| `--afs-danger` | `#f87171` | Error / failed / delete-intent (red, lightened for dark legibility). |
| `--afs-info` | `#60a5fa` | Running / informational status (azure). |
| `--afs-type-image` | `#a78bfa` | Port/edge/badge hue for image-frame data (violet). |
| `--afs-type-video` | `#22d3ee` | Port/edge/badge hue for video-clip data (cyan). |
| `--afs-type-audio` | `#fbbf24` | Port/edge/badge hue for audio data (amber). |
| `--afs-type-text` | `#34d399` | Port/edge/badge hue for text-prompt data (emerald). |
| `--afs-type-json` | `#facc15` | Port/edge/badge hue for json/structured data (yellow). |
| `--afs-type-any` | `#9aa3b5` | Port/edge hue for untyped/any connections (slate). |
| `--afs-cat-input` | `#94a3b8` | Node category color: input (slate). Consumed inline by node headers/library dots/minimap — kept compatible. |
| `--afs-cat-text` | `#60a5fa` | Node category color: text (azure). |
| `--afs-cat-image` | `#a78bfa` | Node category color: image (violet). |
| `--afs-cat-video` | `#22d3ee` | Node category color: video (cyan). |
| `--afs-cat-audio` | `#2dd4bf` | Node category color: audio (teal). |
| `--afs-cat-output` | `#34d399` | Node category color: output (emerald). |

### 3.2 颜色 · 亮色（Light）

| Token | Value | 用途 |
| --- | --- | --- |
| `--afs-bg` | `#eef1f6` | App canvas / page base. Soft cool gray; gives glass a bright substrate without pure white glare. |
| `--afs-surface-sunken` | `#e6eaf1` | Inset wells: timeline lanes, input interiors. Darker than base so content reads as inset. |
| `--afs-panel` | `#ffffff` | Primary opaque panel surface (dock, inspector, toolbar base). |
| `--afs-panel-2` | `#f8fafc` | Raised cards / panel headers / node body alt. |
| `--afs-surface-3` | `#ffffff` | Popovers, menus, dropdown bodies — opaque base under glass; gets a real shadow in light mode for elevation. |
| `--afs-node-bg` | `#ffffff` | Node card BODY fill — solid/near-opaque for legibility. |
| `--afs-border` | `#e2e8f0` | Default 1px hairline border/divider. |
| `--afs-border-strong` | `#cbd2dd` | Stronger separators, hover borders, focused field outer edge. |
| `--afs-text` | `#16203a` | Primary text/icon high-emphasis (~87% black). Slightly blue-tinted ink, not pure #000. |
| `--afs-muted` | `#5b6678` | Secondary text, labels, inactive segment text, port labels (~60%). |
| `--afs-text-dim` | `#8a93a4` | Tertiary/disabled/placeholder (~45% on light). Now properly themed (was hardcoded dark-gray fallback). |
| `--afs-hover` | `#eef1f7` | Hover fill for buttons, rail items, list rows. |
| `--afs-dot` | `rgba(71,85,105,0.32)` | Canvas dot-grid color. Higher alpha than dark; visible on bright canvas without dominating. |
| `--afs-accent` | `#4f46e5` | Brand/primary accent SOLID fallback — full-chroma indigo for light. Legacy token, now theme-tuned. |
| `--afs-accent-strong` | `#4338ca` | Stronger/darker accent for active borders and pressed states on light. |
| `--afs-on-accent` | `#ffffff` | Text/icon color placed ON the accent gradient fill (white reads on the saturated light-theme accent). |
| `--afs-ring` | `#4f46e5` | Focus-visible ring color; ≥3:1 vs light surfaces. |
| `--afs-success` | `#059669` | Done / success status (emerald, darkened for contrast on light). |
| `--afs-warning` | `#b45309` | Queued / warning status (amber, darkened for ≥4.5:1 text contrast on light). |
| `--afs-danger` | `#dc2626` | Error / failed / delete-intent (red, full-strength for light). |
| `--afs-info` | `#2563eb` | Running / informational status (azure). |
| `--afs-type-image` | `#7c3aed` | Port/edge/badge hue for image data (violet). |
| `--afs-type-video` | `#0891b2` | Port/edge/badge hue for video data (cyan, darkened for light). |
| `--afs-type-audio` | `#b45309` | Port/edge/badge hue for audio data (amber). |
| `--afs-type-text` | `#059669` | Port/edge/badge hue for text data (emerald). |
| `--afs-type-json` | `#ca8a04` | Port/edge/badge hue for json data (yellow, darkened). |
| `--afs-type-any` | `#64748b` | Port/edge hue for any/untyped (slate). |
| `--afs-cat-input` | `#64748b` | Node category color: input (slate). |
| `--afs-cat-text` | `#2563eb` | Node category color: text (azure). |
| `--afs-cat-image` | `#7c3aed` | Node category color: image (violet). |
| `--afs-cat-video` | `#0891b2` | Node category color: video (cyan). |
| `--afs-cat-audio` | `#0d9488` | Node category color: audio (teal). |
| `--afs-cat-output` | `#059669` | Node category color: output (emerald). |

### 3.3 渐变（Gradients）

招牌渐变 indigo→violet→azure，OKLCH 插值。**只用于品牌 / 主操作 / 激活·选中·运行态。**

**`--afs-grad-brand`** — DARK signature aurora gradient (indigo→violet→azure). Brand mark, primary CTA fill, active nav indicator. Desaturated stops so it doesn't vibrate on dark. Add 'in oklch' when browser support allows.
```css
linear-gradient(135deg, #6d7cff 0%, #9d6bff 50%, #4fd0e0 100%)
```
**`--afs-grad-brand (light)`** — LIGHT signature gradient — full-chroma stops. Same hue path, higher saturation for bright surfaces.
```css
linear-gradient(135deg, #5b54ff 0%, #8b3dff 50%, #06b6d4 100%)
```
**`--afs-grad-accent`** — Two-stop accent gradient reused on every on/selected affordance: switch-on track, slider range fill, checkbox check, segmented active pill, primary button. Theme-aware via tokens.
```css
linear-gradient(135deg, var(--afs-accent-strong), var(--afs-accent))
```
**`--afs-grad-header`** — Node-card header tint, driven by the per-category --cat color injected inline. Dark mix percentages shown; light uses 18%/6% mixes for subtler tint.
```css
linear-gradient(135deg, color-mix(in srgb, var(--cat) 28%, var(--afs-panel-2)), color-mix(in srgb, var(--cat) 10%, var(--afs-panel-2)))
```
**`--afs-grad-progress`** — Determinate render/progress bar fill for non-text AI artifacts (video render, image board, export). Pair with a moving sheen overlay.
```css
linear-gradient(90deg, #6d7cff, #4fd0e0)
```
**`--afs-aurora`** — DARK ambient aurora backdrop — a single STATIC, low-opacity multi-orb layer behind the canvas/empty states that gives the glass chrome something to blur and saturate. Never animated, never full-bleed behind dense work.
```css
radial-gradient(40% 40% at 20% 20%, oklch(0.55 0.20 286 / .40) 0, transparent 60%), radial-gradient(38% 38% at 80% 25%, oklch(0.55 0.19 230 / .34) 0, transparent 60%), radial-gradient(45% 45% at 65% 85%, oklch(0.50 0.22 330 / .30) 0, transparent 60%)
```
**`--afs-aurora (light)`** — LIGHT ambient aurora — soft pastel blobs on the cool-gray base.
```css
radial-gradient(40% 40% at 20% 20%, oklch(0.86 0.11 286 / .55) 0, transparent 60%), radial-gradient(38% 38% at 80% 25%, oklch(0.88 0.10 230 / .50) 0, transparent 60%), radial-gradient(45% 45% at 65% 85%, oklch(0.90 0.09 330 / .45) 0, transparent 60%)
```
**`--afs-grad-edge-spec`** — Specular lit-glass edge for ::before gradient-border (mask-composite: exclude). DARK lowers the top stop to 0.5 so the edge doesn't blow out. Use on the active/selected glass panel and hero cards only.
```css
linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.15) 40%, rgba(255,255,255,0) 70%)
```

### 3.4 玻璃层（Glass Layers）

玻璃是**亮暗不对称**的材质，两套主题不共享数值。以下为各玻璃配方的亮/暗 CSS。

#### Glass — chrome / popover (the base recipe)
Floating chrome that sits OVER content: top toolbar, dropdown/select popover, context menu, command palette, agent rail, lightbox info panel. NOT under body-dense text or on nodes/timeline.

*Light:*
```css
background: rgba(255,255,255,0.62); -webkit-backdrop-filter: blur(16px) saturate(180%); backdrop-filter: blur(16px) saturate(180%); border: 1px solid rgba(255,255,255,0.55); border-radius: 16px; box-shadow: 0 8px 32px rgba(16,24,40,0.16), inset 0 1px 0 rgba(255,255,255,0.65);
```
*Dark:*
```css
background: rgba(20,24,38,0.60); -webkit-backdrop-filter: blur(16px) saturate(160%); backdrop-filter: blur(16px) saturate(160%); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.10);
```

#### Glass — modal / sheet (heavier, text-bearing)
Modal/drawer surfaces and lightbox panels that carry real body text. Higher fill opacity (≥55%) so worst-case text contrast holds ≥4.5:1.

*Light:*
```css
background: rgba(255,255,255,0.86); -webkit-backdrop-filter: blur(20px) saturate(170%); backdrop-filter: blur(20px) saturate(170%); border: 1px solid rgba(15,23,42,0.08); border-radius: 16px; box-shadow: 0 16px 48px rgba(16,24,40,0.22);
```
*Dark:*
```css
background: rgba(17,22,34,0.80); -webkit-backdrop-filter: blur(20px) saturate(150%); backdrop-filter: blur(20px) saturate(150%); border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; box-shadow: 0 16px 48px rgba(0,0,0,0.60);
```

#### Glass — generation-in-progress card
Transient 'AI is working' node/result overlay. Glass is acceptable here because it is short-lived and few-at-a-time. Pair with the accent glow + shimmer.

*Light:*
```css
background: rgba(255,255,255,0.55); backdrop-filter: blur(14px) saturate(170%); border: 1px solid color-mix(in srgb, var(--afs-accent) 40%, rgba(255,255,255,0.5)); box-shadow: 0 8px 28px rgba(79,70,229,0.18);
```
*Dark:*
```css
background: rgba(22,26,42,0.62); backdrop-filter: blur(14px) saturate(150%); border: 1px solid color-mix(in srgb, var(--afs-accent) 35%, rgba(255,255,255,0.08)); box-shadow: 0 8px 28px rgba(109,124,255,0.22);
```

#### Glass — scrim behind text on media
When glass sits over uncontrolled media (image/video canvas, thumbnails) insert a semi-opaque scrim between backdrop and content so text stays ≥4.5:1 regardless of what is behind.

*Light:*
```css
::before { background: rgba(0,0,0,0.30); } /* light-text-on-media variant; for dark-text use rgba(255,255,255,0.55) */
```
*Dark:*
```css
::before { background: rgba(0,0,0,0.42); }
```

#### Glass — fallback (always shipped)
Progressive-enhancement guards wrapping every glass class: no-backdrop-filter support, reduced-transparency, and forced-colors. Non-negotiable.

*Light:*
```css
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){ .afs-glass{ background:rgba(255,255,255,0.95);} } @media (prefers-reduced-transparency:reduce){ .afs-glass{ backdrop-filter:none; -webkit-backdrop-filter:none; background:var(--afs-surface-3);} } @media (forced-colors:active){ .afs-glass{ border:1px solid CanvasText; background:Canvas; backdrop-filter:none;} }
```
*Dark:*
```css
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){ html:not(.light) .afs-glass{ background:rgba(17,22,34,0.95);} } @media (prefers-reduced-transparency:reduce){ html:not(.light) .afs-glass{ backdrop-filter:none; background:var(--afs-surface-3);} }
```

### 3.5 字体 / 间距 / 圆角 / 层级 / 动效

**字体（Typography）**

| 角色 | 字体 | 字号 | 字重 | 行高 |
| --- | --- | --- | --- | --- |
| Display / empty-state heading | Inter, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif | 22px | 600 | 1.3 |
| Section / panel title | Inter, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif | 16px | 600 | 1.35 |
| Body / default UI | Inter, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif | 13px | 400 | 1.5 |
| Button / control label | Inter, -apple-system, 'Segoe UI', sans-serif | 13px | 600 | 1 |
| Field label / secondary | Inter, -apple-system, 'Segoe UI', sans-serif | 12px | 500 | 1.4 |
| Micro-label (uppercase tracked) | Inter, -apple-system, 'Segoe UI', sans-serif | 11px | 600 | 1 |
| Caption / meta / chip | Inter, -apple-system, 'Segoe UI', sans-serif | 11px | 500 | 1.3 |
| Code / prompt textarea / JSON / snippet | ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace | 12px | 400 | 1.5 |
| Numeric (tabular, timeline/duration/counts) | Inter, ui-monospace, monospace; font-variant-numeric: tabular-nums | 12px | 500 | 1 |

**间距（Spacing，8px 栅格）**：`--afs-sp-0: 0`、`--afs-sp-1: 2px`、`--afs-sp-2: 4px`、`--afs-sp-3: 6px`、`--afs-sp-4: 8px`、`--afs-sp-5: 12px`、`--afs-sp-6: 16px`、`--afs-sp-7: 20px`、`--afs-sp-8: 24px`、`--afs-sp-9: 32px`、`--afs-sp-10: 48px`、`--afs-sp-11: 64px`

**圆角（Radii）**：
- `--afs-r-xs: 4px (chips, tiny tags, inner controls)`
- `--afs-r-sm: 6px (inputs, selects, mini buttons, segmented items)`
- `--afs-r-md: 8px (buttons, cards, dock items)`
- `--afs-r-lg: 12px (node cards, popovers, panels)`
- `--afs-r-xl: 16px (modals, floating glass cards, lightbox panels)`
- `--afs-r-pill: 999px (switches, search field, status pills, count pills, toolbar pill)`
- `--afs-r-round: 50% (radio dots, port handles, avatar, status dots)`

**层级 / 阴影（Elevation）**

| Token | CSS | 用途 |
| --- | --- | --- |
| `--afs-elev-0 (flat / sunken)` | `none` | Canvas base, timeline track lanes, inset fields. In dark, depth comes from surface lightness, not shadow. |
| `--afs-elev-1 (resting card)` | `light: 0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10) \| dark: 0 1px 2px rgba(0,0,0,0.40)` | Resting node cards, asset cards, list rows. Dark mostly relies on the panel-2 lightness step plus a faint contact shadow. |
| `--afs-elev-2 (raised panel)` | `light: 0 4px 12px rgba(16,24,40,0.10) \| dark: 0 4px 14px rgba(0,0,0,0.45)` | Inspector/dock panels, raised cards on hover. |
| `--afs-elev-3 (popover / menu)` | `light: 0 8px 24px rgba(16,24,40,0.14) \| dark: 0 8px 24px rgba(0,0,0,0.50)` | Dropdowns, context menus, select popovers, floating toolbar. |
| `--afs-elev-4 (modal / drawer)` | `light: 0 16px 48px rgba(16,24,40,0.22) \| dark: 0 16px 48px rgba(0,0,0,0.60)` | Modals, drawers, lightbox panels — the highest tier over the scrim. |
| `--afs-glow-accent (AI action aura)` | `separate blurred ::after layer, NOT box-shadow: inset:-6px; background: var(--afs-grad-accent); filter: blur(28px); opacity: light .45 / dark .65; z-index:-1; animate opacity only on hover/running` | Primary Generate button, active/running node, AI 'working' affordance. The signature emissive accent glow. |
| `--afs-glass-highlight (inset top sheen)` | `light: inset 0 1px 0 rgba(255,255,255,0.65) \| dark: inset 0 1px 0 rgba(255,255,255,0.10)` | The cheap inset top-edge highlight that makes a glass panel read as a real pane of glass. |

**动效（Motion）** —— 仅动画 `opacity`/`transform`，绝不动 `backdrop-filter` 模糊半径或 `box-shadow`（保护多节点画布的 INP）。

| Token | 时长 | 缓动 | 用途 |
| --- | --- | --- | --- |
| `--afs-dur-micro` | 120ms | var(--afs-ease-standard) | Hover, press, toggle, icon swap. Press feedback = transform: scale(0.97). |
| `--afs-dur-ui` | 180ms | var(--afs-ease-standard) | Tooltips, dropdowns, popovers, segmented pill slide, tab indicator. |
| `--afs-dur-overlay` | 260ms | var(--afs-ease-emphasized) | Modals, drawers, sheets, lightbox enter. Hard cap UI motion ≈300ms. |
| `--afs-dur-exit` | 140ms | var(--afs-ease-standard) | Exit animations — run ~20% faster than the matching entrance. |
| `--afs-ease-standard` | — | cubic-bezier(0.215, 0.61, 0.355, 1) | ease-out for elements entering AND exiting; the default responsive feel. |
| `--afs-ease-emphasized` | — | cubic-bezier(0.23, 1, 0.32, 1) | ease-out-quint for prominent/hero transitions (modal, primary reveal). |
| `--afs-ease-move` | — | cubic-bezier(0.645, 0.045, 0.355, 1) | ease-in-out for elements moving/morphing while already on screen (segmented pill, reorder). |
| `--afs-ease-spring` | 500ms | spring(bounce 0.2) approximated as cubic-bezier(0.34,1.4,0.64,1) | Direct-manipulation only: node drag/drop, switch thumb. Keep bounce subtle. |
| `--afs-dur-shimmer` | 2000ms | linear (infinite) | Streaming-text gradient sweep and skeleton shimmer — linear only because it loops. Stop the instant the token settles. |
| `--afs-dur-breathe` | 1800ms | cubic-bezier(0.45,0,0.55,1) (infinite) | Processing/'thinking' avatar or orb breathing (opacity+scale) before first output token. |
| `--afs-loader-min` | 1000ms | — | Minimum display time for any loader/skeleton — never flash a loading state under 1s. |

### 3.6 图标系统 + emoji 替换映射

**图标库**：Lucide (lucide-react) as the single base set; Phosphor Fill/Duotone borrowed ONLY for explicit stateful toggle pairs (active vs inactive)

**风格**：Outline, 24px viewBox, stroke-width 1.5 rendered at 18–20px inside 36–40px targets, stroke=currentColor (inherits text/icon tokens for free across themes). Pass absoluteStrokeWidth when scaling >24px. One stroke width, one corner radius, one end-cap across the whole set. Decorative icons get aria-hidden; icon-only buttons put aria-label on the BUTTON. Route every glyph through one iconMap so swaps are one-file.

**emoji → 图标映射**（全部 emoji 收敛到一个 `iconMap`，一处替换、全局生效）：

| Emoji | 含义 | 替换 |
| --- | --- | --- |
| 🎨 | Global project style / 全局设定 panel (toolbar) | Palette (Lucide) — already the de-facto stand-in; formalize it |
| 🛠 | Experimental native tool-calling loop toggle (Studio AgentPanel) | Wrench (Lucide), active state uses Phosphor Wrench (Fill) |
| 🎬 | Director-manual toggle / film-produce (Studio AgentPanel & tabs) | Clapperboard (Lucide), active state Clapperboard (Fill weight) |
| 🎙 | Voice / microphone prefix inside voice <option> labels | Mic (Lucide) rendered as a leading inline icon in the custom select option (drop the in-text emoji) |
| ⚠ | Model config incomplete warning appended to '模型' label | AlertTriangle (Lucide), colored var(--afs-warning); show only when config incomplete |
| ✓ | Done / selected candidate / video-done marker | Check (Lucide), colored var(--afs-success) for done, var(--afs-accent) for selected |
| ✗ | Failed generation tile | X (Lucide), colored var(--afs-danger) |
| × | Delete / remove (script-list, image-strip, chips) | X (Lucide) at 14px inside a real <button> with aria-label='删除' |
| → | Separator in '插入片段 → {target}' / '从此处继续' | ArrowRight (Lucide) at 12px, aria-hidden, as a flow separator |
| ▶ | Play / preview video in lightbox | Play (Lucide, Fill-equivalent via fill=currentColor) centered in the frame play button |

---

## 4. CSS 变量底座（可直接粘贴）

以下整块用于**取代旧 `--afs-*` 调色板**：机制不变（`:root` 为暗色默认、`html.light` 为亮色覆盖），保留全部旧令牌名（重指向），并附带 `.afs-glass` / `.afs-glow` 工具类与全部可访问性降级。

```css
/* ============================================================
   Aurora Glass — design-system foundation
   Supersedes the legacy --afs-* tokens. Mechanism unchanged:
   :root = DARK (default), html.light = LIGHT overrides.
   All 10 legacy token names are preserved (re-pointed) so JS-
   injected node-header/badge/dot colors keep working.
   ============================================================ */
:root {
  /* — surfaces (dark) — */
  --afs-bg: #0a0e16;
  --afs-surface-sunken: #0d121a;
  --afs-panel: #11161f;
  --afs-panel-2: #161c28;
  --afs-surface-3: #1e2533;
  --afs-node-bg: #11161f;

  /* — borders (dark) — */
  --afs-border: #252d3d;
  --afs-border-strong: #37415a;

  /* — text (dark, emphasis ladder) — */
  --afs-text: #e8eaf0;        /* high ~87% */
  --afs-muted: #9aa3b5;       /* med ~60%  */
  --afs-text-dim: #6b7383;    /* low ~38% (was UNDEFINED) */

  /* — interaction (dark) — */
  --afs-hover: #1c2433;
  --afs-dot: rgba(255,255,255,0.07);

  /* — accent (dark: lighter + desaturated so it doesn't vibrate) — */
  --afs-accent: #8b9bff;
  --afs-accent-strong: #6d7cff;
  --afs-on-accent: #0a0e16;
  --afs-ring: #9db2ff;

  /* — semantic status (dark) — */
  --afs-success: #34d399;
  --afs-warning: #fbbf24;
  --afs-danger: #f87171;
  --afs-info: #60a5fa;

  /* — port / data-type hues (dark) — */
  --afs-type-text: #34d399;
  --afs-type-json: #facc15;
  --afs-type-image: #a78bfa;
  --afs-type-video: #22d3ee;
  --afs-type-audio: #fbbf24;
  --afs-type-any: #9aa3b5;

  /* — node category hues (dark) — consumed inline as --cat — */
  --afs-cat-input: #94a3b8;
  --afs-cat-text: #60a5fa;
  --afs-cat-image: #a78bfa;
  --afs-cat-video: #22d3ee;
  --afs-cat-audio: #2dd4bf;
  --afs-cat-output: #34d399;

  /* — signature gradients (dark) — */
  --afs-grad-brand: linear-gradient(135deg, #6d7cff 0%, #9d6bff 50%, #4fd0e0 100%);
  --afs-grad-accent: linear-gradient(135deg, var(--afs-accent-strong), var(--afs-accent));
  --afs-grad-progress: linear-gradient(90deg, #6d7cff, #4fd0e0);
  --afs-aurora:
    radial-gradient(40% 40% at 20% 20%, oklch(0.55 0.20 286 / .40) 0, transparent 60%),
    radial-gradient(38% 38% at 80% 25%, oklch(0.55 0.19 230 / .34) 0, transparent 60%),
    radial-gradient(45% 45% at 65% 85%, oklch(0.50 0.22 330 / .30) 0, transparent 60%);
  --afs-grad-edge-spec: linear-gradient(135deg, rgba(255,255,255,0.5), rgba(255,255,255,0.12) 40%, rgba(255,255,255,0) 70%);

  /* — glass (dark) — */
  --afs-glass-fill: rgba(20,24,38,0.60);
  --afs-glass-fill-strong: rgba(17,22,34,0.80);
  --afs-glass-border: 1px solid rgba(255,255,255,0.10);
  --afs-glass-blur: blur(16px) saturate(160%);
  --afs-glass-highlight: inset 0 1px 0 rgba(255,255,255,0.10);
  --afs-glass-fallback: rgba(17,22,34,0.95);
  --afs-scrim: rgba(0,0,0,0.42);

  /* — elevation (dark) — */
  --afs-elev-1: 0 1px 2px rgba(0,0,0,0.40);
  --afs-elev-2: 0 4px 14px rgba(0,0,0,0.45);
  --afs-elev-3: 0 8px 24px rgba(0,0,0,0.50);
  --afs-elev-4: 0 16px 48px rgba(0,0,0,0.60);
  --afs-glow-opacity: 0.65;

  /* — radii — */
  --afs-r-xs: 4px;  --afs-r-sm: 6px;  --afs-r-md: 8px;
  --afs-r-lg: 12px; --afs-r-xl: 16px; --afs-r-pill: 999px;

  /* — spacing (8px grid) — */
  --afs-sp-1: 2px;  --afs-sp-2: 4px;  --afs-sp-3: 6px;  --afs-sp-4: 8px;
  --afs-sp-5: 12px; --afs-sp-6: 16px; --afs-sp-7: 20px; --afs-sp-8: 24px;
  --afs-sp-9: 32px; --afs-sp-10: 48px; --afs-sp-11: 64px;

  /* — control geometry — */
  --afs-control-h: 32px;
  --afs-control-h-sm: 26px;

  /* — typography — */
  --afs-font-ui: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  --afs-font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;

  /* — motion — */
  --afs-dur-micro: 120ms;
  --afs-dur-ui: 180ms;
  --afs-dur-overlay: 260ms;
  --afs-dur-exit: 140ms;
  --afs-dur-shimmer: 2000ms;
  --afs-dur-breathe: 1800ms;
  --afs-ease-standard: cubic-bezier(0.215, 0.61, 0.355, 1);
  --afs-ease-emphasized: cubic-bezier(0.23, 1, 0.32, 1);
  --afs-ease-move: cubic-bezier(0.645, 0.045, 0.355, 1);
  --afs-ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
}

html.light {
  /* — surfaces (light) — */
  --afs-bg: #eef1f6;
  --afs-surface-sunken: #e6eaf1;
  --afs-panel: #ffffff;
  --afs-panel-2: #f8fafc;
  --afs-surface-3: #ffffff;
  --afs-node-bg: #ffffff;

  /* — borders (light) — */
  --afs-border: #e2e8f0;
  --afs-border-strong: #cbd2dd;

  /* — text (light) — */
  --afs-text: #16203a;
  --afs-muted: #5b6678;
  --afs-text-dim: #8a93a4;

  /* — interaction (light) — */
  --afs-hover: #eef1f7;
  --afs-dot: rgba(71,85,105,0.32);

  /* — accent (light: full-chroma indigo) — */
  --afs-accent: #4f46e5;
  --afs-accent-strong: #4338ca;
  --afs-on-accent: #ffffff;
  --afs-ring: #4f46e5;

  /* — semantic status (light, darkened for >=4.5:1) — */
  --afs-success: #059669;
  --afs-warning: #b45309;
  --afs-danger: #dc2626;
  --afs-info: #2563eb;

  /* — port / data-type hues (light) — */
  --afs-type-text: #059669;
  --afs-type-json: #ca8a04;
  --afs-type-image: #7c3aed;
  --afs-type-video: #0891b2;
  --afs-type-audio: #b45309;
  --afs-type-any: #64748b;

  /* — node category hues (light) — */
  --afs-cat-input: #64748b;
  --afs-cat-text: #2563eb;
  --afs-cat-image: #7c3aed;
  --afs-cat-video: #0891b2;
  --afs-cat-audio: #0d9488;
  --afs-cat-output: #059669;

  /* — signature gradients (light: full chroma) — */
  --afs-grad-brand: linear-gradient(135deg, #5b54ff 0%, #8b3dff 50%, #06b6d4 100%);
  --afs-grad-accent: linear-gradient(135deg, var(--afs-accent-strong), var(--afs-accent));
  --afs-grad-progress: linear-gradient(90deg, #5b54ff, #06b6d4);
  --afs-aurora:
    radial-gradient(40% 40% at 20% 20%, oklch(0.86 0.11 286 / .55) 0, transparent 60%),
    radial-gradient(38% 38% at 80% 25%, oklch(0.88 0.10 230 / .50) 0, transparent 60%),
    radial-gradient(45% 45% at 65% 85%, oklch(0.90 0.09 330 / .45) 0, transparent 60%);
  --afs-grad-edge-spec: linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.15) 40%, rgba(255,255,255,0) 70%);

  /* — glass (light) — */
  --afs-glass-fill: rgba(255,255,255,0.62);
  --afs-glass-fill-strong: rgba(255,255,255,0.86);
  --afs-glass-border: 1px solid rgba(255,255,255,0.55);
  --afs-glass-blur: blur(16px) saturate(180%);
  --afs-glass-highlight: inset 0 1px 0 rgba(255,255,255,0.65);
  --afs-glass-fallback: rgba(255,255,255,0.95);
  --afs-scrim: rgba(0,0,0,0.30);

  /* — elevation (light: shadows carry depth) — */
  --afs-elev-1: 0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10);
  --afs-elev-2: 0 4px 12px rgba(16,24,40,0.10);
  --afs-elev-3: 0 8px 24px rgba(16,24,40,0.14);
  --afs-elev-4: 0 16px 48px rgba(16,24,40,0.22);
  --afs-glow-opacity: 0.45;
}

/* ============================================================
   Shared glass utility (consumes the themed tokens above)
   ============================================================ */
.afs-glass {
  background: var(--afs-glass-fill);
  -webkit-backdrop-filter: var(--afs-glass-blur);
  backdrop-filter: var(--afs-glass-blur);
  border: var(--afs-glass-border);
  border-radius: var(--afs-r-xl);
  box-shadow: var(--afs-elev-3), var(--afs-glass-highlight);
}
.afs-glass--text { background: var(--afs-glass-fill-strong); } /* under body text */

/* AI-action emissive glow (animate opacity only) */
.afs-glow { position: relative; isolation: isolate; }
.afs-glow::after {
  content: ""; position: absolute; inset: -6px; z-index: -1;
  border-radius: inherit; background: var(--afs-grad-accent);
  filter: blur(28px); opacity: var(--afs-glow-opacity);
  transition: opacity var(--afs-dur-ui) var(--afs-ease-standard);
}

/* ============================================================
   Accessibility fallbacks (ship globally)
   ============================================================ */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .afs-glass { background: var(--afs-glass-fallback); }
}
@media (prefers-reduced-transparency: reduce) {
  .afs-glass {
    -webkit-backdrop-filter: none; backdrop-filter: none;
    background: var(--afs-surface-3);
  }
  .afs-glow::after { display: none; }
}
@media (forced-colors: active) {
  .afs-glass { border: 1px solid CanvasText; background: Canvas;
    -webkit-backdrop-filter: none; backdrop-filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  .afs-glow::after { transition: none; }
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; }
}
:focus-visible { outline: 2px solid var(--afs-ring); outline-offset: 2px; }
@media (forced-colors: active) { :focus-visible { outline: 2px solid Highlight; } }
```

---

## 5. 组件库（统一替换原生控件与 emoji）

所有组件**复用上文令牌**（引用 CSS 变量名，不出现裸色值），以 headless 行为原语（Radix / React Aria）实现键盘与 ARIA，**只重写样式、不回退语义**，并 1:1 驱动它们所替换的原生控件原有的 state / 宿主调用。

### 5.1 Form & input controls（18）

#### Button

**替换（Replaces）**：Legacy .afs-btn / .afs-btn--save/--run/--danger/--stop/--mini/--primary/--ghost/--sm (two conflicting definitions at styles.css:182 and :3398) and every raw <button> across Toolbar, Inspector run-row, ProjectHome, AssetsView, Studio batch bars, FilmNode retry, ProviderSettings save/cancel.

**结构（Anatomy）**：Inline-flex row: [optional leading lucide icon 16px] + [label span, Button/control-label type 13px/600] + [optional trailing icon or count pill]. Single border-box; radius --afs-r-md(8px); height from size. Loading swaps leading icon for Loader2 (afs-spin) and keeps label width stable. Gradient/primary variants gain the .afs-glow ::after aura that animates opacity on hover/running only.

**变体（Variants）**：
- primary — solid --afs-accent fill, --afs-on-accent text (white on light, dark ink on dark). Default 'commit/confirm' action (保存).
- gradient — --afs-grad-accent fill + .afs-glow aura. The single signature AI action (运行/Generate/一键成片/生成并设为关键帧). Exactly one per surface.
- secondary — --afs-panel surface, --afs-border hairline, --afs-text label. Neutral default (取消, 导入).
- ghost — transparent fill, no border until hover; for low-emphasis/toolbar rows (返回, fit-view).
- danger — secondary by default; danger hue only on hover/active or as solid for destructive confirm (删除/停止). Always paired with an icon, never color-only.
- icon — see IconButton (square, label collapses to aria-label).

**尺寸（Sizes）**：
- sm — height var(--afs-control-h-sm)=26px, padding 0 var(--afs-sm 12px scaled to 0 10px), icon 14px, font 12px. Dense toolbar/inline rows.
- md — height var(--afs-control-h)=32px, padding 0 14px, icon 16px, font 13px. Default.
- lg — height 40px, padding 0 20px, icon 18px, font 13px/600. Hero CTA / empty-state primary.

**状态（States）**：
- default
- hover — micro transition (--afs-dur-micro): secondary/ghost → background var(--afs-hover); primary → filter brightness(1.06); gradient → glow opacity rises to --afs-glow-opacity
- focus-visible — outline 2px var(--afs-ring), outline-offset 2px (never removed; clears 3:1 both themes)
- active — transform: scale(0.97) (press feedback), --afs-dur-micro
- disabled — opacity 0.45, cursor not-allowed, pointer-events none, glow hidden
- loading — Loader2 afs-spin replaces leading icon, label dims slightly, aria-busy=true, pointer-events none but width frozen
- selected/active-toggle — for toolbar toggles (Run↔Stop), reflects pressed via aria-pressed; gradient persists while running

**亮/暗（Light/Dark）**：primary/gradient text uses --afs-on-accent which flips per theme (#fff light / #0a0e16 dark ink on the luminous dark accent). Gradient stops come from theme-tuned --afs-grad-accent (light full-chroma, dark desaturated). Danger hover uses --afs-danger (light #dc2626 full-strength, dark #f87171 lightened) instead of the old hardcoded #7f1d1d/#b91c1c. Secondary/ghost rely on --afs-hover (re-tuned per theme), so no dark-only fills remain.

**可访问性（A11y）**：Native <button type=button>. Label is visible text; icon-only handled by IconButton. Loading sets aria-busy and disabled. focus-visible ring 2px ≥3:1; in forced-colors uses Highlight. Press scale respects prefers-reduced-motion (drops to none). Danger confirm action keeps text label + icon so intent is not color-only. Never animate box-shadow/blur — only transform+opacity+filter.

*预览：*
```text
secondary   gradient(glow)   danger
┌────────┐  ╔════════════╗   ┌──────────┐
│  保存  │  ║ ✦ 运 行     ║   │ 🗑 删除   │
└────────┘  ╚════════════╝   └──────────┘
              (aurora aura)
```
*CSS（草图，引用令牌）：*
```css
.afs-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--afs-sp-3);height:var(--afs-control-h);padding:0 14px;border:1px solid transparent;border-radius:var(--afs-r-md);font:600 13px/1 var(--afs-font-ui);cursor:pointer;color:var(--afs-text);background:var(--afs-panel);transition:background var(--afs-dur-micro) var(--afs-ease-standard),filter var(--afs-dur-micro) var(--afs-ease-standard),transform var(--afs-dur-micro) var(--afs-ease-standard)}
.afs-btn--sm{height:var(--afs-control-h-sm);padding:0 10px;font-size:12px}
.afs-btn--lg{height:40px;padding:0 20px}
.afs-btn--secondary{background:var(--afs-panel);border-color:var(--afs-border)}
.afs-btn--ghost{background:transparent}
.afs-btn--secondary:hover,.afs-btn--ghost:hover{background:var(--afs-hover)}
.afs-btn--primary{background:var(--afs-accent);color:var(--afs-on-accent)}
.afs-btn--primary:hover{filter:brightness(1.06)}
.afs-btn--gradient{background:var(--afs-grad-accent);color:var(--afs-on-accent);border-color:transparent}
.afs-btn--gradient.afs-glow::after{opacity:0;transition:opacity var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-btn--gradient:hover.afs-glow::after,.afs-btn--gradient[aria-busy=true].afs-glow::after{opacity:var(--afs-glow-opacity)}
.afs-btn--danger:hover,.afs-btn--danger[data-solid]{background:var(--afs-danger);border-color:var(--afs-danger);color:var(--afs-on-accent)}
.afs-btn:active:not(:disabled){transform:scale(.97)}
.afs-btn:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-btn:disabled{opacity:.45;cursor:not-allowed;pointer-events:none}
@media(prefers-reduced-motion:reduce){.afs-btn:active{transform:none}}
```

#### IconButton

**替换（Replaces）**：The 3 fully-inline-styled lock/expand buttons in FilmNode (L323-335, L347-359, L516-529), AppRail items, Toolbar icon buttons (fit/palette/camera), Lightbox close/nav/toggle (hardcoded rgba white-on-dark), card action rows (rename/dup/export/delete), ProviderSettings test/delete, snapshot/board action buttons. The single shared icon-button primitive.

**结构（Anatomy）**：Square or pill target ≥36×40px hit-area with a centered lucide glyph (18–20px, stroke=currentColor inheriting text token). Optional .afs-iconbtn--badge dot (status/notification) at top-right. On glass surfaces wraps in --afs-glass tokens; on solid surfaces uses --afs-hover.

**变体（Variants）**：
- neutral — transparent, glyph --afs-muted → --afs-text on hover (rail, toolbar, card actions)
- active/toggle — pressed state fills color-mix(--afs-accent 16%) tint + accent glyph; aria-pressed (lock-on, 连看-on, chain-on, tool-loop/director toggles)
- danger — glyph --afs-danger; hover bg color-mix(--afs-danger 14%, transparent) (delete)
- on-media — for buttons over uncontrolled media (FilmNode frame expand/lock, lightbox close): glass capsule with --afs-scrim backing so glyph stays ≥3:1 over any image
- glass — lives on floating chrome (lightbox/toolbar), uses .afs-glass recipe

**尺寸（Sizes）**：
- sm — 28px target, glyph 14–16px (dense node/inline)
- md — 36px target, glyph 18px (default chrome)
- lg — 44px target, glyph 20–24px (lightbox nav arrows)

**状态（States）**：
- default
- hover — bg --afs-hover (solid) or rgba lift (glass), glyph → --afs-text, --afs-dur-micro
- focus-visible — 2px --afs-ring ring, offset 2px
- active — scale(0.94)
- pressed/selected (toggle) — accent tint + accent glyph, aria-pressed=true
- disabled — opacity 0.4, no pointer events

**亮/暗（Light/Dark）**：Lightbox controls drop the legacy rgba(255,255,255,0.1) white-on-dark fills; on-media variant now uses --afs-scrim (light rgba(0,0,0,0.30) vs dark rgba(0,0,0,0.42)) with --afs-on-accent-agnostic white glyph that stays legible because the scrim is theme-tuned. Active-toggle tint reads in both themes via color-mix on the themed accent (full-chroma light, desaturated dark). Replaces the inconsistent lock opacity (0.55/0.75/0.8) with one rule.

**可访问性（A11y）**：<button type=button> with aria-label on the BUTTON (never the svg; svg is aria-hidden). Toggles use aria-pressed. Tooltip text duplicates aria-label (title). On-media variant flattens a --afs-scrim before measuring so glyph ≥3:1 vs worst-case image. focus-visible ring required even on glass; forced-colors → 1px CanvasText border + Highlight ring.

*预览：*
```text
neutral  active   danger   on-media
 ┌──┐    ┌──┐    ┌──┐     ╭──╮
 │ ⚙│    │🔒│    │🗑│     │✕ │(scrim)
 └──┘    └▔▔┘    └──┘     ╰──╯
         accent
```
*CSS（草图，引用令牌）：*
```css
.afs-iconbtn{display:inline-grid;place-items:center;width:36px;height:36px;border:1px solid transparent;border-radius:var(--afs-r-md);background:transparent;color:var(--afs-muted);cursor:pointer;transition:background var(--afs-dur-micro) var(--afs-ease-standard),color var(--afs-dur-micro) var(--afs-ease-standard),transform var(--afs-dur-micro) var(--afs-ease-standard)}
.afs-iconbtn--sm{width:28px;height:28px}
.afs-iconbtn--lg{width:44px;height:44px}
.afs-iconbtn:hover{background:var(--afs-hover);color:var(--afs-text)}
.afs-iconbtn:active{transform:scale(.94)}
.afs-iconbtn[aria-pressed=true]{background:color-mix(in srgb,var(--afs-accent) 16%,transparent);color:var(--afs-accent)}
.afs-iconbtn--danger:hover{background:color-mix(in srgb,var(--afs-danger) 14%,transparent);color:var(--afs-danger)}
.afs-iconbtn--onmedia{color:#fff;background:var(--afs-scrim);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur)}
.afs-iconbtn:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-iconbtn:disabled{opacity:.4;pointer-events:none}
```

#### Text Input

**替换（Replaces）**：All raw <input type=text/number/password> styled by .afs-field__input (Inspector node-title/params, Toolbar rename, ProviderSettings ~12 fields incl. API key, Studio title/card/dialogue/track fields, search inputs, snapshot name). Also subsumes afs-form__row input (which lacked a :focus rule).

**结构（Anatomy）**：Field box: [optional leading icon 14px, --afs-muted] + [<input>] + [optional trailing affix: clear ✕ / reveal eye / unit text / inline spinner]. Surface = --afs-surface-sunken (inset well), 1px --afs-border, radius --afs-r-sm. Lives inside a Field wrapper that owns label/help/error. type=number variant adds the Number stepper affix.

**变体（Variants）**：
- text (default)
- password — trailing eye IconButton toggling type
- number — see Number stepper (custom ± affix, native spinner suppressed)
- with-leading-icon — search/identifier fields
- code/mono — font --afs-font-mono, for path/JSON-path/template inputs

**尺寸（Sizes）**：
- sm — height 26px, padding 0 8px, font 12px
- md — height 32px, padding 0 10px, font 13px (default)

**状态（States）**：
- default — sunken surface, hairline border
- hover — border → --afs-border-strong
- focus-visible — border --afs-accent + 2px --afs-ring ring (offset 0/inset feel via box-shadow ring), placeholder stays --afs-text-dim
- filled — same as default (value present)
- disabled — opacity 0.5, surface --afs-panel-2, no caret
- error — border --afs-danger, ring --afs-danger on focus; error text below via Field wrapper; aria-invalid
- readonly — border --afs-border, muted text, copy allowed

**亮/暗（Light/Dark）**：Surface uses --afs-surface-sunken (dark #0d121a / light #e6eaf1) so the field reads as inset in both themes — replaces the old --afs-panel-2 which was equal to bg in dark. Placeholder uses the now-DEFINED --afs-text-dim (dark #6b7383 / light #8a93a4) instead of the undefined token that broke light mode. Error red is theme-tuned (--afs-danger).

**可访问性（A11y）**：Real <input> retains all native semantics. id ↔ <label for>; aria-describedby → help/error ids; aria-invalid on error; aria-required mirrors required. Placeholder is never the only label. Clear/reveal affixes are IconButtons with aria-label. focus ring ≥2px ≥3:1. Native value/onChange preserved 1:1 so host wiring is unchanged.

*预览：*
```text
label
┌─────────────────────────────┐
│ 🔍  搜索素材…            ✕ │
└─────────────────────────────┘
 focus → indigo border + ring
```
*CSS（草图，引用令牌）：*
```css
.afs-input{display:flex;align-items:center;gap:var(--afs-sp-3);width:100%;box-sizing:border-box;height:var(--afs-control-h);padding:0 10px;background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-sm);color:var(--afs-text);font:400 13px/1.5 var(--afs-font-ui);transition:border-color var(--afs-dur-ui) var(--afs-ease-standard),box-shadow var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-input>input{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;outline:none}
.afs-input>input::placeholder{color:var(--afs-text-dim)}
.afs-input:hover{border-color:var(--afs-border-strong)}
.afs-input:focus-within{border-color:var(--afs-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--afs-ring) 55%,transparent)}
.afs-input--mono>input{font-family:var(--afs-font-mono);font-size:12px}
.afs-input[data-invalid=true]{border-color:var(--afs-danger)}
.afs-input[data-invalid=true]:focus-within{box-shadow:0 0 0 2px color-mix(in srgb,var(--afs-danger) 55%,transparent)}
.afs-input[data-disabled=true]{opacity:.5;background:var(--afs-panel-2)}
```

#### Textarea (auto-grow)

**替换（Replaces）**：All <textarea class=afs-field__input> (Inspector textarea params rows=4, OptimizableField, prompt/description fields, novel paste, script content, agent input, director manual, ProviderSettings bodyTemplate, PromptSettings code rows=12/3, GlobalSettings style). Includes the OptimizableField AI-affix variant.

**结构（Anatomy）**：Same sunken field box as Text Input but multi-line; min-rows configurable, auto-grows to max-rows then scrolls (nowheel-safe). Optional bottom-right affix cluster (.afs-optfield style): Clear + AI-optimize button. Optional char/token counter bottom-left. Code variant uses mono font and disables auto-grow ceiling.

**变体（Variants）**：
- default (auto-grow, min 2–4 rows)
- code — --afs-font-mono, fixed rows, tab-insert; for JSON/templates/prompt contracts
- optimizable — adds floating bottom-right AI-optimize (Sparkles) + Undo (RotateCcw) IconButtons; input gets extra bottom-right padding to clear them
- fixed — resize:none, scroll-only

**尺寸（Sizes）**：
- sm — min 2 rows, font 12px
- md — min 4 rows, font 13px (default)

**状态（States）**：
- default
- hover — border --afs-border-strong
- focus-visible — accent border + ring
- disabled — opacity 0.5, no caret
- error — danger border + ring + aria-invalid
- optimizing (loading) — AI button shows Loader2 afs-spin, aria-busy; manual edit clears the undo point

**亮/暗（Light/Dark）**：OptimizableField loses its hardcoded dark navy rgba(15,22,38,0.92) button bg and #c084fc/#cbd5e1 colors — AI button becomes a glass/secondary IconButton with --afs-type-image (violet, theme-tuned: light #7c3aed / dark #a78bfa) accent so the 'AI optimize' affordance reads in light mode instead of being a dark blob on white. Sunken surface + defined --afs-text-dim placeholder fix light mode.

**可访问性（A11y）**：Real <textarea>; label/help/error via Field wrapper + aria-describedby/aria-invalid. AI-optimize and Undo are type=button IconButtons with aria-label; AI disabled when busy or empty. Auto-grow must not trap focus or steal scroll (preserve nowheel). prefers-reduced-motion: height jump is instant (no animated grow). Counter is aria-live=polite only if it gates submission.

*预览：*
```text
画面描述
┌─────────────────────────────┐
│ 夜晚的霓虹街道，雨后反光…     │
│                              │
│                    ↺  ✦AI    │
└─────────────────────────────┘
```
*CSS（草图，引用令牌）：*
```css
.afs-textarea{position:relative;width:100%}
.afs-textarea textarea{width:100%;box-sizing:border-box;min-height:calc(4*1.5em + 16px);padding:8px 10px;background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-sm);color:var(--afs-text);font:400 13px/1.5 var(--afs-font-ui);outline:none;resize:vertical;transition:border-color var(--afs-dur-ui) var(--afs-ease-standard),box-shadow var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-textarea--code textarea{font-family:var(--afs-font-mono);font-size:12px;resize:none}
.afs-textarea--opt textarea{padding-bottom:34px}
.afs-textarea textarea::placeholder{color:var(--afs-text-dim)}
.afs-textarea textarea:hover{border-color:var(--afs-border-strong)}
.afs-textarea textarea:focus{border-color:var(--afs-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--afs-ring) 55%,transparent)}
.afs-textarea__affix{position:absolute;right:6px;bottom:6px;display:flex;gap:4px}
.afs-textarea__ai{color:var(--afs-type-image)}
.afs-textarea[data-invalid=true] textarea{border-color:var(--afs-danger)}
```

#### Custom Select / Dropdown

**替换（Replaces）**：Every native <select> in the app (the #1 visual break): Toolbar text/image model, all nodeDefs control:'select' params, Inspector model/imageModel/provider overrides + snippet inserter (optgroups), GlobalSettings 5 selects (filmScale/aspect/lang/stylePack/concurrency), ProviderSettings preset+kind, ProjectHome template, AssetsView per-card board, Studio artStyle/videoRatio/videoMode/resolution/shotSize/cameraMove/transition/voice, StudioSettings per-agent model. Headless via Radix/React Aria Listbox — restyle only, same value/onChange/option set.

**结构（Anatomy）**：Trigger button: [optional leading icon] + [selected label / placeholder] + [ChevronDown 16px right]. Popover listbox (floating GLASS chrome, --afs-elev-3): scrollable options, optional <optgroup> headers (micro-label uppercase), each option = [optional check/leading icon] + label + [optional trailing meta/swatch]. Selected option shows Check (--afs-accent). Supports inline leading icons inside options (e.g. Mic for voice 🎙 replacement).

**变体（Variants）**：
- default
- with-leading-icon trigger
- grouped — optgroup section headers (snippet groups, provider caps)
- swatch — leading color dot per option (style pack / category / board color)
- follow-default — first option is an em-dashed '跟随默认/（未选）' placeholder mapping to '' value

**尺寸（Sizes）**：
- sm — trigger 26px (toolbar/inline node fields)
- md — trigger 32px (default forms)

**状态（States）**：
- trigger default / hover (border-strong) / focus-visible (accent ring) / disabled (0.5)
- open — chevron rotates 180°, trigger border --afs-accent; popover animates in (--afs-dur-ui, scale+opacity from top)
- option hover/active-descendant — bg --afs-hover
- option selected — Check + label --afs-text, subtle accent tint
- option disabled — opacity 0.4, not focusable
- loading — trigger shows Loader2 + 'loading' (e.g. fetching models)
- empty — popover shows muted '无可选项' note

**亮/暗（Light/Dark）**：Popover uses Glass-chrome recipe: light rgba(255,255,255,0.62)+blur+darker hairline+shadow; dark rgba(20,24,38,0.60)+blur+faint white hairline+lighter-surface depth. Because it sits over content (a chrome surface, short-lived, ≤1 open), glass is appropriate per the 'glass on chrome' principle. Selected-tint via color-mix on themed accent. Replaces OS-light popups in dark mode entirely.

**可访问性（A11y）**：Headless listbox (Radix Select / React Aria): role=combobox(button) + role=listbox + role=option, aria-expanded, aria-activedescendant, aria-selected; full keyboard (↑↓ move, Home/End, type-ahead, Enter/Space select, Esc close, Tab closes+commits). Popover is a portal layered above modals (respect z-index tiers). Glass popover ships .afs-glass fallbacks (reduced-transparency → --afs-surface-3 opaque, forced-colors → Canvas/CanvasText). Trigger focus ring ≥3:1. Selection is never indicated by color alone (Check icon).

*预览：*
```text
trigger              popover (glass)
┌──────────────┐    ┌──────────────────┐
│ 16:9       ▾ │    │ ✓ 16:9 (横屏)    │
└──────────────┘    │   9:16 (竖屏)    │
   open ──────────▶ │   1:1  (方形)    │
                    └──────────────────┘
```
*CSS（草图，引用令牌）：*
```css
.afs-select__trigger{display:flex;align-items:center;gap:var(--afs-sp-2);width:100%;height:var(--afs-control-h);padding:0 8px 0 10px;background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-sm);color:var(--afs-text);font:400 13px/1 var(--afs-font-ui);cursor:pointer}
.afs-select__trigger:hover{border-color:var(--afs-border-strong)}
.afs-select__trigger[data-state=open]{border-color:var(--afs-accent)}
.afs-select__trigger:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-select__chev{margin-left:auto;color:var(--afs-muted);transition:transform var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-select__trigger[data-state=open] .afs-select__chev{transform:rotate(180deg)}
.afs-select__popover{min-width:var(--radix-popper-anchor-width);max-height:300px;overflow:auto;padding:var(--afs-sp-2);background:var(--afs-glass-fill);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border:var(--afs-glass-border);border-radius:var(--afs-r-lg);box-shadow:var(--afs-elev-3),var(--afs-glass-highlight);animation:afs-pop var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-select__group-label{padding:6px 8px 2px;font:600 11px/1 var(--afs-font-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--afs-muted)}
.afs-select__option{display:flex;align-items:center;gap:var(--afs-sp-3);padding:6px 8px;border-radius:var(--afs-r-xs);font-size:13px;color:var(--afs-text);cursor:pointer}
.afs-select__option[data-highlighted]{background:var(--afs-hover);outline:none}
.afs-select__option[data-state=checked]{background:color-mix(in srgb,var(--afs-accent) 12%,transparent)}
.afs-select__option[data-state=checked] .afs-select__check{color:var(--afs-accent)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.afs-select__popover{background:var(--afs-glass-fallback)}}
@keyframes afs-pop{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}
```

#### Combobox / Searchable Select

**替换（Replaces）**：Long native <select>s that need filtering: Toolbar model pickers (many models), provider/voice pickers, style-pack picker, per-agent model selects in StudioSettings, board assignment when many boards. A Custom Select whose trigger is a typeable input.

**结构（Anatomy）**：Trigger = Text Input with leading Search icon + trailing Chevron (combobox). Popover = filtered listbox (same glass chrome as Custom Select) with highlighted match substrings, optional grouping, '创建/无匹配' empty row. Selecting fills the input; clearing reopens full list.

**变体（Variants）**：
- single-select (default)
- grouped + searchable
- creatable — bottom '创建“{query}”' row (e.g. ad-hoc tag/board)

**尺寸（Sizes）**：
- sm — 26px trigger
- md — 32px trigger (default)

**状态（States）**：
- closed / open
- input focus-visible — accent ring
- typing — list filters live (debounced), match highlight
- no-match — muted '无匹配项' (or creatable row)
- option highlighted (aria-activedescendant) / selected (Check)
- loading — Loader2 in trigger while async options resolve
- disabled

**亮/暗（Light/Dark）**：Identical glass popover token recipe to Custom Select. Match-highlight <mark> uses color-mix(--afs-accent 22%) background that reads in both themes (no hardcoded yellow). Input placeholder uses --afs-text-dim.

**可访问性（A11y）**：role=combobox with aria-expanded, aria-controls→listbox, aria-activedescendant; ↑↓ navigate, Enter select, Esc close/clear, Backspace on empty reopens. Filtering announced via aria-live polite count. Match-highlight is presentational (<mark>), not relied on for meaning. Same glass-popover fallbacks as Custom Select.

*预览：*
```text
┌──────────────────────────┐
│ 🔍 gpt-4│              ▾ │
└──────────────────────────┘
┌──────────────────────────┐
│ ✓ gpt-4o                 │
│   gpt-4o-mini            │
│   gpt-4.1                │
└──────────────────────────┘
```
*CSS（草图，引用令牌）：*
```css
.afs-combobox{position:relative}
.afs-combobox .afs-input{cursor:text}
.afs-combobox__popover{/* inherits .afs-select__popover glass recipe */}
.afs-combobox__option mark{background:color-mix(in srgb,var(--afs-accent) 22%,transparent);color:inherit;border-radius:2px}
.afs-combobox__empty{padding:8px;font-size:12px;color:var(--afs-muted)}
.afs-combobox__create{display:flex;gap:6px;align-items:center;padding:6px 8px;color:var(--afs-accent);font-size:12px}
```

#### Multi-select & Tags Input

**替换（Replaces）**：CastChip cluster (StoryboardItem associateAssetIds), capability checkboxes-as-set in ProviderSettings (could converge), comma-split voices field in ProviderSettings, snippet detected {vars}, ElementLibrary refAssetIds. Token-pill input for selecting/entering multiple values.

**结构（Anatomy）**：Field box containing wrapped removable Tag pills [label + ✕ IconButton] followed by an inline text/combobox input. Below or in-popover: a Combobox listbox for choosing from known options; free-typed tokens commit on Enter/comma. Overflow wraps to multiple rows.

**变体（Variants）**：
- tokens-from-list (multi-select, options-constrained)
- free-tags (creatable, comma/Enter to add)
- toggle-chips (CastChip style — pills toggle in/out without a text input, for fixed small sets)

**尺寸（Sizes）**：
- sm — pills 22px (node/inline)
- md — pills 26px (forms)

**状态（States）**：
- default
- focus-within — accent border + ring on the box
- tag default / hover (show ✕) / removing
- tag selected (toggle-chip on) — accent-tint fill + accent text
- input typing → popover filter
- max-reached — input disabled + helper note
- error — danger border (e.g. required-min not met)
- disabled

**亮/暗（Light/Dark）**：Tag pills use --afs-hover surface + --afs-border; selected/toggle-on uses color-mix(--afs-accent 16%) + --afs-accent text, theme-tuned. CastChip 'on' state replaces hardcoded accent-mix + undefined --afs-text-dim with the now-defined token. Remove ✕ glyph inherits text color so it themes.

**可访问性（A11y）**：Container role=group with accessible name; each tag remove is a <button aria-label='删除 {tag}'>; input is a combobox (aria-multiselectable listbox). Backspace on empty input removes last tag. Arrow keys move between tags (roving tabindex). Toggle-chips are <button aria-pressed>. Removal/addition announced via aria-live polite. Pills never color-only — include label text.

*预览：*
```text
出场资产
┌───────────────────────────────┐
│ (主角 ✕)(反派 ✕)(街道 ✕) 添加…│
└───────────────────────────────┘
toggle-chips: ⟨主角⟩ ⟨反派⟩ ⟨•旁白•⟩(on)
```
*CSS（草图，引用令牌）：*
```css
.afs-tagsinput{display:flex;flex-wrap:wrap;gap:var(--afs-sp-2);align-items:center;min-height:var(--afs-control-h);padding:4px 6px;background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-sm)}
.afs-tagsinput:focus-within{border-color:var(--afs-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--afs-ring) 55%,transparent)}
.afs-tag{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 6px 0 8px;border-radius:var(--afs-r-pill);background:var(--afs-hover);border:1px solid var(--afs-border);color:var(--afs-text);font:500 11px/1 var(--afs-font-ui)}
.afs-tag__x{display:grid;place-items:center;width:14px;height:14px;border-radius:50%;color:var(--afs-muted);cursor:pointer}
.afs-tag__x:hover{color:var(--afs-danger)}
.afs-tagsinput input{flex:1;min-width:60px;border:0;background:transparent;color:var(--afs-text);font:inherit;outline:none}
.afs-chip-toggle{height:26px;padding:0 10px;border-radius:var(--afs-r-pill);border:1px solid var(--afs-border);background:transparent;color:var(--afs-muted);cursor:pointer}
.afs-chip-toggle[aria-pressed=true]{background:color-mix(in srgb,var(--afs-accent) 16%,transparent);border-color:color-mix(in srgb,var(--afs-accent) 45%,var(--afs-border));color:var(--afs-accent)}
```

#### Toggle / Switch

**替换（Replaces）**：Boolean toggles currently faked as buttons: Studio toolLoop (🛠) and director-manual (🎬) manualtoggle buttons, chain-from-prev (Link2 is-on), Lightbox 连看, theme-follow concept, advanced toggle in StudioSettings, enableMainPush-style settings. The signature on/off control.

**结构（Anatomy）**：Pill track + circular thumb. Off: track --afs-border / --afs-surface-sunken, thumb --afs-panel raised. On: track = --afs-grad-accent, thumb slides right with subtle spring. Optional leading/trailing icon inside track for stateful pairs (e.g. Phosphor Fill active glyph). Paired with a label via Field/inline.

**变体（Variants）**：
- default switch
- with-icons (icon in track reflects state)
- labeled-row (label left, switch right — settings rows)

**尺寸（Sizes）**：
- sm — track 28×16, thumb 12
- md — track 36×20, thumb 16 (default)

**状态（States）**：
- off (default) / on
- hover — track brightens slightly
- focus-visible — ring around track
- active — thumb scale 0.92 on press
- disabled — opacity 0.45
- loading (optional) — thumb shows tiny spinner while async commit pending

**亮/暗（Light/Dark）**：On-track uses --afs-grad-accent (theme-tuned). Off-track --afs-surface-sunken reads as inset in both themes. Thumb on dark uses lighter surface for depth (no shadow); on light uses --afs-elev-1 shadow. Replaces the emoji-only Studio toggles with a real labeled switch (emoji meaning preserved as a leading icon + visible label).

**可访问性（A11y）**：role=switch (Radix/React Aria), aria-checked, label via aria-labelledby or wrapping <label>. Space/Enter toggles. Thumb travel uses --afs-ease-spring (subtle bounce 0.2) but only transform; prefers-reduced-motion → instant. State must also be conveyed by position + (where the toggle replaced an emoji) an icon/label, never the track color alone. forced-colors: track border + thumb remain visible (use Highlight when on).

*预览：*
```text
off            on
( ●    )      (    ◉)  ← gradient track
工具调用循环   工具调用循环 ✓
```
*CSS（草图，引用令牌）：*
```css
.afs-switch{position:relative;display:inline-flex;align-items:center;width:36px;height:20px;border-radius:var(--afs-r-pill);background:var(--afs-surface-sunken);border:1px solid var(--afs-border);cursor:pointer;transition:background var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-switch[data-state=checked]{background:var(--afs-grad-accent);border-color:transparent}
.afs-switch__thumb{position:absolute;left:2px;width:16px;height:16px;border-radius:50%;background:var(--afs-panel);box-shadow:var(--afs-elev-1);transition:transform var(--afs-dur-ui) var(--afs-ease-spring)}
.afs-switch[data-state=checked] .afs-switch__thumb{transform:translateX(16px)}
.afs-switch:active .afs-switch__thumb{transform:scale(.92)}
.afs-switch[data-state=checked]:active .afs-switch__thumb{transform:translateX(16px) scale(.92)}
.afs-switch:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-switch[data-disabled]{opacity:.45;cursor:not-allowed}
@media(prefers-reduced-motion:reduce){.afs-switch__thumb{transition:none}}
```

#### Checkbox

**替换（Replaces）**：5 native capability checkboxes in ProviderSettings (browser-default blue, no accent-color), advanced toggle in StudioSettings (could be checkbox), any future multi-boolean. Custom box with gradient check.

**结构（Anatomy）**：Square box (--afs-r-xs) + Check glyph that fills with --afs-grad-accent when checked. Indeterminate shows a dash. Adjacent label (clickable). Optional help text under label.

**变体（Variants）**：
- default
- indeterminate (mixed group)
- card-checkbox (larger selectable card with checkbox affordance — e.g. capability cards)

**尺寸（Sizes）**：
- sm — 14px box
- md — 16px box (default)

**状态（States）**：
- unchecked / checked / indeterminate
- hover — border --afs-border-strong, box bg --afs-hover
- focus-visible — ring around box
- active — scale 0.9
- disabled — opacity 0.45
- error — danger border (required group unmet); aria-invalid on group

**亮/暗（Light/Dark）**：Check fill = --afs-grad-accent (theme-tuned) instead of browser default blue, so it matches the indigo palette in both themes and is no longer off-palette. Unchecked box surface --afs-surface-sunken; checkmark glyph --afs-on-accent flips per theme.

**可访问性（A11y）**：Native <input type=checkbox> visually hidden + styled box, OR role=checkbox headless; aria-checked (true/false/mixed). Label <label for> clickable. Space toggles. Group uses <fieldset>/role=group with legend. Indeterminate set via JS .indeterminate. Check is an icon (not color-only). focus ring ≥3:1.

*预览：*
```text
[✓] 视频   [✓] 配乐   [ ] 语音
[–] 原生音频(mixed)   [ ] 口型同步
```
*CSS（草图，引用令牌）：*
```css
.afs-checkbox{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid var(--afs-border-strong);border-radius:var(--afs-r-xs);background:var(--afs-surface-sunken);cursor:pointer;transition:background var(--afs-dur-micro) var(--afs-ease-standard),border-color var(--afs-dur-micro)}
.afs-checkbox:hover{background:var(--afs-hover)}
.afs-checkbox[data-state=checked],.afs-checkbox[data-state=indeterminate]{background:var(--afs-grad-accent);border-color:transparent}
.afs-checkbox__icon{color:var(--afs-on-accent);opacity:0;transform:scale(.6);transition:opacity var(--afs-dur-micro),transform var(--afs-dur-micro) var(--afs-ease-spring)}
.afs-checkbox[data-state=checked] .afs-checkbox__icon,.afs-checkbox[data-state=indeterminate] .afs-checkbox__icon{opacity:1;transform:none}
.afs-checkbox:active{transform:scale(.9)}
.afs-checkbox:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-checkbox[data-disabled]{opacity:.45;cursor:not-allowed}
```

#### Radio

**替换（Replaces）**：ProviderSettings default-provider radio (.afs-prov__radio button + dot), AppearanceSettings theme cards (light/dark single-choice), any single-choice group. Custom radio dot.

**结构（Anatomy）**：Round outer ring (--afs-r-round) + inner accent dot that scales in when selected. Adjacent label. Also a card-radio variant (whole card selectable, e.g. theme picker, provider-default).

**变体（Variants）**：
- dot-radio (default)
- card-radio (selectable tile, theme/provider/template)

**尺寸（Sizes）**：
- sm — 14px
- md — 16px

**状态（States）**：
- unselected / selected
- hover — ring --afs-border-strong
- focus-visible — ring around control (roving tabindex within group)
- active — dot scale
- disabled — opacity 0.45
- error — danger ring on group

**亮/暗（Light/Dark）**：Inner dot = --afs-accent (theme-tuned, full-chroma light / desaturated dark). card-radio selected border = --afs-accent + color-mix(16%) tint. AppearanceSettings theme swatches keep literal preview colors (intentional) but the selection ring uses the token.

**可访问性（A11y）**：Native radios or role=radiogroup + role=radio with roving tabindex; arrow keys move selection within group, Space selects, Tab enters/exits group. aria-checked. Group has <fieldset>/legend or aria-label. card-radio: whole card is the label/control; selection shown by accent border + check, not color alone.

*预览：*
```text
( ) 自动选第一个
(◉) fal-ai/kling     ← selected

card-radio:  ┌Light┐ ┌Dark✓┐
             │ ☀  │ │ 🌙 │
```
*CSS（草图，引用令牌）：*
```css
.afs-radio{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid var(--afs-border-strong);border-radius:50%;background:var(--afs-surface-sunken);cursor:pointer}
.afs-radio:hover{border-color:var(--afs-border-strong)}
.afs-radio__dot{width:8px;height:8px;border-radius:50%;background:var(--afs-accent);transform:scale(0);transition:transform var(--afs-dur-micro) var(--afs-ease-spring)}
.afs-radio[data-state=checked]{border-color:var(--afs-accent)}
.afs-radio[data-state=checked] .afs-radio__dot{transform:scale(1)}
.afs-radio:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-radio-card{padding:var(--afs-sp-5);border:1px solid var(--afs-border);border-radius:var(--afs-r-lg);cursor:pointer}
.afs-radio-card[data-state=checked]{border-color:var(--afs-accent);background:color-mix(in srgb,var(--afs-accent) 12%,transparent)}
```

#### Slider / Range

**替换（Replaces）**：There is no native range today, but it replaces number-typed magnitude fields where a continuum fits: concurrency (1–8), temperature (0–2, StudioSettings), duration, memory limits. The signature gradient range fill.

**结构（Anatomy）**：Track (sunken pill) + filled range (--afs-grad-accent) from min to thumb + draggable thumb (circle). Optional ticks/step marks, optional value bubble on drag, optional min/max labels. Pairs with a Number stepper for precise entry.

**变体（Variants）**：
- single-value (default)
- with-value-bubble
- stepped (visible ticks)
- range (two thumbs — future)

**尺寸（Sizes）**：
- sm — track 4px, thumb 14px
- md — track 6px, thumb 18px (default)

**状态（States）**：
- default / hover (thumb grows)
- focus-visible — ring on thumb
- dragging/active — value bubble shows, thumb scale up
- disabled — opacity 0.45, no drag
- filled portion always gradient

**亮/暗（Light/Dark）**：Range fill = --afs-grad-accent (theme-tuned). Track --afs-surface-sunken. Thumb --afs-panel with --afs-elev-1 (light) / lighter-surface (dark). Value bubble uses glass-chrome tokens.

**可访问性（A11y）**：role=slider, aria-valuemin/max/now/text, aria-label. ←/→ step, ↑/↓ step, PageUp/Down large step, Home/End. Thumb is the focusable element with a ≥2px ring. Value also surfaced numerically (bubble or paired stepper) so it's not drag-only. prefers-reduced-motion: no bubble animation.

*预览：*
```text
并发上限                 3
├──────●────────────────┤
1                       8
(gradient fill left of ●)
```
*CSS（草图，引用令牌）：*
```css
.afs-slider{position:relative;display:flex;align-items:center;height:18px;width:100%}
.afs-slider__track{position:relative;flex:1;height:6px;border-radius:var(--afs-r-pill);background:var(--afs-surface-sunken)}
.afs-slider__range{position:absolute;height:100%;border-radius:inherit;background:var(--afs-grad-accent)}
.afs-slider__thumb{display:block;width:18px;height:18px;border-radius:50%;background:var(--afs-panel);border:1px solid var(--afs-border-strong);box-shadow:var(--afs-elev-1);cursor:grab;transition:transform var(--afs-dur-micro) var(--afs-ease-standard)}
.afs-slider__thumb:hover{transform:scale(1.1)}
.afs-slider__thumb:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-slider[data-disabled]{opacity:.45}
```

#### Number Stepper

**替换（Replaces）**：All native <input type=number> (OS spinner): Studio concurrency/duration×2/temperature/4 memory fields, nodeDefs number params, ProviderSettings numerics. Suppresses native spinner, adds custom ± controls.

**结构（Anatomy）**：Text Input (numeric, tabular-nums) with two stacked IconButtons (▲▼ via ChevronUp/Down) at the trailing edge, OR a horizontal [−][value][+] layout for compact. Native spinner hidden. Optional unit suffix and min/max clamp.

**变体（Variants）**：
- stacked-chevrons (default, fits 32px row)
- horizontal −/+ (compact inline, e.g. node fields)
- with-unit (suffix label like 秒/p)

**尺寸（Sizes）**：
- sm — 26px
- md — 32px (default)

**状态（States）**：
- default / hover (border-strong) / focus-visible (accent ring)
- stepping — press-and-hold repeat; button active scale
- at-min / at-max — corresponding stepper disabled
- disabled — whole control 0.45
- error — danger border (out of allowed range)

**亮/暗（Light/Dark）**：Reuses Text Input sunken surface. Step buttons inherit IconButton hover (--afs-hover). Tabular numeric font (font-variant-numeric: tabular-nums). No dark-only colors.

**可访问性（A11y）**：Native <input type=number> (keeps onChange/Number() coercion + clamp Math.max/min) with role=spinbutton semantics; aria-valuemin/max/now. ↑/↓ step, PageUp/Down large step. Step buttons are <button aria-label='增加'/'减少'>, aria-hidden chevrons. Clamp logic preserved 1:1 (e.g. concurrency 1–8). Value uses tabular-nums for stable width.

*预览：*
```text
温度          ┌─────────┬─┐
              │ 0.7     │▲│
              │         │▼│
              └─────────┴─┘
```
*CSS（草图，引用令牌）：*
```css
.afs-stepper{display:flex;align-items:stretch;height:var(--afs-control-h);background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-sm)}
.afs-stepper:focus-within{border-color:var(--afs-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--afs-ring) 55%,transparent)}
.afs-stepper input{width:100%;min-width:0;border:0;background:transparent;color:var(--afs-text);text-align:left;padding:0 8px;font:500 13px/1 var(--afs-font-ui);font-variant-numeric:tabular-nums;outline:none;-moz-appearance:textfield}
.afs-stepper input::-webkit-outer-spin-button,.afs-stepper input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.afs-stepper__btns{display:flex;flex-direction:column;border-left:1px solid var(--afs-border)}
.afs-stepper__btn{display:grid;place-items:center;width:22px;flex:1;color:var(--afs-muted);cursor:pointer}
.afs-stepper__btn:hover{background:var(--afs-hover);color:var(--afs-text)}
.afs-stepper__btn:disabled{opacity:.35;pointer-events:none}
```

#### Segmented Control

**替换（Replaces）**：Sub-tab / two-way switches now built as raw buttons: AssetsView subtabs (素材/角色场景库), PromptSettings scope tabs (本工程/全局默认), source/type filter clusters where exclusive, Studio video-mode quick toggles. The sliding-pill exclusive selector.

**结构（Anatomy）**：Pill container (--afs-r-pill, --afs-surface-sunken) holding 2–5 equal segments; an absolutely-positioned active pill (--afs-grad-accent or solid accent) slides under the selected segment via --afs-ease-move. Segment = label (+optional icon). Active label uses --afs-on-accent.

**变体（Variants）**：
- text segments
- icon+text
- icon-only (compact, e.g. layout/density toggle)

**尺寸（Sizes）**：
- sm — height 26px
- md — height 32px (default)

**状态（States）**：
- segment default (muted) / hover (text → --afs-text)
- selected — active pill behind, label --afs-on-accent
- focus-visible — ring on the focused segment
- moving — pill slides (--afs-ease-move) between positions
- disabled segment — opacity 0.4, not selectable
- whole disabled

**亮/暗（Light/Dark）**：Container sunken in both themes; active pill = --afs-grad-accent (theme-tuned) with --afs-on-accent label that flips per theme. Replaces the old color-mix-tinted button approach with a cohesive sliding pill matching the brand gradient.

**可访问性（A11y）**：role=tablist+tab OR radiogroup (exclusive). Roving tabindex; ←/→ move + select (automatic activation) or move-then-Enter (manual). aria-selected/aria-checked. Active is shown by pill position + on-accent label (not color alone). Pill slide uses transform only; prefers-reduced-motion → instant swap. focus ring on segment.

*预览：*
```text
╭───────────┬───────────╮
│ ▓本工程▓ │  全局默认 │   ▓ = sliding gradient pill
╰───────────┴───────────╯
```
*CSS（草图，引用令牌）：*
```css
.afs-segmented{position:relative;display:inline-flex;padding:3px;background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-pill)}
.afs-segmented__pill{position:absolute;top:3px;bottom:3px;border-radius:var(--afs-r-pill);background:var(--afs-grad-accent);box-shadow:var(--afs-glass-highlight);transition:transform var(--afs-dur-ui) var(--afs-ease-move),width var(--afs-dur-ui) var(--afs-ease-move)}
.afs-segmented__seg{position:relative;z-index:1;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 14px;border:0;background:transparent;color:var(--afs-muted);font:600 12px/1 var(--afs-font-ui);cursor:pointer}
.afs-segmented__seg:hover{color:var(--afs-text)}
.afs-segmented__seg[aria-selected=true],.afs-segmented__seg[data-state=checked]{color:var(--afs-on-accent)}
.afs-segmented__seg:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px;border-radius:var(--afs-r-pill)}
@media(prefers-reduced-motion:reduce){.afs-segmented__pill{transition:none}}
```

#### Tabs

**替换（Replaces）**：Underline view tabs: Studio stage tabs (原著/剧本/资产/分镜/时间线 with icons), SettingsView left nav (vertical tabs), WorkbenchDock/StudioDock tabs (节点/素材/提示词). The page/section navigation tab set (distinct from Segmented exclusive controls).

**结构（Anatomy）**：Tab list (horizontal underline or vertical rail) of tabs = [icon 18px] + [label]; active tab has a 2px accent/gradient indicator bar that slides (--afs-ease-move) and label → --afs-text + weight. Tab panels below/beside. Vertical variant (Settings) shows label+desc per item with an accent left-bar + tinted bg.

**变体（Variants）**：
- underline (horizontal — Studio stages, docks)
- vertical-rail (Settings nav, label+desc, left indicator)
- with-count-badge (tab shows a count pill)

**尺寸（Sizes）**：
- sm — 32px tab height (docks)
- md — 40px (Studio stages / Settings)

**状态（States）**：
- tab default (muted) / hover (text + faint --afs-hover)
- selected — accent indicator + --afs-text label
- focus-visible — ring on tab
- indicator sliding (--afs-ease-move)
- disabled tab — 0.4
- tab with badge — count pill follows

**亮/暗（Light/Dark）**：Indicator = --afs-grad-brand or solid --afs-accent (theme-tuned). Vertical Settings active bg = color-mix(--afs-accent 16%) + 45% border, theme-aware. Replaces orphaned-nav issue by including all reachable views; uses --afs-muted→--afs-text emphasis ladder consistently.

**可访问性（A11y）**：role=tablist / role=tab / role=tabpanel; aria-selected, aria-controls↔id, tabindex roving. ←/→ (horizontal) or ↑/↓ (vertical) move; activation automatic or manual per pattern; Home/End jump. Panel has tabindex=0 + aria-labelledby. Indicator is decorative; active also reflected by label weight/color + position. Persisted-view state (lastView/stageTab) maps to aria-selected.

*预览：*
```text
📖原著  📄剧本  👤资产  🎬分镜  🎞时间线
──────  ▔▔▔▔▔  ──────  ──────  ──────
        active(gradient underline)
```
*CSS（草图，引用令牌）：*
```css
.afs-tabs{display:flex;gap:var(--afs-sp-6);border-bottom:1px solid var(--afs-border)}
.afs-tab{position:relative;display:inline-flex;align-items:center;gap:var(--afs-sp-3);height:40px;padding:0 var(--afs-sp-2);border:0;background:transparent;color:var(--afs-muted);font:600 13px/1 var(--afs-font-ui);cursor:pointer}
.afs-tab:hover{color:var(--afs-text)}
.afs-tab[aria-selected=true]{color:var(--afs-text)}
.afs-tab[aria-selected=true]::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px;background:var(--afs-grad-brand)}
.afs-tab:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px;border-radius:var(--afs-r-sm)}
.afs-tabs--vert{flex-direction:column;gap:2px;border:0}
.afs-tabs--vert .afs-tab{justify-content:flex-start;height:auto;padding:var(--afs-sp-4) var(--afs-sp-5);border-radius:var(--afs-r-md)}
.afs-tabs--vert .afs-tab[aria-selected=true]{background:color-mix(in srgb,var(--afs-accent) 16%,transparent)}
.afs-tabs--vert .afs-tab[aria-selected=true]::after{top:8px;bottom:8px;left:0;right:auto;width:2px;height:auto}
```

#### Search Field

**替换（Replaces）**：All search inputs: AssetGallery .afs-lib__search, StudioDock/WorkbenchDock dock search, PromptSettings search, NodeLibrary (currently missing — add). A specialized Text Input.

**结构（Anatomy）**：Text Input with leading Search icon (16px, --afs-muted) + trailing Clear ✕ IconButton (appears when non-empty). Optional pill shape (--afs-r-pill) for chrome contexts. Optional inline result count.

**变体（Variants）**：
- box (--afs-r-sm, in forms/panels)
- pill (--afs-r-pill, in toolbars/chrome)
- with-count (trailing 'N 项')

**尺寸（Sizes）**：
- sm — 26px
- md — 32px (default)

**状态（States）**：
- empty (placeholder, no clear) / typing (clear shows)
- hover / focus-visible (accent ring)
- loading — leading icon swaps to Loader2 while async filtering
- no-results — paired empty state below
- disabled

**亮/暗（Light/Dark）**：Same sunken surface + defined --afs-text-dim placeholder. Pill variant in chrome can sit on glass toolbars; box variant in solid panels. No dark-only values.

**可访问性（A11y）**：role=searchbox (input type=search). aria-label or visible label. Clear button aria-label='清除'; Esc clears when focused. Live result count via aria-live=polite if results render below. Leading icon aria-hidden. Reuses Text Input focus ring.

*预览：*
```text
╭─────────────────────────────╮
│ 🔍 搜索素材…              ✕ │
╰─────────────────────────────╯
```
*CSS（草图，引用令牌）：*
```css
.afs-search{display:flex;align-items:center;gap:var(--afs-sp-3);height:var(--afs-control-h);padding:0 8px 0 10px;background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-pill)}
.afs-search svg{color:var(--afs-muted);flex:none}
.afs-search input{flex:1;min-width:0;border:0;background:transparent;color:var(--afs-text);font:400 13px/1 var(--afs-font-ui);outline:none}
.afs-search input::placeholder{color:var(--afs-text-dim)}
.afs-search:focus-within{border-color:var(--afs-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--afs-ring) 55%,transparent)}
.afs-search__clear{color:var(--afs-muted)}
.afs-search__clear:hover{color:var(--afs-text)}
```

#### Field wrapper (label / help / error / required)

**替换（Replaces）**：The two divergent field systems — afs-field (stacked label-above-input) and afs-form__row (inline 76px label) — converged into ONE wrapper. Wraps every control above (Inspector params, ProviderSettings rows, GlobalSettings, Studio forms).

**结构（Anatomy）**：Vertical (or inline) group: [Label (Field-label type 12px/500 --afs-muted) + optional required asterisk + optional info tooltip] → [Control slot] → [Help text (Caption 11px --afs-text-dim) OR Error text (--afs-danger + AlertTriangle 12px)]. Inline variant puts label in a fixed-width column with consistent baseline.

**变体（Variants）**：
- stacked (default)
- inline (label column — dense settings/provider forms; column width tokenized, not the rigid 76px)
- with-tooltip (info ⓘ next to label)
- with-counter (char/token count aligned right of help row)

**尺寸（Sizes）**：
- sm — tighter gaps (--afs-sp-2)
- md — default (--afs-sp-3)

**状态（States）**：
- default
- required — asterisk + aria-required on control
- help — neutral helper line
- error — error line replaces/adds below help, danger color + icon, control gets data-invalid
- disabled — label + control dim together
- optimizable/AI — label may show an inline AI badge for fields with an optimizer

**亮/暗（Light/Dark）**：Help text uses the now-DEFINED --afs-text-dim (was undefined → broke light mode). Error uses --afs-danger (theme-tuned). Inline label column width is a token, not hardcoded 76px, so long CJK labels (请求体模板/图片上传地址) no longer clip.

**可访问性（A11y）**：<label for=id> tied to control; help/error get ids wired via aria-describedby (error appended). aria-invalid + aria-errormessage on error. Required uses aria-required (asterisk is decorative aria-hidden, plus a visually-hidden '必填'). Error text is aria-live=polite. One wrapper guarantees consistent describedby wiring across all controls (fixes the missing-focus/aria gaps in afs-form__row).

*预览：*
```text
供应商名称 *
┌─────────────────────────────┐
│ My Provider                 │
└─────────────────────────────┘
⚠ 请填写供应商名称   ← error (danger)
```
*CSS（草图，引用令牌）：*
```css
.afs-field{display:flex;flex-direction:column;gap:var(--afs-sp-3);margin-bottom:var(--afs-sp-5)}
.afs-field__label{display:inline-flex;align-items:center;gap:4px;font:500 12px/1.4 var(--afs-font-ui);color:var(--afs-muted)}
.afs-field__req{color:var(--afs-danger)}
.afs-field__help{font:500 11px/1.3 var(--afs-font-ui);color:var(--afs-text-dim)}
.afs-field__error{display:inline-flex;align-items:center;gap:4px;font:500 11px/1.3 var(--afs-font-ui);color:var(--afs-danger)}
.afs-field--inline{flex-direction:row;align-items:center;gap:var(--afs-sp-5)}
.afs-field--inline .afs-field__label{flex:0 0 var(--afs-field-label-w,108px);justify-content:flex-end;text-align:right}
.afs-field--inline .afs-field__control{flex:1;min-width:0}
```

#### Form section / group

**替换（Replaces）**：Ad-hoc section dividers: afs-section/__title, afs-setsec, afs-modal__section, afs-studio__setsec, ProviderSettings shape groups (sync-binary/fal/custom-http). A consistent grouping container for related fields.

**结构（Anatomy）**：Optional section header (Section-title 16px/600 + optional description + optional trailing action like '全部恢复默认' link/toggle) → field stack with consistent 8px-grid spacing → optional hairline divider between sections. Collapsible variant uses a chevron disclosure (replacing native <details>).

**变体（Variants）**：
- plain (header + fields)
- card (section wrapped in --afs-panel-2 card with --afs-elev-1 — provider shape groups)
- collapsible (custom disclosure replacing <details>/<summary>, e.g. JSON contract, raw JSON)
- with-action (header-right link/segment/toggle)

**尺寸（Sizes）**：
- md — default 16/12/8 spacing rhythm

**状态（States）**：
- default
- collapsible: collapsed / expanded (chevron rotates, content animates height via grid-rows or max-height with --afs-dur-ui)
- section disabled (whole group dim)

**亮/暗（Light/Dark）**：Card variant uses --afs-panel-2 + --afs-elev-1 (theme-tuned: light shadow / dark surface-lightness). Divider --afs-border. Collapsible content reveal animates max-height/opacity only (no layout-thrash on canvas). Header title --afs-text, description --afs-muted.

**可访问性（A11y）**：Use <fieldset>+<legend> or role=group + aria-labelledby for the header. Collapsible disclosure = <button aria-expanded aria-controls> + region; Space/Enter toggles; chevron aria-hidden. Replaces native <details> default triangle with a themed disclosure but keeps disclosure semantics. Header actions are real buttons/links.

*预览：*
```text
供应商类型 · 自定义 HTTP        全部恢复默认
───────────────────────────────────────
  提交 URL   ┌──────────────────────┐
  轮询 URL   ┌──────────────────────┐
▸ JSON 契约 (collapsed disclosure)
```
*CSS（草图，引用令牌）：*
```css
.afs-formgroup{display:flex;flex-direction:column;gap:var(--afs-sp-5);padding-block:var(--afs-sp-6)}
.afs-formgroup+.afs-formgroup{border-top:1px solid var(--afs-border)}
.afs-formgroup__head{display:flex;align-items:center;justify-content:space-between;gap:var(--afs-sp-4)}
.afs-formgroup__title{font:600 16px/1.35 var(--afs-font-ui);color:var(--afs-text)}
.afs-formgroup__desc{font:400 12px/1.5 var(--afs-font-ui);color:var(--afs-muted);margin-top:2px}
.afs-formgroup--card{padding:var(--afs-sp-6);background:var(--afs-panel-2);border:1px solid var(--afs-border);border-radius:var(--afs-r-lg);box-shadow:var(--afs-elev-1);border-top:1px solid var(--afs-border)}
.afs-formgroup__disclosure{display:flex;align-items:center;gap:var(--afs-sp-3);width:100%;background:transparent;border:0;color:var(--afs-text);font:600 13px/1 var(--afs-font-ui);cursor:pointer}
.afs-formgroup__chev{color:var(--afs-muted);transition:transform var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-formgroup[data-state=open] .afs-formgroup__chev{transform:rotate(90deg)}
```

#### Inline editable text

**替换（Replaces）**：Toolbar project-name (.afs-toolbar__nametag → input on double-click), Studio doc title (afs-studio__title), any click-to-rename. Display text that swaps to an input in place.

**结构（Anatomy）**：Display mode: text with a subtle edit affordance (Pencil 14px on hover, or dotted underline). Edit mode: borderless/seamless Text Input sized to content, autoFocus, select-all; commit on Enter/blur, cancel on Escape. Optional confirm/cancel IconButtons for explicit mode.

**变体（Variants）**：
- seamless (no visible box until edit — toolbar title)
- boxed (shows input box in edit)
- with-confirm-cancel (explicit ✓/✕)

**尺寸（Sizes）**：
- inherits surrounding type (e.g. Section-title 16px or Body 13px)

**状态（States）**：
- display default / hover (edit hint shows)
- editing — input active, autofocus, text selected; accent underline/ring
- committing — value trimmed, fallback to previous if empty (e.g. '未命名工程')
- focus-visible (display mode is a button) — ring
- disabled — not editable, no hint
- error — invalid commit (rare) shows danger underline

**亮/暗（Light/Dark）**：Edit-mode underline/ring = --afs-accent (theme-tuned). Seamless display inherits surrounding token color. No hardcoded colors; replaces the duplicate width:150/200px CSS conflict with content-sizing.

**可访问性（A11y）**：Display mode is a <button> (or text with role=button) labeled '编辑 {name}'; Enter/F2 enters edit. Edit mode is a real <input> with aria-label; Enter commits, Escape cancels (restores prior), blur commits. Focus returns to the trigger after commit/cancel. Empty-commit guard preserves required fallback. Pencil icon aria-hidden.

*预览：*
```text
display:  我的项目 ✎
editing:  ┌─────────────┐
          │ 我的项目│    │  (Enter=commit, Esc=cancel)
          └─────────────┘
```
*CSS（草图，引用令牌）：*
```css
.afs-inline-edit{display:inline-flex;align-items:center;gap:var(--afs-sp-2)}
.afs-inline-edit__display{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:inherit;font:inherit;cursor:text;border-radius:var(--afs-r-sm);padding:2px 4px}
.afs-inline-edit__display:hover{background:var(--afs-hover)}
.afs-inline-edit__pencil{opacity:0;color:var(--afs-muted);transition:opacity var(--afs-dur-micro)}
.afs-inline-edit__display:hover .afs-inline-edit__pencil{opacity:1}
.afs-inline-edit__display:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-inline-edit__input{font:inherit;color:var(--afs-text);background:var(--afs-surface-sunken);border:1px solid var(--afs-accent);border-radius:var(--afs-r-sm);padding:2px 6px;outline:none;box-shadow:0 0 0 2px color-mix(in srgb,var(--afs-ring) 55%,transparent)}
```

### 5.2 Containers, overlays & feedback（24）

#### Card

**替换（Replaces）**：Legacy .afs-pcard / .afs-acard / .afs-studio__card / .afs-card resting surfaces (flat --afs-panel fills with 1px borders and hardcoded rgba(0,0,0,*) shadows).

**结构（Anatomy）**：Root <article|div> .afs-card (near-opaque solid surface, NOT glass) > optional .afs-card__media (16:9 or 1:1 cover) > .afs-card__body (title + meta) > optional .afs-card__footer (action row). Optional overlay pills (kind/ratio/count) absolutely positioned on media. Selection/category accent is injected inline as --cat (kept compatible with JS-injected colors).

**变体（Variants）**：
- resting (default)
- interactive (whole-card click/open, cursor pointer)
- media-cover (16:9 project card / 1:1 asset card)
- data (text-only, no media)
- selected (accent ring)
- category-tinted (header tint via --afs-grad-header driven by inline --cat)

**尺寸（Sizes）**：
- sm (asset grid, min 168px, --afs-r-md)
- md (project home, min 220px, --afs-r-lg)
- lg (hero/empty-state cards, --afs-r-xl)

**状态（States）**：
- default
- hover (border-strong + elev-2 lift, translateY(-1px))
- focus-visible (ring on interactive cards)
- active (scale 0.99)
- disabled (opacity .5, no hover)
- selected (2px accent ring via box-shadow)
- loading (skeleton media + shimmer)

**亮/暗（Light/Dark）**：Solid surface, never glass. Dark: depth from surface step (--afs-panel-2 over --afs-bg) + faint --afs-elev-1 contact shadow; selection ring uses --afs-accent (#8b9bff). Light: white --afs-panel-2 + real --afs-elev-1 layered shadow carries depth; selection ring full-chroma --afs-accent (#4f46e5). Overlay pills use --afs-scrim (theme-tuned) not hardcoded rgba(8,11,18,*). Category tint header uses --afs-grad-header (28%/10% mix dark, 18%/6% light).

**可访问性（A11y）**：Interactive cards are real <button>/<a> or get role='button' + tabIndex=0 + Enter/Space activation (legacy used bare clickable <div>s — must upgrade). Cover-as-trigger needs an accessible name (aria-label or visible title). Selection state exposes aria-selected/aria-pressed. focus-visible ring is 2px var(--afs-ring) offset 2px, never color-only. Decorative overlay pills are aria-hidden; status pills carry text. Cards are solid surfaces so text contrast is measured against --afs-node-bg/--afs-panel-2, both ≥4.5:1.

*预览：*
```text
+----------------------+
| [   16:9 cover    ]  |
| [badge]      [ratio] |
+----------------------+
| Project name         |
| 2h ago · 12 nodes    |
| [打开] [..] [..] [x] |
+----------------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-card{position:relative;display:flex;flex-direction:column;background:var(--afs-panel-2);border:1px solid var(--afs-border);border-radius:var(--afs-r-lg);box-shadow:var(--afs-elev-1);overflow:hidden;transition:border-color var(--afs-dur-micro) var(--afs-ease-standard),box-shadow var(--afs-dur-micro) var(--afs-ease-standard),transform var(--afs-dur-micro) var(--afs-ease-standard)}
.afs-card--interactive{cursor:pointer}
.afs-card--interactive:hover{border-color:var(--afs-border-strong);box-shadow:var(--afs-elev-2);transform:translateY(-1px)}
.afs-card--interactive:active{transform:scale(.99)}
.afs-card.is-selected{box-shadow:0 0 0 2px var(--afs-accent),var(--afs-elev-2)}
.afs-card__media{aspect-ratio:16/9;background:linear-gradient(135deg,var(--afs-node-bg),var(--afs-panel-2));object-fit:cover}
.afs-card__body{padding:var(--afs-sp-5);display:flex;flex-direction:column;gap:var(--afs-sp-2)}
.afs-card__footer{display:flex;gap:var(--afs-sp-3);padding:var(--afs-sp-3) var(--afs-sp-5);border-top:1px solid var(--afs-border)}
.afs-card:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
```

#### Panel / Section

**替换（Replaces）**：Legacy .afs-surface / .afs-app__left / .afs-app__right / .afs-section / .afs-setsec / .afs-studio__agent solid panels and ad-hoc section headers.

**结构（Anatomy）**：Root .afs-panel (solid opaque surface) > .afs-panel__head (sticky 48px: title 16/600, optional actions slot) > .afs-panel__body (scroll region, padding 12px) > optional .afs-panel__foot (pinned actions). Sections within body: .afs-section > .afs-section__title (micro-label, uppercase tracked 11/600) + content. A panel may opt into a category-tinted header via inline --cat + --afs-grad-header.

**变体（Variants）**：
- dock (left rail, border-right)
- inspector (body content, scrollable)
- settings-pane (centered max-720)
- tinted-header (per-category)
- sunken section (--afs-surface-sunken inset well)

**尺寸（Sizes）**：
- rail/dock 240px
- inspector 286px
- content max 720px
- section header 28-32px row

**状态（States）**：
- default
- scrolled (head gains hairline bottom border + elev-1)
- section collapsed/expanded (if collapsible)
- empty (delegates to Empty state)

**亮/暗（Light/Dark）**：Always solid (perf + legibility for dense content). Dark: --afs-panel base, head one step up at --afs-panel-2, separation by lightness + 1px --afs-border (no heavy shadow). Light: white --afs-panel, head --afs-panel-2, relies on --afs-border hairline; floating drawer variant adds --afs-elev-2 (replaces hardcoded rgba(0,0,0,0.3)). Sunken sections use --afs-surface-sunken in both themes.

**可访问性（A11y）**：Panels are landmark regions: use <aside>/<section> with aria-label from the title. Section titles are real headings (h2/h3) or aria-labelledby. Scroll region is keyboard-scrollable and focusable when it has no focusable children (tabIndex=0). Solid surface keeps text ≥4.5:1. Sticky head must not trap focus. Collapsible sections use a <button aria-expanded> trigger.

*预览：*
```text
+-----------------------+
| Title          [+][..]| <- sticky head
+-----------------------+
| SECTION LABEL         |
|  content content      |
|  content content      |
| SECTION LABEL         |
|  ...                  |
+-----------------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-panel{display:flex;flex-direction:column;background:var(--afs-panel);border:1px solid var(--afs-border);min-height:0}
.afs-panel__head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:var(--afs-sp-4);height:48px;padding:0 var(--afs-sp-5);font:600 16px/1.35 var(--afs-font-ui);color:var(--afs-text);background:var(--afs-panel);border-bottom:1px solid transparent;transition:border-color var(--afs-dur-ui) var(--afs-ease-standard),box-shadow var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-panel.is-scrolled .afs-panel__head{border-bottom-color:var(--afs-border);box-shadow:var(--afs-elev-1)}
.afs-panel__body{flex:1;min-height:0;overflow-y:auto;padding:var(--afs-sp-5)}
.afs-section{margin-bottom:var(--afs-sp-6)}
.afs-section__title{font:600 11px/1 var(--afs-font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--afs-muted);margin-bottom:var(--afs-sp-3)}
```

#### Drawer (inspector)

**替换（Replaces）**：Legacy .afs-app__right--float (z-index 50, hardcoded -10px 0 28px rgba(0,0,0,0.3) shadow, afs-drawer-in slide) and the Studio settings right drawer (scrim rgba(0,0,0,0.45)).

**结构（Anatomy）**：Optional scrim (only for modal drawers like Studio settings; the canvas inspector floats WITHOUT a scrim so it doesn't block the canvas). Drawer surface .afs-drawer slides in from the right edge; .afs-drawer__head (title + close) + scrollable body + pinned footer actions. Floating inspector keeps its 'mount only when a node is selected, float over canvas, do not squeeze canvas' behavior.

**变体（Variants）**：
- floating (canvas inspector, no scrim, non-modal)
- modal (Studio settings, scrim + focus trap)
- right (default)
- glass-chrome (floating inspector MAY use glass — it is static floating chrome)

**尺寸（Sizes）**：
- inspector 286px (→256 under 1200px)
- settings ≥580px
- full-height

**状态（States）**：
- entering (slide+fade in, --afs-dur-overlay emphasized)
- open
- exiting (slide out, --afs-dur-exit, ~20% faster)
- scrolled (head border)

**亮/暗（Light/Dark）**：Floating inspector glass: dark uses --afs-glass-fill + --afs-glass-blur + --afs-glass-border; light uses white-tinted glass; both add --afs-glass-highlight inset sheen. Replaces hardcoded dark shadow with --afs-elev-2 (light) / lightness step (dark). Modal drawer scrim = var(--afs-scrim) (theme-tuned 0.42 dark / 0.30 light), NOT fixed rgba(0,0,0,0.45). Under prefers-reduced-transparency the glass inspector falls back to solid --afs-surface-3.

**可访问性（A11y）**：Modal drawer: role='dialog' aria-modal='true', focus trap, Esc closes, focus returns to opener, scrim click closes. Floating non-modal inspector: NOT aria-modal (canvas stays interactive), Esc does NOT close (Delete/Backspace stays bound to editor), labelled by node title. Slide animation uses transform+opacity only (never animate width/blur). Respects prefers-reduced-motion (instant). z-index: floating inspector 50, modal drawer scrim above its content layer but below modals(100).

*预览：*
```text
                 |======|
   canvas        | Title x|
   (still        |------|
    visible)     | param |
                 | param |
                 |------|
                 |[删除]|
                 |======|
```
*CSS（草图，引用令牌）：*
```css
.afs-drawer{position:absolute;top:0;right:0;height:100%;width:286px;display:flex;flex-direction:column;background:var(--afs-panel);border-left:1px solid var(--afs-border);box-shadow:var(--afs-elev-2);z-index:50;animation:afs-drawer-in var(--afs-dur-overlay) var(--afs-ease-emphasized)}
.afs-drawer--glass{background:var(--afs-glass-fill-strong);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border-left:var(--afs-glass-border);box-shadow:var(--afs-elev-3),var(--afs-glass-highlight)}
.afs-drawer__scrim{position:fixed;inset:0;background:var(--afs-scrim);z-index:99}
@keyframes afs-drawer-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
@media (prefers-reduced-motion:reduce){.afs-drawer{animation:none}}
@media (prefers-reduced-transparency:reduce){.afs-drawer--glass{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--afs-surface-3)}}
```

#### Modal / Dialog

**替换（Replaces）**：Hand-rolled .afs-lightbox+.afs-elform editor modals, .afs-modal provider modal, ProjectStylePanel, SnapshotPanel, AND every window.confirm()/window.prompt() (which must become in-app glass dialogs driving the same async gate/cancel behavior).

**结构（Anatomy）**：Scrim .afs-modal__scrim (full-viewport) > centered glass card .afs-modal (text-bearing glass: --afs-glass-fill-strong) > .afs-modal__head (title + close X) > .afs-modal__body (scroll, .nowheel) > .afs-modal__foot (cancel + confirm). Confirm dialog variant: compact, icon + message + 2 buttons (danger/primary).

**变体（Variants）**：
- sheet (form editor, 480-520px)
- wide (provider form, 720px)
- confirm (compact 360px, destructive uses danger CTA)
- prompt (compact + single field)
- style/snapshot (titled wrapper)

**尺寸（Sizes）**：
- confirm 360px
- sheet 480-520px
- wide 720px
- max-height 86vh

**状态（States）**：
- entering (scrim fade + card scale 0.96→1, --afs-dur-overlay emphasized)
- open
- exiting (--afs-dur-exit)
- confirm-loading (CTA spinner, body locked)
- error (inline error region)

**亮/暗（Light/Dark）**：Text-bearing glass: dark rgba(17,22,34,0.80)+blur(20px)+--afs-elev-4; light rgba(255,255,255,0.86)+blur(20px)+--afs-elev-4. Scrim = var(--afs-scrim). Heaviest elevation tier (--afs-elev-4) over scrim. Reduced-transparency → opaque --afs-surface-3. Note: this is one of the ≤3-4 glass surfaces allowed per viewport; do not nest glass inside the modal body.

**可访问性（A11y）**：role='dialog' aria-modal='true', aria-labelledby head, focus trap, initial focus on first field or safest button (Cancel for destructive), Esc closes (unless busy), scrim click closes, focus returns to opener. Confirm/prompt replacing native dialogs keep the SAME async gate: Promise resolves on confirm, rejects/aborts on cancel. CTA has explicit text; danger CTA is not color-only (icon + label). Glass body is ≥55% fill (--afs-glass-fill-strong) so body text holds ≥4.5:1; forced-colors falls back to Canvas/CanvasText border.

*预览：*
```text
######################
#  +--------------+  #
#  | Title      x |  #
#  |--------------|  #
#  | body…        |  #
#  |--------------|  #
#  |   [取消][确定]|  #
#  +--------------+  #
######################
```
*CSS（草图，引用令牌）：*
```css
.afs-modal__scrim{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:var(--afs-scrim);animation:afs-fade var(--afs-dur-overlay) var(--afs-ease-standard)}
.afs-modal{width:min(520px,92vw);max-height:86vh;display:flex;flex-direction:column;background:var(--afs-glass-fill-strong);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border:var(--afs-glass-border);border-radius:var(--afs-r-xl);box-shadow:var(--afs-elev-4),var(--afs-glass-highlight);animation:afs-pop var(--afs-dur-overlay) var(--afs-ease-emphasized)}
.afs-modal--wide{width:min(720px,94vw)}.afs-modal--confirm{width:min(360px,92vw)}
.afs-modal__head{display:flex;align-items:center;justify-content:space-between;padding:var(--afs-sp-5) var(--afs-sp-6);font:600 16px/1.35 var(--afs-font-ui)}
.afs-modal__body{overflow-y:auto;padding:0 var(--afs-sp-6) var(--afs-sp-6)}
.afs-modal__foot{display:flex;justify-content:flex-end;gap:var(--afs-sp-4);padding:var(--afs-sp-5) var(--afs-sp-6);border-top:1px solid var(--afs-border)}
@keyframes afs-pop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.afs-modal,.afs-modal__scrim{animation:none}}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.afs-modal{background:var(--afs-glass-fallback)}}
```

#### Lightbox shell

**替换（Replaces）**：Legacy .afs-lbhost (z9999, scrim rgba(0,0,0,0.86), white-on-translucent-white controls), .afs-studio__lightbox (z100), asset preview .afs-lightbox (z200). NOTE: backdrop-filter is forbidden on this scrim (GPU perf with animating canvas spinners).

**结构（Anatomy）**：Opaque dark scrim (NOT glass — perf constraint). Fixed controls layer (z-index 3 above media): close (top-right), 连看/autoplay toggle (top-left, only when multi+hasVideo), prev/next nav (vertical-center), count pill (bottom-center). Centered stage: media frame (object-fit contain, max 90vw/68vh) + optional glass info/edit panel below. Busy overlay over the frame.

**变体（Variants）**：
- image
- video (native controls + 连看 autoplay)
- with-info (node-context: title/prompt/meta + chat-edit bar)
- busy (generating overlay)
- single vs multi (multi gates nav/toggle/count)

**尺寸（Sizes）**：
- control buttons 40px round-ish (--afs-r-md→pill)
- nav 44px
- count pill (--afs-r-pill)
- media caps 90vw/68vh
- info panel min(680px,92vw)/max 24vh

**状态（States）**：
- default
- control hover (fill +12%→+22% alpha / brightness)
- focus-visible (ring)
- nav active
- toggle on (autoplay, accent gradient fill — NOT hardcoded #3b82f6)
- busy (close+scrim+keys disabled)

**亮/暗（Light/Dark）**：Scrim is intentionally opaque dark in BOTH themes (it's a media theater) — keep var-able as --afs-lb-scrim but default dark. Control fills must NOT be raw white-on-white in light: use a token-driven dark chip fill (e.g. color-mix(in srgb, #000 55%, transparent)) so contrast holds. 连看 ON uses --afs-grad-accent (fixes the #3b82f6 vs accent mismatch). Info/edit panel below uses glass-chrome recipe (theme-aware). No backdrop-filter anywhere here.

**可访问性（A11y）**：role='dialog' aria-modal, Esc closes (deferred handoff: ResultViewer Esc no-ops while lightbox open), ArrowLeft/Right paging — all ignored while busy. Controls are real <button>s with aria-label (关闭/上一个/下一个/连看). Count pill is aria-live polite '{i} / {n}'. Controls sit over uncontrolled media → each control has its own scrim-backed fill ensuring icon ≥3:1 regardless of photo behind. Native <video controls> retained for scrub a11y. focus-visible ring stays visible over media.

*预览：*
```text
[连看]            [x]
   +-------------+
 < |    media    | >
   +-------------+
   |info / 提示词|
   |[重新生成][>]|
       ( 3 / 8 )
```
*CSS（草图，引用令牌）：*
```css
.afs-lb{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:rgba(0,0,0,.86)}
.afs-lb__media{max-width:90vw;max-height:68vh;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.6)}
.afs-lb__ctl{position:fixed;z-index:3;display:grid;place-items:center;width:40px;height:40px;border-radius:var(--afs-r-md);background:color-mix(in srgb,#000 50%,transparent);color:#fff;border:0;transition:background var(--afs-dur-micro) var(--afs-ease-standard)}
.afs-lb__ctl:hover{background:color-mix(in srgb,#000 65%,transparent)}
.afs-lb__ctl:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-lb__toggle.is-on{background:var(--afs-grad-accent);color:var(--afs-on-accent)}
.afs-lb__count{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:3;padding:var(--afs-sp-2) var(--afs-sp-5);border-radius:var(--afs-r-pill);background:color-mix(in srgb,#000 55%,transparent);color:#fff;font-variant-numeric:tabular-nums}
.afs-lb__busy{position:absolute;inset:0;display:grid;place-items:center;background:color-mix(in srgb,#000 45%,transparent);color:#fff}
```

#### Popover

**替换（Replaces）**：Studio model popover .afs-studio__modelpop (absolute div), and the open-state of every native <select> (whose OS popup ignored the theme) — popover-backed listbox/menu replaces native dropdown popups.

**结构（Anatomy）**：Trigger (button/select-like control) + floating .afs-popover surface (glass chrome) positioned by anchor with collision flip. Optional arrow/tail. Body holds menu items, a form cluster (model popover), or a listbox. Dismiss on outside-click / Esc.

**变体（Variants）**：
- menu (action list)
- listbox (select replacement)
- form (model config cluster)
- with-arrow
- no-arrow

**尺寸（Sizes）**：
- min 200px
- model popover ~280px
- max-height with internal scroll (auto-fit viewport)

**状态（States）**：
- entering (fade+scale 0.98 from anchor edge, --afs-dur-ui)
- open
- exiting (--afs-dur-exit)
- item hover/active/selected (see Dropdown menu)

**亮/暗（Light/Dark）**：Glass chrome recipe (the base): dark rgba(20,24,38,0.60)+blur(16px); light rgba(255,255,255,0.62)+blur(16px)+--afs-elev-3 (light leans on shadow). Sits on --afs-surface-3 opaque base conceptually. --afs-elev-3 tier. Arrow inherits glass fill + border. Reduced-transparency → solid --afs-surface-3. This is floating chrome → glass is allowed.

**可访问性（A11y）**：Trigger has aria-haspopup + aria-expanded + aria-controls. Popover role depends on content: 'menu' or 'listbox' or 'dialog' (form). Focus moves into popover on open (roving tabindex or aria-activedescendant for listbox/menu). Esc closes + returns focus to trigger. Outside click closes. Built on a headless primitive (Radix/React Aria) so keyboard/ARIA match the native control it replaces. Glass chrome with ≥3:1 borders; forced-colors → Canvas border.

*预览：*
```text
[模型 ▾]
  +----------------+
  | 文本模型       |
  | [ GPT-4o    ▾] |
  | 图像模型       |
  | [ flux      ▾] |
  | 并发数 [ 3 ]   |
  +----------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-popover{position:absolute;z-index:101;min-width:200px;background:var(--afs-glass-fill);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border:var(--afs-glass-border);border-radius:var(--afs-r-lg);box-shadow:var(--afs-elev-3),var(--afs-glass-highlight);padding:var(--afs-sp-3);transform-origin:var(--afs-pop-origin,top);animation:afs-pop var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-popover__label{font:500 12px/1.4 var(--afs-font-ui);color:var(--afs-muted);margin:var(--afs-sp-2) var(--afs-sp-2) var(--afs-sp-1)}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.afs-popover{background:var(--afs-glass-fallback)}}
@media (prefers-reduced-transparency:reduce){.afs-popover{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--afs-surface-3)}}
@media (prefers-reduced-motion:reduce){.afs-popover{animation:none}}
```

#### Tooltip

**替换（Replaces）**：Native title='' attributes carrying load-bearing meaning across icon-only buttons (fit-view/style/snapshot, rail items, lock/expand, nav arrows). Title tooltips stay as fallback but a styled tooltip is the primary affordance.

**结构（Anatomy）**：Trigger (any focusable control) + tiny floating .afs-tooltip bubble (glass chrome, single line or short) with optional arrow. Appears on hover (delay) and on keyboard focus.

**变体（Variants）**：
- default (label)
- with-shortcut (label + kbd hint)
- rich (label + sub-line)

**尺寸（Sizes）**：
- caption type 11/500
- max-width ~240px
- padding 4-8px
- --afs-r-sm

**状态（States）**：
- entering (fade+2px slide, --afs-dur-micro→ui)
- shown
- hidden (instant on blur/leave)

**亮/暗（Light/Dark）**：Glass chrome but text-bearing-small → bump to --afs-glass-fill-strong for ≥4.5:1. Dark: deep tint + faint white hairline; light: white tint + darker hairline + small --afs-elev-2 shadow. kbd hint chip uses --afs-surface-sunken + --afs-muted. Reduced-transparency → --afs-surface-3.

**可访问性（A11y）**：Use aria-describedby on the trigger pointing at the tooltip (NOT a replacement for an accessible name — icon-only buttons still need aria-label). Shows on focus AND hover; dismissible with Esc; does not steal focus; remains while pointer is over it (hover-bridge). prefers-reduced-motion removes the slide. Never the ONLY source of a control's name. Contrast: glass tooltip body ≥4.5:1 (small text) → uses strong fill tier.

*预览：*
```text
  [⚙]
   ^
 +----------------+
 | 适应视图  ⌘0  |
 +----------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-tooltip{position:absolute;z-index:120;max-width:240px;padding:var(--afs-sp-2) var(--afs-sp-4);font:500 11px/1.3 var(--afs-font-ui);color:var(--afs-text);background:var(--afs-glass-fill-strong);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border:var(--afs-glass-border);border-radius:var(--afs-r-sm);box-shadow:var(--afs-elev-2),var(--afs-glass-highlight);animation:afs-tip-in var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-tooltip kbd{margin-left:var(--afs-sp-3);padding:0 var(--afs-sp-2);font:500 10px/1.4 var(--afs-font-mono);color:var(--afs-muted);background:var(--afs-surface-sunken);border-radius:var(--afs-r-xs)}
@keyframes afs-tip-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.afs-tooltip{animation:none}}
@media (prefers-reduced-transparency:reduce){.afs-tooltip{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--afs-surface-3)}}
```

#### Dropdown menu / context menu

**替换（Replaces）**：Ad-hoc per-card action button rows and any right-click affordances; also the action-menu pattern for overflow on cramped toolbars. Shares the Popover surface.

**结构（Anatomy）**：Popover surface (glass chrome) > list of .afs-menu__item (icon + label + optional trailing shortcut/check) > optional .afs-menu__sep dividers > optional .afs-menu__label group headers. Destructive items get danger styling. Context menu = same surface positioned at pointer.

**变体（Variants）**：
- action menu
- context menu (pointer-anchored)
- with-icons
- with-checkmarks (toggle items)
- with-submenu
- destructive item

**尺寸（Sizes）**：
- item row 28-32px (--afs-control-h-sm/h)
- icon 16-18px
- menu min 180px
- --afs-r-md items inside --afs-r-lg surface

**状态（States）**：
- item default
- hover (--afs-hover fill)
- focus/active-descendant (accent-tinted fill)
- selected/checked (check icon + accent)
- disabled (text-dim, no pointer)
- danger hover (danger-tinted fill, danger text)

**亮/暗（Light/Dark）**：Inherits Popover glass. Item hover uses --afs-hover (theme-tuned). Active-descendant fill = color-mix(in srgb, var(--afs-accent) 18%, transparent). Danger fill = color-mix(in srgb, var(--afs-danger) 16%, transparent) + text var(--afs-danger) (theme-tuned, replaces hardcoded #7f1d1d). Checkmark = Check (Lucide) var(--afs-accent).

**可访问性（A11y）**：role='menu' with role='menuitem'/'menuitemcheckbox'/'menuitemradio'; roving tabindex or aria-activedescendant; Up/Down moves, Home/End, typeahead, Enter/Space activates, Esc closes + returns focus, Left/Right for submenus. Opened from a button with aria-haspopup='menu'. Danger items keep an icon (not color-only). Focused item highlight ≥3:1.

*预览：*
```text
+------------------+
| ✎ 重命名     F2 |
| ⧉ 复制       ⌘D |
| ⬇ 导出          |
|------------------|
| 🗑 删除 (danger) |
+------------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-menu{display:flex;flex-direction:column;gap:1px}
.afs-menu__item{display:flex;align-items:center;gap:var(--afs-sp-4);height:var(--afs-control-h-sm);padding:0 var(--afs-sp-4);border-radius:var(--afs-r-md);font:400 13px/1 var(--afs-font-ui);color:var(--afs-text);cursor:pointer}
.afs-menu__item:hover{background:var(--afs-hover)}
.afs-menu__item.is-active,.afs-menu__item:focus-visible{background:color-mix(in srgb,var(--afs-accent) 18%,transparent);outline:none}
.afs-menu__item[aria-disabled=true]{color:var(--afs-text-dim);pointer-events:none}
.afs-menu__item--danger:hover{background:color-mix(in srgb,var(--afs-danger) 16%,transparent);color:var(--afs-danger)}
.afs-menu__sep{height:1px;margin:var(--afs-sp-2) 0;background:var(--afs-border)}
.afs-menu__sc{margin-left:auto;font:500 11px/1 var(--afs-font-mono);color:var(--afs-muted)}
```

#### Toast / notification

**替换（Replaces）**：In-app surface mirroring window.mulby.notification.show(message, level) — the host toast API stays the SINGLE source of triggers (success/warning/error/info-default). Spec is the visual contract for any in-app rendering; call sites unchanged.

**结构（Anatomy）**：Stack container (top-right or bottom-center, fixed) > .afs-toast items: leading status icon + message text (+ optional sub-line / action button) + optional dismiss X. Auto-dismiss timer with optional progress hairline. Min display honors --afs-loader-min spirit for visibility.

**变体（Variants）**：
- success (Check / emerald)
- warning (AlertTriangle / amber)
- error (X / red)
- info (default, info azure)
- with-action
- with-progress (timed)

**尺寸（Sizes）**：
- min-width 280px
- max-width 420px
- icon 18px
- body 13/400

**状态（States）**：
- entering (slide+fade from edge, --afs-dur-overlay)
- shown
- hover (pause auto-dismiss timer)
- exiting (--afs-dur-exit)
- focus-visible (on action/dismiss)

**亮/暗（Light/Dark）**：Glass chrome (floating, short-lived, few-at-a-time) — allowed. Dark: --afs-glass-fill-strong (text-bearing) + faint hairline; light: white glass + --afs-elev-3. Status icon colors from semantic tokens (--afs-success/warning/danger/info) which are pre-tuned per theme for ≥4.5:1 text and ≥3:1 icon. Left accent bar uses the matching semantic hue. Reduced-transparency → --afs-surface-3.

**可访问性（A11y）**：Container is aria-live='polite' (info/success) or role='alert'/aria-live='assertive' (error/warning). Status is never color-only: leading Lucide icon + text. Auto-dismiss pauses on hover/focus and is long enough to read (≥ ~4s, never <1s flash). Dismiss button has aria-label. Action button is keyboard reachable. Does not steal focus.

*预览：*
```text
                +---------------------+
                |✓ 已保存到库：林夏 x|
                +---------------------+
                |⚠ 模型配置不完整    |
                +---------------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-toaststack{position:fixed;top:var(--afs-sp-6);right:var(--afs-sp-6);z-index:140;display:flex;flex-direction:column;gap:var(--afs-sp-4)}
.afs-toast{position:relative;display:flex;align-items:flex-start;gap:var(--afs-sp-4);min-width:280px;max-width:420px;padding:var(--afs-sp-5);background:var(--afs-glass-fill-strong);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border:var(--afs-glass-border);border-left:3px solid var(--afs-info);border-radius:var(--afs-r-md);box-shadow:var(--afs-elev-3),var(--afs-glass-highlight);color:var(--afs-text);animation:afs-toast-in var(--afs-dur-overlay) var(--afs-ease-emphasized)}
.afs-toast--success{border-left-color:var(--afs-success)}.afs-toast--warning{border-left-color:var(--afs-warning)}.afs-toast--error{border-left-color:var(--afs-danger)}
.afs-toast__icon{flex:0 0 auto;color:var(--afs-info)}
.afs-toast--success .afs-toast__icon{color:var(--afs-success)}.afs-toast--error .afs-toast__icon{color:var(--afs-danger)}
@keyframes afs-toast-in{from{opacity:0;transform:translateX(16px)}to{opacity:1;transform:translateX(0)}}
@media (prefers-reduced-motion:reduce){.afs-toast{animation:none}}
```

#### Badge

**替换（Replaces）**：Legacy .afs-inspector__badge (inline category color), node kind badges, .afs-pcard__kind--canvas/--studio (hardcoded blue/purple), key-status spans (#4ade80/#f59e0b).

**结构（Anatomy）**：Small inline .afs-badge: optional leading icon/dot + short label. Color comes from semantic/category/type tokens. Used for category labels, kind identity, key-presence, type. Distinct from Chip (non-interactive, identity-only) and Pill (count/status).

**变体（Variants）**：
- category (input/text/image/video/audio/output via --afs-cat-*)
- type (image/video/audio/text/json/any via --afs-type-*)
- kind (canvas/studio)
- key-status (has-key success / no-key warning, with icon)
- solid (filled) vs soft (tinted)

**尺寸（Sizes）**：
- xs (11/600, 2x6 padding, --afs-r-xs)
- sm (default, --afs-r-sm)

**状态（States）**：
- static (non-interactive by default)
- with-icon
- incomplete/warning (icon + amber)

**亮/暗（Light/Dark）**：Soft (default): background = color-mix(in srgb, var(--cat,--afs-accent) 16%, transparent), text = the same hue (theme-tuned semantic/category tokens already darken on light for ≥4.5:1). Solid: background = var(--cat), text = white(light)/dark-ink(dark) per --afs-on-accent logic. Replaces hardcoded canvas-blue/studio-purple with --afs-cat-* tokens. Key-status uses --afs-success/--afs-warning (theme-tuned, fixes #4ade80 light contrast).

**可访问性（A11y）**：Decorative-only badges get aria-hidden if the same info is in adjacent text; otherwise carry a readable label. Status badges (key-presence, incomplete) pair color with an icon AND text (never color-only). Soft variant tint flattened over surface keeps text ≥4.5:1. Category/kind colors are injected inline as --cat (must keep working) — spec wraps them with a token-aware soft background.

*预览：*
```text
[● 图像]  [视频]  [✓ 已配置 key]  [⚠ 缺少 key]
```
*CSS（草图，引用令牌）：*
```css
.afs-badge{display:inline-flex;align-items:center;gap:var(--afs-sp-2);height:18px;padding:0 var(--afs-sp-3);border-radius:var(--afs-r-sm);font:600 11px/1 var(--afs-font-ui);white-space:nowrap}
.afs-badge--soft{background:color-mix(in srgb,var(--cat,var(--afs-accent)) 16%,transparent);color:var(--cat,var(--afs-accent))}
.afs-badge--solid{background:var(--cat,var(--afs-accent));color:var(--afs-on-accent)}
.afs-badge--key{color:var(--afs-success);background:color-mix(in srgb,var(--afs-success) 14%,transparent)}
.afs-badge--nokey{color:var(--afs-warning);background:color-mix(in srgb,var(--afs-warning) 14%,transparent)}
.afs-badge svg{width:12px;height:12px}
```

#### Chip / Tag

**替换（Replaces）**：The THREE conflicting .afs-chip definitions (inspector 10px label chip L815, data pill L1656, filter pill L2578) collapsed into ONE component; also .afs-tag--cap / --edited and the undefined bare .afs-tag.

**结构（Anatomy）**：One canonical .afs-chip: optional leading dot/icon + label + optional trailing count (.afs-chip__n) or remove X. Used for metadata chips (shot/camera/duration), filter chips (selectable), and removable tags. Replaces all three legacy variants via modifiers.

**变体（Variants）**：
- meta (read-only metadata, default)
- filter (selectable, is-active)
- removable (trailing X)
- edited (accent-tinted, marks overridden)
- cap (capability tag)
- with-count

**尺寸（Sizes）**：
- sm (filter bar, 28px, --afs-r-pill)
- xs (inline meta, ~18-20px, --afs-r-xs)

**状态（States）**：
- default
- hover (text→--afs-text / border-strong)
- focus-visible (filter chips)
- is-active/selected (accent tint bg + border)
- removable hover-X
- disabled

**亮/暗（Light/Dark）**：Single token-driven recipe. Default border --afs-border, text --afs-muted, bg transparent. Active = color-mix(accent 18% bg / 50% border) + text --afs-text. Edited variant = color-mix(accent 18%) (replaces hardcoded rgba(99,102,241,0.18)). Cap variant = color-mix(in srgb,var(--afs-muted) 16%) (replaces rgba(148,163,184,0.18)). All theme-aware; light auto-darkens via tokens.

**可访问性（A11y）**：Filter chips are role='button' (single toggle) or part of a role='group' of checkboxes with aria-pressed/aria-checked; keyboard focusable, Enter/Space toggles. Removable tag X is a real <button aria-label='删除 {tag}'>. Read-only meta chips are plain text (no role). Active state exposes aria-pressed=true. One definition prevents cascade ambiguity. Tinted active bg flattened keeps text ≥4.5:1.

*预览：*
```text
( 全部 12 )  ( 图像 4 )*active*  ( 视频 2 )
[ 中景 ] [ 推镜 ] [ 5s ]   tag:[ 画风 x ]
```
*CSS（草图，引用令牌）：*
```css
.afs-chip{display:inline-flex;align-items:center;gap:var(--afs-sp-2);height:28px;padding:0 var(--afs-sp-4);font:500 11px/1.3 var(--afs-font-ui);color:var(--afs-muted);background:transparent;border:1px solid var(--afs-border);border-radius:var(--afs-r-pill);cursor:default;transition:color var(--afs-dur-micro) var(--afs-ease-standard),background var(--afs-dur-micro) var(--afs-ease-standard),border-color var(--afs-dur-micro) var(--afs-ease-standard)}
.afs-chip--xs{height:auto;padding:1px var(--afs-sp-3);border-radius:var(--afs-r-xs);font-size:10.5px}
.afs-chip--filter{cursor:pointer}
.afs-chip--filter:hover{color:var(--afs-text);border-color:var(--afs-border-strong)}
.afs-chip.is-active{color:var(--afs-text);background:color-mix(in srgb,var(--afs-accent) 18%,transparent);border-color:color-mix(in srgb,var(--afs-accent) 50%,transparent)}
.afs-chip--edited{color:var(--afs-accent);background:color-mix(in srgb,var(--afs-accent) 18%,transparent);border-color:transparent}
.afs-chip__n{font-variant-numeric:tabular-nums;opacity:.7}
.afs-chip:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-chip__x{display:grid;place-items:center;width:14px;height:14px;border:0;background:transparent;color:inherit;cursor:pointer}
```

#### Pill

**替换（Replaces）**：Count/ratio/node-count overlay pills on cards (.afs-pcard__count/__ratio/__type, hardcoded rgba(8,11,18,0.66)), lightbox count, status pills, toolbar pill.

**结构（Anatomy）**：Rounded .afs-pill (--afs-r-pill): compact label, usually numeric/short, optional leading icon. Two contexts: (a) on-media overlay (scrim-backed for legibility over uncontrolled media), (b) on-surface (token-backed).

**变体（Variants）**：
- count (tabular numeric)
- ratio/meta
- status (semantic hue)
- on-media (scrim fill)
- on-surface (token fill)
- accent (active/brand)

**尺寸（Sizes）**：
- xs (10-11px, on-media overlays)
- sm (12px, status pills)

**状态（States）**：
- static
- accent/active (gradient fill)
- semantic (success/warning/danger/info)

**亮/暗（Light/Dark）**：On-media: background = var(--afs-scrim) or color-mix(in srgb,#000 55%,transparent) + #fff text (theme-agnostic on top of media is acceptable, but token-backed). On-surface: background --afs-surface-3, text --afs-muted/--afs-text. Accent pill = var(--afs-grad-accent) + var(--afs-on-accent). Replaces hardcoded near-black pill with --afs-scrim so it's theme-tuned.

**可访问性（A11y）**：Numeric pills use font-variant-numeric:tabular-nums and aria-live when they change (e.g. lightbox count). On-media pills carry their OWN scrim fill so text holds ≥4.5:1 regardless of media behind. Status pills pair hue with text/icon (not color-only). Decorative ratio pills aria-hidden if redundant.

*预览：*
```text
media corner: (16:9)            (×4)
 status:      ( ● 运行中 )  ( 3 / 8 )
```
*CSS（草图，引用令牌）：*
```css
.afs-pill{display:inline-flex;align-items:center;gap:var(--afs-sp-2);height:20px;padding:0 var(--afs-sp-3);border-radius:var(--afs-r-pill);font:500 11px/1 var(--afs-font-ui);font-variant-numeric:tabular-nums}
.afs-pill--onmedia{background:var(--afs-scrim);color:#fff;backdrop-filter:none}
.afs-pill--surface{background:var(--afs-surface-3);color:var(--afs-muted)}
.afs-pill--accent{background:var(--afs-grad-accent);color:var(--afs-on-accent)}
.afs-pill--success{background:color-mix(in srgb,var(--afs-success) 16%,transparent);color:var(--afs-success)}
.afs-pill--danger{background:color-mix(in srgb,var(--afs-danger) 16%,transparent);color:var(--afs-danger)}
```

#### Status dot

**替换（Replaces）**：8px solid color dots on node headers (queued #fbbf24 / running #3b82f6 / done #10b981 / error #ef4444) and provider default radio dot — color-only status that must gain non-color cues.

**结构（Anatomy）**：Tiny round .afs-dot (--afs-r-round) filled with a semantic token. ALWAYS paired with a label or icon nearby (or wrapped in a labelled element) — never the sole status signal. Running state animates a subtle breathe/halo.

**变体（Variants）**：
- queued (warning)
- running (info, breathing halo)
- done (success)
- error (danger)
- idle/default (muted)
- with-ring (selected/default-provider)

**尺寸（Sizes）**：
- 8px (node)
- 10px (lists)
- 6px (inline)

**状态（States）**：
- static (queued/done/error/idle)
- running (breathe animation, opacity+scale, --afs-dur-breathe)
- selected ring

**亮/暗（Light/Dark）**：Uses --afs-success/warning/danger/info (theme-tuned: lighter on dark, darkened on light). Running halo = --afs-info via a blurred ::after at low opacity (animate opacity only). Selected/default ring = box-shadow 0 0 0 2px color-mix(hue 30%, transparent). Replaces all hardcoded status hexes with semantic tokens.

**可访问性（A11y）**：Status MUST NOT be color-only: dot is accompanied by a text label (e.g. '运行中') or a tooltip + icon, and the container exposes the state via aria-label / aria-live. Running breathe respects prefers-reduced-motion (static at full opacity). Dot itself is aria-hidden when the state is also in text. Color tokens are theme-tuned semantic hues (≥3:1 as a non-text indicator against its surface).

*预览：*
```text
● 排队中   ◉ 运行中   ● 完成   ● 失败
(amber)   (azure*)   (green)  (red)
```
*CSS（草图，引用令牌）：*
```css
.afs-dot{display:inline-block;width:8px;height:8px;border-radius:var(--afs-r-round);background:var(--afs-text-dim);position:relative}
.afs-dot--queued{background:var(--afs-warning)}.afs-dot--running{background:var(--afs-info)}.afs-dot--done{background:var(--afs-success)}.afs-dot--error{background:var(--afs-danger)}
.afs-dot--running::after{content:'';position:absolute;inset:-3px;border-radius:inherit;background:var(--afs-info);opacity:.4;animation:afs-breathe var(--afs-dur-breathe) cubic-bezier(.45,0,.55,1) infinite}
@keyframes afs-breathe{0%,100%{opacity:.25;transform:scale(.9)}50%{opacity:.5;transform:scale(1.25)}}
@media (prefers-reduced-motion:reduce){.afs-dot--running::after{animation:none;opacity:.4}}
```

#### Progress bar

**替换（Replaces）**：Node fan-out progress .afs-node__progress (track rgba(255,255,255,0.08), bar hardcoded #3b82f6→#06b6d4 gradient) — the determinate render/generation progress for non-text AI artifacts.

**结构（Anatomy）**：Track .afs-progress (rounded) + fill .afs-progress__bar (width = percent, --afs-grad-progress) + optional moving sheen overlay + optional centered/aside .afs-progress__txt ('done/total · N failed', tabular). Determinate by default; indeterminate variant for unknown-length.

**变体（Variants）**：
- determinate (width %)
- indeterminate (sliding sheen)
- with-label (overlay text)
- thin (16px pill in node)
- inline (settings/usage)

**尺寸（Sizes）**：
- thin 6-8px height (node pill ~16px tall track)
- default 4px

**状态（States）**：
- progressing (animated width)
- with-failures (text shows N failed)
- complete (100%)
- indeterminate (loop sheen)

**亮/暗（Light/Dark）**：Track = --afs-surface-sunken (replaces rgba(255,255,255,0.08) which was invisible on light). Fill = --afs-grad-progress (theme-tuned: #6d7cff→#4fd0e0 dark, #5b54ff→#06b6d4 light). Sheen = linear-gradient white-alpha overlay, lower alpha on light. Label text --afs-text over fill needs the moving fill to stay legible → label sits on track area / uses scrim if over fill.

**可访问性（A11y）**：role='progressbar' with aria-valuemin/max/now (omit valuenow for indeterminate). aria-label or aria-labelledby describes what's rendering. Numeric label uses tabular-nums. Failure count surfaced in the label (text, not color). Sheen animation is linear loop, stopped on complete and under prefers-reduced-motion. Animate width via transform/inline width, never layout thrash on many nodes.

*预览：*
```text
[████████░░░░░░░░]  5/8 · 1 failed
[░░░░██████░░░░░░]  (indeterminate)
```
*CSS（草图，引用令牌）：*
```css
.afs-progress{position:relative;height:6px;border-radius:var(--afs-r-pill);background:var(--afs-surface-sunken);overflow:hidden}
.afs-progress__bar{height:100%;border-radius:inherit;background:var(--afs-grad-progress);transition:width var(--afs-dur-ui) var(--afs-ease-standard)}
.afs-progress__bar::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent);transform:translateX(-100%);animation:afs-sheen var(--afs-dur-shimmer) linear infinite}
.afs-progress--indeterminate .afs-progress__bar{width:35%;animation:afs-indet var(--afs-dur-shimmer) var(--afs-ease-move) infinite}
.afs-progress__txt{font:500 11px/1 var(--afs-font-mono);font-variant-numeric:tabular-nums;color:var(--afs-muted)}
@keyframes afs-sheen{to{transform:translateX(200%)}}
@keyframes afs-indet{0%{margin-left:-35%}100%{margin-left:100%}}
@media (prefers-reduced-motion:reduce){.afs-progress__bar::after,.afs-progress--indeterminate .afs-progress__bar{animation:none}}
```

#### Spinner

**替换（Replaces）**：Loader2 + afs-spin keyframe usage scattered across run buttons, lightbox busy, tiles, agent panel — the GENERATING/short-load indicator (distinct from the PROCESSING breathe and from Skeleton).

**结构（Anatomy）**：Lucide Loader2 (or an SVG ring) rotating via afs-spin. Sizes 12/14/18. Optional adjacent label ('生成中…'). Used for in-flight actions on buttons and busy overlays. Honors 1s minimum display so it never flashes.

**变体（Variants）**：
- icon-only (in buttons/tiles)
- with-label (生成中…)
- on-accent (inside primary button, inherits on-accent color)
- overlay (centered in busy scrim)

**尺寸（Sizes）**：
- sm 12px
- md 14px (buttons)
- lg 18-24px (overlays)

**状态（States）**：
- spinning (continuous)
- with-label

**亮/暗（Light/Dark）**：stroke=currentColor → inherits --afs-text / --afs-on-accent depending on context, so no per-theme color needed. On accent button it uses --afs-on-accent (dark-ink on dark theme luminous accent, white on light). Continuous rotate is fine (transform only). Reduced-motion handled by the global animation cap.

**可访问性（A11y）**：Spinner SVG is aria-hidden; the surrounding control sets aria-busy='true' and/or has a visible/labelled '生成中…' text and role='status' aria-live='polite' for the busy region. Minimum display ~1s (--afs-loader-min) to avoid flicker. Under prefers-reduced-motion, replace continuous spin with a slow opacity pulse or static icon (animation neutralized globally). Color inherits currentColor (recolors per theme).

*预览：*
```text
(◴) 生成中…    [ (◴) 运行 ]  (in button)
```
*CSS（草图，引用令牌）：*
```css
.afs-spin{animation:afs-spin 0.8s linear infinite}
@keyframes afs-spin{to{transform:rotate(360deg)}}
.afs-spinner{display:inline-flex;color:currentColor}
.afs-spinner--lg{color:var(--afs-muted)}
@media (prefers-reduced-motion:reduce){.afs-spin{animation:afs-pulse-op 1.4s var(--afs-ease-standard) infinite}}
@keyframes afs-pulse-op{0%,100%{opacity:.5}50%{opacity:1}}
```

#### Skeleton / shimmer

**替换（Replaces）**：The bare '加载工程中…' muted text and missing loading affordances (asset thumbs, cards, data lists). Implements the two-AI-states model: PROCESSING (skeleton breathe) and GENERATING/STREAMING (shimmer sweep on in-flight text).

**结构（Anatomy）**：Placeholder blocks .afs-skel (rounded rects matching final content shape) with a moving shimmer sweep. STREAMING text variant overlays a gradient sweep on partially-rendered tokens; PROCESSING variant breathes opacity. Composed into skeleton cards / list rows / media tiles.

**变体（Variants）**：
- block (rect)
- text-line (varying widths)
- media-tile (square/16:9)
- card (composed)
- streaming-text (token shimmer sweep)
- processing (breathe, pre-first-token)

**尺寸（Sizes）**：
- matches target (line 12-16px tall, tile aspect-locked)

**状态（States）**：
- shimmering (sweep loop)
- breathing (processing)
- settled (removed once content arrives — stop animation instantly)

**亮/暗（Light/Dark）**：Base = --afs-surface-sunken. Shimmer gradient = subtle white-alpha on dark, subtle darker-alpha on light (theme-tuned via a mix). Dark uses a faint highlight sweep; light uses a faint shadow-direction sweep so it reads on white. STREAMING text sweep uses the brand gradient at low opacity to signal AI generation. Never animate backdrop-filter.

**可访问性（A11y）**：Skeleton containers are aria-hidden='true' and the live region announces a 'loading' status via role='status' aria-live='polite' once (not per-block). Minimum 1s display (--afs-loader-min). Shimmer/breathe are linear/eased loops disabled under prefers-reduced-motion (static muted block). Only opacity/transform animated (protects INP with many nodes). Stop animation the instant real content replaces it.

*预览：*
```text
+----------------+
| ▭▭▭▭▭ (sweep)  |
| ▬▬▬▬▬▬▬▬       |
| ▬▬▬▬▬          |
+----------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-skel{position:relative;background:var(--afs-surface-sunken);border-radius:var(--afs-r-sm);overflow:hidden}
.afs-skel::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--afs-text) 8%,transparent),transparent);transform:translateX(-100%);animation:afs-sheen var(--afs-dur-shimmer) linear infinite}
.afs-skel--line{height:12px;border-radius:var(--afs-r-xs)}
.afs-skel--tile{aspect-ratio:1;border-radius:var(--afs-r-md)}
.afs-skel--processing{animation:afs-pulse-op var(--afs-dur-breathe) cubic-bezier(.45,0,.55,1) infinite}
.afs-stream-text{background:linear-gradient(90deg,var(--afs-text) 0,var(--afs-text) 40%,color-mix(in srgb,var(--afs-accent) 60%,var(--afs-text)) 50%,var(--afs-text) 60%);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;animation:afs-stream var(--afs-dur-shimmer) linear infinite}
@keyframes afs-stream{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.afs-skel::after,.afs-skel--processing,.afs-stream-text{animation:none}}
```

#### Empty state

**替换（Replaces）**：Plain muted-text empty states ('未选中节点', '加载工程中…', '没有打开的工作流项目', faded Clapperboard, .afs-lib__empty / .afs-dockpanel__empty / .afs-studio__empty).

**结构（Anatomy）**：Centered column .afs-empty: large Lucide icon (low-emphasis) over the aurora-tinted backdrop, a display heading (22/600), a muted hint line, and optional primary/secondary action buttons. The aurora backdrop garnish appears here (one of its sanctioned spots).

**变体（Variants）**：
- no-selection (inspector)
- no-data (gallery/library)
- no-project (studio)
- loading (with spinner instead of icon)
- with-actions (CTA buttons)

**尺寸（Sizes）**：
- icon 40-48px
- heading 22px
- hint 13px
- generous spacing (uses sp-7/8/9 — breathing room is spent here)

**状态（States）**：
- static
- loading (spinner + 'loading' status)
- with-actions hover/focus on buttons

**亮/暗（Light/Dark）**：Background may show --afs-aurora (static, low-opacity) as the substrate. Icon = --afs-text-dim (now DEFINED in both themes, clears 3:1). Heading --afs-text, hint --afs-muted. Light aurora = soft pastel blobs; dark aurora = deeper low-opacity orbs. Never animated. This is the place breathing room and the aurora garnish live, not in dense inspectors.

**可访问性（A11y）**：Heading is a real heading element. Icon is aria-hidden (decorative). If it's a loading empty state, wrap in role='status' aria-live='polite'. Action buttons are real buttons with clear labels. Hint text ≥4.5:1 (uses --afs-muted, not undefined dims). Aurora backdrop is purely decorative (aria-hidden) and static (no motion). Replaces the broken undefined --afs-text-dim usage with defined tokens.

*预览：*
```text
     ( aurora glow )
         [ 🎬 ]
     没有打开的项目
  从模板新建或导入一个工程
   [新建画布]  [新建工作流]
```
*CSS（草图，引用令牌）：*
```css
.afs-empty{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--afs-sp-5);min-height:100%;padding:var(--afs-sp-9);text-align:center}
.afs-empty::before{content:'';position:absolute;inset:0;background:var(--afs-aurora);opacity:.5;z-index:-1;pointer-events:none}
.afs-empty__icon{color:var(--afs-text-dim)}
.afs-empty__title{font:600 22px/1.3 var(--afs-font-ui);color:var(--afs-text)}
.afs-empty__hint{font:400 13px/1.5 var(--afs-font-ui);color:var(--afs-muted);max-width:42ch}
.afs-empty__actions{display:flex;gap:var(--afs-sp-4);margin-top:var(--afs-sp-3)}
```

#### Media tile / thumbnail card

**替换（Replaces）**：Node grid tiles (.afs-node__tile, bg rgba(255,255,255,0.05)), GenItemTile/NodeTile, gallery MediaTile, RvTile, asset cards' thumbs — the lazy-loaded image/video tile with status overlays.

**结构（Anatomy）**：Square/aspect .afs-tile: media (img/video object-fit cover) lazy-mounted (useInView), optional caption bar (gradient-scrim bottom), status overlays (done check / failed X+error / pending Loader2 / selected check), optional ×count badge, click→lightbox. Failed and pending are first-class states.

**变体（Variants）**：
- image
- video (loop muted thumbnail)
- audio (icon placeholder, no media fetch)
- done
- failed (danger box + retry affordance)
- pending (skeleton + spinner)
- selected (accent ring)

**尺寸（Sizes）**：
- 76px (node fan-out)
- 120px (result grid)
- 168px (asset card)
- aspect-locked 1:1 or 16:9

**状态（States）**：
- loading (skeleton)
- loaded default
- hover (slight zoom/overlay, cursor zoom-in)
- focus-visible (ring)
- selected (accent ring + check)
- failed (danger border + X, hover error)
- pending (dashed + spinner)

**亮/暗（Light/Dark）**：Tile bg = --afs-surface-sunken (replaces rgba(255,255,255,0.05) that vanished on light). Caption scrim = linear-gradient to var(--afs-scrim). Failed = border var(--afs-danger) + bg color-mix(danger 12%). Pending dashed border --afs-border + spinner --afs-info. Selected ring = 2px var(--afs-accent). Object-fit:cover preserved (framing semantics). All status hues from semantic tokens.

**可访问性（A11y）**：Tile is a real <button> (or role='button' + tabIndex) with aria-label (caption/shot/index) so it's keyboard-openable (legacy used clickable <div>s — must fix). Status overlays pair icon + accessible text (failed shows error in aria-label/tooltip; not color-only). Selected exposes aria-pressed/aria-selected + check icon. Video thumbnails are decorative (muted/loop) — full controls live in the lightbox. focus-visible ring over media uses scrim-safe --afs-ring.

*预览：*
```text
+------+ +------+ +------+
|image | |  ◴   | |  ✗   |
|  ✓ ×4| |pending| |failed|
|caption| |      | |      |
+------+ +------+ +------+
```
*CSS（草图，引用令牌）：*
```css
.afs-tile{position:relative;display:block;width:100%;aspect-ratio:1;background:var(--afs-surface-sunken);border:1px solid var(--afs-border);border-radius:var(--afs-r-md);overflow:hidden;cursor:zoom-in;padding:0}
.afs-tile img,.afs-tile video{width:100%;height:100%;object-fit:cover;display:block}
.afs-tile:hover{border-color:var(--afs-border-strong)}
.afs-tile:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-tile.is-selected{box-shadow:0 0 0 2px var(--afs-accent)}
.afs-tile--failed{border-color:var(--afs-danger);background:color-mix(in srgb,var(--afs-danger) 12%,transparent);color:var(--afs-danger);display:grid;place-items:center;cursor:default}
.afs-tile--pending{border-style:dashed;display:grid;place-items:center;color:var(--afs-info)}
.afs-tile__cap{position:absolute;left:0;right:0;bottom:0;padding:var(--afs-sp-3);font:500 10px/1.2 var(--afs-font-ui);color:#fff;background:linear-gradient(transparent,var(--afs-scrim))}
.afs-tile__count{position:absolute;top:var(--afs-sp-2);right:var(--afs-sp-2)}
```

#### Divider

**替换（Replaces）**：Ad-hoc 1px hairline borders/separators, .afs-io dashed-bottom rows, .afs-lib__sep, section separators — unified into one token-driven rule.

**结构（Anatomy）**：Thin rule .afs-divider, horizontal (default) or vertical, solid (default) or dashed (for IO/dotted contexts), optional inset margins, optional centered label.

**变体（Variants）**：
- horizontal
- vertical
- solid
- dashed (IO rows)
- with-label (centered text)
- inset (margins)

**尺寸（Sizes）**：
- 1px thickness
- margin via sp tokens

**状态（States）**：
- static

**亮/暗（Light/Dark）**：Default --afs-border (low-contrast so panels don't read as a grid of boxes). Strong separators (ruler/track headers) --afs-border-strong. Dashed variant for IO rows uses --afs-border. Theme-tuned automatically. Vertical divider in toolbars same tokens.

**可访问性（A11y）**：Decorative dividers use role='separator' (or are aria-hidden if purely visual). Labelled dividers expose the label as text. Never the only grouping cue for a region (pair with headings). Color clears the non-text 3:1 expectation as a separator (uses --afs-border / --afs-border-strong).

*预览：*
```text
────────────────────
──── SECTION ───────
- - - - - - - - - -  (dashed IO)
  a │ b │ c  (vertical)
```
*CSS（草图，引用令牌）：*
```css
.afs-divider{border:0;height:1px;background:var(--afs-border);margin:var(--afs-sp-4) 0}
.afs-divider--strong{background:var(--afs-border-strong)}
.afs-divider--dashed{height:0;background:none;border-top:1px dashed var(--afs-border)}
.afs-divider--vertical{width:1px;height:auto;align-self:stretch;margin:0 var(--afs-sp-4)}
.afs-divider--label{display:flex;align-items:center;gap:var(--afs-sp-4);background:none;border:0;color:var(--afs-muted);font:600 11px/1 var(--afs-font-ui);text-transform:uppercase;letter-spacing:.06em}
.afs-divider--label::before,.afs-divider--label::after{content:'';flex:1;height:1px;background:var(--afs-border)}
```

#### Toolbar

**替换（Replaces）**：Legacy .afs-toolbar (48px, amber #f59e0b logo, native model selects, ambiguous 运行/保存 sharing afs-btn--save), Studio topbar — the floating chrome bar.

**结构（Anatomy）**：Glass chrome bar .afs-toolbar: left group (brand/title + status), flexible spacer, right group (controls). Groups separated by vertical Dividers. Holds: editable title (Toolbar rename flow), status meta (with status dot/icon), control buttons, custom Selects (model pickers), and ONE primary CTA (Run) visually distinct from secondary (Save).

**变体（Variants）**：
- editor (canvas)
- studio (workbench)
- pill (floating rounded) vs edge (full-width top bar)
- compact (overflow → menu under narrow widths)

**尺寸（Sizes）**：
- 48px height
- control rows 28-32px
- icon 18px in 36-40px targets

**状态（States）**：
- default
- scrolled/elevated (gains shadow over content)
- running (Run→Stop swap, primary glow)
- saving (status spinner)

**亮/暗（Light/Dark）**：Glass chrome: dark rgba(20,24,38,0.60)+blur(16px); light white glass + --afs-elev-3. Brand mark uses --afs-grad-brand (replaces hardcoded amber #f59e0b, unifying the two-accent clash). Vertical dividers --afs-border. Run CTA fill = --afs-grad-accent + --afs-glow (running). Save = neutral/ghost button. Reduced-transparency → solid --afs-panel. One of the sanctioned glass surfaces.

**可访问性（A11y）**：role='toolbar' with aria-label, arrow-key roving focus between controls, logical group order preserved. Icon-only buttons have aria-label (titles kept). Primary CTA (Run) is visually + semantically primary (accent gradient + glow), Save is secondary — distinct anatomy (fixes the ambiguity). Status meta is aria-live polite. Title is an editable text field with proper label (Toolbar rename: Enter commits, Esc cancels). Consistent icon sizing (one size, fixes 14 vs 15).

*预览：*
```text
[◳] 项目名 ✎  · 12 节点 已保存          [模型▾][图像▾] │ [⤢][保存] │ [▶运行]*glow*
```
*CSS（草图，引用令牌）：*
```css
.afs-toolbar{display:flex;align-items:center;gap:var(--afs-sp-4);height:48px;padding:0 var(--afs-sp-5);background:var(--afs-glass-fill);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border-bottom:var(--afs-glass-border);box-shadow:var(--afs-glass-highlight)}
.afs-toolbar__brand{display:grid;place-items:center;width:28px;height:28px;border-radius:var(--afs-r-md);background:var(--afs-grad-brand);color:var(--afs-on-accent)}
.afs-toolbar__spacer{flex:1}
.afs-toolbar__meta{display:inline-flex;align-items:center;gap:var(--afs-sp-3);font:500 12px/1 var(--afs-font-ui);color:var(--afs-muted);font-variant-numeric:tabular-nums}
.afs-toolbar__group{display:inline-flex;align-items:center;gap:var(--afs-sp-3)}
@media (prefers-reduced-transparency:reduce){.afs-toolbar{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--afs-panel)}}
```

#### Nav-rail item

**替换（Replaces）**：Legacy .afs-rail__item (48px, 10px labels @0.92 scale, subtle 22% accent tint + 3px edge bar, amber brand) and the orphaned-active-state problem for assets/prompts views.

**结构（Anatomy）**：Vertical rail .afs-rail (slightly wider than 56px for comfort) > brand mark (top) > .afs-rail__item buttons (icon 18-20px + small label) > spacer > theme toggle + settings (bottom). Active item shows accent indicator bar + gradient-tinted icon. Items are a shared IconButton-like primitive (fixes per-element restyle risk).

**变体（Variants）**：
- nav (home/studio/editor)
- utility (theme toggle, settings)
- brand (top mark)
- active (gradient indicator)
- with-tooltip (collapsed labels)

**尺寸（Sizes）**：
- item 44-48px target
- icon 18-20px
- label 10-11px micro

**状态（States）**：
- default (muted icon)
- hover (--afs-hover fill)
- focus-visible (ring)
- active/selected (accent bar + tinted icon + accent text)
- disabled

**亮/暗（Light/Dark）**：Active indicator = --afs-grad-accent bar (3px) + icon recolored to --afs-accent + label --afs-text; active fill = color-mix(accent 16%). Brand = --afs-grad-brand (replaces amber). Hover = --afs-hover. Theme-tuned accents (dark desaturated #8b9bff, light #4f46e5). Rail surface = --afs-panel solid (dense nav, not glass) OR glass if treated as floating chrome — default solid for perf.

**可访问性（A11y）**：Rail is <nav aria-label='主导航'>. Items are <button> with accessible name (label text + title/aria-label). Active item exposes aria-current='page'. Roving tabindex within the rail; Up/Down arrow navigation optional. Active indicator is not color-only (bar + icon weight/label). Theme toggle button label states the TARGET theme. Ensures assets/prompts restored views don't leave an orphaned highlight (map them to a sensible active item or none, documented).

*预览：*
```text
│ [◳]   │ brand
│ ▌[⬚]  │ 项目  *active bar
│  [▦]  │ 工作台
│  [⛓]  │ 画布
│  ⋮    │
│  [☾]  │ theme
│  [⚙]  │ 设置
```
*CSS（草图，引用令牌）：*
```css
.afs-rail{display:flex;flex-direction:column;align-items:center;gap:var(--afs-sp-3);width:60px;padding:var(--afs-sp-4) 0;background:var(--afs-panel);border-right:1px solid var(--afs-border)}
.afs-rail__item{position:relative;display:flex;flex-direction:column;align-items:center;gap:var(--afs-sp-1);width:44px;height:44px;justify-content:center;border:0;border-radius:var(--afs-r-md);background:transparent;color:var(--afs-muted);font:600 10px/1 var(--afs-font-ui);cursor:pointer;transition:background var(--afs-dur-micro) var(--afs-ease-standard),color var(--afs-dur-micro) var(--afs-ease-standard)}
.afs-rail__item:hover{background:var(--afs-hover);color:var(--afs-text)}
.afs-rail__item:focus-visible{outline:2px solid var(--afs-ring);outline-offset:2px}
.afs-rail__item[aria-current=page]{color:var(--afs-accent);background:color-mix(in srgb,var(--afs-accent) 16%,transparent)}
.afs-rail__item[aria-current=page]::before{content:'';position:absolute;left:-6px;top:10px;bottom:10px;width:3px;border-radius:var(--afs-r-pill);background:var(--afs-grad-accent)}
```

#### Avatar

**替换（Replaces）**：Agent chat speaker indicators (SpeakerAv) and any user/assistant identity marks in the AgentPanel; new primitive (legacy had none formalized).

**结构（Anatomy）**：Round .afs-avatar (--afs-r-round): image OR initials OR icon fallback. Agent variant uses a Bot icon over a brand-gradient fill; user variant uses initials/neutral. Optional status dot overlay (corner). Processing variant breathes (the 'thinking' orb).

**变体（Variants）**：
- image
- initials
- icon (agent Bot)
- agent (brand gradient)
- user (neutral)
- with-status (corner dot)
- processing (breathing thinking orb)

**尺寸（Sizes）**：
- xs 20px
- sm 24px
- md 32px
- lg 40px

**状态（States）**：
- static
- processing (breathe opacity+scale, pre-first-token)
- with-status dot

**亮/暗（Light/Dark）**：Agent avatar fill = --afs-grad-brand, icon color --afs-on-accent. User avatar = --afs-surface-3 + --afs-text initials. Processing 'thinking' orb = brand gradient + a breathing ::after glow (--afs-glow style, animate opacity). Status dot overlay uses semantic tokens. Theme-tuned via tokens; gradient stops differ per theme automatically.

**可访问性（A11y）**：Image avatars have alt text (name) or are aria-hidden if name is adjacent. Icon/initials fallbacks carry aria-label only if standalone. Corner status dot pairs with text elsewhere (not color-only). Processing breathe respects prefers-reduced-motion. Decorative agent orb is aria-hidden when 'AI 制片' label is present.

*预览：*
```text
(🤖)  agent     (LX)  user
 (◉) processing-orb breathing
```
*CSS（草图，引用令牌）：*
```css
.afs-avatar{position:relative;display:grid;place-items:center;width:32px;height:32px;border-radius:var(--afs-r-round);overflow:hidden;background:var(--afs-surface-3);color:var(--afs-text);font:600 12px/1 var(--afs-font-ui);flex:0 0 auto}
.afs-avatar img{width:100%;height:100%;object-fit:cover}
.afs-avatar--agent{background:var(--afs-grad-brand);color:var(--afs-on-accent)}
.afs-avatar--processing::after{content:'';position:absolute;inset:-4px;border-radius:inherit;background:var(--afs-grad-accent);filter:blur(10px);opacity:var(--afs-glow-opacity);z-index:-1;animation:afs-breathe var(--afs-dur-breathe) cubic-bezier(.45,0,.55,1) infinite}
.afs-avatar__status{position:absolute;right:-1px;bottom:-1px;border:2px solid var(--afs-panel);border-radius:var(--afs-r-round)}
@media (prefers-reduced-motion:reduce){.afs-avatar--processing::after{animation:none}}
```

#### Scrollbar styling

**替换（Replaces）**：Existing *::-webkit-scrollbar (8px, thumb=--afs-dot) — keep but tokenize/theme properly and add reduced-prominence + hover behavior.

**结构（Anatomy）**：Custom thin scrollbar on scroll regions: track (transparent/sunken), thumb (rounded, low-contrast, brightens on hover). Applied to panel bodies, lists, data cards (.nowheel preserved on canvas data lists).

**变体（Variants）**：
- default (thin overlay)
- panel (on solid surface)
- subtle (auto-hide-ish low alpha)

**尺寸（Sizes）**：
- 8px width
- thumb radius --afs-r-pill

**状态（States）**：
- default (faint thumb)
- hover (thumb brighter)
- active (dragging)

**亮/暗（Light/Dark）**：Thumb = --afs-border-strong (visible but calm) → hover --afs-muted. Track transparent or --afs-surface-sunken. Dark and light both derive from tokens (replaces raw --afs-dot which is canvas-grid colored). Firefox scrollbar-width:thin + scrollbar-color tokens. forced-colors:active → leave system default.

**可访问性（A11y）**：Cosmetic only — never the sole scroll mechanism; keyboard scroll (focusable region tabIndex=0, arrow/PageUp/Down) must work regardless. Thumb contrast vs track ≥3:1 so it's perceivable. Does not remove native scroll affordance for users who rely on it. Respects forced-colors (falls back to system scrollbar). Don't hide scrollbar entirely on touch/AT contexts.

*预览：*
```text
│content        ▏│
│content        █│ <- thumb
│content        █│
│content        ▏│
```
*CSS（草图，引用令牌）：*
```css
.afs-scroll{scrollbar-width:thin;scrollbar-color:var(--afs-border-strong) transparent}
.afs-scroll::-webkit-scrollbar{width:8px;height:8px}
.afs-scroll::-webkit-scrollbar-track{background:transparent}
.afs-scroll::-webkit-scrollbar-thumb{background:var(--afs-border-strong);border-radius:var(--afs-r-pill);border:2px solid transparent;background-clip:content-box}
.afs-scroll::-webkit-scrollbar-thumb:hover{background:var(--afs-muted);background-clip:content-box}
@media (forced-colors:active){.afs-scroll{scrollbar-color:auto}}
```

#### Command-palette item

**替换（Replaces）**：New primitive for a future command palette (sanctioned glass surface in the foundation). Provides searchable action/nav rows; complements Dropdown menu but for global command search.

**结构（Anatomy）**：Command palette = glass surface (modal-ish overlay) with a search input header + scrollable .afs-cmd__list of .afs-cmd__item rows: leading icon + primary label + optional secondary/context + trailing shortcut. Group headers + match highlight. Active row via aria-activedescendant.

**变体（Variants）**：
- action item
- navigation item (go to view)
- recent
- with-shortcut
- group header
- no-results

**尺寸（Sizes）**：
- palette width min(640px,92vw)
- item row 36-40px
- icon 18px
- label 13px, context 11px muted

**状态（States）**：
- default
- active (keyboard-highlighted, accent tint)
- hover (--afs-hover)
- selected/disabled
- match-highlight (query substring emphasized)

**亮/暗（Light/Dark）**：Glass chrome (sanctioned): dark rgba(20,24,38,0.60)+blur(16px) → strong fill for the input area; light white glass + --afs-elev-4. Active row = color-mix(accent 18%) + accent left tick. Shortcut chips = --afs-surface-sunken + --afs-muted (mono). Match highlight = --afs-accent text or color-mix(accent 22%) background. Reduced-transparency → --afs-surface-3. Elevation --afs-elev-4 (top overlay).

**可访问性（A11y）**：Palette is role='dialog'; input is role='combobox' aria-expanded aria-controls=listbox; list is role='listbox'; items role='option' with aria-selected; aria-activedescendant tracks the highlighted item (focus stays in input). Up/Down moves activedescendant, Enter runs, Esc closes. Typeahead filters; no-results announced via aria-live. Match highlight is visual emphasis only (text remains full label for SR). Glass body ≥55% fill for input/label contrast.

*预览：*
```text
+--------------------------------+
| 🔍 search…                     |
|--------------------------------|
| ⬚ 打开画布            ⌘1  *act|
| ▦ 新建工作流                   |
| ⚙ 设置 · 模型供应商        ⌘, |
+--------------------------------+
```
*CSS（草图，引用令牌）：*
```css
.afs-cmd{width:min(640px,92vw);max-height:60vh;display:flex;flex-direction:column;background:var(--afs-glass-fill-strong);-webkit-backdrop-filter:var(--afs-glass-blur);backdrop-filter:var(--afs-glass-blur);border:var(--afs-glass-border);border-radius:var(--afs-r-xl);box-shadow:var(--afs-elev-4),var(--afs-glass-highlight)}
.afs-cmd__input{height:48px;padding:0 var(--afs-sp-6);background:transparent;border:0;border-bottom:1px solid var(--afs-border);color:var(--afs-text);font:400 14px/1 var(--afs-font-ui)}
.afs-cmd__list{overflow-y:auto;padding:var(--afs-sp-3)}
.afs-cmd__item{display:flex;align-items:center;gap:var(--afs-sp-4);height:40px;padding:0 var(--afs-sp-4);border-radius:var(--afs-r-md);color:var(--afs-text);cursor:pointer}
.afs-cmd__item[aria-selected=true]{background:color-mix(in srgb,var(--afs-accent) 18%,transparent)}
.afs-cmd__ctx{color:var(--afs-muted);font-size:11px}
.afs-cmd__sc{margin-left:auto;font:500 11px/1 var(--afs-font-mono);color:var(--afs-muted);background:var(--afs-surface-sunken);padding:0 var(--afs-sp-2);border-radius:var(--afs-r-xs)}
.afs-cmd__mark{color:var(--afs-accent);font-weight:600}
```

---

## 6. 逐屏重设计（10 个界面）

每屏给出：中文摘要 → 重设计概念 → 现状问题 → 布局规格 → ASCII 线框（多行者）→ 组件映射表（旧控件 → 新组件）→ 玻璃/渐变用法 → 亮暗说明 → 微交互 → 必须保持的行为。

### 6.1 App shell + left AppRail navigation + theme toggle + global chrome

> 外壳 + 左侧导航栏 + 主题切换：把扁平 IDE 风格外壳换成沉静的近不透明 Aurora Glass chrome，品牌色统一为渐变，导航栏加宽到 64px 并由统一的 Nav-rail-item 原语构建。

**重设计概念（Concept）**

Reskin the outer shell as calm, near-opaque Aurora Glass chrome where the user's work is the brightest thing on screen, and spend the single signature gradient only on brand identity and the active nav state. The left rail becomes a slightly wider (64px), comfortable solid Nav-rail (solid for perf and legibility — it is dense, persistent nav, not floating chrome), built from one shared Nav-rail-item primitive. The amber brand mark is replaced by the --afs-grad-brand gradient chip (unifying the palette to one indigo->violet->azure identity). The active item gains a real sliding gradient indicator bar plus an accent-tinted icon and label, so selection is unmistakable and never color-only. The nav set is completed so no view can be orphaned: assets and prompts get a sensible mapping (the rail still surfaces the 3 primary entries, but the active-state logic is widened so restored assets/prompts views light up their parent 'workbench/editor' entry rather than leaving a dead rail). Theme toggle and settings become utility Nav-rail-items in a bottom cluster, with the toggle's aria-label/tooltip stating the TARGET theme. The editor's three-pane body keeps its exact left-dock / canvas / floating-inspector structure, but the floating inspector is upgraded to the Drawer (floating, glass-chrome, non-modal) recipe with tokenized elevation instead of the harsh dark shadow, and the bare loading text becomes a proper Empty-state/Skeleton with a spinner over a static aurora-tinted backdrop. Aurora backdrop appears only as a static low-opacity garnish behind empty/loading regions and (very faintly) behind the canvas substrate — never animated, never behind dense panels. Glass is reserved for genuinely floating chrome (toolbar, floating inspector, popovers, lightbox controls) and capped to the sanctioned few per viewport; the rail and docks stay solid.

**现状问题（11）**

- Dated IDE/VSCode aesthetic: the entire shell is flat solid panels (--afs-panel/--afs-panel-2) divided by 1px hairlines with zero elevation, gradient, or glass. It reads as the literal opposite of the target AI-native Aurora Glass language.
- Two-accent clash: brand mark uses hardcoded amber #f59e0b (afs-rail__brand) while every active/focus affordance uses indigo --afs-accent #6366f1. The amber is the only non-tokenized color in the shell, has poor contrast on the light #f8fafc rail, and is never re-tuned per theme.
- Cramped rail: 56px wide with 48x48 items, 10px labels force-scaled to 0.92 (~9.2px effective) — tiny text, low touch comfort. Active cue is a subtle 22% accent tint plus an easily-missed 3px left edge bar bleeding off-rail at left:-4px.
- Inconsistent radii in the shell: rail items 9px, no token alignment with the documented scale (4/6/8/12/16). No shared geometry.
- Orphaned navigation state: ITEMS has only 3 entries (home/studio/editor). 'assets' and 'prompts' are valid AppViews and persistable as lastView, but have NO rail entry — so a restored lastView='assets' renders a view with no active rail highlight. theme-toggle and settings are hand-coded buttons outside the ITEMS map.
- All shell controls are raw <button>/<nav>/<aside>/<div> styled per-element by afs-* classes — no shared IconButton/Nav-rail-item primitive, so every restyle must be re-applied by hand (high inconsistency risk).
- Theme toggle shows the opposite-state icon (Moon when light) and has no 'follow system' affordance; once toggled, host theme sync is silently disabled forever with no UI to re-enable it.
- Flash-of-dark on load: html.light is applied only after async loadTheme() resolves (awaited storage.get), so a light-mode user sees a dark flash; index.html has no inline pre-paint theme script.
- Loading state is a bare centered muted text '加载工程中…' with no spinner/skeleton — feels unfinished and violates the two-AI-states / 1s-min-loader principle.
- Floating inspector uses a heavy dark-only box-shadow rgba(0,0,0,0.3) with -10px 0 28px spread and a 0.16s slide; fine in dark, harsh on the light panel; z-index magic numbers (50 vs Lightbox 9999) are undocumented in component code.
- Responsive treatment is partial: @media(max-width:1200px) only shrinks the editor left/right panes; the rail stays a fixed 56px and the new surfaces have no density adaptation.

**布局规格（Layout Spec）**

REGIONS (unchanged DOM topology — restyle only):\n- .afs-shell: display:flex, height:100%, min-height:0. Root row container holding rail + main.\n- .afs-rail (left, solid Nav-rail): width 64px (was 56), flex-shrink:0, column flex, padding var(--afs-sp-4) 0 (8px), gap var(--afs-sp-3)(6px), background var(--afs-panel), border-right 1px var(--afs-border). NOT glass (dense persistent nav). Vertical layout: [brand chip] -> [primary items group] -> [spacer flex:1] -> [utility group: theme toggle, settings] at bottom.\n- .afs-main: flex:1, min-width:0, column flex, height:100%. Hosts the active view.\n\nRAIL INTERNALS:\n- Brand chip: 36x36 (target), --afs-r-md(8px), background var(--afs-grad-brand), centered Clapperboard 20px in --afs-on-accent. margin-bottom var(--afs-sp-5)(12px). title 'AI 影视工坊'.\n- .afs-rail__item (Nav-rail-item primitive): 48px target height, full-width centered column (icon 18-20px over 10-11px micro-label), border-radius --afs-r-md(8px), gap var(--afs-sp-1)(2px). Idle: transparent bg, icon+label var(--afs-muted). Hover: bg var(--afs-hover), icon+label var(--afs-text). Active (aria-current=page): bg color-mix(--afs-accent 16% transparent), icon var(--afs-accent), label var(--afs-text), PLUS a 3px gradient indicator bar (--afs-grad-accent, --afs-r-pill) inset on the left edge (left:0, top:10px bottom:10px) that slides between items via transform/--afs-ease-move.\n- Utility cluster (theme + settings) separated from primary group by the flex spacer; identical Nav-rail-item styling.\n\nEDITOR BODY (region order MUST stay left->center->right):\n- .afs-app__body: flex:1, display:flex, min-height:0, position:relative (anchor for floating inspector).\n- .afs-app__left (WorkbenchDock): width 240px (->220 under 1200px), flex-shrink:0, solid var(--afs-panel), border-right 1px --afs-border, overflow hidden. Panel/Section primitive.\n- .afs-app__center (canvas): flex:1, position:relative, min-width:0. FlowCanvas when graphStore.loaded, else the Empty/loading state.\n- .afs-app__right--float (Inspector): position:absolute, top/right/bottom:0, width 286px (->256 under 1200px), z-index 50 (documented: above ReactFlow internals, below Lightbox 9999). Upgraded to Drawer (floating glass-chrome, non-modal) — afs-drawer--glass recipe + --afs-elev-2; slide-in via afs-drawer-in keyframe (transform+opacity only, --afs-dur-overlay --afs-ease-emphasized).\n- Toolbar (48px) pinned on top of .afs-editor column — owned by another partition but its glass chrome sits flush against the rail.\n\nGRID/SPACING/DENSITY: 8px spacing grid via --afs-sp-* tokens. Rail item targets 48px (comfortable), micro-label 11px/600 (no transform scale hack). Control radii from token scale (rail items/brand 8px). Density stays 'pro tool' in docks/inspector (12px padding, 13px body) but breathing room (sp-7/8/9) is spent in the empty/loading state. Responsive: keep @media(max-width:1200px) dock-shrink rules; rail stays 64px (utility nav, not space-pressured); consider hiding micro-labels under very narrow heights (icon-only with tooltip) but not required.

**组件映射（13）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| <nav className=afs-rail> (56px solid rail) | raw <nav> + .afs-rail class | Nav-rail-item host (.afs-rail) | Widen to 64px, solid --afs-panel (NOT glass — dense persistent nav, perf). Add <nav aria-label='主导航'>. Keep column layout brand->items->spacer->utility. |
| Brand mark (Clapperboard 20px, amber #f59e0b) | .afs-rail__brand with hardcoded #f59e0b | Nav-rail-item brand variant | Replace amber with 36x36 chip filled --afs-grad-brand, Clapperboard in --afs-on-accent. Unifies the two-accent clash. Keep title='AI 影视工坊'. |
| 3 primary nav buttons (home/studio/editor) | raw <button> .afs-rail__item with is-active template string | Nav-rail-item (nav variant) | One shared primitive. icon 18-20px Lucide (LayoutGrid/Film/Workflow kept), 11px micro-label (drop the scale(0.92) hack). Active = aria-current='page' + accent tint + accent icon + sliding gradient indicator bar. onClick(onChange(view)) UNCHANGED. |
| Active-state cue (22% tint + 3px edge bar at left:-4px) | .afs-rail__item.is-active + ::before bar | Nav-rail-item active indicator | 3px --afs-grad-accent bar, --afs-r-pill, inset (left:0) so it no longer bleeds off-rail; slides via --afs-ease-move (transform). Pair with icon color + label weight so state is never color-only. |
| Theme toggle button (Sun/Moon, opposite-state icon) | hand-coded <button> outside ITEMS | Nav-rail-item (utility variant) | Same primitive in bottom utility cluster. Keep Sun(when dark)/Moon(when light) swap + label 亮色/暗色 + title '切换到暗色主题'/'切换到亮色主题'. onClick(toggleTheme) UNCHANGED. aria-label states TARGET theme. Icon swap micro-transition. |
| Settings button | hand-coded <button> with is-active | Nav-rail-item (utility variant) | Bottom cluster. Settings icon 18px. Active when view==='settings'. onClick(onChange('settings')) + title '设置（模型供应商 / 外观 / 存储）' UNCHANGED. |
| title='' tooltips on every rail button | native title attributes (load-bearing) | Tooltip | Styled glass Tooltip as primary affordance (aria-describedby), keep title as fallback. Icon-only-feel buttons keep aria-label on the button. No behavior change. |
| .afs-shell / .afs-main outer containers | raw <div> | Panel/Section (shell layout) | Flex topology unchanged. Apply aurora backdrop only behind empty/loading + faint canvas substrate, never behind rail/docks. |
| EditorView three-pane (.afs-app__left/center/right) | raw <aside>/<main> + afs-app__* classes | Panel (dock) + canvas + Drawer (inspector) | Order left->center->right preserved. Left dock = solid Panel. Inspector mount condition (hasSelection) preserved 1:1. |
| Floating inspector (.afs-app__right--float, dark box-shadow) | absolute aside + rgba(0,0,0,0.3) shadow + afs-drawer-in | Drawer (floating / glass-chrome / non-modal) | afs-drawer--glass recipe + tokenized --afs-elev-2; NOT aria-modal (canvas stays interactive); Esc does NOT close (Delete/Backspace stays bound to editor); z-index 50 documented. Slide animation transform+opacity only. |
| Loading state ('加载工程中…' bare muted text) | .afs-loading centered text | Empty state (loading variant) + Spinner | role='status' aria-live='polite', Loader2 afs-spin + '加载工程中…', static aurora backdrop, 1s min display. FlowCanvas-vs-loading gate (graphStore.loaded) preserved. |
| Run / Save in Toolbar (ambiguous afs-btn--save) | shared button class | Button (gradient=Run w/ glow, secondary=Save) | Out-of-partition but flush against rail: Run = single gradient CTA + afs-glow; Save = secondary. Mentioned for cohesion only; no wiring change here. |
| SnapshotPanel / ProjectStylePanel overlays | conditional render | Modal / Dialog (glass) | Toggled by Toolbar onOpenSnapshots/onOpenStyle via EditorView local state — preserved 1:1; only visual recipe upgraded. |

**玻璃 / 渐变用法**：Glass is used sparingly and only on genuinely floating chrome that overlays content: the Toolbar (flush against the rail), the floating Inspector (Drawer glass-chrome recipe, --afs-glass-fill-strong since it bears text, --afs-elev-2), any popovers/tooltips, and the lightbox controls. The left Nav-rail and the WorkbenchDock stay SOLID (--afs-panel) because they are dense, persistent, always-on surfaces — per the 'glass on chrome, solids under content' principle and for pan/zoom performance. This keeps the per-viewport glass count within the sanctioned 3-4 and never nests glass. The signature indigo->violet->azure gradient appears in exactly two shell spots: (1) the brand chip fill (--afs-grad-brand), replacing the off-palette amber and carrying brand identity; (2) the active Nav-rail-item indicator bar and tint (--afs-grad-accent / color-mix accent), marking the running/selected nav state. Idle rail items, the rail surface, dividers, and all dock chrome get NO gradient. The --afs-aurora backdrop is used only as a static, low-opacity garnish behind the editor empty/loading state and very faintly as the canvas substrate the toolbar glass blurs — never animated, never full-bleed behind the rail or docks. The Run CTA in the toolbar carries the only --afs-glow aura in the shell.

**亮 / 暗说明**：All shell colors route through the re-pointed --afs-* tokens; the single CSS switch stays html.light (uiStore.apply toggles document.documentElement.classList 'light' — do not change this mechanism). Rail surface: dark --afs-panel #11161f over the #0a0e16 app bg with separation by lightness + 1px --afs-border (no heavy shadow); light --afs-panel #ffffff separated by the --afs-border hairline. Brand chip --afs-grad-brand is theme-tuned automatically (dark desaturated stops #6d7cff/#9d6bff/#4fd0e0, light full-chroma #5b54ff/#8b3dff/#06b6d4) — this finally themes the brand (was un-themed amber). Active indicator/tint uses --afs-grad-accent + color-mix on --afs-accent (dark desaturated #8b9bff so it doesn't vibrate, light full-chroma #4f46e5). Active icon = --afs-accent, hover/idle icon = --afs-muted->--afs-text — the emphasis ladder reads in both themes. Floating inspector replaces the hardcoded rgba(0,0,0,0.3) shadow with --afs-elev-2 (light = layered shadow carries depth; dark = surface-lightness step + faint contact shadow) and afs-drawer--glass falls back to opaque --afs-surface-3 under prefers-reduced-transparency. Loading aurora backdrop: light = soft pastel blobs, dark = deeper low-opacity orbs (--afs-aurora light/dark variants). Focus-visible rings use --afs-ring (>=3:1 both themes). Recommend an inline pre-paint theme script in index.html (read storage/query before first paint, add html.light) to kill the flash-of-dark for light-mode users — visual fix only, mirrors loadTheme logic, does not change store semantics.

**微交互**

- Active nav indicator bar slides between rail items on view change via transform + --afs-ease-move (~180ms); under prefers-reduced-motion it snaps instantly.
- Rail item hover: bg fades to --afs-hover and icon/label lift from --afs-muted to --afs-text over --afs-dur-micro (120ms).
- Rail item press: transform scale(0.94) on :active (IconButton press feedback); disabled under reduced-motion.
- Theme toggle: Sun<->Moon icon swap with a quick --afs-dur-micro cross-fade/scale; label text 亮色/暗色 swaps in sync.
- Floating Inspector enter: slide-in (translateX 12px->0) + opacity via afs-drawer-in over --afs-dur-overlay (260ms) with --afs-ease-emphasized; transform+opacity only (never width/blur/shadow-spread) to protect canvas INP. Exit ~20% faster.
- Loading Empty-state: Loader2 spins continuously (transform only); honors --afs-loader-min 1s so it never flashes; reduced-motion swaps spin for a slow opacity pulse.
- Run CTA in toolbar: --afs-glow aura opacity rises to --afs-glow-opacity on hover/while running (opacity-only transition).
- Focus-visible: 2px --afs-ring ring at offset 2px appears on keyboard focus of any rail item/brand/toggle; in forced-colors uses Highlight.
- Brand chip gradient is static (no animated wallpaper) per the restraint principle.

**必须 1:1 保持的行为**

- AppRail props contract {view: AppView, onChange:(v)=>void} unchanged; ITEMS order home,studio,editor with labels 项目/工作台/画布 and icons LayoutGrid/Film/Workflow; brand Clapperboard; is-active computed as view===target (now mirrored to aria-current).
- onClick handlers verbatim: nav items -> onChange(view); theme button -> toggleTheme; settings -> onChange('settings'). All title tooltips kept verbatim: brand 'AI 影视工坊', theme '切换到暗色主题'/'切换到亮色主题', settings '设置（模型供应商 / 外观 / 存储）', nav item titles = their labels.
- go(v) guard in App: when leaving 'editor' to any other view, void flushSave() FIRST then ALWAYS setView (never block the user, even if save rejected).
- View model AppView union = studio|home|editor|assets|prompts|settings; VIEWS array validates restored lastView; default initial view 'home' overridden by valid persisted lastView. Conditional render keyed on `view` string preserved.
- On mount: init() + loadModels() + loadProviders() + loadPrompts() + async restore lastView from window.mulby.storage.get('lastView','ai-film-studio') guarded by typeof string + VIEWS.includes.
- Persist current view: useEffect writes window.mulby.storage.set('lastView', view, 'ai-film-studio') on every view change.
- Window-boundary save: visibilitychange->if hidden flushSave(); pagehide->flushSave()+clearAssetCache(); listeners added/removed in effect cleanup.
- Theme bootstrap: loadTheme() on mount, subscribe window.mulby.onThemeChange((t)=>applyHostTheme(...)), dispose on unmount. applyHostTheme early-returns when manual===true (user choice wins).
- Theme store semantics: default 'dark'; loadTheme reads storage('theme') -> light/dark sets theme+manual=true, else ?theme= query param (manual false); setTheme persists + manual=true; toggleTheme flips; apply()=documentElement.classList.toggle('light', theme==='light'). html.light remains the SOLE CSS theming switch.
- Global shortcuts: Cmd/Ctrl+S -> preventDefault + requestSave() (any view); Delete/Backspace -> deleteSelected() ONLY when view==='editor' AND focus not in INPUT/TEXTAREA/SELECT; effect deps [deleteSelected, view].
- EditorView: right Inspector mounts ONLY when selectedNodeId exists in nodes (float over canvas, do not squeeze it); FlowCanvas mounts only when graphStore.loaded else loading state; SnapshotPanel/ProjectStylePanel toggled by Toolbar onOpenSnapshots/onOpenStyle via local snapOpen/styleOpen state; layout order left/center/right unchanged.
- App component tree: ReactFlowProvider wraps everything; LightboxHost + ResultViewer render as siblings of .afs-shell (global overlays). main.tsx CSS import order (reactflow CSS before styles.css) preserved so afs-* + html.light overrides win.
- z-index tiers preserved: floating inspector 50 (above ReactFlow internals, below Lightbox 9999).

---

### 6.2 ProjectHome landing (项目) — entry to Canvas vs Studio, recent projects grid

> 项目主页（项目）：改为静态极光背景上的「发射台」——顶部玻璃工具栏 + 两张大「新建」卡（画布 / 工作流）+ 最近项目网格，明确区分两类工程及其不同操作集。

**重设计概念（Concept）**

Reframe ProjectHome as a calm, premium 'launchpad' over a static Aurora Glass backdrop. The screen answers two questions instantly: (1) 'start something new' and (2) 'continue something recent'. The top is a glass Toolbar (the single sanctioned glass chrome on this screen) carrying the brand mark, the project title, a Search field, and a kind filter Segmented control. Directly under it sits a HERO ROW of exactly two equal 'New' action cards — '新建画布 (Canvas)' and '新建工作流 (Workflow)' — each a large gradient-bordered card that makes the two distinct entry points obvious and equal; the '从模板新建' template list collapses into a Custom Select / Popover attached to the Canvas hero card (where it belongs, since templates only seed canvas), and Import becomes a secondary ghost action in the toolbar. Below the hero, recent projects render as solid (non-glass) Cards in a responsive grid, each clearly tagged by a category-tinted Badge (canvas=violet via --afs-cat-image-adjacent token, studio=cyan via --afs-type-video token) instead of hardcoded blue/purple, with overflow actions moved into a Dropdown menu (kebab) so the resting card is clean and the hit-targets grow to 36px. The signature indigo→violet→azure gradient appears ONLY on: the brand mark, the two hero 'New' cards' active/hover state + their primary CTA, the 'current project' ring/badge, and focus rings — never on idle recent cards. backdrop-filter is used only on the toolbar and on the template/kebab popovers and the new in-app confirm modal (replacing window.confirm) — respecting the existing 'no blur on running spinners' constraint since this screen has none. Recent cards stay near-opaque solid surfaces for legibility and grid scroll performance.

**现状问题（11）**

- Two project kinds (canvas node-graph + studio workflow) are merged into ONE flat grid distinguished only by a tiny hardcoded color badge (blue rgba(59,130,246,.92) vs purple rgba(168,85,247,.92)). The badge is the only differentiator yet each kind has a DIFFERENT action set (canvas = open/rename/dup/export/delete; studio = open/delete) — cognitively noisy and visually identical cards behave differently.
- Header crams four heterogeneous actions in one row with no hierarchy: a raw native <select> '从模板新建…', '导入', '新建画布' (afs-btn neutral), '新建工作流' (afs-btn--save = the only accented one). The two PRIMARY create paths (canvas vs workflow) don't read as the two entry points the screen is supposed to surface; the template select is the most prominent OS-native eyesore.
- The template <select className='afs-toolbar__select'> is a raw native dropdown with OS popup, no custom chevron, and a value='' placeholder option — clashes with the dark/glass theme and ignores html.light tokens for its popup.
- Overlay pills are hardcoded near-black: afs-pcard__count and afs-pcard__ratio use background rgba(8,11,18,.66) + color #e5e7eb — these read as dark chips even in light mode (not theme-aware).
- Card hover uses a hardcoded box-shadow 0 6px 20px rgba(0,0,0,.25) and the delete-hover is hardcoded #ef4444 !important on border+color — no token, no light tuning.
- Bare <span className='afs-tag'>当前</span> has NO base .afs-tag style definition (only contextual + --edited/--cap variants exist) so it renders as unstyled inline text — the 'current project' marker is visually broken.
- Cards are plain clickable <div>s: the cover div has onClick but no role/tabIndex/keyboard handler, so the primary open affordance is not keyboard-operable. Action buttons are 26px with 13px lucide icons (tiny targets), icon-only with title-tooltips (low discoverability).
- Accent is a single flat indigo (#6366f1) used identically in light+dark with zero gradient — the opposite of the desired AI-native gradient/glass look. No brand mark, no aurora, no glass anywhere on the entry screen.
- Empty state reuses afs-studio__empty (a faded Clapperboard at opacity .3 + one muted sentence) — minimal, no illustration/gradient/CTA; it doesn't help a brand-new user choose between the two entry points.
- No sorting/filter/search affordance; the dual list just sorts by updatedAt desc with no way to scope to canvas vs workflow or find a project by name as the library grows.
- Action confirmations/prompts are all OS-native window.confirm (delete canvas/studio) and window.prompt (rename) — they shatter the aesthetic and can't be themed (must be replaced with in-app glass Modal/dialog driving the SAME async gate).

**布局规格（Layout Spec）**

REGIONS (top→bottom), full-height flex column (.afs-surface keeps flex:1 min-height:0):\n\n1) GLASS TOOLBAR (role=toolbar, .afs-toolbar, height 56px, sticky top, --afs-glass-fill + --afs-glass-blur + bottom --afs-glass-border + --afs-glass-highlight; reduced-transparency/forced-colors → solid --afs-panel). Left group: 28px brand mark (--afs-grad-brand rounded --afs-r-md) + 'AI 影视工作室 / 项目' title (Section-title 16/600). Spacer (flex:1). Right group: Search Field (pill, 240px, collapses to icon-only IconButton under 720px) · vertical Divider · kind-filter Segmented control [全部 | 画布 | 工作流] · vertical Divider · '导入' secondary/ghost Button (Upload 16px). Toolbar gains is-scrolled shadow when the scroll body scrolls.\n\n2) SCROLL BODY (.afs-home__scroll, flex:1 overflow-y:auto, .afs-scroll thin scrollbar, padding 20px 24px 32px). Sits over a STATIC --afs-aurora backdrop layer (::before, opacity .4 dark / .55 light, aria-hidden, never animated). Two stacked sub-regions:\n\n  2a) HERO 'NEW' ROW: a 2-column grid (grid-template-columns: repeat(2,1fr), gap 16px; collapses to 1 column under 640px). Two large lg Cards (--afs-r-xl, min-height 132px): \n     - CANVAS hero: leading 40px icon tile (Workflow lucide on a soft --afs-cat-image tint), title '新建画布工程', one-line caption '自由节点图，精细编排生成流程', a footer row with a gradient primary Button '新建画布' + a Custom Select '从模板…' (the template list lives here).\n     - WORKFLOW hero: leading 40px icon tile (Clapperboard/Film on a soft --afs-type-video tint), title '新建工作流项目', caption 'AI 短剧工作台，分镜→成片', footer gradient primary Button '新建工作流'.\n     Idle = solid --afs-panel-2 + --afs-border + --afs-elev-1; hover = gradient hairline border (--afs-grad-accent via ::before mask) + --afs-elev-2 lift + .afs-glow aura rises. These two cards are the only place the brand/AI gradient lives at rest-ish.\n\n  2b) RECENT GRID: a Divider/label row 'RECENT · 最近项目' (micro-label 11/600 uppercase --afs-muted, optional count Pill) then .afs-home__grid (display:grid; gap:16px; grid-template-columns: repeat(auto-fill, minmax(224px,1fr))). Each recent project = interactive Card (--afs-r-lg, solid --afs-panel-2, --afs-elev-1): \n        > .afs-card__media 16:9 cover (Cover component unchanged) with top-left category Badge (画布/工作流) and on-media Pills bottom-left (ratio, canvas only) + bottom-right (N 节点, canvas only) — pills use --afs-scrim not hardcoded black.\n        > .afs-card__body padding var(--afs-sp-5): name row (Body 13/600 ellipsis) + optional gradient 'current' Badge; relTime (Caption 11 --afs-muted tabular-nums); meta line (style for canvas / '{artStyle · ratio · N 分镜}' for studio, --afs-text-dim ellipsis).\n        > .afs-card__footer (border-top --afs-border): primary-ish '打开' Button (sm, secondary) on the left, spacer, one kebab IconButton (MoreHorizontal) opening a Dropdown menu with the per-kind actions.\n\nDENSITY/SPACING: 8px grid throughout. Toolbar 56px; control rows 32px (sm 28 for in-card). Card radii --afs-r-lg recent / --afs-r-xl hero. Gaps: toolbar groups sp-3/sp-4; grid 16px; card body internal sp-2. Breathing room is spent on the hero row + aurora empty state, not inside cards. RESPONSIVE: hero 2→1 col <640px; recent grid auto-fills 224px min; toolbar search→icon under 720px and Segmented may drop labels to icon-only under 560px (keeps aria-labels).\n\nEMPTY STATE (rows.length===0): the recent region is replaced by an Empty state component centered over the aurora — 44px Clapperboard (--afs-text-dim), display heading '开始你的第一个项目' (22/600), muted hint, and the SAME two hero cards remain above as the actionable CTAs (so empty state is never a dead end).

**组件映射（21）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| Header bar (.afs-surface__head 52px) | flat bar, border-bottom only | Toolbar (glass chrome) | role=toolbar, 56px, --afs-glass-fill + blur; gains brand mark (--afs-grad-brand) replacing the bare title. Reduced-transparency/forced-colors fallbacks required. |
| '项目' title (h2.afs-surface__title) | h2 16/700 | Toolbar brand + Section title | Keep as the toolbar left label; add 28px gradient brand mark before it. Real heading element retained for landmark a11y. |
| Template <select className='afs-toolbar__select'> '从模板新建…' | native <select> value='' + <option> per TEMPLATE | Custom Select / Dropdown (headless Radix/React Aria listbox) | Moves INTO the Canvas hero card footer. Same option set (TEMPLATES.map id/name + title=desc), same onChange→onTemplate(id), value='' placeholder maps to '从模板…' follow-default row. Glass popover, Check on selected. Reset value to '' after pick (current behavior keeps select uncontrolled at ''). |
| '导入' button (afs-btn + Upload 15px) | afs-btn neutral | Button (secondary/ghost) + IconButton under 720px | Stays in toolbar right group. Upload icon normalized to 16px. onClick→fileRef.current?.click() unchanged; hidden <input type=file> preserved verbatim. |
| '新建画布' button (afs-btn + Workflow 15px) | afs-btn neutral | Button (gradient, .afs-glow) inside Canvas hero Card | Promoted to gradient primary CTA in the Canvas hero card; onClick→onNewCanvas unchanged. |
| '新建工作流' button (afs-btn afs-btn--save + Film 15px) | afs-btn--save (the lone accented btn) | Button (gradient, .afs-glow) inside Workflow hero Card | Promoted to gradient primary CTA in the Workflow hero card; onClick→onNewStudio (createStudio({name:'新项目'})+onOpenStudio) unchanged. Now visually equal to Canvas entry. |
| (new) kind filter | none — flat merged list | Segmented Control [全部\|画布\|工作流] | Pure client-side view filter over the existing merged rows[] (filter by r.kind); does NOT change the merge/sort pipeline. Sliding gradient pill, roving tabindex. Default '全部'. |
| (new) project search | none | Search Field (pill) | Client-side filter over r.card.name / r.name only; presentational, no store/host change. Esc clears, aria-live count. |
| Project card (div.afs-pcard / .is-current) | clickable <div>, hover hardcoded shadow | Card (interactive, solid --afs-panel-2) | Becomes real <button>/role=button+tabIndex with Enter/Space → open. is-current → is-selected (2px --afs-accent ring). Hover uses --afs-elev-2 + --afs-border-strong (tokenized, drops rgba(0,0,0,.25)). |
| Cover (.afs-pcard__cover onClick + Cover img/ph) | clickable div, useMediaUrl | Card media (.afs-card__media 16:9) | Cover component + useMediaUrl({assetId}) lifecycle UNCHANGED. Placeholder Film(studio)/Clapperboard(canvas) kept; icon color → --afs-text-dim. |
| Kind badge (.afs-pcard__kind--canvas/--studio) | hardcoded blue rgba(59,130,246,.92)/purple rgba(168,85,247,.92) | Badge (soft, category-tinted) | canvas → --afs-cat-image/violet token; studio → --afs-type-video/cyan token via inline --cat. Soft tint, leading dot, theme-aware. Pairs color with text label (not color-only). |
| Ratio pill (.afs-pcard__ratio) + node-count pill (.afs-pcard__count) | hardcoded rgba(8,11,18,.66) near-black | Pill (on-media, --afs-scrim) | Same content (r.card.aspectRatio; r.card.nodeCount 节点), canvas-only. Now --afs-scrim backed (theme-tuned) so legible in light too. tabular-nums on count. |
| '当前' marker (<span className='afs-tag'>) — unstyled | bare span, no base style | Badge (accent/gradient soft) | Gets a real style: color-mix(--afs-accent 16%) tint + accent text + leading Check. Bound to r.id===currentId exactly as today. |
| '打开' button (.afs-pcard__open) | text button | Button (secondary, sm) in Card footer | onClick→openCanvas(switchProject)/openStudioCard(openStudio) unchanged. |
| Rename/Dup/Export/Delete icon buttons (.afs-pcard__actions, 26px, Pencil/Copy/Download/Trash2 13px) | 4 inline 26px icon buttons (canvas) / 1 (studio) | IconButton (kebab MoreHorizontal) → Dropdown menu | Collapse into one kebab opening a Dropdown menu: 重命名(Pencil)/复制(Copy)/导出 JSON(Download)/[sep]/删除(Trash2,danger). Studio card menu shows only 删除. Each item drives the exact same handler (onRename/onDup/onExport/onDeleteCanvas/onDeleteStudio). Targets grow to ≥36px rows. |
| window.prompt('重命名工程') in onRename | native prompt | Modal (prompt variant) — single Text Input | Same async gate: resolves trimmed name→renameProjectById+refreshCanvas, cancel aborts (no-op). Empty/whitespace guarded as today. |
| window.confirm delete (canvas & studio) | native confirm | Modal (confirm variant, danger CTA) | Same gate: confirm→deleteProject/deleteStudio+refresh; cancel aborts. Danger CTA = icon+label (not color-only). Message text preserved (「{name}」… 不可撤销). |
| window.mulby.notification.show('导入失败…','error') | host toast | Toast / notification (host API unchanged) | Call site identical; only the in-app rendering follows the Toast spec. Success/error/warning levels preserved. |
| Empty state (.afs-studio__empty + Clapperboard opacity .3) | faded icon + 1 sentence | Empty state component | 44px Clapperboard (--afs-text-dim), display heading + muted hint over static aurora; hero 'New' cards remain above as live CTAs. rows.length===0 trigger unchanged. |
| Scroll body (.afs-home__scroll) | plain overflow-y auto | Panel body + .afs-scroll + aurora ::before | Adds static --afs-aurora garnish (aria-hidden, never animated) + tokenized thin scrollbar. flex:1 min-height:0 preserved. |
| Hidden file input (<input type=file accept json hidden>) | native file input | (unchanged) native input | Kept verbatim — drives onImportFile (JSON.parse→newProject+importProject+onOpenCanvas; catch→toast). Not user-visible. |

**玻璃 / 渐变用法**：GLASS (sanctioned, ≤3-4 surfaces, none nested): (1) the top Toolbar — the one persistent glass chrome here (--afs-glass-fill + blur(16px) saturate; bottom --afs-glass-border + --afs-glass-highlight). (2) the Template Custom Select popover and the per-card kebab Dropdown menu — short-lived floating chrome (glass-chrome recipe, --afs-elev-3). (3) the in-app confirm/prompt Modal that replaces window.confirm/prompt — text-bearing glass (--afs-glass-fill-strong ≥55% so body text holds ≥4.5:1, --afs-elev-4 over --afs-scrim). NOTHING ELSE is glass: recent project Cards and the two hero Cards stay near-opaque solid surfaces (--afs-panel-2) for legibility and scroll performance. The existing 'no backdrop-filter near running spinners' constraint is honored because this screen renders no in-progress spinners (covers are static images); the toolbar/popover blur never sits over an animating canvas.\n\nGRADIENT (signature indigo→violet→azure, used sparingly): only on (a) the 28px Toolbar brand mark (--afs-grad-brand), (b) the two hero 'New' cards — gradient hairline border via ::before mask-composite + .afs-glow aura that animates opacity ONLY on hover/focus, plus their primary CTA fill (--afs-grad-accent) and the loading state, (c) the Segmented filter's active sliding pill (--afs-grad-accent), (d) the 'current' Badge soft accent tint + the is-selected card ring (--afs-accent), (e) focus-visible rings (--afs-ring). Idle recent cards carry NO gradient — they are the calm field so the user's covers and the two entry points are the brightest things. Aurora gradient (--afs-aurora) appears as a single STATIC low-opacity backdrop behind the scroll body / empty state only.

**亮 / 暗说明**：All surfaces are token-driven so html.light swaps work with no per-component branching. Specific re-tunings vs the legacy hardcoded values: (1) Kind badges drop hardcoded blue/purple → category tokens (--afs-cat-image violet light #7c3aed / dark #a78bfa for canvas; --afs-type-video cyan light #0891b2 / dark #22d3ee for studio), injected inline as --cat so any JS color stays compatible. (2) On-media ratio/count pills drop rgba(8,11,18,.66) → --afs-scrim (light rgba(0,0,0,.30) / dark rgba(0,0,0,.42)) with white glyph that stays ≥4.5:1 over either-theme covers. (3) Card hover shadow drops rgba(0,0,0,.25) → --afs-elev-2 (light = layered shadow carries depth; dark = relies on --afs-panel-2 lightness step + faint contact shadow). (4) Delete-hover drops #ef4444 !important → --afs-danger token (light #dc2626 / dark #f87171) inside the Dropdown danger item. (5) Accent flips per theme: gradient stops full-chroma in light (#5b54ff→#8b3dff→#06b6d4), desaturated in dark (#6d7cff→#9d6bff→#4fd0e0); on-accent CTA text flips white(light)/dark-ink(dark) via --afs-on-accent. (6) Aurora backdrop = soft pastel blobs (light, opacity .55) vs deeper low-opacity orbs (dark, .40), static. (7) Toolbar glass: light = white-tint + darker hairline + --afs-elev-3 shadow for separation; dark = deep blue-black tint + faint white hairline + lightness-step depth. Reduced-transparency → toolbar/popover/modal become opaque --afs-panel/--afs-surface-3; forced-colors → 1px CanvasText borders + Highlight focus rings; @supports not backdrop-filter → opaque ~95% fallback fills.

**微交互**

- Hero card hover/focus: gradient hairline border fades in (::before mask-composite) + card lifts translateY(-1px) to --afs-elev-2 + .afs-glow ::after aura opacity 0→--afs-glow-opacity over --afs-dur-ui; press scale(0.99). prefers-reduced-motion drops the lift/glow transition (static).
- Hero CTA (gradient Button) press scale(0.97) --afs-dur-micro; while creating, leading icon swaps to Loader2 afs-spin, label width frozen, aria-busy=true (covers the brief newProject/createStudio await).
- Segmented filter pill slides between 全部/画布/工作流 via transform + width on --afs-ease-move (--afs-dur-ui); active label → --afs-on-accent; reduced-motion = instant swap. Filtering announces count via aria-live polite.
- Search Field: typing live-filters the recent grid (debounced); clear ✕ appears when non-empty, Esc clears; leading Search icon, no layout shift. Result count aria-live.
- Recent Card hover: border --afs-border → --afs-border-strong + --afs-elev-2 + translateY(-1px); cover image subtle scale(1.02) under overflow:hidden; cursor pointer. is-selected (current) shows persistent 2px --afs-accent ring.
- Kebab → Dropdown menu: opens with fade+scale(0.98) from the button edge (--afs-dur-ui, --afs-ease-standard); item hover --afs-hover, danger 删除 hover = color-mix(--afs-danger 16%) tint; Esc/outside-click closes and returns focus to the kebab.
- Template Custom Select: chevron rotates 180° on open; popover scale+opacity in from top; selected option shows Check (--afs-accent); type-ahead + ↑↓ keyboard. After choosing a template the trigger resets to the '从模板…' placeholder (value='' behavior preserved).
- Confirm/prompt Modal: scrim fade + card scale 0.96→1 (--afs-dur-overlay emphasized); focus traps to safest control (Cancel for delete); danger CTA shows Loader2 while the async delete/rename resolves; Esc/scrim-click = cancel (aborts the gate).
- Toolbar is-scrolled: when the scroll body scrolls >0, the glass toolbar gains a hairline bottom border + --afs-elev-1 (transition border/shadow on --afs-dur-ui) to separate from content.
- Card/empty-state mount: recent grid items fade+rise 6px staggered subtly on first paint (opacity/transform only, capped, reduced-motion → none).

**必须 1:1 保持的行为**

- Dual-source merge UNCHANGED: rows = canvasCards(loadProjectCards from graphStore).map(kind:'canvas') ++ studioCards(projectStore.cards).map(kind:'studio'), sorted by updatedAt desc. New Segmented filter + Search only filter the rendered subset client-side; the underlying rows memo, its [canvasCards,studioCards] dependency, and the sort are untouched.
- Refresh effect keyed on [projects.length, currentId] still runs refreshCanvas (setCanvasCards(await loadProjectCards())) + refreshStudioCards on mount/changes.
- All canvas actions 1:1: onTemplate(tid)→if(!tid)return; loadTemplate(tid)+onOpenCanvas; onNewCanvas→newProject+onOpenCanvas; openCanvas(id)→switchProject(id)+onOpenCanvas; onRename→(name)trim guard→renameProjectById(id,name)+refreshCanvas; onDup→duplicateProject(id)+refreshCanvas; onExport→exportProjectById(id)→Blob(JSON.stringify(data,null,2),application/json)→a.download=`${name||'ai-film-project'}.json`→click→revokeObjectURL; onDeleteCanvas→deleteProject(id)+refreshCanvas (now behind in-app confirm).
- All studio actions 1:1: onNewStudio→createStudio({name:'新项目'})+onOpenStudio; openStudioCard(id)→openStudio(id)+onOpenStudio; onDeleteStudio→deleteStudio(id) (behind in-app confirm).
- Import flow verbatim: hidden <input type=file accept='application/json,.json'> → onImportFile reads file.text()→JSON.parse as Partial<ProjectData>→newProject()→importProject(data)→refreshCanvas→onOpenCanvas; on throw → window.mulby.notification.show('导入失败：文件格式不正确','error'); e.target.value='' reset preserved.
- Cover resolution: Cover uses useMediaUrl(assetId?{assetId}:null); canvas coverAssetId and studio coverImageId both index the same asset registry. Placeholder Film(studio)/Clapperboard(canvas) when no url. Lifecycle (no offscreen resolve regressions) preserved.
- Studio meta string format EXACT: `${styleLabel(c.artStyle)} · ${c.videoRatio} · ${c.storyboardCount} 分镜`, with styleLabel via listStylePacks().find(p=>p.id===id)?.label ?? id. Canvas meta: relTime(updatedAt) + conditional '风格：{r.card.style}' (only when style truthy) + ratio/nodeCount overlays.
- is-current binding: highlight + '当前' badge only when r.id===currentId (graphStore.currentId). Studio cards never show 'current'.
- relTime(ts) helper output strings unchanged (刚刚 / N 分钟前 / N 小时前 / N 天前 / toLocaleDateString fallback).
- TEMPLATES list (id/name/desc) is the exact source for the template Custom Select options; the '从模板新建…' empty/placeholder entry maps to value='' and is a no-op (onTemplate guards !tid).
- Every window.mulby.notification.show(message, level) call remains the host toast trigger; window.confirm/window.prompt are replaced by in-app dialogs that MUST keep the same async gating — confirm resolves→runs action, cancel aborts with no side effects; rename empty/whitespace still aborts.
- Theme stays token-driven via the html.light class swapping --afs-* custom properties; no new surface hardcodes dark-only values, so both modes work. Props (onOpenCanvas, onOpenStudio) and all store selectors/actions consumed are unchanged.

---

### 6.3 FlowCanvas editor chrome — top Toolbar + draggable NodeLibrary rail + React Flow Background(Dots)/Controls/MiniMap

> 画布编辑器外壳：48px 工具栏成为本屏唯一玻璃 chrome；模型选择改自定义下拉；运行是唯一「渐变 + 辉光」主操作；点阵背景 / 控件 / 小地图全部令牌化。

**重设计概念（Concept）**

Re-skin the editor shell as Aurora Glass 'glass on chrome, solids under content'. The 48px Toolbar becomes the one sanctioned glass chrome surface of this screen (Toolbar component: backdrop-filter glass bar over the canvas), carrying a brand mark on --afs-grad-brand, an inline-editable project title, an icon+text status pill with a status dot, two Custom Selects for the models, and a clearly tiered action cluster where exactly ONE gradient+glow Button (运行) is the signature AI action and everything else (保存 primary-solid, fit/style/snapshot IconButtons) is lower-emphasis. The native <select>s are swapped 1:1 for headless Custom Select / Combobox whose glass popovers finally obey the theme. The NodeLibrary rail stays a SOLID --afs-panel surface (dense, text-heavy, must stay legible and perf-friendly — never glass), but gains a Search Field header, becomes keyboard-operable (each node row upgraded to a real focusable button-role with Enter/Space = add), uses Badge-style category headers, and threads the legacy CATEGORY_META colors through the inline --cat custom-property so category tinting works in both themes. The React Flow canvas is the calm static substrate: dotColor/maskColor/minimap node colors are read from CSS tokens (var(--afs-dot), var(--afs-cat-*)) instead of JS hex literals, Controls/MiniMap get fully tokenized re-skins, and an optional static --afs-aurora wash sits behind the empty canvas only. Gradient and glass appear on a tiny, disciplined set — brand mark, Run CTA, model-select popovers, the toolbar bar itself — never on the rail body, node rows, or the canvas working area. All data contracts, store wiring, DnD MIME dispatch, and host calls are untouched; this is restyle + accessibility-only.

**现状问题（12）**

- Native <select> dropdowns (text model + image model in Toolbar, plus every nodeDefs control:'select') render OS-native option lists that ignore the dark theme — jarring white popups in dark mode, inconsistent across OSes. This is the #1 visual break for an AI-native aesthetic.
- Primary-action ambiguity: 运行 (Run) and 保存 (Save) share the exact same .afs-btn--save accent fill (var(--afs-accent) #6366f1), so the single most important CTA (Run) has zero visual primacy over Save — they read as twins.
- Inconsistent button anatomy in one row: icon-only buttons (Maximize2 fit, Palette style, Camera snapshots) rely solely on title tooltips with no label, sitting next to labeled buttons (保存/运行). Icon sizes are also uneven (size={15} for most, size={14} for Square/Stop).
- NodeLibrary items are plain <div onClick> with no role, tabindex, or keyboard handler — not keyboard- or screen-reader-operable. There is also no search/filter for 25 nodes in a fixed 240px rail; it is pure scroll and dense.
- Toolbar is cramped: name + status + two selects (capped 150–200px) + five buttons in a 48px bar with no overflow/responsive handling; selects truncate model labels.
- Dated flat-panel look: solid --afs-panel fills, 1px hairline borders, 6–7px radii, 11–13px type, hard pure-black drop shadows (rgba(0,0,0,0.25)/0.3). No glass, gradient, or depth — reads like a 2018 dev tool, not an AI-native studio.
- Split-brain color system: theme colors live in CSS vars but category/port/canvas colors are JS hex literals applied inline. Theme switches only half-recolor the chrome — dotColor/maskColor are re-hardcoded in FlowCanvas JS (#cbd5e1/#2a3650, rgba one-offs) and minimap node colors (CATEGORY_META hexes) are not theme-aware at all.
- Status text ('未保存'/'已保存'/'保存中…') is plain muted text with no color/icon affordance — dirty state is easy to miss; saving shows no spinner even though afs-spin exists.
- React Flow Controls/MiniMap are only lightly re-skinned (button bg + minimap bg); the stock xyflow glyphs, borders, and viewport rect clash with the custom panels.
- Dead/conflicting CSS: .afs-toolbar__name declares width twice (150px then 200px); orphaned .afs-toolbar__logo (amber #f59e0b) / .afs-toolbar__brand classes remain after the brand mark was removed from Toolbar.tsx.
- --afs-accent is identical #6366f1 in both themes (no light-tuned accent); CATEGORY_META and PORT_COLORS have no light variants, so saturated dark-tuned hexes can wash out on the bright light canvas.
- Disabled buttons only dim to opacity 0.45 with no focus ring and no loading affordance beyond the Run→Stop swap.

**布局规格（Layout Spec）**

REGIONS (unchanged 3-column shell + top bar):
- Top: .afs-toolbar — height 48px, full-width, glass chrome (afs-glass-fill + blur(16px), border-bottom var(--afs-glass-border), --afs-glass-highlight inset). z-index above canvas. Flex row, gap var(--afs-sp-4)=8px, padding 0 var(--afs-sp-5)=12px.
- Body (.afs-app__body, position:relative): left .afs-app__left = 240px solid --afs-panel rail (NodeLibrary), border-right 1px var(--afs-border); center .afs-app__center (flex:1) hosting .afs-canvas (absolute inset:0, React Flow); right .afs-app__right--float = 286px floating Drawer (out of scope, preserved).

TOOLBAR GRID (left group | spacer | right group):
- Left group (gap 8px): brand mark 28x28 (--afs-grad-brand, --afs-r-md, Clapperboard/Film glyph --afs-on-accent) -> Inline-editable title (Section-title 16/600 in display, seamless) -> Status pill = Status dot + tabular meta text ('{n} 节点 · {state}').
- Spacer flex:1.
- Right group (gap var(--afs-sp-3)=6px), left-to-right: Custom Select(text model, sm, leading Type icon, max-width 180px) -> Custom Select(image model, sm, leading Image icon, max-width 180px) -> Divider(vertical) -> IconButton fit-view(Maximize2) -> IconButton style(Palette) -> IconButton snapshots(Camera) -> Divider(vertical) -> Button 保存(primary solid, sm, Save+label) -> Button 运行/停止(gradient+glow / danger-solid, sm, Play|Square+label).
- Control heights: --afs-control-h-sm=26px for selects/buttons in this dense bar; IconButtons 28px (sm). Icon glyphs unified to 16px.
- Responsive: under ~1180px collapse fit/style/snapshot IconButtons into a single overflow Dropdown menu (MoreHorizontal) to relieve the cramped bar; selects shrink to min 120px with truncation; title ellipsizes.

NODELIBRARY RAIL (240px, solid):
- Header block padding var(--afs-sp-5)=12px top/sides: Panel title '节点库' (Section-title 16/600) + hint caption '拖拽到画布，或点击添加' (--afs-muted) + Search Field (box, sm, leading Search, clear X) for live filter.
- Scroll region (.afs-scroll thin tokenized scrollbar, padding-bottom 12px). Per category (CATEGORY_ORDER): group header = Badge-soft (category --cat dot + meta.label, micro-label uppercase 11/600). Node rows: 8px-grid, row padding var(--afs-sp-3) var(--afs-sp-4), radius --afs-r-md(8px), gap 9px = [category-tinted icon 16px in 28px slot] + [label 13/500 + desc 11 --afs-muted ellipsis]. Empty filter result -> Empty-state mini ('无匹配节点').

CANVAS:
- .afs-canvas absolute inset:0 unchanged. Background Dots gap 18 size 1 color var(--afs-dot). Optional ::before static --afs-aurora at opacity .4 behind an empty graph (decorative, aria-hidden, no motion). Controls bottom-left + MiniMap bottom-right, both re-skinned as small solid --afs-panel cards with --afs-border + --afs-r-md, glyphs --afs-muted->--afs-text on hover, minimap mask var(--afs-scrim), node fills var(--afs-cat-*).

DENSITY: 8px spacing grid; compact 26–28px control rows in chrome; 11–14px UI type; 6–8px radii on controls, 16px radius reserved for toolbar/popover glass cards. Breathing room spent only on canvas + empty states.

**ASCII 线框**

```text
DARK / LIGHT — same structure (glass = toolbar bar + model popovers + Run glow only)

 TOP TOOLBAR (48px glass chrome)
╔══════════════════════════════════════════════════════════════════════════════════════╗
║ ◳  我的影片 ✎   ● 12 节点 · 已保存          [T 文本：GPT-4o ▾][▦ 图像：flux ▾] │ [⤢][🎨][▣] │ [💾 保存] ║✦运行║ ║
╚══════════════════════════════════════════════════════════════════════════════════════╝
  ◳=brand(grad)  ✎=inline rename  ●=status dot   selects=Custom Select(glass popover)   │=divider
  [⤢]fit [🎨]style [▣]snapshot = IconButtons   [保存]=primary solid   ║✦运行║=gradient+glow CTA

┌──────────────┬──────────────────────────────────────────────────────┬ (right drawer
│ NODE LIBRARY │                  FLOW CANVAS                          │  floats only
│ (240 solid)  │            (static aurora wash · dot grid)           │  on selection,
│              │                                                      │  out of scope)
│ 节点库       │        ┌───────┐         ┌───────┐                   │
│ 拖拽/点击添加│        │ node  │────────▶│ node  │                   │
│ ╭──────────╮ │        └───────┘         └───────┘                   │
│ │🔍 搜索…  ✕│ │                                                      │
│ ╰──────────╯ │                                                      │
│ ● 输入       │                                                      │
│  [▦] 故事原著│                                                      │
│      原著文本 │                                                      │
│  [T] 文本    │                                                      │
│  [👤]角色    │                                                      │
│ ● 文本 AI    │                                                      │
│  [☰]大纲     │                                                      │
│  [✎]剧本生成 │                                                      │
│ ● 图像 AI    │                                                      │
│  [▣]关键帧   │                                                      │
│ ● 视频 AI    │   ┌────┐ Controls          MiniMap ┌──────────┐      │
│  …(scroll)…  │   │+ −⤢│ (solid card)    (tokens)  │ ░░▓░░░▒░ │      │
└──────────────┴───└────┘──────────────────────────└──────────┘──────┘

  Custom Select popover (glass, theme-obeying)        Run→Stop swap (same slot)
  ┌──────────────────────┐                            running: ║■ 停止║ (danger solid)
  │ ✓ 文本：GPT-4o       │                            idle:    ║✦ 运行║ (grad + glow)
  │   文本：GPT-4o-mini  │
  │   文本：Claude 3.5   │
  └──────────────────────┘
```

**组件映射（23）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| <div className="afs-toolbar"> 48px bar | solid --afs-panel flex bar, 1px bottom border | Toolbar (glass chrome) | afs-glass-fill + blur(16px) + --afs-glass-highlight; border-bottom var(--afs-glass-border). One of the ≤3-4 sanctioned glass surfaces. Reduced-transparency/forced-colors fall back to solid --afs-panel. role=toolbar, roving focus. |
| (removed) .afs-toolbar__logo amber + .afs-toolbar__brand | orphaned classes, #f59e0b amber | Toolbar brand mark | Re-add a 28x28 --afs-grad-brand square with Clapperboard glyph (--afs-on-accent). Replaces hardcoded amber, unifies the two-accent clash. Delete dead CSS. |
| <span className="afs-toolbar__nametag" onDoubleClick> / <input className="afs-toolbar__name"> | text span swapping to raw <input>, conflicting width:150/200px | Inline editable text (seamless variant) | Keep double-click->edit, Enter commit, Escape cancel, blur commit, trim+'未命名工程' fallback, renameProject(n). Display mode is role=button labelled '编辑 {name}'; content-sized (kills the width conflict). Accent underline+ring in edit. |
| <span className="afs-toolbar__meta"> '{n} 节点 · 状态' | plain muted text, no affordance | Status dot + Pill (on-surface) + Spinner | Status dot: idle/saved=success, dirty=warning, saving=info(breathing) + tabular text. While saving show Loader2 (afs-spin) ahead of '保存中…'. Status never color-only (dot+icon+text). String preserved exactly: `{nodeCount} 节点 · {saving?'保存中…':dirty?'未保存':'已保存'}`. |
| <select className="afs-toolbar__select afs-toolbar__model"> text model | native <select>, OS popup ignores theme | Custom Select (or Combobox if many models) | Headless Radix/React Aria listbox + glass popover. Keep value=selectedModel\|\|'', onChange=setSelectedModel(value\|\|null); empty-list placeholder '默认文本模型'; option label '文本：'+(m.label\|\|m.id); leading Type icon on trigger. sm size. |
| <select> image model | native <select> | Custom Select / Combobox | value=selectedImageModel\|\|'', onChange=setSelectedImageModel(value\|\|null); placeholder '无图像模型'; label '图像：'+(m.label\|\|m.id); leading Image icon. Same glass popover recipe. |
| <button className="afs-btn"> fit-view (Maximize2 size=15) | labeled-less afs-btn | IconButton (neutral, sm) | glyph 16px, aria-label '适应画布' + Tooltip. Keep fitView({duration:300,padding:0.2}). |
| <button className="afs-btn"> style (Palette size=15) | afs-btn icon-only | IconButton (neutral, sm) | Palette formalized as the 🎨 '全局设定' glyph. aria-label '项目风格' + Tooltip. Keep onOpenStyle(). |
| <button className="afs-btn"> snapshots (Camera size=15) | afs-btn icon-only | IconButton (neutral, sm) | aria-label '工程快照' + Tooltip. Keep onOpenSnapshots(). Under ~1180px, fit/style/snapshot collapse into a Dropdown menu (MoreHorizontal). |
| <button className="afs-btn afs-btn--save"> 保存 | accent-fill, identical to Run | Button variant=primary (solid, sm) | Solid --afs-accent + --afs-on-accent, NO glow — visually subordinate to Run. Keep saveProject(); add aria-busy spinner when saving. Differentiated anatomy fixes Run/Save ambiguity. |
| <button className="afs-btn afs-btn--save"> 运行 (Play) | same accent fill as Save | Button variant=gradient + .afs-glow (sm) | The single signature AI action: --afs-grad-accent fill + emissive glow that rises on hover/running. Keep runAll(). Exactly one gradient button on this surface. |
| <button className="afs-btn afs-btn--stop"> 停止 (Square) | hardcoded red #7f1d1d/#b91c1c | Button variant=danger (solid, sm) | Same slot, conditional on isRunning; uses --afs-danger token (theme-tuned). Keep cancelRun(); aria-pressed reflects running. Square glyph unified to 16px. |
| <div className="afs-library"> rail | solid panel, no search | Panel / Section (dock, SOLID — never glass) | Stays near-opaque --afs-panel for legibility + canvas pan perf. landmark <aside aria-label='节点库'>. |
| <div className="afs-library__title"> '节点库' + __hint | bold 13px text + muted hint | Panel head (Section-title) + Caption | Title 16/600, hint 11 --afs-muted. Unchanged copy. |
| (missing) library search | none — pure scroll over 25 nodes | Search Field (box, sm) | New: leading Search, clear X, role=searchbox, Esc clears, filters NODE_DEFS by label/desc client-side; aria-live count. Does NOT change node data. |
| <div className="afs-libgroup__header"> dot + label | inline style={{background:meta.color}} hardcoded hex | Badge (category, soft) / micro-label header | Thread meta.color through inline --cat custom property; dot+label use color-mix on --cat so it themes. Keep CATEGORY_ORDER iteration + skip-empty-group logic. |
| <div className="afs-libitem" draggable onClick title> | <div> with onClick, no a11y | Nav/list row upgraded to role=button | Add role=button, tabIndex=0, Enter/Space => onClickAdd(def). Keep draggable + onDragStart setData(DND_MIME,def.kind)+effectAllowed='move'; keep onClick cascading offset {x:360+(count%6)*34,y:150+(count%6)*34}; keep title=def.desc (also as Tooltip). |
| <span className="afs-libitem__icon" style={{color:meta.color}}> | inline hardcoded category hex | Category-tinted icon slot | Drive via --cat (color-mix tint background optional). lucide def.icon at unified 16px. Light/dark via CATEGORY_META threaded as tokens. |
| Background variant=Dots color={dotColor JS literal} | theme==='light'?'#cbd5e1':'#2a3650' in JS | Tokenized canvas dot | Read var(--afs-dot) (dark rgba(255,255,255,.07) / light rgba(71,85,105,.32)) via getComputedStyle or a CSS-var bridge so dots stop drifting from the token. Keep gap=18 size=1, BackgroundVariant.Dots. |
| <Controls showInteractive={false}> | stock xyflow, lightly skinned | Re-skinned Controls (solid card) | Fully tokenize .react-flow__controls: --afs-panel card, --afs-border, --afs-r-md, glyphs --afs-muted->--afs-text, IconButton hover (--afs-hover), focus ring. Keep showInteractive=false + zoom/fit behavior. |
| <MiniMap nodeColor={miniMapColor} maskColor={JS literal}> | JS CATEGORY_META hex + rgba mask literal | Re-skinned MiniMap (tokens) | maskColor=var(--afs-scrim); node fill from var(--afs-cat-*) keyed by category (keep node.data.kind->getNodeDef->category mapping, fallback --afs-cat-input). Keep pannable+zoomable + minimap card --afs-panel/--afs-border. |
| 🎨 emoji (nodeDefs.ts comment, style-panel concept) | emoji literal in comment only | Lucide Palette | Formalize Palette as the rendered glyph for the style/全局设定 IconButton; emoji stays a non-rendered comment, no DOM change. |
| nodeDefs.ts CATEGORY_META / PORT_COLORS / NODE_DEFS | hardcoded hexes, single set both themes | Token bridge (no rename/re-type) | Map the 6 CATEGORY_META + 6 PORT_COLORS values onto --afs-cat-* / --afs-type-* tokens (light+dark) consumed inline via --cat, OR keep hexes as dark fallbacks. MUST NOT change kind strings, categories, port ids/types, param keys/controls/options/defaults, CATEGORY_ORDER, or exports. |

**玻璃 / 渐变用法**：Glass is reserved for floating CHROME only, and on this screen that means exactly three things: (1) the 48px Toolbar bar itself (afs-glass-fill + backdrop-filter blur(16px) saturate(160/180%) + --afs-glass-highlight inset, border-bottom var(--afs-glass-border)) layered over the canvas; (2) the Custom Select / Combobox model popovers (Glass-chrome recipe, --afs-elev-3, short-lived, ≤1 open at a time); and (3) any Tooltip/overflow Dropdown spawned from the bar (glass-fill-strong for small text). Everything text-dense or canvas-heavy stays SOLID: the NodeLibrary rail body, every node row, the React Flow canvas working area, and the Controls/MiniMap cards are near-opaque --afs-panel — never blurred (legibility + pan/zoom GPU perf; backdrop-filter is explicitly avoided on the canvas layer). Gradient is even more disciplined: the indigo->violet->azure --afs-grad-brand appears ONLY on the 28px brand mark, and the two-stop --afs-grad-accent appears ONLY on the single Run CTA fill plus its .afs-glow emissive aura (opacity animates up on hover/running). Save is solid-accent (no gradient, no glow) so the one gradient button reads as THE AI action. Category color is a tint via inline --cat (color-mix into soft badges/icon slots), not a full gradient. A single static low-opacity --afs-aurora wash may sit behind an EMPTY canvas as the substrate the toolbar glass blurs — never animated, never behind a populated graph. Glass surface count for this viewport stays at 1 resident (toolbar) + 1 transient (popover) = within the ≤3-4 budget; glass is never nested.

**亮 / 暗说明**：All chrome consumes themed tokens via the existing html.light mechanism (no data-theme, no per-component branching). Toolbar glass: dark = rgba(20,24,38,0.60) + faint white hairline (relies on lighter surface for depth); light = rgba(255,255,255,0.62) + darker hairline + --afs-elev-3 shadow. Reduced-transparency -> solid --afs-panel both themes; @supports-not-backdrop-filter -> --afs-glass-fallback (~95%). Accent finally theme-asymmetric: Run CTA + brand use --afs-grad-accent/--afs-grad-brand whose stops differ (light full-chroma #5b54ff->#8b3dff->#06b6d4, dark desaturated #6d7cff->#9d6bff->#4fd0e0) so the gradient never vibrates on dark; on-accent label flips (white on light, dark ink #0a0e16 on the luminous dark accent). CRITICAL canvas fix: replace the JS color literals with tokens — dotColor=var(--afs-dot) (dark rgba(255,255,255,.07) / light rgba(71,85,105,.32)), minimap maskColor=var(--afs-scrim) (dark 0.42 / light 0.30), minimap node fills=var(--afs-cat-*) which now have BOTH light and dark variants (input slate, text azure, image violet, video cyan, audio teal, output emerald — light versions darkened for the bright canvas). NodeLibrary category dots/icons use the same --afs-cat-* tokens via inline --cat instead of the single dark-tuned hexes, so they no longer wash out on the light rail. Status dot uses --afs-success/--afs-warning/--afs-info (theme-tuned for >=3:1 as a non-text indicator). Drop the pure-black rgba(0,0,0,0.25/0.3) shadows for token elevation (light = layered shadow, dark = surface-lightness step). Off-white text #e8eaf0 on the #0a0e16-family dark base; blue-ink #16203a on the cool-gray light base — no pure #fff/#000.

**微交互**

- Run CTA glow: .afs-glow ::after (--afs-grad-accent, blur(28px)) animates opacity 0 -> --afs-glow-opacity on hover and holds while isRunning; transform/opacity only, --afs-dur-ui. Reduced-motion drops the transition (static glow).
- Run<->Stop swap: same slot, gradient Play -> danger-solid Square; press feedback transform:scale(0.97) at --afs-dur-micro; aria-pressed reflects running.
- Saving feedback: status dot switches to info + breathing (--afs-dur-breathe opacity/scale) and 保存 button shows Loader2 (afs-spin) with aria-busy while saving; settles to success dot + '已保存' (honor ~1s min so it doesn't flash).
- Inline rename: hover the title reveals a Pencil hint; entering edit shows accent underline + ring, autofocus + select-all; Enter commits (scale settle), Escape restores prior, focus returns to the trigger.
- Custom Select open: chevron rotates 180deg, trigger border -> --afs-accent, glass popover animates in (afs-pop: opacity + translateY(-4px) scale(.98), --afs-dur-ui from top); selected option shows Check (--afs-accent); option hover/active-descendant = --afs-hover.
- NodeLibrary search: typing filters rows live (debounced), group headers with zero matches collapse, clear X appears when non-empty, Esc clears; aria-live polite count.
- Node row interactions: hover = --afs-hover fill + --afs-border edge + cursor grab; :active cursor grabbing; keyboard focus = 2px --afs-ring; Enter/Space adds at the cascading offset (same as click); drag begins the existing DnD with effectAllowed='move'.
- Toolbar IconButton hover: bg --afs-hover, glyph --afs-muted -> --afs-text (--afs-dur-micro); :active scale(0.94); focus-visible 2px ring.
- Vertical Dividers separate the model group, the utility-icon group, and the commit/run group so the three tiers read at a glance.
- Canvas drop affordance: while dragging a node over .afs-canvas, dropEffect='move' (unchanged); optional faint accent ring pulse on the canvas edge during dragover (opacity only, reduced-motion safe).
- Controls/MiniMap hover: control buttons lift bg to --afs-hover with glyph -> --afs-text; minimap viewport rect uses --afs-border-strong stroke.
- Responsive collapse: below ~1180px the fit/style/snapshot IconButtons cross-fade into a single MoreHorizontal Dropdown (--afs-dur-ui); selects narrow with truncation.

**必须 1:1 保持的行为**

- FlowCanvas drop dispatch order EXACT: DND_MIME(node kind)->addNode(kind,position via screenToFlowPosition) | DND_ASSET->insertAssetNode(rec,position) | DND_ELEMENT->insertElementNode(el,position) | DND_SNIPPET->appendTextToSelected(resolveSnippet(s)) + window.mulby?.notification?.show(ok?'已插入片段到选中节点':'请先选中一个含文本参数的节点', ok?'success':'warning').
- onDragOver must preventDefault() and set dataTransfer.dropEffect='move' or drops break.
- ReactFlow config unchanged: nodeTypes={film:FilmNode}, onNodesChange/onEdgesChange/onConnect from store, onNodeClick->setSelected(node.id), onPaneClick->setSelected(null), onMoveEnd->setViewport(vp), isValidConnection->isValidConnection(c,currentNodes), fitView only when !viewport, defaultViewport=viewport, snapToGrid + snapGrid=[16,16], minZoom 0.2 / maxZoom 2, defaultEdgeOptions type 'default', proOptions.hideAttribution=true.
- Background/Controls/MiniMap stay present; MiniMap nodeColor keeps node.data.kind->getNodeDef->CATEGORY_META.color mapping (fallback #64748b / --afs-cat-input); Controls showInteractive={false}; MiniMap pannable+zoomable.
- Cmd/Ctrl+D duplicateSelected() preserved INCLUDING the guard that skips when activeElement is INPUT/TEXTAREA/contentEditable (now also true for the new Search Field and Select trigger inputs).
- Toolbar rename: double-click nametag -> input (autoFocus), trim + only renameProject(n) if non-empty, Enter commit / Escape cancel / blur commit, projectName fallback '未命名工程'.
- Status string preserved verbatim: `{nodeCount} 节点 · {saving?'保存中…':dirty?'未保存':'已保存'}`.
- Model selects keep wiring: value=selectedModel/selectedImageModel||'', onChange=setSelectedModel/setSelectedImageModel(value||null); empty-list placeholders '默认文本模型'/'无图像模型'; option labels '文本：'/'图像：'+(m.label||m.id).
- Toolbar button actions unchanged: fitView({duration:300,padding:0.2}); saveProject(); onOpenStyle(); onOpenSnapshots(); isRunning?cancelRun():runAll().
- Toolbar store selectors/actions unchanged: projectName,dirty,saving,nodes.length,models,imageModels,selectedModel,selectedImageModel,isRunning + renameProject,saveProject,setSelectedModel,setSelectedImageModel,runAll,cancelRun; plus useReactFlow().fitView.
- NodeLibrary keeps exporting DND_MIME/DND_ASSET/DND_ELEMENT/DND_SNIPPET (FlowCanvas imports them); onDragStart sets dataTransfer.setData(DND_MIME,def.kind)+effectAllowed='move'; onClick/keyboard-activate adds at offset {x:360+(count%6)*34, y:150+(count%6)*34}.
- NodeLibrary keeps iterating CATEGORY_ORDER -> getDefsByCategory(cat), skipping empty groups, rendering meta.color + meta.label + def.icon/label/desc with title=def.desc.
- nodeDefs.ts data contract is load-bearing and unchanged: kind strings, category assignment, port ids/labels/types (drive isValidConnection), param keys/controls/options/defaults, CATEGORY_ORDER, CATEGORY_META keys, PORT_COLORS keys, getNodeDef/getDefsByCategory exports — restyle only, no rename/re-type.
- Theme source of truth preserved: useUiStore theme value + html.light class; canvas color values continue to switch on theme (now via tokens, but the html.light mechanism is untouched).

---

### 6.4 FilmNode node cards — all 5 body layouts (standard E, media-frame A, text-data D, fan-out grid C, running-preview B) plus progress bar, retry-failed button, status header, ports, and error fallback. File: D:/Node.js/mulby-all/mulby-plugins/plugins/ai-film-studio/src/ui/components/nodes/FilmNode.tsx (CSS in src/ui/styles.css; colors from src/ui/nodes/nodeDefs.ts).

> 节点卡片（FilmNode 全部 5 种布局）：卡体保持实色（画布性能 + 可读性），把品牌 / 渐变 / 玻璃能量集中到「运行中 / 选中 / 状态」；满铺高饱和头改为低饱和渐变色头，状态点配图标。

**重设计概念（Concept）**

Re-skin the node card as a SOLID, near-opaque legible surface (per the 'solids under content' principle — node bodies are NEVER glass, for canvas pan/zoom perf and legibility), and move all brand/gradient/glass energy onto the small set of states that earn it: the RUNNING state, selection, and primary status. Keep every render-branch, layout-selection guard, handle id/type/position, lightbox index math, and store call 1:1 — this is purely a CSS/token/markup-shape change.\n\nFour moves: (1) Replace the full-bleed saturated category header with a TONAL gradient header tint via --afs-grad-header driven by the existing inline --cat color (color-mix 28%/10% dark, 18%/6% light over --afs-panel-2), so each category keeps its identity but reads as a calm tinted card header on a solid surface, with --afs-text (not #fff) label that themes. (2) Replace the color-only 8px status dot with the Status dot component ALWAYS paired with a non-color cue: queued=warning dot, running=info dot with a breathing halo, done=success dot, error=danger dot — each carries an aria-label and (where space allows) the running state shows a tiny 'Loader2 + 生成中' so status is never color-alone. (3) Consolidate the three inline-styled lock/expand buttons into the shared IconButton primitive (on-media variant with --afs-scrim backing for the frame buttons; neutral variant for the header lock), with one aria-pressed lock rule, one hover/active/focus-visible recipe, and one set of tokens. (4) Reserve the signature gradient/glow for AI work: the RUNNING node gets the 'generation-in-progress' treatment (accent-tinted hairline border + subtle --afs-glow aura + breathing status), the determinate progress bar uses --afs-grad-progress, and selection becomes a real CSS ring (--afs-accent) that COMBINES with a lock chip so both show at once. Emoji ▶/✗ become Lucide Play (fill) and X. All hardcoded rgba/pastels swap to semantic tokens so light mode finally works. The media-frame and grid keep their two affordances but both adopt the same tile/scrim/port-capsule recipe so they read as one family.

**现状问题（12）**

- Saturated flat category color is the FULL-BLEED 38px header background (#3b82f6 text-blue, #a855f7 image-purple, #ef4444 video-RED, #14b8a6 audio-teal, #10b981 output-green) with hardcoded #fff text. Reads as a dated 2018 dev tool; the red video header in particular looks like an error. No tonal/gradient/glass treatment — exactly what Aurora Glass supersedes.
- Status is a single 8px solid color dot (queued #fbbf24 / running #3b82f6 / done #10b981 / error #ef4444) with only a title='running' (raw English status) tooltip. Color-only (fails a11y), tiny, no label/icon, easy to miss; idle/queued/done have no other affordance.
- THREE controls (frame expand L323-335, frame lock L347-359, header lock L516-529) are styled ENTIRELY by inline style objects duplicating the same flex-center/16x16/transparent recipe with hardcoded color:#fff or color:inherit and four different opacities (0.55/0.75/0.8/1) for the SAME lock action. Brittle, off-token, no hover/focus/light-mode handling.
- Selection and lock are inline boxShadow rings (selected: 0 0 0 2px catColor; locked: 0 0 0 1.5px #f59e0b amber) with NO dedicated CSS, so they cannot combine — a locked+selected node shows only the selection ring, hiding lock. No hover or focus-visible affordance anywhere on the card.
- Mixed icon vocabulary: lucide SVG (Lock/LockOpen/Maximize2/RotateCcw/Loader2) coexists with literal text glyphs ▶ (play, L309) and ✗ (failed tile, L48) that don't scale/theme/align like vectors.
- Pervasive dark-only colors invisible/low-contrast on the light theme's white --afs-node-bg: tile bg rgba(255,255,255,0.05), data-row odd bg rgba(255,255,255,0.03), progress track rgba(255,255,255,0.08), thumb-badge bg rgba(11,15,23,0.72), and pastel-on-dark footer text (#fca5a5/#93c5fd/#86efac), data-head #93c5fd, data-more #60a5fa, chip #cbd5e1.
- Three disconnected palettes on one card: header = category color, ports/handles = PORT_COLORS, progress bar = its OWN unrelated #3b82f6→#06b6d4 gradient. Nothing ties them together.
- Two visual languages for 'this node has media': single media uses borderless MediaFrameNode with on-media capsule ports; multi/grid/thumb use a bordered card with edge ports.
- Failed tile = thin red border + bare ✗ with hover-only title error; no per-tile retry (only node-level button), error hidden in a tooltip.
- Heavy density with no rhythm: 11–12px body, 10px on-media labels, ~9.5px chips, 24px port rows, plus a heavy 0 4px 14px rgba(0,0,0,0.25) black drop shadow tuned only for dark.
- Magic-number layout baked into inline styles (ROW_H 24, TILE 76, FRAME_LONG 280, width 200/300) — no tokens, hard to make zoom/density-aware.
- --afs-text-dim is referenced only as a hardcoded fallback (#94a3b8) for data-row sub; the token itself was undefined, breaking light mode.

**布局规格（Layout Spec）**

REGIONS (top→bottom, per card; layout chosen by the EXISTING guard chain, unchanged):\n- Card root .afs-node: solid --afs-node-bg, 1px --afs-border, radius --afs-r-lg (12px, up from 8 only for the lg node card; tiles stay --afs-r-md), --afs-elev-1 (theme-tuned, replaces the heavy rgba(0,0,0,0.25)). Width still inline (200 default / max(200,gridWidth) grid / 300 data / measured frameSize for media). isolation:isolate so the running glow ::after can sit at z-index:-1.\n- Header .afs-node__header: height 32px (--afs-control-h, was 38), padding 0 var(--afs-sp-3 6px) 0 var(--afs-sp-4 8px), radius 11px 11px 0 0. Background = --afs-grad-header (driven by inline style --cat:<catColor>). Row: [def.icon 14px, color=--cat] + [title span, 13px/600 --afs-text, ellipsis, flex:1] + [lock IconButton sm 24px] + [Status dot 8px]. gap var(--afs-sp-3 6px).\n- Body .afs-node__body: inline height = rows*ROW_H + TOP_PAD (UNCHANGED math). Sunken feel optional via --afs-surface-sunken inset; ports absolutely positioned. Port label .afs-port 11px --afs-muted; in left 12px / out right 12px; top computed UNCHANGED (TOP_PAD + i*ROW_H + ROW_H/2). Handle dot keeps PORT_COLORS[type] inline + gains a 1.5px --afs-node-bg ring so it reads on any edge.\n- Media-frame variant .afs-node--media: transparent root (unchanged), .afs-node__frame radius --afs-r-lg, 1px --afs-border, object-fit cover (unchanged). Overlay .afs-node__frame-head = bottom-fading scrim gradient(--afs-scrim→transparent) + [icon 12px color=--cat] + [title 11px/600 #fff w/ shadow] + [expand IconButton onmedia] + [lock IconButton onmedia] + [Status dot]. Center Play IconButton (lg, onmedia, --afs-scrim) for video. On-media port capsules .afs-port--onmedia: --afs-scrim bg, #fff text, top = h*(i+1)/(n+1) UNCHANGED.\n- Fan-out grid .afs-node__grid: gridTemplateColumns repeat(cols, TILE) UNCHANGED (cols=min(4,max(1,gridCount))), gap var(--afs-sp-2 4px wait—keep existing 4px gap). Tiles = Media tile component, 76px (TILE) inline UNCHANGED, radius --afs-r-md, bg --afs-surface-sunken (replaces rgba(255,255,255,.05)). States: done=img/video cover + caption scrim; pending=dashed --afs-border + Loader2 (--afs-info); failed=--afs-danger border + bg color-mix(danger 12%) + X icon + caption.\n- Text-data card .afs-node__data (width 300 UNCHANGED): head .afs-node__data-head (clickable→openResultViewer) = [label 12px/600 --afs-text] + ['查看全文' link --afs-accent] + [running Loader2]; bg color-mix(--afs-accent 8%). List .afs-node__data-list (nowheel, max-h 260 UNCHANGED) of rows: title 12px --afs-text + Chip components (meta variant) + sub 11px --afs-text-dim (now DEFINED). Odd-row stripe = color-mix(--afs-text 3%) so it shows on light.\n- Progress overlay .afs-node__progress: Progress bar component, ~6px track --afs-surface-sunken, fill --afs-grad-progress, inline width % UNCHANGED, txt 'done/total · X失败' tabular-nums --afs-muted.\n- Retry button .afs-node__retry: Button danger sm with RotateCcw + '重试失败项 (N)'.\n- Summary footer .afs-node__summary: 11px, status-tinted via semantic tokens (error=--afs-danger, running=--afs-info, done=--afs-success, else --afs-muted), 3-line clamp UNCHANGED.\n\nGRID/SPACING/DENSITY: 8px base grid via --afs-sp-* tokens. Control rows 24–32px. Radii: card --afs-r-lg(12), header 11, tiles/thumb --afs-r-md(8), chips --afs-r-xs(4), status/handle dots round, lock buttons --afs-r-sm(6). Type ladder: title 13/600, body/port 11, chip 10.5, on-media label 10, data-sub 11. All magic numbers (ROW_H 24, TOP_PAD 8, TILE 76, FRAME_LONG 280, FRAME_SHORT_MIN 120, neutral 220x168, cols/gridWidth/bodyH formulas) PRESERVED exactly as JS constants — only their CSS-side companions move to tokens.

**ASCII 线框**

```text
STANDARD CARD (layout E)                MEDIA-FRAME (layout A)
+------------------------------+         +============================+
|░░ tonal --cat grad header ░░ |         |▓ scrim  [⛶][🔒] ● running ▓| <-frame-head
| ◇ 角色设定图       🔓  ◉run  |         |                            |
|------------------------------|         |        (image fills        |
|● 角色───            ───关键帧○|  <ports |         to true AR)         |
|                              |         |     [▶ play] (video)       |
|  [████████░░░] 5/8 · 1失败   |  <prog  |o角色─                ─关键帧o| <on-media ports
|------------------------------|         +============================+
| 生成中… 夜晚的霓虹街道反光… |  <foot   selection=2px --afs-accent ring (combines
+------------------------------+          with amber lock chip, both visible)
running card: accent hairline + soft glow aura behind

FAN-OUT GRID (layout C)                  TEXT-DATA CARD (layout D, w=300)
+----------------------------------+     +----------------------------------+
|░ tonal header  剧本生成  🔓 ◉  ░|     |░ tonal header  剧本生成 🔓 ◉done ░|
|----------------------------------|     |----------------------------------|
| +----+ +----+ +----+ +----+      |     | 剧本 · 12 场        查看全文 →   |<head
| |img | |img | | ◴  | | ✗  |      |     |----------------------------------|
| |  ✓ | |    | |pend| |fail|      |     | 场1 INT.咖啡馆 [日][3句对白]      |
| |s01 | |s02 | |s03 | |s04 |      |     |  林夏走进店里，环顾四周…          |
| +----+ +----+ +----+ +----+      |     | 场2 EXT.街道  [夜][雨]           |
|----------------------------------|     |  雨水打在霓虹灯招牌上…           |
| [↺ 重试失败项 (1)]  (danger sm)  |     |  …(nowheel scroll, max-h 260)    |
+----------------------------------+     +----------------------------------+

STATUS DOTS (always + non-color cue)     ERROR NODE (fallback)
 ● queued(amber)  ◉ running(azure+halo)  +------------------------------+
 ● done(green)    ● error(red)           | ⚠ 未知节点：{kind} (danger)  |
 running also shows: ◴ 生成中 in footer  +------------------------------+
```

**组件映射（18）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| Full-bleed saturated category header (background: cat.color, color #fff, height 38px) | .afs-node__header inline style background=cat.color | Card (category-tinted header variant) — header uses --afs-grad-header driven by inline --cat:<catColor>; label flips to --afs-text | cat.color still injected inline as the --cat custom property (keeps JS-injected color contract). 28%/10% mix dark, 18%/6% light. Height 32px. def.icon recolored to --cat. |
| 8px solid color status dot (queued/running/done/error) with title=raw status | .afs-node__status / --queued/--running/--done/--error | Status dot | Maps data.status→variant. running gets breathing halo (::after, animate opacity only). Add aria-label per status + keep running footer 'Loader2 + 生成中' so status is never color-only. Semantic tokens replace hardcoded hexes. |
| Header lock toggle (inline-styled <button>, color:inherit, opacity 0.55/1) | L508-532 inline style object | IconButton (neutral, sm 24px, aria-pressed) | Lucide Lock/LockOpen. onClick=useGraphStore.getState().toggleNodeLock(id) + stopPropagation PRESERVED. Tooltip strings preserved. aria-pressed=data.locked. |
| Frame expand button (inline-styled, color:#fff, opacity 0.8) + frame lock button (inline-styled, color:#fff, opacity 0.75/1) | L315-338 (expand), L339-362 (lock) inline style objects | IconButton (on-media variant, --afs-scrim backing) | Maximize2 expand→onOpen; Lock/LockOpen→toggleNodeLock. One scrim-backed recipe so glyph ≥3:1 over any media; single opacity rule replaces three. Both keep stopPropagation + nodrag. |
| Video play button '▶' (literal text glyph) | .afs-node__frame-play with ▶ text | IconButton (lg, on-media) + Lucide Play (fill=currentColor) | onClick=onOpen + stopPropagation PRESERVED. Replaces text ▶ with vector Play centered in scrim circle. |
| Failed tile '✗' (literal text glyph) | .afs-node__tile-x with ✗ text | Media tile (failed state) + Lucide X (--afs-danger) | Hover error tooltip preserved; consider surfacing item.error in caption. Tile bg color-mix(danger 12%), border --afs-danger. |
| Pending tile (dashed border + Loader2) | .afs-node__tile--pending | Media tile (pending state) / Skeleton | Dashed --afs-border + Spinner (--afs-info). useInView lazy-mount + Loader2 afs-spin PRESERVED. |
| Done/grid media tiles (img/video, click→lightbox) | GenItemTile / NodeTile (.afs-node__tile bg rgba(255,255,255,.05)) | Media tile / thumbnail card | bg→--afs-surface-sunken. Must become real <button>/role=button + aria-label for keyboard open (currently bare div). All click→openLightbox index math, stopPropagation, nodrag, useInView, useMediaUrl PRESERVED 1:1. |
| Single-media fallback thumb + ×N badge | .afs-node__thumb + .afs-node__thumb-badge | Media tile/thumbnail + Pill (count, on-surface) | thumb-badge dark navy rgba→Pill --afs-surface-3. 生成中 preview badge→Pill. click→openLightbox PRESERVED. |
| Native data-row chips (剧本/分镜 meta: location/time/shotSize/camera/duration) | .afs-chip (one of 3 conflicting defs, color #cbd5e1) | Chip / Tag (meta variant, xs) | Read-only meta chips (no role). Token-driven; collapses the 3 conflicting .afs-chip rules. Chinese chip text preserved verbatim. |
| Data-card head ('查看全文' link, running Loader2, click→openResultViewer) | .afs-node__data-head / __data-more (#93c5fd/#60a5fa) | Card head + Button(ghost/link sm) + Spinner | link→--afs-accent. onClick=openResultViewer(id)+stopPropagation PRESERVED. Should be a real button for keyboard. |
| Progress bar (track rgba(255,255,255,.08), bar #3b82f6→#06b6d4) | .afs-node__progress / __progress-bar / __progress-txt | Progress bar | track→--afs-surface-sunken, fill→--afs-grad-progress, role=progressbar + aria-valuenow. width % + 'done/total · X失败' text + title PRESERVED. tabular-nums. |
| Retry-failed button (#ef4444 bg, hover #dc2626) | .afs-node__retry | Button (danger, sm) + RotateCcw | onClick=retryFailedItems(id)+stopPropagation, guard failedCount>0 && status!=='running' PRESERVED. Icon + label (not color-only). |
| Selection / lock boxShadow rings (2px catColor / 1.5px #f59e0b) | inline boxShadow on root | Card selection ring (.is-selected) + lock chip/ring | Real CSS: selection=0 0 0 2px --afs-accent; lock=amber ring or corner Lock chip that COMBINES with selection (fixes mutual exclusivity). aria-selected/aria-pressed. |
| Summary footer (status-tinted text #fca5a5/#93c5fd/#86efac) | .afs-node__footer--error/--running/--done | (restyled in place) semantic-token text | error→--afs-danger, running→--afs-info, done→--afs-success, else --afs-muted. 3-line clamp + precedence logic PRESERVED. |
| Port labels + React Flow Handles (PORT_COLORS inline) | .afs-port / Handle style background=PORT_COLORS[type] | (restyled in place) — labels use --afs-muted; handle keeps inline PORT_COLORS + adds --afs-node-bg ring | Handle id/type/position and PORT_COLORS injection are graph-wiring-critical — NOT changed. Only add a hairline ring + tokenize the label color. |
| Error node fallback ('未知节点') | .afs-node--error (#f87171) | Card (error) + Lucide AlertTriangle (--afs-danger) | Text + icon. getNodeDef miss → this branch PRESERVED. |
| Card drop shadow rgba(0,0,0,0.25) | .afs-node box-shadow | --afs-elev-1 token | Theme-tuned: light layered shadow, dark faint contact shadow + surface-step lightness. |

**玻璃 / 渐变用法**：SOLID, NOT GLASS for the card body — this is the core discipline. Node cards are text/canvas-dense and pan/zoom-heavy, so per the 'solids under content' principle the card surface stays near-opaque --afs-node-bg with a 1px --afs-border and --afs-elev-1; NO backdrop-filter is applied to any node, tile, data list, or frame (protects INP with many nodes). Gradient/glow is rationed to states that signify AI identity or action:\n1. Header tint — the ONLY gradient that appears on every card: --afs-grad-header, a TONAL color-mix of the per-category --cat color into --afs-panel-2 (28%/10% dark, 18%/6% light). This is a calm tint, not the saturated brand gradient, so it carries category identity without shouting.\n2. RUNNING node = the sanctioned 'generation-in-progress' moment: the card gains an accent-tinted hairline border (color-mix --afs-accent ~35%) and a single soft --afs-glow aura (::after, background --afs-grad-accent, blur, animate OPACITY only, behind the card via isolation:isolate + z-index:-1). This is the one place the signature gradient glows, and only while status==='running'. The breathing status dot reinforces it.\n3. Determinate progress bar fill = --afs-grad-progress (the indigo→azure progress gradient) — used only for the non-text render progress, paired with a moving sheen overlay that stops on complete and under reduced-motion.\n4. Selection ring = solid --afs-accent (a fill/ring, not a gradient) so it reads as a crisp affordance.\nNo glass anywhere on this screen; the aurora backdrop and .afs-glass recipes belong to chrome (toolbar/inspector/popover/lightbox), not nodes. Glow ::after is hidden under prefers-reduced-transparency and prefers-reduced-motion.

**亮 / 暗说明**：Everything routes through the re-pointed --afs-* tokens; no per-theme branching in the component. Surfaces: card --afs-node-bg (dark #11161f / light #ffffff), tiles + body wells + progress track --afs-surface-sunken (dark #0d121a / light #e6eaf1) — this single swap fixes the four dark-only rgba overlays (tile .05, data-row .03, progress .08, thumb-badge navy) that were invisible on white. Header tint via --afs-grad-header uses theme-asymmetric mix percentages (deeper on dark, subtler on light) and the --cat color is the SAME inline value both themes (category identity is intentionally shared, matching nodeDefs); only the mix surface differs. Text: title/body --afs-text, ports/summary-default --afs-muted, data-sub now-DEFINED --afs-text-dim (dark #6b7383 / light #8a93a4, clears 3:1 both themes). Status/footer/tile-state hues come from semantic tokens that are pre-darkened on light for ≥4.5:1 text / ≥3:1 indicator: success (#34d399 dark / #059669 light), warning (#fbbf24/#b45309), danger (#f87171/#dc2626), info (#60a5fa/#2563eb). Elevation: dark relies on the surface-lightness step + faint --afs-elev-1 contact shadow; light uses the layered --afs-elev-1 shadow — replacing the heavy pure-black rgba(0,0,0,0.25). Accent (selection ring, running border/glow) is theme-asymmetric: full-chroma indigo #4f46e5 on light, desaturated #8b9bff on dark, so it doesn't vibrate. On-media controls (frame buttons, play, port capsules, tile captions) keep a --afs-scrim backing (theme-tuned 0.42 dark / 0.30 light) with #fff glyph because they sit over uncontrolled media in both themes. PORT_COLORS/handle hexes stay inline (graph-critical) but each handle gets a --afs-node-bg ring so it reads on either theme's edge.

**微交互**

- Card hover (interactive nodes): border --afs-border→--afs-border-strong + lift to --afs-elev-2 over --afs-dur-micro (120ms) --afs-ease-standard. No transform jump on canvas (avoid layout thrash); only border/shadow.
- RUNNING glow: ::after aura opacity rises from ~0 to --afs-glow-opacity when status flips to running and pulses subtly via the breathe loop; instantly removed (opacity 0) the moment status leaves running. Disabled under reduced-transparency/reduced-motion.
- Status dot 'running' breathe: ::after halo animates opacity .25↔.5 + scale .9↔1.25 over --afs-dur-breathe (1800ms) cubic-bezier(.45,0,.55,1); static at full opacity under reduced-motion.
- Lock IconButton: hover bg --afs-hover (neutral) / lift on scrim (on-media); active scale(.94); aria-pressed=true paints accent tint; focus-visible 2px --afs-ring. Icon swaps LockOpen→Lock with a --afs-dur-micro fade.
- Progress bar: fill width transitions over --afs-dur-ui (180ms) ease-standard as doneCount changes; a sheen sweep (--afs-dur-shimmer 2000ms linear) rides the fill and STOPS at 100% and under reduced-motion.
- Tile states: pending Loader2 spins (--afs-spin .8s linear); done tile fades/scales in (opacity+transform) when its media URL resolves; failed tile can do one subtle error shake on first paint (transform only, reduced-motion → none). Hover tile: border→--afs-border-strong + cursor zoom-in.
- Selection: applying .is-selected animates the ring (box-shadow) appearance over --afs-dur-micro; combines with the lock chip so locking a selected node adds the amber chip without hiding the ring.
- Media-frame play/expand: hover brightens the scrim fill; press scale(.94). Double-click frame still opens lightbox (no animation, instant handoff).
- Data-card head hover: '查看全文' link underline/color lift over --afs-dur-micro; running Loader2 spins inline.
- All press feedback (transform: scale) and the glow transition respect prefers-reduced-motion (neutralized to none); only opacity/transform/filter animate — never backdrop-filter, box-shadow spread, or layout.

**必须 1:1 保持的行为**

- Layout-selection guard chain EXACTLY: singleMedia (media && count===1 && !showGrid && !showData && !previewImg && status!=='running') → MediaFrameNode; else previewImg(status==='running'?data.previewUrl) → preview thumb; else showGrid (!previewImg && gridCount>1) → grid; else showData (def.category==='text' && !showGrid && dataCard rows>0) → data card; else media → fallback thumb. Progress/retry/footer overlays under their existing guards.
- getNodeDef(data.kind); miss → afs-node--error '未知节点：{kind}'. def.icon/label/category/inputs/outputs, CATEGORY_META[def.category].color (injected inline as --cat), PORT_COLORS[port.type] (injected inline on Handle) all keep feeding the same values.
- Ports: one <Handle> per input (type=target, Position.Left, id=port.id) and output (type=source, Position.Right, id=port.id); vertical top = body: TOP_PAD+i*ROW_H+ROW_H/2, media: h*(i+1)/(n+1). Handle ids/types/positions are graph-wiring-critical — unchanged.
- MediaFrameNode AR measurement (img onLoad naturalWidth/Height, video onLoadedMetadata videoWidth/Height → setAr) and useUpdateNodeInternals(id) on [id,w,h] change; frameSize clamps long edge to [120,280], neutral default 220x168. All unchanged.
- Lock toggle: useGraphStore.getState().toggleNodeLock(id) + e.stopPropagation() in BOTH header and frame variants; tooltip strings reflect data.locked; locked shows amber affordance + Lock icon.
- Lightbox: openLightbox(lbItems, index) from useUiStore; lbItems built from doneItems (hasItems) else tiles via toLb carrying {ref,type,nodeId:id,port:outKey,index,title,meta,prompt}; index = dense index into output items; lbIndexByIdx (it.idx→lightbox position) used for grid clicks. openResultViewer(id) on data-head click. All index/mapping math preserved exactly.
- stopPropagation on media single-click (img/video onClick) so preview doesn't select the node; double-click frame → onOpen; video Play and expand → onOpen. nodrag on interactive elements; nowheel on data list; useInView lazy mount (300px rootMargin); useMediaUrl ref→URL resolution all retained.
- Grid math: cols=min(4,max(1,gridCount)); gridCount=max(hasItems?genItems.length:runningTotal, tiles.length); pending=max(0,runningTotal-tiles.length); node width=max(200, cols*(TILE+4)+12). GenItemTile vs NodeTile branch on hasItems; pending tiles render Loader2.
- Retry-failed: button only when failedCount>0 && status!=='running'; onClick→retryFailedItems(id) (stopPropagation). failedCount = items with status==='failed'.
- Progress: shown when status==='running' && progTotal>1; progTotal=hasItems?genItems.length:runningTotal; doneCount=hasItems?done items:tiles.length; width=round(doneCount/progTotal*100)%; text 'done/total · X失败'; title with same.
- Footer precedence: error→data.error||'运行出错'; running→stream tail truncate(slice(-80),80) or '生成中…'; done→outputSummary(data) if non-empty; else paramSummary(data). Rendered only when footer && !media && !previewImg && !showGrid && !showData. outputSummary/paramSummary/dataCard/firstMedia/mediaTiles/jsonOutput/truncate logic and ALL Chinese label strings (剧本·N场, 分镜·N镜, 角色·N个, 大纲·N节拍, 视频·N段, 图像·N张, 音频·N, JSON 已生成, 生成中…, 查看全文, etc.) preserved verbatim.
- previewImg only while status==='running'; preview thumb badge '生成中…'. Single-media count badge ×N when media.count>1.
- All Chinese tooltip/title strings (lock/unlock copy, '拖动移动 · 双击看大图', '播放（全屏 Lightbox）', '看大图（也可双击媒体）', '点击看大图', '查看全文…', retry title, progress title, failed-tile error title) preserved or only enriched, never dropped — they are the sole on-screen explanation for many controls.
- Constants ROW_H=24, TOP_PAD=8, TILE=76, FRAME_LONG=280, FRAME_SHORT_MIN=120 and the neutral 220x168 default kept exactly. memo() wrapping of the exported component kept for render perf.

---

### 6.5 Inspector drawer + fields + OptimizableField (right panel)

> 属性面板（Inspector）：保持实色密集内容面板，玻璃只留给已浮于其上的 chrome（下拉 / 提示气泡）；保留三段式结构，统一字段系统与运行按钮组。

**重设计概念（Concept）**

Re-skin the Inspector as a solid, dense, near-opaque content panel (NOT glass — it is text-heavy and lives over the canvas) using the Aurora Glass token system, with glass reserved strictly for the floating chrome that already overlays it (the Custom Select / Combobox popovers and Tooltips). The drawer keeps its exact three-region anatomy — pinned header, pinned action zone, scrollable field/IO/result/output body, pinned delete footer — but each region gains a clear role via the token elevation ladder instead of flat hairlines. The node's category identity moves from a raw inline-colored badge into a tokenized Badge (soft, category-tinted via --cat injected from CATEGORY_META.color) plus an optional --afs-grad-header tint on the header strip, so the existing inline color injection still drives it but now reads in both themes. The 'Run this node' button becomes the single signature gradient Button with the .afs-glow aura (one per surface), while 'continue from here', uploads, and save-to-library become neutral secondary Buttons — finally establishing primary/secondary hierarchy. Every native <select> becomes a headless Custom Select (long model lists → Combobox) whose popover is the sanctioned glass-chrome surface; the snippet inserter becomes a grouped Custom Select that keeps its reset-to-'' insert-action semantics. Every field is wrapped in the unified Field wrapper (label/help/error + aria wiring) and every input uses the sunken Text Input / Textarea / Number Stepper recipes. OptimizableField becomes a Textarea/Input with the optimizable variant: its AI button is a token-driven IconButton tinted with --afs-type-image (violet) and the undo is a neutral IconButton — no more dark navy blob. Result/preview/stream blocks become framed cards using the two-AI-states model (error = danger-bordered card; running preview = generation-in-progress; streaming text = shimmer). JSON output cards collapse onto the single canonical Chip and Card components; media uses Media tile / thumbnail card; the empty state gets the Empty state component with an aurora-tinted icon. Net effect: same information, same wiring, but a coherent, modern, hierarchical inspector that matches the rest of the workbench.

**现状问题（13）**

- Native unstyled controls dominate: every param 'select', the snippet inserter (with <optgroup>), and the text-model / image-model / provider-override selects are raw <select>. They render OS-default arrows and OS-native popup lists that ignore the theme entirely and differ between Windows/macOS and light/dark. This is the single biggest visual break in the drawer.
- Four+ inconsistent button idioms in one panel: run uses .afs-inspector__run/--alt, edit/save use .afs-btn--mini, JSON/raw/edit toggles use the borderless link-style .afs-raw__toggle, OptimizableField AI/undo + MediaTile folder use bespoke icon buttons, and delete uses .afs-inspector__delete. No shared button primitive, no clear primary/secondary hierarchy.
- Flat 'property grid' look: 11px muted labels stacked over 12px inputs, 6px radii, dashed 1px .afs-io separators, 10-11px chip/meta text. High density but no hierarchy, no elevation, no gradients/glass — feels like a debug console rather than a polished inspector.
- OptimizableField AI button is hardcoded dark navy (rgba(15,22,38,0.92)) with purple #c084fc text/icon; in light mode it becomes a dark blob floating over a white field. It also has no relationship to the brand accent.
- Three conflicting .afs-chip definitions in styles.css (square token-driven ~L815, pill rgba/#cbd5e1 ~L1656, third ~L2578) mean chip appearance is cascade-order-dependent and unpredictable across the JSON cards.
- afs-inthumb--ph is referenced in JSX (InputSummary loading state) but has NO CSS rule — it renders as a bare empty bordered box artifact while thumbnails resolve.
- Delete button danger only reads in dark (hover bg #7f1d1d). Error/preview/stream result blocks are dark-tuned (rgba(185,28,28,0.15) bg + #fca5a5 text) and wash out / lose contrast in light mode.
- Native <video controls> / <audio controls> in MediaTile use raw browser player chrome — foreign to the glass aesthetic and unthemed.
- Inline runtime style injection (head borderColor + badge background = CATEGORY_META.color) bypasses tokens; the legacy category hexes (#3b82f6/#a855f7/#ef4444/#14b8a6/#10b981/#64748b) were never validated for light-mode contrast.
- Result/preview/stream are plain top-bordered <pre>/<img> stacks with no card framing or distinction between 'error' / 'processing preview' / 'streaming text' states.
- Header badge+kind, action buttons, scroll body, and delete are all flat undifferentiated panels — there is no visual anchor for the node's identity or its single most-important action (Run).
- Empty state is two centered muted text lines with no icon/illustration — minimal and dated; the unknown-node fallback is a single muted line.
- CJK arrows used as separators ('插入片段 → …', '从此处继续') and text-only ellipsis states ('生成中…') with only a 12-14px spinner — no real progress affordance.

**布局规格（Layout Spec）**

OVERALL: Panel/Section component as root (.afs-panel, solid --afs-panel surface, border-left 1px --afs-border). Drawer mounts as the floating inspector variant (non-modal, NOT aria-modal, Esc does NOT close, width 286px → 256px under 1200px) preserving current mount-only-when-node-selected behavior. Vertical flex column, height 100%, min-height 0. Four regions top-to-bottom:\n\nREGION 1 — HEADER (pinned, ~48px, .afs-panel__head): left = category Badge (soft variant, --cat = CATEGORY_META[def.category].color injected inline) + node-kind label (def.label, Section-title 16/600 --afs-text). Optional 1px bottom hairline that appears only when the body is scrolled (is-scrolled). The header strip MAY carry a very subtle --afs-grad-header tint driven by --cat (28%/10% dark, 18%/6% light). Spacing: 0 var(--afs-sp-5) horizontal, gap var(--afs-sp-3).\n\nREGION 2 — ACTION ZONE (pinned, outside scroll, padding var(--afs-sp-5) var(--afs-sp-5) var(--afs-sp-4)): conditional buttons stacked / wrapped on the 8px grid, gap var(--afs-sp-3). Contains (per current gating): upload-image (secondary Button, Upload icon), save-to-library (secondary Button, BookmarkPlus icon), upload-audio (secondary Button), and the run-row. Run-row = a flex row: PRIMARY gradient Button '运行此节点' (Play→Loader2 when running, .afs-glow) at flex:1, plus secondary Button '从此处继续' (FastForward) only when hasDownstream. Both md size (32px). If no action buttons apply (non-runnable, non-upload), this region collapses to 0 height.\n\nREGION 3 — SCROLL BODY (flex:1, min-height:0, overflow-y:auto, .afs-scroll thin scrollbar, padding var(--afs-sp-5)). Sections separated by Divider/Form-section spacing rhythm (16/12/8). Order preserved exactly:\n  a) 节点标题 — Field(stacked) + Text Input(md).\n  b) Dynamic params — one Field per def.params entry; control by type: textarea→Textarea(md, 4 rows) or optimizable variant; number→Number Stepper(md); select→Custom Select(md); text→Text Input(md) or optimizable variant.\n  c) Snippet inserter (when snippetTarget && snippets.length>0) — Field labeled '插入片段' with ArrowRight(12, aria-hidden) + target label; control = grouped Custom Select with placeholder option '选择片段插入…', optgroup section headers (micro-label uppercase), value resets to '' after select.\n  d) Model/provider overrides — Custom Select (or Combobox if list is long): text-model (category text), image-model (category image), provider (when providerCap); each first option = follow-default em-dash placeholder. capProviders-empty → Field help/note text.\n  e) No-params note (gated identically) → muted helper line.\n  f) 输入 section — Form-section with micro-label title '输入'; each input port = a compact row: port label + type Badge(type variant, --afs-type-*) on the left, InputSummary on the right; '未连接' rendered as muted note. Replace dashed .afs-io border with Divider spacing.\n  g) Result blocks (same conditions/order): error→danger-framed Card; error+stream→Card with mono <pre> ('模型原始输出'); running+previewUrl→generation-in-progress Card with <img> + Progress/Spinner; running+stream→generation-in-progress Card with shimmering streaming-text <pre>.\n  h) 输出 section — Form-section title '输出' (+ '（生成中…）' suffix while running); per output port: optional outport label (only when def.outputs.length>1) + OutputView (JSON cards via Chip/Card, media via Media tile gallery, editable text).\n\nREGION 4 — DELETE FOOTER (pinned, outside scroll, padding var(--afs-sp-5)): full-width danger Button (secondary→danger-on-hover), Trash2(16) + '删除节点'.\n\nDENSITY: 8px grid, control rows 32px (md) / 26px (sm dense), UI type 11-14px, radii 6-8px for controls, 12px for cards. Empty state (Region replaces all) uses generous sp-7/8/9 spacing + 40-48px icon + 22px heading + aurora backdrop garnish.

**ASCII 线框**

```text
┌──────────────────────────────────────┐ ← .afs-panel (solid, 286px), border-left
│ [● 图像 AI]  星空生成               │ Region1 HEADER: Badge(soft,--cat)+kind
│ ░░ subtle --afs-grad-header tint ░░  │   (sticky; hairline appears when scrolled)
├──────────────────────────────────────┤
│ ┌────────────────────────────────┐   │ Region2 ACTION ZONE (pinned)
│ │ ⬆ 上传角色图  │  │ 🔖 保存到库 │   │  secondary Buttons (conditional)
│ ╔══════════════════╗ ┌───────────┐   │
│ ║ ▶  运行此节点    ║ │ ⏩ 从此处继续│  │  PRIMARY gradient(.afs-glow) + secondary
│ ╚══════════════════╝ └───────────┘   │
├──────────────────────────────────────┤
│ ▏SCROLL BODY (.afs-scroll)        ▏  │ Region3
│ 节点标题                              │  Field + Text Input (sunken)
│ ┌────────────────────────────────┐   │
│ │ 星空生成                        │   │
│ └────────────────────────────────┘   │
│ 画面描述                              │  Textarea (optimizable variant)
│ ┌────────────────────────────────┐   │
│ │ 夜晚霓虹街道，雨后反光…          │   │
│ │                          ↺  ✦AI │   │  undo=neutral IconBtn, AI=violet IconBtn
│ └────────────────────────────────┘   │
│ 画面比例                              │  Custom Select (trigger; glass popover)
│ ┌────────────────────────────┬─┐     │
│ │ 16:9 (横屏)                │▾│     │
│ └────────────────────────────┴─┘     │
│ 插入片段  →  画面描述                 │  grouped Custom Select
│ ┌────────────────────────────┬─┐     │
│ │ 选择片段插入…              │▾│     │
│ └────────────────────────────┴─┘     │
│ 图像模型（覆盖顶栏）                  │  Custom Select / Combobox
│ ┌────────────────────────────┬─┐     │
│ │ — 跟随顶栏（默认）         │▾│     │
│ └────────────────────────────┴─┘     │
│ ───────────────────────────────────  │
│ 输入                                  │  Form-section (micro-label)
│  参考图 [image]            🖼 ×3      │  port label + type Badge + InputSummary
│  提示词 [text]             未连接     │  muted note
│ ───────────────────────────────────  │
│ ┌── ⚠ 生成失败 ─────────────────┐    │  error → danger-framed Card
│ │ provider timeout (502)         │    │
│ └────────────────────────────────┘   │
│ 输出（生成中…）                       │  Form-section
│ ┌──────┐ ┌──────┐                    │  Media tile gallery (2-col)
│ │ img ✓│ │ ◴pend│   3 项             │
│ │  ×3  │ │      │                    │
│ └──────┘ └──────┘                    │
│ ▿                                     │
├──────────────────────────────────────┤
│ ┌────────────────────────────────┐   │ Region4 DELETE FOOTER (pinned)
│ │ 🗑  删除节点                    │   │  danger Button (full width)
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘

EMPTY STATE (no node selected) — replaces whole panel:
┌──────────────────────────────────────┐
│         ( aurora glow garnish )       │
│              [ ⬚ MousePointer ]       │  Empty state icon (--afs-text-dim)
│           未选中节点                  │  heading 22/600 --afs-text
│   点击画布上的节点以编辑参数          │  hint --afs-muted
└──────────────────────────────────────┘
```

**组件映射（35）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| Root .afs-inspector drawer | div.afs-inspector (flat --afs-panel) | Panel / Section + Drawer (floating, non-modal variant) | Solid surface, NOT glass (text-dense). Keep 286→256px responsive width and mount-when-selected behavior; non-modal so canvas stays interactive and Esc/Delete keybindings are untouched. |
| Header badge + kind label | .afs-inspector__head (inline borderColor) + .afs-inspector__badge (inline background) + .afs-inspector__kind | Panel__head + Badge (soft variant) + Section-title | Keep CATEGORY_META.color injection but pass it as --cat to a tokenized soft Badge + optional --afs-grad-header header tint, so it reads in light + dark. Validate the 6 legacy category hexes against light surfaces. |
| Upload-image button | button.afs-inspector__run.afs-inspector__run--alt + Upload(14) | Button (secondary, md) + Upload icon (16) | Keep hidden <input type=file accept=image/*>, readFileAsDataUrl, setNodeImage(port 'image' for assets else 'out'), value='' reset, kind-varying label/title, '图片读取失败' toast. |
| Save-to-library button | button.afs-inspector__run.afs-inspector__run--alt + BookmarkPlus(14) | Button (secondary, md) + BookmarkPlus icon | Keep onSaveToLibrary: name-required warning toast, kind/description/prompt/refAssetIds derivation, saveElement, success toast. |
| Upload-audio button | button.afs-inspector__run + Upload(14) | Button (secondary, md) + Upload icon | Keep hidden audio input, setNodeAudio, '音频读取失败' toast. |
| Run this node button | button.afs-inspector__run + Play/Loader2(14) | Button (gradient variant + .afs-glow, md, loading state) | THE single signature action per surface. runNode(node.id); disabled while isRunning; Loader2 afs-spin + '生成中…' when running===true; aria-busy. Loading swaps leading icon, keeps label width. |
| Continue-from-here button | button.afs-inspector__run.afs-inspector__run--alt + FastForward(14) | Button (secondary, md) | Only when hasDownstream; runFrom(node.id); disabled while isRunning. Keep gating predicate identical. |
| '插入片段 → ' / '从此处继续' CJK arrow separators | literal '→' text | ArrowRight (Lucide, 12px, aria-hidden) flow separator | Purely presentational swap; copy and target-label logic unchanged. |
| Node-title input | input.afs-field__input[type=text] | Field (stacked) + Text Input (md) | updateNodeTitle(node.id, value) preserved; native <input> retained for 1:1 onChange. |
| Param control: textarea | textarea.afs-field__input rows=4 | Field + Textarea (md, min 4 rows) | updateNodeParam(node.id, p.key, value) unchanged; placeholder preserved. |
| Param control: number | input.afs-field__input[type=number] (OS spinner) | Field + Number Stepper (md) | Suppress native spinner, add ±. Keep coercion: ''→'' else Number(); same updateNodeParam write. |
| Param control: select | native <select>.afs-field__input + <option> | Field + Custom Select (headless listbox, md) | Same options from p.options with p.default fallback; value/onChange→updateNodeParam identical. Popover = glass chrome. |
| Param control: text | input.afs-field__input[type=text] | Field + Text Input (md) | Or optimizable variant when getFieldOptimizer returns a guide — same substitution rule. |
| OptimizableField (input/textarea + AI/undo) | .afs-optfield + .afs-optfield__btn--ai (purple #c084fc on rgba(15,22,38,0.92)) | Text Input / Textarea (optimizable variant) + IconButton ×2 | AI button = IconButton tinted --afs-type-image (violet, theme-tuned); undo = neutral IconButton. Both type=button, bottom-right affix, input gets extra bottom-right padding. Preserve: onChange clears undoVal; AI disabled when busy\|\|!cur.trim(); model-missing error toast; optimizeFieldText(guide,cur,model); set undoVal only if out&&out!==cur; throw→toast; onUndo restores. |
| Snippet inserter select | native <select> + <optgroup> + <option> (controlled value='' reset) | Custom Select (grouped, md) | optgroup→group section headers (uppercase micro-label). Keep gating (snippetTarget && snippets.length>0), insertSnippet appends resolveSnippet newline-joined, value resets to '' after pick. Placeholder option '选择片段插入…'. |
| Text-model override select | native <select> | Custom Select or Combobox (md) | Use Combobox when models list is long. First option = '跟随顶栏（默认）' = '' → updateNodeParam('modelOverride'). |
| Image-model override select | native <select> | Custom Select or Combobox (md) | Same as text-model; updateNodeParam('imageModelOverride'); '' = follow. |
| Provider override select | native <select> + .afs-inspector__note | Custom Select (md) + Field help text | Shown when providerCap; capProviders filtered by capability; '跟随默认' = ''; updateNodeParam('providerOverride'). capProviders empty → Field help/note '尚无…供应商'. Keep label '{providerCapLabel}供应商（覆盖默认）'. |
| No-params note | div.afs-inspector__note | Field help / muted helper line | Same gating (params empty && not text/image && !providerCap). |
| Input section + IO rows | .afs-section/.afs-io (dashed border) + .afs-portcol__type + InputSummary | Form-section + Divider spacing + Badge (type variant) + InputSummary | Type chip → type Badge colored via --afs-type-*. '未连接' → muted note. gatherInputs + per-port mapping unchanged. |
| InThumb placeholder (--ph) | span.afs-inthumb--ph (NO CSS — empty box) | Skeleton (block, --afs-surface-sunken) | Fix the missing-style artifact: render a small skeleton block while useMediaUrl resolves; same resolution logic. |
| InputSummary thumb | img.afs-inthumb / .afs-inmini | Media tile / thumbnail (xs) + caption text | 22px thumb keeps useMediaUrl; counts/slice(0,40)/JSON/视频/音频/空 mapping unchanged. |
| Error result block | .afs-result.afs-result--error (rgba(185,28,28,0.15)+#fca5a5) | Card (data, danger-framed) + AlertTriangle icon | Tokenize to --afs-danger; pair color with icon+text (not color-only). Same render condition (node.data.error). |
| Raw model output (error+stream) | .afs-result + .afs-result__pre | Card + mono <pre> (code style) | Title '模型原始输出（供排查）'; --afs-font-mono. Condition unchanged. |
| Running preview (image) | .afs-result + .afs-result__img | Glass generation-in-progress Card + Media + Spinner/Progress | PROCESSING/GENERATING state per two-AI-states model; condition running && previewUrl unchanged. |
| Running stream (text) | .afs-result + .afs-result__pre | Card + streaming-text shimmer (Skeleton streaming variant) | Shimmer sweep on in-flight text; stop instantly on settle. Condition running && !previewUrl && stream unchanged. |
| Output section + outport label | .afs-section/.afs-outport/.afs-outport__label + OutputView | Form-section + per-port wrapper + OutputView | Title '输出'+'（生成中…）' suffix; outport label only when def.outputs.length>1. OutputView dispatch + lightbox index logic 1:1. |
| JSON cards (Scene/Shot/Char/Raw) | .afs-cards/.afs-card(*) + 3 conflicting .afs-chip + .afs-raw__toggle | Card (data) + Chip (canonical, meta variant) + Form-section collapsible (RawJson) | Collapse all 3 chip definitions onto ONE Chip. RawJson toggle → disclosure; keep ChevronRight/Down + defaultOpen rules. All field readouts unchanged. |
| EditableValue (view/edit JSON/text) | textarea.afs-editbox + .afs-btn--mini + .afs-raw__toggle + .afs-editerr | Textarea (code variant) + Button ×2 (secondary/primary) + Field error + IconButton (Pencil edit toggle) | Keep edit/cancel/save flow, onEditText(draft)→error\|null, '编辑'/'编辑 JSON' label, JSON 2-space serialize. Pencil edit affordance. |
| MediaTile | .afs-tile + native <video>/<audio> controls + .afs-tile__folder | Media tile / thumbnail card + IconButton (FolderOpen, FolderOpen 12→14) | Keep useInView('400px') lazy video mount, useMediaUrl, img→lightbox only for image/video, caption name=meta.name\|\|meta.shot, folder→window.mulby.shell.showItemInFolder when localPath. Native <video>/<audio> retained (a11y scrub) but framed by tile chrome. |
| Gallery + count | .afs-gallery / .afs-gallery__count | Media tile grid + Pill (count, on-surface) | 2-col grid preserved; '{n} 项' becomes a count Pill; openLightbox(lbItems,i) unchanged. |
| Delete-node button | button.afs-inspector__delete (hover #7f1d1d, dark-only) | Button (secondary→danger on hover, full width) + Trash2(16) | removeNode(node.id); danger hue from --afs-danger (theme-tuned); keep icon+label (not color-only). |
| Empty state (no node) | .afs-inspector__empty + __empty-hint (2 muted lines) | Empty state (no-selection variant) | Aurora-tinted backdrop + Lucide icon (--afs-text-dim, aria-hidden) + heading '未选中节点' + hint '点击画布上的节点以编辑参数'. Same render condition (!node \|\| !selectedNodeId). |
| Unknown-node fallback | .afs-inspector__empty single line | Empty state (no-data variant) | '未知节点类型：{kind}' when getNodeDef returns null; same condition. |
| Inline spinner '生成中…' | Loader2 + afs-spin (12-14px) | Spinner (with-label, on-accent inside gradient button) | Honors 1s min-display; stroke=currentColor inherits --afs-on-accent in the gradient run button. |

**玻璃 / 渐变用法**：Glass is deliberately NOT used on the inspector body itself — the panel is text-dense content, so per the 'solids under content' principle it stays a near-opaque --afs-panel surface with the elevation ladder (panel → panel-2 → surface-sunken) and hairline borders carrying separation. Glass appears here ONLY on the floating chrome that overlays the inspector and is short-lived / few-at-a-time: (1) the Custom Select / Combobox popovers (model/param/snippet/provider dropdowns) use the glass-chrome recipe (--afs-glass-fill + blur(16px) + --afs-glass-border + --afs-elev-3); (2) Tooltips on icon-only buttons (folder, AI-optimize, undo) use the strong-fill glass; (3) the running-preview 'generation-in-progress' card MAY use the glass generation-in-progress recipe (accent-tinted border + glow) because it is transient. All ship the standard fallbacks (no-backdrop-filter → opaque fill, prefers-reduced-transparency → --afs-surface-3, forced-colors → Canvas/CanvasText). The signature indigo→violet→azure gradient is used sparingly and only on active/primary affordances: the 'Run this node' button (--afs-grad-accent fill + .afs-glow aura that animates opacity on hover/running only) is the one gradient CTA per surface; the header may carry a faint --afs-grad-header category tint driven by the inline --cat; the determinate running progress bar uses --afs-grad-progress; Custom Select 'checked' option and any active toggle use color-mix on the themed accent. Idle controls (inputs, secondary buttons, IO rows, JSON cards) get NO gradient.

**亮 / 暗说明**：All theming flows through tokens, never per-component branches. Inspector body: dark depth comes from surface-lightness steps (--afs-panel #11161f base, header one step up to --afs-panel-2, fields sunken to --afs-surface-sunken #0d121a) plus a faint contact shadow; light depth comes from white --afs-panel + real --afs-elev-1/2 shadows and the --afs-surface-sunken #e6eaf1 inset wells. Placeholders use the now-DEFINED --afs-text-dim (dark #6b7383 / light #8a93a4) — fixing the legacy undefined token that broke light mode. Category badge: keep the inline CATEGORY_META.color as --cat but render through a soft Badge (color-mix(--cat 16%) bg + --cat text); the six legacy hexes must be re-checked for ≥4.5:1 on light — prefer remapping them to the --afs-cat-* token ramp (input slate, text azure, image violet, video → map to a tokenized red, audio teal, output emerald) so light contrast holds. Run button gradient stops come from theme-tuned --afs-grad-accent (light full-chroma, dark desaturated) with --afs-on-accent label flipping (#fff light / dark ink on the luminous dark accent). OptimizableField AI button drops rgba(15,22,38,0.92)+#c084fc and becomes an IconButton in --afs-type-image (light #7c3aed / dark #a78bfa) so it reads on white instead of being a dark blob. Delete danger replaces #7f1d1d hover with --afs-danger (light #dc2626 full-strength / dark #f87171). Error/stream cards use --afs-danger border + flattened color-mix bg so text holds contrast in both themes. Select popovers use the asymmetric glass recipe (light white-tint + darker hairline + shadow; dark deep blue-black tint + faint white hairline + surface-lightness). Native <video>/<audio> remain browser-chromed (unavoidable) but are framed by tokenized tile surfaces in both themes.

**微交互**

- Run button: idle gradient with glow opacity 0; on hover glow rises to --afs-glow-opacity (120ms); while running aria-busy=true holds the glow on and swaps Play→Loader2 (afs-spin) with label '生成中…' at frozen width; press scale(0.97). Respects prefers-reduced-motion (no press scale, spinner→opacity pulse).
- Custom Select open: chevron rotates 180° and trigger border → --afs-accent; glass popover animates in from top edge (opacity + translateY(-4px)→0 scale .98→1, 180ms --afs-ease-standard); option hover → --afs-hover, checked option shows Check in --afs-accent + faint accent tint.
- OptimizableField AI-optimize: on click button shows Loader2 (afs-spin) + aria-busy; on success the field value swaps and the undo (RotateCcw) IconButton fades in; any manual keystroke clears the undo point and fades the undo button out.
- Header hairline: the sticky header gains a 1px --afs-border bottom + --afs-elev-1 only once the scroll body is scrolled (is-scrolled), giving a subtle 'lifted' cue (border-color/box-shadow transition 180ms).
- Streaming-text result: while running with a text stream, the in-flight <pre> shows the brand-gradient shimmer sweep (2000ms linear loop) signalling GENERATING; it stops the instant the token settles. Running image preview shows a determinate --afs-grad-progress bar with a moving sheen.
- Number Stepper: ▲▼ buttons support press-and-hold repeat; at-min/at-max the corresponding chevron disables; value uses tabular-nums for stable width.
- Media tile: hover lifts border to --afs-border-strong + slight cursor zoom-in; clicking an image/video tile opens the lightbox; pending tiles show a dashed border + Spinner, failed tiles a danger border + X.
- Delete button: neutral by default; on hover the fill/text shift to --afs-danger (120ms) keeping the Trash2 icon + label so intent is never color-only; press scale(0.97).
- Input thumbnails: while useMediaUrl resolves, a small Skeleton block shimmers in place of the old empty --ph box, then cross-fades to the resolved <img>.
- Field focus: inputs/textarea/select-trigger transition border → --afs-accent + 2px --afs-ring box-shadow on focus-within (180ms); error state swaps to --afs-danger border + ring and reveals an AlertTriangle + message (aria-live polite).

**必须 1:1 保持的行为**

- Empty/unknown states: render Empty when (!node || !selectedNodeId); unknown-kind fallback when getNodeDef(node.data.kind) returns null — same conditions.
- Header reflects CATEGORY_META[def.category] label+color (badge + header tint) and def.label — inline --cat injection retained.
- runnable predicate identical: category text/image/video/audio, input (except image-input & audio-input), and output kinds preview/compose/export/merge.
- Run buttons: runNode(node.id); '从此处继续' only when hasDownstream (edges.some(e=>e.source===node.id)) → runFrom(node.id); both disabled while isRunning; spinner+'生成中…' when runningNodeId===node.id.
- Upload image: hidden <input type=file accept=image/*>, readFileAsDataUrl, setNodeImage(node.id, dataUrl, isAsset?'image':'out'), e.target.value='' reset, kind-varying label/title, '图片读取失败' error toast.
- Upload audio: accept=audio/*, setNodeAudio(node.id, dataUrl), '音频读取失败' toast.
- Save-to-library (character/scene/prop only): require non-empty name (else warning toast '请先填写名称'); kind from isCharacter/isScene/prop; description = appearance(char) else description; prompt = refPrompt; refAssetIds from outputs.image.assetId; saveElement(); success toast '已保存到库：{name}'.
- Node title → updateNodeTitle(node.id, value).
- renderControl mapping unchanged: textarea(rows=4)/number(''→'' else Number())/select(options with p.default fallback)/text; OptimizableField substituted for text & textarea iff getFieldOptimizer(kind,key) returns a guide; all writes via updateNodeParam(node.id, p.key, value).
- Snippet inserter: only when snippetTarget (first textarea param key) && snippets.length>0; SNIPPET_GROUPS→groups; insertSnippet appends resolveSnippet result newline-joined to the target param; select value resets to '' after pick.
- modelOverride select (category text) over models; imageModelOverride (category image) over imageModels; providerOverride when providerCap (video→video, bgm→music, tts→tts) over capProviders filtered by capability; '' = follow default; capProviders empty → note prompting to add provider in top bar.
- No-params note only when params empty AND category not text/image AND !providerCap.
- Input section: gatherInputs(node, allNodes, edges); per def.inputs port show label + type + InputSummary of inputs[p.id][0], or '未连接' note.
- Result blocks order/conditions: error; error+stream raw output; running+previewUrl image; running+stream(no preview) pre.
- Output section: per outputEntries OutputView with nodeId/port/title(node.title||def.label)/nodePrompt(params.prompt if string)/onEditText→updateNodeOutputText(node.id,k,text); outport label only when def.outputs.length>1; '（生成中…）' suffix while running.
- OutputView dispatch: json/text/(text&&!items&&!url)→EditableValue; mediaList = items.filter(hasMedia) else single image/video/audio if hasMedia; lbItems from image/video only with index = rawItems.indexOf(it); openLightbox(lbItems, i) on tile click; '（暂无可显示内容）'/'（无内容）' notes.
- MediaTile: video lazy-mount via useInView('400px'); useMediaUrl(lazy?inView:always); img onClick→lightbox only for image/video; caption name=meta.name||meta.shot; folder button → window.mulby.shell.showItemInFolder(localPath) only when localPath present.
- EditableValue: edit/cancel/save flow; JSON serialized 2-space (fallback value.text); save→onEditText(draft) returns error string|null; '编辑'/'编辑 JSON' label by isJson; RawJson defaultOpen=true for unstructured JSON, open for Scene/Shot/Char lists.
- InputSummary mapping (items thumb×N / 'N 项' / 剧本·N场 / 分镜·N镜 / 角色·N个 / JSON / 视频 / 音频 / text.slice(0,40) / 空) and InThumb useMediaUrl resolution.
- OptimizableField: onChange clears undoVal; onOptimize guarded by busy||!cur.trim() and requires selectedModel (error toast '未配置文本模型（请在顶栏选择）' if missing); optimizeFieldText(guide,cur,model); set undoVal=cur and update only if out && out!==cur; throw→error toast; onUndo restores undoVal then clears it; AI/undo buttons type=button; AI disabled when busy||!cur.trim().
- Delete: removeNode(node.id), pinned at bottom outside scroll.
- All window.mulby.* calls (notification.show, shell.showItemInFolder) and every store action (graphStore/providerStore/assetStore/promptStore/uiStore.openLightbox) remain identical — restyle only.

---

### 6.6 Lightbox + chat-to-edit + ResultViewer modal (afs-lbhost z-9999 / afs-rv z-9998)

> 灯箱 + 改图 + 结果查看器：统一 Aurora Glass 语言——ResultViewer 为承文玻璃模态，灯箱保持暗场影院（两主题都暗），全部 chrome 控件令牌化并在媒体上加描边环。

**重设计概念（Concept）**

Treat this as TWO cooperating overlays with one consistent Aurora-Glass language. (1) ResultViewer becomes a standard text-bearing Modal/Dialog: --afs-scrim backdrop, a glass-strong card (afs-glass--text recipe), a real .afs-modal__head with the same title contract, and a body whose media grid uses the Media-tile primitive and whose structured-JSON readers use the one canonical Chip + Card-data row. (2) The Lightbox stays a media THEATER: its scrim is intentionally opaque-dark in BOTH themes (--afs-lb-scrim) with NO backdrop-filter (the perf constraint is preserved verbatim), but every floating control becomes a scrim-backed IconButton (on-media variant) so glyphs hold >=3:1 over any photo in any theme, and the 连看 toggle/active states use the signature --afs-grad-accent (killing the #3b82f6 mismatch). The info+chat panel below the media becomes a single Glass-chrome card (floating chrome, short-lived, <=1 instance — sanctioned glass) housing a proper AI Chat composer: a Textarea-style composer with a Wand2 leading mark, a gradient .afs-glow Send button (the one signature AI action here), and a secondary Regenerate IconButton. Gradient and aurora are spent only on: the Send button glow, the 连看-on / busy accent, the ResultViewer empty-state aurora garnish, and category/type tints on JSON chips — never on idle chrome. Everything else is calm token-driven solids. Crucially this is restyle-only: same z-tiers, same dispatch order, same narrow live subscription, same local-state composer, same key/remount logic.

**现状问题（12）**

- Lightbox chrome is hardcoded dark-only: close (rgba(255,255,255,0.12)/.22 + #fff), nav arrows (rgba(255,255,255,0.1)/.2 + #fff), 连看 toggle (rgba(255,255,255,0.12) + #fff), count pill (rgba(0,0,0,0.5) + #fff), loading text (#cbd5e1), busy overlay (rgba(0,0,0,0.45)). None of these read --afs-* tokens, so they do not respond to html.light at all and float as low-contrast white-on-translucent-white over bright photos.
- 连看-on uses #3b82f6 (azure-blue) while the entire rest of the app accent is indigo (#6366f1 legacy / new --afs-accent). The single most visible accent inconsistency on this screen.
- Both modals are flat 2018-era dark sheets: afs-rv scrim rgba(0,0,0,0.72), afs-lbhost scrim rgba(0,0,0,0.86); afs-rv__panel is a flat --afs-node-bg box with a sharp 12px radius and rgba(0,0,0,0.5) shadow. No glass, no gradient, no aurora — nothing AI-native.
- Open triggers are non-semantic <div onClick> with cursor:zoom-in (RvTile in ResultViewer; JSON rows). They have no role, no tabindex, no keyboard activation — the lightbox can only be opened by mouse, and the close button is the only real control in ResultViewer.
- De-emphasis is done with raw opacity (afs-rv__seg .75, afs-rv__row-prompt .6, afs-rv__dlg i .6, afs-lbhost__info-label .75) instead of the --afs-muted/--afs-text-dim ladder, so dim text drifts inconsistently between themes and can fall below 4.5:1.
- Dark-only fills bleed into the light panels: afs-rv__dlg bg rgba(255,255,255,0.04) and afs-rv__tile bg rgba(255,255,255,0.05) are invisible/wrong on the white --afs-node-bg light panel; the dialogue well and tile placeholder effectively vanish in light mode.
- Three conflicting .afs-chip definitions (styles.css ~L815/L1656/L2578) and two .afs-spin/keyframes blocks mean the structured-JSON chips and spinners render with whichever rule wins the cascade, not a deliberate style.
- The chat-to-edit composer is a bare single-line <input> (transparent, no border of its own, 12.5px) with a tiny 26px accent send square. It does not read as an AI chat composer: no clear affordance, no submit hint surfaced beyond a title attr, no multiline, regen and chatbar share a cramped 34px row.
- Info-panel hierarchy is flat and tiny: title 13.5px, metachips 10.5px, prompt 12px, '提示词' label 10px uppercase — dense and hard to scan, capped at 24vh.
- Native HTML5 <video controls> bar is browser-default and clashes with the (otherwise custom) chrome; the count is a plain 'n / total' pill with no filmstrip for the many-item case the data model supports.
- Tile captions are 10px white over a hard rgba(0,0,0,0.7) gradient inside 120px auto-fill cells — low legibility at grid density.
- The two stacked dark scrims (RV under, Lightbox over) look identical, so the layered-Esc handoff (RV defers to lightbox) is invisible — the user can't tell two layers exist.

**布局规格（Layout Spec）**

TWO overlays, unchanged z-tiers (RV z-9998 below, Lightbox z-9999 above).\n\nA) ResultViewer modal (afs-rv -> Modal/Dialog 'sheet'):\n- Backdrop: full-viewport, background var(--afs-scrim) (theme-tuned 0.42 dark / 0.30 light), NO backdrop-filter (keep the existing perf comment verbatim). display:grid; place-items:center. Click-outside closes (unchanged).\n- Card: width min(760px,92vw), max-height 86vh, radius --afs-r-xl(16), afs-glass--text recipe (--afs-glass-fill-strong + blur(20px) + --afs-glass-border + --afs-elev-4 + --afs-glass-highlight); flex column; overflow hidden. (One of the <=3-4 sanctioned glass surfaces; do not nest glass inside.)\n- Head (.afs-modal__head): 48px row, padding 0 16px, sticky top; left = title (Section-title 16/600, text '{title} · 结果' contract preserved); right = close IconButton (md, X 18, aria-label '关闭 (Esc)'). Hairline bottom border --afs-border appears on scroll (is-scrolled).\n- Body (.afs-modal__body .nowheel .afs-scroll): padding 0 16px 16px; overflow-y auto. Three content modes (dispatch order preserved):\n  * Media grid: CSS grid repeat(auto-fill,minmax(132px,1fr)), gap --afs-sp-4(8). Each cell = Media-tile (aspect 1, --afs-r-md).\n  * Structured-JSON list: vertical stack gap --afs-sp-4; each entry = data Card (afs-card 'data' variant: --afs-panel-2, --afs-border, --afs-r-lg, --afs-elev-1, padding --afs-sp-4 --afs-sp-5). Row head = bold id + Chip cluster; sub-lines Body 13/--afs-muted; dialogue = sunken well (--afs-surface-sunken, --afs-r-sm); prompt line = mono Caption --afs-text-dim with a 'prompt' micro-label.\n  * Raw <pre>: Code 12/mono, --afs-surface-sunken inset, --afs-r-md, padding --afs-sp-4.\n- Empty state: Empty-state component (aurora ::before garnish, icon --afs-text-dim, line --afs-muted) for '暂无产物' / '无可展示内容'.\n\nB) Lightbox (afs-lbhost) — media theater, controls layer z-index 3 over media:\n- Scrim: var(--afs-lb-scrim, rgba(0,0,0,0.86)) opaque-dark in BOTH themes, NO backdrop-filter (perf comment kept). flex center.\n- Floating controls (all on-media IconButtons = #fff glyph on color-mix(#000 50%,transparent) scrim fill, blur allowed ONLY on these tiny chips, never on the scrim):\n  * Close: top-right (16/18), IconButton md, X 20, aria-label '关闭 (Esc)', disabled while busy.\n  * 连看 toggle: top-left, only when multi&&hasVideo. Switch-styled pill button: off = scrim fill + ListVideo + '连看'; on (is-on) = --afs-grad-accent fill + --afs-on-accent + 'connsecutive'; aria-pressed mirrors autoplay.\n  * Prev/Next nav: vertical-center left/right, IconButton lg (44px), ChevronLeft/Right 28, aria-label '上一个 (←)'/'下一个 (→)', only when multi.\n  * Count: bottom-center Pill (on-media), tabular-nums '{i+1} / {n}', aria-live polite, only when multi.\n- Stage column: flex column, gap --afs-sp-4, max-width 92vw / max-height 94vh.\n  * Frame: media <=90vw/68vh, object-fit contain, --afs-r-md, shadow 0 8px 40px rgba(0,0,0,0.6) (kept). Busy overlay = absolute inset, color-mix(#000 45%,transparent), centered Spinner(lg) + '生成中…' (role=status).\n  * Info+chat card (only when showInfo): Glass-chrome card, width min(680px,92vw), max-height 24vh, --afs-r-xl, --afs-glass-fill-strong+blur(16)+--afs-glass-border+--afs-elev-3+highlight (sanctioned floating chrome). Internal stack gap --afs-sp-4:\n      - Head row: title (Body 14/600 --afs-text) + metachip cluster (Chip xs, --afs-surface-sunken/--afs-muted).\n      - Prompt block: sunken well --afs-surface-sunken, --afs-r-md, micro-label 'PROMPT' --afs-muted + body 12.5/--afs-text, max-height 7em scroll.\n      - Edit row: [Regenerate Icon+label button, secondary, RotateCcw 14] + [Chat composer: flex pill, --afs-surface-sunken, --afs-r-pill, focus-within accent ring; Wand2 14 leading --afs-type-image; input flex; Send gradient IconButton 28 with .afs-glow]. Row height 32-34px.

**组件映射（25）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| afs-rv backdrop (rgba(0,0,0,0.72)) | hardcoded dark scrim div | Modal/Dialog scrim | background:var(--afs-scrim) (theme-tuned 0.42/0.30); KEEP no-backdrop-filter + perf comment; click-outside still closes. |
| afs-rv__panel | flat --afs-node-bg box, r12, rgba(0,0,0,0.5) shadow | Modal/Dialog (sheet, afs-glass--text) | --afs-glass-fill-strong+blur(20)+--afs-elev-4+--afs-r-xl; role=dialog aria-modal aria-labelledby head. Sanctioned glass surface. |
| afs-rv__head + afs-rv__title | plain row + 14px bold span | Modal head (Panel head) | Section-title 16/600; preserve text '{node.data.title\|\|def?.label} · 结果' exactly; is-scrolled hairline. |
| afs-rv__close (transparent opacity-hover button) | minimally styled <button> | IconButton (neutral, md) | X 18; aria-label '关闭 (Esc)'; same close() handler. |
| afs-rv__empty | centered opacity:0.6 line | Empty state | aurora ::before garnish, icon --afs-text-dim, '暂无产物'/'无可展示内容' as --afs-muted hint. |
| afs-rv__tile (clickable <div>, bg rgba(255,255,255,0.05)) | non-semantic div + cursor:zoom-in | Media tile / thumbnail card | Real <button> role+tabindex+Enter/Space -> openLightbox(lb,i); bg --afs-surface-sunken; keep useInView('600px')+useMediaUrl + caption from meta.shot/name/index. |
| afs-rv__tile-cap (10px #fff over rgba(0,0,0,0.7)) | hard gradient caption | Media-tile caption (scrim) | linear-gradient to var(--afs-scrim) + #fff; caption text Caption 11. |
| afs-rv__row / __seg / __row-sub / __row-prompt / __dlg | bordered rows + opacity de-emphasis + rgba(255,255,255,0.04) dlg | Card (data variant) + Divider + sunken well | --afs-panel-2 card; sub=--afs-muted (not opacity); dialogue well=--afs-surface-sunken; prompt=mono --afs-text-dim + 'PROMPT' micro-label. |
| afs-chip (3 conflicting defs) | ambiguous .afs-chip | Chip / Tag (single canonical, meta variant) | One token-driven recipe; type/category tint via color-mix on --afs-type-*/--cat for shotSize/camera etc.; xs size in dense rows. |
| afs-rv__pre | plain <pre> | Code surface (Textarea --code visual) | --afs-font-mono 12, --afs-surface-sunken inset; JSON.stringify fallback unchanged. |
| afs-lbhost scrim (rgba(0,0,0,0.86)) | hardcoded dark theater scrim | Lightbox shell scrim | var(--afs-lb-scrim) intentionally opaque-dark BOTH themes; KEEP no-backdrop-filter + perf comment verbatim. |
| afs-lbhost__close (rgba white-on-white + #fff) | square translucent button | IconButton (on-media, md) | #fff glyph on color-mix(#000 50%,transparent) scrim fill, blur on chip only; X 20; aria-label; disabled while busy. |
| afs-lbhost__nav--prev/--next | rgba(255,255,255,0.1) squares | IconButton (on-media, lg 44px) | ChevronLeft/Right 28; aria-label '上一个 (←)'/'下一个 (→)'; only when multi; stopPropagation+nav kept. |
| afs-lbhost__toggle + .is-on (#3b82f6) | fake toggle button, off-palette blue | Toggle/Switch (pill button form) on-media | on = --afs-grad-accent + --afs-on-accent (fixes #3b82f6); ListVideo 15 leading; aria-pressed=autoplay; only when multi&&hasVideo; titles preserved. |
| afs-lbhost__count (rgba(0,0,0,0.5)) | plain dark pill | Pill (on-media, count) | --afs-scrim/color-mix(#000 55%) fill, tabular-nums '{i+1} / {n}', aria-live polite; only when multi. |
| afs-lbhost__busy (rgba(0,0,0,0.45) + Loader2) | dark overlay + spinner | Spinner (overlay, lg) in busy region | role=status aria-live; color-mix(#000 45%); '生成中…'; keeps disabling close/scrim/keys simultaneously. |
| afs-lbhost__loading (#cbd5e1) | hardcoded slate text | Skeleton/loading text | '加载中…' via --afs-muted on the dark scrim (or #fff for theater), no hardcoded hex. |
| afs-lbhost__info (panel card) | flat --afs-panel card | Popover/Glass-chrome card | --afs-glass-fill-strong+blur(16)+--afs-elev-3 (floating chrome, <=1 instance); only renders when showInfo; max-height 24vh kept. |
| afs-lbhost__info-title + __metachip | 13.5px title + 10.5px chips | Section title + Chip (meta xs) | title Body 14/600; metaChips label rules (name/镜 /视角 /形态 /角色/场景) preserved exactly as Chips. |
| afs-lbhost__info-prompt + __info-label | muted block + 10px uppercase label | Field-style prompt well + Micro-label | --afs-surface-sunken well, 'PROMPT' micro-label 11/600 --afs-muted; promptText = ctx.prompt\|\|meta.prompt\|\|meta.description unchanged. |
| afs-lbhost__regen (RotateCcw + 重新生成) | hover-border button | Button (secondary, sm) / IconButton | RotateCcw 14; same doRegen() guard (canEdit&&!busy); disabled while busy. |
| afs-lbhost__chatbar (bare input) | transparent single-line input | Search/Chat composer (Text Input pill) | --afs-surface-sunken pill, focus-within accent ring; Wand2 14 leading --afs-type-image; placeholder via --afs-text-dim; LOCAL prompt state kept; Enter submits. |
| afs-lbhost__send (26px accent square) | flat accent button | IconButton (gradient + .afs-glow) | The single signature AI action here: --afs-grad-accent + glow on hover/busy; Send 14 / Loader2 when busy; disabled !prompt.trim()\|\|busy; aria-label '发送修改 (Enter)'. |
| native <video controls> | browser-default control bar | Keep native <video controls> (a11y scrubbing) | Per spec, retain native controls for scrub a11y; only restyle surrounding chrome; loop={!autoplay}/onEnded logic preserved. |
| afs-spin / @keyframes (duplicated) | two conflicting keyframes | Spinner (single afs-spin) | One canonical keyframe; reduced-motion -> opacity pulse fallback. |

**玻璃 / 渐变用法**：Glass is reserved for the two FLOATING chrome surfaces that qualify under 'glass on chrome': (1) the ResultViewer card uses the text-bearing glass recipe (--afs-glass-fill-strong >=80%/86% + blur(20px) + --afs-elev-4) so body text holds >=4.5:1; (2) the Lightbox info+chat card uses the chrome glass recipe (--afs-glass-fill-strong + blur(16px) + --afs-elev-3) — it is short-lived, <=1 instance, floating over media, so glass is sanctioned. Both ship the standard fallbacks (@supports not backdrop-filter -> opaque fallback; prefers-reduced-transparency -> --afs-surface-3; forced-colors -> Canvas/CanvasText). NEITHER scrim gets backdrop-filter: the RV scrim keeps no-blur per the existing perf comment, and the Lightbox scrim MUST keep no-blur (the load-bearing GPU constraint). The tiny on-media control chips may carry blur because they are a handful of small surfaces, not the full-screen scrim. The signature indigo->violet->azure gradient appears in only four purposeful places: the Send button fill+glow (--afs-grad-accent, the one AI action), the 连看-on toggle and busy-accent state (--afs-grad-accent, replacing the off-palette #3b82f6), the ResultViewer empty-state aurora garnish (--afs-aurora ::before, static low-opacity), and as low-opacity color-mix tints on type/category JSON chips. All idle chrome (nav, close, count, regen, prompt well, dialogue well, tiles) stays calm token-driven solids — no gradient.

**亮 / 暗说明**：Everything flows through --afs-* tokens so the html.light toggle works with zero JS theme branching. ResultViewer: scrim --afs-scrim (dark .42 / light .30); card glass-strong (dark rgba(17,22,34,0.80)+faint white hairline / light rgba(255,255,255,0.86)+darker hairline+--afs-elev-4 shadow); data-row cards --afs-panel-2 (dark surface-lightness step / light white+shadow); dialogue + prompt wells --afs-surface-sunken (dark #0d121a / light #e6eaf1) — fixes the rgba(255,255,255,0.04/.05) fills that vanished on white; de-emphasis via --afs-muted/--afs-text-dim ladder instead of raw opacity so dim text clears contrast in both themes. Lightbox theater: scrim --afs-lb-scrim defaults opaque-dark in BOTH themes by design (it's a media theater) — keep it var-able but dark; on-media control chips use a token-driven dark fill (color-mix(#000 50%,transparent)) + #fff glyph so contrast holds even in light mode over a bright photo (the current white-on-white failure is fixed); 连看-on and Send use --afs-grad-accent which is theme-tuned (light full-chroma indigo, dark desaturated), with --afs-on-accent flipping (#fff light / dark ink dark); the info+chat glass card and its sunken wells theme normally. Reduced-transparency collapses both glass cards to opaque --afs-surface-3 and drops the Send glow; forced-colors gives every chip a CanvasText border (the only edge cue once transparency is stripped).

**微交互**

- ResultViewer open: scrim fade + card scale 0.96->1 over --afs-dur-overlay with --afs-ease-emphasized; exit ~20% faster (--afs-dur-exit). prefers-reduced-motion -> instant.
- Modal/info head gains hairline border + --afs-elev-1 only after the body scrolls (is-scrolled), signaling more content.
- Media tile hover: border --afs-border->--afs-border-strong, subtle 1.02 zoom on the media (transform only), cursor zoom-in; focus-visible -> 2px --afs-ring over the image.
- Lightbox nav: ArrowLeft/Right and arrow buttons cross-fade the framed media via the existing key-remount (`${index}-${assetId||url}`); thumbnail decode shows '加载中…' until useMediaUrl resolves.
- 连看 toggle: track/fill animates to --afs-grad-accent on enable (--afs-dur-ui), aria-pressed flips; ListVideo glyph stays; titles describe the behavior exactly as today.
- Send button: idle glow opacity 0; on hover OR while busy the .afs-glow ::after rises to --afs-glow-opacity (the AI-working aura); press scale 0.94; disabled (empty/busy) drops to 0.4 with glow hidden.
- Busy state: media frame dims (color-mix #000 45%), centered Spinner (>=1s min display, --afs-loader-min) + '生成中…'; close button, scrim-click, and all keyboard nav are simultaneously disabled — exactly the current gate.
- Composer focus: pill border -> --afs-accent + 0 0 0 2px ring (focus-within); Enter submits and clears ONLY on success; typing animates nothing on the big media (local-state isolation preserved).
- Regenerate: secondary button, RotateCcw; press scale 0.97; disabled+dim while busy.
- Empty-state aurora: static low-opacity --afs-aurora garnish behind the icon — never animated (calm substrate).
- All status/spinner/glow animations neutralize under prefers-reduced-motion (spinner -> opacity pulse; glow -> static; scale presses -> none).

**必须 1:1 保持的行为**

- ResultViewer open/close driven by useUiStore.resultViewer(nodeId)/closeResultViewer; returns null when no nodeId or node not found; reads live node from useGraphStore by id.
- ResultViewer picks the FIRST truthy output: Object.values(node.data.outputs).find(Boolean); title = (node.data.title || def?.label) + ' · 结果' (exact separator).
- ResultViewer Esc-to-close ONLY when lightbox is NOT open (lightboxOpen guard) — keep the layered Esc handoff so one Esc never closes both layers.
- Click-outside scrim closes ResultViewer; inner panel stopPropagation. Lightbox scrim-close closes too but is disabled while busy.
- Content dispatch order unchanged: media items (filter type image|video && hasMedia) -> JsonStructured (v.type==='json' && object) -> v.text <pre> -> '无可展示内容'; empty value -> '暂无产物'.
- MediaGrid builds LightboxItem[] = items.map -> {ref,type} and calls openLightbox(lb,i) at the clicked index. RvTile lazy-loads via useInView('600px') + useMediaUrl(inView?ref:null); caption = meta.shot ?? meta.name ?? index+1.
- JsonStructured kind branches and field reads preserved exactly: storyboard (segments label/id/mood; shots id/shotSize/camera/duration/segmentId/continuousFromPrev='顺接'/description/dialogues/prompt), script-gen (scenes slug/location/time/summary/dialogues), char-sheet (characters name/voiceId/variants[]/identity/appearance + variant label/id/appearance), outline (beats type/emotion/summary); fallback raw JSON.stringify(json,null,2). Dialogues render character||speaker : line (emotion).
- Lightbox single app-wide instance: lightbox={items,index}; openLightbox clamps index to [0,len-1]; closeLightbox nulls; lightboxNav wraps modulo length (cyclic).
- Lightbox keyboard: Esc=close, ArrowLeft=nav(-1), ArrowRight=nav(1); ALL ignored while busy; listener bound only while lb present.
- Narrow live subscription: liveRef = node.data.outputs[port].items[index] (or the output itself when index===0) only when nodeId+port+index present — must NOT re-render the big media on status/stream patches (Object.is hit). Keep this subscription shape.
- ref = liveRef||ctx.ref; meta = liveRef.meta||ctx.meta; promptText = ctx.prompt||meta.prompt||meta.description; title = ctx.title.
- canEdit = type==='image' && nodeId && port && index!=null; showInfo = title || chips.length || promptText || canEdit; info panel renders only when showInfo.
- doEdit(p): guarded canEdit && p.trim() && !busy; setBusy, await editNodeImageItem(nodeId,port,index,p.trim()), return true(clear input)/false(throw), always clear busy. doRegen: guarded canEdit && !busy; await regenNodeImageItem(nodeId,port,index).
- LightboxEditBar keeps prompt in LOCAL state (not store) so typing never re-renders media/subscription; Enter submits via onSend; clears only on success; Send disabled when !prompt.trim()||busy.
- 连看(autoplay): only shown when multi && hasVideo; default true; onVideoEnded advances nav(1) only when autoplay && multi && lbIndex < total-1 (does NOT wrap at end); video loop={!autoplay}; onEnded handler attached only when autoplay; class/aria reflect autoplay.
- Multi (>1 item) gates nav arrows, 连看 toggle (also needs hasVideo), and count pill; hasVideo = any item type==='video'.
- LightboxMedia remounts on key `${lb.index}-${ref.assetId||ref.url||''}` and is memoized; '加载中…' until useMediaUrl resolves; video attrs controls/autoPlay/playsInline preserved; native <video controls> retained for scrub a11y.
- metaChips label rules and exact prefixes preserved: name (no prefix), '镜 '+shot, '视角 '+view, '形态 '+variantId, '角色'/'场景' from meta.kind.
- No backdrop-filter on EITHER full-screen scrim (RV and Lightbox) — the load-bearing GPU/perf constraint; keep the existing explanatory comments.
- All host integration stays indirect via store actions editNodeImageItem/regenNodeImageItem (which internally hit window.mulby / graph regen) — no new direct window.mulby calls; signatures and call sites unchanged.
- Theme stays html.light-class driven via uiStore; components keep reading --afs-* vars only — no per-component JS theme branching.

---

### 6.7 AssetsView gallery (素材 + 角色/场景库) + ProjectStylePanel (项目风格 modal, body=GlobalSettings) + SnapshotPanel (工程快照 modal)

> 素材库 + 项目风格 + 工程快照：内容区实色卡片 / 瓦片，玻璃只用于浮层与模态；逐卡 `<select>` 与 `window.confirm` 换成自定义下拉 / 确认对话框。

**重设计概念（Concept）**

Re-skin all three surfaces onto the Aurora Glass token system with ZERO behavior change. The AssetsView body is dense content, so it stays on SOLID surfaces (Panel/Card/Media-tile) — glass is reserved only for the floating chrome that already overlays content: the Lightbox info/control layer, the Custom Select popovers, and the two editor/utility Modals (Style, Snapshot, Element editor). The signature indigo→violet→azure gradient appears sparingly and only on active/primary affordances: the active subtab indicator, the active filter chip / active board row, the primary CTA per surface (上传素材, 保存, 存为快照), and selected ref-image / selected media-tile rings. Everything else (idle chips, board rows, card chrome) stays calm and near-opaque.\n\nThree concrete structural moves, all purely visual: (1) AssetsView header becomes Tabs (underline gradient indicator) for the two sub-tabs; the gallery body is a fixed two-region layout — a left Boards Panel rail and a right content column whose top is a dedicated, non-wrapping Toolbar strip (Segmented for type filter, Segmented for source filter, a pill Search field, usage Pill, then GC + Upload Buttons) over a responsive Media-tile grid. (2) Every hand-rolled modal (Element editor, Style, Snapshot) adopts the shared Modal/Dialog component (text-bearing glass, X always inside a consistent head), and every window.confirm/window.prompt becomes an in-app glass confirm/prompt Modal that preserves the exact async gate (resolve on confirm, abort on cancel) and the same notification.show toasts. (3) GlobalSettings inside the Style modal becomes Field-wrapper rows feeding Custom Selects, a Textarea, and a Slider+Number-stepper for 并发上限; the four long hints collapse into compact help lines / a collapsible Form-section so the form scans. The asset Lightbox keeps its opaque-dark theater scrim (perf constraint: no backdrop-filter near animating media) but its controls become scrim-backed on-media IconButtons and its info panel below uses the glass-chrome recipe.

**现状问题（10）**

- Native browser chrome breaks the aesthetic everywhere: per-card move-to-board `<select className="afs-acard__board">` (rendered on every card when boards exist), the group/style `<select>` cluster (5 raw selects in GlobalSettings inside the Style modal), `<video controls>`/`<audio controls>` in the asset Lightbox, plus `window.confirm` on every delete/GC/restore (board delete, asset delete, element delete, GC cleanup, snapshot restore+delete) and `window.prompt` on every rename/new-name (new board, rename board, rename snapshot). None of these can be themed and they shatter the glass/gradient language.
- Single flat indigo (#6366f1) used identically in light and dark with no gradient — the opposite of the AI-native gradient/glass target. Active chips, active board rows, active subtabs all read as one dull flat tint.
- Hardcoded dark-only overlay colors: `.afs-acard__type` / `__src` pills use rgba(8,11,18,0.66) near-black; `.afs-lightbox` backdrop rgba(8,11,18,0.8); delete-hover red is a literal #ef4444 with !important; `.afs-lib__ph--audio` emerald #34d399. These look wrong or fixed-dark in light mode.
- Two inconsistent modal systems that look almost identical but aren't: the asset Lightbox floats its close button OUTSIDE the card (top:-36px/right:-6px) while the editor/Style/Snapshot modals (afs-elform) put X inside a head row — confusing close-button placement and differing card chrome.
- ElementLibrary appearance-variant rows are built with ad-hoc inline flex styles (flex:'0 0 120px', flex:1) instead of a class — fragile, non-responsive, visually unrefined next to the rest of the form.
- AssetGallery filter bar crams type chips + a `<span class=afs-lib__sep>` divider + source chips + free-text search + usage label + 清理未引用 + 上传素材 into ONE wrapping flex row that wraps awkwardly below ~1200px (only side panels narrow at that breakpoint).
- Tiny icon-only action buttons (~26px targets, 13px lucide glyphs) on every asset card, element card, board row, and snapshot row — title-tooltip only, low discoverability, below comfortable pointer/touch size.
- `.afs-tag` has no base style — the bare `<span className="afs-tag">` would render unstyled; var-count / status chips are inconsistent across the partition.
- Empty states are plain muted text in a div (afs-lib__empty, afs-dockpanel__empty) with no icon, illustration, or gradient treatment, and no clear CTA.
- Dense walls of low-contrast hint copy: GlobalSettings has four long Chinese `afs-modal__hint` paragraphs (each style={{marginTop:4}}) and ElementLibrary/Assets have long hint bars — hard to scan, no progressive disclosure.

**布局规格（Layout Spec）**

REGIONS\n— AssetsView shell: Panel with sticky 48px head. Head left = panel title \"素材库\" (Section-title 16/600). Head right = Tabs (underline variant, 2 tabs: \"素材（图片/视频/音频）\", \"角色/场景库\"), gradient indicator bar slides under the active tab. Body fills remaining height, min-height:0, scroll handled per-region.\n\n— 素材 (AssetGallery) body = CSS grid `grid-template-columns: 200px 1fr; gap: var(--afs-sp-5)` (200px ≥ legacy 176 for comfort; collapses to a top horizontal board scroller under ~900px).\n  · LEFT Boards rail = sunken-section Panel. Section head row: micro-label \"合集\" + IconButton(FolderPlus, sm, aria-label 新建合集) right-aligned. Then Nav-rail-style rows: \"全部素材\" + count Pill, \"未分组\" + count Pill, then per-board rows. Each board row = a Nav-rail item (full-width, 32px, --afs-r-md): label (truncate, title attr) + count Pill, plus two hover-revealed sm IconButtons (Brush rename, Trash2 delete). Active row = color-mix(accent 16%) fill + 3px gradient left indicator + accent text.\n  · RIGHT content column = grid-rows `auto 1fr`. Row 1 = Toolbar strip (NOT wrapping): `display:flex; align-items:center; gap:var(--afs-sp-4); height:44px` → [Segmented: 全部/图片/视频/音频 each with trailing count] [Divider vertical] [Segmented: 全部来源/生成/上传] [spacer flex:1] [Search field pill, max-width 240px] [usage Pill --afs-pill--surface] [Button GC secondary sm] [Button Upload gradient sm]. Under <1100px the two Segmenteds + search stay row-1; usage+buttons wrap to a row-2 (the toolbar becomes `flex-wrap:wrap` only here, controlled, not the whole bar collapsing chaotically).\n  · Row 2 = scroll region (.afs-scroll) holding the Media-tile grid `repeat(auto-fill, minmax(168px,1fr)); gap:var(--afs-sp-5); padding:var(--afs-sp-5)`. Each asset Card = Media-tile (1:1 thumb with on-media type Pill top-left + 上传 source Pill top-right) + Card body (name 13/500 truncate, meta 11/500 muted) + footer action row (Custom Select 'move to board' sm full-width when boards exist; then 插入画布 Button sm + delete IconButton danger sm). Empty state = Empty-state component (Image icon, heading, hint, no CTA needed) on aurora substrate.\n\n— 角色/场景库 (ElementLibrary) body = grid-rows `auto 1fr`. Row 1 = Toolbar strip: hint text (single line, truncate/tooltip) at left + 3 Buttons (新建角色/场景/物品, secondary sm) at right. Row 2 = same Media-tile grid of element Cards (RefThumb 1:1 + on-media kind Pill, name, 28-char desc meta, footer 插入画布 + edit + delete IconButtons).\n\n— Element editor / Style / Snapshot = shared Modal/Dialog (sheet size 480px for Element & Snapshot, 520px for Style), centered over --afs-scrim, glass-fill-strong card, head (title + X IconButton) / scrollable body / foot (cancel + primary). Style modal body = GlobalSettings as a Form-section: 6 Field rows (stacked label-above-control), each Custom Select / Textarea / Slider; long hints become Field help lines, the verbose ones wrapped in a collapsible disclosure (Form-section collapsible). Snapshot modal body = a 'create' Field row (Text Input + 存为快照 gradient Button) then a scroll list (max-height 52vh) of snapshot rows (name + meta + 恢复/重命名/删除).\n\nSPACING / DENSITY: 8px grid throughout. Control rows 32px (md) in forms, 26-28px (sm) in dense toolbars/cards. Tile gap sp-5 (12px). Card radius --afs-r-lg, tile --afs-r-md, modal --afs-r-xl, chips/pills/search --afs-r-pill. Breathing room (sp-7/8/9) spent only on empty states and the tile grid, not on inspectors/hints.

**ASCII 线框**

```text
素材库 SHELL
┌──────────────────────────────────────────────────────────────────────┐
│ 素材库              素材（图片/视频/音频）   角色/场景库               │
│                     ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔   (gradient underline)        │
├───────────────┬──────────────────────────────────────────────────────┤
│ 合集      [＋] │ ╭全部┬图片3┬视频2┬音频1╮ │ ╭全部来源┬生成┬上传╮       │
│ ▌全部素材   6 │ ╰▓▓▓┴────┴────┴────╯     ╰────────┴───┴───╯          │
│   未分组    2 │              🔍 搜索…   (占用 6 项·24MB) [✦清理][⬆上传]│
│   主角     3 ⤙│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                   │
│     ✎ 🗑       │ │[图片]│ │[视频]│ │ ♪音频│ │[图片]│  ← Media-tiles     │
│   反派     1  │ │ img ✓│ │ vid  │ │ icon │ │ img  │                   │
│               │ └──────┘ └──────┘ └──────┘ └──────┘                   │
│               │ 林夏定妆   街道空镜   旁白01    反派立绘                │
│               │ 工程A·2MB  工程A·8MB  上传·1MB  工程A·3MB              │
│               │ [合集 ▾] [⊞插入画布]  [合集 ▾] [⊞插入画布][🗑]         │
└───────────────┴──────────────────────────────────────────────────────┘

LIGHTBOX (opaque dark theater scrim — NO backdrop-filter)
            ╭──╮ ← on-media scrim IconButton (✕)
   ┌─────────────────┐
   │      media      │   <video controls> kept (native scrub a11y)
   └─────────────────┘
   ┌─────────────────┐ ← glass-chrome info panel
   │ 林夏定妆          │
   │ 图片·png·2MB      │
   │ 来源：生成（工程A）│
   └─────────────────┘

STYLE MODAL (项目风格)            SNAPSHOT MODAL (工程快照)
######scrim#########          ######scrim#########
# ┌───────────────┐ #         # ┌───────────────┐ #
# │项目风格·工程A ✕│ #         # │工程快照·工程A ✕│ #
# │───────────────│ #         # │───────────────│ #
# │成片体量 [短片▾]│ #         # │┌名称…─┐[📷存为]│ #
# │画幅    [16:9▾]│ #         # │───────────────│ #
# │对白语言 [中文▾]│ #         # │v2  3天前·12节点│ #
# │风格包  [无  ▾]│ #         # │  [↺恢复][✎][🗑]│ #
# │全局画风 ┌────┐ │ #         # │v1  5天前·9 节点│ #
# │        └────┘ │ #         # │  [↺恢复][✎][🗑]│ #
# │并发 ●──── 3   │ #         # └───────────────┘ #
# │▸ 说明 (展开)   │ #         ###################
# └───────────────┘ #
###################

IN-APP CONFIRM (replaces window.confirm)
   ┌────────────────────┐
   │ ⚠ 删除该上传素材？  │
   │ 此操作不可撤销。     │
   │        [取消][删除] │ ← danger CTA (icon+label)
   └────────────────────┘
```

**组件映射（38）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| AssetsView shell + two sub-tab buttons (afs-subtab.is-active) | afs-surface__head + afs-subtabs / afs-subtab buttons | Panel (solid, sticky head) + Tabs (underline variant) | Two tabs map to aria-selected; gradient underline indicator slides (--afs-ease-move). Same useState('assets'\|'elements') toggle, same render branch. |
| Boards left rail container | aside.afs-boards / afs-boards__head | Panel (sunken-section) with Section title row | Solid surface (dense nav, not glass). Head micro-label 合集 + IconButton. |
| 新建合集 button (FolderPlus, title) | <button title=新建合集> | IconButton (sm, FolderPlus) | aria-label=新建合集. Still calls onNewBoard → in-app prompt Modal → createBoard. |
| 全部素材 / 未分组 / per-board rows (afs-boards__row.is-active + __n) | <button> rows + count span | Nav-rail item + count Pill (--afs-pill--surface) | Active row = gradient left indicator + accent tint (replaces flat tint). aria-current on active. setBoardF unchanged ('all'\|'none'\|boardId). |
| Per-board rename / delete (Brush / Trash2, afs-boards__act) | icon <button title> | IconButton (sm; rename neutral, delete danger) | Hover-reveal. rename→prompt Modal→renameBoard; delete→confirm Modal→deleteBoard (still resets boardF to 'all' if active board deleted). |
| Type filter chips all/image/video/audio + count (afs-chip.is-active + __n) | 4 toggle buttons | Segmented Control (text+trailing count) | Exclusive selector → sliding gradient pill. setTypeF unchanged; counts memo unchanged. role=radiogroup. |
| Source filter chips all/generated/uploaded | 3 toggle buttons | Segmented Control | setRoleF unchanged. The afs-lib__sep between groups becomes a vertical Divider. |
| Free-text search (afs-lib__search) | native <input> | Search Field (pill variant, leading Search icon, trailing clear) | type=search, value/onChange→setQ unchanged. Esc/clear sets q=''. Filter pipeline preserved exactly. |
| Usage label (afs-lib__usage) | <span>占用 N 项 · bytes</span> | Pill (--afs-pill--surface, tabular-nums) | Same fmtBytes output; title attr → Tooltip. |
| 清理未引用 (Sparkles, disabled while busy) | afs-btn | Button (secondary, sm, leading Sparkles) | disabled=busy. onGc: still saveProject() FIRST then runGc() then notification.show success; window.confirm→in-app confirm Modal. |
| 上传素材 (Upload, afs-btn--save) | afs-btn--save (primary) | Button (gradient, sm, leading Upload) | The single per-toolbar AI/primary action. Still triggers hidden file input; onPick/readFile/upload pipeline unchanged. |
| Asset card (afs-acard + thumb/type/src/name/meta) | div.afs-acard with overlay spans | Card (media-cover) + Media-tile thumb + on-media Pills | Type Pill top-left, 上传 source Pill top-right (scrim-backed, theme-tuned --afs-scrim, replaces rgba(8,11,18,0.66)). AssetThumb useInView windowing + useMediaUrl lifecycle preserved exactly. |
| Per-card move-to-board (afs-acard__board, only when boards>0) | native <select> | Custom Select (sm, follow-default first option 未分组) | Glass popover. value=a.boardId\|\|'' ; onChange→moveAsset(a.id, val\|\|undefined). Only rendered when boards.length>0. |
| 插入画布 (PlusSquare, image\|audio only) | <button title> | Button (secondary, sm, leading PlusSquare) | canInsert gate (image\|audio) preserved. onInsert→insertAssetNode+onInserted. |
| Delete uploaded asset (Trash2, afs-acard__del, uploaded only) | icon button, window.confirm | IconButton (danger, sm) + in-app confirm Modal | Only for role==='uploaded'. confirm→removeAsset. Danger keeps icon+intent, not color-only. |
| Asset preview Lightbox (afs-lightbox__panel, close outside card) | hand-rolled overlay | Lightbox shell (opaque dark scrim) + glass info panel | Keep opaque scrim, NO backdrop-filter (perf). Close → on-media IconButton inside controls layer (consistent placement). Backdrop click closes (preserved). |
| Lightbox media: img / <video controls autoPlay> / <audio controls autoPlay> | native media chrome | Media frame; native <video/audio controls> retained | Per Lightbox-shell spec, native controls kept for scrub a11y; only the close/meta chrome is restyled. autoPlay preserved. |
| Lightbox meta block (name/type/mime/bytes/dur/source/nodeKind) | afs-lightbox__meta | Glass-chrome info panel (text-bearing) | All meta string formats preserved verbatim incl. TYPE_LABEL·mime·fmtBytes·durationSec + source/nodeKind. |
| ElementLibrary hint bar + 3 new buttons | afs-lib__hint + afs-btn x3 | Toolbar strip: hint text + Button(secondary,sm) x3 (Users/Mountain/Box) | setEditing({kind,...}) unchanged for each. |
| Element card (RefThumb + kind badge + name + desc) | afs-acard | Card (media-cover) + on-media kind Pill (icon+label) | RefThumb loadAssetUrl mounted-guard lifecycle preserved (never revoke). desc.slice(0,28) preserved. |
| Element card actions 插入/编辑/删除 | 3 icon/text buttons | Button(secondary sm 插入画布) + IconButton(Brush edit) + IconButton(danger Trash2) | onInsert→insertElementNode+onInserted; edit→setEditing(el); delete→confirm Modal→removeElement. |
| Element editor modal (afs-lightbox + afs-elform 480px) | hand-rolled | Modal/Dialog (sheet 480px, glass-fill-strong) | X in consistent head. Backdrop click closes (=setEditing(null)). Body scrolls. |
| Editor name / desc / prompt / identity fields | afs-field + raw input/textarea | Field wrapper + Text Input + Textarea (auto-grow) | Each value/onChange via setEditing({...editing,key}) preserved 1:1; placeholders preserved (per-kind name placeholder logic). |
| appearanceVariants rows (inline-styled flex: label 0 0 120px / appearance flex 1 / delete X) | inline style divs + afs-field__input + afs-btn X | Field wrapper rows: Text Input (label) + Text Input (appearance) + IconButton(X delete), in a Form-section | Replace inline flex with a class/grid; add/edit/remove logic and id-defaults-to-label preserved exactly. 添加时期变体 → Button(secondary sm, Plus). |
| Ref-image picker grid (afs-elform__ref.is-picked, single-select) | toggle buttons | Media-tile selectable grid (selected = accent ring, aria-pressed) | Single-select: refAssetIds = picked?[]:[assetId]. imageAssets filter (type==='image'&&assetId) preserved. Empty → note text. |
| Editor 取消 / 保存 (Plus, afs-btn--save) | afs-btn / afs-btn--save | Button(secondary 取消) + Button(gradient 保存) | onSave validates name.trim() else notification.show('请填写名称','warning') then saveElement; preserved. |
| ProjectStylePanel wrapper (afs-elform--style) | hand-rolled lightbox + elform | Modal/Dialog (sheet 520px) | Title 项目风格 · {projectName}. Close on backdrop or X (preserved). Renders GlobalSettings as body. |
| GlobalSettings 5 native <select> (filmScale/aspect/lang/stylePack/concurrency-as-select) | native <select afs-field__input> | Custom Select x4 + Slider/Number-stepper for 并发 | filmScale/aspect/lang/stylePack → Custom Select (stylePack uses follow-default first option mapping ''→undefined). 并发上限 → Slider(1-8 stepped) + Number stepper, BUT option set [1,2,3,4,6,8] and label format ('1（顺序执行）','N 路并发') must be preserved — if non-contiguous steps can't be a clean slider, keep it a Custom Select. Number()(coercion) + exact setGlobals keys preserved. |
| GlobalSettings 全局/自由画风 textarea | textarea afs-field__input | Textarea (auto-grow) in Field wrapper | Label text switch ('全局画风' vs '自由画风（补充…）') by stylePackId presence preserved. setGlobals({style}). |
| GlobalSettings 4 long hint paragraphs (afs-modal__hint marginTop:4) | <div style={{marginTop:4}}> | Field help line + collapsible Form-section for verbose ones | getStylePack(stylePackId) conditional hint preserved. No inline marginTop; spacing via tokens. |
| SnapshotPanel wrapper (afs-elform) | hand-rolled | Modal/Dialog (sheet 480px) | Title 工程快照 · {projectName}. Close backdrop/X preserved. |
| Snapshot create row (name input + 存为快照 Camera) | afs-snapnew: afs-field__input + afs-btn--save | Field row: Text Input + Button(gradient sm, Camera) | Placeholder shows live nodeCount; Enter triggers onCreate (onKeyDown preserved). createSnapshot(name)+clear+refresh. |
| Snapshot list rows (name + relTime·nodeCount + 恢复/重命名/删除) | afs-snapitem rows + icon buttons | List rows (Card data variant) + Button(↺恢复) + IconButton(Brush) + IconButton(danger Trash2) | 恢复→confirm Modal→restoreSnapshot→notification.show→onClose; 重命名→prompt Modal→renameSnapshot; 删除→confirm Modal→deleteSnapshot. relTime helper unchanged. |
| Snapshot empty state (afs-dockpanel__empty reused) | muted text div | Empty state component | Camera icon + heading + hint copy preserved. |
| ALL window.confirm (board/asset/element delete, GC, snapshot restore+delete) | window.confirm | Modal/Dialog (confirm variant, danger CTA) | MUST keep the same async gate: confirm → proceed, cancel → abort. Same trigger order (e.g. GC saveProject-before-runGc). |
| ALL window.prompt (new/rename board, rename snapshot) | window.prompt | Modal/Dialog (prompt variant, single Text Input) | Empty/whitespace input aborts (matches current name&&name.trim() guards). Returns trimmed value to same store call. |
| audio placeholder tint (afs-lib__ph--audio emerald) | hardcoded #34d399 | Media-tile audio variant + Music icon, --afs-type-audio token | Theme-tuned (light #b45309 / dark #fbbf24) instead of hardcoded emerald; audio never fetches blob (preserved). |
| bare <span className=afs-tag> var-count / status | unstyled afs-tag | Badge or Chip (with-count) | Gives the previously-undefined tag a real token-driven style. |

**玻璃 / 渐变用法**：Glass is used on exactly the surfaces the foundation sanctions as floating chrome, and nowhere on the dense content: (1) the three Modals — Element editor, Style, Snapshot — use the text-bearing glass recipe (--afs-glass-fill-strong, blur 20px) so body text holds >=4.5:1; (2) the Custom Select popovers (per-card move-to-board, the GlobalSettings selects) use the chrome glass recipe (--afs-glass-fill, blur 16px, --afs-elev-3); (3) the asset Lightbox info/meta panel below the media uses chrome glass. The in-app confirm/prompt dialogs ARE Modals so they inherit glass. Hard constraint honored: NO backdrop-filter anywhere on the Lightbox scrim or the media frame — that scrim stays opaque dark (perf, animating media), and its on-media controls get a token --afs-scrim fill rather than blur. The AssetsView Panel, Boards rail, Toolbar strip, asset/element Cards, and Media-tiles are all SOLID (--afs-panel / --afs-panel-2 / --afs-surface-sunken) for legibility and grid pan/scroll performance — never glass. Per-viewport glass count stays <=3-4 (a modal is open OR a select popover is open OR the lightbox info panel — they don't stack densely).\n\nGradient is used sparingly and only on active/primary affordances: the active Tab underline (--afs-grad-brand), the active Segmented pill for type/source filters (--afs-grad-accent), the active Boards row left indicator (--afs-grad-accent), the one primary Button per surface (上传素材, 保存, 存为快照 = gradient + .afs-glow aura on hover), selected ref-image and selected media-tile rings (solid --afs-accent ring, gradient only on the active pill), and the Slider range fill for 并发. Idle chips, idle board rows, idle cards, and all the meta/usage pills stay calm and gradient-free. The aurora backdrop appears only as the static low-opacity substrate behind the Empty states.

**亮 / 暗说明**：All new surfaces are token-driven so html.light keeps working with no per-component branching. Specific re-pointings for this screen: (1) on-media Pills (type / 上传 source / kind) drop hardcoded rgba(8,11,18,0.66) and use var(--afs-scrim) (dark 0.42 / light 0.30) with white glyph/text, which stays legible over any thumbnail in both themes. (2) Active subtab/chip/board indicators move from flat #6366f1 to --afs-grad-accent / --afs-grad-brand (light full-chroma indigo, dark desaturated #8b9bff) so they read correctly on both bright and dark surfaces; active fill uses color-mix(accent 16%). (3) Delete-hover red drops the literal #ef4444 !important and uses --afs-danger (light #dc2626 full-strength / dark #f87171 lightened) on IconButton--danger hover. (4) Audio tile tint uses --afs-type-audio (light #b45309 / dark #fbbf24) instead of hardcoded emerald. (5) Modal cards use --afs-glass-fill-strong (dark rgba(17,22,34,0.80) / light rgba(255,255,255,0.86)) + --afs-elev-4; the scrim uses --afs-scrim (theme-tuned) replacing fixed rgba(8,11,18,0.8). (6) Media-tile / sunken fields use --afs-surface-sunken (dark #0d121a / light #e6eaf1) so empty tiles and inputs read as inset in both themes, replacing rgba(255,255,255,0.05) which vanished on light. (7) Card depth: dark relies on the --afs-panel-2 lightness step + faint --afs-elev-1 contact shadow; light relies on layered --afs-elev-1 shadow. (8) The Lightbox theater scrim is intentionally opaque-dark in BOTH themes (it's a media theater) — its controls use color-mix(#000 …) chip fills so they never become white-on-white in light mode. Hint/help text uses the now-defined --afs-text-dim (dark #6b7383 / light #8a93a4) and --afs-muted, fixing the legacy undefined-token light-mode breakage. Fallbacks: glass falls back to --afs-surface-3 under prefers-reduced-transparency and to ~95% opaque fill under @supports not (backdrop-filter); forced-colors swaps glass to Canvas/CanvasText with a 1px border.

**微交互**

- Tab switch: gradient underline slides under the newly active subtab via transform (--afs-dur-ui, --afs-ease-move); panel content cross-fades; reduced-motion → instant swap.
- Segmented type/source filter: the gradient pill slides + resizes to the chosen segment (--afs-ease-move); label flips to --afs-on-accent; counts update live.
- Board row select: active row gains a 3px gradient left indicator that grows in, plus accent-tint fill; hover reveals rename/delete IconButtons (opacity 0→1, --afs-dur-micro).
- Search: typing reveals the trailing clear IconButton; clear/Esc empties q and grid re-filters; result count can announce via aria-live polite.
- Media-tile load: skeleton shimmer (sunken + sweep) while useInView hasn't resolved the blob; on load the img/video fades in; tiles never animate offscreen (windowing preserved); reduced-motion → no shimmer.
- Card hover: border → --afs-border-strong, elev-1 → elev-2, translateY(-1px); active press scale(0.99).
- Custom Select open (per-card board / GlobalSettings): chevron rotates 180°, glass popover pops from anchor (scale .98→1 + fade, --afs-dur-ui); selected option shows Check in accent.
- Primary Button (上传素材 / 保存 / 存为快照): .afs-glow accent aura opacity rises on hover; press scale(0.97); while uploading/saving leading icon swaps to Loader2 (afs-spin) with frozen width, aria-busy.
- GC button: disabled+0.45 while busy; on success the host toast slides in (notification.show).
- Modal enter: scrim fades + card scales 0.96→1 (--afs-dur-overlay, --afs-ease-emphasized); exit ~20% faster; reduced-motion → no scale.
- In-app confirm/prompt: focus traps; initial focus on Cancel for destructive confirms, on the input for prompts; Enter on prompt commits (mirrors snapshot Enter-to-create), Esc/cancel aborts the async gate.
- Ref-image / media-tile select: clicking toggles a 2px accent ring (single-select for refs); aria-pressed flips; subtle scale on press.
- Slider (并发): thumb grows on hover, value bubble (glass) shows while dragging, gradient range fill tracks the thumb; keyboard arrows step; reduced-motion → no bubble animation.
- Lightbox: on-media close/info controls lift their scrim fill on hover; backdrop click closes; native video/audio controls retain their own scrub interaction.

**必须 1:1 保持的行为**

- AssetGallery filter pipeline EXACTLY: assets → typeF (all|image|video|audio) → roleF (all|generated|uploaded) → boardF (all | none=!boardId | boardId) → keyword over `${name} ${tags.join(' ')} ${projectName} ${nodeKind}` lowercased includes → sort by createdAt desc. counts memo {all:assets.length,image,video,audio}.
- Tab state useState('assets'|'elements') and the render branch (AssetGallery vs ElementLibrary) unchanged.
- load() gated on !loaded in both AssetGallery and ElementLibrary useEffect; loaded flag drives empty-vs-loading copy.
- onPick: Array.from(files); reset e.target.value=''; readFile (FileReader.readAsDataURL → parse data:mime;base64); upload(payload.filter(p=>p.base64)); accept 'image/*,video/*,audio/*' multiple.
- onGc: window.confirm gate → saveProject() FIRST (avoid flagging unsaved assets as orphans) → runGc() → notification.show(`已清理 ${removed} 个未引用素材，释放 ${fmtBytes(freedBytes)}`,'success'); button disabled while busy.
- onInsert(rec): insertAssetNode(rec)+onInserted(); only rendered when canInsert (type==='image'||'audio').
- moveAsset(a.id, e.target.value||undefined); board select only rendered when boards.length>0; option list = 未分组('') + boards.
- removeAsset only for role==='uploaded' behind a confirm gate.
- Boards: createBoard/renameBoard/deleteBoard via name prompts (trim, abort on empty); deleteBoard resets boardF→'all' when deleting the active board; boardCount(id)=assets where boardId===id (or !boardId when undefined).
- AssetThumb: useInView('400px') windowing — useMediaUrl(rec) ONLY when type!=='audio' && inView (never fetch blob offscreen, never for audio). RefThumb: loadAssetUrl(assetId) with mounted guard, NEVER revoke (blob lifetime owned by assets.ts byte cache). These lifecycle invariants kept.
- Lightbox media tags by type: image=<img>, video=<video controls autoPlay>, audio=<audio controls autoPlay>; meta = TYPE_LABEL · mime · fmtBytes · (durationSec?` · ${n}s`) + 来源 (uploaded='本地上传' | `生成（${projectName}）`) + (nodeKind?` · 节点：${nodeKind}`); backdrop click + X close.
- ElementLibrary: imageAssets=assets.filter(type==='image'&&assetId); ref picker SINGLE-select (refAssetIds = picked?[]:[assetId]); onSave validates name.trim() else notification.show('请填写名称','warning') then saveElement({...editing,kind,name:trimmed}); appearanceVariants add/edit/remove with id defaulting to label; insertElementNode on insert; KIND_ICON/KIND_LABEL maps and per-kind name placeholders.
- GlobalSettings: each control writes useGraphStore.setGlobals with EXACT keys — filmScale (default '短片'), aspectRatio, dialogueLang (default '中文'), stylePackId ('' → undefined), style, concurrency (Number(), default 3). ASPECTS list and option labels fixed; concurrency option set [1,2,3,4,6,8] with labels '1（顺序执行）' / 'N 路并发'; dialogueLang option set fixed; style label text switches on stylePackId presence; getStylePack(stylePackId) conditional hint.
- ProjectStylePanel binds projectName from graphStore, renders GlobalSettings, closes on backdrop or X.
- SnapshotPanel: refresh()=listSnapshots on mount; onCreate=createSnapshot(name)+setName('')+refresh; name input Enter triggers onCreate; onRestore=confirm→restoreSnapshot(id)→notification.show success→onClose; onRename=prompt→renameSnapshot(id,trimmed); onDelete=confirm→deleteSnapshot(id)→refresh; placeholder shows live nodeCount; each item shows relTime(createdAt)·nodeCount.
- All window.mulby.notification.show(message, level) calls remain the host toast API (call sites unchanged in args).
- Every window.confirm/window.prompt that becomes an in-app dialog preserves the SAME async gate: confirm resolves → action proceeds, cancel → action aborts; prompt returns trimmed value or aborts on empty/cancel.
- Theme switching stays token-driven via the html.light class swapping --afs-* vars; no dark-only hardcoded values introduced for any new surface.
- No backdrop-filter on the Lightbox scrim or media frame (GPU/perf with animating spinners) — glass stays off the theater layer.

---

### 6.8 PromptLibrary (提示词库) + PromptSettings (节点模板覆盖, embedded in 设置·高级)

> 提示词库 + 节点模板覆盖：统一为两栏「Prompt 工作台」（仍是两个独立路由，不做功能合并），分段控件切换分组 / 作用域，统一片段卡与模板字段。

**重设计概念（Concept）**

Unify both prompt surfaces under one calm, near-opaque two-pane 'Prompt Workbench' on a static aurora substrate, keeping the two as separate routed views/components (no functional merge — PromptLibrary stays its own afs-surface, PromptSettings stays embedded in 设置·高级). Both adopt the same primitives: a Panel shell with a sticky head, a Segmented control for the top-level switch (snippet groups filter in Library; 本工程/全局默认 scope in Settings), a pill Search Field, Form-section group headers (micro-label uppercase), and a single shared field/card vocabulary. Content stays on solid surfaces (Panel/Card/Textarea) for legibility and scroll perf — glass is reserved strictly for the floating CHROME: the snippet-editor Modal (text-bearing strong glass), the group/scope Custom Select popovers, Tooltips on icon buttons, the version-history Popover, and in-app glass Confirm dialogs that replace window.confirm. The signature indigo→violet→azure gradient appears ONLY on: the one primary AI action (新建片段 / save = gradient Button with glow), the active Segmented pill, the 'override/edited' Badge, and the scope-active tab — never on idle cards. Snippets and templates become proper Cards with category-tinted left accent (driven by the existing group color as inline --cat). The JSON contract <details> becomes a Form-section collapsible disclosure. Long text-node textareas keep rows but gain a sticky group nav rail so the user can jump between template groups without scrolling the wall. The result: dense, scannable, AI-native, and 1:1 behavior-preserving.

**现状问题（13）**

- Two visually-distinct prompt surfaces with no shared shell: PromptLibrary is a standalone afs-surface view (snippet cards grouped by 画风/运镜/打光/负面/自定义), while PromptSettings lives buried inside AdvancedSettings behind a scary amber afs-advbanner warning. They are conceptually the same domain ('prompts') but use different layouts, different scroll containers, and different visual languages.
- Native <select> with OS popup: the snippet editor 分组 picker (PromptLibrary.tsx L162) is a raw native <select className='afs-field__input'> with no appearance:none/chevron — its dropdown renders OS-light on Windows even in dark mode, the single biggest aesthetic break here.
- Native <details>/<summary> disclosure for the read-only JSON contract (PromptSettings.tsx L156) shows the default browser triangle marker — dated, unthemed.
- Bare <span className='afs-tag'> has NO base style (only contextual .afs-field__label .afs-tag + --edited/--cap variants exist). The '{n} 变量' count tag in PromptLibrary (L118) renders inconsistently/unstyled.
- Hand-rolled modal: the snippet editor is a fixed afs-lightbox + afs-elform card (L143) with a heavy dark drop-shadow rgba(0,0,0,0.45-0.6) that looks wrong on light bg, no focus trap, no Esc handling, scrim is a fixed dark rgba regardless of theme.
- window.confirm() for snippet delete (L127) — jarring OS chrome modal that cannot be themed.
- Wall-of-text hints: afs-lib__hint (PromptLibrary) and a very dense afs-modal__hint paragraph in PromptSettings (L68-76) mixing body copy, a <b> priority rule, AND an inline reset-all afs-link-btn — low hierarchy, hard to scan.
- Inconsistent focus affordance: afs-field__input HAS an accent focus border but the PromptSettings search <input> (afs-prompts__search input) and many controls do not get a consistent ring.
- Tiny 26px icon-only action buttons with 13px lucide icons (afs-snip__actions 编辑/删除) and 11px afs-link-btn rows (恢复默认/历史) — low discoverability, small targets.
- afs-tag--edited uses hardcoded rgba(99,102,241,0.18); delete-hover uses hardcoded #ef4444 — not tokenized, no light-mode tuning.
- Flat single indigo #6366f1 accent used identically in light+dark with no gradient — opposite of the desired AI-native gradient/glass look. The 'edited/override' state, the active scope tab, and the save button are all the same flat indigo with no hierarchy.
- The text-node textarea is forced to rows=12 (PromptSettings L119) creating a very tall un-resizable wall inside an already-dense vertical stack of ~10+ templates; combined with the inline history panel it becomes an extremely long scroll with no overview/jump affordance.
- Snippet cards (afs-snip) and template fields (afs-field) are flat panels with no elevation/altitude distinction between the grouping container, the card, and the editing surface.

**布局规格（Layout Spec）**

REGIONS (both views share the same Panel shell anatomy):\n\nA) PromptLibrary (提示词库) — standalone afs-surface/Panel.\n- Panel head (sticky, 48px, --afs-panel): title '提示词库' (Section-title 16/600) left; right action group = [Search Field pill, --afs-control-h] + Divider(vertical) + [Button ghost 导入 (Upload 16)] + [Button ghost 导出 (Download 16)] + [Button gradient+glow 新建片段 (Plus 16)]. Collapses to an overflow Dropdown menu under ~720px.\n- Hint strip: ONE compact line (Caption 11/500 --afs-muted) below head, padding sp-3 sp-5, with the {变量} token rendered as a mono inline Chip. Not a wall — one sentence.\n- Filter row (optional, sp-4 below hint): Segmented control of group filters [全部 · 画风 · 运镜 · 打光 · 负面 · 自定义] each with a count Pill; drives a pure client-side display filter only (no store change). Keep ALL groups always; this is presentation.\n- Body (afs-scroll, padding sp-5): grouped sections. Each group = Form-section header (micro-label uppercase 11/600 --afs-muted, with a leading 4px category dot using inline --cat) + responsive Card grid (CSS grid, minmax(220px,1fr), gap sp-5). Empty group hidden (preserve). Whole-empty -> Empty state (centered, aurora garnish, Clapperboard-style icon, hint, primary 新建片段).\n- Snippet Card: solid --afs-panel-2, --afs-r-lg, --afs-elev-1, 3px left category accent bar (inline --cat). Body: name row (Body 13/600 + trailing soft Badge '{n} 变量' when vars>0) -> clamped mono text (afs-card text, 3-line clamp, --afs-font-mono 12px, --afs-text-dim) -> footer action row (IconButton 编辑 Brush, IconButton danger 删除 Trash2) revealed/strengthened on hover, sm size 28px.\n\nB) PromptSettings (节点模板) — embedded in 设置·高级 content pane (max 720 centered).\n- Top: keep AdvancedSettings warning but restyle afs-advbanner as a soft warning Form-section card (AlertTriangle --afs-warning icon + text), NOT amber color-mix hack.\n- Controls cluster (sticky sub-head): Segmented control [本工程（{projectName}） | 全局默认] (the scope switch) left; right = reset-all Button (secondary, danger-intent text) whose label switches 清空本工程覆盖/全部恢复默认.\n- Hint: condensed to one line + a separate single-line priority badge row: small Pill '本工程 > 全局默认 > 内置默认' (surface pill, mono). The JSON-contract caveat moves into the collapsible at the bottom.\n- Search Field pill (full width of pane) below the cluster.\n- LAYOUT: optional left sticky group-nav rail (vertical Tabs, 文本节点 / 图像节点) + right scroll column of template fields, OR (narrow) stacked Form-section headers. Each template = a Form field block in a subtle Card: label row [name + override Badge when overridden + IconButton 恢复默认 (RotateCcw) + IconButton/Button 历史 with count] ; help line (Field help, --afs-text-dim, desc + 占位符 chips + JSON契约 note); Textarea (code, rows preserved: text non-fx=12 else 3); history opens as a Popover anchored to the 历史 button (glass) rather than inline-pushing layout.\n- Bottom: Form-section collapsible disclosure '查看固定 JSON 输出契约（不可编辑）' -> mono <pre> in a sunken well.\n\nGRID/SPACING: 8px grid throughout. Card grid gap sp-5 (12px). Field stack gap sp-5; label/help/control gap sp-3. Section headers sp-6 top margin. Control heights --afs-control-h (32) default, sm 26 for inline. Radii: cards/popover --afs-r-lg, modal --afs-r-xl, inputs/chips --afs-r-sm, pills --afs-r-pill. Density: compact rows, 11–14px type per scale; breathing room only in empty states.

**组件映射（32）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| PromptLibrary root afs-surface + afs-surface__head | <div className='afs-surface'> + afs-surface__head/title | Panel / Section (dock/inspector variant, solid) | Keep solid (dense, scroll perf). Sticky head gains hairline+elev-1 on scroll. Title is the Section-title role. |
| PromptSettings root afs-settings-pane + afs-modal__body | <div className='afs-settings-pane'><div className='afs-modal__body'> | Panel / Section (settings-pane variant, max 720) | Stays embedded in 设置·高级 content; no IA move. Solid surface. |
| PromptLibrary action buttons 导入 / 导出 | <button className='afs-btn'> (Upload/Download) | Button (ghost / secondary, md, leading icon) | Low-emphasis; Upload + Download lucide icons kept. Wire to same fileRef.click / exportPack unchanged. |
| PromptLibrary 新建片段 / snippet editor 保存 | <button className='afs-btn afs-btn--save'> (Plus) | Button (gradient variant + .afs-glow, md) | The single signature AI/primary action per surface. afs-grad-accent fill, on-accent label, glow on hover. Plus icon kept. |
| snippet editor 取消 / PromptSettings reset-all | <button className='afs-btn'> / afs-link-btn (清空/全部恢复默认) | Button (secondary for 取消; secondary danger-intent for reset-all) | reset-all keeps label switch by scope; pairs an icon (RotateCcw) so destructive intent is not color-only. Same resetAll() call. |
| snippet editor 分组 native <select> | <select className='afs-field__input'> over SNIPPET_GROUPS | Custom Select / Dropdown (md, glass popover) | Headless Radix/React-Aria listbox; SAME options (SNIPPET_GROUPS), SAME value/onChange writing editing.group. Optional leading category swatch per option. |
| PromptSettings 本工程 / 全局默认 scope tabs | two <button className='afs-scope__tab is-active'> | Segmented Control (2 segments, sliding gradient pill) | role=radiogroup exclusive; active pill = afs-grad-accent + on-accent label. Drives setScope('project'\|'global') 1:1. Label keeps （{projectName}）. |
| PromptLibrary group sections header | <div className='afs-modal__section'>{g.label} | Form section / group header (micro-label) + category dot | Uppercase tracked 11/600 --afs-muted. Leading 4px --cat dot from group color. Empty group still hidden (preserve grouped memo). |
| PromptLibrary group filter (NEW, presentation-only) | (none — currently always shows all groups) | Segmented Control with count Pills (optional) | Pure client-side display filter; MUST default to 全部 so default behavior == current (all groups shown). No store change. |
| snippet card afs-snip | <div className='afs-snip'> (flat panel) | Card (data variant, category-tinted 3px left accent) | Solid --afs-panel-2 + elev-1. Inline --cat from group color (kept compatible). Hover = border-strong + elev-2. |
| snippet name clamp + var-count tag | afs-snip__name + bare <span className='afs-tag'> | Card body title + Badge (soft variant) | Fixes the unstyled bare afs-tag: '{n} 变量' becomes a soft Badge. Count from s.vars.length unchanged. |
| snippet clamped text | <div className='afs-snip__text'> | Card text (mono, line-clamp) | --afs-font-mono 12px, --afs-text-dim, 3-line clamp. Full text on title/preview. |
| snippet 编辑 / 删除 buttons | <button>(Brush) / <button className='afs-snip__del'>(Trash2) | IconButton (sm; neutral for edit, danger for delete) | ≥28px target, aria-label + Tooltip. Brush/Trash2 kept. Delete opens glass Confirm (see below). |
| window.confirm snippet/history deletes | window.confirm(`删除片段「${name}」？`) | Modal (confirm variant, glass) | MUST keep the same async gate: resolve->removeSnippet, reject/cancel->no-op. Danger CTA with icon+label. |
| snippet editor afs-lightbox + afs-elform | fixed overlay + card, click-backdrop close, X | Modal / Dialog (sheet variant, strong glass) + scrim | role=dialog aria-modal, focus trap, Esc closes, backdrop click closes (preserve), focus returns. --afs-glass-fill-strong for body-text contrast. |
| editor name / var-default <input> | <input className='afs-field__input'> | Text Input (md) inside Field wrapper | Same value/onChange. Field wrapper owns label + describedby. |
| editor content <textarea--code> | <textarea className='afs-field__input afs-field__input--code' rows=4> | Textarea (code variant, rows preserved) | onChange runs onTextChange(detectVars) unchanged. mono font, sunken surface. |
| appearance/var rows afs-varrow + __name | afs-varrow with __name label + input | Field (inline variant) rows; var name as xs mono Chip | Replaces ad-hoc layout with tokenized inline label column. Same vars[i].default onChange logic. |
| resolved preview afs-varpreview | <span className='afs-varpreview'>resolveSnippet(...) | Field help / Caption mono region | resolveSnippet({...editing,vars}) call unchanged; just restyled. |
| PromptLibrary / PromptSettings search input | afs-lib (none) / afs-prompts__search Search + <input> | Search Field (pill, leading Search + clear) | PromptSettings query onChange unchanged; Library gains a presentational search filtering by name/text (optional, must not alter store). |
| PromptSettings hint wall + inline reset link | afs-modal__hint paragraph with <b> + afs-link-btn | Caption hint line + surface Pill (priority) + Button (reset, moved to head) | Splits the wall: one-line hint, a mono priority Pill '本工程 > 全局默认 > 内置默认', reset-all promoted to a real Button in the controls cluster. |
| override marker afs-tag--edited | <span className='afs-tag afs-tag--edited'>本工程已改/全局已改 | Badge (accent-tinted, edited variant) | color-mix(accent 18%) via token, theme-tuned. Label text (本工程已改/全局已改) preserved; not color-only. |
| 恢复默认 / 历史 afs-link-btn rows | <button className='afs-link-btn'>(RotateCcw/History) | IconButton or small Button (sm) with Tooltip | RotateCcw=reset (resetOne), History=history toggle. Count '历史(n)' kept. aria-label on button, svg aria-hidden. |
| inline history panel afs-history | <div className='afs-history'> pushed inline | Popover (glass menu/list) anchored to 历史 button | Stops layout-push on the long wall. Each row: relTime + truncated text + 恢复此版本. PRESERVE: snapshot(id,value) BEFORE setOverride(id,h.text). |
| history empty state | afs-history__empty text | Empty state (compact, in popover) | Same copy '暂无历史快照…'. |
| template label / desc / placeholders | afs-field__label + afs-field__desc with 占位符 string | Field wrapper (label + help) + placeholder Chips | t.placeholders rendered as xs mono Chips instead of inline string join; JSON契约 note as a small Badge. desc/label text unchanged. |
| PromptSettings template <textarea> | <textarea --code rows={12\|3}> | Textarea (code variant) in a subtle Card | rows formula (text&&!startsWith('text.fx')?12:3) preserved EXACTLY. onChange setOverride, onBlur snapshot unchanged. |
| group iteration headers (text/image) | afs-modal__section{GROUP_LABEL[g]} | Form section header + vertical Tabs rail (jump nav) | GROUP_LABEL map kept. Tabs rail (文本/图像) is sticky nav that scrolls to the section; groups=['text','image'] order preserved, 0-match group returns null (preserve). |
| JSON contract <details>/<summary> | native <details className='afs-modal__details'><pre> | Form section collapsible disclosure + sunken <pre> | <button aria-expanded aria-controls> replaces native triangle; JSON_CONTRACT shown read-only mono in sunken well. Same content. |
| AdvancedSettings amber afs-advbanner | color-mix(#f59e0b…) warning banner | Form section card (soft warning) + AlertTriangle | Uses --afs-warning token (theme-tuned) instead of literal amber; AlertTriangle lucide icon. Same warning copy. |
| all icon-only buttons' title tooltips | title='导入'/'编辑'/'删除'/etc. | Tooltip (glass) + aria-label on button | title kept as fallback; styled Tooltip primary. Load-bearing meaning preserved. |
| import/export hidden file input | <input type=file accept='application/json,.json' hidden> | unchanged (hidden native input) | Triggered by Button; onImportFile/onExport logic and notifications unchanged. |

**玻璃 / 渐变用法**：Glass is reserved for FLOATING CHROME only, never on the snippet cards, template fields, or the JSON <pre> (those stay solid Panel/Card/sunken for legibility and scroll perf). Sanctioned glass surfaces on these screens, capped at <=3-4 per viewport and never nested: (1) the snippet-editor Modal — text-bearing, so it uses --afs-glass-fill-strong + blur(20px) + --afs-elev-4 over a --afs-scrim, with @supports/reduced-transparency fallbacks to --afs-surface-3; (2) the 分组 Custom Select popover and (3) the version-history Popover — chrome-recipe glass (--afs-glass-fill + blur(16px) + --afs-elev-3); (4) Tooltips (strong-fill glass for small-text contrast); (5) in-app Confirm dialogs replacing window.confirm. The Panel head reads as a subtle toolbar but stays solid --afs-panel (it sits over scrolling content, not floating). Gradient (the indigo→violet→azure signature) is used SPARINGLY and only on active/primary affordances: the gradient+glow primary Button (新建片段 and editor 保存 — exactly one gradient CTA per surface), the active Segmented pill (group filter active = 全部, and the 本工程/全局默认 scope pill via --afs-grad-accent), the 'edited/override' Badge (color-mix accent tint), and the category accent bar on snippet cards (driven by the per-group --cat color, not the brand gradient). The aurora backdrop (--afs-aurora, static, low-opacity) appears only behind the Empty states. Idle cards, idle buttons, search fields, and the JSON contract get NO gradient.

**亮 / 暗说明**：All new surfaces are token-driven so html.light swaps work with zero per-component branching. Snippet/template cards: dark depth comes from the --afs-panel-2 lightness step over --afs-bg plus a faint --afs-elev-1 contact shadow; light depth comes from real layered --afs-elev-1 shadow on white --afs-panel-2. Replace the hardcoded afs-tag--edited rgba(99,102,241,0.18) with color-mix(in srgb, var(--afs-accent) 18%, transparent) so it tracks the theme-tuned accent (full-chroma #4f46e5 light / desaturated #8b9bff dark) — and on-accent label flips per theme. Replace delete-hover #ef4444 with --afs-danger (light #dc2626 / dark #f87171). The amber afs-advbanner literal #f59e0b becomes --afs-warning (light #b45309 darkened for >=4.5:1 / dark #fbbf24). The editor Modal drops its hardcoded rgba(0,0,0,0.45-0.6) shadow and fixed dark scrim for --afs-elev-4 + --afs-scrim (theme-tuned 0.30 light / 0.42 dark). Glass popovers use the asymmetric recipe: light = rgba(255,255,255,0.62)+darker hairline+shadow; dark = rgba(20,24,38,0.60)+faint white hairline+lighter-surface depth. Category dots/accent bars on snippet cards use the existing per-group colors injected inline as --cat (kept working). Code text uses --afs-text-dim for the muted clamp (now DEFINED in both themes; was the undefined token that broke light mode). Body text on the strong-glass Modal holds >=4.5:1 because fill is >=55%; small Tooltip text uses --afs-glass-fill-strong. Search-field placeholder uses the defined --afs-text-dim. Reduced-transparency drops all backdrop-filter to solid --afs-surface-3; forced-colors gives every glass surface a CanvasText border.

**微交互**

- Primary Button (新建片段 / 保存): hover raises .afs-glow ::after opacity to --afs-glow-opacity (animate opacity only); press = transform scale(0.97); both honor prefers-reduced-motion (glow static / no scale).
- Segmented pill (group filter + scope switch): active pill slides between segments via transform with --afs-ease-move (~180ms); instant under prefers-reduced-motion. Label color crossfades muted->on-accent.
- Snippet Card hover: border --afs-border->--afs-border-strong, elev-1->elev-2, translateY(-1px) over --afs-dur-micro; action IconButtons fade from muted to full --afs-text. Focus-visible shows a 2px --afs-ring on the card if interactive.
- Custom Select (分组): chevron rotates 180deg on open; glass popover scales+fades in from top (--afs-dur-ui, scale .98->1); selected option shows a Check (--afs-accent), highlighted option bg --afs-hover; full keyboard (up/down/Home/End/typeahead/Enter/Esc).
- Search Field: clear ✕ IconButton fades in only when non-empty; Esc clears when focused; focus-within = accent border + ring. Library/Settings result count can update via aria-live polite.
- Version-history Popover: opens anchored under the 历史 button (fade+2px slide), replacing the old inline layout push; Esc closes + returns focus to the trigger; '恢复此版本' runs snapshot(id,value) THEN setOverride(id,h.text) (rollback-stack preserved) and the popover stays/closes consistently.
- Editor Modal: scrim fades + card scales 0.96->1 (--afs-dur-overlay emphasized) on enter, ~20% faster exit; Esc and backdrop-click close (preserved); focus trapped, returns to opener.
- Confirm dialog (delete/restore replacing window.confirm): same scale-in; danger CTA, Cancel is the safe default focus; resolve/abort gate identical to the old confirm.
- JSON-contract disclosure: chevron rotates 90deg, content reveals via max-height/opacity (--afs-dur-ui), never layout-thrash; instant under reduced-motion.
- Textarea focus: border->--afs-accent + 2px ring; the override Badge appears the instant typeof layer[id]==='string' becomes true (i.e. on first edit), matching the existing overridden check.
- Icon button Tooltips: appear on hover (delay) AND keyboard focus; dismiss on Esc; hover-bridge so moving onto them doesn't flicker; slide removed under reduced-motion.
- Vertical Tabs jump-rail (PromptSettings): clicking 文本/图像 smooth-scrolls to that group's section header and sets aria-current; active indicator bar slides with --afs-ease-move.

**必须 1:1 保持的行为**

- PromptLibrary remains its own afs-surface view and PromptSettings remains embedded inside 设置·高级 (AdvancedSettings) — NO IA/route change, only restyle/markup.
- grouped memo: seed ALL SNIPPET_GROUPS, bucket snippets by s.group, render in SNIPPET_GROUPS order, skip groups with 0 items (preserve exactly). Any new group filter defaults to 全部 so default render == current.
- startNew sets editing={name:'',group:'style',text:'',vars:[]}; the editor title toggles 新建片段/编辑片段 on editing.id presence.
- onTextChange: detectVars(text) maps to vars preserving previously-entered defaults (prevDefaults keyed by name) — exact logic kept; runs on every content change.
- onSave: require editing.name.trim() && editing.text.trim() else window.mulby?.notification?.show('请填写名称与片段内容','warning') and abort; else saveSnippet({...editing,name:name.trim()}) then setEditing(null).
- onExport: exportPack() -> Blob 'ai-film-prompts.json' (pretty JSON) -> a.download -> revokeObjectURL. onImportFile: read file, JSON.parse, importPack(obj)=n, notify '已导入 ${n} 个片段'+(obj.globalTemplates?' + 全局模板覆盖':'') 'success'; parse fail -> '导入失败：文件格式不正确' 'error'. Hidden file input accept='application/json,.json'; e.target.value cleared after pick.
- removeSnippet only after confirm of `删除片段「${s.name}」？` (now an in-app glass Confirm with identical gate).
- resolveSnippet({...editing,vars:editing.vars}) drives the live preview; var-count tag = s.vars.length; vars[] add/edit logic on default change preserved.
- PromptSettings scope switching: isProject=scope==='project'; layer/setOverride/resetOne/resetAll all swap between graphStore (project) and promptStore (global) sources EXACTLY; baseline(id)=isProject? (nonEmpty(globalOverrides,id) ?? DEFAULT_PROMPTS[id]) : DEFAULT_PROMPTS[id]; overridden = typeof layer[id]==='string'; value = overridden?layer[id]:baseline(id).
- reset-all button label switches 清空本工程覆盖 / 全部恢复默认 by scope and calls resetAll() for the active scope.
- Template iteration: groups=['text','image'] in that order; match filter on `${t.label} ${t.desc} ${t.id}`.toLowerCase().includes(kw); group with 0 matches returns null; GROUP_LABEL map preserved.
- Textarea rows formula EXACT: g==='text' && !t.id.startsWith('text.fx') ? 12 : 3. onChange=setOverride(t.id,value); onBlur=snapshot(t.id,value).
- Per-template controls: 恢复默认 (resetOne) shown only when overridden; 历史 always shown with count history[t.id]?.length; help line shows t.desc + 占位符 (t.placeholders) + JSON契约 note when t.jsonContract.
- History: 恢复此版本 MUST call snapshot(t.id, value) BEFORE setOverride(t.id, h.text) (rollback stack). relTime thresholds (刚刚 / <60 分钟前 / <24 小时前 / else toLocaleString) unchanged; truncation h.text.replace(/\s+/g,' ').slice(0,60); empty state copy '暂无历史快照（编辑后失焦会自动记录）'.
- JSON_CONTRACT rendered read-only (non-editable) in a <pre>; the disclosure stays a disclosure (collapsed by default like <details>).
- All window.mulby?.notification?.show(message, level) host-toast calls remain the single source of toasts; window.confirm/window.prompt replacements (if added) keep identical async gating + cancel-aborts.
- Theme via html.light class swapping --afs-* CSS vars; no dark-only hardcoded values introduced for any new surface.
- All store hook selectors and action signatures (usePromptStore, useGraphStore) are untouched — redesign is CSS/markup only.

---

### 6.9 Settings — SettingsView shell + AppearanceSettings/StorageSettings/AdvancedSettings + GlobalSettings (project-style modal) + ProviderSettings (provider list + 14-field add/edit form). The heaviest native-control debt in the plugin.

> 设置（原生控件重灾区）：统一字段系统 + 控件集；竖向 Tabs 外壳，5+2 个原生 select 全替换，14 字段供应商表单重排为对齐的内联字段。

**重设计概念（Concept）**

Rebuild all three settings surfaces on ONE field system and ONE control set from the Aurora Glass library, with solid near-opaque content panes and glass reserved only for floating chrome (the Custom Select / Combobox popovers, the GC confirm Dialog, tooltips). The Settings shell becomes a Tabs (vertical-rail) Panel: left rail of nav items, right a single max-720 scroll content Panel on a solid --afs-panel surface; the existing aurora backdrop garnish is allowed only behind empty/landing states, never behind the dense forms. GlobalSettings stays mounted in its ProjectStylePanel Modal (IA unchanged 1:1) but its body is rebuilt with the SAME Field wrapper + Custom Select + Slider components so it reads as one family with ProviderSettings. Every native <select> becomes a headless Custom Select with a glass popover (grouped + swatch variants where useful); the long provider 'kind' and stylePack pickers may use Combobox. Native checkboxes become the gradient-check Checkbox in a fieldset. ProviderSettings collapses from a flat 14-input wall into a Form section/group structure: an 能力 fieldset, then a shape-driven 'card' Form group per provider shape (sync-binary / fal / custom-http) that swaps based on deriveMode + kind, ending with the API-Key field and a foot action row (secondary 取消编辑 + primary 保存/添加). Provider list rows become solid data Cards with a Radio (default), category-neutral cap Badges, key-presence Badge (icon+text, not color-only), a Plug IconButton (test), and a danger IconButton (delete). The single signature gradient appears only on: the active vertical tab indicator, the primary 保存/添加 button, Run-like CTAs (none here), the selected Radio dot, gradient Checkbox check, the active Segmented pill in PromptSettings scope tabs, the Slider range fill (concurrency), and Switch tracks if any boolean is added. window.confirm becomes an in-app glass confirm Modal that drives the exact same async gate. Native <details> becomes a Form-section collapsible disclosure. All hardcoded hexes route through semantic/category/type tokens so light + dark both hold contrast.

**现状问题（12）**

- NATIVE SELECTS RENDER OS-CHROME: 5 <select> in GlobalSettings (filmScale/aspect/dialogueLang/stylePackId/concurrency) + 2 in ProviderSettings (preset, kind) use class afs-field__input or bare afs-form__row select with NO appearance:none, NO custom chevron, NO styled option popup. On Windows the option list is OS-light even in dark mode — the single biggest break from the glass/gradient aesthetic.
- TWO PARALLEL FORM SYSTEMS: GlobalSettings + PromptSettings use afs-field (stacked label-above-input, 100% width, HAS :focus accent border at styles.css:539). ProviderSettings uses afs-form__row (inline 76px-wide span label + flex input, styles.css:1976/1982) which has NO :focus rule (1991-1992) — so half the inputs highlight on focus and half do not. Same conceptual control, two visual DNAs.
- DUPLICATE CONFLICTING .afs-btn: defined twice — styles.css:182 (height 30px, padding 0 9px, radius 6px, bg --afs-hover, font 12px, gap 5px) AND styles.css:3398 (no fixed height, padding 7px 12px, radius 8px, bg --afs-panel, font 13px, gap 6px). Cascade makes later win per-prop, so buttons size inconsistently.
- NATIVE CHECKBOXES OFF-PALETTE: the 5 capability <input type=checkbox> in ProviderSettings have no accent-color, rendering browser-default blue identically in light AND dark, clashing with indigo --afs-accent.
- window.confirm() NATIVE DIALOG: StorageSettings GC uses a raw browser confirm — jarring OS chrome that breaks the in-app aesthetic.
- NATIVE <details>/<summary> in PromptSettings (JSON contract) shows the default browser triangle — dated.
- INCONSISTENT IA: the Settings shell has a 220px left-nav with 4 tabs (providers/appearance/storage/advanced) but the densest config — GlobalSettings project-style — is NOT in this nav; it lives in a separate ProjectStylePanel modal opened from the editor top bar.
- DENSITY / NO GROUPING: ProviderSettings stacks up to 14 inputs flat with tiny 11-12px fonts, 8px gaps and a 3-col micro-input grid (taskIdPath/statusPath/videoUrlPath), with no visual cards separating the three provider shapes (sync-binary / fal / custom-http).
- CRAMPED LABEL COLUMN: afs-form__row > span is fixed 76px (styles.css:1982), too narrow for labels like 请求体模板 / 图片上传地址 which wrap or clip.
- HARDCODED DARK-ONLY COLORS: afs-prov__key #4ade80 / afs-prov__nokey #f59e0b, testmsg--ok #4ade80 / --fail #fca5a5, afs-prov__del:hover rgba(185,28,28,.18)/#fca5a5, afs-btn--danger:hover #7f1d1d, afs-tag--edited rgba(99,102,241,.18), afs-tag--cap rgba(148,163,184,.18), themecard swatches #f1f5f9/#0b0f17. afs-prov--active uses rgba(59,130,246,.08) BLUE while --afs-accent is INDIGO #6366f1 — an actual mismatch.
- WALL-OF-TEXT HINTS: afs-modal__hint / afs-form__note / afs-field__desc / afs-setsec__desc are dense muted 11-12px Chinese paragraphs everywhere — heavy, low hierarchy, no progressive disclosure. Repeated inline style={{marginTop:4}} magic number on 4 GlobalSettings hint divs.
- NO SPACING/TYPE SCALE: paddings (7px 8px, 6px 8px, 9px 11px, 12px 14px) and 11 different font sizes (10–16px) are hand-tuned per element — no rhythm.

**布局规格（Layout Spec）**

REGIONS (SettingsView shell): (1) Panel head — sticky 48px, h2 设置 (Section title 16/600), border-bottom hairline on scroll. (2) Body = two columns: LEFT vertical Tabs rail (afs-tabs--vert) fixed 220px → 200px under 1200px, items = nav buttons with label (13/600) + desc (11/500 muted), active gets color-mix(accent 16%) bg + 2px gradient left-bar + accent label; RIGHT content Panel, scrollable (afs-scroll), inner column max-width 720px centered, padding var(--afs-sp-6)=16px.\n\nGRID: 8px spacing grid throughout. Field vertical rhythm: label→control gap --afs-sp-3(6px), field-to-field margin-bottom --afs-sp-5(12px), section gap --afs-sp-6(16px), section-to-section divider with --afs-sp-6 padding-block. Control height 32px (--afs-control-h), sm rows 26px. Radii: inputs/selects --afs-r-sm(6px), buttons/cards --afs-r-md(8px), section cards/popovers --afs-r-lg(12px), modal --afs-r-xl(16px).\n\nField wrapper: converge afs-field + afs-form__row into ONE .afs-field. Default = stacked. ProviderSettings uses --inline variant where the label column is a TOKEN width (--afs-field-label-w, default 108px, right-aligned) instead of rigid 76px, so 请求体模板/图片上传地址 no longer clip. Help/error sit under control in --afs-text-dim / --afs-danger.\n\nProviderSettings layout: provider-list (stack of Cards, gap --afs-sp-4) → Form. Form = head (title 编辑供应商/添加供应商 16/600) → 预设 Combobox (add-mode only) → 能力 Checkbox fieldset (5 boxes in a wrap row, mode note as a soft Badge) → 类型 Custom Select → 名称 Text Input → SHAPE-CARD (Form group --card, --afs-panel-2 + elev-1, swaps by draftMode/kind) → API Key password Text Input (KeyRound leading icon in label) → foot action row (right-aligned: secondary 取消编辑 when editing + primary 保存/添加).\n\nGlobalSettings (inside ProjectStylePanel Modal, width ~520px): modal head (项目风格 title) → body scroll: lead hint as one compact help line → 成片体量 Custom Select + collapsible 'why' help → 画幅 Custom Select → 对白语言 Custom Select → 风格包 Custom Select (swatch/grouped) + conditional hint → 自由画风/全局画风 Textarea (auto-grow, label text toggles) → 并发上限 Slider (1–8, snapped to [1,2,3,4,6,8]) paired with a read-only value pill + help.\n\nStorageSettings: section title + desc → setrow (附件占用 label / value bold tabular) → primary-ish secondary Button (Sparkles + 清理未引用素材). AppearanceSettings: 2 card-Radio theme tiles in a row. AdvancedSettings: amber warning callout (Form section with --afs-warning soft tint) → PromptSettings (Segmented scope tabs + Search + grouped Textareas + collapsible JSON disclosure).\n\nRESPONSIVE/DENSITY: under 1200px rail → 200px; under ~900px rail collapses to icon+label-only or top horizontal Tabs (content stays 100% width, max 720). Density is dense (28–32px rows, 11–14px type); breathing room only in empty/landing and the theme-card row.

**ASCII 线框**

```text
SETTINGS SHELL (providers tab active)
+--------------------------------------------------------------------------+
| 设置                                                          (sticky head)|
+----------------------+---------------------------------------------------+
| ▌模型供应商          |  <inner column max 720, centered>                 |
|   视频/配乐/语音…    |  ┌─ provider list (solid cards) ───────────────┐ |
|                      |  | (◉) fal 视频  [视频·默认][配乐]   [⚙plug][🗑]| |
|  外观                |  |     fal · fal-ai/kling…  [✓ 有 Key]          | |
|   亮色/暗色主题      |  └──────────────────────────────────────────────┘ |
|                      |  ┌─ 添加供应商 ──────────────────────────────────┐ |
|  存储                |  | 预设   ╭ 从预设快速填充…           ▾╮(combobox) | |
|   素材附件占用与清理 |  | 能力   [✓]视频 [ ]配乐 [ ]语音 [ ]原生 [ ]口型 | |
|                      |  |        ( 模式 · 异步轮询 )                      | |
|  高级                |  | 类型   ╭ fal.ai（聚合）             ▾╮(select)  | |
|   节点提示词·专家    |  | 名称   ┌──────────────────────────────────────┐ | |
|  (active = gradient  |  |  ┌── 形态卡 fal (panel-2 card, elev-1) ──────┐  | |
|   left-bar + tint)   |  |  │ 模型 ┌────────────────────────────────┐  │  | |
|                      |  |  │  视频:I2V用 image-to-video…(help)       │  │  | |
|                      |  |  └─────────────────────────────────────────┘  | |
|                      |  | 🔑 API Key ┌──────────── 粘贴 API Key ──────┐ | |
|                      |  |                          [取消编辑] [✦ 添加] | |
|                      |  └────────────────────────────────────────────────┘ |
+----------------------+---------------------------------------------------+

CUSTOM SELECT OPEN (glass popover)        GC CONFIRM (glass modal)
 类型                                       ##############################
 ╭ fal.ai（聚合）            ▾╮             #  +------------------------+ #
 ┌────────────────────────────┐(glass)     #  | 清理未引用素材?      x | #
 │ ✓ fal.ai（聚合）           │             #  | 删除未被引用的附件,   | #
 │   custom-http（自定义端点）│             #  | 不可撤销.             | #
 └────────────────────────────┘            #  |        [取消][✦ 清理] | #
                                            #  +------------------------+ #
                                            ##############################

GLOBALSETTINGS (ProjectStylePanel modal body)
+-------------------------------------------------+
| 项目风格                                      x |
|-------------------------------------------------|
| 画风/画幅自动注入当前工程(项目名)…  (help line) |
| 成片体量  ╭ 短片                       ▾╮       |
|           ▸ 为什么? (collapsible help)          |
| 画幅      ╭ 16:9（横屏）               ▾╮       |
| 对白语言  ╭ 中文                       ▾╮       |
| 风格包    ╭ （不使用·仅用自由画风）    ▾╮       |
| 全局画风  ┌─────────────────────────────────┐  |
|          │ 如:电影感、赛博朋克…            │  |
|          └─────────────────────────────────┘  |
| 并发上限  ├─────●───────────────┤  ( 3 )       |
|           1                     8   单节点扇出… |
+-------------------------------------------------+
```

**组件映射（32）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| SettingsView shell .afs-surface + .afs-surface__head/title | div wrapper + h2 | Panel + Panel head (sticky 48px, Section title) | Solid --afs-panel; head gains hairline+elev-1 on scroll. Landmark <section aria-label=设置>. |
| Left nav 4 buttons .afs-settings__navitem (label+desc, is-active) | <button> string-concat is-active | Tabs (vertical-rail variant, afs-tabs--vert) | role=tablist/tab, aria-selected, roving tabindex, Up/Down move. Active = color-mix(accent 16%) bg + 2px gradient left-bar + accent label. Keep 4 tabs + default 'providers'. tab state stays local useState 1:1. |
| 5 native <select> in GlobalSettings (filmScale/aspect/dialogueLang/stylePackId/concurrency) | native <select class=afs-field__input> | Custom Select (filmScale/aspect/lang); stylePack → Custom Select with swatch+follow-default; concurrency → Slider (range 1-8 stepped to [1,2,3,4,6,8]) | Headless Radix/React Aria listbox, glass popover. Same value/onChange; stylePack '' => undefined; concurrency String()/Number() coercion preserved. follow-default first option (不使用) maps to '' value. |
| 2 native <select> in ProviderSettings (preset, kind) | bare native <select> (no class / afs-form__row select) | preset → Combobox/Custom Select (option title=hint as helper); kind → Custom Select | applyPreset on change unchanged (spreads EMPTY+preset.config); preset only shown when !editingId. kind sets draft.kind 1:1. |
| 5 capability <input type=checkbox> .afs-capbox__item | native checkbox (browser-default blue) | Checkbox (gradient check) inside Form fieldset/role=group | toggleCap unchanged incl. never-empty fallback ['video']. Group has legend 能力. Mode note becomes a soft Badge. |
| mode note '模式：…' .afs-form__note | inline span | Badge (soft, --afs-type-* neutral) / help line | Derived from deriveMode(draftCaps); text unchanged (同步（语音）/ 异步轮询（视频/音乐）). |
| ~12 text/password <input> .afs-form__row input | native inputs, no :focus rule | Text Input (password variant for API Key) | Now get accent focus border+ring. KeyRound leading icon in label. password placeholder differs when editing+keyPresence. All field→draft mappings 1:1 (baseURL/model/voices/submitUrl/pollUrl/taskIdPath/statusPath/videoUrlPath/uploadUrl). |
| voices comma input | <input> split(',') | Text Input (could be Tags input, keep plain Text Input to preserve exact parse) | Keep split(',').map(trim).filter(Boolean) parse 1:1 — do NOT swap to Tags to avoid changing value semantics. |
| bodyTemplate <textarea afs-form__ta> | native textarea rows=3 | Textarea (code/mono, fixed) | Mono font for template. onChange→draft.bodyTemplate 1:1. |
| GlobalSettings style <textarea afs-field__input> | native textarea rows=3 | Textarea (auto-grow) | Label text toggles 自由画风/全局画风 on stylePackId presence — preserved. onChange→style. |
| PromptSettings textareas .afs-field__input--code | native textarea rows 12/3 | Textarea (code variant) | rows = group==='text' && !id.startsWith('text.fx') ? 12 : 3 preserved. onChange setOverride, onBlur snapshot 1:1. |
| afs-form__row + afs-field (two systems) | inline-76px vs stacked | Field wrapper (one component, --inline variant) | Inline label column = token --afs-field-label-w(108px) not 76px. Unifies focus/aria/describedby wiring. |
| 3 provider shape branches (sync-binary/fal/custom-http) | conditional flat input stack | Form section/group --card (panel-2 + elev-1) | Card swaps on draftMode==='sync-binary' then draft.kind==='fal' else custom-http — exact branch logic preserved. |
| Provider list row .afs-prov(+--active) | clickable <div onClick=onEdit> | Card (interactive, role=button + Enter/Space) | Upgrade bare div to keyboard-openable. --active tint uses --afs-accent (fixes blue/indigo mismatch). onEdit copies provider→draft 1:1. |
| default radio .afs-prov__radio + __dot/Check | <button> Check/dot | Radio (dot) / IconButton-radio | makeDefault sets default for EVERY capability; isDefaultForAll true only if every cap default===p.id → Check. aria-checked. Selected dot = accent. |
| cap tags .afs-tag--cap | span rgba fill | Badge (soft, category/type token) | '·默认' suffix per cap preserved. Token-driven tint (was rgba(148,163,184,.18)). |
| key/nokey spans .afs-prov__key/__nokey | colored span (#4ade80/#f59e0b) | Badge --key (success+Check) / --nokey (warning+AlertTriangle) | Icon+text, not color-only. Semantic tokens theme-tuned for light contrast. |
| test button .afs-prov__testbtn (Plug/Loader2) | <button> disabled while testing | IconButton (Plug; Loader2 afs-spin loading) | Only rendered when mode!=='sync-binary'. onTest logic (keyInput-if-editing else getKey, testVideoProvider, tests[p.id]) preserved 1:1. aria-busy while testing. |
| delete button .afs-prov__del (Trash2) | <button> hover red | IconButton --danger (Trash2) | removeProvider(p.id) 1:1. Danger hue from --afs-danger token + aria-label 删除. |
| testmsg .afs-prov__testmsg(--ok/--fail) | colored line | inline status text (success/danger token) / Toast-style inline | tests[p.id].msg shown; state→hue via tokens; keep inline placement under sub-line. |
| foot 取消编辑 / 保存·添加 .afs-btn / --save | two <button> | Button (secondary 取消编辑) + Button (primary 保存/添加, Plus icon) | Unify the duplicate .afs-btn rules. Primary = solid accent (commit). onSave validation+payload+addProvider/updateProvider+setProviderKey+resetForm all 1:1. label fallback warning notification preserved. |
| StorageSettings GC <button> + window.confirm() | afs-btn + native confirm | Button (secondary, Sparkles) + in-app Modal (confirm variant) | Confirm Modal must drive the SAME async gate: resolve→ await saveProject() THEN runGc() THEN notification.show success with exact string; reject→ no-op. Button disabled while busy. fmtBytes thresholds unchanged. |
| 附件占用 row .afs-setrow | flex label/value | Field (inline) / definition row | Value uses tabular-nums; '${usage.count} 项 · ${fmtBytes(usage.bytes)}' unchanged. |
| Theme cards .afs-themecard (Sun/Moon) | <button> is-active | Radio (card-radio) group | role=radiogroup; Sun=light Moon=dark preserved; setTheme('light'\|'dark'); active=theme===id. Swatch preview colors stay literal (intentional theme previews) but selection ring uses --afs-accent token. |
| AdvancedSettings warning .afs-advbanner | amber color-mix banner | Form section / Callout (warning, AlertTriangle + --afs-warning soft tint) | Copy unchanged; AlertTriangle icon added (not color-only). |
| PromptSettings scope tabs .afs-scope__tab | 2 <button> is-active | Segmented Control (sliding gradient pill) | 本工程/全局默认 exclusive; scope state + all layer/setOverride/resetOne/resetAll/baseline swaps preserved 1:1; active pill = gradient + on-accent label. |
| PromptSettings search .afs-prompts__search (Search+input) | icon + input | Search Field | role=searchbox, clear button, Esc clears. Filter `${label} ${desc} ${id}`.includes(kw) unchanged. |
| reset-all / 恢复默认 / 历史 .afs-link-btn (RotateCcw/History) | text link buttons | Button (ghost, sm) / IconButton with label | resetAll label switches by scope; resetOne(t.id); openHistory toggle; history count badge preserved. RotateCcw/History icons kept. |
| edited badge .afs-tag--edited | span rgba(99,102,241,.18) | Chip/Badge --edited (accent soft, token) | '本工程已改/全局已改' text by scope preserved; tokenized accent tint. |
| history items .afs-history__item + 恢复此版本 | list rows + link | List rows + Button (ghost sm) | relTime thresholds (刚刚/<60 分钟前/<24 小时前/else toLocaleString) preserved; 恢复此版本 must snapshot(id,currentValue) BEFORE setOverride(id,h.text) — rollback-stack order kept 1:1. |
| JSON contract <details>/<summary>/<pre> | native disclosure | Form-section collapsible disclosure + mono <pre> | <button aria-expanded aria-controls> replaces native triangle; JSON_CONTRACT read-only, mono. Disclosure semantics kept. |
| hint paragraphs (afs-modal__hint/form__note/field__desc/setsec__desc) + inline marginTop:4 | muted <div>s | Field help text (Caption, --afs-text-dim) / collapsible 'why' disclosure | Long hints become progressive-disclosure where heavy; magic-number marginTop removed for sp tokens. Copy unchanged. |

**玻璃 / 渐变用法**：Glass is used ONLY on floating chrome here, never on the content panes: (1) every Custom Select / Combobox / preset / stylePack / kind popover uses the Glass-chrome recipe (--afs-glass-fill + --afs-glass-blur + --afs-glass-border + elev-3 + highlight); (2) the GC confirm Modal uses text-bearing glass (--afs-glass-fill-strong + blur(20px) + elev-4) over --afs-scrim; (3) the ProjectStylePanel Modal hosting GlobalSettings is the same text-glass; (4) tooltips on the Plug/Trash IconButtons use --afs-glass-fill-strong. The Settings shell Panel, the left Tabs rail, all provider Cards, the Form shape-cards, and every input/textarea stay SOLID (--afs-panel / --afs-panel-2 / --afs-surface-sunken) for legibility and scroll perf — at most ~1 glass popover + maybe 1 modal open at once, well under the ≤3-4 glass-per-viewport cap, and glass is never nested. The signature indigo→violet→azure gradient appears SPARINGLY and only on active/primary affordances: the active vertical-tab left indicator bar (--afs-grad-accent/brand), the primary 保存/添加 Button (solid --afs-accent, not even gradient — gradient reserved for the rarer AI 'generate' CTAs which don't exist on this screen) and the GC confirm primary, the selected default-Radio dot, the gradient Checkbox check on capabilities, the active Segmented pill in PromptSettings scope tabs, and the concurrency Slider range fill. Idle controls, panels, list rows, and the form body carry NO gradient. The aurora backdrop garnish is allowed only if a settings sub-pane is empty (e.g. provider list empty state), never behind the dense forms.

**亮 / 暗说明**：Everything is token-driven so no per-component theme branching remains. Surfaces: shell Panel --afs-panel (dark #11161f / light #fff); shape-cards + nav-active --afs-panel-2; inputs/selects/textareas --afs-surface-sunken (dark #0d121a / light #e6eaf1) so they read as inset wells in both themes (replaces the old --afs-panel-2 that equaled bg in dark). Placeholders use the now-DEFINED --afs-text-dim (dark #6b7383 / light #8a93a4) — previously undefined and broke light mode. Accent: light full-chroma indigo #4f46e5, dark desaturated #8b9bff; on-accent flips (#fff light / dark ink #0a0e16 dark) so 保存 button + active-tab + radio-dot labels stay legible. Status/key badges: --afs-key uses --afs-success (light #059669 / dark #34d399), --afs-nokey uses --afs-warning (light #b45309 / dark #fbbf24) — replaces hardcoded #4ade80/#f59e0b which were low-contrast on light; each pairs an icon (Check / AlertTriangle) so status is never color-only. Provider --active tint = color-mix(--afs-accent 12%) (fixes the blue #3b82f6 vs indigo mismatch — now matches accent in both themes). Cap/edited chips use color-mix on themed accent/muted not raw rgba, auto-darkening on light. Danger (delete, GC confirm danger) = --afs-danger (light #dc2626 / dark #f87171) not #7f1d1d. Glass popovers: dark rgba(20,24,38,.60)+faint white hairline + lighter-surface depth; light rgba(255,255,255,.62)+darker hairline + real elev-3 shadow. Theme-card swatches keep their literal preview colors intentionally but the selection ring uses the --afs-accent token. Elevation carries depth via shadow in light, via surface-lightness step (panel→panel-2→surface-3) in dark. All glass ships @supports-not + prefers-reduced-transparency (→ solid --afs-surface-3) + forced-colors (→ Canvas/CanvasText border) fallbacks.

**微交互**

- Vertical tab switch: active indicator left-bar slides between items via --afs-ease-move (180ms), label crossfades muted→--afs-text + weight bump; prefers-reduced-motion → instant.
- Custom Select open: chevron rotates 180°, glass popover scales+fades in from top (afs-pop, --afs-dur-ui 180ms ease-standard); selected option shows Check (--afs-accent); option highlight via aria-activedescendant bg --afs-hover; type-ahead + ↑↓/Home/End/Esc.
- Checkbox toggle: gradient fill + Check scales in (0.6→1) with --afs-ease-spring micro-bounce; press scale(0.9); reduced-motion drops bounce.
- Concurrency Slider drag: range gradient fills left of thumb, thumb grows on hover (scale 1.1), value pill updates live (tabular-nums); snaps to allowed steps [1,2,3,4,6,8]; ←/→ step.
- Primary 保存/添加 Button: hover filter brightness(1.06), active scale(0.97); on save success the form resets (resetForm) — no spinner needed since add/update is local.
- Test connection: Plug IconButton → Loader2 afs-spin while tests[p.id].state==='testing', aria-busy=true, button disabled; result line fades in success/danger; honor ~1s min so it doesn't flash.
- GC confirm Modal: scrim fade + card scale 0.96→1 (--afs-dur-overlay 260ms emphasized); primary 清理 shows Loader2 + body locked while await saveProject()→runGc() runs; Esc/scrim-click cancels (no-op); on resolve, success Toast mirrors notification.show.
- Collapsible 'why' help (GlobalSettings) + JSON-contract disclosure: chevron rotates 90°, content height reveals via max-height/opacity --afs-dur-ui; reduced-motion instant.
- Segmented scope pill (PromptSettings): gradient pill slides under selected tab via --afs-ease-move; reduced-motion instant swap.
- Provider Card hover: border → --afs-border-strong + elev-2 lift translateY(-1px); focus-visible 2px --afs-ring ring; click/Enter opens edit.
- Search Field: Clear ✕ fades in when non-empty; Esc clears; leading icon swaps to Loader2 only if filtering were async (here sync, stays Search).
- All focus-visible: 2px --afs-ring outline offset 2px on every control (tabs, selects, inputs, buttons, radios, checkboxes) — never removed, ≥3:1 both themes; forced-colors uses Highlight.

**必须 1:1 保持的行为**

- SettingsView tab state: local useState<SettingsTab> default 'providers'; 4 sections providers/appearance/storage/advanced switch on click. Keep TABS labels+desc strings.
- Theme: useUiStore theme + setTheme('light'|'dark'); 2 options; active = theme===id. Theme type from uiStore.
- Storage GC exact sequence: lazy useEffect load() when !loaded; onGc must (1) confirm with EXACT string '清理「未被任何工程 / 角色场景库 / 上传素材 / 快照」引用的附件？此操作不可撤销。' (now via in-app Modal), (2) await saveProject() FIRST, (3) await runGc(), (4) window.mulby?.notification?.show(`已清理 ${r.removed} 个未引用素材，释放 ${fmtBytes(r.freedBytes)}`,'success'). Button disabled while busy. usage shows `${usage.count} 项 · ${fmtBytes(usage.bytes)}`. fmtBytes B/KB/MB/GB thresholds identical.
- GLOBALS keys/types exact: filmScale(string default '短片'), aspectRatio(string from ASPECTS), dialogueLang(string default '中文'), stylePackId(string|undefined; '' => undefined), style(string), concurrency(Number default 3, value via String()/Number()). Style-pack hint only when getStylePack(id) truthy. Free-style label toggles on stylePackId presence. listStylePacks()/getStylePack() unchanged. ASPECTS array unchanged.
- PROVIDER shape logic: deriveMode(caps)='sync-binary' iff caps===['tts'] else 'async-poll'; UI branches draftMode==='sync-binary' THEN draft.kind==='fal' ELSE custom-http. draftCaps falls back to ['video'] when empty. toggleCap never empties (fallback ['video']). applyPreset spreads {...EMPTY, ...preset.config}. EMPTY default kind=fal, model=fal-ai/kling-video/v1/standard/image-to-video.
- onSave: require draft.label.trim() else notification '请填写供应商名称' 'warning'; payload {...draft, capabilities:draftCaps, mode:draftMode}; if editingId updateProvider(editingId,payload) else id=addProvider(payload); if id && keyInput.trim() setProviderKey(id, keyInput.trim()); then resetForm. onEdit copies provider into draft + setEditingId + clear keyInput. resetForm => EMPTY/null/''.
- PROVIDER list: makeDefault sets default for EVERY capability; isDefaultForAll true only if every cap default===p.id → Check shown. sub-line composes kind · (baseURL|model|submitUrl per mode/kind) + key-presence. testbtn only when mode!=='sync-binary'. onTest: key = (editingId===p.id && keyInput.trim()) ? keyInput.trim() : await getKey(p.id); testVideoProvider; tests[p.id]={state,msg}; testing disables+spins. removeProvider on delete. CAPS / CAP_LABEL maps + 5 cap values (video/music/tts/nativeAudio/lipsync) unchanged.
- voices parse: split(',').map(trim).filter(Boolean) 1:1. custom-http fields taskIdPath/statusPath/videoUrlPath/bodyTemplate/uploadUrl/submitUrl/pollUrl map 1:1. password writes keyInput only, never pre-filled; placeholder differs when editing+keyPresence[editingId].
- PROMPTS scope: isProject=scope==='project'; layer/setOverride/resetOne/resetAll/baseline swap project(graphStore)/global(promptStore). baseline(id)= project ? (nonEmpty(globalOverrides,id) ?? DEFAULT_PROMPTS[id]) : DEFAULT_PROMPTS[id]. overridden = typeof layer[id]==='string'. value = overridden ? layer[id] : baseline(id).
- PROMPTS editing: textarea onChange setOverride(id,value); onBlur snapshot(id,value). rows=(group==='text' && !id.startsWith('text.fx'))?12:3. Search filters `${label} ${desc} ${id}`.toLowerCase().includes(kw). groups=['text','image']; 0-match group returns null. GROUP_LABEL preserved.
- PROMPTS history: openHistory toggles per-id; history[id]||[]; relTime thresholds preserved; 恢复此版本 must snapshot(id, currentValue) BEFORE setOverride(id, h.text). empty message preserved. JSON_CONTRACT read-only.
- All host calls unchanged: window.mulby?.notification?.show(message, kind). All store hook selectors + action signatures (uiStore/assetStore/graphStore/providerStore/promptStore) identical — redesign is CSS/markup only.
- Icon semantics (lucide) preserved: Sun=light, Moon=dark, Sparkles=run GC, Check=is-default, Plug=test, Loader2(spin)=testing, Trash2=delete, Plus=add/save, KeyRound=API key label, RotateCcw=reset default, History=version history, Search=search.

---

### 6.10 Studio (Toonflow workbench): StudioApp + StudioDock + StudioEditor + StudioSettings + WorkbenchDock

> Studio（Toonflow 工作台）：三段式（玻璃工具栏 / 实色 Tabs / 三栏实色工作区）；12+ 原生 select 全替换；时间线、分镜、资产卡统一到组件库。

**重设计概念（Concept）**

Re-skin the Toonflow workbench into the Aurora Glass system WITHOUT touching data flow, store wiring, or host calls. The frame becomes three discipline-driven layers: (1) a single glass Toolbar at top (the only top chrome), (2) a glass-free solid Tabs strip that separates chrome from the dense work area, (3) a 3-column solid work area (StudioDock | stage | AgentPanel) where everything text/canvas-heavy stays on near-opaque Panel/Card surfaces for legibility and pan/zoom perf. Glass is reserved for exactly the floating chrome that already exists conceptually — the Toolbar, the model Popover, the four overlays (settings Drawer, StoryboardWall Modal, ImageFlowEditor Modal, ClipPreview Lightbox), Tooltips, and transient generation-in-progress affordances — capped at the foundation's 3-4-glass-surfaces-per-viewport rule (only one overlay is ever open at once). The signature indigo→violet→azure gradient appears ONLY on brand/primary-AI affordances: the toolbar brand mark, the one gradient+glow CTA per surface (一键成片 in the toolbar, 合成成片 in timeline, 生成并设为关键帧 in refine, the agent Send), active tab/segmented indicators, switch-on tracks, selected rings, and running status. Every native <select> becomes a headless Custom Select with a glass popover; every emoji becomes a Lucide glyph routed through one iconMap (🛠→Wrench, 🎬→Clapperboard, 🎙→Mic inline in option, ⚠→AlertTriangle, ✓→Check, ×→X); the two label-less agent toggles become real labeled Toggle switches; the three character/voice metaphors collapse onto Multi-select toggle-chips (cast), a single-select chip row (speaker) and a Custom Select (voice) that all share the same chip/select tokens. The missing --afs-text-dim is defined per-theme and every hardcoded hex is re-pointed to a semantic/category/type token so light mode finally works and status is never color-only (each status hue gains a Lucide icon + text via Status dot, Badge, Pill).

**现状问题（12）**

- Native <select> everywhere (12+): artStyle, videoRatio, model-bar text/image/video-provider/videoMode/resolution, asset role-voice (with literal '🎙 ' in option text) + voice-picker, storyboard shotSize/cameraMove, timeline transition, StudioSettings per-agent model. styles.css never sets appearance:none on .afs-studio__sel / .afs-studio__sbinline select, so the OS chevron + OS popup render and clash hard with the dark gradient/glass aesthetic and ignore the theme entirely.
- Emoji used as primary, label-less UI: 🛠 (tool-loop) and 🎬 (director-manual) are the ONLY visual for the two most important AgentPanel toggles (no text, just emoji + title + .is-on accent bg); 🎙 inside native voice <option> text; ' ⚠' string appended to the '模型' button label; text glyph ✓ in two places (storyboard 视频 done marker + CandidateClip '设为当选' button); text glyph × as ScriptTab list delete. Cross-platform-inconsistent and unpolished next to Lucide icons used elsewhere.
- --afs-text-dim is referenced in ~20 studio rules (trackdesc, deploylbl, sbinline, castchip, spk, cardprompt, cand-load, sbfieldlbl, dlg inputs, derivdesc) but is NEVER declared in :root or html.light — it silently falls back to inline #94a3b8, a dark-mode gray, so in LIGHT mode all those labels/placeholders are too low-contrast and light mode is partially broken.
- Hardcoded non-token colors ignore theme: #ef4444 (afs-studio__err / err-text), #f59e0b amber (sberr, modelstat.is-missing), #000 backgrounds on cand/flowkf/lightbox-video/filmvideo, #fff text on accent/overlay badges (msg--user, cand-badge, sbnum, cand-actions, card-del), three different scrim opacities rgba(0,0,0,.45 drawer / .78 lightbox / .62 sbnum / .55 cand-actions), stale fallbacks var(--afs-accent,#5b8cff) and var(--afs-accent,#a855f7) that disagree with the real token, and canvas '#111'/'#fff' in StoryboardWall.
- Three overlay paradigms with different scrims/shadows: ModelBar = absolute popover (shadow 0 8px 28px), settings = right drawer (scrim .45, shadow -8px 0 24px), refine/wall/clip = centered lightboxes (scrim .78). No shared elevation, radius, or motion language.
- Topbar overload: back + title input + artStyle select + ratio select + ModelBar popover trigger + busy text + settings icon + 一键成片 crammed into one flex row at gap:10px with no visual grouping; native selects sit raw beside icon buttons.
- StoryboardItem sbhead crams 时长 number + 景别 select + 运镜 select + 轨道 text + delete into one wrapping flex row of tiny 12px native controls — reads like a spreadsheet; AgentDeployPanel and MemoryConfigPanel are 2010-era stacked label+native-input rows.
- Inconsistent delete/action affordances: some deletes are Lucide Trash2, others are bare text '×' (ScriptTab) or '✓'/preview/delete circle buttons (CandidateClip) styled only as positioned rgba-black circles with #fff glyphs.
- Three different 'pick a character/voice' metaphors for the same conceptual action: CastChip toggle pills (出场资产), DialogueLine speaker single-select pills (.afs-studio__spk), and a native <select> voice picker on AssetCard/VoiceCard.
- Two conflicting .afs-btn definitions (styles.css:182 height:30/r6/font12 and :3398 padding7/12/r8/font13/no-height); source order makes the later win but it is fragile, and the only variants are --primary/--ghost/--sm — there is no gradient/glow primary, so the signature AI CTA (一键成片, 生成并设为关键帧) looks identical to neutral buttons.
- No focus-visible, no glass, no gradient, no elevation language anywhere — focus is only a border-color swap; every surface is a flat --afs-panel/--afs-panel-2 fill; nothing uses backdrop-filter or the brand gradient even on running/active states.
- Ad-hoc inline style hacks: style={{marginLeft:'auto'}} on NovelTab clear button, opacity passed as a JSX prop on Lucide placeholders (Film/Users/Clapperboard size opacity 0.3) instead of CSS, and dynamic aspectRatio inline on sbthumb (this last one is legit/data-driven and must be preserved).

**布局规格（Layout Spec）**

REGIONS (StudioEditor root = flex column, height:100%):
1) TOOLBAR (afs-toolbar, glass chrome, height 48px, padding 0 var(--afs-sp-5)=12px, border-bottom var(--afs-glass-border), box-shadow var(--afs-glass-highlight)). Three groups separated by vertical Dividers: LEFT = ghost IconButton back (ArrowLeft 18) + brand mark (28px --afs-grad-brand square, optional) + Inline-editable-text project title (seamless, Section-title 16/600, content-sized, Enter commit / Esc cancel, empty→'未命名工程'). CENTER-RIGHT cluster = [artStyle Custom Select sm + videoRatio Custom Select sm] | [模型 Popover trigger Button sm with AlertTriangle warning suffix] | aria-live busy Pill (Spinner + label). RIGHT = ghost IconButton settings (Settings 18) | the single gradient+glow CTA 一键成片 (Button md, Wand2 leading). Under <1100px the artStyle/ratio/model cluster collapses into an overflow Dropdown menu (kebab).
2) TABS (afs-tabs underline, height 40px, padding 0 16px, border-bottom 1px --afs-border, gap var(--afs-sp-6)). Leading dock-toggle IconButton (PanelLeft, aria-pressed=dockOpen, separated by a vertical Divider) then 5 Tabs (原著/剧本/资产/分镜/时间线) each icon 18 + label; active = --afs-grad-brand 2px sliding underline + --afs-text label.
3) WORK AREA (afs-studio__work, flex row, flex:1, min-height:0): StudioDock 240px (solid Panel, border-right) when dockOpen | stage (flex:1, afs-scroll, padding var(--afs-sp-6)=16px, min-width:0) | AgentPanel 320px (solid Panel, border-left). Under 1200px AgentPanel→280, dock→220.

GRID/SPACING: 8px grid via --afs-sp-*. Control rows 32px (sm 26px). UI type 13/12/11. Card radius var(--afs-r-lg)=12px, inputs/selects var(--afs-r-sm)=6px, chips/switch var(--afs-r-pill). Section gaps var(--afs-sp-6); intra-card gaps var(--afs-sp-3..4). Density is high in inspector-like areas (storyboard sbhead, settings rows, agent) and generous in empty states (afs-empty uses sp-9 + static --afs-aurora garnish).

STAGE-SPECIFIC GRIDS:
- Novel: empty = afs-empty pattern then Textarea(auto-grow, min 240px) + gradient import Button. Loaded = sticky tabbar (Section/group header with trailing actions) + chapter Cards stack (gap sp-3), each Card = title + Pill(N字) + 提取事件 secondary Button + optional event body.
- Script: afs-studio__split — left 180px Panel-section list (新建剧本 Button + selectable Card rows each with X IconButton delete) | right detail = Inline-editable title + flex:1 Textarea(code-ish, resize:none).
- Assets: batch tabbar (3 secondary Buttons, one gradient-glow optional) + 3 Form-section groups (人物/场景/物品) each header(b + 新增 Button) + Card grid (auto-fill minmax 168px). AssetCard = Media-tile thumb (1:1) + Inline name + 2 Textareas + AssetImageStrip(Media-tiles) + role→voice Custom Select + action row of sm Buttons + collapsible Derivative row. Then 音色 group of VoiceCards (fixed 200px Cards).
- Storyboard: batch tabbar + vertical StoryboardItem Card stack (gap sp-4). Each Card: afs-studio__sbmain = left col 200px (Media-tile thumb with data-driven aspectRatio + index Pill + error Badge + ChevronUp/Down IconButtons + Link2 chain Toggle-IconButton) | right fields col (sbhead = compact row of 4 Fields: 时长 Number-stepper + 景别 Custom Select + 运镜 Custom Select + 轨道 Text Input + spacer + delete IconButton; then 画面描述 Textarea, 关键帧提示词 Textarea(mono/code), 出场资产 Multi-select toggle-chips, 对白 DialogueLine rows + 加台词 Button). Footer sbbar (border-top) = 关键帧/视频(with Check + count Pill)/精修 Buttons + failed Badge.
- Timeline: head row (count hint + 全部段提示词 Button + 整片转场 Custom Select + gradient-glow 合成成片 CTA) + TrackCard stack. TrackCard head = index Pill + keyframe Media-tile(16:9 small) + desc + 段时长 Number-stepper + 生成视频 Button; body = prompt Textarea + 提示词 Button; candidate row = CandidateClip Media-tiles(video, 当选 Badge, Check/preview/delete on-media IconButtons). FilmDone = video + 2 Buttons + path hint.

OVERLAYS: settings = Drawer modal (right, ≥580px, scrim var(--afs-scrim), role=dialog, focus trap, glass text-bearing surface) containing StudioSettings (Form-section cards: AgentDeployPanel Checkbox + rows of Custom Select + Number-stepper; MemoryConfigPanel 4 Number-steppers) then SettingsView. StoryboardWall + ImageFlowEditor = Modal (glass-strong, --afs-elev-4). ClipPreview = Lightbox shell (opaque dark scrim, NO backdrop-filter, on-media IconButton close).

**ASCII 线框**

```text
DARK theme, Storyboard tab active, dock open:

╔═══════════════════════════════════════════════════════════════════════════════╗ glass toolbar
║[←] [◳] 雨夜追凶 ✎ │ [水墨风▾][16:9▾] │ [⚙模型 ⚠] (◴合成中…) │ [⚙] │ ✦一键成片 ║ ←gradient+glow CTA
╚═══════════════════════════════════════════════════════════════════════════════╝
 [�&] │ 📖原著  📄剧本  👤资产  ▓🎬分镜▓  🎞时间线        ← gradient underline on 分镜
 ───────────────────────────────────────────────────────────────────────────────
┌─────────────┬───────────────────────────────────────────────┬─────────────────┐
│ STUDIODOCK  │  STAGE (分镜)                                   │  AGENT 制片 🤖  │
│╭素材┬提示词╮│  ┌─新增分镜─┐┌全部关键帧┐┌全部视频┐┌预览故事板┐ │ [工具调用 ◉ ON] │ ←Toggle (was 🛠)
│ ▓素材▓      │                                                 │ [导演手册   ●  ]│ ←Toggle (was 🎬)
│╭──────────╮ │  ┌─────────────────────────────────────────────┐│─────────────────│
││🔍搜索素材 ││  │ ╭───────╮  时长[5▲▼]秒 景别[中景▾] 运镜[推▾]  ││  ┌────────────┐ │
│╰──────────╯ │  │ │ keyfrm│  轨道[main____]            [🗑]   ││  │描述你的短剧…│ │ ←user bubble
│ 角色/场景   │  │ │  [1]  │  画面描述                          ││  └────────────┘ │
│ ┌──┐┌──┐    │  │ ╰───────╯  ┌────────────────────────────┐    ││  ┌────────────┐ │
│ │林│└──┘    │  │ [▲][▼][⛓] │ 雨夜霓虹，主角伫立街口…      │    ││  │(🤖)已拆成 5 │ │ ←assistant
│ └──┘        │  │            └────────────────────────────┘    ││  │  个镜头…    │ │
│ 素材        │  │            关键帧提示词  英文·可空            ││  └────────────┘ │
│ ┌──┐┌──┐    │  │            ⟨主角⟩⟨•反派•⟩⟨街道⟩ +出场资产    ││                 │
│ │雨│└──┘    │  │            对白: (林夏)[台词____][情绪_][✕]   ││─────────────────│
│ └──┘        │  │            [+ 加台词]                         ││ ┌─────────────┐ │
│             │  │ ─────────────────────────────────────────── ││ │下一步…⌘↵发送│ │
│             │  │ ✦关键帧  🎬视频(×2)✓  ⚙精修   ⚠视频失败     ││ └──────[✦➤]──┘ │ ←gradient send
│             │  │ └─────────────────────────────────────────────┘                 │
│             │  (more StoryboardItem cards…)                    │                 │
└─────────────┴───────────────────────────────────────────────┴─────────────────┘

模型 Popover (glass chrome, opens under trigger):     一键成片 CTA detail:
  ┌────────────────────────────┐                       ╔══════════════╗
  │ 文本模型  [ gpt-4o      ▾] │                       ║ ✦ 一键成片   ║ aurora aura
  │ 图像模型  [ flux-pro    ▾] │                       ╚══════════════╝
  │ 视频供应商[ kling       ▾] │  (or ⚠ Badge row)
  │ 视频模式  [ 首帧驱动    ▾] │
  │ 分辨率    [ 720p        ▾] │
  │ 批量并发数[ 3      ▲▼]     │ Number-stepper
  └────────────────────────────┘

Settings Drawer (right, glass-strong + scrim):
  ████████████████████████│ 设置                    [✕] │
  ████████ canvas ████████│──────────────────────────────│
  ████████ dimmed ████████│ ┌Agent 部署──────────────┐  │ Form-section card
  ████████████████████████│ │[✓]高级  [全部设为当前模型]│  │
                          │ │ 统筹/决策 [gpt-4o▾][0.7▲▼]│  │
                          │ │ 编剧      [（用全局）▾][▲▼]│  │
                          │ └──────────────────────────┘  │
                          │ ┌记忆────────────────────┐  │
                          │ │ 注入近期对话条数 [12 ▲▼] │  │
```

**组件映射（56）**

| 元素 | 原控件 | 新组件 | 说明 |
| --- | --- | --- | --- |
| StudioApp empty state (Film opacity-prop + sentence + 2 buttons) | .afs-studio__empty + .afs-btn + .afs-btn--primary, <Film opacity={0.3}> | Empty state | afs-empty pattern: static --afs-aurora garnish behind, Film icon colored var(--afs-text-dim) via CSS (drop the JSX opacity prop), display heading + muted hint, actions = secondary Button (去项目列表, ArrowLeft) + gradient/primary Button (新建工作流项目, Plus). Preserve onHome + createProject({name:'新项目'}). |
| Loading '加载中…' | .afs-studio--center text | Empty state (loading variant) / Skeleton | role=status aria-live=polite, Spinner + text, honor 1s min. Keep loading&&!doc branch. |
| Topbar container | .afs-studio__topbar flex gap:10px | Toolbar | Glass chrome bar role=toolbar, roving focus, vertical Dividers between groups; reduced-transparency→solid --afs-panel. |
| Back button (ArrowLeft) | .afs-btn--ghost | IconButton (ghost, md) | aria-label='返回项目列表'; calls closeProject(). |
| Project name <input class=afs-studio__title> | raw text input | Inline editable text (seamless) | Display=button '编辑 {name}', edit=input; Enter commit/Esc cancel/blur commit; empty→fallback. Keep updateMeta({name}). |
| artStyle <select> (listStylePacks) | native select .afs-studio__sel | Custom Select (sm) | Headless listbox, same options/value, updateMeta({artStyle}). swatch variant optional if packs carry color. |
| videoRatio <select> 16:9/9:16/1:1 | native select | Custom Select (sm) | updateMeta({videoRatio}); drives sbthumb aspectRatio downstream — keep value strings identical. |
| 模型 trigger Button + ' ⚠' string | .afs-btn--sm with Settings2 + literal ' ⚠' | Button (secondary sm) + Popover; ⚠→AlertTriangle (Lucide) | Replace text ' ⚠' with AlertTriangle 14 colored var(--afs-warning), shown only when ok===false; advisory only, never disables. aria-haspopup + aria-expanded. |
| ModelBar popover (.afs-studio__modelpop absolute div) | hand-rolled absolute div + box-shadow | Popover (glass chrome, --afs-elev-3) | Floating chrome→glass allowed; outside-click+Esc close, focus return. Holds the 6 controls below. |
| 文本/图像 model <select>, 视频供应商 <select>, 视频模式 <select>, 分辨率 <select> | 5 native selects .afs-field__input | Custom Select (md) ×5 | Each headless, same option sets/values incl. '（未选）'/'（自动选第一个）' follow-default first option mapping to ''. Keep setSelectedModel/setSelectedImageModel/setDefault('video',..)/updateMeta({videoMode\|videoResolution}). 视频供应商 missing→is-missing replaced by warning Badge/Pill (AlertTriangle + text, var(--afs-warning)). |
| 批量并发数 <input type=number min1 max8> | native number .afs-field__input | Number Stepper (md) | Native spinner suppressed, ▲▼ chevrons; preserve clamp Math.max(1,Math.min(8,...)) and updateMeta({concurrency}). |
| busy span (Loader2 + label) | .afs-studio__batchstat | Pill (status) + Spinner | aria-live=polite; shows film.text\|\|'合成中…' or batch.label. busy=batch.running\|\|film.state==='composing' unchanged. |
| Settings icon button | .afs-btn--ghost--sm Settings | IconButton (ghost, md) | aria-label; opens settings Drawer. |
| 一键成片 button | .afs-btn--primary--sm .afs-studio__produce | Button (gradient + glow, md) — the single signature CTA | --afs-grad-accent + .afs-glow aura, Wand2/Loader2 leading. Keep disabled=busy\|\|storyboards.length===0 and autoProduce(). Exactly one gradient button on this surface. |
| Tabs nav (.afs-studio__tabs + .afs-studio__tab) | underline buttons | Tabs (underline) + IconButton dock-toggle | role=tablist; --afs-grad-brand sliding indicator; aria-selected maps to tab state; persistence of {stageTab,dockOpen} via window.mulby.storage unchanged. Dock toggle = IconButton aria-pressed=dockOpen (PanelLeft). |
| AgentPanel container + bubbles | .afs-studio__agent / __msg--user / --assistant | Panel (solid) + chat bubbles + Avatar | User bubble keeps accent fill but text via --afs-on-accent (theme-flip) not hardcoded #fff. Assistant bubble = Panel surface. Add agent Avatar (Bot, --afs-grad-brand) in header; processing→breathing Avatar/Spinner. Keep memory filter, agentBusy/agentStage. |
| 🛠 tool-loop toggle button | .afs-studio__manualtoggle.is-on (emoji-only) | Toggle / Switch (labeled-row) + Wrench (Lucide), active Phosphor Wrench Fill | role=switch aria-checked=toolLoop, visible label '工具调用循环' + Wrench icon. Keep setToolLoop and runAgentToolLoop-vs-runAgent branch in send(). |
| 🎬 director-manual toggle button | .afs-studio__manualtoggle (emoji-only) | Toggle / Switch (labeled-row) + Clapperboard (Lucide) | aria-checked=showManual reveals the manual Textarea. Keep setShowManual + updateMeta({directorManual}). |
| director manual <textarea> | .afs-studio__manual | Textarea (auto-grow, sm) | updateMeta({directorManual}) unchanged. |
| agent prompt <textarea> + send/stop | raw textarea + .afs-btn--primary / stop | Textarea (fixed, sm) + gradient Send Button + danger/secondary Stop IconButton | Send→gradient (Send icon), disabled when empty; Stop→X IconButton while busy→abortAgent(). Keep Ctrl/Cmd+Enter send + clear-on-send. |
| NovelTab paste textarea + import | .afs-studio__novelpaste + primary btn | Textarea (auto-grow) + Button (gradient) ; Empty state for the hint | Keep importNovel(text)+clear; remove style={{marginLeft:'auto'}} hack → use Form-section header trailing-action slot or a spacer class. |
| NovelTab tabbar + chapter rows | .afs-studio__tabbar + .afs-studio__chapter | Form section / group header + Card (data) per chapter + Pill (N字) | 清空→danger secondary Button (Trash2). per-chapter 提取/重提→secondary Button (Wand2/Loader2). Keep extractChapterEvents/extractAllEvents, eventState 'generating'. |
| ScriptTab list + × delete + active item | .afs-studio__listitem + raw × button | Panel list of Card rows + X IconButton (×→X Lucide) + is-selected accent ring | 新建剧本→secondary Button. Delete X IconButton aria-label='删除剧本' with stopPropagation. Keep upsertScript/removeScript + sel fallback to first. |
| ScriptTab title input + content textarea | .afs-studio__title + .afs-studio__editor-text | Inline editable text + Textarea (fixed, code-feel) | Keep upsertScript({id,name\|content}). |
| AssetsTab batch buttons (全部润色/全部生成/AI配音匹配) | 3× .afs-btn--sm | Button (secondary sm) ×3; AI 配音匹配 may be gradient if treated as the section's AI action | Keep disabled logic (batch.running, assets length, role&&audio for autoBindVoices); Bot icon stays. |
| Asset group headers + 新增 | .afs-studio__assetgroup-head b + btn | Form section / group (with-action header) | 新增→secondary Button (Plus); upsertAsset({type,name}) unchanged. |
| AssetCard thumb (img/Loader2/Users placeholder + AlertCircle err) | .afs-studio__thumb + .afs-studio__err #ef4444 | Media tile / thumbnail card (states: loaded/pending/failed) | Failed badge→Badge/Status using var(--afs-danger)+AlertCircle (drop #ef4444 over rgba black). Users placeholder→CSS color var(--afs-text-dim), not opacity prop. Keep useMediaUrl(refImageId). |
| AssetCard name input | .afs-studio__cardname | Inline editable text (or Text Input borderless) | upsertAsset name unchanged. |
| AssetCard desc + prompt textareas | .afs-studio__carddesc / __cardprompt (#text-dim) | Textarea (auto-grow sm) + Textarea (code/mono sm) | prompt is english→mono variant; placeholder uses now-defined --afs-text-dim. Could adopt 'optimizable' variant pointing 润色 at the AI-optimize affix, but simplest: keep separate 润色 Button. Keep upsertAsset desc/prompt. |
| AssetImageStrip + ImageStripThumb (select + raw X) | .afs-studio__imgthumb is-sel + raw button | Media tile (sm, selected ring) + X IconButton (on-media) | is-sel ring=var(--afs-accent). Keep render only when images.length>=2, selectAssetImage/deleteAssetImage. |
| role→voice <select> with '🎙 {name}' | native select .afs-studio__voicesel | Custom Select with leading Mic icon per option (🎙→Mic Lucide) | Drop in-text 🎙; render Mic 14 as option leading icon. Keep '（未配音）' follow-default + bindRoleVoice. |
| AssetCard action row (润色/生成/衍生/delete) | 4× .afs-btn(--sm/--ghost) | Button (secondary) 润色/生成, Button (ghost) 衍生 with count Pill, IconButton (danger) delete | 衍生 count→Pill. Delete Trash2→IconButton danger. Keep polishAsset/generateAsset/addDerivative/removeAsset + promptState/state. |
| DerivativeCard (thumb/name/desc/gen/del) | .afs-studio__deriv* | Card (sm) + Media tile + Inline text + Text Input + Button + IconButton | Keep generateDerivative/removeAsset; disabled add when !refImageId. |
| VoiceCard (name/voice-select/desc/audio/试听/del) | .afs-studio__voicecard + native select + raw <audio> | Card + Inline text + Custom Select (voice) + Text Input + native <audio controls> kept + Button + IconButton | Keep <audio> for scrub a11y; synthVoice/removeAsset/upsertAsset(audio). Failed→Badge (drop #f59e0b literal). |
| StoryboardItem card | .afs-studio__sbcard hover color-mix | Card (interactive resting, elev-1→elev-2 hover) | Keep hover accent-mix border via tokens. Solid surface, not glass. |
| sbthumb (data-driven aspectRatio) + index + err | inline style aspectRatio + .afs-studio__sbnum rgba(0,0,0,.62) #fff + __err | Media tile (aspect-locked via preserved inline aspectRatio) + Pill (on-media index) + Badge (danger error) | PRESERVE inline aspectRatio=videoRatio.replace(':',' / '). index Pill on-media uses --afs-scrim. error→AlertCircle var(--afs-danger). |
| ChevronUp/Down move buttons | .afs-studio__move | IconButton (sm) | disabled at ends; moveStoryboard(id,±1) unchanged. |
| Link2 chain-from-prev toggle | .afs-studio__chain.is-on | IconButton (toggle, aria-pressed) — Link2 | Only when index>0; accent tint when on. Keep patch({chainFromPrev}). |
| sbhead inline fields (时长/景别/运镜/轨道 + delete) | label.afs-studio__sbinline wrapping native input/select | Field row: Number Stepper (时长, unit 秒) + Custom Select (景别) + Custom Select (运镜) + Text Input (轨道) + spacer + IconButton danger (delete) | SHOT_SIZES/CAMERA_MOVES with '—' follow-default. Keep duration clamp default 5, patch() merges Partial with videoDesc required. |
| 画面描述 / 关键帧提示词 textareas | .afs-field__input / __cardprompt | Textarea (auto-grow) + Textarea (code/mono) with '英文·可空' as Field help | Keep videoDesc required path (upsertStoryboard{id,videoDesc}) vs patch({prompt}). |
| 出场资产 CastChip toggles | .afs-studio__castchip.is-on (avatar + name) | Multi-select & Tags Input → toggle-chips variant | role=group of aria-pressed buttons, avatar + label, accent-tint on. Keep toggleCast/associateAssetIds. Uses defined --afs-text-dim. |
| DialogueLine speaker pills (.afs-studio__spk) + line/emotion inputs + X | single-select pills + 2 inputs + raw X | Segmented-like single-select chip row (speaker) + Text Input (台词) + Text Input (情绪) + X IconButton | Speaker chips share chip tokens with cast; preserved extra speaker handling intact. Keep onChange/onRemove, options=charAssets+旁白+extra. |
| 加台词 button | .afs-studio__dlgadd | Button (ghost sm, Plus) | setDlg append {character:'',line:''}. |
| sbbar (关键帧/视频 with ✓+count/精修 + failed) | 3 buttons + ' ✓' string + '(n)' + __sberr | Button (secondary) ×2 + Button (ghost) 精修; ✓→Check (var(--afs-success)); count→Pill; failed→Badge (AlertCircle+text) | Keep generateKeyframe/generateClip disabled logic, candCount from track.clipIds, clip.state done/failed. |
| StoryboardWall modal (canvas PNG) | .afs-studio__lightbox + __wall + canvas '#111'/'#fff' | Modal / Dialog (glass-strong) + 导出 Button + close IconButton | Canvas fill stays #111/#fff (export-bound, canvas-only — acceptable, document as intentional). Keep download() + busy. role=dialog. |
| ImageFlowEditor modal + FlowRef toggles + refine | .afs-studio__flowedit lightbox + .afs-studio__flowref.is-sel + primary btn | Modal / Dialog (glass-strong) + Media tile toggles (selected ring) + Textarea + gradient CTA 生成并设为关键帧 | flowkf img bg stays dark via token. Keep refineKeyframe(sb.id,sel,prompt), initial sel from associateAssetIds→refImageId. |
| TimelineTab head (count/全部段提示词/转场/合成成片) | .afs-studio__timeline-head + native transition select + primary | Form-section header row: hint text + Button (secondary 全部段提示词) + Custom Select (转场) + Button (gradient+glow 合成成片) | transition options fade/xfade/none → updateMeta; compose() disabled=composing\|\|!anyDone. composing/failed→Pill/Badge (drop #ef4444). |
| TrackCard (head/duration/generate/prompt/candidates) | .afs-studio__trackcard + native number + textarea + buttons | Card + Pill index + Media tile keyframe + Number Stepper (段时长) + Button + Textarea + Button | trackdesc/trackdur use defined --afs-text-dim. Keep updateTrackDuration/updateTrackPrompt/generateTrackPrompt/generateClip; promptState failed→Badge. |
| CandidateClip (video + 当选 + ✓/preview/delete circles) | .afs-studio__cand + rgba-black circle buttons + ✓ glyph | Media tile (video, selected ring) + Badge (当选, accent) + on-media IconButtons (✓→Check, Film, Trash2) | Three actions become scrim-backed on-media IconButtons (aria-labels 设为当选/预览/删除). Keep selectClip/onPreview/deleteClip; pending/failed states→Spinner/AlertCircle. |
| ClipPreview lightbox | .afs-studio__lightbox scrim .78 + close | Lightbox shell (opaque dark scrim, NO backdrop-filter) + on-media close IconButton | Keep <video controls autoPlay> for scrub. Esc/scrim close. |
| FilmDone (video + 打开文件夹 + 另存为 + path) | .afs-studio__film + 2 buttons | Card + native <video> + Button ×2 + Caption hint | Preserve window.mulby shell/dialog/filesystem/notification calls exactly. |
| Settings drawer (scrim .45 + __drawer) | .afs-studio__drawer-scrim/__drawer | Drawer (modal, right, glass-strong) + scrim var(--afs-scrim) | role=dialog aria-modal, focus trap, Esc/scrim close, focus return. Contains StudioSettings + SettingsView. |
| AgentDeployPanel (advanced checkbox + 全部设为当前模型 + per-agent rows) | .afs-studio__setsec + native checkbox + native selects + native number temp | Form section / group (card) + Checkbox + Button + per-row Field (Custom Select model + Number Stepper temperature) | Custom checkbox gradient check; '（用全局）' follow-default. Keep setMode/setAllModel/setEntry, AGENT_KEYS rows, simple=only decision row, temp clamp step0.1 min0 max2. |
| MemoryConfigPanel (4 native number rows) | .afs-studio__setrow + native number | Form section / group (card) + 4× Field (inline label + Number Stepper) | Keep getMemoryConfig + kvSet(STUDIO_KV.memoryConfig); min1; Number()\|\|fallback logic intact. |
| StudioDock tabs + search + items + snippets | .afs-dock/__tab/.afs-dockpanel/.afs-dockitem/.afs-docksnip | Panel + Segmented control (素材\|提示词) + Search Field + Media-tile dock items + Menu-like snippet rows | Click-to-insert (NOT drag) preserved: insertAtFocused + notifyInsert via window.mulby.notification. Empty→Empty state. Keep assetStore lazy load. |
| WorkbenchDock (canvas sibling, 3 tabs, drag DnD) | shared afs-dock* + draggable items | Panel + Segmented control (节点\|素材\|提示词) + Search Field + draggable Media-tiles + snippet rows | PRESERVE drag payloads DND_ASSET/DND_ELEMENT/DND_SNIPPET + appendTextToSelected (distinct from StudioDock click-insert). Same dock CSS tokens so both stay consistent. |

**玻璃 / 渐变用法**：GLASS (capped at the foundation's 3-4 surfaces/viewport; only one overlay open at a time, so the live count is Toolbar + at most one of {Popover, Drawer, Modal} + transient Tooltip): (1) Toolbar = Glass-chrome base recipe (dark rgba(20,24,38,0.60)+blur16/sat160, light white 0.62+blur16/sat180), border-bottom only, --afs-glass-highlight inset sheen. (2) 模型 Popover = Glass-chrome (--afs-elev-3). (3) Settings Drawer = Glass modal/sheet text-bearing (--afs-glass-fill-strong ≥55% so body text holds 4.5:1, --afs-elev-4). (4) StoryboardWall + ImageFlowEditor = Glass modal/sheet strong. (5) Tooltips on icon-only buttons (lock/expand/move/chain/candidate actions) = Glass-chrome strong. (6) generation-in-progress = the agent processing Avatar/breathe glow and the running Status dot halo. EXPLICITLY NOT glass: every node-like dense surface — StudioDock body, AgentPanel, all Cards (asset/storyboard/track/voice/derivative/chapter), all tiles, all input fields, the Tabs strip, and crucially the ClipPreview Lightbox scrim (forbidden backdrop-filter for GPU perf with animating video) — all stay near-opaque solids for legibility + pan/zoom perf. Every glass class ships the @supports-not / prefers-reduced-transparency / forced-colors fallbacks (→ --afs-surface-3 or --afs-panel opaque).

GRADIENT (one signature indigo→violet→azure, sparingly): brand mark in Toolbar = --afs-grad-brand. The single gradient+glow CTA per surface = --afs-grad-accent + .afs-glow aura: 一键成片 (toolbar), 合成成片 (timeline head), 生成并设为关键帧 (ImageFlowEditor), agent Send. Active Tab underline + Segmented active pill = --afs-grad-brand/--afs-grad-accent. Toggle-on track, Checkbox check, selected Card/tile rings, custom-select selected-option tint = --afs-grad-accent / color-mix on themed accent. Determinate progress (none today but available for media renders) = --afs-grad-progress. The static low-opacity --afs-aurora appears ONLY behind empty states (StudioApp empty, novel/script/storyboard/timeline empty hints) and never animated, never behind dense work. Idle controls, panels, and resting cards get NO gradient.

**亮 / 暗说明**：Single biggest fix: DEFINE --afs-text-dim per theme (dark #6b7383 / light #8a93a4) so the ~20 studio rules (trackdesc, deploylbl, sbinline, castchip, spk, cardprompt, cand-load, sbfieldlbl, dlg inputs, derivdesc, lblhint) stop falling back to the dark-gray #94a3b8 that broke light mode. All currently-hardcoded hexes are re-pointed to theme-tuned semantic/category tokens: #ef4444→var(--afs-danger) (dark #f87171/light #dc2626) on asset/storyboard/clip error Badges + err-text; #f59e0b→var(--afs-warning) (dark #fbbf24/light #b45309) on sberr + model-missing Badge; stale var(--afs-accent,#5b8cff)/(#a855f7) fallbacks dropped — accent is theme-asymmetric (light full-chroma #4f46e5, dark desaturated #8b9bff) and on-accent text flips (#fff light / #0a0e16 dark ink) on every gradient/accent fill (msg--user bubble, cand-badge, sbnum/index Pill, segmented active, switch-on, primary buttons). Surfaces: Cards/Panels solid — dark gets depth from the panel→panel-2→surface-3 lightness ladder + faint --afs-elev-1 contact shadow; light gets depth from real layered --afs-elev-1/2 shadows on white. Sunken wells (inputs, dock search, timeline tracks, sbthumb bg) use --afs-surface-sunken (dark #0d121a / light #e6eaf1) so they read inset in both. Glass is theme-asymmetric per recipe (light white-tint + darker hairline + shadow; dark deep-blue-black tint + faint white hairline + lighter-surface elevation, no heavy shadow). The three scrims unify to var(--afs-scrim) (dark 0.42 / light 0.30) for Drawer + Modals; ClipPreview keeps an intentionally opaque dark theater scrim in both themes, with its on-media control fills token-driven (color-mix #000 55%) + white glyph so they never become white-on-white in light. Category/type hues for asset-type chips (角/景/物), dialogue, and badges come from --afs-cat-*/--afs-type-* (auto-darkened on light for 4.5:1). StoryboardWall canvas #111/#fff is the one sanctioned dark-only exception (raster export target, not on-screen chrome). Brand mark drops amber → --afs-grad-brand in both themes.

**微交互**

- Toolbar 一键成片 / timeline 合成成片 / refine CTA: idle = flat gradient; hover/aria-busy(running) = .afs-glow ::after aura opacity rises to --afs-glow-opacity over --afs-dur-ui; press = scale(0.97) --afs-dur-micro; loading swaps Wand2→Loader2 (afs-spin) keeping label width frozen + aria-busy.
- Tab switch: active --afs-grad-brand underline slides between tabs via transform with --afs-ease-move over --afs-dur-ui; label color --afs-muted→--afs-text. Dock-toggle IconButton press scale(0.94) + aria-pressed flip.
- Custom Select open: chevron rotates 180° (--afs-dur-ui), trigger border→--afs-accent, glass popover animates opacity+translateY(-4px)→0 scale(.98)→1; selected option shows Check (var(--afs-accent)) + subtle accent tint; keyboard ↑↓/Home/End/type-ahead highlight via aria-activedescendant.
- Toggle/Switch (工具调用循环, 导演手册): thumb travels with --afs-ease-spring (subtle bounce) transform-only, track fills --afs-grad-accent on; press = thumb scale(0.92); director-manual switch-on animates the manual Textarea reveal via max-height/opacity (no layout thrash). prefers-reduced-motion→instant.
- Number Stepper (时长/段时长/温度/记忆/并发): ▲▼ press-and-hold repeat, button active scale; at-min/at-max disables the matching chevron; value tabular-nums for stable width; focus-within → accent border + ring.
- CastChip / speaker chip / FlowRef / candidate / image-strip toggle: hover lifts text→--afs-text; selected/on = accent-tint fill + accent border + (tiles) 2px accent ring via box-shadow; press scale(0.97). Check appears on selected candidate.
- StoryboardItem / TrackCard / asset Card hover: border→--afs-border-strong + elevation step (elev-1→elev-2) + translateY(-1px) over --afs-dur-micro; focus-visible 2px --afs-ring ring on interactive cards.
- Status feedback: running Status dot breathes (opacity+scale, --afs-dur-breathe) with a low-opacity --afs-info halo; queued/done/error are static hue + icon + text (never color-only). Generate buttons disabled→opacity .45, glow hidden.
- Agent send: Ctrl/Cmd+Enter sends, text clears, an assistant bubble shows a breathing Avatar/Spinner while agentBusy; streaming text uses the brand-gradient shimmer sweep (--afs-dur-shimmer) that stops the instant content settles; Stop swaps Send→X danger IconButton.
- Overlay enter/exit: Drawer slides translateX(12px)→0 + fade over --afs-dur-overlay (emphasized); Modals scale(0.96)→1 + scrim fade; exits run ~20% faster (--afs-dur-exit). Esc + scrim-click + outside-click close (modal traps focus, returns to opener); ClipPreview Esc/scrim close. All transform/opacity only — never animate blur/box-shadow/layout.
- Inline-edit title: hover shows Pencil affordance; F2/Enter enters edit with select-all + accent ring; Enter commit / Esc restore / blur commit; empty→fallback '未命名工程'.
- focus-visible everywhere: 2px var(--afs-ring) outline offset 2px on every control (was absent); forced-colors → Highlight ring; all press-scale + shimmer/breathe respect prefers-reduced-motion (neutralized to static).

**必须 1:1 保持的行为**

- StudioApp boot: useProjectStore.init(), useAgentDeployStore.getState().load(), registerToolCallingProbe() on mount; loading(&&!doc)→'加载中…', doc→StudioEditor, else empty; onHome + createProject({name:'新项目'}).
- Stage tab state machine novel|script|assets|storyboard|timeline; dockOpen + settingsOpen booleans; persist/restore {stageTab,dockOpen} via window.mulby.storage.get/set('studio:ui',...,'ai-film-studio'); installFocusTracker() on mount.
- Topbar: doc.meta.name→updateMeta({name}); artStyle from listStylePacks()→updateMeta({artStyle}); videoRatio 16:9/9:16/1:1→updateMeta({videoRatio}) (and the inline sbthumb aspectRatio=videoRatio.replace(':',' / ') stays data-driven); closeProject(); autoProduce() disabled when busy||storyboards.length===0; busy=batch.running||film.state==='composing'.
- StudioModelBar: graphStore selectedModel/selectedImageModel + setters; providerStore defaults.video + setDefault('video',...); videoProviders=providers filtered on capabilities includes 'video'; videoProvider resolution order (default→first enabled→null); meta.videoMode default firstFrame (firstFrame/startEndFrame/multiRef/singleImageFirst), videoResolution default 720p (480p/720p/1080p), concurrency clamp Math.max(1,Math.min(8,...)) default 3; ok=!!selectedModel&&!!selectedImageModel&&!!videoProvider drives the warning ONLY (never disables).
- AgentPanel: send() routes runAgentToolLoop(t) when toolLoop else runAgent(t); abortAgent() while busy; doc.memory filtered to user/assistant; agentBusy/agentStage drive busy bubble; directorManual via updateMeta; Ctrl/Cmd+Enter sends + clears text; send disabled when !text.trim()||busy.
- NovelTab: importNovel(text)/clearNovel/extractChapterEvents(id)/extractAllEvents; batch.running disabling; chapter eventState 'generating'; import clears local text.
- ScriptTab: upsertScript({name,content,id}) returns id used to set sel; removeScript; sel fallback to doc.scripts[0]; × delete uses stopPropagation and nulls sel if deleting current.
- AssetsTab: generateAllAssets/polishAllAssets/autoBindVoices; group filter type role/scene/prop && !parentAssetId; upsertAsset({type,name:`${label}${items.length+1}`}); autoBindVoices disabled unless assets include a role AND an audio.
- AssetCard: generateAsset/polishAsset/addDerivative(disabled when !refImageId)/removeAsset/bindRoleVoice; state generating/failed + promptState polishing/failed; refImageId→useMediaUrl; role→voiceAssets select with '（未配音）'→bindRoleVoice(id, value||undefined).
- AssetImageStrip: renders only when images.length>=2; selectAssetImage/deleteAssetImage; is-sel = im.id===currentImageId.
- VoiceCard: upsertAsset type:'audio' (name/voice/desc); synthVoice(id); listProviderVoices(); useMediaUrl from audioUrl|audioFilePath; native <audio controls> retained.
- StoryboardTab/Item: upsertStoryboard (videoDesc REQUIRED; patch merges Partial with videoDesc carried), removeStoryboard, moveStoryboard(id,±1), generateKeyframe/generateClip, generateAllKeyframes/generateAllClips, hasKeyframes gating; chainFromPrev only when index>0; shotSize/cameraMove(''→undefined)/duration(default 5, Number()||5)/track fields; associateAssetIds toggle via CastChip; dialogues [{character,line,emotion}] add/edit/remove; speaker options = role assets + '旁白' + preserved non-list extra; candCount=track.clipIds.length, clip via selectClipId||last clipId; StoryboardWall sorts by index, filters keyframeImageId, Canvas 2D compose (#111 bg, #fff S## labels, 5 cols 320x180) + PNG download via anchor toDataURL.
- ImageFlowEditor: refineKeyframe(sb.id, sel, prompt); initial sel derived from sb.associateAssetIds→asset.refImageId (filtered truthy); assets filtered to refImageId present; prompt seeds from sb.prompt||sb.videoDesc.
- TimelineTab/TrackCard: tracks.length===0 empty; sort by order; compose() disabled=composing||!anyDone (anyDone=some clip done); generateAllTrackPrompts disabled unless a track has storyboardIds; transition meta fade/xfade/none→updateMeta; updateTrackDuration(id, value||undefined) clamp 1..15 with placeholder sb.duration; updateTrackPrompt/generateTrackPrompt; generateClip(sb.id); selId=selectClipId||clipIds[0]; cands map+filter; CandidateClip select/preview/delete; film.state composing/failed/done + film.path; promptState generating/failed.
- FilmDone: window.mulby.shell.showItemInFolder(path); dialog.showSaveDialog → filesystem.readFile(path,'base64') → writeFile(dest,data,'base64') → notification.show; FilmPreview useMediaUrl({localPath}).
- StudioDock: click-to-insert via insertAtFocused(name|resolvedSnippet) + notifyInsert (window.mulby.notification.show success/warning); assetStore lazy load; promptStore SNIPPET_GROUPS/resolveSnippet; NO drag.
- WorkbenchDock (canvas): drag DnD payloads DND_ASSET/DND_ELEMENT/DND_SNIPPET set on dataTransfer + appendTextToSelected on snippet click + notification — must remain DISTINCT from StudioDock click-insert.
- StudioSettings: agentDeployStore load/setMode('simple'|'advanced')/setEntry(k,{model|temperature})/setAllModel(selectedModel); AGENT_KEYS rows, simple=only 'decision'; '全部设为当前模型' shown only when selectedModel; temperature ''→undefined (step0.1 min0 max2); MemoryConfigPanel getMemoryConfig + kvSet(STUDIO_KV.memoryConfig) with DEFAULT_MEMORY_CONFIG fields shortTermLimit/messagesPerSummary/summaryMaxLength/ragLimit (Number(e)||prev).
- All useMediaUrl/loadAssetUrl image+video resolution, afs-spin Loader2 spinner semantics, and every generate-button disabled-state predicate remain byte-identical in behavior; all controls become headless (Radix/React Aria) restyle that drives the exact same value/onChange/host calls as the native elements they replace.

---

## 7. 可访问性与降级（Accessibility & Fallbacks）

- Contrast targets: body text >=4.5:1, large/heading text and UI controls/icons >=3:1, focus rings >=3:1. Verified against the WORST-CASE surface, not the average. The text emphasis ladder (text/muted/text-dim) was tuned so even text-dim clears 3:1 on its surface in both themes; text-dim is now DEFINED (the legacy studio block referenced an undefined --afs-text-dim that fell back to a dark gray and broke light mode).
- Glass contrast: never trust a raw glass token value — flatten the alpha by compositing the fill over the actual backdrop, then measure against the lightest, darkest, AND most-saturated states the backdrop can reach. Body text only goes on >=55% fill glass (--afs-glass-fill-strong / .afs-glass--text) or over a --afs-scrim layer. Thin --afs-glass-fill (~60%) is for chrome/decoration. WCAG 2.x overstates contrast for dark color pairs, so dark + gradient surfaces were cross-checked with APCA (target ~Lc 60 body).
- Accent is theme-asymmetric for legibility: light uses full-chroma indigo (#4f46e5), dark uses a lighter, desaturated indigo (#8b9bff) so it doesn't vibrate/bleed on dark surfaces. On-accent text flips (#fff on light, dark ink on the luminous dark accent) to keep label contrast on the gradient fill; test text at the LOWEST-contrast stop of any gradient and prefer a solid scrim under text rather than text directly on a gradient.
- Reduced transparency: @media (prefers-reduced-transparency: reduce) drops all backdrop-filter and swaps glass to the opaque --afs-surface-3, and hides the accent glow. A @supports not (backdrop-filter) branch ships an opaque fallback fill (~95%) for unsupported browsers/older Safari. -webkit-backdrop-filter is always paired.
- Forced-colors / Windows High Contrast: transparency is stripped, so the 1px border is the only edge cue — it is always present on glass, and in forced-colors mode glass falls back to Canvas/CanvasText and focus rings use the system Highlight color. Never rely on blur/tint alone for a panel edge.
- Reduced motion: @media (prefers-reduced-motion: reduce) neutralizes shimmer/breathe/shake/spring and the glow transition; every animation (streaming shimmer, skeleton, AI breathing, button press scale, error shake) has a static fallback. Only opacity/transform are animated (never backdrop-filter blur radius, box-shadow spread, or layout properties) to protect INP on the Electron/Mulby renderer with many nodes.
- Performance guardrails that double as accessibility: glass is capped to ~3-4 surfaces per viewport and never nested; backdrop-filter blur stays <=20px; the aurora backdrop is a single static low-opacity layer (no animation); nodes/timeline/data are solid (no per-element blur). Consider exposing a 'reduce effects' toggle that maps to the reduced-transparency code path for low-end machines.
- Icons & emoji: all emoji are replaced with Lucide glyphs (stroke=currentColor, so they recolor with text tokens across themes) routed through one iconMap. Decorative icons carry aria-hidden; icon-only buttons place aria-label on the button (not the svg). Status is never color-only — pair every status hue (success/warning/danger/info, failed-tile, model-incomplete) with an icon and/or text label for color-blind users.
- Dark surfaces use #0a0e16 base (not pure #000) and off-white #e8eaf0 text (not pure #fff) to prevent halation/eye strain over long editing sessions; depth in dark comes from lighter surface steps (panel -> panel-2 -> surface-3), depth in light comes from shadows.
- Native-control replacements (custom select/combobox/switch/slider/segmented/tags) must use headless behavior primitives (Radix/React Aria) for ARIA + keyboard (combobox/listbox roles, aria-activedescendant, roving tabindex, full key support) and drive the exact same state/host calls as the native elements they replace — restyle only, never regress semantics.

---

## 8. 实施风险与注意事项

落地时尤其要注意以下点（来自完整性审查 + 各屏诊断），多数是「换皮时容易踩坏功能 / 主题 / 可访问性」的陷阱：

| 优先级 | 风险点（详细应对见下方展开） |
| --- | --- |
| 高 | Inline injected category and port colors cannot be rethemed by the new CSS tokens because they are applied as inline JS styles |
| 高 | Token repoints are value changes not renames dark accent panel two and video category hue all shift |
| 高 | Toolbar and popover text on sixty percent glass fails the fifty five percent body text contrast rule |
| 高 | Concurrency must stay a custom select because its option set is non contiguous one two three four six eight |
| 中 | Studio video provider zero state static swap and the auto first option are not mapped only the missing badge |
| 中 | Mic emoji becomes an icon only if both the asset card and voice card voice selects convert |
| 中 | Boolean toggle ARIA is split between role switch and aria pressed and continuous play is both |
| 中 | On media lightbox controls with no blur vanish over a dark video frame so add a light hairline ring |
| 中 | Large details JSON contract becomes an animated collapsible which is janky and loses find in page reveal |
| 低 | The lightbox scrim token is referenced but not declared repeating the undefined token bug |
| 低 | The field label width token is referenced but not declared |
| 低 | The aurora is authored only in oklch despite the promised sRGB fallback |
| 低 | No explicit instruction deletes the duplicate button chip and spin rules or orphaned toolbar logo and brand rules |
| 低 | Assets and prompts restored views have no specified active rail item so they can show no active nav |
| 低 | Non running node status is conveyed by color and a title tooltip only not an accessible name |

关键陷阱的应对（展开）：

- **内联注入色无法被令牌重着色**：`FilmNode`/节点头/端口/小地图的分类色目前由 JS 内联 `style` 写入。换皮时需改为「写 `data-category`/CSS 变量 `--cat`、由 CSS 着色」，否则亮暗切换与新色阶对它们无效。
- **令牌是「改值」不是「改名」**：`--afs-accent`（#6366f1→亮#4f46e5/暗#8b9bff）、`--afs-panel-2`、视频分类色等都变了值。逐屏回归时要确认依赖旧具体色值的地方不破。
- **60% 玻璃上不能放正文**：工具栏 / 下拉等薄玻璃（~60% 填充）只承载 chrome；任何正文必须落在 `--afs-glass-fill-strong`（≥80/86%）或叠 `--afs-scrim` 之上，保证 ≥4.5:1。
- **并发上限必须保留为自定义下拉**：选项是非连续集合（1/2/3/4/6/8），不能改成 Slider。
- **布尔切换的 ARIA 要分清**：`role=switch + aria-checked` 用于设置开关；工具栏「运行↔停止」「连看」等 toggle 用 `aria-pressed`；连看这类「既是开关又是动作」的，按其语义二选一并保持一致。
- **未声明令牌要补齐**：审查发现灯箱 scrim、字段标签列宽等仍存在「引用却未声明」的令牌，需在底座中补上（否则重演 `--afs-text-dim` 破亮色的 bug）。
- **aurora 需补 sRGB 回退**：极光背景目前只写了 OKLCH，需补 sRGB fallback 以兼容旧引擎。
- **清理重复/孤儿样式**：删除 `.afs-btn`/chip/spin 的重复定义与已废弃的 toolbar logo/brand 规则。
- **素材 / 提示词视图的激活态**：这两个被路由保留的视图当前没有对应的导航激活项，重构导航时要给出明确归属，避免「无激活项」。

---

## 9. 实施路线图（分阶段落地）

建议按「底座 → 组件 → 高频屏 → 画布/节点 → 打磨」推进，每阶段都保持功能 1:1、可独立验收：

**阶段 0 · 令牌底座（不动业务）**
- 把第 4 节的 CSS 变量底座替换进 `styles.css`，保留旧令牌名重指向；落地 `.afs-glass` / `.afs-glow` 工具类与全部可访问性降级（`@supports`/`prefers-reduced-*`/`forced-colors`）。
- 把节点 / 端口 / 分类色从内联 `style` 迁移到 `data-*` + CSS 变量驱动。
- 验收：亮暗切换全局生效，旧界面不破（视觉先「不变难看」，颜色随令牌平移）。

**阶段 1 · 组件库（headless + 换皮）**
- 优先实现覆盖面最大的 10 个：Button / IconButton / Text Input / Textarea / Custom Select / Combobox / Switch / Segmented / Tabs / Field wrapper —— 即可吃掉约 80% 的原生控件。
- 用 Radix / React Aria 提供 ARIA 与键盘；每个组件 1:1 透传原 `value/onChange` 与宿主调用。
- 统一 `.afs-btn` 的两套冲突定义为单一组件；建立 `iconMap` 收敛全部 emoji。

**阶段 2 · 高频原生控件屏**
- 按重灾区顺序替换：Studio（StudioEditor 12 selects/13 inputs/9 emoji）→ 设置（ProviderSettings 14 inputs + GlobalSettings 5 selects）→ Inspector → Toolbar。
- 逐屏对照第 6 节「组件映射表」与「必须保持的行为」清单验收。

**阶段 3 · 画布与节点视觉**
- 节点头改低饱和渐变 + 状态点配图标；运行态用玻璃 + 辉光 + 进度/微光；灯箱与结果查看器 chrome 全部令牌化（去掉白底硬编码、媒体上控件加描边环）。
- 注意保持 React Flow 句柄 id/type/position、灯箱索引计算、扇出网格等逻辑不变。

**阶段 4 · 打磨与回归**
- 微交互 / 动效 / skeleton-shimmer / 空状态；区分「处理中（breathe）」与「生成中（shimmer + 确定性进度）」两种 AI 态。
- 全量亮 / 暗 + 可访问性回归（对比度、焦点环、reduced-transparency/motion、forced-colors）；可加「降低特效」开关映射到 reduced-transparency 路径，照顾低端机。

---

## 10. 参考来源（业界优秀设计）

本方案的研究取材（实时联网检索），按主题归类：

**AI-native gradient + glassmorphism design systems (2024-2026)**
- [Linear - A Linear spin on Liquid Glass](https://linear.app/now/linear-liquid-glass) —— Gold-standard, restraint-first glass for a DENSE professional tool (closest analog to a film/video workbench). Documents the layered build (Gaussian blur base + structural gradient + specular highlight shader + moving light source), why they REJECTED refraction for legibility, and edge-variable-blur. The 'ProKit philosophy' is the right north star for not-gimmicky.
- [Linear - How we redesigned the Linear UI (theming)](https://linear.app/now/how-we-redesigned-the-linear-ui) —— Blueprint for shipping light+dark from minimal tokens: just 3 variables (base/accent/contrast) in LCH, an elevation surface-ladder, and auto-generated high-contrast accessibility themes. Exactly the architecture to adopt before adding any glass/gradient.
- [Evil Martians - OKLCH in CSS: why we quit RGB and HSL](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl) —— Concrete oklch() token system: derive hover/active and light/dark by nudging L/C only, relative-color syntax oklch(from var(--x) calc(l + .1) c h), guaranteed-contrast accents, and gradient interpolation without gray dead zones. The implementation backbone for the whole palette.
- [CSS-Tricks - Grainy Gradients](https://css-tricks.com/grainy-gradients/) —— Canonical, copy-pasteable SVG feTurbulence recipe (fractalNoise, baseFrequency, numOctaves 3, stitchTiles) for resolution-independent noise that both fixes banding and adds the premium grain texture over gradients/mesh.
- [Smarative - Realistic Frosted Glassmorphism in CSS With Gradient Borders](https://smarative.com/blog/realistic-frosted-glassmorphism-css-gradient-borders) —— Provides the exact padding + double-mask + mask-composite:exclude gradient-border technique plus a frosted noise layer, with literal CSS values. Directly implements the 'specular lit edge' pattern.
- [Superdesign - Glassmorphism: CSS Recipe, Generator, When Not to Use](https://www.superdesign.dev/styles/glassmorphism) —— Gives explicit LIGHT and DARK token sets (rgba(255,255,255,0.12) vs rgba(17,25,40,0.55)), blur 12px / saturate 160%, the @supports opaque fallback pair, and a clear 'when not to use' list (text over uncontrolled backdrops, data-dense screens, flat backgrounds, low-end devices).
- [Axess Lab - Glassmorphism Meets Accessibility](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/) —— Accessibility guardrails: prefers-reduced-transparency / prefers-contrast handling, worst-case 4.5:1 contrast against scrolling backgrounds, keeping the 1px border for edge definition. Required reading for a shipping product with both themes.
- [LearnUI Design - Mesh Gradients: A UI Technique Deep Dive](https://www.learnui.design/blog/mesh-gradients.html) —— Strategy for using mesh gradients without it feeling gimmicky: as confined brand backdrop (Stripe top-third, Vercel single-mesh decorative system), per-product sub-meshes, and attention direction -- the 'where/when' guidance that complements the CSS how.
- [Vercel Geist - Material / design system](https://vercel.com/geist/material) —— Reference for a restrained, premium AI-company surface/material system (translucent surfaces, hairline borders, subtle elevation) that proves the aesthetic works for a serious developer/pro tool rather than a marketing splash.
- [LambdaTest/TestMu - CSS Gradient Shadows](https://www.testmuai.com/blog/css-gradient-shadows/) —— Exact blurred-::after gradient-glow technique (inset:-Npx, filter:blur(20-40px), z-index:-1, opacity-on-hover) for the accent/AI-action glow, with sample CSS -- the performant alternative to giant box-shadows.

**Light/dark theming architecture for glass (glassmorphism) UIs, with WCAG/APCA accessibilit**
- [Material Design — Dark theme (m2.material.io)](https://m2.material.io/design/color/dark-theme.html) —— Canonical source for the dark-mode elevation-overlay strategy (lightness instead of shadow), the #121212 base surface, the dp->white-overlay opacity ladder (1dp=5% … 24dp=16%), on-surface emphasis opacities (87/60/38%), and desaturated-primary (200-tone) guidance. Directly drives the dark-theme half of the token system.
- [Apple HIG — Materials + Liquid Glass (WWDC25)](https://developer.apple.com/design/human-interface-guidelines/materials) —— Production reference for adaptive glass that auto-switches light/dark, locally darkens the material behind text to hold contrast, and responds to Reduce Transparency / Increase Contrast. Validates the 'adapt the material, not just the text' principle and the named material-thickness ladder. See also the 2025 newsroom post: https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/
- [Superdesign — Glassmorphism CSS recipe & when not to use it](https://www.superdesign.dev/styles/glassmorphism) —— Gives the exact dual-theme CSS values used here (light rgba(255,255,255,0.12) / dark rgba(17,25,40,0.55)), the @supports-not fallback fills (.85/.92), the prefers-reduced-transparency rule, the forced-colors 'border is the only edge' note, and the '>=55% fill for body text' contrast rule. Most implementation-ready single source.
- [Axess Lab — Glassmorphism meets accessibility](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/) —— Accessibility authority: 4.5:1 body / 3:1 UI, measure against darkest+lightest backdrop, use scrims/semi-opaque fills behind text, cap blur below 20px, honor prefers-reduced-transparency and prefers-reduced-motion, and test with SR + high-contrast + zoom + low-power devices.
- [Chrome for Developers — CSS prefers-reduced-transparency](https://developer.chrome.com/blog/css-prefers-reduced-transparency) —— Exact media-query syntax, browser support (Chrome/Edge 118+, Firefox behind flag, Safari not yet), and the recommended additive 'no-preference' pattern plus the custom-property opacity-swap fallback (e.g. --opacity .5 -> .95). Defines the reduced-transparency fallback layer.
- [APCA in a Nutshell + 'Do not rely on WCAG 2, try APCA'](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html) —— Explains why WCAG 2.x contrast math breaks for dark mode and translucent/gradient surfaces (overstates contrast on dark pairs) and that you must flatten alpha over the real background before scoring. Justifies using APCA Lc as the contrast check for glass. Companion: https://from.red/blog/do-not-rely-on-wcag2-contrast-calculation-try-apca/
- [shadcn/ui — Theming](https://ui.shadcn.com/docs/theming) —— The token-architecture blueprint: semantic background/foreground PAIRS, identical variable names redeclared under :root and .dark, OKLCH values, and concrete light/dark token examples. This is the base color layer the glass tokens sit on top of.
- [Muzli — Dark Mode Design Systems: patterns, tokens, hierarchy](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/) —— Concrete dark-mode token values: near-black surfaces (#0F0F0F-#161616), 4-step elevation-by-lightness ladder, off-white text (#E0E0E0-#F0F0F0 / #E5E5E5), desaturated-up accent mapping (#0070F3 -> #4A9EFF), and the semantic --color-{role}-{state} naming convention.
- [StudioLimb / Clay — Glassmorphism CSS tutorial & 'doing it right'](https://www.studiolimb.com/guides/glassmorphism-css-tutorial.html) —— Reinforces the light-mode failure mode (light-on-light flattens) and the fixes (stronger borders, higher opacity, more blur, manage busy backdrops), with practical glass-card recipes. Clay companion: https://clay.global/blog/glassmorphism-ui

**Modern accessible replacements for native form controls**
- [Radix Primitives — Select](https://www.radix-ui.com/primitives/docs/components/select) —— Canonical headless Select: exact anatomy (Trigger/Value/Icon/Portal/Content/Viewport/Item/ItemText/ItemIndicator/Group/Label/Separator), the data-state/data-highlighted/data-disabled/data-side attributes you style against, and its ListBox/Select-Only-Combobox ARIA conformance. The model to clone for the glass dropdown.
- [Radix Primitives — Tabs](https://www.radix-ui.com/primitives/docs/components/tabs) —— Roving-tabindex tablist with activationMode (automatic vs manual). Use manual activation for heavy AI panels so arrow-key roving doesn't trigger expensive renders. Provides data-state=active for styling.
- [W3C ARIA APG — Select-Only Combobox example](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/) —— The authoritative keyboard + ARIA spec for an accessible custom select: full key table (Down/Alt+Down/Up/Enter/Space/Home/End/PageUp/PageDown/Esc/typeahead) and required roles (combobox, listbox, option, aria-expanded/controls/activedescendant/selected). Verify your widget against this.
- [W3C ARIA APG — Spinbutton pattern](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) —— Defines the number-stepper contract (aria-valuenow/min/max/valuetext, Arrow/Home/End/PageUp-Down) and explicitly recommends native <input type=number> over custom role=spinbutton — directly informs the stepper pattern.
- [Vercel Geist — Colors](https://vercel.com/geist/colors) —— Source of the intent-encoded 100-1000 scale (100 surface -> 400 border -> 700 solid fill -> 1000 primary text) and exact light+dark hex values used in the recommended tokens. A proven two-theme token architecture.
- [Vercel Geist — Switch](https://vercel.com/geist/switch) —— Reference for the segmented/switch 'active pill' model, fixed item widths to prevent jumping, size variants (small/default/large), and the rule that every control needs a label (geist-sr-only for icon-only).
- [React Aria (Adobe) — useSwitch / useCheckbox / useSlider](https://react-aria.adobe.com/) —— Behavior hooks with rigorous focus-ring handling (useFocusRing -> isFocusVisible) and concrete geometry (checkbox ~1.143rem, 2px outline, 2px offset). Best source for the keyboard/focus internals if not using Radix.
- [shadcn/ui — Switch / Slider / Tabs / Combobox](https://ui.shadcn.com/docs/components/radix/select) —— Production Tailwind recipes over Radix: real class values (switch h-5 w-9 rounded-full border-2; thumb h-4 w-4 translate; slider thumb h-4 w-4 border bg-background; focus-visible:ring-2 ring-offset-2). Combobox = Popover + Command composition — the multi-select/search blueprint.
- [Linear — How we redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui) —— Demonstrates generating full light+dark themes from 3 inputs (base/accent/contrast) in perceptually-uniform LCH, with a built-in contrast variable for high-contrast accessibility — the token strategy to emulate for shipping two themes cleanly.
- [WCAG 2.2 — SC 2.4.13 Focus Appearance (W3C Understanding)](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html) —— Defines the focus-ring requirements baked into the token layer: >=3:1 contrast vs unfocused, >=2px thickness / minimum perimeter area, and the double-outline (light+dark, >=9:1 between layers) technique for rings over gradients/glass.
- [Superdesign — Glassmorphism CSS recipe & when-not-to-use](https://www.superdesign.dev/styles/glassmorphism) —— Concrete glass values (light rgba(255,255,255,0.12) / dark rgba(17,25,40,0.55); blur(12px) saturate(160%); 1px translucent border; 0 8px 32px shadow), the @supports-not + prefers-reduced-transparency fallbacks, and the explicit 'chrome/overlays only, not data-dense bodies' rule.
- [UX Patterns for Developers — Multi-select Input](https://uxpatterns.dev/patterns/forms/multi-select-input) —— Accessible multi-select/tags blueprint: aria-multiselectable listbox, removable chips with aria-label='Remove {name}', Backspace-removes-last, and the warning against redundant aria-live announcements.

**Node-graph / infinite-canvas editor UI design**
- [ComfyUI Nodes 2.0 (official beta announcement)](https://blog.comfy.org/p/comfyui-node-2-0) —— Most directly comparable product: an AI media node editor's first full visual redesign (Dec 2025). Migrated LiteGraph Canvas -> Vue components, citing 'cleaner, more modern, better visual hierarchy at all zoom levels.' Confirms the industry is moving node rendering to DOM/components (enables real CSS glass/gradient) and shipping it as an opt-in beta — a good rollout model.
- [Apatero — ComfyUI v0.3.76 Nodes 2.0 guide](https://www.apatero.com/blog/comfyui-v0376-nodes-20-beta-complete-guide-2025) —— Independent breakdown of the Nodes 2.0 goals: redesigned node appearance, refined typography for all zoom levels, improved connection-clarity, stronger visual hierarchy. Validates the priorities (legibility at zoom, clearer wires) for a film/video node tool.
- [React Flow — Theming (CSS variables)](https://reactflow.dev/learn/customization/theming) —— Concrete, copy-paste token names if the plugin uses React Flow (the standard React node-canvas lib): --xy-node-*, --xy-edge-*, --xy-handle-*, --xy-background-pattern-dots-color (#91919a), minimap/controls vars. Gives real default values to override per theme.
- [React Flow — Custom Nodes & Handles](https://reactflow.dev/learn/customization/handles) —— Defines the node-card-as-React-component model and how to style handles (hide built-in bg/border, set size, pointer-events:none on children) — exactly how to build the type-colored ports and 4-region card.
- [React Flow — Turbo Flow & Animated SVG Edge examples](https://reactflow.dev/examples/styling/turbo-flow) —— Reference implementation of the premium look: nodes with glowing animated gradient borders and animated SVG edges — the exact gradient/glow aesthetic requested, with the caveat to use it sparingly.
- [Change React Flow edge color to gradient (raivaibhav, Medium)](https://raivaibhav.medium.com/change-react-flow-edge-color-to-gradient-bc303c6845b9) —— Shows the SVG <linearGradient> + stroke:url(#id) technique for source-hue -> target-hue edges, which is how to implement the type-coded gradient wires.
- [NN/g — Glassmorphism: Definition and Best Practices](https://www.nngroup.com/articles/glassmorphism/) —— Authoritative legibility/accessibility guardrails: generous blur over complex backgrounds, verify contrast at worst-case pixel, give users transparency/contrast controls, reserve glass for chrome — the rules that keep this aesthetic from failing WCAG.
- [Superdesign — Glassmorphism CSS recipe & when not to use](https://www.superdesign.dev/styles/glassmorphism) —— Provides the literal light AND dark glass recipes used in the token table (rgba fills, blur+saturate, border, shadow, @supports fallback) plus the explicit 'data-dense / uncontrolled-backdrop / large-surface / reduced-transparency' avoid-list.
- [Dark Glassmorphism: The Aesthetic That Will Define UI in 2026 (Medium)](https://medium.com/@developer_89726/dark-glassmorphism-the-aesthetic-that-will-define-ui-in-2026-93aa4153088f) —— Dark-theme specifics: rgba(17,25,40,.55-.75) fills, blur 10-20px sweet spot, white/10 borders, 0 8px 32px shadow, and the will-change:transform / translateZ(0) layer-promotion perf hints for the dark variant.
- [ibelick — Grid and dot backgrounds with CSS/Tailwind](https://ibelick.com/blog/create-grid-and-dot-backgrounds-with-css-tailwind-css) —— Exact CSS for dot-grid (radial-gradient, 16px size) and the mask-image edge-fade technique used in the Faded Dot-Grid pattern — the cheapest way to get an 'infinite' canvas backdrop.
- [Blender Manual — Node Parts + socket color coding](https://docs.blender.org/manual/en/latest/interface/controls/nodes/parts.html) —— Canonical reference for color-coding ports by data type (value=yellow, vector=green, boolean=blue, image=gray, shader=olive) and the header/sockets/body node anatomy — the convention to adapt to image/video/audio/text/model types.
- [shadcn-ui/ui #327 + Mozilla bug 1718471 (backdrop-filter perf)](https://github.com/shadcn-ui/ui/issues/327) —— Hard evidence that backdrop-filter:blur on many elements causes lag/jank — the technical basis for the 'glass on chrome only, not on nodes' rule and the optional performance-mode toggle.
- [tldraw SDK (infinite canvas)](https://tldraw.dev/) —— Best-in-class infinite-canvas UX reference (used by Google/Shopify/Replit): fully replaceable toolbars/menus, minimap navigator, polished pan/zoom and selection feel — the bar for canvas chrome and floating toolbars.
- [cmdk + Floating UI command palette pattern (LogRocket/cmdk)](https://blog.logrocket.com/react-command-palette-tailwind-css-headless-ui/) —— De-facto 2025 stack for the command palette / node-insertion search: cmdk for fuzzy search + accessibility, Floating UI for positioning, TanStack Virtual for long node lists — what to build the glass command palette on.
- [n8n — Editor UI & Node UI design docs](https://docs.n8n.io/integrations/creating-nodes/plan/node-ui-design/) —— Production automation node-editor with a centralized node UI system (CanvasNode.vue): standardized node styling, gray dotted-grid canvas, hover toolbars, left-to-right data flow — a pragmatic reference for consistent node chrome and canvas conventions.

**Pro video/creative tool layout, density & docking**
- [Runway design system (Open Design / VoltAgent awesome-design-md)](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/runwayml/DESIGN.md) —— Reverse-engineered, concrete token dump for the closest peer product (AI video). Source of verbatim dark surfaces (#000/#030303/#1a1a1a), light palette (#e9ecf2, #c9ccd1, #404040), 8px spacing scale, 4/6/8/16 radius ladder, and the 'zero shadows / invisible chrome' pro philosophy.
- [Runway product changelog (assets, light mode, keyframes)](https://runwayml.com/changelog) —— Primary source showing the actual app patterns to mirror: sortable/filterable asset library (type/media/duration/creator/date/favorite), Light mode added in settings, and first/middle/last keyframe timeline control.
- [Adobe Spectrum — color & dark theme (Premiere Pro Spectrum UI)](https://spectrum.adobe.com/page/color-system/) —— Gold-standard pro-creative design system. Establishes the gray-ramp + background-layer approach (bg layer1=gray-75, layer2=gray-100 on dark) and Premiere's Darkest/Dark/Light + high/low-contrast toggle model — directly informs the multi-theme token strategy.
- [Premiere Pro appearance preferences (Spectrum UI)](https://helpx.adobe.com/premiere-pro/using/drover-7-spectrum-ui.html) —— Real pro-NLE chrome reference: three themes plus a contrast toggle and brightness sliders. Confirms shipping both light and dark (and a high-contrast accessibility mode) is industry-standard, not optional.
- [CapCut desktop interface & layout guide](https://www.capcut.com/help/interface-and-settings) —— Documents the canonical 4-panel dock (media/assets top-left, preview center, properties top-right, timeline bottom) and customizable layouts — the skeleton the redesign should keep and reskin.
- [Material Design 2 — Dark theme (elevation overlays)](https://m2.material.io/design/color/dark-theme.html) —— Authoritative source for dark-mode elevation-by-overlay (0%→16% white per dp), #121212 soft-black base, on-surface emphasis opacities (87/60/38%), and 200-tone desaturated accents — the backbone of the dark theme tokens.
- [Glassmorphism CSS recipe + when-not-to-use (Superdesign)](https://www.superdesign.dev/styles/glassmorphism) —— Provides verbatim light AND dark glass CSS (blur(12px) saturate(160%), light rgba(255,255,255,.12) vs dark rgba(17,25,40,.55), 16px radius, 0 8px 32px shadow), @supports fallback, and an explicit 'don't use on data-dense/flat/low-end' pitfall list.
- [12 Glassmorphism UI features & best practices (UX Pilot)](https://uxpilot.ai/blogs/glassmorphism-ui) —— Concrete blur ranges (4-6 subtle / 5-15 balanced / 20+ only if perf allows), 20-30% panel opacity, WCAG 4.5:1 / 3:1 requirements, and the key constraint that animating backdrop-filter and stacking blurs is expensive — the perf guardrails for an Electron plugin.
- [Inclusive Dark Mode — Designing Accessible Dark Themes (Smashing, 2025)](https://www.smashingmagazine.com/2025/04/inclusive-dark-mode-designing-accessible-dark-themes/) —— Recent, reputable. Backs #121212-over-#000, >4.5:1 interactive contrast, avoid over-saturated colors on dark, and gradient-legibility caution (test the lowest-contrast region).
- [Dark mode UI best practices (LogRocket) + Dark mode design considerations (FiveJars)](https://blog.logrocket.com/ux-design/dark-mode-ui-design-best-practices-and-examples/) —— Explain why saturated accents 'vibrate/bleed' on dark and prescribe desaturation while keeping brand identity — directly drives the theme-flipped, desaturated gradient/accent token values.
- [React Video Editor — Timeline component docs](https://www.reactvideoeditor.com/docs/core/components/timeline) —— Implementation-ready timeline pattern inventory: unlimited multi-type tracks, magnetic snapping (clip/playhead/bounds), zoom, marquee multiselect, split with visual feedback, alignment guides, and CSS-custom-property theming — a buildable spec for the bottom dock.
- [Building a timeline-based video editor (Remotion)](https://www.remotion.dev/docs/building-a-timeline) —— Concrete guidance on track structure, playhead, ruler, and zoom math for a web/React timeline — relevant since the plugin is a renderer-layer React app.

**Iconography systems + microinteractions + motion for AI products (AI-native gradient + gla**
- [Lucide — Comparison & Stroke-width / Sizing guides](https://lucide.dev/guide/comparison) —— Recommended base icon set: 1000+ icons, ISC license, default 24px/2px/currentColor, React `size` + `absoluteStrokeWidth` props (formula (strokeWidth*24)/size), shadcn/ui standard. Direct basis for the emoji-replacement icon system.
- [AWS Cloudscape — Generative AI loading states](https://cloudscape.design/patterns/genai/genai-loading-states/) —— Production design-system pattern specifically for AI: two-stage processing vs generating model, streaming for text / loading bar for tables-code-media, '[Generating] [artifact]' copy, and the 'never show loading <1s' rule.
- [Vercel open-agents — web-animation-design SKILL](https://github.com/vercel-labs/open-agents/blob/main/.agents/skills/web-animation-design/SKILL.md) —— Gives the exact duration bands (100-150 / 150-250 / 200-300ms, 300ms cap, exits 20% faster), the full ease-out/ease-in-out cubic-bezier table, scale(0.97) press, scale(0.95) entrance, transform/opacity-only, and prefers-reduced-motion rules used throughout the recommendations.
- [animations.dev — The Easing Blueprint (Emil Kowalski)](https://animations.dev/learn/animation-theory/the-easing-blueprint) —— Authoritative rationale for ease-out (user-initiated enter/exit), ease-in-out (on-screen movement), avoid ease-in, linear only for loops — the easing decision rules behind the token table.
- [Material Design 3 — Easing and duration tokens](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs) —— Cross-check for duration ladder (short 50-200, medium 250-400, long 450-600, extra-long 700-1000ms) and standard/emphasized cubic-beziers (standard 0.2,0,0,1; emphasized-decelerate 0.05,0.7,0.1,1) — a second reputable source corroborating the Vercel values.
- [Vercel AI SDK Elements — Shimmer component](https://elements.ai-sdk.dev/components/shimmer) —— Real AI-product component defining the streaming-text shimmer: CSS gradient + background-clip:text transparent text, infinite linear easing, default 2s duration — the canonical AI streaming affordance.
- [Kevin Hufnagl — Vercel text gradient teardown](https://kevinhufnagl.com/verceltext-gradient/) —— Concrete working CSS for the Vercel-style animated gradient text (background-clip:text, linear-gradient stops, keyframes) used as the implementation basis for the shimmer-text pattern.
- [designsystems.com — A complete guide to iconography (Figma)](https://www.designsystems.com/iconography-guide/) —— Source for optical-alignment specs: 8px grid -> 16/24/32px, live-area padding = stroke weight, single stroke/radius/end-cap, no stroked icons <10px, single-color-only rule. Basis of the icon consistency standard.
- [Sara Soueidan — Accessible Icon Buttons](https://www.sarasoueidan.com/blog/accessible-icon-buttons/) —— Definitive guidance for the emoji-replacement accessibility contract: aria-hidden on decorative svgs, aria-label on the interactive control (not the svg), keyboard focus correctness.
- [Muzli — Dark Mode Design Systems: Patterns, Tokens, Hierarchy](https://muz.li/blog/dark-mode-design-systems-a-complete-guide-to-patterns-tokens-and-hierarchy/) —— Token strategy for shipping light AND dark themes (CSS custom properties, contrast baked in day one, no-flash head script) that lets icons recolor via currentColor across themes.
- [Medium (MustBeWebCode) — Dark Glassmorphism: the 2026 aesthetic + WebAIM Contrast](https://webaim.org/articles/contrast/) —— Confirms 2025/26 glassmorphism is dark-mode-first (Apple iOS 26 / macOS Tahoe Liquid Glass) and supplies the WCAG non-text 3:1 / text 4.5:1 thresholds that glass panels must still meet against the blurred backdrop.
- [Phosphor Icons](https://phosphoricons.com/) —— Source for the supplementary Fill/Duotone weights used only for stateful icon pairs (active toggles, recording indicators) layered on top of the Lucide base, giving clear active/inactive differentiation.

---

## 附录：本方案的产出方法

本方案由一次多智能体工作流（29 个 agent / 6 阶段）产出：① 9 个阅读 agent 通读全部 UI 源码与 3690 行 CSS，建立现状清单；② 6 个 agent 实时联网调研 AI 原生玻璃/渐变、亮暗主题与可访问性、原生控件替代、节点画布、专业影视工具、图标与动效；③ 综合出设计令牌底座；④ 规格化组件库；⑤ 逐屏重设计；⑥ 完整性审查找缺口。本文档据其结构化产出装配，技术规格原样保留。
