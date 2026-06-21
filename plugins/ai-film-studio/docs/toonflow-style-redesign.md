# ai-film-studio · Toonflow 式重构设计文档

> 目标：把 ai-film-studio 从「自由连线节点图」演进为 Toonflow 式「**Agent 驱动的结构化短剧流水线 + 工作台**」，在 **Mulby 插件沙箱**内落地。
> 参考实现：[HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app)（Electron + Express + SQLite + Vercel AI SDK + ONNX）。
> 本文档不改代码，只定义目标架构、数据模型、Agent/Skill/供应商体系与分阶段迁移路线，供评审后再开工。

---

## 0. 核心判断

| | 我们现在 | Toonflow | 结论 |
|---|---|---|---|
| 形态 | 自由连线节点图（手动接 AI 节点） | Agent 对话驱动 + 结构化工作台 | **重做交互/数据模型** |
| 运行环境 | Mulby 插件（仅渲染层 + host API） | 独立 Electron + 自带服务端 | 部分能力需换实现 |
| 底层能力 | 供应商/ffmpeg/图像视频引擎/资产库/关键帧一致性 | 同类能力 | **大部分可复用** |

**关键可行性已确认**：Mulby host `ai.text` 支持 `tools` + 流式 + `reasoning`（chunk 类型含 `tool-call`/`tool-result`，model 类型含 `function_calling`）。→ **Toonflow 的三层 Agent 编排可在插件内用 host API 实现，无需引入 Vercel AI SDK 或自带服务端。**

---

## 1. Toonflow 架构拆解（事实）

### 1.1 数据模型（SQLite，关系型）
`项目 o_project`（画风 artStyle / 画幅 videoRatio / 图像模型 / 视频模型 / 视频模式 mode / 导演手册 directorManual）
→ `小说章节 o_novel`（chapterData / event 事件 / eventState）
→ `章节事件图谱 o_event + o_eventChapter`
→ `剧本 o_script`
→ `资产 o_assets`（type: role/scene/tool/clip；衍生资产 derive 自关联 assetsId）+ 关联表 `o_scriptAssets`/`o_assets2Storyboard`
→ `分镜 o_storyboard`（videoDesc / prompt / duration / track / shouldGenerateImage / associateAssetsIds）
→ `视频 o_video + o_videoTrack`（一镜多生、selectVideoId 选优）
横切：`memories`（向量记忆）、`o_skillList`/`o_skillAttribution`（技能库）、`o_vendorConfig`（供应商）、`o_modelPrompt`（按模型的视频提示词）、`o_tasks`（异步任务）、`o_artStyle`、`o_setting`。

### 1.2 三层 Agent（决策 → 执行 → 监督）
- **ScriptAgent**：决策层 `script_agent_decision.md` 调度子 Agent：`storySkeleton`（故事骨架）/`adaptation`（改编策略）/`script`（剧本）+ `supervision`（监督）。各子 Agent 有独立 skill 系统提示词，产物用 XML 标签写回「工作区」(planData: storySkeleton/adaptationStrategy/script)。
- **ProductionAgent**：决策层 `production_agent_decision.md` 调度：`director_plan`（拍摄计划）/`derive_assets`+`generate_assets`（资产）/`storyboard_table`→`storyboard_panel`→`storyboard_gen`（分镜表→面板→生成）+ `supervision`。工具集通过 socket 实时操作前端工作台（FlowData: script/scriptPlan/assets[]/storyboardTable/storyboard[]）。
- **机制**：Vercel AI SDK `streamText` + `tools`，`fullStream` 消费 reasoning/text/tool。子 Agent = 父 Agent 的一个 tool（`run_sub_agent_*`）。

### 1.3 Skill 文件系统（最值得抄）
```
data/skills/
  ├─ script_agent_decision.md, script_execution_{skeleton,adaptation,script}.md, script_agent_supervision.md
  ├─ production_agent_decision.md, production_execution_{director_plan,derive_assets,generate_assets,
  │    storyboard_table,storyboard_panel,storyboard_gen}.md, production_agent_supervision.md
  └─ art_skills/<画风>/                        # 按画风的提示词知识库
       ├─ prefix.md                            # 该画风全局基线：色盘/色温/硬约束/严禁项/情绪→面容映射/光影词库
       ├─ director_skills/{director_planning_style, director_storyboard, director_storyboard_table_style}.md
       └─ art_prompt/{art_character, art_scene, art_prop, art_storyboard_video}(.md + _derivative.md)
```
- `skillsTools`（scanSkills/useSkill/parseFrontmatter）让 Agent 可**按需动态加载** skill（带 frontmatter: name/description/metaData）。
- 模型定义可声明 `associationSkills`，按「画风 + 资产类型」拼接 `prefix + 对应 art/director skill`。

