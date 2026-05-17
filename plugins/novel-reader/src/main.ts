/// <reference path="./types/mulby.d.ts" />

declare const require: any
const { readFile: readFsFile, open: openFsFile, stat: statFs } = require('node:fs/promises')
const jschardet = require('jschardet')
const iconv = require('iconv-lite')

type PluginContext = BackendPluginContext

interface BookEntry {
  id: string
  title: string
  filePath: string
  addedAt: number
  lastReadAt: number
  progress: number
  chapterCount: number
  totalChars: number
  indexing: boolean
}

interface ChapterIndex {
  title: string
  startOffset: number
  endOffset: number
}

interface StoredChapterIndex {
  chapters: ChapterIndex[]
  totalChars: number
  indexedAt?: number
}

interface ReaderSettings {
  fontSize: number
  lineHeight: number
  theme: 'light' | 'dark' | 'sepia'
}

const BOOKSHELF_KEY = 'bookshelf'
const SETTINGS_KEY = 'settings'
const PROGRESS_PREFIX = 'progress:'
const CHAPTER_INDEX_PREFIX = 'chapters:'
const PREVIEW_BYTES = 128 * 1024

function bookId(filePath: string): string {
  let hash = 0
  for (let i = 0; i < filePath.length; i++) {
    const ch = filePath.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash |= 0
  }
  return `book_${Math.abs(hash).toString(36)}`
}

function titleFromPath(filePath: string): string {
  const name = filePath.split(/[/\\]/).pop() ?? 'unknown'
  return name.replace(/\.txt$/i, '')
}

function log(evt: string) {
  console.log(`[novel-reader] ${evt}`)
}

// ── 文件缓存 ──

const fileCache = new Map<string, string>()
const MAX_CACHE_SIZE = 3

function cacheFile(filePath: string, text: string) {
  if (fileCache.size >= MAX_CACHE_SIZE && !fileCache.has(filePath)) {
    const first = fileCache.keys().next().value
    if (first) fileCache.delete(first)
  }
  fileCache.delete(filePath)
  fileCache.set(filePath, text)
}

async function readFileCached(ctx: PluginContext, filePath: string): Promise<string> {
  const cached = fileCache.get(filePath)
  if (cached !== undefined) return cached
  const raw = await readFsFile(filePath)
  const detected = jschardet.detect(raw)
  const encoding = (detected && detected.encoding && detected.confidence > 0.8) ? detected.encoding : 'utf-8'
  const text = iconv.decode(raw, encoding)
  cacheFile(filePath, text)
  return text
}

function trimPreviewText(text: string, truncated: boolean): string {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!truncated) return normalized

  const lastParagraphBreak = normalized.lastIndexOf('\n\n')
  const lastLineBreak = normalized.lastIndexOf('\n')
  const trimIndex = Math.max(lastParagraphBreak, lastLineBreak)

  if (trimIndex > normalized.length * 0.6) {
    return normalized.slice(0, trimIndex).trimEnd()
  }

  return normalized.trimEnd()
}

async function readFilePreview(filePath: string): Promise<{ text: string; truncated: boolean }> {
  const cached = fileCache.get(filePath)
  if (cached !== undefined) {
    return { text: cached, truncated: false }
  }

  const stats = await statFs(filePath)
  const bufferSize = Math.max(1, Math.min(typeof stats?.size === 'number' ? stats.size : PREVIEW_BYTES, PREVIEW_BYTES))
  const fileHandle = await openFsFile(filePath, 'r')

  try {
    const buffer = new Uint8Array(bufferSize)
    const result = await fileHandle.read(buffer, 0, buffer.length, 0)
    const bytesRead = typeof result?.bytesRead === 'number' ? result.bytesRead : 0
    const truncated = typeof stats?.size === 'number' ? stats.size > bytesRead : false
    
    const subarray = buffer.subarray(0, bytesRead)
    const detected = jschardet.detect(Buffer.from(subarray))
    const encoding = (detected && detected.encoding && detected.confidence > 0.8) ? detected.encoding : 'utf-8'
    const text = iconv.decode(Buffer.from(subarray), encoding)
    
    return {
      text: trimPreviewText(text, truncated),
      truncated,
    }
  } finally {
    await fileHandle.close()
  }
}

// ── 章节解析 ──

const CHAPTER_PATTERNS = [
  /^第[零一二三四五六七八九十百千\d]+[章节回卷].*/,
  /^Chapter\s+\d+.*/i,
  /^[1-9]\d*[、，.]\s*\S/,
]

