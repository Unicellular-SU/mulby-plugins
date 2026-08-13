import type {
  AssetAnchor,
  AssetRole,
  Card,
  Material,
  MaterialKind,
  PinnedAnchorMedia,
  ProjectDoc
} from '../types'
import { uid } from '../util'
import { materialKindOfCard } from './nodeCapabilities'

export const ASSET_ROLES: readonly AssetRole[] = ['character', 'scene', 'prop', 'voice', 'style', 'music', 'reference']

export const ASSET_ROLE_LABEL: Record<AssetRole, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  voice: '声音',
  style: '风格',
  music: '音乐',
  reference: '参考'
}

export interface AssetAnchorDraft {
  id?: string
  role: AssetRole
  name: string
  aliases?: string[]
  description?: string
  tags?: string[]
  locked?: boolean
}

function cleanList(value: unknown, maxItems = 24): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, maxItems)
}

export function projectCard(project: ProjectDoc, cardId: string): { boardId: string; card: Card } | null {
  for (const board of project.boards || []) {
    const card = board.cards?.[cardId]
    if (card) return { boardId: board.id, card }
  }
  return null
}

export function semanticAnchorIdOfCard(card: Card): string | null {
  const value = (card.meta as { semanticAnchorId?: unknown })?.semanticAnchorId
  return typeof value === 'string' && value ? value : null
}

export function anchorForSourceCard(project: ProjectDoc, cardId: string): AssetAnchor | null {
  const direct = projectCard(project, cardId)?.card
  const directId = direct ? semanticAnchorIdOfCard(direct) : null
  if (directId && project.assetAnchors?.[directId]) return project.assetAnchors[directId]
  return Object.values(project.assetAnchors || {}).find((anchor) => anchor.source?.cardId === cardId) || null
}

function cardMediaMissing(card: Card): boolean {
  const missing = (card.meta as { missingMediaReferences?: unknown })?.missingMediaReferences
  return Array.isArray(missing) && missing.includes('primary')
}

/** 当前卡片可以固定进锚点的最小媒体快照；不把 data URL 放进工程 JSON。 */
export function pinnableMediaFromCard(card: Card): PinnedAnchorMedia | undefined {
  const kind = materialKindOfCard(card)
  if (!kind || cardMediaMissing(card)) return undefined
  if (kind === 'text') {
    const text = (card.text || '').trim()
    return text ? { text, mime: card.mime || 'text/plain' } : undefined
  }
  const assetUrl = card.assetUrl && !card.assetUrl.startsWith('data:') ? card.assetUrl : undefined
  if (!card.assetLocalPath && !assetUrl) return undefined
  const meta = card.meta as { thumb?: unknown; thumbFor?: unknown }
  const thumbUrl = meta.thumbFor === card.assetUrl && typeof meta.thumb === 'string' && !meta.thumb.startsWith('data:')
    ? meta.thumb
    : undefined
  return {
    assetLocalPath: card.assetLocalPath || undefined,
    assetUrl,
    mime: card.mime || undefined,
    thumbUrl
  }
}

export function makeAssetAnchor(
  project: ProjectDoc,
  sourceCardId: string,
  draft: AssetAnchorDraft,
  previous?: AssetAnchor | null
): AssetAnchor {
  const located = projectCard(project, sourceCardId)
  if (!located) throw new Error('锚点源卡片不存在')
  const mediaKind = materialKindOfCard(located.card)
  if (!mediaKind) throw new Error('分组和便签不能创建语义锚点')
  const now = Date.now()
  // 已锁定锚点只编辑名称/标签时仍保留原快照；要改为当前产物，先解锁保存，再重新锁定。
  const pinnedMedia = draft.locked
    ? previous?.locked && previous.pinnedMedia ? previous.pinnedMedia : pinnableMediaFromCard(located.card)
    : undefined
  return {
    id: previous?.id || draft.id || uid('anchor'),
    role: draft.role,
    name: draft.name.trim(),
    aliases: cleanList(draft.aliases),
    description: String(draft.description || '').trim(),
    tags: cleanList(draft.tags),
    mediaKind,
    source: { boardId: located.boardId, cardId: located.card.id },
    pinnedMedia,
    revision: (previous?.revision || 0) + 1,
    locked: !!draft.locked && !!pinnedMedia,
    mediaMissing: false,
    createdAt: previous?.createdAt || now,
    updatedAt: now
  }
}

function mediaFromPinned(anchor: AssetAnchor): Material | null {
  const pinned = anchor.pinnedMedia
  if (!pinned) return null
  const unavailable = !!anchor.mediaMissing || (anchor.mediaKind === 'text' ? !pinned.text?.trim() : !(pinned.assetLocalPath || pinned.assetUrl))
  return {
    matId: `anchor:${anchor.id}`,
    origin: 'anchor',
    kind: anchor.mediaKind,
    label: anchor.name,
    thumbUrl: unavailable ? undefined : pinned.thumbUrl || pinned.assetUrl,
    text: anchor.mediaKind === 'text' ? pinned.text : undefined,
    assetUrl: unavailable ? undefined : pinned.assetUrl,
    assetLocalPath: unavailable ? undefined : pinned.assetLocalPath,
    mime: pinned.mime,
    anchorId: anchor.id,
    cardId: anchor.source?.cardId,
    unavailable
  }
}

/** 把工程级锚点解析成现有生成链路可消费的 Material。 */
export function materialFromAnchor(anchor: AssetAnchor, project: ProjectDoc): Material {
  if (anchor.locked) {
    const pinned = mediaFromPinned(anchor)
    if (pinned) return pinned
  }
  const located = anchor.source?.cardId ? projectCard(project, anchor.source.cardId) : null
  const source = located?.card
  if (!source) {
    return {
      matId: `anchor:${anchor.id}`,
      origin: 'anchor',
      kind: anchor.mediaKind,
      label: anchor.name,
      anchorId: anchor.id,
      cardId: anchor.source?.cardId,
      unavailable: true
    }
  }
  const sourceMissing = cardMediaMissing(source)
  const kind = materialKindOfCard(source) || anchor.mediaKind
  const unavailable = sourceMissing || (kind === 'text' ? !source.text?.trim() : !(source.assetUrl || source.assetLocalPath))
  return {
    matId: `anchor:${anchor.id}`,
    origin: 'anchor',
    kind,
    label: anchor.name,
    thumbUrl: unavailable ? undefined : source.assetUrl || undefined,
    text: kind === 'text' ? source.text || undefined : undefined,
    cardId: source.id,
    assetUrl: unavailable ? undefined : source.assetUrl || undefined,
    assetLocalPath: unavailable ? undefined : source.assetLocalPath || undefined,
    mime: source.mime || undefined,
    anchorId: anchor.id,
    unavailable
  }
}

export function projectAnchorMaterials(project: ProjectDoc): Material[] {
  return Object.values(project.assetAnchors || {})
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name))
    .map((anchor) => materialFromAnchor(anchor, project))
}

export function isAssetRole(value: unknown): value is AssetRole {
  return typeof value === 'string' && (ASSET_ROLES as readonly string[]).includes(value)
}

export function isMaterialKind(value: unknown): value is MaterialKind {
  return value === 'image' || value === 'video' || value === 'audio' || value === 'text'
}
