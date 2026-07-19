# manga-core 融合设计：tech-manga / horror-manga 引擎统一

> 分支：`refactor/manga-core`
> 目标：改工作流只动一处；题材只是数据，新题材 = 一个 theme 文件 + 薄壳插件。

## 1. 背景与结论

tech-manga 与 horror-manga 是同一条流水线（配置 → 流式剧本 → 定妆/参考图 → 逐页绘制 → 导出）的两个题材实例，约 80% 代码重复。tech-manga 工程能力更全（持久化、中止纪元、附件缓存、并发池、道具参考图、zip/pdf/长图导出、费用监控）；horror-manga 独有：水印、结局类型、主/副故事模式混合。

**以 tech-manga 为引擎基座**，抽 `packages/manga-core`，horror 的三项能力通用化后搬入核心包。

## 2. 前置事实（已验证）

- `pnpm-workspace.yaml` 已含 `packages/*`，新增包零配置。
- `packages/manga-kit` 已是 manga 系公共层（.ts 源码分发，插件 vite/esbuild 全量内联，无独立构建步骤）——manga-core 沿用同一分发模式。
- `scripts/detect-changed-plugins.js` 已内建支持：`packages/` 变更时，按 `@mulby-plugins/*` 依赖声明精准标记受影响插件，不触发全量重建。
- CI（build.yml）根目录 `pnpm install --no-frozen-lockfile` 后逐插件 `pnpm run build && pnpm run pack`，对 workspace 依赖透明。
- `.inplugin` 产物自包含（dist/main.js + ui/index.html），共享包不出现在运行时。

## 3. 目标结构

```
packages/manga-core/            @mulby-plugins/manga-core, private, workspace:*
├── package.json                exports 指向 ./src/index.ts；peerDeps: react, react-dom
├── src/
│   ├── index.ts                公共出口
│   ├── theme/
│   │   ├── types.ts            MangaTheme 接口（见 §4）
│   │   └── registry.ts         setTheme()/getTheme() 模块级单例
│   ├── engine-types.ts         ComicStyle/StoryMode/ComicResponse/AppConfig/用量等类型
│   ├── services/               mulbyAiService / exportService / persistenceService / pricing / asyncPool
│   ├── hooks/                  useComicWorkflow / useImageQueue / useSessionPersistence / useUsageTracker
│   ├── components/             ConfigPanel / CharacterGenerator / ScriptEditor / PanelCard
│   │                           LogPanel / TokenMonitor / ReaderOverlay / WatermarkControls
│   ├── utils/                  promptBuilder / progressText / watermarkUtils
│   └── MangaApp.tsx            <MangaApp theme={...}/>：四步工作流编排（原 tech-manga App.tsx）

plugins/tech-manga/             薄壳
├── theme.ts                    全部题材数据（systemRole、画风、模式+prompt、角色、strings、uiTheme）
├── index.tsx                   setTheme + render <MangaApp/>
├── manifest.json / package.json / src/main.ts / index.html / 构建配置
└── app.css                     主题 CSS 变量覆写（可选）

plugins/horror-manga/           薄壳，结构同上；删除本地 mulby.d.ts、CastingPanel.tsx
```

## 4. MangaTheme 接口（核心设计）

```ts
interface MangaTheme {
  id: 'tech-manga' | 'horror-manga' | string;

  // —— Prompt 层（原硬编码在 mulbyAiService / constants）——
  systemRole: string;            // 'Professional Tech Manga Director...' | 'Professional Horror Manga Artist...'
  sourceAnalysis: string;        // 素材类型分析段落（tech 的四类素材 / horror 的故事大意）
  languageRules: string;         // '代码、术语保留英文，对白简体中文' | '对白简体中文'
  artStyles: ArtStyleOption[];   // tech 23 种 / horror 14 种大师画风
  storyModes: StoryModeOption[]; // 含各自叙事 prompt 模板（原 STORY_MODE_PROMPTS）
  characterPresets: CharacterPreset[];
  endings?: EndingOption[];      // horror 的 6 种结局，通用化为可选维度
  refineToneHint: string;        // refineText 的题材语气要求

  // —— 文案层（原 strings.ts + 组件内硬编码）——
  strings: UIStrings;            // 全部界面文案（标题、占位符、按钮、阶段名…）

  // —— 视觉层 ——
  ui: UITheme;                   // { fontFamily, accent, colorScheme, ... } → 根节点 CSS 变量

  // —— 能力开关 ——
  features: {
    watermark: boolean;          // horror: true（tech 也可开）
    endings: boolean;            // horror: true
    secondaryStoryMode: boolean; // horror: true（主/副模式混合）
    props: boolean;              // tech: true（道具参考图）
  };
}
```

