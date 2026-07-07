/**
 * Toonflow 式重构 · 阶段6（§6.1）：Agent 工具集——把 projectStore 动作暴露为可被工具循环调用的 AgentTool。
 * 同进程直调 store（替代 Toonflow 的 socket.emit）。get 为 projectStore 的 getState（type-only 引入，无运行期循环）。
 */
import type { AgentTool } from './runtime'
import type { ProjectState } from '../../store/projectStore'
import type { Asset, AssetVariant, Clip, Episode, EpisodePlan, ProjectDoc, Script, Storyboard, StoryboardCastRef, StoryboardTableScene, VideoTrack } from '../../domain/types'
import { castRefsForStoryboard, labelForCastRef } from '../../domain/castRefs'
import { assetPrefixLookup, cleanAssetAliases, findAssetByNameOrAlias, normalizeAssetLookup } from '../../domain/assetAliases'
import { buildContinuityReport, variantScopePatchForUse, type ContinuityIssue, type ContinuityReport } from '../services/continuityReport'
import { buildEpisodeProductionHandoff, episodeSeriesQueueState, type EpisodeHandoffSuggestion, type EpisodeProductionHandoff } from '../services/episodeProduction'
import { applyEpisodeHandoffSuggestion, type EpisodeHandoffSuggestionApplyResult } from '../services/episodeHandoffSuggestions'
import { loadAssetHub, projectAssetIdentityAppearanceLabels, projectAssetIdentityEntityId, projectAssetIdentityEpisodeLabels, projectAssetIdentityUsageEntityId, type IdentityAssetUsage, type LibraryEntity } from '../../services/assetHub'
import { PLANNED_HANDOFF_STORYBOARD_RULE } from './policy'

type ProjectDocGetter = () => ProjectDoc | null
type LinkableLibraryEntity = {
  id: string
  kind?: LibraryEntity['kind']
  name?: string
  aliases?: string[]
  identity?: string
  description?: string
  tags?: string[]
  mediaRefs?: LibraryEntity['mediaRefs']
  voiceRef?: LibraryEntity['voiceRef']
  lora?: LibraryEntity['lora']
  version?: number
  archived?: boolean
  variants?: LibraryEntity['variants']
}

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

function castNames(doc: ProjectDoc, storyboard: Storyboard): string[] {
  const assets = new Map(doc.assets.map((a) => [a.id, a]))
  return castRefsForStoryboard(storyboard).map((ref) => labelForCastRef(assets.get(ref.assetId), ref))
}

function storyboardCastAssets(doc: ProjectDoc, storyboard: Storyboard, usageByEntity?: Record<string, IdentityAssetUsage>) {
  const assets = new Map(doc.assets.map((a) => [a.id, a]))
  return castRefsForStoryboard(storyboard).map((ref) => {
    const asset = assets.get(ref.assetId)
    const variant = asset?.variants?.find((item) => item.id === ref.variantId)
    return {
      assetId: ref.assetId,
      name: asset?.name,
      type: asset?.type,
      ...assetLineageView(asset),
      variantId: ref.variantId,
      variantLabel: variant?.label,
      variantKind: variant?.variantKind,
      libraryVariantId: asset && variant ? variantLibraryIdView(asset, variant) : undefined,
      label: labelForCastRef(asset, ref),
      roleInShot: ref.roleInShot,
      note: ref.note,
      assetCenterUsage: asset ? assetCenterUsageView(doc, asset, usageByEntity) : undefined,
    }
  })
}

function storyboardView(doc: ProjectDoc, s: Storyboard, opts?: { includePrompt?: boolean; includeDialogues?: boolean; includeAssets?: boolean; usageByEntity?: Record<string, IdentityAssetUsage> }) {
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
    castAssets: opts?.includeAssets === false ? undefined : storyboardCastAssets(doc, s, opts?.usageByEntity),
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

async function loadIdentityUsageSafe(): Promise<Record<string, IdentityAssetUsage> | undefined> {
  try {
    return (await loadAssetHub()).usageByEntity
  } catch {
    return undefined
  }
}

function mergeLabels(...groups: Array<string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))]
}

function assetCenterUsageView(doc: ProjectDoc, asset: Asset, usageByEntity?: Record<string, IdentityAssetUsage>) {
  const entityId = projectAssetIdentityUsageEntityId(doc, asset, usageByEntity)
  if (!entityId) return undefined
  const usage = usageByEntity?.[entityId]
  const currentEpisodeLabels = projectAssetIdentityEpisodeLabels(doc, asset.id)
  const currentAppearanceLabels = projectAssetIdentityAppearanceLabels(doc, asset)
  const currentProjectFromDoc =
    currentEpisodeLabels.length || currentAppearanceLabels.length
      ? { episodeLabels: currentEpisodeLabels, appearanceLabels: currentAppearanceLabels }
      : undefined
  if (!usage) return { entityId, currentProject: currentProjectFromDoc }
  const currentProject = usage.projects.find((project) => project.projectId === doc.meta.id && project.assetIds.includes(asset.id))
  return {
    entityId,
    projectCount: usage.projectCount,
    projectAssetCount: usage.assetCount,
    canvasNodeCount: usage.canvasNodeCount,
    snapshotCount: usage.snapshotCount,
    currentProject:
      currentProject || currentProjectFromDoc
        ? {
            episodeLabels: mergeLabels(currentProject?.episodeLabels, currentProjectFromDoc?.episodeLabels),
            appearanceLabels: mergeLabels(currentProject?.appearanceLabels, currentProjectFromDoc?.appearanceLabels),
          }
        : undefined,
  }
}

function assetLineageView(asset: Asset | undefined) {
  return {
    libraryEntityId: asset?.libraryLink?.entityId ?? asset?.elementId,
    libraryEntityVersion: asset?.libraryLink?.entityVersion,
    librarySyncPolicy: asset?.libraryLink?.syncPolicy,
  }
}

function variantLibraryIdView(asset: Asset, variant: AssetVariant): string | undefined {
  return variant.libraryVariantId ?? asset.libraryLink?.variantMap?.[variant.id]
}

function projectAssetUsageView(doc: ProjectDoc, assetId: string, usageByEntity?: Record<string, IdentityAssetUsage>) {
  const asset = doc.assets.find((item) => item.id === assetId)
  return {
    assetId,
    name: asset?.name,
    type: asset?.type,
    ...assetLineageView(asset),
    assetCenterUsage: asset ? assetCenterUsageView(doc, asset, usageByEntity) : undefined,
  }
}

function projectAssetNameUsageView(doc: ProjectDoc, name: string, usageByEntity?: Record<string, IdentityAssetUsage>) {
  const asset = findAssetByNameOrAlias(doc.assets, name)
  return {
    name,
    assetId: asset?.id,
    assetName: asset?.name,
    assetType: asset?.type,
    ...assetLineageView(asset),
    variants: asset?.variants?.map((variant) => ({
      id: variant.id,
      label: variant.label,
      variantKind: variant.variantKind,
      libraryVariantId: variantLibraryIdView(asset, variant),
      refImageId: variant.refImageId,
      appliesToEpisodeIds: variant.appliesToEpisodeIds,
    })),
    assetCenterUsage: asset ? assetCenterUsageView(doc, asset, usageByEntity) : undefined,
  }
}

function storyboardTableView(doc: ProjectDoc, scenes: StoryboardTableScene[], usageByEntity?: Record<string, IdentityAssetUsage>) {
  return scenes.map((scene) => ({
    ...scene,
    resolvedCastAssets: scene.castNames.map((name) => projectAssetNameUsageView(doc, name, usageByEntity)),
    segments: scene.segments.map((segment) => ({
      ...segment,
      rows: segment.rows.map((row) => ({
        ...row,
        resolvedAssetRefs: row.assetRefNames.map((name) => projectAssetNameUsageView(doc, name, usageByEntity)),
      })),
    })),
  }))
}

function continuityIssueView(doc: ProjectDoc, issue: ContinuityIssue, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return {
    ...issue,
    assetCenterUsage: issue.assetId ? projectAssetUsageView(doc, issue.assetId, usageByEntity).assetCenterUsage : undefined,
    relatedAssetUsages: issue.relatedAssetIds?.map((assetId) => projectAssetUsageView(doc, assetId, usageByEntity)),
  }
}

function continuityReportView(doc: ProjectDoc, report: ContinuityReport, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return {
    ...report,
    episodes: report.episodes.map((episode) => ({
      ...episode,
      castUses: episode.castUses.map((use) => ({
        ...use,
        assetCenterUsage: projectAssetUsageView(doc, use.assetId, usageByEntity).assetCenterUsage,
      })),
      issues: episode.issues.map((issue) => continuityIssueView(doc, issue, usageByEntity)),
    })),
    issues: report.issues.map((issue) => continuityIssueView(doc, issue, usageByEntity)),
  }
}

function handoffAssetCenterUsageView(doc: ProjectDoc, assetId: string, usageByEntity?: Record<string, IdentityAssetUsage>) {
  const asset = doc.assets.find((item) => item.id === assetId)
  return asset ? assetCenterUsageView(doc, asset, usageByEntity) : undefined
}

function episodeHandoffView(doc: ProjectDoc, handoff: EpisodeProductionHandoff, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return {
    ...handoff,
    plannedAssets: handoff.plannedAssets.map((item) => ({ ...item, assetCenterUsage: handoffAssetCenterUsageView(doc, item.assetId, usageByEntity) })),
    plannedVariants: handoff.plannedVariants.map((item) => ({ ...item, assetCenterUsage: handoffAssetCenterUsageView(doc, item.assetId, usageByEntity) })),
    sharedAssets: handoff.sharedAssets.map((item) => ({ ...item, assetCenterUsage: handoffAssetCenterUsageView(doc, item.assetId, usageByEntity) })),
    suggestions: handoff.suggestions.map((item) => handoffSuggestionRef(item, doc, usageByEntity)),
  }
}

function assetView(a: Asset, opts?: { doc?: ProjectDoc; includePrompt?: boolean; includeImages?: boolean; usageByEntity?: Record<string, IdentityAssetUsage> }) {
  return {
    id: a.id,
    type: a.type,
    name: a.name,
    aliases: a.aliases,
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
    libraryLink: a.libraryLink,
    ...assetLineageView(a),
    assetCenterUsage: opts?.doc ? assetCenterUsageView(opts.doc, a, opts.usageByEntity) : undefined,
    rejectedLibraryEntityIds: a.rejectedLibraryEntityIds,
    lora: a.lora,
    flowId: a.flowId,
    voice: a.voice,
    voiceAssetId: a.voiceAssetId,
    audioBindState: a.audioBindState,
    audioFilePath: a.audioFilePath,
    audioUrl: a.audioUrl,
    sex: a.sex,
  }
}

async function assetViewWithUsage(doc: ProjectDoc, asset: Asset, opts?: { includePrompt?: boolean; includeImages?: boolean }) {
  return assetView(asset, {
    doc,
    includePrompt: opts?.includePrompt,
    includeImages: opts?.includeImages,
    usageByEntity: await loadIdentityUsageSafe(),
  })
}

function assetCandidateList(doc: ProjectDoc, assets = doc.assets.filter(isCastableAsset), usageByEntity?: Record<string, IdentityAssetUsage>) {
  return assets.map((asset) => assetView(asset, { doc, includePrompt: false, includeImages: false, usageByEntity }))
}

async function assetCandidateListWithUsage(doc: ProjectDoc, assets = doc.assets.filter(isCastableAsset)) {
  return assetCandidateList(doc, assets, await loadIdentityUsageSafe())
}

function variantOptions(doc: ProjectDoc, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return doc.assets
    .filter(isCastableAsset)
    .flatMap((asset) =>
      (asset.variants ?? []).map((variant) => ({
        id: variant.id,
        label: variant.label,
        variantKind: variant.variantKind,
        libraryVariantId: variantLibraryIdView(asset, variant),
        assetId: asset.id,
        assetName: asset.name,
        ...assetLineageView(asset),
        assetCenterUsage: assetCenterUsageView(doc, asset, usageByEntity),
      })),
    )
}

