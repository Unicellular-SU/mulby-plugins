# ai-film-studio · 对标 Toonflow 的工作台功能/细节补全设计

> 衔接文档：[`toonflow-style-redesign.md`](./toonflow-style-redesign.md)（已完成阶段 1-3 + 全链路连贯性 + 两轮评审加固）。
> 本文档不重复前文已建成的部分，只**穷尽补全工作台相对 Toonflow 仍缺失的功能与细节**，三大重点块为【资产 / 分镜 / 时间线】，并把现有【画布 / 素材库 / 提示词库 / 供应商设置】**融入工作台**（勿重造轮子）。
> 术语沿用前文：ProjectDoc / studio:* 命名空间 / 三层 Agent / art_skills / 画风锚定 / 关键帧链式 / 片段尾帧接龙。
> 落地总原则（Mulby 沙箱）：**无 socket → 同进程 zustand action + onProgress 回调**；**无 SQLite → ProjectDoc JSON KV + 独立 KV store**；**无 Vercel AI SDK → host `ai.call/ai.text` 手动 tool-loop**；**无 ONNX → LLM 摘要 + 关键词召回**；skills 走 `import.meta.glob` 构建期内联。

---

## 1. 摘要与目标差距全景

现状判断：工作台的 **剧本 / 原著 / 资产 / 分镜中段链路** 已 `full`，**时间线为只读顺序展示（partial）**，**衍生/音频/多 take/imageFlow/真 tool-loop/记忆/任务队列/设置面全缺或 stub**。底层可复用面极厚（imageEngine/providers/ffmpeg/tts/assetStore/assetRegistry/skillSystem/promptStore/providerStore/graphStore.mapPool 均现成），**主要工作是补数据结构 + 服务函数 + UI 交互 + 把已就绪能力接上**，几乎不需重造底层。

### 1.1 总差距表（Toonflow 有 / 我们现状 / 结论）

| 域 | 能力点 | Toonflow 有 | 我们现状 | 结论/优先级 |
|---|---|---|---|---|
| **资产** | 衍生资产（换装/场景变体/物品状态） | o_assets 自关联 + `*_derivative` 视觉手册 + 父图 img2img | `parentAssetId`/`variants` 字段定义但全未消费(stub)；**`*_derivative.md` 全库不存在，derivative 分支静默回退基础手册** | **补：编写衍生手册 + 消费现有字段 + img2img** `P0` |
| 资产 | AI 提示词润色（视觉手册驱动两段式） | polishAssetsPrompt(art_*手册→LLM→英文prompt) | 直接拼锚定词出图，`composeArtPrompt` 手册未被消费；**仅 cinematic_realistic 有 art_prompt 手册，2d_anime 等只有 prefix** | **补：润色步骤 + 状态 + 补全各画风手册** `P0` |
| 资产 | 一资产多图（历史候选）+ 选定当前图 | o_image 多图 + imageId 选图 + 上传自定义 | 单 `refImageId`，重试即覆盖 | 补：`images[]`+currentImageId `P1` |
| 资产 | 音频/配音：音色库 + 角色↔音色 + AI匹配 + 注入 | type=audio + o_assetsRole2Audio + batchBindAudio + 合成注入 | 完全缺（tts.ts/ffmpeg多轨闲置） | **补：音色全链** `P1` |
| 资产 | 批量并发 + 单条取消 + 进度 | pLimit(5) 并发 + cancelGenerate + 轮询 | 串行 for + 单 label | 补：mapPool + cancel `P2` |
| 资产 | 消除双轨（studio↔全局 ElementRef + GC 保护） | 单一资产源 | 两套模型互不读写；studio 图不进 registry → **有 GC 误删风险** | **补：桥接 + GC 收集** `P1` |
| 资产 | 片段/素材上传 + prompt 手动编辑入口 | uploadClip + updateAssets(prompt) | 仅改 name/desc | 补：clip 类型 + prompt textarea `P2` |
| **分镜** | 分镜表（storyboardTable）上游设计层 | 分镜表 markdown→逐行写面板（两段式+审核） | Agent 一次性直出面板，无中间表 | **补：分镜表层** `P1` |
| 分镜 | shouldGenerateImage 双模式（首位帧/纯文本多参） | =1出关键帧 / =0直进视频 | 字段存在但生成逻辑/UI 未消费 | 补：分支 + 开关 `P2` |
| 分镜 | reason 失败原因 + 强制重生(compulsory) + 轮询进度 | reason 列 + compulsory + pollingImage | 仅 error + 串行 label | 补：复用 error + compulsory `P2` |
| 分镜 | **imageFlow 关键帧二次编辑** | 节点式多参考图合成画布(o_imageFlow) | 整张重生，无精修/换参考 | **补：ImageEditFlow 内联** `P1` |
| 分镜 | 面板字段完整编辑入口 | duration/track/关联资产/prompt/对白 可编辑 | 仅 videoDesc + 承接开关 | 补：详情折叠区 `P1` |
| 分镜 | 分镜墙预览/导出（S01 编号网格） | previewImage/downPreviewImage(sharp) | 缺 | 补：Canvas 合成 `P2` |
| 分镜 | 导演技能注入彻底 | director_storyboard/_table_style 注入分镜表+prompt | composeDirectorPrompt 函数已就绪但**仅 cinematic_realistic 有 director_storyboard.md，无 _table_style/_planning_style，且从未被消费** | **补：编写缺失 .md + 接上能力** `P1` |
| **时间线** | 真正的「视频段/轨道」实体 | o_videoTrack（聚合分镜/段prompt/段时长/选优） | VideoTrackItem 退化为每镜固定一片 | **补：VideoTrack 重构** `P0` |
| 时间线 | 一镜多生选优（候选并排/选片/删候选） | 多 o_video + selectVideo | clipIds[] 结构在但 generateClip 覆盖单片 | **补：追加候选语义** `P0` |
| 时间线 | 按模型+模式的视频提示词（4 模式模板） | modelPrompt/video 4 md 路由 | motion 硬拼，videoMode 未消费 | **补：videoPrompt 服务 + 模板** `P0` |
| 时间线 | 段时长编辑 | updateVideoDuration | 无 UI 入口 | 补：段时长输入 `P0` |
| 时间线 | 音频轨/配音注入合成 | getGenerateData 注入 + audioReference:N | compose 不注入任何配音 | 补：dub.ts + audioTracks `P1` |
| 时间线 | 逐段批量并发 + 轮询式进度 | batchGenerate* pLimit | 串行 for + 单 label | 补：mapPool + perItem `P1` |
| 时间线 | 转场/裁剪/拖拽重排/手动归段 | 段重排 + 转场 | compose 支持 fade/xfade 但 UI 不可选 | 补：渐进 `P2` |
| **Agent** | 真 host tool-calling 工具循环 | streamText + tools | 单次结构化 JSON 方案（非 tool-loop） | **补：手动 tool-loop** `P0` |
| Agent | 子 Agent 即工具（run_sub_agent_*） | createSubAgent | 顺序硬编码三子 Agent | 补：subAgents.ts `P0` |
| Agent | agentDeploy（按 Agent 选模型/温度） | o_agentDeploy 16 子层 | 全局单 selectedModel | 补：agentDeployStore `P1` |
| **技能** | story_skills + production_skills + references + 动态拼接 | 三大类 + scanSkills + activate_skill | 仅 art_skills 2 画风 | 补：技能库扩展 `P1` |
| 供应商 | 强类型 VideoModel（mode/durationResolutionMap/audio） | 能力矩阵驱动参数面板 | toapisModels 雏形未统一 | 补：VideoModelSpec 注册表 `P2` |
| **记忆** | summary 压缩 + RAG + isolationKey | ONNX 三级记忆 | 平铺数组近 6 条裸注入 | 补：LLM 摘要 + 关键词召回 `P1` |
| **任务** | o_tasks 任务中心 | taskRecord/getTaskApi | 仅 batch.label | 补：taskStore `P2` |
| **设置** | 6 子域（vendor/modelMap/prompt/skill/memory/agentDeploy） | 完整设置面 | 散在画布侧 SettingsView | 补：工作台设置抽屉 `P1` |
| **图编辑** | imageFlow 多参考图合成画布 | o_imageFlow | 缺 | （同分镜域 imageFlow）`P1` |
| **信息架构** | 一个项目工作台内含所有面 | 单一项目工作台 | AppRail 平级 6 视图，资源库在工作台外 | **补：StudioShell 收敛** `P0` |

---

## 2. 数据模型演进（ProjectDoc 增量 + 独立 KV store）

原则：**全部新字段可选、向后兼容旧 doc**；衍生/多图/imageFlow 内联进 ProjectDoc JSON（等价于 Toonflow 各关系表）；agent runtime / 配置 / 任务属独立 KV store，不进 ProjectDoc。

### 2.1 `domain/types.ts` 增量

```ts
// ── 类型扩展 ─────────────────────────────
export type AssetType = 'role' | 'scene' | 'prop' | 'audio' | 'clip'   // [改] 增 audio/clip
export type PromptState = 'idle' | 'polishing' | 'done' | 'failed'      // [新] 润色态

// ── 资产：历史候选图 + 润色态 + 衍生归属 + 桥接 + 音色 ──
export interface AssetImage {                                            // [新] 一资产多图(对应 o_image)
  id: string; assetId: string; refImageId: string
  model?: string; resolution?: string; createdAt: number
  state: GenState; error?: string
}
export interface AssetVariant {                                          // [改] 补 state/error，真正消费
  id: string; label: string; prompt?: string; refImageId?: string
  appliesTo?: string[]; state?: GenState; error?: string
}
export interface Asset {
  // …现有 id/type/name/prompt/desc/refImageId/parentAssetId/variants/state/error 不变…
  images?: AssetImage[]            // [新] 历史候选图；refImageId 同步为 currentImage 的 refImageId
  currentImageId?: string          // [新] 当前选定 AssetImage.id
  promptState?: PromptState        // [新] 提示词润色状态
  promptError?: string             // [新]
  derivedFromImageId?: string      // [新] 衍生所用父图(img2img 来源)
  elementId?: string               // [新] 桥接全局 assetStore.ElementRef.id
  flowId?: string                  // [新] 关键帧/资产精修画布引用(指向 doc.imageFlows)
  // ── 音色子资产(type:audio) 专用 ──
  audioFilePath?: string           // [新] 试听音频本地路径(tts.ts 落盘)
  audioUrl?: string                // [新]
  sex?: string                     // [新] audio 父资产性别标签
  // ── 角色音色绑定(type:role) ──
  voiceAssetId?: string            // [新] 指向 type:audio 的 Asset.id(一对一)
  audioBindState?: GenState        // [新] AI 配音绑定状态
}

// ── 分镜：失败原因 + 二次编辑画布 ──
export interface Storyboard {
  // …现有字段不变…
  // reason?: 复用现有 error，不新增
  flowId?: string                  // [新] 关键帧精修画布引用
}

// ── 图像编辑流（内联，替代 o_imageFlow 表）──
export interface FlowNode {        // [新]
  id: string; type: 'upload' | 'generated'
  assetId?: string; prompt?: string; model?: string; size?: string
  references?: string[]            // 本次生成所用参考 assetId 列表
  position?: { x: number; y: number }
}
export interface ImageEditFlow {   // [新]
  nodes: FlowNode[]
  edges?: { from: string; to: string }[]
}

// ── 视频段/轨道（取代退化的 VideoTrackItem 单片语义）──
export type VideoMode = 'firstFrame' | 'startEndFrame' | 'multiRef' | 'singleImageFirst'  // [新]
export interface VideoTrack {      // [新] 对标 o_videoTrack
  id: string
  storyboardIds: string[]          // 该段聚合的分镜(默认 1 个)
  prompt?: string                  // 段级视频提示词(按模型+模式生成，可手改)
  promptState?: GenState
  promptError?: string
  duration?: number                // 段时长(覆盖分镜 duration 之和)
  videoMode?: VideoMode            // 缺省取 meta.videoMode
  clipIds: string[]                // 候选视频(一镜多生)
  selectClipId?: string            // 选优
  audioClipId?: string             // 该段配音音频 assetId
  order: number                    // 时间线排序
}

// ── Clip：候选元信息 ──
export interface Clip {
  // …现有 id/storyboardId/videoFilePath/videoUrl/durationSec/state/error 不变…
  trackId?: string                 // [新] 所属段
  prompt?: string                  // [新] 生成所用提示词快照(候选对比)
  createdAt?: number               // [新] 候选排序
  posterImageId?: string           // [新] 候选首帧缩略
}

// ── 记忆：RAG/摘要关联 ──
// 注意：现有 MemoryItem 已有 agent:string + role:string 两字段。
//   - 隔离维度【复用现有 agent 字段】，不新增 isolation（避免与 agent 语义重叠成第三套隔离维度）。
//   - 若未来一项目多集(scripts/episodes)，隔离键退化为复合值 agent[:scriptId]（仍写进 agent 字段，不新增字段）。
export interface MemoryItem {
  // …现有字段不变（id/agent/role/content/createTime/summarized）…
  embedding?: number[]             // [新] 可选向量(宿主有 embedding 模型时；AiModelType 含 'embedding')
  relatedIds?: string[]            // [新] summary 关联的 message id
  // [删] isolation：与现有 agent 字段语义重叠，改为复用 agent（单集本期假设：agent 即隔离键）
}

// ── 分镜表设计层 ──
export interface StoryboardTableRow {  // [新]
  index: number; videoDesc: string; duration: number
  shotSize?: string; cameraMove?: string; dialogue?: string; sfx?: string
  assetRefNames: string[]
}
export interface StoryboardTableSegment { id: string; title: string; rows: StoryboardTableRow[] }
export interface StoryboardTableScene {
  id: string; sceneName: string; castNames: string[]; segments: StoryboardTableSegment[]
}

// ── ProjectMeta 增量 ──
export interface ProjectMeta {
  // …现有字段不变…
  videoMode?: VideoMode | string   // [改] 收敛为强类型(兼容旧 string)
  videoResolution?: '480p' | '720p' | '1080p' | string  // [新]
  audioReferenceCount?: number     // [新] 每段注入配音上限(对标 audioReference:N)
  concurrency?: number             // [新] 批量并发数(默认 3)
  transition?: 'none' | 'fade' | 'xfade'  // [新] 整片转场
}

// ── ProjectDoc 增量 ──
export interface ProjectDoc {
  // …现有字段…
  track: VideoTrack[]              // [改] VideoTrackItem[] → VideoTrack[]（loadProject 内一次性 normalize）
  storyboardTable?: StoryboardTableScene[]   // [新] 分镜表设计层
  imageFlows?: Record<string, ImageEditFlow> // [新] 以 flowId 为键的精修画布
  // events: EventNode[]（现状必填非可选，types.ts:130）。【口径统一】采纳 R5：本期删 EventNode 与 doc.events stub
  //   （章节事件用 NovelChapter.event 文本承载）；需事件图谱再单独立项。删除时需同步清理所有构造 ProjectDoc 的
  //   空 events:[] 初始化点（newProject/loadProject）。
}
```

