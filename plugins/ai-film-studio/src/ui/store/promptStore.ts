/**
 * 提示词模板覆盖：用户在「提示词模板」面板里编辑的内容存为全局覆盖（plugin 隔离的明文 KV，
 * 跨工程生效，类似 Toonflow 的可编辑「技能文件」）。未覆盖的模板回退到 promptTemplates 的默认值。
 */
import { create } from 'zustand'
import { DEFAULT_PROMPTS } from '../services/promptTemplates'

const STORAGE_KEY = 'afs:promptOverrides'

interface PromptState {
  overrides: Record<string, string>
  loaded: boolean
  load: () => Promise<void>
  /** 取生效模板：有非空覆盖用覆盖，否则用默认 */
  get: (id: string) => string
  setOverride: (id: string, value: string) => void
  reset: (id: string) => void
  resetAll: () => void
}

function persist(overrides: Record<string, string>) {
  void window.mulby?.storage?.set(STORAGE_KEY, overrides)
}

export const usePromptStore = create<PromptState>((set, get) => ({
  overrides: {},
  loaded: false,
  load: async () => {
    try {
      const raw = await window.mulby?.storage?.get(STORAGE_KEY)
      if (raw && typeof raw === 'object') {
        set({ overrides: raw as Record<string, string>, loaded: true })
        return
      }
    } catch {
      // 忽略，用默认
    }
    set({ loaded: true })
  },
  get: (id) => {
    const o = get().overrides[id]
    return typeof o === 'string' && o.trim() ? o : DEFAULT_PROMPTS[id] ?? ''
  },
  setOverride: (id, value) => {
    const overrides = { ...get().overrides, [id]: value }
    set({ overrides })
    persist(overrides)
  },
  reset: (id) => {
    const overrides = { ...get().overrides }
    delete overrides[id]
    set({ overrides })
    persist(overrides)
  },
  resetAll: () => {
    set({ overrides: {} })
    persist({})
  },
}))

/** 供非 React 模块（prompts.ts）取用生效模板 */
export function getPrompt(id: string): string {
  return usePromptStore.getState().get(id)
}
