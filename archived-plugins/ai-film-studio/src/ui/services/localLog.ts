const PLUGIN_ID = 'ai-film-studio'
const FLUSH_DELAY = 600
const MAX_STRING = 16000
const MAX_ARRAY = 120
const MAX_KEYS = 120
const MAX_LINE = 120000

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  ts: string
  level: LogLevel
  scope: string
  event: string
  data?: unknown
}

let queue: string[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let flushing: Promise<void> = Promise.resolve()
let baseDirPromise: Promise<string> | null = null

function trimString(value: string, limit = MAX_STRING): string {
  return value.length > limit ? `${value.slice(0, limit)}…（已截断，原长 ${value.length}）` : value
}

function normalize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value
  if (typeof value === 'string') return trimString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Error) return { name: value.name, message: value.message, stack: trimString(value.stack ?? '') }
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  if (depth >= 6) return '[MaxDepth]'
  seen.add(value)
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((item) => normalize(item, depth + 1, seen))
    if (value.length > MAX_ARRAY) out.push(`…（数组已截断，原长 ${value.length}）`)
    return out
  }
  const out: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)
  for (const [key, val] of entries) out[key] = normalize(val, depth + 1, seen)
  const total = Object.keys(value as Record<string, unknown>).length
  if (total > MAX_KEYS) out.__truncatedKeys = total - MAX_KEYS
  return out
}

function toLine(entry: LogEntry): string {
  const normalized = { ...entry, data: normalize(entry.data) }
  const line = JSON.stringify(normalized)
  if (line.length <= MAX_LINE) return line
  return JSON.stringify({
    ts: entry.ts,
    level: entry.level,
    scope: entry.scope,
    event: entry.event,
    data: { truncated: true, preview: line.slice(0, MAX_LINE), length: line.length },
  })
}

async function getBaseDir(): Promise<string> {
  if (!baseDirPromise) {
    baseDirPromise = (async () => {
      try {
        return (await window.mulby?.system?.getPath('userData')) || ''
      } catch {
        return ''
      }
    })()
  }
  return baseDirPromise
}

async function callLogRpc<T>(method: 'appendLog' | 'getLogInfo', payload?: Record<string, unknown>): Promise<T> {
  const host = window.mulby?.host
  if (!host?.call) throw new Error('宿主 Host API 不可用')
  const baseDir = await getBaseDir()
  const res = (await host.call(PLUGIN_ID, method, { ...(payload ?? {}), baseDir })) as { success?: boolean; data?: T }
  if (!res?.data) throw new Error('日志 RPC 未返回数据')
  return res.data
}

function scheduleFlush() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushLogs()
  }, FLUSH_DELAY)
}

export function logLocal(level: LogLevel, scope: string, event: string, data?: unknown): void {
  try {
    queue.push(toLine({ ts: new Date().toISOString(), level, scope, event, data }))
    scheduleFlush()
  } catch (e) {
    console.warn('[ai-film-studio] log enqueue failed', e)
  }
}

export function logDebug(scope: string, event: string, data?: unknown): void {
  logLocal('debug', scope, event, data)
}

export function logInfo(scope: string, event: string, data?: unknown): void {
  logLocal('info', scope, event, data)
}

export function logWarn(scope: string, event: string, data?: unknown): void {
  logLocal('warn', scope, event, data)
}

export function logError(scope: string, event: string, error: unknown, data?: unknown): void {
  logLocal('error', scope, event, { ...(data && typeof data === 'object' ? (data as Record<string, unknown>) : { data }), error })
}

export async function flushLogs(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (!queue.length) return flushing
  const batch = queue
  queue = []
  flushing = flushing
    .catch(() => undefined)
    .then(async () => {
      try {
        const data = await callLogRpc<{ ok?: boolean; path?: string; error?: string }>('appendLog', { lines: batch })
        if (!data.ok) throw new Error(data.error || '写入日志失败')
      } catch (e) {
        queue = batch.concat(queue).slice(-1000)
        console.warn('[ai-film-studio] log flush failed', e)
      }
    })
  return flushing
}

export async function getLogFilePath(): Promise<string> {
  const data = await callLogRpc<{ ok?: boolean; path?: string; error?: string }>('getLogInfo')
  if (!data.ok || !data.path) throw new Error(data.error || '无法获取日志路径')
  return data.path
}