### 1.4 可编程供应商（`data/vendor/*.ts`）
每家一个强类型 TS 模块：`TextModel/ImageModel/VideoModel/TTSModel`，视频模式枚举（`singleImage/startEndRequired/endFrameOptional/startFrameOptional/text/[imageReference:N|videoReference:N|audioReference:N]`）、`durationResolutionMap`、`audio: optional|true|false`、`associationSkills`。设置里可写 TS 热加载。

### 1.5 持久化向量记忆
本地 ONNX `all-MiniLM-L6-v2` 做 embedding，`memories` 表存短期消息 / 长期摘要 / 语义召回（RAG）。Agent 每轮 `memory.get(text)` 注入 [相关记忆/历史摘要/近期对话]。

### 1.6 工作台
画布（资产板 + 分镜面板）+ 时间线/轨道（多镜选优、拖拽排序）+ Agent 对话，三位一体。

---

## 2. 映射到 Mulby 插件：约束与替代实现

| Toonflow | 插件内替代 | 说明 |
|---|---|---|
| Express 服务端 + socket.io | store 内部事件 + 直接函数调用 | 插件是单进程渲染层，Agent 与「工作台」同进程，无需网络 |
| SQLite/knex | **filesystem JSON / kvStore**（必要时 sql.js wasm） | host `filesystem.*` + `kvStore`；关系用 id 引用 |
| Vercel AI SDK tool-calling | **host `ai.text({messages, tools})` 流式** | 已确认支持；自写 Agent runtime（工具循环 + 思考块 + XML 工作区） |
| ONNX 向量记忆 | **轻量记忆**（关键事实+摘要存 JSON，关键词/标题召回）或跳过 | 插件内跑 ONNX 偏重，先简化 |
| 设置里热加载用户 TS 供应商 | **声明式增强**（沿用现 `bodyTemplate` + 强类型 model 定义） | 沙箱不宜 eval 用户 TS |
| 图像/视频/ffmpeg | **直接复用 host 能力**（已有） | 无需改 |

---

## 3. 目标架构（我们的）

### 3.1 分层
```
┌─ UI 工作台（React）：项目 / 剧本 / 资产 / 分镜 / 时间线 + Agent 对话面板
├─ Agent Runtime（host ai.text tool-calling）：决策 / 执行 / 监督 + 工具集
├─ Skill 系统：agent skills + art_skills/<画风> 动态加载拼接
├─ 领域服务（复用现有）：图像引擎 / 视频引擎(providers) / ffmpeg / 资产库 / 关键帧一致性
└─ 持久化：filesystem JSON（project.json / 各实体目录）+ kvStore 索引
```

### 3.2 数据模型（JSON 持久化，TypeScript 接口草案）
```ts
interface Project {
  id: string; name: string; intro?: string; type?: string;
  artStyle: string;            // 画风 id（对应 art_skills/<画风>）
  videoRatio: string;          // 16:9 / 9:16 …
  imageModel: string; videoModel: string; videoMode: VideoMode;
  directorManual?: string;     // 导演手册（全局风格意图）
  createdAt: number; updatedAt: number;
}
interface NovelChapter { id; projectId; index; title; text; event?; eventState }   // 小说导入（可选）
interface EventNode { id; projectId; name; detail; chapterIds: string[] }          // 事件图谱（可选）
interface Script { id; projectId; name; content; createdAt }
interface Asset {                                                                  // 资产
  id; projectId; scriptId?; type: 'role'|'scene'|'prop'|'clip';
  name; prompt?; desc?; refImageId?; parentAssetId?;                               // 衍生资产 = parentAssetId 非空
  variants?: AssetVariant[];                                                       // 复用现有时期/状态变体
  state: 'idle'|'generating'|'done'|'failed';
}
interface Storyboard {                                                             // 分镜面板
  id; projectId; scriptId?; index; track; videoDesc; prompt?; duration;
  associateAssetIds: string[]; shouldGenerateImage: boolean;
  keyframeImageId?; state; chainFromPrev?: boolean;                                // 复用关键帧链式
}
interface Clip { id; projectId; storyboardId; videoFilePath?; durationSec; state } // 视频片段
interface VideoTrack { id; projectId; clipIds: string[]; selectClipId?; ... }      // 时间线轨道
interface MemoryItem { id; isolationKey; role; content; type; createTime; summarized? }
```
> 现有 `assetStore`/`graphStore` 的资产、变体、关键帧 meta 可平移到 Asset/Storyboard。

