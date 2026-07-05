/**
 * Toonflow 式重构 · 阶段2：项目持久化（host storage KV，命名空间 studio:*）。
 *
 * - studio:index            轻量卡片数组 ProjectCard[]（主页/切换器读它）
 * - studio:project:<id>     完整项目文档 ProjectDoc（懒加载）
 * - studio:current          当前项目 id
 *
 * 不考虑老节点图数据兼容（独立命名空间）。资产二进制仍走现有资产库（assetStore/saveAsset）。
 */
import type { Episode, GenState, ProjectCard, ProjectDoc, ProjectMeta, VideoTrack } from './types'

const PLUGIN_ID = 'ai-film-studio'
const INDEX_KEY = 'studio:index'
const CURRENT_KEY = 'studio:current'
const projectKey = (id: string) => `studio:project:${id}`
const INTERRUPTED_GENERATION_ERROR = '上次生成在完成前中断，请重新生成。'
const INTERRUPTED_PROMPT_ERROR = '上次提示词生成在完成前中断，请重新生成。'
const INTERRUPTED_POLISH_ERROR = '上次提示词润色在完成前中断，请重新润色。'
const INTERRUPTED_EPISODE_ERROR = '上次整集成片在完成前中断，请重新生成本集。'

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, PLUGIN_ID)
    return (v as T) ?? null
  } catch {
    return null
  }
}
async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await window.mulby?.storage?.set(key, value, PLUGIN_ID)
  } catch {
    // 忽略（浏览器调试态无 storage）
  }
}
async function kvRemove(key: string): Promise<void> {
  try {
    await window.mulby?.storage?.remove(key, PLUGIN_ID)
  } catch {
    // 忽略
  }
}

