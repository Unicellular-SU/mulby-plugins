/**
 * Toonflow 式重构 · 阶段2：结构化数据模型（阶段2 演进版，见 docs/toonflow-workbench-parity-design.md §2）。
 *
 * 用「结构化项目」取代自由连线节点图：项目 → 小说(可选) → 剧本 → 资产 → 分镜 → 视频段/轨道。
 * 每个项目持久化为一份 JSON 文档（ProjectDoc），存 host storage（key=studio:project:<id>）。
 * 全部新增字段可选、向后兼容旧 doc（loadProject 内 normalizeDoc 一次性迁移 track + 兜底数组）。
 */

export type AssetType = 'role' | 'scene' | 'prop' | 'audio' | 'clip' // [阶段2] 增 audio(音色)/clip(片段素材)
export type GenState = 'idle' | 'generating' | 'done' | 'failed'
export type PromptState = 'idle' | 'polishing' | 'done' | 'failed' // [阶段2] 提示词润色态
/** 视频生成模式（对标 Toonflow 视频模式枚举，§5.3） */
export type VideoMode = 'firstFrame' | 'startEndFrame' | 'multiRef' | 'singleImageFirst'

/** 项目元信息（轻量，进 index 卡片） */
export interface ProjectMeta {
  id: string
  name: string
  intro?: string
  genre?: string // 题材/类型（古风/都市/悬疑…）
  artStyle: string // 画风 = stylePack/skill id（如 cinematic_realistic）
  videoRatio: '16:9' | '9:16' | '1:1' | string
  imageModel?: string // host 图像模型 id
  videoModel?: string // 供应商:模型
  videoMode?: VideoMode | string // 视频模式（兼容旧 string）
  videoResolution?: '480p' | '720p' | '1080p' | string // [阶段2]
  dialogueLang?: string // 对白语言（默认中文）
  directorManual?: string // 导演手册：全局风格/节奏意图，注入各 Agent
  audioReferenceCount?: number // [阶段2] 每段注入配音上限（对标 audioReference:N）
  concurrency?: number // [阶段2] 批量并发数（默认 3）
  transition?: 'none' | 'fade' | 'xfade' // [阶段2] 整片转场
  createdAt: number
  updatedAt: number
}

/** 小说章节（可选入口：长文改编）。章节事件用 event 文本承载（R5：不再单立 EventNode 图谱） */
export interface NovelChapter {
  id: string
  index: number
  title: string
  text: string
  event?: string // 抽取的章节事件摘要
  eventState?: GenState
}

/** 剧本 */
export interface Script {
  id: string
  name: string
  content: string
  createdAt: number
  updatedAt: number
}

/** 资产变体（时期/状态/换装） */
export interface AssetVariant {
  id: string
  label: string
  desc?: string
  prompt?: string
  refImageId?: string // 资产库 assetId
  libraryVariantId?: string // 来源身份资产变体 id；本地 id 可独立演进
  variantKind?: 'age' | 'outfit' | 'makeup' | 'injury' | 'state' | 'time' | 'weather' | 'custom'
  parentVariantId?: string
  appliesTo?: string[] // 对齐节拍/段落关键字
  appliesToEpisodeIds?: string[]
  appliesToSceneIds?: string[]
  appliesToStoryboardIds?: string[]
  tags?: string[]
  state?: GenState // [阶段2]
  error?: string // [阶段2]
}

export interface ProjectAssetLibraryLink {
  entityId: string
  entityVersion?: number
  syncPolicy: 'linked' | 'snapshot' | 'forked'
  variantMap?: Record<string, string> // local AssetVariant.id -> LibraryVariant.id
  lastSyncedAt?: number
}

/** 一资产多图历史候选（对标 o_image，§3.3） */
export interface AssetImage {
  id: string
  refImageId: string // 资产库 assetId
  model?: string
  resolution?: string
  createdAt: number
  state: GenState
  error?: string
}

