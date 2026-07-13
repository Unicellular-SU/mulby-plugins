import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { useUi } from '../store/uiStore'
import { arrayBufferToBase64 } from '../util'
import { aiLimiter } from './limiter'
import { generateText } from './aiText'
import { generateImage } from './aiImage'
import { saveBase64, mimeToExt, toFileUrl, loadImageInput } from './media'
import { resolveGenInputs, findUnresolvedMentions, buildMaterials } from './references'
import { useProviders } from '../store/providerStore'
import { runVideoJob, runTts, resumeVideoJob } from './providers/engine'
import { snapDuration } from './videoSpecs'
import { videoStyleTag } from './stylePacks'
import { resolveModelId } from './models'
import { PLUGIN_ID } from './persistence'
import { toast } from '../store/toastStore'

const limiter = aiLimiter // 共享并发池（card 生成 + 360/局部修复 共用，统一限流）
const aborters = new Map<string, string>() // cardId -> requestId（文/图：ai.abort）
const videoAborts = new Map<string, AbortController>() // cardId -> 视频任务取消器（轮询循环）
const canceledCards = new Set<string>() // 排队中被用户「停止」的卡：出队时早退，不真正起跑
// 每次生成分配一个 runId（cardId -> 当前 runId）。stopCard 使其失效；生成体内所有卡片写入都经 commit 校验
// runId 仍为当前，否则丢弃——统一堵死「取消后底层调用照跑、成功路径把卡翻回 done 复活」的三条路径
//（rid 未到达 / images.edit 无流式回调 / TTS 无 abort 通道，均无法真正中止底层，但结果作废即可）。
let runSeq = 0
const runIds = new Map<string, number>()
function isCurrentRun(cardId: string, runId: number): boolean {
  return runIds.get(cardId) === runId
}

function ai(): any {
  return (window as any).mulby.ai
}

// 完成提示音（WebAudio 短促双衰减 blip，无需打包音频文件）
function playDoneSound() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g)
    g.connect(ctx.destination)
    o.type = 'sine'
    o.frequency.setValueAtTime(660, ctx.currentTime)
    o.frequency.setValueAtTime(990, ctx.currentTime + 0.09)
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28)
    o.start()
    o.stop(ctx.currentTime + 0.3)
    setTimeout(() => {
      try {
        void ctx.close()
      } catch {
        /* ignore */
      }
    }, 500)
  } catch {
    /* ignore */
  }
}

// 生成成功提示：可在任务中心开关，仅成功终态一次；窗口失焦时额外发系统通知
function notifyDone(_cardId: string) {
  if (!useUi.getState().notifyDone) return
  playDoneSound()
  if (typeof document !== 'undefined' && document.hidden) {
    try {
      ;(window as any).mulby?.notification?.show?.('生成完成', 'success')
    } catch {
      /* ignore */
    }
  }
}

export function canGenerate(kind: string): boolean {
  return kind === 'text' || kind === 'image' || kind === 'video' || kind === 'audio'
}

// 批量生成所有选中的可生成卡片（分镜扇出 → 一键出图）
export function generateSelected(): void {
  const g = useGraph.getState()
  const board = g.getActiveBoard()
  for (const id of [...g.selectedIds]) {
    const c = board.cards[id]
    if (c && canGenerate(c.kind) && c.status !== 'running' && c.status !== 'queued') {
      void generateCard(id)
    }
  }
}

