import type { CardKind } from '../types'

export function extensionOf(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1 ? base.slice(dot + 1).toLowerCase() : ''
}

export function guessMimeByExt(ext: string): string {
  switch (ext.toLowerCase().replace(/^\./, '')) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'mp4': return 'video/mp4'
    case 'mov': return 'video/quicktime'
    case 'webm': return 'video/webm'
    case 'mp3': return 'audio/mpeg'
    case 'wav': return 'audio/wav'
    case 'aac': return 'audio/aac'
    case 'opus': return 'audio/opus'
    default: return ''
  }
}

/** 浏览器/系统可能不给 File.type，或只给 application/octet-stream；这两种情况按文件扩展名兜底。 */
export function resolveImportMime(name: string, declaredMime?: string): string {
  const declared = String(declaredMime || '').trim().toLowerCase()
  const guessed = guessMimeByExt(extensionOf(name))
  if (!declared || declared === 'application/octet-stream') return guessed || declared
  return declared
}

export function kindForMime(mime: string): CardKind {
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('text/')) return 'text'
  return 'source' // image/* 及其它 → 素材卡（图片类会走 source 预览）
}
