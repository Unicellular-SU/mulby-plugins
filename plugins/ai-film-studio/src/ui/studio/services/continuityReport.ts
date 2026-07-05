import { castRefsForStoryboard, labelForCastRef, refImageIdForCastRef } from '../../domain/castRefs'
import { normalizeAssetLookup } from '../../domain/assetAliases'
import type { Asset, Episode, ProjectDoc, Storyboard } from '../../domain/types'

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
  conflictLabel?: string
  conflictSource?: 'name' | 'alias'
  relatedAssetIds?: string[]
  scopeKind?: 'episode' | 'scene' | 'storyboard'
}

export interface ContinuityCastUse {
  storyboardId: string
  storyboardIndex: number
  assetId: string
  assetName: string
  assetType: Asset['type']
  variantId?: string
  variantLabel?: string
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

function variantScopeIssue(variant: NonNullable<Asset['variants']>[number] | undefined, episode: Episode, storyboard: Storyboard): ContinuityIssue['scopeKind'] | undefined {
  if (!variant) return undefined
  const episodeIds = variant.appliesToEpisodeIds ?? []
  if (episodeIds.length && !episodeIds.includes(episode.id)) return 'episode'
  const sceneIds = variant.appliesToSceneIds ?? []
  if (sceneIds.length && (!storyboard.sceneId || !sceneIds.includes(storyboard.sceneId))) return 'scene'
  const storyboardIds = variant.appliesToStoryboardIds ?? []
  if (storyboardIds.length && !storyboardIds.includes(storyboard.id)) return 'storyboard'
  return undefined
}

function variantsScopedToStoryboard(asset: Asset, episode: Episode, storyboard: Storyboard): NonNullable<Asset['variants']> {
  return (asset.variants ?? []).filter((variant) => {
    const hasScope = !!variant.appliesToEpisodeIds?.length || !!variant.appliesToSceneIds?.length || !!variant.appliesToStoryboardIds?.length
    return hasScope && !variantScopeIssue(variant, episode, storyboard)
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

interface LastVariantUse {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  variantId: string
  variantLabel: string
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

export function buildContinuityReport(doc: ProjectDoc): ContinuityReport {
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const episodes = episodeList(doc)
  const episodeReports: ContinuityEpisodeReport[] = []
  const allIssues: ContinuityIssue[] = []
  const chapterIds = new Set(doc.novel.map((chapter) => chapter.id))
  const assignedChapterIds = new Set<string>()
  const chapterEpisodeRefs = new Map<string, { id: string; index: number; title: string; report: ContinuityEpisodeReport }[]>()
  const lastVariantUseByAsset = new Map<string, LastVariantUse>()
  const stateRegressionWarnings = new Set<string>()
  addDuplicateAssetNameIssues(doc, allIssues)
  addDuplicateAssetAliasIssues(doc, allIssues)
  addUnusedProjectAssetIssues(doc, episodes, allIssues)

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
          addIssue({ ...base, severity: 'warning', code: 'variant_out_of_episode_scope', scopeKind: scopeIssue, sceneId: storyboard.sceneId, message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了未标记适用于${scopeLabel}的「${labelForCastRef(asset, ref)}」` })
        }
        if (!ref.variantId && asset.type !== 'audio' && asset.type !== 'clip') {
          const scopedVariants = variantsScopedToStoryboard(asset, episode, storyboard)
          if (scopedVariants.length) {
            const labels = scopedVariants.map((item) => item.label).join('、')
            addIssue({
              ...base,
              variantId: scopedVariants.length === 1 ? scopedVariants[0].id : undefined,
              severity: 'warning',
              code: 'episode_variant_available',
              sceneId: storyboard.sceneId,
              message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了「${asset.name}」主形象，但当前分镜已有适用形态：${labels}。建议绑定具体形态，避免妆容/服装状态回退到主图。`,
            })
          } else {
            const previous = lastVariantUseByAsset.get(asset.id)
            const key = `${episode.id}:${storyboard.id}:${asset.id}`
            if (previous && previous.episodeId !== episode.id && !stateRegressionWarnings.has(key)) {
              stateRegressionWarnings.add(key)
              addIssue({
                ...base,
                variantId: previous.variantId,
                severity: 'warning',
                code: 'asset_state_regressed_to_main',
                message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了「${asset.name}」主形象，但上一相关剧集 E${previous.episodeIndex}「${previous.episodeTitle}」使用过「${asset.name}-${previous.variantLabel}」。如果状态延续，建议创建或绑定本集形态；如果剧情已恢复默认状态，可忽略。`,
              })
            }
          }
        }
        const refImageId = refImageIdForCastRef(asset, ref)
        if (!refImageId) {
          addIssue({ ...base, severity: 'error', code: 'missing_ref_image', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 的「${labelForCastRef(asset, ref)}」没有参考图` })
        }
        report.castUses.push({
          storyboardId: storyboard.id,
          storyboardIndex: storyboard.index + 1,
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type,
          variantId: ref.variantId,
          variantLabel: variant?.label,
          label: labelForCastRef(asset, ref),
          refImageId,
          appliesToEpisode,
        })
        if (variant) {
          lastVariantUseByAsset.set(asset.id, {
            episodeId: episode.id,
            episodeIndex: episode.index + 1,
            episodeTitle: episode.title,
            variantId: variant.id,
            variantLabel: variant.label,
          })
        }
      }
    }
    addSceneReuseIssues(episode, sortedStoryboards, assets, addIssue)
    episodeReports.push(report)
  }

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
