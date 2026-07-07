import { castRefsForStoryboard, labelForCastRef } from '../../domain/castRefs'
import type { AssetVariant, Clip, Episode, ProjectDoc, Script, Storyboard, StoryboardCastRef } from '../../domain/types'
import { buildContinuityReport, variantScopeIssue, type ContinuityIssue } from './continuityReport'

export interface VariantImageRequest {
  assetId: string
  variantId: string
}

export interface EpisodeHandoffRecap {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  recap: string
}

export interface EpisodeHandoffVariantDetail {
  variantId: string
  label: string
  variantKind?: AssetVariant['variantKind']
}

export interface EpisodeHandoffAppearance {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  variants: string[]
  variantLabels?: string[]
  variantDetails?: EpisodeHandoffVariantDetail[]
  mainImageUsed?: boolean
  recap?: string
}

export interface EpisodeHandoffAssetCue {
  assetId: string
  label: string
  variantId?: string
  variantKind?: AssetVariant['variantKind']
  appearances: EpisodeHandoffAppearance[]
  carryForward?: boolean
  detail?: string
}

export interface EpisodeHandoffPlannedAsset {
  assetId: string
  assetName: string
  assetType: ProjectDoc['assets'][number]['type']
  refImageId?: string
  requiredVariantIds: string[]
}

export interface EpisodeHandoffPlannedVariant {
  assetId: string
  assetName: string
  variantId: string
  variantLabel: string
  variantKind?: AssetVariant['variantKind']
  refImageId?: string
  scopeAppliesToEpisode: boolean
  appliesToEpisodeIds?: string[]
}

export type EpisodeHandoffSuggestionKind = 'generate_asset_ref_image' | 'generate_variant_ref_image' | 'add_variant_episode_scope' | 'create_episode_variant'

export interface EpisodeHandoffSuggestion {
  id: string
  kind: EpisodeHandoffSuggestionKind
  assetId: string
  variantId?: string
  scopeKind?: 'episode' | 'scene' | 'storyboard'
  storyboardId?: string
  sceneId?: string
  label: string
  detail: string
  autoRepairable?: boolean
  variantLabel?: string
  variantKind?: AssetVariant['variantKind']
  variantDesc?: string
  variantPrompt?: string
  disabledReason?: string
}

export interface EpisodeProductionHandoff {
  recaps: EpisodeHandoffRecap[]
  plannedAssets: EpisodeHandoffPlannedAsset[]
  plannedVariants: EpisodeHandoffPlannedVariant[]
  sharedAssets: EpisodeHandoffAssetCue[]
  suggestions: EpisodeHandoffSuggestion[]
}

export interface EpisodeComposeReadiness {
  ready: boolean
  total: number
  readyCount: number
  missingStoryboardIds: string[]
  missingStoryboardIndexes: number[]
}

export interface EpisodeProductionScope {
  current: boolean
  episode?: Episode
  storyboards: Storyboard[]
  clips: Clip[]
  track: ProjectDoc['track']
}

type HandoffAsset = ProjectDoc['assets'][number]
type HandoffVariant = NonNullable<HandoffAsset['variants']>[number]

interface EpisodeHandoffSourceRef {
  ref: StoryboardCastRef
  storyboard?: Storyboard
  carryForward: boolean
  sourceEpisode?: Episode
}

export function hasEpisodeProductionState(episode: Episode | undefined): boolean {
  return !!episode && (!!episode.filmPath || !!episode.filmError || !!episode.producedAt || !!episode.productionRecap || episode.status === 'done')
}

export function invalidateEpisodeProduction(episode: Episode | undefined): boolean {
  if (!episode || !hasEpisodeProductionState(episode)) return false
  delete episode.filmPath
  delete episode.filmError
  delete episode.producedAt
  delete episode.productionRecap
  if (episode.status === 'done') episode.status = 'planned'
  episode.updatedAt = Date.now()
  return true
}

export function invalidateCurrentEpisodeProduction(doc: ProjectDoc): boolean {
  return invalidateEpisodeProduction(doc.episodes?.find((item) => item.id === doc.currentEpisodeId))
}

export function storyboardsForEpisode(doc: ProjectDoc, episode: Episode): ProjectDoc['storyboards'] {
  return episode.id === doc.currentEpisodeId ? doc.storyboards : episode.storyboards
}

export function scriptsForEpisode(doc: ProjectDoc, episode: Episode): Script[] {
  return episode.id === doc.currentEpisodeId ? doc.scripts : episode.scripts
}

export function clipsForEpisode(doc: ProjectDoc, episode: Episode): Clip[] {
  return episode.id === doc.currentEpisodeId ? doc.clips : episode.clips
}

