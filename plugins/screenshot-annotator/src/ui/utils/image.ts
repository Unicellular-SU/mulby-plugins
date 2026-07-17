// 截图标注插件共享的图片/编码工具函数。
// 合并自原 App.tsx / AiView.tsx / HistoryView.tsx / history.ts 中的重复实现。

export function createId(prefix = 'annotation') {
  const randomId = globalThis.crypto?.randomUUID?.()
  if (randomId) {
    return `${prefix}-${randomId}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function loadImage(dataUrl: string, errorMessage = '图片加载失败') {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(errorMessage))
    image.src = dataUrl
  })
}

export function dataUrlToBase64(dataUrl: string) {
  return dataUrl.split(',', 2)[1] ?? ''
}

export function dataUrlToArrayBuffer(dataUrl: string) {
  const base64 = dataUrlToBase64(dataUrl)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

export function bytesToBase64(buffer: ArrayBuffer | Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return btoa(binary)
}

export function arrayBufferToDataUrl(buffer: ArrayBuffer | Uint8Array, mime = 'image/png') {
  return `data:${mime};base64,${bytesToBase64(buffer)}`
}

export function ensurePngPath(path: string) {
  return path.toLowerCase().endsWith('.png') ? path : `${path}.png`
}

export function defaultPngFileName(prefix: string) {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')

  return `${prefix}-${stamp}.png`
}
