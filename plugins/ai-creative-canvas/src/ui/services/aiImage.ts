import type { Board, Card } from '../types'
import { resolveGenInputs } from './references'
import { loadImageInput } from './media'

function ai(): any {
  return (window as any).mulby.ai
}

const ASPECT_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '4:3': '1152x896',
  '3:4': '896x1152',
  '16:9': '1344x768',
  '9:16': '768x1344'
}

export interface ImageGenResult {
  images: string[] // base64
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
  const size = ASPECT_SIZE[String(params.aspect || '')] || (params.size as string) || '1024x1024'
  const count = Math.max(1, Math.min(4, Number(params.count) || 1))

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
      prompt: card.prompt
    })
    images = res.images
    onProgress(1)
  } else {
    const req = ai().images.generateStream(
      { model, prompt: card.prompt, size, count },
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