function planView(doc: ProjectDoc, plan: EpisodePlan | undefined, usageByEntity?: Record<string, IdentityAssetUsage>) {
  const requiredAssets = (plan?.requiredAssetIds ?? [])
    .map((id) => doc.assets.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset)
    .map((asset) => ({ id: asset.id, name: asset.name, type: asset.type, ...assetLineageView(asset), assetCenterUsage: assetCenterUsageView(doc, asset, usageByEntity) }))
  const requiredVariants = (plan?.requiredVariantIds ?? [])
    .map((variantId) => variantOptions(doc, usageByEntity).find((variant) => variant.id === variantId))
    .filter((variant): variant is NonNullable<ReturnType<typeof variantOptions>[number]> => !!variant)
  return {
    hook: plan?.hook,
    conflict: plan?.conflict,
    cliffhanger: plan?.cliffhanger,
    requiredAssetIds: plan?.requiredAssetIds,
    requiredAssets,
    requiredVariantIds: plan?.requiredVariantIds,
    requiredVariants,
  }
}

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function episodeList(doc: ProjectDoc): Episode[] {
  const episodes = sortedEpisodes(doc)
  if (episodes.length) return episodes
  return [
    {
      id: doc.currentEpisodeId ?? 'current',
      index: 0,
      title: '当前集',
      scripts: doc.scripts,
      storyboards: doc.storyboards,
      storyboardTable: doc.storyboardTable,
      clips: doc.clips,
      track: doc.track,
      createdAt: doc.meta.createdAt,
      updatedAt: doc.meta.updatedAt,
    },
  ]
}

function episodeInfo(doc: ProjectDoc, episode: Episode) {
  return { episodeId: episode.id, episodeIndex: episode.index + 1, episodeTitle: episode.title, current: episode.id === doc.currentEpisodeId }
}

function episodeInfoWithPlan(doc: ProjectDoc, episode: Episode, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return { ...episodeInfo(doc, episode), plan: planView(doc, episode.plan, usageByEntity) }
}

function scriptEpisodeContext(doc: ProjectDoc, episode: Episode, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return { ...episodeInfo(doc, episode), episodePlan: planView(doc, episode.plan, usageByEntity) }
}

function scriptsForEpisode(doc: ProjectDoc, episode: Episode): Script[] {
  return episode.id === doc.currentEpisodeId ? doc.scripts : episode.scripts
}

function storyboardsForEpisode(doc: ProjectDoc, episode: Episode): Storyboard[] {
  return episode.id === doc.currentEpisodeId ? doc.storyboards : episode.storyboards
}

function storyboardTableForEpisode(doc: ProjectDoc, episode: Episode): StoryboardTableScene[] {
  return episode.id === doc.currentEpisodeId ? (doc.storyboardTable ?? []) : (episode.storyboardTable ?? [])
}

function clipsForEpisode(doc: ProjectDoc, episode: Episode): Clip[] {
  return episode.id === doc.currentEpisodeId ? doc.clips : episode.clips
}

function trackForEpisode(doc: ProjectDoc, episode: Episode): VideoTrack[] {
  return episode.id === doc.currentEpisodeId ? doc.track : episode.track
}

function episodeHandoffSummary(doc: ProjectDoc, episode: Episode, usageByEntity?: Record<string, IdentityAssetUsage>) {
  const handoff = buildEpisodeProductionHandoff(doc, episode, { maxRecaps: 1, maxAssets: 4, maxAppearances: 2 })
  const autoSuggestions = handoff.suggestions.filter((suggestion) => suggestion.autoRepairable !== false && !suggestion.disabledReason)
  return {
    plannedAssetCount: handoff.plannedAssets.length,
    plannedVariantCount: handoff.plannedVariants.length,
    sharedAssetCount: handoff.sharedAssets.length,
    suggestionCount: handoff.suggestions.length,
    autoRepairableSuggestionCount: autoSuggestions.length,
    suggestions: handoff.suggestions.slice(0, 6).map((suggestion) => handoffSuggestionRef(suggestion, doc, usageByEntity)),
  }
}

function episodeView(doc: ProjectDoc, episode: Episode, opts?: { usageByEntity?: Record<string, IdentityAssetUsage> }) {
  const current = episode.id === doc.currentEpisodeId
  const scripts = scriptsForEpisode(doc, episode)
  const storyboards = storyboardsForEpisode(doc, episode)
  const clips = clipsForEpisode(doc, episode)
  const track = trackForEpisode(doc, episode)
  return {
    id: episode.id,
    index: episode.index + 1,
    title: episode.title,
    summary: episode.summary,
    productionRecap: episode.productionRecap,
    status: episode.status,
    seriesSkip: episode.seriesSkip === true,
    seriesQueueState: episodeSeriesQueueState(doc, episode),
    plan: planView(doc, episode.plan, opts?.usageByEntity),
    handoff: episodeHandoffSummary(doc, episode, opts?.usageByEntity),
    current,
    production: {
      hasFilm: !!episode.filmPath,
      filmPath: episode.filmPath,
      filmError: episode.filmError,
      producedAt: episode.producedAt,
    },
    counts: {
      novelChapters: episode.novelChapterIds?.length ?? 0,
      scripts: scripts.length,
      storyboards: storyboards.length,
      clips: clips.length,
      tracks: track.length,
      storyboardTableScenes: episode.storyboardTable?.length ?? 0,
    },
    updatedAt: episode.updatedAt,
  }
}

async function episodeViewWithUsage(doc: ProjectDoc, episode: Episode) {
  return episodeView(doc, episode, { usageByEntity: await loadIdentityUsageSafe() })
}

async function episodeListWithUsage(doc: ProjectDoc, episodes: Episode[] = sortedEpisodes(doc)) {
  const usageByEntity = await loadIdentityUsageSafe()
  return episodes.map((episode) => episodeView(doc, episode, { usageByEntity }))
}

