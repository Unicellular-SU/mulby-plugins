import { loadAsset } from '../../services/assets'
import { castRefsForStoryboard, labelForCastRef, refImageIdForCastRef } from '../../domain/castRefs'
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
  const seenCastRefs = new Set<string>()
  const seenRefIds = new Set<string>()
  const seenUrls = new Set<string>(primaryImageUrl ? [primaryImageUrl] : [])
  const refs: VideoReferenceImage[] = []

  for (const sb of list) {
    for (const castRef of castRefsForStoryboard(sb)) {
      if (refs.length >= max) return refs
      const asset = byId.get(castRef.assetId)
      const castKey = `${castRef.assetId}:${castRef.variantId ?? ''}`
      if (!asset || seenCastRefs.has(castKey)) continue
      seenCastRefs.add(castKey)
      const refImageId = refImageIdForCastRef(asset, castRef)
      if (!refImageId || seenRefIds.has(refImageId)) continue
      seenRefIds.add(refImageId)
      const img = await loadAsset(refImageId)
      if (!img) continue
      const url = `data:${img.mime};base64,${img.base64}`
      if (seenUrls.has(url)) continue
      seenUrls.add(url)
      refs.push({ url, name: labelForCastRef(asset, castRef), type: asset.type, source: 'asset' })
    }
  }

  return refs
}
