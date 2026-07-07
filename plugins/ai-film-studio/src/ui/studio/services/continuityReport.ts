import { castRefsForStoryboard, labelForCastRef, refImageIdForCastRef } from '../../domain/castRefs'
import { normalizeAssetLookup } from '../../domain/assetAliases'
import type { Asset, Episode, ProjectDoc, Storyboard } from '../../domain/types'
import type { LibraryEntity } from '../../services/assetHub'

type VariantKind = NonNullable<Asset['variants']>[number]['variantKind']

export interface ContinuityIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  episodeId?: string
  storyboardId?: string
  storyboardIndex?: number
  sceneId?: string
  assetId?: string
  variantId?: string
  variantKind?: VariantKind
  candidateVariantIds?: string[]
  candidateVariantLabels?: string[]
  candidateVariantKinds?: VariantKind[]
  candidateLibraryEntityIds?: string[]
  candidateLibraryEntityLabels?: string[]
  previousEpisodeId?: string
  previousEpisodeIndex?: number
  previousEpisodeTitle?: string
  previousVariantId?: string
  previousVariantLabel?: string
  previousVariantKind?: VariantKind
  conflictLabel?: string
  conflictSource?: 'name' | 'alias'
  relatedAssetIds?: string[]
  libraryEntityId?: string
  entityVersion?: number
  currentEntityVersion?: number
  scopeKind?: 'episode' | 'scene' | 'storyboard'
}

export interface ContinuityReportOptions {
  libraryEntities?: readonly LibraryEntity[]
}

export interface ContinuityCastUse {
  storyboardId: string
  storyboardIndex: number
  assetId: string
  assetName: string
  assetType: Asset['type']
  variantId?: string
  variantLabel?: string
  variantKind?: VariantKind
  label: string
  refImageId?: string
  appliesToEpisode: boolean
}

export interface ContinuityEpisodeReport {
  id: string
  index: number
  title: string
  current: boolean
  storyboards: number
  castUses: ContinuityCastUse[]
  issues: ContinuityIssue[]
}

export interface ContinuityReport {
  currentEpisodeId?: string
  episodes: ContinuityEpisodeReport[]
  issues: ContinuityIssue[]
}

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function episodeStoryboards(doc: ProjectDoc, episode: Episode): Storyboard[] {
  return episode.id === doc.currentEpisodeId ? doc.storyboards : episode.storyboards
}

function episodeList(doc: ProjectDoc): Episode[] {
  const episodes = sortedEpisodes(doc)
  if (episodes.length) return episodes
  return [
    {
      id: doc.currentEpisodeId ?? 'current',
      index: 0,
      title: '当前集',
      scripts: doc.scripts,
      storyboards: doc.storyboards,
      storyboardTable: doc.storyboardTable,
      clips: doc.clips,
      track: doc.track,
      createdAt: doc.meta.createdAt,
      updatedAt: doc.meta.updatedAt,
    },
  ]
}

export function variantScopeIssue(variant: NonNullable<Asset['variants']>[number] | undefined, episode: Episode, storyboard: Storyboard): ContinuityIssue['scopeKind'] | undefined {
  if (!variant) return undefined
  const episodeIds = variant.appliesToEpisodeIds ?? []
  if (episodeIds.length && !episodeIds.includes(episode.id)) return 'episode'
  const sceneIds = variant.appliesToSceneIds ?? []
  if (sceneIds.length && (!storyboard.sceneId || !sceneIds.includes(storyboard.sceneId))) return 'scene'
  const storyboardIds = variant.appliesToStoryboardIds ?? []
  if (storyboardIds.length && !storyboardIds.includes(storyboard.id)) return 'storyboard'
  return undefined
}

function variantHasScope(variant: NonNullable<Asset['variants']>[number] | undefined): boolean {
  return !!variant && (!!variant.appliesToEpisodeIds?.length || !!variant.appliesToSceneIds?.length || !!variant.appliesToStoryboardIds?.length)
}

function withScopeId(ids: string[] | undefined, id: string): string[] {
  return [...new Set([...(ids ?? []), id].filter(Boolean))]
}

export function variantScopePatchForUse(
  variant: NonNullable<Asset['variants']>[number],
  episode: Pick<Episode, 'id'>,
  storyboard: Pick<Storyboard, 'id' | 'sceneId'>,
  preferredScope?: ContinuityIssue['scopeKind'],
): Partial<NonNullable<Asset['variants']>[number]> | undefined {
  const scope =
    preferredScope ??
    ((variant.appliesToStoryboardIds?.length ?? 0) > 0
      ? 'storyboard'
      : (variant.appliesToSceneIds?.length ?? 0) > 0
        ? 'scene'
        : (variant.appliesToEpisodeIds?.length ?? 0) > 0
          ? 'episode'
          : undefined)
  if (!scope) return undefined
  if (scope === 'storyboard') return { appliesToStoryboardIds: withScopeId(variant.appliesToStoryboardIds, storyboard.id) }
  if (scope === 'scene') {
    if (storyboard.sceneId) return { appliesToSceneIds: withScopeId(variant.appliesToSceneIds, storyboard.sceneId) }
    return { appliesToStoryboardIds: withScopeId(variant.appliesToStoryboardIds, storyboard.id) }
  }
  return { appliesToEpisodeIds: withScopeId(variant.appliesToEpisodeIds, episode.id) }
}