注入方式：**模块级单例**（`setTheme(theme)` 在插件 index.tsx 启动时调用一次；services 与组件经 `getTheme()` 读取）。主题在单个插件生命周期内不可变，无需 React Context 的订阅机制——保持简单。

Prompt 缓存不受影响：`STATIC_SYSTEM_PROMPT` 改为按当前 theme 惰性构建一次并缓存，单插件内仍是静态前缀。

## 5. horror 三项能力的通用化搬迁

1. **水印**：`utils/watermarkUtils.ts`（Canvas 实现，零依赖）原样入核心包；`features.watermark` 开启时 ConfigPanel 显示水印配置、PanelCard 显示逐页覆盖、导出前统一加水印。
2. **结局类型**：`endings` + `features.endings`；开启时剧本 prompt 注入结局约束、ConfigPanel 显示结局下拉。
3. **主/副故事模式**：`features.secondaryStoryMode`；开启时 ConfigPanel 出现副模式下拉，剧本 prompt 按 horror 现有的"主 70% / 副 30%"规则混合（以 horror 现有实现文案为准）。

## 6. 实施步骤

### Phase 1 — 抽核心包，tech-manga 先迁移（行为不变）
1. 建 `packages/manga-core` 骨架（package.json 仿 manga-kit：源码分发、无构建步骤、react/react-dom peerDeps）。
2. tech-manga 的 engine-types / services / hooks / utils / components / App.tsx 移入核心包，所有题材硬编码点改为 `getTheme()` 读取。
3. tech-manga 侧抽出 `theme.ts`（数据 1:1 平移，含 STORY_MODE_PROMPTS、预设角色、strings、23 画风）。
4. tech-manga `package.json` 加 `@mulby-plugins/manga-core: workspace:*`；App.tsx 删除，index.tsx 改为 setTheme + render。
5. **验收**：tech-manga `pnpm run build` 通过；UI 行为与重构前一致（人工比对关键文案/流程）。

### Phase 2 — horror 特性入核心包
1. watermarkUtils 入 `utils/`，ConfigPanel/PanelCard/导出链路加 `features.watermark` 分支（tech 主题先关闭）。
2. endings、secondaryStoryMode 以 horror-manga 现有 prompt 文案为准通用化（tech 主题关闭）。
3. **验收**：tech-manga 构建通过且行为不变（三个开关全关）。

### Phase 3 — horror-manga 重写为薄壳
1. 写 `plugins/horror-manga/theme.ts`：14 大师画风、9+1 模式、6 结局、恐怖 strings、红黑 uiTheme、Creepster 字体、`features: { watermark: true, endings: true, secondaryStoryMode: true, props: false }`。
2. 删除 horror-manga 的 App.tsx / services / hooks / components / constants.ts / types.ts / strings.ts（能力全部由核心包提供）；删除死代码 `components/CastingPanel.tsx`；清掉 LogPanel "GEMINI-3.0-PRO" 残留。
3. 删除本地 `src/types/mulby.d.ts`，改用 `@mulby-plugins/types`（devDependencies + tsconfig types 声明）——顺带回答：该包本来就面向全部插件，horror 是第二个使用者。
4. **验收**：horror-manga 构建通过；题材体验（文案/配色/字体/水印/结局/主副模式）与原版一致；白得持久化、中止纪元、pdf/长图导出。

### Phase 4 — 收尾
1. manga-kit 的 `configs/tailwind` 模板 content glob 加入 `../../packages/manga-core/src/**/*.{ts,tsx}`，两个插件同步。
2. 两个插件 manifest version 各 bump 一个 minor（核心包变更不会自动 bump 插件版本）。
3. 双插件 `pnpm run build && pnpm run pack` 验证，产出 `.inplugin`。
4. 更新本设计文档的实际偏差；AGENTS.md 如有涉及插件结构的描述一并更新。

## 7. 不变量（任何一步都不得破坏）

