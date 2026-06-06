// Per-document AI image-generation history. Generated images are saved to disk
// (see App `persistImageGeneration`) and only their lightweight metadata is kept
// here, keyed by document, so reopening the generator shows everything produced
// for that document — even images that were never inserted. Pure + DOM-free so
// the bookkeeping stays unit-testable.

export interface ImageHistoryItem {
  /** Stable id used for de-duplication and lookup on insert. */
  id: string
  /** Prompt the image was generated from. */
  prompt: string
  /** Size preset value (e.g. "1024x1024"). */
  size: string
  /** Absolute path of the saved image file on disk. */
  path: string
  /** Creation time (ms epoch). */
  createdAt: number
}

/** Map of document key -> its image-generation history (newest first). */
export type ImageHistoryMap = Record<string, ImageHistoryItem[]>

/** Document key used while the editor is not bound to a file (a draft). */
export const DRAFT_DOC_KEY = '__draft__'

/** Maximum number of history entries kept per document. */
export const IMAGE_HISTORY_LIMIT = 30

/** Derives the history bucket key for a (possibly unbound) document path. */
export function docKeyForPath(filePath: string | null | undefined): string {
  const trimmed = (filePath ?? '').trim()
  return trimmed || DRAFT_DOC_KEY
}

function isValidItem(value: unknown): value is ImageHistoryItem {
  if (!value || typeof value !== 'object') {
    return false
  }
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.path === 'string' &&
    item.path.length > 0 &&
    typeof item.prompt === 'string' &&
    typeof item.size === 'string' &&
    typeof item.createdAt === 'number'
  )
}

/** Validates and sanitizes a raw value loaded from storage into a clean map. */
export function normalizeHistoryMap(raw: unknown): ImageHistoryMap {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const out: ImageHistoryMap = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !Array.isArray(value)) {
      continue
    }
    const items = value.filter(isValidItem).slice(0, IMAGE_HISTORY_LIMIT)
    if (items.length > 0) {
      out[key] = items
    }
  }
  return out
}

/**
 * Returns a new map with `item` prepended to the given document's history,
 * de-duplicated by id and capped to `limit`. Never mutates the input.
 */
export function appendHistoryItem(
  map: ImageHistoryMap,
  docKey: string,
  item: ImageHistoryItem,
  limit = IMAGE_HISTORY_LIMIT
): ImageHistoryMap {
  const existing = map[docKey] ?? []
  const next = [item, ...existing.filter((entry) => entry.id !== item.id)].slice(0, limit)
  return { ...map, [docKey]: next }
}

/** Reads one document's history (newest first), or an empty array. */
export function getHistoryForDoc(map: ImageHistoryMap, docKey: string): ImageHistoryItem[] {
  return map[docKey] ?? []
}

/** Generates a reasonably unique history item id. */
export function makeHistoryId(now: number = Date.now()): string {
  return `img-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
