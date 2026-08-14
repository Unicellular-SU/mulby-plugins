import { useGraph } from '../store/graphStore'
import { saveBase64, mimeToExt } from './media'
import { aiLimiter } from './limiter'
import { editImageWithMaskCompatibility, type ImageEditApi } from './imageEditCompat'
import { toast } from '../store/toastStore'
import { buildInpaintInstruction, normalizedAnnotationTexts, type InpaintOp } from './inpaintGuidance'
import { readCardMediaVersions } from './mediaVersions'
import { findFreeCardSpot } from './cardPlacement'

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
// 普通图片结果落「新卡」（非破坏式，可与原图对比）；工作流视觉设定卡更新当前主图并保留旧版本，
// 确保用户确认锁定时，下游静帧拿到的就是编辑后的设定。
export interface InpaintResult {
  cardId: string
  replacedCurrentSetting: boolean
}

export async function inpaint(
  cardId: string,
  op: InpaintOp,
  compositePngDataUrl: string,
  prompt: string,
  maskPngDataUrl?: string,
  guidance: InpaintAnnotationGuidance = { hasAnnotations: false }
): Promise<InpaintResult> {
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
  const continuity = (base.meta as { workflowContinuityV1?: unknown })?.workflowContinuityV1 as any
  if (continuity?.version === 1 && typeof continuity.runId === 'string') {
    const previousVersions = readCardMediaVersions(base)
    const previousResults = Array.isArray((base.meta as any)?.results) ? [...(base.meta as any).results] : []
    if (!previousResults.length && (base.assetUrl || base.assetLocalPath)) {
      previousResults.push({ url: base.assetUrl || undefined, localPath: base.assetLocalPath || undefined, mime: base.mime || 'image/png' })
    }
    const results = [...previousResults, { url: saved.url, localPath: saved.path, mime: 'image/png' }].filter((item, index, values) => {
      const key = item.localPath || item.url
      return !!key && values.findIndex((candidate) => (candidate.localPath || candidate.url) === key) === index
    })
    const meta = { ...(base.meta || {}), results, mediaVersionsV1: previousVersions } as Record<string, unknown>
    delete meta.thumb
    delete meta.thumbFor
    delete meta.fittedFor
    const draft = { ...base, assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png', meta }
    useGraph.getState().updateCard(base.id, {
      status: 'done',
      progress: 1,
      error: null,
      assetUrl: saved.url,
      assetLocalPath: saved.path,
      mime: 'image/png',
      meta: {
        ...meta,
        workflowContinuityEditV1: { op, prompt: prompt.trim(), annotationTexts, editedAt: Date.now() },
        mediaVersionsV1: readCardMediaVersions(draft, 'edit')
      }
    })
    useGraph.getState().setSelection([base.id])
    return { cardId: base.id, replacedCurrentSetting: true }
  }
  const spot = findFreeCardSpot(useGraph.getState().getActiveBoard(), 280, 320, base.x + base.w + 220, base.y + base.h / 2)
  const newId = useGraph.getState().addCard(
    'image',
    spot,
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
  return { cardId: newId, replacedCurrentSetting: false }
}
