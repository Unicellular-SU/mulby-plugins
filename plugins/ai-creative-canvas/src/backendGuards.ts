const MB = 1024 * 1024

// host-worker 只能整块写文件，无法把 fetch body 直接 pipe 到磁盘；因此必须在进入 Buffer 前设硬上限。
export const MAX_REMOTE_MEDIA_BYTES = 256 * MB
export const MAX_UPLOAD_IMAGE_BYTES = 50 * MB

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
