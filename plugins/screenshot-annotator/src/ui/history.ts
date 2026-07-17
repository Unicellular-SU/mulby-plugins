import { asFiniteNumber } from './annotations/normalize'
import type { CaptureRegion } from './annotations/types'
import { bytesToBase64, createId, dataUrlToBase64, loadImage } from './utils/image'

export type HistoryAnnotation = {
  id: string
  type: string
  [key: string]: unknown
}

export type HistoryDisplaySize = {
  width: number
  height: number
}

export type ScreenshotHistoryItem<TAnnotation = HistoryAnnotation> = {
  id: string
  createdAt: number
  updatedAt: number
  originalImagePath: string
  finalImagePath?: string
  thumbnailPath: string
  editableImagePath?: string
  annotations: TAnnotation[]
  imageMeta: {
    mime: string
    scaleFactor?: number
  }
  capture?: unknown
  displaySize?: HistoryDisplaySize
  fileSize: number
  width: number
  height: number
}

type HistoryStorage = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<unknown>
}

type HistoryFilesystem = {
  readFile(path: string, encoding?: 'utf-8' | 'base64'): Promise<string | ArrayBuffer | Uint8Array>
  writeFile(path: string, data: string | ArrayBuffer | Uint8Array, encoding?: 'utf-8' | 'base64'): Promise<void>
  exists(path: string): Promise<boolean>
  unlink(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  getDataPath?: (...subPaths: string[]) => string
  join?: (...paths: string[]) => string
}

export type HistoryApi = {
  storage: HistoryStorage
  filesystem: HistoryFilesystem
  system?: {
    getPath(name: 'userData' | 'temp'): Promise<string>
  }
}

type CreateHistoryInput<TAnnotation> = {
  rawDataUrl: string
  annotations: TAnnotation[]
  width: number
  height: number
  displaySize?: HistoryDisplaySize
  capture?: unknown
  imageMeta?: {
    mime?: string
    scaleFactor?: number
  }
}

type UpdateHistoryInput<TAnnotation> = {
  finalDataUrl?: string
  baseDataUrl?: string
  annotations?: TAnnotation[]
  width?: number
  height?: number
  displaySize?: HistoryDisplaySize
  capture?: unknown
  imageMeta?: {
    mime?: string
    scaleFactor?: number
  }
}

const INDEX_KEY = 'screenshot-history:index'
const HISTORY_DIR = 'screenshot-history'
const DEFAULT_LIMIT = 100

const IMAGE_FILES = {
  original: 'original.png',
  final: 'final.png',
  editable: 'editable.png',
  thumbnail: 'thumbnail.png'
} as const

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeDisplaySize(value: unknown): HistoryDisplaySize | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.width) || !isFiniteNumber(value.height)) {
    return undefined
  }

  return {
    width: Math.max(1, Math.round(value.width)),
    height: Math.max(1, Math.round(value.height))
  }
}

