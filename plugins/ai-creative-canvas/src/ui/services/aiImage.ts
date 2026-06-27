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

// 360 全景提示词（GPT Image 2 社区公认模板）：明确等距柱状(cylindrical equidistant)、2:1、
// 左右无缝、光照一致、地平线居中、禁鱼眼/小行星。场景描述来自 card.prompt（前置）。
function panoHint(): string {
  return (
    '\n\n360 equirectangular panorama, equirectangular (cylindrical equidistant projection), 2:1 aspect ratio, ' +
    'a seamless 360x180 panoramic view that wraps correctly in a 360 VR viewer, the left and right edges connect seamlessly, ' +
    'consistent lighting across the full 360-degree field of view, horizon centered, no fisheye, no tiny planet effect, no visible stitching seam.'
  )
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
  // 接缝不再做羽化（效果差）——改由「修复接缝」走偏移+生成式重绘（mediaPano.repairEquirectSeam）
  return { images, mime: 'image/png' }
}
