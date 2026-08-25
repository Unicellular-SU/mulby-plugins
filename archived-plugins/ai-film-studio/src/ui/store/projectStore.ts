/**
 * Toonflow 式重构 · 阶段2b：结构化项目 store（zustand），建立在 domain/persistence 之上。
 *
 * 管理：项目列表(cards) + 当前打开的项目文档(doc) + 各实体增删改 + 防抖落盘。
 * 实体二进制（图/视频）仍存现有资产库；这里只存结构与 assetId 引用。
 * 不兼容老节点图（独立 studio:* 命名空间）。
 */
import { create } from 'zustand'
import * as P from '../domain/persistence'
import type { AgentStep, AppearanceChange, Asset, ShotDesign, AssetImage, AssetVariant, Clip, Episode, EpisodePlan, ProjectCard, ProjectDoc, ProjectMeta, Script, SeriesBible, Storyboard, StoryboardCastRef } from '../domain/types'
import { assetPrefixLookup, cleanAssetAliases, findAssetByNameOrAlias, mergeAssetAliases, normalizeAssetLookup } from '../domain/assetAliases'
import { ambiguousVariantBases, declareAppearanceChange, revertToInheritedAppearance, variantBaseUses, variantDerivationBase } from '../domain/continuityLedger'
import { syncCastRefsToLedger } from '../studio/services/episodeProduction'
import type { AgentPlan, PipelineEvent } from '../studio/agent/agent'
import { generateAssetImage, generateDerivativeImage, generateKeyframeImage, generateClipVideo, loadImageBase64, clipLastFrameDataUrl } from '../studio/services/generate'
import { polishAssetPrompt } from '../studio/services/polish'
import { runFlowImage } from '../studio/services/imageFlow'
import { synthVoiceSample, matchRoleVoices } from '../studio/services/audio'
import { maybeSummarize, getMemoryConfig, recallContext } from '../studio/agent/memory'
import { PIPELINE_STAGES, runNovelToFilmPipeline, type PipelineOptions, type PipelineStageStatus } from '../studio/services/pipeline'
import { buildStoryBible, storyBibleIsStale } from '../studio/services/storyBible'
import { planEpisodeBreaks } from '../studio/services/novel'
import { deleteAsset } from '../services/assets'
import { runAgentPipeline, buildToolLoopSystem } from '../studio/agent/agent'
import type { PipelineStage, PipelineStagePlan } from '../studio/agent/agent'
import { runToolLoop } from '../studio/agent/runtime'
import { makeAgentTools } from '../studio/agent/agentTools'
import { resolveAgentEpisodeTarget, resolveAgentRelativeEpisodeDirection } from '../studio/agent/episodeTarget'
import { abortText } from '../services/textEngine'
import { useGraphStore } from './graphStore'
import { useAssetStore, type ElementRef } from './assetStore'
import type { AssetRecord } from '../services/assetRegistry'
import { useAgentDeployStore } from './agentDeployStore'
import { splitNovelChapters, extractEvents } from '../studio/services/novel'
import { composeProject } from '../studio/services/compose'
import { syncTracksFromStoryboards, selectedClipId } from '../studio/services/track'
import { mapPool } from '../studio/services/concurrency'
import { chainTasks, independentTasks, limitsFromConcurrency, runTaskQueue } from '../studio/services/taskQueue'
import { generateGridKeyframes, gridSupported, planGridGroups } from '../studio/services/gridKeyframes'
import { generateTrackVideoPrompt } from '../studio/services/videoPrompt'
import { assertPreflight, preflightClipGeneration, preflightKeyframeGeneration, type GenerationPreflightIssue } from '../studio/services/generationPreflight'
import { supportsVideoReferenceImages } from '../studio/services/videoReferences'
import { buildEpisodeProductionHandoff, buildEpisodeProductionRecap, episodeComposeReadiness, episodeProductionContinuityBlockers, formatEpisodeProductionContinuityError, hasEpisodeProductionState, invalidateCurrentEpisodeProduction, invalidateEpisodesUsingAsset, invalidateEpisodesUsingCastRef, invalidateProductionScope, missingReferencedVariantImages, pendingEpisodesForSeries, productionScopeForStoryboard, productionScopeForTrack, projectDocForProductionScope, setStoryboardCastVariantForScope } from '../studio/services/episodeProduction'
import { flushLogs, logError, logInfo } from '../services/localLog'
import { useProviderStore } from './providerStore'
import { createProjectAssetFromEntity, elementToLibraryEntity, libraryEntityToElement, projectAssetIdentityEntityId, promoteProjectAssetToEntity } from '../services/assetHub'
import type { LibraryEntity } from '../services/assetHub'
import { ASSET_HUB_SYNC_FIELDS, type AssetHubDiffField } from '../services/assetHubDomain'
import { useAssetHubStore } from './assetHubStore'

export interface FilmState {
  state: 'idle' | 'composing' | 'done' | 'failed'
  path?: string
  text?: string
  error?: string
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let agentAbort: AbortController | null = null // 工具循环 Agent 的中断句柄（§6.1.1 per-run）
let agentAborted = false // 用户主动中断标志：catch 里据此把「中断」与「真失败」区分开（避免留下红色出错气泡）

export interface ProjectState {
  cards: ProjectCard[]
  doc: ProjectDoc | null
  loading: boolean
  dirty: boolean
  agentBusy: boolean
  agentStage?: string
  agentTrace?: AgentStep[] // 进行中回合的过程轨迹（busy 时实时更新；提交后随助手消息落到 memory.steps）
  film: FilmState

  init: () => Promise<void>
  refreshCards: () => Promise<void>
  createProject: (meta: Pick<ProjectMeta, 'name'> & Partial<ProjectMeta>) => Promise<string>
  openProject: (id: string) => Promise<void>
  closeProject: () => Promise<void>
  deleteProject: (id: string) => Promise<void>
  flush: () => Promise<void>

  /** 通用：克隆当前 doc → 应用变更 → 落盘（防抖） */
  mutate: (fn: (doc: ProjectDoc) => void) => void
  updateMeta: (patch: Partial<ProjectMeta>) => void
  updateSeriesBible: (patch: Partial<SeriesBible>) => void
  updateEpisodePlan: (episodeId: string, patch: Partial<EpisodePlan>) => void
  createEpisode: () => string
  createEpisodes: (count: number) => string[]
  switchEpisode: (id: string) => void
  renameEpisode: (id: string, title: string) => void
  deleteEpisode: (id: string) => void
  resetCurrentEpisodeProduction: () => void
  setCurrentEpisodeSeriesSkip: (skip: boolean) => void
  setEpisodeNovelChapters: (episodeId: string, chapterIds: string[]) => void
  distributeNovelChaptersAcrossEpisodes: () => void

  // 实体便捷增删改（基于 mutate）
  upsertScript: (s: Partial<Script> & { content: string }) => string
  removeScript: (id: string) => void
  upsertAsset: (a: Partial<Asset> & { type: Asset['type']; name: string }) => string
  removeAsset: (id: string) => void
  /** 从媒体文件库把一张图片绑成项目资产（角色/场景/物品的参考图）。projectId 为当前打开项目时走 mutate，否则直接读写目标 doc。返回新资产 id；非图片/无 assetId 返回 ''。 */
  importImageToProject: (projectId: string, rec: Pick<AssetRecord, 'assetId' | 'name' | 'type'>, kind: 'role' | 'scene' | 'prop') => Promise<string>
  /** 从资产中心身份资产把元素绑成项目资产快照（带 refImageId + 桥接 elementId）。kind 显式指定时优先（拖入「项目资产」某分组时按该组类别），否则按 el.kind 映射。 */
  importElementToProject: (projectId: string, el: ElementRef, kind?: 'role' | 'scene' | 'prop') => Promise<string>
  /** 只把项目资产标记为来自某个身份资产快照，不覆盖项目内生产字段。 */
  linkAssetToLibraryEntity: (assetId: string, entity: { id: string; name?: string; version?: number; archived?: boolean; variants?: Array<Pick<NonNullable<LibraryEntity['variants']>[number], 'id' | 'label'>> }) => boolean
  /** 明确标记候选身份不是该项目资产，压制同名/别名候选误报。 */
  markAssetAsDistinctIdentity: (assetId: string, entityIds: string[]) => boolean
  /** 合并重复项目资产：把分镜/剧集计划引用从 source 迁移到 target，并删除 source 及其子资产。 */
  mergeProjectAssetInto: (sourceAssetId: string, targetAssetId: string) => boolean
  /** 从资产中心身份同步项目快照字段，保留项目内变体作用域；fields 可限制同步字段。 */
  syncAssetFromLibraryEntity: (assetId: string, entity: LibraryEntity, fields?: AssetHubDiffField[]) => boolean
  /** 把项目里的角色/场景/物品资产保存（回流）到资产中心身份资产（复用 elementId，幂等更新）。返回是否实际发布。 */
  promoteAssetToElement: (id: string) => Promise<boolean>
  upsertStoryboard: (s: Partial<Storyboard> & { videoDesc: string }) => string
  removeStoryboard: (id: string) => void
  reorderStoryboards: (orderedIds: string[]) => void
  moveStoryboard: (id: string, delta: number) => void
  upsertClip: (c: Partial<Clip> & { storyboardId: string }) => string

  // 时间线 · 视频段/轨道（§5.1/§5.2/§5.4）
  syncTracks: () => void
  selectClip: (trackId: string, clipId: string) => void
  deleteClip: (trackId: string, clipId: string) => void
  updateTrackDuration: (trackId: string, sec: number | undefined) => void
  updateTrackPrompt: (trackId: string, prompt: string) => void
  generateTrackPrompt: (trackId: string) => Promise<void>
  generateAllTrackPrompts: () => Promise<void>

  // 资产润色（两段式）+ 衍生（§3.1/§3.2）
  polishAsset: (id: string) => Promise<void>
  polishAllAssets: () => Promise<void>
  addDerivative: (parentId: string, init?: { name?: string; desc?: string }) => string
  generateDerivative: (childId: string) => Promise<void>
  addAssetVariant: (assetId: string, init?: { label?: string; desc?: string; prompt?: string }) => string
  updateAssetVariant: (assetId: string, variantId: string, patch: Partial<AssetVariant>) => void
  deleteAssetVariant: (assetId: string, variantId: string) => Promise<void>
  generateAssetVariant: (assetId: string, variantId: string) => Promise<void>
  promoteCanvasImageToProjectAsset: (target: { assetId: string; refImageId: string; variantId?: string }) => boolean
  setStoryboardCastVariant: (storyboardId: string, assetId: string, variantId: string | undefined) => void
  /** 在某镜登记形态变更点：从这一镜起该资产切换形态，后续镜头自动沿用 */
  setAppearanceChange: (storyboardId: string, change: AppearanceChange) => boolean
  /** 把"从多种状态变来"的形态按底图拆成多个独立形态；返回新建的形态数 */
  splitVariantByBase: (assetId: string, variantId: string) => number
  /** 撤销某镜上某资产的变更点，让它回到沿用上一镜的状态 */
  revertAppearanceToInherited: (storyboardId: string, assetId: string) => boolean
  // 一资产多图历史（§3.3）
  selectAssetImage: (assetId: string, imageId: string) => void
  deleteAssetImage: (assetId: string, imageId: string) => Promise<void>
  // 关键帧多参考图精修（§4.4 imageFlow）
  refineKeyframe: (storyboardId: string, refAssetIds: string[], prompt: string) => Promise<void>
  // 音色库 + 角色↔音色（§3.4）
  addVoice: (init?: { name?: string; voice?: string; desc?: string }) => string
  synthVoice: (audioAssetId: string, text?: string) => Promise<void>
  bindRoleVoice: (roleId: string, voiceAssetId: string | undefined) => void
  autoBindVoices: () => Promise<void>

  // 生成（接现有图像引擎 + 项目画风 Skill）
  generateAsset: (id: string) => Promise<void>
  generateKeyframe: (storyboardId: string) => Promise<void>
  generateClip: (storyboardId: string) => Promise<void>
  // 批量「一键生成」（顺序执行，跳过已完成；batch 显示当前进度标签）
  batch: { running: boolean; label?: string; kind?: 'series'; pauseRequested?: boolean }
  generateAllAssets: () => Promise<void>
  generateAllKeyframes: () => Promise<void>
  /** 宫格关键帧：同场景连续镜头合成一张分镜板再切开；返回实际用宫格覆盖的分镜数 */
  generateGridKeyframesForPending: (onLabel?: (text: string) => void) => Promise<number>
  generateAllClips: () => Promise<void>
  /** 一键成片：资产 → 关键帧 → 视频 → 合成 一条龙 */
  autoProduce: () => Promise<void>
  /** 全剧生成：按剧集顺序逐集执行一键成片，并把每集成片路径回写到 Episode。 */
  autoProduceSeries: () => Promise<void>
  pauseSeriesProduction: () => void

  // 小说导入（长文 → 章节，供 Agent 改编）
  importNovel: (text: string) => void
  clearNovel: () => void
  extractChapterEvents: (chapterId: string) => Promise<void>
  extractAllEvents: () => Promise<void>

  // 小说 → 成片主线流水线（确定性阶段机，可从任意阶段进入 / 中断恢复）
  pipeline: { running: boolean; stages: PipelineStageStatus[]; abortRequested?: boolean }
  runNovelPipeline: (options?: PipelineOptions) => Promise<void>
  abortNovelPipeline: () => void

  // 制片 Agent（结构化方案：一句话/故事 → 剧本+资产+分镜）
  runAgent: (userText: string, options?: { stages?: ('script' | 'assets' | 'storyboard')[] }) => Promise<void>
  /** 工具增强 Agent（§6.1）：可按需读取真实项目状态并调用工具写入；jsonMode 管线保留为兜底 */
  runAgentToolLoop: (userText: string) => Promise<void>
  /** 中断进行中的 Agent（管线 runText 与工具循环均尽力中断） */
  abortAgent: () => void

