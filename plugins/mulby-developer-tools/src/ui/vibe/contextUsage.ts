/**
 * 上下文占用追踪：AI 写代码期间实时估算当前上下文大小，
 * 回合结束用宿主返回的真实 usage 校准分词密度，让后续回合的估算越来越准。
 *
 * 真实值锚定（方案 B，需宿主支持）：宿主在多步工具循环中每轮推送 usage chunk
 * （usage_round=本轮真实用量，usage=跨轮累计），收到后把 liveTokens 锚定在
 * 「本轮 input+output」真实值上，仅轮间增量靠估算；老版本宿主无此块时自动退回纯估算。
 *
 * 估算口径（按来源分桶，桶之和 = liveTokens，供明细面板拆解展示）：
 *   live = 系统提示词 + 对话消息 + 工具定义 + 本回合生成 + 工具结果
 * - 输入侧（系统提示词+对话消息）优先用宿主 `ai.tokens.estimate` 真实分词，不可用时按字符 × ratio 近似；
 *   工具 schema（tools 参数）不在 estimate 统计范围内，单独按字符近似一桶；
 * - 流式增量 = 正文 + 工具调用参数 + 工具结果（这些都会进入后续工具轮的 prompt）；
 *   reasoning 不计入上下文（各家普遍不把 thinking 回传到后续轮次），只参与校准；
 * - ratio（token/字符）初值 0.25（≈宿主 compaction 用的 4 字符/token），
 *   回合结束用真实 outputTokens / 产出字符校准，模块级保留、跨回合生效；
 * - 宿主在工具循环内部还会自动压缩上下文（compaction），真实 prompt 可能比估算小，
 *   所以该指示只作量级参考，UI 一律带 "~" 前缀。
 */

/** 上下文构成分类拆解（token 估算值），供明细面板展示「都是什么占了窗口」 */
export interface CtxBreakdown {
  /** 系统提示词（含会话锚点/前情摘要） */
  system: number
  /** 对话消息（历史窗口 + 本次输入） */
  messages: number
  /** 工具定义（tools schema 等不在 estimate 统计内的额外负载） */
  tools: number
  /** 本回合生成（正文 + 工具调用参数，模型产出后会进入后续轮上下文） */
  gen: number
  /** 工具结果（执行输出回流进上下文的部分） */
  toolResults: number
}

export interface CtxUsage {
  /** estimating=正在精确估算初始输入；live=生成中；final=本回合结束（有真实 usage 时 realInput/realOutput 非空） */
  phase: 'estimating' | 'live' | 'final'
  /** 当前估算的上下文 token（输入 prompt + 已累积增量） */
  liveTokens: number
  /** 模型上下文窗口 token；0=未知（此时只显示绝对值不显示百分比） */
  windowTokens: number
  /** 窗口占用比 0~1+；窗口未知为 null */
  pct: number | null
  /** 分类拆解；各项之和 = liveTokens */
  breakdown: CtxBreakdown
  /**
   * true=宿主已推送过本回合的逐轮真实 usage（usage chunk），liveTokens 锚定在
   * 最近一轮真实「输入+输出」上、仅轮间增量为估算 —— UI 可去掉 ~ 前缀
   */
  anchored?: boolean
  /** 宿主统计的真实消耗（跨工具轮累计）：生成期随 usage chunk 实时更新，回合结束为最终值 */
  realInput?: number
  realOutput?: number
}

