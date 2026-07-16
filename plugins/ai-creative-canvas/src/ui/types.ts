// 领域模型：卡片 / 连线 / 视口 / 画布(board) / 工程(project)

export type CardKind = 'image' | 'video' | 'text' | 'audio' | 'source' | 'group' | 'note'
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
  assets: NodeAsset[] // 节点内上传的素材
  meta: Record<string, unknown>
  parentId: string | null // 直接父组 id；null = 顶级
}

export interface Edge {
  id: string
  source: string
  target: string
  kind: 'ref' | 'flow'
}

export type MaterialKind = 'image' | 'video' | 'audio' | 'text'

// 节点内上传的素材
export interface NodeAsset {
  id: string
  kind: MaterialKind
  url: string
  localPath?: string
  mime?: string
  name?: string
}

// 统一"素材"：来自上游连线 / 显式引用 / 本节点上传
export interface Material {
  matId: string // 'card:<id>' | 'upload:<assetId>'
  origin: 'edge' | 'card' | 'upload'
  kind: MaterialKind
  label: string // 自动编号：图片1 / 文本2 ...
  thumbUrl?: string
  text?: string
  cardId?: string
  assetUrl?: string
  assetLocalPath?: string
  mime?: string
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
  kind: string // 人台 / 道具 / 模型
  pos: [number, number, number]
  rot: [number, number, number]
  scale: number | [number, number, number] // 旧数据=均匀(number)；新数据=三轴(非均匀缩放)
  joints?: Record<string, [number, number, number]> // 关节名 → 欧拉角（人台/rigged 模型摆姿）
  poseName?: string // 一键姿势名（供生成提示）
  assetId?: string // 导入模型(GLB)的 storage.attachment id —— 据此重开时重建
  name?: string // 对象显示名（Outliner 改名后持久化）
}
export interface DirectorShot {
  id: string
  name: string
  cam: DirectorCam
}
export interface DirectorScene {
  subjects: DirectorSubject[]
  cam: DirectorCam
  shots: DirectorShot[]
  prompt?: string
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
}

export const SCHEMA_VERSION = 1

// 类型色 —— 单一真相：JS 侧用此处，CSS 侧 styles.css 的 --kind-* 须与之同源
export const KIND_ACCENT: Record<CardKind, string> = {
  image: '#6366f1',
  video: '#ec4899',
  text: '#10b981',
  audio: '#f59e0b',
  source: '#64748b',
  group: '#64748b',
  note: '#eab308'
}

export const KIND_LABEL: Record<CardKind, string> = {
  image: '图片',
  video: '视频',
  text: '文本',
  audio: '音频',
  source: '素材',
  group: '分组',
  note: '便签'
}

export const CARD_DEFAULT_SIZE: Record<CardKind, { w: number; h: number }> = {
  image: { w: 280, h: 320 },
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