  // 时间线 → ffmpeg 合成成片
  compose: () => Promise<void>
}

/** 改某资产/分镜的 state+error（异步生成进度回写，按 id 查最新避免覆盖并发编辑） */
function setAssetState(get: () => ProjectState, id: string, patch: Partial<Asset>) {
  get().mutate((d) => {
    const a = d.assets.find((x) => x.id === id)
    if (a) Object.assign(a, patch)
  })
}
function setStoryboardState(get: () => ProjectState, id: string, patch: Partial<Storyboard>) {
  get().mutate((d) => {
    const scope = productionScopeForStoryboard(d, id)
    const s = scope?.storyboards.find((x) => x.id === id)
    if (s) Object.assign(s, patch)
    if ('keyframeImageId' in patch) invalidateProductionScope(d, scope)
  })
}
function setAssetVariantState(get: () => ProjectState, assetId: string, variantId: string, patch: Partial<AssetVariant>) {
  get().mutate((d) => {
    const variant = d.assets.find((x) => x.id === assetId)?.variants?.find((x) => x.id === variantId)
    if (variant) {
      Object.assign(variant, patch)
      if ('refImageId' in patch) invalidateEpisodesUsingCastRef(d, assetId, variantId)
    }
  })
}
/** 资产生成成功：把新图作为一条历史候选追加（§3.3），并设为当前选定图（refImageId 同步） */
function pushAssetImage(get: () => ProjectState, id: string, refImageId: string, extra?: Partial<Asset>) {
  get().mutate((d) => {
    const a = d.assets.find((x) => x.id === id)
    if (!a) return
    const img = { id: P.newId('ai_'), refImageId, createdAt: Date.now(), state: 'done' as const }
    a.images = [...(a.images ?? []), img]
    a.currentImageId = img.id
    a.refImageId = refImageId
    a.state = 'done'
    a.error = undefined
    if (extra) Object.assign(a, extra)
    invalidateEpisodesUsingCastRef(d, id)
  })
}

/** 由「库素材规格」构造一条项目 Asset；带 assetId 时同步建一条图片历史候选并设为当前图。 */
function buildLibraryAsset(spec: { kind: Asset['type']; name: string; assetId?: string; prompt?: string; desc?: string; elementId?: string }): Asset {
  const asset: Asset = { id: P.newId('a_'), type: spec.kind, name: spec.name, state: spec.assetId ? 'done' : 'idle' }
  if (spec.assetId) {
    const img: AssetImage = { id: P.newId('ai_'), refImageId: spec.assetId, createdAt: Date.now(), state: 'done' }
    asset.refImageId = spec.assetId
    asset.images = [img]
    asset.currentImageId = img.id
  }
  if (spec.prompt) asset.prompt = spec.prompt
  if (spec.desc) asset.desc = spec.desc
  if (spec.elementId) asset.elementId = spec.elementId
  return asset
}

function libraryVariantMapForAsset(asset: Asset, entity: { variants?: Array<Pick<NonNullable<LibraryEntity['variants']>[number], 'id' | 'label'>> }): Record<string, string> | undefined {
  const variants = asset.variants ?? []
  const entityVariants = entity.variants ?? []
  if (!variants.length || !entityVariants.length) return undefined
  const entityIds = new Set(entityVariants.map((variant) => variant.id))
  const byLabel = new Map(entityVariants.map((variant) => [normalizeAssetLookup(variant.label), variant.id]))
  const map: Record<string, string> = {}
  for (const variant of variants) {
    const linked = variant.libraryVariantId && entityIds.has(variant.libraryVariantId)
      ? variant.libraryVariantId
      : byLabel.get(normalizeAssetLookup(variant.label))
    if (linked) map[variant.id] = linked
  }
  return Object.keys(map).length ? map : undefined
}

function isMergeableProjectAsset(asset: Asset | undefined): asset is Asset {
  return !!asset && !asset.parentAssetId && (asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop')
}

function mergeProjectAssetVariants(source: Asset, target: Asset): Record<string, string> {
  const sourceVariants = source.variants ?? []
  if (!sourceVariants.length) return {}
  const targetVariants = [...(target.variants ?? [])]
  const map: Record<string, string> = {}
  const targetIds = new Set(targetVariants.map((variant) => variant.id))
  const byLibraryId = new Map(targetVariants.map((variant) => [variant.libraryVariantId ?? variant.id, variant.id]))
  const byLabel = new Map(targetVariants.map((variant) => [normalizeAssetLookup(variant.label), variant.id]))
  for (const variant of sourceVariants) {
    const matched =
      (variant.libraryVariantId ? byLibraryId.get(variant.libraryVariantId) : undefined) ??
      byLabel.get(normalizeAssetLookup(variant.label))
    if (matched) {
      map[variant.id] = matched
      continue
    }
    const nextId = targetIds.has(variant.id) ? P.newId('v_') : variant.id
    targetIds.add(nextId)
    targetVariants.push({ ...variant, id: nextId })
    map[variant.id] = nextId
  }
  target.variants = targetVariants.length ? targetVariants : undefined
  return map
}

function rewriteStoryboardAssetRefs(storyboards: Storyboard[], removedIds: Set<string>, targetAssetId: string, variantMap: Record<string, string>): boolean {
  let changed = false
  for (const storyboard of storyboards) {
    const refs: StoryboardCastRef[] = storyboard.castRefs?.length ? [...storyboard.castRefs] : []
    for (const assetId of storyboard.associateAssetIds ?? []) {
      if (!refs.some((ref) => ref.assetId === assetId)) refs.push({ assetId })
    }
    if (!refs.some((ref) => removedIds.has(ref.assetId))) continue
    const nextRefs: StoryboardCastRef[] = []
    const seen = new Set<string>()
    for (const ref of refs) {
      const next: StoryboardCastRef = removedIds.has(ref.assetId)
        ? { ...ref, assetId: targetAssetId, variantId: ref.variantId ? variantMap[ref.variantId] : undefined }
        : ref
      const key = `${next.assetId}:${next.variantId ?? ''}:${next.roleInShot ?? ''}:${next.note ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      nextRefs.push(next)
    }
    storyboard.castRefs = nextRefs
    storyboard.associateAssetIds = [...new Set(nextRefs.map((ref) => ref.assetId))]
    changed = true
  }
  return changed
}

/** 合并资产时改写分镜上的形态变更点，让台账不指向被删掉的资产/形态 */
function rewriteStateChangeRefs(storyboards: Storyboard[], removedIds: Set<string>, targetAssetId: string, sourceVariantIds: Set<string>, variantMap: Record<string, string>): boolean {
  let changed = false
  for (const storyboard of storyboards) {
    const current = storyboard.stateChanges
    if (!current?.length) continue
    const next = current.map((change) => {
      const assetId = removedIds.has(change.assetId) ? targetAssetId : change.assetId
      const toVariantId = change.toVariantId && sourceVariantIds.has(change.toVariantId) ? variantMap[change.toVariantId] : change.toVariantId
      return { ...change, assetId, toVariantId }
    })
    const deduped: typeof next = []
    for (const change of next) {
      const index = deduped.findIndex((item) => item.assetId === change.assetId)
      if (index >= 0) deduped[index] = change
      else deduped.push(change)
    }
    if (JSON.stringify(deduped) !== JSON.stringify(current)) {
      storyboard.stateChanges = deduped
      changed = true
    }
  }
  return changed
}

function syncedProjectAssetFromEntity(current: Asset, entity: LibraryEntity, fields?: AssetHubDiffField[]): Asset {
  const selected = new Set(fields?.length ? fields : ASSET_HUB_SYNC_FIELDS)
  const snapshot = createProjectAssetFromEntity(entity, current.type)
  const currentVariants = current.variants ?? []
  const rejectedLibraryEntityIds = (current.rejectedLibraryEntityIds ?? []).filter((id) => id !== entity.id)
  const nextVariants = selected.has('variants')
    ? (snapshot.variants ?? []).map((variant) => {
        const existing =
          currentVariants.find((item) => item.libraryVariantId && item.libraryVariantId === variant.libraryVariantId) ??
          currentVariants.find((item) => normalizeAssetLookup(item.label) === normalizeAssetLookup(variant.label))
        return { ...variant, id: existing?.id ?? variant.id }
      })
    : currentVariants
  const variantMap = nextVariants.reduce<Record<string, string>>((acc, variant) => {
    if (variant.libraryVariantId) acc[variant.id] = variant.libraryVariantId
    return acc
  }, {})
  return {
    ...current,
    name: selected.has('name') ? snapshot.name : current.name,
    aliases: selected.has('aliases') ? snapshot.aliases : current.aliases,
    desc: selected.has('description') ? snapshot.desc : current.desc,
    prompt: selected.has('prompt') ? snapshot.prompt : current.prompt,
    refImageId: selected.has('primaryImage') ? snapshot.refImageId : current.refImageId,
    images: selected.has('primaryImage') ? snapshot.images : current.images,
    currentImageId: selected.has('primaryImage') ? snapshot.currentImageId : current.currentImageId,
    variants: nextVariants.length ? nextVariants : undefined,
    elementId: entity.id,
    libraryLink: {
      entityId: entity.id,
      entityVersion: entity.version,
      syncPolicy: 'snapshot',
      variantMap: Object.keys(variantMap).length ? variantMap : undefined,
      lastSyncedAt: Date.now(),
    },
    rejectedLibraryEntityIds: rejectedLibraryEntityIds.length ? rejectedLibraryEntityIds : undefined,
    lora: selected.has('lora') ? snapshot.lora ?? current.lora : current.lora,
    state: selected.has('primaryImage') ? snapshot.state : current.state,
    voiceAssetId: selected.has('voice') ? snapshot.voiceAssetId ?? current.voiceAssetId : current.voiceAssetId,
    audioBindState: selected.has('voice')
      ? snapshot.voiceAssetId
        ? snapshot.audioBindState ?? 'done'
        : current.audioBindState
      : current.audioBindState,
    audioFilePath: selected.has('voice') ? snapshot.audioFilePath ?? current.audioFilePath : current.audioFilePath,
    audioUrl: selected.has('voice') ? snapshot.audioUrl ?? current.audioUrl : current.audioUrl,
  }
}

function emptyEpisode(index: number): Episode {
  const now = Date.now()
  return {
    id: P.newId('ep_'),
    index,
    title: `第 ${index + 1} 集`,
    scripts: [],
    storyboards: [],
    clips: [],
    track: [],
    createdAt: now,
    updatedAt: now,
  }
}

function reindexEpisodes(episodes: Episode[]): void {
  episodes.sort((a, b) => a.index - b.index).forEach((episode, index) => (episode.index = index))
}

function compactText(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text || undefined
}

function cleanEpisodePlanPatch(patch: Partial<EpisodePlan>): Partial<EpisodePlan> {
  return {
    hook: 'hook' in patch ? compactText(patch.hook) : patch.hook,
    conflict: 'conflict' in patch ? compactText(patch.conflict) : patch.conflict,
    cliffhanger: 'cliffhanger' in patch ? compactText(patch.cliffhanger) : patch.cliffhanger,
  }
}

function episodePlanHasContent(plan: EpisodePlan | undefined): boolean {
  return !!(plan?.hook || plan?.conflict || plan?.cliffhanger)
}

/** 把一条新资产写进指定项目：打开中的项目走 mutate（防抖落盘），未打开的直接读写其持久化 doc。返回资产 id。 */
async function writeAssetToProject(get: () => ProjectState, projectId: string, asset: Asset): Promise<string> {
  const cur = get().doc
  if (cur && cur.meta.id === projectId) {
    get().mutate((d) => {
      d.assets.push(asset)
    })
    await get().flush()
    return asset.id
  }
  const doc = await P.loadProject(projectId)
  if (!doc) return ''
  doc.assets.push(asset)
  await P.saveProject(doc)
  await get().refreshCards()
  return asset.id
}

function scheduleSave(get: () => ProjectState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void get().flush()
  }, 700)
}

function textPreview(text: string | undefined, limit = 700): { length: number; preview: string } {
  const value = text ?? ''
  return { length: value.length, preview: value.length > limit ? `${value.slice(0, limit)}…` : value }
}

function docCounts(doc: ProjectDoc | null | undefined) {
  return {
    scripts: doc?.scripts.length ?? 0,
    assets: doc?.assets.length ?? 0,
    storyboards: doc?.storyboards.length ?? 0,
    clips: doc?.clips.length ?? 0,
    tracks: doc?.track.length ?? 0,
    novelChapters: doc?.novel.length ?? 0,
  }
}

function switchProjectDocEpisode(d: ProjectDoc, episodeId: string | undefined): boolean {
  if (!episodeId || d.currentEpisodeId === episodeId) return false
  P.syncCurrentEpisodeFromFlat(d)
  const episode = d.episodes?.find((item) => item.id === episodeId)
  if (!episode) return false
  d.currentEpisodeId = episode.id
  P.applyEpisodeToFlat(d, episode)
  return true
}

function logPreflightWarnings(stage: 'keyframe' | 'clip', storyboardId: string, warnings: GenerationPreflightIssue[]): void {
  if (!warnings.length) return
  logInfo('generation.preflight', 'warnings', {
    stage,
    storyboardId,
    warnings: warnings.map((issue) => ({ code: issue.code, message: issue.message })),
  })
}

function composeReadinessError(readiness: ReturnType<typeof episodeComposeReadiness> | undefined): string {
  const missing = readiness?.missingStoryboardIndexes.length
    ? `，缺少分镜 #${readiness.missingStoryboardIndexes.slice(0, 8).join('、')}${readiness.missingStoryboardIndexes.length > 8 ? ` 等 ${readiness.missingStoryboardIndexes.length} 个` : ''}`
    : ''
  return readiness?.total ? `未合成：仍有分镜没有可用视频片段${missing}` : '没有可合成的视频片段'
}

function setEpisodeProductionState(get: () => ProjectState, episodeId: string | undefined, patch: Partial<Episode>): void {
  if (!episodeId) return
  get().mutate((d) => {
    const episode = d.episodes?.find((item) => item.id === episodeId)
    if (!episode) return
    Object.assign(episode, patch, { updatedAt: Date.now() })
  })
}

function setCurrentEpisodeProductionState(get: () => ProjectState, patch: Partial<Episode>): void {
  const doc = get().doc
  if (!doc?.currentEpisodeId) return
  setEpisodeProductionState(get, doc.currentEpisodeId, patch)
}

async function produceCurrentEpisode(
  get: () => ProjectState,
  set: (partial: Partial<ProjectState>) => void,
  opts: { labelPrefix?: string; manageBatch?: boolean; enforceContinuity?: boolean } = {},
): Promise<void> {
  const doc = get().doc
  if (!doc) return
  const prefix = opts.labelPrefix ? `${opts.labelPrefix} · ` : ''
  const setLabel = (label: string) => set({ batch: { ...get().batch, running: true, label: `${prefix}${label}` } })
  if (opts.manageBatch) setLabel('准备…')
  try {
    if (doc.storyboards.length === 0) return
    setCurrentEpisodeProductionState(get, { status: 'generating', filmError: undefined })

    const assetQueueLimits = limitsFromConcurrency(get().doc!.meta.concurrency)

    const assetIds = get().doc!.assets.filter((a) => (a.type === 'role' || a.type === 'scene' || a.type === 'prop') && !a.refImageId).map((a) => a.id)
    if (assetIds.length) {
      setLabel(`生成资产 0/${assetIds.length}`)
      await runTaskQueue(independentTasks(assetIds.map((id) => ({ id })), 'image', (item) => get().generateAsset(item.id), (item) => item.id), {
        limits: assetQueueLimits,
        onProgress: (p) => setLabel(`生成资产 ${p.done}/${p.total}`),
      })
    }

    const variantRefs = missingReferencedVariantImages(get().doc!)
    if (variantRefs.length) {
      setLabel(`生成形态参考图 0/${variantRefs.length}`)
      await runTaskQueue(
        independentTasks(
          variantRefs.map((ref) => ({ id: `${ref.assetId}:${ref.variantId}`, ...ref })),
          'image',
          (item) => get().generateAssetVariant(item.assetId, item.variantId),
          (item) => item.id,
        ),
        { limits: assetQueueLimits, onProgress: (p) => setLabel(`生成形态参考图 ${p.done}/${p.total}`) },
      )
    }

    if (opts.enforceContinuity) {
      const latest = get().doc
      const episode = latest?.episodes?.find((item) => item.id === latest.currentEpisodeId)
      const issues = latest && episode ? episodeProductionContinuityBlockers(latest, episode) : []
      if (latest && episode && issues.length) {
        throw new Error(formatEpisodeProductionContinuityError(episode, issues, { suggestions: buildEpisodeProductionHandoff(latest, episode).suggestions }))
      }
    }

    const limits = limitsFromConcurrency(get().doc!.meta.concurrency)

    // 先用宫格覆盖同场景连续镜（组内一致性最强 + 省调用），剩下的再逐镜生成
    if (get().doc?.meta.gridKeyframes) {
      setLabel('宫格分镜板…')
      await get().generateGridKeyframesForPending(setLabel)
    }

    const pendingKeyframes = [...(get().doc?.storyboards ?? [])].sort((a, b) => a.index - b.index).filter((s) => !s.keyframeImageId)
    if (pendingKeyframes.length) {
      const tasks = chainTasks(pendingKeyframes, 'image', (sb) => get().generateKeyframe(sb.id), (sb) => `#${sb.index + 1}`)
      setLabel(`生成关键帧 0/${tasks.length}`)
      await runTaskQueue(tasks, { limits, onProgress: (p) => setLabel(`生成关键帧 ${p.done}/${p.total}`) })
    }

    const pendingClips = [...(get().doc?.storyboards ?? [])]
      .sort((a, b) => a.index - b.index)
      .filter((s) => s.keyframeImageId && !get().doc!.clips.some((c) => c.storyboardId === s.id && c.state === 'done'))
    if (pendingClips.length) {
      const tasks = chainTasks(pendingClips, 'video', (sb) => get().generateClip(sb.id), (sb) => `#${sb.index + 1}`)
      setLabel(`生成视频 0/${tasks.length}`)
      await runTaskQueue(tasks, { limits, onProgress: (p) => setLabel(`生成视频 ${p.done}/${p.total}`) })
    }

    const latest = get().doc
    const readiness = latest ? episodeComposeReadiness(latest) : undefined
    if (readiness?.ready) {
      setLabel('合成成片…')
      await get().compose()
    } else {
      setCurrentEpisodeProductionState(get, { status: 'planned', filmError: composeReadinessError(readiness) })
    }
  } finally {
    if (opts.manageBatch) set({ batch: { running: false } })
  }
}

function planForLog(plan: AgentPlan) {
  return {
    reply: textPreview(plan.reply, 1000),
    script: plan.script
      ? { name: plan.script.name, content: textPreview(plan.script.content, 1200) }
      : undefined,
    assets: (plan.assets ?? []).map((a) => ({ type: a?.type, name: a?.name, hasDesc: !!a?.desc, hasPrompt: !!a?.prompt })),
    storyboards: (plan.storyboards ?? []).map((s, i) => ({
      index: i + 1,
      replaceIndex: s?.replaceIndex,
      sceneId: s?.sceneId,
      videoDesc: textPreview(s?.videoDesc, 300),
      duration: s?.duration,
      cast: s?.cast,
      castRefCount: s?.castRefs?.length ?? 0,
      dialogueCount: s?.dialogues?.length ?? 0,
    })),
    autoGenerate: plan.autoGenerate === true,
  }
}

interface AgentApplySummary {
  script?: { name: string; length: number }
  assetsCreated: Array<{ id: string; type: Asset['type']; name: string }>
  assetsUpdated: Array<{ id: string; type: Asset['type']; name: string }>
  storyboardsAdded: Array<{ id: string; index: number; desc: string }>
  storyboardsReplaced: Array<{ id: string; index: number; desc: string }>
}

function createAgentApplySummary(): AgentApplySummary {
  return { assetsCreated: [], assetsUpdated: [], storyboardsAdded: [], storyboardsReplaced: [] }
}

function applyAgentScript(d: ProjectDoc, script: AgentPlan['script'] | undefined, applied: AgentApplySummary): void {
  if (!script?.content) return
  const name = script.name || `剧本 ${d.scripts.length + 1}`
  if (d.scripts.length) d.scripts[0] = { ...d.scripts[0], name, content: script.content, updatedAt: Date.now() }
  else d.scripts.push({ id: P.newId('s_'), name, content: script.content, createdAt: Date.now(), updatedAt: Date.now() })
  invalidateCurrentEpisodeProduction(d)
  applied.script = { name, length: script.content.length }
}

function applyAgentAssets(d: ProjectDoc, assets: AgentPlan['assets'] | undefined, applied: AgentApplySummary): void {
  for (const a of assets ?? []) {
    if (!a?.name || !a.type) continue
    const ex = findAssetByNameOrAlias(d.assets.filter((x) => x.type === a.type), a.name)
    if (ex) {
      ex.desc = a.desc ?? ex.desc
      ex.prompt = a.prompt ?? ex.prompt
      const aliases = a.aliases !== undefined ? mergeAssetAliases(ex.aliases, a.aliases) : ex.aliases
      ex.aliases = aliases?.length ? aliases : undefined
      applied.assetsUpdated.push({ id: ex.id, type: ex.type, name: ex.name })
    } else {
      const id = P.newId('a_')
      const aliases = cleanAssetAliases(a.aliases)
      d.assets.push({ id, type: a.type, name: a.name, aliases: aliases.length ? aliases : undefined, desc: a.desc, prompt: a.prompt, state: 'idle' })
      applied.assetsCreated.push({ id, type: a.type, name: a.name })
    }
  }
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function agentCastAsset(d: ProjectDoc, token: unknown): Asset | undefined {
  const text = cleanString(token)
  if (!text) return undefined
  return findAssetByNameOrAlias(d.assets, text)
}

function assetLookupLength(asset: Asset): number {
  return Math.max(...[asset.name, ...(asset.aliases ?? [])].map((name) => name.length))
}

/** Agent 用来表示"就是主形象"的各种说法；命中这些不建形态 */
const MAIN_APPEARANCE_TOKENS = new Set(['主形象', '主形态', '默认', '默认形象', '原样', '无', 'none', 'default', 'main', 'normal'])

/**
 * 严格查找已有形态。**找不到就返回 undefined，绝不把标签原文当 id 用**。
 *
 * 曾经这里以 `?? text` 兜底，于是 Agent 提到一个尚不存在的形态（"受伤"）就会写进一个
 * 指向空气的 variantId。P0 之后台账会把这个坏值继承给后面所有镜头，一个坏点扩散成整集报错。
 */
function agentVariantId(asset: Asset, token: unknown): string | undefined {
  const text = cleanString(token)
  if (!text) return undefined
  const lower = text.toLowerCase()
  return asset.variants?.find((variant) => variant.id === text)?.id ?? asset.variants?.find((variant) => variant.label.toLowerCase() === lower)?.id
}

/**
 * 解析 Agent 引用的形态；不存在就**就地补建**一个空形态。
 *
 * Agent 在分镜阶段说"四叔这一镜变成受伤状态"，是在陈述剧情需求——美术阶段没预建这个形态
 * 是上游的疏漏，不是分镜写错了。三种处理里：
 *   - 返回 undefined → 换装被静默丢弃，剧情要求消失，最糟；
 *   - 返回标签原文 → 悬空引用，报一个和根因无关的错，就是这次的 bug；
 *   - 补建空形态 → 缺参考图，于是 missing_ref_image 精确指出"该给四叔-受伤出图"，
 *     承接面板的「一键补齐」直接能修。这条才是可行动的。
 */
function resolveAgentVariant(d: ProjectDoc, asset: Asset, token: unknown, reason?: string): string | undefined {
  const text = cleanString(token)
  if (!text) return undefined
  if (MAIN_APPEARANCE_TOKENS.has(text.toLowerCase())) return undefined
  const existing = agentVariantId(asset, text)
  if (existing) return existing
  const target = d.assets.find((item) => item.id === asset.id)
  if (!target || target.type === 'audio' || target.type === 'clip') return undefined
  const id = P.newId('v_')
  target.variants = [
    ...(target.variants ?? []),
    {
      id,
      label: text,
      // desc 会作为 img2img 的画面基底喂给图像模型，所以这里只能写**这个形态长什么样**。
      // 变更点的 reason 正好是剧情给出的外观依据（"左脸被划伤"），比标签本身信息量大。
      desc: reason?.trim() ? `${text}：${reason.trim()}` : text,
      // 标记来源用 tags，不要污染 desc——否则元信息会被当成画面描述画进图里
      tags: ['auto'],
      state: 'idle',
    },
  ]
  return id
}

function agentRoleInShot(value: unknown): StoryboardCastRef['roleInShot'] | undefined {
  return value === 'lead' || value === 'supporting' || value === 'background' ? value : undefined
}

function agentCastRefFromString(d: ProjectDoc, raw: unknown): StoryboardCastRef | undefined {
  const text = cleanString(raw)
  if (!text) return undefined
  const exact = agentCastAsset(d, text)
  if (exact) return { assetId: exact.id }
  const assets = [...d.assets].sort((a, b) => assetLookupLength(b) - assetLookupLength(a))
  for (const asset of assets) {
    const prefix = assetPrefixLookup(asset, text)
    if (!prefix) continue
    let variantToken = text.slice(prefix.length).trim()
    variantToken = variantToken.replace(/^[\s\-—–_:：/|·]+/, '').trim()
    variantToken = variantToken.replace(/^[（(\[]/, '').replace(/[）)\]]$/, '').trim()
    return variantToken ? { assetId: asset.id, variantId: resolveAgentVariant(d, asset, variantToken) } : { assetId: asset.id }
  }
  return undefined
}

function agentCastRefFromObject(d: ProjectDoc, value: Record<string, unknown>): StoryboardCastRef | undefined {
  const asset = agentCastAsset(d, value.assetId) ?? agentCastAsset(d, value.assetName) ?? agentCastAsset(d, value.name)
  if (!asset) return agentCastRefFromString(d, value.name ?? value.assetName)
  return {
    assetId: asset.id,
    variantId: resolveAgentVariant(d, asset, value.variantId ?? value.variantLabel ?? value.variant ?? value.label),
    roleInShot: agentRoleInShot(value.roleInShot),
    note: cleanString(value.note),
  }
}

function agentStoryboardCastRefs(d: ProjectDoc, sb: NonNullable<AgentPlan['storyboards']>[number]): StoryboardCastRef[] {
  const refs = new Map<string, StoryboardCastRef>()
  const push = (ref: StoryboardCastRef | undefined) => {
    if (!ref?.assetId) return
    refs.set(`${ref.assetId}:${ref.variantId ?? ''}`, ref)
  }
  for (const item of Array.isArray(sb.castRefs) ? sb.castRefs : []) {
    if (item && typeof item === 'object' && !Array.isArray(item)) push(agentCastRefFromObject(d, item as Record<string, unknown>))
  }
  for (const item of Array.isArray(sb.cast) ? sb.cast : []) push(agentCastRefFromString(d, item))
  return [...refs.values()]
}

/** 解析 Agent 输出的镜头设计决策层；全部字段可选，空串一律丢弃 */
function agentShotDesign(sb: NonNullable<AgentPlan['storyboards']>[number]): ShotDesign | undefined {
  const raw = sb.shotDesign
  if (!raw || typeof raw !== 'object') return undefined
  const design: ShotDesign = {
    unresolvedState: cleanString(raw.unresolvedState),
    viewerPosition: cleanString(raw.viewerPosition),
    gazeFlow: cleanString(raw.gazeFlow),
    compositionMechanism: cleanString(raw.compositionMechanism),
    colorThesis: cleanString(raw.colorThesis),
    imagingBase: cleanString(raw.imagingBase),
  }
  return Object.values(design).some(Boolean) ? design : undefined
}

/**
 * 解析 Agent 输出的形态变更点。取代旧的 ensureScope/scopeKind——
 * Agent 不再声明"这个形态适用于哪几集"，只声明"这一镜里谁变成了什么，为什么"。
 */
function agentStateChanges(d: ProjectDoc, sb: NonNullable<AgentPlan['storyboards']>[number]): AppearanceChange[] | undefined {
  const raw = Array.isArray(sb.stateChanges) ? sb.stateChanges : undefined
  if (!raw) return undefined
  const changes: AppearanceChange[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const value = item as Record<string, unknown>
    const asset = agentCastAsset(d, value.assetId) ?? agentCastAsset(d, value.assetName) ?? agentCastAsset(d, value.name)
    if (!asset) continue
    const reason = cleanString(value.reason) ?? cleanString(value.note)
    if (!reason) continue // 无理由的变更点等于没解释，交给一致性检查提示
    const toVariantId = resolveAgentVariant(d, asset, value.toVariantId ?? value.variantId ?? value.toVariantLabel ?? value.variantLabel, reason)
    const index = changes.findIndex((change) => change.assetId === asset.id)
    const change: AppearanceChange = { assetId: asset.id, toVariantId, reason }
    if (index >= 0) changes[index] = change
    else changes.push(change)
  }
  return changes.length ? changes : undefined
}

function applyAgentStoryboards(d: ProjectDoc, storyboards: AgentPlan['storyboards'] | undefined, applied: AgentApplySummary): void {
  for (const sb of storyboards ?? []) {
    if (!sb?.videoDesc) continue
    const castRefs = agentStoryboardCastRefs(d, sb)
    const cast = [...new Set(castRefs.map((ref) => ref.assetId))]
    const hasCastInput = (Array.isArray(sb.cast) && sb.cast.length > 0) || (Array.isArray(sb.castRefs) && sb.castRefs.length > 0)
    const sceneId = cleanString(sb.sceneId)
    const shotDesign = agentShotDesign(sb)
    const stateChanges = agentStateChanges(d, sb)
    const dlgs = Array.isArray(sb.dialogues)
      ? sb.dialogues
          .filter((x) => x && typeof x.line === 'string' && x.line.trim())
          .map((x) => ({ character: String(x.character ?? ''), line: String(x.line).trim(), emotion: x.emotion ? String(x.emotion) : undefined }))
      : undefined
    const ri = typeof sb.replaceIndex === 'number' && sb.replaceIndex > 0 ? sb.replaceIndex - 1 : -1
    const target = ri >= 0 ? d.storyboards.find((s) => s.index === ri) : undefined
    if (target) {
      target.videoDesc = sb.videoDesc
      if (sb.prompt != null) target.prompt = sb.prompt
      if (typeof sb.duration === 'number') target.duration = sb.duration
      if (hasCastInput) {
        target.associateAssetIds = cast
        target.castRefs = castRefs
      }
      if ('sceneId' in sb) target.sceneId = sceneId
      if (shotDesign) target.shotDesign = shotDesign
      if (dlgs) target.dialogues = dlgs
      if (typeof sb.chainFromPrev === 'boolean') target.chainFromPrev = sb.chainFromPrev
      if ('stateChanges' in sb) target.stateChanges = stateChanges
      target.keyframeImageId = undefined
      target.state = 'idle'
      target.error = undefined
      applied.storyboardsReplaced.push({ id: target.id, index: target.index + 1, desc: target.videoDesc.slice(0, 120) })
      continue
    }
    const id = P.newId('sb_')
    const index = d.storyboards.length
    d.storyboards.push({
      id,
      index,
      track: '默认',
      videoDesc: sb.videoDesc,
      prompt: sb.prompt,
      duration: typeof sb.duration === 'number' ? sb.duration : 5,
      associateAssetIds: cast,
      castRefs,
      sceneId,
      shotDesign,
      stateChanges,
      dialogues: dlgs ?? [],
      shouldGenerateImage: true,
      chainFromPrev: sb.chainFromPrev === true,
      state: 'idle',
    })
    applied.storyboardsAdded.push({ id, index: index + 1, desc: sb.videoDesc.slice(0, 120) })
  }
  if ((storyboards ?? []).some((sb) => sb?.videoDesc)) {
    syncTracksFromStoryboards(d)
    // 未声明变更点的 castRefs 一律回落到台账推导的继承形态，避免 Agent 漏写导致静默漂移
    syncCastRefsToLedger(d)
    invalidateCurrentEpisodeProduction(d)
  }
}

function pipelineEventForLog(e: PipelineEvent) {
  if (e.type === 'reasoning') return null
  if (e.type === 'toolResult') return { type: e.type, agent: e.agent, name: e.name, result: textPreview(e.result, 1200) }
  if (e.type === 'output') return { type: e.type, agent: e.agent, summary: textPreview(e.summary, 1200) }
  if (e.type === 'toolCall') return { type: e.type, agent: e.agent, name: e.name, args: e.args }
  return e
}

/**
 * 过程轨迹构建器：把 Agent 运行中的事件（管线子 Agent / 工具循环的思考·工具调用）
 * 增量累积成 AgentStep[]，并实时写入 agentTrace 供对话面板逐步渲染；结束时 finalize 落到助手消息。
 */
function makeTrace(set: (partial: Partial<ProjectState>) => void) {
  const steps: AgentStep[] = []
  const sync = () => set({ agentTrace: steps.slice() })
  // 工具入参落库前先 JSON 往返：保证纯数据（后续 mutate 的 structuredClone / KV 持久化不会因异常值报错）
  const safeData = (v: unknown): unknown => {
    try {
      return JSON.parse(JSON.stringify(v ?? null))
    } catch {
      return String(v)
    }
  }
  const lastRunning = (kind: AgentStep['kind'], agent?: string) =>
    [...steps].reverse().find((s) => s.kind === kind && (agent === undefined || s.agent === agent) && s.status === 'running')
  const recordToolCall = (name: string, args: unknown, title = `调用 ${name}`) => {
    for (const s of steps) if ((s.kind === 'thinking' || s.kind === 'text') && s.status === 'running') s.status = 'done'
    steps.push({ id: P.newId('st_'), kind: 'tool', title, toolName: name, toolArgs: safeData(args), status: 'running' })
    sync()
  }
  const recordToolResult = (name: string, result: string) => {
    const s = [...steps].reverse().find((x) => x.kind === 'tool' && x.toolName === name && x.status === 'running')
    if (s) {
      s.toolResult = result
      s.status = 'done'
    }
    sync()
  }
  return {
    /** 分阶段管线事件 → 每个子 Agent 一张卡片（内嵌思考流 + 产出摘要）。 */
    onPipeline(e: PipelineEvent) {
      if (e.type === 'toolCall') {
        recordToolCall(`读取 ${e.name}`, e.args, `读取 ${e.name}`)
        return
      }
      if (e.type === 'toolResult') {
        recordToolResult(`读取 ${e.name}`, e.result)
        return
      }
      if (e.type === 'start') {
        steps.push({ id: P.newId('st_'), kind: 'agent', agent: e.agent, title: e.title, thinking: '', content: '', status: 'running' })
      } else {
        const s = [...steps].reverse().find((x) => x.kind === 'agent' && x.agent === e.agent)
        if (s) {
          if (e.type === 'reasoning') s.thinking = (s.thinking ?? '') + e.delta
          else if (e.type === 'output') s.content = e.summary
          else if (e.type === 'done') s.status = 'done'
        }
      }
      sync()
    },
    /** 工具循环：思考增量并入当前 thinking 步。 */
    reasoning(delta: string) {
      let s = lastRunning('thinking')
      if (!s) {
        s = { id: P.newId('st_'), kind: 'thinking', title: '思考', thinking: '', status: 'running' }
        steps.push(s)
      }
      s.thinking = (s.thinking ?? '') + delta
      sync()
    },
    /** 工具循环：模型在工具调用之间的说明性文本，并入当前 text 步（末尾未被工具收束者即最终回复，finalize 时剔除避免与气泡重复）。 */
    text(delta: string) {
      let s = lastRunning('text')
      if (!s) {
        s = { id: P.newId('st_'), kind: 'text', content: '', status: 'running' }
        steps.push(s)
      }
      s.content = (s.content ?? '') + delta
      sync()
    },
    /** 工具循环：一次工具调用（先收束在跑的思考/文本步——这些文本确属工具调用前的串联意图，保留）。 */
    toolCall(name: string, args: unknown) {
      recordToolCall(name, args)
    },
    toolResult(name: string, result: string) {
      recordToolResult(name, result)
    },
    /** 结束：剔除末尾未被工具收束的 text 步（=最终回复，已作气泡展示），把 running 标记完成、超长思考/结果截断，返回快照。 */
    finalize(): AgentStep[] {
      const last = steps[steps.length - 1]
      if (last && last.kind === 'text' && last.status === 'running') steps.pop()
      const CAP_THINK = 6000
      const CAP_RESULT = 4000
      for (const s of steps) {
        if (s.status === 'running') s.status = 'done'
        if (s.thinking && s.thinking.length > CAP_THINK) s.thinking = s.thinking.slice(0, CAP_THINK) + '…（已截断）'
        if (s.toolResult && s.toolResult.length > CAP_RESULT) s.toolResult = s.toolResult.slice(0, CAP_RESULT) + '…（已截断）'
      }
      return steps.slice()
    },
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  cards: [],
  doc: null,
  loading: false,
  dirty: false,
  agentBusy: false,
  film: { state: 'idle' },
  batch: { running: false },
  pipeline: { running: false, stages: PIPELINE_STAGES.map((stage) => ({ ...stage, state: 'pending' as const })) },

  init: async () => {
    set({ loading: true })
    const cards = await P.loadIndex()
    const currentId = await P.getCurrentId()
    let doc: ProjectDoc | null = null
    if (currentId) doc = await P.loadProject(currentId)
    set({ cards, doc, loading: false })
    if (doc) get().syncTracks() // 旧项目惰性补齐视频段
  },

  refreshCards: async () => set({ cards: await P.loadIndex() }),

  createProject: async (meta) => {
    await get().flush() // 先落盘当前 dirty 项目 + 清掉待触发的 saveTimer，避免替换 doc 后丢失/存错
    const doc = P.emptyProjectDoc(meta)
    await P.saveProject(doc)
    await P.setCurrentId(doc.meta.id)
    set({ doc })
    await get().refreshCards()
    return doc.meta.id
  },

  openProject: async (id) => {
    await get().flush()
    const doc = await P.loadProject(id)
    if (!doc) return
    await P.setCurrentId(id)
    set({ doc, dirty: false })
    get().syncTracks() // 惰性补齐视频段
  },

  closeProject: async () => {
    await get().flush()
    await P.setCurrentId(null)
    set({ doc: null })
  },

  deleteProject: async (id) => {
    await get().flush() // 先落盘 + 清 saveTimer，避免 stale timer 把当前 doc 存错
    await P.deleteProject(id)
    const cur = get().doc
    if (cur?.meta.id === id) set({ doc: null })
    await get().refreshCards()
  },

  flush: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const doc = get().doc
    if (doc && get().dirty) {
      await P.saveProject(doc)
      set({ dirty: false })
      await get().refreshCards()
    }
  },

  mutate: (fn) => {
    const cur = get().doc
    if (!cur) return
    const next = structuredClone(cur) as ProjectDoc
    fn(next)
    next.meta.updatedAt = Date.now()
    set({ doc: next, dirty: true })
    scheduleSave(get)
  },

  updateMeta: (patch) => get().mutate((d) => Object.assign(d.meta, patch)),

  updateSeriesBible: (patch) =>
    get().mutate((d) => {
      const current: SeriesBible = d.seriesBible ?? { plannedEpisodeCount: d.episodes?.length || 1 }
      d.seriesBible = {
        logline: 'logline' in patch ? compactText(patch.logline) : current.logline,
        synopsis: 'synopsis' in patch ? compactText(patch.synopsis) : current.synopsis,
        theme: 'theme' in patch ? compactText(patch.theme) : current.theme,
        worldRules: 'worldRules' in patch ? compactText(patch.worldRules) : current.worldRules,
        plannedEpisodeCount:
          typeof patch.plannedEpisodeCount === 'number' && Number.isFinite(patch.plannedEpisodeCount)
            ? Math.max(1, Math.floor(patch.plannedEpisodeCount))
            : current.plannedEpisodeCount,
      }
    }),

  updateEpisodePlan: (episodeId, patch) =>
    get().mutate((d) => {
      const episode = d.episodes?.find((item) => item.id === episodeId)
      if (!episode) return
      const next = { ...(episode.plan ?? {}), ...cleanEpisodePlanPatch(patch) }
      episode.plan = episodePlanHasContent(next) ? next : undefined
      episode.updatedAt = Date.now()
    }),

  createEpisode: () => {
    let id = ''
    get().mutate((d) => {
      P.syncCurrentEpisodeFromFlat(d)
      d.episodes ??= []
      reindexEpisodes(d.episodes)
      const episode = emptyEpisode(d.episodes.length)
      d.episodes.push(episode)
      d.currentEpisodeId = episode.id
      P.applyEpisodeToFlat(d, episode)
      id = episode.id
    })
    return id
  },

  createEpisodes: (count) => {
    const ids: string[] = []
    const n = Math.max(0, Math.min(100, Math.floor(count)))
    if (!n) return ids
    get().mutate((d) => {
      P.syncCurrentEpisodeFromFlat(d)
      d.episodes ??= []
      reindexEpisodes(d.episodes)
      const currentId = d.currentEpisodeId
      for (let i = 0; i < n; i += 1) {
        const episode = emptyEpisode(d.episodes.length)
        d.episodes.push(episode)
        ids.push(episode.id)
      }
      d.currentEpisodeId = currentId
      const current = d.episodes.find((episode) => episode.id === currentId)
      if (current) P.applyEpisodeToFlat(d, current)
    })
    return ids
  },

  switchEpisode: (id) =>
    get().mutate((d) => {
      if (d.currentEpisodeId === id) return
      P.syncCurrentEpisodeFromFlat(d)
      const episode = d.episodes?.find((e) => e.id === id)
      if (!episode) return
      d.currentEpisodeId = episode.id
      P.applyEpisodeToFlat(d, episode)
    }),

  renameEpisode: (id, title) =>
    get().mutate((d) => {
      const episode = d.episodes?.find((e) => e.id === id)
      if (!episode) return
      episode.title = title.trim() || `第 ${episode.index + 1} 集`
      episode.updatedAt = Date.now()
    }),

  deleteEpisode: (id) =>
    get().mutate((d) => {
      P.syncCurrentEpisodeFromFlat(d)
      const episodes = d.episodes ?? []
      if (episodes.length <= 1) return
      const deleteIndex = episodes.findIndex((e) => e.id === id)
      if (deleteIndex < 0) return
      const deletingCurrent = d.currentEpisodeId === id
      d.episodes = episodes.filter((e) => e.id !== id)
      reindexEpisodes(d.episodes)
      if (deletingCurrent || !d.episodes.some((e) => e.id === d.currentEpisodeId)) {
        const next = d.episodes[Math.min(deleteIndex, d.episodes.length - 1)]
        d.currentEpisodeId = next.id
        P.applyEpisodeToFlat(d, next)
      }
    }),

  resetCurrentEpisodeProduction: () => {
    const doc = get().doc
    const episode = doc?.episodes?.find((item) => item.id === doc.currentEpisodeId)
    if (!hasEpisodeProductionState(episode)) return
    get().mutate((d) => {
      invalidateCurrentEpisodeProduction(d)
    })
  },

  setCurrentEpisodeSeriesSkip: (skip) =>
    get().mutate((d) => {
      const episode = d.episodes?.find((item) => item.id === d.currentEpisodeId)
      if (!episode) return
      episode.seriesSkip = skip || undefined
      episode.updatedAt = Date.now()
    }),

  setEpisodeNovelChapters: (episodeId, chapterIds) =>
    get().mutate((d) => {
      const episode = d.episodes?.find((e) => e.id === episodeId)
      if (!episode) return
      const valid = new Set(d.novel.map((chapter) => chapter.id))
      episode.novelChapterIds = [...new Set(chapterIds.filter((id) => valid.has(id)))]
      episode.updatedAt = Date.now()
    }),

  distributeNovelChaptersAcrossEpisodes: () =>
    get().mutate((d) => {
      const episodes = [...(d.episodes ?? [])].sort((a, b) => a.index - b.index)
      if (episodes.length <= 1 || !d.novel.length) return
      const now = Date.now()
      for (let i = 0; i < episodes.length; i += 1) {
        const start = Math.floor((i * d.novel.length) / episodes.length)
        const end = Math.floor(((i + 1) * d.novel.length) / episodes.length)
        episodes[i].novelChapterIds = d.novel.slice(start, end).map((chapter) => chapter.id)
        episodes[i].updatedAt = now
      }
    }),

  upsertScript: (s) => {
    const id = s.id ?? P.newId('s_')
    const now = Date.now()
    get().mutate((d) => {
      const i = d.scripts.findIndex((x) => x.id === id)
      const base: Script = d.scripts[i] ?? { id, name: s.name ?? '剧本', content: '', createdAt: now, updatedAt: now }
      const merged: Script = { ...base, ...s, id, content: s.content, updatedAt: now }
      if (i >= 0) d.scripts[i] = merged
      else d.scripts.push(merged)
      invalidateCurrentEpisodeProduction(d)
    })
    return id
  },
  removeScript: (id) =>
    get().mutate((d) => {
      d.scripts = d.scripts.filter((x) => x.id !== id)
      invalidateCurrentEpisodeProduction(d)
    }),

  upsertAsset: (a) => {
    const id = a.id ?? P.newId('a_')
    get().mutate((d) => {
      const i = d.assets.findIndex((x) => x.id === id)
      const base: Asset = d.assets[i] ?? { id, type: a.type, name: a.name, state: 'idle' }
      const aliases = a.aliases !== undefined ? cleanAssetAliases(a.aliases) : base.aliases
      const nameChanged = i >= 0 && 'name' in a && a.name !== base.name
      const refImageChanged = i >= 0 && 'refImageId' in a && a.refImageId !== base.refImageId
      const merged: Asset = { ...base, ...a, id, aliases: aliases?.length ? aliases : undefined }
      if (i >= 0) d.assets[i] = merged
      else d.assets.push(merged)
      if (nameChanged) invalidateEpisodesUsingAsset(d, id)
      else if (refImageChanged) invalidateEpisodesUsingCastRef(d, id)
    })
    return id
  },
  removeAsset: (id) =>
    get().mutate((d) => {
      const removing = d.assets.filter((asset) => asset.id === id || asset.parentAssetId === id).map((asset) => asset.id)
      if (!removing.length) return
      for (const assetId of removing) invalidateEpisodesUsingAsset(d, assetId)
      const removed = new Set(removing)
      d.assets = d.assets.filter((asset) => !removed.has(asset.id))
      const cleanStoryboards = (storyboards: Storyboard[]) => {
        for (const storyboard of storyboards) {
          if (storyboard.associateAssetIds.some((assetId) => removed.has(assetId))) {
            storyboard.associateAssetIds = storyboard.associateAssetIds.filter((assetId) => !removed.has(assetId))
          }
          if (storyboard.castRefs?.some((ref) => removed.has(ref.assetId))) {
            storyboard.castRefs = storyboard.castRefs.filter((ref) => !removed.has(ref.assetId))
          }
        }
      }
      cleanStoryboards(d.storyboards)
      for (const episode of d.episodes ?? []) {
        if (episode.id !== d.currentEpisodeId) cleanStoryboards(episode.storyboards)
      }
    }),

  importImageToProject: async (projectId, rec, kind) => {
    if (!rec.assetId || rec.type !== 'image') {
      window.mulby?.notification?.show('仅图片媒体文件可加入项目资产（视频/音频请在时间线/配音处使用）', 'warning')
      return ''
    }
    return writeAssetToProject(get, projectId, buildLibraryAsset({ kind, name: rec.name || '媒体文件', assetId: rec.assetId }))
  },

  importElementToProject: async (projectId, el, kind) => {
    if (el.archived) {
      window.mulby?.notification?.show(`「${el.name || '身份资产'}」已归档，恢复后才能加入项目资产`, 'warning')
      return ''
    }
    const k: Asset['type'] = kind ?? (el.kind === 'scene' ? 'scene' : el.kind === 'prop' ? 'prop' : 'role')
    const asset = createProjectAssetFromEntity(elementToLibraryEntity(el), k)
    return writeAssetToProject(get, projectId, asset)
  },

  linkAssetToLibraryEntity: (assetId, entity) => {
    if (!entity.id) return false
    if (entity.archived) {
      window.mulby?.notification?.show(`「${entity.name || '身份资产'}」已归档，恢复后才能关联项目资产`, 'warning')
      return false
    }
    let linked = false
    get().mutate((d) => {
      const asset = d.assets.find((item) => item.id === assetId)
      if (!asset || asset.parentAssetId || (asset.type !== 'role' && asset.type !== 'scene' && asset.type !== 'prop')) return
      const variantMap = libraryVariantMapForAsset(asset, entity)
      if (asset.variants?.length && variantMap) {
        asset.variants = asset.variants.map((variant) => ({
          ...variant,
          libraryVariantId: variantMap[variant.id] ?? variant.libraryVariantId,
        }))
      }
      asset.elementId = entity.id
      asset.libraryLink = {
        entityId: entity.id,
        entityVersion: entity.version,
        syncPolicy: 'snapshot',
        variantMap,
        lastSyncedAt: Date.now(),
      }
      const rejected = (asset.rejectedLibraryEntityIds ?? []).filter((id) => id !== entity.id)
      asset.rejectedLibraryEntityIds = rejected.length ? rejected : undefined
      linked = true
    })
    return linked
  },

  markAssetAsDistinctIdentity: (assetId, entityIds) => {
    const ids = [...new Set(entityIds.map((id) => id.trim()).filter(Boolean))]
    if (!ids.length) return false
    let marked = false
    get().mutate((d) => {
      const asset = d.assets.find((item) => item.id === assetId)
      if (!asset || asset.parentAssetId || (asset.type !== 'role' && asset.type !== 'scene' && asset.type !== 'prop')) return
      asset.rejectedLibraryEntityIds = [...new Set([...(asset.rejectedLibraryEntityIds ?? []), ...ids])]
      const currentEntityId = asset.libraryLink?.entityId || asset.elementId
      if (currentEntityId && ids.includes(currentEntityId)) {
        asset.libraryLink = {
          ...asset.libraryLink,
          entityId: currentEntityId,
          syncPolicy: 'forked',
        }
      }
      marked = true
    })
    return marked
  },

  mergeProjectAssetInto: (sourceAssetId, targetAssetId) => {
    if (!sourceAssetId || !targetAssetId || sourceAssetId === targetAssetId) return false
    let merged = false
    get().mutate((d) => {
      const source = d.assets.find((asset) => asset.id === sourceAssetId)
      const target = d.assets.find((asset) => asset.id === targetAssetId)
      if (!isMergeableProjectAsset(source) || !isMergeableProjectAsset(target) || source.type !== target.type) return
      const removedIds = new Set(d.assets.filter((asset) => asset.id === source.id || asset.parentAssetId === source.id).map((asset) => asset.id))
      const sourceVariantIds = new Set((source.variants ?? []).map((variant) => variant.id))
      const variantMap = mergeProjectAssetVariants(source, target)
      const aliases = mergeAssetAliases(target.aliases, [source.name, ...(source.aliases ?? [])]).filter((alias) => normalizeAssetLookup(alias) !== normalizeAssetLookup(target.name))
      target.aliases = aliases.length ? aliases : undefined
      if (!target.libraryLink && source.libraryLink) target.libraryLink = source.libraryLink
      if (!target.elementId && source.elementId) target.elementId = source.elementId
      target.rejectedLibraryEntityIds = [...new Set([...(target.rejectedLibraryEntityIds ?? []), ...(source.rejectedLibraryEntityIds ?? [])])].filter(Boolean)
      if (!target.rejectedLibraryEntityIds.length) target.rejectedLibraryEntityIds = undefined

      let refsChanged = rewriteStoryboardAssetRefs(d.storyboards, removedIds, target.id, variantMap)
      refsChanged = rewriteStateChangeRefs(d.storyboards, removedIds, target.id, sourceVariantIds, variantMap) || refsChanged
      for (const episode of d.episodes ?? []) {
        if (episode.id === d.currentEpisodeId) continue
        refsChanged = rewriteStoryboardAssetRefs(episode.storyboards, removedIds, target.id, variantMap) || refsChanged
        refsChanged = rewriteStateChangeRefs(episode.storyboards, removedIds, target.id, sourceVariantIds, variantMap) || refsChanged
      }
      d.assets = d.assets.filter((asset) => !removedIds.has(asset.id))
      if (refsChanged) invalidateEpisodesUsingAsset(d, target.id)
      merged = true
    })
    return merged
  },

  syncAssetFromLibraryEntity: (assetId, entity, fields) => {
    if (!assetId || !entity.id) return false
    if (entity.archived) {
      window.mulby?.notification?.show(`「${entity.name}」已归档，恢复后才能同步到项目资产`, 'warning')
      return false
    }
    let synced = false
    get().mutate((d) => {
      const index = d.assets.findIndex((asset) => asset.id === assetId)
      const current = d.assets[index]
      if (!isMergeableProjectAsset(current)) return
      const next = syncedProjectAssetFromEntity(current, entity, fields)
      d.assets[index] = next
      invalidateEpisodesUsingAsset(d, current.id)
      synced = true
    })
    return synced
  },

  promoteAssetToElement: async (id) => {
    const doc = get().doc
    if (!doc) return false
    const a = doc.assets.find((x) => x.id === id)
    if (!a) return false
    if (!a.refImageId) {
      window.mulby?.notification?.show('该资产还没有参考图，先生成或选择一张图片', 'warning')
      return false
    }
    const entityId = projectAssetIdentityEntityId(a)
    const hub = useAssetHubStore.getState()
    if (!hub.loaded) await hub.refresh()
    const existingEntity = entityId ? useAssetHubStore.getState().entities.find((entity) => entity.id === entityId) : undefined
    if (existingEntity?.archived) {
      window.mulby?.notification?.show(`「${existingEntity.name}」已归档，恢复后才能更新身份资产`, 'warning')
      return false
    }
    const publishAsset = entityId ? (entityId !== a.elementId ? { ...a, elementId: entityId } : a) : { ...a, elementId: undefined }
    const entity = promoteProjectAssetToEntity(publishAsset, existingEntity)
    const publishedVariantMap = a.variants?.reduce<Record<string, string>>((acc, variant) => {
      acc[variant.id] = variant.libraryVariantId ?? variant.id
      return acc
    }, {})
    // 复用 elementId（幂等更新已存在的库元素），首次保存则新建并回写桥接 id
    const assetStore = useAssetStore.getState()
    if (!assetStore.loaded) await assetStore.load()
    const el = await useAssetStore.getState().saveElement(libraryEntityToElement(entity))
    get().mutate((d) => {
      const x = d.assets.find((y) => y.id === id)
      if (x) {
        x.elementId = el.id
        if (x.variants) {
          x.variants = x.variants.map((variant) => ({
            ...variant,
            libraryVariantId: variant.libraryVariantId ?? publishedVariantMap?.[variant.id] ?? variant.id,
          }))
        }
        const variantMap = x.variants?.reduce<Record<string, string>>((acc, variant) => {
          if (variant.libraryVariantId) acc[variant.id] = variant.libraryVariantId
          return acc
        }, {})
        x.libraryLink = {
          entityId: el.id,
          entityVersion: entity.version,
          syncPolicy: 'snapshot',
          variantMap: variantMap && Object.keys(variantMap).length ? variantMap : undefined,
          lastSyncedAt: Date.now(),
        }
        const rejected = (x.rejectedLibraryEntityIds ?? []).filter((entityId) => entityId !== el.id)
        x.rejectedLibraryEntityIds = rejected.length ? rejected : undefined
      }
    })
    await useAssetHubStore.getState().refresh()
    window.mulby?.notification?.show(`已保存「${a.name}」到资产中心`, 'success')
    return true
  },

  upsertStoryboard: (s) => {
    const id = s.id ?? P.newId('sb_')
    get().mutate((d) => {
      const i = d.storyboards.findIndex((x) => x.id === id)
      const base: Storyboard = d.storyboards[i] ?? {
        id,
        index: d.storyboards.length,
        track: s.track ?? '默认',
        videoDesc: s.videoDesc,
        duration: s.duration ?? 5,
        associateAssetIds: s.associateAssetIds ?? [],
        shouldGenerateImage: s.shouldGenerateImage ?? true,
        state: 'idle',
      }
      const merged: Storyboard = { ...base, ...s, id }
      if (s.associateAssetIds && !s.castRefs) {
        const existingRefs = new Map((base.castRefs ?? []).map((ref) => [ref.assetId, ref]))
        merged.castRefs = s.associateAssetIds.map((assetId) => existingRefs.get(assetId) ?? { assetId })
      } else if (!merged.castRefs?.length && merged.associateAssetIds.length) {
        merged.castRefs = merged.associateAssetIds.map((assetId) => ({ assetId }))
      }
      if (i >= 0) d.storyboards[i] = merged
      else d.storyboards.push(merged)
      syncTracksFromStoryboards(d) // 新分镜惰性补一个段
      invalidateCurrentEpisodeProduction(d)
    })
    return id
  },
  removeStoryboard: (id) =>
    get().mutate((d) => {
      d.storyboards = d.storyboards.filter((x) => x.id !== id)
      d.clips = d.clips.filter((c) => c.storyboardId !== id)
      // 删除后重排 index 保持连续：否则 index 出现空洞，新建分镜会与现有撞 index → 排序/承接取错相邻镜
      d.storyboards.sort((a, b) => a.index - b.index).forEach((s, i) => (s.index = i))
      syncTracksFromStoryboards(d) // 段内去该分镜 + 空段删除 + order 重排
      // 删掉的这一镜可能带着变更点，后续镜的继承状态要重算
      syncCastRefsToLedger(d)
      invalidateCurrentEpisodeProduction(d)
    }),
  reorderStoryboards: (orderedIds) =>
    get().mutate((d) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i]))
      d.storyboards.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
      d.storyboards.forEach((s, i) => (s.index = i))
      syncTracksFromStoryboards(d) // 段顺序跟随分镜 index
      invalidateCurrentEpisodeProduction(d)
    }),
  moveStoryboard: (id, delta) =>
    get().mutate((d) => {
      const ordered = [...d.storyboards].sort((a, b) => a.index - b.index)
      const i = ordered.findIndex((s) => s.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= ordered.length) return
      ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
      ordered.forEach((s, k) => (s.index = k))
      d.storyboards = ordered
      syncTracksFromStoryboards(d)
      invalidateCurrentEpisodeProduction(d)
    }),

  syncTracks: () => get().mutate((d) => syncTracksFromStoryboards(d)),
  selectClip: (trackId, clipId) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t && t.clipIds.includes(clipId)) {
        t.selectClipId = clipId
        invalidateCurrentEpisodeProduction(d)
      }
    }),
  deleteClip: (trackId, clipId) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t) {
        t.clipIds = t.clipIds.filter((c) => c !== clipId)
        if (t.selectClipId === clipId) t.selectClipId = t.clipIds[0]
      }
      d.clips = d.clips.filter((c) => c.id !== clipId)
      invalidateCurrentEpisodeProduction(d)
    }),
  updateTrackDuration: (trackId, sec) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t) {
        t.duration = sec && sec > 0 ? sec : undefined
        invalidateCurrentEpisodeProduction(d)
      }
    }),
  updateTrackPrompt: (trackId, prompt) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t) {
        t.prompt = prompt
        t.promptState = 'done'
        invalidateCurrentEpisodeProduction(d)
      }
    }),
  generateTrackPrompt: async (trackId) => {
    const doc = get().doc
    const scope = doc ? productionScopeForTrack(doc, trackId) : undefined
    const track = scope?.track.find((t) => t.id === trackId)
    if (!doc || !track) return
    const sourceDoc = projectDocForProductionScope(doc, scope)
    get().mutate((d) => {
      const nextScope = productionScopeForTrack(d, trackId)
      const t = nextScope?.track.find((x) => x.id === trackId)
      if (t) {
        t.promptState = 'generating'
        t.promptError = undefined
      }
    })
    try {
      const prompt = await generateTrackVideoPrompt(track, sourceDoc)
      get().mutate((d) => {
        const nextScope = productionScopeForTrack(d, trackId)
        const t = nextScope?.track.find((x) => x.id === trackId)
        if (t) {
          t.prompt = prompt
          t.promptState = 'done'
          invalidateProductionScope(d, nextScope)
        }
      })
    } catch (e) {
      get().mutate((d) => {
        const nextScope = productionScopeForTrack(d, trackId)
        const t = nextScope?.track.find((x) => x.id === trackId)
        if (t) {
          t.promptState = 'failed'
          t.promptError = e instanceof Error ? e.message : String(e)
        }
      })
    }
  },
  generateAllTrackPrompts: async () => {
    if (get().batch.running || !get().doc) return
    const ids = [...get().doc!.track].sort((a, b) => a.order - b.order).filter((t) => t.storyboardIds.length && !t.prompt).map((t) => t.id)
    if (!ids.length) return
    const c = get().doc!.meta.concurrency ?? 3 // 段提示词相互独立 → 并发
    set({ batch: { running: true, label: `生成段提示词 0/${ids.length}` } })
    try {
      await mapPool(ids, c, (id) => get().generateTrackPrompt(id), (done, total) => set({ batch: { running: true, label: `生成段提示词 ${done}/${total}` } }))
    } finally {
      set({ batch: { running: false } })
    }
  },

  upsertClip: (c) => {
    const id = c.id ?? P.newId('c_')
    get().mutate((d) => {
      const scope = productionScopeForStoryboard(d, c.storyboardId)
      if (!scope) return
      const i = scope.clips.findIndex((x) => x.id === id)
      const base: Clip = scope.clips[i] ?? { id, storyboardId: c.storyboardId, durationSec: c.durationSec ?? 5, state: 'idle' }
      const merged: Clip = { ...base, ...c, id }
      if (i >= 0) scope.clips[i] = merged
      else scope.clips.push(merged)
      invalidateProductionScope(d, scope)
    })
    return id
  },

  polishAsset: async (id) => {
    const doc = get().doc
    const asset = doc?.assets.find((a) => a.id === id)
    if (!doc || !asset || asset.type === 'audio' || asset.type === 'clip') return
    setAssetState(get, id, { promptState: 'polishing', promptError: undefined })
    try {
      const prompt = await polishAssetPrompt(asset, doc.meta)
      setAssetState(get, id, { prompt, promptState: 'done' })
    } catch (e) {
      setAssetState(get, id, { promptState: 'failed', promptError: e instanceof Error ? e.message : String(e) })
    }
  },
  polishAllAssets: async () => {
    if (get().batch.running || !get().doc) return
    const ids = get().doc!.assets.filter((a) => (a.type === 'role' || a.type === 'scene' || a.type === 'prop') && !a.prompt).map((a) => a.id)
    if (!ids.length) return
    const c = get().doc!.meta.concurrency ?? 3 // 润色相互独立 → 并发
    set({ batch: { running: true, label: `润色提示词 0/${ids.length}` } })
    try {
      await mapPool(ids, c, (id) => get().polishAsset(id), (done, total) => set({ batch: { running: true, label: `润色提示词 ${done}/${total}` } }))
    } finally {
      set({ batch: { running: false } })
    }
  },
  addDerivative: (parentId, init) => {
    const parent = get().doc?.assets.find((a) => a.id === parentId)
    if (!parent) return ''
    const n = (get().doc?.assets.filter((a) => a.parentAssetId === parentId).length ?? 0) + 1
    return get().upsertAsset({ type: parent.type, name: init?.name || `${parent.name}·变体${n}`, desc: init?.desc, parentAssetId: parentId })
  },
  generateDerivative: async (childId) => {
    const doc = get().doc
    const child = doc?.assets.find((a) => a.id === childId)
    const parent = child?.parentAssetId ? doc?.assets.find((a) => a.id === child.parentAssetId) : undefined
    if (!doc || !child || !parent) return
    setAssetState(get, childId, { state: 'generating', error: undefined })
    try {
      const refImageId = await generateDerivativeImage(child, parent, doc.meta)
      pushAssetImage(get, childId, refImageId, { derivedFromImageId: parent.refImageId })
    } catch (e) {
      setAssetState(get, childId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
  addAssetVariant: (assetId, init) => {
    let id = ''
    get().mutate((d) => {
      const asset = d.assets.find((a) => a.id === assetId)
      if (!asset || asset.type === 'audio' || asset.type === 'clip') return
      const n = (asset.variants?.length ?? 0) + 1
      id = P.newId('av_')
      const variant: AssetVariant = {
        id,
        label: init?.label || `形态${n}`,
        desc: init?.desc,
        prompt: init?.prompt,
        state: 'idle',
      }
      asset.variants = [...(asset.variants ?? []), variant]
    })
    return id
  },
  updateAssetVariant: (assetId, variantId, patch) =>
    get().mutate((d) => {
      const variant = d.assets.find((a) => a.id === assetId)?.variants?.find((v) => v.id === variantId)
      if (!variant) return
      const affectsGeneratedRefs =
        ('label' in patch && patch.label !== undefined && patch.label !== variant.label) ||
        ('refImageId' in patch && patch.refImageId !== variant.refImageId)
      Object.assign(variant, patch)
      if (affectsGeneratedRefs) invalidateEpisodesUsingCastRef(d, assetId, variantId)
    }),
  deleteAssetVariant: async (assetId, variantId) => {
    const refImageId = get().doc?.assets.find((a) => a.id === assetId)?.variants?.find((v) => v.id === variantId)?.refImageId
    if (refImageId) {
      try {
        await deleteAsset(refImageId)
      } catch {
        // 附件可能已经不存在，忽略
      }
    }
    get().mutate((d) => {
      const asset = d.assets.find((a) => a.id === assetId)
      if (asset?.variants) asset.variants = asset.variants.filter((v) => v.id !== variantId)
      invalidateEpisodesUsingCastRef(d, assetId, variantId)
      const clearVariantRefs = (storyboards: Storyboard[]) => {
        for (const sb of storyboards) {
          if (!sb.castRefs?.some((ref) => ref.assetId === assetId && ref.variantId === variantId)) continue
          sb.castRefs = sb.castRefs.map((ref) => (ref.assetId === assetId && ref.variantId === variantId ? { ...ref, variantId: undefined } : ref))
        }
      }
      clearVariantRefs(d.storyboards)
      for (const episode of d.episodes ?? []) {
        if (episode.id !== d.currentEpisodeId) clearVariantRefs(episode.storyboards)
      }
    })
  },
  generateAssetVariant: async (assetId, variantId) => {
    const doc = get().doc
    const asset = doc?.assets.find((a) => a.id === assetId)
    const variant = asset?.variants?.find((v) => v.id === variantId)
    if (!doc || !asset || !variant || asset.type === 'audio' || asset.type === 'clip') return
    const child: Asset = {
      id: `${asset.id}_${variant.id}`,
      type: asset.type,
      name: `${asset.name}-${variant.label}`,
      desc: variant.desc || variant.label,
      prompt: variant.prompt,
      state: 'idle',
    }
    // 底图从时间轴推导：这个形态是在角色处于什么状态时发生的，就以那个状态为底。
    // 一直用主图会让"常服 → 受伤"变成"默认造型 + 伤口"，把中间的换装丢掉。
    const baseVariantId = variantDerivationBase(doc, assetId, variantId)
    const baseVariant = baseVariantId ? asset.variants?.find((item) => item.id === baseVariantId) : undefined
    const base: Asset = baseVariant?.refImageId
      ? { ...asset, refImageId: baseVariant.refImageId, desc: baseVariant.desc || asset.desc, prompt: baseVariant.prompt || asset.prompt }
      : asset
    setAssetVariantState(get, assetId, variantId, { state: 'generating', error: undefined })
    try {
      const refImageId = await generateDerivativeImage(child, base, doc.meta)
      setAssetVariantState(get, assetId, variantId, { refImageId, state: 'done', error: undefined })
    } catch (e) {
      setAssetVariantState(get, assetId, variantId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
  promoteCanvasImageToProjectAsset: ({ assetId, refImageId, variantId }) => {
    let changed = false
    get().mutate((d) => {
      const asset = d.assets.find((item) => item.id === assetId)
      if (!asset || asset.type === 'audio' || asset.type === 'clip') return
      if (variantId) {
        const variant = asset.variants?.find((item) => item.id === variantId)
        if (!variant) return
        variant.refImageId = refImageId
        variant.state = 'done'
        variant.error = undefined
        invalidateEpisodesUsingCastRef(d, assetId, variantId)
        changed = true
        return
      }
      const existing = asset.images?.find((image) => image.refImageId === refImageId)
      const image: AssetImage = existing ?? { id: P.newId('ai_'), refImageId, createdAt: Date.now(), state: 'done' }
      asset.images = existing ? asset.images : [...(asset.images ?? []), image]
      asset.currentImageId = image.id
      asset.refImageId = refImageId
      asset.state = 'done'
      asset.error = undefined
      invalidateEpisodesUsingCastRef(d, assetId)
      changed = true
    })
    return changed
  },
  setStoryboardCastVariant: (storyboardId, assetId, variantId) =>
    get().mutate((d) => {
      setStoryboardCastVariantForScope(d, storyboardId, assetId, variantId)
    }),
  /**
   * 按派生底图拆分形态。
   *
   * 第一种底图保留在原形态上（它的参考图如果已经生成过，就是按这个底来的，不该作废）；
   * 之后每出现一种新底图就复制出一个新形态，并把那个变更点改指过去。
   * 下游镜头的 castRefs 不用手工改——syncCastRefsToLedger 会按新的变更点重算继承。
   */
  splitVariantByBase: (assetId, variantId) => {
    let created = 0
    get().mutate((d) => {
      const asset = d.assets.find((item) => item.id === assetId)
      const origin = asset?.variants?.find((item) => item.id === variantId)
      if (!asset || !origin) return
      const uses = variantBaseUses(d, assetId, variantId)
      const bases = ambiguousVariantBases(d, assetId, variantId, uses)
      if (bases.length < 2) return

      const labelOf = (baseId: string | undefined) =>
        baseId ? asset.variants?.find((item) => item.id === baseId)?.label ?? baseId : '主形象'
      // 第一种底图留给原形态
      const [, ...extraBases] = bases
      const newIdByBase = new Map<string, string>()
      for (const baseId of extraBases) {
        const id = P.newId('v_')
        newIdByBase.set(baseId ?? '', id)
        asset.variants = [
          ...(asset.variants ?? []),
          {
            ...origin,
            id,
            label: `${origin.label}（${labelOf(baseId)}）`,
            // 参考图不复制：底图不同，图必须重新派生，否则拆分没有意义
            refImageId: undefined,
            state: 'idle',
            error: undefined,
            parentVariantId: baseId,
            tags: [...new Set([...(origin.tags ?? []), 'split'])],
          },
        ]
        created += 1
      }

      const allStoryboards = [d.storyboards, ...(d.episodes ?? []).map((episode) => episode.storyboards)]
      const ambiguousKeys = new Set(bases.map((baseId) => baseId ?? ''))
      for (const use of uses) {
        // 环形返回（换回原样）不参与拆分，它的底图不在 bases 里
        if (!ambiguousKeys.has(use.baseVariantId ?? '')) continue
        const nextId = newIdByBase.get(use.baseVariantId ?? '')
        if (!nextId) continue
        for (const storyboards of allStoryboards) {
          const storyboard = storyboards?.find((item) => item.id === use.storyboardId)
          const change = storyboard?.stateChanges?.find((item) => item.assetId === assetId && item.toVariantId === variantId)
          if (change) change.toVariantId = nextId
        }
      }
      if (created) {
        syncCastRefsToLedger(d)
        invalidateEpisodesUsingAsset(d, assetId)
      }
    })
    return created
  },

  setAppearanceChange: (storyboardId, change) => {
    let ok = false
    get().mutate((d) => {
      ok = declareAppearanceChange(d, storyboardId, change)
      if (!ok) return
      // 变更点会改变后续所有镜头的继承状态，这些镜头的关键帧/成片随之失效
      syncCastRefsToLedger(d)
      invalidateEpisodesUsingAsset(d, change.assetId)
    })
    return ok
  },
  revertAppearanceToInherited: (storyboardId, assetId) => {
    let ok = false
    get().mutate((d) => {
      ok = revertToInheritedAppearance(d, storyboardId, assetId)
      if (!ok) return
      syncCastRefsToLedger(d)
      invalidateEpisodesUsingAsset(d, assetId)
    })
    return ok
  },
  selectAssetImage: (assetId, imageId) =>
    get().mutate((d) => {
      const a = d.assets.find((x) => x.id === assetId)
      const img = a?.images?.find((i) => i.id === imageId)
      if (a && img) {
        a.currentImageId = imageId
        a.refImageId = img.refImageId
        invalidateEpisodesUsingCastRef(d, assetId)
      }
    }),
  deleteAssetImage: async (assetId, imageId) => {
    const a = get().doc?.assets.find((x) => x.id === assetId)
    const img = a?.images?.find((i) => i.id === imageId)
    if (img) {
      try {
        await deleteAsset(img.refImageId)
      } catch {
        // 附件可能已不存在，忽略
      }
    }
    get().mutate((d) => {
      const x = d.assets.find((y) => y.id === assetId)
      if (!x?.images) return
      x.images = x.images.filter((i) => i.id !== imageId)
      if (x.currentImageId === imageId) {
        const last = x.images[x.images.length - 1]
        x.currentImageId = last?.id
        x.refImageId = last?.refImageId
        invalidateEpisodesUsingCastRef(d, assetId)
      }
    })
  },
  refineKeyframe: async (storyboardId, refAssetIds, prompt) => {
    const doc = get().doc
    const sb = doc?.storyboards.find((s) => s.id === storyboardId)
    if (!doc || !sb) return
    setStoryboardState(get, storyboardId, { state: 'generating', error: undefined })
    try {
      const keyframeImageId = await runFlowImage(refAssetIds, prompt, doc.meta)
      setStoryboardState(get, storyboardId, { keyframeImageId, state: 'done' })
    } catch (e) {
      setStoryboardState(get, storyboardId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  addVoice: (init) => get().upsertAsset({ type: 'audio', name: init?.name || '音色', voice: init?.voice, desc: init?.desc }),
  synthVoice: async (audioAssetId, text) => {
    const a = get().doc?.assets.find((x) => x.id === audioAssetId)
    if (!a) return
    setAssetState(get, audioAssetId, { state: 'generating', error: undefined })
    try {
      const r = await synthVoiceSample(text || `你好，我是${a.name}。`, a.voice || '')
      setAssetState(get, audioAssetId, { audioFilePath: r.path, audioUrl: r.base64 ? `data:${r.mime};base64,${r.base64}` : undefined, state: 'done' })
    } catch (e) {
      setAssetState(get, audioAssetId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
  bindRoleVoice: (roleId, voiceAssetId) =>
    get().mutate((d) => {
      const r = d.assets.find((a) => a.id === roleId)
      if (r) {
        r.voiceAssetId = voiceAssetId
        r.audioBindState = voiceAssetId ? 'done' : 'idle'
      }
    }),
  autoBindVoices: async () => {
    const doc = get().doc
    if (!doc) return
    const roles = doc.assets.filter((a) => a.type === 'role')
    const voices = doc.assets.filter((a) => a.type === 'audio')
    if (!roles.length || !voices.length) return
    set({ batch: { running: true, label: 'AI 配音匹配…' } })
    try {
      const map = await matchRoleVoices(
        roles.map((r) => ({ id: r.id, name: r.name, desc: r.desc })),
        voices.map((v) => ({ id: v.id, name: v.name, desc: v.desc }))
      )
      get().mutate((d) => {
        for (const m of map) {
          const r = d.assets.find((a) => a.id === m.roleId && a.type === 'role')
          if (r && d.assets.some((a) => a.id === m.voiceAssetId && a.type === 'audio')) {
            r.voiceAssetId = m.voiceAssetId
            r.audioBindState = 'done'
          }
        }
      })
    } finally {
      set({ batch: { running: false } })
    }
  },

  generateAsset: async (id) => {
    const doc = get().doc
    const asset = doc?.assets.find((a) => a.id === id)
    if (!doc || !asset) return
    setAssetState(get, id, { state: 'generating', error: undefined })
    try {
      const refImageId = await generateAssetImage(asset, doc.meta)
      pushAssetImage(get, id, refImageId)
    } catch (e) {
      setAssetState(get, id, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  generateKeyframe: async (storyboardId) => {
    const doc = get().doc
    const scope = doc ? productionScopeForStoryboard(doc, storyboardId) : undefined
    const sb = scope?.storyboards.find((s) => s.id === storyboardId)
    if (!doc || !scope || !sb) return
    setStoryboardState(get, storyboardId, { state: 'generating', error: undefined })
    try {
      const preflight = await preflightKeyframeGeneration(sb, scope.storyboards, doc.assets)
      logPreflightWarnings('keyframe', storyboardId, preflight.warnings)
      assertPreflight(preflight)
      // 连贯性：承接镜头取「上一镜（按 index）关键帧」作 img2img 主参考
      let chainBase: { base64: string; mime: string } | null = null
      if (sb.chainFromPrev) {
        const ordered = [...scope.storyboards].sort((a, b) => a.index - b.index)
        const i = ordered.findIndex((s) => s.id === storyboardId)
        const prev = i > 0 ? ordered[i - 1] : undefined
        if (prev?.keyframeImageId) chainBase = await loadImageBase64(prev.keyframeImageId)
      }
      const keyframeImageId = await generateKeyframeImage(sb, doc.assets, doc.meta, chainBase)
      setStoryboardState(get, storyboardId, { keyframeImageId, state: 'done' })
    } catch (e) {
      setStoryboardState(get, storyboardId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  generateClip: async (storyboardId) => {
    const doc0 = get().doc
    const scope0 = doc0 ? productionScopeForStoryboard(doc0, storyboardId) : undefined
    const sb = scope0?.storyboards.find((s) => s.id === storyboardId)
    if (!doc0 || !scope0 || !sb) return
    // 确保该分镜有段（1 分镜=1 段惰性补齐），再取段
    if (scope0.current) get().syncTracks()
    const doc = get().doc!
    const scope = productionScopeForStoryboard(doc, storyboardId)
    const track = scope?.track.find((t) => t.storyboardIds.includes(storyboardId))
    if (!scope || !track) return
    // 一镜多生选优（§5.2）：重试「失败」候选则就地覆盖（不堆孤儿），否则新建候选并自动选中
    const last = track.clipIds.length ? scope.clips.find((c) => c.id === track.clipIds[track.clipIds.length - 1]) : undefined
    if (last?.state === 'generating') return // 防重入
    const reuse = last?.state === 'failed' ? last : undefined
    const clipId = get().upsertClip({
      id: reuse?.id,
      storyboardId,
      trackId: track.id,
      state: 'generating',
      error: undefined,
      durationSec: track.duration ?? sb.duration ?? 5,
      createdAt: Date.now(),
    })
    get().mutate((d) => {
      const scope = productionScopeForStoryboard(d, storyboardId)
      const t = scope?.track.find((x) => x.id === track.id)
      if (t) {
        if (!t.clipIds.includes(clipId)) t.clipIds.push(clipId)
        t.selectClipId = clipId
      }
    })
    const setClip = (patch: Partial<Clip>) =>
      get().mutate((d) => {
        const scope = productionScopeForStoryboard(d, storyboardId)
        const c = scope?.clips.find((x) => x.id === clipId)
        if (c) Object.assign(c, patch)
      })
    try {
      // 顺接：承接片段取「上一镜选用片段的真实尾帧」作首帧，无缝衔接
      let firstFrameUrl: string | undefined
      if (sb.chainFromPrev) {
        const ordered = [...scope.storyboards].sort((a, b) => a.index - b.index)
        const i = ordered.findIndex((s) => s.id === storyboardId)
        const prev = i > 0 ? ordered[i - 1] : undefined
        const pt = prev ? scope.track.find((t) => t.storyboardIds.includes(prev.id)) : undefined
        const selId = pt ? selectedClipId(pt) : undefined
        const prevClip = selId
          ? scope.clips.find((c) => c.id === selId)
          : prev
            ? scope.clips.find((c) => c.storyboardId === prev.id && c.state === 'done')
            : undefined
        firstFrameUrl = await clipLastFrameDataUrl(prevClip?.videoFilePath)
      }
      const referenceStoryboards = track.storyboardIds.map((id) => scope.storyboards.find((s) => s.id === id)).filter(Boolean) as Storyboard[]
      const provider = useProviderStore.getState().getActiveFor('video')
      const preflight = await preflightClipGeneration(sb, referenceStoryboards, doc.assets, {
        firstFrameUrl,
        supportsReferenceImages: supportsVideoReferenceImages(provider),
      })
      logPreflightWarnings('clip', storyboardId, preflight.warnings)
      assertPreflight(preflight)
      const r = await generateClipVideo(sb, doc.assets, doc.meta, { firstFrameUrl, durationSec: track.duration, promptOverride: track.prompt, referenceStoryboards })
      setClip({ videoUrl: r.url, videoFilePath: r.localPath, durationSec: r.durationSec, state: 'done' })
    } catch (e) {
      setClip({ state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  importNovel: (text) =>
    get().mutate((d) => {
      d.novel = splitNovelChapters(text).map((c, i) => ({ id: P.newId('ch_'), index: i, title: c.title, text: c.text }))
    }),
  clearNovel: () => get().mutate((d) => (d.novel = [])),

  extractChapterEvents: async (chapterId) => {
    const ch = get().doc?.novel.find((c) => c.id === chapterId)
    if (!ch) return
    get().mutate((d) => {
      const c = d.novel.find((x) => x.id === chapterId)
      if (c) c.eventState = 'generating'
    })
    try {
      const event = await extractEvents(ch.text)
      get().mutate((d) => {
        const c = d.novel.find((x) => x.id === chapterId)
        if (c) {
          c.event = event
          c.eventState = 'done'
        }
      })
    } catch {
      get().mutate((d) => {
        const c = d.novel.find((x) => x.id === chapterId)
        if (c) c.eventState = 'failed'
      })
    }
  },

  extractAllEvents: async () => {
    if (get().batch.running || !get().doc) return
    const ids = get().doc!.novel.filter((c) => !c.event).map((c) => c.id)
    set({ batch: { running: true, label: `提取事件 0/${ids.length}` } })
    try {
      for (let i = 0; i < ids.length; i++) {
        set({ batch: { running: true, label: `提取事件 ${i + 1}/${ids.length}` } })
        await get().extractChapterEvents(ids[i])
      }
    } finally {
      set({ batch: { running: false } })
    }
  },

  abortNovelPipeline: () => {
    const pipeline = get().pipeline
    if (!pipeline.running || pipeline.abortRequested) return
    set({ pipeline: { ...pipeline, abortRequested: true } })
  },

  /**
   * 小说 → 成片一键跑通。阶段产物已存在就跳过，所以「继续上次」和「从头跑」是同一个入口；
   * force 时才重跑。中断只在阶段边界生效——半路砍断正在写的剧本没有意义。
   */
  runNovelPipeline: async (options) => {
    if (get().pipeline.running || get().batch.running || get().agentBusy) return
    const doc = get().doc
    if (!doc) return
    set({ pipeline: { running: true, stages: get().pipeline.stages, abortRequested: false } })
    try {
      await runNovelToFilmPipeline(
        {
          getDoc: () => get().doc,
          isAborted: () => get().pipeline.abortRequested === true,
          onStatus: (stages) => set({ pipeline: { ...get().pipeline, stages } }),
          extractAllEvents: () => get().extractAllEvents(),
          createEpisodes: (count) => get().createEpisodes(count),
          setEpisodeNovelChapters: (episodeId, chapterIds) => get().setEpisodeNovelChapters(episodeId, chapterIds),
          renameEpisode: (episodeId, title) => get().renameEpisode(episodeId, title),
          updateEpisodePlan: (episodeId, patch) => get().updateEpisodePlan(episodeId, patch),
          switchEpisode: (episodeId) => get().switchEpisode(episodeId),
          generateAllAssets: () => get().generateAllAssets(),
          produceCurrentEpisode: () => produceCurrentEpisode(get, set, { manageBatch: true, enforceContinuity: true }),
          runAgentStage: (stage, userText) => get().runAgent(userText, { stages: [stage] }),
          planEpisodeBreaks: async (targetCount) => {
            const current = get().doc
            const model = useGraphStore.getState().selectedModel
            if (!current?.novel.length || !model) return []
            return planEpisodeBreaks(current.novel, targetCount, { model })
          },
          ensureStoryBible: async (onProgress) => {
            const current = get().doc
            const model = useGraphStore.getState().selectedModel
            if (!current || !model || !storyBibleIsStale(current.storyBible, current.novel.length)) return
            const bible = await buildStoryBible(current.novel, { model }, onProgress)
            get().mutate((d) => {
              d.storyBible = bible
            })
          },
        },
        options,
      )
    } catch (e) {
      logError('pipeline', 'run.error', e, { projectId: doc.meta.id })
    } finally {
      set({ pipeline: { ...get().pipeline, running: false, abortRequested: false } })
      await get().flush()
      await flushLogs()
    }
  },

  runAgent: async (userText, agentOptions) => {
    const doc0 = get().doc
    if (!doc0 || !userText.trim() || get().agentBusy) return
    const runId = P.newId('run_')
    let targetEpisode = resolveAgentEpisodeTarget(doc0, userText)
    const relativeDirection = targetEpisode ? undefined : resolveAgentRelativeEpisodeDirection(userText)
    let createdRelativeEpisode: Episode | undefined
    let relativeTargetError: string | undefined
    if (!targetEpisode && relativeDirection === 'next') {
      get().mutate((d) => {
        P.syncCurrentEpisodeFromFlat(d)
        d.episodes ??= []
        reindexEpisodes(d.episodes)
        const episode = emptyEpisode(d.episodes.length)
        d.episodes.push(episode)
        d.currentEpisodeId = episode.id
        P.applyEpisodeToFlat(d, episode)
        createdRelativeEpisode = episode
      })
      if (createdRelativeEpisode) targetEpisode = { episode: createdRelativeEpisode, match: 'relative', value: 'next' }
    } else if (!targetEpisode && relativeDirection === 'previous') {
      relativeTargetError = '当前已经是第一集，没有上一集可写入。'
    }
    const writeEpisodeId = targetEpisode?.episode.id ?? (relativeTargetError ? undefined : doc0.currentEpisodeId)
    const logCtx = { runId, projectId: doc0.meta.id, projectName: doc0.meta.name, writeEpisodeId, targetEpisodeMatch: targetEpisode?.match }
    const now = Date.now()
    get().mutate((d) => d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'user', content: userText, createTime: now }))
    if (createdRelativeEpisode) logInfo('agent', 'targetEpisode.create', { ...logCtx, episodeTitle: createdRelativeEpisode.title })
    if (targetEpisode?.episode.id && targetEpisode.episode.id !== doc0.currentEpisodeId) {
      let switched = false
      get().mutate((d) => {
        switched = switchProjectDocEpisode(d, targetEpisode.episode.id)
      })
      if (switched) logInfo('agent', 'targetEpisode.switch', { ...logCtx, episodeTitle: targetEpisode.episode.title })
    }
    const trace = makeTrace(set)
    const onPipeline = (e: PipelineEvent) => {
      trace.onPipeline(e)
      const payload = pipelineEventForLog(e)
      if (payload) logInfo('agent.pipeline', e.type, { ...logCtx, ...payload })
    }
    agentAborted = false
    set({ agentBusy: true, agentStage: undefined, agentTrace: [] })
    logInfo('agent', 'run.start', { ...logCtx, userText: textPreview(userText, 1200), before: docCounts(doc0) })
    const applied = createAgentApplySummary()
    const appliedStages = new Set<PipelineStage>()
    const applyStagePlan = (stage: PipelineStage, fragment: PipelineStagePlan) => {
      get().mutate((d) => {
        if (stage === 'script' || stage === 'storyboard') switchProjectDocEpisode(d, writeEpisodeId)
        if (stage === 'script') applyAgentScript(d, fragment.script, applied)
        else if (stage === 'assets') applyAgentAssets(d, fragment.assets, applied)
        else if (stage === 'storyboard') applyAgentStoryboards(d, fragment.storyboards, applied)
      })
      appliedStages.add(stage)
      logInfo('agent', 'stage.apply', { ...logCtx, stage, applied, after: docCounts(get().doc) })
    }
    try {
      if (relativeTargetError) throw new Error(relativeTargetError)
      const plan = await runAgentPipeline(() => get().doc, userText, onPipeline, (stage, fragment) => {
        applyStagePlan(stage, fragment)
      }, { episodeId: writeEpisodeId, stages: agentOptions?.stages })
      logInfo('agent', 'plan.result', { ...logCtx, plan: planForLog(plan) })
      if (plan.script?.content && !appliedStages.has('script')) applyStagePlan('script', { script: plan.script })
      if (plan.assets?.length && !appliedStages.has('assets')) applyStagePlan('assets', { assets: plan.assets })
      if (plan.storyboards?.length && !appliedStages.has('storyboard')) applyStagePlan('storyboard', { storyboards: plan.storyboards })
      get().mutate((d) => {
        d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'assistant', content: plan.reply, createTime: Date.now(), steps: trace.finalize() })
      })
      logInfo('agent', 'apply.result', { ...logCtx, applied, after: docCounts(get().doc) })
      // 用户明确要求出图/成片 → 应用方案后自动一键成片（后台执行，不阻塞对话）
      if (plan.autoGenerate) {
        logInfo('agent', 'autoProduce.start', { ...logCtx })
        void get().autoProduce()
      }
    } catch (e) {
      const stopped = agentAborted || (e instanceof Error && /abort/i.test(e.message))
      logError('agent', 'run.error', e, { ...logCtx, stopped })
      get().mutate((d) =>
        d.memory.push({
          id: P.newId('m_'),
          agent: 'productionAgent',
          role: 'assistant',
          content: stopped ? '（已停止）' : '出错：' + (e instanceof Error ? e.message : String(e)),
          createTime: Date.now(),
          steps: trace.finalize(),
        }),
      )
    } finally {
      set({ agentBusy: false, agentStage: undefined, agentTrace: undefined })
      const d = get().doc
      if (d) await maybeSummarize(d, get().mutate, await getMemoryConfig()) // §6.6 长会话压缩
      await get().flush()
      await flushLogs()
    }
  },

  runAgentToolLoop: async (userText) => {
    const doc0 = get().doc
    if (!doc0 || !userText.trim() || get().agentBusy) return
    const runId = P.newId('run_')
    const logCtx = { runId, projectId: doc0.meta.id, projectName: doc0.meta.name, mode: 'toolLoop' }
    const deploy = useAgentDeployStore.getState().resolve('decision') // §6.3 按 Agent 选模型/温度
    const model = deploy.model || useGraphStore.getState().selectedModel
    const push = (role: string, content: string, steps?: AgentStep[]) =>
      get().mutate((d) => d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role, content, createTime: Date.now(), steps }))
    if (!model) {
      push('assistant', '未配置文本模型（请在「模型」里选择）')
      return
    }
    push('user', userText)
    const controller = new AbortController()
    agentAbort = controller
    const trace = makeTrace(set)
    agentAborted = false
    set({ agentBusy: true, agentStage: '工具调用…', agentTrace: [] })
    logInfo('agent', 'run.start', { ...logCtx, userText: textPreview(userText, 1200), before: docCounts(doc0), model })
    try {
      const cfg = await getMemoryConfig()
      const reply = await runToolLoop({
        model,
        system: buildToolLoopSystem(get().doc!, recallContext(get().doc!, userText, cfg)),
        user: userText,
        tools: makeAgentTools(get),
        params: deploy.params,
        signal: controller.signal,
        onText: trace.text,
        onReasoning: (text) => {
          trace.reasoning(text)
        },
        onToolCall: (name, args) => {
          trace.toolCall(name, args)
          logInfo('agent.toolLoop', 'tool.call', { ...logCtx, name, args })
          set({ agentStage: `调用 ${name}…` })
        },
        onToolResult: (name, result) => {
          trace.toolResult(name, result)
          logInfo('agent.toolLoop', 'tool.result', { ...logCtx, name, result: textPreview(result, 1200) })
          set({ agentStage: `${name} 完成` })
        },
      })
      logInfo('agent', 'run.reply', { ...logCtx, reply: textPreview(reply, 1200), after: docCounts(get().doc) })
      push('assistant', reply, trace.finalize())
      const d = get().doc
      if (d) await maybeSummarize(d, get().mutate, cfg)
    } catch (e) {
      const stopped = agentAborted || controller.signal.aborted || (e instanceof Error && /abort/i.test(e.message))
      logError('agent', 'run.error', e, { ...logCtx, stopped })
      push('assistant', stopped ? '（已停止）' : '出错：' + (e instanceof Error ? e.message : String(e)), trace.finalize())
    } finally {
      agentAbort = null
      set({ agentBusy: false, agentStage: undefined, agentTrace: undefined })
      await get().flush()
      await flushLogs()
    }
  },

  abortAgent: () => {
    logInfo('agent', 'abort')
    agentAborted = true // 标记为用户主动中断，供 catch 区分「已停止」与真失败
    abortText() // 兜底中断管线进行中的 runText
    agentAbort?.abort()
    agentAbort = null
    set({ agentBusy: false, agentStage: undefined, agentTrace: undefined })
    void flushLogs()
  },

  generateAllAssets: async () => {
    if (get().batch.running || !get().doc) return
    // 只批量出图类资产（角色/场景/物品），跳过 audio/clip + 已出图的
    const ids = get().doc!.assets.filter((a) => (a.type === 'role' || a.type === 'scene' || a.type === 'prop') && !a.refImageId).map((a) => a.id)
    if (!ids.length) return
    set({ batch: { running: true, label: `生成资产 0/${ids.length}` } })
    try {
      await runTaskQueue(independentTasks(ids.map((id) => ({ id })), 'image', (item) => get().generateAsset(item.id), (item) => item.id), {
        limits: limitsFromConcurrency(get().doc!.meta.concurrency),
        onProgress: (p) => set({ batch: { running: true, label: `生成资产 ${p.done}/${p.total}` } }),
      })
    } finally {
      set({ batch: { running: false } })
    }
  },

  /**
   * 宫格关键帧：把同一 sceneId 的连续待生成镜头合成一张分镜板，生成后切成单帧回写。
   * 组内一致性由"同一次生成"保证；组间仍靠资产参考图。失败的组静默退回逐镜生成
   * ——宫格是优化不是前提，不该因为它挂掉就产不出片。
   */
  generateGridKeyframesForPending: async (onLabel) => {
    const doc = get().doc
    if (!doc || !doc.meta.gridKeyframes || !gridSupported()) return 0
    const model = doc.meta.imageModel || useGraphStore.getState().selectedImageModel
    if (!model) return 0
    // 承接镜要用上一镜成品作参考，语义与宫格冲突，交给逐镜路径
    const pending = doc.storyboards.filter((sb) => !sb.keyframeImageId && !sb.chainFromPrev)
    const { groups } = planGridGroups(pending.map((sb) => ({ id: sb.id, index: sb.index, sceneId: sb.sceneId })))
    if (!groups.length) return 0

    let covered = 0
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]
      const latest = get().doc
      if (!latest) break
      onLabel?.(`宫格分镜板 ${i + 1}/${groups.length}（${group.shots.length} 镜）`)
      try {
        const result = await generateGridKeyframes(group, latest.storyboards, latest.assets, latest.meta, model, (text) => onLabel?.(text))
        get().mutate((d) => {
          for (const [storyboardId, imageId] of Object.entries(result.cellImageIds)) {
            const sb = d.storyboards.find((item) => item.id === storyboardId)
            if (!sb) continue
            sb.keyframeImageId = imageId
            sb.gridImageId = result.gridImageId
            sb.state = 'done'
            sb.error = undefined
          }
        })
        covered += Object.keys(result.cellImageIds).length
      } catch (e) {
        logError('grid', 'generate.failed', e, { sceneId: group.sceneId, shots: group.shots.length })
        // 宫格失败会静默退回逐镜，用户看不到任何痕迹。把原因写到组内第一个分镜上，
        // 并保留已落盘的宫格原图 id——排查时要能肉眼看到模型实际画了什么。
        const failedGridImageId = (e as Error & { gridImageId?: string }).gridImageId
        const reason = e instanceof Error ? e.message : String(e)
        get().mutate((d) => {
          const sb = d.storyboards.find((item) => item.id === group.shots[0].id)
          if (!sb) return
          sb.gridError = reason
          if (failedGridImageId) sb.gridImageId = failedGridImageId
        })
      }
    }
    return covered
  },

  generateAllKeyframes: async () => {
    if (get().batch.running || !get().doc) return
    if (![...get().doc!.storyboards].some((s) => !s.keyframeImageId)) return
    set({ batch: { running: true, label: '准备关键帧…' } })
    try {
      await get().generateGridKeyframesForPending((label) => set({ batch: { running: true, label } }))
    } finally {
      set({ batch: { running: false } })
    }
    const pending = [...get().doc!.storyboards].sort((a, b) => a.index - b.index).filter((s) => !s.keyframeImageId)
    if (!pending.length) return
    // 承接链内部必须顺序（后一镜要用前一镜关键帧作参考），链与链之间没有依赖 → 并发。
    // 旧写法是"只要有任意承接镜就整批串行"，40 镜里 3 个承接会拖垮另外 37 个。
    const tasks = chainTasks(pending, 'image', (sb) => get().generateKeyframe(sb.id), (sb) => `#${sb.index + 1}`)
    set({ batch: { running: true, label: `生成关键帧 0/${tasks.length}` } })
    try {
      await runTaskQueue(tasks, {
        limits: limitsFromConcurrency(get().doc!.meta.concurrency),
        onProgress: (p) => set({ batch: { running: true, label: `生成关键帧 ${p.done}/${p.total}${p.failed ? `（${p.label} 失败）` : ''}` } }),
      })
    } finally {
      set({ batch: { running: false } })
    }
  },

  generateAllClips: async () => {
    if (get().batch.running || !get().doc) return
    const pending = [...get().doc!.storyboards]
      .sort((a, b) => a.index - b.index)
      .filter((s) => s.keyframeImageId && !get().doc!.clips.some((c) => c.storyboardId === s.id && c.state === 'done'))
    if (!pending.length) return
    // 同关键帧：承接片段需要上一片段的真实尾帧，链内串行、链间并发；视频走独立通道和更严的 RPM
    const tasks = chainTasks(pending, 'video', (sb) => get().generateClip(sb.id), (sb) => `#${sb.index + 1}`)
    set({ batch: { running: true, label: `生成视频 0/${tasks.length}` } })
    try {
      await runTaskQueue(tasks, {
        limits: limitsFromConcurrency(get().doc!.meta.concurrency),
        onProgress: (p) => set({ batch: { running: true, label: `生成视频 ${p.done}/${p.total}${p.failed ? `（${p.label} 失败）` : ''}` } }),
      })
    } finally {
      set({ batch: { running: false } })
    }
  },

  autoProduce: async () => {
    // 当前集一键生产：资产 → 关键帧 → 视频 → 合成，保持旧入口语义。
    if (get().batch.running || get().film.state === 'composing' || !get().doc) return
    await produceCurrentEpisode(get, set, { manageBatch: true })
  },

  pauseSeriesProduction: () => {
    const batch = get().batch
    if (!batch.running || batch.kind !== 'series' || batch.pauseRequested) return
    set({ batch: { ...batch, pauseRequested: true, label: batch.label ? `${batch.label}（将暂停后续）` : '生成全剧：将暂停后续' } })
  },

  autoProduceSeries: async () => {
    const doc = get().doc
    if (get().batch.running || get().film.state === 'composing' || !doc) return
    const episodes = [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
    if (episodes.length <= 1) {
      await get().autoProduce()
      return
    }
    const pending = pendingEpisodesForSeries(doc)
    if (!pending.length) return
    const startId = doc.currentEpisodeId
    set({ batch: { running: true, label: `生成全剧 0/${pending.length}`, kind: 'series', pauseRequested: false } })
    try {
      for (let i = 0; i < pending.length; i += 1) {
        if (get().batch.pauseRequested) {
          set({ batch: { ...get().batch, running: true, label: `生成全剧已暂停：完成 ${i}/${pending.length}` } })
          break
        }
        const latest = get().doc
        if (!latest) return
        const target = latest.episodes?.find((episode) => episode.id === pending[i].id)
        if (!target) continue
        if (latest.currentEpisodeId !== target.id) get().switchEpisode(target.id)
        try {
          await produceCurrentEpisode(get, set, { labelPrefix: `全剧 ${i + 1}/${pending.length} · E${target.index + 1}`, enforceContinuity: true })
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e)
          logError('production.series', error, { episodeId: target.id, episodeIndex: target.index + 1 })
          setCurrentEpisodeProductionState(get, { status: 'planned', filmError: error })
        }
      }
    } finally {
      const latest = get().doc
      if (startId && latest?.episodes?.some((episode) => episode.id === startId) && latest.currentEpisodeId !== startId) {
        get().switchEpisode(startId)
      }
      set({ batch: { running: false } })
      await get().flush()
    }
  },

  compose: async () => {
    const doc = get().doc
    if (!doc || get().film.state === 'composing') return
    const composeEpisodeId = doc.currentEpisodeId
    const readiness = episodeComposeReadiness(doc)
    if (!readiness.ready) {
      const error = composeReadinessError(readiness)
      set({ film: { state: 'failed', error } })
      setEpisodeProductionState(get, composeEpisodeId, { status: 'planned', filmError: error })
      return
    }
    set({ film: { state: 'composing', text: '开始合成…' } })
    try {
      const path = await composeProject(doc, (text, percent) => set({ film: { state: 'composing', text: percent != null ? `${text} ${percent}%` : text } }))
      set({ film: { state: 'done', path } })
      get().mutate((d) => {
        const episode = d.episodes?.find((item) => item.id === composeEpisodeId)
        if (!episode) return
        Object.assign(episode, { status: 'done' as const, filmPath: path, filmError: undefined, producedAt: Date.now() })
        episode.productionRecap = buildEpisodeProductionRecap(d, episode)
        episode.updatedAt = Date.now()
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      set({ film: { state: 'failed', error } })
      setEpisodeProductionState(get, composeEpisodeId, { status: 'planned', filmError: error })
    }
  },
}))
