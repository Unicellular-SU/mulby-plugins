import type { Asset, AssetVariant, Episode, ProjectDoc } from '../domain/types'
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
  scoped: boolean
  episodeLabels: string[]
  unknownEpisodeCount: number
  sceneCount: number
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
 * 汇总某个项目资产变体的作用域，供矩阵、系列页和同步确认展示。
 */
export function assetHubVariantScopeSummary(asset: Asset, variant: AssetVariant, episodes: Episode[] = []): AssetHubVariantScopeSummary {
  const episodesById = new Map(episodes.map((episode) => [episode.id, episode]))
  const episodeIds = [...new Set(variant.appliesToEpisodeIds ?? [])]
  const episodeLabels = episodeIds.map((episodeId) => episodeScopeLabel(episodesById.get(episodeId))).filter(Boolean)
  const unknownEpisodeCount = episodeIds.length - episodeLabels.length
  const sceneCount = new Set(variant.appliesToSceneIds ?? []).size
  const storyboardCount = new Set(variant.appliesToStoryboardIds ?? []).size
  const scoped = episodeIds.length > 0 || sceneCount > 0 || storyboardCount > 0
  const parts: string[] = []
  if (episodeLabels.length) parts.push(`适用：${episodeLabels.join('、')}`)
  if (unknownEpisodeCount > 0) parts.push(`${unknownEpisodeCount} 个未知剧集`)
  if (sceneCount) parts.push(`${sceneCount} 个场景`)
  if (storyboardCount) parts.push(`${storyboardCount} 个分镜`)
  const label = scoped ? `${asset.name} / ${variant.label}：${parts.join('；')}` : `${asset.name} / ${variant.label}：全剧通用`
  return { scoped, episodeLabels, unknownEpisodeCount, sceneCount, storyboardCount, label }
}
