/**
 * Toonflow 式重构 · 阶段2（§2.2）：独立 KV store 骨架。
 *
 * 这些配置/运行态不进 ProjectDoc（全局或半全局），各占一个 studio:* KV 键。本文件只提供类型定义 +
 * 强类型读写，具体 zustand store 与 UI 在后续阶段接入（agentDeploy→§6.3、tasks→§6.7、memoryConfig→§6.6、
 * modelPrompt→§5.3/§8、customStyles→§8）。
 */

const PLUGIN_ID = 'ai-film-studio'

export const STUDIO_KV = {
  ui: 'studio:ui', // 工作台布局态（阶段1 已用）
  agentDeploy: 'studio:agentDeploy', // 按 Agent 模型/温度配置
  memoryConfig: 'studio:memoryConfig', // 记忆阈值
  tasks: 'studio:tasks', // 任务中心
  modelPrompt: 'studio:modelPrompt', // 视频模型↔提示词模板覆盖
  customStyles: 'studio:customStyles', // 用户画风覆盖层
} as const

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, PLUGIN_ID)
    return (v as T) ?? null
  } catch {
    return null
  }
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await window.mulby?.storage?.set(key, value, PLUGIN_ID)
  } catch {
    // 忽略（浏览器调试态无 storage）
  }
}

// —— agentDeploy（§6.3）——
export type AgentKey = 'decision' | 'writer' | 'artDirector' | 'director' | 'supervision' | 'universal'
export interface AgentDeployEntry {
  model?: string
  temperature?: number
  maxOutputTokens?: number
}
export interface AgentDeployDoc {
  useMode: 'simple' | 'advanced'
  entries: Partial<Record<AgentKey, AgentDeployEntry>>
}

// —— tasks（§6.7）——
export type TaskState = 'running' | 'done' | 'failed'
export type TaskClass = 'asset' | 'keyframe' | 'clip' | 'compose' | 'text' | 'audio'
export interface TaskRecord {
  id: string
  projectId: string
  taskClass: TaskClass
  model?: string
  describe?: string
  state: TaskState
  reason?: string
  startTime: number
  endTime?: number
}

// —— memoryConfig（§6.6）——
export interface MemoryConfig {
  shortTermLimit: number // 注入近期消息条数
  messagesPerSummary: number // 累计多少条触发摘要
  summaryMaxLength: number // 摘要字数上限
  ragLimit: number // 语义/关键词召回条数
}
export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  shortTermLimit: 6,
  messagesPerSummary: 12,
  summaryMaxLength: 400,
  ragLimit: 4,
}

// —— modelPrompt（§5.3/§8）：视频模型 id → 自定义提示词模板 ——
export type ModelPromptMap = Record<string, string>
