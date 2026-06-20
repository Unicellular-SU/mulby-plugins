/**
 * Toonflow 式重构 · 阶段2：结构化数据模型。
 *
 * 用「结构化项目」取代自由连线节点图：项目 → 小说(可选) → 剧本 → 资产 → 分镜 → 片段 → 时间线。
 * 每个项目持久化为一份 JSON 文档（ProjectDoc），存 host storage（key=studio:project:<id>）。
 * 不考虑老数据（节点图）兼容——全新命名空间 studio:*。
 */

export type AssetType = 'role' | 'scene' | 'prop'
export type GenState = 'idle' | 'generating' | 'done' | 'failed'

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
  videoMode?: string // 视频模式（singleImage / startEnd / imageReference…）
  dialogueLang?: string // 对白语言（默认中文）
  directorManual?: string // 导演手册：全局风格/节奏意图，注入各 Agent
  createdAt: number
  updatedAt: number
}

/** 小说章节（可选入口：长文改编） */
export interface NovelChapter {
  id: string
  index: number
  title: string
  text: string
  event?: string // 抽取的章节事件摘要
  eventState?: GenState
}

/** 章节事件图谱节点 */
export interface EventNode {
  id: string
  name: string
  detail: string
  chapterIds: string[]
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
  prompt?: string
  refImageId?: string // 资产库 assetId
  appliesTo?: string[] // 对齐节拍/段落关键字
}

/** 资产（人物/场景/物品 + 衍生） */
export interface Asset {
  id: string
  type: AssetType
  name: string
  prompt?: string // 英文生成提示词
  desc?: string // 中文描述
  refImageId?: string // 主参考图（资产库 assetId）
  parentAssetId?: string // 非空=衍生资产
  variants?: AssetVariant[]
  state: GenState
  error?: string
}

/** 分镜面板 */
export interface Storyboard {
  id: string
  index: number
  track: string // 分组/段落
  videoDesc: string // 画面描述（中文，给关键帧/视频）
  prompt?: string // 英文关键帧提示词
  duration: number // 推荐视频时长(秒)
  associateAssetIds: string[] // 出场资产
  shouldGenerateImage: boolean
  keyframeImageId?: string // 关键帧图（资产库 assetId）
  chainFromPrev?: boolean // 承接上一镜（关键帧链式/尾帧接龙）
  sceneId?: string // 同场判断
  dialogues?: { character: string; line: string; emotion?: string }[]
  state: GenState
  error?: string
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
}

/** 时间线轨道项（按分镜顺序，selectClipId 为选用片段） */
export interface VideoTrackItem {
  id: string
  storyboardId: string
  clipIds: string[]
  selectClipId?: string
}

/** Agent 记忆项（轻量：短期/摘要） */
export interface MemoryItem {
  id: string
  agent: string // scriptAgent / productionAgent
  role: string // user / assistant:* / summary
  content: string
  createTime: number
  summarized?: boolean
}

/** 完整项目文档（一份 JSON 持久化） */
export interface ProjectDoc {
  meta: ProjectMeta
  novel: NovelChapter[]
  events: EventNode[]
  scripts: Script[]
  assets: Asset[]
  storyboards: Storyboard[]
  clips: Clip[]
  track: VideoTrackItem[]
  memory: MemoryItem[]
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
}