export function productionScopeForStoryboard(doc: ProjectDoc, storyboardId: string): EpisodeProductionScope | undefined {
  const currentEpisode = doc.episodes?.find((item) => item.id === doc.currentEpisodeId)
  if (doc.storyboards.some((storyboard) => storyboard.id === storyboardId)) {
    return { current: true, episode: currentEpisode, storyboards: doc.storyboards, clips: doc.clips, track: doc.track }
  }
  for (const episode of doc.episodes ?? []) {
    if (episode.id === doc.currentEpisodeId) continue
    if (episode.storyboards.some((storyboard) => storyboard.id === storyboardId)) {
      return { current: false, episode, storyboards: episode.storyboards, clips: episode.clips, track: episode.track }
    }
  }
  return undefined
}

export function productionScopeForTrack(doc: ProjectDoc, trackId: string): EpisodeProductionScope | undefined {
  const currentEpisode = doc.episodes?.find((item) => item.id === doc.currentEpisodeId)
  if (doc.track.some((track) => track.id === trackId)) {
    return { current: true, episode: currentEpisode, storyboards: doc.storyboards, clips: doc.clips, track: doc.track }
  }
  for (const episode of doc.episodes ?? []) {
    if (episode.id === doc.currentEpisodeId) continue
    if (episode.track.some((track) => track.id === trackId)) {
      return { current: false, episode, storyboards: episode.storyboards, clips: episode.clips, track: episode.track }
    }
  }
  return undefined
}

export function invalidateProductionScope(doc: ProjectDoc, scope: EpisodeProductionScope | undefined): boolean {
  if (!scope) return false
  return scope.current ? invalidateCurrentEpisodeProduction(doc) : invalidateEpisodeProduction(scope.episode)
}

export function setStoryboardCastVariantForScope(doc: ProjectDoc, storyboardId: string, assetId: string, variantId: string | undefined): boolean {
  const scope = productionScopeForStoryboard(doc, storyboardId)
  const storyboard = scope?.storyboards.find((item) => item.id === storyboardId)
  if (!scope || !storyboard) return false
  storyboard.associateAssetIds ??= []
  if (!storyboard.associateAssetIds.includes(assetId)) storyboard.associateAssetIds.push(assetId)
  const refs = castRefsForStoryboard(storyboard)
  const index = refs.findIndex((ref) => ref.assetId === assetId)
  const nextRef: StoryboardCastRef = { assetId, variantId: variantId || undefined }
  if (index >= 0) refs[index] = { ...refs[index], variantId: nextRef.variantId }
  else refs.push(nextRef)
  storyboard.castRefs = refs
  invalidateProductionScope(doc, scope)
  return true
}

export function projectDocForProductionScope(doc: ProjectDoc, scope: EpisodeProductionScope | undefined): ProjectDoc {
  if (!scope || scope.current) return doc
  return {
    ...doc,
    currentEpisodeId: scope.episode?.id ?? doc.currentEpisodeId,
    scripts: scope.episode?.scripts ?? doc.scripts,
    storyboards: scope.storyboards,
    storyboardTable: scope.episode?.storyboardTable,
    clips: scope.clips,
    track: scope.track,
  }
}

export function currentEpisodeUsesCastRef(doc: ProjectDoc, assetId: string, variantId?: string): boolean {
  const episode = doc.episodes?.find((item) => item.id === doc.currentEpisodeId)
  return episodeUsesCastRef(doc, episode, assetId, variantId)
}

export function episodeUsesCastRef(doc: ProjectDoc, episode: Episode | undefined, assetId: string, variantId?: string): boolean {
  const storyboards = episode ? storyboardsForEpisode(doc, episode) : doc.storyboards
  return storyboards.some((storyboard) =>
    castRefsForStoryboard(storyboard).some((ref) => ref.assetId === assetId && (variantId ? ref.variantId === variantId : !ref.variantId)),
  )
}

export function episodeUsesAsset(doc: ProjectDoc, episode: Episode | undefined, assetId: string): boolean {
  const storyboards = episode ? storyboardsForEpisode(doc, episode) : doc.storyboards
  return storyboards.some((storyboard) => castRefsForStoryboard(storyboard).some((ref) => ref.assetId === assetId))
}

export function invalidateCurrentEpisodeProductionIfCastRef(doc: ProjectDoc, assetId: string, variantId?: string): boolean {
  return currentEpisodeUsesCastRef(doc, assetId, variantId) ? invalidateCurrentEpisodeProduction(doc) : false
}

export function invalidateEpisodesUsingCastRef(doc: ProjectDoc, assetId: string, variantId?: string): number {
  const episodes = doc.episodes?.length ? doc.episodes : undefined
  if (!episodes) return invalidateCurrentEpisodeProductionIfCastRef(doc, assetId, variantId) ? 1 : 0
  let changed = 0
  for (const episode of episodes) {
    if (episodeUsesCastRef(doc, episode, assetId, variantId) && invalidateEpisodeProduction(episode)) changed += 1
  }
  return changed
}

