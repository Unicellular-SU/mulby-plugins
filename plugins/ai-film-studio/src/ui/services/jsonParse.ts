/**
 * 从模型输出中稳健地提取 JSON。
 * 兼容：纯 JSON / ```json 代码块（含未闭合）/ 前后夹带自然语言说明 /
 * 自然语言里夹带的假 {} / 尾随逗号 等常见模型瑕疵。
 */

/** 从 start 处（必须是 { 或 [）扫描出配平的子串；支持字符串内转义 */
function sliceBalancedFrom(s: string, start: number): string | null {
  const open = s[start]
  if (open !== '{' && open !== '[') return null
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

/** 直接 JSON.parse；失败则去掉尾随逗号后重试 */
function tryParse(raw: string): unknown | null {
  const t = raw.trim()
  if (!t) return null
  try {
    return JSON.parse(t)
  } catch {
    // 容错：对象/数组里的尾随逗号（如 ,] 或 ,}）是最常见的模型瑕疵
    const noTrailing = t.replace(/,(\s*[}\]])/g, '$1')
    if (noTrailing !== t) {
      try {
        return JSON.parse(noTrailing)
      } catch {
        // 继续
      }
    }
  }
  return null
}

/** 在一段文本里尽力解析出对象/数组：整体解析 → 扫描所有 {/[ 起点的配平子串（最长优先） */
function parseLoose(text: string): unknown | null {
  if (!text) return null
  const whole = tryParse(text)
  if (whole !== null && typeof whole === 'object') return whole

  const candidates: string[] = []
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '{' || ch === '[') {
      const slice = sliceBalancedFrom(text, i)
      if (slice) candidates.push(slice)
    }
  }
  // 最长优先：自然语言里的假 {} 通常较短，真正的结构体最长
  candidates.sort((a, b) => b.length - a.length)
  for (const c of candidates) {
    const v = tryParse(c)
    if (v !== null && typeof v === 'object') return v
  }
  return null
}

export function extractJson(content: string): unknown | null {
  if (!content) return null
  // 1) 优先所有 ```fenced``` 代码块内部（最可能是结构化输出）
  const fences = [...content.matchAll(/```(?:json|JSON)?\s*([\s\S]*?)```/g)].map((m) => m[1])
  for (const f of fences) {
    const v = parseLoose(f)
    if (v !== null) return v
  }
  // 2) 整体 + 配平扫描（覆盖纯 JSON、prose+JSON、未闭合围栏等）
  return parseLoose(content)
}

/** 去除代码块与分隔线，得到自然语言说明部分 */
export function stripCodeFences(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*---\s*$/gm, '')
    .trim()
}