> 迁移：`loadProject` 内做一次性 `normalizeTrack`：把旧 `VideoTrackItem{storyboardId}` 映射为 `VideoTrack{storyboardIds:[storyboardId], clipIds, selectClipId, order:index}`。旧 doc 其余无需迁移。

#### 2.1.1 迁移破坏点清单（阶段2 一次性改对）

> 以下增量会破坏现有编译/运行，**必须在同一阶段同步改对全部受影响调用点**，否则 tsc 报错或运行期匹配失败。逐条列出受影响文件与改法。

| 破坏点 | 受影响文件 | 现状 | 改法 |
|---|---|---|---|
| `AssetType` 增 `'audio'`/`'clip'` → `ASSET_ROLE` 缺键 | `studio/services/generate.ts:26`（`const ASSET_ROLE: Record<Asset['type'], StyleRole> = {role,scene,prop}`） | `Record<Asset['type'],…>` 要求全键，新增 audio/clip 后 tsc 报缺键；`ASSET_ROLE['audio']` 运行期 `undefined` 传 `composeArtPrompt` 出错 | 把 `ASSET_ROLE` 改为 `Partial<Record<Asset['type'], StyleRole>>`（或显式只列 role/scene/prop）；`generateAssetImage`/衍生/`polish` 路径对 `audio`/`clip` **提前 return**（不出图、不润色），调用点用 `ASSET_ROLE[type] ?? 'character'` 兜底 |
| `track` 字段类型冲突：`VideoTrackItem[]` → `VideoTrack[]` | `domain/types.ts:135`、`studio/services/compose.ts:21`、`projectStore.generateClip`、`TimelineTab`（读 `t.storyboardId`） | compose.ts:21 `doc.track.find(x=>x.storyboardId===sb.id)` 用单数 `storyboardId`，重构为 `storyboardIds:string[]` 后**永远匹配不到** | 见 §5.1 受影响调用点清单：compose 改 `track.find(x=>x.storyboardIds.includes(sb.id))`、generateClip 改写 `storyboardIds`、TimelineTab 读复数 |
| `VideoTrackItem`→`VideoTrack` normalize | `loadProject`（normalizeTrack） | 旧 doc 是单 `storyboardId` 形状 | loadProject 内一次性映射（见上） |
| `Storyboard.track:string` 与 `ProjectDoc.track:VideoTrack[]` **同名不同义** | `domain/types.ts`、§4.8 按 `Storyboard.track` 名聚合 | `Storyboard.track` 是「轨道名标签」(string)，`ProjectDoc.track` 是「视频段数组」——两个 `track` 易混 | 不改字段名但在注释里区分；§4.8 聚合用 `Storyboard.track`（标签），§5 时间线用 `ProjectDoc.track`（段） |
| `Asset.refImageId` 改为 derived getter（=选定图的 refImageId） | `studio/services/generate.ts`、`studio/services/keyframe`（读 `asset.refImageId`/`currentImageId`） | 现有 generate/keyframe 直接读 `asset.refImageId` | 保留 `refImageId` 字段并在 `selectAssetImage` 时同步写回（不做真 getter，避免 zustand 序列化问题），现有引用零改动 |

### 2.2 独立 KV store（不进 ProjectDoc，全局或半全局）

| KV key | 类型 | 用途 |
|---|---|---|
| `studio:ui` | `{ dockTab; stageTab; settingsOpen }` | 工作台布局态 |
| `studio:agentDeploy` | `AgentDeployDoc{ useMode; entries }` | 按 Agent 模型/温度配置 |
| `studio:memoryConfig` | `{ shortTermLimit; messagesPerSummary; summaryMaxLength; ragLimit }` | 记忆阈值 |
| `studio:tasks` | `TaskRecord[]`（环形封顶 ~500） | 任务中心 |
| `studio:modelPrompt` | `Record<videoModelId, templateText>` | 视频模型↔提示词覆盖(modelMap) |
| `studio:customStyles` | `Record<styleId, Partial<StylePack>>` | 用户画风覆盖层 |

```ts
// agentDeployStore
export type AgentKey = 'decision'|'writer'|'artDirector'|'director'|'supervision'|'universal'
export interface AgentDeployEntry { model?: string; temperature?: number; maxOutputTokens?: number }
export interface AgentDeployDoc { useMode: 'simple'|'advanced'; entries: Partial<Record<AgentKey, AgentDeployEntry>> }

// taskStore
export type TaskState = 'running'|'done'|'failed'
export interface TaskRecord {
  id: string; projectId: string
  taskClass: 'asset'|'keyframe'|'clip'|'compose'|'text'|'audio'
  model?: string; describe?: string; state: TaskState; reason?: string
  startTime: number; endTime?: number
}
```

---

## 3. 资产板补全设计（详）

### 3.1 衍生资产（换装/场景变体/物品状态）`P0` · 工作量 M
- **Toonflow**：o_assets 自关联（父 `assetsId=null` + 衍生 `assetsId=父id`）；衍生走 img2img——父成图 base64 作 referenceList + `art_*_derivative` 手册（约束「面容/姿态不变只叠服化」）；先 universalAi 润色衍生 prompt 再出图。生产 Agent 有 add/del/generate_deriveAsset 三工具。
- **现状**：`parentAssetId`/`variants` 字段已定义但 store/UI/generate 全未消费（stub）。
- **落地方案**：
  - 数据：启用 `Asset.parentAssetId` + `derivedFromImageId`；`AssetVariant.state/error`。
  - **交付物（新建 .md）**：必须编写 `art_skills/<style>/art_prompt/art_{character,scene,prop}_derivative.md`（约束「面容/姿态/身份不变，只叠服化/状态/场景变体」），否则 `composeArtPrompt({derivative:true})` 会**静默回退基础手册**（`skillSystem.ts:98`），衍生约束不生效。**手册缺失兜底**：`generateDerivativeImage` 在 prompt 内硬编码 `DERIVATIVE_CLAUSE`（「keep the same face/identity/pose, only change outfit/state/scene as described」）作子句，保证即使无衍生手册也有约束。
  - 服务：`generate.ts` 新增 `generateDerivativeImage(child, parent, meta)`——取 `parent.currentImageId`→`loadImageBase64` 作主参考；`prompt = composeArtPrompt(meta.artStyle, ASSET_ROLE[child.type] ?? 'character', {derivative:true}) + DERIVATIVE_CLAUSE + CONTINUITY_CLAUSE + child.desc`；调 `editImage`(img2img+extraRefs)。注意 `ASSET_ROLE` 仅有 role/scene/prop（见 §2.1.1），audio/clip 不走衍生出图。
  - store：`addDerivative(parentId,{label,desc})` / `generateDerivative(childId)` / `removeDerivative(childId)`。
  - UI：`AssetCard` 下方「衍生」可展开横排（按 parentAssetId 分组的子卡片：缩略/标签/生成/删除）+ 新增衍生弹窗。
  - Agent 工具：`add_derive_asset` / `generate_derive_asset` 接入 assets 阶段（结构化方案 assets 项支持 `parentName`）。
- **复用**：`composeArtPrompt({derivative:true})`（**函数已就绪，但衍生 .md 需新建**——见交付物）、`editImage`、`loadImageBase64`、`saveAsset`、`CONTINUITY_CLAUSE`。
- **Mulby 替代**：Agent 工具直接调 projectStore action（同进程）而非 socket.emit。

### 3.2 AI 提示词润色（视觉手册驱动两段式）`P0` · 工作量 M
- **Toonflow**：`polishAssetsPrompt`/`batchPolishAssetsPrompt` 读 art_character/scene/prop（或 _derivative）作 system，LLM 把「名称+描述」润色成英文 prompt 写 `o_assets.prompt`，`promptState` 跟踪，前端轮询。出图与润色两段式。
- **现状**：直接拼 `applyStylePack` 锚定词当 prompt 出图；`composeArtPrompt` 手册正文从未进生成路径。**且仅 cinematic_realistic 有 art_prompt 手册，2d_anime 等画风只有 prefix.md**——其它画风润色只能拿到 prefix，得不到细化的人物/场景/物品提示词手册。
- **落地方案**：
  - **交付物（新建 .md）**：补全各画风的 `art_prompt/art_{character,scene,prop,storyboard_video}.md`（当前只有 cinematic_realistic 全套，2d_anime 等只有 prefix），否则非 cinematic_realistic 画风润色只拿到 prefix。手册缺失时 prompt 内硬编码资产约束兜底子句。
  - 服务：新增 `studio/services/polish.ts`：`polishAssetPrompt(asset, meta)` = `runText({ model:文本模型, system:composeArtPrompt(meta.artStyle, ASSET_ROLE[type] ?? 'character', {derivative:!!parentAssetId}), user:'名称:..\n描述:..' })` → 写 `asset.prompt`。audio/clip 资产跳过润色（见 §2.1.1）。
  - store：`polishAsset(id)` / `polishAllAssets()`（batch 进度），`setAssetState` 增 `promptState`。
  - 流程：UI 拆两步按钮「润色提示词」「生成图片」（对齐 Toonflow 两段式，更可控）；`generateAsset` 若无 prompt 则先 polish。
  - UI：`AssetCard` 增可编辑 prompt textarea（补齐手动编辑入口）+ 润色态徽标(spinner/失败角标)。
- **复用**：`composeArtPrompt`、`runText`(jsonMode 关)。
- **Mulby 替代**：润色态由 zustand action 同步回 doc，UI 订阅即刷新（无需 HTTP 轮询）。

### 3.3 一资产多图（历史候选）+ 选定当前图 `P1` · 工作量 M
- **Toonflow**：o_image 一资产挂多张历史图，imageId 指当前；getImage 列候选(标 selected)，saveAssets 选定/上传自定义为当前，delImage 删单张；每次生成不覆盖。
- **现状**：单 `refImageId`，生成即覆盖，无历史/无上传。
- **落地方案**：
  - 数据：`Asset.images[]` 累积每次 `AssetImage`，`currentImageId` 指当前；`refImageId` 保留为 derived getter（= 选定图的 refImageId，最小改 generate/keyframe 引用）。
  - 服务/store：`generateAsset` 改为 push 新 AssetImage 而非覆盖；`selectAssetImage(assetId,imageId)` / `deleteAssetImage` / `uploadAssetImage(file)`（复用 `assetStore.upload`/`saveAsset`）。
  - UI：缩略图加角标计数，点开 `<AssetImageDrawer>`（历史图横排 + 选定/删除/上传）。
- **复用**：`saveAsset/loadAsset/loadAssetUrl/useMediaUrl`、`assetStore.upload`。
- **Mulby 替代**：历史图数组内联进 Asset（JSON KV），二进制各自 saveAsset；删图同步 deleteAsset 防附件泄漏。
- **待决策**：历史是否限条数（建议每资产封顶 ~10 + GC，类比 promptStore）。

