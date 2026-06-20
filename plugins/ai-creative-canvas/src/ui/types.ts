// 领域模型：卡片 / 连线 / 视口 / 画布(board) / 工程(project)

export type CardKind = 'image' | 'video' | 'text' | 'audio' | 'source'
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

export interface Board {
  id: string
  name: string
  cards: Record<string, Card>
  edges: Record<string, Edge>
  viewport: Viewport
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
  concurrency?: number
  createdAt: number
  updatedAt: number
  schemaVersion: number
}

export interface Shot {
  desc: string
  shotSize?: string
  camera?: string
  duration?: number
  dialogue?: string
}

export const SCHEMA_VERSION = 1

export const CARD_DEFAULT_SIZE: Record<CardKind, { w: number; h: number }> = {
  image: { w: 280, h: 320 },
  video: { w: 320, h: 280 },
  text: { w: 300, h: 220 },
  audio: { w: 300, h: 140 },
  source: { w: 260, h: 240 }
}
