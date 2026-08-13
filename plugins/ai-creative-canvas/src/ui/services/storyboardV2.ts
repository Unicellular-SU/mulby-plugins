import type {
  Board,
  Card,
  Shot,
  StoryboardBacklink,
  StoryboardDocV2,
  StoryboardShotV2
} from '../types'
import { uid } from '../util'

const SHOT_TEXT_FIELDS = [
  'desc', 'scene', 'character', 'characterDesc', 'action', 'emotion', 'shotSize', 'camera',
  'dialogue', 'sfx', 'imagePrompt', 'videoPrompt'
] as const satisfies readonly (keyof Shot)[]

function hashText(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function text(value: unknown): string | undefined {
  const result = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
  return result || undefined
}

function positive(value: unknown): number | undefined {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : undefined
}

function stringList(value: unknown, limit = 64): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, limit)
}

export function storyboardSourceText(card: Card): string {
  return (card.text || '').trim() || (card.prompt || '').trim()
}

export function storyboardSourceFingerprint(card: Card): string {
  return `source-${hashText(storyboardSourceText(card))}`
}

export function storyboardShotFingerprint(shot: Pick<StoryboardShotV2, keyof Shot | 'anchorIds'>): string {
  const value: Record<string, unknown> = {
    shotNumber: shot.shotNumber || null,
    duration: shot.duration || null,
    anchorIds: [...(shot.anchorIds || [])].sort()
  }
  for (const key of SHOT_TEXT_FIELDS) value[key] = shot[key] || ''
  return `shot-${hashText(stable(value))}`
}

function stableStoryboardId(ownerCardId: string): string {
  return `storyboard-${hashText(ownerCardId)}`
}

function stableLegacyShotId(ownerCardId: string, index: number, raw: unknown): string {
  return `shot-${hashText(`${ownerCardId}:${index}:${stable(raw)}`)}`
}

function normalizeShot(raw: any, ownerCardId: string, index: number, usedIds: Set<string>): StoryboardShotV2 {
  const baseId = text(raw?.id) || stableLegacyShotId(ownerCardId, index, raw)
  let id = baseId
  let suffix = 2
  while (usedIds.has(id)) id = `${baseId}-${suffix++}`
  usedIds.add(id)
  const shot: StoryboardShotV2 = {
    id,
    order: index,
    anchorIds: stringList(raw?.anchorIds),
    version: Math.max(1, Math.floor(positive(raw?.version) || 1)),
    desc: text(raw?.desc) || '',
    shotNumber: positive(raw?.shotNumber) || index + 1
  }
  for (const key of SHOT_TEXT_FIELDS) {
    if (key === 'desc') continue
    const value = text(raw?.[key])
    if (value) (shot as any)[key] = value
  }
  const duration = positive(raw?.duration)
  if (duration) shot.duration = duration
  const roleImageRefs = stringList(raw?.roleImageRefs)
  if (roleImageRefs.length) shot.roleImageRefs = roleImageRefs
  for (const key of ['imageCardId', 'videoCardId', 'audioCardId'] as const) {
    const value = text(raw?.[key])
    if (value) shot[key] = value
  }
  const start = Number(raw?.sourceRange?.start)
  const end = Number(raw?.sourceRange?.end)
  if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) shot.sourceRange = { start, end }
  return shot
}

export function normalizeStoryboardDoc(raw: unknown, owner: Card): StoryboardDocV2 | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as any).shots)) return null
  const value = raw as any
  const usedIds = new Set<string>()
  const shots = value.shots.slice(0, 500).map((shot: unknown, index: number) => normalizeShot(shot, owner.id, index, usedIds))
  const now = Date.now()
  return {
    version: 2,
    id: text(value.id) || stableStoryboardId(owner.id),
    ownerCardId: owner.id,
    title: text(value.title) || `${owner.title || '文本'} · 故事板`,
    sourceFingerprint: text(value.sourceFingerprint) || storyboardSourceFingerprint(owner),
    shots,
    createdAt: positive(value.createdAt) || now,
    updatedAt: positive(value.updatedAt) || now
  }
}

export function readStoryboardDoc(owner: Card): StoryboardDocV2 | null {
  const meta = owner.meta as Record<string, unknown>
  const current = normalizeStoryboardDoc(meta.storyboardV2, owner)
  if (current) return current
  if (!Array.isArray(meta.shots)) return null
  return normalizeStoryboardDoc({
    version: 2,
    id: stableStoryboardId(owner.id),
    ownerCardId: owner.id,
    title: `${owner.title || '文本'} · 故事板`,
    sourceFingerprint: storyboardSourceFingerprint(owner),
    shots: meta.shots,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }, owner)
}

function sameShotContent(a: StoryboardShotV2, b: StoryboardShotV2): boolean {
  return storyboardShotFingerprint(a) === storyboardShotFingerprint(b)
}

