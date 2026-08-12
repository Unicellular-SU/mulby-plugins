const MB = 1024 * 1024

// host-worker 只能整块写文件，无法把 fetch body 直接 pipe 到磁盘；因此必须在进入 Buffer 前设硬上限。
export const MAX_REMOTE_MEDIA_BYTES = 256 * MB
export const MAX_UPLOAD_IMAGE_BYTES = 50 * MB
export const MAX_LOCAL_IMPORT_FILES = 64
export const MAX_TEXT_IMPORT_BYTES = 5 * MB
export const MAX_AI_IMAGE_ARTIFACTS = 4
export const LEGACY_IMAGE_RESULT_TOO_LARGE_MESSAGE = 'Legacy Base64 image result exceeds the compatibility size limit'

const IMPORT_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  srt: 'application/x-subrip'
}

/** 只从最后一个路径段取扩展名；不把隐藏文件或末尾点误判成扩展名。 */
export function localImportExtension(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : ''
}

export function localImportMime(name: string): string {
  return IMPORT_MIME_BY_EXT[localImportExtension(name)] || ''
}

export function isTextImportName(name: string): boolean {
  return ['txt', 'md', 'json', 'srt'].includes(localImportExtension(name))
}

const AI_IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
}

/** AI 任务附件在宿主中以 ID 作为文件名；只接受宿主 UUID/安全 ID 字符集。 */
export function normalizeAiAttachmentId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  return id && /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : ''
}

export function aiImageArtifactExtension(mime: unknown): string {
  return AI_IMAGE_EXT_BY_MIME[String(mime || '').trim().toLowerCase()] || ''
}

/** contextBridge 可能只保留 Error.message，因此不能只依赖宿主附加的 code 字段。 */
export function isLegacyImageResultTooLarge(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null
  if (candidate?.code === 'legacy_result_too_large') return true
  const message = typeof candidate?.message === 'string'
    ? candidate.message
    : typeof error === 'string'
      ? error
      : ''
  return message.includes(LEGACY_IMAGE_RESULT_TOO_LARGE_MESSAGE)
}

/** 远程 RPC 只允许 HTTP(S)，避免 data:/file:/ftp: 等协议把 host-worker 变成通用读取器。 */
export function normalizeRemoteHttpUrl(raw: string, label = '远程地址'): string {
  const value = String(raw || '').trim()
  if (!value) throw new Error(`${label}为空`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label}不是有效 URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${label}仅支持 http/https`)
  }
  if (url.username || url.password) {
    throw new Error(`${label}不得在 URL 中携带账号或密码`)
  }
  return url.toString()
}

/** 在 Buffer.from(base64) 分配内存前估算解码尺寸；标准 base64 尾部最多两个 '='。 */
export function decodedBase64ByteLength(base64: string): number {
  const len = base64.length
  if (!len) return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((len * 3) / 4) - padding)
}
