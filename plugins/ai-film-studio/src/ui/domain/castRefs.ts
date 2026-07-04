import type { Asset, Storyboard, StoryboardCastRef } from './types'

export function castRefsForStoryboard(storyboard: Pick<Storyboard, 'associateAssetIds' | 'castRefs'>): StoryboardCastRef[] {
  const source = storyboard.castRefs?.length
    ? storyboard.castRefs
    : (storyboard.associateAssetIds ?? []).map((assetId) => ({ assetId }))
  const seen = new Set<string>()
  const refs: StoryboardCastRef[] = []
  for (const ref of source) {
    if (!ref?.assetId) continue
    const key = `${ref.assetId}:${ref.variantId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

export function assetForCastRef(assets: Asset[], ref: StoryboardCastRef): Asset | undefined {
  return assets.find((asset) => asset.id === ref.assetId)
}

export function refImageIdForCastRef(asset: Asset | undefined, ref: StoryboardCastRef): string | undefined {
  if (!asset || asset.type === 'audio' || asset.type === 'clip') return undefined
  if (ref.variantId) {
    const variant = asset.variants?.find((v) => v.id === ref.variantId)
    if (variant?.refImageId) return variant.refImageId
  }
  return asset.refImageId
}

export function labelForCastRef(asset: Asset | undefined, ref: StoryboardCastRef): string {
  if (!asset) return ref.assetId
  if (!ref.variantId) return asset.name
  const variant = asset.variants?.find((v) => v.id === ref.variantId)
  return variant ? `${asset.name}-${variant.label}` : asset.name
}

export function castAssetsForStoryboard(storyboard: Pick<Storyboard, 'associateAssetIds' | 'castRefs'>, assets: Asset[]): Asset[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const seen = new Set<string>()
  const result: Asset[] = []
  for (const ref of castRefsForStoryboard(storyboard)) {
    if (seen.has(ref.assetId)) continue
    const asset = byId.get(ref.assetId)
    if (!asset) continue
    seen.add(ref.assetId)
    result.push(asset)
  }
  return result
}
