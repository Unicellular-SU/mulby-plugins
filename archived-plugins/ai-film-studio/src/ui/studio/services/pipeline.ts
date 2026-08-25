/**
 * 小说 → 成片主线流水线。
 *
 * 旧版的「生成全剧」第一行就是 `if (doc.storyboards.length === 0) return`——它只覆盖
 * 分镜之后的四步（关键帧 → 视频 → 合成）。前面的拆章、分集、剧本、资产、分镜全靠对话式
 * Agent，用户要打七八轮字才能到达那个按钮能用的状态。
 *
 * 这里把整条链做成一个**有状态、可从任意阶段进入、可中断恢复**的阶段机：每个阶段先问
 * "我的产物是不是已经在了"，在就跳过。于是"接着上次继续"和"从头跑一遍"是同一个入口。
 *
 * 阶段本身不碰 store，全部依赖注入（PipelineActions），既便于自测也避免和 zustand 耦合。
 */
import type { Episode, ProjectDoc } from '../../domain/types'

export type PipelineStageId = 'chapters' | 'events' | 'episodes' | 'script' | 'assets' | 'storyboard' | 'media'
export type PipelineStageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed'

export interface PipelineStageStatus {
  id: PipelineStageId
  label: string
  state: PipelineStageState
  detail?: string
  error?: string
  progress?: { done: number; total: number }
}

export const PIPELINE_STAGES: { id: PipelineStageId; label: string }[] = [
  { id: 'chapters', label: '拆章' },
  { id: 'events', label: '章节事件' },
  { id: 'episodes', label: '分集规划' },
  { id: 'script', label: '剧本' },
  { id: 'assets', label: '资产与参考图' },
  { id: 'storyboard', label: '分镜' },
  { id: 'media', label: '关键帧 / 视频 / 成片' },
]

export interface PipelineOptions {
  /** 目标集数；缺省取系列圣经的计划集数，再缺省按每 3 章一集估 */
  targetEpisodeCount?: number
  /** true 时即使阶段产物已存在也重跑（"重新生成"入口） */
  force?: boolean
  /** 只跑到这一阶段为止，用于"先看看剧本对不对"这种分步确认 */
  stopAfter?: PipelineStageId
}

export interface PipelineActions {
  getDoc: () => ProjectDoc | null | undefined
  /** 章节事件提取（已有 event 的章节内部会跳过） */
  extractAllEvents: () => Promise<void>
  /** 建 N 个空剧集，返回新建的 id */
  createEpisodes: (count: number) => string[]
  setEpisodeNovelChapters: (episodeId: string, chapterIds: string[]) => void
  renameEpisode: (episodeId: string, title: string) => void
  updateEpisodePlan: (episodeId: string, patch: { hook?: string; conflict?: string; cliffhanger?: string }) => void
  switchEpisode: (episodeId: string) => void
  /** 规划整本书的分集断点 */
  planEpisodeBreaks: (targetCount: number) => Promise<{ title: string; summary: string; chapterIndexes: number[] }[]>
  /** 建全局故事圣经（内部判断是否需要重跑） */
  ensureStoryBible: (onProgress?: (done: number, total: number) => void) => Promise<void>
  /** 为当前剧集跑一个 Agent 阶段（复用现有分阶段管线） */
  runAgentStage: (stage: 'script' | 'assets' | 'storyboard', userText: string) => Promise<void>
  /** 给所有缺主图的资产出图 */
  generateAllAssets: () => Promise<void>
  /** 当前集：关键帧 → 视频 → 合成 */
  produceCurrentEpisode: () => Promise<void>
  onStatus: (stages: PipelineStageStatus[]) => void
  /** 用户请求中断；每个阶段边界检查一次 */
  isAborted: () => boolean
}

export interface PipelineResult {
  stages: PipelineStageStatus[]
  completed: boolean
  abortedAt?: PipelineStageId
}

