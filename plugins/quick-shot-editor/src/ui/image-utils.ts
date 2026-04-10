const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif'
}

export function sleep(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function createId(prefix = 'item') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function arrayBufferToDataUrl(
  buffer: ArrayBuffer | Uint8Array,
  mimeType = 'image/png'
) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })

  return `data:${mimeType};base64,${btoa(binary)}`
}

export function dataUrlToBase64(dataUrl: string) {
  const [, base64 = ''] = dataUrl.split(',', 2)
  return base64
}

export function dataUrlToUint8Array(dataUrl: string) {
  const binary = atob(dataUrlToBase64(dataUrl))
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

export function dataUrlToArrayBuffer(dataUrl: string) {
  const bytes = dataUrlToUint8Array(dataUrl)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

export function guessMimeType(path: string) {
  const normalizedPath = path.toLowerCase()
  const match = Object.keys(MIME_BY_EXTENSION).find((extension) =>
    normalizedPath.endsWith(extension)
  )

  return match ? MIME_BY_EXTENSION[match] : 'image/png'
}

export function joinSystemPath(dir: string, leaf: string) {
  if (dir.endsWith('\\') || dir.endsWith('/')) {
    return `${dir}${leaf}`
  }

  return dir.includes('\\') ? `${dir}\\${leaf}` : `${dir}/${leaf}`
}

export function ensurePngPath(path: string) {
  return path.toLowerCase().endsWith('.png') ? path : `${path}.png`
}

export function formatDateTime(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value)
}

export function formatPixels(width: number, height: number) {
  return `${width} x ${height}`
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function makeDefaultShotName(prefix = 'quick-shot') {
  const stamp = new Date()
  const parts = [
    stamp.getFullYear(),
    String(stamp.getMonth() + 1).padStart(2, '0'),
    String(stamp.getDate()).padStart(2, '0'),
    String(stamp.getHours()).padStart(2, '0'),
    String(stamp.getMinutes()).padStart(2, '0'),
    String(stamp.getSeconds()).padStart(2, '0')
  ]

  return `${prefix}-${parts.join('')}.png`
}

export async function readImageFileAsDataUrl(
  path: string,
  filesystem: {
    readFile: (
      path: string,
      encoding?: 'utf-8' | 'base64'
    ) => Promise<string | ArrayBuffer | undefined>
  }
) {
  const encoded = await filesystem.readFile(path, 'base64')
  if (typeof encoded !== 'string' || !encoded) {
    throw new Error('无法读取图片文件')
  }

  return `data:${guessMimeType(path)};base64,${encoded}`
}

export async function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}
