export const PET_PRESENTATION_LOG_PREFIX = '[desktop-pet][presentation]'

type LogDetail = Record<string, unknown> | undefined

/** 仅当为 true 时打印「调试」级别日志（工具流、chunk、渲染细节等）。错误/告警不受此限制。 */
let debugEnabled = false
let debugFlagInitialized = false

function readStoredDebugFlag(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage?.getItem('pet-presentation-debug') === '1'
  } catch {
    return false
  }
}

function ensureDebugFlagLoaded() {
  if (debugFlagInitialized) return
  debugFlagInitialized = true
  debugEnabled = readStoredDebugFlag()
}

/** 打开/关闭详细 presentation 调试日志，并写入 localStorage（键 `pet-presentation-debug`）。 */
export function setPetPresentationDebug(enabled: boolean) {
  ensureDebugFlagLoaded()
  debugEnabled = enabled
  if (typeof window === 'undefined') return
  try {
    if (enabled) window.localStorage.setItem('pet-presentation-debug', '1')
    else window.localStorage.removeItem('pet-presentation-debug')
  } catch {
    /* ignore */
  }
}

export function getPetPresentationDebug(): boolean {
  ensureDebugFlagLoaded()
  return debugEnabled
}

export type PetPresentationLogLevel = 'debug' | 'warn' | 'error'

/** 未显式传入 level 时，按事件名粗分：避免在默认情况下刷屏。 */
function inferLevelFromEvent(event: string): PetPresentationLogLevel {
  if (
    /\.error$/.test(event) ||
    /-error$/.test(event) ||
    /require-error$/.test(event) ||
    /generate\.error$/.test(event) ||
    /tick\.error$/.test(event) ||
    /start\.error$/.test(event) ||
    /fetch-error$/.test(event) ||
    /save-error$/.test(event) ||
    /load-error$/.test(event)
  ) {
    return 'error'
  }
  if (
    /\.abort$/.test(event) ||
    /\.invalid$/.test(event) ||
    /rejected/.test(event) ||
    /parse-failed/.test(event) ||
    /missing/.test(event) ||
    /no-session/.test(event) ||
    /skip\.sensitive/.test(event) ||
    /save-failed/.test(event) ||
    /\.unsupported$/.test(event)
  ) {
    return 'warn'
  }
  return 'debug'
}

function trimLogString(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 160) return normalized
  return `${normalized.slice(0, 157)}...(${normalized.length} chars)`
}

function sanitizeForLog(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return trimLogString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeForLog(item, depth + 1, seen))
  if (typeof value === 'object') {
    if (depth >= 3) return '[object]'
    if (seen.has(value)) return '[circular]'
    seen.add(value)
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeForLog(item, depth + 1, seen)
    }
    return out
  }
  return String(value)
}

export function formatPetPresentationLog(event: string, detail?: LogDetail): string {
  if (detail === undefined) return `${PET_PRESENTATION_LOG_PREFIX} ${event}`
  return `${PET_PRESENTATION_LOG_PREFIX} ${event} ${JSON.stringify(sanitizeForLog(detail))}`
}

/**
 * @param level 省略时按事件名推断。`debug` 仅在 `setPetPresentationDebug(true)` 或 localStorage `pet-presentation-debug=1` 时输出。
 * 任意文件里需要**始终可见**的排查信息可传 `level: 'warn' | 'error'`，或直接使用 `console.log`。
 */
export function logPetPresentation(event: string, detail?: LogDetail, level?: PetPresentationLogLevel) {
  ensureDebugFlagLoaded()
  const resolved = level ?? inferLevelFromEvent(event)
  if (resolved === 'debug' && !debugEnabled) return

  const line = (() => {
    try {
      return formatPetPresentationLog(event, detail)
    } catch {
      return `${PET_PRESENTATION_LOG_PREFIX} ${event}`
    }
  })()

  try {
    if (resolved === 'error') console.error(line)
    else if (resolved === 'warn') console.warn(line)
    else console.info(line)
  } catch {
    /* logging must never affect pet behavior */
  }
}
