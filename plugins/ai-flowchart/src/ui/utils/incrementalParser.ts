/**
 * 增量 JSON 解析器：从流式文本中提取已完成的节点和边
 *
 * AI 输出格式：
 * ```json
 * { "nodes": [ {...}, {...} ], "edges": [ {...}, {...} ], "metadata": {...} }
 * ```
 *
 * 本解析器在 JSON 未完成时，尽量提取已闭合的 node/edge 对象，
 * 实现"边输出边绘制"效果。
 */

interface PartialFlowData {
  nodes: any[]
  edges: any[]
  metadata?: any
}

/**
 * 从流式文本中提取 JSON 代码块内容
 */
function extractJsonBlock(text: string): string | null {
  // 匹配 ```json ... ``` 或 ``` ... ``` 代码块
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)(?:```|$)/)
  if (match) return match[1]

  // 也尝试匹配裸 JSON（以 { 开头）
  const braceStart = text.indexOf('{')
  if (braceStart >= 0) return text.slice(braceStart)

  return null
}

/**
 * 用括号计数法提取数组中的完整 JSON 对象
 * 从 startIdx 开始搜索 '[' 后面的每个 {...} 对象
 */
function extractCompleteObjects(text: string, arrayKey: string): any[] {
  const results: any[] = []

  // 找到 "nodes": [ 或 "edges": [ 的位置
  const keyPattern = new RegExp(`"${arrayKey}"\\s*:\\s*\\[`)
  const keyMatch = keyPattern.exec(text)
  if (!keyMatch) return results

  const arrayStart = keyMatch.index + keyMatch[0].length
  let i = arrayStart
  const len = text.length

  while (i < len) {
    // 跳过空白和逗号
    while (i < len && (text[i] === ' ' || text[i] === '\n' || text[i] === '\r' || text[i] === '\t' || text[i] === ',')) {
      i++
    }

    // 遇到 ] 说明数组结束
    if (i >= len || text[i] === ']') break

    // 期望遇到 {
    if (text[i] !== '{') {
      i++
      continue
    }

    // 用括号计数找到完整的 {...}
    let depth = 0
    let objStart = i
    let inString = false
    let escaped = false

    for (; i < len; i++) {
      const ch = text[i]

      if (escaped) {
        escaped = false
        continue
      }

      if (ch === '\\' && inString) {
        escaped = true
        continue
      }

      if (ch === '"') {
        inString = !inString
        continue
      }

      if (inString) continue

      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          // 找到一个完整对象
          const objStr = text.slice(objStart, i + 1)
          try {
            results.push(JSON.parse(objStr))
          } catch {
            // 解析失败则跳过
          }
          i++
          break
        }
      }
    }

    // 如果 depth > 0，说明对象未闭合，停止
    if (depth > 0) break
  }

  return results
}

/**
 * 从流式累积文本中解析已完成的流程图数据
 */
export function parsePartialFlowData(streamingText: string): PartialFlowData | null {
  const jsonBlock = extractJsonBlock(streamingText)
  if (!jsonBlock) return null

  const nodes = extractCompleteObjects(jsonBlock, 'nodes')
  const edges = extractCompleteObjects(jsonBlock, 'edges')

  if (nodes.length === 0 && edges.length === 0) return null

  // 尝试提取 metadata
  let metadata: any = undefined
  try {
    const metaMatch = jsonBlock.match(/"metadata"\s*:\s*(\{[^}]+\})/)
    if (metaMatch) {
      metadata = JSON.parse(metaMatch[1])
    }
  } catch {
    // metadata 可选，解析失败忽略
  }

  return { nodes, edges, metadata }
}
