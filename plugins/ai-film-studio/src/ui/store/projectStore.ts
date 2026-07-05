/**
 * Toonflow 式重构 · 阶段2b：结构化项目 store（zustand），建立在 domain/persistence 之上。
 *
 * 管理：项目列表(cards) + 当前打开的项目文档(doc) + 各实体增删改 + 防抖落盘。
 * 实体二进制（图/视频）仍存现有资产库；这里只存结构与 assetId 引用。
 * 不兼容老节点图（独立 studio:* 命名空间）。
 */
import { create } from 'zustand'
import * as P from '../domain/persistence'
import type { AgentStep, Asset, AssetImage, AssetVariant, Clip, Episode, ProjectCard, ProjectDoc, ProjectMeta, Script, Storyboard, StoryboardCastRef } from '../domain/types'
import { castRefsForStoryboard } from '../domain/castRefs'
import { assetPrefixLookup, cleanAssetAliases, findAssetByNameOrAlias, mergeAssetAliases } from '../domain/assetAliases'
import { removeVariantScopeReferences } from '../domain/variantScopes'
import type { AgentPlan, PipelineEvent } from '../studio/agent/agent'
import { generateAssetImage, generateDerivativeImage, generateKeyframeImage, generateClipVideo, loadImageBase64, clipLastFrameDataUrl } from '../studio/services/generate'
import { polishAssetPrompt } from '../studio/services/polish'
import { runFlowImage } from '../studio/services/imageFlow'
import { synthVoiceSample, matchRoleVoices } from '../studio/services/audio'
import { maybeSummarize, getMemoryConfig, recallContext } from '../studio/agent/memory'
import { deleteAsset } from '../services/assets'
import { runAgentPipeline, buildToolLoopSystem } from '../studio/agent/agent'
import type { PipelineStage, PipelineStagePlan } from '../studio/agent/agent'
import { runToolLoop } from '../studio/agent/runtime'
import { makeAgentTools } from '../studio/agent/agentTools'
import { resolveAgentEpisodeTarget } from '../studio/agent/episodeTarget'
import { abortText } from '../services/textEngine'
import { useGraphStore } from './graphStore'
import { useAssetStore, type ElementRef, type ElementKind } from './assetStore'
import type { AssetRecord } from '../services/assetRegistry'
import { useAgentDeployStore } from './agentDeployStore'
import { splitNovelChapters, extractEvents } from '../studio/services/novel'
import { composeProject } from '../studio/services/compose'
import { syncTracksFromStoryboards, selectedClipId } from '../studio/services/track'
import { mapPool } from '../studio/services/concurrency'
import { generateTrackVideoPrompt } from '../studio/services/videoPrompt'
import { assertPreflight, preflightClipGeneration, preflightKeyframeGeneration, type GenerationPreflightIssue } from '../studio/services/generationPreflight'
import { supportsVideoReferenceImages } from '../studio/services/videoReferences'
import { variantScopePatchForUse } from '../studio/services/continuityReport'
import { buildEpisodeProductionRecap, episodeComposeReadiness, episodeProductionContinuityBlockers, formatEpisodeProductionContinuityError, hasEpisodeProductionState, invalidateCurrentEpisodeProduction, invalidateEpisodesUsingAsset, invalidateEpisodesUsingCastRef, invalidateProductionScope, missingReferencedVariantImages, pendingEpisodesForSeries, productionScopeForStoryboard, productionScopeForTrack, projectDocForProductionScope } from '../studio/services/episodeProduction'
import { flushLogs, logError, logInfo } from '../services/localLog'
import { useProviderStore } from './providerStore'

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
  /** 从全局素材库把一张图片绑成项目资产（角色/场景/物品的参考图）。projectId 为当前打开项目时走 mutate，否则直接读写目标 doc。返回新资产 id；非图片/无 assetId 返回 ''。 */
  importImageToProject: (projectId: string, rec: Pick<AssetRecord, 'assetId' | 'name' | 'type'>, kind: 'role' | 'scene' | 'prop') => Promise<string>
  /** 从全局角色/场景库把元素绑成项目资产（带 refImageId + 桥接 elementId）。kind 显式指定时优先（拖入「资产」某分组时按该组类别），否则按 el.kind 映射。 */
  importElementToProject: (projectId: string, el: ElementRef, kind?: 'role' | 'scene' | 'prop') => Promise<string>
  /** 把项目里的角色/场景资产保存（回流）到全局角色场景库（复用 elementId，幂等更新）。 */
  promoteAssetToElement: (id: string) => Promise<void>
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
  setStoryboardCastVariant: (storyboardId: string, assetId: string, variantId: string | undefined) => void
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

  // 制片 Agent（结构化方案：一句话/故事 → 剧本+资产+分镜）
  runAgent: (userText: string) => Promise<void>
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

    const assetIds = get().doc!.assets.filter((a) => (a.type === 'role' || a.type === 'scene' || a.type === 'prop') && !a.refImageId).map((a) => a.id)
    if (assetIds.length) {
      const c = get().doc!.meta.concurrency ?? 3
      setLabel(`生成资产 0/${assetIds.length}`)
      await mapPool(assetIds, c, (id) => get().generateAsset(id), (done, total) => setLabel(`生成资产 ${done}/${total}`))
    }

    const variantRefs = missingReferencedVariantImages(get().doc!)
    if (variantRefs.length) {
      const c = get().doc!.meta.concurrency ?? 3
      setLabel(`生成形态参考图 0/${variantRefs.length}`)
      await mapPool(
        variantRefs,
        c,
        ({ assetId, variantId }) => get().generateAssetVariant(assetId, variantId),
        (done, total) => setLabel(`生成形态参考图 ${done}/${total}`),
      )
    }

    if (opts.enforceContinuity) {
      const latest = get().doc
      const episode = latest?.episodes?.find((item) => item.id === latest.currentEpisodeId)
      const issues = latest && episode ? episodeProductionContinuityBlockers(latest, episode) : []
      if (episode && issues.length) throw new Error(formatEpisodeProductionContinuityError(episode, issues))
    }

    const keyframeIds = [...(get().doc?.storyboards ?? [])]
      .sort((a, b) => a.index - b.index)
      .filter((s) => !s.keyframeImageId)
      .map((s) => s.id)
    if (keyframeIds.length) {
      const current = get().doc!
      const chained = current.storyboards.some((s) => s.chainFromPrev)
      const c = chained ? 1 : (current.meta.concurrency ?? 3)
      setLabel(`生成关键帧 0/${keyframeIds.length}`)
      await mapPool(keyframeIds, c, (id) => get().generateKeyframe(id), (done, total) => setLabel(`生成关键帧 ${done}/${total}`))
    }

    const clipIds = [...(get().doc?.storyboards ?? [])]
      .sort((a, b) => a.index - b.index)
      .filter((s) => s.keyframeImageId && !get().doc!.clips.some((c) => c.storyboardId === s.id && c.state === 'done'))
      .map((s) => s.id)
    if (clipIds.length) {
      const current = get().doc!
      const chained = current.storyboards.some((s) => s.chainFromPrev)
      const c = chained ? 1 : (current.meta.concurrency ?? 3)
      setLabel(`生成视频 0/${clipIds.length}`)
      await mapPool(clipIds, c, (id) => get().generateClip(id), (done, total) => setLabel(`生成视频 ${done}/${total}`))
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

function agentVariantId(asset: Asset, token: unknown): string | undefined {
  const text = cleanString(token)
  if (!text) return undefined
  const lower = text.toLowerCase()
  return asset.variants?.find((variant) => variant.id === text)?.id ?? asset.variants?.find((variant) => variant.label.toLowerCase() === lower)?.id ?? text
}

function agentRoleInShot(value: unknown): StoryboardCastRef['roleInShot'] | undefined {
  return value === 'lead' || value === 'supporting' || value === 'background' ? value : undefined
}

function agentScopeKind(value: unknown): 'episode' | 'scene' | 'storyboard' | undefined {
  return value === 'episode' || value === 'scene' || value === 'storyboard' ? value : undefined
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
    return variantToken ? { assetId: asset.id, variantId: agentVariantId(asset, variantToken) } : { assetId: asset.id }
  }
  return undefined
}

