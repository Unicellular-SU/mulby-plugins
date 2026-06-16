/**
 * 文本引擎：流式调用 mulby.ai.call（复用宿主 AI，零配置）。
 * 支持中断（abort）。M4 起可叠加自定义供应商覆盖。
 */

export interface TextRunOptions {
  model?: string | null
  system: string
  user: string
  /** 为 true 时请求宿主结构化输出（response_format: json_object），从源头约束为合法 JSON */
  jsonMode?: boolean
  onText?: (chunk: string) => void
  onReasoning?: (chunk: string) => void
}

export interface TextRunResult {
  content: string
  reasoning?: string
}

// 当前进行中的请求（支持中断）
let current: { abort: () => void } | null = null

export function abortText() {
  if (current) {
    try {
      current.abort()
    } catch {
      // 忽略
    }
    current = null
  }
}

export async function runText(opts: TextRunOptions): Promise<TextRunResult> {
  const ai = window.mulby?.ai
  if (!ai?.call) throw new Error('Mulby AI 不可用（请在宿主中配置模型）')

  const messages: AiMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ]

  let errorMessage = ''
  // 自行累积流式增量：流式调用时 await 的 result.content 可能为空/不完整
  // （对齐 mulby-ai-chat 的做法），最终文本以累积值为准。
  let acc = ''
  let accReasoning = ''
  // 结构化输出（宿主 v0.9+）：让模型从源头只产出合法 JSON；旧宿主忽略该参数（不影响）
  const params = opts.jsonMode ? { responseFormat: 'json_object' as const } : undefined
  const req = ai.call({ messages, model: opts.model || undefined, params }, (chunk: AiMessage) => {
    switch (chunk.chunkType) {
      case 'text': {
        const t = typeof chunk.content === 'string' ? chunk.content : ''
        if (t) {
          acc += t
          opts.onText?.(t)
        }
        break
      }
      case 'reasoning': {
        const r = chunk.reasoning_content || ''
        if (r) {
          accReasoning += r
          opts.onReasoning?.(r)
        }
        break
      }
      case 'error': {
        if (chunk.error?.message) errorMessage = chunk.error.message
        break
      }
    }
  })

  current = req
  try {
    const result = await req
    const resultContent = typeof result.content === 'string' ? result.content : ''
    // 优先用累积的流式文本；非流式或未收到增量时回退 result.content
    const content = acc || resultContent
    if (!content && (errorMessage || result.error?.message)) {
      throw new Error(errorMessage || result.error?.message || 'AI 调用失败')
    }
    return { content, reasoning: accReasoning || result.reasoning_content }
  } finally {
    current = null
  }
}