export function invalidateEpisodesUsingAsset(doc: ProjectDoc, assetId: string): number {
  const episodes = doc.episodes?.length ? doc.episodes : undefined
  if (!episodes) return episodeUsesAsset(doc, undefined, assetId) && invalidateCurrentEpisodeProduction(doc) ? 1 : 0
  let changed = 0
  for (const episode of episodes) {
    if (episodeUsesAsset(doc, episode, assetId) && invalidateEpisodeProduction(episode)) changed += 1
  }
  return changed
}

export type EpisodeSeriesQueueState = 'pending' | 'completed' | 'failed' | 'generating' | 'skipped' | 'empty'

export function episodeSeriesQueueState(doc: ProjectDoc, episode: Episode): EpisodeSeriesQueueState {
  if (episode.status === 'generating') return 'generating'
  if (episode.filmPath) return 'completed'
  if (episode.filmError) return 'failed'
  if (episode.seriesSkip) return 'skipped'
  if (storyboardsForEpisode(doc, episode).length === 0) return 'empty'
  return 'pending'
}

export function episodeIsPendingForSeries(doc: ProjectDoc, episode: Episode): boolean {
  return episodeSeriesQueueState(doc, episode) === 'pending'
}

export function pendingEpisodesForSeries(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])]
    .sort((a, b) => a.index - b.index)
    .filter((episode) => episodeIsPendingForSeries(doc, episode))
}

const PRODUCTION_BLOCKING_CONTINUITY_CODES = new Set([
  'missing_asset',
  'missing_variant',
  'missing_ref_image',
  'variant_out_of_episode_scope',
  'episode_variant_available',
  'episode_plan_invalid_asset',
  'episode_plan_missing_asset',
  'episode_plan_invalid_variant',
  'episode_plan_variant_asset_missing',
  'episode_plan_variant_scope_mismatch',
  'episode_plan_missing_variant',
  'asset_state_regressed_to_main',
  'asset_state_changed_variant',
  'scene_group_asset_mismatch',
  'scene_group_missing_asset',
  'scene_group_variant_mismatch',
])

export function episodeProductionContinuityBlockers(doc: ProjectDoc, episode: Episode): ContinuityIssue[] {
  return buildContinuityReport(doc).issues.filter((issue) => issue.episodeId === episode.id && PRODUCTION_BLOCKING_CONTINUITY_CODES.has(issue.code))
}

function formatHandoffSuggestionLine(suggestion: EpisodeHandoffSuggestion): string {
  const id = suggestion.id ? ` (${suggestion.id})` : ''
  return `- ${suggestion.label}${id}`
}

export function formatEpisodeProductionContinuityError(
  episode: Episode,
  issues: ContinuityIssue[],
  options: { suggestions?: EpisodeHandoffSuggestion[] } = {},
): string {
  if (!issues.length) return ''
  const details = issues.slice(0, 5).map((issue) => `- ${issue.message}`).join('\n')
  const more = issues.length > 5 ? `\n- 另有 ${issues.length - 5} 个连续性问题` : ''
  const suggestions = (options.suggestions ?? []).filter((suggestion) => suggestion.autoRepairable !== false && !suggestion.disabledReason)
  const suggestionLines = suggestions.slice(0, 5).map(formatHandoffSuggestionLine).join('\n')
  const suggestionMore = suggestions.length > 5 ? `\n- 另有 ${suggestions.length - 5} 条可自动处理建议` : ''
  const suggestionBlock = suggestionLines ? `\n可先处理以下 handoff 建议：\n${suggestionLines}${suggestionMore}` : ''
  return `E${episode.index + 1}「${episode.title}」存在需要先确认的资产/形态连续性问题，已暂停本集生成：\n${details}${more}${suggestionBlock}`
}

function usableClip(clip: Clip | undefined): boolean {
  return !!clip && clip.state === 'done' && (!!clip.videoFilePath || !!clip.videoUrl)
}

export function episodeComposeReadiness(doc: Pick<ProjectDoc, 'storyboards' | 'clips' | 'track'>): EpisodeComposeReadiness {
  const storyboards = [...doc.storyboards].sort((a, b) => a.index - b.index)
  const missingStoryboardIds: string[] = []
  const missingStoryboardIndexes: number[] = []
  for (const storyboard of storyboards) {
    const track = doc.track.find((item) => item.storyboardIds.includes(storyboard.id))
    const clip = track
      ? doc.clips.find((item) => item.id === (track.selectClipId || track.clipIds[0]))
      : doc.clips.find((item) => item.storyboardId === storyboard.id && item.state === 'done')
    if (usableClip(clip)) continue
    missingStoryboardIds.push(storyboard.id)
    missingStoryboardIndexes.push(storyboard.index + 1)
  }
  return {
    ready: storyboards.length > 0 && missingStoryboardIds.length === 0,
    total: storyboards.length,
    readyCount: storyboards.length - missingStoryboardIds.length,
    missingStoryboardIds,
    missingStoryboardIndexes,
  }
}