function agentCastRefFromObject(d: ProjectDoc, value: Record<string, unknown>): StoryboardCastRef | undefined {
  const asset = agentCastAsset(d, value.assetId) ?? agentCastAsset(d, value.assetName) ?? agentCastAsset(d, value.name)
  if (!asset) return agentCastRefFromString(d, value.name ?? value.assetName)
  return {
    assetId: asset.id,
    variantId: agentVariantId(asset, value.variantId ?? value.variantLabel ?? value.variant ?? value.label),
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

function scopeAgentStoryboardVariants(d: ProjectDoc, episode: Episode | undefined, storyboard: Storyboard, refs: StoryboardCastRef[], scopeKind?: 'episode' | 'scene' | 'storyboard'): void {
  if (!episode) return
  for (const ref of refs) {
    if (!ref.variantId) continue
    const asset = d.assets.find((item) => item.id === ref.assetId)
    const variant = asset?.variants?.find((item) => item.id === ref.variantId)
    const patch = variant ? variantScopePatchForUse(variant, episode, storyboard, scopeKind) : undefined
    if (asset && variant && patch) {
      asset.variants = asset.variants?.map((item) => (item.id === variant.id ? { ...item, ...patch } : item))
    }
  }
}

function applyAgentStoryboards(d: ProjectDoc, storyboards: AgentPlan['storyboards'] | undefined, applied: AgentApplySummary): void {
  const currentEpisode = d.episodes?.find((item) => item.id === d.currentEpisodeId)
  for (const sb of storyboards ?? []) {
    if (!sb?.videoDesc) continue
    const castRefs = agentStoryboardCastRefs(d, sb)
    const cast = [...new Set(castRefs.map((ref) => ref.assetId))]
    const hasCastInput = (Array.isArray(sb.cast) && sb.cast.length > 0) || (Array.isArray(sb.castRefs) && sb.castRefs.length > 0)
    const sceneId = cleanString(sb.sceneId)
    const scopeKind = agentScopeKind(sb.scopeKind)
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
      if (dlgs) target.dialogues = dlgs
      if (typeof sb.chainFromPrev === 'boolean') target.chainFromPrev = sb.chainFromPrev
      target.keyframeImageId = undefined
      target.state = 'idle'
      target.error = undefined
      if (sb.ensureScope === true || scopeKind) scopeAgentStoryboardVariants(d, currentEpisode, target, castRefs, scopeKind)
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
      dialogues: dlgs ?? [],
      shouldGenerateImage: true,
      chainFromPrev: sb.chainFromPrev === true,
      state: 'idle',
    })
    const added = d.storyboards[d.storyboards.length - 1]
    if (sb.ensureScope === true || scopeKind) scopeAgentStoryboardVariants(d, currentEpisode, added, castRefs, scopeKind)
    applied.storyboardsAdded.push({ id, index: index + 1, desc: sb.videoDesc.slice(0, 120) })
  }
  if ((storyboards ?? []).some((sb) => sb?.videoDesc)) {
    syncTracksFromStoryboards(d)
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
      const deleted = episodes[deleteIndex]
      const deletedStoryboardIds = deleted.storyboards.map((storyboard) => storyboard.id)
      const deletingCurrent = d.currentEpisodeId === id
      d.episodes = episodes.filter((e) => e.id !== id)
      removeVariantScopeReferences(d, { episodeIds: [id], storyboardIds: deletedStoryboardIds })
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
      window.mulby?.notification?.show('仅图片素材可加入项目素材（视频/音频请在时间线/配音处使用）', 'warning')
      return ''
    }
    return writeAssetToProject(get, projectId, buildLibraryAsset({ kind, name: rec.name || '素材', assetId: rec.assetId }))
  },

  importElementToProject: async (projectId, el, kind) => {
    const k: Asset['type'] = kind ?? (el.kind === 'scene' ? 'scene' : el.kind === 'prop' ? 'prop' : 'role')
    // 元素参考图优先取正视图，回退首张参考图（与画布 insertElementNode 取图口径一致）
    const assetId = el.views?.front ?? el.refAssetIds?.[0]
    return writeAssetToProject(
      get,
      projectId,
      buildLibraryAsset({ kind: k, name: el.name, assetId, prompt: el.prompt, desc: el.description, elementId: el.id })
    )
  },

  promoteAssetToElement: async (id) => {
    const doc = get().doc
    if (!doc) return
    const a = doc.assets.find((x) => x.id === id)
    if (!a) return
    if (!a.refImageId) {
      window.mulby?.notification?.show('该资产还没有参考图，先生成或选择一张图片', 'warning')
      return
    }
    const kind: ElementKind = a.type === 'scene' ? 'scene' : a.type === 'prop' ? 'prop' : 'character'
    // 复用 elementId（幂等更新已存在的库元素），首次保存则新建并回写桥接 id
    const el = await useAssetStore.getState().saveElement({
      id: a.elementId,
      kind,
      name: a.name,
      description: a.desc,
      prompt: a.prompt,
      refAssetIds: [a.refImageId],
    })
    get().mutate((d) => {
      const x = d.assets.find((y) => y.id === id)
      if (x) x.elementId = el.id
    })
    window.mulby?.notification?.show(`已保存「${a.name}」到角色 / 场景库`, 'success')
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
      removeVariantScopeReferences(d, { storyboardIds: [id] })
      // 删除后重排 index 保持连续：否则 index 出现空洞，新建分镜会与现有撞 index → 排序/承接取错相邻镜
      d.storyboards.sort((a, b) => a.index - b.index).forEach((s, i) => (s.index = i))
      syncTracksFromStoryboards(d) // 段内去该分镜 + 空段删除 + order 重排
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
    setAssetVariantState(get, assetId, variantId, { state: 'generating', error: undefined })
    try {
      const refImageId = await generateDerivativeImage(child, asset, doc.meta)
      setAssetVariantState(get, assetId, variantId, { refImageId, state: 'done', error: undefined })
    } catch (e) {
      setAssetVariantState(get, assetId, variantId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
  setStoryboardCastVariant: (storyboardId, assetId, variantId) =>
    get().mutate((d) => {
      const sb = d.storyboards.find((s) => s.id === storyboardId)
      if (!sb) return
      if (!sb.associateAssetIds.includes(assetId)) sb.associateAssetIds.push(assetId)
      const refs = castRefsForStoryboard(sb)
      const i = refs.findIndex((ref) => ref.assetId === assetId)
      if (i >= 0) refs[i] = { ...refs[i], variantId: variantId || undefined }
      else refs.push({ assetId, variantId: variantId || undefined })
      sb.castRefs = refs
      invalidateCurrentEpisodeProduction(d)
    }),
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

  runAgent: async (userText) => {
    const doc0 = get().doc
    if (!doc0 || !userText.trim() || get().agentBusy) return
    const runId = P.newId('run_')
    const targetEpisode = resolveAgentEpisodeTarget(doc0, userText)
    const writeEpisodeId = targetEpisode?.episode.id ?? doc0.currentEpisodeId
    const logCtx = { runId, projectId: doc0.meta.id, projectName: doc0.meta.name, writeEpisodeId, targetEpisodeMatch: targetEpisode?.match }
    const now = Date.now()
    get().mutate((d) => d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'user', content: userText, createTime: now }))
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
      const plan = await runAgentPipeline(() => get().doc, userText, onPipeline, (stage, fragment) => {
        applyStagePlan(stage, fragment)
      }, { episodeId: writeEpisodeId })
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
    const c = get().doc!.meta.concurrency ?? 3 // 资产相互独立 → 并发
    set({ batch: { running: true, label: `生成资产 0/${ids.length}` } })
    try {
      await mapPool(ids, c, (id) => get().generateAsset(id), (done, total) => set({ batch: { running: true, label: `生成资产 ${done}/${total}` } }))
    } finally {
      set({ batch: { running: false } })
    }
  },

  generateAllKeyframes: async () => {
    if (get().batch.running || !get().doc) return
    const ids = [...get().doc!.storyboards]
      .sort((a, b) => a.index - b.index)
      .filter((s) => !s.keyframeImageId)
      .map((s) => s.id)
    if (!ids.length) return
    // 有承接镜头 → 串行(concurrency=1)保连贯(承接需上一镜关键帧)；全无承接 → 并发提速
    const chained = get().doc!.storyboards.some((s) => s.chainFromPrev)
    const c = chained ? 1 : (get().doc!.meta.concurrency ?? 3)
    set({ batch: { running: true, label: `生成关键帧 0/${ids.length}` } })
    try {
      await mapPool(ids, c, (id) => get().generateKeyframe(id), (done, total) => set({ batch: { running: true, label: `生成关键帧 ${done}/${total}` } }))
    } finally {
      set({ batch: { running: false } })
    }
  },

  generateAllClips: async () => {
    if (get().batch.running || !get().doc) return
    const ids = [...get().doc!.storyboards]
      .sort((a, b) => a.index - b.index)
      .filter((s) => s.keyframeImageId && !get().doc!.clips.some((c) => c.storyboardId === s.id && c.state === 'done'))
      .map((s) => s.id)
    if (!ids.length) return
    // 有承接镜头 → 串行保顺接(承接片段需上一片段尾帧)；全无承接 → 并发提速
    const chained = get().doc!.storyboards.some((s) => s.chainFromPrev)
    const c = chained ? 1 : (get().doc!.meta.concurrency ?? 3)
    set({ batch: { running: true, label: `生成视频 0/${ids.length}` } })
    try {
      await mapPool(ids, c, (id) => get().generateClip(id), (done, total) => set({ batch: { running: true, label: `生成视频 ${done}/${total}` } }))
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