function parseChapterIndex(text: string): ChapterIndex[] {
  const lines = text.split('\n')
  const chapters: ChapterIndex[] = []
  let offset = 0
  for (const line of lines) {
    const trimmed = line.trim()
    const matched = CHAPTER_PATTERNS.some((re) => re.test(trimmed))
    if (matched && trimmed.length <= 40) {
      if (chapters.length > 0) {
        chapters[chapters.length - 1].endOffset = offset - 1
      }
      chapters.push({ title: trimmed, startOffset: offset, endOffset: 0 })
    }
    offset += line.length + 1
  }
  if (chapters.length > 0) {
    chapters[chapters.length - 1].endOffset = text.length
  }
  return chapters
}

function normalizeStoredIndex(data: unknown): StoredChapterIndex | null {
  const value = data as Partial<StoredChapterIndex> | null | undefined
  if (!value || !Array.isArray(value.chapters)) return null
  return {
    chapters: value.chapters.filter((chapter) =>
      chapter
      && typeof chapter.title === 'string'
      && typeof chapter.startOffset === 'number'
      && typeof chapter.endOffset === 'number'
    ),
    totalChars: typeof value.totalChars === 'number' ? value.totalChars : 0,
    indexedAt: typeof value.indexedAt === 'number' ? value.indexedAt : undefined,
  }
}

function normalizeBooks(data: unknown): BookEntry[] {
  return Array.isArray(data) ? data as BookEntry[] : []
}

function normalizeProgress(data: unknown): number {
  const value = data as { progress?: unknown } | null | undefined
  return typeof value?.progress === 'number' ? value.progress : 0
}

function normalizeSettings(data: unknown): ReaderSettings {
  const value = data as Partial<ReaderSettings> | null | undefined
  if (
    value
    && typeof value.fontSize === 'number'
    && typeof value.lineHeight === 'number'
    && (value.theme === 'light' || value.theme === 'dark' || value.theme === 'sepia')
  ) {
    return value as ReaderSettings
  }
  return { fontSize: 18, lineHeight: 1.8, theme: 'light' }
}

async function updateBookEntry(ctx: PluginContext, bookId: string, patch: Partial<BookEntry>): Promise<BookEntry | null> {
  const books = normalizeBooks(await ctx.api.storage.get(BOOKSHELF_KEY))
  const idx = books.findIndex((b) => b.id === bookId)
  if (idx === -1) return null
  books[idx] = { ...books[idx], ...patch }
  await ctx.api.storage.set(BOOKSHELF_KEY, books)
  return books[idx]
}

async function saveChapterIndexResult(
  ctx: PluginContext,
  bookId: string,
  chapters: ChapterIndex[],
  totalChars: number,
) {
  const safeChapters = chapters.filter((chapter) =>
    chapter
    && typeof chapter.title === 'string'
    && Number.isFinite(chapter.startOffset)
    && Number.isFinite(chapter.endOffset)
    && chapter.endOffset >= chapter.startOffset
  )

  await ctx.api.storage.set(`${CHAPTER_INDEX_PREFIX}${bookId}`, {
    chapters: safeChapters,
    totalChars,
    indexedAt: Date.now(),
  })

  await updateBookEntry(ctx, bookId, {
    indexing: false,
    chapterCount: safeChapters.length,
    totalChars,
  })

  return { chapters: safeChapters, totalChars, chapterCount: safeChapters.length }
}

// ── 生命周期 ──

export function onLoad() { log('插件已加载') }
export function onUnload() { log('插件已卸载') }
export function onEnable() { log('插件已启用') }
export function onDisable() { log('插件已禁用') }

export async function run(_context: PluginContext) {
  log('插件触发')
}

// ── Host RPC ──