/** 生成短 id（无第三方依赖；时间戳由调用方传入以保证纯函数处可控） */
export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}${Date.now().toString(36)}${rand}`
}

export function docToCard(doc: ProjectDoc): ProjectCard {
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const episodeStoryboards = episodes.length
    ? episodes.map((episode) => (episode.id === doc.currentEpisodeId ? doc.storyboards : episode.storyboards))
    : [doc.storyboards]
  const storyboards = episodeStoryboards.flat()
  return {
    id: doc.meta.id,
    name: doc.meta.name,
    artStyle: doc.meta.artStyle,
    videoRatio: doc.meta.videoRatio,
    updatedAt: doc.meta.updatedAt,
    coverImageId: storyboards.find((s) => s.keyframeImageId)?.keyframeImageId,
    storyboardCount: storyboards.length,
    episodeCount: doc.episodes?.length,
  }
}

/** 空项目文档 */
export function emptyProjectDoc(meta: Pick<ProjectMeta, 'name'> & Partial<ProjectMeta>): ProjectDoc {
  const now = Date.now()
  const doc: ProjectDoc = {
    meta: {
      id: meta.id ?? newId('p_'),
      name: meta.name,
      intro: meta.intro,
      genre: meta.genre,
      artStyle: meta.artStyle ?? 'cinematic_realistic',
      videoRatio: meta.videoRatio || '16:9', // 用 || 兜空串：空画幅会导致视频不传 aspect_ratio → grok 默认竖屏
      imageModel: meta.imageModel,
      videoModel: meta.videoModel,
      videoMode: meta.videoMode,
      dialogueLang: meta.dialogueLang ?? '中文',
      directorManual: meta.directorManual,
      createdAt: meta.createdAt ?? now,
      updatedAt: now,
    },
    novel: [],
    scripts: [],
    assets: [],
    storyboards: [],
    clips: [],
    track: [],
    memory: [],
  }
  const episode = episodeFromFlat(doc, now)
  doc.episodes = [episode]
  doc.currentEpisodeId = episode.id
  return doc
}

function normalizeTrack(raw: unknown[] | undefined): VideoTrack[] {
  const rawTrack = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
  return rawTrack.map((t, i): VideoTrack => {
    const clipIds = Array.isArray(t.clipIds) ? (t.clipIds as unknown[]).filter((id): id is string => typeof id === 'string') : []
    const selectClipId = typeof t.selectClipId === 'string' ? t.selectClipId : undefined
    const order = typeof t.order === 'number' ? t.order : i
    if (Array.isArray(t.storyboardIds)) {
      return {
        ...t,
        id: String(t.id ?? newId('t_')),
        storyboardIds: (t.storyboardIds as unknown[]).filter((id): id is string => typeof id === 'string'),
        clipIds,
        selectClipId,
        order,
      } as VideoTrack
    }
    return {
      ...t,
      id: String(t.id ?? newId('t_')),
      storyboardIds: typeof t.storyboardId === 'string' ? [t.storyboardId] : [],
      clipIds,
      selectClipId,
      order,
    }
  })
}

function syncTracksForStoryboards(storyboards: ProjectDoc['storyboards'], track: VideoTrack[]): VideoTrack[] {
  const storyboardIds = new Set(storyboards.map((storyboard) => storyboard.id))
  const normalized = track
    .map((item) => ({ ...item, storyboardIds: item.storyboardIds.filter((id) => storyboardIds.has(id)) }))
    .filter((item) => item.storyboardIds.length > 0 || !!item.kind || !!item.clipAssetId)
  const assigned = new Set<string>()
  for (const item of normalized) for (const storyboardId of item.storyboardIds) assigned.add(storyboardId)
  for (const storyboard of [...storyboards].sort((a, b) => a.index - b.index)) {
    if (assigned.has(storyboard.id)) continue
    normalized.push({ id: newId('t_'), storyboardIds: [storyboard.id], clipIds: [], order: normalized.length })
    assigned.add(storyboard.id)
  }
  const storyboardIndex = (item: VideoTrack): number => {
    const first = item.storyboardIds[0]
    const storyboard = first ? storyboards.find((candidate) => candidate.id === first) : undefined
    return storyboard ? storyboard.index : Number.MAX_SAFE_INTEGER
  }
  return normalized
    .map((item, index) => ({ item, index }))
    .sort((a, b) => storyboardIndex(a.item) - storyboardIndex(b.item) || a.index - b.index)
    .map(({ item }, order) => ({ ...item, order }))
}

function episodeFromFlat(doc: ProjectDoc, now = Date.now()): Episode {
  return {
    id: doc.currentEpisodeId ?? newId('ep_'),
    index: 0,
    title: '第 1 集',
    scripts: doc.scripts,
    storyboards: doc.storyboards,
    storyboardTable: doc.storyboardTable,
    clips: doc.clips,
    track: doc.track,
    createdAt: doc.meta.createdAt ?? now,
    updatedAt: doc.meta.updatedAt ?? now,
  }
}

function normalizeEpisode(raw: Episode, index: number): Episode {
  const episode = raw as Episode & { track?: unknown[] }
  const normalized = {
    ...episode,
    id: String(episode.id ?? newId('ep_')),
    index: typeof episode.index === 'number' ? episode.index : index,
    title: typeof episode.title === 'string' && episode.title.trim() ? episode.title : `第 ${index + 1} 集`,
    scripts: Array.isArray(episode.scripts) ? episode.scripts : [],
    storyboards: Array.isArray(episode.storyboards) ? episode.storyboards : [],
    storyboardTable: Array.isArray(episode.storyboardTable) ? episode.storyboardTable : undefined,
    clips: Array.isArray(episode.clips) ? episode.clips : [],
    track: normalizeTrack(episode.track),
    createdAt: typeof episode.createdAt === 'number' ? episode.createdAt : Date.now(),
    updatedAt: typeof episode.updatedAt === 'number' ? episode.updatedAt : Date.now(),
  }
  normalized.track = syncTracksForStoryboards(normalized.storyboards, normalized.track)
  return normalized
}

function recoverGeneratingState(item: { state?: GenState; error?: string }): boolean {
  if (item.state !== 'generating') return false
  item.state = 'failed'
  item.error ||= INTERRUPTED_GENERATION_ERROR
  return true
}

function recoverTrackPrompt(track: VideoTrack): boolean {
  if (track.promptState !== 'generating') return false
  track.promptState = 'failed'
  track.promptError ||= INTERRUPTED_PROMPT_ERROR
  return true
}

function recoverEpisodeInterruptedState(episode: Episode, now: number): boolean {
  let changed = false
  if (episode.status === 'generating') {
    episode.status = 'planned'
    episode.filmError ||= INTERRUPTED_EPISODE_ERROR
    changed = true
  }
  for (const storyboard of episode.storyboards) changed = recoverGeneratingState(storyboard) || changed
  for (const clip of episode.clips) changed = recoverGeneratingState(clip) || changed
  for (const track of episode.track) changed = recoverTrackPrompt(track) || changed
  if (changed) episode.updatedAt = now
  return changed
}

export function recoverInterruptedGenerationState(doc: ProjectDoc, now = Date.now()): boolean {
  let changed = false
  for (const chapter of doc.novel ?? []) {
    if (chapter.eventState === 'generating') {
      chapter.eventState = 'failed'
      changed = true
    }
  }
  for (const asset of doc.assets ?? []) {
    changed = recoverGeneratingState(asset) || changed
    if (asset.promptState === 'polishing') {
      asset.promptState = 'failed'
      asset.promptError ||= INTERRUPTED_POLISH_ERROR
      changed = true
    }
    for (const image of asset.images ?? []) changed = recoverGeneratingState(image) || changed
    for (const variant of asset.variants ?? []) changed = recoverGeneratingState(variant) || changed
  }
  for (const episode of doc.episodes ?? []) changed = recoverEpisodeInterruptedState(episode, now) || changed
  for (const storyboard of doc.storyboards ?? []) changed = recoverGeneratingState(storyboard) || changed
  for (const clip of doc.clips ?? []) changed = recoverGeneratingState(clip) || changed
  for (const track of doc.track ?? []) changed = recoverTrackPrompt(track) || changed
  return changed
}

export function syncCurrentEpisodeFromFlat(doc: ProjectDoc): void {
  if (!Array.isArray(doc.episodes) || doc.episodes.length === 0) {
    const episode = episodeFromFlat(doc)
    doc.episodes = [episode]
    doc.currentEpisodeId = episode.id
    return
  }
  let episode = doc.episodes.find((e) => e.id === doc.currentEpisodeId)
  if (!episode) {
    episode = doc.episodes[0]
    doc.currentEpisodeId = episode.id
  }
  episode.scripts = doc.scripts
  episode.storyboards = doc.storyboards
  episode.storyboardTable = doc.storyboardTable
  episode.clips = doc.clips
  episode.track = doc.track
  episode.updatedAt = doc.meta.updatedAt
}

export function applyEpisodeToFlat(doc: ProjectDoc, episode: Episode): void {
  doc.scripts = episode.scripts
  doc.storyboards = episode.storyboards
  doc.storyboardTable = episode.storyboardTable
  doc.clips = episode.clips
  doc.track = episode.track
}

/**
 * 阶段2 迁移：把旧 doc 规范化到当前模型——
 * - track: 旧 VideoTrackItem{storyboardId} → VideoTrack{storyboardIds:[..], order}（一次性、幂等）。
 * - 必填数组字段兜底（旧 doc 可能缺新增字段）。旧 doc 残留的 events 字段无害，忽略即可。
 */
function normalizeDoc(raw: ProjectDoc): ProjectDoc {
  const doc = raw as ProjectDoc & { track?: unknown[]; episodes?: unknown[] }
  doc.track = normalizeTrack(doc.track)
  doc.novel ??= []
  doc.scripts ??= []
  doc.assets ??= []
  doc.storyboards ??= []
  doc.clips ??= []
  doc.memory ??= []
  doc.track = syncTracksForStoryboards(doc.storyboards, doc.track)
  doc.episodes = Array.isArray(doc.episodes) ? (doc.episodes as Episode[]).map((e, i) => normalizeEpisode(e, i)) : []
  if (doc.episodes.length === 0) doc.episodes = [episodeFromFlat(doc)]
  if (!doc.currentEpisodeId || !doc.episodes.some((e) => e.id === doc.currentEpisodeId)) doc.currentEpisodeId = doc.episodes[0].id
  const current = doc.episodes.find((e) => e.id === doc.currentEpisodeId) ?? doc.episodes[0]
  const flatHasContent =
    doc.scripts.length > 0 ||
    doc.storyboards.length > 0 ||
    doc.clips.length > 0 ||
    doc.track.length > 0 ||
    (doc.storyboardTable?.length ?? 0) > 0
  if (!flatHasContent && current) applyEpisodeToFlat(doc, current)
  else syncCurrentEpisodeFromFlat(doc)
  if (doc.meta && !doc.meta.videoRatio) doc.meta.videoRatio = '16:9' // 旧/空画幅 doc 兜底，避免视频出竖屏
  recoverInterruptedGenerationState(doc)
  return doc
}

export async function loadIndex(): Promise<ProjectCard[]> {
  return (await kvGet<ProjectCard[]>(INDEX_KEY)) ?? []
}

async function saveIndex(cards: ProjectCard[]): Promise<void> {
  await kvSet(INDEX_KEY, cards)
}

export async function loadProject(id: string): Promise<ProjectDoc | null> {
  const raw = await kvGet<ProjectDoc>(projectKey(id))
  return raw ? normalizeDoc(raw) : null
}

/** 保存项目（更新 updatedAt + index 卡片，原子性靠 KV 自身） */
export async function saveProject(doc: ProjectDoc): Promise<void> {
  doc.meta.updatedAt = Date.now()
  syncCurrentEpisodeFromFlat(doc)
  await kvSet(projectKey(doc.meta.id), doc)
  const index = await loadIndex()
  const card = docToCard(doc)
  const i = index.findIndex((c) => c.id === doc.meta.id)
  if (i >= 0) index[i] = card
  else index.unshift(card)
  index.sort((a, b) => b.updatedAt - a.updatedAt)
  await saveIndex(index)
}

export async function deleteProject(id: string): Promise<void> {
  await kvRemove(projectKey(id))
  await saveIndex((await loadIndex()).filter((c) => c.id !== id))
  if ((await getCurrentId()) === id) await setCurrentId(null)
}

export async function getCurrentId(): Promise<string | null> {
  return kvGet<string>(CURRENT_KEY)
}
export async function setCurrentId(id: string | null): Promise<void> {
  if (id) await kvSet(CURRENT_KEY, id)
  else await kvRemove(CURRENT_KEY)
}
