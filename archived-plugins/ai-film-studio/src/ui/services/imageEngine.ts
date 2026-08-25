/**
 * 图像引擎：封装 mulby.ai.images（复用宿主图像模型，零配置）。
 * 优先使用 generateStream（可中断 + 预览），回退到 generate。
 */

export interface ImageRunOptions {
  model?: string | null
  prompt: string
  size?: string
  onPreview?: (base64: string) => void
}

export interface ImageRunResult {
  base64: string
  mime: string
}

let current: { abort: () => void } | null = null

export function abortImage() {
  if (current) {
    try {
      current.abort()
    } catch {
      // 忽略
    }
    current = null
  }
}

/**
 * 已知会拒绝显式尺寸的模型。
 *
 * 插件对模型支持的尺寸没有可见性（`ai.images.generate` 只收 `size?: string`，宿主内部才有
 * exact/ratio/omit 的能力表），所以尺寸只能盲传。不同供应商的合法尺寸差别很大——
 * DALL·E 只认三档、有的要比例字符串、有的干脆不接受——传错就是 HTTP 400。
 *
 * 被拒过一次就记下来，之后对这个模型直接省略 size 让宿主用默认值，避免每次都白费一轮请求。
 */
const modelsRejectingExplicitSize = new Set<string>()

/** 供应商判定"请求无效"（400/404/422）而不是鉴权/限流/服务故障 */
function looksLikeInvalidRequest(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /provider rejected the request|unsupported parameter|request is invalid|invalid[_ ]request|invalid size|unsupported size/i.test(message)
}

/** 把请求参数写进错误信息：宿主会用固定文案覆盖供应商的原始说明，不带上下文就没法定位 */
function describeRequest(opts: ImageRunOptions, sizeSent: string | undefined): string {
  return `模型 ${opts.model}、尺寸 ${sizeSent ?? '(未指定)'}、提示词 ${opts.prompt.length} 字`
}

export async function generateImage(opts: ImageRunOptions): Promise<ImageRunResult> {
  const ai = window.mulby?.ai
  if (!ai?.images?.generate) throw new Error('Mulby 图像能力不可用')
  if (!opts.model) throw new Error('未配置图像模型（请在顶栏选择图像模型）')
  const model = opts.model

  const once = async (size: string | undefined): Promise<ImageRunResult> => {
    const input = { model, prompt: opts.prompt, size, count: 1 }
    // 优先流式：支持中断与生成预览
    if (ai.images.generateStream) {
      const req = ai.images.generateStream(input, (chunk) => {
        if (chunk.type === 'preview' && chunk.image) opts.onPreview?.(chunk.image)
      })
      current = req
      try {
        const r = await req
        const b = r.images?.[0]
        if (!b) throw new Error('未返回图像')
        return { base64: b, mime: 'image/png' }
      } finally {
        current = null
      }
    }
    const r = await ai.images.generate(input)
    const b = r.images?.[0]
    if (!b) throw new Error('未返回图像')
    return { base64: b, mime: 'image/png' }
  }

  const sizeSent = opts.size && !modelsRejectingExplicitSize.has(model) ? opts.size : undefined
  try {
    return await once(sizeSent)
  } catch (error) {
    // 带着尺寸被判无效 → 多半是这个模型不接受该尺寸；摘掉重试一次，并记住别再传
    if (sizeSent && looksLikeInvalidRequest(error)) {
      modelsRejectingExplicitSize.add(model)
      console.warn(`[ai-film-studio] ${model} 拒绝尺寸 ${sizeSent}，改用模型默认尺寸重试`)
      try {
        return await once(undefined)
      } catch (retryError) {
        const detail = retryError instanceof Error ? retryError.message : String(retryError)
        throw new Error(`${detail}（${describeRequest(opts, undefined)}；已尝试省略尺寸后重试仍失败）`)
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${detail}（${describeRequest(opts, sizeSent)}）`)
  }
}

// 纯 base64 → ArrayBuffer（供附件上传）
function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export interface ImageEditOptions {
  model?: string | null
  prompt: string
  refBase64: string // 主参考图：纯 base64（无 data: 前缀）
  refMime?: string
  // 额外参考图（多图一致性 / 按参考图条件生成，如同镜多角色、角色+场景）。宿主 v0.11+ 支持
  extraRefs?: { base64: string; mime?: string }[]
}

/**
 * 参考图编辑（img2img / 按参考图条件生成）：把参考图上传为附件后调用 ai.images.edit。
 * 支持多张参考图（主图 + extraRefs），在多图模型（如 Gemini）上做强角色/风格一致性。
 */
export async function editImage(opts: ImageEditOptions): Promise<ImageRunResult> {
  const ai = window.mulby?.ai
  if (!ai?.images?.edit) throw new Error('Mulby 图像编辑（img2img）能力不可用')
  if (!ai?.attachments?.upload) throw new Error('附件上传能力不可用，无法使用参考图')
  if (!opts.model) throw new Error('未配置图像模型（请在顶栏或节点选择图像模型）')
  if (!opts.refBase64) throw new Error('参考图为空')
  const upload = (base64: string, mime?: string) =>
    ai.attachments.upload({ buffer: b64ToArrayBuffer(base64), mimeType: mime || 'image/png', purpose: 'image-edit' })
  const att = await upload(opts.refBase64, opts.refMime)
  const referenceAttachmentIds: string[] = []
  for (const r of opts.extraRefs || []) {
    if (!r.base64) continue
    try {
      const a = await upload(r.base64, r.mime)
      referenceAttachmentIds.push(a.attachmentId)
    } catch {
      // 单张额外参考图失败不影响主流程
    }
  }
  const model = opts.model
  const call = (refs: string[]) =>
    ai.images.edit({
      model,
      imageAttachmentId: att.attachmentId,
      prompt: opts.prompt,
      ...(refs.length ? { referenceAttachmentIds: refs } : {}),
    })
  let r: Awaited<ReturnType<typeof call>>
  try {
    r = await call(referenceAttachmentIds)
  } catch (error) {
    // 多参考图不是所有模型都支持；被判无效时退回单参考图再试一次，比整张图生不出来强
    if (referenceAttachmentIds.length && looksLikeInvalidRequest(error)) {
      console.warn(`[ai-film-studio] ${model} 拒绝多参考图请求，退回单参考图重试`)
      try {
        r = await call([])
      } catch (retryError) {
        const detail = retryError instanceof Error ? retryError.message : String(retryError)
        throw new Error(`${detail}（模型 ${model}、img2img、提示词 ${opts.prompt.length} 字；已退回单参考图重试仍失败）`)
      }
    } else {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(`${detail}（模型 ${model}、img2img、${referenceAttachmentIds.length + 1} 张参考图、提示词 ${opts.prompt.length} 字）`)
    }
  }
  const b = r.images?.[0]
  if (!b) throw new Error('未返回图像')
  return { base64: b, mime: 'image/png' }
}
