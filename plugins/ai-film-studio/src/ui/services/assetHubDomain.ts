import type { Asset, AssetVariant, Episode, ProjectDoc } from '../domain/types'
import { castRefsForStoryboard } from '../domain/castRefs'
import { preferredMediaAssetId, type CanvasPortValue, type LibraryEntity, type LibraryVariant } from './assetHub'

/**
 * 资产中心 V2 领域 helper（V2 方案 P1）。
 * 集中身份版本状态、项目快照与身份新版的字段差异、画布候选保存目标、
 * 变体作用域摘要这四类此前散落在矩阵/抽屉/检查器里的判断。
 */

export type AssetHubLinkState = 'unlinked' | 'legacy' | 'snapshot' | 'linked' | 'forked'

export interface AssetHubEntityVersionStatus {
  state: AssetHubLinkState
  entityId: string
  snapshotVersion?: number
  entityVersion?: number
  entityMissing: boolean
  archived: boolean
  hasNewerVersion: boolean
  canSync: boolean
  /** UI 状态标签：快照 / 已关联 / 已分叉 / 旧链接 / 有新版 / 已归档 */
  labels: string[]
}

type EntityVersionSource = Pick<LibraryEntity, 'version' | 'archived'> | null | undefined

export function assetHubEntityVersionStatus(asset: Asset, entity?: EntityVersionSource): AssetHubEntityVersionStatus {
  const link = asset.libraryLink
  const entityId = (link?.entityId ?? asset.elementId ?? '').trim()
  const state: AssetHubLinkState = link
    ? link.syncPolicy === 'forked'
      ? 'forked'
      : link.syncPolicy === 'linked'
        ? 'linked'
        : 'snapshot'
    : entityId
      ? 'legacy'
      : 'unlinked'
  const entityMissing = !!entityId && state !== 'unlinked' && entity === null
  const archived = !!entity?.archived
  const hasNewerVersion = state !== 'forked' && !!link?.entityVersion && !!entity && !archived && entity.version > link.entityVersion
  const labels: string[] = []
  if (state === 'legacy') labels.push('旧链接')
  if (state === 'forked') labels.push('已分叉')
  else if (state === 'linked') labels.push('已关联')
  else if (state === 'snapshot') labels.push('快照')
  if (hasNewerVersion) labels.push('有新版')
  if (archived) labels.push('已归档')
  return {
    state,
    entityId,
    snapshotVersion: link?.entityVersion,
    entityVersion: entity?.version,
    entityMissing,
    archived,
    hasNewerVersion,
    // hasNewerVersion 已排除 forked 与 archived，可同步即有新版
    canSync: hasNewerVersion,
    labels,
  }
}

export type AssetHubDiffField = 'name' | 'aliases' | 'description' | 'prompt' | 'primaryImage' | 'variants' | 'voice' | 'lora'

export const ASSET_HUB_DIFF_FIELD_LABELS: Record<AssetHubDiffField, string> = {
  name: '名称',
  aliases: '别名',
  description: '描述',
  prompt: '提示词',
  primaryImage: '主参考图',
  variants: '形态',
  voice: '音色',
  lora: 'LoRA',
}

export const ASSET_HUB_SYNC_FIELDS: AssetHubDiffField[] = [
  'name',
  'aliases',
  'description',
  'prompt',
  'primaryImage',
  'variants',
  'voice',
  'lora',
]

export interface AssetHubProjectAssetFieldDiff {
  field: AssetHubDiffField
  label: string
  projectValue: string
  entityValue: string
}

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim()
}

function aliasSetLabel(aliases: string[] | undefined): string {
  const cleaned = [...new Set((aliases ?? []).map((alias) => alias.trim()).filter(Boolean))].sort()
  return cleaned.join('、')
}

function variantSummaryLabel(labels: string[]): string {
  return labels.length ? labels.join('、') : '无形态'
}

/**
 * 计算“项目快照 vs 身份库当前版本”的字段级差异。
 * 只比较同步会覆盖的生产字段，作用域等项目专属字段不参与比较。
 */
