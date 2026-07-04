import { loadAsset } from '../../services/assets'
import type { Asset, Storyboard } from '../../domain/types'
import type { VideoProviderConfig, VideoReferenceImage } from '../../services/providers'

export const MAX_VIDEO_REFERENCE_IMAGES = 12

export function supportsVideoReferenceImages(provider?: VideoProviderConfig | null): boolean {
  return provider?.kind === 'custom-http'
}

export async function loadAssetDataUrl(assetId?: string): Promise<string | undefined> {
  if (!assetId) return undefined
  const img = await loadAsset(assetId)
  return img ? `data:${img.mime};base64,${img.base64}` : undefined
}

export async function collectStoryboardVideoReferences(
  storyboards: Storyboard | Storyboard[],
  assets: Asset[],
  primaryImageUrl?: string,
  max = MAX_VIDEO_REFERENCE_IMAGES,
): Promise<VideoReferenceImage[]> {
  const list = Array.isArray(storyboards) ? storyboards : [storyboards]
  const byId = new Map(assets.map((a) => [a.id, a]))
  const seenAssets = new Set<string>()
  const seenRefIds = new Set<string>()
  const seenUrls = new Set<string>(primaryImageUrl ? [primaryImageUrl] : [])
  const refs: VideoReferenceImage[] = []

  for (const sb of list) {
    for (const id of sb.associateAssetIds) {
      if (refs.length >= max) return refs
      const asset = byId.get(id)
      if (!asset || seenAssets.has(asset.id)) continue
      seenAssets.add(asset.id)
      if (!asset.refImageId || asset.type === 'audio' || asset.type === 'clip') continue
      if (seenRefIds.has(asset.refImageId)) continue
      seenRefIds.add(asset.refImageId)
      const img = await loadAsset(asset.refImageId)
      if (!img) continue
      const url = `data:${img.mime};base64,${img.base64}`
      if (seenUrls.has(url)) continue
      seenUrls.add(url)
      refs.push({ url, name: asset.name, type: asset.type, source: 'asset' })
    }
  }

  return refs
}