### 3.4 音频/配音：音色库 + 角色↔音色 + AI 匹配 + 合成注入 `P1` · 工作量 L
- **Toonflow**：type=audio 父资产（分组，`describe` 用 `|` 拆 `sex|describe`）+ 多个音色子项（o_assets 自关联，每个子音色可有多条试听音频候选）；o_assetsRole2Audio 一对一绑定（手动 updateAssetsAudio 或 AI batchBindAudio 用 resultTool 选最匹配，audioBindState 跟踪）；合成按角色→音色映射注入分镜/轨道 medias，mode `audioReference:N` **截断每段对白音轨条数为 N**（控注入数量上限）。
- **音色父子双层结构（精确语义）**：一个角色组 = 1 个父 audio 资产（`sex`/`desc`，`describe` 按 `|` 拆 sex/desc）+ N 条子音色试听；用户在多条候选子音色里**选一条**绑定到角色——角色 `voiceAssetId` 指向**某条子音色（child）而非父组**；compose 注入时按 `meta.audioReferenceCount` 限制每段对白音轨条数。
- **现状**：完全缺；底层 `tts.synthSpeech`(已落盘) 与 `ffmpeg.composeFilm` 的 audioTracks+ducking 闲置。
- **落地方案**：
  - 数据：`AssetType` 增 `'audio'`；音色父子用 `parentAssetId`（父 audio 分组 + 子音色，`audioFilePath` 存试听）；`Asset.voiceAssetId/audioBindState/sex`。
  - 服务：新增 `studio/services/audio.ts`：
    - `synthVoiceSample(text, voiceCfg)` 复用 `tts.synthSpeech` 生成试听 → saveAsset 落盘建音色子项。
    - `bindRoleVoice(roleId, voiceAssetId)`（一对一覆盖写 `voiceAssetId`）。
    - `autoBindVoices(roleIds)`：`runText` jsonMode 给「角色设定 + 候选音色列表(id|名|描述/性别)」让 LLM 返回 `{roleId, voiceAssetId}[]`（替代 Toonflow resultTool），`audioBindState` 跟踪。
  - 合成注入（按 provider 能力择路）：
    - 路径 A（视频模型原生音频）：**provider 能力门控是硬前置条件**——注入前必须检查 `providerStore.getActiveFor('video')` 的 capabilities 含 `nativeAudio`/`lipsync` **且** `cfg.audio.acceptsDrivingAudio && cfg.audio.drivingAudioField` 已配置（核对 `fal.ts:35`：仅在 `cfg.audio?.acceptsDrivingAudio && cfg.audio.drivingAudioField && req.drivingAudioUrl` 三者齐备时才写入；native 音频走 `cfg.audio.toggleField`）。满足才把出场角色 `voiceAssetId`（子音色）音频作 `drivingAudioUrl`/`audioMode` 传 `runVideo`；**不满足自动回退路径 B**。即「路径 A 非普适可用」，能否注入完全取决于所选 provider 的 audio 能力声明（与 §4.2『纯文本多参直拍需校验 provider 能力』同等严谨，见 §5.5.1 能力矩阵前置校验）。
    - 路径 B（ffmpeg 后期音轨，通用兜底）：`compose.ts` 注入 `AudioTrack{role:'dialogue'}`（composeFilm 已支持多轨 + sidechain ducking）。
  - 配音对白来源：优先 `Storyboard.dialogues`（让 Agent skill 强制产出），兜底从 videoDesc 抽。
  - UI：资产 Tab 增「音色」分组(audio 父组) + 每父组下多条子音色试听条（多条候选并排，可单条试听/删除）；角色卡片「选择音色」下拉**列出全部子音色（非父组）单选绑定** + 「AI 智能匹配音色」批量按钮 + audioBindState 进度灯。**两种填充路径**：① 上传真实样本（`assetStore.upload` 落盘建子音色）② TTS 试听（`synthVoiceSample` 生成候选），UI 两个入口并存。
- **复用**：`tts.synthSpeech`、`providerStore.getActiveFor('tts'/'nativeAudio'/'lipsync')`、`ffmpeg.composeFilm` AudioTrack、`runText`。
- **Mulby 替代**：一对一绑定用单字段 `voiceAssetId`；AI 匹配用 jsonMode 返回映射；两条注入路径按 provider 能力自动择一。
- **待决策**：音色来源是 TTS 试听 还是 上传真实样本？建议两者都支持（上传 + TTS 试听）。

### 3.5 批量并发 + 单条取消 + 进度 `P2` · 工作量 S
- **Toonflow**：pLimit(默认5) 后台并发 + 前端轮询每条 state；cancelGenerate 置失败实现取消。
- **现状**：串行 for + 单 label，无并发/取消/逐条进度。
- **落地方案**：抽 `graphStore.mapPool` 为 `studio/services/pool.ts`；`generateAll*` 改 `mapPool(ids, doc.meta.concurrency??3, fn)`，每条独立 `setAssetState` 回写；`cancelAsset(id)`（置 failed + '已取消' + 重入守卫跳过写回，配合 `imageEngine.abortImage`）。
- **复用**：`graphStore.mapPool`、`abortImage`。

### 3.6 消除双轨：studio Asset ↔ 全局 ElementRef + GC 保护 `P1` · 工作量 M
- **Toonflow**：项目内单一资产源（富身份集中在 o_assets）。
- **现状**：studio `Asset` 与全局 `assetStore.ElementRef`（identity/views/appearanceVariants/voiceId）两套互不读写；**studio 生成图不进 `assets:registry` → 不在画廊、不被 `gcOrphans.collectReferenced` 保护，有误删风险**。
- **落地方案**：
  - 桥接：`Asset.elementId`；`AssetCard` 加「存入素材库/从库选用」——存入调 `assetStore.saveElement({kind: role→character, name, description, prompt, refAssetIds:[currentImageId], views, voiceId})`；从库选用把 `ElementRef` 映射成 studio Asset（带 elementId 回链）实现跨项目角色一致性复用。
  - **GC 保护（先做，防误删）·两道保护缺一不可**：
    1. **collectReferenced 扫 studio doc**：`assetRegistry.collectReferenced`（`assetRegistry.ts:277-290`，现状只扫 `listProjects()`(canvas)+elements+snapshots+`role==='uploaded'` registry，**完全不扫 studio doc**）扩展扫描 `studio:index`→每个 `studio:project:<id>` 的 doc，收集 `assets[].images[].refImageId`、`assets[].variants[].refImageId`、`storyboards[].keyframeImageId`、`clips[].videoFilePath`、`audios` assetId、`imageFlows` 节点 assetId。
    2. **registry 登记**：`registerStudioAsset(...)` 在每次 saveAsset 后登记进 registry（进画廊）；`backfillFromProjects` 增 studio 扫描分支（幂等回填）。
    - **⚠ role 取值陷阱**：`gcOrphans` 删除后 `saveRegistry(registry.filter(...))` 会按 `assetId∈removedIds` 剔除记录，而 `collectReferenced` 只把 `role==='uploaded'` 的 registry 项当根引用保护（`assetRegistry.ts:288`）。若 `registerStudioAsset` 写入时 role 用默认 `generated`，该记录**不享根引用保护**——必须靠第 1 道（collectReferenced 扫 studio doc）兜住。因此**两道缺一不可**：登记进画廊（可见）+ collectReferenced 以 studio doc 引用为准（防删）。registerStudioAsset 的 role 不能想当然用 `uploaded`（语义错），保护应以 studio doc 实际引用为准。
  - 双向同步：`Asset.voiceAssetId` ↔ `ElementRef.voiceId`。
- **复用**：`assetStore.saveElement/promoteCharViews/ElementRef`、`assetRegistry.backfillFromProjects/gcOrphans/collectReferenced`、`AssetsView`。
- **节奏建议**：**先做 GC 引用收集（防现有 studio 资产被误删），再做功能增量。**

### 3.7 片段/素材上传 + 片头片尾 + prompt 完整编辑 `P2` · 工作量 S→M
- **Toonflow**：uploadClip(按 base64 头识别图/音/视建 clip)；updateAssets 改 name/describe/remark/prompt；**getMaterialData 自带本地官方片尾(ending.mp4, id=0)，合成时固定追加**；clip 素材可在时间线作片头/片尾/中间插入。
- **现状**：仅改 name/desc；无 clip 类型/上传；prompt 只 Agent 写；`compose.ts` 现仅按分镜 `selectClip` 顺序合成，**无「把 clip 资产作为片头/片尾插入时间线」的数据位与合成逻辑**。
- **落地方案**：
  - 上传：`AssetCard` 补 prompt textarea（与 §3.2 合并）；`AssetType` 增 `'clip'` + 资产 Tab「片段」分组 + 上传（复用 `assetStore.upload/importAssetFile`，图音→attachment 视频→filesystem）。
  - **片头/片尾/插入段（本期 P2 占位，给出数据位预留）**：在 `VideoTrack`（或独立时间线段）增 `kind?: 'shot' | 'intro' | 'outro' | 'insert'` 与 `clipAssetId?`（非分镜来源的素材段，引用 type:clip 资产）；compose 合成序列按 `order` 纳入这些非分镜段（intro 置首、outro 置尾、insert 按 order 插入）。**本期可只落数据位与「整片官方/自定义片尾固定追加」最小实现**，完整片头片尾拖拽编辑作 P2。
- **复用**：`assetStore.upload/importAssetFile`、`useMediaUrl`、`composeFilm`（拼接序列追加 clip 段）。

### 3.8 与现有 assetStore + AssetsView 融合方案（汇总）
1. studio 生成产物经 `registerStudioAsset` 进 `assets:registry` → 自动出现在 AssetsView 画廊（可加来源筛选 `studio`）。
2. studio 角色经 `elementId` 与 `elements:library` 双向桥接，实现跨项目一致性。
3. GC `collectReferenced` 纳入 `studio:*` 引用，根除误删。
4. 不硬隔离 canvas/studio 资产，仅加来源筛选（统一素材池，符合 Toonflow 单数据源心智）。

---

## 4. 分镜面板补全设计（详）

### 4.1 分镜表（storyboardTable）上游设计层 `P1` · 工作量 M
- **Toonflow**：阶段4 storyboard_table Agent 产出整张分镜表 markdown（场头/片段/序号·画面·时长·景别·运镜·台词·音效，标注引用资产名+ID），存 o_agentWorkData，需审核；阶段5 storyboard_panel 读分镜表逐行写面板格。表是人可审阅/编辑的中间产物。
- **现状**：无 storyboardTable；Agent 一次性直出面板，无场/片段分组、无景别/运镜结构化列、无审核。
- **落地方案**：
  - 数据：`ProjectDoc.storyboardTable?: StoryboardTableScene[]`（结构化，便于 UI 表格渲染）。
  - Agent：storyboard 阶段前插「分镜表」子 Agent（`TABLE_SKILL` 注入 `composeDirectorPrompt(artStyle,'storyboard_table_style')` + Toonflow 约束：禁写光影色调词/台词逐字照搬/标注资产ID），先产分镜表，再把它作上下文喂 `STORYBOARD_SKILL` 逐场拆面板格。
  - store：`runAgent` 合并把 `plan.storyboardTable` 写 doc；`DECIDE_CONTRACT.tasks` 增 `'storyboardTable'`。
  - UI：分镜 Tab 顶部「分镜表/分镜面板」二级切换；分镜表视图渲染 场→片段→可编辑表格，底部「生成分镜面板」把表行展开为 Storyboard（row.videoDesc/duration/assetRefNames→associateAssetIds，沿用 `upsertStoryboard`）。
- **复用**：runAgentPipeline 分阶段机制、`composeDirectorPrompt('storyboard_table_style')`(**函数已就绪，但 `director_storyboard_table_style.md` 全库不存在、需新建**——否则只返回 prefix，见 `skillSystem.ts:103-106`)、`upsertStoryboard`。
- **分镜表→视频提示词字段衔接**：`StoryboardTableRow` 的 `shotSize`/`cameraMove`/`dialogue`/`sfx` 是 §5.3 视频提示词 12 字段映射的**结构化来源**——studio 单层 `Storyboard` 缺「景别/运镜/光影」结构化字段，§5.3 模板需依赖分镜表这些列回填，否则模板拿不到这些字段。故分镜表 Agent 必须产出这些列。
- **监督口径裁决（统一，消除 §4.1 与 §6.2 歧义）**：**本期只做人工确认**——生成分镜表后停在表视图等用户人工确认（不自动展开面板），对话区给说明；**不做 Agent 监督**，§6.2 的 `run_supervision` 子 Agent 工具**留 P2**。两处口径以此为准，不并存。

### 4.2 shouldGenerateImage 双模式 `P2` · 工作量 S
- **Toonflow**：=1 首位帧模式(出关键帧，prompt 带 @图N)；=0 纯文本多参(不出图直进视频，videoDesc=组原文+承接句)。
- **现状**：字段存在但生成逻辑/UI 未消费，所有分镜都当首位帧出图。
- **落地方案**：`generateAllKeyframes` 过滤 `&& s.shouldGenerateImage`；`generateClipVideo` 放宽「必须有关键帧」——允许 keyframe 与 firstFrameUrl 均空时走纯 prompt 文生视频；UI `StoryboardItem` 加「出图/直拍」开关；Agent 据 `providerStore.getActiveFor('video')` 是否多参输出 shouldGenerateImage。
- **待决策**：纯文本多参直拍依赖 provider 支持多参/文生视频，放宽后需校验所选 provider 能力。

### 4.3 reason + 强制重生 + 轮询式进度 `P2` · 工作量 S
- **Toonflow**：reason 列；后台并发 + pollingImage 轮询；compulsory 强制重生已完成图。
- **现状**：仅 error；串行 label。
- **落地方案**：reason **复用现有 error**（语义等价，不新增）；`generateAllKeyframes/Clips` 增 `compulsory` 参数（true 不跳过已有图，UI「全部重生」）；策略：承接镜头(chainFromPrev)必须串行，非承接可并发（或保持串行优先连贯，工作量更小）。
- **复用**：`mapPool`、`setStoryboardState`。
- **Mulby 替代**：同进程 await + mutate 回写，无需轮询接口。

