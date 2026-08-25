import { castRefsForStoryboard, labelForCastRef } from '../../domain/castRefs'
import { buildContinuityLedger, expectedVariantId, lastAppearanceChangeBefore } from '../../domain/continuityLedger'
import type { Asset, Clip, Episode, ProjectDoc, Script, Storyboard, StoryboardCastRef } from '../../domain/types'
import { buildContinuityReport, isProductionBlocking, type ContinuityIssue } from './continuityReport'

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

/**
 * 进入本集时某个资产的继承形态——这就是「承接」的全部内容。
 * 旧版用 appearances[] 枚举该资产在每一集出现过的形态组合，再靠一堆规则猜"应该承接哪个"；
 * 现在台账直接给出确定答案，不需要猜。
 */
export interface EpisodeHandoffAssetCue {
  assetId: string
  assetName: string
  assetType: Asset['type']
  label: string
  variantId?: string
  variantLabel?: string
  refImageId?: string
  /** 该形态是在哪一镜被设定的（没有变更点则为首次出场） */
  sinceEpisodeIndex?: number
  sinceStoryboardIndex?: number
  reason?: string
}

export type EpisodeHandoffSuggestionKind = 'generate_asset_ref_image' | 'generate_variant_ref_image'

export interface EpisodeHandoffSuggestion {
  id: string
  kind: EpisodeHandoffSuggestionKind
  assetId: string
  variantId?: string
  label: string
  detail: string
  autoRepairable?: boolean
  disabledReason?: string
}

