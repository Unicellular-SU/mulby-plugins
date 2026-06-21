/**
 * toapis 视频模型注册表（由官方文档 https://docs.toapis.com 抓取，2026-06）。
 *
 * 背景：toapis 是 OpenAI 兼容聚合网关——所有视频模型都 POST /v1/videos/generations 并轮询，
 * 但**每个模型的请求字段差异极大**（画幅参数名、时长是数字还是字符串枚举、图像字段名、原生音频开关、分辨率），
 * 手写 bodyTemplate 极易漏字段（grok 漏 aspect_ratio 就默认出了竖屏 9:16）。
 * 这里把各模型的参数「强类型化」，由 buildToapisVideoBody 按模型自动拼正确的 body，从根上消除这类 bug。
 */
import type { VideoGenRequest } from './types'

// 画幅字段：多数 aspect_ratio；Veo3.1-official 用 size；Hailuo/wan2.6-flash 无画幅参数（朝向跟随输入图）
type AspectParam = 'aspect_ratio' | 'size' | null
// 图像输入字段：各家命名不同
type ImageField = 'image_urls' | 'images' | 'reference_images' | 'image_with_roles' | 'metadata.image_list'

export interface ToapisVideoModel {
  id: string // 提交给 model 字段的精确串
  label: string
  aspectParam: AspectParam
  aspectValues: string[] // 支持的画幅（吸附用）
  durationParam: 'duration' | 'seconds'
  durationType: 'number' | 'string'
  durationValues: number[] // 允许时长（吸附到最接近的合法值）
  imageField: ImageField
  audioField?: string // 原生音频开关字段（支持 metadata. 前缀）
  audioDefault?: boolean
  resolutionParam?: string // 分辨率字段（支持 metadata. 前缀）
  resolutionDefault?: string
}

const KLING_DUR = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
const SEEDANCE_AR = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