### 4.4 imageFlow 关键帧二次编辑 `P1` · 工作量 L→可降 M
- **Toonflow**：每分镜/资产挂 o_imageFlow（React Flow 画布，节点 upload/generated），多参考图 + prompt → 合成一张（generateFlowImage），回写 filePath+flowId。非蒙版、非图层，是「多图融合重编辑」。
- **现状**：关键帧只能整张重生，无法保留参考图集合迭代精修/换参考/局部调整。
- **落地方案**：
  - 数据：`ProjectDoc.imageFlows: Record<flowId, ImageEditFlow>`；`Storyboard.flowId` / `Asset.flowId`。
  - 服务：新增 `studio/services/imageFlow.ts`：`runFlowImage(flow)` 取 references 的 assetId→`loadImageBase64`→`editImage`(refBase64 主参考 + extraRefs 多参考)→`saveAsset`→生成 generated 节点。
  - UI：`<ImageFlowEditor>` 灯箱弹层——左侧参考图栅格(勾选作 references，来源=资产库/出场资产/上传，复用 `assetStore.assets + AssetThumb`)，右侧 prompt textarea + 模型/比例下拉 + 「重新生成」+「设为关键帧」。`StoryboardItem`/`AssetCard` 缩略图加「✎ 编辑」入口。
  - 级联删：`removeStoryboard` 时清 `doc.imageFlows[flowId]`（内联，随 doc）。
- **复用**：`imageEngine.editImage`（= Toonflow generateFlowImage 多参考图融合等价物）、`assets.saveAsset/loadAsset`、`assetStore.assets + AssetThumb`、`applyStylePack`。
- **Mulby 替代**：editFlow 内联进 ProjectDoc JSON，删除天然级联；**不引入 React Flow**——edges 可省（P1 阶段），用「参考图勾选列表 + 生成历史」覆盖核心多图融合（工作量 L→M）。

### 4.5 面板字段完整编辑入口 `P1` · 工作量 M
- **Toonflow**：editStoryboardInfo 改 prompt+videoDesc；面板 UI 暴露 duration/track/关联资产头像/shouldGenerateImage/景别/运镜/台词。
- **现状**：仅暴露 videoDesc + chainFromPrev + 上下移；prompt/duration/associateAssetIds/track/dialogues 只 Agent 写。
- **落地方案**：`StoryboardItem` 加「详情」折叠区——duration 数字、track 文本、associateAssetIds 多选(从 doc.assets 勾选，显头像 chip)、prompt textarea、dialogues 行编辑(角色+台词+情绪)；全走现有 `upsertStoryboard`(已支持任意 Partial 合并)。
- **复用**：`upsertStoryboard`、`useMediaUrl`、`AssetThumb`、`doc.assets`。

### 4.6 分镜墙预览/导出 `P2` · 工作量 S
- **Toonflow**：previewImage 5 列网格 sharp 合成 + S01 编号叠加；downPreviewImage 原图 PNG 下载。
- **现状**：缺。
- **落地方案**：**纯前端 Canvas 2D**——把每个 keyframeImageId 的 blob `drawImage` 进网格 canvas + `fillText` 画 S01 编号 → `toDataURL/toBlob`；分镜 Tab「预览故事板」按钮弹灯箱 + 下载。零新依赖。
- **复用**：`loadAsset/loadAssetUrl`、现有灯箱(uiStore/ClipPreview)。
- **Mulby 替代**：Canvas 替代 Node sharp。

### 4.7 导演技能注入彻底 `P1` · 工作量 M
- **Toonflow**：分镜表 activate director_storyboard_table_style；面板/出图 activate director_storyboard(情绪→面容映射/光影词库/锚定词/负向词) + production_skills + art_storyboard_video。按 artStyle+题材动态拼接。
- **现状**：`STORYBOARD_SKILL` 硬编码短提示；关键帧仅注入 `applyStylePack` 锚定词；`composeDirectorPrompt/composeArtPrompt` **函数已就绪但从未被消费**；**仅 cinematic_realistic 有 director_storyboard.md，无 `director_storyboard_table_style.md`、无 `director_planning_style.md`；2d_anime 等画风连基础 art_prompt 手册都没有（只有 prefix）**。
- **交付物（新建 .md，本设计产物）**：`director_storyboard_table_style.md`、`director_planning_style.md`（至少 cinematic_realistic + 主力画风）、补全各画风 `director_storyboard.md`。详见 §4.9 技能资产交付清单。
- **落地方案**：`agent.ts` 的 `STORYBOARD_SKILL` 运行时拼 `composeDirectorPrompt(artStyle,'storyboard')` + 题材 story skill + 通用要点；`TABLE_SKILL` 拼 `..._table_style`；`generate.ts generateKeyframeImage` prompt 加入 `composeArtPrompt(artStyle,'storyboard_video')` 的情绪→面容要点（承接 applyStylePack）；**手册缺失时回退基础 prefix + 硬编码兜底子句**；从 Toonflow 迁更多画风的 director_*（import.meta.glob 自动打包）。
- **复用**：`composeDirectorPrompt/composeArtPrompt`(**函数已就绪，但所需 .md 多数需新建**——本差距核心是「写齐 .md + 接上已有函数」)、`applyStylePack`、`import.meta.glob`。

### 4.8 排序（现状已有，增 track 分组）`P2`
- 现有 `moveStoryboard` 上下移已可用。补：按 `Storyboard.track` 名聚合渲染（同名归一轨），对齐 Toonflow trackId 复用。多片选优 UI 归时间线域（§5.2）。
- **注意**：此处 `Storyboard.track`（轨道名标签 string）与 §5 `ProjectDoc.track`（视频段数组 `VideoTrack[]`）**同名不同义**，勿混（见 §2.1.1）。

### 4.9 技能资产交付清单（统一口径，汇总散落各节的「需新建 .md」）`P0/P1`

> 现状已存在的 .md：`art_skills/cinematic_realistic/{prefix, director_skills/director_storyboard, art_prompt/art_{character,scene,prop,storyboard_video}}.md` + `art_skills/2d_anime/prefix.md` + `agent/{production,script}_agent_decision.md`。**以下为本设计需交付的新建/补全 .md**——凡前文写「已就绪」的，以本清单为准统一为「需新建/补全」。

| 交付文件 | 数量/覆盖画风 | 最小内容要求 | 关联节 |
|---|---|---|---|
| `art_skills/<style>/art_prompt/art_{character,scene,prop}_derivative.md` | ×3/画风（至少 cinematic_realistic） | 衍生约束：面容/身份/姿态不变，只叠服化/状态/场景变体 | §3.1 |
| `art_skills/<style>/art_prompt/art_{character,scene,prop,storyboard_video}.md` | 补全 2d_anime 等画风（cinematic 已全） | 各资产类型细化提示词手册 | §3.2 §4.7 |
| `art_skills/<style>/director_skills/director_storyboard_table_style.md` | 至少 cinematic_realistic | 分镜表技法：场/片段/12 字段结构、禁光影色调词、禁台词逐字照搬、标资产 ID | §4.1 §5.3 |
| `art_skills/<style>/director_skills/director_planning_style.md` | 至少 cinematic_realistic | 分镜规划技法：叙事节奏/分场/镜头数规划 | §6.4 |
| `art_skills/<style>/director_skills/director_storyboard.md` | 补全非 cinematic 画风 | 情绪→面容映射/光影词库/锚定词/负向词 | §4.7 |
| `src/ui/skills/video_modes/{firstFrame,startEndFrame,multiRef,singleImageFirst}.md` | ×4（先 firstFrame/startEndFrame 两通用） | 4 视频模式模板：12 字段拆解 + 台词标注 + @图N 编号一致性（见 §5.3） | §5.3 |
| `story_skills/<genre>/director_skills/{director_planning_narrative, director_storyboard_table_narrative}.md` | 按题材按需 | 题材叙事技法（画风无关） | §6.4 |
| `production_skills/*.md`、`references/*.md` | 按需 | 双无关通用生产技能 + 提取格式参考 | §6.4 |

- **缺失兜底通则**：任一 .md 未交付时，`composeArtPrompt/composeDirectorPrompt` 静默回退基础 prefix（不报错），调用方在 prompt 内硬编码兜底子句保证最低约束生效。

---

## 5. 时间线补全设计（详）

> **复用分级（避免低估工作量）**：本节区分两类复用——① **零改动复用**（如 `saveAsset`/`loadAsset`/`runText`/`upsertClip`/`composeFilm` transition）直接调用；② **需改签名/需改调用点的复用**（`generateClipVideo` 加 `track.prompt`/`lastImageUrl`/`track.duration` 改签名 §5.4；`compose.ts` 改轨道定位 §5.1/§5.2）——这些不是「天然兼容」，工作量含函数改造。每处复用断言下方已标注是否需改签名。

### 5.1 「视频段/轨道」实体重构 `P0` · 工作量 L
- **Toonflow**：o_videoTrack 一段=待生成镜头单元，聚合多分镜、持段级 prompt/duration/state、可多候选视频、选优写回 videoId；addTrack/deleteTrack；同名 track 合并 trackId。
- **现状**：`VideoTrackItem{storyboardId}` 退化为每镜固定一片；无 addTrack/deleteTrack/聚合/段级 prompt/duration。
- **落地方案**：
  - 数据：`VideoTrack`（§2.1）；`ProjectDoc.track: VideoTrack[]`；loadProject 内 normalizeTrack 一次性迁移。
  - store：`addTrack(storyboardIds?)` / `deleteTrack(id)` / `assignStoryboardToTrack(sbId,trackId)` / `mergeTracks(ids)` / `reorderTracks(orderedIds)`；新增 `services/track.ts: syncTracksFromStoryboards(doc)`（分镜增删后惰性补齐，每个未归段分镜自动建 1 段，在 openProject/runAgent 后调用）。
  - UI：时间线 Tab 重构为段卡片序列：每段显聚合分镜缩略 + 段操作(生成提示词/生成视频/时长/候选) + 顶部「+新增段」+ 段删除。
- **复用**：`projectStore.mutate/upsert`、`moveStoryboard` 重排思路、`newId('t_')`(规避 Toonflow Date.now() 撞 id)。
- **受影响调用点清单（VideoTrackItem→VideoTrack 重构必须同步改，否则匹配失败/tsc 报错）**：
  | 调用点 | 现状（单数 storyboardId） | 改法（复数 storyboardIds） |
  |---|---|---|
  | `compose.ts:21` | `doc.track.find(x=>x.storyboardId===sb.id)` | `doc.track.find(x=>x.storyboardIds.includes(sb.id))`，或改为遍历 `track.order` 取 `selectClipId` |
  | `projectStore.generateClip` | 写/读 `t.storyboardId` | 改为 `t.storyboardIds`，新建段时 `[sb.id]` |
  | `TimelineTab`（UI 读取） | 读 `t.storyboardId` 渲染 | 读 `t.storyboardIds`（可能多分镜，渲染缩略组） |
  | `loadProject` | 直接读旧 track | 经 `normalizeTrack` 迁移后再用 |
- **待决策**：「多分镜聚合一段」Toonflow 支持但多为 1:1——**先 1 分镜=1 段默认，多分镜聚合作 P2**，避免过度设计。

### 5.2 一镜多生选优 `P0` · 工作量 M
- **Toonflow**：同段多次 generateVideo 产候选；getVideoList 列全部；selectVideo 写回；delVideo 删候选。
- **现状**：clipIds[]+selectClipId 结构在，但 `generateClip` 固定就地覆盖单片；UI 只展示一片。
- **落地方案**：`generateClip` 改「追加候选」——每次 `upsertClip({storyboardId, trackId, prompt快照})` 新建一条→push 进 `track.clipIds`，首条自动设 selectClipId；新增 `selectClip(trackId,clipId)` / `deleteClip(trackId,clipId)`(回退 selectClipId) / `regenerateClip(trackId)`(=追加)。
- **UI**：段卡片下候选缩略横排（复用 `TrackClip` + 「当选」高亮边框 + 选优/删除/再生一版 + `ClipPreview` 灯箱）。
- **复用**：`upsertClip`；`generateClipVideo` **需改签名**（非原样调用——见 §5.4，要接 `track.prompt`/`lastImageUrl`/`track.duration`）；`compose` 读 `selectClipId` **非天然兼容**——`compose.ts:21` 现按 `x.storyboardId===sb.id`（旧单数形）定位轨道，VideoTrack 重构为 `storyboardIds:string[]` 后该行永远匹配不到，**必须同步改轨道定位逻辑**（`storyboardIds.includes(sb.id)`，见 §5.1 受影响调用点清单）。`selectClipId` 复用仅在旧 VideoTrackItem 下成立，重构后不是零改动。
- **待决策**：候选只存远程 url，**选优后才 downloadVideoToDisk** 省磁盘。

### 5.3 按模型+模式的视频提示词（4 模式模板）`P0` · 工作量 L
- **Toonflow**：generateVideoPrompt/batchGeneratePrompt 按 model+mode 路由到 4 个 .md（wan2.6 单图首帧 / seedance2 多参 / 通用首尾帧 / 通用多参），结合 videoDesc + 资产 + art_storyboard_video 手册，LLM 生成段 prompt；台词标注 dialogue/OS/VO，时间分段≥1s。
- **现状**：无段级视频提示词；motion 在 generateClipVideo 硬拼；videoMode 未消费；无模板。
- **模板内容硬要求（4 模板核心价值，不止「移植 4 个 md」）**：
  - **12 字段拆解**：videoDesc 按顿号拆 12 字段——画面 / 场景 / 关联资产名 / 时长 / 景别 / 运镜 / 动作 / 情绪 / 光影 / 台词 / 音效 / 资产ID；模板必须定义这套拆解规则。
  - **台词播报类型标注**：对白标注 `dialogue`（角色对白）/ `OS`（画外音同场）/ `VO`（旁白配音）。
  - **时间分段 ≥1s**：每个动作分段时长不小于 1 秒。
  - **@图N 编号一致性**：`@图N` 引用编号与 `referenceList`（出场资产顺序）**严格对应锁定**——@图1 必为出场资产列表第 1 个，顺序不可错位。
  - **字段来源依赖**：studio 单层 `Storyboard` **缺「景别/运镜/光影」结构化字段**，模板需依赖分镜表（§4.1）的 `shotSize`/`cameraMove` 列回填，否则模板拿不到这些字段（见 §4.1 字段衔接）。
