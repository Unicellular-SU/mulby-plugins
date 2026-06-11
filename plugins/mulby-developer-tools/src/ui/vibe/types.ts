import type { VibeContract } from '../lib/vibeContract'

export type VibeSessionState = 'initial' | 'contract' | 'generating' | 'ready' | 'error'

export interface VibeMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  /** 用户消息的识别意图（ask/create/modify/run/package/rollback），用于 UI 标签与纠正 */
  intent?: string
  /** assistant 消息：本回合内联的操作明细（由 timeline 事件汇总而来） */
  actions?: VibeAction[]
}

export interface VibeAction {
  /** 事件类别：read/write/build/load/error/note/ai */
  kind: string
  /** 一句话动作描述 */
  text: string
  /** 可选补充（如字节数、命中数） */
  detail?: string
}

export type VibePlanTodoStatus = 'pending' | 'in_progress' | 'done' | 'failed'

/** Plan 模式：契约确认后、生成之前 AI 制定的开发计划中的一步（todo） */
export interface VibePlanTodo {
  id: string
  /** 简短步骤名（≤ 20 字），用于对话内 todo 列表展示 */
  title: string
  /** 这一步要做什么（一句话） */
  detail?: string
  status: VibePlanTodoStatus
}

/** Plan 模式所处阶段：idle 无计划 / planning 正在制定 / review 待用户开始 / executing 逐项执行 / done 全部完成 */
export type VibePlanPhase = 'idle' | 'planning' | 'review' | 'executing' | 'done'

export interface VibeSession {
  id: string
  pluginPath: string
  pluginName: string

  state: VibeSessionState
  contract: VibeContract | null

  messages: VibeMessage[]
  contextSummary: string

  sentence: string
  vibeMode: 'create' | 'edit'
  genDepth: 'full' | 'minimal'
  selectedModel: string

  /** Plan 模式：AI 制定的开发计划（todo list），持久化以便重载/切换后仍能查看与续跑 */
  plan?: VibePlanTodo[]
  /** Plan 模式所处阶段；持久化（重载后瞬态阶段会被降级，见水合逻辑） */
  planPhase?: VibePlanPhase

  createdAt: number
  lastActiveAt: number
  lastCommitHash?: string
}

/** 头脑风暴阶段：AI 为模糊需求发散出的候选插件方向 */
export interface BrainstormOption {
  title: string
  pitch: string
  trigger?: string
}

/** 澄清式风暴：AI 围绕用户的明确需求提出的关键澄清问题（一次只问一个） */
export interface ClarifyQuestion {
  question: string
  /** 2-4 个可直接点选的候选答案（用户也可在输入框自行作答） */
  options: string[]
}

/** 澄清式风暴：同主题下的候选实现做法（差异在做法而非主题） */
export interface ClarifyApproach {
  title: string
  pitch: string
  recommended?: boolean
  /** 推荐理由（仅推荐项） */
  reason?: string
}

/** 澄清式风暴：已确认的一问一答 */
export interface ClarifyQA {
  q: string
  a: string
}

/** 澄清式风暴进行中状态：question 非空=等用户回答；approaches 非空=等用户选做法；loading=AI 生成中 */
export interface ClarifyState {
  loading: boolean
  seed: string
  /** 当前问到第几轮（展示用，1 起） */
  round: number
  maxRounds: number
  question: ClarifyQuestion | null
  qa: ClarifyQA[]
  approaches: ClarifyApproach[] | null
}

export interface SessionStorageStats {
  count: number
  totalBytes: number
  sessions: Array<{ id: string; name: string; bytes: number; lastActiveAt: number }>
}

export const MAX_SESSIONS = 20
// 每个会话持久化保留的最近消息条数。运行期内存里保留全部消息，
// 这里仅限制写入存储/重载后的上限——调大以便重新打开插件后仍能延续对话上下文。
export const MAX_MESSAGES_PERSISTED = 40
