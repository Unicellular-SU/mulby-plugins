/**
 * 提示词库：节点模板覆盖（两层 + 默认）+ 可复用片段 + 版本历史。
 * - 工程级覆盖（projectOverrides）：每个工程一套，存在工程 JSON 里，由 graphStore 拥有并通过
 *   setProjectLayer 推送快照到这里（供非 React 的 prompts.ts 解析）。
 * - 全局覆盖（globalOverrides）：plugin 隔离的明文 KV，跨工程的默认基线。
 *   生效优先级：工程覆盖 > 全局覆盖 > 内置默认（promptTemplates 的 default）。
 * - 片段（snippets）：可复用的画风/运镜/打光/负面/自定义提示词块，跨工程全局共享，支持 {变量} 占位符。
 * - 版本历史（history）：每个模板 id 的历次编辑快照（封顶 10），可回滚。
 */
import { create } from 'zustand'
import { DEFAULT_PROMPTS } from '../services/promptTemplates'

const NS = 'ai-film-studio'
const STORAGE_KEY = 'afs:promptOverrides' // 历史键，保持默认 namespace 不动（避免迁移）
const KEY_SNIPPETS = 'prompts:snippets'
const KEY_HISTORY = 'prompts:history'
const HISTORY_CAP = 10

export type SnippetGroup = 'style' | 'camera' | 'lighting' | 'negative' | 'custom'

export const SNIPPET_GROUPS: { id: SnippetGroup; label: string }[] = [
  { id: 'style', label: '画风' },
  { id: 'camera', label: '运镜' },
  { id: 'lighting', label: '打光' },
  { id: 'negative', label: '负面' },
  { id: 'custom', label: '自定义' },
]

export interface SnippetVar {
  name: string
  default?: string
}

export interface PromptSnippet {
  id: string
  name: string
  group: SnippetGroup
  text: string
  vars?: SnippetVar[]
  createdAt: number
  updatedAt: number
}

export interface VersionEntry {
  text: string
  ts: number
}

const pick = (m: Record<string, string>, id: string): string | null => {
  const v = m[id]
  return typeof v === 'string' && v.trim() ? v : null
}