export const host = {

  // 导入小说：先登记到书架并标记建目录，正文读取与目录解析由阅读页继续执行
  async importBook(ctx: PluginContext, filePath: string) {
    const id = bookId(filePath)
    const storage = ctx.api.storage
    const books = normalizeBooks(await storage.get(BOOKSHELF_KEY))
    const existingIdx = books.findIndex((b) => b.id === id)
    const existing = existingIdx !== -1 ? books[existingIdx] : null
    const storedIndex = normalizeStoredIndex(await storage.get(`${CHAPTER_INDEX_PREFIX}${id}`))
    const hasCompletedIndex = Boolean(storedIndex)

    const entry: BookEntry = {
      id,
      title: titleFromPath(filePath),
      filePath,
      addedAt: existing?.addedAt ?? Date.now(),
      lastReadAt: existing?.lastReadAt ?? 0,
      progress: existing?.progress ?? 0,
      chapterCount: hasCompletedIndex ? storedIndex!.chapters.length : 0,
      totalChars: storedIndex?.totalChars ?? existing?.totalChars ?? 0,
      indexing: !hasCompletedIndex,
    }

    if (existingIdx !== -1) {
      books[existingIdx] = entry
    } else {
      books.push(entry)
    }

    await storage.set(BOOKSHELF_KEY, books)
    log(`导入: ${entry.title}`)
    return { book: entry }
  },

  // 快速返回正文首屏，避免等待整本书读取完成
  async openBookPreview(ctx: PluginContext, filePath: string, bookId: string) {
    const preview = await readFilePreview(filePath)
    const storedIndex = normalizeStoredIndex(await ctx.api.storage.get(`${CHAPTER_INDEX_PREFIX}${bookId}`))

    return {
      text: preview.text,
      truncated: preview.truncated,
      chapters: storedIndex?.chapters ?? [],
      indexed: Boolean(storedIndex),
    }
  },

  // 打开书籍数据：返回全文 + 已有章节索引（如有）
  async openBookData(ctx: PluginContext, filePath: string, bookId: string) {
    const text = await readFileCached(ctx, filePath)
    const key = `${CHAPTER_INDEX_PREFIX}${bookId}`
    const storedIndex = normalizeStoredIndex(await ctx.api.storage.get(key))
    let chapters = storedIndex?.chapters ?? []
    let indexed = Boolean(storedIndex)

    if (storedIndex && storedIndex.totalChars !== text.length) {
      chapters = []
      indexed = false
      await ctx.api.storage.remove(key)
    }

    await updateBookEntry(ctx, bookId, {
      totalChars: text.length,
      chapterCount: indexed ? chapters.length : 0,
      indexing: !indexed,
    })

    return { text, chapters, totalChars: text.length, indexed }
  },

  // 建立章节索引：从缓存读 → 解析 → 存储 → 返回章节列表
  async indexBook(ctx: PluginContext, filePath: string, bookId: string) {
    const text = fileCache.get(filePath) ?? await readFileCached(ctx, filePath)
    const chapters = parseChapterIndex(text)
    const totalChars = text.length
    const result = await saveChapterIndexResult(ctx, bookId, chapters, totalChars)
    log(`索引完成: ${bookId}, ${chapters.length} 章`)
    return result
  },

  // 保存前端分片解析出的目录结果
  async saveChapterIndex(ctx: PluginContext, bookId: string, chapters: ChapterIndex[], totalChars: number) {
    const result = await saveChapterIndexResult(ctx, bookId, chapters, totalChars)
    log(`索引保存: ${bookId}, ${result.chapterCount} 章`)
    return result
  },

  // 读取章节文本
  async readChapter(ctx: PluginContext, filePath: string, startOffset: number, endOffset: number) {
    const text = await readFileCached(ctx, filePath)
    return text.slice(startOffset, endOffset)
  },

  async getBookList(ctx: PluginContext): Promise<BookEntry[]> {
    return normalizeBooks(await ctx.api.storage.get(BOOKSHELF_KEY))
  },

  async removeBook(ctx: PluginContext, bookId: string): Promise<boolean> {
    const books = normalizeBooks(await ctx.api.storage.get(BOOKSHELF_KEY))
    const book = books.find((b) => b.id === bookId)
    const filtered = books.filter((b) => b.id !== bookId)
    if (filtered.length === books.length) return false
    await ctx.api.storage.set(BOOKSHELF_KEY, filtered)
    await ctx.api.storage.remove(`${PROGRESS_PREFIX}${bookId}`)
    await ctx.api.storage.remove(`${CHAPTER_INDEX_PREFIX}${bookId}`)
    if (book) fileCache.delete(book.filePath)
    return true
  },

  async saveProgress(ctx: PluginContext, bookId: string, progress: number): Promise<void> {
    await ctx.api.storage.set(`${PROGRESS_PREFIX}${bookId}`, { progress, updatedAt: Date.now() })
    const books = normalizeBooks(await ctx.api.storage.get(BOOKSHELF_KEY))
    const idx = books.findIndex((b) => b.id === bookId)
    if (idx !== -1) {
      books[idx].progress = progress
      books[idx].lastReadAt = Date.now()
      await ctx.api.storage.set(BOOKSHELF_KEY, books)
    }
  },

  async getProgress(ctx: PluginContext, bookId: string): Promise<number> {
    return normalizeProgress(await ctx.api.storage.get(`${PROGRESS_PREFIX}${bookId}`))
  },

  async getSettings(ctx: PluginContext): Promise<ReaderSettings> {
    return normalizeSettings(await ctx.api.storage.get(SETTINGS_KEY))
  },

  async saveSettings(ctx: PluginContext, settings: ReaderSettings): Promise<void> {
    await ctx.api.storage.set(SETTINGS_KEY, settings)
  },
}

export default { onLoad, onUnload, onEnable, onDisable, run, host }