- **落地方案**：
  - 模板：新建 `src/ui/skills/video_modes/{firstFrame,startEndFrame,multiRef,singleImageFirst}.md`（从 Toonflow 4 模板移植**完整 12 字段 + 台词标注 + @图N 规则**，frontmatter 标 modeKey）；`skillSystem.getVideoModeSkill(mode)`。
  - 服务：`studio/services/videoPrompt.ts`：`routeVideoMode(model, videoMode)→VideoMode`（按模型名子串：wan→singleImageFirst, seedance→multiRef, 首尾帧 mode→startEndFrame, 默认 firstFrame）；`generateTrackVideoPrompt(track, doc)→string`（system=模式 md + `composeArtPrompt(artStyle,'storyboard_video')` 视觉手册，user=段内分镜 videoDesc + 出场资产名 + 时长，走 `runText`）；`batchGenerateTrackPrompts`(并发)。
  - store：`generateTrackPrompt` / `generateAllTrackPrompts` 写 `track.prompt/promptState`；`generateClipVideo` 优先用 `track.prompt`（无则回退现有硬拼）。
  - UI：段卡片「生成提示词」按钮 + 可编辑 prompt 框 + promptState 标签；段参数行视频模式下拉(4 选项)。
- **复用**：`import.meta.glob` 打包 md、`composeArtPrompt('storyboard_video')`、`runText`、`videoStyleTag`(兜底)。
- **Mulby 替代**：确定性 `runText` 单次调用(非 tool-loop)；模式→模板用代码内 map + md 打包，省 DB。
- **待决策**：先移植 2 个通用模板(首帧/首尾帧) + 按需补模型专属，避免维护 30+ 模型分歧。

### 5.4 段时长编辑 + generateClipVideo 扩参 `P0` · 工作量 S→M
- **Toonflow**：updateVideoDuration。
- **现状**：无 UI 入口；`generateClipVideo`（`generate.ts:122`）**只接 `sb`（非 track）、`firstFrameUrl`、硬拼 motion**，钳 [4,15]，**不传 `lastImageUrl`（尾帧，providers 层已支持 `generate.ts:27` tail_image_url）、不读段级 prompt、duration 取 `sb.duration`**。
- **⚠ 这不是「原样调用」——`generateClipVideo` 需改函数签名**（与 §5.2/§5.3 共用）：
  - 接 `track.prompt` 覆盖硬拼 motion（无则回退现有硬拼）。
  - 接 `lastImageUrl` 以支持真正首尾帧顺接（尾帧接龙），透传给 `runVideo`。
  - `duration` 改读 `track.duration ?? Σ分镜duration ?? 5`，钳制 [4,15] 保留。
  - 入参由 `sb` 升级为 `track + sb[]`（段聚合分镜）。
  - 「原样调用、不覆盖」**仅适用于一镜多生**（不覆盖 clip 记录），不适用于段提示词/尾帧/段时长这些需改签名的项。
- **落地方案**：`updateTrackDuration(trackId, sec)`；UI 段卡片时长数字输入(秒)。

### 5.5 音频轨/配音注入合成 `P1` · 工作量 L
- 见 §3.4（音色绑定）+ 本节合成注入。`compose.ts` 改：每段若有 `audioClipId` 解析为本地 wav → 组 `AudioTrack{role:'dialogue'}` 传 `composeFilm({audioTracks, ducking:true})`；段视频原音轨作 music/sfx 或 keepClipAudio 二选一。
- **复用**：`tts.synthSpeech`、`ffmpeg.composeFilm` 多轨 + ducking。

#### 5.5.1 音频注入路径 A/B provider 能力矩阵前置校验

> 与 §4.2『纯文本多参直拍需校验 provider 能力』同一规范——注入前先查能力，缺失自动降级，不在「待决策」轻描淡写。

```
选段配音注入
  └─ 取 providerStore.getActiveFor('video')
       ├─ capabilities 含 nativeAudio/lipsync？
       │    ├─ 是 → cfg.audio.acceptsDrivingAudio && cfg.audio.drivingAudioField 已配置？
       │    │         ├─ 是 → 【路径 A】drivingAudioUrl=子音色音频 传 runVideo（fal.ts:35 写入）
       │    │         └─ 否 → 降级 ↓
       │    └─ 否 → 降级 ↓
       └─ 【路径 B 兜底】compose.ts 注入 AudioTrack{role:'dialogue'} + composeFilm ducking
```
- 任一能力门未满足即自动回退路径 B（ffmpeg 后期音轨，通用）；UI 提示当前 provider 不支持原生配音、已转后期合成。

### 5.6 逐段批量并发 + 轮询式进度 `P1` · 工作量 M
- **Toonflow**：batchGenerate* pLimit(5) 后台并发 + checkVideoPrompt/checkVideoStateList 轮询。
- **现状**：串行 for + 单 label。
- **落地方案**：`services/concurrency.ts: mapPool`（抽自 graphStore）；`batchGenerateTrackClips(concurrency=3)`：承接段串行(并发1)、独立段并发；进度从单 label 升级为 `batch:{running,label,done,total,perItem:Record<id,state>}`，UI 逐段状态徽标。
- **复用**：现有 `batch` 标志位模式(= Mulby 无 socket 的轮询版)、`generateClipVideo` 的 onProgress。

### 5.7 转场/裁剪/拖拽重排/手动归段 `P2` · 工作量 M
- ffmpeg 已支持 `transition('none'|'xfade'|'fade')` + clipDurations，仅需 UI 暴露：时间线转场下拉(写 `meta.transition`，compose 透传) + `reorderTracks` 拖拽重排段 + 手动归段(`assignStoryboardToTrack`)；裁剪(逐帧 in/out)留 P2 后置(host ffmpeg.run trim)。
- **复用**：`composeFilm` transition、`reorderStoryboards` 思路。

### 5.8 项目级视频参数编辑入口 `P1` · 工作量 S
- 现状 StudioModelBar 只读供应商状态、复用全局图像模型。补：StudioModelBar 加项目级——视频供应商/模型下拉(`providersFor('video')`) + 视频模式(4 选项) + 分辨率 + 画幅；写 meta，generateClipVideo/videoPrompt 优先读 meta。

---

## 6. Agent / 技能 / 记忆补全

### 6.1 真 host tool-calling 工具循环 `P0` · 工作量 L
- **Toonflow**：streamText + tools，模型自主多步调用工具，工具 execute 落库 + socket 通知。
- **现状**：runAgentPipeline 三次独立 jsonMode 调用，确定性合并；agent skill 虽按工具描述写但从不以 tool-calling 调用。
- **已核实的 API 表面（事实）**：`src/types/mulby.d.ts:1013` 的 `AiTool = { type:'function', function?:{ name, description, parameters:{ type:'object', properties, required?, additionalProperties? } } }`——**OpenAI 风格，无 `execute` 字段**（`execute` 是插件侧 `AgentTool` 概念，非宿主类型）。`AiOption`（:1052）同时带 `tools` / `internalTools` / `toolingPolicy{enableInternalTools,…}` / `mcp` / `maxToolSteps` / `params`，chunk 有 `tool_call`/`tool_result`。`AiModelType`（:1070）含 `'embedding'`/`'function_calling'`。
- **⚠ 待验证假设（阶段0 echo 实测后才能定稿，勿当既定事实）**：宿主对**插件自定义 function 工具**是「吐出 tool_call 后停下等回灌」还是别的行为，**mulby.d.ts 无注释/类型佐证**，是推断。但可确定：`internalTools`/`mcp` 工具由**宿主用 `maxToolSteps` 自动多步执行**（`toolingPolicy.enableInternalTools` 控制）；手动 tool-loop **仅对插件自定义 function 工具可能必需**。
- **采用的循环策略（假设成立时）**：自建手动工具循环——单次 call 收集自定义 function 的 tool-call chunk → 本地执行(改 projectStore) → 把 assistant tool_call 与工具结果回灌 messages → 再次 call，直到无 tool_call 或步数上限。`run_supervision` 等若改用宿主能力则不需手动循环。
- **落地方案**：
  - `studio/agent/runtime.ts`：`runToolLoop({model, system, messages, tools:AgentTool[], maxSteps, params, onStage, onToolCall, onToolResult, abortSignal})`。`AgentTool = {name, description, parameters(JSONSchema), execute(args)=>Promise<string>}`。execute 直接调 `useProjectStore.getState()` 的 upsert*/generate* 动作（同进程，替代 socket.emit）。
  - 决策工具集：`get_workspace` / `upsert_script` / `add_asset` / `update_asset` / `add_storyboard` / `update_storyboard` / `generate_asset` / `generate_keyframe` / `generate_clip` / `compose` / `run_sub_agent_*`。
  - UI：AgentPanel 把单标签升级为「工具调用步骤流」折叠面板(工具名/参数摘要/结果/状态) + 「停止」按钮(abortSignal)。
  - **兜底**：保留现有 jsonMode 确定性管线作为不支持 tool-calling 模型的常驻双路径。
- **复用**：`textEngine`(ai.call 累积 + abortText)、projectStore 全部动作(工具体几乎零新逻辑)、`getAgentSkill`、`generate.ts`。
- **必做验证（呼应上文待验证假设）**：先声明一个 **自定义 function echo 工具**实测宿主 chunk 行为（是「吐出 tool_call 后停止等回灌」还是「内部自动多步」），确认采用手动循环；明确只验**自定义 function 工具**的 chunk 行为（internalTools/MCP 由宿主自动执行，不在本验证范围）。

#### 6.1.1 并发/嵌套调用模型（abort 句柄不可复用全局单例）`P0`

> `textEngine.ts:22` 用**模块级单例 `current`** 持有 abort，`abortText()` 只能中断「最后一次」调用。父 tool-loop 调 `run_sub_agent`(内部再 runText) 或并发记忆摘要时，会互相覆盖 `current`，导致 abort 错乱、stop 按钮只停最里层。

- **改造**：`runToolLoop` / 子 Agent / 记忆摘要每次调用**持有独立 abort 句柄**（用 `AbortController` 链路，不复用 `textEngine` 全局 `current`）。具体：扩展 `runText` 接受 `abortSignal` 入参（替代依赖全局单例），或新建 `runToolLoop` 统一管理 `AbortController`。
- **三类调用的取消传播**：父 tool-loop（顶层）→ 子 Agent（`run_sub_agent` 内 runText）→ 记忆摘要（并发 runText）。`AgentPanel` 的「停止」按钮**只停顶层**，顶层 controller.abort() 经链路**传播取消所有子/并发调用**（子调用接收父 signal 派生的 child signal）。
- 兼容：保留 `abortText()` 作为「停最后一次普通 runText」的旧路径（确定性管线/非 tool-loop 用），但 tool-loop 路径不依赖它。

### 6.2 子 Agent 即工具 `P0` · 工作量 M
- **Toonflow**：createSubAgent 把执行/监督子 Agent 封成父 Agent 的 tool，execute 内新建独立 streamText 子会话。
- **现状**：runAgentPipeline 顺序硬编码三子 Agent，非父 Agent 自主调度。
- **落地方案**：`studio/agent/subAgents.ts: makeSubAgentTools(doc, model, ctx)→AgentTool[]`：`run_writer`(编剧，工具=upsert_script) / `run_art_director`(美术，工具=add_asset/update_asset，注入 composeArtPrompt) / `run_director`(导演，工具=add_storyboard，注入 composeDirectorPrompt)。每个 execute 调 `runToolLoop` 子会话返汇总文本给父 Agent。
- **监督口径（与 §4.1 统一，消除歧义）**：**本期不做 Agent 监督**，仅人工确认（生成分镜表后停在表视图等用户确认）。`run_supervision` 子 Agent（只读 get_workspace 返结论 + 决策层在分镜表后调用 + 结论在 AgentPanel 呈现 + 「按建议修复/重做」回环）**留 P2**。若 P2 启用，则审核结论作为消息在 AgentPanel 呈现，并提供一键「按建议修复」动作驱动修复/重做回环。本期两处口径均以「人工确认」为准，不与 Agent 监督并存。
- **记忆身份**：`MemoryItem.role` 约定 `assistant:decision`/`assistant:execution:script`/`:assets`/`:storyboard`/`assistant:supervision`（字段已是 string，仅约定 + UI 解析头像/标签）。
- **复用**：`runToolLoop`、`composeArtPrompt/composeDirectorPrompt`、现有 SCRIPT/ASSETS/STORYBOARD skill 文案迁进 skill md。