/** 检测文本里的 {变量} 名（去重，保序） */
export function detectVars(text: string): string[] {
  const out: string[] = []
  const re = /\{(\w+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** 用变量默认值填充 {name} 占位符（缺失变量替换为空串） */
export function resolveSnippet(s: PromptSnippet, overrides?: Record<string, string>): string {
  const defaults: Record<string, string> = {}
  for (const v of s.vars || []) defaults[v.name] = overrides?.[v.name] ?? v.default ?? ''
  return s.text.replace(/\{(\w+)\}/g, (_, k: string) => (overrides?.[k] ?? defaults[k] ?? ''))
}

interface PromptState {
  globalOverrides: Record<string, string>
  projectOverrides: Record<string, string>
  snippets: PromptSnippet[]
  history: Record<string, VersionEntry[]>
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
  // 片段库
  saveSnippet: (s: Partial<PromptSnippet> & { name: string; group: SnippetGroup; text: string }) => PromptSnippet
  removeSnippet: (id: string) => void
  // 提示词包导入导出（片段 + 全局模板覆盖）
  exportPack: () => { version: number; snippets: PromptSnippet[]; globalTemplates: Record<string, string> }
  importPack: (pack: { snippets?: PromptSnippet[]; globalTemplates?: Record<string, string> }) => number
  // 版本历史
  snapshot: (id: string, text: string) => void
  revert: (scope: 'project' | 'global', id: string, text: string) => void
}

function persistGlobal(overrides: Record<string, string>) {
  void window.mulby?.storage?.set(STORAGE_KEY, overrides)
}
function persistSnippets(snippets: PromptSnippet[]) {
  void window.mulby?.storage?.set(KEY_SNIPPETS, snippets, NS)
}
function persistHistory(history: Record<string, VersionEntry[]>) {
  void window.mulby?.storage?.set(KEY_HISTORY, history, NS)
}

export const usePromptStore = create<PromptState>((set, get) => ({
  globalOverrides: {},
  projectOverrides: {},
  snippets: [],
  history: {},
  loaded: false,

  loadGlobal: async () => {
    let globalOverrides: Record<string, string> = {}
    try {
      const raw = await window.mulby?.storage?.get(STORAGE_KEY)
      if (raw && typeof raw === 'object') globalOverrides = raw as Record<string, string>
    } catch {
      // 忽略
    }
    let snippets: PromptSnippet[] = []
    let history: Record<string, VersionEntry[]> = {}
    try {
      const s = await window.mulby?.storage?.get(KEY_SNIPPETS, NS)
      if (Array.isArray(s)) snippets = s as PromptSnippet[]
      const h = await window.mulby?.storage?.get(KEY_HISTORY, NS)
      if (h && typeof h === 'object') history = h as Record<string, VersionEntry[]>
    } catch {
      // 忽略
    }
    set({ globalOverrides, snippets, history, loaded: true })
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

  saveSnippet: (input) => {
    const list = get().snippets.slice()
    const ts = Date.now()
    let saved: PromptSnippet
    const idx = input.id ? list.findIndex((s) => s.id === input.id) : -1
    if (idx >= 0) {
      saved = { ...list[idx], ...input, updatedAt: ts } as PromptSnippet
      list[idx] = saved
    } else {
      saved = {
        id: `sn_${Math.random().toString(36).slice(2, 10)}`,
        name: input.name,
        group: input.group,
        text: input.text,
        vars: input.vars,
        createdAt: ts,
        updatedAt: ts,
      }
      list.push(saved)
    }
    set({ snippets: list })
    persistSnippets(list)
    return saved
  },
  removeSnippet: (id) => {
    const list = get().snippets.filter((s) => s.id !== id)
    set({ snippets: list })
    persistSnippets(list)
  },

  exportPack: () => ({
    version: 1,
    snippets: get().snippets,
    globalTemplates: get().globalOverrides,
  }),
  importPack: (pack) => {
    const ts = Date.now()
    // 片段：追加并重新分配 id（避免冲突）
    const incoming = Array.isArray(pack.snippets) ? pack.snippets : []
    const added: PromptSnippet[] = incoming
      .filter((s) => s && typeof s.text === 'string')
      .map((s) => ({
        id: `sn_${Math.random().toString(36).slice(2, 10)}`,
        name: s.name || '未命名片段',
        group: (SNIPPET_GROUPS.some((g) => g.id === s.group) ? s.group : 'custom') as SnippetGroup,
        text: s.text,
        vars: Array.isArray(s.vars) ? s.vars : undefined,
        createdAt: ts,
        updatedAt: ts,
      }))
    if (added.length) {
      const snippets = [...get().snippets, ...added]
      set({ snippets })
      persistSnippets(snippets)
    }
    // 全局模板覆盖：合并（导入覆盖同名）
    if (pack.globalTemplates && typeof pack.globalTemplates === 'object') {
      const globalOverrides = { ...get().globalOverrides, ...pack.globalTemplates }
      set({ globalOverrides })
      persistGlobal(globalOverrides)
    }
    return added.length
  },

  snapshot: (id, text) => {
    const t = text.trim()
    if (!t) return
    const cur = get().history[id] || []
    if (cur[0]?.text === text) return // 与最近快照相同则不重复记录
    const next = [{ text, ts: Date.now() }, ...cur].slice(0, HISTORY_CAP)
    const history = { ...get().history, [id]: next }
    set({ history })
    persistHistory(history)
  },
  revert: (scope, id, text) => {
    if (scope === 'global') get().setGlobal(id, text)
    // 工程层覆盖由 graphStore 拥有；此处仅暴露全局回滚，工程回滚在组件里走 graphStore.setPromptOverride
  },
}))

/** 供非 React 模块（prompts.ts）取用生效模板 */
export function getPrompt(id: string): string {
  return usePromptStore.getState().get(id)
}