### 3.3 Agent Runtime（host tool-calling）
- `runAgent({systemSkill, messages, tools})` 封装 `window.mulby.ai.text(...).stream({messages, tools})`，消费 `tool-call`/`tool-result`/`reasoning`/`text` chunk，渲染「思考块 + 流式正文」到对话面板。
- **三层**：决策 Agent 把「执行子 Agent」「监督 Agent」「记忆工具」「Skill 工具」「领域工具」都作为 tools 暴露；子 Agent 各自加载对应 skill。
- **工具集（对照 Toonflow，改为同进程函数调用）**：
  - 数据读取：`get_workspace(key)`、`get_novel_events`、`get_script`、`get_assets`、`get_storyboards`
  - 剧本：`write_skeleton`/`write_adaptation`/`write_script`（XML 工作区）
  - 资产：`add_asset`/`add_derive_asset`/`del_asset`/`generate_asset`（→ 现图像引擎）
  - 分镜：`write_storyboard_table`/`add_storyboard_panel`/`generate_storyboard`（→ 关键帧引擎）/`generate_clip`（→ 视频引擎）
  - 时间线：`arrange_track`/`select_clip`/`compose_film`（→ ffmpeg）
  - 记忆：`memory_add`/`memory_search`
- **产物回写**：工具直接改 store（持久化 JSON）并触发 UI 刷新（取代 socket.emit）。

### 3.4 Skill 目录（放插件内，可在「提示词库」编辑）
```
src/ui/skills/                      # 打包进插件；用户覆盖存 kvStore/filesystem
  agent/  script_*.md  production_*.md
  art_skills/<画风>/  prefix.md  director_skills/*.md  art_prompt/*(.md|_derivative.md)
```
- 加载器：`loadSkill(style, kind)` = `prefix + director/art 对应技能`，按 frontmatter 选取；支持用户覆盖。
- 迁移现有：`promptTemplates.ts` + `stylePacks.ts` → 拆成 art_skills（至少先做 1-2 个画风：写实/国风/日漫）。

### 3.5 供应商增强（在现 providers 基础上）
- 给 model 增加强类型定义：`type: text|image|video|tts`、视频 `mode: VideoMode[]`、`durationResolutionMap`、`audio`、`associationSkills`。
- 复用现 `bodyTemplate` + `{seed}`/`{lastImageUrl}` 等占位（已支持），把 Toonflow 的视频模式（singleImage/startEnd/imageReference…）映射到我们的 req 字段。

### 3.6 工作台 UI
- 顶层切换：**项目 → 剧本 → 资产 → 分镜 → 时间线**（分阶段 Tab），右侧常驻 **Agent 对话面板**。
- 画布从「自由连线」改为「结构化板」：资产卡片网格、分镜面板时间序、时间线轨道。保留节点图作为「高级编辑」入口（可选）。

### 3.7 小说导入 + 事件图谱（可选高阶）
导入长文 → 分章 → 逐章事件抽取（LLM）→ 事件图谱 → 改编剧本时按事件检索上下文（解决长文丢信息）。

---

## 4. 现有能力复用清单（不重做）
- ✅ 供应商框架 `providers/*`（fal/custom-http/异步轮询/seed/首尾帧）
- ✅ 图像引擎 `imageEngine`（generate/edit/多参考图）、视频 `runVideo`
- ✅ ffmpeg 合成 `ffmpeg.ts`（拼接/字幕/转场/抽帧 extractLastFrame）
- ✅ 资产库 `assetStore`（角色/场景/物品 + 变体）
- ✅ 一致性能力：关键帧链式生成、按名/charId/变体取参考图、片段尾帧接龙、seed 锁定
- ✅ 提示词分层 / 全局画风画幅注入（迁入 Skill 系统）