/** 用新生成的 Shot 更新故事板；同镜号/同位置优先保留稳定 id 与已落地卡片。 */
export function createStoryboardDoc(owner: Card, shots: Shot[], previous?: StoryboardDocV2 | null): StoryboardDocV2 {
  const usedPrevious = new Set<string>()
  const usedIds = new Set<string>()
  const nextShots = shots.slice(0, 500).map((raw, index) => {
    const matched = previous?.shots.find((shot) => !usedPrevious.has(shot.id) && shot.shotNumber === (raw.shotNumber || index + 1))
      || previous?.shots[index]
    if (matched) usedPrevious.add(matched.id)
    const candidate = normalizeShot({
      ...raw,
      id: matched?.id || uid('shot'),
      anchorIds: (raw as StoryboardShotV2).anchorIds || matched?.anchorIds || [],
      imageCardId: matched?.imageCardId,
      videoCardId: matched?.videoCardId,
      audioCardId: matched?.audioCardId,
      version: matched?.version || 1
    }, owner.id, index, usedIds)
    if (matched && !sameShotContent(candidate, matched)) candidate.version = matched.version + 1
    return candidate
  })
  const now = Date.now()
  return {
    version: 2,
    id: previous?.id || uid('storyboard'),
    ownerCardId: owner.id,
    title: previous?.title || `${owner.title || '文本'} · 故事板`,
    sourceFingerprint: storyboardSourceFingerprint(owner),
    shots: nextShots,
    createdAt: previous?.createdAt || now,
    updatedAt: now
  }
}

export function emptyStoryboardDoc(owner: Card): StoryboardDocV2 {
  return createStoryboardDoc(owner, [])
}

export function updateStoryboardShot(doc: StoryboardDocV2, shotId: string, patch: Partial<StoryboardShotV2>): StoryboardDocV2 {
  let changed = false
  const shots = doc.shots.map((shot) => {
    if (shot.id !== shotId) return shot
    const next = normalizeShot({ ...shot, ...patch, id: shot.id, order: shot.order }, doc.ownerCardId, shot.order, new Set())
    next.imageCardId = shot.imageCardId
    next.videoCardId = shot.videoCardId
    next.audioCardId = shot.audioCardId
    next.version = sameShotContent(next, shot) ? shot.version : shot.version + 1
    changed = stable(next) !== stable(shot)
    return changed ? next : shot
  })
  return changed ? { ...doc, shots, updatedAt: Date.now() } : doc
}

export function appendStoryboardShot(doc: StoryboardDocV2, partial: Partial<Shot> = {}): StoryboardDocV2 {
  const shot = normalizeShot({ id: uid('shot'), shotNumber: doc.shots.length + 1, shotSize: '中景', duration: 5, desc: '', imagePrompt: '', ...partial }, doc.ownerCardId, doc.shots.length, new Set(doc.shots.map((item) => item.id)))
  return { ...doc, shots: [...doc.shots, shot], updatedAt: Date.now() }
}

export function removeStoryboardShot(doc: StoryboardDocV2, shotId: string): StoryboardDocV2 {
  if (!doc.shots.some((shot) => shot.id === shotId)) return doc
  return {
    ...doc,
    shots: doc.shots.filter((shot) => shot.id !== shotId).map((shot, index) => ({ ...shot, order: index })),
    updatedAt: Date.now()
  }
}

export function moveStoryboardShot(doc: StoryboardDocV2, shotId: string, direction: -1 | 1): StoryboardDocV2 {
  const from = doc.shots.findIndex((shot) => shot.id === shotId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= doc.shots.length) return doc
  const shots = doc.shots.slice()
  ;[shots[from], shots[to]] = [shots[to], shots[from]]
  return { ...doc, shots: shots.map((shot, index) => ({ ...shot, order: index })), updatedAt: Date.now() }
}

export function storyboardBacklink(card: Card | undefined): StoryboardBacklink | null {
  const value = (card?.meta as Record<string, unknown> | undefined)?.storyboardBacklink as any
  if (!value || typeof value !== 'object' || typeof value.storyboardId !== 'string' || typeof value.shotId !== 'string') return null
  if (value.stage !== 'image' && value.stage !== 'video' && value.stage !== 'audio') return null
  return {
    storyboardId: value.storyboardId,
    shotId: value.shotId,
    stage: value.stage,
    materializedFingerprint: text(value.materializedFingerprint)
  }
}

export function backlinkFor(doc: StoryboardDocV2, shot: StoryboardShotV2, stage: StoryboardBacklink['stage']): StoryboardBacklink {
  return { storyboardId: doc.id, shotId: shot.id, stage, materializedFingerprint: storyboardShotFingerprint(shot) }
}

export type StoryboardStageState = 'unmaterialized' | 'synced' | 'stale' | 'running' | 'error' | 'done'

export type StoryboardStage = StoryboardBacklink['stage']

export function storyboardStageCardId(shot: StoryboardShotV2, stage: StoryboardStage): string | undefined {
  return stage === 'image' ? shot.imageCardId : stage === 'video' ? shot.videoCardId : shot.audioCardId
}

