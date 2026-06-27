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
  '3:4': [768, 1024],
  '2:1': [1440, 720] // 360 全景（等距柱状）基准
}

// 360 全景提示词：英文触发词（360 LoRA/模型通用）+ 中文强约束，避免鱼眼/小行星
function panoHint(): string {
  return '\n\nequirectangular 360 view, 360 panorama, seamless equirectangular projection, full 360x180, horizon centered.【360° 全景图：等距柱状投影，单张完整 360×180 全景，水平环绕连续、左右边缘可无缝拼接，地平线居中；不要鱼眼、不要 tiny planet 小行星、不要拼接缝】'
}

// 成图后循环羽化：让最左列与最右列趋向二者平均 → 水平接缝连续（poor-man's circular blend）。
// 治不了"假等距柱状"的投影错误，只缓解左右拼缝。输入/输出均为不含前缀的 base64。
async function seamBlendEquirect(base64: string): Promise<string> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = `data:image/png;base64,${base64}`
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return base64
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) return base64
    ctx.drawImage(img, 0, 0)
    const band = Math.max(2, Math.round(w * 0.05))
    const col0 = ctx.getImageData(0, 0, 1, h).data
    const colW = ctx.getImageData(w - 1, 0, 1, h).data
    const left = ctx.getImageData(0, 0, band, h)
    const right = ctx.getImageData(w - band, 0, band, h)
    const L = left.data
    const R = right.data
    for (let y = 0; y < h; y++) {
      const avg0 = (col0[y * 4] + colW[y * 4]) / 2
      const avg1 = (col0[y * 4 + 1] + colW[y * 4 + 1]) / 2
      const avg2 = (col0[y * 4 + 2] + colW[y * 4 + 2]) / 2
      for (let x = 0; x < band; x++) {
        const i = (y * band + x) * 4
        const tl = 1 - x / band // 左带：列0 最接缝 → 取平均
        L[i] = Math.round(L[i] * (1 - tl) + avg0 * tl)
        L[i + 1] = Math.round(L[i + 1] * (1 - tl) + avg1 * tl)
        L[i + 2] = Math.round(L[i + 2] * (1 - tl) + avg2 * tl)
        const tr = x / (band - 1) // 右带：列 w-1 最接缝 → 取平均
        R[i] = Math.round(R[i] * (1 - tr) + avg0 * tr)
        R[i + 1] = Math.round(R[i + 1] * (1 - tr) + avg1 * tr)
        R[i + 2] = Math.round(R[i + 2] * (1 - tr) + avg2 * tr)
      }
    }
    ctx.putImageData(left, 0, 0)
    ctx.putImageData(right, w - band, 0)
    return c.toDataURL('image/png').split(',')[1] || base64
  } catch {
    return base64
  }
}
function computeSize(aspect: string, resolution: string): string {
  let w = 1024
  let h = 1024
  if (BASE_SIZE[aspect]) {
    ;[w, h] = BASE_SIZE[aspect]
  } else {
    // 任意 W:H 通用解析：短边基准 720，长边按比例
    const m = /^(\d+):(\d+)$/.exec(aspect)
    if (m) {
      const aw = Number(m[1])
      const ah = Number(m[2])
      const S = 720
      if (aw >= ah) {
        h = S
        w = Math.round((S * aw) / ah)
      } else {
        w = S
        h = Math.round((S * ah) / aw)
      }
    }
  }
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
  const g = useGraph.getState()
  const proj = g.project
  const b = g.getActiveBoard()
  const pack = getStylePack(b.stylePackId ?? proj.stylePackId) // 画布级优先
  const freeStyle = b.style ?? proj.style
  const parts: string[] = []
  if (pack) parts.push(applyStylePack(pack, 'keyframe'))
  if (freeStyle && freeStyle.trim()) parts.push(freeStyle.trim())
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
  const pano = !!params.pano
  const aspect = pano ? '2:1' : String(params.aspect || '1:1') // 全景强制等距柱状 2:1
  // 全景看的是 ~60° 一小片（约占贴图宽 1/6），分辨率要够才不糊：至少 2K
  const resolution = pano && String(params.resolution || '1K') === '1K' ? '2K' : String(params.resolution || '1K')
  const size = computeSize(aspect, resolution)
  const count = pano ? 1 : Math.max(1, Math.min(4, Number(params.count) || 1)) // 全景单张
  const prompt = (card.prompt || '') + aspectHint(aspect) + (pano ? panoHint() : '') + styleHint()

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
    // 多图：逐张以 count=1 调用，避免向不支持 n>1 的模型（如 gpt-image-2）传 n 而报错
    const collected: string[] = []
    for (let k = 0; k < count; k++) {
      const genReq: Record<string, unknown> = { model, prompt, size, count: 1 }
      if (params.seed) genReq.seed = Number(params.seed) + k // 多张时按 k 偏移，既可复现又不重复
      const req = ai().images.generateStream(
        genReq,
        (chunk: any) => {
          if (chunk.__requestId) {
            onRequestId(chunk.__requestId)
            return
          }
          if (chunk.type === 'preview' && chunk.image) {
            onProgress((k + 0.6) / count, `data:image/png;base64,${chunk.image}`)
          } else if (chunk.type === 'status') {
            const map: Record<string, number> = { start: 0.1, partial: 0.5, finalizing: 0.85, completed: 1 }
            onProgress((k + (map[chunk.stage as string] ?? 0.3)) / count)
          }
        }
      )
      const res = await req
      if (res.images?.length) collected.push(res.images[0])
    }
    images = collected
    onProgress(1)
  }

  if (!images || images.length === 0) throw new Error('模型未返回图像')
  if (pano) images = await Promise.all(images.map(seamBlendEquirect)) // 全景成图后循环羽化接缝
  return { images, mime: 'image/png' }
}
