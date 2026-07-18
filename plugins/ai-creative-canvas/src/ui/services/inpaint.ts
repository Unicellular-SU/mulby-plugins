import { useGraph } from '../store/graphStore'
import { saveBase64, mimeToExt } from './media'
import { aiLimiter } from './limiter'

function ai() {
  return window.mulby.ai
}

function dataUrlToArrayBuffer(d: string): ArrayBuffer {
  const b64 = d.split(',')[1] || ''
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr.buffer
}

export type InpaintOp = 'repaint' | 'remove'

// 局部重绘双保险范式：主图=挖透明洞(repaint)/填绿(remove)的合成图（不支持 mask 的 provider 也能看懂），
// 同时上传真遮罩附件走 maskAttachmentId（涂抹区 alpha=0，OpenAI edits 约定）；
// 结果落「新卡」（非破坏式，可与原图对比）。
export async function inpaint(cardId: string, op: InpaintOp, compositePngDataUrl: string, prompt: string, maskPngDataUrl?: string): Promise<void> {
  const g = useGraph.getState()
  const card = g.getActiveBoard().cards[cardId]
  if (!card || !card.assetUrl) throw new Error('没有底图')
  const boardId = g.boardIdOfCard(cardId)
  const model = card.modelId
  if (!model) throw new Error('请先在节点里选择图像模型')

  const instruction =
    op === 'remove'
      ? `移除画面中绿色覆盖区域内的物体，用与周围一致、自然连贯的背景无缝填补该区域；其余区域严格保持与原图一致。${prompt ? '补充要求：' + prompt : ''}`
      : `图中透明（被挖空）的区域请按以下描述重绘，并与周围光影、风格、边缘无缝衔接；其余区域严格保持与原图一致：${prompt}`

  const res = await aiLimiter(async () => {
    const att = await ai().attachments.upload({ buffer: dataUrlToArrayBuffer(compositePngDataUrl), mimeType: 'image/png', purpose: 'image' })
    let maskAttachmentId: string | undefined
    if (maskPngDataUrl) {
      try {
        const maskAtt = await ai().attachments.upload({ buffer: dataUrlToArrayBuffer(maskPngDataUrl), mimeType: 'image/png', purpose: 'image' })
        maskAttachmentId = maskAtt.attachmentId
      } catch {
        // 遮罩上传失败降级为无遮罩（合成图本身仍含挖洞/填绿信息）
      }
    }
    return ai().images.edit({ model, imageAttachmentId: att.attachmentId, prompt: instruction, maskAttachmentId })
  })
  const img = res.images?.[0]
  if (!img) throw new Error('模型未返回结果')

  const projectId = g.project.id
  const saved = await saveBase64(projectId, `${cardId}_${op}`, img, mimeToExt('image/png'))
  const base = useGraph.getState().getActiveBoard().cards[cardId] || card
  const newId = useGraph.getState().addCard(
    'image',
    { x: base.x + base.w + 220, y: base.y + base.h / 2 },
    {
      title: (base.title || '图片') + (op === 'remove' ? ' · 擦除' : ' · 重绘'),
      status: 'done',
      modelId: base.modelId,
      prompt: prompt || (op === 'remove' ? '擦除涂抹区域' : ''),
      assetUrl: saved.url,
      assetLocalPath: saved.path,
      mime: 'image/png'
    },
    boardId
  )
  useGraph.getState().addEdgeBetween(cardId, newId)
  useGraph.getState().setSelection([newId])
}
