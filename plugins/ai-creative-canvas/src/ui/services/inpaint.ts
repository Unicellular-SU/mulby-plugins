import { useGraph } from '../store/graphStore'
import { loadImageInput, saveBase64, mimeToExt } from './media'

function ai(): any {
  return (window as any).mulby.ai
}

function dataUrlToArrayBuffer(d: string): ArrayBuffer {
  const b64 = d.split(',')[1] || ''
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr.buffer
}

// 局部重绘（实验）：底图 + 遮罩(黑白) + 提示词 → images.edit。
// 宿主无 mask 专用口，遮罩作为参考图随提示词喂入，是否只改遮罩区取决于模型。
export async function inpaint(cardId: string, maskPngDataUrl: string, prompt: string): Promise<void> {
  const g = useGraph.getState()
  const card = g.getActiveBoard().cards[cardId]
  if (!card || !card.assetUrl) throw new Error('没有底图')
  const model = card.modelId
  if (!model) throw new Error('请先在节点里选择图像模型')

  const origBuf = await loadImageInput({ url: card.assetUrl, localPath: card.assetLocalPath || undefined })
  if (!origBuf) throw new Error('读取底图失败')
  const origAtt = await ai().attachments.upload({ buffer: origBuf, mimeType: card.mime || 'image/png', purpose: 'image' })
  const maskAtt = await ai().attachments.upload({ buffer: dataUrlToArrayBuffer(maskPngDataUrl), mimeType: 'image/png', purpose: 'image' })

  const res = await ai().images.edit({
    model,
    imageAttachmentId: origAtt.attachmentId,
    referenceAttachmentIds: [maskAtt.attachmentId],
    prompt: `第二张图是遮罩：仅在遮罩的白色区域，按以下描述重绘，其余区域严格保持与原图一致：${prompt}`
  })
  const img = res.images?.[0]
  if (!img) throw new Error('模型未返回结果')

  const projectId = useGraph.getState().project.id
  const saved = await saveBase64(projectId, `${cardId}_inpaint`, img, mimeToExt('image/png'))
  const cur = useGraph.getState().getActiveBoard().cards[cardId]
  useGraph.getState().updateCard(cardId, {
    assetUrl: saved.url,
    assetLocalPath: saved.path,
    mime: 'image/png',
    meta: { ...(cur?.meta || {}), fittedFor: undefined, results: undefined }
  })
}
