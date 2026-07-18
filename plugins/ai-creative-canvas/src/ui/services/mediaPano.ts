import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { saveBase64, loadImageInput } from './media'
import { toast } from '../store/toastStore'
import { aiLimiter } from './limiter'

function ai() {
  return window.mulby.ai
}


// 水平环绕平移 dx：内容右移 dx（mod w）。对 w/2 连用两次 = 平移 w = 恒等（可逆）。
function offsetWrapX(src: CanvasImageSource, w: number, h: number, dx: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, dx, 0, w, h)
  ctx.drawImage(src, dx - w, 0, w, h)
  return c
}

function dataUrlToBuffer(d: string): ArrayBuffer {
  const b64 = d.split(',')[1] || ''
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr.buffer
}

async function bitmapFromDataUrl(d: string): Promise<ImageBitmap> {
  const blob = await (await fetch(d)).blob()
  return createImageBitmap(blob)
}


// 360 接缝修复（替代羽化）：把图水平平移半幅 → 接缝移到画面正中 → 在中缝挖透明带 →
// 图生图(ai.images.edit)按周边重绘接好 → 再平移半幅复位 → 落新全景卡。比羽化好得多。
export async function repairEquirectSeam(cardId: string): Promise<void> {
  const g = useGraph.getState()
  const src = g.getCard(cardId)
  if (!src || !src.assetUrl) {
    toast('该卡片没有图片', 'error')
    return
  }
  if (!src.modelId) {
    toast('请先在节点里选择图像模型（需支持图生图）', 'error')
    return
  }
  const boardId = g.boardIdOfCard(cardId)
  useTask.getState().inc()
  try {
    const buf = await loadImageInput({ url: src.assetUrl, localPath: src.assetLocalPath || undefined })
    if (!buf) throw new Error('读取图片失败')
    const bmp = await createImageBitmap(new Blob([buf], { type: src.mime || 'image/png' }))
    const w = bmp.width
    const h = bmp.height
    if (!w || !h) throw new Error('图片尺寸无效')

    // 1) 平移半幅 → 接缝到中央；2) 中缝挖透明带
    const shifted = offsetWrapX(bmp, w, h, Math.round(w / 2))
    const sctx = shifted.getContext('2d')!
    const band = Math.max(8, Math.round(w * 0.14))
    sctx.clearRect(Math.round(w / 2 - band / 2), 0, band, h) // 透明洞 = 待重绘区

    // 3) 上传 + 图生图重绘中缝（走共享并发池，避免叠加批量生成打满配额）
    const prompt =
      '这是一张等距柱状 360 全景图，中央有一条透明竖带。请只在透明带内无缝补全画面，' +
      '严格延续两侧的纹理、结构、光照与地平线，使中缝完全连续、不留痕迹；其余区域保持不变。' +
      'Seamlessly inpaint only the transparent vertical strip to continue the equirectangular panorama; no visible seam.'
    const res = await aiLimiter(async () => {
      const att = await ai().attachments.upload({ buffer: dataUrlToBuffer(shifted.toDataURL('image/png')), mimeType: 'image/png', purpose: 'image' })
      return ai().images.edit({ model: src.modelId!, imageAttachmentId: att.attachmentId, prompt })
    })
    const out = res?.images?.[0]
    if (!out) throw new Error('模型未返回结果')

    // 4) 结果平移半幅复位（接缝回到左右边、已接好）
    const healed = await bitmapFromDataUrl(`data:image/png;base64,${out}`)
    const restored = offsetWrapX(healed, w, h, Math.round(w / 2))
    const base64 = restored.toDataURL('image/png').split(',')[1]

    const projectId = useGraph.getState().project.id
    const saved = await saveBase64(projectId, `${cardId}_seam`, base64, 'png')
    const id = useGraph.getState().addCard(
      'pano',
      { x: src.x + src.w + 220, y: src.y + src.h / 2 },
      { title: (src.title || '全景') + ' · 接缝修复', status: 'done', modelId: src.modelId, refIds: [src.id], assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png', meta: { pano: true } },
      boardId
    )
    if (g.boardIdOfCard(cardId) === useGraph.getState().project.activeBoardId) useGraph.getState().setSelection([id])
    toast('接缝已修复', 'success')
  } catch (e: any) {
    toast('接缝修复失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}
