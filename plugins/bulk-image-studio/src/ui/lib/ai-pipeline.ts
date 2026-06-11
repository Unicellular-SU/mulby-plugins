import type { BatchStep, RasterFormat, WatermarkPosition } from '../../pipeline/types'

/** 自然语言 → 流水线：调用宿主 AI，把用户描述解析成批处理步骤数组。 */

export interface GeneratePipelineResult {
  steps: BatchStep[]
  nameSuffix?: string
  notes?: string
}

export interface GeneratePipelineInput {
  text: string
  model?: string
}

export interface AiModelLite {
  id: string
  label?: string
  providerLabel?: string
}

const CONVERT_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'avif', 'gif', 'ico'] as const
const FIT_VALUES = ['inside', 'cover', 'fill'] as const
const GRAVITY_VALUES = ['center', 'north', 'south', 'east', 'west'] as const
const POSITION_VALUES: WatermarkPosition[] = ['tl', 'tr', 'bl', 'br', 'center']

const SYSTEM_PROMPT = `你是「图片批量工坊」的流水线编排助手。用户用自然语言描述想对一批图片做的处理，你要把它翻译成一组有序的处理步骤，并以严格 JSON 返回。

可用步骤（kind 及其字段）：
- compress：光栅图压缩。字段 quality(1-100，越大越清晰)。
- convert：转换格式。字段 format，取值之一：png/jpg/jpeg/webp/tiff/avif/gif/ico（不要输出 svg）。
- resize：改尺寸。字段 width(px)、height(px)、percent(百分比缩放)、fit(inside 默认/cover/fill)。三者至少给一个；等比缩放优先用 percent。
- cropAspect：按宽高比居中裁剪。字段 aspectW、aspectH、gravity(center/north/south/east/west)。
- rotate：旋转。字段 angle(角度)、background(#RRGGBB 背景色)。
- flip：翻转。字段 horizontal(左右)、vertical(上下)，按需置 true。
- padding：补边留白。字段 top/right/bottom/left(px)、color(#RRGGBB)、opacity(0-1)。
- watermarkText：文字水印。字段 text(必填)、fontSize、color(#RRGGBB)、opacity(0-1)、rotateDeg、position(tl/tr/bl/br/center)、tile(是否平铺)。
- watermarkImage：图片水印。需要本地图片路径，你无法提供文件，因此只在用户明确要“图片/logo 水印”时才输出该步骤，path 留空字符串，并在 notes 提醒用户手动选择水印文件。
- rounded：圆角。字段 percentOfMinSide(1-50，占短边百分比)。
- svgMinify：仅对 .svg 矢量文件做结构优化。
- toPdf：把每张图导出为单页 PDF。字段 pageLayout(perImage 默认/a4)、marginPts。只能出现一次且必须是最后一步。

规则：
1. 只生成用户明确表达的步骤，不要自作主张添加无关步骤。
2. 步骤顺序要合理：一般先裁剪/尺寸/旋转/翻转，再补边/圆角/水印，压缩与转格式可放后面，toPdf 永远最后。
3. 颜色一律用 #RRGGBB。百分比、质量等数值落在合理范围内。
4. 如果用户提到给输出文件名加后缀（如“加 _small 后缀”），用 nameSuffix 返回。
5. 只输出一个 JSON 对象，形如 {"steps":[{"kind":"...","...":"..."}],"nameSuffix":"...","notes":"..."}；不要输出任何解释文字、前后缀或 markdown 代码围栏。
6. notes 用简短中文说明你的理解或需要用户注意的点（可省略）。`

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

function optInt(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.round(Math.min(max, Math.max(min, n)))
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function asBool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt
}

