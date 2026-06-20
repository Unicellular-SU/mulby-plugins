import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { createLimiter, arrayBufferToBase64 } from '../util'
import { generateText } from './aiText'
import { generateImage } from './aiImage'
import { saveBase64, mimeToExt, toFileUrl, readAsArrayBuffer } from './media'
import { resolveRefs } from './references'
import { useProviders } from '../store/providerStore'
import { runVideoJob, runTts } from './providers/engine'
import { PLUGIN_ID } from './persistence'

const limiter = createLimiter(3)
const aborters = new Map<string, string>() // cardId -> requestId

function ai(): any {
  return (window as any).mulby.ai
}

export function canGenerate(kind: string): boolean {
  return kind === 'text' || kind === 'image' || kind === 'video' || kind === 'audio'
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
        const saved = await saveBase64(projectId, cardId, res.base64, mimeToExt(res.mime))
        useGraph.getState().updateCard(cardId, {
          status: 'done',
          progress: 1,
          assetUrl: saved.url,
          assetLocalPath: saved.path,
          mime: res.mime
        })
      } else if (card.kind === 'video') {
        const cfg = useProviders.getState().activeFor('video')
        if (!cfg) throw new Error('未配置视频 Provider（右上角“设置”）')
        const key = await useProviders.getState().getKey(cfg.id)
        const refs = resolveRefs(card, board)
        let imageDataUrl: string | undefined
        const ic = refs.imageCards[0]
        if (ic) {
          const bytes = ic.assetLocalPath
            ? await readAsArrayBuffer(ic.assetLocalPath)
            : await (await fetch(ic.assetUrl!)).arrayBuffer()
          imageDataUrl = `data:${ic.mime || 'image/png'};base64,${arrayBufferToBase64(bytes)}`
        }
        const { url } = await runVideoJob(cfg, key, { prompt: card.prompt, imageDataUrl }, (p) =>
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
        const refs = resolveRefs(card, board)
        const text = (card.prompt && card.prompt.trim()) || refs.texts.map((t) => t.text).join('\n')
        if (!text) throw new Error('请填写配音文本（或引用一张文本卡）')
        useGraph.getState().updateCard(cardId, { progress: 0.4 })
        const res = await runTts(cfg, key, text)
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