---

## 5. 分阶段迁移路线（每阶段独立可用、可验收）

| 阶段 | 内容 | 产物 | 验收 |
|---|---|---|---|
| **1. Skill 提示词系统 + 供应商 model 定义** | art_skills/<画风> 目录 + 加载器；现有模板迁入；provider model 强类型 | 在**现有节点图**上即生效 | 同画风跨镜一致性/画质明显提升；可在提示词库编辑 skill |
| **2. 结构化数据模型 + 工作台骨架** | Project/Script/Asset/Storyboard/Clip JSON 持久化；分阶段 Tab UI（与节点图并存） | 新「项目」工作台 | 能建项目、写剧本、加资产/分镜、生成、落盘 |
| **3. 三层 Agent 编排** | Agent runtime（host tool-calling）+ 工具集 + agent skills + 对话面板 | 「跟 Agent 对话出片」 | 一句话 → Agent 自动拆剧本/资产/分镜/生成 |
| **4. 高阶能力** | 小说导入+事件图谱、时间线/轨道选优剪辑、轻量记忆 | 完整短剧工作台 | 长文改编不丢信息；可视化剪辑；跨会话记忆 |

> 建议先做**阶段 1**：性价比最高、零破坏、直接改善你最在意的一致性/画质，且为后续 Agent 提供 skill 基座。

---

## 6. 风险与待决策点
- **是否保留节点图**：建议阶段 2 起「结构化工作台」为主，节点图降级为高级入口（不删，降权）。
- **持久化选型**：JSON 文件（简单、够用）vs sql.js（关系查询强、重）。建议先 JSON。
- **记忆**：阶段 4 才做，先用轻量（摘要+关键词召回），ONNX 视宿主能力再议。
- **Skill 体量**：Toonflow 每画风 skill 很厚（色盘/光影/情绪映射）。我们先做 1-2 个画风打样，验证质量提升再扩。
- **工作量**：阶段 1≈小，阶段 2-3≈大（数月级），阶段 4≈大。不建议一次性全量重写。

---

## 7. 实施进度（构建顺序 · 全量重构 loop 跟踪）

> 全量重构进行中（不考虑老数据兼容）。每个 loop 迭代产出一个**可编译、可验收**的增量。

