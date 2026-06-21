import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { createLimiter, arrayBufferToBase64 } from '../util'
import { generateText } from './aiText'
import { generateImage } from './aiImage'
import { saveBase64, mimeToExt, toFileUrl, loadImageInput } from './media'
import { resolveGenInputs } from './references'
import { useProviders } from '../store/providerStore'
import { runVideoJob, runTts } from './providers/engine'
import { videoStyleTag } from './stylePacks'
import { resolveModelId } from './models'
import { PLUGIN_ID } from './persistence'

const limiter = createLimiter(() => useGraph.getState().project.concurrency || 4)
const aborters = new Map<string, string>() // cardId -> requestId

function ai(): any {
  return (window as any).mulby.ai
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
  if (!canGenerate(card0.kind)) {
    g0.updateCard(cardId, { status: 'error', error: '该卡片类型暂不支持生成（视频/音频生成见 M7）' })
    return
  }
  if ((card0.kind === 'text' || card0.kind === 'image') && !card0.prompt?.trim()) {
    g0.updateCard(cardId, { status: 'error', error: '请先填写提示词' })
    return
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
    const g = useGraph.getState()
    const board = g.getActiveBoard()
    const card = board.cards[cardId]
    if (!card) {
      useTask.getState().dec()
      return
    }
    g.updateCard(cardId, { status: 'running', progress: 0, error: null })
    try {
      if (card.kind === 'text') {
        const text = await generateText(
          card,
          board,
          (acc) => useGraph.getState().updateCard(cardId, { text: acc, progress: 0.5 }),
          (rid) => aborters.set(cardId, rid)
        )
        useGraph.getState().updateCard(cardId, { status: 'done', progress: 1, text })
      } else if (card.kind === 'image') {
        const res = await generateImage(
          card,
          board,
          (p, preview) =>
            useGraph.getState().updateCard(cardId, { progress: p, ...(preview ? { assetUrl: preview } : {}) }),
          (rid) => aborters.set(cardId, rid)
        )
        const projectId = useGraph.getState().project.id
        const ext = mimeToExt(res.mime)
        // 多图：全部存进本卡的 meta.results（堆叠展示），主图 = 第一张
        const results: Array<{ url: string; localPath: string; mime: string }> = []
        for (let i = 0; i < res.images.length; i++) {
          const s = await saveBase64(projectId, `${cardId}_${i}`, res.images[i], ext)
          results.push({ url: s.url, localPath: s.path, mime: res.mime })
        }
        const base0 = useGraph.getState().getActiveBoard().cards[cardId]
        useGraph.getState().updateCard(cardId, {
          status: 'done',
          progress: 1,
          assetUrl: results[0].url,
          assetLocalPath: results[0].localPath,
          mime: res.mime,
          meta: { ...(base0?.meta || {}), results }
        })
      } else if (card.kind === 'video') {
        const cfg = useProviders.getState().activeFor('video')
        if (!cfg) throw new Error('未配置视频 Provider（右上角“设置”）')
        const key = await useProviders.getState().getKey(cfg.id)
        const inputs = resolveGenInputs(card, board)
        let imageDataUrl: string | undefined
        const img = inputs.images[0]
        if (img) {
          const bytes = await loadImageInput(img)
          if (bytes) imageDataUrl = `data:${img.mime || 'image/png'};base64,${arrayBufferToBase64(bytes)}`
        }
        const proj = useGraph.getState().project
        const vtag = videoStyleTag(proj.stylePackId, proj.style)
        const vprompt = card.prompt + (vtag && vtag.trim() ? `\n\n风格：${vtag.trim()}` : '')
        const { url } = await runVideoJob(cfg, key, { prompt: vprompt, imageDataUrl, params: card.params }, (p) =>
          useGraph.getState().updateCard(cardId, { progress: p })
        )
        const projectId = useGraph.getState().project.id
        const r = await (window as any).mulby.host.call(PLUGIN_ID, 'downloadMedia', {
          url,
          name: card.title || 'video',
          projectId
        })
        const path = r?.data?.path
        if (!path) throw new Error('下载失败：' + (r?.data?.error || ''))
        useGraph.getState().updateCard(cardId, {
          status: 'done',
          progress: 1,
          assetUrl: toFileUrl(path),
          assetLocalPath: path,
          mime: 'video/mp4'
        })
      } else if (card.kind === 'audio') {
        const cfg = useProviders.getState().activeFor('audio')
        if (!cfg) throw new Error('未配置音频/TTS Provider（右上角“设置”）')
        const key = await useProviders.getState().getKey(cfg.id)
        const inputs = resolveGenInputs(card, board)
        const text = (card.prompt && card.prompt.trim()) || inputs.texts.map((t) => t.text).join('\n')
        if (!text) throw new Error('请填写配音文本（或引用一张文本卡）')
        useGraph.getState().updateCard(cardId, { progress: 0.4 })
        const pp = card.params || {}
        const res = await runTts(cfg, key, text, {
          voice: typeof pp.voice === 'string' ? pp.voice : undefined,
          speed: typeof pp.speed === 'number' ? pp.speed : undefined,
          format: typeof pp.format === 'string' ? pp.format : undefined
        })
        useGraph.getState().updateCard(cardId, {
          status: 'done',
          progress: 1,
          assetUrl: res.url,
          assetLocalPath: res.path,
          mime: res.mime
        })
      }
    } catch (e: any) {
      const msg = e?.message || String(e)
      const aborted = /abort/i.test(msg)
      useGraph.getState().updateCard(cardId, {
        status: aborted ? 'idle' : 'error',
        error: aborted ? null : msg,
        progress: 0
      })
    } finally {
      aborters.delete(cardId)
      useTask.getState().dec()
    }
  })
}

export async function stopCard(cardId: string): Promise<void> {
  const rid = aborters.get(cardId)
  if (rid) {
    try {
      await ai().abort(rid)
    } catch {
      /* ignore */
    }
  }
  aborters.delete(cardId)
  useGraph.getState().updateCard(cardId, { status: 'idle', progress: 0 })
}
