import { castRefsForStoryboard } from '../../domain/castRefs'
import type { Episode, ProjectDoc } from '../../domain/types'

export interface VariantImageRequest {
  assetId: string
  variantId: string
}

export function invalidateEpisodeProduction(episode: Episode | undefined): boolean {
  if (!episode || (!episode.filmPath && !episode.filmError && !episode.producedAt && episode.status !== 'done')) return false
  delete episode.filmPath
  delete episode.filmError
  delete episode.producedAt
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

export function pendingEpisodesForSeries(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])]
    .sort((a, b) => a.index - b.index)
    .filter((episode) => !episode.filmPath && storyboardsForEpisode(doc, episode).length > 0)
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
