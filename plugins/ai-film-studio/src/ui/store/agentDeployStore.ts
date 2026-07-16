/**
 * Toonflow 式重构 · 阶段9（§6.3）：Agent 部署配置——按 Agent 选模型/温度/最大 token。
 * 简易：全部回退 decision/全局；高级：各子层独立。存独立 KV studio:agentDeploy（不进 ProjectDoc）。
 */
import { create } from 'zustand'
import { kvGet, kvSet, STUDIO_KV, type AgentDeployDoc, type AgentKey, type AgentDeployEntry } from '../domain/studioKv'

export const AGENT_KEYS: AgentKey[] = ['decision', 'writer', 'artDirector', 'director', 'supervision', 'universal']
const DEFAULT_DOC: AgentDeployDoc = { useMode: 'simple', entries: {} }

interface AgentDeployState {
  loaded: boolean
  doc: AgentDeployDoc
  load: () => Promise<void>
  setMode: (m: 'simple' | 'advanced') => void
  setEntry: (key: AgentKey, patch: Partial<AgentDeployEntry>) => void
  setAllModel: (model: string) => void
  /** 解析某 Agent 的实际模型 + 参数（simple→decision 兜底；advanced→子层，缺则 universal/decision） */
  resolve: (key: AgentKey) => { model?: string; params?: { temperature?: number; maxOutputTokens?: number } }
}

function persist(doc: AgentDeployDoc) {
  void kvSet(STUDIO_KV.agentDeploy, doc)
}

export const useAgentDeployStore = create<AgentDeployState>((set, get) => ({
  loaded: false,
  doc: DEFAULT_DOC,
  load: async () => {
    const d = await kvGet<AgentDeployDoc>(STUDIO_KV.agentDeploy)
    set({ loaded: true, doc: d ?? DEFAULT_DOC })
  },
  setMode: (m) => {
    const doc = { ...get().doc, useMode: m }
    set({ doc })
    persist(doc)
  },
  setEntry: (key, patch) => {
    const doc = { ...get().doc, entries: { ...get().doc.entries, [key]: { ...get().doc.entries[key], ...patch } } }
    set({ doc })
    persist(doc)
  },
  setAllModel: (model) => {
    const entries = { ...get().doc.entries }
    for (const k of AGENT_KEYS) entries[k] = { ...entries[k], model }
    const doc = { ...get().doc, entries }
    set({ doc })
    persist(doc)
  },
  resolve: (key) => {
    const { useMode, entries } = get().doc
    const e = useMode === 'advanced' ? entries[key] ?? entries.universal : entries.decision ?? entries.universal
    const hasParams = e?.temperature != null || e?.maxOutputTokens != null
    return { model: e?.model, params: hasParams ? { temperature: e?.temperature, maxOutputTokens: e?.maxOutputTokens } : undefined }
  },
}))
