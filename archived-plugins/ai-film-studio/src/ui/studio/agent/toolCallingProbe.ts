/**
 * Toonflow 式重构 · 阶段0：宿主 tool-calling 行为探针。
 *
 * 背景（见 docs/toonflow-workbench-parity-design.md §6.1 / R1）：phase6 的「真 tool-loop Agent」依赖一个
 * 未经证实的假设——宿主对【插件自定义 function 工具】是「吐出 tool_call 后停下、等我们回灌结果」，
 * 还是别的行为。mulby.d.ts 无注释佐证（internalTools/MCP 由宿主用 maxToolSteps 自动多步执行，
 * 但自定义 function 工具的语义未知）。本探针在 Mulby 运行态实测：发一个 echo 工具，强制模型调用，
 * 观察 chunk 行为，推断该用哪种循环策略。
 *
 * 用法（无 UI，避免污染界面）：在 Mulby 中打开本插件后，浏览器/宿主 devtools 控制台执行：
 *   await window.__filmStudioProbe()              // 用当前默认文本模型
 *   await window.__filmStudioProbe('vendor:model')// 指定模型
 * 结果对象的 `inference` 字段即「该用手动循环 / 宿主自动执行 / 不支持」的结论。
 */

export interface ToolCallingProbeResult {
  ok: boolean
  model?: string
  /** 观察到的全部 chunkType（去重） */
  chunkTypes: string[]
  sawToolCall: boolean
  sawToolResult: boolean
  toolCalls: Array<{ id?: string; name?: string; args?: unknown }>
  finalText: string
  /** 人类可读结论：手动 tool-loop / 宿主自动执行 / 不支持 / 探测失败 */
  inference: string
  error?: string
}

const ECHO_TOOL: AiTool = {
  type: 'function',
  function: {
    name: 'echo',
    description: '回显给定文本。当被要求回显时，必须调用本工具，不要用普通文本回答。',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: '要回显的文本' } },
      required: ['text'],
    },
  },
}

export async function runToolCallingProbe(model?: string): Promise<ToolCallingProbeResult> {
  const res: ToolCallingProbeResult = {
    ok: false,
    model: model || undefined,
    chunkTypes: [],
    sawToolCall: false,
    sawToolResult: false,
    toolCalls: [],
    finalText: '',
    inference: '',
  }
  const ai = window.mulby?.ai
  if (!ai?.call) {
    res.error = 'Mulby AI 不可用'
    res.inference = '无法探测：宿主 ai.call 不可用（请在宿主中配置文本模型）。'
    return res
  }

  const messages: AiMessage[] = [
    { role: 'system', content: '你是一个 function-calling 测试器。你必须调用 echo 工具，参数 text="ping"。禁止用普通文本回答。' },
    { role: 'user', content: '请回显 "ping"。' },
  ]
  const seen = new Set<string>()
  let finalText = ''

  try {
    // maxToolSteps: 1 —— 若宿主会自动执行自定义工具，限 1 步可暴露其「自动执行」行为；
    // 若宿主只吐 tool_call 等回灌，则这里拿到的就是「tool_call 无 tool_result」。
    const req = ai.call({ messages, model: model || undefined, tools: [ECHO_TOOL], maxToolSteps: 1 }, (chunk: AiMessage) => {
      if (chunk.chunkType) seen.add(chunk.chunkType)
      if (chunk.chunkType === 'text' && typeof chunk.content === 'string') finalText += chunk.content
      if (chunk.tool_call) {
        res.sawToolCall = true
        res.toolCalls.push({ id: chunk.tool_call.id, name: chunk.tool_call.name, args: chunk.tool_call.args })
      }
      if (chunk.tool_result) res.sawToolResult = true
    })
    const result = await req
    // 非流式：结果对象本身可能带 tool_call / tool_result
    const r = result as AiMessage
    if (r?.tool_call) {
      res.sawToolCall = true
      res.toolCalls.push({ id: r.tool_call.id, name: r.tool_call.name, args: r.tool_call.args })
    }
    if (r?.tool_result) res.sawToolResult = true
    if (!finalText && typeof result.content === 'string') finalText = result.content
    res.ok = true
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e)
  }

  res.chunkTypes = [...seen]
  res.finalText = finalText
  res.inference = !res.ok
    ? `探测失败：${res.error}`
    : res.sawToolCall && !res.sawToolResult
      ? '✅ 宿主在自定义 function 工具上「吐出 tool_call 后停止、等待回灌」→ phase6 采用手动 tool-loop 策略成立（§6.1）。'
      : res.sawToolCall && res.sawToolResult
        ? '⚠ 观察到 tool_call + tool_result（宿主似乎自动执行/或属内部工具语义）→ 复核 maxToolSteps 与是否误用 internalTools；手动循环可能不必需。'
        : '⚠ 未观察到 tool_call → 该模型可能不支持 function-calling，或工具触发方式不同 → 保留 jsonMode 确定性兜底双路径（§6.1 兜底）。'
  return res
}

/** 注册控制台调试钩子（仅 Mulby 运行态有 window.mulby 时）。重复注册无害。 */
export function registerToolCallingProbe(): void {
  try {
    ;(window as unknown as { __filmStudioProbe?: typeof runToolCallingProbe }).__filmStudioProbe = runToolCallingProbe
    if (window.mulby?.ai) {
      // eslint-disable-next-line no-console
      console.info('[ai-film-studio] tool-calling 探针已就绪：在控制台执行 await window.__filmStudioProbe() 查看宿主自定义工具行为。')
    }
  } catch {
    // 忽略（非浏览器环境）
  }
}
