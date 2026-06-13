/**
 * 外观工坊逻辑层:串起「生图 → 解码 → 像素化 → 五官合成」。
 *
 * 除 decodeImageToRawImage(需要 canvas)外均为纯函数,可在 node 中单测。
 * UI 层(SettingsView 外观 tab)只负责调用这里的函数并展示结果。
 */

import {
  buildColorPaths,
  computeContentBounds,
  pixelateToSvg,
  tightViewBox,
  type ContentBounds,
  type PixelateResult,
  type RawImage,
} from './pixelate-pipeline'
import { composeSpriteSet, type ComposeMeta } from './sprite-composer'
import { ALL_EXPRESSIONS, ALL_POSES, type PetExpression, type PetSpriteKey, type PetSpriteSet } from './pet-standard'

// ---------------------------------------------------------------------------
// 生图 prompt 模板
// ---------------------------------------------------------------------------

/** 用户描述/风格提示拼进 prompt 前的长度上限,避免超长输入抬高费用或被模型截断 */
const MAX_PROMPT_SUBJECT_LEN = 300

/**
 * 基准定妆照需要的脸部约束:特征大、简洁、可读,既保证像素化后五官清晰,
 * 也方便后续图生图(buildExpressionEditPrompt)在保持角色一致的前提下精准改表情。
 */
const NEUTRAL_FACE_CLAUSE =
  'The character has a simple, clear, cute face with a calm neutral expression: two big round eyes, a tiny nose and a small gentle closed mouth — keep the facial features bold, simple and clearly readable (this is the base reference portrait whose facial expression will be edited afterwards).'

/** 像素化管线依赖的通用构图约束:正面全身、居中、大色块、纯白背景、无渐变/文字 */
const PIXEL_COMPOSITION_CLAUSES = [
  'Front facing, full body, standing pose, centered in frame.',
  'Flat colors with large solid color blocks, bold dark outline, no gradients, no texture noise.',
  'Plain solid pure white background, no shadow on the ground, no text, no watermark.',
  'Simple kawaii game sprite, the head takes about half of the body height.',
]

/**
 * 基准定妆照 prompt:生成一张「带简洁中性表情脸」的宠物立绘。
 * 该图既作为 neutral 表情,也作为后续逐表情图生图的参考底图。
 * 构图约束不交给用户输入,保证像素化管线能稳定抠背景与量化。
 */
export function buildPetImagePrompt(description: string): string {
  const subject = description.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_SUBJECT_LEN)
  return [
    `A cute chibi pixel-art style desktop pet character: ${subject}.`,
    NEUTRAL_FACE_CLAUSE,
    ...PIXEL_COMPOSITION_CLAUSES,
  ].join(' ')
}

/**
 * 图生图(ai.images.edit)用的转换 prompt:把用户上传的任意图片重绘成
 * 「带简洁中性表情脸」的基准宠物立绘(同样作为后续改表情的底图)。hint 为用户的可选风格补充。
 */
