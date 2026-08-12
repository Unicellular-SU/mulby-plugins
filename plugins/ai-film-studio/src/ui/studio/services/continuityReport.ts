/**
 * 连续性报告（台账版）。
 *
 * 旧版有 31 个问题码，其中 16 个阻断生产——因为它把「用户声明的适用范围/必需资产」
 * 和「分镜实际用法」当成两套数据反复交叉校验，每多一种不匹配方式就多一个码。
 *
 * 新版只有 7 个码 / 6 个分类，全部从数据推导，不校验任何声明：
 *
 *   blocking   dangling_ref                    引用了已删除的资产或形态          （阻断）
 *   blocking   missing_ref_image               出场资产/形态没有参考图            （阻断）
 *   appearance unexplained_appearance_change   形态与继承状态不符且未声明变更点
 *   identity   duplicate_identity              多个资产疑似同一身份
 *   scene      scene_asset_inconsistent        同场景组的场景资产漏挂或混用
 *   coverage   chapter_coverage                原著章节未分配 / 重复分配 / 引用失效
 *   hint       unused_project_asset            资产未被任何分镜引用（仅提示）
 *
 * 身份资产（资产中心）的版本落后/归档/别名撞库不再进本报告——那是资产面板的角标，
 * 不该拦住整季生产。
 */
import { castRefsForStoryboard, labelForCastRef, refImageIdForCastRef } from '../../domain/castRefs'
import { normalizeAssetLookup } from '../../domain/assetAliases'
import {
  buildContinuityLedger,
  ambiguousVariantBases,
  expectedVariantId,
  storyboardsOf,
  variantBaseUses,
  type ContinuityLedger,
  type LedgerEntry,
} from '../../domain/continuityLedger'
import type { Asset, Episode, ProjectDoc } from '../../domain/types'

export type ContinuityCategory = 'blocking' | 'appearance' | 'identity' | 'scene' | 'coverage' | 'hint'

export type ContinuityCode =
  | 'dangling_ref'
  | 'missing_ref_image'
  | 'unexplained_appearance_change'
  | 'ambiguous_variant_base'
  | 'duplicate_identity'
  | 'scene_asset_inconsistent'
  | 'chapter_coverage'
  | 'unused_project_asset'

export interface ContinuityIssue {
  category: ContinuityCategory
  severity: 'error' | 'warning' | 'info'
  code: ContinuityCode
  message: string
  episodeId?: string
  storyboardId?: string
  storyboardIndex?: number
  storyboardIds?: string[]
  sceneId?: string
  assetId?: string
  /** 本镜实际绑定的形态 */
  variantId?: string
  /** 台账推导出的继承形态（undefined = 主形象）——「沿用上一形态」快速修复的目标值 */
  expectedVariantId?: string
  expectedVariantLabel?: string
  /** 上一次变更点的位置，用于说明「上一次换装发生在哪」 */
  changedAtEpisodeIndex?: number
  changedAtStoryboardIndex?: number
  relatedAssetIds?: string[]
  conflictLabel?: string
  chapterId?: string
  /** ambiguous_variant_base：该形态被从这几种不同状态变来过（undefined 项 = 主形象） */
  baseVariantIds?: (string | undefined)[]
  baseVariantLabels?: string[]
}

export const CATEGORY_LABEL: Record<ContinuityCategory, string> = {
  blocking: '生成前置检查',
  appearance: '形态连续性',
  identity: '资产身份',
  scene: '同场景一致性',
  coverage: '章节覆盖',
  hint: '提示',
}

/** 只有 blocking 分类会拦住生产。旧版有 16 个阻断码，绝大多数只是"你没勾选"。 */
export function isProductionBlocking(issue: ContinuityIssue): boolean {
  return issue.category === 'blocking'
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
  ledger: ContinuityLedger
}

const ASSET_TYPE_LABEL: Record<Asset['type'], string> = {
  role: '角色',
  scene: '场景',
  prop: '道具',
  audio: '音色',
  clip: '素材片段',
}

const CAST_TYPES: Asset['type'][] = ['role', 'scene', 'prop']

function variantLabelOf(asset: Asset | undefined, variantId: string | undefined): string {
  if (!variantId) return '主形象'
  return asset?.variants?.find((item) => item.id === variantId)?.label ?? variantId
}