### 6.3 agentDeploy（按 Agent 模型/温度）`P1` · 工作量 M
- **Toonflow**：o_agentDeploy 给 ~16 子层绑模型/温度/maxTokens，agentUseMode 简易/高级。
- **现状**：仅全局 selectedModel。
- **⚠ 现状缺口**：`textEngine.ts:35-50` 的 `runText` **只接受 `jsonMode→responseFormat`，不透传 `temperature`/`maxOutputTokens`，无 `tools`/`abortSignal` 入参**——当前 `runText` 不支持温度。
- **落地方案**：`store/agentDeployStore.ts`(zustand+KV `studio:agentDeploy`)；agentKey ∈ decision/writer/artDirector/director/supervision/universal；`resolveAgentModel(key)→{model, params}`：advanced 用子层配置，simple 回退 decision/全局。**先扩展 `runText` 入参**：`params?:{temperature?,maxOutputTokens?}`（透传给 `ai.call({params:AiModelParameters})`）+ `abortSignal`，或新建 `runToolLoop` 统一传 `AiModelParameters`；runToolLoop/子 Agent 调用前取 `resolveAgentModel` 传入。UI 设置区「Agent 部署」表格(6 行模型/温度/maxTokens) + 简易/高级切换 + 「全部设为当前模型」。
- **复用**：`models.listTextModels`、providerStore 的 KV 模式、`ai.call` params（**runText 需先扩参才能透传**）。
- **待决策**：temperature/maxOutputTokens 经 ai.call 是否对所有端点生效，需实测。

### 6.4 技能库扩展（story_skills + production_skills + references + 动态拼接）`P1` · 工作量 L
- **Toonflow**：art_skills(画风) × story_skills(题材，画风无关) 正交；production_skills(双无关通用)；references(提取格式)；scanSkills 按 artStyle+storyName 动态拼可激活技能集，activate_skill 渐进披露。
- **现状**：仅 art_skills 2 画风；无 story/production/references；无 scanSkills。
- **落地方案**：
  - 文件：`src/ui/skills/story_skills/<genre>/director_skills/{director_planning_narrative, director_storyboard_table_narrative}.md`、`production_skills/*.md`、`references/*.md`。
  - 函数：`listStoryGenres()` / `composeNarrativePrompt(genreId,kind)` / `getProductionSkill(name)` / `getReferenceSkill(name)` / `scanSkills({artStyle,genre})→SkillMeta[]`(内存 REGISTRY 前缀过滤，零读盘) / `makeSkillTools(scope)→AgentTool[]`(activate_skill/list_skills 渐进披露)。
  - 项目 `ProjectMeta.genre`(已有)作题材键，启用 art×story 正交组合。
- **复用**：`import.meta.glob/parseSkill/REGISTRY/composeArtPrompt` 全复用，仅加查询函数 + md。
- **Mulby 替代**：scanSkills 退化为内存前缀过滤(无文件系统)；activate_skill 作 AgentTool execute 返回 skill 正文，渐进披露天然适配 tool-loop；无 ONNX → 同 Toonflow 生产域本就是文件系统拼接(非向量)。
- **待决策**：迁移多少画风/题材的 director_*（从 Toonflow 按需迁）。

### 6.5 供应商强类型 VideoModel `P2` · 工作量 M
- **Toonflow**：VideoModel{mode 判别联合 + durationResolutionMap + audio + associationSkills} 驱动参数面板。
- **现状**：MediaProviderConfig 运行时配置 + toapisModels 雏形未统一。
- **落地方案**：`services/providers/videoModels.ts: VideoModelSpec{id,label,providerId,mode:VideoMode[],audio,durationResolutionMap,associationSkills?}`；把 toapisModels 桥接为该形(toVideoModelSpec)；`listVideoModels(providerId?)` / `videoModeOf(modelId)`；生成时 generateClipVideo 据 spec 裁剪传首帧/尾帧/参考图/音频开关；UI 选模型后按 spec 渲染 mode/时长↔分辨率联动/音频开关。
- **复用**：`toapisModels.TOAPIS_VIDEO_MODELS/buildToapisVideoBody` 升级复用。

### 6.6 轻量记忆 / RAG `P1` · 工作量 M
- **Toonflow**：ONNX 三级记忆(短期+summary+RAG) + isolationKey 隔离 + deepRetrieve。
- **现状**：doc.memory 平铺，buildContext 近 6 条裸注入；无压缩/RAG。
- **落地方案**：`studio/agent/memory.ts: MemoryManager(doc, agentKey)`：`add(role,content)`；`getContext(query)→{shortTerm, summaries, rag}`；`maybeSummarize()`(未压缩 ≥阈值时 `runText` 压缩成 summary 标 summarized)。`embedding.ts`：若宿主有 embedding 模型则 embed+余弦（`AiModelType` 含 `'embedding'`），否则**关键词重叠召回**兜底；`deepRetrieve` 作决策 Agent 工具。**隔离键复用现有 `MemoryItem.agent` 字段**（不新增 `isolation` 字段，避免与 `agent` 语义重叠成第三套维度）：Toonflow `isolationKey=projectId:agentType[:episodesId]`，studio 单 doc 内退化为 `agent` 字段过滤。**多集隔离**：studio ProjectDoc 是单项目单文档（可含多 scripts/集），若未来一项目多集，`agent` 字段取复合值 `agentKey[:scriptId]` 以区分集（否则跨集记忆会串）；**本期单集假设，agent=agentKey**。阈值存 `studio:memoryConfig`；AgentPanel 加「清空/查看记忆」。
- **复用**：`textEngine.runText`、doc.memory(summarized 已预留)。
- **待决策**：宿主是否暴露可用 embedding 模型(AiModelType 含 'embedding')；不可用则降级关键词召回。

### 6.7 任务队列 `P2` · 工作量 M
- **Toonflow**：o_tasks + taskRecord withTaskRecord 包裹每次生成；任务中心分页/分类/筛选。
- **现状**：仅 batch.label，失败原因就地写 error。
- **落地方案**：`store/taskStore.ts`(KV `studio:tasks` 环形封顶 ~500)：`start({projectId,taskClass,model,describe})→id` / `done(id,ok,reason?)`；包装器 `withTask(meta, fn)` 包在 generate.ts 三函数 + compose 外层；UI「任务中心」抽屉(分类+项目+状态筛选 + 进行中 spinner/失败 reason)。
- **复用**：storage KV 模式、generate/compose 仅外层包装。

### 6.8 思考配置 + 停止 + 历史 `P2` · 工作量 S
- `runToolLoop` 接 abortSignal；AgentPanel 加停止按钮(abortText)、think 开关(ai.call reasoning 偏好)、清空记忆(all/message/summary)。
- **待决策**：宿主 ai.call 无显式 thinkLevel 参数 → 退化为「是否展示 reasoning」开关。

---

## 7. 画布 / 素材 / 提示词 融入工作台

> 核心：把素材库/提示词库/供应商/节点画布从「与工作台平级的顶层 Tab」收敛为「工作台内的资源 Dock + 设置抽屉 + 高级编辑入口」，**不重造**——四个全局 store 即插即用。

### 7.1 信息架构收敛（StudioShell）`P0` · 工作量 M
- **现状**：AppRail 把 studio/home/editor(节点画布)/assets/prompts/settings 做成 6 个平级顶层视图；资源库在工作台外。
- **落地方案**：App.tsx view 枚举收敛为 `'home' | 'studio'`。`StudioShell` = 顶栏(项目设置 + 一键成片) + 左侧资源 Dock(复用 `WorkbenchDock`，标签 素材/角色/提示词) + 中央阶段区(原著/剧本/资产/分镜/时间线/精修画布 Tab) + 右侧 AgentPanel + 设置抽屉(齿轮 overlay)。删除 assets/prompts/settings 顶层视图 → 改为 Dock 面板与抽屉；节点画布(EditorView)降级为工作台内「精修画布」Tab(承载 imageFlow / 高级编辑)。布局态存 `studio:ui`。
- **复用**：`WorkbenchDock`(整体作左 Dock)、`SettingsView/ProviderSettings`(塞进抽屉)、`AssetsView/PromptLibrary`(其内容已在 Dock 复用过)、`AppRail`(改 home/studio 二态)。

### 7.2 数据打通（已在 §3.6 详述，此处汇总）
- studio 产物进 `assets:registry`；GC `collectReferenced` 纳入 `studio:*`；角色经 `elementId` 双向桥接。

### 7.3 提示词片段库挂工作台输入框 `P1` · 工作量 S
- **现状**：studio 提示词输入未挂 snippets，未用 {变量}。
- **落地方案**：WorkbenchDock 提示词面板在 studio 上下文：点击片段 → 插入「最后聚焦的 textarea」(轻量 focus tracker：记录 last focused ref + 插入回调)，替代面向画布节点的 `appendTextToSelected`；分镜/资产/剧本关键 textarea 旁加「+片段」小按钮(复用 PromptLibrary 片段列表渲染)；`detectVars/resolveSnippet` 做 {变量} 填充。
- **复用**：`promptStore.snippets/resolveSnippet/detectVars/SNIPPET_GROUPS`、PromptLibrary 渲染。

### 7.4 节点画布降级为高级编辑入口
- 节点图(`graphStore`/nodeDefs/executor) **不删，降权**：作为工作台「精修画布」Tab，承载 imageFlow 多参考图编辑与高级 DAG 编辑；其 `mapPool` 抽出供 studio 并发复用；`insertAssetNode/insertElementNode` 作素材↔画布桥接保留。

---

## 8. 设置面与供应商体系补全 `P1`

工作台「设置抽屉」内嵌 6 子面板（Mulby 约束下大幅简化）：

| 子面板 | Toonflow | 落地（复用 + 简化） |
|---|---|---|
| **供应商 vendorConfig** | 可编程 TS(vm/sucrase) + modelTest(文本/图片/视频三类) | 复用 `providerStore`+`presets`+`services/keys`+`ProviderSettings` 塞抽屉；**不复刻 vm 沙箱**(声明式 custom-http 更安全已覆盖)；`modelTest` **覆盖三类**：文本=`host ai.call`(可顺带验 tool-calling，正好服务 R1)、图像=`host ai.images.generate`、视频=`runVideo` 短 prompt 测连通 |
| **Agent 部署 agentDeploy** | 16 子层 | §6.3，6 行模型/温度 + 简易开关 + 「全部设为当前模型」(无需填 Key，用宿主模型) |
| **提示词管理 promptManage** | o_prompt 4 条 | 复用 `promptStore.globalOverrides` 三层覆盖(比 Toonflow 强)，抽屉嵌「提示词管理」编辑 + 还原默认 |
| **模型映射 modelMap** | 视频模型↔md | 轻量 KV `studio:modelPrompt = Record<videoModelId, templateText>`，videoPrompt 命中自定义模板 |
| **技能浏览 skillManagement** | md 在线读写 | skills 构建期内联**只读展示**(listArtStyles/listSkills + 正文预览)；编辑降级为「用户画风覆盖」KV `studio:customStyles`，stylePacks 合并优先用户覆盖 |
| **记忆配置 memoryConfig** | 8 参数 + ONNX | §6.6，3 数字(shortTermLimit/messagesPerSummary/summaryMaxLength) + 清空记忆；无向量则 LLM 文本判相关 |

- **供应商体系两套，测试入口分两处**：**文本/图像供应商 = 宿主模型选择（`models` 服务 / `ai.call` / `ai.images`），无自定义供应商**；`providerStore` **仅管 video/music/tts** 三类自定义供应商。故 `modelTest`：文本/图像测试走宿主模型（在「Agent 部署/图像模型选择」处），视频/音乐/配音测试走 `providerStore`（在「供应商」面板）——**测试入口需分两处**，不要把文本/图像测试错放进 providerStore 面板。
- **待决策**：供应商/Agent 部署是全局配置 → ProjectHome 也应提供同一设置抽屉入口(无项目时仍可配)。

---

## 9. UI / 信息架构（三位一体）

### 9.1 StudioShell 整体布局线框
```
┌───────────────────────────────────────────────────────────────────────────┐
│ 顶栏  ← 返回 | 项目名 | 画风▾ | 画幅▾ | 视频模型/模式/分辨率▾ | ⚙设置 | ▶一键成片 │
├──────────┬──────────────────────────────────────────────┬───────────────────┤
│ 左 Dock  │ 中央阶段区（Tab：原著/剧本/资产/分镜/时间线/精修）│ 右 Agent 对话面板  │
│ ─────── │ ──────────────────────────────────────────── │ ───────────────── │
│ [素材]   │  ┌ 资产 Tab ───────────────────────────────┐  │ 工具调用步骤流(折叠)│
│ [角色]   │  │ 角色组  ┌卡:缩略|名|desc|prompt态|衍生▾┐  │  │  统筹/编剧/美术/导演│
│ [提示词] │  │        └ 润色 生成 多图▾ 存库 ✎精修 ──┘  │  │  /监制 头像区分     │
│          │  │ 场景组 / 物品组 / 音色组(audio)          │  │ ─────────────────  │
│ 片段拖拽 │  └─────────────────────────────────────────┘  │ 消息(markdown)     │
│ /插入    │  ┌ 分镜 Tab：分镜表 ⇄ 分镜面板 ─────────────┐  │ ─────────────────  │
│          │  │ 面板格:缩略|videoDesc|详情▾(时长/track/  │  │ 输入框 | ⏹停止 | 发送│
│          │  │ 关联资产chip/prompt/对白) | 关键帧 ✎ 编辑 │  │ 🎬导演手册 | 🧠记忆  │
│          │  └─────────────────────────────────────────┘  │                    │
│          │  ┌ 时间线 Tab：段卡片序列 ─────────────────┐  │                    │
│          │  │ [段1: 分镜缩略|prompt|时长|候选横排⊙当选]│  │                    │
│          │  │ [段2 ...] [+新增段]  转场▾  合成成片 ▶   │  │                    │
│          │  └─────────────────────────────────────────┘  │                    │
└──────────┴──────────────────────────────────────────────┴───────────────────┘
```