export function buildPetImageEditPrompt(hint?: string): string {
  const extra = hint?.trim().replace(/\s+/g, ' ').slice(0, MAX_PROMPT_SUBJECT_LEN)
  return [
    'Redraw the main subject of this image as a cute chibi pixel-art style desktop pet character.',
    extra ? `Style hints: ${extra}.` : '',
    NEUTRAL_FACE_CLAUSE,
    ...PIXEL_COMPOSITION_CLAUSES,
  ].filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// 逐表情图生图(以基准定妆照为底,只改五官表情)
// ---------------------------------------------------------------------------

/** 基准表情:它本身就是定妆照,不需要再图生图,其余表情都以它为参考底图派生 */
export const BASE_EXPRESSION: PetExpression = 'neutral'

/** 需要在基准定妆照之上派生的表情(全集去掉基准),即用户说的「全量 14 个表情」 */
export const DERIVED_EXPRESSIONS: PetExpression[] = ALL_EXPRESSIONS.filter(e => e !== BASE_EXPRESSION)

/**
 * 各表情的英文五官描述,用于图生图 prompt。
 * 刻意只描述「眼/眉/嘴/腮红」等面部特征,不提身体,配合 buildExpressionEditPrompt 的
 * 「只改脸、其他保持完全一致」约束,尽量保证同一角色在不同表情间的连续性。
 */
export const EXPRESSION_PORTRAIT_HINT: Record<PetExpression, string> = {
  neutral: 'a calm neutral face — relaxed round eyes and a small gentle closed mouth',
  happy: 'a very happy face — cheerful curved ^_^ eyes, a big open smile and rosy cheeks',
  sad: 'a sad face — droopy teary downturned eyes and a small frowning mouth',
  surprised: 'a surprised face — wide open round eyes, raised eyebrows and a small open "o" mouth',
  sleepy: 'a sleepy face — half-closed droopy eyes and a tiny yawning mouth',
  angry: 'an angry face — furrowed angled eyebrows, glaring eyes and a frowning mouth',
  excited: 'an excited face — big sparkling star eyes and a wide open joyful grin',
  shy: 'a shy bashful face — eyes glancing aside, a tiny smile and very rosy blushing cheeks',
  love: 'a loving face — pink heart-shaped eyes, a sweet smile and blushing cheeks',
  curious: 'a curious face — one raised eyebrow, alert eyes and a small interested mouth',
  confused: 'a confused face — uneven puzzled eyes and a small wavy unsure mouth',
  proud: 'a proud confident face — smug half-closed eyes looking slightly up and a content smile',
  scared: 'a scared face — frightened wide eyes, worried eyebrows and a small trembling open mouth',
  focused: 'a focused determined face — narrowed concentrated eyes and a straight serious mouth',
  dizzy: 'a dizzy dazed face — swirly spiral @_@ eyes and a wobbly open mouth',
}

/**
 * 逐表情图生图 prompt:在基准定妆照之上「只改脸」。
 * 强约束身体/配色/轮廓/姿态/构图/背景全部保持一致,只把五官换成目标表情,
 * 从根本上消除「AI 画的五官与叠加的矢量五官打架」(双脸/错位)问题。
 */
export function buildExpressionEditPrompt(expression: PetExpression): string {
  const hint = EXPRESSION_PORTRAIT_HINT[expression] ?? EXPRESSION_PORTRAIT_HINT.neutral
  return [
    'This is a cute chibi pixel-art desktop pet character.',
    'Redraw the EXACT same character: keep the body shape, colors, outline, pose, size, framing and the plain solid pure white background all identical.',
    `Change ONLY the facial expression to ${hint}.`,
    'Do not add, remove or move any body part; keep flat colors with a bold outline, no gradients, no text, no watermark.',
  ].join(' ')
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

// ---------------------------------------------------------------------------
// 由「逐表情 AI 图」合成完整套装(无矢量五官叠加,五官来自各表情整图本身)
// ---------------------------------------------------------------------------

/** 单个表情的像素化产物(整图自带五官,因此只取身体/网格,无需脸部锚点) */
export interface ExpressionPixelation {
  expression: PetExpression
  pixelation: Pick<PixelateResult, 'palette' | 'grid' | 'width' | 'height'>
}

/**
 * 把「每个表情各自一张 AI 整图的像素化结果」合成完整 PetSpriteSet。
 *
 * 与 composeSpriteSet(身体 + 叠加矢量五官)不同,这里每个表情都是独立整图,
 * 五官由 AI 直接画在图上,因此不存在「叠加脸与 AI 脸打架」的双脸/错位问题。
 *
 * 关键点:所有表情共用同一个 viewBox(取所有表情不透明像素的并集包围盒),
 * 这样切换表情时画面不会因各自紧致包围盒不同而抖动/错位。
 * 缺失的表情(某次图生图失败)回退到 neutral,保证 195 个 pose×expression key 全覆盖。
 */
export function composeSpriteSetFromExpressions(items: ExpressionPixelation[], meta: ComposeMeta): PetSpriteSet {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('composeSpriteSetFromExpressions: 没有任何可用的表情图')
  }

  // 统一 viewBox:并集包围盒,保证各表情在同一坐标系内对齐
  let union: ContentBounds | null = null
  for (const { pixelation } of items) {
    const bounds = computeContentBounds(pixelation.grid, pixelation.width, pixelation.height)
    if (!bounds) continue
    union = union
      ? {
          minX: Math.min(union.minX, bounds.minX),
          minY: Math.min(union.minY, bounds.minY),
          maxX: Math.max(union.maxX, bounds.maxX),
          maxY: Math.max(union.maxY, bounds.maxY),
        }
      : bounds
  }

  const baseWidth = items[0].pixelation.width
  const baseHeight = items[0].pixelation.height
  const viewBox = tightViewBox(union, baseWidth, baseHeight)

  const svgByExpression = new Map<PetExpression, string>()
  for (const { expression, pixelation } of items) {
    const paths = buildColorPaths(pixelation.palette, pixelation.grid, pixelation.width, pixelation.height).join('')
    if (!paths) continue
    svgByExpression.set(
      expression,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelation.width}" height="${pixelation.height}" viewBox="${viewBox}" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges">${paths}</svg>`,
    )
  }

  if (svgByExpression.size === 0) {
    throw new Error('像素化后没有可用主体:请换张更清晰、主体居中、背景纯净的图重试')
  }

  // 缺失表情的回退:优先 neutral,否则取任意一张已成功的
  const fallbackSvg = svgByExpression.get(BASE_EXPRESSION) ?? (svgByExpression.values().next().value as string)

  const sprites: Partial<Record<PetSpriteKey, string>> = {}
  for (const pose of ALL_POSES) {
    for (const expression of ALL_EXPRESSIONS) {
      sprites[`${pose}_${expression}` as PetSpriteKey] = svgByExpression.get(expression) ?? fallbackSvg
    }
  }

  return {
    id: meta.id.slice(0, 64),
    name: meta.name.slice(0, 80),
    description: meta.description.slice(0, 200),
    sprites,
    createdAt: Date.now(),
  }
}