function episodeList(doc: ProjectDoc): Episode[] {
  const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
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

// —— identity：一组疑似同身份的资产只报一条，不再每个资产各报一条 ——

function identityKeysOf(asset: Asset): string[] {
  const keys = [asset.name, ...(asset.aliases ?? [])]
    .map((label) => normalizeAssetLookup(label))
    .filter(Boolean)
  return [...new Set(keys)]
}

function linkedEntityId(asset: Asset): string | undefined {
  if (asset.libraryLink?.syncPolicy === 'forked') return undefined
  return asset.libraryLink?.entityId || asset.elementId
}

function addDuplicateIdentityIssues(doc: ProjectDoc, issues: ContinuityIssue[]): void {
  const candidates = doc.assets.filter((asset) => !asset.parentAssetId && CAST_TYPES.includes(asset.type))
  const groups = new Map<string, { label: string; assets: Asset[] }>()

  const push = (key: string, label: string, asset: Asset) => {
    const group = groups.get(key) ?? { label, assets: [] }
    if (!group.assets.some((item) => item.id === asset.id)) group.assets.push(asset)
    groups.set(key, group)
  }

  for (const asset of candidates) {
    for (const key of identityKeysOf(asset)) push(`${asset.type}:name:${key}`, key, asset)
    const entityId = linkedEntityId(asset)
    if (entityId) push(`entity:${entityId}`, entityId, asset)
  }

  const reported = new Set<string>()
  for (const group of groups.values()) {
    if (group.assets.length < 2) continue
    // 已经明确关联到同一个身份资产的，视为用户有意为之，不再报名称重复
    const entityIds = group.assets.map(linkedEntityId)
    const sameEntity = entityIds.every(Boolean) && new Set(entityIds).size === 1
    const groupKey = [...group.assets.map((asset) => asset.id)].sort().join('|')
    if (reported.has(groupKey)) continue
    reported.add(groupKey)
    const typeLabel = ASSET_TYPE_LABEL[group.assets[0].type]
    const names = group.assets.map((asset) => asset.name).join('、')
    issues.push({
      category: 'identity',
      severity: 'warning',
      code: 'duplicate_identity',
      assetId: group.assets[0].id,
      relatedAssetIds: group.assets.slice(1).map((asset) => asset.id),
      conflictLabel: group.label,
      message: sameEntity
        ? `${typeLabel}「${names}」都指向同一个身份资产，建议合并成一个项目资产，避免同一对象被当成两个。`
        : `${typeLabel}「${names}」共用名称/别名「${group.label}」。如果是同一对象请合并，否则改名以免 Agent 选错。`,
    })
  }
}

// —— scene：同 sceneId 的连续镜头应复用同一个场景资产，一组只报一条 ——

function addSceneIssues(ledger: ContinuityLedger, assets: Map<string, Asset>, issues: ContinuityIssue[]): void {
  const groups = new Map<string, LedgerEntry[]>()
  for (const shot of ledger.shots) {
    if (!shot.sceneId) continue
    const key = `${shot.episodeId}:${shot.sceneId}`
    groups.set(key, [...(groups.get(key) ?? []), shot])
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sceneIdsPerShot = group.map((shot) => {
      const ids = castRefsForStoryboard(shot.storyboard)
        .filter((ref) => assets.get(ref.assetId)?.type === 'scene')
        .map((ref) => ref.assetId)
      return { shot, ids: [...new Set(ids)] }
    })
    const allSceneIds = [...new Set(sceneIdsPerShot.flatMap((item) => item.ids))]
    if (!allSceneIds.length) continue

    const head = group[0]
    if (allSceneIds.length > 1) {
      const names = allSceneIds.map((id) => assets.get(id)?.name ?? id).join('、')
      issues.push({
        category: 'scene',
        severity: 'warning',
        code: 'scene_asset_inconsistent',
        episodeId: head.episodeId,
        sceneId: head.sceneId,
        storyboardIds: group.map((shot) => shot.storyboardId),
        storyboardId: head.storyboardId,
        assetId: allSceneIds[0],
        relatedAssetIds: allSceneIds.slice(1),
        message: `E${head.episodeIndex + 1} 场景组「${head.sceneId}」混用了 ${allSceneIds.length} 个场景资产：${names}。连续场景应复用同一个，避免跨镜环境漂移。`,
      })
      continue
    }

    const sceneAssetId = allSceneIds[0]
    const missing = sceneIdsPerShot.filter((item) => !item.ids.length)
    if (!missing.length) continue
    const name = assets.get(sceneAssetId)?.name ?? sceneAssetId
    issues.push({
      category: 'scene',
      severity: 'warning',
      code: 'scene_asset_inconsistent',
      episodeId: head.episodeId,
      sceneId: head.sceneId,
      storyboardIds: missing.map((item) => item.shot.storyboardId),
      storyboardId: missing[0].shot.storyboardId,
      assetId: sceneAssetId,
      message: `E${head.episodeIndex + 1} 场景组「${head.sceneId}」有 ${missing.length} 个分镜（#${missing
        .map((item) => item.shot.storyboardIndex + 1)
        .join(' #')}）没有引用场景资产「${name}」。`,
    })
  }
}

/**
 * 同一形态从多种状态变来 → 它其实承载了多种外观，但只有一张参考图。
 *
 * 「受伤」在 E1 从常服变来、E5 从礼服变来，派生底图只会取第一次（常服），
 * E5 的礼服就丢了。图能生成、流程不会停，所以这只是提醒——但不提醒的话，
 * 用户要到看成片时才发现衣服换错了，那时候重做代价大得多。
 */
function addAmbiguousVariantBaseIssues(doc: ProjectDoc, assets: Map<string, Asset>, issues: ContinuityIssue[]): void {
  const seen = new Set<string>()
  for (const asset of assets.values()) {
    if (asset.parentAssetId || !CAST_TYPES.includes(asset.type)) continue
    for (const variant of asset.variants ?? []) {
      const key = `${asset.id}:${variant.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const uses = variantBaseUses(doc, asset.id, variant.id)
      const bases = ambiguousVariantBases(doc, asset.id, variant.id, uses)
      if (bases.length < 2) continue
      const labels = bases.map((baseId) => variantLabelOf(asset, baseId))
      const where = uses
        .map((use) => `E${use.episodeIndex + 1} #${use.storyboardIndex + 1}（从${variantLabelOf(asset, use.baseVariantId)}）`)
        .join('、')
      issues.push({
        category: 'appearance',
        severity: 'warning',
        code: 'ambiguous_variant_base',
        assetId: asset.id,
        variantId: variant.id,
        baseVariantIds: bases,
        baseVariantLabels: labels,
        storyboardIds: uses.map((use) => use.storyboardId),
        episodeId: uses[0]?.episodeId,
        message: `「${asset.name}-${variant.label}」被从 ${labels.join('、')} 这 ${bases.length} 种状态变来过（${where}）。一个形态只有一张参考图，会按第一次（${labels[0]}）派生，其余场合的服装会丢。如果这几处外观本该不同，拆成不同形态。`,
      })
    }
  }
}

// —— coverage：原著章节分配 ——

function addChapterCoverageIssues(doc: ProjectDoc, episodes: Episode[], issues: ContinuityIssue[]): void {
  if (!doc.novel.length || episodes.length <= 1) return
  const chapterIds = new Set(doc.novel.map((chapter) => chapter.id))
  const owners = new Map<string, Episode[]>()

  for (const episode of episodes) {
    const assigned = episode.novelChapterIds ?? []
    if (!assigned.length) {
      issues.push({
        category: 'coverage',
        severity: 'warning',
        code: 'chapter_coverage',
        episodeId: episode.id,
        message: `E${episode.index + 1}「${episode.title}」还没有分配原著章节。`,
      })
      continue
    }
    for (const chapterId of assigned) {
      if (!chapterIds.has(chapterId)) {
        issues.push({
          category: 'coverage',
          severity: 'warning',
          code: 'chapter_coverage',
          episodeId: episode.id,
          chapterId,
          message: `E${episode.index + 1}「${episode.title}」引用了已不存在的原著章节。`,
        })
        continue
      }
      owners.set(chapterId, [...(owners.get(chapterId) ?? []), episode])
    }
  }

  for (const chapter of doc.novel) {
    const holders = owners.get(chapter.id) ?? []
    if (!holders.length) {
      issues.push({
        category: 'coverage',
        severity: 'warning',
        code: 'chapter_coverage',
        chapterId: chapter.id,
        message: `原著章节「${chapter.title}」还没有分配到任何剧集。`,
      })
    } else if (holders.length > 1) {
      const labels = holders.map((episode) => `E${episode.index + 1}`).join('、')
      issues.push({
        category: 'coverage',
        severity: 'warning',
        code: 'chapter_coverage',
        chapterId: chapter.id,
        episodeId: holders[0].id,
        message: `原著章节「${chapter.title}」同时分配给了 ${labels}。`,
      })
    }
  }
}

export function buildContinuityReport(doc: ProjectDoc): ContinuityReport {
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const episodes = episodeList(doc)
  const ledger = buildContinuityLedger(doc)
  const allIssues: ContinuityIssue[] = []
  const usedAssetIds = new Set<string>()

  addDuplicateIdentityIssues(doc, allIssues)

  const episodeReports: ContinuityEpisodeReport[] = episodes.map((episode) => ({
    id: episode.id,
    index: episode.index + 1,
    title: episode.title,
    current: episode.id === doc.currentEpisodeId,
    storyboards: storyboardsOf(doc, episode).length,
    castUses: [],
    issues: [],
  }))
  const reportById = new Map(episodeReports.map((report) => [report.id, report]))

  const addIssue = (issue: ContinuityIssue) => {
    allIssues.push(issue)
    if (issue.episodeId) reportById.get(issue.episodeId)?.issues.push(issue)
  }

  for (const shot of ledger.shots) {
    const report = reportById.get(shot.episodeId)
    const base = {
      episodeId: shot.episodeId,
      storyboardId: shot.storyboardId,
      storyboardIndex: shot.storyboardIndex + 1,
      sceneId: shot.sceneId,
    }

    for (const ref of castRefsForStoryboard(shot.storyboard)) {
      const asset = assets.get(ref.assetId)
      if (!asset) {
        addIssue({
          ...base,
          category: 'blocking',
          severity: 'error',
          code: 'dangling_ref',
          assetId: ref.assetId,
          message: `E${shot.episodeIndex + 1} 分镜 #${shot.storyboardIndex + 1} 引用了已删除的资产。`,
        })
        continue
      }
      usedAssetIds.add(asset.id)

      const variant = ref.variantId ? asset.variants?.find((item) => item.id === ref.variantId) : undefined
      if (ref.variantId && !variant) {
        addIssue({
          ...base,
          category: 'blocking',
          severity: 'error',
          code: 'dangling_ref',
          assetId: asset.id,
          variantId: ref.variantId,
          message: `E${shot.episodeIndex + 1} 分镜 #${shot.storyboardIndex + 1} 引用了「${asset.name}」已删除的形态。`,
        })
        continue
      }

      // 唯一的形态连续性规则：实际形态 ≠ 继承形态，且本镜没有声明变更点。
      // 旧版这一件事散在 7 个码里（作用域越界/有可用形态/回退主形象/跨集切换/场景内漂移/计划范围不符/计划未绑定）。
      if (asset.type !== 'audio' && asset.type !== 'clip') {
        const expected = expectedVariantId(shot, ref.assetId)
        if (ref.variantId !== expected) {
          const from = variantLabelOf(asset, expected)
          const to = variantLabelOf(asset, ref.variantId)
          addIssue({
            ...base,
            category: 'appearance',
            severity: 'warning',
            code: 'unexplained_appearance_change',
            assetId: asset.id,
            variantId: ref.variantId,
            expectedVariantId: expected,
            expectedVariantLabel: from,
            message: `E${shot.episodeIndex + 1} 分镜 #${shot.storyboardIndex + 1}「${asset.name}」从${from}变成${to}，但没有说明原因。确认是剧情里的变化就登记一次变更，否则沿用上一形态。`,
          })
        }
      }

      const refImageId = refImageIdForCastRef(asset, ref)
      if (!refImageId && asset.type !== 'audio' && asset.type !== 'clip') {
        addIssue({
          ...base,
          category: 'blocking',
          severity: 'error',
          code: 'missing_ref_image',
          assetId: asset.id,
          variantId: ref.variantId,
          message: `E${shot.episodeIndex + 1} 分镜 #${shot.storyboardIndex + 1} 的「${labelForCastRef(asset, ref)}」还没有参考图。`,
        })
      }

      report?.castUses.push({
        storyboardId: shot.storyboardId,
        storyboardIndex: shot.storyboardIndex + 1,
        assetId: asset.id,
        assetName: asset.name,
        assetType: asset.type,
        variantId: ref.variantId,
        variantLabel: variant?.label,
        label: labelForCastRef(asset, ref),
        refImageId,
      })
    }
  }

  addAmbiguousVariantBaseIssues(doc, assets, allIssues)
  addSceneIssues(ledger, assets, allIssues)
  addChapterCoverageIssues(doc, episodes, allIssues)

  if (ledger.shots.length) {
    for (const asset of doc.assets) {
      if (asset.parentAssetId || !CAST_TYPES.includes(asset.type) || usedAssetIds.has(asset.id)) continue
      allIssues.push({
        category: 'hint',
        severity: 'info',
        code: 'unused_project_asset',
        assetId: asset.id,
        message: `${ASSET_TYPE_LABEL[asset.type]}「${asset.name}」还没有出现在任何分镜里。`,
      })
    }
  }

  // scene / coverage / identity / hint 是跨镜或跨集的，回填到对应集报告
  for (const issue of allIssues) {
    if (!issue.episodeId) continue
    const report = reportById.get(issue.episodeId)
    if (report && !report.issues.includes(issue)) report.issues.push(issue)
  }

  return { currentEpisodeId: doc.currentEpisodeId, episodes: episodeReports, issues: allIssues, ledger }
}