/** 资产（人物/场景/物品 + 衍生 + 音色） */
export interface Asset {
  id: string
  type: AssetType
  name: string
  aliases?: string[] // 角色/场景/道具的别名，用于跨集复用和 Agent 匹配
  prompt?: string // 英文生成提示词
  desc?: string // 中文描述
  refImageId?: string // 主参考图（= 当前选定图的 refImageId；selectAssetImage 时同步写回）
  parentAssetId?: string // 非空=衍生资产（或音色子项归属父音色组）
  variants?: AssetVariant[]
  state: GenState
  error?: string
  // —— 阶段2 新增 ——
  images?: AssetImage[] // 历史候选图（§3.3）
  currentImageId?: string // 当前选定 AssetImage.id
  promptState?: PromptState // 提示词润色态（§3.2）
  promptError?: string
  derivedFromImageId?: string // 衍生所用父图（img2img 来源，§3.1）
  elementId?: string // 桥接全局 assetStore.ElementRef.id（§3.6）
  libraryLink?: ProjectAssetLibraryLink
  flowId?: string // 资产精修画布引用（指向 doc.imageFlows，§4.4）
  // —— 音色子资产(type:audio) 专用 ——
  voice?: string // 供应商音色 id（用于合成）
  audioFilePath?: string // 试听音频本地路径（tts 落盘）
  audioUrl?: string
  sex?: string // audio 父资产性别标签
  // —— 角色音色绑定(type:role) ——
  voiceAssetId?: string // 指向 type:audio 的子音色 Asset.id（一对一，§3.4）
  audioBindState?: GenState // AI 配音绑定状态
}

/** 分镜面板 */
export interface Storyboard {
  id: string
  episodeId?: string
  index: number
  track: string // 轨道名标签（分组/段落）——注意与 ProjectDoc.track(视频段数组) 同名不同义
  videoDesc: string // 画面描述（中文，给关键帧/视频）
  prompt?: string // 英文关键帧提示词
  shotSize?: string // 景别（远景/全景/中景/近景/特写…）—注入关键帧+视频提示词
  cameraMove?: string // 运镜（固定/推/拉/摇/移/跟…）—注入视频提示词
  duration: number // 推荐视频时长(秒)
  associateAssetIds: string[] // 出场资产
  castRefs?: StoryboardCastRef[] // 精确出场资产引用（支持同一角色的妆容/服装/年龄变体）
  shouldGenerateImage: boolean
  keyframeImageId?: string // 关键帧图（资产库 assetId）
  chainFromPrev?: boolean // 承接上一镜（关键帧链式/尾帧接龙）
  sceneId?: string // 同场判断
  dialogues?: { character: string; line: string; emotion?: string }[]
  flowId?: string // [阶段2] 关键帧精修画布引用（§4.4）
  state: GenState
  error?: string
}

export interface StoryboardCastRef {
  assetId: string
  variantId?: string
  roleInShot?: 'lead' | 'supporting' | 'background'
  note?: string
}

/** 图像编辑流节点（对标 o_imageFlow 的 nodes，§4.4） */
export interface FlowNode {
  id: string
  type: 'upload' | 'generated'
  assetId?: string // 该节点图片的资产库 assetId
  prompt?: string
  model?: string
  size?: string
  references?: string[] // 本次生成所用参考 assetId 列表
  position?: { x: number; y: number }
}

/** 图像编辑流（内联，替代 o_imageFlow 表） */
export interface ImageEditFlow {
  nodes: FlowNode[]
  edges?: { from: string; to: string }[]
}

/** 视频片段（一镜可多生选优） */
export interface Clip {
  id: string
  storyboardId: string
  videoFilePath?: string
  videoUrl?: string
  durationSec: number
  state: GenState
  error?: string
  // —— 阶段2 新增（候选元信息，§5.2）——
  trackId?: string // 所属视频段
  prompt?: string // 生成所用提示词快照（候选对比）
  createdAt?: number // 候选排序
  posterImageId?: string // 候选首帧缩略
}

/** 视频段/轨道（对标 o_videoTrack，取代退化的 VideoTrackItem 单片语义，§5.1） */
export interface VideoTrack {
  id: string
  storyboardIds: string[] // 该段聚合的分镜（默认 1 个）
  prompt?: string // 段级视频提示词（按模型+模式生成，可手改，§5.3）
  promptState?: GenState
  promptError?: string
  duration?: number // 段时长（覆盖分镜 duration 之和）
  videoMode?: VideoMode // 缺省取 meta.videoMode
  clipIds: string[] // 候选视频（一镜多生）
  selectClipId?: string // 选优
  audioClipId?: string // 该段配音音频 assetId
  order: number // 时间线排序
  kind?: 'shot' | 'intro' | 'outro' | 'insert' // [阶段2] 段类型（片头/片尾/插入素材段，§3.7）
  clipAssetId?: string // 非分镜来源的素材段引用（type:clip 资产）
}

