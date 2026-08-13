import type { Card, DirectorShot, MediaVersion, MediaVersionSource, MediaVersionState } from '../types'
import { useGraph } from '../store/graphStore'

type LegacyResult = { url?: string; localPath?: string; mime?: string }

function stableId(prefix: string, value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}_${(hash >>> 0).toString(36)}`
}

function mediaKey(value: Pick<MediaVersion, 'url' | 'localPath'>): string {
  return value.localPath || value.url
}

function isVersion(value: unknown): value is MediaVersion {
  const item = value as MediaVersion
  return !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.url === 'string' && (item.kind === 'image' || item.kind === 'video')
}

function traceFor(card: Card): { providerId?: string | null; modelId?: string | null; prompt?: string; createdAt: number } {
  const meta = card.meta as Record<string, any>
  const trace = meta.imageGeneration || meta.videoGeneration || {}
  return {
    providerId: trace.providerId ?? card.providerId,
    modelId: trace.modelId ?? card.modelId,
    prompt: typeof trace.sentPrompt === 'string' ? trace.sentPrompt : card.prompt,
    createdAt: Number.isFinite(trace.completedAt) ? trace.completedAt : Date.now()
  }
}

export function readCardMediaVersions(card: Card, fallbackSource: MediaVersionSource = 'import'): MediaVersionState {
  const meta = card.meta as Record<string, any>
  const saved = meta.mediaVersionsV1 as MediaVersionState | undefined
  const source: MediaVersionSource = fallbackSource !== 'import' ? fallbackSource
    : meta.localReshootV1 ? 'reshoot'
      : meta.editRecipe ? 'edit'
        : meta.imageGeneration || meta.videoGeneration ? 'generation'
          : 'import'
  const items = Array.isArray(saved?.items) ? saved!.items.filter(isVersion).map((item) => ({ ...item })) : []
  const known = new Set(items.map(mediaKey))
  const kind: MediaVersion['kind'] = card.kind === 'video' ? 'video' : 'image'
  const trace = traceFor(card)
  const legacy = (card.meta as Record<string, any>).results
  const results: LegacyResult[] = Array.isArray(legacy) ? legacy.filter((value) => value && typeof value === 'object') : []
  const candidates: LegacyResult[] = results.length
    ? results
    : card.assetUrl || card.assetLocalPath
      ? [{ url: card.assetUrl || undefined, localPath: card.assetLocalPath || undefined, mime: card.mime || undefined }]
      : []

  for (const candidate of candidates) {
    const url = candidate.url || (candidate.localPath ? `file:///${candidate.localPath.replace(/^\/+/, '')}` : '')
    if (!url) continue
    const key = candidate.localPath || url
    if (known.has(key)) continue
    const index = items.length + 1
    items.push({
      id: stableId('ver', `${kind}:${key}`),
      kind,
      url,
      localPath: candidate.localPath,
      mime: candidate.mime || card.mime || undefined,
      label: `${kind === 'image' ? '图片' : '视频'}版本 ${index}`,
      createdAt: trace.createdAt + index - 1,
      source,
      disposition: 'normal',
      prompt: trace.prompt,
      providerId: trace.providerId,
      modelId: trace.modelId
    })
    known.add(key)
  }

  const primaryKey = card.assetLocalPath || card.assetUrl || ''
  const primary = items.find((item) => mediaKey(item) === primaryKey)
  const currentId = primary?.id || (items.some((item) => item.id === saved?.currentId) ? saved!.currentId : items[0]?.id || '')
  const compare = saved?.compareIds?.filter((id): id is string => !!id && items.some((item) => item.id === id)).slice(0, 2) || []
  return { version: 1, currentId, compareIds: [compare[0], compare[1]], items }
}

export function cardMediaVersionMeta(card: Card, source: MediaVersionSource): Record<string, unknown> {
  return { ...card.meta, mediaVersionsV1: readCardMediaVersions(card, source) }
}

