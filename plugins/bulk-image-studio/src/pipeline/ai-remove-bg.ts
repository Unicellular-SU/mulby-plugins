/** 后端：调用宿主 AI 图像编辑能力对单张图片去背景，返回透明 PNG 的二进制。 */

declare const mulby: {
  ai?: {
    attachments?: {
      upload?: (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<{ attachmentId?: string } | undefined>
      delete?: (attachmentId: string) => Promise<void>
    }
    images?: {
      edit?: (input: { model: string; imageAttachmentId: string; prompt: string }) => Promise<{ images?: string[] } | undefined>
    }
  }
}

export const DEFAULT_REMOVE_BG_PROMPT =
  'Remove the background of this image and make it completely transparent. Keep the main subject fully intact with clean, precise edges. Output a PNG with an alpha channel.'

export interface AiRemoveBgOptions {
  model?: string
  prompt?: string
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function base64ToBuffer(b64: string): Buffer {
  const comma = b64.indexOf(',')
  const raw = b64.startsWith('data:') && comma >= 0 ? b64.slice(comma + 1) : b64
  return Buffer.from(raw.trim(), 'base64')
}

/**
 * 把一张 PNG 缓冲上传到宿主，调用 images.edit 去背景，返回结果二进制。
 * 失败时抛错，由上层 catch 计入该文件的错误列表。
 */
export async function removeBackgroundViaAi(pngBuffer: Buffer, opts: AiRemoveBgOptions): Promise<Buffer> {
  const ai = typeof mulby !== 'undefined' ? mulby?.ai : undefined
  const upload = ai?.attachments?.upload
  const edit = ai?.images?.edit
  if (typeof upload !== 'function' || typeof edit !== 'function') {
    throw new Error('当前 Mulby 版本未提供 AI 图像编辑能力（attachments.upload / images.edit）')
  }
  const model = opts.model?.trim()
  if (!model) {
    throw new Error('未选择 AI 图像模型，无法去背景')
  }

  const uploaded = await upload({ buffer: toArrayBuffer(pngBuffer), mimeType: 'image/png', purpose: 'vision' })
  const attachmentId = uploaded?.attachmentId
  if (!attachmentId) {
    throw new Error('图片上传到 AI 失败')
  }

  try {
    const res = await edit({
      model,
      imageAttachmentId: attachmentId,
      prompt: opts.prompt?.trim() || DEFAULT_REMOVE_BG_PROMPT,
    })
    const out = res?.images?.[0]
    if (!out || typeof out !== 'string') {
      throw new Error('AI 未返回去背景结果')
    }
    const buf = base64ToBuffer(out)
    if (!buf.length) {
      throw new Error('AI 返回的图片数据为空')
    }
    return buf
  } finally {
    try {
      await ai?.attachments?.delete?.(attachmentId)
    } catch {
      /* 清理附件失败可忽略 */
    }
  }
}