- tech-manga 用户可见行为在 Phase 1/2 后完全不变。
- horror-manga 的题材数据（画风描述、模式 prompt、结局、文案、水印默认"单细胞漫画"）1:1 保留。
- 核心包不含任何题材字样（tech/horror 均不出现），题材只能存在于插件 theme.ts。
- 两个插件的 manifest 触发关键词、窗口尺寸不变。

## 8. 实施偏差记录（Phase 1–4 实际落地与设计的差异）

1. **colorMode 成为第四项通用化能力**。设计 §5 只列了 horror 的三项独有能力，遗漏了黑白/彩色模式（SUPREME COLOR RULE 影响剧本与每张图）。落地建模：`theme.colorModes?: ColorModeOption[]`（label/value/promptHint/default），`AppConfig.colorMode?`；SUPREME COLOR RULE 文案随 horror 的 `buildScriptPrompt` 保留，`promptHint` 追加到风格字符串参与角色/页面全部图像 prompt。角色立绘关键词统一取原页面版文案（原实现立绘与页面用词略异）。
2. **新增 `MangaTheme.buildScriptPrompt` 钩子**。horror 的剧本 prompt 与 tech 是两种结构（tech：静态 system 前缀 + 变量 user；horror：变量全在 system 段、user 仅源文本），拆段参数化无法保持逐字一致，故 horror 的 `constructSystemPrompt` + schema 文字版整体以 theme 钩子提供；核心包经 `resolveScriptPrompts` 统一 generateComicScript/estimateScriptTokens 两条路径，中止纪元/JSON 修复/API 级 schema（`theme.jsonSchema` 可覆写）等引擎机制不变。tech 未用钩子，其 system+user 与重构前逐字节一致（有脚本验证）。
3. **持久化恢复后 `rawImageData` 不读回**（已知限制）：页面图像附件只存水印版 `imageData`，恢复会话后修改全局水印不会重绘旧页。horror 原本无持久化，属新组合场景，影响可接受。
4. **日志观感差异**：剧本流式日志为核心包格式（system+user 拼接），不再保留 horror 原实现的 `[MULBY AI]` 前缀与 `USER PROMPT:` 标记；内容一致。
5. **类型与枚举的归属**：`ComicStyle` 枚举随 tech 画风数据移入 tech theme.ts；`StoryMode` 枚举留核心包作引擎值空间（含 HORROR 成员，属 tech 的 11 模式之一），`StoryModeOption.value` 放宽为 string 以容纳 horror 的模式集合；horror 的 HorrorStyle/StoryMode/EndingType/ColorMode 枚举作为题材数据定义在 horror theme.ts。
6. **UI 参数化边界**：tech 配色字体零变化优先——根节点字体/背景/文字、品牌渐变、标题字体（`headingFontFamily`）、selection 色、spinner、生成/导出 CTA 渐变（`ctaFrom/To`、`ctaHoverFrom/To`）走 CSS 变量；资产工作室确认钮等次级按钮与 slate/indigo 中性类保持引擎默认，未全量按题材换色。
7. **无预设角色 = 全自动选角**：`characterPresets` 为空时 ConfigPanel 角色区整段隐藏（horror 原即无角色选择）；tech 的 HISTORY_SERIES 自动选角逻辑保留在核心包 ConfigPanel，未做 features 开关隔离。
8. **UIStrings 扩充**：Phase 2/3 共新增 19 个键（副模式/结局/水印 16 个 + colorModeLabel + studioTabAssets/studioTabScript），两个主题均填满；MangaApp 内恢复条幅、确认对话框等少量新增能力文案仍为硬编码中文（新增能力无原版对照）。
9. **页面 prompt 结构以 tech 引擎为准**：horror 的逐页 prompt（sourceDef/layoutConstraint/inherited state 拼装）未保留，改用 tech 的 promptBuilder（参考图 + context 块 + 尺寸数学一致）；[VISUAL STATE]/否定强调机制经 horror 剧本 prompt 保留，由模型输出承载。
10. **manga-kit tailwind 模板**：默认 content globs 已更新为 `./index.html`、`./index.tsx`、`../../packages/manga-core/src/**/*.{ts,tsx}`（两插件本地 override 内容相同）。
11. **版本与产物**：两插件 manifest version 1.0.0 → 1.1.0；`.inplugin` 已在 .gitignore，pack 验证后产物已删除。