function variantsScopedToStoryboard(asset: Asset, episode: Episode, storyboard: Storyboard): NonNullable<Asset['variants']> {
  return (asset.variants ?? []).filter((variant) => {
    return variantHasScope(variant) && !variantScopeIssue(variant, episode, storyboard)
  })
}

const ASSET_TYPE_LABEL: Record<Asset['type'], string> = {
  role: '角色',
  scene: '场景',
  prop: '道具',
  audio: '音色',
  clip: '素材片段',
}

function addDuplicateAssetNameIssues(doc: ProjectDoc, allIssues: ContinuityIssue[]): void {
  const checkedTypes: Asset['type'][] = ['role', 'scene', 'prop']
  const groups = new Map<string, Asset[]>()
  for (const asset of doc.assets) {
    if (!checkedTypes.includes(asset.type)) continue
    const name = normalizeAssetLookup(asset.name)
    if (!name) continue
    const key = `${asset.type}:${name}`
    groups.set(key, [...(groups.get(key) ?? []), asset])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const typeLabel = ASSET_TYPE_LABEL[group[0].type]
    const ids = group.map((asset) => asset.id).join('、')
    for (const asset of group) {
      allIssues.push({
        severity: 'warning',
        code: 'duplicate_asset_name',
        assetId: asset.id,
        message: `项目中存在多个同名${typeLabel}资产「${asset.name}」（${ids}），多集生成前建议合并或改名，避免同一角色/场景被当成不同资产。`,
      })
    }
  }
}

interface AssetLookupEntry {
  asset: Asset
  label: string
  source: 'name' | 'alias'
}

interface EntityLookupEntry {
  entity: LibraryEntity
  label: string
  source: 'name' | 'alias'
}

interface LastAppearanceUse {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  variantId?: string
  variantLabel?: string
  variantKind?: VariantKind
}

function addDuplicateAssetAliasIssues(doc: ProjectDoc, allIssues: ContinuityIssue[]): void {
  const checkedTypes: Asset['type'][] = ['role', 'scene', 'prop']
  const groups = new Map<string, AssetLookupEntry[]>()
  for (const asset of doc.assets) {
    if (!checkedTypes.includes(asset.type)) continue
    const entries: AssetLookupEntry[] = [
      { asset, label: asset.name, source: 'name' },
      ...(asset.aliases ?? []).map((alias): AssetLookupEntry => ({ asset, label: alias, source: 'alias' })),
    ]
    const seenForAsset = new Set<string>()
    for (const entry of entries) {
      const lookup = normalizeAssetLookup(entry.label)
      if (!lookup || seenForAsset.has(lookup)) continue
      seenForAsset.add(lookup)
      const key = `${asset.type}:${lookup}`
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }
  }
  for (const [key, entries] of groups.entries()) {
    const assetIds = new Set(entries.map((entry) => entry.asset.id))
    if (assetIds.size < 2 || !entries.some((entry) => entry.source === 'alias')) continue
    const lookup = key.slice(key.indexOf(':') + 1)
    const assets = [...assetIds].map((id) => entries.find((entry) => entry.asset.id === id)?.asset).filter((asset): asset is Asset => !!asset)
    const typeLabel = ASSET_TYPE_LABEL[assets[0].type]
    const labels = [...new Set(entries.map((entry) => entry.label.trim()).filter(Boolean))]
    const sharedLabel = labels.length === 1 ? labels[0] : labels.join(' / ')
    const ids = assets.map((asset) => asset.id).join('、')
    for (const asset of assets) {
      const currentEntry =
        entries.find((entry) => entry.asset.id === asset.id && entry.source === 'alias' && normalizeAssetLookup(entry.label) === lookup) ??
        entries.find((entry) => entry.asset.id === asset.id && normalizeAssetLookup(entry.label) === lookup)
      allIssues.push({
        severity: 'warning',
        code: 'duplicate_asset_alias',
        assetId: asset.id,
        conflictLabel: currentEntry?.label.trim() || sharedLabel,
        conflictSource: currentEntry?.source,
        relatedAssetIds: assets.map((item) => item.id).filter((id) => id !== asset.id),
        message: `项目中多个${typeLabel}资产共享名称/别名「${sharedLabel}」（${ids}），多集生成前建议合并资产或调整别名，避免 Agent 把同一称呼解析到不同资产。`,
      })
    }
  }
}

function sceneAssetIdsForStoryboard(storyboard: Storyboard, assets: Map<string, Asset>): string[] {
  const ids = new Set<string>()
  for (const ref of castRefsForStoryboard(storyboard)) {
    const asset = assets.get(ref.assetId)
    if (asset?.type === 'scene') ids.add(asset.id)
  }
  return [...ids]
}

function roleVariantLabel(asset: Asset, variantId: string | undefined): string {
  if (!variantId) return '主形象'
  return asset.variants?.find((variant) => variant.id === variantId)?.label ?? variantId
}

