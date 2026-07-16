import { castRefsForStoryboard } from '../../domain/castRefs'
import type { AssetVariant, Episode, ProjectDoc } from '../../domain/types'
import { variantScopePatchForUse } from './continuityReport'
import { storyboardsForEpisode, type EpisodeHandoffSuggestion } from './episodeProduction'

export interface EpisodeHandoffSuggestionActions {
  getDoc: () => ProjectDoc | null | undefined
  generateAsset: (assetId: string) => Promise<void>
  generateAssetVariant: (assetId: string, variantId: string) => Promise<void>
  updateAssetVariant: (assetId: string, variantId: string, patch: Partial<AssetVariant>) => void
  addAssetVariant: (assetId: string, init?: { label?: string; desc?: string; prompt?: string }) => string
  setStoryboardCastVariant: (storyboardId: string, assetId: string, variantId: string | undefined) => void
}

export interface EpisodeHandoffSuggestionApplyResult {
  id: string
  kind: EpisodeHandoffSuggestion['kind']
  applied?: true
  skipped?: true
  reason?: string
  assetId?: string
  variantId?: string
  variantKind?: EpisodeHandoffSuggestion['variantKind']
  libraryEntityId?: EpisodeHandoffSuggestion['libraryEntityId']
  libraryEntityVersion?: EpisodeHandoffSuggestion['libraryEntityVersion']
  librarySyncPolicy?: EpisodeHandoffSuggestion['librarySyncPolicy']
  libraryVariantId?: EpisodeHandoffSuggestion['libraryVariantId']
  patch?: Partial<AssetVariant>
}

function suggestionResultLineage(suggestion: EpisodeHandoffSuggestion): Pick<EpisodeHandoffSuggestionApplyResult, 'variantKind' | 'libraryEntityId' | 'libraryEntityVersion' | 'librarySyncPolicy' | 'libraryVariantId'> {
  return {
    variantKind: suggestion.variantKind,
    libraryEntityId: suggestion.libraryEntityId,
    libraryEntityVersion: suggestion.libraryEntityVersion,
    librarySyncPolicy: suggestion.librarySyncPolicy,
    libraryVariantId: suggestion.libraryVariantId,
  }
}

function skipped(suggestion: EpisodeHandoffSuggestion, reason: string): EpisodeHandoffSuggestionApplyResult {
  return { id: suggestion.id, kind: suggestion.kind, skipped: true, reason, ...suggestionResultLineage(suggestion) }
}

function episodeForLatestDoc(doc: ProjectDoc, episode: Episode): Episode {
  return doc.episodes?.find((item) => item.id === episode.id) ?? episode
}

export async function applyEpisodeHandoffSuggestion(
  episode: Episode,
  suggestion: EpisodeHandoffSuggestion,
  actions: EpisodeHandoffSuggestionActions,
): Promise<EpisodeHandoffSuggestionApplyResult> {
  if (suggestion.autoRepairable === false || suggestion.disabledReason) {
    return skipped(suggestion, suggestion.disabledReason ?? '该建议不可自动处理')
  }

  if (suggestion.kind === 'generate_asset_ref_image') {
    await actions.generateAsset(suggestion.assetId)
    return { id: suggestion.id, kind: suggestion.kind, applied: true, assetId: suggestion.assetId, ...suggestionResultLineage(suggestion) }
  }

  if (suggestion.kind === 'generate_variant_ref_image' && suggestion.variantId) {
    await actions.generateAssetVariant(suggestion.assetId, suggestion.variantId)
    return { id: suggestion.id, kind: suggestion.kind, applied: true, assetId: suggestion.assetId, variantId: suggestion.variantId, ...suggestionResultLineage(suggestion) }
  }

  const doc = actions.getDoc()
  if (!doc) return skipped(suggestion, '无项目')

  if (suggestion.kind === 'add_variant_episode_scope' && suggestion.variantId) {
    const asset = doc.assets.find((item) => item.id === suggestion.assetId)
    const variant = asset?.variants?.find((item) => item.id === suggestion.variantId)
    const storyboard = suggestion.storyboardId ? storyboardsForEpisode(doc, episodeForLatestDoc(doc, episode)).find((item) => item.id === suggestion.storyboardId) : undefined
    if (!asset || !variant) return skipped(suggestion, '资产或变体已不存在')
    const patch = variantScopePatchForUse(
      variant,
      { id: episode.id },
      { id: suggestion.storyboardId ?? storyboard?.id ?? '', sceneId: suggestion.sceneId ?? storyboard?.sceneId },
      suggestion.scopeKind ?? 'episode',
    )
    if (!patch) return skipped(suggestion, '无法解析要补充的作用域')
    actions.updateAssetVariant(asset.id, variant.id, patch)
    return { id: suggestion.id, kind: suggestion.kind, applied: true, assetId: asset.id, variantId: variant.id, patch, ...suggestionResultLineage(suggestion) }
  }

  if (suggestion.kind === 'create_episode_variant') {
    const asset = doc.assets.find((item) => item.id === suggestion.assetId)
    if (!asset) return skipped(suggestion, '资产已不存在')
    const latestEpisode = episodeForLatestDoc(doc, episode)
    const variantId = actions.addAssetVariant(asset.id, {
      label: suggestion.variantLabel ?? `E${latestEpisode.index + 1} ${latestEpisode.title}形态`,
      desc: suggestion.variantDesc ?? `适用于 E${latestEpisode.index + 1}「${latestEpisode.title}」的妆容、服装或状态变体。`,
      prompt: suggestion.variantPrompt,
    })
    if (!variantId) return skipped(suggestion, '未能创建变体')
    actions.updateAssetVariant(asset.id, variantId, { appliesToEpisodeIds: [episode.id] })
    for (const storyboard of storyboardsForEpisode(doc, latestEpisode)) {
      if (castRefsForStoryboard(storyboard).some((ref) => ref.assetId === asset.id && !ref.variantId)) {
        actions.setStoryboardCastVariant(storyboard.id, asset.id, variantId)
      }
    }
    return { id: suggestion.id, kind: suggestion.kind, applied: true, assetId: asset.id, variantId, ...suggestionResultLineage(suggestion) }
  }

  return skipped(suggestion, '暂不支持该建议类型')
}