export const TOAPIS_VIDEO_MODELS: ToapisVideoModel[] = [
  // —— Grok（图字段 images；时长是 seconds 字符串枚举；实测默认输出原生音频，无需开关，声音在片段文件里）——
  { id: 'grok-video-3', label: 'Grok Video 3', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '3:2', '2:3', '1:1'], durationParam: 'seconds', durationType: 'string', durationValues: [6, 10, 15], imageField: 'images' },
  { id: 'grok-video-1.5-preview', label: 'Grok Video 1.5 Preview', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16'], durationParam: 'seconds', durationType: 'string', durationValues: [10, 15], imageField: 'images' },
  // —— Sora2（默认 9:16！必须显式传 aspect_ratio 才横屏）——
  { id: 'sora-2', label: 'Sora 2', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16'], durationParam: 'duration', durationType: 'number', durationValues: [4, 8, 12], imageField: 'image_urls' },
  { id: 'sora-2-vvip', label: 'Sora 2 VVIP', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16'], durationParam: 'duration', durationType: 'number', durationValues: [4, 8, 12], imageField: 'image_urls' },
  // —— Veo3.1（聚合版 aspect_ratio；official 版用 size）——
  { id: 'veo3.1-fast', label: 'Veo 3.1 Fast', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16'], durationParam: 'duration', durationType: 'number', durationValues: [8], imageField: 'image_urls', resolutionParam: 'metadata.resolution', resolutionDefault: '1080p' },
  { id: 'veo3.1-quality', label: 'Veo 3.1 Quality', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16'], durationParam: 'duration', durationType: 'number', durationValues: [8], imageField: 'image_urls', resolutionParam: 'metadata.resolution', resolutionDefault: '1080p' },
  { id: 'Veo3.1-fast-official', label: 'Veo 3.1 Fast (official)', aspectParam: 'size', aspectValues: ['16:9', '9:16'], durationParam: 'duration', durationType: 'number', durationValues: [4, 6, 8], imageField: 'image_urls', audioField: 'metadata.generateAudio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'Veo3.1-quality-official', label: 'Veo 3.1 Quality (official)', aspectParam: 'size', aspectValues: ['16:9', '9:16'], durationParam: 'duration', durationType: 'number', durationValues: [4, 6, 8], imageField: 'image_urls', audioField: 'metadata.generateAudio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  // —— 豆包 Seedance ——
  { id: 'doubao-seedance-1-5-pro', label: '豆包 Seedance 1.5 Pro', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], durationParam: 'duration', durationType: 'number', durationValues: [4, 5, 6, 7, 8, 9, 10, 11, 12], imageField: 'image_urls', audioField: 'metadata.audio', audioDefault: true, resolutionParam: 'metadata.resolution', resolutionDefault: '1080p' },
  { id: 'doubao-seedance-1-0-pro-fast', label: '豆包 Seedance 1.0 Pro Fast', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], durationParam: 'duration', durationType: 'number', durationValues: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], imageField: 'image_urls', resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'doubao-seedance-1-0-pro-quality', label: '豆包 Seedance 1.0 Pro Quality', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], durationParam: 'duration', durationType: 'number', durationValues: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], imageField: 'image_urls', resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'seedance-2', label: 'Seedance 2（原生音频/首尾帧）', aspectParam: 'aspect_ratio', aspectValues: SEEDANCE_AR, durationParam: 'duration', durationType: 'number', durationValues: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], imageField: 'image_with_roles', audioField: 'generate_audio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'seedance-2-fast', label: 'Seedance 2 Fast', aspectParam: 'aspect_ratio', aspectValues: SEEDANCE_AR, durationParam: 'duration', durationType: 'number', durationValues: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], imageField: 'image_with_roles', audioField: 'generate_audio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '720p' },
  // —— Gemini ——
  { id: 'gemini_omni_flash', label: 'Gemini Omni Flash', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16'], durationParam: 'duration', durationType: 'number', durationValues: [4, 6, 10], imageField: 'image_urls', resolutionParam: 'resolution', resolutionDefault: '720P' },
  // —— 可灵 Kling ——
  { id: 'kling-v3', label: '可灵 Kling v3', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: KLING_DUR, imageField: 'reference_images', audioField: 'audio', audioDefault: false },
  { id: 'kling-v3-omni', label: '可灵 Kling v3 Omni（原生音频）', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: KLING_DUR, imageField: 'metadata.image_list', audioField: 'audio', audioDefault: true },
  { id: 'kling-3.0-turbo', label: '可灵 Kling 3.0 Turbo', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: KLING_DUR, imageField: 'reference_images', resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'kling-v2-6', label: '可灵 Kling v2.6', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: [5, 10], imageField: 'reference_images', audioField: 'audio', audioDefault: false },
  { id: 'kling-video-o1', label: '可灵 Kling Video o1', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: [3, 4, 5, 6, 7, 8, 9, 10], imageField: 'metadata.image_list' },
  // —— 海螺 MiniMax（无画幅参数，朝向跟随输入图；resolution 控清晰度）——
  { id: 'MiniMax-Hailuo-2.3', label: '海螺 Hailuo 2.3', aspectParam: null, aspectValues: [], durationParam: 'duration', durationType: 'number', durationValues: [6, 10], imageField: 'image_urls', resolutionParam: 'resolution', resolutionDefault: '1080P' },
  { id: 'MiniMax-Hailuo-2.3-Fast', label: '海螺 Hailuo 2.3 Fast', aspectParam: null, aspectValues: [], durationParam: 'duration', durationType: 'number', durationValues: [6, 10], imageField: 'image_urls', resolutionParam: 'resolution', resolutionDefault: '1080P' },
  { id: 'MiniMax-Hailuo-02', label: '海螺 Hailuo 02', aspectParam: null, aspectValues: [], durationParam: 'duration', durationType: 'number', durationValues: [6, 10], imageField: 'image_urls', resolutionParam: 'resolution', resolutionDefault: '768P' },
  // —— Vidu ——
  { id: 'viduq3', label: 'Vidu Q3', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], imageField: 'image_urls', audioField: 'audio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'viduq3-pro', label: 'Vidu Q3 Pro', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], imageField: 'image_urls', audioField: 'audio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'viduq3-turbo', label: 'Vidu Q3 Turbo', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1'], durationParam: 'duration', durationType: 'number', durationValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], imageField: 'image_urls', audioField: 'audio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  // —— 通义万相 Wan ——
  { id: 'wan2.6', label: '通义万相 Wan 2.6', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1', '4:3', '3:4'], durationParam: 'duration', durationType: 'number', durationValues: [5, 10, 15], imageField: 'image_urls', audioField: 'audio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  { id: 'wan2.6-flash', label: '通义万相 Wan 2.6 Flash', aspectParam: null, aspectValues: [], durationParam: 'duration', durationType: 'number', durationValues: [5, 10, 15], imageField: 'image_urls', audioField: 'audio', audioDefault: true, resolutionParam: 'resolution', resolutionDefault: '1080p' },
  // —— Happyhorse ——
  { id: 'happyhorse-1.0', label: 'Happyhorse 1.0', aspectParam: 'aspect_ratio', aspectValues: ['16:9', '9:16', '1:1', '4:3', '3:4'], durationParam: 'duration', durationType: 'number', durationValues: KLING_DUR, imageField: 'image_urls', resolutionParam: 'resolution', resolutionDefault: '1080P' },
]

const BY_ID: Record<string, ToapisVideoModel> = Object.fromEntries(TOAPIS_VIDEO_MODELS.map((m) => [m.id, m]))

export function toapisVideoModel(id?: string): ToapisVideoModel | undefined {
  return id ? BY_ID[id] : undefined
}

function orient(r: string): 'land' | 'port' | 'sq' {
  const [a, b] = r.split(':').map(Number)
  if (!a || !b) return 'land'
  return a > b ? 'land' : a < b ? 'port' : 'sq'
}

/** 把请求画幅吸附到该模型支持的画幅：优先精确命中，否则同朝向（横/竖/方）里取第一个，再否则取首个 */
function snapAspect(values: string[], want: string): string {
  if (values.includes(want)) return want
  const o = orient(want)
  return values.find((v) => orient(v) === o) || values[0]
}

/** 把请求时长吸附到该模型允许的最接近合法值 */
function snapDuration(values: number[], want: number): number {
  return values.reduce((best, v) => (Math.abs(v - want) < Math.abs(best - want) ? v : best), values[0])
}

/** 写入可能带 metadata. 前缀的嵌套字段 */
function setField(body: Record<string, unknown>, path: string, value: unknown): void {
  if (path.startsWith('metadata.')) {
    const key = path.slice('metadata.'.length)
    const meta = (body.metadata as Record<string, unknown>) || {}
    meta[key] = value
    body.metadata = meta
  } else {
    body[path] = value
  }
}

/** 按模型各自的图像字段约定写入首帧（+可选尾帧） */
function setImage(body: Record<string, unknown>, field: ImageField, url: string, lastUrl?: string): void {
  switch (field) {
    case 'image_with_roles': {
      const arr: Record<string, string>[] = [{ url, role: 'first_frame' }]
      if (lastUrl) arr.push({ url: lastUrl, role: 'last_frame' })
      body.image_with_roles = arr
      break
    }
    case 'metadata.image_list': {
      const meta = (body.metadata as Record<string, unknown>) || {}
      meta.image_list = [{ image_url: url }]
      body.metadata = meta
      break
    }
    default:
      // image_urls / images / reference_images 均为 URL 数组
      body[field] = [url]
  }
}

/**
 * 按 toapis 模型定义拼请求体——画幅/时长/图像字段/原生音频/分辨率全部映射正确。
 * 未知模型回退最小体 {model,prompt(,image_urls)}（仍可工作，只是不带模型专属字段）。
 */
export function buildToapisVideoBody(modelId: string, req: VideoGenRequest): Record<string, unknown> {
  const m = BY_ID[modelId]
  const body: Record<string, unknown> = { model: modelId, prompt: req.prompt }
  if (!m) {
    if (req.imageUrl) body.image_urls = [req.imageUrl]
    if (req.aspectRatio) body.aspect_ratio = req.aspectRatio
    return body
  }
  if (m.aspectParam && req.aspectRatio) setField(body, m.aspectParam, snapAspect(m.aspectValues, req.aspectRatio))
  if (req.duration != null && m.durationValues.length) {
    const d = snapDuration(m.durationValues, req.duration)
    setField(body, m.durationParam, m.durationType === 'string' ? String(d) : d)
  }
  if (req.imageUrl) setImage(body, m.imageField, req.imageUrl, req.lastImageUrl)
  if (m.resolutionParam && m.resolutionDefault) setField(body, m.resolutionParam, m.resolutionDefault)
  // 原生音频：native=开；external/silent=关；未指定时用模型默认
  if (m.audioField) {
    const on = req.audioMode === 'native' ? true : req.audioMode === 'external' || req.audioMode === 'silent' ? false : m.audioDefault
    if (on != null) setField(body, m.audioField, on)
  }
  return body
}
