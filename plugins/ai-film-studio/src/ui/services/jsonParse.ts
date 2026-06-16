/**
 * 从模型输出中稳健地提取 JSON。
 * 兼容：```json 代码块 / 裸 JSON / 前后夹带自然语言说明。
 */

function sliceBalanced(s: string): string | null {
  const start = s.search(/[{[]/)
  if (start < 0) return null
  const open = s[start]
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

export function extractJson(content: string): unknown | null {
  if (!content) return null
  const candidates: string[] = []
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) candidates.push(fenced[1])
  candidates.push(content)

  for (const c of candidates) {
    const trimmed = c.trim()
    try {
      return JSON.parse(trimmed)
    } catch {
      const balanced = sliceBalanced(trimmed)
      if (balanced) {
        try {
          return JSON.parse(balanced)
        } catch {
          // 继续尝试下一个候选
        }
      }
    }
  }
  return null
}

/** 去除代码块与分隔线，得到自然语言说明部分 */
export function stripCodeFences(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*---\s*$/gm, '')
    .trim()
}