- [x] **1a Skill 系统**：`services/skillSystem.ts`（import.meta.glob 打包 .md + frontmatter 解析 + composeArtPrompt/composeDirectorPrompt/getAgentSkill）；`skills/art_skills/cinematic_realistic/` 完整包（prefix + director_storyboard + art_{character,scene,prop,storyboard_video}）；`skills/art_skills/2d_anime/prefix.md`；`skills/agent/{script,production}_agent_decision.md` 占位。`vite-env.d.ts` 加 vite/client 类型。tsc+build 通过。
- [x] **1b Skill 接入生成**：`skillStylePacks()` 从画风 prefix.md frontmatter（anchor/anchorXxx/videoTag/negative）桥接成 `StylePack`；`stylePacks.listStylePacks()` = 画风 Skill 包(优先) + 内置(兜底)，`getStylePack` 查两者；GlobalSettings 改用 `listStylePacks()`。画风 Skill 即刻经现有 resolveStyle 注入生成；完整 skill 正文留给阶段3 Agent。tsc+build 通过。
- [ ] **1c 供应商强类型 model 定义**（可后置/并入阶段3 视频生成时做）：type/mode(视频模式)/durationResolutionMap/associationSkills。
- [x] **2 数据模型 + 持久化**：`domain/types.ts`（ProjectDoc: meta/novel/events/scripts/assets/storyboards/clips/track/memory）；`domain/persistence.ts`（host storage KV，命名空间 `studio:*`：index/project:<id>/current；loadIndex/loadProject/saveProject/deleteProject/emptyProjectDoc）。独立命名空间，不碰老节点图数据。tsc+build 通过。
- [x] **2b projectStore**：zustand `store/projectStore.ts`（cards/doc/init/create/open/delete/flush + 防抖落盘 mutate；实体增删改 upsertScript/Asset/Storyboard/Clip + reorder）。tsc+build 通过。
- [x] **2c 工作台 UI 骨架**：新增 `studio/`（StudioApp/StudioHome/StudioEditor）；AppRail 加「工作台」一级入口并设为默认视图（节点图仍在「画布」）；项目主页（卡片+新建/删除）+ 编辑器顶栏（名称/画风/画幅）+ 阶段 Tab（剧本/资产/分镜可编辑落盘，时间线占位）+ Agent 面板占位；styles.css 加工作台样式。tsc+build 通过。
- [x] **2d 生成接入工作台（图像）**：`studio/services/generate.ts`（generateAssetImage 文生图+画风锚定；generateKeyframeImage：出场资产参考图 img2img 一致性，否则文生图）；projectStore 加 generateAsset/generateKeyframe（state/error 回写）；资产卡/分镜项加「生成」按钮 + 缩略图 + loading/失败态。tsc+build 通过。
- [x] **2e 分镜→视频片段**：`generateClipVideo`（关键帧→runVideo 图生视频 + 画风视频标签 + 下载落盘）；projectStore.generateClip（建 Clip + 同步时间线 track）；分镜项加「视频」按钮；时间线 Tab 列片段视频预览。tsc+build 通过。（compose/导出 + 多镜选优待后续）
- [ ] **2f compose 导出**：时间线 → ffmpeg composeFilm（复用现有）导出成片。
- [x] **3a Agent（结构化方案版）**：`studio/agent/agent.ts`（runAgentPlan：host runText json 模式，注入 production_agent_decision skill + 项目画风/上下文 → JSON 方案 reply/script/assets/storyboards）；projectStore.runAgent（应用方案：覆盖剧本 + 去重资产 + 追加分镜，cast 名→资产 id；对话存 memory）；工作台右侧对话面板接通（消息流 + 输入 + 思考态）。一句话/故事 → 自动拆剧本+资产+分镜。tsc+build 通过。
- [x] **3b 批量「一键生成」**：projectStore.batch + generateAllAssets/generateAllKeyframes/generateAllClips（顺序执行、跳过已完成、batch.label 进度）；资产/分镜 Tab 加批量按钮（全部生成/全部关键帧/全部视频）+ 顶栏批量进度。tsc+build 通过。
- [x] **3c 一键成片 + Agent 触发生成**：projectStore.autoProduce（资产→关键帧→视频→合成 一条龙，子步骤自管标志、守卫防重入）；顶栏「一键成片」按钮 + busy 进度；Agent 方案加 autoGenerate（用户要求出图/成片时 true → runAgent 应用后台触发 autoProduce）。tsc+build 通过。
- [x] **3d 工作台连贯性（关键帧）**：generateKeyframeImage 加 chainBase——承接镜头(chainFromPrev)由上一镜关键帧 img2img 派生 + 连贯指令；generateKeyframe 按 index 取上一镜关键帧 base64；generateAllKeyframes 按 index 顺序生成；Agent 方案标注 chainFromPrev；分镜项加手动「承接」切换。tsc+build 通过。
- [x] **3d-2 片段顺接**：generateClipVideo 加 firstFrameUrl——承接片段用「上一片段真实尾帧」作首帧（clipLastFrameDataUrl 复用 extractLastFrame，best-effort）；generateClip 按 index 取上一片段尾帧；generateAllClips 按 index 顺序。**连贯性全链路：关键帧链式 + 片段尾帧接龙**。tsc+build 通过。