/**
 * 助手回合的过程轨迹单步（对话面板可视化用）。一个回合可含多步：
 * - agent：某个子 Agent（决策/编剧/美术/导演）的工作卡片，内嵌思考流 + 产出摘要；
 * - tool：一次工具调用（名称 + 入参 + 结果）；
 * - thinking / text：工具循环里模型的思考流 / 文本增量。
 */
export interface AgentStep {
  id: string
  kind: 'agent' | 'tool' | 'thinking' | 'text'
  agent?: string // 归属子 Agent 键（decision/script/assets/storyboard/production）
  title?: string // 展示标题：如「制片决策」「导演 · 拆分镜」「调用 add_storyboard」
  thinking?: string // agent 步内嵌的思考流（reasoning）
  content?: string // 产出摘要 / 文本正文（markdown）
  toolName?: string
  toolArgs?: unknown
  toolResult?: string
  status?: 'running' | 'done' | 'error'
}

/** Agent 记忆项（轻量：短期/摘要/RAG） */
export interface MemoryItem {
  id: string
  agent: string // 隔离键：scriptAgent/productionAgent 或 agentKey[:scriptId]（§6.6）
  role: string // user / assistant:* / summary
  content: string
  createTime: number
  summarized?: boolean
  embedding?: number[] // [阶段2] 可选向量（宿主有 embedding 模型时）
  relatedIds?: string[] // [阶段2] summary 关联的 message id
  steps?: AgentStep[] // [阶段10] 助手回合过程轨迹（对话面板展示；content 仍为最终回复，供上下文/摘要用）
}

/** 分镜表行（设计层结构化来源，§4.1） */
export interface StoryboardTableRow {
  index: number
  videoDesc: string
  duration: number
  shotSize?: string // 景别
  cameraMove?: string // 运镜
  dialogue?: string // 台词
  sfx?: string // 音效
  assetRefNames: string[] // 引用资产名
}
export interface StoryboardTableSegment {
  id: string
  title: string
  rows: StoryboardTableRow[]
}
export interface StoryboardTableScene {
  id: string
  sceneName: string
  castNames: string[]
  segments: StoryboardTableSegment[]
}

export type EpisodeStatus = 'draft' | 'planned' | 'generating' | 'done'

/** 单集生产线。项目级资产仍保留在 ProjectDoc.assets 中跨集共享。 */
export interface Episode {
  id: string
  index: number
  title: string
  summary?: string
  productionRecap?: string
  seriesSkip?: boolean
  status?: EpisodeStatus
  filmPath?: string
  filmError?: string
  producedAt?: number
  novelChapterIds?: string[]
  scripts: Script[]
  storyboards: Storyboard[]
  storyboardTable?: StoryboardTableScene[]
  clips: Clip[]
  track: VideoTrack[]
  createdAt: number
  updatedAt: number
}

/** 完整项目文档（一份 JSON 持久化） */
export interface ProjectDoc {
  meta: ProjectMeta
  novel: NovelChapter[]
  /** 多集迁移期的当前集兼容镜像。 */
  scripts: Script[]
  assets: Asset[]
  /** 多集迁移期的当前集兼容镜像。 */
  storyboards: Storyboard[]
  /** 多集迁移期的当前集兼容镜像。 */
  clips: Clip[]
  /** 多集迁移期的当前集兼容镜像。 */
  track: VideoTrack[] // [阶段2] VideoTrackItem[] → VideoTrack[]（loadProject normalizeDoc 迁移）
  episodes?: Episode[]
  currentEpisodeId?: string
  memory: MemoryItem[]
  storyboardTable?: StoryboardTableScene[] // [阶段2] 分镜表设计层（§4.1）
  imageFlows?: Record<string, ImageEditFlow> // [阶段2] 以 flowId 为键的精修画布（§4.4）
}

/** 主页/切换器用的轻量卡片 */
export interface ProjectCard {
  id: string
  name: string
  artStyle: string
  videoRatio: string
  updatedAt: number
  coverImageId?: string
  storyboardCount: number
  episodeCount?: number
}
