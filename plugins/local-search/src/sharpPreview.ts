// 后端图片解码：用宿主 sharp 把浏览器无法解码的格式（tiff/psd/heic…）转成 PNG。
// 复用 bulk-image-studio/src/pipeline/sharp-client.ts 的 Buffer 复原逻辑：
// 宿主可能以 { type:'Buffer', data:[...] } / ArrayBuffer / Uint8Array 返回二进制。
declare const mulby: any

function isArrayBufferView(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value)
}

export function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof ArrayBuffer) return Buffer.from(value)
  if (isArrayBufferView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return Buffer.from((value as { data: number[] }).data)
  }
  throw new Error('宿主 sharp 返回了无法识别的二进制结果')
}

export function reviveSharpResult(value: unknown): any {
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || isArrayBufferView(value)) {
    return toBuffer(value)
  }
  if (
    value &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return toBuffer(value)
  }
  if (Array.isArray(value)) return value.map(reviveSharpResult)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = reviveSharpResult(v)
    return out
  }
  return value
}

export async function previewImageAsPng(
  path: string
): Promise<{ base64: string; meta: { width?: number; height?: number; format?: string } }> {
  if (typeof mulby?.sharp?.execute !== 'function') {
    throw new Error('当前 Mulby 版本未提供后端 sharp.execute，无法预览该图片格式')
  }

  const raw = await mulby.filesystem.readFile(path, 'base64')
  const input = Buffer.from(raw as string, 'base64')

  let meta: any = {}
  try {
    meta = reviveSharpResult(
      await mulby.sharp.execute({
        input,
        options: { failOn: 'none' },
        operations: [{ method: 'metadata', args: [] }],
      })
    )
  } catch {
    meta = {}
  }

  const out = await mulby.sharp.execute({
    input,
    options: { failOn: 'none', limitInputPixels: false },
    operations: [
      // 限制最长边，控制回传 base64 体积（base64 会让内存翻倍）
      { method: 'resize', args: [{ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }] },
      { method: 'png', args: [] },
      { method: 'toBuffer', args: [] },
    ],
  })

  const buf = toBuffer(reviveSharpResult(out))
  return {
    base64: buf.toString('base64'),
    meta: { width: meta?.width, height: meta?.height, format: meta?.format },
  }
}
