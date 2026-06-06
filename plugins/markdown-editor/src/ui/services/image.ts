export interface ImageFilesystem {
  writeFile: (path: string, data: string | ArrayBuffer, encoding?: 'utf-8' | 'base64') => Promise<void>
  exists: (path: string) => Promise<boolean>
  mkdir: (path: string) => Promise<void>
}

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (data instanceof Uint8Array) {
    return data.slice().buffer
  }
  return data
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg'
}

export function getDirectory(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : ''
}

export function getExtension(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function mimeFromExtension(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream'
}

export function extensionFromMime(mime: string): string {
  return EXT_BY_MIME[mime] ?? 'png'
}

export function joinPath(dir: string, name: string): string {
  if (!dir) {
    return name
  }
  return `${dir.replace(/[/\\]+$/, '')}/${name}`
}

export function bytesToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

export function buildDataUrl(buffer: ArrayBuffer | Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(buffer)}`
}

export function buildImageMarkdown(url: string, alt = ''): string {
  return `![${alt}](${url})`
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export interface ParsedDataUrl {
  mime: string
  ext: string
  bytes: Uint8Array
}

/** Parses a base64 data URL into its mime type, derived extension and bytes. */
export function parseDataUrl(dataUrl: string): ParsedDataUrl | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl.trim())
  if (!match || !match[2]) {
    return null
  }
  const mime = match[1] || 'image/png'
  try {
    const bytes = base64ToBytes(match[3])
    return { mime, ext: extensionFromMime(mime), bytes }
  } catch {
    return null
  }
}

export interface InlineDataImage {
  /** Absolute start index of the full `![alt](data:...)` token. */
  start: number
  /** Absolute end index (exclusive) of the token. */
  end: number
  alt: string
  dataUrl: string
}

const INLINE_DATA_IMAGE_RE = /!\[([^\]]*)\]\((data:[^)\s]+)\)/g

/** Finds all inline base64 data-URL image references in a markdown string. */
export function findInlineDataImages(markdown: string): InlineDataImage[] {
  const matches: InlineDataImage[] = []
  let result: RegExpExecArray | null
  INLINE_DATA_IMAGE_RE.lastIndex = 0
  while ((result = INLINE_DATA_IMAGE_RE.exec(markdown)) !== null) {
    matches.push({
      start: result.index,
      end: result.index + result[0].length,
      alt: result[1] ?? '',
      dataUrl: result[2] ?? ''
    })
  }
  return matches
}

export function hasInlineDataImage(markdown: string): boolean {
  INLINE_DATA_IMAGE_RE.lastIndex = 0
  return INLINE_DATA_IMAGE_RE.test(markdown)
}

/** Builds a unique asset file name like "image-20260605-1.png". */
export function buildAssetFileName(ext: string, seed = Date.now()): string {
  const date = new Date(seed)
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  const rand = Math.floor(Math.random() * 1000)
  return `image-${stamp}-${rand}.${ext}`
}

export interface SaveAssetResult {
  /** Markdown-friendly relative reference (POSIX separators). */
  relativePath: string
  /** Absolute path the asset was written to. */
  absolutePath: string
}

/** Converts an absolute filesystem path to a file:// URL suitable for an <img> src. */
export function toFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const prefix = normalized.startsWith('/') ? 'file://' : 'file:///'
  return `${prefix}${normalized.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * Normalizes an `<img>` src into a URL that a browser `<img>` element can load
 * during export. `data:` / `http(s):` / `file:` / `blob:` URLs pass through
 * untouched; absolute filesystem paths become `file://` URLs; relative paths are
 * resolved against the bound document directory. Returns `null` when a relative
 * path cannot be resolved (no bound directory) so callers can skip it.
 */
export function resolveImageHref(src: string, baseDir: string): string | null {
  const trimmed = src.trim()
  if (!trimmed) {
    return null
  }
  if (/^(data:|https?:|file:|blob:)/i.test(trimmed)) {
    return trimmed
  }
  // Absolute filesystem path (POSIX "/..." or Windows "C:\..." / "C:/...").
  if (trimmed.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(trimmed)) {
    return toFileUrl(trimmed)
  }
  if (!baseDir) {
    return null
  }
  const relative = trimmed.replace(/^\.\//, '')
  return toFileUrl(joinPath(baseDir, relative))
}

export interface ImageSize {
  width: number
  height: number
}

/**
 * Scales an image's natural pixel size down to fit a maximum width while
 * preserving aspect ratio. Dimensions are rounded to whole pixels (min 1).
 * Non-positive natural sizes fall back to the max width with a 4:3 ratio.
 */
export function fitImageSize(natural: ImageSize, maxWidth: number): ImageSize {
  const safeMax = maxWidth > 0 ? maxWidth : 1
  const width = natural.width > 0 ? natural.width : safeMax
  const height = natural.height > 0 ? natural.height : Math.round(safeMax * 0.75)
  if (width <= safeMax) {
    return {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height))
    }
  }
  const ratio = safeMax / width
  return {
    width: safeMax,
    height: Math.max(1, Math.round(height * ratio))
  }
}

/**
 * Saves an image into an arbitrary directory (creating it if needed) and
 * returns the absolute path. Used when there is no bound document to anchor a
 * relative path against.
 */
export async function saveImageToDir(
  filesystem: ImageFilesystem,
  dir: string,
  data: ArrayBuffer | Uint8Array,
  ext: string
): Promise<string> {
  if (!(await filesystem.exists(dir))) {
    await filesystem.mkdir(dir)
  }
  const fileName = buildAssetFileName(ext)
  const absolutePath = joinPath(dir, fileName)
  await filesystem.writeFile(absolutePath, toArrayBuffer(data))
  return absolutePath
}

/**
 * Saves an image next to the bound document under an `assets/` folder and
 * returns a relative path suitable for a Markdown image reference.
 */
export async function saveImageAsset(
  filesystem: ImageFilesystem,
  documentPath: string,
  data: ArrayBuffer | Uint8Array,
  ext: string,
  assetsDirName = 'assets'
): Promise<SaveAssetResult> {
  const docDir = getDirectory(documentPath)
  const assetsDir = joinPath(docDir, assetsDirName)
  if (!(await filesystem.exists(assetsDir))) {
    await filesystem.mkdir(assetsDir)
  }
  const fileName = buildAssetFileName(ext)
  const absolutePath = joinPath(assetsDir, fileName)
  await filesystem.writeFile(absolutePath, toArrayBuffer(data))
  return {
    relativePath: `${assetsDirName}/${fileName}`,
    absolutePath
  }
}

/**
 * Persists a decoded inline image and returns the short Markdown URL that
 * should replace the original `data:` URL (e.g. an `assets/` relative path or a
 * `file://` URL). Returning `null` leaves the original reference untouched.
 */
export type InlineImageSaver = (image: ParsedDataUrl) => Promise<string | null>

export interface ExtractInlineImagesResult {
  /** Markdown with inline base64 images replaced by short references. */
  markdown: string
  /** Number of inline images that were successfully extracted to disk. */
  extracted: number
}

/**
 * Walks a Markdown string, persists every inline base64 image via `save`, and
 * rewrites each `![alt](data:...)` reference to point at the saved short URL.
 * References that fail to parse or fail to save are left untouched so content
 * is never lost. Replacements are applied from the end backwards to keep the
 * earlier match offsets valid.
 */
export async function extractInlineImages(
  markdown: string,
  save: InlineImageSaver
): Promise<ExtractInlineImagesResult> {
  const matches = findInlineDataImages(markdown)
  if (matches.length === 0) {
    return { markdown, extracted: 0 }
  }

  let result = markdown
  let extracted = 0

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]
    const parsed = parseDataUrl(match.dataUrl)
    if (!parsed) {
      continue
    }
    let savedUrl: string | null
    try {
      savedUrl = await save(parsed)
    } catch {
      savedUrl = null
    }
    if (!savedUrl) {
      continue
    }
    const replacement = buildImageMarkdown(savedUrl, match.alt)
    result = result.slice(0, match.start) + replacement + result.slice(match.end)
    extracted += 1
  }

  return { markdown: result, extracted }
}
