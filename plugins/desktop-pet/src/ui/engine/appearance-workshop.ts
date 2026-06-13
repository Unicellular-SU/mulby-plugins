/**
 * 外观工坊逻辑层:串起「生图 → 解码 → 像素化 → 五官合成」。
 *
 * 除 decodeImageToRawImage(需要 canvas)外均为纯函数,可在 node 中单测。
 * UI 层(SettingsView 外观 tab)只负责调用这里的函数并展示结果。
 */

import { pixelateToSvg, type PixelateResult, type RawImage } from './pixelate-pipeline'
import { composeSpriteSet, type ComposeMeta } from './sprite-composer'
import type { PetSpriteSet } from './pet-standard'

// ---------------------------------------------------------------------------
// 生图 prompt 模板
// ---------------------------------------------------------------------------

/** 用户描述/风格提示拼进 prompt 前的长度上限,避免超长输入抬高费用或被模型截断 */
const MAX_PROMPT_SUBJECT_LEN = 300

/**
 * 锁定构图约束的 prompt 模板:像素化管线依赖「正面全身、纯色背景、大色块」
 * 才能稳定抠背景和量化,这些约束不交给用户输入。
 */
export function buildPetImagePrompt(description: string): string {
  const subject = description.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_SUBJECT_LEN)
  return [
    `A cute chibi pixel-art style desktop pet character: ${subject}.`,
    'Front facing, full body, standing pose, centered in frame.',
    'Flat colors with large solid color blocks, bold dark outline, no gradients, no texture noise.',
    'Plain solid pure white background, no shadow on the ground, no text, no watermark.',
    'Simple kawaii game sprite, the head takes about half of the body height.',
  ].join(' ')
}

/**
 * 图生图(ai.images.edit)用的转换 prompt:把用户上传的任意图片重绘成
 * 符合像素化管线输入要求的宠物立绘。hint 为用户的可选风格补充。
 */
export function buildPetImageEditPrompt(hint?: string): string {
  const extra = hint?.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_SUBJECT_LEN)
  return [
    'Redraw the main subject of this image as a cute chibi pixel-art style desktop pet character.',
    extra ? `Style hints: ${extra}.` : '',
    'Front facing, full body, standing pose, centered in frame.',
    'Flat colors with large solid color blocks, bold dark outline, no gradients, no texture noise.',
    'Plain solid pure white background, no shadow on the ground, no text, no watermark.',
    'Simple kawaii game sprite, the head takes about half of the body height.',
  ].filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// 生图模型筛选
// ---------------------------------------------------------------------------

export interface ImageModelInfo {
  id?: string
  label?: string
  endpointType?: string
  supportedEndpointTypes?: string[]
}

const IMAGE_MODEL_ID_HINT = /(^|[/:_-])(gpt-image|dall-e|flux|seedream|cogview)|image/i

/**
 * 只保留能走图像生成端点的模型:优先看 endpointType 声明,
 * 对未声明端点的系统内置条目兜底用 id 关键字识别(gpt-image / *-image / dall-e / flux 等)。
 */
export function filterImageGenModels(models: ImageModelInfo[]): ImageModelInfo[] {
  if (!Array.isArray(models)) return []
  return models.filter(model => {
    if (!model?.id) return false
    if (model.endpointType === 'image-generation') return true
    if (Array.isArray(model.supportedEndpointTypes) && model.supportedEndpointTypes.includes('image-generation')) return true
    if (model.endpointType) return false
    return IMAGE_MODEL_ID_HINT.test(model.id)
  })
}

/** 对话模型不该出现的 id 特征:embedding / rerank */
const NON_CHAT_MODEL_ID_HINT = /(^|[/:_-])(embed|embedding|rerank)/i

/**
 * 对话模型 = 全集减去「图像生成模型」(复用 filterImageGenModels 的统一判定),
 * 再排除 embedding / rerank。
 * 必须与 filterImageGenModels 互补:否则 dall-e / flux / seedream / cogview 等
 * id 不含 "image" 子串的图像模型会被字符串启发式漏过、混进对话模型列表甚至被设为默认对话模型。
 */