export async function generateCard(cardId: string): Promise<void> {
  const g0 = useGraph.getState()
  const card0 = g0.getActiveBoard().cards[cardId]
  if (!card0) return
  // 并发守卫：本卡已在生成中/排队中 → 忽略重复触发（重新生成请先「停止」）。防两个 limiter 任务写同一
  // cardId 致 aborters/videoAborts 互相覆盖（停止只能中止其一、先结束方的 finally 又删掉另一方取消器）+ 双倍消耗配额。
  // 未设防的入口有 MediaToolbox「重新生成」、NodeEditor direct 预设等；与 generateSelected 的既有守卫一致。
  if (card0.status === 'running' || card0.status === 'queued') return
  canceledCards.delete(cardId) // 清理上一轮可能残留的取消标记，避免本轮被误早退
  if (!canGenerate(card0.kind)) {
    g0.updateCard(cardId, { status: 'error', error: '该类型卡片不支持生成（素材/分组/便签卡仅用于组织与引用）' })
    return
  }
  if ((card0.kind === 'text' || card0.kind === 'image') && !card0.prompt?.trim()) {
    g0.updateCard(cardId, { status: 'error', error: '请先填写提示词' })
    return
  }

  const board0 = g0.getActiveBoard()
  const mats0 = buildMaterials(card0, board0)
  const badMentions = findUnresolvedMentions(card0.prompt || '', mats0)
  if (badMentions.length) {
    toast(`提示词中有无效 @ 引用：${badMentions.join('、')}（将忽略，改用全部素材）`, 'info')
  }

  // 默认模型回填：卡片未选 → 工程默认 → 可用列表第一个（让批量/分镜卡无需逐个选模型）
  if ((card0.kind === 'image' || card0.kind === 'text') && !card0.modelId) {
    const def = card0.kind === 'image' ? g0.project.defaultImageModel : g0.project.defaultTextModel
    const resolved = await resolveModelId(card0.kind, null, def ?? null)
    if (resolved) g0.updateCard(cardId, { modelId: resolved })
  }

  g0.updateCard(cardId, { status: 'queued', error: null, progress: 0 })
  useTask.getState().inc()

  await limiter(async () => {
    // 排队期间被「停止」：出队时直接早退，不消耗额度（修复排队态点停止无效）
    if (canceledCards.has(cardId)) {
      canceledCards.delete(cardId)
      useTask.getState().dec()
      useGraph.getState().updateCard(cardId, { status: 'idle', progress: 0 })
      return
    }
    const g = useGraph.getState()
    // 按 id 取拥有该卡的画布（任务可能排队，出队时活动画布已被切换）——避免读/写到错的画布
    const board = g.project.boards.find((b) => b.cards[cardId]) ?? g.getActiveBoard()
    const card = board.cards[cardId]
    if (!card) {
      useTask.getState().dec()
      return
    }
    // 本次生成的 runId：晚于此的 stopCard/新生成会使其失效，令下面 commit 丢弃陈旧写入
    const runId = ++runSeq
    runIds.set(cardId, runId)
    // 门控写入：仅当本卡仍属于本次 run 时才写。取消后（runId 失效）底层调用即便跑完，其
    // 进度/预览/终态 done 全部落空 → 卡片停在 stopCard 置的 idle，不再「复活」。
    const commit = (patch: Record<string, unknown>) => {
      if (isCurrentRun(cardId, runId)) useGraph.getState().updateCard(cardId, patch)
    }
    commit({ status: 'running', progress: 0, error: null })
    try {
      if (card.kind === 'text') {
        const text = await generateText(
          card,
          board,
          (acc) => commit({ text: acc, progress: 0.5 }),
          (rid) => aborters.set(cardId, rid)
        )
        commit({ status: 'done', progress: 1, text })
      } else if (card.kind === 'image') {
        const res = await generateImage(
          card,
          board,
          (p, preview) => commit({ progress: p, ...(preview ? { assetUrl: preview } : {}) }),
          (rid) => aborters.set(cardId, rid)
        )
        // 已取消：底层出图作废，不落盘、不写卡（避免为死卡产生孤儿媒体）
        if (!isCurrentRun(cardId, runId)) throw new DOMException('已取消', 'AbortError')
        const projectId = useGraph.getState().project.id
        const ext = mimeToExt(res.mime)
        // 多图：全部存进本卡的 meta.results（堆叠展示），主图 = 第一张
        const results: Array<{ url: string; localPath: string; mime: string }> = []
        for (let i = 0; i < res.images.length; i++) {
          const s = await saveBase64(projectId, `${cardId}_${i}`, res.images[i], ext)
          results.push({ url: s.url, localPath: s.path, mime: res.mime })
        }
        const base0 = useGraph.getState().getCard(cardId)
        commit({
          status: 'done',
          progress: 1,
          assetUrl: results[0].url,
          assetLocalPath: results[0].localPath,
          mime: res.mime,
          meta: { ...(base0?.meta || {}), results, ...(card.params?.pano ? { pano: true } : {}) }
        })
      } else if (card.kind === 'video') {
        const cfg = useProviders.getState().activeFor('video')
        if (!cfg) throw new Error('未配置视频 Provider（右上角“设置”）')
        const key = await useProviders.getState().getKey(cfg.id)
        const inputs = resolveGenInputs(card, board)
        const toDataUrl = async (im: { url?: string; localPath?: string; mime?: string }) => {
          const bytes = await loadImageInput(im)
          return bytes ? `data:${im.mime || 'image/png'};base64,${arrayBufferToBase64(bytes)}` : undefined
        }
        const refMode = (card.params?.refMode as string) || 'omni'
        let imageDataUrl: string | undefined
        let lastImageDataUrl: string | undefined
        if (inputs.images[0]) imageDataUrl = await toDataUrl(inputs.images[0])
        if (refMode === 'keyframe' && inputs.images[1]) lastImageDataUrl = await toDataUrl(inputs.images[1])
        const proj = useGraph.getState().project
        const vboard = proj.boards.find((b) => b.cards[cardId]) ?? useGraph.getState().getActiveBoard()
        const vtag = videoStyleTag(vboard.stylePackId ?? proj.stylePackId, vboard.style ?? proj.style)
        const cam = (card.params?.camera as string) || ''
        const mot = (card.params?.motion as string) || ''
        const motionHint = [cam && `运镜：${cam}`, mot && `运动幅度：${mot}`].filter(Boolean).join('，')
        const vprompt =
          card.prompt + (motionHint ? `\n\n${motionHint}` : '') + (vtag && vtag.trim() ? `\n\n风格：${vtag.trim()}` : '')
        // 兜底默认：比例/时长可能只是下拉里显示的默认值而未真正写入 params；不发就会用供应商默认(grok 默认竖屏)
        const sentParams = {
          ...card.params,
          aspect: (card.params?.aspect as string) || '16:9',
          duration: snapDuration(card.modelId, Number(card.params?.duration) || 5)
        }
        const vctrl = new AbortController()
        videoAborts.set(cardId, vctrl)
        const { url } = await runVideoJob(
          cfg,
          key,
          { prompt: vprompt, imageDataUrl, lastImageDataUrl, model: card.modelId || undefined, params: sentParams },
          (p) => commit({ progress: p }),
          vctrl.signal,
          (taskId) => {
            const m = useGraph.getState().getCard(cardId)?.meta || {}
            commit({ meta: { ...m, task: { taskId, provider: cfg.id } } })
          }
        )
        if (!isCurrentRun(cardId, runId)) throw new DOMException('已取消', 'AbortError') // 已取消：不下载不写卡
        const projectId = useGraph.getState().project.id
        const r = await (window as any).mulby.host.call(PLUGIN_ID, 'downloadMedia', {
          url,
          // 文件名必须含全局唯一 cardId——否则后端按标题落盘，多个默认标题（如"AI 视频"）会写到同一文件互相覆盖
          name: `${card.title || 'video'}-${cardId}`,
          projectId
        })
        const path = r?.data?.path
        if (!path) throw new Error('下载失败：' + (r?.data?.error || ''))
        const mDone = useGraph.getState().getCard(cardId)?.meta || {}
        commit({
          status: 'done',
          progress: 1,
          assetUrl: toFileUrl(path),
          assetLocalPath: path,
          mime: (r?.data?.mime as string) || 'video/mp4', // 后端已回真实 content-type，仅缺失时才回退
          meta: { ...mDone, task: undefined }
        })
      } else if (card.kind === 'audio') {
        const cfg = useProviders.getState().activeFor('audio')
        if (!cfg) throw new Error('未配置音频/TTS Provider（右上角“设置”）')
        const key = await useProviders.getState().getKey(cfg.id)
        const inputs = resolveGenInputs(card, board)
        const text = (card.prompt && card.prompt.trim()) || inputs.texts.map((t) => t.text).join('\n')
        if (!text) throw new Error('请填写配音文本（或引用一张文本卡）')
        commit({ progress: 0.4 })
        const pp = card.params || {}
        const res = await runTts(cfg, key, text, {
          voice: typeof pp.voice === 'string' ? pp.voice : undefined,
          speed: typeof pp.speed === 'number' ? pp.speed : undefined,
          format: typeof pp.format === 'string' ? pp.format : undefined,
          projectId: useGraph.getState().project.id
        })
        if (!isCurrentRun(cardId, runId)) throw new DOMException('已取消', 'AbortError') // 已取消：合成结果作废
        commit({
          status: 'done',
          progress: 1,
          assetUrl: res.url,
          assetLocalPath: res.path,
          mime: res.mime
        })
      }
      if (isCurrentRun(cardId, runId)) notifyDone(cardId)
    } catch (e: any) {
      const msg = e?.message || String(e)
      // 显式取消信号优先（用户停止）；字符串嗅探仅作兜底，用词边界收紧避免误吞真实报错
      const aborted = canceledCards.has(cardId) || e?.name === 'AbortError' || /\babort(ed)?\b/i.test(msg)
      // commit 门控：若本 run 已失效（stopCard 或被新生成取代），不覆盖 idle/新状态
      commit({
        status: aborted ? 'idle' : 'error',
        error: aborted ? null : msg,
        progress: 0
      })
    } finally {
      // 仅清理仍属本 run 的取消器/runId（若已被 stopCard 清或被新生成取代，勿动新状态）
      if (isCurrentRun(cardId, runId)) {
        aborters.delete(cardId)
        videoAborts.delete(cardId)
        runIds.delete(cardId)
      }
      useTask.getState().dec()
    }
  })
}