function normalizeHistoryItem(value: unknown): ScreenshotHistoryItem | null {
  if (!isRecord(value)) {
    return null
  }

  const id = typeof value.id === 'string' ? value.id : ''
  const originalImagePath = typeof value.originalImagePath === 'string' ? value.originalImagePath : ''
  const thumbnailPath = typeof value.thumbnailPath === 'string' ? value.thumbnailPath : ''

  if (!id || !originalImagePath || !thumbnailPath) {
    return null
  }

  const imageMeta = isRecord(value.imageMeta) ? value.imageMeta : {}

  return {
    id,
    createdAt: isFiniteNumber(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : Date.now(),
    originalImagePath,
    finalImagePath: typeof value.finalImagePath === 'string' ? value.finalImagePath : undefined,
    thumbnailPath,
    editableImagePath: typeof value.editableImagePath === 'string' ? value.editableImagePath : undefined,
    annotations: Array.isArray(value.annotations) ? value.annotations as HistoryAnnotation[] : [],
    imageMeta: {
      mime: typeof imageMeta.mime === 'string' ? imageMeta.mime : 'image/png',
      scaleFactor: isFiniteNumber(imageMeta.scaleFactor) ? imageMeta.scaleFactor : undefined
    },
    capture: value.capture,
    displaySize: normalizeDisplaySize(value.displaySize),
    fileSize: isFiniteNumber(value.fileSize) ? value.fileSize : 0,
    width: isFiniteNumber(value.width) ? value.width : 0,
    height: isFiniteNumber(value.height) ? value.height : 0
  }
}

function sortItems(items: ScreenshotHistoryItem[]) {
  return [...items].sort((a, b) => b.createdAt - a.createdAt)
}

function joinPath(api: HistoryApi, ...parts: string[]) {
  const filtered = parts.filter(Boolean)
  if (api.filesystem.join) {
    return api.filesystem.join(...filtered)
  }

  return filtered.join('/').replace(/\/+/g, '/')
}

async function getHistoryRoot(api: HistoryApi) {
  if (api.filesystem.getDataPath) {
    return api.filesystem.getDataPath(HISTORY_DIR)
  }

  if (api.system?.getPath) {
    return joinPath(api, await api.system.getPath('userData'), HISTORY_DIR)
  }

  throw new Error('当前环境不支持插件数据目录')
}

async function getItemDir(api: HistoryApi, id: string) {
  if (api.filesystem.getDataPath) {
    return api.filesystem.getDataPath(HISTORY_DIR, id)
  }

  return joinPath(api, await getHistoryRoot(api), id)
}

async function getItemPath(api: HistoryApi, id: string, fileName: string) {
  if (api.filesystem.getDataPath) {
    return api.filesystem.getDataPath(HISTORY_DIR, id, fileName)
  }

  return joinPath(api, await getItemDir(api, id), fileName)
}

async function ensureDirectory(api: HistoryApi, path: string) {
  try {
    await api.filesystem.mkdir(path)
  } catch {
    // mkdir may fail if the directory already exists; existence is verified by later writes.
  }
}

async function ensureItemDirectory(api: HistoryApi, id: string) {
  await ensureDirectory(api, await getHistoryRoot(api))
  await ensureDirectory(api, await getItemDir(api, id))
}

function getDataUrlMime(dataUrl: string) {
  return /^data:([^;,]+)[;,]/.exec(dataUrl)?.[1] ?? 'image/png'
}

function base64ByteLength(base64: string) {
  const clean = base64.replace(/\s/g, '')
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding)
}

async function writeDataUrl(api: HistoryApi, path: string, dataUrl: string) {
  await api.filesystem.writeFile(path, dataUrlToBase64(dataUrl), 'base64')
}

async function readBase64(api: HistoryApi, path: string) {
  const result = await api.filesystem.readFile(path, 'base64')

  if (typeof result === 'string') {
    return result
  }

  return bytesToBase64(result)
}

async function imageExists(api: HistoryApi, path?: string) {
  if (!path) {
    return false
  }

  try {
    return await api.filesystem.exists(path)
  } catch {
    return false
  }
}

async function deleteFiles(api: HistoryApi, item: ScreenshotHistoryItem) {
  const paths = Array.from(new Set([
    item.originalImagePath,
    item.finalImagePath,
    item.editableImagePath,
    item.thumbnailPath
  ].filter((path): path is string => Boolean(path))))

  await Promise.all(paths.map(async (path) => {
    try {
      if (await imageExists(api, path)) {
        await api.filesystem.unlink(path)
      }
    } catch {
      // A missing or locked file should not prevent index cleanup.
    }
  }))
}

async function saveIndex(api: HistoryApi, items: ScreenshotHistoryItem[]) {
  await api.storage.set(INDEX_KEY, sortItems(items).map((item) => cloneJson(item)))
}

