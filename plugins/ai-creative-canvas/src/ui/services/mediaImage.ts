import type { Card } from '../types'
import { readAsArrayBuffer, saveBytes } from './media'
import { arrayBufferToBase64 } from '../util'
import { listImageModels } from './models'

// 生成卡片缩略图（sharp 缩到 maxW 宽、webp）：大图(如 4K)卡片渲染缩略图而非全分辨率原图，
// 避免可见图片卡全量全分辨率解码占用数 GB 位图。已够小(宽≤maxW)则返回 null（不必缩）。
export async function makeThumbnail(
  projectId: string,
  cardId: string,
  localPath: string,
  maxW = 640
): Promise<{ path: string; url: string } | null> {
  try {
    const bytes = await readAsArrayBuffer(localPath)
    const meta = await sharp(bytes).metadata()
    if (!meta?.width || meta.width <= maxW) return null
    const out: ArrayBuffer = await sharp(bytes).resize({ width: maxW, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer()
    return await saveBytes(projectId, `${cardId}_thumb`, out, 'image/webp')
  } catch {
    return null
  }
}

function ai(): any {
  return (window as any).mulby.ai
}
function sharp(input: any): any {
  return (window as any).mulby.sharp(input)
}

export interface ImageResult {
  base64: string
  mime: string
}

async function getImageBytes(card: Card): Promise<Uint8Array> {
  if (card.assetLocalPath) return new Uint8Array(await readAsArrayBuffer(card.assetLocalPath))
  if (card.assetUrl) return new Uint8Array(await (await fetch(card.assetUrl)).arrayBuffer())
  throw new Error('卡片没有图片数据')
}

async function firstImageModel(): Promise<string | null> {
  const m = await listImageModels()
  return m[0]?.id || null
}

async function resolveModel(card: Card): Promise<string> {
  const m = card.modelId || (await firstImageModel())
  if (!m) throw new Error('需要图像模型：请在 Mulby「AI 设置 → 模型管理」配置 image-generation 模型')
  return m
}

// 纯 sharp 裁剪
export async function cropImage(card: Card, rect: { left: number; top: number; width: number; height: number }): Promise<ImageResult> {
  const bytes = await getImageBytes(card)
  const out: ArrayBuffer = await sharp(bytes)
    .extract({
      left: Math.max(0, Math.round(rect.left)),
      top: Math.max(0, Math.round(rect.top)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    })
    .png()
    .toBuffer()
  return { base64: arrayBufferToBase64(out), mime: 'image/png' }
}

// 宫格切分 → 多张图
export async function gridSlice(card: Card, rows: number, cols: number): Promise<ImageResult[]> {
  const bytes = await getImageBytes(card)
  const meta = await sharp(bytes).metadata()
  const W = meta.width || 0
  const H = meta.height || 0
  if (!W || !H) throw new Error('无法读取图片尺寸')
  const cw = Math.floor(W / cols)
  const ch = Math.floor(H / rows)
  const results: ImageResult[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const out: ArrayBuffer = await sharp(bytes)
        .extract({ left: c * cw, top: r * ch, width: cw, height: ch })
        .png()
        .toBuffer()
      results.push({ base64: arrayBufferToBase64(out), mime: 'image/png' })
    }
  }
  return results
}

// 扩图：sharp 透明扩边 → 模型填充
export async function outpaintImage(card: Card, ratio = 0.25, prompt?: string): Promise<ImageResult> {
  const bytes = await getImageBytes(card)
  const meta = await sharp(bytes).metadata()
  const W = meta.width || 512
  const H = meta.height || 512
  const px = Math.round(W * ratio)
  const py = Math.round(H * ratio)
  const extended: ArrayBuffer = await sharp(bytes)
    .extend({ top: py, bottom: py, left: px, right: px, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()
  const att = await ai().attachments.upload({ buffer: extended, mimeType: 'image/png', purpose: 'image' })
  const model = await resolveModel(card)
  const res = await ai().images.edit({
    model,
    imageAttachmentId: att.attachmentId,
    prompt: prompt || card.prompt || '自然地向外扩展画面，无缝填充四周的透明区域，保持光影、风格与构图一致'
  })
  if (!res.images?.length) throw new Error('扩图未返回结果')
  return { base64: res.images[0], mime: 'image/png' }
}

// 通用：上传后用提示词重绘（放大 / 抠像 等）
export async function editWithPrompt(card: Card, prompt: string): Promise<ImageResult> {
  const bytes = await getImageBytes(card)
  const att = await ai().attachments.upload({ buffer: bytes.buffer, mimeType: card.mime || 'image/png', purpose: 'image' })
  const model = await resolveModel(card)
  const res = await ai().images.edit({ model, imageAttachmentId: att.attachmentId, prompt })
  if (!res.images?.length) throw new Error('未返回结果')
  return { base64: res.images[0], mime: 'image/png' }
}

export const upscaleImage = (card: Card) =>
  editWithPrompt(card, '提升清晰度与细节，输出高分辨率、锐利的版本；严格保持原有内容、构图与风格不变')

export const removeBackground = (card: Card) =>
  editWithPrompt(card, 'remove the background completely, keep only the main subject with clean precise edges, output a PNG with fully transparent background')