/** 把模型给的宽松对象收敛成合法 BatchStep；非法返回 null。 */
function sanitizeStep(raw: unknown): BatchStep | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kind = r.kind
  switch (kind) {
    case 'compress':
      return { kind: 'compress', quality: clampNum(r.quality, 1, 100, 82) }
    case 'convert': {
      const fmt = pickEnum(r.format, CONVERT_FORMATS, 'webp')
      return { kind: 'convert', format: fmt as RasterFormat | 'svg' | 'ico' | 'jpg' }
    }
    case 'resize': {
      const width = optInt(r.width, 1, 100000)
      const height = optInt(r.height, 1, 100000)
      const percent = optInt(r.percent, 1, 1000)
      if (width == null && height == null && percent == null) return null
      return {
        kind: 'resize',
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
        ...(percent != null ? { percent } : {}),
        fit: pickEnum(r.fit, FIT_VALUES, 'inside'),
      }
    }
    case 'cropAspect':
      return {
        kind: 'cropAspect',
        aspectW: clampNum(r.aspectW, 1, 10000, 16),
        aspectH: clampNum(r.aspectH, 1, 10000, 9),
        gravity: pickEnum(r.gravity, GRAVITY_VALUES, 'center'),
      }
    case 'rotate':
      return {
        kind: 'rotate',
        angle: clampNum(r.angle, -3600, 3600, 90),
        background: asString(r.background) ?? '#00000000',
      }
    case 'flip': {
      const horizontal = asBool(r.horizontal)
      const vertical = asBool(r.vertical)
      if (!horizontal && !vertical) return { kind: 'flip', horizontal: true, vertical: false }
      return { kind: 'flip', horizontal, vertical }
    }
    case 'padding':
      return {
        kind: 'padding',
        top: optInt(r.top, 0, 100000) ?? 0,
        right: optInt(r.right, 0, 100000) ?? 0,
        bottom: optInt(r.bottom, 0, 100000) ?? 0,
        left: optInt(r.left, 0, 100000) ?? 0,
        color: asString(r.color) ?? '#ffffff',
        opacity: clampNum(r.opacity, 0, 1, 1),
      }
    case 'watermarkText': {
      const text = asString(r.text)
      if (!text) return null
      return {
        kind: 'watermarkText',
        text,
        fontSize: optInt(r.fontSize, 8, 2000) ?? 24,
        color: asString(r.color) ?? '#ffffff',
        opacity: clampNum(r.opacity, 0, 1, 0.6),
        rotateDeg: optInt(r.rotateDeg, -360, 360) ?? 0,
        position: pickEnum(r.position, POSITION_VALUES, 'br'),
        tile: asBool(r.tile),
      }
    }
    case 'watermarkImage':
      return {
        kind: 'watermarkImage',
        path: asString(r.path) ?? '',
        scale: clampNum(r.scale, 0.05, 1, 0.2),
        opacity: clampNum(r.opacity, 0, 1, 0.8),
        rotateDeg: optInt(r.rotateDeg, -360, 360) ?? 0,
        position: pickEnum(r.position, POSITION_VALUES, 'br'),
        tile: asBool(r.tile),
      }
    case 'rounded':
      return { kind: 'rounded', percentOfMinSide: clampNum(r.percentOfMinSide, 1, 50, 8) }
    case 'svgMinify':
      return { kind: 'svgMinify' }
    case 'toPdf':
      return {
        kind: 'toPdf',
        pageLayout: pickEnum(r.pageLayout, ['perImage', 'a4'] as const, 'perImage'),
        marginPts: optInt(r.marginPts, 0, 1000) ?? 36,
      }
    default:
      return null
  }
}

/** 保证 toPdf 唯一且在末尾。 */
function enforcePdfRule(steps: BatchStep[]): BatchStep[] {
  const pdfs = steps.filter((s) => s.kind === 'toPdf')
  if (pdfs.length === 0) return steps
  const rest = steps.filter((s) => s.kind !== 'toPdf')
  return [...rest, pdfs[0]]
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** 从自由文本中提取第一个 JSON 对象（兼容 ```json 围栏与裸花括号）。 */
function extractJsonObject(text: string): unknown {
  if (!text) return undefined
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    const parsed = tryParseJson(fence[1].trim())
    if (parsed) return parsed
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const parsed = tryParseJson(text.slice(start, end + 1))
    if (parsed) return parsed
  }
  return undefined
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && (c as { type?: string }).type === 'text' ? String((c as { text?: string }).text ?? '') : ''))
      .join('')
  }
  return ''
}

interface AiLike {
  call?: (option: unknown, onChunk?: (chunk: unknown) => void) => Promise<unknown>
}

export async function generatePipelineFromPrompt(ai: AiLike | undefined, input: GeneratePipelineInput): Promise<GeneratePipelineResult> {
  const text = input.text.trim()
  if (!text) throw new Error('请先输入想要的处理描述')
  if (typeof ai?.call !== 'function') throw new Error('当前 Mulby 版本未提供 AI 能力')

  const option: Record<string, unknown> = {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    // 这是「结构化输出」而非「让 AI 执行工具」：必须彻底关闭宿主的工具注入引擎，
    // 否则宿主会把模型生成的 tool_call 当成真实工具去 RPC 执行并继续循环，
    // 由于本插件没有同名 host 方法，循环会一直空转直到 maxToolSteps 上限被抛错。
    capabilities: [],
    toolingPolicy: { enableInternalTools: false },
    mcp: { mode: 'off' },
    skills: { mode: 'off' },
    params: { temperature: 0 },
  }
  if (input.model) option.model = input.model

  // 流式累积纯文本，最终再用聚合结果兜底。
  let chunkText = ''
  const onChunk = (chunk: unknown) => {
    if (!chunk || typeof chunk !== 'object') return
    const c = chunk as { content?: unknown }
    const t = extractText(c.content)
    if (t) chunkText = t.startsWith(chunkText) ? t : chunkText + t
  }

  const final = (await ai.call(option, onChunk)) as { content?: unknown; error?: { message?: string } } | undefined

  if (final?.error?.message) throw new Error(final.error.message)

  // 纯文本 JSON：先整体解析，失败再从围栏/裸花括号里提取。
  const txt = (extractText(final?.content) || chunkText).trim()
  let parsed = tryParseJson(txt)
  if (parsed === undefined) parsed = extractJsonObject(txt)

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 没有返回可用的步骤，请把描述写得更具体一些')
  }

  const obj = parsed as { steps?: unknown; nameSuffix?: unknown; notes?: unknown }
  const rawSteps = Array.isArray(obj.steps) ? obj.steps : []
  const steps = enforcePdfRule(rawSteps.map(sanitizeStep).filter((s): s is BatchStep => s !== null))

  if (steps.length === 0) {
    throw new Error('未能从描述中识别出可执行的处理步骤')
  }

  return {
    steps,
    nameSuffix: asString(obj.nameSuffix),
    notes: asString(obj.notes),
  }
}