async function savePrunedIndex(api: HistoryApi, items: ScreenshotHistoryItem[], limit = DEFAULT_LIMIT) {
  const sorted = sortItems(items)
  const kept = sorted.slice(0, limit)
  const removed = sorted.slice(limit)

  await saveIndex(api, kept)
  await Promise.all(removed.map((item) => deleteFiles(api, item)))
  return kept
}

export async function listHistoryItems(api: HistoryApi) {
  const raw = await api.storage.get(INDEX_KEY)
  const values = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.items)
      ? raw.items
      : []

  return sortItems(values.map(normalizeHistoryItem).filter((item): item is ScreenshotHistoryItem => Boolean(item)))
}

async function createThumbnailDataUrl(dataUrl: string, maxSize = 320) {
  const image = await loadImage(dataUrl, '缩略图生成失败')
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('无法创建缩略图画布')
  }

  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL('image/png')
}

export async function createHistoryItem<TAnnotation extends { id: string; type: string }>(
  api: HistoryApi,
  input: CreateHistoryInput<TAnnotation>
) {
  const id = createId('shot')
  const now = Date.now()
  const originalImagePath = await getItemPath(api, id, IMAGE_FILES.original)
  const thumbnailPath = await getItemPath(api, id, IMAGE_FILES.thumbnail)
  const rawMime = input.imageMeta?.mime ?? getDataUrlMime(input.rawDataUrl)

  await ensureItemDirectory(api, id)
  await writeDataUrl(api, originalImagePath, input.rawDataUrl)
  await writeDataUrl(api, thumbnailPath, await createThumbnailDataUrl(input.rawDataUrl))

  const item: ScreenshotHistoryItem<TAnnotation> = {
    id,
    createdAt: now,
    updatedAt: now,
    originalImagePath,
    finalImagePath: originalImagePath,
    thumbnailPath,
    editableImagePath: originalImagePath,
    annotations: cloneJson(input.annotations),
    imageMeta: {
      mime: rawMime,
      scaleFactor: input.imageMeta?.scaleFactor
    },
    capture: input.capture,
    displaySize: input.displaySize,
    fileSize: base64ByteLength(dataUrlToBase64(input.rawDataUrl)),
    width: input.width,
    height: input.height
  }

  const items = await listHistoryItems(api)
  await savePrunedIndex(api, [item as ScreenshotHistoryItem, ...items], DEFAULT_LIMIT)
  return item
}

export async function updateHistoryItem<TAnnotation extends { id: string; type: string }>(
  api: HistoryApi,
  id: string,
  input: UpdateHistoryInput<TAnnotation>
) {
  const items = await listHistoryItems(api)
  const index = items.findIndex((item) => item.id === id)

  if (index < 0) {
    throw new Error('历史记录不存在')
  }

  await ensureItemDirectory(api, id)

  const current = items[index]
  const next: ScreenshotHistoryItem = {
    ...current,
    updatedAt: Date.now(),
    annotations: input.annotations ? cloneJson(input.annotations) : current.annotations,
    capture: input.capture ?? current.capture,
    displaySize: input.displaySize ?? current.displaySize,
    imageMeta: {
      ...current.imageMeta,
      ...input.imageMeta,
      mime: input.imageMeta?.mime ?? current.imageMeta.mime ?? 'image/png'
    },
    width: input.width ?? current.width,
    height: input.height ?? current.height
  }

  if (input.baseDataUrl) {
    const editableImagePath = await getItemPath(api, id, IMAGE_FILES.editable)
    await writeDataUrl(api, editableImagePath, input.baseDataUrl)
    next.editableImagePath = editableImagePath
    next.imageMeta.mime = input.imageMeta?.mime ?? getDataUrlMime(input.baseDataUrl)
  }

  if (input.finalDataUrl) {
    const finalImagePath = await getItemPath(api, id, IMAGE_FILES.final)
    await writeDataUrl(api, finalImagePath, input.finalDataUrl)
    next.finalImagePath = finalImagePath
    next.fileSize = base64ByteLength(dataUrlToBase64(input.finalDataUrl))
    next.imageMeta.mime = input.imageMeta?.mime ?? getDataUrlMime(input.finalDataUrl)

    try {
      await writeDataUrl(api, next.thumbnailPath, await createThumbnailDataUrl(input.finalDataUrl))
    } catch {
      // Keep the previous thumbnail if the final image cannot be thumbnailed.
    }
  } else if (input.baseDataUrl) {
    try {
      await writeDataUrl(api, next.thumbnailPath, await createThumbnailDataUrl(input.baseDataUrl))
    } catch {
      // Keep the previous thumbnail if the editable image cannot be thumbnailed.
    }
  }

  const nextItems = [...items]
  nextItems[index] = next
  await savePrunedIndex(api, nextItems, DEFAULT_LIMIT)
  return next
}