### 9.2 关键交互
- **资产卡**：缩略(角标计数→多图抽屉) | 名 | desc textarea | prompt textarea + 润色态徽标 | [润色][生成] 两步 | [衍生▾ 横排] | [存库/从库选用] | [✎精修(imageFlow)]。
- **音色组**：audio 父分组 + 子音色试听条；角色卡「选择音色」下拉 + 「AI 智能匹配」批量 + 进度灯。
- **分镜表/面板二级切换**：分镜表(场→片段→可编辑表格 + 「生成分镜面板」) ⇄ 面板格(详情折叠 + 关键帧 ✎ 编辑灯箱)。
- **时间线段卡片**：聚合分镜缩略 + 段 prompt(生成/可改) + 段时长 + 候选视频横排(当选高亮/选优/删/再生) + 段批量 + 转场下拉 + 合成。
- **Agent 面板**：工具调用步骤流折叠(对齐 Toonflow thinking) + 多角色身份(统筹/编剧/美术/导演/监制) + 停止 + 导演手册 + 记忆入口。
- **精修画布 Tab**：ImageFlowEditor(参考图勾选栅格 + prompt + 模型/比例 + 重生 + 设为关键帧)，节点画布作高级编辑入口。

### 9.3 数据流时序（同进程直调替代 Toonflow socket）

> Toonflow 用 socket `emit` 把工具执行结果推给前端；Mulby 沙箱无 socket，用「同进程 zustand action + 订阅刷新」等价替代。

```
用户发话
  │
  ▼
runToolLoop(model, messages, tools, abortSignal)        ← §6.1 顶层 AbortController
  │  ai.call 流式 → 收集 tool_call chunk
  ▼
工具 execute(args)
  │  直调 useProjectStore.getState().upsert*/generate*   ← 替代 Toonflow socket.emit
  ▼
projectStore mutate（改 ProjectDoc 内存态）
  │  ├─ 触发 zustand 订阅 → UI 即时刷新（替代 socket 推送给前端）
  │  └─ 防抖落盘 saveProject（KV/attachment）             ← 替代 SQLite 写库
  ▼
工具结果回灌 messages → 再次 ai.call（循环至无 tool_call / maxSteps）
  │  onStage/onToolCall/onToolResult 回调 → AgentPanel 步骤流（替代 socket thinking 推送）
  ▼
停止：顶层 abort → 经 AbortController 链路传播取消子/并发调用（§6.1.1）
```
| Toonflow（socket/SQLite） | Mulby 等价 |
|---|---|
| `socket.emit('asset:update')` 推前端 | zustand action mutate → 订阅组件自动重渲 |
| 工具 execute 写 SQLite | projectStore mutate + 防抖 saveProject(KV/attachment) |
| 轮询 `pollingImage`/`checkVideoState` | 同进程 await + mutate 回写，无需轮询接口 |
| streamText thinking 经 socket | runToolLoop onStage/onToolCall 回调 → AgentPanel |

---

## 10. 分阶段实施路线

> 每阶段产物**可编译、可验收**；优先「防误删 GC」与「真 tool-loop 验证」两件高风险前置事项。

| 阶段 | 内容 | 优先级 | 工作量 | 验收 |
|---|---|---|---|---|
| **0 前置加固** | ① assetRegistry.collectReferenced 纳入 studio:*（防 GC 误删）② echo 工具实测宿主 tool-calling 行为 | P0 | S | 现有 studio 资产不被 gcOrphans 删；确认 tool-loop 策略 |
| **1 信息架构收敛** | StudioShell：WorkbenchDock 作左 Dock + 设置抽屉 + view 收敛 home/studio；节点画布降级 Tab；提示词片段挂输入框 | P0 | M | 一个项目工作台内含资产/分镜/时间线/Agent/资源/设置 |
| **2 数据模型演进** | types.ts 全量增量 + loadProject normalizeTrack 迁移 + 独立 KV store 骨架 | P0 | M | 旧 doc 正常打开，新字段就位，tsc/build 通过 |
| **3 时间线重构** | VideoTrack 实体 + syncTracksFromStoryboards + 一镜多生选优 + 段时长 + 项目级视频参数 | P0 | L | 段卡片序列、候选并排选优、段时长可改 |
| **4 视频提示词 4 模式** | video_modes md + videoPrompt 服务 + 段提示词生成/编辑 | P0 | L | 选模型→自动套模板生成段 prompt，可手改 |
| **5 资产衍生 + 润色** | 衍生 img2img + polish 两段式 + prompt 手动编辑 + 导演技能注入接上 | P0/P1 | M | 衍生换装一致、润色态可见、画质提升 |
| **6 真 tool-loop Agent** | runtime.runToolLoop + 子 Agent 即工具 + 工具集 + AgentPanel 步骤流 + 兜底 jsonMode | P0 | L | 一句话→Agent 多步工具调用可见可中断 |
| **7 多图 + imageFlow** | 一资产多图抽屉 + ImageFlowEditor 关键帧精修 + 分镜面板字段编辑 + 分镜表层 | P1 | L | 历史图切换、多参考图精修回写、分镜表审核 |
| **8 音频配音** | 音色库 + 角色↔音色 + AI 匹配 + compose 注入(原生/ffmpeg 双路) | P1 | L | 角色配音绑定 + 成片含对白音轨 |
| **9 设置面 + agentDeploy + 记忆** | 设置抽屉 6 面板 + agentDeployStore + MemoryManager(摘要/关键词召回) | P1 | M | 按 Agent 配模型、记忆压缩、供应商在工作台配 |
| **10 收尾** | 双轨桥接(elementId 双向) + 任务队列 + 批量并发/取消 + 分镜墙预览 + 转场/拖拽 | P1/P2 | M | 跨项目角色复用、任务中心、并发提速、故事板导出 |

### 风险 / 待决策
- **R1 宿主 tool-calling 语义**（阶段0 必验）：若宿主不等插件执行自定义函数，手动循环是唯一路径；不支持的模型保留 jsonMode 双路径。
- **R2 GC 误删**（阶段0 必做）：现有 studio 资产尚未被 collectReferenced 保护。
- **R3 ai.call params**：temperature/maxOutputTokens 是否对所有端点生效需实测。
- **R4 embedding 可用性**：宿主无可用 embedding 模型则 RAG 降级关键词召回。
- **R5 events stub（已裁决：删）**：本期删 EventNode/doc.events stub 减负（章节事件用 NovelChapter.event 文本承载）；§2.1 已统一口径采纳此裁决（`events:EventNode[]` 现为必填，删除时需同步清理 newProject/loadProject 的 `events:[]` 初始化点）。需要事件图谱再单独立项。
- **R6 衍生 vs ElementRef.appearanceVariants**：统一则 studio 衍生映射为 ElementRef 变体，避免第三套变体模型（待定，先 studio 内 parentAssetId）。
- **R7 VideoTrack 迁移**：loadProject 一次性 normalize，避免破坏旧项目。

---

## 11. 实施进度（loop 跟踪）

> 按 §10 路线逐阶段实现，每阶段产物可编译（tsc --noEmit + vite build 通过）并提交。运行态验收（需在 Mulby 实测）单列标注。

- [x] **阶段 0 前置加固**（commit 待提交）
  - ① **GC 防误删**：`assetRegistry.ts` 新增 `collectStudioReferenced`，`collectReferenced` 现额外扫描 `studio:index`→各 `studio:project:<id>` 文档，收集 `assets[].refImageId`、`assets[].images[].refImageId`（向前兼容 phase7）、`assets[].variants[].refImageId`、`storyboards[].keyframeImageId`、`imageFlows[].nodes[].assetId`（向前兼容 phase7）。工作台资产图/关键帧不再被 `gcOrphans` 误删（R2 闭环）。
  - ② **tool-calling 探针**：新增 `studio/agent/toolCallingProbe.ts`（`runToolCallingProbe`/`registerToolCallingProbe`），`StudioApp` 挂载时注册 `window.__filmStudioProbe`。发一个 echo 自定义 function 工具、强制模型调用、观察 chunk（`tool_call`/`tool_result`/chunkType），`inference` 字段直接给结论「手动 tool-loop / 宿主自动执行 / 不支持」。
  - **运行态待验收（Mulby）**：① 跑 `gcOrphans` 后工作台资产图仍在（GC 不误删）；② 控制台执行 `await window.__filmStudioProbe()` 确认 R1（宿主对自定义 function 工具的语义），据此定 phase6 的 tool-loop 策略。
  - tsc + vite build 通过。

- [x] **阶段 1 信息架构收敛 StudioShell**（commit 待提交）
  - **一级导航收敛**：`AppRail` 只保留「项目 / 工作台」两项；素材/提示词/画布不再作平级顶层视图（旧画布工程仍可从项目页打开，`editor` 视图保留作兼容入口）。
  - **左侧资源 Dock**（§7.1）：新增 `studio/StudioDock.tsx`（素材 | 提示词 两标签），复用 `AssetsView` 缩略图组件 + `assetStore` + `promptStore` 片段，**全部复用画布 Dock 的 CSS 类（afs-dock\*）**。`StudioEditor` 工作区现为 `Dock | 阶段区 | Agent` 三栏，Dock 可经 tabs 栏 `PanelLeft` 按钮收起/展开。
  - **片段/资产名插入聚焦输入框**（§7.3）：新增 `studio/services/focusInsert.ts`（`installFocusTracker`/`insertAtFocused`）——跟踪最后聚焦的 input/textarea，用「原生 value setter + dispatch input 事件」让受控组件的 onChange 接管并写回 store；Dock 内点击素材→插名、点击片段→插正文。
  - **节点画布作高级编辑入口**（§7.4）：节点画布(`EditorView`)作为独立子系统（自带工程，与工作台项目互不相通）。〔修订〕初版曾嵌为工作台「精修」Tab，但与分镜关键帧精修重名且显示无关工程 → 现移回**左侧一级导航「画布」**（AppRail），不混入工作台阶段标签。关键帧精修走「分镜」每镜的「精修」按钮（ImageFlowEditor）。
  - **设置抽屉**（§7.1/§8）：顶栏齿轮按钮打开右侧抽屉内嵌 `SettingsView`（供应商/提示词/外观/存储），无需离开工作台。
  - **布局态持久化**：`studio:ui` KV 记录 `{stageTab, dockOpen}`，重开工作台恢复。
  - tsc + vite build 通过。运行态布局/视觉待 Mulby 实测。

- [x] **阶段 2 数据模型演进**（commit 待提交）
  - **types.ts 全量增量**（§2.1）：`AssetType` 增 `audio`/`clip`；新增 `PromptState`/`VideoMode`/`AssetImage`/`FlowNode`/`ImageEditFlow`/`VideoTrack`/`StoryboardTableRow|Segment|Scene`；`Asset` 补 images/currentImageId/promptState/derivedFromImageId/elementId/flowId/音色字段(audioFilePath/sex/voiceAssetId/audioBindState)；`AssetVariant` 补 state/error；`Storyboard` 补 flowId；`Clip` 补 trackId/prompt/createdAt/posterImageId；`MemoryItem` 补 embedding/relatedIds；`ProjectMeta` 补 videoResolution/audioReferenceCount/concurrency/transition；`ProjectDoc` 改 `track: VideoTrack[]` + 增 storyboardTable/imageFlows。
  - **R5 裁决落地**：删除 `EventNode` 与 `ProjectDoc.events`（章节事件用 `NovelChapter.event` 文本承载）；同步清 `emptyProjectDoc` 的 `events:[]`。
  - **迁移（§2.1.1）**：`loadProject` 内新增 `normalizeDoc`——旧 `VideoTrackItem{storyboardId}` → `VideoTrack{storyboardIds:[..],order}`（幂等）+ 必填数组兜底；旧 doc 残留 events 字段无害忽略。**同步改对全部受影响调用点**：`generate.ts` ASSET_ROLE 改 `Partial<Record>` + `?? 'character'` 兜底、audio/clip 提前 return；`projectStore`（removeStoryboard 段内去分镜+空段删除、generateClip 段定位/新建改 storyboardIds+order）；`compose.ts:21`、`StudioEditor` TimelineTab 轨道定位改 `storyboardIds.includes`。
  - **独立 KV store 骨架**（§2.2）：新增 `domain/studioKv.ts`——`STUDIO_KV` 键表 + 强类型读写 + `AgentDeployDoc`/`TaskRecord`/`MemoryConfig`(默认值)/`ModelPromptMap` 类型，供 phase6/9/10 接入。
  - 旧项目向后兼容（normalizeDoc 迁移）。tsc + vite build 通过。

