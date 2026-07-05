/**
 * Toonflow 式重构 · 阶段6（§6.1）：Agent 工具集——把 projectStore 动作暴露为可被工具循环调用的 AgentTool。
 * 同进程直调 store（替代 Toonflow 的 socket.emit）。get 为 projectStore 的 getState（type-only 引入，无运行期循环）。
 */
import type { AgentTool } from './runtime'
import type { ProjectState } from '../../store/projectStore'
import type { Asset, Episode, ProjectDoc, Storyboard, StoryboardCastRef } from '../../domain/types'
import { castRefsForStoryboard, labelForCastRef } from '../../domain/castRefs'
import { buildContinuityReport } from '../services/continuityReport'

type ProjectDocGetter = () => ProjectDoc | null

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function boolArg(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function numberArg(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

function textBlock(value: string | undefined, limit: number) {
  const text = value ?? ''
  return {
    text: limit > 0 && text.length > limit ? text.slice(0, limit) : text,
    length: text.length,
    truncated: limit > 0 && text.length > limit,
  }
}

function assetNameMap(doc: ProjectDoc): Map<string, string> {
  return new Map(doc.assets.map((a) => [a.id, a.name]))
}

function assetNames(doc: ProjectDoc, ids: string[] | undefined): string[] {
  const names = assetNameMap(doc)
  return (ids ?? []).map((id) => names.get(id) ?? id)
}

function castNames(doc: ProjectDoc, storyboard: Storyboard): string[] {
  const assets = new Map(doc.assets.map((a) => [a.id, a]))
  return castRefsForStoryboard(storyboard).map((ref) => labelForCastRef(assets.get(ref.assetId), ref))
}

function storyboardView(doc: ProjectDoc, s: Storyboard, opts?: { includePrompt?: boolean; includeDialogues?: boolean; includeAssets?: boolean }) {
  const castRefs = castRefsForStoryboard(s)
  return {
    id: s.id,
    index: s.index + 1,
    track: s.track,
    videoDesc: s.videoDesc,
    prompt: opts?.includePrompt === false ? undefined : s.prompt,
    shotSize: s.shotSize,
    cameraMove: s.cameraMove,
    duration: s.duration,
    castAssetIds: castRefs.map((ref) => ref.assetId),
    castRefs,
    castNames: opts?.includeAssets === false ? undefined : castNames(doc, s),
    shouldGenerateImage: s.shouldGenerateImage,
    keyframeImageId: s.keyframeImageId,
    chainFromPrev: s.chainFromPrev,
    sceneId: s.sceneId,
    dialogues: opts?.includeDialogues === false ? undefined : s.dialogues,
    flowId: s.flowId,
    state: s.state,
    error: s.error,
  }
}

function assetView(a: Asset, opts?: { includePrompt?: boolean; includeImages?: boolean }) {
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    desc: a.desc,
    prompt: opts?.includePrompt === false ? undefined : a.prompt,
    refImageId: a.refImageId,
    parentAssetId: a.parentAssetId,
    state: a.state,
    error: a.error,
    currentImageId: a.currentImageId,
    images: opts?.includeImages === false ? undefined : a.images,
    variants: a.variants,
    promptState: a.promptState,
    promptError: a.promptError,
    derivedFromImageId: a.derivedFromImageId,
    elementId: a.elementId,
    flowId: a.flowId,
    voice: a.voice,
    voiceAssetId: a.voiceAssetId,
    audioBindState: a.audioBindState,
    audioFilePath: a.audioFilePath,
    audioUrl: a.audioUrl,
    sex: a.sex,
  }
}

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function episodeView(doc: ProjectDoc, episode: Episode) {
  return {
    id: episode.id,
    index: episode.index + 1,
    title: episode.title,
    summary: episode.summary,
    status: episode.status,
    current: episode.id === doc.currentEpisodeId,
    counts: {
      novelChapters: episode.novelChapterIds?.length ?? 0,
      scripts: episode.scripts.length,
      storyboards: episode.storyboards.length,
      clips: episode.clips.length,
      tracks: episode.track.length,
      storyboardTableScenes: episode.storyboardTable?.length ?? 0,
    },
    updatedAt: episode.updatedAt,
  }
}

function overview(doc: ProjectDoc) {
  const sortedStoryboards = [...doc.storyboards].sort((a, b) => a.index - b.index)
  const episodes = sortedEpisodes(doc)
  return {
    meta: doc.meta,
    currentEpisodeId: doc.currentEpisodeId,
    counts: {
      episodes: episodes.length,
      scripts: doc.scripts.length,
      assets: doc.assets.length,
      rootAssets: doc.assets.filter((a) => !a.parentAssetId).length,
      storyboards: doc.storyboards.length,
      clips: doc.clips.length,
      tracks: doc.track.length,
      novelChapters: doc.novel.length,
      storyboardTableScenes: doc.storyboardTable?.length ?? 0,
    },
    episodes: episodes.map((episode) => episodeView(doc, episode)),
    scripts: doc.scripts.map((s, i) => ({ id: s.id, index: i + 1, name: s.name, length: s.content.length, updatedAt: s.updatedAt })),
    assets: doc.assets
      .filter((a) => !a.parentAssetId)
      .map((a) => ({ id: a.id, type: a.type, name: a.name, state: a.state, hasPrompt: !!a.prompt, hasRefImage: !!a.refImageId })),
    storyboards: sortedStoryboards.map((s) => ({
      id: s.id,
      index: s.index + 1,
      track: s.track,
      videoDesc: s.videoDesc,
      duration: s.duration,
      castNames: castNames(doc, s),
      dialogueCount: s.dialogues?.length ?? 0,
      state: s.state,
      hasKeyframe: !!s.keyframeImageId,
    })),
    novel: doc.novel.map((c) => ({ id: c.id, index: c.index + 1, title: c.title, textLength: c.text.length, event: c.event, eventState: c.eventState })),
  }
}

function snippet(text: string, query: string, max = 240): string {
  const t = text ?? ''
  const q = query.trim().toLowerCase()
  const i = q ? t.toLowerCase().indexOf(q) : -1
  if (i < 0) return t.slice(0, max)
  const half = Math.floor(max / 2)
  const start = Math.max(0, i - half)
  const end = Math.min(t.length, start + max)
  return `${start > 0 ? '...' : ''}${t.slice(start, end)}${end < t.length ? '...' : ''}`
}

function resolveEpisode(doc: ProjectDoc, args: Record<string, unknown>): Episode | undefined {
  const episodes = sortedEpisodes(doc)
  if (typeof args.episodeId === 'string') {
    const episodeId = args.episodeId.trim()
    return episodeId ? episodes.find((episode) => episode.id === episodeId) : undefined
  }
  if (typeof args.index === 'number') return episodes[Math.max(0, Math.floor(args.index) - 1)]
  if (typeof args.title === 'string') {
    const title = args.title.trim().toLowerCase()
    if (!title) return undefined
    return episodes.find((episode) => episode.title.toLowerCase() === title) ?? episodes.find((episode) => episode.title.toLowerCase().includes(title))
  }
  return undefined
}

function chapterEpisodeRefs(doc: ProjectDoc, chapterId: string) {
  return sortedEpisodes(doc)
    .filter((episode) => episode.novelChapterIds?.includes(chapterId))
    .map((episode) => ({ id: episode.id, index: episode.index + 1, title: episode.title, current: episode.id === doc.currentEpisodeId }))
}

function resolveChapterIds(doc: ProjectDoc, args: Record<string, unknown>): { ids: string[]; unresolved: unknown[] } {
  const ids: string[] = []
  const unresolved: unknown[] = []
  const valid = new Set(doc.novel.map((chapter) => chapter.id))
  const pushId = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return
    const id = value.trim()
    if (valid.has(id)) ids.push(id)
    else unresolved.push(value)
  }
  const pushIndex = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return
    const chapter = doc.novel[Math.max(0, Math.floor(value) - 1)]
    if (chapter) ids.push(chapter.id)
    else unresolved.push(value)
  }
  for (const value of Array.isArray(args.chapterIds) ? args.chapterIds : []) pushId(value)
  for (const value of Array.isArray(args.chapterIndexes) ? args.chapterIndexes : []) pushIndex(value)
  return { ids: [...new Set(ids)], unresolved }
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isCastableAsset(asset: Asset): boolean {
  return !asset.parentAssetId && (asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop')
}

function findCastableAsset(doc: ProjectDoc, token: unknown): Asset | undefined {
  const text = stringArg(token)
  if (!text) return undefined
  const lower = text.toLowerCase()
  const assets = doc.assets.filter(isCastableAsset)
  return assets.find((asset) => asset.id === text) ?? assets.find((asset) => asset.name.toLowerCase() === lower)
}

function findAssetVariant(asset: Asset, token: unknown) {
  const text = stringArg(token)
  if (!text) return undefined
  const lower = text.toLowerCase()
  return asset.variants?.find((variant) => variant.id === text) ?? asset.variants?.find((variant) => variant.label.toLowerCase() === lower)
}

function roleInShot(value: unknown): StoryboardCastRef['roleInShot'] | undefined {
  return value === 'lead' || value === 'supporting' || value === 'background' ? value : undefined
}

function parseCastString(doc: ProjectDoc, raw: unknown): { ref?: StoryboardCastRef; unresolved?: string } {
  const text = stringArg(raw)
  if (!text) return {}
  const exact = findCastableAsset(doc, text)
  if (exact) return { ref: { assetId: exact.id } }

  const assets = doc.assets.filter(isCastableAsset).sort((a, b) => b.name.length - a.name.length)
  for (const asset of assets) {
    if (!text.toLowerCase().startsWith(asset.name.toLowerCase())) continue
    let variantToken = text.slice(asset.name.length).trim()
    variantToken = variantToken.replace(/^[\s\-—–_:：/|·]+/, '').trim()
    variantToken = variantToken.replace(/^[（(\[]/, '').replace(/[）)\]]$/, '').trim()
    if (!variantToken) return { ref: { assetId: asset.id } }
    const variant = findAssetVariant(asset, variantToken)
    if (variant) return { ref: { assetId: asset.id, variantId: variant.id } }
    return { ref: { assetId: asset.id, note: `未找到变体：${variantToken}` }, unresolved: `${text}（未找到变体「${variantToken}」）` }
  }

  return { unresolved: text }
}

function parseCastObject(doc: ProjectDoc, value: Record<string, unknown>): { ref?: StoryboardCastRef; unresolved?: string } {
  const asset =
    findCastableAsset(doc, value.assetId) ??
    findCastableAsset(doc, value.assetName) ??
    findCastableAsset(doc, value.name) ??
    findCastableAsset(doc, value.asset)
  if (!asset) {
    const fromName = parseCastString(doc, value.name ?? value.assetName)
    return fromName.ref ? fromName : { unresolved: stringArg(value.name ?? value.assetName ?? value.assetId) ?? JSON.stringify(value) }
  }

  const variantToken = value.variantId ?? value.variantLabel ?? value.variant ?? value.label
  const variant = findAssetVariant(asset, variantToken)
  const note = stringArg(value.note)
  const ref: StoryboardCastRef = {
    assetId: asset.id,
    variantId: variant?.id,
    roleInShot: roleInShot(value.roleInShot),
    note,
  }
  if (variantToken && !variant) {
    ref.note = [note, `未找到变体：${String(variantToken)}`].filter(Boolean).join('；')
    return { ref, unresolved: `${asset.name}（未找到变体「${String(variantToken)}」）` }
  }
  return { ref }
}

function storyboardCastRefsFromArgs(doc: ProjectDoc, args: Record<string, unknown>): { refs: StoryboardCastRef[]; unresolved: string[] } {
  const unresolved: string[] = []
  const byKey = new Map<string, StoryboardCastRef>()
  const push = (result: { ref?: StoryboardCastRef; unresolved?: string }) => {
    if (result.unresolved) unresolved.push(result.unresolved)
    if (!result.ref?.assetId) return
    const key = `${result.ref.assetId}:${result.ref.variantId ?? ''}`
    byKey.set(key, result.ref)
  }

  const castRefs = Array.isArray(args.castRefs) ? args.castRefs : []
  for (const item of castRefs) {
    if (item && typeof item === 'object' && !Array.isArray(item)) push(parseCastObject(doc, item as Record<string, unknown>))
    else push(parseCastString(doc, item))
  }

  const cast = Array.isArray(args.cast) ? args.cast : []
  for (const item of cast) {
    if (item && typeof item === 'object' && !Array.isArray(item)) push(parseCastObject(doc, item as Record<string, unknown>))
    else push(parseCastString(doc, item))
  }

  return { refs: [...byKey.values()], unresolved }
}

function stringArrayArg(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.map((item) => stringArg(item)).filter((item): item is string => !!item)
  return items.length ? items : undefined
}

function variantView(asset: Asset, variantId: string) {
  const variant = asset.variants?.find((item) => item.id === variantId)
  return variant ? { assetId: asset.id, assetName: asset.name, variant } : undefined
}

function resolveStoryboard(doc: ProjectDoc, args: Record<string, unknown>): Storyboard | undefined {
  if (typeof args.storyboardId === 'string' && args.storyboardId.trim()) return doc.storyboards.find((storyboard) => storyboard.id === args.storyboardId.trim())
  if (typeof args.index === 'number') {
    const sorted = [...doc.storyboards].sort((a, b) => a.index - b.index)
    return sorted[Math.max(0, Math.floor(args.index) - 1)]
  }
  return undefined
}

export function makeProjectReadTools(getDoc: ProjectDocGetter): AgentTool[] {
  const doc = getDoc
  return [
    {
      name: 'get_workspace',
      description: '读取当前工作区结构化概览。适合每轮开始先看项目真实状态，再决定是否读取完整剧本/分镜/资产。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        return d ? json(overview(d)) : '无打开的项目'
      },
    },
    {
      name: 'get_project_overview',
      description: '读取当前项目的 meta、数量统计、剧本/资产/分镜/章节概览。不会返回长文本正文。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        return d ? json(overview(d)) : '无打开的项目'
      },
    },
    {
      name: 'get_episodes',
      description: 'Read episode list and current episode before multi-episode planning or editing.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        return d ? json({ currentEpisodeId: d.currentEpisodeId, episodes: sortedEpisodes(d).map((episode) => episodeView(d, episode)) }) : '无打开的项目'
      },
    },
    {
      name: 'get_continuity_report',
      description: 'Audit multi-episode asset and variant consistency: per-episode cast refs, missing assets/images, and variants used outside their episode scope.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        return d ? json(buildContinuityReport(d)) : '无打开的项目'
      },
    },
    {
      name: 'get_script',
      description: '读取完整或指定长度的剧本正文。默认读取主剧本，可用 scriptId 或 index(1-based) 指定。',
      parameters: {
        type: 'object',
        properties: {
          scriptId: { type: 'string' },
          index: { type: 'number', description: '1-based 剧本序号' },
          contentLimit: { type: 'number', description: '正文最多返回字符数，默认 12000，最大 50000' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const limit = numberArg(a.contentLimit, 12000, 0, 50000)
        const idx = typeof a.index === 'number' ? Math.max(0, Math.floor(a.index) - 1) : 0
        const script = typeof a.scriptId === 'string' ? d.scripts.find((s) => s.id === a.scriptId) : d.scripts[idx]
        if (!script) return json({ error: '未找到剧本', scripts: d.scripts.map((s, i) => ({ id: s.id, index: i + 1, name: s.name })) })
        return json({ id: script.id, index: d.scripts.indexOf(script) + 1, name: script.name, createdAt: script.createdAt, updatedAt: script.updatedAt, content: textBlock(script.content, limit) })
      },
    },
    {
      name: 'get_storyboards',
      description: '读取真实分镜列表，包含画面、提示词、时长、对白、关联资产、生成状态等。支持 startIndex/count 分页。',
      parameters: {
        type: 'object',
        properties: {
          startIndex: { type: 'number', description: '1-based 起始分镜序号，默认 1' },
          count: { type: 'number', description: '最多读取多少条，默认全部，最大 200' },
          includePrompt: { type: 'boolean' },
          includeDialogues: { type: 'boolean' },
          includeAssets: { type: 'boolean' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const sorted = [...d.storyboards].sort((x, y) => x.index - y.index)
        const start = numberArg(a.startIndex, 1, 1, Math.max(1, sorted.length)) - 1
        const count = numberArg(a.count, sorted.length, 1, 200)
        const slice = sorted.slice(start, start + count)
        return json({
          total: sorted.length,
          startIndex: start + 1,
          count: slice.length,
          storyboards: slice.map((s) =>
            storyboardView(d, s, {
              includePrompt: boolArg(a.includePrompt, true),
              includeDialogues: boolArg(a.includeDialogues, true),
              includeAssets: boolArg(a.includeAssets, true),
            }),
          ),
        })
      },
    },
    {
      name: 'get_assets',
      description: '读取真实资产列表，包含角色/场景/物品/音色/片段素材的描述、提示词、图片和生成状态。可按 type/name 过滤。',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['role', 'scene', 'prop', 'audio', 'clip'] },
          name: { type: 'string' },
          includeDerived: { type: 'boolean', description: '是否包含衍生/子资产，默认 true' },
          includePrompt: { type: 'boolean' },
          includeImages: { type: 'boolean' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const includeDerived = boolArg(a.includeDerived, true)
        const name = typeof a.name === 'string' ? a.name.trim().toLowerCase() : ''
        const assets = d.assets.filter((x) => {
          if (!includeDerived && x.parentAssetId) return false
          if (typeof a.type === 'string' && x.type !== a.type) return false
          if (name && !x.name.toLowerCase().includes(name)) return false
          return true
        })
        return json({
          total: assets.length,
          assets: assets.map((x) => assetView(x, { includePrompt: boolArg(a.includePrompt, true), includeImages: boolArg(a.includeImages, true) })),
        })
      },
    },
    {
      name: 'get_novel',
      description: '读取原著章节、章节事件和大纲素材。默认不返回章节全文；需要全文时设置 includeText=true。',
      parameters: {
        type: 'object',
        properties: {
          chapterId: { type: 'string' },
          chapterIndex: { type: 'number', description: '1-based 章节序号' },
          includeText: { type: 'boolean' },
          textLimit: { type: 'number', description: '每章正文最多返回字符数，默认 6000，最大 50000' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const includeText = boolArg(a.includeText, false)
        const limit = numberArg(a.textLimit, 6000, 0, 50000)
        const one =
          typeof a.chapterId === 'string'
            ? d.novel.find((c) => c.id === a.chapterId)
            : typeof a.chapterIndex === 'number'
              ? d.novel[Math.max(0, Math.floor(a.chapterIndex) - 1)]
              : undefined
        const chapters = one ? [one] : d.novel
        return json({
          total: d.novel.length,
          chapters: chapters.map((c) => ({
            id: c.id,
            index: c.index + 1,
            title: c.title,
            episodes: chapterEpisodeRefs(d, c.id),
            event: c.event,
            eventState: c.eventState,
            text: includeText ? textBlock(c.text, limit) : { length: c.text.length, omitted: true },
          })),
        })
      },
    },
    {
      name: 'get_storyboard_table',
      description: '读取设计层分镜表/大纲（场次、段落、镜头行）。当用户问大纲、段落、分场或结构时优先使用。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        return d ? json({ scenes: d.storyboardTable ?? [] }) : '无打开的项目'
      },
    },
    {
      name: 'get_timeline',
      description: '读取时间线、视频段和候选片段状态，包含 clip 路径、时长、选中候选和生成状态。',
      parameters: { type: 'object', properties: { includeClips: { type: 'boolean' } } },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const includeClips = boolArg(a.includeClips, true)
        return json({
          tracks: [...d.track].sort((x, y) => x.order - y.order).map((t) => ({
            id: t.id,
            order: t.order,
            kind: t.kind,
            storyboardIds: t.storyboardIds,
            storyboardIndexes: t.storyboardIds.map((id) => {
              const sb = d.storyboards.find((s) => s.id === id)
              return sb ? sb.index + 1 : id
            }),
            duration: t.duration,
            prompt: t.prompt,
            promptState: t.promptState,
            promptError: t.promptError,
            videoMode: t.videoMode,
            clipIds: t.clipIds,
            selectClipId: t.selectClipId,
            audioClipId: t.audioClipId,
            clipAssetId: t.clipAssetId,
          })),
          clips: includeClips ? d.clips : undefined,
        })
      },
    },
    {
      name: 'search_project',
      description: '按关键词搜索当前项目的剧本、资产、分镜、原著章节和分镜表。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          domains: { type: 'array', items: { type: 'string', enum: ['episodes', 'scripts', 'assets', 'storyboards', 'novel', 'storyboardTable'] } },
          limit: { type: 'number', description: '每类最多返回条数，默认 8，最大 30' },
        },
        required: ['query'],
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const q = String(a.query ?? '').trim()
        if (!q) return json({ error: 'query 不能为空' })
        const domains = Array.isArray(a.domains) ? new Set((a.domains as unknown[]).map(String)) : null
        const wants = (name: string) => !domains || domains.has(name)
        const limit = numberArg(a.limit, 8, 1, 30)
        const has = (s: string | undefined) => (s ?? '').toLowerCase().includes(q.toLowerCase())
        return json({
          query: q,
          episodes: wants('episodes')
            ? sortedEpisodes(d)
                .filter((episode) => has(episode.title) || has(episode.summary))
                .slice(0, limit)
                .map((episode) => episodeView(d, episode))
            : undefined,
          scripts: wants('scripts')
            ? d.scripts
                .filter((s) => has(s.name) || has(s.content))
                .slice(0, limit)
                .map((s, i) => ({ id: s.id, index: i + 1, name: s.name, snippet: snippet(s.content, q) }))
            : undefined,
          assets: wants('assets')
            ? d.assets
                .filter((asset) => has(asset.name) || has(asset.desc) || has(asset.prompt))
                .slice(0, limit)
                .map((asset) => ({ id: asset.id, type: asset.type, name: asset.name, desc: asset.desc, promptSnippet: snippet(asset.prompt ?? '', q, 180) }))
            : undefined,
          storyboards: wants('storyboards')
            ? d.storyboards
                .filter((s) => has(s.videoDesc) || has(s.prompt) || (s.dialogues ?? []).some((dl) => has(dl.character) || has(dl.line)))
                .sort((x, y) => x.index - y.index)
                .slice(0, limit)
                .map((s) => ({ id: s.id, index: s.index + 1, videoDesc: s.videoDesc, promptSnippet: snippet(s.prompt ?? '', q, 180), dialogues: s.dialogues }))
            : undefined,
          novel: wants('novel')
            ? d.novel
                .filter((c) => has(c.title) || has(c.event) || has(c.text))
                .slice(0, limit)
                .map((c) => ({ id: c.id, index: c.index + 1, title: c.title, event: c.event, snippet: snippet(c.text, q) }))
            : undefined,
          storyboardTable: wants('storyboardTable')
            ? (d.storyboardTable ?? [])
                .filter((scene) => has(scene.sceneName) || scene.segments.some((seg) => has(seg.title) || seg.rows.some((row) => has(row.videoDesc) || has(row.dialogue))))
                .slice(0, limit)
            : undefined,
        })
      },
    },
  ]
}

