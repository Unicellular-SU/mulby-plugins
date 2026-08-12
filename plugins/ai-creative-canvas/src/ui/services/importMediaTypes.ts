import type { CardKind } from '../types'
import { localImportExtension, localImportMime } from '../../backendGuards'

const SUPPORTED_IMPORT_MIMES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/wav', 'audio/aac', 'audio/opus', 'audio/mp4', 'audio/flac', 'audio/ogg',
  'text/plain', 'text/markdown', 'application/json', 'application/x-subrip'
])

export function extensionOf(name: string): string {
  return localImportExtension(name)
}

export function guessMimeByExt(ext: string): string {
  const clean = ext.toLowerCase().replace(/^\./, '')
  return clean ? localImportMime(`resource.${clean}`) : ''
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
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/x-subrip') return 'text'
  return 'source' // image/* 及其它 → 素材卡（图片类会走 source 预览）
}

export function isSupportedImportMime(mime: string): boolean {
  const value = String(mime || '').toLowerCase()
  return SUPPORTED_IMPORT_MIMES.has(value)
}

/** 同步解析拖拽事件里的 URI/纯文本路径；调用方必须在任何 await 之前执行。 */
export function parseDroppedPathText(raw: string): string[] {
  if (!raw) return []
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !!line && !line.startsWith('#'))
    .map((line) => {
      if (!line.startsWith('file://')) return line
      try {
        let path = decodeURIComponent(line.replace(/^file:\/\//, ''))
        if (/^\/[a-zA-Z]:\//.test(path)) path = path.slice(1)
        return path
      } catch {
        return line.replace(/^file:\/\//, '')
      }
    })
    .filter(Boolean)
}
