import type { Board, Card } from '../types'
import { resolveGenInputs } from './references'
import { loadImageInput } from './media'

function ai(): any {
  return (window as any).mulby.ai
}

export async function generateText(
  card: Card,
  board: Board,
  onChunk: (text: string) => void,
  onRequestId: (id: string) => void
): Promise<string> {
  const inputs = resolveGenInputs(card, board)

  // 参考图片 → vision 附件
  const imageContents: any[] = []
  for (const img of inputs.images) {
    const buf = await loadImageInput(img)
    if (!buf) continue
    try {
      const att = await ai().attachments.upload({ buffer: buf, mimeType: img.mime || 'image/png', purpose: 'vision' })
      imageContents.push({ type: 'image', attachmentId: att.attachmentId, mimeType: img.mime || 'image/png' })
    } catch {
      /* skip */
    }
  }

  const refText = inputs.texts.map((t) => `【${t.label}】\n${t.text}`).join('\n\n')
  const userText = [card.prompt, refText && `\n\n参考资料：\n${refText}`].filter(Boolean).join('')
  const content = imageContents.length ? [{ type: 'text', text: userText }, ...imageContents] : userText

  const messages = [
    { role: 'system', content: '你是创意影像创作助手。输出简洁、可直接使用的中文结果；若用户要求分镜/列表，请用清晰结构。' },
    { role: 'user', content }
  ]

  let acc = ''
  const option: any = { messages, params: card.params || {} }
  if (card.modelId) option.model = card.modelId

  const req = ai().call(option, (chunk: any) => {
    if (chunk.__requestId) {
      onRequestId(chunk.__requestId)
      return
    }
    const piece = typeof chunk.content === 'string' ? chunk.content : ''
    if (piece && (chunk.chunkType === 'text' || chunk.chunkType === undefined)) {
      acc += piece
      onChunk(acc)
    }
  })

  const final = await req
  if (!acc && final && typeof final.content === 'string') acc = final.content
  return acc
}
