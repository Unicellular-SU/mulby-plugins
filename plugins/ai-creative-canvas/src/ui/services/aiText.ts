import type { Board, Card } from '../types'
import { resolveRefs } from './references'
import { readAsArrayBuffer } from './media'

function ai(): any {
  return (window as any).mulby.ai
}

async function cardToArrayBuffer(c: Card): Promise<ArrayBuffer | null> {
  try {
    if (c.assetLocalPath) return await readAsArrayBuffer(c.assetLocalPath)
    if (c.assetUrl) return await (await fetch(c.assetUrl)).arrayBuffer()
  } catch {
    /* ignore */
  }
  return null
}

export async function generateText(
  card: Card,
  board: Board,
  onChunk: (text: string) => void,
  onRequestId: (id: string) => void
): Promise<string> {
  const refs = resolveRefs(card, board)

  // 参考图片 → vision 附件
  const imageContents: any[] = []
  for (const ic of refs.imageCards) {
    const buf = await cardToArrayBuffer(ic)
    if (!buf) continue
    try {
      const att = await ai().attachments.upload({ buffer: buf, mimeType: ic.mime || 'image/png', purpose: 'vision' })
      imageContents.push({ type: 'image', attachmentId: att.attachmentId, mimeType: ic.mime || 'image/png' })
    } catch {
      /* skip */
    }
  }

  const refText = refs.texts.map((t) => `【${t.title}】\n${t.text}`).join('\n\n')
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
