import type { Asset } from './types'

export function normalizeAssetLookup(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase() : ''
}

export function cleanAssetAliases(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.flatMap((item) => String(item).split(/[，,、;\n]+/)) : typeof value === 'string' ? value.split(/[，,、;\n]+/) : []
  const seen = new Set<string>()
  const aliases: string[] = []
  for (const item of raw) {
    const alias = item.trim()
    const key = normalizeAssetLookup(alias)
    if (!alias || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }
  return aliases
}

export function assetLookupNames(asset: Pick<Asset, 'name' | 'aliases'>): string[] {
  return [asset.name, ...(asset.aliases ?? [])].filter((item) => item.trim())
}

export function assetMatchesToken(asset: Pick<Asset, 'id' | 'name' | 'aliases'>, token: unknown): boolean {
  if (typeof token !== 'string' || !token.trim()) return false
  if (asset.id === token.trim()) return true
  const key = normalizeAssetLookup(token)
  return assetLookupNames(asset).some((name) => normalizeAssetLookup(name) === key)
}

export function findAssetByNameOrAlias<T extends Pick<Asset, 'id' | 'name' | 'aliases'>>(assets: T[], token: unknown): T | undefined {
  return assets.find((asset) => assetMatchesToken(asset, token))
}

export function assetPrefixLookup(asset: Pick<Asset, 'name' | 'aliases'>, text: string): string | undefined {
  const lower = text.toLocaleLowerCase()
  return assetLookupNames(asset)
    .sort((a, b) => b.length - a.length)
    .find((name) => lower.startsWith(name.toLocaleLowerCase()))
}
