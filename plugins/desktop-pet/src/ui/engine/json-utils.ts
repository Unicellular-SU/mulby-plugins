/**
 * AI 模型常常输出 ```json ... ``` 代码块或额外说明，直接 JSON.parse 容易抛错。
 * `extractJsonObject` 尝试从一段文本里宽松地找出第一个完整 JSON 对象。
 * 解析失败统一返回 null，调用方可拿到日志友好的失败原因。
 */

const FENCE = /```(?:json|JSON)?\s*([\s\S]*?)```/

export interface ExtractResult<T> {
  data: T | null
  reason?: 'empty' | 'no-object' | 'parse-failed'
  raw?: string
}

function findFirstJsonSegment(text: string): string | null {
  if (!text) return null
  const fenced = FENCE.exec(text)
  if (fenced && fenced[1]) return fenced[1].trim()

  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return text.slice(start, i + 1).trim()
      }
    }
  }
  return null
}

export function extractJsonObject<T = unknown>(text: string): ExtractResult<T> {
  if (!text) return { data: null, reason: 'empty' }
  const segment = findFirstJsonSegment(text)
  if (!segment) return { data: null, reason: 'no-object', raw: text }
  try {
    return { data: JSON.parse(segment) as T }
  } catch {
    return { data: null, reason: 'parse-failed', raw: segment }
  }
}

function findFirstJsonArray(text: string): string | null {
  if (!text) return null
  const start = text.indexOf('[')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return text.slice(start, i + 1).trim()
    }
  }
  return null
}

/** 从宽松文本中解析第一个 JSON 数组（支持 ``` 代码块包裹）。 */
export function extractJsonArray<T = unknown>(text: string): ExtractResult<T[]> {
  if (!text) return { data: null, reason: 'empty' }
  const fenced = FENCE.exec(text)
  const inner = fenced && fenced[1] ? fenced[1].trim() : text
  const segment = findFirstJsonArray(inner) ?? findFirstJsonArray(text)
  if (!segment) return { data: null, reason: 'no-object', raw: text }
  try {
    const parsed = JSON.parse(segment) as unknown
    if (!Array.isArray(parsed)) return { data: null, reason: 'parse-failed', raw: segment }
    return { data: parsed as T[] }
  } catch {
    return { data: null, reason: 'parse-failed', raw: segment }
  }
}