export function filterChatModels(models: ImageModelInfo[]): ImageModelInfo[] {
  if (!Array.isArray(models)) return []
  const imageIds = new Set(filterImageGenModels(models).map(model => model.id))
  return models.filter(model => {
    if (!model?.id) return false
    if (imageIds.has(model.id)) return false
    if (model.endpointType === 'jina-rerank') return false
    return !NON_CHAT_MODEL_ID_HINT.test(model.id)
  })
}

// ---------------------------------------------------------------------------
// base64 / dataURL 处理
// ---------------------------------------------------------------------------

/** 去掉 data: 前缀与空白,留下纯 base64 */
export function normalizeBase64(input: string): string {
  if (!input) return ''
  const trimmed = input.trim()
  const comma = trimmed.indexOf(',')
  const body = trimmed.startsWith('data:') && comma >= 0 ? trimmed.slice(comma + 1) : trimmed
  return body.replace(/\s+/g, '')
}

/** 纯 base64(或已是 dataURL / 远程 URL)→ 可直接喂给 <img>/canvas 的来源 */
export function toImageDataUrl(base64: string, mime = 'image/png'): string {
  if (!base64) return ''
  const trimmed = base64.trim()
  if (trimmed.startsWith('data:')) return trimmed
  // 部分生图后端直接返回可访问的图片 URL(而非 base64),原样透传,
  // 否则会被当成 base64 包成非法 dataURL 导致后续解码必然失败
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const body = normalizeBase64(trimmed)
  return body ? `data:${mime};base64,${body}` : ''
}

export interface ParsedDataUrl {
  mimeType: string
  buffer: ArrayBuffer
}

/**
 * 图片 dataURL → 二进制(供 ai.attachments.upload 走图生图)。
 * 非图片 mime 或 base64 损坏返回 null。
 */
export function parseImageDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = /^data:([\w/+.-]+);base64,([\s\S]*)$/.exec((dataUrl ?? '').trim())
  if (!match) return null
  const mimeType = match[1] || 'image/png'
  if (!mimeType.startsWith('image/')) return null
  try {
    const binary = atob(match[2].replace(/\s+/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { mimeType, buffer: bytes.buffer }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// 位图解码(浏览器专用)
// ---------------------------------------------------------------------------

/** 本地文件 → dataURL(浏览器专用,供上传入口读取用户选择的图片) */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取图片文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * dataURL → RGBA 位图。依赖 Image + canvas,只能在窗口环境调用;
 * 为限制后续管线开销,超过 maxEdge 的图先按长边等比缩到 maxEdge(canvas 阶段粗缩,
 * 精细的 64×64 盒式缩放仍由 pixelate-pipeline 完成)。
 */
export function decodeImageToRawImage(dataUrl: string, maxEdge = 512): Promise<RawImage> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
        const width = Math.max(1, Math.round(img.naturalWidth * scale))
        const height = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          reject(new Error('无法创建 canvas 上下文'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        const data = ctx.getImageData(0, 0, width, height)
        resolve({ width, height, data: data.data })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = dataUrl
  })
}

// ---------------------------------------------------------------------------
// 生成完整 sprite 套装
// ---------------------------------------------------------------------------

export interface GeneratePetResult {
  spriteSet: PetSpriteSet
  pixelation: PixelateResult
}

/** 由描述推导套装元信息;id 带时间戳保证可区分,name 截取描述前 20 字 */
export function suggestSpriteMeta(description: string, now = Date.now()): ComposeMeta {
  const cleaned = description.trim().replace(/\s+/g, ' ')
  return {
    id: `custom_${now}`,
    name: cleaned.slice(0, 20) || '自定义宠物',
    description: cleaned.slice(0, 200),
  }
}

/**
 * RGBA 位图 → 完整 PetSpriteSet。
 * 像素化后没有任何不透明内容时抛出友好错误(通常是整图被当背景抠掉,
 * 说明生成图不符合「主体居中 + 纯色背景」预期,应引导用户重新生成)。
 */
export function generatePetSpriteSet(rgba: RawImage, meta: ComposeMeta): GeneratePetResult {
  const pixelation = pixelateToSvg(rgba)
  if (pixelation.opaquePixels === 0) {
    throw new Error('像素化后没有可用主体:图片可能背景过于复杂或主体不清晰,请换个描述重新生成')
  }
  const spriteSet = composeSpriteSet(pixelation, meta)
  return { spriteSet, pixelation }
}