> **核心重构已完成**（阶段 1-3 + 全链路连贯性）：对话→剧本/资产/分镜→出图→出视频→合成导出，跨镜一致。以下为进阶可选。
- [ ] **3e 分阶段子 Agent**：编剧/分镜/制片分工 + 监督（可选升级原生流式 tool-calling）。
- [x] **2f compose 导出**：`studio/services/compose.ts`（按分镜顺序取选用片段，无本地路径则下载→ensureFfmpeg→composeFilm 整片淡入淡出→导出 exports/）；projectStore.compose + film 瞬态（composing/done/failed + 进度）；时间线 Tab 加「合成成片」按钮 + 进度 + 成片预览。**全链路打通：对话→剧本/资产/分镜→出图→出视频→合成成片→导出**。tsc+build 通过。
- [ ] **3 Agent runtime**：host ai.text tool-calling 封装 + 三层编排 + 工具集（剧本/资产/分镜/时间线/记忆）+ agent skills 全量。
- [x] **4a Agent 质量**：runAgentPlan 注入近期对话（最多6条 user/assistant，记住上下文如「再加3镜」）+ 导演手册；StudioEditor AgentPanel 加可折叠 🎬 导演手册编辑（updateMeta directorManual）。tsc+build 通过。
- [x] **4b 小说导入 + 改编**：`studio/services/novel.ts`（splitNovelChapters 按 第N章/回/卷 或长度分段）；projectStore.importNovel/clearNovel；原著 Tab（粘贴→分章→章节列表）；agent 上下文注入原著（capped 8000 字），可「按原著改编」。tsc+build 通过。
- [x] **4c 章节事件提取**：novel.ts extractEvents（LLM 把每章压成关键事件要点）；projectStore.extractChapterEvents/extractAllEvents（单章+批量）；原著 Tab 显示事件 + 提取按钮；agent 上下文优先用事件（省 token、长篇装得下）。tsc+build 通过。
- [x] **4d UX 模型设置**：工作台顶栏「模型」弹层——文本/图像模型选择器（复用 graphStore.selectedModel/Image）+ 视频供应商状态 + 未配齐 ⚠ 提示。修复「工作台无模型选择器、需去画布配」的 UX gap。tsc+build 通过。
- [x] **4e 分镜排序**：projectStore.moveStoryboard（上下移 + 重排 index）；分镜项加 ↑/↓ 按钮，列表按 index 渲染。承接连贯随新顺序。tsc+build 通过。
- [x] **4f 成片打开/另存**：FilmDone——「打开所在文件夹」(shell.showItemInFolder) +「另存为…」(dialog.showSaveDialog → filesystem 读写复制)。tsc+build 通过。
- [ ] **4g 进阶（剩余可选）**：时间线多镜选优剪辑、持久向量记忆、分阶段子 Agent、供应商强类型 model 定义。

- [x] **自检/加固（多 Agent 评审）**：对新 studio 代码跑 16-agent 评审（state/async、services、react/ui、persistence 四维 + 对抗复核），修 6 个确认 bug：① novel 章节正则 `\b` 致中文标题全不匹配（高）② generateClip 每次新建片段→重试堆积孤儿片段（高）③ StoryboardItem 取到最旧片段→状态显示错（高，随②修复）④ parsePlan 空/非JSON 抛裸 SyntaxError→改纯文本兜底 ⑤ ScriptTab 选中不回退→Agent 新建剧本不显示 ⑥ composeArtPrompt 路径缺 art_ 前缀（潜在）。tsc+build 通过 + 正则实测。

- [x] **二次评审加固（10-agent）**：四维全量复审 + 复核首轮修复未回归，修 3 个新确认 bug：① createProject/deleteProject 未先 flush→切项目丢未存编辑+stale timer 存错（高，数据丢失）② removeStoryboard 不重排 index→index 撞号致排序/承接取错相邻镜（中）③ autoProduce await 后裸 deref `get().doc!`→生成中关/删项目崩溃（低）。tsc+build 通过。

> **状态**：Toonflow 式核心重构 + 长文改编 + 工作台 UX（模型设置/排序/成片打开另存）+ **两轮多 Agent 评审加固（共修 9 个确认 bug）** 已完成，全链路可用。剩余为锦上添花，**强烈建议在 Mulby 实测后再决定是否继续**。

---

## 附：参考源码位置（本机克隆）
`/tmp/toonflow`（如已清理可重新 `git clone --depth 1 https://github.com/HBAI-Ltd/Toonflow-app`）
- 数据模型：`src/types/database.d.ts`
- Agent：`src/agents/{scriptAgent,productionAgent}/{index,tools}.ts`
- Skill：`data/skills/`（agent + art_skills/<画风>）
- 供应商：`data/vendor/*.ts`
- 视频模式提示词：`data/modelPrompt/video/*.md`