function addSceneRoleVariantIssues(
  episode: Episode,
  sceneId: string,
  group: Storyboard[],
  assets: Map<string, Asset>,
  addIssue: (issue: ContinuityIssue) => void,
): void {
  const roleVariantUses = new Map<string, { storyboard: Storyboard; variantId?: string; label: string }[]>()
  for (const storyboard of group) {
    for (const ref of castRefsForStoryboard(storyboard)) {
      const asset = assets.get(ref.assetId)
      if (asset?.type !== 'role') continue
      const uses = roleVariantUses.get(asset.id) ?? []
      uses.push({ storyboard, variantId: ref.variantId, label: roleVariantLabel(asset, ref.variantId) })
      roleVariantUses.set(asset.id, uses)
    }
  }
  for (const [assetId, uses] of roleVariantUses) {
    const labels = [...new Set(uses.map((use) => use.label).filter(Boolean))]
    if (labels.length < 2) continue
    const asset = assets.get(assetId)
    const seenStoryboards = new Set<string>()
    for (const use of uses) {
      if (seenStoryboards.has(use.storyboard.id)) continue
      seenStoryboards.add(use.storyboard.id)
      addIssue({
        severity: 'warning',
        code: 'scene_group_variant_mismatch',
        episodeId: episode.id,
        storyboardId: use.storyboard.id,
        storyboardIndex: use.storyboard.index + 1,
        sceneId,
        assetId,
        variantId: use.variantId,
        message: `E${episode.index + 1} 场景组「${sceneId}」中「${asset?.name ?? assetId}」混用了 ${labels.join('、')}。连续场景建议统一绑定同一角色形态，除非镜头内明确发生换装或状态变化。`,
      })
    }
  }
}

