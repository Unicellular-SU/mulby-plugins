import { castRefsForStoryboard, labelForCastRef } from '../../domain/castRefs'
import type { Clip, Episode, ProjectDoc, Script, Storyboard } from '../../domain/types'

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

export interface EpisodeHandoffAppearance {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  variants: string[]
  recap?: string
}

export interface EpisodeHandoffAssetCue {
  assetId: string
  label: string
  appearances: EpisodeHandoffAppearance[]
}

export type EpisodeHandoffSuggestionKind = 'generate_asset_ref_image' | 'generate_variant_ref_image' | 'add_variant_episode_scope' | 'create_episode_variant'

export interface EpisodeHandoffSuggestion {
  id: string
  kind: EpisodeHandoffSuggestionKind
  assetId: string
  variantId?: string
  label: string
  detail: string
  autoRepairable?: boolean
  variantLabel?: string
  variantDesc?: string
  variantPrompt?: string
  disabledReason?: string
}

export interface EpisodeProductionHandoff {
  recaps: EpisodeHandoffRecap[]
  sharedAssets: EpisodeHandoffAssetCue[]
  suggestions: EpisodeHandoffSuggestion[]
}

export function hasEpisodeProductionState(episode: Episode | undefined): boolean {
  return !!episode && (!!episode.filmPath || !!episode.filmError || !!episode.producedAt || !!episode.productionRecap || episode.status === 'done')
}

export function invalidateEpisodeProduction(episode: Episode | undefined): boolean {
  if (!hasEpisodeProductionState(episode)) return false
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
  if (episode.filmPath || episode.status === 'done') return 'completed'
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

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
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
  const source = appearance
    ? `承接 E${appearance.episodeIndex + 1}「${appearance.episodeTitle}」的 ${appearance.variants.join('、')}`
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

  const currentRefs = uniqueCastRefs(storyboardsForEpisode(doc, episode))
  const sharedAssets: EpisodeHandoffAssetCue[] = []
  const suggestions: EpisodeHandoffSuggestion[] = []
  const suggested = new Set<string>()
  const addSuggestion = (suggestion: EpisodeHandoffSuggestion) => {
    if (suggested.has(suggestion.id)) return
    suggested.add(suggestion.id)
    suggestions.push(suggestion)
  }
  for (const ref of currentRefs) {
    const asset = assets.get(ref.assetId)
    if (!asset || asset.type === 'audio' || asset.type === 'clip') continue
    if (!asset.refImageId) {
      addSuggestion({
        id: `asset-image:${asset.id}`,
        kind: 'generate_asset_ref_image',
        assetId: asset.id,
        label: `生成「${asset.name}」主参考图`,
        detail: '当前集引用了该资产，但它还没有主参考图。',
        autoRepairable: true,
      })
    }
    if (ref.variantId) {
      const variant = asset.variants?.find((item) => item.id === ref.variantId)
      if (variant) {
        if ((variant.appliesToEpisodeIds?.length ?? 0) > 0 && !variant.appliesToEpisodeIds?.includes(episode.id)) {
          addSuggestion({
            id: `variant-scope:${asset.id}:${variant.id}:${episode.id}`,
            kind: 'add_variant_episode_scope',
            assetId: asset.id,
            variantId: variant.id,
            label: `标记「${variant.label}」适用本集`,
            detail: `当前集使用了 ${asset.name}-${variant.label}，但该形态尚未标记适用于 E${episode.index + 1}。`,
            autoRepairable: true,
          })
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
            disabledReason: asset.refImageId ? undefined : '先生成主参考图，再派生形态图。',
          })
        }
      }
    }
    const appearances = episodes
      .filter((item) => item.id !== episode.id)
      .map((item) => {
        const refs = uniqueCastRefs(storyboardsForEpisode(doc, item)).filter((itemRef) => itemRef.assetId === ref.assetId)
        if (!refs.length) return null
        return {
          episodeId: item.id,
          episodeIndex: item.index,
          episodeTitle: item.title,
          variants: unique(refs.map((itemRef) => labelForCastRef(asset, itemRef))).slice(0, 4),
          recap: item.productionRecap ? compact(item.productionRecap, 180) : undefined,
        }
      })
      .filter((item): item is EpisodeHandoffAppearance => !!item)
      .sort((a, b) => Math.abs(a.episodeIndex - episode.index) - Math.abs(b.episodeIndex - episode.index) || a.episodeIndex - b.episodeIndex)
      .slice(0, maxAppearances)
    if (appearances.length) {
      sharedAssets.push({
        assetId: ref.assetId,
        label: labelForCastRef(asset, ref),
        appearances,
      })
      if (!ref.variantId) {
        const previousAppearance = appearances
          .filter((item) => item.episodeIndex < episode.index)
          .sort((a, b) => b.episodeIndex - a.episodeIndex)[0]
        const seed = episodeVariantSeed(asset.name, episode, previousAppearance ?? appearances[0])
        addSuggestion({
          id: `create-variant:${asset.id}:${episode.id}`,
          kind: 'create_episode_variant',
          assetId: asset.id,
          label: `新建并应用「${asset.name}」本集形态`,
          detail: `该资产在其他集也出现过；如果 E${episode.index + 1} 有新妆容、服装或状态，先建本集专属形态再生成参考图。`,
          autoRepairable: true,
          ...seed,
        })
      }
    }
    if (sharedAssets.length >= maxAssets) break
  }

  return { recaps, sharedAssets, suggestions }
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