- [x] **阶段 3 时间线重构**（commit 待提交）
  - **段同步服务**（§5.1）：新增 `studio/services/track.ts`——`syncTracksFromStoryboards`（1 分镜=1 段惰性补齐：去删除分镜引用、空段删除、保留素材段、按分镜 index 排 order，幂等）+ `trackOfStoryboard`/`selectedClipId`。在 init/openProject/分镜增删改/Agent 应用方案后调用。
  - **projectStore 时间线动作**：`syncTracks`/`selectClip`/`deleteClip`/`updateTrackDuration`；`generateClip` 重构为**一镜多生选优**（§5.2）——每次生成新建候选并自动选中，重试「失败」候选则就地覆盖（不堆孤儿），防重入；承接首帧改用段选用片段尾帧。
  - **段时长 + 扩参**（§5.4）：`generateClipVideo` 签名改为 `(sb, meta, opts:{firstFrameUrl?,durationSec?,onProgress?})`；`generateClip` 传 `track.duration`，时长钳 [4,15] 不变。（lastImageUrl 尾帧顺接因 runVideo req 暂无该字段，留待 provider 能力核实后接入。）
  - **时间线 UI 重构**：`TimelineTab` 从扁平片段列表 → **段卡片序列**（`TrackCard`）：每段显关键帧缩略 + 画面描述 + 段时长输入 + 候选片段横排（`CandidateClip`：当选高亮/选优/预览/删除/再生一版）；`StoryboardItem` 视频态改取段选用候选；删除旧 `TrackClip`。
  - **项目级视频参数**（§5.8）：`StudioModelBar` 模型弹层加视频供应商下拉（`setDefault('video')`）+ 视频模式（4 模式）+ 分辨率，写入 `meta.videoMode/videoResolution`。
  - tsc + vite build 通过。运行态待 Mulby 实测（含旧项目段迁移、候选选优、段时长生效）。

- [x] **阶段 4 视频提示词 4 模式**（commit 待提交）
  - **模式模板**（§5.3）：新增 `src/ui/skills/video_modes/{firstFrame,startEndFrame,multiRef,singleImageFirst}.md`（原创撰写，非照搬）——含 12 字段拆解（画面/场景/资产名/时长/景别/运镜/动作/情绪/光影/台词/音效/资产ID）、台词标注 `dialogue/OS/VO`、@图N 编号锁定、时间分段 ≥1s，各模式补首帧/首尾帧/多参/单图首帧差异；frontmatter 标 modeKey。`skillSystem.getVideoModeSkill(mode)` 经现有 `import.meta.glob` 自动打包。
  - **videoPrompt 服务**：新增 `studio/services/videoPrompt.ts`——`routeVideoMode(model, videoMode)`（段级 videoMode 优先；否则模型名子串 wan2.6→singleImageFirst / seedance→multiRef / 默认 firstFrame）；`generateTrackVideoPrompt(track, doc)`（system=模式模板+`composeArtPrompt(artStyle,'storyboard_video')` 视觉手册，user=段内分镜画面/台词/出场资产@图N顺序/时长，走 host `runText`）。
  - **store**：`updateTrackPrompt`/`generateTrackPrompt`/`generateAllTrackPrompts`（写 `track.prompt`/`promptState`）；`generateClipVideo` 扩 `promptOverride`，`generateClip` 传 `track.prompt`（无则回退硬拼 motion）。
  - **UI**：TrackCard 加段提示词 textarea（可生成/手改）+「提示词」按钮 + promptState；TimelineTab 顶部「全部段提示词」批量按钮。
  - tsc + vite build 通过。运行态待 Mulby 实测。

- [x] **阶段 5 资产衍生 + 润色**（commit 待提交）
  - **两段式润色**（§3.2）：新增 `studio/services/polish.ts`——`polishAssetPrompt`（system=`composeArtPrompt(artStyle, kind, {derivative})` 美术手册，缺手册回退兜底；user=名称+描述+画风→英文提示词，走 `runText`）。store `polishAsset`/`polishAllAssets` 写 `asset.prompt`/`promptState`。**美术手册（art_prompt）至此真正进入生成路径**。
  - **衍生资产 img2img**（§3.1）：`generate.ts` 新增 `generateDerivativeImage(child, parent, meta)`——父图作 img2img 主参考 + `DERIVATIVE_CLAUSE`（恒附身份保持兜底）+ 画风锚定。store `addDerivative`/`generateDerivative`（删子复用 `removeAsset`）。
  - **缺失 .md 交付**（§4.9）：新增 `cinematic_realistic/art_prompt/art_{character,scene,prop}_derivative.md`（原创：锁身份/形制/空间，只改外层），令 `composeArtPrompt({derivative:true})` 不再静默回退。
  - **UI**：AssetCard 加英文提示词 textarea（可手改）+「润色」「生成」两步 + promptState + 可展开「衍生」横排（DerivativeCard）；AssetsTab 加「全部润色」批量、网格过滤掉衍生子项（衍生嵌在父卡片下）。
  - 注：§4.7 director_* 导演技能注入留待 phase6 Agent；本阶段先把 art_prompt 手册经润色接上。
  - tsc + vite build 通过。运行态待 Mulby 实测。

- [x] **阶段 6 真 tool-loop Agent（实验路径 + 兜底双轨）**（commit 待提交）
  - **§6.1.1 / §6.3 groundwork**（可验证）：`textEngine.runText` 加 `abortSignal`（中断时 abort 本次 req，不复用全局单例，支持嵌套/并发）+ `params`（temperature/maxOutputTokens 透传 ai.call，为 agentDeploy 铺路）。
  - **工具循环运行时**（§6.1）：新增 `studio/agent/runtime.ts`——`AgentTool` 接口 + `runToolLoop`（每次 ai.call 用传入 signal 独立中断；**格式无关回灌**：工具结果作 role+string 消息喂回，不依赖未知的结构化 tool-result 消息格式，故支持 function-calling 的模型可用、不支持则降级为只回文本）。
  - **工具集**：新增 `studio/agent/agentTools.ts`——`makeAgentTools(get)` 暴露 get_workspace/upsert_script/add_asset/add_storyboard/generate_asset/generate_keyframe/generate_clip，同进程直调 projectStore（替代 socket.emit）。
  - **store**：`runAgentToolLoop`（实验路径，独立 AbortController）+ `abortAgent`（abortText 兜底 + controller.abort）；`agent.ts` 加 `buildToolLoopSystem`；导出 `ProjectState`。
  - **UI**：AgentPanel 加 🛠 原生工具调用开关（默认关→走 jsonMode 管线）+ 生成中「停止」按钮（abortAgent）。
  - **⚠ R1 仍待 Mulby 实测**：原生工具循环依赖宿主对自定义 function 工具的行为；未生效则继续用默认 jsonMode 确定性管线（常驻兜底，不影响现有流程）。建议先用 phase0 探针 `window.__filmStudioProbe()` 确认。
  - tsc + vite build 通过。

- [x] **阶段 7 多图 + imageFlow + 分镜字段编辑**（commit 待提交）
  - **一资产多图历史**（§3.3）：`generateAsset`/`generateDerivative` 改为追加 `AssetImage` 候选（`pushAssetImage`，不再覆盖）+ 设当前 `currentImageId`/`refImageId`；store `selectAssetImage`/`deleteAssetImage`（删图同步 `deleteAsset` 回收附件，防泄漏）。AssetCard 多于 1 张时显历史候选条（点选/删除）。
  - **关键帧精修 imageFlow**（§4.4）：新增 `studio/services/imageFlow.ts`（`runFlowImage`：多参考图 `editImage` 融合 + 画风锚定，= Toonflow generateFlowImage 核心）；store `refineKeyframe`；`ImageFlowEditor` 灯箱（参考图勾选栅格【复用资产库已出图】+ 当前关键帧 + 精修提示词 → 生成并设为关键帧）。StoryboardItem 加「精修」入口。**这是「把画布/资产库融入工作台」的落地之一**（不引入 React Flow，用勾选列表覆盖核心多图融合；节点图 edges 作 P2）。
  - **分镜面板字段完整编辑**（§4.5）：StoryboardItem「详情」折叠区——时长/轨道/出场资产（chips 多选自资产库）/关键帧提示词/对白（角色+台词+情绪 增删行），全走现有 `upsertStoryboard`。
  - 注：分镜表设计层（§4.1）作 P1 留到阶段 10 收尾接入（需 Agent 配合）。
  - tsc + vite build 通过。运行态待 Mulby 实测。

- [x] **阶段 8 音频配音（音色库 + 绑定 + AI 匹配）**（commit 待提交）
  - **音色库**（§3.4）：audio 成为一等资产；新增 `studio/services/audio.ts`——`synthVoiceSample`（复用 `tts.synthSpeech` + 默认 tts 供应商 baseURL/key/model/voice 落盘试听）、`listProviderVoices`、`matchRoleVoices`（LLM jsonMode 角色↔音色匹配，替代 Toonflow resultTool）。`Asset` 加 `voice` 字段（供应商音色 id）。
  - **store**：`addVoice`/`synthVoice`（落盘试听写 audioFilePath/audioUrl）/`bindRoleVoice`/`autoBindVoices`（AI 匹配批量绑定 + audioBindState）。
  - **UI**：AssetsTab 加「音色」库（VoiceCard：名/供应商音色下拉/描述/试听 audio 播放器/删除）+「AI 配音匹配」按钮；角色 AssetCard 加音色绑定下拉（voiceAssetId）。
  - **⚠ 合成注入（§5.5）留到阶段 10**：现 ffmpeg `AudioTrack` 仅 `{path, role}` 无时间偏移，按段精确对白需给 AudioTrack 加 start 或按段拼接对齐——作阶段 10 收尾项（含 provider 原生音频路径 A 能力门控 + ffmpeg 后期路径 B）。本阶段先打通音色管理与绑定。
  - tsc + vite build 通过。运行态待 Mulby 实测（需配 tts 供应商）。

- [x] **阶段 9 设置面 + agentDeploy + 记忆**（commit 待提交）
  - **轻量记忆/RAG**（§6.6）：新增 `studio/agent/memory.ts`——`recallContext`（历史摘要 + 关键词召回相关历史 + 近期对话）+ `maybeSummarize`（累积超阈值 LLM 压缩较早对话成 summary，标 summarized）+ `getMemoryConfig`。`agent.buildContext(doc, memoryText?)` 接入召回；`runAgentPipeline`/`buildToolLoopSystem` 用 `recallContext`；`runAgent`/`runAgentToolLoop` 结束后 `maybeSummarize`（长会话不丢主线、省 token）。
  - **agentDeploy**（§6.3）：新增 `store/agentDeployStore.ts`（简易/高级、按 Agent 模型/温度、`setAllModel`、`resolve(key)`）；`runAgentToolLoop` 用 `resolve('decision')` 的模型 + params（经 phase6 已扩参的 runText/runToolLoop 透传温度）。StudioApp 挂载即 load。
  - **设置抽屉面板**（§8）：新增 `studio/StudioSettings.tsx`（Agent 部署表格 + 记忆配置），与画布 `SettingsView`（供应商/外观/存储）并列进设置抽屉。
  - 注：pipeline 各执行子 Agent 的逐层 model/params 透传作增量（本期 toolloop 路径已用 agentDeploy；pipeline 仍用全局 model）。
  - tsc + vite build 通过。运行态待 Mulby 实测。

- [x] **阶段 10 收尾**（commit 待提交）
  - **整片转场选择**（§5.7）：时间线顶栏转场下拉（淡入淡出/交叉溶解/硬切）→ `meta.transition`；`compose.ts` 改用 `meta.transition`（不再硬编码 fade）。ffmpeg 转场能力既有。
  - **分镜墙预览/导出**（§4.6）：分镜 Tab「预览故事板」→ `StoryboardWall` 纯前端 Canvas 2D 把关键帧拼 S## 编号网格 + 导出 PNG（零新依赖，替代 Toonflow sharp）。
  - tsc + vite build 通过。运行态待 Mulby 实测。

---

### 收尾说明：已完成 vs 进阶可选

**已完成（阶段 0-10，全部 tsc + vite build 绿）**：前置加固(GC/探针) → 信息架构收敛(资源 Dock/设置抽屉/精修画布) → 数据模型演进 → 时间线重构(段/一镜多生选优/段时长) → 视频提示词 4 模式 → 资产衍生+两段式润色 → tool-loop Agent(实验)+记忆/agentDeploy → 多图历史+imageFlow 精修+分镜字段 → 音色库+绑定+AI匹配 → 转场+分镜墙。**工作台相对 Toonflow 的资产/分镜/时间线三大块核心差距已补齐**，画布/素材库/提示词已融入工作台。

**进阶可选（未做，按需再立项；多为 P2 或依赖运行态验证）**：
- **R1 原生 tool-loop 落地**：依赖 Mulby 实测宿主自定义工具行为（探针已就绪）；当前 jsonMode 管线为常驻默认，不阻塞使用。
- **§5.5 配音合成注入**：音色已可绑定，但「成片听到对白」需 ffmpeg `AudioTrack` 加时间偏移或按段拼接对齐（+ provider 原生音频路径 A 能力门控）。
- **§4.1 分镜表设计层**：分镜表 markdown 中间产物 + Agent 分镜表→面板两段式（需 Agent 配合）。
- **§3.6 双轨桥接「存入素材库/从库选用」**：studio 资产 ↔ 全局 ElementRef 双向（GC 防误删已在阶段0 完成）。
- **§6.7 任务队列**、**批量并发/取消(mapPool)**、**§5.7 拖拽重排/裁剪**、**§6.5 供应商强类型 VideoModel**、**pipeline 逐层 agentDeploy**、**imageFlow 节点图 edges**、**story_skills/production_skills 全量技能库**、**更多画风/题材 .md**。

> **强烈建议**：在 Mulby 中实跑工作台（配文本+图像模型 + 视频/tts 供应商），用 `window.__filmStudioProbe()` 确认 R1，再决定是否推进原生 tool-loop 与配音合成注入。所有阶段均独立可用、向后兼容旧项目。