export function assetHubProjectAssetDiff(asset: Asset, entity: LibraryEntity): AssetHubProjectAssetFieldDiff[] {
  const diffs: AssetHubProjectAssetFieldDiff[] = []
  const push = (field: AssetHubDiffField, label: string, projectValue: string, entityValue: string) => {
    if (projectValue === entityValue) return
    diffs.push({ field, label, projectValue, entityValue })
  }
  push('name', '名称', normalizeText(asset.name), normalizeText(entity.name))
  push('aliases', '别名', aliasSetLabel(asset.aliases), aliasSetLabel(entity.aliases))
  push('description', '描述', normalizeText(asset.desc), normalizeText(entity.description))
  push('prompt', '提示词', normalizeText(asset.prompt), normalizeText(entity.prompt))
  push('primaryImage', '主参考图', normalizeText(asset.refImageId), normalizeText(preferredMediaAssetId(entity.mediaRefs)))

  const variantMap = asset.libraryLink?.variantMap ?? {}
  const linkedLibraryVariantIds = new Set(
    (asset.variants ?? [])
      .map((variant) => variant.libraryVariantId ?? variantMap[variant.id])
      .filter((id): id is string => !!id),
  )
  const entityVariants = entity.variants ?? []
  const missingLocally = entityVariants.filter((variant) => !linkedLibraryVariantIds.has(variant.id))
  const entityVariantIds = new Set(entityVariants.map((variant) => variant.id))
  const localOnly = (asset.variants ?? []).filter((variant) => {
    const libraryVariantId = variant.libraryVariantId ?? variantMap[variant.id]
    return !libraryVariantId || !entityVariantIds.has(libraryVariantId)
  })
  if (missingLocally.length || localOnly.length) {
    push(
      'variants',
      '形态',
      variantSummaryLabel(localOnly.map((variant) => `${variant.label}（项目专属）`)),
      variantSummaryLabel(missingLocally.map((variant) => `${variant.label}（未导入）`)),
    )
  }
  push('voice', '音色', normalizeText(asset.voiceAssetId), normalizeText(entity.voiceRef?.assetId))
  push('lora', 'LoRA', normalizeText(asset.lora?.ref), normalizeText(entity.lora?.ref))
  return diffs
}

/** 只保留用户勾选的差异字段。 */
export function assetHubSelectedFieldDiffs(
  diffs: AssetHubProjectAssetFieldDiff[],
  fields: AssetHubDiffField[] | undefined,
): AssetHubProjectAssetFieldDiff[] {
  if (!fields?.length) return diffs
  const selected = new Set(fields)
  return diffs.filter((diff) => selected.has(diff.field))
}

export interface AssetHubSyncImpact {
  episodeLabels: string[]
  storyboardCount: number
  summary: string
}

/**
 * 估算同步某项目资产后会影响哪些剧集/分镜（只读，不改文档）。
 * 影响面完全来自分镜 castRefs 的实际出场——不再有"计划剧集"这条平行声明。
 */
export function assetHubSyncImpactSummary(doc: ProjectDoc, assetId: string): AssetHubSyncImpact {
  const episodeLabels = new Set<string>()
  let storyboardCount = 0

  const considerStoryboards = (episode: Pick<Episode, 'id' | 'index' | 'title'> | undefined, storyboards: NonNullable<ProjectDoc['storyboards']>) => {
    for (const storyboard of storyboards) {
      const hit = castRefsForStoryboard(storyboard).some((ref) => ref.assetId === assetId)
      if (!hit) continue
      storyboardCount += 1
      const label = episodeScopeLabel(episode)
      if (label) episodeLabels.add(label)
    }
  }

  for (const episode of doc.episodes ?? []) {
    if (episode.id === doc.currentEpisodeId) continue
    considerStoryboards(episode, episode.storyboards ?? [])
  }
  const currentEpisode = doc.currentEpisodeId ? (doc.episodes ?? []).find((episode) => episode.id === doc.currentEpisodeId) : undefined
  considerStoryboards(currentEpisode, doc.storyboards ?? [])

  const episodeList = [...episodeLabels]
  const parts: string[] = []
  if (episodeList.length) parts.push(`出场剧集：${episodeList.join('、')}`)
  if (storyboardCount) parts.push(`${storyboardCount} 个分镜引用`)
  return {
    episodeLabels: episodeList,
    storyboardCount,
    summary: parts.length ? parts.join('；') : '当前项目暂无分镜引用该资产',
  }
}

export type AssetHubAdoptionTargetKind = 'project-asset' | 'project-variant' | 'library-entity' | 'library-variant'

