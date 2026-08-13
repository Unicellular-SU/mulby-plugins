// 领域模型：卡片 / 连线 / 视口 / 画布(board) / 工程(project)

export type CardKind = 'image' | 'pano' | 'video' | 'text' | 'audio' | 'source' | 'group' | 'note'
export type CardStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface Card {
  id: string
  kind: CardKind
  x: number
  y: number
  w: number
  h: number
  title: string
  prompt: string
  modelId: string | null
  providerId: string | null
  params: Record<string, unknown>
  status: CardStatus
  progress: number // 0..1
  error: string | null
  // 产物以引用形式存放（二进制不进 store/工程 JSON）
  assetUrl: string | null // file:// 或 blob:
  assetLocalPath: string | null
  attachmentId: string | null // storage.attachment 缩略图 id
  mime: string | null
  text: string | null // 文本卡产物
  refIds: string[] // 显式引用的卡片 id
  anchorRefs?: AnchorReference[] // 工程级语义素材引用（稳定 id，不依赖卡片标题）
  assets: NodeAsset[] // 节点内上传的素材
  meta: Record<string, unknown>
  parentId: string | null // 直接父组 id；null = 顶级
}

export type MediaVersionDisposition = 'normal' | 'starred' | 'rejected'
export type MediaVersionSource = 'generation' | 'import' | 'edit' | 'reshoot' | 'director'

/** 图片、视频和导演 Take 共用的非破坏式版本条目。 */
export interface MediaVersion {
  id: string
  kind: 'image' | 'video'
  url: string
  localPath?: string
  mime?: string
  label: string
  createdAt: number
  source: MediaVersionSource
  disposition: MediaVersionDisposition
  parentVersionId?: string
  prompt?: string
  providerId?: string | null
  modelId?: string | null
  metadata?: Record<string, unknown>
}

export interface MediaVersionState {
  version: 1
  currentId: string
  compareIds?: [string?, string?]
  items: MediaVersion[]
}

export interface VideoReshootRequestV1 {
  version: 1
  sourceCardId: string
  sourceBoardId: string
  range: { start: number; end: number }
  originalDuration: number
  boundary: {
    startCardId: string
    middleCardId: string
    endCardId: string
    startPath: string
    middlePath: string
    endPath: string
  }
  context: {
    sourcePrompt: string
    sentPrompt?: string
    directorPrompt?: string
    anchorIds: string[]
    style?: string
    stylePackId?: string
    storyboardId?: string
    shotId?: string
  }
  status: 'awaiting-generation' | 'composing' | 'completed' | 'error'
  outputCardId?: string
  error?: string
  createdAt: number
}

export interface Edge {
  id: string
  source: string
  target: string
  kind: 'ref' | 'flow'
}

export type MaterialKind = 'image' | 'video' | 'audio' | 'text'

export type AssetRole = 'character' | 'scene' | 'prop' | 'voice' | 'style' | 'music' | 'reference'

export interface PinnedAnchorMedia {
  assetUrl?: string
  assetLocalPath?: string
  mime?: string
  text?: string
  thumbUrl?: string
}

/** 工程级语义素材：角色、场景、道具等身份与具体媒体产物解耦。 */
export interface AssetAnchor {
  id: string
  role: AssetRole
  name: string
  aliases: string[]
  description: string
  tags: string[]
  mediaKind: MaterialKind
  source?: { boardId: string; cardId: string; resultIndex?: number }
  pinnedMedia?: PinnedAnchorMedia
  revision: number
  locked: boolean
  mediaMissing?: boolean
  createdAt: number
  updatedAt: number
}

/** 节点对语义锚点的稳定绑定；mention 仅供 UI 展示与改名联动。 */
export interface AnchorReference {
  anchorId: string
  mention: string
  acceptedAt: number
}

// 节点内上传的素材
export interface NodeAsset {
  id: string
  kind: MaterialKind
  url?: string
  localPath?: string
  mime?: string
  name?: string
  text?: string
}