function addSceneReuseIssues(
  episode: Episode,
  storyboards: Storyboard[],
  assets: Map<string, Asset>,
  addIssue: (issue: ContinuityIssue) => void,
): void {
  const groups = new Map<string, Storyboard[]>()
  for (const storyboard of storyboards) {
    const sceneId = storyboard.sceneId?.trim()
    if (!sceneId) continue
    groups.set(sceneId, [...(groups.get(sceneId) ?? []), storyboard])
  }
  for (const [sceneId, group] of groups) {
    if (group.length < 2) continue
    addSceneRoleVariantIssues(episode, sceneId, group, assets, addIssue)
    const sceneRefsByStoryboard = new Map(group.map((storyboard) => [storyboard.id, sceneAssetIdsForStoryboard(storyboard, assets)]))
    const sceneAssetIds = [...new Set([...sceneRefsByStoryboard.values()].flat())]
    if (!sceneAssetIds.length) continue
    const sceneLabels = sceneAssetIds.map((id) => assets.get(id)?.name ?? id).join('、')
    if (sceneAssetIds.length > 1) {
      for (const storyboard of group) {
        const refs = sceneRefsByStoryboard.get(storyboard.id) ?? []
        addIssue({
          severity: 'warning',
          code: 'scene_group_asset_mismatch',
          episodeId: episode.id,
          storyboardId: storyboard.id,
          storyboardIndex: storyboard.index + 1,
          sceneId,
          assetId: refs[0],
          message: `E${episode.index + 1} 场景组「${sceneId}」混用了多个场景资产：${sceneLabels}。连续场景建议统一复用同一个场景资产，避免跨镜环境漂移。`,
        })
      }
      continue
    }
    const sceneAssetId = sceneAssetIds[0]
    const sceneLabel = assets.get(sceneAssetId)?.name ?? sceneAssetId
    for (const storyboard of group) {
      const refs = sceneRefsByStoryboard.get(storyboard.id) ?? []
      if (refs.length) continue
      addIssue({
        severity: 'warning',
        code: 'scene_group_missing_asset',
        episodeId: episode.id,
        storyboardId: storyboard.id,
        storyboardIndex: storyboard.index + 1,
        sceneId,
        assetId: sceneAssetId,
        message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 属于场景组「${sceneId}」，但没有引用场景资产「${sceneLabel}」。建议绑定同一场景资产以保持连续场景复用。`,
      })
    }
  }
}

function isPlanCastAsset(asset: Asset): boolean {
  return !asset.parentAssetId && (asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop')
}

function findVariantOwner(assets: Map<string, Asset>, variantId: string): { asset: Asset; variant: NonNullable<Asset['variants']>[number] } | undefined {
  for (const asset of assets.values()) {
    const variant = asset.variants?.find((item) => item.id === variantId)
    if (variant) return { asset, variant }
  }
  return undefined
}

function addEpisodePlanIssues(
  episode: Episode,
  storyboards: Storyboard[],
  assets: Map<string, Asset>,
  castUses: ContinuityCastUse[],
  addIssue: (issue: ContinuityIssue) => void,
): void {
  const plan = episode.plan
  const requiredAssetIds = [...new Set(plan?.requiredAssetIds ?? [])]
  const requiredVariantIds = [...new Set(plan?.requiredVariantIds ?? [])]
  if (!requiredAssetIds.length && !requiredVariantIds.length) return

  const hasStoryboards = storyboards.length > 0
  const usedAssetIds = new Set(castUses.map((use) => use.assetId))
  const validVariantUses = new Set(castUses.filter((use) => use.variantId && use.appliesToEpisode).map((use) => `${use.assetId}:${use.variantId}`))

  for (const assetId of requiredAssetIds) {
    const asset = assets.get(assetId)
    if (!asset || !isPlanCastAsset(asset)) {
      addIssue({
        severity: 'warning',
        code: 'episode_plan_invalid_asset',
        episodeId: episode.id,
        assetId,
        message: `E${episode.index + 1}「${episode.title}」计划要求的项目资产 ${assetId} 已不存在或不是可用于分镜的角色/场景/道具。`,
      })
      continue
    }
    if (hasStoryboards && !usedAssetIds.has(asset.id)) {
      addIssue({
        severity: 'warning',
        code: 'episode_plan_missing_asset',
        episodeId: episode.id,
        assetId: asset.id,
        message: `E${episode.index + 1}「${episode.title}」计划要求项目资产「${asset.name}」，但本集分镜尚未引用。`,
      })
    }
  }

  for (const variantId of requiredVariantIds) {
    const owner = findVariantOwner(assets, variantId)
    if (!owner || !isPlanCastAsset(owner.asset)) {
      addIssue({
        severity: 'warning',
        code: 'episode_plan_invalid_variant',
        episodeId: episode.id,
        variantId,
        message: `E${episode.index + 1}「${episode.title}」计划要求的形态/妆容 ${variantId} 已不存在或不属于可用于分镜的项目资产。`,
      })
      continue
    }
    if (!requiredAssetIds.includes(owner.asset.id)) {
      addIssue({
        severity: 'warning',
        code: 'episode_plan_variant_asset_missing',
        episodeId: episode.id,
        assetId: owner.asset.id,
        variantId: owner.variant.id,
        message: `E${episode.index + 1}「${episode.title}」计划要求形态「${owner.asset.name}-${owner.variant.label}」，但未把父项目资产「${owner.asset.name}」列入本集必需资产。建议补入 requiredAssetIds，保证系列资产矩阵能按资产和形态两层追踪。`,
      })
    }
    const scopedEpisodeIds = owner.variant.appliesToEpisodeIds ?? []
    const variantScopeExcludesEpisode = scopedEpisodeIds.length > 0 && !scopedEpisodeIds.includes(episode.id)
    if (variantScopeExcludesEpisode) {
      addIssue({
        severity: 'warning',
        code: 'episode_plan_variant_scope_mismatch',
        episodeId: episode.id,
        assetId: owner.asset.id,
        variantId: owner.variant.id,
        scopeKind: 'episode',
        message: `E${episode.index + 1}「${episode.title}」计划要求形态「${owner.asset.name}-${owner.variant.label}」，但该形态只标记适用于其他剧集（${scopedEpisodeIds.join('、')}）。生成本集前请把本集加入该形态适用范围，或从本集计划移除该形态。`,
      })
    }
    if (hasStoryboards && !variantScopeExcludesEpisode && !validVariantUses.has(`${owner.asset.id}:${owner.variant.id}`)) {
      addIssue({
        severity: 'warning',
        code: 'episode_plan_missing_variant',
        episodeId: episode.id,
        assetId: owner.asset.id,
        variantId: owner.variant.id,
        candidateVariantIds: owner.asset.variants?.map((item) => item.id),
        candidateVariantLabels: owner.asset.variants?.map((item) => item.label),
        message: `E${episode.index + 1}「${episode.title}」计划要求形态「${owner.asset.name}-${owner.variant.label}」，但本集分镜尚未有效绑定该变体。`,
      })
    }
  }
}

function addUnusedProjectAssetIssues(doc: ProjectDoc, episodes: Episode[], allIssues: ContinuityIssue[]): void {
  const checkedTypes: Asset['type'][] = ['role', 'scene', 'prop']
  const usedAssetIds = new Set<string>()
  let storyboardCount = 0
  for (const episode of episodes) {
    const storyboards = episodeStoryboards(doc, episode)
    storyboardCount += storyboards.length
    for (const storyboard of storyboards) {
      for (const ref of castRefsForStoryboard(storyboard)) {
        if (ref.assetId) usedAssetIds.add(ref.assetId)
      }
    }
  }
  if (!storyboardCount) return
  for (const asset of doc.assets) {
    if (asset.parentAssetId || !checkedTypes.includes(asset.type) || usedAssetIds.has(asset.id)) continue
    const typeLabel = ASSET_TYPE_LABEL[asset.type]
    allIssues.push({
      severity: 'warning',
      code: 'unused_project_asset',
      assetId: asset.id,
      message: `项目级${typeLabel}资产「${asset.name}」还没有被任何分镜引用。若它属于后续剧集，建议在对应分镜中复用；否则可合并、改名或移出当前资产池，避免资产池膨胀影响 Agent 选择。`,
    })
  }
}

function addSeriesPlanIssues(doc: ProjectDoc, episodes: Episode[], allIssues: ContinuityIssue[]): void {
  const plannedEpisodeCount = doc.seriesBible?.plannedEpisodeCount
  if (!Number.isFinite(plannedEpisodeCount) || !plannedEpisodeCount || plannedEpisodeCount <= episodes.length) return
  const missingCount = plannedEpisodeCount - episodes.length
  allIssues.push({
    severity: 'warning',
    code: 'series_planned_episodes_missing',
    message: `系列圣经计划 ${plannedEpisodeCount} 集，但当前只创建了 ${episodes.length} 集，还缺 ${missingCount} 集。建议补齐剧集后再进行整季生产。`,
  })
}

function addCrossEpisodeDuplicateAssetIssues(doc: ProjectDoc, episodeReports: ContinuityEpisodeReport[], allIssues: ContinuityIssue[]): void {
  const checkedTypes: Asset['type'][] = ['role', 'scene', 'prop']
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const episodeUsesByAsset = new Map<string, Set<string>>()
  const episodeLabelsByAsset = new Map<string, Set<string>>()
  for (const report of episodeReports) {
    for (const use of report.castUses) {
      const asset = assets.get(use.assetId)
      if (!asset || asset.parentAssetId || !checkedTypes.includes(asset.type)) continue
      const episodes = episodeUsesByAsset.get(asset.id) ?? new Set<string>()
      episodes.add(report.id)
      episodeUsesByAsset.set(asset.id, episodes)
      const labels = episodeLabelsByAsset.get(asset.id) ?? new Set<string>()
      labels.add(`E${report.index}「${report.title}」`)
      episodeLabelsByAsset.set(asset.id, labels)
    }
  }
  const groups = new Map<string, AssetLookupEntry[]>()
  for (const asset of doc.assets) {
    if (asset.parentAssetId || !checkedTypes.includes(asset.type) || !episodeUsesByAsset.has(asset.id)) continue
    const entries: AssetLookupEntry[] = [
      { asset, label: asset.name, source: 'name' },
      ...(asset.aliases ?? []).map((alias): AssetLookupEntry => ({ asset, label: alias, source: 'alias' })),
    ]
    const seenForAsset = new Set<string>()
    for (const entry of entries) {
      const lookup = normalizeAssetLookup(entry.label)
      if (!lookup || seenForAsset.has(lookup)) continue
      seenForAsset.add(lookup)
      const key = `${asset.type}:${lookup}`
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }
  }
  const emitted = new Set<string>()
  for (const [key, entries] of groups) {
    const assetIds = [...new Set(entries.map((entry) => entry.asset.id))]
    if (assetIds.length < 2) continue
    const assetsInGroup = assetIds.map((id) => assets.get(id)).filter((asset): asset is Asset => !!asset)
    const linkedValues = assetsInGroup.map(linkedLibraryEntityId)
    if (linkedValues.every(Boolean) && new Set(linkedValues).size === 1) continue
    const lookup = key.slice(key.indexOf(':') + 1)
    const labels = [...new Set(entries.map((entry) => entry.label.trim()).filter(Boolean))]
    const sharedLabel = labels.length === 1 ? labels[0] : labels.join(' / ')
    for (const asset of assetsInGroup) {
      const assetEpisodes = episodeUsesByAsset.get(asset.id) ?? new Set<string>()
      const related = assetsInGroup.filter((candidate) => {
        if (candidate.id === asset.id) return false
        const candidateEpisodes = episodeUsesByAsset.get(candidate.id) ?? new Set<string>()
        return [...assetEpisodes].some((episodeId) => !candidateEpisodes.has(episodeId)) || [...candidateEpisodes].some((episodeId) => !assetEpisodes.has(episodeId))
      })
      if (!related.length) continue
      const emitKey = `${asset.id}:${lookup}`
      if (emitted.has(emitKey)) continue
      emitted.add(emitKey)
      const typeLabel = ASSET_TYPE_LABEL[asset.type]
      const currentEntry =
        entries.find((entry) => entry.asset.id === asset.id && entry.source === 'alias' && normalizeAssetLookup(entry.label) === lookup) ??
        entries.find((entry) => entry.asset.id === asset.id && normalizeAssetLookup(entry.label) === lookup)
      const appearanceLabels = [...(episodeLabelsByAsset.get(asset.id) ?? [])].join('、')
      const relatedLabels = related.map((item) => `${item.name}（${[...(episodeLabelsByAsset.get(item.id) ?? [])].join('、') || item.id}）`).join('、')
      allIssues.push({
        severity: 'warning',
        code: 'cross_episode_duplicate_project_asset_candidate',
        assetId: asset.id,
        conflictLabel: currentEntry?.label.trim() || sharedLabel,
        conflictSource: currentEntry?.source,
        relatedAssetIds: related.map((item) => item.id),
        message: `项目${typeLabel}资产「${asset.name}」在 ${appearanceLabels} 出现，且名称/别名「${sharedLabel}」与其他跨集项目资产重叠：${relatedLabels}。如果它们是同一对象，建议合并到同一个项目资产；如果不是，请调整名称或别名以降低 Agent 误选风险。`,
      })
    }
  }
}

function linkedLibraryEntityId(asset: Asset): string | undefined {
  if (asset.libraryLink?.syncPolicy === 'forked') return undefined
  return asset.libraryLink?.entityId || asset.elementId
}

function entityKindForAsset(asset: Asset): LibraryEntity['kind'] | undefined {
  if (asset.type === 'role') return 'character'
  if (asset.type === 'scene') return 'scene'
  if (asset.type === 'prop') return 'prop'
  return undefined
}

function entityLookupEntries(entity: LibraryEntity): EntityLookupEntry[] {
  return [
    { entity, label: entity.name, source: 'name' },
    ...(entity.aliases ?? []).map((alias): EntityLookupEntry => ({ entity, label: alias, source: 'alias' })),
  ]
}

function assetLookupEntries(asset: Asset): Array<{ label: string; source: 'name' | 'alias' }> {
  return [
    { label: asset.name, source: 'name' },
    ...(asset.aliases ?? []).map((alias) => ({ label: alias, source: 'alias' }) as const),
  ]
}

function entityDisplayName(entry: EntityLookupEntry): string {
  return entry.source === 'alias' ? `${entry.entity.name}（别名：${entry.label}）` : entry.entity.name
}

function addAssetHubIssues(doc: ProjectDoc, options: ContinuityReportOptions | undefined, allIssues: ContinuityIssue[]): void {
  const checkedTypes: Asset['type'][] = ['role', 'scene', 'prop']
  const entitiesProvided = !!options?.libraryEntities
  const entities = new Map((options?.libraryEntities ?? []).map((entity) => [entity.id, entity]))
  const linkedAssetsByEntity = new Map<string, Asset[]>()
  const entityLookup = new Map<string, EntityLookupEntry[]>()
  for (const entity of options?.libraryEntities ?? []) {
    if (entity.archived) continue
    for (const entry of entityLookupEntries(entity)) {
      const lookup = normalizeAssetLookup(entry.label)
      if (!lookup) continue
      const key = `${entity.kind}:${lookup}`
      entityLookup.set(key, [...(entityLookup.get(key) ?? []), entry])
    }
  }

  for (const asset of doc.assets) {
    if (asset.parentAssetId || !checkedTypes.includes(asset.type)) continue
    const entityId = linkedLibraryEntityId(asset)
    if (!entityId) continue
    linkedAssetsByEntity.set(entityId, [...(linkedAssetsByEntity.get(entityId) ?? []), asset])

    if (!entitiesProvided) continue
    const entity = entities.get(entityId)
    if (!entity) {
      allIssues.push({
        severity: 'warning',
        code: 'library_entity_missing',
        assetId: asset.id,
        libraryEntityId: entityId,
        entityVersion: asset.libraryLink?.entityVersion,
        message: `项目资产「${asset.name}」链接的身份资产 ${entityId} 已不存在。生产仍会使用项目快照，但建议确认是否另存为新身份或重新关联资产中心。`,
      })
      continue
    }
    if (entity.archived) {
      allIssues.push({
        severity: 'warning',
        code: 'library_entity_archived',
        assetId: asset.id,
        libraryEntityId: entity.id,
        entityVersion: asset.libraryLink?.entityVersion,
        currentEntityVersion: entity.version,
        message: `项目资产「${asset.name}」链接的身份资产「${entity.name}」已归档。生产仍会使用项目快照，但多集继续制作前建议确认是否保留、解除关联或改用新的身份资产。`,
      })
      continue
    }
    const linkedVersion = asset.libraryLink?.entityVersion
    if (typeof linkedVersion === 'number' && entity.version > linkedVersion) {
      allIssues.push({
        severity: 'warning',
        code: 'library_entity_version_outdated',
        assetId: asset.id,
        libraryEntityId: entity.id,
        entityVersion: linkedVersion,
        currentEntityVersion: entity.version,
        message: `项目资产「${asset.name}」来自身份资产「${entity.name}」v${linkedVersion}，资产中心已有 v${entity.version}。建议确认继续使用项目快照，或手动同步新版身份资产。`,
      })
    }
  }

  if (entitiesProvided) {
    for (const asset of doc.assets) {
      if (asset.parentAssetId || !checkedTypes.includes(asset.type)) continue
      const kind = entityKindForAsset(asset)
      if (!kind) continue
      const linkedEntityId = linkedLibraryEntityId(asset)
      const rejectedEntityIds = new Set(asset.rejectedLibraryEntityIds ?? [])
      const matches = new Map<string, EntityLookupEntry>()
      let conflictLabel = ''
      let conflictSource: ContinuityIssue['conflictSource'] | undefined
      for (const entry of assetLookupEntries(asset)) {
        const lookup = normalizeAssetLookup(entry.label)
        if (!lookup) continue
        const candidates = entityLookup.get(`${kind}:${lookup}`) ?? []
        for (const candidate of candidates) {
          if (candidate.entity.id === linkedEntityId) continue
          if (rejectedEntityIds.has(candidate.entity.id)) continue
          if (!matches.has(candidate.entity.id)) matches.set(candidate.entity.id, candidate)
          if (!conflictLabel) {
            conflictLabel = entry.label.trim() || candidate.label
            conflictSource = entry.source
          }
        }
      }
      if (!matches.size) continue
      const candidateEntries = [...matches.values()]
      const candidateIds = candidateEntries.map((entry) => entry.entity.id)
      const candidateLabels = candidateEntries.map(entityDisplayName)
      if (linkedEntityId) {
        allIssues.push({
          severity: 'warning',
          code: 'library_entity_alias_conflict',
          assetId: asset.id,
          libraryEntityId: linkedEntityId,
          candidateLibraryEntityIds: candidateIds,
          candidateLibraryEntityLabels: candidateLabels,
          conflictLabel,
          conflictSource,
          message: `项目资产「${asset.name}」已关联身份资产 ${linkedEntityId}，但名称/别名「${conflictLabel}」也命中了资产中心的其他身份：${candidateLabels.join('、')}。建议确认是否关联错身份，或调整别名避免 Agent 选错对象。`,
        })
      } else {
        allIssues.push({
          severity: 'warning',
          code: 'asset_matches_unlinked_library_entity',
          assetId: asset.id,
          candidateLibraryEntityIds: candidateIds,
          candidateLibraryEntityLabels: candidateLabels,
          conflictLabel,
          conflictSource,
          message: `项目资产「${asset.name}」尚未关联身份资产，但名称/别名「${conflictLabel}」命中了资产中心身份：${candidateLabels.join('、')}。若这是同一对象，建议改为从资产中心快照导入或手动关联；否则请改名或标记为不同身份。`,
        })
      }
    }
  }

  for (const [entityId, linkedAssets] of linkedAssetsByEntity.entries()) {
    if (linkedAssets.length < 2) continue
    const entityName = entities.get(entityId)?.name
    const label = entityName ? `「${entityName}」` : entityId
    const ids = linkedAssets.map((asset) => asset.id).join('、')
    for (const asset of linkedAssets) {
      allIssues.push({
        severity: 'warning',
        code: 'duplicate_library_entity_project_assets',
        assetId: asset.id,
        libraryEntityId: entityId,
        relatedAssetIds: linkedAssets.map((item) => item.id).filter((id) => id !== asset.id),
        message: `同一个身份资产${label}被导入成多个项目资产（${ids}）。多集生产前建议合并到同一个项目资产，避免同一角色/场景被 Agent 当成不同对象。`,
      })
    }
  }
}

export function buildContinuityReport(doc: ProjectDoc, options?: ContinuityReportOptions): ContinuityReport {
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const episodes = episodeList(doc)
  const episodeReports: ContinuityEpisodeReport[] = []
  const allIssues: ContinuityIssue[] = []
  const chapterIds = new Set(doc.novel.map((chapter) => chapter.id))
  const assignedChapterIds = new Set<string>()
  const chapterEpisodeRefs = new Map<string, { id: string; index: number; title: string; report: ContinuityEpisodeReport }[]>()
  const lastAppearanceUseByAsset = new Map<string, LastAppearanceUse>()
  const stateRegressionWarnings = new Set<string>()
  addDuplicateAssetNameIssues(doc, allIssues)
  addDuplicateAssetAliasIssues(doc, allIssues)
  addSeriesPlanIssues(doc, episodes, allIssues)
  addUnusedProjectAssetIssues(doc, episodes, allIssues)
  addAssetHubIssues(doc, options, allIssues)

  for (const episode of episodes) {
    const storyboards = episodeStoryboards(doc, episode)
    const report: ContinuityEpisodeReport = {
      id: episode.id,
      index: episode.index + 1,
      title: episode.title,
      current: episode.id === doc.currentEpisodeId,
      storyboards: storyboards.length,
      castUses: [],
      issues: [],
    }
    const addIssue = (issue: ContinuityIssue) => {
      report.issues.push(issue)
      allIssues.push(issue)
    }

    if (doc.novel.length > 0 && episodes.length > 1) {
      const assigned = episode.novelChapterIds ?? []
      if (!assigned.length) {
        addIssue({ severity: 'warning', code: 'episode_without_chapters', episodeId: episode.id, message: `E${episode.index + 1}「${episode.title}」还没有分配原著章节` })
      }
      for (const chapterId of assigned) {
        if (chapterIds.has(chapterId)) {
          assignedChapterIds.add(chapterId)
          const refs = chapterEpisodeRefs.get(chapterId) ?? []
          refs.push({ id: episode.id, index: episode.index + 1, title: episode.title, report })
          chapterEpisodeRefs.set(chapterId, refs)
        } else addIssue({ severity: 'warning', code: 'invalid_episode_chapter', episodeId: episode.id, message: `E${episode.index + 1}「${episode.title}」引用了不存在的原著章节 ${chapterId}` })
      }
    }

    const sortedStoryboards = [...storyboards].sort((a, b) => a.index - b.index)
    for (const storyboard of sortedStoryboards) {
      for (const ref of castRefsForStoryboard(storyboard)) {
        const base = { episodeId: episode.id, storyboardId: storyboard.id, storyboardIndex: storyboard.index + 1, assetId: ref.assetId, variantId: ref.variantId }
        const asset = assets.get(ref.assetId)
        if (!asset) {
          addIssue({ ...base, severity: 'error', code: 'missing_asset', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 引用了不存在的资产 ${ref.assetId}` })
          continue
        }
        const variant = ref.variantId ? asset.variants?.find((item) => item.id === ref.variantId) : undefined
        if (ref.variantId && !variant) {
          addIssue({ ...base, severity: 'error', code: 'missing_variant', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 引用了「${asset.name}」不存在的变体 ${ref.variantId}` })
          continue
        }
        const scopeIssue = variantScopeIssue(variant, episode, storyboard)
        const appliesToEpisode = !scopeIssue
        if (scopeIssue) {
          const scopeLabel = scopeIssue === 'episode' ? '本集' : scopeIssue === 'scene' ? '本场景' : '本分镜'
          addIssue({ ...base, variantKind: variant?.variantKind, severity: 'warning', code: 'variant_out_of_episode_scope', scopeKind: scopeIssue, sceneId: storyboard.sceneId, message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了未标记适用于${scopeLabel}的「${labelForCastRef(asset, ref)}」` })
        }
        if (variant && !scopeIssue && !variantHasScope(variant)) {
          const previous = lastAppearanceUseByAsset.get(asset.id)
          const key = `${episode.id}:${storyboard.id}:${asset.id}:${variant.id}`
          if (previous?.variantId && previous.episodeId !== episode.id && previous.variantId !== variant.id && !stateRegressionWarnings.has(key)) {
            stateRegressionWarnings.add(key)
            addIssue({
              ...base,
              previousEpisodeId: previous.episodeId,
              previousEpisodeIndex: previous.episodeIndex,
              previousEpisodeTitle: previous.episodeTitle,
              previousVariantId: previous.variantId,
              previousVariantLabel: previous.variantLabel,
              previousVariantKind: previous.variantKind,
              variantKind: variant.variantKind,
              severity: 'warning',
              code: 'asset_state_changed_variant',
              scopeKind: 'episode',
              sceneId: storyboard.sceneId,
              message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了「${asset.name}-${variant.label}」，但上一相关剧集 E${previous.episodeIndex}「${previous.episodeTitle}」使用过「${asset.name}-${previous.variantLabel ?? previous.variantId}」。若这是剧情中的换装/妆容变化，建议把当前形态标记适用于本集；否则建议沿用上一形态。`,
            })
          }
        }
        if (!ref.variantId && asset.type !== 'audio' && asset.type !== 'clip') {
          const scopedVariants = variantsScopedToStoryboard(asset, episode, storyboard)
          if (scopedVariants.length) {
            const labels = scopedVariants.map((item) => item.label).join('、')
            addIssue({
              ...base,
              variantId: scopedVariants.length === 1 ? scopedVariants[0].id : undefined,
              variantKind: scopedVariants.length === 1 ? scopedVariants[0].variantKind : undefined,
              candidateVariantIds: scopedVariants.map((item) => item.id),
              candidateVariantLabels: scopedVariants.map((item) => item.label),
              candidateVariantKinds: scopedVariants.map((item) => item.variantKind).filter((kind): kind is VariantKind => !!kind),
              severity: 'warning',
              code: 'episode_variant_available',
              sceneId: storyboard.sceneId,
              message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了「${asset.name}」主形象，但当前分镜已有适用形态：${labels}。建议绑定具体形态，避免妆容/服装状态回退到主图。`,
            })
          } else {
            const previous = lastAppearanceUseByAsset.get(asset.id)
            const key = `${episode.id}:${storyboard.id}:${asset.id}`
            if (previous?.variantId && previous.episodeId !== episode.id && !stateRegressionWarnings.has(key)) {
              stateRegressionWarnings.add(key)
              addIssue({
                ...base,
                variantId: previous.variantId,
                variantKind: previous.variantKind,
                previousVariantKind: previous.variantKind,
                severity: 'warning',
                code: 'asset_state_regressed_to_main',
                message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了「${asset.name}」主形象，但上一相关剧集 E${previous.episodeIndex}「${previous.episodeTitle}」使用过「${asset.name}-${previous.variantLabel ?? previous.variantId}」。如果状态延续，建议创建或绑定本集形态；如果剧情已恢复默认状态，可忽略。`,
              })
            }
          }
        }
        const refImageId = refImageIdForCastRef(asset, ref)
        if (!refImageId) {
          addIssue({ ...base, variantKind: variant?.variantKind, severity: 'error', code: 'missing_ref_image', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 的「${labelForCastRef(asset, ref)}」没有参考图` })
        }
        report.castUses.push({
          storyboardId: storyboard.id,
          storyboardIndex: storyboard.index + 1,
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type,
          variantId: ref.variantId,
          variantLabel: variant?.label,
          variantKind: variant?.variantKind,
          label: labelForCastRef(asset, ref),
          refImageId,
          appliesToEpisode,
        })
        if (variant) {
          lastAppearanceUseByAsset.set(asset.id, {
            episodeId: episode.id,
            episodeIndex: episode.index + 1,
            episodeTitle: episode.title,
            variantId: variant.id,
            variantLabel: variant.label,
            variantKind: variant.variantKind,
          })
        } else if (!ref.variantId && asset.type !== 'audio' && asset.type !== 'clip') {
          lastAppearanceUseByAsset.set(asset.id, {
            episodeId: episode.id,
            episodeIndex: episode.index + 1,
            episodeTitle: episode.title,
          })
        }
      }
    }
    addEpisodePlanIssues(episode, sortedStoryboards, assets, report.castUses, addIssue)
    addSceneReuseIssues(episode, sortedStoryboards, assets, addIssue)
    episodeReports.push(report)
  }

  addCrossEpisodeDuplicateAssetIssues(doc, episodeReports, allIssues)

  if (doc.novel.length > 0 && episodes.length > 1) {
    for (const chapter of doc.novel) {
      if (!assignedChapterIds.has(chapter.id)) {
        allIssues.push({ severity: 'warning', code: 'unassigned_chapter', message: `原著章节「${chapter.title}」还没有分配到任何剧集` })
      }
      const refs = chapterEpisodeRefs.get(chapter.id) ?? []
      if (refs.length > 1) {
        const labels = refs.map((ref) => `E${ref.index}「${ref.title}」`).join('、')
        for (const ref of refs) {
          const issue: ContinuityIssue = { severity: 'warning', code: 'duplicated_chapter_assignment', episodeId: ref.id, message: `原著章节「${chapter.title}」同时分配给 ${labels}` }
          ref.report.issues.push(issue)
          allIssues.push(issue)
        }
      }
    }
  }

  return { currentEpisodeId: doc.currentEpisodeId, episodes: episodeReports, issues: allIssues }
}