export function makeAgentTools(get: () => ProjectState): AgentTool[] {
  const doc = () => get().doc
  return [
    ...makeProjectReadTools(doc),
    {
      name: 'upsert_script',
      description: '写入或更新剧本',
      parameters: { type: 'object', properties: { name: { type: 'string' }, content: { type: 'string', description: '剧本正文' } }, required: ['content'] },
      execute: async (a) => {
        get().upsertScript({ name: typeof a.name === 'string' ? a.name : undefined, content: String(a.content ?? '') })
        return '剧本已更新'
      },
    },
    {
      name: 'create_episode',
      description: 'Create a new episode and switch the workspace to it. Use before writing script/storyboards for a new episode.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      execute: async (a) => {
        if (!doc()) return '无打开的项目'
        const id = get().createEpisode()
        if (typeof a.title === 'string' && a.title.trim()) get().renameEpisode(id, a.title)
        if (typeof a.summary === 'string') {
          const summary = a.summary.trim()
          get().mutate((d) => {
            const episode = d.episodes?.find((e) => e.id === id)
            if (episode) {
              episode.summary = summary
              episode.updatedAt = Date.now()
            }
          })
        }
        const next = get().doc
        const episode = next?.episodes?.find((e) => e.id === id)
        return json({ id, currentEpisodeId: next?.currentEpisodeId, episode: next && episode ? episodeView(next, episode) : undefined })
      },
    },
    {
      name: 'switch_episode',
      description: 'Switch current workspace to an existing episode by episodeId, 1-based index, or title before editing it.',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          index: { type: 'number' },
          title: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisode(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: sortedEpisodes(d).map((e) => episodeView(d, e)) })
        get().switchEpisode(episode.id)
        const next = get().doc ?? d
        const current = next.episodes?.find((e) => e.id === episode.id) ?? episode
        return json({ currentEpisodeId: next.currentEpisodeId, episode: episodeView(next, current) })
      },
    },
    {
      name: 'rename_episode',
      description: 'Rename an existing episode by episodeId, 1-based index, or current title.',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          index: { type: 'number' },
          title: { type: 'string', description: 'Current title when episodeId/index is omitted.' },
          newTitle: { type: 'string' },
        },
        required: ['newTitle'],
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisode(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: sortedEpisodes(d).map((e) => episodeView(d, e)) })
        get().renameEpisode(episode.id, String(a.newTitle ?? ''))
        const next = get().doc ?? d
        const renamed = next.episodes?.find((e) => e.id === episode.id) ?? episode
        return json({ id: renamed.id, episode: episodeView(next, renamed) })
      },
    },
    {
      name: 'assign_episode_chapters',
      description: 'Assign imported novel chapters to an episode. Use when planning multi-episode adaptation coverage before writing episode scripts.',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          index: { type: 'number', description: '1-based episode index when episodeId is omitted.' },
          title: { type: 'string', description: 'Episode title when episodeId/index is omitted.' },
          chapterIds: { type: 'array', items: { type: 'string' } },
          chapterIndexes: { type: 'array', items: { type: 'number' }, description: '1-based novel chapter indexes.' },
          mode: { type: 'string', enum: ['replace', 'add', 'remove'], description: 'Default replace.' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisode(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: sortedEpisodes(d).map((e) => episodeView(d, e)) })
        const chapters = resolveChapterIds(d, a)
        if (!chapters.ids.length) return json({ error: '未找到章节', unresolved: chapters.unresolved, chapters: d.novel.map((chapter) => ({ id: chapter.id, index: chapter.index + 1, title: chapter.title })) })
        const current = new Set(episode.novelChapterIds ?? [])
        const mode = a.mode === 'add' || a.mode === 'remove' ? a.mode : 'replace'
        let nextIds = chapters.ids
        if (mode === 'add') nextIds = [...new Set([...current, ...chapters.ids])]
        else if (mode === 'remove') nextIds = [...current].filter((id) => !chapters.ids.includes(id))
        get().setEpisodeNovelChapters(episode.id, nextIds)
        const next = get().doc ?? d
        const updated = next.episodes?.find((e) => e.id === episode.id) ?? episode
        return json({ episode: episodeView(next, updated), chapterIds: updated.novelChapterIds ?? [], unresolved: chapters.unresolved })
      },
    },
    {
      name: 'distribute_episode_chapters',
      description: 'Evenly distribute imported novel chapters across existing episodes in order. This overwrites current episode chapter assignments.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episodes = sortedEpisodes(d)
        if (episodes.length <= 1) return json({ error: '需要至少两集才能均分章节', episodes: episodes.map((episode) => episodeView(d, episode)) })
        if (!d.novel.length) return json({ error: '还没有导入原著章节' })
        get().distributeNovelChaptersAcrossEpisodes()
        const next = get().doc ?? d
        return json({ episodes: sortedEpisodes(next).map((episode) => episodeView(next, episode)) })
      },
    },
    {
      name: 'add_asset',
      description: '新增资产：人物 role / 场景 scene / 物品 prop',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['role', 'scene', 'prop'] }, name: { type: 'string' }, desc: { type: 'string' }, prompt: { type: 'string' } },
        required: ['type', 'name'],
      },
      execute: async (a) => {
        const type = a.type === 'scene' || a.type === 'prop' ? a.type : 'role'
        const id = get().upsertAsset({ type, name: String(a.name ?? '未命名'), desc: a.desc as string | undefined, prompt: a.prompt as string | undefined })
        return `已新增资产 ${a.name}（id ${id}）`
      },
    },
    {
      name: 'upsert_asset_variant',
      description: '为角色/场景/道具创建或更新妆容、服装、年龄、时期等变体。资产仍是项目级共享，变体可按集/场/镜头标注适用范围。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string', description: '资产名，assetId/assetName 为空时使用。' },
          variantId: { type: 'string' },
          variantLabel: { type: 'string' },
          label: { type: 'string' },
          desc: { type: 'string' },
          prompt: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          appliesToEpisodeIds: { type: 'array', items: { type: 'string' } },
          appliesToSceneIds: { type: 'array', items: { type: 'string' } },
          appliesToStoryboardIds: { type: 'array', items: { type: 'string' } },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) {
          return json({ error: '未找到可创建变体的资产', assets: d.assets.filter(isCastableAsset).map((item) => ({ id: item.id, name: item.name, type: item.type })) })
        }

        const lookup = a.variantId ?? a.variantLabel ?? a.label
        const existing = findAssetVariant(asset, lookup)
        let variantId = existing?.id
        const label = stringArg(a.label) ?? stringArg(a.variantLabel) ?? existing?.label
        if (!variantId) {
          variantId = get().addAssetVariant(asset.id, {
            label: label ?? `形态${(asset.variants?.length ?? 0) + 1}`,
            desc: stringArg(a.desc),
            prompt: stringArg(a.prompt),
          })
        }

        const patch = {
          label,
          desc: stringArg(a.desc),
          prompt: stringArg(a.prompt),
          tags: stringArrayArg(a.tags),
          appliesToEpisodeIds: stringArrayArg(a.appliesToEpisodeIds),
          appliesToSceneIds: stringArrayArg(a.appliesToSceneIds),
          appliesToStoryboardIds: stringArrayArg(a.appliesToStoryboardIds),
        }
        get().updateAssetVariant(asset.id, variantId, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)))
        const nextAsset = get().doc?.assets.find((item) => item.id === asset.id) ?? asset
        return json(variantView(nextAsset, variantId))
      },
    },
    {
      name: 'generate_asset_variant',
      description: '基于资产主参考图生成某个妆容/服装/时期变体的参考图。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string' },
          variantId: { type: 'string' },
          variantLabel: { type: 'string' },
          label: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产' })
        if (!asset.refImageId) return json({ error: '该资产还没有主参考图，不能生成变体', asset: assetView(asset, { includeImages: false }) })
        const variant = findAssetVariant(asset, a.variantId ?? a.variantLabel ?? a.label)
        if (!variant) return json({ error: '未找到变体', variants: asset.variants ?? [] })
        await get().generateAssetVariant(asset.id, variant.id)
        const nextAsset = get().doc?.assets.find((item) => item.id === asset.id) ?? asset
        return json(variantView(nextAsset, variant.id))
      },
    },
    {
      name: 'set_storyboard_cast_variant',
      description: '给已有分镜里的某个出场资产绑定或清除指定变体，用于修正同一角色的妆容/服装/时期一致性。',
      parameters: {
        type: 'object',
        properties: {
          storyboardId: { type: 'string' },
          index: { type: 'number', description: '1-based 分镜序号，storyboardId 为空时使用。' },
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string' },
          variantId: { type: 'string' },
          variantLabel: { type: 'string' },
          label: { type: 'string' },
          clear: { type: 'boolean', description: 'true 时清除该资产在此分镜上的变体绑定。' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const storyboard = resolveStoryboard(d, a)
        if (!storyboard) return json({ error: '未找到分镜', storyboards: [...d.storyboards].sort((x, y) => x.index - y.index).map((s) => ({ id: s.id, index: s.index + 1, videoDesc: s.videoDesc.slice(0, 80) })) })
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: d.assets.filter(isCastableAsset).map((item) => ({ id: item.id, name: item.name, type: item.type })) })
        const variant = a.clear === true ? undefined : findAssetVariant(asset, a.variantId ?? a.variantLabel ?? a.label)
        if (a.clear !== true && !variant) return json({ error: '未找到变体', asset: assetView(asset, { includeImages: false }) })
        get().setStoryboardCastVariant(storyboard.id, asset.id, variant?.id)
        const next = doc()
        const updated = next?.storyboards.find((s) => s.id === storyboard.id)
        return json({ storyboard: next && updated ? storyboardView(next, updated, { includePrompt: true, includeDialogues: true, includeAssets: true }) : undefined })
      },
    },
    {
      name: 'add_storyboard',
      description: '新增当前剧集的分镜面板。cast 可用资产名或“资产名-变体标签”；需要精确妆容/服装时优先传 castRefs。',
      parameters: {
        type: 'object',
        properties: {
          videoDesc: { type: 'string' },
          prompt: { type: 'string' },
          duration: { type: 'number' },
          cast: { type: 'array', items: { type: 'string' }, description: '出场资产名；可写“角色名-变体标签”来指定已有妆容/服装/时期变体。' },
          castRefs: {
            type: 'array',
            description: '精确出场引用。assetId/assetName/name 三选一；variantId 或 variantLabel 可选。',
            items: {
              type: 'object',
              properties: {
                assetId: { type: 'string' },
                assetName: { type: 'string' },
                name: { type: 'string' },
                variantId: { type: 'string' },
                variantLabel: { type: 'string' },
                roleInShot: { type: 'string', enum: ['lead', 'supporting', 'background'] },
                note: { type: 'string' },
              },
            },
          },
          dialogues: {
            type: 'array',
            items: { type: 'object', properties: { character: { type: 'string' }, line: { type: 'string' }, emotion: { type: 'string' } } },
          },
          chainFromPrev: { type: 'boolean' },
        },
        required: ['videoDesc'],
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const cast = storyboardCastRefsFromArgs(d, a)
        const ids = [...new Set(cast.refs.map((ref) => ref.assetId))]
        const dialogues = Array.isArray(a.dialogues)
          ? (a.dialogues as Array<Record<string, unknown>>)
              .filter((x) => x && typeof x.line === 'string' && (x.line as string).trim())
              .map((x) => ({ character: String(x.character ?? ''), line: String(x.line).trim(), emotion: x.emotion ? String(x.emotion) : undefined }))
          : undefined
        const id = get().upsertStoryboard({
          videoDesc: String(a.videoDesc ?? ''),
          prompt: a.prompt as string | undefined,
          duration: typeof a.duration === 'number' ? a.duration : undefined,
          associateAssetIds: ids,
          castRefs: cast.refs.length ? cast.refs : undefined,
          dialogues,
          chainFromPrev: a.chainFromPrev === true,
        })
        const next = doc()
        const storyboard = next?.storyboards.find((s) => s.id === id)
        return json({
          id,
          unresolvedCast: cast.unresolved,
          storyboard: next && storyboard ? storyboardView(next, storyboard, { includePrompt: true, includeDialogues: true, includeAssets: true }) : undefined,
        })
      },
    },
    {
      name: 'generate_asset',
      description: '按名称生成资产参考图',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      execute: async (a) => {
        const as = doc()?.assets.find((x) => x.name === a.name)
        if (!as) return `未找到资产 ${a.name}`
        await get().generateAsset(as.id)
        return `已生成资产 ${a.name}`
      },
    },
    {
      name: 'generate_keyframe',
      description: '按分镜序号(1-based)生成关键帧',
      parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const sb = [...d.storyboards].sort((x, y) => x.index - y.index)[Number(a.index) - 1]
        if (!sb) return '分镜序号越界'
        await get().generateKeyframe(sb.id)
        return `已生成第 ${a.index} 镜关键帧`
      },
    },
    {
      name: 'generate_clip',
      description: '按分镜序号(1-based)生成视频片段',
      parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const sb = [...d.storyboards].sort((x, y) => x.index - y.index)[Number(a.index) - 1]
        if (!sb) return '分镜序号越界'
        await get().generateClip(sb.id)
        return `已生成第 ${a.index} 镜视频`
      },
    },
  ]
}