function episodesOf(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function storyboardsOf(doc: ProjectDoc, episode: Episode) {
  return episode.id === doc.currentEpisodeId ? doc.storyboards : episode.storyboards
}

function scriptsOf(doc: ProjectDoc, episode: Episode) {
  return episode.id === doc.currentEpisodeId ? doc.scripts : episode.scripts
}

/** 目标集数：显式指定 > 系列圣经计划 > 已建剧集数 > 按每 3 章一集估 */
export function resolveTargetEpisodeCount(doc: ProjectDoc, explicit?: number): number {
  if (explicit && explicit > 0) return Math.floor(explicit)
  const planned = doc.seriesBible?.plannedEpisodeCount
  if (planned && planned > 0) return Math.floor(planned)
  const existing = doc.episodes?.length ?? 0
  if (existing > 1) return existing
  return Math.max(1, Math.ceil((doc.novel.length || 1) / 3))
}

/**
 * 判断每个阶段是否已经有产物——这就是断点续传的全部依据。
 * 不存独立的进度状态：进度是从文档推导出来的，所以手工改了内容后再跑也能自洽。
 */
export function inspectPipeline(doc: ProjectDoc): Record<PipelineStageId, boolean> {
  const episodes = episodesOf(doc)
  const withChapters = episodes.filter((episode) => (episode.novelChapterIds ?? []).length > 0)
  const hasNovel = doc.novel.length > 0
  return {
    chapters: hasNovel,
    events: hasNovel && doc.novel.every((chapter) => !!chapter.event?.trim()),
    // 有原著时要求章节已分配；纯原创（无原著）时有剧集即可
    episodes: episodes.length > 0 && (!hasNovel || withChapters.length === episodes.length),
    script: episodes.length > 0 && episodes.every((episode) => scriptsOf(doc, episode).some((script) => !!script.content?.trim())),
    assets: doc.assets.some((asset) => asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop'),
    storyboard: episodes.length > 0 && episodes.every((episode) => storyboardsOf(doc, episode).length > 0),
    media: episodes.length > 0 && episodes.every((episode) => !!episode.filmPath),
  }
}

const STAGE_ORDER = PIPELINE_STAGES.map((stage) => stage.id)

function initialStages(): PipelineStageStatus[] {
  return PIPELINE_STAGES.map((stage) => ({ ...stage, state: 'pending' as const }))
}

/**
 * 跑主线。返回每个阶段的最终状态；任一阶段 failed 就停下——后续阶段依赖它的产物，
 * 硬跑下去只会产出一堆垃圾素材然后在合成时报一个和根因无关的错。
 */
export async function runNovelToFilmPipeline(actions: PipelineActions, options: PipelineOptions = {}): Promise<PipelineResult> {
  const stages = initialStages()
  const emit = () => actions.onStatus(stages.map((stage) => ({ ...stage })))
  const at = (id: PipelineStageId) => stages[STAGE_ORDER.indexOf(id)]
  const requireDoc = (): ProjectDoc => {
    const doc = actions.getDoc()
    if (!doc) throw new Error('项目已关闭')
    return doc
  }

  emit()

  for (const stageId of STAGE_ORDER) {
    const stage = at(stageId)
    if (actions.isAborted()) return { stages, completed: false, abortedAt: stageId }

    const doc = requireDoc()
    const satisfied = inspectPipeline(doc)[stageId]
    if (satisfied && !options.force) {
      stage.state = 'skipped'
      stage.detail = '已有产物，跳过'
      emit()
      if (options.stopAfter === stageId) return { stages, completed: true }
      continue
    }

    stage.state = 'running'
    stage.error = undefined
    emit()

    try {
      await runStage(stageId, actions, options, stage, emit)
      stage.state = 'done'
    } catch (error) {
      stage.state = 'failed'
      stage.error = error instanceof Error ? error.message : String(error)
      emit()
      return { stages, completed: false }
    }
    emit()
    if (options.stopAfter === stageId) return { stages, completed: true }
  }

  return { stages, completed: true }
}

async function runStage(
  stageId: PipelineStageId,
  actions: PipelineActions,
  options: PipelineOptions,
  stage: PipelineStageStatus,
  emit: () => void,
): Promise<void> {
  const doc = () => {
    const current = actions.getDoc()
    if (!current) throw new Error('项目已关闭')
    return current
  }
  const setProgress = (done: number, total: number, detail?: string) => {
    stage.progress = { done, total }
    if (detail) stage.detail = detail
    emit()
  }

  if (stageId === 'chapters') {
    if (!doc().novel.length) throw new Error('还没有导入原著。先在「原著」页粘贴或导入正文。')
    stage.detail = `${doc().novel.length} 章`
    return
  }

  if (stageId === 'events') {
    await actions.extractAllEvents()
    stage.detail = `${doc().novel.filter((chapter) => !!chapter.event?.trim()).length}/${doc().novel.length} 章已提取`
    // 故事圣经依赖章节事件，紧跟着一起建：之后每集只带圣经 + 本集章节，上下文不再随小说长度膨胀
    await actions.ensureStoryBible((done, total) => setProgress(done, total, `扫描全书建故事圣经 ${done}/${total}`))
    const bible = doc().storyBible
    if (bible) stage.detail = `${stage.detail} · 圣经 ${bible.characters.length} 人物 / ${bible.locations.length} 场景 / ${bible.props.length} 道具`
    return
  }

  if (stageId === 'episodes') {
    const current = doc()
    const target = resolveTargetEpisodeCount(current, options.targetEpisodeCount)
    const breaks = current.novel.length ? await actions.planEpisodeBreaks(target) : []
    if (!breaks.length) {
      const missing = Math.max(0, target - (current.episodes?.length ?? 0))
      if (missing > 0) actions.createEpisodes(missing)
      stage.detail = `${doc().episodes?.length ?? 0} 集（无原著，按目标集数建空剧集）`
      return
    }
    const existing = episodesOf(current)
    const missing = Math.max(0, breaks.length - existing.length)
    if (missing > 0) actions.createEpisodes(missing)
    const episodes = episodesOf(doc())
    breaks.forEach((item, index) => {
      const episode = episodes[index]
      if (!episode) return
      const chapterIds = item.chapterIndexes.map((chapterIndex) => doc().novel[chapterIndex]?.id).filter((id): id is string => !!id)
      actions.setEpisodeNovelChapters(episode.id, chapterIds)
      if (item.title) actions.renameEpisode(episode.id, item.title)
      if (item.summary) actions.updateEpisodePlan(episode.id, { conflict: item.summary })
    })
    stage.detail = `${breaks.length} 集，按情节弧断点切分`
    return
  }

  if (stageId === 'script' || stageId === 'assets' || stageId === 'storyboard') {
    const episodes = episodesOf(doc())
    if (!episodes.length) throw new Error('还没有剧集，无法生成本阶段内容。')

    // 资产是项目级共享的：只在第一集提炼一次，后续集复用，否则每集都会新建一批同名资产
    if (stageId === 'assets') {
      const startId = doc().currentEpisodeId
      actions.switchEpisode(episodes[0].id)
      setProgress(0, 2, '提炼角色 / 场景 / 道具')
      await actions.runAgentStage('assets', '根据故事圣经和已有剧本，提炼全剧需要的角色、场景和关键道具资产。同一对象只建一个资产，别名写进 aliases。')
      setProgress(1, 2, '生成参考图')
      await actions.generateAllAssets()
      setProgress(2, 2)
      if (startId) actions.switchEpisode(startId)
      const assets = doc().assets.filter((asset) => asset.type === 'role' || asset.type === 'scene' || asset.type === 'prop')
      stage.detail = `${assets.length} 个资产，${assets.filter((asset) => !!asset.refImageId).length} 个已出图`
      return
    }

    const prompt = stageId === 'script'
      ? '把本集分配到的原著章节改编成短剧剧本：分场、对白、动作。只写本集范围，跨集伏笔点到为止。'
      : '把本集剧本拆成可执行镜头表。同一空间或连续动作复用同一个 sceneId；外观默认沿用上一镜，只有剧情真的发生换装/受伤/时间跳跃时才在那一镜写 stateChanges。'

    for (let i = 0; i < episodes.length; i += 1) {
      if (actions.isAborted()) throw new Error('已中断')
      const episode = episodes[i]
      const latest = doc()
      const hasOutput = stageId === 'script'
        ? scriptsOf(latest, episode).some((script) => !!script.content?.trim())
        : storyboardsOf(latest, episode).length > 0
      if (hasOutput && !options.force) {
        setProgress(i + 1, episodes.length, `E${episode.index + 1} 已有产物，跳过`)
        continue
      }
      setProgress(i, episodes.length, `E${episode.index + 1}「${episode.title}」`)
      actions.switchEpisode(episode.id)
      await actions.runAgentStage(stageId, prompt)
    }
    setProgress(episodes.length, episodes.length)
    stage.detail = `${episodes.length} 集已${stageId === 'script' ? '成稿' : '拆镜'}`
    return
  }

  // media：逐集跑 关键帧 → 视频 → 合成，复用已有的单集生产
  const episodes = episodesOf(doc())
  if (!episodes.length) throw new Error('还没有剧集。')
  for (let i = 0; i < episodes.length; i += 1) {
    if (actions.isAborted()) throw new Error('已中断')
    const episode = episodes[i]
    if (episode.filmPath && !options.force) {
      setProgress(i + 1, episodes.length, `E${episode.index + 1} 已成片，跳过`)
      continue
    }
    setProgress(i, episodes.length, `E${episode.index + 1}「${episode.title}」`)
    actions.switchEpisode(episode.id)
    await actions.produceCurrentEpisode()
  }
  setProgress(episodes.length, episodes.length)
  const produced = episodesOf(doc()).filter((episode) => !!episode.filmPath).length
  stage.detail = `${produced}/${episodes.length} 集已成片`
}
