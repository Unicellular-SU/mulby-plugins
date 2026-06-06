// AI image generation service: pure helpers + a streaming-aware runner that
// wraps the Mulby host `ai.images` API. Kept free of React/DOM so the helpers
// stay unit-testable.

export interface ImageModelInfo {
  id?: string
  label?: string
  endpointType?: string
  supportedEndpointTypes?: string[]
}

export interface ImageGenInput {
  model: string
  prompt: string
  size?: string
  count?: number
}

export interface ImageGenResult {
  images: string[]
  tokens?: { inputTokens: number; outputTokens: number }
}

export interface ImageProgressChunk {
  type: 'status' | 'preview'
  stage?: string
  message?: string
  image?: string
  index?: number
  received?: number
  total?: number
}

/** Minimal structural view of the host `ai` object used for image generation. */
export interface ImageAiClient {
  allModels?: () => Promise<ImageModelInfo[]>
  images?: {
    generate?: (input: ImageGenInput) => Promise<ImageGenResult>
    generateStream?: (
      input: ImageGenInput,
      onChunk: (chunk: ImageProgressChunk) => void
    ) => Promise<ImageGenResult> & { abort?: () => void }
  }
}

export interface ImageSizeOption {
  value: string
  label: string
}

export const DEFAULT_IMAGE_SIZE = '1024x1024'

/**
 * Size presets labelled by their aspect ratio (easier to reason about than raw
 * pixels). Ordered tallest → widest. The `value` carries concrete pixel
 * dimensions because the host image API expects a `WxH` string.
 */
export const IMAGE_SIZES: ImageSizeOption[] = [
  { value: '768x1344', label: '9:16 竖屏 (768×1344)' },
  { value: '832x1248', label: '2:3 竖图 (832×1248)' },
  { value: '864x1152', label: '3:4 竖图 (864×1152)' },
  { value: '1024x1024', label: '1:1 方形 (1024×1024)' },
  { value: '1152x864', label: '4:3 横图 (1152×864)' },
  { value: '1248x832', label: '3:2 横图 (1248×832)' },
  { value: '1344x768', label: '16:9 横屏 (1344×768)' }
]

/** Keeps only models that can serve the image-generation endpoint. */
export function filterImageModels(models: ImageModelInfo[]): ImageModelInfo[] {
  if (!Array.isArray(models)) {
    return []
  }
  return models.filter((model) => {
    if (!model || !model.id) {
      return false
    }
    if (model.endpointType === 'image-generation') {
      return true
    }
    return (
      Array.isArray(model.supportedEndpointTypes) &&
      model.supportedEndpointTypes.includes('image-generation')
    )
  })
}

/** Strips a `data:...;base64,` prefix and whitespace, leaving raw base64. */
export function normalizeBase64(input: string): string {
  if (!input) {
    return ''
  }
  const trimmed = input.trim()
  const comma = trimmed.indexOf(',')
  const body = trimmed.startsWith('data:') && comma >= 0 ? trimmed.slice(comma + 1) : trimmed
  return body.replace(/\s+/g, '')
}

/** Wraps raw base64 (or passes through an existing data URL) into a data URL. */
export function toImageDataUrl(base64: string, mime = 'image/png'): string {
  if (!base64) {
    return ''
  }
  const trimmed = base64.trim()
  if (trimmed.startsWith('data:')) {
    return trimmed
  }
  const body = normalizeBase64(trimmed)
  return body ? `data:${mime};base64,${body}` : ''
}

/** Builds a short, single-line, Markdown-safe alt text from the prompt. */
export function buildImageAlt(prompt: string, max = 50): string {
  const cleaned = prompt
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[[\]\\]/g, '')
  if (cleaned.length <= max) {
    return cleaned
  }
  return `${cleaned.slice(0, max)}…`
}

export interface ImageGenRunResult {
  images: string[]
  aborted: boolean
}

export interface ImageGenHandle {
  result: Promise<ImageGenRunResult>
  abort: () => void
}

export interface RunImageGenerationOptions {
  ai: ImageAiClient
  model: string
  prompt: string
  size?: string
  count?: number
  /** Called with each partial preview image (raw base64) during streaming. */
  onPreview?: (image: string, chunk: ImageProgressChunk) => void
  /** Called with status-only progress chunks during streaming. */
  onStatus?: (chunk: ImageProgressChunk) => void
}

/**
 * Runs an image generation request, preferring the streaming API so previews
 * can render progressively. Returns a handle whose `result` resolves with the
 * final images (or `aborted: true` when cancelled) and an `abort()` method.
 */
export function runImageGeneration(options: RunImageGenerationOptions): ImageGenHandle {
  const { ai, model, prompt, size, count = 1, onPreview, onStatus } = options
  const input: ImageGenInput = { model, prompt, size, count }

  let aborted = false
  let streamAbort: (() => void) | undefined

  const exec = async (): Promise<ImageGenRunResult> => {
    if (ai.images?.generateStream) {
      const handle = ai.images.generateStream(input, (chunk) => {
        if (chunk.type === 'preview' && chunk.image) {
          onPreview?.(chunk.image, chunk)
        } else {
          onStatus?.(chunk)
        }
      })
      streamAbort = typeof handle.abort === 'function' ? () => handle.abort?.() : undefined
      try {
        const res = await handle
        return { images: res?.images ?? [], aborted }
      } catch (error) {
        if (aborted) {
          return { images: [], aborted: true }
        }
        throw error
      }
    }

    if (ai.images?.generate) {
      const res = await ai.images.generate(input)
      return { images: res?.images ?? [], aborted }
    }

    throw new Error('当前环境未启用 Mulby 生图能力')
  }

  return {
    result: exec(),
    abort: () => {
      aborted = true
      streamAbort?.()
    }
  }
}