/** token 数的紧凑显示：980 / 12.4k / 1.05M */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${parseFloat((n / 1000).toFixed(1))}k`
  return String(Math.round(n))
}

// token/字符 密度。初值 ≈4 字符/token；clamp 防异常样本把估算带飞
// （英文代码 ≈0.25，中文 ≈0.5~1.0，混排居中）。模块级保留：同一 UI 会话内跨回合复用。
const RATIO_DEFAULT = 0.25
let calibratedRatio = RATIO_DEFAULT
const clampRatio = (r: number) => Math.min(1.2, Math.max(0.1, r))

type ChunkLike = {
  chunkType?: string
  content?: unknown
  reasoning_content?: string
  tool_call?: { name?: string; args?: unknown }
  tool_result?: { name?: string; result?: unknown }
  /** usage chunk：跨轮累计真实消耗（与 end 块口径一致） */
  usage?: { inputTokens?: number; outputTokens?: number }
  /** usage chunk：本轮（单次 LLM 往返）真实用量 */
  usage_round?: { inputTokens?: number; outputTokens?: number }
}

type EstimateFn = (input: { model?: string; messages: Array<{ role: string; content: string }> }) => Promise<{ inputTokens?: number }>

const charsOf = (v: unknown): number => {
  if (v == null) return 0
  if (typeof v === 'string') return v.length
  try { return JSON.stringify(v).length } catch { return 0 }
}

export interface CtxTrackerBeginInput {
  messages: Array<{ role: string; content: string }>
  /** 不在 estimate 统计范围内、但会占上下文的额外负载（工具 schema 等），按字符近似 */
  extraPayload?: unknown
  model?: string
  /**
   * 模型上下文窗口；0=未知（UI 退化为只显示绝对量）。
   * 取宿主 allModels() 的 contextTokens（用户显式填写 ＞ models.dev 快照/缓存），
   * 不在插件侧按模型 id 猜——按家族猜的窗口误差可达数倍，错误百分比比没有百分比更误导。
   */
  windowTokens: number
  /** 宿主 ai.tokens.estimate；缺省则纯字符近似 */
  estimate?: EstimateFn
}

/**
 * 创建追踪器。onUpdate 在占用变化时回调（流式期间节流 ~250ms），传 null 表示清除指示。
 * 同一时刻只追踪一次调用：begin 会作废上一回合未完成的异步估算。
 */
export function createCtxTracker(onUpdate: (u: CtxUsage | null) => void) {
  let seq = 0
  let active = false
  let phase: CtxUsage['phase'] = 'live'
  // 输入侧按来源分桶（字符）：系统提示词 / 对话消息 / 工具 schema
  let systemChars = 0
  let msgChars = 0
  let toolsChars = 0
  // msgRatio：系统提示词+对话消息的 token/字符密度。estimate 返回真实分词后用
  // inputTokens/字符 替换（不 clamp，保证 system+messages 之和恰为真实估算值）
  let msgRatio = calibratedRatio
  // 流式增量分桶（字符）：模型生成（正文+工具参数）/ 工具结果
  let genChars = 0
  let toolResultChars = 0
  let outChars = 0 // 模型产出字符（正文 + reasoning + 工具参数），用于输出侧校准
  let windowTokens = 0
  let realInput: number | undefined
  let realOutput: number | undefined
  // 宿主逐轮 usage chunk 的真实锚点：最近一轮 inputTokens+outputTokens ≈ 当时的真实上下文大小。
  // 锚定后 live = 锚点 + 锚点之后新增字符 × ratio，仅轮间增量为估算
  let anchorTokens: number | null = null
  let anchorGenChars = 0
  let anchorToolResultChars = 0
  let lastEmit = 0

  const snapshot = (): CtxUsage => {
    const breakdown: CtxBreakdown = {
      system: Math.round(systemChars * msgRatio),
      messages: Math.round(msgChars * msgRatio),
      tools: Math.round(toolsChars * calibratedRatio),
      gen: Math.round(genChars * calibratedRatio),
      toolResults: Math.round(toolResultChars * calibratedRatio)
    }
    let live = breakdown.system + breakdown.messages + breakdown.tools + breakdown.gen + breakdown.toolResults
    if (anchorTokens != null) {
      const deltaChars = (genChars - anchorGenChars) + (toolResultChars - anchorToolResultChars)
      const anchoredLive = Math.round(anchorTokens + Math.max(0, deltaChars) * calibratedRatio)
      // 拆解按比例缩放到锚定总量，保持「各桶之和 = 总量」的面板一致性
      if (live > 0) {
        const scale = anchoredLive / live
        breakdown.system = Math.round(breakdown.system * scale)
        breakdown.messages = Math.round(breakdown.messages * scale)
        breakdown.tools = Math.round(breakdown.tools * scale)
        breakdown.gen = Math.round(breakdown.gen * scale)
        breakdown.toolResults = Math.round(breakdown.toolResults * scale)
      }
      live = anchoredLive
    }
    return {
      phase,
      liveTokens: live,
      windowTokens,
      pct: windowTokens > 0 ? live / windowTokens : null,
      breakdown,
      anchored: anchorTokens != null,
      realInput,
      realOutput
    }
  }

  const emit = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmit < 250) return
    lastEmit = now
    onUpdate(snapshot())
  }

  return {
    begin(input: CtxTrackerBeginInput) {
      const mySeq = ++seq
      active = true
      genChars = 0
      toolResultChars = 0
      outChars = 0
      realInput = undefined
      realOutput = undefined
      anchorTokens = null
      anchorGenChars = 0
      anchorToolResultChars = 0
      windowTokens = input.windowTokens
      systemChars = input.messages.reduce((s, m) => s + (m.role === 'system' ? charsOf(m.content) : 0), 0)
      msgChars = input.messages.reduce((s, m) => s + (m.role === 'system' ? 0 : charsOf(m.content)), 0)
      toolsChars = charsOf(input.extraPayload)
      msgRatio = calibratedRatio
      phase = input.estimate ? 'estimating' : 'live'
      emit(true)
      if (!input.estimate) return
      void input.estimate({ ...(input.model ? { model: input.model } : {}), messages: input.messages })
        .then((r) => {
          if (mySeq !== seq || !active) return
          const totalMsgChars = systemChars + msgChars
          if (typeof r?.inputTokens === 'number' && r.inputTokens > 0 && totalMsgChars > 0) {
            // 输入侧校准：真实分词 / 字符。msgRatio 用未 clamp 的精确密度，
            // 使 system+messages 两桶之和恰等于宿主真实估算值
            msgRatio = r.inputTokens / totalMsgChars
            if (totalMsgChars > 200) calibratedRatio = clampRatio(msgRatio)
          }
          phase = 'live'
          emit(true)
        })
        .catch(() => {
          if (mySeq !== seq || !active) return
          phase = 'live'
          emit(true)
        })
    },

    chunk(c: ChunkLike) {
      if (!active || phase === 'final') return
      const ct = c?.chunkType
      if (ct === 'usage') {
        // 宿主逐轮真实用量（方案B）：本轮 input+output ≈ 此刻真实上下文大小，作为锚点；
        // 累计 usage 实时刷新「已消耗」。锚点之后的增量重新从 0 估算
        const ru = c.usage_round
        const anchor = (typeof ru?.inputTokens === 'number' ? ru.inputTokens : 0)
          + (typeof ru?.outputTokens === 'number' ? ru.outputTokens : 0)
        if (anchor > 0) {
          anchorTokens = anchor
          anchorGenChars = genChars
          anchorToolResultChars = toolResultChars
        }
        if (c.usage && (c.usage.inputTokens || c.usage.outputTokens)) {
          realInput = c.usage.inputTokens
          realOutput = c.usage.outputTokens
        }
        emit(true)
        return
      }
      if (ct === 'text') {
        const n = charsOf(c.content)
        genChars += n
        outChars += n
      } else if (ct === 'reasoning') {
        outChars += charsOf(c.reasoning_content)
        return // reasoning 不进入后续上下文，也无须刷新显示
      } else if (ct === 'tool-call') {
        const n = charsOf(c.tool_call?.args) + charsOf(c.tool_call?.name)
        outChars += n
        // 已锚定时不计入上下文增量：compat 循环的 usage 块先于 tool-call 块到达，
        // 工具参数已包含在锚点那轮的 outputTokens 里，再计会双算
        if (anchorTokens == null) genChars += n
      } else if (ct === 'tool-result') {
        toolResultChars += charsOf(c.tool_result?.result)
      } else if (ct == null && typeof c?.content === 'string') {
        // 兼容无 chunkType 的旧协议纯文本块；有 chunkType 的 meta/end/error 不计
        genChars += c.content.length
        outChars += c.content.length
      } else {
        return
      }
      emit()
    },

    /** 回合结束：记录宿主真实 usage 并用输出侧数据校准密度；usage 缺失（失败/中止）只收尾不校准 */
    end(usage?: { inputTokens?: number; outputTokens?: number }) {
      if (!active) return
      phase = 'final'
      if (usage && (usage.inputTokens || usage.outputTokens)) {
        realInput = usage.inputTokens
        realOutput = usage.outputTokens
        if (typeof usage.outputTokens === 'number' && usage.outputTokens > 0 && outChars > 400) {
          calibratedRatio = clampRatio(usage.outputTokens / outChars)
        }
      }
      emit(true)
    },

    /** 清除指示（切换会话 / 重新开始） */
    reset() {
      seq++
      active = false
      onUpdate(null)
    }
  }
}
