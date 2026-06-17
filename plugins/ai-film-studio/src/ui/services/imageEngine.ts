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

export async function generateImage(opts: ImageRunOptions): Promise<ImageRunResult> {
  const ai = window.mulby?.ai
  if (!ai?.images?.generate) throw new Error('Mulby 图像能力不可用')
  if (!opts.model) throw new Error('未配置图像模型（请在顶栏选择图像模型）')

  const input = { model: opts.model, prompt: opts.prompt, size: opts.size, count: 1 }

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
  const r = await ai.images.edit({
    model: opts.model,
    imageAttachmentId: att.attachmentId,
    prompt: opts.prompt,
    ...(referenceAttachmentIds.length ? { referenceAttachmentIds } : {}),
  })
  const b = r.images?.[0]
  if (!b) throw new Error('未返回图像')
  return { base64: b, mime: 'image/png' }
}
