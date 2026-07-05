import { castRefsForStoryboard, labelForCastRef } from '../../domain/castRefs'
import type { Clip, Episode, ProjectDoc, Script, Storyboard } from '../../domain/types'

export interface VariantImageRequest {
  assetId: string
  variantId: string
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
  const storyboards = episode ? storyboardsForEpisode(doc, episode) : doc.storyboards
  return storyboards.some((storyboard) =>
    castRefsForStoryboard(storyboard).some((ref) => ref.assetId === assetId && (variantId ? ref.variantId === variantId : !ref.variantId)),
  )
}

export function invalidateCurrentEpisodeProductionIfCastRef(doc: ProjectDoc, assetId: string, variantId?: string): boolean {
  return currentEpisodeUsesCastRef(doc, assetId, variantId) ? invalidateCurrentEpisodeProduction(doc) : false
}

export function pendingEpisodesForSeries(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])]
    .sort((a, b) => a.index - b.index)
    .filter((episode) => !episode.filmPath && storyboardsForEpisode(doc, episode).length > 0)
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

function storyboardLabel(storyboard: Storyboard, assets: Map<string, ProjectDoc['assets'][number]>): string {
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
