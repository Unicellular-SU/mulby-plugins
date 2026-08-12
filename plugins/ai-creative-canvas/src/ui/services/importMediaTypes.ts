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

/**
 * 兼容 Mulby 不同宿主版本的文件选择结果：公开契约是 string[]，部分运行时会返回
 * `{ path }[]`、`{ filePath }[]`，或 Electron 风格 `{ filePaths: [...] }`。
 * 统一在 UI 边界提取真实路径，禁止把对象隐式转成 "[object Object]" 传给后端。
 */
export function normalizeOpenDialogPaths(value: unknown): string[] {
  const paths = new Set<string>()
  const visited = new Set<object>()
  const add = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    if (value.startsWith('file://')) {
      for (const path of parseDroppedPathText(value)) if (path) paths.add(path)
    } else {
      paths.add(value)
    }
  }
  const visit = (item: unknown, depth: number) => {
    if (depth > 6 || item == null) return
    if (typeof item === 'string') {
      add(item)
      return
    }
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1)
      return
    }
    if (typeof item !== 'object' || visited.has(item)) return
    visited.add(item)
    const record = item as Record<string, unknown>
    if (record.canceled === true) return
    for (const key of ['path', 'filePath', 'fullPath', 'nativePath', 'url']) {
      if (typeof record[key] === 'string') add(record[key] as string)
    }
    for (const key of ['filePaths', 'paths', 'files', 'data', 'result', 'value', 'selection']) {
      if (record[key] != null) visit(record[key], depth + 1)
    }
  }
  visit(value, 0)
  return [...paths]
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

/** 纯文本拖拽只接受明确的本地绝对路径，避免把网页文字误送给后端当文件读取。 */
export function parseDroppedPlainPathText(raw: string): string[] {
  return parseDroppedPathText(raw).filter((path) => (
    path.startsWith('/')
    || path.startsWith('\\\\')
    || /^[a-zA-Z]:[\\/]/.test(path)
  ))
}