function overview(doc: ProjectDoc, opts?: { usageByEntity?: Record<string, IdentityAssetUsage> }) {
  const episodes = episodeList(doc)
  const allScripts = episodes.flatMap((episode) => scriptsForEpisode(doc, episode))
  const allStoryboards = episodes.flatMap((episode) => storyboardsForEpisode(doc, episode))
  const allClips = episodes.flatMap((episode) => clipsForEpisode(doc, episode))
  const allTracks = episodes.flatMap((episode) => trackForEpisode(doc, episode))
  return {
    meta: doc.meta,
    currentEpisodeId: doc.currentEpisodeId,
    seriesBible: {
      ...(doc.seriesBible ?? {}),
      plannedEpisodeCount: doc.seriesBible?.plannedEpisodeCount ?? episodes.length,
      continuityRules: doc.seriesBible?.continuityRules ?? [],
    },
    counts: {
      episodes: episodes.length,
      scripts: allScripts.length,
      assets: doc.assets.length,
      rootAssets: doc.assets.filter((a) => !a.parentAssetId).length,
      storyboards: allStoryboards.length,
      clips: allClips.length,
      tracks: allTracks.length,
      novelChapters: doc.novel.length,
      storyboardTableScenes: episodes.reduce((total, episode) => total + storyboardTableForEpisode(doc, episode).length, 0),
    },
    episodes: episodes.map((episode) => episodeView(doc, episode, opts)),
    scripts: episodes.flatMap((episode) =>
      scriptsForEpisode(doc, episode).map((s, i) => ({ ...scriptEpisodeContext(doc, episode, opts?.usageByEntity), id: s.id, index: i + 1, name: s.name, length: s.content.length, updatedAt: s.updatedAt })),
    ),
    assets: doc.assets
      .filter((a) => !a.parentAssetId)
      .map((a) => ({ id: a.id, type: a.type, name: a.name, state: a.state, hasPrompt: !!a.prompt, hasRefImage: !!a.refImageId, ...assetLineageView(a), assetCenterUsage: assetCenterUsageView(doc, a, opts?.usageByEntity) })),
    storyboards: episodes.flatMap((episode) =>
      [...storyboardsForEpisode(doc, episode)]
        .sort((a, b) => a.index - b.index)
        .map((s) => ({
          ...episodeInfo(doc, episode),
          id: s.id,
          index: s.index + 1,
          track: s.track,
          videoDesc: s.videoDesc,
          duration: s.duration,
          castNames: castNames(doc, s),
          castAssets: storyboardCastAssets(doc, s, opts?.usageByEntity),
          dialogueCount: s.dialogues?.length ?? 0,
          state: s.state,
          hasKeyframe: !!s.keyframeImageId,
        })),
    ),
    novel: doc.novel.map((c) => ({
      id: c.id,
      index: c.index + 1,
      title: c.title,
      textLength: c.text.length,
      event: c.event,
      eventState: c.eventState,
      episodes: chapterEpisodeRefs(doc, c.id, opts?.usageByEntity),
    })),
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

function oneBasedIndex(value: unknown, length: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const index = Math.floor(value)
  if (index < 1 || index > length) return undefined
  return index - 1
}

function resolveEpisode(doc: ProjectDoc, args: Record<string, unknown>): Episode | undefined {
  const episodes = sortedEpisodes(doc)
  if (typeof args.episodeId === 'string') {
    const episodeId = args.episodeId.trim()
    return episodeId ? episodes.find((episode) => episode.id === episodeId) : undefined
  }
  const episodeIndex = oneBasedIndex(args.index, episodes.length)
  if (episodeIndex !== undefined) return episodes[episodeIndex]
  if (typeof args.title === 'string') {
    const title = args.title.trim().toLowerCase()
    if (!title) return undefined
    return episodes.find((episode) => episode.title.toLowerCase() === title) ?? episodes.find((episode) => episode.title.toLowerCase().includes(title))
  }
  return undefined
}

function currentEpisode(doc: ProjectDoc): Episode | undefined {
  return sortedEpisodes(doc).find((episode) => episode.id === doc.currentEpisodeId) ?? sortedEpisodes(doc)[0]
}

function resolveEpisodeSelector(doc: ProjectDoc, args: Record<string, unknown>): Episode | undefined {
  if (hasEpisodeSelector(args)) return resolveEpisode(doc, { episodeId: args.episodeId, index: args.episodeIndex, title: args.episodeTitle })
  return currentEpisode(doc)
}

function chapterEpisodeRefs(doc: ProjectDoc, chapterId: string, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return sortedEpisodes(doc)
    .filter((episode) => episode.novelChapterIds?.includes(chapterId))
    .map((episode) => ({
      id: episode.id,
      index: episode.index + 1,
      title: episode.title,
      current: episode.id === doc.currentEpisodeId,
      seriesQueueState: episodeSeriesQueueState(doc, episode),
      plan: planView(doc, episode.plan, usageByEntity),
    }))
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

function hasArg(args: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(args, key)
}

function isCastableAsset(asset: Asset): boolean {
  return !asset.parentAssetId && (asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop')
}

function findCastableAsset(doc: ProjectDoc, token: unknown): Asset | undefined {
  const text = stringArg(token)
  if (!text) return undefined
  const assets = doc.assets.filter(isCastableAsset)
  return findAssetByNameOrAlias(assets, text)
}

function assetLookupLength(asset: Asset): number {
  return Math.max(...[asset.name, ...(asset.aliases ?? [])].map((name) => name.length))
}

function findAssetVariant(asset: Asset, token: unknown) {
  const text = stringArg(token)
  if (!text) return undefined
  const lower = text.toLowerCase()
  return asset.variants?.find((variant) => variant.id === text) ?? asset.variants?.find((variant) => variant.label.toLowerCase() === lower)
}

type VariantScopeKind = 'episode' | 'scene' | 'storyboard'
type VariantScopeKey = 'appliesToEpisodeIds' | 'appliesToSceneIds' | 'appliesToStoryboardIds'

function variantScopeKind(value: unknown): VariantScopeKind | undefined {
  return value === 'episode' || value === 'scene' || value === 'storyboard' ? value : undefined
}

function inferVariantScopeKind(args: Record<string, unknown>): VariantScopeKind | undefined {
  return (
    variantScopeKind(args.scopeKind) ??
    (stringArg(args.storyboardId) || typeof args.storyboardIndex === 'number' ? 'storyboard' : undefined) ??
    (stringArg(args.sceneId) ? 'scene' : undefined) ??
    (stringArg(args.episodeId) || typeof args.episodeIndex === 'number' || stringArg(args.episodeTitle) ? 'episode' : undefined)
  )
}

function variantScopeKey(kind: VariantScopeKind): VariantScopeKey {
  if (kind === 'scene') return 'appliesToSceneIds'
  if (kind === 'storyboard') return 'appliesToStoryboardIds'
  return 'appliesToEpisodeIds'
}

function resolveVariantScopeId(doc: ProjectDoc, args: Record<string, unknown>, kind: VariantScopeKind): string | undefined {
  const scopeId = stringArg(args.scopeId)
  if (scopeId) return scopeId
  if (kind === 'scene') return stringArg(args.sceneId)
  if (kind === 'storyboard') {
    const storyboardId = stringArg(args.storyboardId)
    if (storyboardId) return storyboardId
    const index = typeof args.storyboardIndex === 'number' ? args.storyboardIndex : undefined
    if (index === undefined || !Number.isFinite(index)) return undefined
    const episode = resolveEpisodeSelector(doc, args)
    const storyboards = episode ? [...storyboardsForEpisode(doc, episode)].sort((a, b) => a.index - b.index) : []
    const storyboardIndex = oneBasedIndex(index, storyboards.length)
    return storyboardIndex === undefined ? undefined : storyboards[storyboardIndex]?.id
  }
  if (hasEpisodeSelector(args)) return resolveEpisode(doc, { episodeId: args.episodeId, index: args.episodeIndex, title: args.episodeTitle })?.id
  return currentEpisode(doc)?.id
}

function nextVariantScopeIds(variant: AssetVariant, key: VariantScopeKey, scopeId: string, remove: boolean): string[] | undefined {
  const existing = variant[key] ?? []
  const ids = remove ? existing.filter((id) => id !== scopeId) : [...new Set([...existing, scopeId])]
  return ids.length ? ids : undefined
}

function roleInShot(value: unknown): StoryboardCastRef['roleInShot'] | undefined {
  return value === 'lead' || value === 'supporting' || value === 'background' ? value : undefined
}

function parseCastString(doc: ProjectDoc, raw: unknown): { ref?: StoryboardCastRef; unresolved?: string } {
  const text = stringArg(raw)
  if (!text) return {}
  const exact = findCastableAsset(doc, text)
  if (exact) return { ref: { assetId: exact.id } }

  const assets = doc.assets.filter(isCastableAsset).sort((a, b) => assetLookupLength(b) - assetLookupLength(a))
  for (const asset of assets) {
    const prefix = assetPrefixLookup(asset, text)
    if (!prefix) continue
    let variantToken = text.slice(prefix.length).trim()
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

function mergeIdList(existing: string[] | undefined, incoming: string[], mode: unknown): string[] | undefined {
  const current = existing ?? []
  const clean = [...new Set(incoming)]
  if (mode === 'add') return [...new Set([...current, ...clean])]
  if (mode === 'remove') {
    const removing = new Set(clean)
    const next = current.filter((id) => !removing.has(id))
    return next.length ? next : undefined
  }
  return clean.length ? clean : undefined
}

function resolvePlanAssetIds(doc: ProjectDoc, args: Record<string, unknown>): { ids: string[]; unresolved: unknown[] } {
  const ids: string[] = []
  const unresolved: unknown[] = []
  const valid = new Set(doc.assets.filter(isCastableAsset).map((asset) => asset.id))
  for (const value of Array.isArray(args.requiredAssetIds) ? args.requiredAssetIds : []) {
    const id = stringArg(value)
    if (!id) continue
    if (valid.has(id)) ids.push(id)
    else unresolved.push(value)
  }
  const names = [...(Array.isArray(args.requiredAssetNames) ? args.requiredAssetNames : []), ...(Array.isArray(args.assetNames) ? args.assetNames : [])]
  for (const value of names) {
    const asset = findCastableAsset(doc, value)
    if (asset) ids.push(asset.id)
    else if (value != null) unresolved.push(value)
  }
  return { ids: [...new Set(ids)], unresolved }
}

function findVariantOption(doc: ProjectDoc, value: unknown) {
  const text = stringArg(value)
  if (!text) return undefined
  const variants = variantOptions(doc)
  return variants.find((variant) => variant.id === text) ?? variants.find((variant) => variant.label.toLowerCase() === text.toLowerCase())
}

function resolvePlanVariantIds(doc: ProjectDoc, args: Record<string, unknown>): { ids: string[]; assetIds: string[]; unresolved: unknown[] } {
  const ids: string[] = []
  const assetIds: string[] = []
  const unresolved: unknown[] = []
  const variantsById = new Map(variantOptions(doc).map((variant) => [variant.id, variant]))
  for (const value of Array.isArray(args.requiredVariantIds) ? args.requiredVariantIds : []) {
    const id = stringArg(value)
    if (!id) continue
    const variant = variantsById.get(id)
    if (variant) {
      ids.push(id)
      assetIds.push(variant.assetId)
    }
    else unresolved.push(value)
  }
  const variants = Array.isArray(args.requiredVariants) ? args.requiredVariants : []
  for (const value of variants) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      const asset = findCastableAsset(doc, record.assetId) ?? findCastableAsset(doc, record.assetName) ?? findCastableAsset(doc, record.name)
      const variantOption = asset ? undefined : findVariantOption(doc, record.variantId ?? record.variantLabel ?? record.label)
      const variant = asset ? findAssetVariant(asset, record.variantId ?? record.variantLabel ?? record.label) : variantOption
      if (variant) {
        ids.push(variant.id)
        const assetId = asset?.id ?? variantOption?.assetId
        if (assetId) assetIds.push(assetId)
      }
      else unresolved.push(value)
      continue
    }
    const variant = findVariantOption(doc, value)
    if (variant) {
      ids.push(variant.id)
      assetIds.push(variant.assetId)
    }
    else if (value != null) unresolved.push(value)
  }
  return { ids: [...new Set(ids)], assetIds: [...new Set(assetIds)], unresolved }
}

function variantView(asset: Asset, variantId: string, opts?: { doc?: ProjectDoc; usageByEntity?: Record<string, IdentityAssetUsage> }) {
  const variant = asset.variants?.find((item) => item.id === variantId)
  return variant
    ? {
        assetId: asset.id,
        assetName: asset.name,
        assetType: asset.type,
        ...assetLineageView(asset),
        variantId: variant.id,
        variantLabel: variant.label,
        variantKind: variant.variantKind,
        libraryVariantId: variantLibraryIdView(asset, variant),
        assetCenterUsage: opts?.doc ? assetCenterUsageView(opts.doc, asset, opts.usageByEntity) : undefined,
        variant,
      }
    : undefined
}

function variantCandidateList(doc: ProjectDoc, asset: Asset, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return (asset.variants ?? [])
    .map((variant) => variantView(asset, variant.id, { doc, usageByEntity }))
    .filter((item): item is NonNullable<ReturnType<typeof variantView>> => !!item)
}

async function variantCandidateListWithUsage(doc: ProjectDoc, asset: Asset) {
  return variantCandidateList(doc, asset, await loadIdentityUsageSafe())
}

function scopedVariantViews(doc: ProjectDoc | null | undefined, refs: StoryboardCastRef[], usageByEntity?: Record<string, IdentityAssetUsage>): Array<ReturnType<typeof variantView>> {
  if (!doc) return []
  return refs
    .filter((ref) => !!ref.variantId)
    .map((ref) => {
      const asset = doc.assets.find((item) => item.id === ref.assetId)
      return asset && ref.variantId ? variantView(asset, ref.variantId, { doc, usageByEntity }) : undefined
    })
    .filter((item): item is NonNullable<ReturnType<typeof variantView>> => !!item)
}

function storyboardCandidateList(doc: ProjectDoc, storyboards: Storyboard[] = doc.storyboards, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return [...storyboards]
    .sort((x, y) => x.index - y.index)
    .map((storyboard) => storyboardView(doc, storyboard, { includePrompt: false, includeDialogues: false, includeAssets: true, usageByEntity }))
}

async function storyboardCandidateListWithUsage(doc: ProjectDoc, storyboards: Storyboard[] = doc.storyboards) {
  return storyboardCandidateList(doc, storyboards, await loadIdentityUsageSafe())
}

function resolveStoryboard(doc: ProjectDoc, args: Record<string, unknown>): Storyboard | undefined {
  const storyboardId = stringArg(args.storyboardId)
  if (storyboardId) return doc.storyboards.find((storyboard) => storyboard.id === storyboardId)
  if (typeof args.index === 'number') {
    const sorted = [...doc.storyboards].sort((a, b) => a.index - b.index)
    const index = oneBasedIndex(args.index, sorted.length)
    return index === undefined ? undefined : sorted[index]
  }
  return undefined
}

function findSceneAsset(doc: ProjectDoc, args: Record<string, unknown>): Asset | undefined {
  const asset =
    findCastableAsset(doc, args.assetId) ??
    findCastableAsset(doc, args.assetName) ??
    findCastableAsset(doc, args.sceneAssetId) ??
    findCastableAsset(doc, args.sceneAssetName) ??
    findCastableAsset(doc, args.name)
  return asset?.type === 'scene' ? asset : undefined
}

function assetLookupConflicts(doc: ProjectDoc, target: Asset): Array<{ assetId: string; assetName: string; value: string }> {
  const targetKeys = new Set([target.name, ...(target.aliases ?? [])].map((value) => normalizeAssetLookup(value)).filter(Boolean))
  if (!targetKeys.size) return []
  return doc.assets
    .filter((asset) => asset.id !== target.id && !asset.parentAssetId && asset.type === target.type)
    .flatMap((asset) =>
      [asset.name, ...(asset.aliases ?? [])]
        .filter((value) => targetKeys.has(normalizeAssetLookup(value)))
        .map((value) => ({ assetId: asset.id, assetName: asset.name, value })),
    )
}

function libraryEntityKindForAsset(asset: Asset): LibraryEntity['kind'] | undefined {
  if (asset.type === 'role') return 'character'
  if (asset.type === 'scene') return 'scene'
  if (asset.type === 'prop') return 'prop'
  if (asset.type === 'audio') return 'voice'
  return undefined
}

function libraryEntityMatchesAsset(entity: LibraryEntity, asset: Asset): boolean {
  const kind = libraryEntityKindForAsset(asset)
  return !kind || entity.kind === kind
}

function mediaRefView(ref: NonNullable<LibraryEntity['mediaRefs']>[number] | LibraryEntity['voiceRef']) {
  if (!ref) return undefined
  return {
    role: ref.role,
    label: ref.label,
    assetId: ref.assetId,
    mediaAssetId: ref.mediaAssetId,
    localPath: ref.localPath,
    url: ref.url,
  }
}

function identityAssetUsageView(entityId: string | undefined, usageByEntity?: Record<string, IdentityAssetUsage>, doc?: ProjectDoc | null) {
  if (!entityId) return undefined
  const usage = usageByEntity?.[entityId]
  const currentProject = doc && usage ? usage.projects.find((project) => project.projectId === doc.meta.id) : undefined
  if (!usage) return { entityId }
  return {
    entityId: usage.entityId,
    projectCount: usage.projectCount,
    projectAssetCount: usage.assetCount,
    canvasNodeCount: usage.canvasNodeCount,
    snapshotCount: usage.snapshotCount,
    currentProject: currentProject
      ? {
          episodeLabels: currentProject.episodeLabels,
          appearanceLabels: currentProject.appearanceLabels,
        }
      : undefined,
  }
}

function libraryEntityView(entity: LinkableLibraryEntity, opts?: { doc?: ProjectDoc | null; usageByEntity?: Record<string, IdentityAssetUsage> }) {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    aliases: entity.aliases,
    identity: entity.identity,
    description: entity.description,
    tags: entity.tags,
    mediaRefs: entity.mediaRefs?.map(mediaRefView),
    voiceRef: mediaRefView(entity.voiceRef),
    lora: entity.lora,
    version: entity.version,
    archived: entity.archived,
    variants: entity.variants?.map((variant) => ({
      id: variant.id,
      label: variant.label,
      kind: variant.kind,
      parentVariantId: variant.parentVariantId,
      tags: variant.tags,
      mediaRefs: variant.mediaRefs?.map(mediaRefView),
    })),
    assetCenterUsage: identityAssetUsageView(entity.id, opts?.usageByEntity, opts?.doc),
  }
}

async function loadLibraryEntitiesSafe(): Promise<LibraryEntity[]> {
  try {
    const hub = await loadAssetHub()
    return hub.entities
  } catch {
    return []
  }
}

function entityVersionArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined
}

async function resolveLibraryEntityForAsset(asset: Asset, args: Record<string, unknown>): Promise<{ entity?: LinkableLibraryEntity; candidates?: LibraryEntity[]; error?: string }> {
  const entityId = stringArg(args.libraryEntityId) ?? stringArg(args.entityId)
  const entityName = stringArg(args.libraryEntityName) ?? stringArg(args.entityName)
  const entities = await loadLibraryEntitiesSafe()

  if (entityId) {
    const entity = entities.find((item) => item.id === entityId)
    if (entity?.archived) return { error: '身份资产已归档，不能作为新的项目链接', candidates: [entity] }
    if (entity && !libraryEntityMatchesAsset(entity, asset)) {
      return { error: '身份资产类型与项目资产类型不匹配', candidates: [entity] }
    }
    return { entity: entity ?? { id: entityId, version: entityVersionArg(args.entityVersion) } }
  }

  if (!entityName) return { error: '缺少 libraryEntityId/entityId 或 libraryEntityName/entityName' }
  const lookup = normalizeAssetLookup(entityName)
  const candidates = entities.filter((entity) => {
    if (entity.archived || !libraryEntityMatchesAsset(entity, asset)) return false
    const names = [entity.name, ...(entity.aliases ?? [])].map((value) => normalizeAssetLookup(value))
    return names.includes(lookup)
  })
  if (candidates.length === 1) return { entity: candidates[0] }
  if (candidates.length > 1) return { error: '身份名称匹配到多个候选，请传 libraryEntityId', candidates }
  return { error: '未找到身份资产', candidates: entities.filter((entity) => !entity.archived && libraryEntityMatchesAsset(entity, asset)) }
}

async function resolveLibraryEntityIdsForAsset(asset: Asset, args: Record<string, unknown>): Promise<{ ids: string[]; candidates?: LibraryEntity[]; error?: string }> {
  const ids = [
    stringArg(args.libraryEntityId),
    stringArg(args.entityId),
    ...(Array.isArray(args.libraryEntityIds) ? args.libraryEntityIds.map((item) => stringArg(item)) : []),
    ...(Array.isArray(args.entityIds) ? args.entityIds.map((item) => stringArg(item)) : []),
  ].filter((id): id is string => !!id)
  const entityName = stringArg(args.libraryEntityName) ?? stringArg(args.entityName)
  if (!entityName) return ids.length ? { ids: [...new Set(ids)] } : { ids: [], error: '缺少要标记的身份资产 ID 或名称' }

  const entities = await loadLibraryEntitiesSafe()
  const lookup = normalizeAssetLookup(entityName)
  const matches = entities.filter((entity) => {
    if (entity.archived || !libraryEntityMatchesAsset(entity, asset)) return false
    const names = [entity.name, ...(entity.aliases ?? [])].map((value) => normalizeAssetLookup(value))
    return names.includes(lookup)
  })
  return { ids: [...new Set([...ids, ...matches.map((entity) => entity.id)])], candidates: matches, error: matches.length ? undefined : '未找到身份资产' }
}

function storyboardWithSceneAsset(doc: ProjectDoc, storyboard: Storyboard, sceneAssetId: string, replaceOtherSceneAssets: boolean): Pick<Storyboard, 'associateAssetIds' | 'castRefs'> {
  const refs = castRefsForStoryboard(storyboard)
  const nextRefs = replaceOtherSceneAssets
    ? refs.filter((ref) => ref.assetId === sceneAssetId || doc.assets.find((asset) => asset.id === ref.assetId)?.type !== 'scene')
    : refs
  if (!nextRefs.some((ref) => ref.assetId === sceneAssetId)) nextRefs.push({ assetId: sceneAssetId })
  return {
    associateAssetIds: [...new Set(nextRefs.map((ref) => ref.assetId))],
    castRefs: nextRefs,
  }
}

function storyboardWithAssetRef(storyboard: Storyboard, assetId: string, opts?: { remove?: boolean; variantId?: string; roleInShot?: StoryboardCastRef['roleInShot']; note?: string }): Pick<Storyboard, 'associateAssetIds' | 'castRefs'> {
  const refs = castRefsForStoryboard(storyboard)
  let nextRefs = refs.filter((ref) => ref.assetId !== assetId)
  if (opts?.remove !== true) {
    const existing = refs.find((ref) => ref.assetId === assetId)
    nextRefs = [
      ...nextRefs,
      {
        ...existing,
        assetId,
        variantId: opts?.variantId ?? existing?.variantId,
        roleInShot: opts?.roleInShot ?? existing?.roleInShot,
        note: opts?.note ?? existing?.note,
      },
    ]
  }
  return {
    associateAssetIds: [...new Set(nextRefs.map((ref) => ref.assetId))],
    castRefs: nextRefs,
  }
}

function hasEpisodeSelector(args: Record<string, unknown>): boolean {
  return (
    (typeof args.episodeId === 'string' && !!args.episodeId.trim()) ||
    (typeof args.episodeIndex === 'number' && Number.isFinite(args.episodeIndex)) ||
    (typeof args.episodeTitle === 'string' && !!args.episodeTitle.trim())
  )
}

function resolveEpisodeForWrite(doc: ProjectDoc, args: Record<string, unknown>): Episode | undefined {
  if (hasEpisodeSelector(args)) return resolveEpisode(doc, { episodeId: args.episodeId, index: args.episodeIndex, title: args.episodeTitle })
  return currentEpisode(doc)
}

function switchToEpisodeForWrite(get: () => ProjectState, args: Record<string, unknown>): { doc?: ProjectDoc; episode?: Episode; error?: string } {
  const d = get().doc
  if (!d) return { error: '无项目' }
  const episode = resolveEpisodeForWrite(d, args)
  if (!episode) return { doc: d, error: '未找到剧集' }
  if (d.currentEpisodeId !== episode.id) get().switchEpisode(episode.id)
  const next = get().doc ?? d
  return { doc: next, episode: next.episodes?.find((item) => item.id === episode.id) ?? episode }
}

async function episodeWriteTargetErrorView(target: { doc?: ProjectDoc; error?: string }) {
  return {
    error: target.error,
    episodes: target.doc ? await episodeListWithUsage(target.doc) : undefined,
  }
}

function handoffSuggestionAssetCenterUsage(doc: ProjectDoc | null | undefined, item: { assetId?: string }, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return doc && item.assetId ? handoffAssetCenterUsageView(doc, item.assetId, usageByEntity) : undefined
}

function handoffSuggestionRef(suggestion: EpisodeHandoffSuggestion, doc?: ProjectDoc | null, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return {
    id: suggestion.id,
    kind: suggestion.kind,
    assetId: suggestion.assetId,
    variantId: suggestion.variantId,
    variantKind: suggestion.variantKind,
    libraryEntityId: suggestion.libraryEntityId,
    libraryEntityVersion: suggestion.libraryEntityVersion,
    librarySyncPolicy: suggestion.librarySyncPolicy,
    libraryVariantId: suggestion.libraryVariantId,
    scopeKind: suggestion.scopeKind,
    storyboardId: suggestion.storyboardId,
    sceneId: suggestion.sceneId,
    label: suggestion.label,
    disabledReason: suggestion.disabledReason,
    autoRepairable: suggestion.autoRepairable,
    assetCenterUsage: handoffSuggestionAssetCenterUsage(doc, suggestion, usageByEntity),
  }
}

function handoffSuggestionApplyResultView(result: EpisodeHandoffSuggestionApplyResult, doc?: ProjectDoc | null, usageByEntity?: Record<string, IdentityAssetUsage>) {
  return {
    ...result,
    assetCenterUsage: handoffSuggestionAssetCenterUsage(doc, result, usageByEntity),
  }
}

function handoffSuggestionIds(args: Record<string, unknown>): string[] {
  return [
    stringArg(args.suggestionId),
    stringArg(args.id),
    ...(Array.isArray(args.suggestionIds) ? args.suggestionIds.map((item) => stringArg(item)) : []),
  ].filter((id): id is string => !!id)
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
        if (!d) return '无打开的项目'
        return json(overview(d, { usageByEntity: await loadIdentityUsageSafe() }))
      },
    },
    {
      name: 'get_project_overview',
      description: '读取当前项目的 meta、数量统计、剧本/资产/分镜/章节概览。不会返回长文本正文。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        if (!d) return '无打开的项目'
        return json(overview(d, { usageByEntity: await loadIdentityUsageSafe() }))
      },
    },
    {
      name: 'get_episodes',
      description: 'Read episode list and current episode before multi-episode planning or editing.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        if (!d) return '无打开的项目'
        const usageByEntity = await loadIdentityUsageSafe()
        return json({ currentEpisodeId: d.currentEpisodeId, episodes: sortedEpisodes(d).map((episode) => episodeView(d, episode, { usageByEntity })) })
      },
    },
    {
      name: 'get_series_bible',
      description: '读取系列圣经和每集规划。用于整季规划、续写多集、决定每集必须出现的资产/妆容/形态。',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        if (!d) return '无打开的项目'
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          seriesBible: {
            ...(d.seriesBible ?? {}),
            plannedEpisodeCount: d.seriesBible?.plannedEpisodeCount ?? sortedEpisodes(d).length,
            continuityRules: d.seriesBible?.continuityRules ?? [],
          },
          episodes: sortedEpisodes(d).map((episode) => ({ ...episodeInfo(d, episode), plan: planView(d, episode.plan, usageByEntity) })),
          availableAssets: d.assets
            .filter(isCastableAsset)
            .map((asset) => ({ id: asset.id, name: asset.name, type: asset.type, aliases: asset.aliases, ...assetLineageView(asset), assetCenterUsage: assetCenterUsageView(d, asset, usageByEntity) })),
          availableVariants: variantOptions(d, usageByEntity),
        })
      },
    },
    {
      name: 'get_continuity_report',
      description: 'Audit multi-episode asset, variant, episode-plan, and asset-center consistency.',
      parameters: { type: 'object', properties: {} },
      execute: async () => {
        const d = doc()
        if (!d) return '无打开的项目'
        try {
          const hub = await loadAssetHub()
          return json(continuityReportView(d, buildContinuityReport(d, { libraryEntities: hub.entities }), hub.usageByEntity))
        } catch {
          return json(buildContinuityReport(d))
        }
      },
    },
    {
      name: 'get_episode_handoff',
      description: `读取某集的跨集承接线索：最近已制作剧集回顾、plannedAssets/plannedVariants 本集计划输入、当前集资产/形态在其他剧集中的出现记录，以及可执行承接建议。${PLANNED_HANDOFF_STORYBOARD_RULE}`,
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number', description: '1-based 剧集序号' },
          episodeTitle: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisodeSelector(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        return json({ ...episodeInfo(d, episode), ...episodeHandoffView(d, buildEpisodeProductionHandoff(d, episode), await loadIdentityUsageSafe()) })
      },
    },
    {
      name: 'get_script',
      description: '读取剧本正文。默认读取当前集，可用 episodeId/episodeIndex/episodeTitle 指定剧集；scriptId 或 index(1-based) 指定该集内剧本。',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number', description: '1-based 剧集序号' },
          episodeTitle: { type: 'string' },
          scriptId: { type: 'string' },
          index: { type: 'number', description: '1-based 剧本序号' },
          contentLimit: { type: 'number', description: '正文最多返回字符数，默认 12000，最大 50000' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisodeSelector(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        const scripts = scriptsForEpisode(d, episode)
        const limit = numberArg(a.contentLimit, 12000, 0, 50000)
        const idx = typeof a.index === 'number' ? oneBasedIndex(a.index, scripts.length) : 0
        const script = typeof a.scriptId === 'string' ? scripts.find((s) => s.id === a.scriptId) : idx === undefined ? undefined : scripts[idx]
        const usageByEntity = await loadIdentityUsageSafe()
        const episodeContext = scriptEpisodeContext(d, episode, usageByEntity)
        if (!script) return json({ error: '未找到剧本', episode: episodeContext, scripts: scripts.map((s, i) => ({ id: s.id, index: i + 1, name: s.name })) })
        return json({ ...episodeContext, id: script.id, index: scripts.indexOf(script) + 1, name: script.name, createdAt: script.createdAt, updatedAt: script.updatedAt, content: textBlock(script.content, limit) })
      },
    },
    {
      name: 'get_storyboards',
      description: '读取某集真实分镜列表，包含画面、提示词、时长、对白、关联资产、生成状态等。默认当前集；支持 episodeId/episodeIndex/episodeTitle 和 startIndex/count 分页。',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number', description: '1-based 剧集序号' },
          episodeTitle: { type: 'string' },
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
        const episode = resolveEpisodeSelector(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        const sorted = [...storyboardsForEpisode(d, episode)].sort((x, y) => x.index - y.index)
        const start = numberArg(a.startIndex, 1, 1, Math.max(1, sorted.length)) - 1
        const count = numberArg(a.count, sorted.length, 1, 200)
        const slice = sorted.slice(start, start + count)
        const includeAssets = boolArg(a.includeAssets, true)
        const usageByEntity = includeAssets ? await loadIdentityUsageSafe() : undefined
        return json({
          ...episodeInfo(d, episode),
          total: sorted.length,
          startIndex: start + 1,
          count: slice.length,
          storyboards: slice.map((s) =>
            storyboardView(d, s, {
              includePrompt: boolArg(a.includePrompt, true),
              includeDialogues: boolArg(a.includeDialogues, true),
              includeAssets,
              usageByEntity,
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
        const name = normalizeAssetLookup(a.name)
        const assets = d.assets.filter((x) => {
          if (!includeDerived && x.parentAssetId) return false
          if (typeof a.type === 'string' && x.type !== a.type) return false
          if (name && ![x.name, ...(x.aliases ?? [])].some((value) => normalizeAssetLookup(value).includes(name))) return false
          return true
        })
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          total: assets.length,
          assets: assets.map((x) =>
            assetView(x, {
              doc: d,
              includePrompt: boolArg(a.includePrompt, true),
              includeImages: boolArg(a.includeImages, true),
              usageByEntity,
            }),
          ),
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
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          total: d.novel.length,
          chapters: chapters.map((c) => ({
            id: c.id,
            index: c.index + 1,
            title: c.title,
            episodes: chapterEpisodeRefs(d, c.id, usageByEntity),
            event: c.event,
            eventState: c.eventState,
            text: includeText ? textBlock(c.text, limit) : { length: c.text.length, omitted: true },
          })),
        })
      },
    },
    {
      name: 'get_storyboard_table',
      description: '读取某集设计层分镜表/大纲（场次、段落、镜头行）。默认当前集；当用户问大纲、段落、分场或结构时优先使用。',
      parameters: { type: 'object', properties: { episodeId: { type: 'string' }, episodeIndex: { type: 'number', description: '1-based 剧集序号' }, episodeTitle: { type: 'string' } } },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisodeSelector(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        return json({ ...episodeInfo(d, episode), scenes: storyboardTableView(d, storyboardTableForEpisode(d, episode), await loadIdentityUsageSafe()) })
      },
    },
    {
      name: 'get_timeline',
      description: '读取某集时间线、视频段和候选片段状态，包含 clip 路径、时长、选中候选和生成状态。默认当前集。',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number', description: '1-based 剧集序号' },
          episodeTitle: { type: 'string' },
          includeClips: { type: 'boolean' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisodeSelector(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        const storyboards = storyboardsForEpisode(d, episode)
        const storyboardById = new Map(storyboards.map((s) => [s.id, s]))
        const clips = clipsForEpisode(d, episode)
        const includeClips = boolArg(a.includeClips, true)
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          ...episodeInfo(d, episode),
          tracks: [...trackForEpisode(d, episode)].sort((x, y) => x.order - y.order).map((t) => ({
            id: t.id,
            order: t.order,
            kind: t.kind,
            storyboardIds: t.storyboardIds,
            storyboardIndexes: t.storyboardIds.map((id) => {
              const sb = storyboards.find((s) => s.id === id)
              return sb ? sb.index + 1 : id
            }),
            storyboardCastAssets: t.storyboardIds.map((id) => {
              const sb = storyboardById.get(id)
              return {
                storyboardId: id,
                storyboardIndex: sb ? sb.index + 1 : undefined,
                castAssets: sb ? storyboardCastAssets(d, sb, usageByEntity) : [],
              }
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
          clips: includeClips ? clips : undefined,
        })
      },
    },
    {
      name: 'search_project',
      description: '按关键词搜索当前项目的剧集、全剧剧本、资产、全剧分镜、原著章节和分镜表；结果会标明所属剧集。',
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
        const episodes = episodeList(d)
        const usageByEntity = wants('assets') || wants('episodes') || wants('scripts') || wants('storyboards') || wants('novel') || wants('storyboardTable') ? await loadIdentityUsageSafe() : undefined
        return json({
          query: q,
          episodes: wants('episodes')
            ? episodes
                .filter((episode) => has(episode.title) || has(episode.summary) || has(episode.productionRecap))
                .slice(0, limit)
                .map((episode) => episodeView(d, episode, { usageByEntity }))
            : undefined,
          scripts: wants('scripts')
            ? episodes
                .flatMap((episode) =>
                  scriptsForEpisode(d, episode).map((s, i) => ({
                    ...scriptEpisodeContext(d, episode, usageByEntity),
                    id: s.id,
                    index: i + 1,
                    name: s.name,
                    content: s.content,
                  })),
                )
                .filter((s) => has(s.name) || has(s.content))
                .slice(0, limit)
                .map((s) => ({ episodeId: s.episodeId, episodeIndex: s.episodeIndex, episodeTitle: s.episodeTitle, current: s.current, episodePlan: s.episodePlan, id: s.id, index: s.index, name: s.name, snippet: snippet(s.content, q) }))
            : undefined,
          assets: wants('assets')
            ? d.assets
                .filter((asset) => has(asset.name) || asset.aliases?.some((alias) => has(alias)) || has(asset.desc) || has(asset.prompt))
                .slice(0, limit)
                .map((asset) => ({
                  id: asset.id,
                  type: asset.type,
                  name: asset.name,
                  aliases: asset.aliases,
                  desc: asset.desc,
                  promptSnippet: snippet(asset.prompt ?? '', q, 180),
                  ...assetLineageView(asset),
                  assetCenterUsage: assetCenterUsageView(d, asset, usageByEntity),
                }))
            : undefined,
          storyboards: wants('storyboards')
            ? episodes
                .flatMap((episode) =>
                  storyboardsForEpisode(d, episode).map((s) => ({
                    ...episodeInfo(d, episode),
                    storyboard: s,
                  })),
                )
                .filter(({ storyboard }) => has(storyboard.videoDesc) || has(storyboard.prompt) || (storyboard.dialogues ?? []).some((dl) => has(dl.character) || has(dl.line)))
                .sort((x, y) => x.episodeIndex - y.episodeIndex || x.storyboard.index - y.storyboard.index)
                .slice(0, limit)
                .map(({ storyboard: s, ...episode }) => ({
                  ...episode,
                  id: s.id,
                  index: s.index + 1,
                  videoDesc: s.videoDesc,
                  promptSnippet: snippet(s.prompt ?? '', q, 180),
                  dialogues: s.dialogues,
                  castAssets: storyboardCastAssets(d, s, usageByEntity),
                }))
            : undefined,
          novel: wants('novel')
            ? d.novel
                .filter((c) => has(c.title) || has(c.event) || has(c.text))
                .slice(0, limit)
                .map((c) => ({ id: c.id, index: c.index + 1, title: c.title, event: c.event, episodes: chapterEpisodeRefs(d, c.id, usageByEntity), snippet: snippet(c.text, q) }))
            : undefined,
          storyboardTable: wants('storyboardTable')
            ? episodes
                .flatMap((episode) =>
                  storyboardTableForEpisode(d, episode).map((scene) => ({
                    ...episodeInfo(d, episode),
                    scene,
                  })),
                )
                .filter(({ scene }) => has(scene.sceneName) || scene.segments.some((seg) => has(seg.title) || seg.rows.some((row) => has(row.videoDesc) || has(row.dialogue))))
                .slice(0, limit)
                .map(({ scene, ...episode }) => ({ ...episode, scene: storyboardTableView(d, [scene], usageByEntity)[0] }))
            : undefined,
        })
      },
    },
  ]
}

export function makeAgentTools(get: () => ProjectState): AgentTool[] {
  const doc = () => get().doc
  const applyHandoffSuggestion = async (episodeId: string, suggestion: EpisodeHandoffSuggestion): Promise<EpisodeHandoffSuggestionApplyResult> => {
    const d = doc()
    const episode = d?.episodes?.find((item) => item.id === episodeId) ?? (d ? currentEpisode(d) : undefined)
    if (!episode) return { id: suggestion.id, kind: suggestion.kind, skipped: true, reason: '未找到剧集' }
    return applyEpisodeHandoffSuggestion(episode, suggestion, {
      getDoc: doc,
      generateAsset: (assetId) => get().generateAsset(assetId),
      generateAssetVariant: (assetId, variantId) => get().generateAssetVariant(assetId, variantId),
      updateAssetVariant: (assetId, variantId, patch) => get().updateAssetVariant(assetId, variantId, patch),
      addAssetVariant: (assetId, init) => get().addAssetVariant(assetId, init),
      setStoryboardCastVariant: (storyboardId, assetId, variantId) => get().setStoryboardCastVariant(storyboardId, assetId, variantId),
    })
  }

  return [
    ...makeProjectReadTools(doc),
    {
      name: 'apply_episode_handoff_suggestion',
      description: '执行 get_episode_handoff 返回的可自动处理建议。可传 suggestionId/suggestionIds，或 allAuto=true 顺序执行当前集所有未禁用的 handoff.suggestions；用于先补齐计划资产主图、计划形态图和 plannedVariants 的 episode 作用域，再生成分镜、关键帧或视频。',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number', description: '1-based 剧集序号' },
          episodeTitle: { type: 'string' },
          suggestionId: { type: 'string' },
          id: { type: 'string', description: 'suggestionId 的别名。' },
          suggestionIds: { type: 'array', items: { type: 'string' } },
          allAuto: { type: 'boolean', description: 'true 时循环执行当前集所有 autoRepairable 且未 disabled 的建议。' },
        },
      },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const episodeId = target.episode?.id
        if (!episodeId) return json({ error: '未找到剧集' })
        const requestedIds = handoffSuggestionIds(a)
        const applied: EpisodeHandoffSuggestionApplyResult[] = []
        const missing: string[] = []
        const attempted = new Set<string>()

        if (a.allAuto === true && !requestedIds.length) {
          for (let i = 0; i < 24; i += 1) {
            const d = doc()
            const episode = d?.episodes?.find((item) => item.id === episodeId)
            if (!d || !episode) break
            const suggestion = buildEpisodeProductionHandoff(d, episode).suggestions.find((item) => item.autoRepairable !== false && !item.disabledReason && !attempted.has(item.id))
            if (!suggestion) break
            attempted.add(suggestion.id)
            applied.push(await applyHandoffSuggestion(episodeId, suggestion))
          }
        } else {
          if (!requestedIds.length) {
            const handoff = target.doc && target.episode ? buildEpisodeProductionHandoff(target.doc, target.episode) : undefined
            const usageByEntity = target.doc ? await loadIdentityUsageSafe() : undefined
            return json({ error: '缺少 suggestionId/suggestionIds，或传 allAuto=true', suggestions: handoff?.suggestions.map((suggestion) => handoffSuggestionRef(suggestion, target.doc, usageByEntity)) ?? [] })
          }
          for (const id of requestedIds) {
            const d = doc()
            const episode = d?.episodes?.find((item) => item.id === episodeId)
            const suggestion = d && episode ? buildEpisodeProductionHandoff(d, episode).suggestions.find((item) => item.id === id) : undefined
            if (!suggestion) {
              missing.push(id)
              continue
            }
            applied.push(await applyHandoffSuggestion(episodeId, suggestion))
          }
        }

        const next = doc()
        const episode = next?.episodes?.find((item) => item.id === episodeId)
        const handoff = next && episode ? buildEpisodeProductionHandoff(next, episode) : undefined
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          episode: next && episode ? episodeInfoWithPlan(next, episode, usageByEntity) : undefined,
          applied: applied.map((item) => handoffSuggestionApplyResultView(item, next, usageByEntity)),
          missing,
          remainingSuggestions: handoff?.suggestions.map((suggestion) => handoffSuggestionRef(suggestion, next, usageByEntity)) ?? [],
        })
      },
    },
    {
      name: 'upsert_script',
      description: '写入或更新某集的剧本，默认当前集；可用 episodeId/episodeIndex/episodeTitle 指定剧集。',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number', description: '1-based 剧集序号' },
          episodeTitle: { type: 'string' },
          name: { type: 'string' },
          content: { type: 'string', description: '剧本正文' },
        },
        required: ['content'],
      },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const id = get().upsertScript({ name: typeof a.name === 'string' ? a.name : undefined, content: String(a.content ?? '') })
        const next = doc()
        const episode = next?.episodes?.find((item) => item.id === target.episode?.id) ?? target.episode
        const scripts = next && episode ? scriptsForEpisode(next, episode) : []
        const script = scripts.find((item) => item.id === id)
        const usageByEntity = next && episode ? await loadIdentityUsageSafe() : undefined
        return json({ id, episode: next && episode ? scriptEpisodeContext(next, episode, usageByEntity) : undefined, script: script ? { id: script.id, name: script.name, length: script.content.length } : undefined })
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
        return json({ id, currentEpisodeId: next?.currentEpisodeId, episode: next && episode ? await episodeViewWithUsage(next, episode) : undefined })
      },
    },
    {
      name: 'create_episodes',
      description: 'Batch create empty episodes. Use when the user asks for many episodes before chapter distribution or episode production.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of new episodes to add. Max 100.' },
          titlePrefix: { type: 'string', description: 'Optional prefix for new episode titles.' },
        },
        required: ['count'],
      },
      execute: async (a) => {
        if (!doc()) return '无打开的项目'
        const count = Math.max(0, Math.min(100, Math.floor(Number(a.count ?? 0))))
        if (!count) return json({ error: 'count 必须大于 0' })
        const ids = get().createEpisodes(count)
        if (typeof a.titlePrefix === 'string' && a.titlePrefix.trim()) {
          ids.forEach((id, index) => get().renameEpisode(id, `${a.titlePrefix}${index + 1}`))
        }
        const next = get().doc
        return json({ ids, currentEpisodeId: next?.currentEpisodeId, episodes: next ? await episodeListWithUsage(next) : [] })
      },
    },
    {
      name: 'update_series_bible',
      description: '创建或更新系列圣经：整季 logline、梗概、主题、世界规则、连续性规则和计划集数。用于多集规划前先建立整季蓝图。',
      parameters: {
        type: 'object',
        properties: {
          logline: { type: 'string' },
          synopsis: { type: 'string' },
          theme: { type: 'string' },
          worldRules: { type: 'string' },
          continuityRules: { type: 'array', items: { type: 'string' } },
          continuityRulesText: { type: 'string', description: '多行连续性规则；continuityRules 为空时可用。' },
          plannedEpisodeCount: { type: 'number' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const continuityRules =
          stringArrayArg(a.continuityRules) ??
          (typeof a.continuityRulesText === 'string'
            ? a.continuityRulesText
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
            : undefined)
        const patch: Parameters<ProjectState['updateSeriesBible']>[0] = {}
        if (hasArg(a, 'logline')) patch.logline = stringArg(a.logline)
        if (hasArg(a, 'synopsis')) patch.synopsis = stringArg(a.synopsis)
        if (hasArg(a, 'theme')) patch.theme = stringArg(a.theme)
        if (hasArg(a, 'worldRules')) patch.worldRules = stringArg(a.worldRules)
        if (hasArg(a, 'continuityRules') || hasArg(a, 'continuityRulesText')) patch.continuityRules = continuityRules ?? []
        if (typeof a.plannedEpisodeCount === 'number') patch.plannedEpisodeCount = a.plannedEpisodeCount
        get().updateSeriesBible(patch)
        const next = doc() ?? d
        return json({
          seriesBible: {
            ...(next.seriesBible ?? {}),
            plannedEpisodeCount: next.seriesBible?.plannedEpisodeCount ?? sortedEpisodes(next).length,
            continuityRules: next.seriesBible?.continuityRules ?? [],
          },
        })
      },
    },
    {
      name: 'upsert_episode_plan',
      description: '创建或更新某集规划：开场钩子、核心冲突、结尾钩子，以及本集必须出现的项目资产和妆容/形态。默认当前集；可用 episodeId/episodeIndex/episodeTitle 指定。',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number' },
          episodeTitle: { type: 'string' },
          hook: { type: 'string' },
          conflict: { type: 'string' },
          cliffhanger: { type: 'string' },
          requiredAssetIds: { type: 'array', items: { type: 'string' } },
          requiredAssetNames: { type: 'array', items: { type: 'string' } },
          assetNames: { type: 'array', items: { type: 'string' }, description: 'requiredAssetNames 的别名。' },
          requiredVariantIds: { type: 'array', items: { type: 'string' } },
          requiredVariants: {
            type: 'array',
            description: '可传变体 id/label 字符串，或 {assetId/assetName/name, variantId/variantLabel/label} 对象。',
            items: { type: 'object' },
          },
          mode: { type: 'string', enum: ['replace', 'add', 'remove'], description: '仅作用于本次传入的 requiredAsset/requiredVariant 列表；默认 replace。' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisodeSelector(d, a)
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        const patch: Partial<EpisodePlan> = {}
        if (hasArg(a, 'hook')) patch.hook = stringArg(a.hook)
        if (hasArg(a, 'conflict')) patch.conflict = stringArg(a.conflict)
        if (hasArg(a, 'cliffhanger')) patch.cliffhanger = stringArg(a.cliffhanger)
        const assets = resolvePlanAssetIds(d, a)
        const variants = resolvePlanVariantIds(d, a)
        const hasAssetArgs = hasArg(a, 'requiredAssetIds') || hasArg(a, 'requiredAssetNames') || hasArg(a, 'assetNames')
        const hasVariantArgs = hasArg(a, 'requiredVariantIds') || hasArg(a, 'requiredVariants')
        const requiredAssetIds = a.mode === 'remove' ? assets.ids : [...new Set([...assets.ids, ...variants.assetIds])]
        if (hasAssetArgs || (hasVariantArgs && variants.assetIds.length && a.mode !== 'remove')) {
          patch.requiredAssetIds = mergeIdList(episode.plan?.requiredAssetIds, requiredAssetIds, hasAssetArgs ? a.mode : 'add')
        }
        if (hasVariantArgs) {
          patch.requiredVariantIds = mergeIdList(episode.plan?.requiredVariantIds, variants.ids, a.mode)
        }
        get().updateEpisodePlan(episode.id, patch)
        const next = doc() ?? d
        const updated = next.episodes?.find((item) => item.id === episode.id) ?? episode
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          episode: episodeInfo(next, updated),
          plan: planView(next, updated.plan, usageByEntity),
          unresolvedAssets: assets.unresolved,
          unresolvedVariants: variants.unresolved,
        })
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
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        get().switchEpisode(episode.id)
        const next = get().doc ?? d
        const current = next.episodes?.find((e) => e.id === episode.id) ?? episode
        return json({ currentEpisodeId: next.currentEpisodeId, episode: await episodeViewWithUsage(next, current) })
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
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        get().renameEpisode(episode.id, String(a.newTitle ?? ''))
        const next = get().doc ?? d
        const renamed = next.episodes?.find((e) => e.id === episode.id) ?? episode
        return json({ id: renamed.id, episode: await episodeViewWithUsage(next, renamed) })
      },
    },
    {
      name: 'set_episode_series_skip',
      description: 'Temporarily hold or restore an episode in the full-series production queue.',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          index: { type: 'number', description: '1-based episode index when episodeId is omitted.' },
          title: { type: 'string', description: 'Episode title when episodeId/index is omitted.' },
          episodeIndex: { type: 'number', description: '1-based episode index; alias of index.' },
          episodeTitle: { type: 'string', description: 'Episode title; alias of title.' },
          skip: { type: 'boolean', description: 'true to hold the episode out of series production; false to restore it.' },
        },
        required: ['skip'],
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无打开的项目'
        const episode = resolveEpisode(d, { episodeId: a.episodeId, index: a.index ?? a.episodeIndex, title: a.title ?? a.episodeTitle })
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
        if (d.currentEpisodeId !== episode.id) get().switchEpisode(episode.id)
        get().setCurrentEpisodeSeriesSkip(a.skip === true)
        const next = get().doc ?? d
        const updated = next.episodes?.find((e) => e.id === episode.id) ?? episode
        return json({ episode: await episodeViewWithUsage(next, updated) })
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
        if (!episode) return json({ error: '未找到剧集', episodes: await episodeListWithUsage(d) })
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
        return json({ episode: await episodeViewWithUsage(next, updated), chapterIds: updated.novelChapterIds ?? [], unresolved: chapters.unresolved })
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
        if (episodes.length <= 1) return json({ error: '需要至少两集才能均分章节', episodes: await episodeListWithUsage(d, episodes) })
        if (!d.novel.length) return json({ error: '还没有导入原著章节' })
        get().distributeNovelChaptersAcrossEpisodes()
        const next = get().doc ?? d
        return json({ episodes: await episodeListWithUsage(next) })
      },
    },
    {
      name: 'add_asset',
      description: '新增资产：人物 role / 场景 scene / 物品 prop；aliases 用于昵称、称谓、原著别称，帮助后续分镜复用同一资产。',
      parameters: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['role', 'scene', 'prop'] }, name: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, desc: { type: 'string' }, prompt: { type: 'string' } },
        required: ['type', 'name'],
      },
      execute: async (a) => {
        const type = a.type === 'scene' || a.type === 'prop' ? a.type : 'role'
        const id = get().upsertAsset({ type, name: String(a.name ?? '未命名'), aliases: cleanAssetAliases(a.aliases), desc: a.desc as string | undefined, prompt: a.prompt as string | undefined })
        const next = get().doc
        const asset = next?.assets.find((item) => item.id === id)
        return json({
          id,
          asset: next && asset ? assetView(asset, { doc: next, includeImages: false, usageByEntity: await loadIdentityUsageSafe() }) : undefined,
        })
      },
    },
    {
      name: 'update_asset',
      description: '更新已有项目级资产的名称、别名、描述或提示词；用于修正 duplicate_asset_name / duplicate_asset_alias，不会创建新资产或自动合并引用。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string', description: '资产查找名；如需改名请传 newName。' },
          newName: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' }, description: '默认替换 aliases；传空数组可清空。' },
          aliasMode: { type: 'string', enum: ['replace', 'add', 'remove'], description: 'aliases 的处理方式，默认 replace。' },
          desc: { type: 'string' },
          prompt: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })

        const aliasMode = a.aliasMode === 'add' || a.aliasMode === 'remove' ? a.aliasMode : 'replace'
        const patch: Partial<Asset> & { id: string; type: Asset['type']; name: string } = {
          id: asset.id,
          type: asset.type,
          name: stringArg(a.newName) ?? asset.name,
        }
        if (Array.isArray(a.aliases) || typeof a.aliases === 'string') {
          const incoming = cleanAssetAliases(a.aliases)
          if (aliasMode === 'add') patch.aliases = cleanAssetAliases([...(asset.aliases ?? []), ...incoming])
          else if (aliasMode === 'remove') {
            const removing = new Set(incoming.map((alias) => normalizeAssetLookup(alias)))
            patch.aliases = (asset.aliases ?? []).filter((alias) => !removing.has(normalizeAssetLookup(alias)))
          } else patch.aliases = incoming
        }
        if (hasArg(a, 'desc')) patch.desc = typeof a.desc === 'string' && a.desc.trim() ? a.desc.trim() : undefined
        if (hasArg(a, 'prompt')) patch.prompt = typeof a.prompt === 'string' && a.prompt.trim() ? a.prompt.trim() : undefined

        get().upsertAsset(patch)
        const next = doc()
        const updated = next?.assets.find((item) => item.id === asset.id) ?? { ...asset, ...patch }
        const nextDoc = next ?? d
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          asset: assetView(updated, { doc: nextDoc, includeImages: false, usageByEntity }),
          conflicts: next ? assetLookupConflicts(next, updated) : [],
        })
      },
    },
    {
      name: 'link_project_asset_to_library_entity',
      description: '把已有项目资产关联到资产中心身份快照，不覆盖项目内名称、提示词、图片等生产字段；用于处理 asset_matches_unlinked_library_entity / library_entity_alias_conflict。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string', description: '项目资产查找名；不是身份资产名。' },
          libraryEntityId: { type: 'string' },
          entityId: { type: 'string' },
          libraryEntityName: { type: 'string' },
          entityName: { type: 'string' },
          entityVersion: { type: 'number', description: '资产中心快照版本；只有无法读取资产中心且按 id 关联时才需要。' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        const resolved = await resolveLibraryEntityForAsset(asset, a)
        const usageByEntity = await loadIdentityUsageSafe()
        if (!resolved.entity) {
          return json({
            error: resolved.error ?? '未找到身份资产',
            asset: assetView(asset, { doc: d, includeImages: false, usageByEntity }),
            candidates: resolved.candidates?.map((entity) => libraryEntityView(entity, { doc: d, usageByEntity })),
          })
        }
        const linked = get().linkAssetToLibraryEntity(asset.id, {
          id: resolved.entity.id,
          name: resolved.entity.name,
          version: resolved.entity.version,
          archived: resolved.entity.archived,
          variants: resolved.entity.variants?.map((variant) => ({ id: variant.id, label: variant.label })),
        })
        const nextDoc = get().doc ?? d
        const nextAsset = nextDoc.assets.find((item) => item.id === asset.id) ?? asset
        return json({
          linked,
          asset: assetView(nextAsset, { doc: nextDoc, includeImages: false, usageByEntity }),
          entity: libraryEntityView(resolved.entity, { doc: nextDoc, usageByEntity }),
        })
      },
    },
    {
      name: 'mark_project_asset_distinct_identity',
      description: '把连续性报告中的身份候选标记为“不是同一身份”，压制同名/别名候选误报；如果当前链接到该身份，会把项目资产标为 forked。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string', description: '项目资产查找名；不是身份资产名。' },
          libraryEntityId: { type: 'string' },
          entityId: { type: 'string' },
          libraryEntityIds: { type: 'array', items: { type: 'string' } },
          entityIds: { type: 'array', items: { type: 'string' } },
          libraryEntityName: { type: 'string' },
          entityName: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        const resolved = await resolveLibraryEntityIdsForAsset(asset, a)
        if (!resolved.ids.length) {
          const usageByEntity = await loadIdentityUsageSafe()
          return json({
            error: resolved.error ?? '缺少要标记的身份资产 ID',
            asset: assetView(asset, { doc: d, includeImages: false, usageByEntity }),
            candidates: resolved.candidates?.map((entity) => libraryEntityView(entity, { doc: d, usageByEntity })),
          })
        }
        const marked = get().markAssetAsDistinctIdentity(asset.id, resolved.ids)
        const nextDoc = get().doc ?? d
        const nextAsset = nextDoc.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          marked,
          rejectedLibraryEntityIds: nextAsset.rejectedLibraryEntityIds ?? [],
          asset: assetView(nextAsset, { doc: nextDoc, includeImages: false, usageByEntity }),
        })
      },
    },
    {
      name: 'publish_project_asset_to_library',
      description: '把项目资产发布/更新到资产中心身份资产。会复用已有活动 elementId/libraryLink，并把可复用变体写入资产中心；已分叉资产会另存为新身份，发布后项目资产保持快照链接。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        if (!asset.refImageId) return json({ error: '该资产还没有主参考图，不能发布到资产中心', asset: await assetViewWithUsage(d, asset, { includeImages: false }) })
        const published = await get().promoteAssetToElement(asset.id)
        const nextDoc = get().doc ?? d
        const nextAsset = nextDoc.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          published,
          error: published ? undefined : '未发布，可能缺少主参考图或关联身份已归档',
          asset: assetView(nextAsset, { doc: nextDoc, includeImages: false, usageByEntity }),
        })
      },
    },
    {
      name: 'sync_project_asset_from_library',
      description: '从资产中心身份资产同步项目资产快照。会更新项目资产的身份字段、参考图和可复用变体，但保留项目内变体适用范围；已分叉资产必须显式指定新的身份目标。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string', description: '项目资产查找名；不是身份资产名。' },
          libraryEntityId: { type: 'string' },
          entityId: { type: 'string' },
          libraryEntityName: { type: 'string' },
          entityName: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        const resolved = await resolveLibraryEntityForAsset(asset, {
          libraryEntityId: a.libraryEntityId ?? a.entityId ?? projectAssetIdentityEntityId(asset),
          libraryEntityName: a.libraryEntityName ?? a.entityName,
        })
        const usageByEntity = await loadIdentityUsageSafe()
        if (!resolved.entity?.name) {
          return json({
            error: resolved.error ?? '需要可读取的资产中心身份快照才能同步',
            asset: assetView(asset, { doc: d, includeImages: false, usageByEntity }),
            candidates: resolved.candidates?.map((entity) => libraryEntityView(entity, { doc: d, usageByEntity })),
          })
        }
        const synced = get().syncAssetFromLibraryEntity(asset.id, resolved.entity as LibraryEntity)
        const nextDoc = get().doc ?? d
        const nextAsset = nextDoc.assets.find((item) => item.id === asset.id) ?? asset
        return json({ synced, entity: libraryEntityView(resolved.entity, { doc: nextDoc, usageByEntity }), asset: assetView(nextAsset, { doc: nextDoc, includeImages: false, usageByEntity }) })
      },
    },
    {
      name: 'merge_project_asset_into',
      description: '把一个重复项目资产合并到另一个同类型项目资产，迁移分镜/每集计划引用并删除源资产；用于处理 duplicate_library_entity_project_assets / cross_episode_duplicate_project_asset_candidate。',
      parameters: {
        type: 'object',
        properties: {
          sourceAssetId: { type: 'string' },
          sourceAssetName: { type: 'string' },
          fromAssetId: { type: 'string' },
          fromAssetName: { type: 'string' },
          targetAssetId: { type: 'string' },
          targetAssetName: { type: 'string' },
          toAssetId: { type: 'string' },
          toAssetName: { type: 'string' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const source =
          findCastableAsset(d, a.sourceAssetId) ??
          findCastableAsset(d, a.fromAssetId) ??
          findCastableAsset(d, a.sourceAssetName) ??
          findCastableAsset(d, a.fromAssetName)
        const target =
          findCastableAsset(d, a.targetAssetId) ??
          findCastableAsset(d, a.toAssetId) ??
          findCastableAsset(d, a.targetAssetName) ??
          findCastableAsset(d, a.toAssetName)
        if (!source || !target) {
          const usageByEntity = await loadIdentityUsageSafe()
          return json({
            error: '未找到源资产或目标资产',
            sourceFound: source ? assetView(source, { doc: d, includePrompt: false, includeImages: false, usageByEntity }) : undefined,
            targetFound: target ? assetView(target, { doc: d, includePrompt: false, includeImages: false, usageByEntity }) : undefined,
            assets: assetCandidateList(d, undefined, usageByEntity),
          })
        }
        if (source.id === target.id) return json({ error: '源资产和目标资产不能相同', asset: await assetViewWithUsage(d, source, { includeImages: false }) })
        if (source.type !== target.type) {
          const usageByEntity = await loadIdentityUsageSafe()
          return json({
            error: '只能合并同类型项目资产',
            source: assetView(source, { doc: d, includeImages: false, usageByEntity }),
            target: assetView(target, { doc: d, includeImages: false, usageByEntity }),
          })
        }
        const merged = get().mergeProjectAssetInto(source.id, target.id)
        const next = doc()
        const nextTarget = next?.assets.find((item) => item.id === target.id)
        const usageByEntity = nextTarget ? await loadIdentityUsageSafe() : undefined
        return json({
          merged,
          removedSourceId: merged ? source.id : undefined,
          target: next && nextTarget ? assetView(nextTarget, { doc: next, includeImages: false, usageByEntity }) : undefined,
          sourceStillExists: next?.assets.some((item) => item.id === source.id),
        })
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
          return json({ error: '未找到可创建变体的资产', assets: await assetCandidateListWithUsage(d) })
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
        const nextDoc = get().doc ?? d
        const nextAsset = nextDoc.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = await loadIdentityUsageSafe()
        return json(variantView(nextAsset, variantId, { doc: nextDoc, usageByEntity }))
      },
    },
    {
      name: 'set_asset_variant_scope',
      description: '增量标记或移除资产变体适用范围，不会覆盖其它 episode/scene/storyboard 适用范围；用于修正 variant_out_of_episode_scope 和 episode_plan_variant_scope_mismatch。',
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string' },
          variantId: { type: 'string' },
          variantLabel: { type: 'string' },
          label: { type: 'string' },
          scopeKind: { type: 'string', enum: ['episode', 'scene', 'storyboard'] },
          scopeId: { type: 'string', description: '直接指定要追加/移除的 episodeId、sceneId 或 storyboardId。' },
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number', description: '1-based 剧集序号；scopeKind=episode 时可作为目标范围。' },
          episodeTitle: { type: 'string' },
          sceneId: { type: 'string' },
          storyboardId: { type: 'string' },
          storyboardIndex: { type: 'number', description: '1-based 分镜序号；scopeKind=storyboard 且 storyboardId 为空时使用。' },
          remove: { type: 'boolean', description: 'true 时从该层级适用范围中移除目标 ID。' },
        },
      },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        const variant = findAssetVariant(asset, a.variantId ?? a.variantLabel ?? a.label)
        if (!variant) return json({ error: '未找到变体', asset: await assetViewWithUsage(d, asset, { includeImages: false }), variants: await variantCandidateListWithUsage(d, asset) })
        const scopeKind = inferVariantScopeKind(a)
        if (!scopeKind) return json({ error: '未指定适用范围层级', expected: ['episode', 'scene', 'storyboard'] })
        const scopeId = resolveVariantScopeId(d, a, scopeKind)
        if (!scopeId) return json({ error: '未找到适用范围 ID', scopeKind, episodes: scopeKind === 'episode' ? sortedEpisodes(d).map((episode) => episodeInfo(d, episode)) : undefined })
        const key = variantScopeKey(scopeKind)
        const patch: Partial<AssetVariant> = { [key]: nextVariantScopeIds(variant, key, scopeId, a.remove === true) }
        get().updateAssetVariant(asset.id, variant.id, patch)
        const nextDoc = get().doc ?? d
        const nextAsset = nextDoc.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = await loadIdentityUsageSafe()
        return json({
          scopeKind,
          scopeId,
          action: a.remove === true ? 'remove' : 'add',
          result: variantView(nextAsset, variant.id, { doc: nextDoc, usageByEntity }),
        })
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
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        if (!asset.refImageId) return json({ error: '该资产还没有主参考图，不能生成变体', asset: await assetViewWithUsage(d, asset, { includeImages: false }) })
        const variant = findAssetVariant(asset, a.variantId ?? a.variantLabel ?? a.label)
        if (!variant) return json({ error: '未找到变体', asset: await assetViewWithUsage(d, asset, { includeImages: false }), variants: await variantCandidateListWithUsage(d, asset) })
        await get().generateAssetVariant(asset.id, variant.id)
        const nextDoc = get().doc ?? d
        const nextAsset = nextDoc.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = await loadIdentityUsageSafe()
        return json(variantView(nextAsset, variant.id, { doc: nextDoc, usageByEntity }))
      },
    },
    {
      name: 'set_storyboard_cast_variant',
      description: '给已有分镜里的某个出场资产绑定或清除指定变体，用于修正同一角色的妆容/服装/时期一致性；可选 ensureScope/scopeKind 在绑定时补当前剧集/场景/分镜适用范围。',
      parameters: {
        type: 'object',
        properties: {
          storyboardId: { type: 'string' },
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number' },
          episodeTitle: { type: 'string' },
          index: { type: 'number', description: '1-based 分镜序号，storyboardId 为空时使用。' },
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string' },
          variantId: { type: 'string' },
          variantLabel: { type: 'string' },
          label: { type: 'string' },
          ensureScope: { type: 'boolean', description: 'true 时按该变体已有作用域层级，或 scopeKind 指定层级，把当前使用位置加入适用范围。' },
          scopeKind: { type: 'string', enum: ['episode', 'scene', 'storyboard'], description: 'ensureScope 时可指定补剧集/场景/分镜范围。' },
          clear: { type: 'boolean', description: 'true 时清除该资产在此分镜上的变体绑定。' },
        },
      },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const d = target.doc
        if (!d) return '无项目'
        const storyboard = resolveStoryboard(d, a)
        if (!storyboard) return json({ error: '未找到分镜', storyboards: await storyboardCandidateListWithUsage(d) })
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        const variant = a.clear === true ? undefined : findAssetVariant(asset, a.variantId ?? a.variantLabel ?? a.label)
        if (a.clear !== true && !variant) return json({ error: '未找到变体', asset: await assetViewWithUsage(d, asset, { includeImages: false }), variants: await variantCandidateListWithUsage(d, asset) })
        get().setStoryboardCastVariant(storyboard.id, asset.id, variant?.id)
        const scopeKind = variantScopeKind(a.scopeKind)
        if (variant && (a.ensureScope === true || scopeKind)) {
          const episode = target.episode ?? currentEpisode(d)
          const patch = episode ? variantScopePatchForUse(variant, episode, storyboard, scopeKind) : undefined
          if (patch) get().updateAssetVariant(asset.id, variant.id, patch)
        }
        const next = doc()
        const updated = next?.storyboards.find((s) => s.id === storyboard.id)
        const nextAsset = next?.assets.find((item) => item.id === asset.id)
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          episode: next && target.episode ? episodeInfoWithPlan(next, target.episode, usageByEntity) : undefined,
          variant: variant ? variantView(nextAsset ?? asset, variant.id, next ? { doc: next, usageByEntity } : undefined) : undefined,
          storyboard: next && updated ? storyboardView(next, updated, { includePrompt: true, includeDialogues: true, includeAssets: true, usageByEntity }) : undefined,
        })
      },
    },
    {
      name: 'set_storyboard_asset_ref',
      description: '给已有分镜补充或移除角色/场景/道具资产引用，可选绑定变体；用于把 unused_project_asset 复用到合适分镜，或修正既有分镜出场资产。',
      parameters: {
        type: 'object',
        properties: {
          storyboardId: { type: 'string' },
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number' },
          episodeTitle: { type: 'string' },
          index: { type: 'number', description: '1-based 分镜序号，storyboardId 为空时使用。' },
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          name: { type: 'string' },
          variantId: { type: 'string' },
          variantLabel: { type: 'string' },
          label: { type: 'string' },
          roleInShot: { type: 'string', enum: ['lead', 'supporting', 'background'] },
          note: { type: 'string' },
          remove: { type: 'boolean', description: 'true 时从该分镜移除此资产引用。' },
        },
      },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const d = target.doc
        if (!d) return '无项目'
        const storyboard = resolveStoryboard(d, a)
        if (!storyboard) return json({ error: '未找到分镜', storyboards: await storyboardCandidateListWithUsage(d) })
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: '未找到资产', assets: await assetCandidateListWithUsage(d) })
        const variantToken = a.variantId ?? a.variantLabel ?? a.label
        const variant = variantToken ? findAssetVariant(asset, variantToken) : undefined
        if (variantToken && !variant) return json({ error: '未找到变体', asset: await assetViewWithUsage(d, asset, { includeImages: false }), variants: await variantCandidateListWithUsage(d, asset) })
        const patch = storyboardWithAssetRef(storyboard, asset.id, {
          remove: a.remove === true,
          variantId: variant?.id,
          roleInShot: roleInShot(a.roleInShot),
          note: stringArg(a.note),
        })
        get().upsertStoryboard({ id: storyboard.id, videoDesc: storyboard.videoDesc, ...patch })
        const next = doc()
        const updated = next?.storyboards.find((s) => s.id === storyboard.id)
        const nextAsset = next?.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          episode: next && target.episode ? episodeInfoWithPlan(next, target.episode, usageByEntity) : undefined,
          asset: next ? assetView(nextAsset, { doc: next, includeImages: false, usageByEntity }) : await assetViewWithUsage(d, asset, { includeImages: false }),
          storyboard: next && updated ? storyboardView(next, updated, { includePrompt: true, includeDialogues: true, includeAssets: true, usageByEntity }) : undefined,
        })
      },
    },
    {
      name: 'set_storyboard_scene_asset',
      description: '给已有分镜绑定场景资产；也可按 sceneId 把当前剧集中同一连续场景组统一为同一个场景资产，用于修正 scene_group_missing_asset/scene_group_asset_mismatch。',
      parameters: {
        type: 'object',
        properties: {
          storyboardId: { type: 'string' },
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number' },
          episodeTitle: { type: 'string' },
          index: { type: 'number', description: '1-based 分镜序号，storyboardId 为空且 sceneId 为空时使用。' },
          sceneId: { type: 'string', description: '连续场景组 ID。提供时可批量处理该组分镜。' },
          assetId: { type: 'string' },
          assetName: { type: 'string' },
          sceneAssetId: { type: 'string' },
          sceneAssetName: { type: 'string' },
          name: { type: 'string' },
          unifySceneGroup: { type: 'boolean', description: 'true 时移除同一 sceneId 组内其他场景资产并统一为该场景资产。' },
        },
      },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const d = target.doc
        if (!d) return '无项目'
        const asset = findSceneAsset(d, a)
        if (!asset) return json({ error: '未找到场景资产', assets: await assetCandidateListWithUsage(d, d.assets.filter((item) => item.type === 'scene' && !item.parentAssetId)) })
        const sceneId = stringArg(a.sceneId)
        const replaceOtherSceneAssets = a.unifySceneGroup === true || !!sceneId
        const targets = sceneId
          ? d.storyboards.filter((storyboard) => storyboard.sceneId?.trim() === sceneId)
          : [resolveStoryboard(d, a)].filter((storyboard): storyboard is Storyboard => !!storyboard)
        if (!targets.length) return json({ error: sceneId ? `未找到场景组：${sceneId}` : '未找到分镜', storyboards: await storyboardCandidateListWithUsage(d) })
        const updatedIds: string[] = []
        for (const storyboard of targets) {
          const patch = storyboardWithSceneAsset(d, storyboard, asset.id, replaceOtherSceneAssets)
          get().upsertStoryboard({ id: storyboard.id, videoDesc: storyboard.videoDesc, ...patch })
          updatedIds.push(storyboard.id)
        }
        const next = doc()
        const updated = next ? updatedIds.map((id) => next.storyboards.find((s) => s.id === id)).filter((item): item is Storyboard => !!item) : []
        const nextAsset = next?.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          episode: next && target.episode ? episodeInfoWithPlan(next, target.episode, usageByEntity) : undefined,
          asset: next ? assetView(nextAsset, { doc: next, includeImages: false, usageByEntity }) : await assetViewWithUsage(d, asset, { includeImages: false }),
          storyboards: next ? updated.map((storyboard) => storyboardView(next, storyboard, { includePrompt: true, includeDialogues: true, includeAssets: true, usageByEntity })) : undefined,
        })
      },
    },
    {
      name: 'add_storyboard',
      description: '新增当前剧集的分镜面板。cast 可用资产名或“资产名-变体标签”；需要精确妆容/服装时优先传 castRefs。可传 sceneId 支撑同场连续性检查，也可用 ensureScope/scopeKind 在绑定变体时补当前使用范围。',
      parameters: {
        type: 'object',
        properties: {
          episodeId: { type: 'string' },
          episodeIndex: { type: 'number' },
          episodeTitle: { type: 'string' },
          videoDesc: { type: 'string' },
          prompt: { type: 'string' },
          duration: { type: 'number' },
          sceneId: { type: 'string', description: '连续场景组 ID；同一空间或连续动作的镜头应复用同一个 sceneId。' },
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
          ensureScope: { type: 'boolean', description: 'true 时按变体已有作用域层级，或 scopeKind 指定层级，把当前使用位置加入适用范围。' },
          scopeKind: { type: 'string', enum: ['episode', 'scene', 'storyboard'], description: 'ensureScope 时可指定补剧集/场景/分镜范围。' },
          chainFromPrev: { type: 'boolean' },
        },
        required: ['videoDesc'],
      },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const d = target.doc
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
          sceneId: stringArg(a.sceneId),
          associateAssetIds: ids,
          castRefs: cast.refs.length ? cast.refs : undefined,
          dialogues,
          chainFromPrev: a.chainFromPrev === true,
        })
        let next = doc()
        const storyboard = next?.storyboards.find((s) => s.id === id)
        const scopeKind = variantScopeKind(a.scopeKind)
        if (storyboard && (a.ensureScope === true || scopeKind)) {
          const episode = target.episode ?? (next ? currentEpisode(next) : currentEpisode(d))
          if (episode) {
            for (const ref of cast.refs) {
              if (!ref.variantId) continue
              const asset = next?.assets.find((item) => item.id === ref.assetId)
              const variant = asset?.variants?.find((item) => item.id === ref.variantId)
              const patch = variant ? variantScopePatchForUse(variant, episode, storyboard, scopeKind) : undefined
              if (asset && variant && patch) get().updateAssetVariant(asset.id, variant.id, patch)
            }
            next = doc()
          }
        }
        const updatedStoryboard = next?.storyboards.find((s) => s.id === id)
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          id,
          episode: next && target.episode ? episodeInfoWithPlan(next, target.episode, usageByEntity) : undefined,
          unresolvedCast: cast.unresolved,
          variants: scopedVariantViews(next, cast.refs, usageByEntity),
          storyboard: next && updatedStoryboard ? storyboardView(next, updatedStoryboard, { includePrompt: true, includeDialogues: true, includeAssets: true, usageByEntity }) : undefined,
        })
      },
    },
    {
      name: 'generate_asset',
      description: '按名称生成资产参考图',
      parameters: { type: 'object', properties: { assetId: { type: 'string' }, assetName: { type: 'string' }, name: { type: 'string' } } },
      execute: async (a) => {
        const d = doc()
        if (!d) return '无项目'
        const asset = findCastableAsset(d, a.assetId) ?? findCastableAsset(d, a.assetName) ?? findCastableAsset(d, a.name)
        if (!asset) return json({ error: `未找到资产 ${String(a.assetId ?? a.assetName ?? a.name ?? '')}`, assets: await assetCandidateListWithUsage(d) })
        await get().generateAsset(asset.id)
        const next = doc()
        const nextAsset = next?.assets.find((item) => item.id === asset.id) ?? asset
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          generated: true,
          asset: next ? assetView(nextAsset, { doc: next, includeImages: false, usageByEntity }) : await assetViewWithUsage(d, asset, { includeImages: false }),
        })
      },
    },
    {
      name: 'generate_keyframe',
      description: '按分镜序号(1-based)生成关键帧',
      parameters: { type: 'object', properties: { episodeId: { type: 'string' }, episodeIndex: { type: 'number' }, episodeTitle: { type: 'string' }, index: { type: 'number' } }, required: ['index'] },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const d = target.doc
        if (!d) return '无项目'
        const storyboards = [...d.storyboards].sort((x, y) => x.index - y.index)
        const index = oneBasedIndex(a.index, storyboards.length)
        const sb = index === undefined ? undefined : storyboards[index]
        if (!sb) return json({ error: '分镜序号越界', storyboards: await storyboardCandidateListWithUsage(d) })
        await get().generateKeyframe(sb.id)
        const next = doc()
        const updated = next?.storyboards.find((storyboard) => storyboard.id === sb.id)
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          generated: true,
          episode: next && target.episode ? episodeInfoWithPlan(next, target.episode, usageByEntity) : undefined,
          storyboard: next && updated ? storyboardView(next, updated, { includePrompt: true, includeDialogues: true, includeAssets: true, usageByEntity }) : undefined,
        })
      },
    },
    {
      name: 'generate_clip',
      description: '按分镜序号(1-based)生成视频片段',
      parameters: { type: 'object', properties: { episodeId: { type: 'string' }, episodeIndex: { type: 'number' }, episodeTitle: { type: 'string' }, index: { type: 'number' } }, required: ['index'] },
      execute: async (a) => {
        const target = switchToEpisodeForWrite(get, a)
        if (target.error) return json(await episodeWriteTargetErrorView(target))
        const d = target.doc
        if (!d) return '无项目'
        const storyboards = [...d.storyboards].sort((x, y) => x.index - y.index)
        const index = oneBasedIndex(a.index, storyboards.length)
        const sb = index === undefined ? undefined : storyboards[index]
        if (!sb) return json({ error: '分镜序号越界', storyboards: await storyboardCandidateListWithUsage(d) })
        await get().generateClip(sb.id)
        const next = doc()
        const updated = next?.storyboards.find((storyboard) => storyboard.id === sb.id)
        const clips = next ? clipsForEpisode(next, target.episode ?? currentEpisode(next) ?? episodeList(next)[0]).filter((clip) => clip.storyboardId === sb.id) : undefined
        const usageByEntity = next ? await loadIdentityUsageSafe() : undefined
        return json({
          generated: true,
          episode: next && target.episode ? episodeInfoWithPlan(next, target.episode, usageByEntity) : undefined,
          storyboard: next && updated ? storyboardView(next, updated, { includePrompt: true, includeDialogues: true, includeAssets: true, usageByEntity }) : undefined,
          clips,
        })
      },
    },
  ]
}