export function storyboardStageState(doc: StoryboardDocV2, shot: StoryboardShotV2, board: Board, stage: StoryboardStage): StoryboardStageState {
  const cardId = storyboardStageCardId(shot, stage)
  if (!cardId) return 'unmaterialized'
  const card = board.cards[cardId]
  if (!card) return 'unmaterialized'
  const backlink = storyboardBacklink(card)
  if (!backlink || backlink.storyboardId !== doc.id || backlink.shotId !== shot.id || backlink.stage !== stage) return 'stale'
  if (backlink.materializedFingerprint !== storyboardShotFingerprint(shot) || (card.meta as any)?.storyboardInputStale) return 'stale'
  if (card.status === 'running' || card.status === 'queued') return 'running'
  if (card.status === 'error') return 'error'
  if (card.assetUrl || card.assetLocalPath) return 'done'
  return 'synced'
}

export function storyboardImageState(doc: StoryboardDocV2, shot: StoryboardShotV2, board: Board): StoryboardStageState {
  return storyboardStageState(doc, shot, board, 'image')
}

function matchesLegacyShot(card: Card, shot: StoryboardShotV2, index: number): boolean {
  const legacy = (card.meta as any)?.shot as Shot | undefined
  if (!legacy) return false
  if (legacy.shotNumber && shot.shotNumber) return Number(legacy.shotNumber) === Number(shot.shotNumber)
  return card.title.startsWith(`镜${shot.shotNumber || index + 1}`)
}

/** 持久化迁移/修复：V1 meta.shots → V2，并修复缺失卡片引用与 backlink。 */
export function sanitizeStoryboardBoard(board: Board): Board {
  let changed = false
  const cards = { ...board.cards }
  for (const owner of Object.values(board.cards)) {
    if (owner.kind !== 'text') continue
    let doc = readStoryboardDoc(owner)
    if (!doc) continue
    const legacy = !(owner.meta as any)?.storyboardV2
    const used = new Set<string>()
    const outgoing = new Set(Object.values(board.edges).filter((edge) => edge.source === owner.id).map((edge) => edge.target))
    const shots = doc.shots.map((shot, index) => {
      let imageCardId = shot.imageCardId
      if (imageCardId && !cards[imageCardId]) imageCardId = undefined
      if (!imageCardId && legacy) {
        const candidate = Object.values(cards).find((card) => !used.has(card.id) && outgoing.has(card.id) && matchesLegacyShot(card, shot, index))
        if (candidate) imageCardId = candidate.id
      }
      if (imageCardId) {
        used.add(imageCardId)
        const imageCard = cards[imageCardId]
        const expected = backlinkFor(doc!, shot, 'image')
        const current = storyboardBacklink(imageCard)
        if (!current || stable(current) !== stable(expected)) {
          cards[imageCardId] = { ...imageCard, meta: { ...(imageCard.meta || {}), storyboardBacklink: expected } }
          changed = true
        }
      }
      for (const key of ['videoCardId', 'audioCardId'] as const) {
        const cardId = shot[key]
        if (cardId && !cards[cardId]) {
          shot = { ...shot, [key]: undefined }
          changed = true
        }
      }
      if (imageCardId !== shot.imageCardId) {
        changed = true
        return { ...shot, imageCardId }
      }
      return shot
    })
    if (shots.some((shot, index) => shot !== doc!.shots[index])) doc = { ...doc, shots, updatedAt: Date.now() }
    const meta = { ...(owner.meta || {}), storyboardV2: doc } as Record<string, unknown>
    if ('shots' in meta) delete meta.shots
    const currentRaw = (owner.meta as any)?.storyboardV2
    if (legacy || stable(currentRaw) !== stable(doc)) {
      cards[owner.id] = { ...owner, meta }
      changed = true
    }
  }
  return changed ? { ...board, cards } : board
}

export function detachCardsFromStoryboards(cards: Record<string, Card>, removedIds: ReadonlySet<string>): Record<string, Card> {
  let changed = false
  const next = { ...cards }
  for (const [ownerId, owner] of Object.entries(cards)) {
    const doc = readStoryboardDoc(owner)
    if (!doc) continue
    let docChanged = false
    const shots = doc.shots.map((shot) => {
      const patch: Partial<StoryboardShotV2> = {}
      if (shot.imageCardId && removedIds.has(shot.imageCardId)) patch.imageCardId = undefined
      if (shot.videoCardId && removedIds.has(shot.videoCardId)) patch.videoCardId = undefined
      if (shot.audioCardId && removedIds.has(shot.audioCardId)) patch.audioCardId = undefined
      if (!Object.keys(patch).length) return shot
      docChanged = true
      return { ...shot, ...patch }
    })
    if (!docChanged) continue
    const meta = { ...(owner.meta || {}), storyboardV2: { ...doc, shots, updatedAt: Date.now() } }
    next[ownerId] = { ...owner, meta }
    changed = true
  }
  return changed ? next : cards
}