function updateVersionCard(cardId: string, mutate: (card: Card, state: MediaVersionState) => Partial<Card>): boolean {
  const graph = useGraph.getState()
  const card = graph.getCard(cardId)
  if (!card) return false
  graph.pushHistory()
  graph.updateCard(cardId, mutate(card, readCardMediaVersions(card)))
  return true
}

export function adoptCardMediaVersion(cardId: string, versionId: string): boolean {
  return updateVersionCard(cardId, (card, state) => {
    const item = state.items.find((version) => version.id === versionId)
    if (!item) return {}
    const meta = { ...card.meta, mediaVersionsV1: { ...state, currentId: item.id } } as Record<string, unknown>
    delete meta.thumb
    delete meta.thumbFor
    delete meta.poster
    delete meta.posterFor
    delete meta.fittedFor
    return { assetUrl: item.url, assetLocalPath: item.localPath || null, mime: item.mime || card.mime, meta }
  })
}

export function setCardVersionDisposition(cardId: string, versionId: string, disposition: MediaVersion['disposition']): boolean {
  return updateVersionCard(cardId, (card, state) => ({
    meta: {
      ...card.meta,
      mediaVersionsV1: { ...state, items: state.items.map((item) => item.id === versionId ? { ...item, disposition } : item) }
    }
  }))
}

export function setCardVersionCompareSlot(cardId: string, versionId: string, slot: 0 | 1): boolean {
  return updateVersionCard(cardId, (card, state) => {
    const compareIds: [string?, string?] = [...(state.compareIds || [])]
    compareIds[slot] = versionId
    return { meta: { ...card.meta, mediaVersionsV1: { ...state, compareIds } } }
  })
}

export function branchFromCardMediaVersion(cardId: string, versionId: string): string | null {
  const graph = useGraph.getState()
  const source = graph.getCard(cardId)
  const boardId = graph.boardIdOfCard(cardId)
  if (!source || !boardId) return null
  const item = readCardMediaVersions(source).items.find((version) => version.id === versionId)
  if (!item) return null
  const id = graph.addCard(item.kind, { x: source.x + source.w + 180, y: source.y + 40 }, {
    title: `${source.title} · 分支`,
    prompt: item.prompt || source.prompt,
    modelId: item.modelId ?? source.modelId,
    providerId: item.providerId ?? source.providerId,
    params: { ...source.params },
    status: 'done',
    progress: 1,
    assetUrl: item.url,
    assetLocalPath: item.localPath || null,
    mime: item.mime || source.mime,
    refIds: [source.id],
    anchorRefs: source.anchorRefs ? [...source.anchorRefs] : undefined,
    meta: {
      versionBranchV1: { sourceCardId: source.id, sourceVersionId: item.id, createdAt: Date.now() },
      mediaVersionsV1: { version: 1, currentId: item.id, compareIds: [], items: [{ ...item }] }
    }
  }, boardId)
  graph.setSelection([id])
  return id
}

export function readDirectorTakeVersions(shot: DirectorShot): MediaVersionState {
  const items = Array.isArray(shot.takeVersions) ? shot.takeVersions.filter(isVersion).map((item) => ({ ...item })) : []
  const known = new Set(items.map(mediaKey))
  for (const url of shot.takes || (shot.take ? [shot.take] : [])) {
    if (!url || known.has(url)) continue
    items.push({
      id: stableId('take', url),
      kind: 'image',
      url,
      label: `Take ${items.length + 1}`,
      createdAt: Date.now() + items.length,
      source: 'director',
      disposition: 'normal'
    })
    known.add(url)
  }
  const current = items.find((item) => item.url === shot.take)
  return { version: 1, currentId: current?.id || items.at(-1)?.id || '', compareIds: shot.compareTakeIds || [], items }
}

export function withDirectorTakeVersions(shot: DirectorShot): DirectorShot {
  const state = readDirectorTakeVersions(shot)
  return { ...shot, takeVersions: state.items, compareTakeIds: state.compareIds }
}