// 断点续跑单个视频卡：仅凭持久化的 taskId 重新轮询（不重新提交），完成后下载落盘
async function resumeVideoCard(cardId: string, taskId: string, providerId: string): Promise<void> {
  if (videoAborts.has(cardId)) return // 已在续跑
  const vctrl = new AbortController()
  videoAborts.set(cardId, vctrl) // 早注册，使「停止」立即可取消
  useTask.getState().inc()
  try {
    const cfg = useProviders.getState().providers.find((p) => p.id === providerId)
    if (!cfg) {
      const m = useGraph.getState().getCard(cardId)?.meta || {}
      useGraph.getState().updateCard(cardId, { status: 'error', error: '续跑失败：原视频 Provider 已不存在', progress: 0, meta: { ...m, task: undefined } })
      return
    }
    const key = await useProviders.getState().getKey(providerId)
    useGraph.getState().updateCard(cardId, { status: 'running', error: null, progress: 0.5 })
    const { url } = await resumeVideoJob(cfg, key, taskId, (p) => useGraph.getState().updateCard(cardId, { progress: p }), vctrl.signal)
    const projectId = useGraph.getState().project.id
    const title = useGraph.getState().getCard(cardId)?.title || 'video'
    const r = await (window as any).mulby.host.call(PLUGIN_ID, 'downloadMedia', { url, name: `${title}-${cardId}`, projectId })
    const path = r?.data?.path
    if (!path) throw new Error('下载失败：' + (r?.data?.error || ''))
    const mDone = useGraph.getState().getCard(cardId)?.meta || {}
    useGraph.getState().updateCard(cardId, {
      status: 'done', progress: 1, assetUrl: toFileUrl(path), assetLocalPath: path, mime: (r?.data?.mime as string) || 'video/mp4', meta: { ...mDone, task: undefined }
    })
    notifyDone(cardId)
  } catch (e: any) {
    const msg = e?.message || String(e)
    const aborted = canceledCards.has(cardId) || e?.name === 'AbortError' || /\babort(ed)?\b/i.test(msg)
    useGraph.getState().updateCard(cardId, { status: aborted ? 'idle' : 'error', error: aborted ? null : msg, progress: 0 })
  } finally {
    videoAborts.delete(cardId)
    useTask.getState().dec()
  }
}

