/**
 * Toonflow 式重构 · 阶段6（§6.1）：Agent 工具循环运行时（host tool-calling）。
 *
 * ⚠ R1 待验证（见 toolCallingProbe）：宿主对【插件自定义 function 工具】是否「吐 tool_call 后停下等回灌」
 * 未经证实。本实现采用「格式无关」的回灌策略——只用 role+string content 的消息（保证宿主支持），把工具结果
 * 作为对话消息喂回，而非依赖未知的结构化 tool-result 消息格式；因此对支持 function-calling 的模型可用，
 * 不支持则降级为「只回文本、不动作」（此时仍有 jsonMode 确定性管线作默认兜底）。
 *
 * §6.1.1：每次 ai.call 用传入的 abortSignal，不复用 textEngine 全局单例，支持嵌套子 Agent / 并发取消。
 */

export interface AgentTool {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
  execute: (args: Record<string, unknown>) => Promise<string>
}

export interface ToolLoopOptions {
  model: string
  system: string
  user: string
  tools: AgentTool[]
  maxSteps?: number
  params?: { temperature?: number; maxOutputTokens?: number }
  signal?: AbortSignal
  onText?: (text: string) => void
  onToolCall?: (name: string, args: unknown) => void
  onToolResult?: (name: string, result: string) => void
}

function toAiTool(t: AgentTool): AiTool {
  return { type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }
}

function normalizeArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object') return args as Record<string, unknown>
  if (typeof args === 'string') {
    try {
      return JSON.parse(args) as Record<string, unknown>
    } catch {
      return { _raw: args }
    }
  }
  return {}
}

/** 运行工具循环，返回最终文本回复。 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<string> {
  const ai = window.mulby?.ai
  if (!ai?.call) throw new Error('宿主 AI 不可用（请在宿主配置文本模型）')
  const maxSteps = opts.maxSteps ?? 8
  const params: AiModelParameters | undefined = opts.params && Object.keys(opts.params).length ? opts.params : undefined
  const aiTools = opts.tools.map(toAiTool)
  const msgs: AiMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ]
  let lastText = ''

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) break
    const calls: Array<{ id?: string; name?: string; args?: unknown }> = []
    let text = ''
    const req = ai.call({ messages: msgs, model: opts.model, tools: aiTools, params }, (chunk: AiMessage) => {
      if (chunk.chunkType === 'text' && typeof chunk.content === 'string') {
        text += chunk.content
        opts.onText?.(chunk.content)
      }
      if (chunk.tool_call) calls.push(chunk.tool_call)
    })
    const onAbort = () => {
      try {
        req.abort()
      } catch {
        // 忽略
      }
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    let result: AiMessage
    try {
      result = await req
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
    }
    // 非流式：结果对象本身可能带 tool_call
    if (result?.tool_call && !calls.some((c) => c.id === result.tool_call!.id)) calls.push(result.tool_call)
    const finalText = text || (typeof result.content === 'string' ? result.content : '')
    if (finalText) lastText = finalText

    if (calls.length === 0) return finalText || lastText || '（无回复）'

    // 有工具调用：把本轮助手文本 + 各工具结果作为对话消息回灌（格式无关）
    if (finalText) msgs.push({ role: 'assistant', content: finalText })
    for (const call of calls) {
      if (opts.signal?.aborted) return lastText
      const name = call.name || ''
      opts.onToolCall?.(name, call.args)
      const tool = opts.tools.find((t) => t.name === name)
      let out = ''
      try {
        out = tool ? await tool.execute(normalizeArgs(call.args)) : `未知工具：${name}`
      } catch (e) {
        out = '工具执行出错：' + (e instanceof Error ? e.message : String(e))
      }
      opts.onToolResult?.(name, out)
      msgs.push({ role: 'user', content: `[工具 ${name} 结果]\n${out}` })
    }
  }
  return lastText || '（已达最大工具步数）'
}