export interface AssetHubAdoptionTarget {
  kind: AssetHubAdoptionTargetKind
  label: string
  projectId?: string
  assetId?: string
  variantId?: string
  entityId?: string
  libraryVariantId?: string
  view?: string
}

function metaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 从画布输出 lineage 解析显式采纳目标。
 * 只解析显式 id 线索：项目目标优先于身份目标；目标失效或身份已归档时返回 null。
 */
export function assetHubAdoptionTargetForCanvasOutput(
  port: CanvasPortValue,
  doc?: ProjectDoc | null,
  entities?: LibraryEntity[],
): AssetHubAdoptionTarget | null {
  const meta = port.meta
  const projectId = metaString(meta, 'projectId')
  const projectAssetId = metaString(meta, 'projectAssetId')
  if (projectAssetId && doc && (!projectId || doc.meta.id === projectId)) {
    const asset = doc.assets?.find((item) => item.id === projectAssetId)
    if (asset) {
      const projectVariantId = metaString(meta, 'projectVariantId')
      if (projectVariantId) {
        const variant = asset.variants?.find((item) => item.id === projectVariantId)
        if (variant) {
          return {
            kind: 'project-variant',
            label: `${asset.name} / ${variant.label}`,
            projectId: doc.meta.id,
            assetId: asset.id,
            variantId: variant.id,
          }
        }
      } else {
        return { kind: 'project-asset', label: asset.name, projectId: doc.meta.id, assetId: asset.id }
      }
    }
  }
  const libraryEntityId = metaString(meta, 'libraryEntityId')
  if (libraryEntityId && entities?.length) {
    const entity = entities.find((item) => item.id === libraryEntityId)
    if (entity && !entity.archived) {
      const view = metaString(meta, 'view') || undefined
      const libraryVariantId = metaString(meta, 'libraryVariantId')
      if (libraryVariantId) {
        const variant = entity.variants?.find((item: LibraryVariant) => item.id === libraryVariantId)
        if (variant) {
          return {
            kind: 'library-variant',
            label: `${entity.name} / ${variant.label}`,
            entityId: entity.id,
            libraryVariantId: variant.id,
            view,
          }
        }
      } else {
        return { kind: 'library-entity', label: entity.name, entityId: entity.id, view }
      }
    }
  }
  return null
}

export interface AssetHubVariantScopeSummary {
  /** 该形态是否真的被分镜用过 */
  used: boolean
  episodeLabels: string[]
  storyboardCount: number
  label: string
}

function episodeScopeLabel(episode: Pick<Episode, 'index' | 'title'> | undefined): string {
  if (!episode) return ''
  const index = Number.isFinite(episode.index) ? `E${episode.index + 1}` : ''
  const title = episode.title?.trim()
  return [index, title].filter(Boolean).join(' ')
}

/**
 * 汇总某个形态在项目里的**实际使用范围**（由分镜反查，不再读已删除的 appliesTo* 声明）。
 * 一个形态"适用于哪里"不需要标注——它出现在哪些分镜里，就适用于哪里。
 */
export function assetHubVariantScopeSummary(doc: ProjectDoc, asset: Asset, variant: AssetVariant): AssetHubVariantScopeSummary {
  const episodeLabels = new Set<string>()
  let storyboardCount = 0

  const scan = (episode: Pick<Episode, 'index' | 'title'> | undefined, storyboards: ProjectDoc['storyboards']) => {
    for (const storyboard of storyboards) {
      if (!castRefsForStoryboard(storyboard).some((ref) => ref.assetId === asset.id && ref.variantId === variant.id)) continue
      storyboardCount += 1
      const label = episodeScopeLabel(episode)
      if (label) episodeLabels.add(label)
    }
  }
  for (const episode of doc.episodes ?? []) {
    if (episode.id === doc.currentEpisodeId) continue
    scan(episode, episode.storyboards ?? [])
  }
  scan((doc.episodes ?? []).find((episode) => episode.id === doc.currentEpisodeId), doc.storyboards ?? [])

  const labels = [...episodeLabels]
  const label = storyboardCount
    ? `${asset.name} / ${variant.label}：${labels.length ? `${labels.join('、')}，` : ''}${storyboardCount} 个分镜`
    : `${asset.name} / ${variant.label}：尚未被任何分镜使用`
  return { used: storyboardCount > 0, episodeLabels: labels, storyboardCount, label }
}