// 重开/切换工程后，扫描所有画布里仍标记为 running 且带持久化 taskId 的视频卡，断点续跑其轮询。
// sanitizeDoc 已对「视频卡 + meta.task」保留 running 状态（其余 running/queued 置 idle）。
export async function resumeInflightVideos(): Promise<void> {
  try {
    await useProviders.getState().load()
  } catch {
    /* ignore */
  }
  const g = useGraph.getState()
  for (const board of g.project.boards) {
    for (const card of Object.values(board.cards)) {
      const task = (card.meta as any)?.task
      if (card.kind === 'video' && card.status === 'running' && task?.taskId && task?.provider && !videoAborts.has(card.id)) {
        void resumeVideoCard(card.id, String(task.taskId), String(task.provider))
      }
    }
  }
}

// 切换/删除工程前调用：中止全部在途视频轮询（含续跑）——否则旧工程的 poll 完成回调会落到
// 新活动工程被静默丢弃。中止后持久化仍是 running+taskId，切回时由 resumeInflightVideos 重新接管。
export function abortAllInflightVideos(): void {
  for (const vc of videoAborts.values()) {
    try {
      vc.abort()
    } catch {
      /* ignore */
    }
  }
  videoAborts.clear()
}

export async function stopCard(cardId: string): Promise<void> {
  // 使当前 run 失效：即便底层调用（未到达 requestId 的流式、images.edit、TTS）无法真正中止，
  // 其后续写入也会被 commit 丢弃，卡片不会「复活」为 done。
  runIds.delete(cardId)
  const rid = aborters.get(cardId)
  const vc = videoAborts.get(cardId)
  // 还在排队（既无文/图 requestId 也无视频取消器）→ 标记取消，limiter 出队时早退
  if (!rid && !vc && useGraph.getState().getCard(cardId)?.status === 'queued') {
    canceledCards.add(cardId)
  }
  if (rid) {
    try {
      await ai().abort(rid)
    } catch {
      /* ignore */
    }
    aborters.delete(cardId)
  }
  if (vc) {
    vc.abort()
    videoAborts.delete(cardId)
  }
  // 视频卡置闲时一并清除残留 taskId，避免后续 loadIntoGraph 误触续跑（尤其「已 sanitize 为
  // running 但续跑尚未起跑」的窗口期——此时 rid/vc 都没有，仅落到这里置 idle）
  const cNow = useGraph.getState().getCard(cardId)
  const clearTask = cNow?.kind === 'video' && (cNow.meta as any)?.task ? { meta: { ...cNow.meta, task: undefined } } : {}
  useGraph.getState().updateCard(cardId, { status: 'idle', progress: 0, ...clearTask })
}
