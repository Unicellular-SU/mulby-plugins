/**
 * 提示词模板覆盖：两层 + 默认。
 * - 工程级覆盖（projectOverrides）：每个工程一套，存在工程 JSON 里，由 graphStore 拥有并通过
 *   setProjectLayer 推送快照到这里（供非 React 的 prompts.ts 解析）。
 * - 全局覆盖（globalOverrides）：plugin 隔离的明文 KV，跨工程的默认基线（Toonflow 式可编辑「技能文件」）。
 * 生效优先级：工程覆盖 > 全局覆盖 > 内置默认（promptTemplates 的 default）。
 */
import { create } from 'zustand'
import { DEFAULT_PROMPTS } from '../services/promptTemplates'

const STORAGE_KEY = 'afs:promptOverrides'

const pick = (m: Record<string, string>, id: string): string | null => {
  const v = m[id]
  return typeof v === 'string' && v.trim() ? v : null
}

interface PromptState {
  globalOverrides: Record<string, string>
  projectOverrides: Record<string, string>
  loaded: boolean
  loadGlobal: () => Promise<void>
  /** 取生效模板：工程覆盖 > 全局覆盖 > 内置默认 */
  get: (id: string) => string
  // 全局层（KV）
  setGlobal: (id: string, value: string) => void
  resetGlobal: (id: string) => void
  resetAllGlobal: () => void
  // 工程层快照（由 graphStore 推送，不在此持久化）
  setProjectLayer: (overrides: Record<string, string>) => void
}

function persistGlobal(overrides: Record<string, string>) {
  void window.mulby?.storage?.set(STORAGE_KEY, overrides)
}

export const usePromptStore = create<PromptState>((set, get) => ({
  globalOverrides: {},
  projectOverrides: {},
  loaded: false,
  loadGlobal: async () => {
    try {
      const raw = await window.mulby?.storage?.get(STORAGE_KEY)
      if (raw && typeof raw === 'object') {
        set({ globalOverrides: raw as Record<string, string>, loaded: true })
        return
      }
    } catch {
      // 忽略，用默认
    }
    set({ loaded: true })
  },
  get: (id) => {
    const s = get()
    return pick(s.projectOverrides, id) ?? pick(s.globalOverrides, id) ?? DEFAULT_PROMPTS[id] ?? ''
  },
  setGlobal: (id, value) => {
    const globalOverrides = { ...get().globalOverrides, [id]: value }
    set({ globalOverrides })
    persistGlobal(globalOverrides)
  },
  resetGlobal: (id) => {
    const globalOverrides = { ...get().globalOverrides }
    delete globalOverrides[id]
    set({ globalOverrides })
    persistGlobal(globalOverrides)
  },
  resetAllGlobal: () => {
    set({ globalOverrides: {} })
    persistGlobal({})
  },
  setProjectLayer: (overrides) => set({ projectOverrides: overrides || {} }),
}))

/** 供非 React 模块（prompts.ts）取用生效模板 */
export function getPrompt(id: string): string {
  return usePromptStore.getState().get(id)
}
