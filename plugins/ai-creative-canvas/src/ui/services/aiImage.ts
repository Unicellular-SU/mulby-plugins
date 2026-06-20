import type { Board, Card } from '../types'
import { resolveGenInputs } from './references'
import { loadImageInput } from './media'
import { useGraph } from '../store/graphStore'
import { getStylePack, applyStylePack } from './stylePacks'

function ai(): any {
  return (window as any).mulby.ai
}

// 参考 ai-film-studio：比例 → 尺寸（短边 ≥720，宿主原样转发给 provider）
const BASE_SIZE: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '4:3': [1024, 768],
  '3:4': [768, 1024]
}
function computeSize(aspect: string, resolution: string): string {
  const [w, h] = BASE_SIZE[aspect] || [1024, 1024]
  const scale = resolution === '4K' ? 3 : resolution === '2K' ? 2 : 1
  const r64 = (n: number) => Math.max(64, Math.round((n * scale) / 64) * 64)
  return `${r64(w)}x${r64(h)}`
}
// 关键：把画幅写进提示词——很多图像模型忽略 size、只认提示词里的比例（ai-film-studio 同款做法）
function aspectHint(aspect: string): string {
  const m = /^(\d+):(\d+)$/.exec(aspect)
  if (!m) return ''
  const aw = Number(m[1])
  const ah = Number(m[2])
  const ori = aw > ah ? '横向 landscape' : aw < ah ? '竖向 portrait' : '方形 square'
  return `\n\n【画幅比例 ${aspect}，${ori}】`
}
// 风格包（项目级）注入所有图像提示词；自由画风作为补充叠加
function styleHint(): string {
  const proj = useGraph.getState().project
  const pack = getStylePack(proj.stylePackId)
  const parts: string[] = []
  if (pack) parts.push(applyStylePack(pack, 'keyframe'))
  if (proj.style && proj.style.trim()) parts.push(proj.style.trim())
  return parts.length ? `\n\n风格：${parts.join(', ')}` : ''
}

export interface ImageGenResult {
  images: string[]
  mime: string
}

export async function generateImage(
  card: Card,
  board: Board,
  onProgress: (p: number, previewDataUrl?: string) => void,
  onRequestId: (id: string) => void
): Promise<ImageGenResult> {
  const model = card.modelId
  if (!model) throw new Error('请先选择图像模型（面板内"模型"下拉）')

  const inputs = resolveGenInputs(card, board)
  const params = card.params || {}
  const aspect = String(params.aspect || '1:1')
  const size = computeSize(aspect, String(params.resolution || '1K'))
  const count = Math.max(1, Math.min(4, Number(params.count) || 1))
  const prompt = (card.prompt || '') + aspectHint(aspect) + styleHint() // 尺寸 + 比例/风格提示词

  // 参考图（连入卡片 + 上传素材）→ 附件；首图主图、其余多图参考
  const attIds: string[] = []
  for (const img of inputs.images) {
    const buf = await loadImageInput(img)
    if (!buf) continue
    try {
      const att = await ai().attachments.upload({ buffer: buf, mimeType: img.mime || 'image/png', purpose: 'image' })
      attIds.push(att.attachmentId)
    } catch {
      /* skip */
    }
  }

  let images: string[] | undefined
  if (attIds.length > 0) {
    onProgress(0.3)
    const res = await ai().images.edit({
      model,
      imageAttachmentId: attIds[0],
      referenceAttachmentIds: attIds.slice(1),
      prompt
    })
    images = res.images
    onProgress(1)
  } else {
    const req = ai().images.generateStream(
      { model, prompt, size, count },
      (chunk: any) => {
        if (chunk.__requestId) {
          onRequestId(chunk.__requestId)
          return
        }
        if (chunk.type === 'preview' && chunk.image) {
          onProgress(0.6, `data:image/png;base64,${chunk.image}`)
        } else if (chunk.type === 'status') {
          const map: Record<string, number> = { start: 0.1, partial: 0.5, finalizing: 0.85, completed: 1 }
          onProgress(map[chunk.stage as string] ?? 0.3)
        }
      }
    )
    const res = await req
    images = res.images
    onProgress(1)
  }

  if (!images || images.length === 0) throw new Error('模型未返回图像')
  return { images, mime: 'image/png' }
}
