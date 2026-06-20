import type { Board, Card } from '../types'
import { resolveRefs } from './references'
import { readAsArrayBuffer } from './media'

function ai(): any {
  return (window as any).mulby.ai
}

async function uploadCardImage(c: Card): Promise<string | null> {
  try {
    const buf = c.assetLocalPath ? await readAsArrayBuffer(c.assetLocalPath) : await (await fetch(c.assetUrl!)).arrayBuffer()
    const att = await ai().attachments.upload({ buffer: buf, mimeType: c.mime || 'image/png', purpose: 'image' })
    return att.attachmentId
  } catch {
    return null
  }
}

export interface ImageGenResult {
  base64: string
  mime: string
}

export async function generateImage(
  card: Card,
  board: Board,
  onProgress: (p: number, previewDataUrl?: string) => void,
  onRequestId: (id: string) => void
): Promise<ImageGenResult> {
  const model = card.modelId
  if (!model) throw new Error('请先选择图像模型（右侧模型下拉）')

  const refs = resolveRefs(card, board)
  const params = card.params || {}
  const size = (params.size as string) || '1024x1024'

  const attIds: string[] = []
  for (const ic of refs.imageCards) {
    const id = await uploadCardImage(ic)
    if (id) attIds.push(id)
  }

  let images: string[] | undefined
  if (attIds.length > 0) {
    // 图生图 / 多图参考一致性：首图为主图，其余为参考
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
    // 文生图（流式进度 + 预览）
    const req = ai().images.generateStream(
      { model, prompt: card.prompt, size, count: 1 },
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
  return { base64: images[0], mime: 'image/png' }
}