function compact(value: string | undefined, limit: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 3))}...`
}

function limitLines(lines: string[], limit: number): string {
  const text = lines.filter(Boolean).join('\n')
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 3))}...`
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function variantForCastRef(asset: HandoffAsset | undefined, ref: StoryboardCastRef): HandoffVariant | undefined {
  if (!asset || !ref.variantId) return undefined
  return asset.variants?.find((variant) => variant.id === ref.variantId)
}

function uniqueVariantDetails(details: EpisodeHandoffVariantDetail[]): EpisodeHandoffVariantDetail[] {
  const seen = new Set<string>()
  const result: EpisodeHandoffVariantDetail[] = []
  for (const detail of details) {
    const key = `${detail.variantId}:${detail.label}:${detail.variantKind ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(detail)
  }
  return result
}

function variantDetailsForRefs(asset: HandoffAsset, refs: StoryboardCastRef[]): EpisodeHandoffVariantDetail[] {
  return uniqueVariantDetails(
    refs.flatMap((ref): EpisodeHandoffVariantDetail[] => {
      const variant = variantForCastRef(asset, ref)
      if (!ref.variantId || !variant) return []
      return [{
        variantId: ref.variantId,
        label: labelForCastRef(asset, ref),
        variantKind: variant.variantKind,
      }]
    }),
  )
}

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function plannedHandoffRequirements(episode: Episode, assets: Map<string, HandoffAsset>): Pick<EpisodeProductionHandoff, 'plannedAssets' | 'plannedVariants'> {
  const requiredVariantIds = unique(episode.plan?.requiredVariantIds ?? [])
  const ownerByVariant = new Map<string, { asset: HandoffAsset; variant: HandoffVariant }>()
  for (const asset of assets.values()) {
    if (asset.parentAssetId || asset.type === 'audio' || asset.type === 'clip') continue
    for (const variant of asset.variants ?? []) ownerByVariant.set(variant.id, { asset, variant })
  }
  const plannedVariants = requiredVariantIds.flatMap((variantId): EpisodeHandoffPlannedVariant[] => {
    const owner = ownerByVariant.get(variantId)
    if (!owner) return []
    const appliesToEpisodeIds = owner.variant.appliesToEpisodeIds
    return [{
      assetId: owner.asset.id,
      assetName: owner.asset.name,
      variantId: owner.variant.id,
      variantLabel: owner.variant.label,
      variantKind: owner.variant.variantKind,
      refImageId: owner.variant.refImageId,
      scopeAppliesToEpisode: !appliesToEpisodeIds?.length || appliesToEpisodeIds.includes(episode.id),
      appliesToEpisodeIds,
    }]
  })
  const requiredVariantIdsByAsset = new Map<string, string[]>()
  for (const item of plannedVariants) {
    requiredVariantIdsByAsset.set(item.assetId, [...(requiredVariantIdsByAsset.get(item.assetId) ?? []), item.variantId])
  }
  const plannedAssets = unique(episode.plan?.requiredAssetIds ?? []).flatMap((assetId): EpisodeHandoffPlannedAsset[] => {
    const asset = assets.get(assetId)
    if (!asset || asset.parentAssetId || asset.type === 'audio' || asset.type === 'clip') return []
    return [{
      assetId: asset.id,
      assetName: asset.name,
      assetType: asset.type,
      refImageId: asset.refImageId,
      requiredVariantIds: requiredVariantIdsByAsset.get(asset.id) ?? [],
    }]
  })
  return { plannedAssets, plannedVariants }
}

function uniqueCastRefs(storyboards: Storyboard[]): ReturnType<typeof castRefsForStoryboard> {
  const seen = new Set<string>()
  const refs: ReturnType<typeof castRefsForStoryboard> = []
  for (const storyboard of storyboards) {
    for (const ref of castRefsForStoryboard(storyboard)) {
      const key = `${ref.assetId}:${ref.variantId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs
}

function castRefUses(storyboards: Storyboard[]): { ref: StoryboardCastRef; storyboard: Storyboard }[] {
  return storyboards.flatMap((storyboard) => castRefsForStoryboard(storyboard).map((ref) => ({ ref, storyboard })))
}

function uniqueCastRefUses(storyboards: Storyboard[]): { ref: StoryboardCastRef; storyboard: Storyboard }[] {
  const seen = new Set<string>()
  const uses: { ref: StoryboardCastRef; storyboard: Storyboard }[] = []
  for (const use of castRefUses(storyboards)) {
    const key = `${use.ref.assetId}:${use.ref.variantId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    uses.push(use)
  }
  return uses
}

function latestCastRefsByAsset(doc: ProjectDoc, episode: Episode): StoryboardCastRef[] {
  const storyboards = [...storyboardsForEpisode(doc, episode)].sort((a, b) => b.index - a.index)
  const seen = new Set<string>()
  const refs: StoryboardCastRef[] = []
  for (const storyboard of storyboards) {
    for (const ref of [...castRefsForStoryboard(storyboard)].reverse()) {
      if (seen.has(ref.assetId)) continue
      seen.add(ref.assetId)
      refs.push(ref)
    }
  }
  return refs
}

function carryForwardCastRefs(doc: ProjectDoc, episode: Episode, episodes: Episode[], limit: number): { ref: StoryboardCastRef; sourceEpisode: Episode }[] {
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const seen = new Set<string>()
  const refs: { ref: StoryboardCastRef; sourceEpisode: Episode }[] = []
  for (const sourceEpisode of episodes.filter((item) => item.index < episode.index).sort((a, b) => b.index - a.index)) {
    for (const ref of latestCastRefsByAsset(doc, sourceEpisode)) {
      const asset = assets.get(ref.assetId)
      if (!asset || asset.type === 'audio' || asset.type === 'clip' || seen.has(ref.assetId)) continue
      seen.add(ref.assetId)
      refs.push({ ref, sourceEpisode })
      if (refs.length >= limit) return refs
    }
  }
  return refs
}

function variantHasScope(variant: NonNullable<ProjectDoc['assets'][number]['variants']>[number] | undefined): boolean {
  return !!variant && (!!variant.appliesToEpisodeIds?.length || !!variant.appliesToSceneIds?.length || !!variant.appliesToStoryboardIds?.length)
}

function scopeTargetLabel(kind: NonNullable<EpisodeHandoffSuggestion['scopeKind']>, episode: Episode, storyboard?: Storyboard): string {
  if (kind === 'scene') return storyboard?.sceneId ? `场景「${storyboard.sceneId}」` : `分镜 #${(storyboard?.index ?? 0) + 1}`
  if (kind === 'storyboard') return `分镜 #${(storyboard?.index ?? 0) + 1}`
  return `E${episode.index + 1}`
}

function latestPreviousVariantUse(
  doc: ProjectDoc,
  episodes: Episode[],
  episode: Episode,
  assetId: string,
  currentVariantId: string,
): { ref: StoryboardCastRef; episode: Episode } | undefined {
  for (const sourceEpisode of episodes.filter((item) => item.index < episode.index).sort((a, b) => b.index - a.index)) {
    const ref = latestCastRefsByAsset(doc, sourceEpisode).find((item) => item.assetId === assetId)
    if (!ref) continue
    if (ref.variantId && ref.variantId !== currentVariantId) return { ref, episode: sourceEpisode }
    return undefined
  }
  return undefined
}

function storyboardLabel(storyboard: Storyboard, assets: Map<string, ProjectDoc['assets'][number]>): string {
  const cast = castRefsForStoryboard(storyboard).map((ref) => labelForCastRef(assets.get(ref.assetId), ref))
  const castText = cast.length ? `（${unique(cast).slice(0, 4).join('、')}）` : ''
  return `#${storyboard.index + 1} ${compact(storyboard.videoDesc || storyboard.prompt, 76)}${castText}`
}

function episodeVariantSeed(
  assetName: string,
  episode: Episode,
  appearance: EpisodeHandoffAppearance | undefined,
): Pick<EpisodeHandoffSuggestion, 'variantLabel' | 'variantDesc' | 'variantPrompt'> {
  const label = `E${episode.index + 1} ${episode.title}形态`
  const sourceVariants = appearance?.variantLabels?.length ? appearance.variantLabels : appearance?.variants
  const source = appearance
    ? `承接 E${appearance.episodeIndex + 1}「${appearance.episodeTitle}」的 ${sourceVariants?.join('、')}`
    : `适用于 E${episode.index + 1}「${episode.title}」`
  const recap = appearance?.recap ? `上一状态：${compact(appearance.recap, 180)}` : ''
  return {
    variantLabel: label,
    variantDesc: `${source}，用于本集的新妆容、服装或剧情状态。`,
    variantPrompt: limitLines(
      [
        `为「${assetName}」生成 E${episode.index + 1}「${episode.title}」专属形态参考图。`,
        source,
        recap,
        '保持同一角色身份、脸型、体态和核心识别特征一致；只改变本集需要的妆容、服装、发型、道具或受伤/战损等状态。',
      ],
      520,
    ),
  }
}

function previousVariantBeforeMainReset(appearances: EpisodeHandoffAppearance[]): EpisodeHandoffAppearance | undefined {
  for (const appearance of appearances) {
    if ((appearance.variantLabels?.length ?? 0) > 0) return appearance
    if (appearance.mainImageUsed) return undefined
  }
  return undefined
}

export function buildEpisodeProductionRecap(doc: ProjectDoc, episode: Episode, limit = 1200): string {
  const scripts = scriptsForEpisode(doc, episode)
  const storyboards = [...storyboardsForEpisode(doc, episode)].sort((a, b) => a.index - b.index)
  const clips = clipsForEpisode(doc, episode)
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const chapterTitles = (episode.novelChapterIds ?? [])
    .map((id) => doc.novel.find((chapter) => chapter.id === id)?.title)
    .filter(Boolean) as string[]
  const castLabels = unique(
    storyboards.flatMap((storyboard) => castRefsForStoryboard(storyboard).map((ref) => labelForCastRef(assets.get(ref.assetId), ref))),
  )
  const doneClipCount = storyboards.filter((storyboard) => clips.some((clip) => clip.storyboardId === storyboard.id && clip.state === 'done')).length
  const script = scripts[0]
  const shotLabels = storyboards.slice(0, 8).map((storyboard) => storyboardLabel(storyboard, assets))
  const extraShots = Math.max(0, storyboards.length - shotLabels.length)
  const extraCast = Math.max(0, castLabels.length - 12)

  return limitLines(
    [
      `E${episode.index + 1}「${episode.title}」制作回顾：${storyboards.length} 个分镜，${doneClipCount}/${storyboards.length} 个已成视频${episode.filmPath ? '，已合成成片' : ''}。`,
      chapterTitles.length ? `原著章节：${chapterTitles.join('、')}` : '',
      script?.content ? `剧本要点：${compact(script.content, 180)}` : '',
      castLabels.length ? `连续性资产：${castLabels.slice(0, 12).join('、')}${extraCast ? ` 等 ${castLabels.length} 个` : ''}` : '',
      shotLabels.length ? `关键分镜：${shotLabels.join('；')}${extraShots ? `；另 ${extraShots} 个分镜` : ''}` : '',
    ],
    limit,
  )
}

export function buildEpisodeProductionHandoff(
  doc: ProjectDoc,
  episode: Episode,
  options: { maxRecaps?: number; maxAssets?: number; maxAppearances?: number } = {},
): EpisodeProductionHandoff {
  const maxRecaps = options.maxRecaps ?? 3
  const maxAssets = options.maxAssets ?? 8
  const maxAppearances = options.maxAppearances ?? 4
  const episodes = sortedEpisodes(doc)
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const planned = plannedHandoffRequirements(episode, assets)
  const recaps = episodes
    .filter((item) => item.index < episode.index && !!item.productionRecap?.trim())
    .sort((a, b) => b.index - a.index)
    .slice(0, maxRecaps)
    .map((item) => ({
      episodeId: item.id,
      episodeIndex: item.index,
      episodeTitle: item.title,
      recap: compact(item.productionRecap, 260),
    }))

  const currentStoryboards = storyboardsForEpisode(doc, episode)
  const allCurrentUses = castRefUses(currentStoryboards)
  const currentUses = uniqueCastRefUses(currentStoryboards)
  const sourceRefs: EpisodeHandoffSourceRef[] = currentUses.length
    ? currentUses.map(({ ref, storyboard }) => ({ ref, storyboard, carryForward: false as const, sourceEpisode: undefined }))
    : carryForwardCastRefs(doc, episode, episodes, maxAssets).map(({ ref, sourceEpisode }) => ({ ref, carryForward: true as const, sourceEpisode }))
  const sharedAssets: EpisodeHandoffAssetCue[] = []
  const suggestions: EpisodeHandoffSuggestion[] = []
  const suggested = new Set<string>()
  const addSuggestion = (suggestion: EpisodeHandoffSuggestion) => {
    if (suggested.has(suggestion.id)) return
    suggested.add(suggestion.id)
    suggestions.push(suggestion)
  }
  const addVariantScopeSuggestion = (asset: HandoffAsset, variant: HandoffVariant, storyboard: Storyboard) => {
    const scopeIssue = variantScopeIssue(variant, episode, storyboard)
    if (!scopeIssue) return
    const target = scopeTargetLabel(scopeIssue, episode, storyboard)
    addSuggestion({
      id: scopeIssue === 'episode' ? `variant-scope:${asset.id}:${variant.id}:${episode.id}:episode` : `variant-scope:${asset.id}:${variant.id}:${episode.id}:${scopeIssue}:${storyboard.id}`,
      kind: 'add_variant_episode_scope',
      assetId: asset.id,
      variantId: variant.id,
      scopeKind: scopeIssue,
      storyboardId: storyboard.id,
      sceneId: storyboard.sceneId,
      label: `标记「${variant.label}」适用${target}`,
      detail: `当前集使用了 ${asset.name}-${variant.label}，但该形态尚未标记适用于${target}。`,
      autoRepairable: true,
      variantKind: variant.variantKind,
    })
  }
  for (const plannedAsset of planned.plannedAssets) {
    if (plannedAsset.refImageId) continue
    addSuggestion({
      id: `asset-image:${plannedAsset.assetId}`,
      kind: 'generate_asset_ref_image',
      assetId: plannedAsset.assetId,
      label: `生成「${plannedAsset.assetName}」主参考图`,
      detail: `本集计划要求项目资产「${plannedAsset.assetName}」，但它还没有主参考图。生成分镜或关键帧前建议先补齐。`,
      autoRepairable: true,
    })
  }
  for (const plannedVariant of planned.plannedVariants) {
    const asset = assets.get(plannedVariant.assetId)
    const variant = asset?.variants?.find((item) => item.id === plannedVariant.variantId)
    if (!asset || !variant) continue
    if (!plannedVariant.scopeAppliesToEpisode) {
      addSuggestion({
        id: `variant-scope:${asset.id}:${variant.id}:${episode.id}:episode`,
        kind: 'add_variant_episode_scope',
        assetId: asset.id,
        variantId: variant.id,
        scopeKind: 'episode',
        label: `标记「${variant.label}」适用于E${episode.index + 1}`,
        detail: `本集计划要求 ${asset.name}-${variant.label}，但该形态尚未标记适用于 E${episode.index + 1}「${episode.title}」。建议生成分镜前先把本集加入适用范围。`,
        autoRepairable: true,
        variantKind: variant.variantKind,
      })
    }
    if (!plannedVariant.refImageId) {
      addSuggestion({
        id: `variant-image:${asset.id}:${variant.id}`,
        kind: 'generate_variant_ref_image',
        assetId: asset.id,
        variantId: variant.id,
        label: `生成「${asset.name}-${variant.label}」参考图`,
        detail: `本集计划要求该形态/妆容，但它还没有独立参考图。建议生成关键帧前先补齐。`,
        autoRepairable: true,
        variantKind: variant.variantKind,
        disabledReason: asset.refImageId ? undefined : '先生成主参考图，再派生形态图。',
      })
    }
  }
  for (const { ref, storyboard } of allCurrentUses) {
    if (!ref.variantId) continue
    const asset = assets.get(ref.assetId)
    const variant = asset?.variants?.find((item) => item.id === ref.variantId)
    if (asset && variant) addVariantScopeSuggestion(asset, variant, storyboard)
  }
  for (const sourceRef of sourceRefs) {
    const { ref } = sourceRef
    const asset = assets.get(ref.assetId)
    if (!asset || asset.type === 'audio' || asset.type === 'clip') continue
    if (!sourceRef.carryForward && !asset.refImageId) {
      addSuggestion({
        id: `asset-image:${asset.id}`,
        kind: 'generate_asset_ref_image',
        assetId: asset.id,
        label: `生成「${asset.name}」主参考图`,
        detail: '当前集引用了该资产，但它还没有主参考图。',
        autoRepairable: true,
      })
    }
    if (!sourceRef.carryForward && ref.variantId) {
      const variant = asset.variants?.find((item) => item.id === ref.variantId)
      if (variant) {
        if (!variantHasScope(variant)) {
          const previous = latestPreviousVariantUse(doc, episodes, episode, asset.id, variant.id)
          if (previous) {
            addSuggestion({
              id: `variant-switch-scope:${asset.id}:${variant.id}:${episode.id}`,
              kind: 'add_variant_episode_scope',
              assetId: asset.id,
              variantId: variant.id,
              label: `确认「${variant.label}」为本集形态`,
              detail: `上一相关剧集 E${previous.episode.index + 1}「${previous.episode.title}」使用过 ${labelForCastRef(asset, previous.ref)}，当前集切到 ${asset.name}-${variant.label} 但尚未标记适用本集；若这是明确换装/妆容变化，建议标记本集适用，否则回到分镜沿用上一形态。`,
              autoRepairable: true,
              variantKind: variant.variantKind,
            })
          }
        }
        if (!variant.refImageId) {
          addSuggestion({
            id: `variant-image:${asset.id}:${variant.id}`,
            kind: 'generate_variant_ref_image',
            assetId: asset.id,
            variantId: variant.id,
            label: `生成「${asset.name}-${variant.label}」参考图`,
            detail: '当前集引用了该形态，但它还没有独立参考图。',
            autoRepairable: true,
            variantKind: variant.variantKind,
            disabledReason: asset.refImageId ? undefined : '先生成主参考图，再派生形态图。',
          })
        }
      }
    }
    const appearances = episodes
      .filter((item) => item.id !== episode.id)
      .flatMap((item): EpisodeHandoffAppearance[] => {
        const refs = uniqueCastRefs(storyboardsForEpisode(doc, item)).filter((itemRef) => itemRef.assetId === ref.assetId)
        if (!refs.length) return []
        const variantLabels = unique(refs.filter((itemRef) => !!itemRef.variantId).map((itemRef) => labelForCastRef(asset, itemRef))).slice(0, 4)
        const variantDetails = variantDetailsForRefs(asset, refs).slice(0, 4)
        return [{
          episodeId: item.id,
          episodeIndex: item.index,
          episodeTitle: item.title,
          variants: unique(refs.map((itemRef) => labelForCastRef(asset, itemRef))).slice(0, 4),
          variantLabels: variantLabels.length ? variantLabels : undefined,
          variantDetails: variantDetails.length ? variantDetails : undefined,
          mainImageUsed: refs.some((itemRef) => !itemRef.variantId),
          recap: item.productionRecap ? compact(item.productionRecap, 180) : undefined,
        }]
      })
      .sort((a, b) => Math.abs(a.episodeIndex - episode.index) - Math.abs(b.episodeIndex - episode.index) || a.episodeIndex - b.episodeIndex)
      .slice(0, maxAppearances)
    if (appearances.length) {
      sharedAssets.push({
        assetId: ref.assetId,
        label: labelForCastRef(asset, ref),
        variantId: ref.variantId,
        variantKind: variantForCastRef(asset, ref)?.variantKind,
        appearances,
        carryForward: sourceRef.carryForward,
        detail: sourceRef.carryForward && sourceRef.sourceEpisode
          ? `当前集还没有分镜出场记录，建议从 E${sourceRef.sourceEpisode.index + 1}「${sourceRef.sourceEpisode.title}」承接该资产/形态。`
          : undefined,
      })
      if (!sourceRef.carryForward && !ref.variantId) {
        const previousAppearances = appearances
          .filter((item) => item.episodeIndex < episode.index)
          .sort((a, b) => b.episodeIndex - a.episodeIndex)
        const previousVariantAppearance = previousVariantBeforeMainReset(previousAppearances)
        const previousAppearance = previousAppearances[0]
        const seed = episodeVariantSeed(asset.name, episode, previousVariantAppearance ?? previousAppearance ?? appearances[0])
        const stateRegressionDetail = previousVariantAppearance
          ? `上一相关剧集 E${previousVariantAppearance.episodeIndex + 1}「${previousVariantAppearance.episodeTitle}」使用过 ${previousVariantAppearance.variantLabels?.join('、')}，当前集仍用主形象；如果不是剧情恢复默认，建议一键创建并绑定本集形态。`
          : undefined
        addSuggestion({
          id: `create-variant:${asset.id}:${episode.id}`,
          kind: 'create_episode_variant',
          assetId: asset.id,
          label: previousVariantAppearance ? `承接「${asset.name}」上一形态` : `新建并应用「${asset.name}」本集形态`,
          detail: stateRegressionDetail ?? `该资产在其他集也出现过；如果 E${episode.index + 1} 有新妆容、服装或状态，先建本集专属形态再生成参考图。`,
          autoRepairable: true,
          ...seed,
        })
      }
    }
    if (sharedAssets.length >= maxAssets) break
  }

  return { recaps, ...planned, sharedAssets, suggestions }
}

export function missingReferencedVariantImages(doc: Pick<ProjectDoc, 'assets' | 'storyboards'>): VariantImageRequest[] {
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const seen = new Set<string>()
  const result: VariantImageRequest[] = []
  for (const storyboard of doc.storyboards) {
    for (const ref of castRefsForStoryboard(storyboard)) {
      if (!ref.variantId) continue
      const key = `${ref.assetId}:${ref.variantId}`
      if (seen.has(key)) continue
      seen.add(key)
      const asset = assets.get(ref.assetId)
      if (!asset || asset.type === 'audio' || asset.type === 'clip') continue
      const variant = asset.variants?.find((item) => item.id === ref.variantId)
      if (!variant || variant.refImageId) continue
      result.push({ assetId: asset.id, variantId: variant.id })
    }
  }
  return result
}
