import { useGraph } from '../store/graphStore'
import { saveBase64, mimeToExt } from './media'
import { aiLimiter } from './limiter'
import { editImageWithMaskCompatibility, type ImageEditApi } from './imageEditCompat'
import { toast } from '../store/toastStore'
import { buildInpaintInstruction, normalizedAnnotationTexts, type InpaintOp } from './inpaintGuidance'

export type { InpaintOp } from './inpaintGuidance'

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

export interface InpaintAnnotationGuidance {
  hasAnnotations: boolean
  annotationTexts?: string[]
}

// 局部重绘双保险范式：主图=挖透明洞(repaint)/填绿(remove)+可选箭头文字的合成图（不支持 mask 的 provider 也能看懂），
// 同时上传真遮罩附件走 maskAttachmentId（涂抹区 alpha=0，OpenAI edits 约定）；没有蒙版时则直接按图上标注普通 edit。宿主会把带蒙版请求
// 严格规范化为 inpaint 并校验 Profile 能力，不支持时按 imageEditCompat 安全降级为合成图普通 edit；
// 结果落「新卡」（非破坏式，可与原图对比）。
export async function inpaint(
  cardId: string,
  op: InpaintOp,
  compositePngDataUrl: string,
  prompt: string,
  maskPngDataUrl?: string,
  guidance: InpaintAnnotationGuidance = { hasAnnotations: false }
): Promise<void> {
  const g = useGraph.getState()
  const card = g.getActiveBoard().cards[cardId]
  if (!card || !card.assetUrl) throw new Error('没有底图')
  const boardId = g.boardIdOfCard(cardId)
  const model = card.modelId
  if (!model) throw new Error('请先在节点里选择图像模型')

  const annotationTexts = normalizedAnnotationTexts(guidance.annotationTexts)
  const instruction = buildInpaintInstruction({
    op,
    prompt,
    hasMask: !!maskPngDataUrl,
    hasAnnotations: guidance.hasAnnotations,
    annotationTexts
  })

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
    return editImageWithMaskCompatibility(ai().images as ImageEditApi, {
      model,
      imageAttachmentId: att.attachmentId,
      prompt: instruction,
      maskAttachmentId
    })
  })
  if (res.mode === 'composite-fallback') {
    toast('当前模型不支持原生遮罩，已改用合成图编辑', 'warning')
  }
  const img = res.result.images?.[0]
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
      prompt: [prompt.trim(), ...annotationTexts].filter(Boolean).join('；') || (op === 'remove' ? '擦除标注区域' : ''),
      assetUrl: saved.url,
      assetLocalPath: saved.path,
      mime: 'image/png'
    },
    boardId
  )
  useGraph.getState().addEdgeBetween(cardId, newId)
  useGraph.getState().setSelection([newId])
}
