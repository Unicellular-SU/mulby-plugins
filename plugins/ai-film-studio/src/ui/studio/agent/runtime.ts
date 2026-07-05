/**
 * Toonflow 式重构 · 阶段6（§6.1）：Agent 工具循环运行时（前端本地工具协议）。
 *
 * Mulby 的 option.tools 会由宿主尝试执行同名 Host RPC 方法；右侧工作台工具需要读取当前
 * renderer 内的 projectStore，所以不能交给宿主执行。这里用 JSON 文本协议让模型“请求工具”，
 * 再由前端本地执行并把结果回灌给模型，从而避免 Host method not found。
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
  onReasoning?: (text: string) => void
  onToolCall?: (name: string, args: unknown) => void
  onToolResult?: (name: string, result: string) => void
}

type ProtocolToolCall = { name?: string; args?: unknown }
type ProtocolResponse = {
  tool_calls?: ProtocolToolCall[]
  toolCalls?: ProtocolToolCall[]
  final?: string
  reply?: string
  content?: string
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

function toolSchemaText(tools: AgentTool[]): string {
  return JSON.stringify(
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    null,
    2,
  )
}

function protocolSystem(system: string, tools: AgentTool[]): string {
  return `${system}

## 本地工具协议
你可以请求调用下列本地项目工具；这些工具由当前插件前端执行，能读取最新项目状态。
宿主 MCP、skills、internal tools 可继续用于外部能力，但当前项目的剧本/分镜/资产读写必须使用下面的本地 JSON 协议。

可用工具：
${toolSchemaText(tools)}

每轮只能输出一个 JSON 对象，二选一：
1. 请求工具：
{"tool_calls":[{"name":"get_project_overview","args":{}}]}
2. 给用户最终回复：
{"final":"这里写给用户的中文回复"}

规则：
- 需要确认当前剧本、分镜、资产、原著或时间线时，先请求读取工具。
- 多集项目中，用户指定第几集、下一集或新一集时，先用 get_episodes 确认剧集，再用 switch_episode 或 create_episode 选中目标剧集；剧本、分镜和视频片段都写入当前剧集，资产是项目级共享。
- 用户要求规划多集、按原著拆集或指定每集覆盖内容时，先用 get_novel/get_episodes 查看章节和剧集；剧集数量不足时先用 create_episodes 补空剧集；粗略初始化可用 distribute_episode_chapters 顺序均分，精确拆集用 assign_episode_chapters 写入章节归属。
- 续写下一集、承接上一集状态、处理换装/妆容/受伤/时期变化时，先调用 get_episode_handoff 读取最近制作回顾、共享资产出场记录和承接建议；看到上一相关剧集使用过具体形态或本集已有适用变体时，分镜写入必须用 castRefs/variant 精确绑定。
- 检查跨集角色一致性、妆容/服装绑定或缺图问题时，优先调用 get_continuity_report，再决定是否补资产、补变体或修正分镜绑定。
- get_continuity_report 返回 duplicate_asset_name 或 duplicate_asset_alias 时，优先复用已有资产；需要改名、补充或移除 aliases 时调用 update_asset，确认是真重复且引用复杂时再建议合并资产；不要继续用同一称呼创建新角色、场景或道具。
- get_continuity_report 返回 unused_project_asset 时，先判断该资产是否属于当前或后续剧集；需要出场就调用 set_storyboard_asset_ref 把它加入相应分镜 castRefs，不需要就建议合并或移出资产池，避免继续堆积未使用资产。
- get_continuity_report 返回 scene_group_missing_asset 或 scene_group_asset_mismatch 时，优先调用 set_storyboard_scene_asset，让同一 sceneId 的连续分镜复用同一个场景资产；不要为同一空间重复创建新场景。
- get_continuity_report 返回 scene_group_variant_mismatch 时，先判断是否有明确换装/状态变化；没有明确变化时，优先用 set_storyboard_cast_variant 让同一 sceneId 连续分镜里的同一角色使用同一形态。
- get_continuity_report 返回 episode_variant_available 且带 variantId 时，优先调用 set_storyboard_cast_variant 把该分镜资产绑定到当前分镜/场景/剧集适用形态；不要继续让分镜使用主形象。
- get_continuity_report 返回 asset_state_regressed_to_main 时，先判断剧情是否确实恢复默认状态；如果状态应延续或变化，调用 upsert_asset_variant 创建本集形态并用 set_storyboard_cast_variant 绑定。
- 同一角色有妆容、服装、年龄或时期差异时，先用 get_assets 查看 variants；缺少变体就调用 upsert_asset_variant 创建/更新，再在 add_storyboard 或 set_storyboard_cast_variant 里传 castRefs/variant 精确绑定。不要只把变体写进画面描述。
- 用户要求生成、新增、续写或修改项目内容时，最终回复前必须调用对应写入/生成工具：剧本用 upsert_script，新资产用 add_asset，修改既有资产用 update_asset，分镜用 add_storyboard，出图/关键帧/视频用 generate_*。不要只描述计划。
- 写入后如需确认结果，再调用读取工具核对；确认完成后再给最终回复。
- 工具返回后，再根据结果继续请求工具或给最终回复。
- 不要把下列本地项目工具写成 Host RPC，也不要编造工具结果。
- JSON 之外不要输出额外文字。`
}

function parseProtocol(raw: string): ProtocolResponse {
  const trimmed = (raw || '').trim()
  if (!trimmed) return { final: '' }
  let s = trimmed
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s)
  if (fence) s = fence[1].trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  try {
    return JSON.parse(s) as ProtocolResponse
  } catch {
    return { final: trimmed }
  }
}

function protocolFinal(res: ProtocolResponse, fallback: string): string {
  return res.final ?? res.reply ?? res.content ?? fallback
}

/** 运行工具循环，返回最终文本回复。 */
export async function runToolLoop(opts: ToolLoopOptions): Promise<string> {
  const ai = window.mulby?.ai
  if (!ai?.call) throw new Error('宿主 AI 不可用（请在宿主配置文本模型）')
  const maxSteps = opts.maxSteps ?? 12
  const params: AiModelParameters = { responseFormat: 'json_object', ...(opts.params ?? {}) }
  const msgs: AiMessage[] = [
    { role: 'system', content: protocolSystem(opts.system, opts.tools) },
    { role: 'user', content: opts.user },
  ]
  let lastText = ''

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) break
    let raw = ''
    const req = ai.call({ messages: msgs, model: opts.model, params }, (chunk: AiMessage) => {
      if (chunk.chunkType === 'text' && typeof chunk.content === 'string') raw += chunk.content
      if (chunk.chunkType === 'reasoning' && chunk.reasoning_content) opts.onReasoning?.(chunk.reasoning_content)
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
    const finalText = raw || (typeof result.content === 'string' ? result.content : '')
    if (finalText) lastText = finalText
    const parsed = parseProtocol(finalText)
    const calls = parsed.tool_calls ?? parsed.toolCalls ?? []

    if (calls.length === 0) {
      const reply = protocolFinal(parsed, finalText || lastText || '（无回复）')
      if (reply) opts.onText?.(reply)
      return reply
    }

    msgs.push({ role: 'assistant', content: JSON.stringify({ tool_calls: calls }) })
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
