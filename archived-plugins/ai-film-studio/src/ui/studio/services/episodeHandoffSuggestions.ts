import type { ProjectDoc } from '../../domain/types'
import type { EpisodeHandoffSuggestion } from './episodeProduction'

/**
 * 承接建议的执行器。
 *
 * 建议类型从 4 类收敛到 2 类——两类「标记形态适用范围」的建议随作用域声明一起消失了。
 * 剩下的都是纯补图动作，没有任何状态声明。
 */
export interface EpisodeHandoffSuggestionActions {
  getDoc: () => ProjectDoc | null | undefined
  generateAsset: (assetId: string) => Promise<void>
  generateAssetVariant: (assetId: string, variantId: string) => Promise<void>
}

export interface EpisodeHandoffSuggestionApplyResult {
  id: string
  kind: EpisodeHandoffSuggestion['kind']
  applied?: true
  skipped?: true
  reason?: string
  assetId?: string
  variantId?: string
}

function skipped(suggestion: EpisodeHandoffSuggestion, reason: string): EpisodeHandoffSuggestionApplyResult {
  return { id: suggestion.id, kind: suggestion.kind, skipped: true, reason }
}

export async function applyEpisodeHandoffSuggestion(
  suggestion: EpisodeHandoffSuggestion,
  actions: EpisodeHandoffSuggestionActions,
): Promise<EpisodeHandoffSuggestionApplyResult> {
  if (suggestion.autoRepairable === false || suggestion.disabledReason) {
    return skipped(suggestion, suggestion.disabledReason ?? '该建议不可自动处理')
  }
  const doc = actions.getDoc()
  if (!doc) return skipped(suggestion, '无项目')
  const asset = doc.assets.find((item) => item.id === suggestion.assetId)
  if (!asset) return skipped(suggestion, '资产已不存在')

  if (suggestion.kind === 'generate_asset_ref_image') {
    await actions.generateAsset(suggestion.assetId)
    return { id: suggestion.id, kind: suggestion.kind, applied: true, assetId: suggestion.assetId }
  }

  if (suggestion.kind === 'generate_variant_ref_image' && suggestion.variantId) {
    if (!asset.variants?.some((item) => item.id === suggestion.variantId)) return skipped(suggestion, '形态已不存在')
    await actions.generateAssetVariant(suggestion.assetId, suggestion.variantId)
    return { id: suggestion.id, kind: suggestion.kind, applied: true, assetId: suggestion.assetId, variantId: suggestion.variantId }
  }

  return skipped(suggestion, '暂不支持该建议类型')
}