// 统一"素材"：来自上游连线 / 显式引用 / 本节点上传
export interface Material {
  matId: string // 'card:<id>' | 'upload:<assetId>' | 'anchor:<anchorId>'
  origin: 'edge' | 'card' | 'upload' | 'anchor'
  kind: MaterialKind
  label: string // 自动编号：图片1 / 文本2 ...
  thumbUrl?: string
  text?: string
  cardId?: string
  assetUrl?: string
  assetLocalPath?: string
  mime?: string
  anchorId?: string
  /** 工程仍保留引用，但底层本地文件已不可用；可展示/移除，不得发给生成 Provider。 */
  unavailable?: boolean
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

// 自由绘制标注（世界坐标，随视口变换）
export type AnnotKind = 'pen' | 'arrow' | 'rect' | 'text'
export interface Annotation {
  id: string
  kind: AnnotKind
  color: string
  points: { x: number; y: number }[] // pen: 多点路径；arrow/rect: [起, 止]；text: [位置]
  text?: string
}

export interface Board {
  id: string
  name: string
  cards: Record<string, Card>
  edges: Record<string, Edge>
  viewport: Viewport
  annotations?: Annotation[]
  style?: string // 画布级自由风格（独立于其它画布）
  stylePackId?: string // 画布级风格包
}

// 3D 导演台场景（持久化）
export interface DirectorCam {
  pos: [number, number, number]
  target: [number, number, number]
  focal: number
}
export interface DirectorSubject {
  id?: string // 稳定对象 id；旧工程缺省时首次载入补齐
  kind: string // 人台 / 道具 / 模型
  pos: [number, number, number]
  rot: [number, number, number]
  scale: number | [number, number, number] // 旧数据=均匀(number)；新数据=三轴(非均匀缩放)
  joints?: Record<string, [number, number, number]> // 关节名 → 欧拉角（人台/rigged 模型摆姿）
  poseName?: string // 一键姿势名（供生成提示）
  poseSchemaVersion?: number
  bodyType?: 'mannequin' | 'female' | 'broad' | 'muscular' | 'slim' | 'teen' | 'teenFemale' | 'child' | 'childFemale' | 'chibi' | 'senior' | 'seniorFemale' | 'heavyFemale' // 独立人台素体（旧工程缺省=mannequin）
  poseOffsetY?: number // 下蹲/跪姿等预设的内部垂直偏移；不改对象世界坐标
  assetId?: string // 导入模型(GLB)的 storage.attachment id —— 据此重开时重建
  name?: string // 对象显示名（Outliner 改名后持久化）
  desc?: string // 对象语义描述（"穿长衫的老者"）：场景即提示词，生成时按画面方位装配
  colorName?: string // 人台锚定色名（"红标"）：参考图颜色块 + prompt 颜色锚定，锁定站位/朝向
  visible?: boolean
  locked?: boolean
}
export interface DirectorShot {
  id: string
  name: string
  cam: DirectorCam
  aspect?: string // 记录机位时的出图画幅；旧工程缺省时沿用场景当前画幅
  lighting?: string // 记录机位时的灯光预设；旧工程缺省时沿用场景当前灯光
  shotType?: string // 特写 / 中景 / 全景 / 远景，供分镜条快速识别
  durationMs?: number // 分镜时长元数据，用于总时长、导出和后续剪辑节奏
  notes?: string // 导演备注，逐镜生成与分镜导出时追加到提示词
  targetSubjectId?: string // 可选跟随目标；应用机位时按目标当前位置解析相机
  targetOffset?: [number, number, number] // 目标点相对跟随对象原点的偏移
  cameraOffset?: [number, number, number] // 相机相对跟随对象原点的偏移
  sceneState?: DirectorShotSceneState // 可选逐镜头调度快照；旧工程缺省时仅应用相机
  environmentState?: DirectorShotEnvironmentState // 可选逐镜头全景构图快照；旧机位缺省时沿用当前环境
  thumb?: string // 机位缩略图（jpeg dataURL，记录机位时抓取）
  take?: string // 该机位当前成片 url（分镜回贴：缩略图优先显示成片）
  takes?: string[] // 成片历史（新→旧追加，cap 6；take=当前选中那条）
  takeVersions?: MediaVersion[] // M5：Take 状态/追踪信息；旧工程仍由 takes 自动适配
  compareTakeIds?: [string?, string?]
}
export interface DirectorShotEnvironmentState {
  mode: 'grounded' | 'infinite'
  compositionMode: 'physical' | 'adapted'
  backgroundScale: number
}
export interface DirectorShotSubjectState {
  subjectId: string
  name?: string
  kind?: string
  pos: [number, number, number]
  rot: [number, number, number]
  scale: number | [number, number, number]
  joints?: Record<string, [number, number, number]>
  poseName?: string
  poseSchemaVersion?: number
  poseOffsetY?: number
  bodyType?: DirectorSubject['bodyType']
  visible?: boolean
}
export interface DirectorShotSceneState {
  subjects: DirectorShotSubjectState[]
}
export interface DirectorEnvironment {
  assetId: string // 全景背景附件 id
  name?: string
  mimeType?: string
  description?: string // 追加进镜头提示词的环境描述
  rotation?: number // 水平旋转角度，单位为度
  mode?: 'grounded' | 'infinite' // 落地环境用于小范围移机；无限背景只随视角旋转
  compositionMode?: 'physical' | 'adapted' // 物理一致共用镜头；构图适配允许背景使用独立视野
  backgroundScale?: number // 构图适配下的背景视觉尺寸，范围 0.5-2
  captureOrigin?: [number, number, number] // 全景拍摄光心在导演场景中的位置
  cameraHeight?: number // 全景拍摄点离地高度，单位为米
  horizon?: number // 地平线垂直校准，单位为度
  exposure?: number // ACES 画面曝光
  environmentIntensity?: number // PBR 材质使用的全景环境光强度
  backgroundBlur?: number // 背景柔化，范围 0-1
  shadowOpacity?: number // 透明接影面的阴影强度，范围 0-1
  width?: number // 原始全景像素尺寸，用于质量提示
  height?: number
  source?: 'local' | 'canvas' // 仅用于说明来源；附件始终复制到导演工程独立存储
  sourceCardId?: string // 来自当前画布时记录源 360 全景卡 id
}
export interface DirectorScene {
  schemaVersion?: 2
  subjects: DirectorSubject[]
  cam: DirectorCam
  shots: DirectorShot[]
  prompt?: string
  lighting?: string // 灯光预设 key（DirectorStage LIGHTINGS）
  aspect?: string // 出图画幅 key（DirectorStage ASPECTS，默认视口=不裁剪）
  environment?: DirectorEnvironment | null // 可选等距柱状全景背景
}

export type WorkflowRecipeId = 'script-to-short-film'

/** Agent 能执行的动作白名单。模型只产出创作规格，不得自行发明命令。 */
export type AgentCommandName =
  | 'save_storyboard'
  | 'materialize_images'
  | 'generate_images'
  | 'create_videos'
  | 'generate_videos'
  | 'prepare_timeline'

export type WorkflowStatus = 'planned' | 'running' | 'paused' | 'completed' | 'error' | 'canceled' | 'stale'
export type WorkflowStepStatus = 'pending' | 'running' | 'checkpoint' | 'completed' | 'error' | 'canceled' | 'stale'

export interface WorkflowAnchorSuggestion {
  role: AssetRole
  name: string
  description: string
}

export interface WorkflowCreativeBrief {
  title: string
  summary: string
  audience: string
  aspect: string
  totalDuration: number
  ending: string
  anchorSuggestions: WorkflowAnchorSuggestion[]
  shots: Shot[]
}

export interface WorkflowStep {
  id: string
  command: AgentCommandName
  title: string
  description: string
  status: WorkflowStepStatus
  requiresApproval: boolean
  approvedAt?: number
  startedAt?: number
  completedAt?: number
  outputCardIds: string[]
  error?: string
}

export interface WorkflowLogEntry {
  id: string
  at: number
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  stepId?: string
}

/** 工程内持久化的可恢复工作流；二进制结果仍只存在卡片媒体引用中。 */
export interface WorkflowRun {
  version: 1
  id: string
  recipe: WorkflowRecipeId
  sourceBoardId: string
  sourceCardId: string
  goal: string
  status: WorkflowStatus
  sourceFingerprint: string
  selectedSkillIds: string[]
  brief: WorkflowCreativeBrief
  steps: WorkflowStep[]
  logs: WorkflowLogEntry[]
  createdAt: number
  updatedAt: number
}

export interface ProjectDoc {
  id: string
  name: string
  boards: Board[]
  activeBoardId: string
  globalModelId: string | null
  style?: string
  stylePackId?: string
  defaultImageModel?: string | null
  defaultTextModel?: string | null
  defaultPanoModel?: string | null // 360 全景专用模型（出真等距柱状）
  defaultControlModel?: string | null // ControlNet 控制模型（深度/姿态 → 强控制）
  assetAnchors?: Record<string, AssetAnchor> // 工程内角色 / 场景 / 道具等稳定语义素材
  workflowRuns?: Record<string, WorkflowRun> // Agent 固定配方的计划、检查点与恢复状态
  director?: DirectorScene | null // 3D 导演台场景（持久化）
  concurrency?: number
  createdAt: number
  updatedAt: number
  schemaVersion: number
}

// 导演级镜头表（~15 列）；除 desc 外均可空，老工程/渲染处按 `?? ''` 兜底
export interface Shot {
  shotNumber?: number // 镜号
  desc: string // 画面描述
  scene?: string // 场景/地点
  character?: string // 出场角色
  characterDesc?: string // 角色外观/服装要点
  action?: string // 主体动作
  emotion?: string // 情绪基调
  shotSize?: string // 景别
  camera?: string // 机位与运镜
  duration?: number // 时长(秒)
  dialogue?: string // 对白
  sfx?: string // 音效/环境声
  imagePrompt?: string // 静帧图片提示词
  videoPrompt?: string // 动态视频提示词
  roleImageRefs?: string[] // 角色一致性参考图 id
  anchorNames?: string[] // Agent 计划阶段的锚点名称；保存故事板时解析为稳定 anchorIds
}

export interface StoryboardShotV2 extends Shot {
  id: string
  order: number
  anchorIds: string[]
  imageCardId?: string
  videoCardId?: string
  audioCardId?: string
  sourceRange?: { start: number; end: number }
  version: number
}

export interface StoryboardDocV2 {
  version: 2
  id: string
  ownerCardId: string
  title: string
  sourceFingerprint: string
  shots: StoryboardShotV2[]
  createdAt: number
  updatedAt: number
}

export interface StoryboardBacklink {
  storyboardId: string
  shotId: string
  stage: 'image' | 'video' | 'audio'
  /** 最近一次把故事板输入同步到卡片时的指纹。 */
  materializedFingerprint?: string
}

export type VideoAnalysisFrameRole = 'start' | 'middle' | 'end'

export interface VideoAnalysisFrame {
  role: VideoAnalysisFrameRole
  time: number
  path: string
  url: string
}

export interface VideoAnalysisShot {
  id: string
  index: number
  start: number
  end: number
  frames: VideoAnalysisFrame[]
  representativeFramePath?: string
  representativeFrameUrl?: string
  scene: string
  shotSize: string
  composition: string
  characters: string
  action: string
  camera: string
  color: string
  mood: string
  learnablePrompt: string
  dialogue: string
  transcriptStatus: 'matched' | 'untranscribed'
}

/** 视频视觉拉片报告；只保存结构化摘要与本地抽帧引用，不保存 Base64。 */
export interface VideoAnalysisReport {
  version: 1
  id: string
  sourceCardId: string
  sourceAssetUrl: string
  sourcePath: string
  duration: number
  threshold: number
  sampleStrategy: 'start-middle-end'
  shots: VideoAnalysisShot[]
  modelId?: string
  createdAt: number
  updatedAt: number
}

export const SCHEMA_VERSION = 6 // v6：统一媒体版本 + 视频局部重拍；v5 为可恢复 Agent Workflow

// 类型色 —— 单一真相：JS 侧用此处，CSS 侧 styles.css 的 --kind-* 须与之同源
export const KIND_ACCENT: Record<CardKind, string> = {
  image: '#6366f1',
  pano: '#06b6d4',
  video: '#ec4899',
  text: '#10b981',
  audio: '#f59e0b',
  source: '#64748b',
  group: '#64748b',
  note: '#eab308'
}

export const KIND_LABEL: Record<CardKind, string> = {
  image: '图片',
  pano: '360 全景',
  video: '视频',
  text: '文本',
  audio: '音频',
  source: '素材',
  group: '分组',
  note: '便签'
}

export const CARD_DEFAULT_SIZE: Record<CardKind, { w: number; h: number }> = {
  image: { w: 280, h: 320 },
  pano: { w: 360, h: 220 }, // 等距柱状 2:1，出图后 fitAspect 收敛到真实比例
  video: { w: 320, h: 280 },
  text: { w: 300, h: 220 },
  audio: { w: 300, h: 140 },
  source: { w: 260, h: 240 },
  group: { w: 400, h: 300 },
  note: { w: 220, h: 160 }
}

// 卡片是否整体落在组框内（用于拖入归属 / resize 弹出判定）
export function isCardInsideGroup(node: Card, group: Card): boolean {
  if (group.kind !== 'group') return false
  return node.x >= group.x && node.y >= group.y && node.x + node.w <= group.x + group.w && node.y + node.h <= group.y + group.h
}

// 组模板（可复用的组子树，归一化到 (0,0)；不含产物）
export interface GroupTemplate {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  group: { w: number; h: number; title: string; params: Record<string, unknown> }
  members: Array<{
    localId: string
    parentLocalId: string | null
    card: Omit<Card, 'id' | 'assetUrl' | 'assetLocalPath' | 'attachmentId' | 'parentId'>
  }>
  edges: Array<{ source: string; target: string; kind: 'ref' | 'flow' }>
}