export interface EpisodeProductionHandoff {
  recaps: EpisodeHandoffRecap[]
  /** 本集开拍时每个资产的形态状态 */
  carriedState: EpisodeHandoffAssetCue[]
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

/**
 * 只有 blocking 分类（引用悬空 / 缺参考图）会拦住整季生产。
 * 旧版有 16 个阻断码，其中 13 个只是「你没在计划里勾选」或「你没标作用域」——
 * 那些不是连续性事故，不该让一集停摆。形态告警现在只提示，不阻断。
 */
export function episodeProductionContinuityBlockers(doc: ProjectDoc, episode: Episode): ContinuityIssue[] {
  return buildContinuityReport(doc).issues.filter((issue) => issue.episodeId === episode.id && isProductionBlocking(issue))
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
  const more = issues.length > 5 ? `\n- 另有 ${issues.length - 5} 个问题` : ''
  const suggestions = (options.suggestions ?? []).filter((suggestion) => suggestion.autoRepairable !== false && !suggestion.disabledReason)
  const suggestionLines = suggestions.slice(0, 5).map(formatHandoffSuggestionLine).join('\n')
  const suggestionMore = suggestions.length > 5 ? `\n- 另有 ${suggestions.length - 5} 条可自动处理建议` : ''
  const suggestionBlock = suggestionLines ? `\n可先处理以下建议：\n${suggestionLines}${suggestionMore}` : ''
  return `E${episode.index + 1}「${episode.title}」缺少生成所需的资产或参考图，已暂停本集生成：\n${details}${more}${suggestionBlock}`
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

function storyboardLabel(storyboard: Storyboard, assets: Map<string, Asset>): string {
  const cast = castRefsForStoryboard(storyboard).map((ref) => labelForCastRef(assets.get(ref.assetId), ref))
  const castText = cast.length ? `（${unique(cast).slice(0, 4).join('、')}）` : ''
  return `#${storyboard.index + 1} ${compact(storyboard.videoDesc || storyboard.prompt, 76)}${castText}`
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
  const changes = storyboards.flatMap((storyboard) =>
    (storyboard.stateChanges ?? []).map((change) => {
      const asset = assets.get(change.assetId)
      const label = change.toVariantId ? asset?.variants?.find((item) => item.id === change.toVariantId)?.label ?? change.toVariantId : '主形象'
      return `#${storyboard.index + 1} ${asset?.name ?? change.assetId} → ${label}（${change.reason}）`
    }),
  )

  return limitLines(
    [
      `E${episode.index + 1}「${episode.title}」制作回顾：${storyboards.length} 个分镜，${doneClipCount}/${storyboards.length} 个已成视频${episode.filmPath ? '，已合成成片' : ''}。`,
      chapterTitles.length ? `原著章节：${chapterTitles.join('、')}` : '',
      script?.content ? `剧本要点：${compact(script.content, 180)}` : '',
      castLabels.length ? `出场资产：${castLabels.slice(0, 12).join('、')}${extraCast ? ` 等 ${castLabels.length} 个` : ''}` : '',
      changes.length ? `本集形态变更：${changes.slice(0, 6).join('；')}` : '',
      shotLabels.length ? `关键分镜：${shotLabels.join('；')}${extraShots ? `；另 ${extraShots} 个分镜` : ''}` : '',
    ],
    limit,
  )
}

/**
 * 跨集承接：直接读台账，给出「本集开拍时每个资产处于什么形态」+ 缺图补齐建议。
 *
 * 旧版这个函数 220 行，要枚举 appearances、猜 previousVariantBeforeMainReset、
 * 生成 4 类建议（含两类作用域标记）。作用域没了以后，承接就是一次台账查询。
 */
export function buildEpisodeProductionHandoff(
  doc: ProjectDoc,
  episode: Episode,
  options: { maxRecaps?: number; maxAssets?: number } = {},
): EpisodeProductionHandoff {
  const maxRecaps = options.maxRecaps ?? 3
  const maxAssets = options.maxAssets ?? 12
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
  const ledger = buildContinuityLedger(doc)

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

  // 本集第一镜的继承状态就是承接状态；本集还没有分镜时，取本集之前最后一镜的结束状态
  const firstShotOfEpisode = ledger.shots.find((shot) => shot.episodeId === episode.id)
  const lastShotBefore = [...ledger.shots].reverse().find((shot) => shot.episodeIndex < episode.index)
  const state = firstShotOfEpisode?.inherited ?? lastShotBefore?.resulting ?? new Map<string, string | undefined>()

  const carriedState: EpisodeHandoffAssetCue[] = []
  const suggestions: EpisodeHandoffSuggestion[] = []
  const seen = new Set<string>()

  const addSuggestion = (suggestion: EpisodeHandoffSuggestion) => {
    if (seen.has(suggestion.id)) return
    seen.add(suggestion.id)
    suggestions.push(suggestion)
  }

  for (const [assetId, variantId] of state) {
    const asset = assets.get(assetId)
    if (!asset || asset.type === 'audio' || asset.type === 'clip') continue
    if (carriedState.length >= maxAssets) break
    const variant = variantId ? asset.variants?.find((item) => item.id === variantId) : undefined
    const anchorShotId = firstShotOfEpisode?.storyboardId ?? lastShotBefore?.storyboardId
    const origin = anchorShotId ? lastAppearanceChangeBefore(ledger, assetId, anchorShotId) : undefined

    carriedState.push({
      assetId,
      assetName: asset.name,
      assetType: asset.type,
      label: variant ? `${asset.name}-${variant.label}` : asset.name,
      variantId,
      variantLabel: variant?.label,
      refImageId: variant ? variant.refImageId : asset.refImageId,
      sinceEpisodeIndex: origin?.entry.episodeIndex,
      sinceStoryboardIndex: origin?.entry.storyboardIndex,
      reason: origin?.change.reason,
    })

    if (!asset.refImageId) {
      addSuggestion({
        id: `asset-image:${asset.id}`,
        kind: 'generate_asset_ref_image',
        assetId: asset.id,
        label: `生成「${asset.name}」主参考图`,
        detail: '本集会用到该资产，但它还没有主参考图。',
        autoRepairable: true,
      })
    }
    if (variant && !variant.refImageId) {
      addSuggestion({
        id: `variant-image:${asset.id}:${variant.id}`,
        kind: 'generate_variant_ref_image',
        assetId: asset.id,
        variantId: variant.id,
        label: `生成「${asset.name}-${variant.label}」参考图`,
        detail: '本集承接了该形态，但它还没有独立参考图。',
        autoRepairable: true,
        disabledReason: asset.refImageId ? undefined : '先生成主参考图，再派生形态图。',
      })
    }
  }

  // 本集分镜里出现、但不在承接状态里的资产（首次登场）也要补图
  for (const shot of ledger.shots) {
    if (shot.episodeId !== episode.id) continue
    for (const ref of castRefsForStoryboard(shot.storyboard)) {
      const asset = assets.get(ref.assetId)
      if (!asset || asset.type === 'audio' || asset.type === 'clip' || asset.refImageId) continue
      addSuggestion({
        id: `asset-image:${asset.id}`,
        kind: 'generate_asset_ref_image',
        assetId: asset.id,
        label: `生成「${asset.name}」主参考图`,
        detail: `E${episode.index + 1} 分镜 #${shot.storyboardIndex + 1} 引用了该资产，但它还没有主参考图。`,
        autoRepairable: true,
      })
    }
  }

  return { recaps, carriedState, suggestions }
}

/** 分镜实际绑定、但还没有参考图的形态——生产前批量补图用 */
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

/** 把台账推导出的形态回填到 castRefs.variantId（新增/改写分镜后调用，保证缓存与推导一致） */
export function syncCastRefsToLedger(doc: ProjectDoc): number {
  const ledger = buildContinuityLedger(doc)
  let changed = 0
  for (const shot of ledger.shots) {
    const refs = shot.storyboard.castRefs
    if (!refs?.length) continue
    for (const ref of refs) {
      const declared = shot.changes.find((change) => change.assetId === ref.assetId)
      if (declared) continue
      const expected = expectedVariantId(shot, ref.assetId)
      if (ref.variantId !== expected) {
        ref.variantId = expected
        changed += 1
      }
    }
  }
  return changed
}