export async function pruneHistory(api: HistoryApi, limit = DEFAULT_LIMIT) {
  const items = await listHistoryItems(api)
  return savePrunedIndex(api, items, limit)
}

export async function deleteHistoryItem(api: HistoryApi, id: string) {
  const items = await listHistoryItems(api)
  const target = items.find((item) => item.id === id)
  const kept = items.filter((item) => item.id !== id)

  await saveIndex(api, kept)

  if (target) {
    await deleteFiles(api, target)
  }
}

export async function clearHistory(api: HistoryApi) {
  const items = await listHistoryItems(api)
  await saveIndex(api, [])
  await Promise.all(items.map((item) => deleteFiles(api, item)))
}

export async function readHistoryImageDataUrl(
  api: HistoryApi,
  item: ScreenshotHistoryItem,
  kind: 'thumbnail' | 'final' | 'editable' | 'original' = 'final'
) {
  const candidates = kind === 'thumbnail'
    ? [item.thumbnailPath]
    : kind === 'original'
      ? [item.originalImagePath]
      : kind === 'editable'
        ? [item.editableImagePath, item.originalImagePath]
        : [item.finalImagePath, item.editableImagePath, item.originalImagePath]

  for (const path of candidates) {
    if (!path) {
      continue
    }

    try {
      if (await imageExists(api, path)) {
        return `data:${item.imageMeta.mime || 'image/png'};base64,${await readBase64(api, path)}`
      }
    } catch {
      // Try the next fallback path.
    }
  }

  throw new Error('历史图片文件缺失')
}

export async function loadHistoryItem(api: HistoryApi, id: string) {
  const item = (await listHistoryItems(api)).find((historyItem) => historyItem.id === id)

  if (!item) {
    throw new Error('历史记录不存在')
  }

  return {
    item,
    editableDataUrl: await readHistoryImageDataUrl(api, item, 'editable')
  }
}

export function getHistoryCaptureRegion(item: ScreenshotHistoryItem): CaptureRegion | undefined {
  const capture = item.capture as { region?: unknown } | undefined
  const region = capture?.region

  if (!region || typeof region !== 'object') {
    return undefined
  }

  const source = region as Record<string, unknown>
  const x = asFiniteNumber(source.x)
  const y = asFiniteNumber(source.y)
  const width = asFiniteNumber(source.width)
  const height = asFiniteNumber(source.height)

  if (x === null || y === null || width === null || height === null) {
    return undefined
  }

  return {
    x,
    y,
    width,
    height,
    scaleFactor: asFiniteNumber(source.scaleFactor) ?? undefined
  }
}

export function getHistoryScaleFactor(item: ScreenshotHistoryItem) {
  const capture = item.capture as {
    region?: { scaleFactor?: unknown }
    display?: { scaleFactor?: unknown }
  } | undefined

  return (
    item.imageMeta.scaleFactor ??
    asFiniteNumber(capture?.region?.scaleFactor) ??
    asFiniteNumber(capture?.display?.scaleFactor) ??
    window.devicePixelRatio ??
    1
  )
}
