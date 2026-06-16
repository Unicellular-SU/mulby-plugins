import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { VideoProviderConfig } from '../services/providers'
import { setKey, getKey, removeKey, hasKey } from '../services/keys'

const NS = 'ai-film-studio'
const KEY_PROVIDERS = 'videoProviders'
const KEY_SELECTED = 'selectedVideoProvider'

async function sget<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, NS)
    return (v as T) ?? null
  } catch {
    return null
  }
}
async function sset(key: string, value: unknown): Promise<void> {
  try {
    await window.mulby?.storage?.set(key, value, NS)
  } catch {
    // 忽略
  }
}

interface ProviderState {
  loaded: boolean
  providers: VideoProviderConfig[]
  selectedId: string | null
  keyPresence: Record<string, boolean>

  load: () => Promise<void>
  addProvider: (cfg: Partial<VideoProviderConfig>) => Promise<string>
  updateProvider: (id: string, patch: Partial<VideoProviderConfig>) => Promise<void>
  removeProvider: (id: string) => Promise<void>
  selectProvider: (id: string | null) => void
  setProviderKey: (id: string, apiKey: string) => Promise<void>
  getActive: () => VideoProviderConfig | null
  resolveKey: (id: string) => Promise<string>
}

async function persist(providers: VideoProviderConfig[]) {
  await sset(KEY_PROVIDERS, providers)
}

async function refreshPresence(providers: VideoProviderConfig[]): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {}
  for (const p of providers) map[p.id] = await hasKey(p.id)
  return map
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  loaded: false,
  providers: [],
  selectedId: null,
  keyPresence: {},

  load: async () => {
    const providers = (await sget<VideoProviderConfig[]>(KEY_PROVIDERS)) || []
    const selectedId = (await sget<string>(KEY_SELECTED)) || providers[0]?.id || null
    const keyPresence = await refreshPresence(providers)
    set({ loaded: true, providers, selectedId, keyPresence })
  },

  addProvider: async (cfg) => {
    const id = `vp_${nanoid(8)}`
    const provider: VideoProviderConfig = {
      id,
      kind: cfg.kind || 'fal',
      label: cfg.label || (cfg.kind === 'custom-http' ? '自定义 HTTP' : 'fal.ai'),
      model: cfg.model,
      baseURL: cfg.baseURL,
      headers: cfg.headers,
      submitUrl: cfg.submitUrl,
      pollUrl: cfg.pollUrl,
      taskIdPath: cfg.taskIdPath,
      statusPath: cfg.statusPath,
      videoUrlPath: cfg.videoUrlPath,
      enabled: cfg.enabled ?? true,
    }
    const providers = [...get().providers, provider]
    await persist(providers)
    const selectedId = get().selectedId || id
    await sset(KEY_SELECTED, selectedId)
    set({ providers, selectedId })
    return id
  },

  updateProvider: async (id, patch) => {
    const providers = get().providers.map((p) => (p.id === id ? { ...p, ...patch, id } : p))
    await persist(providers)
    set({ providers })
  },

  removeProvider: async (id) => {
    const providers = get().providers.filter((p) => p.id !== id)
    await persist(providers)
    await removeKey(id)
    const selectedId = get().selectedId === id ? providers[0]?.id ?? null : get().selectedId
    await sset(KEY_SELECTED, selectedId)
    const keyPresence = { ...get().keyPresence }
    delete keyPresence[id]
    set({ providers, selectedId, keyPresence })
  },

  selectProvider: (id) => {
    set({ selectedId: id })
    void sset(KEY_SELECTED, id)
  },

  setProviderKey: async (id, apiKey) => {
    if (apiKey) await setKey(id, apiKey)
    else await removeKey(id)
    set({ keyPresence: { ...get().keyPresence, [id]: !!apiKey } })
  },

  getActive: () => {
    const { providers, selectedId } = get()
    return providers.find((p) => p.id === selectedId) || null
  },

  resolveKey: async (id) => getKey(id),
}))
