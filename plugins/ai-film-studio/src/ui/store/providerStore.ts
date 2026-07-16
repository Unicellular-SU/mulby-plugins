import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { MediaProviderConfig, MediaCapability } from '../services/providers'
import { setKey, getKey, removeKey, hasKey } from '../services/keys'

const NS = 'ai-film-studio'
const KEY_PROVIDERS = 'videoProviders' // 沿用旧键名（内部存储，无需迁移）
const KEY_DEFAULTS = 'mediaDefaults'
const KEY_SELECTED_LEGACY = 'selectedVideoProvider'

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

// 归一化：旧数据无 capabilities/mode 时按视频供应商补全
function normProvider(p: MediaProviderConfig): MediaProviderConfig {
  const capabilities: MediaCapability[] = p.capabilities?.length ? p.capabilities : ['video']
  const mode = p.mode || (capabilities.length === 1 && capabilities[0] === 'tts' ? 'sync-binary' : 'async-poll')
  return { ...p, capabilities, mode }
}

interface ProviderState {
  loaded: boolean
  providers: MediaProviderConfig[]
  defaults: Partial<Record<MediaCapability, string>> // 每能力默认供应商
  keyPresence: Record<string, boolean>

  load: () => Promise<void>
  addProvider: (cfg: Partial<MediaProviderConfig>) => Promise<string>
  updateProvider: (id: string, patch: Partial<MediaProviderConfig>) => Promise<void>
  removeProvider: (id: string) => Promise<void>
  setDefault: (cap: MediaCapability, id: string | null) => void
  setProviderKey: (id: string, apiKey: string) => Promise<void>
  providersFor: (cap: MediaCapability) => MediaProviderConfig[]
  getActiveFor: (cap: MediaCapability) => MediaProviderConfig | null
  resolveKey: (id: string) => Promise<string>
}

async function persist(providers: MediaProviderConfig[]) {
  await sset(KEY_PROVIDERS, providers)
}

async function refreshPresence(providers: MediaProviderConfig[]): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = {}
  for (const p of providers) map[p.id] = await hasKey(p.id)
  return map
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  loaded: false,
  providers: [],
  defaults: {},
  keyPresence: {},

  load: async () => {
    const raw = (await sget<MediaProviderConfig[]>(KEY_PROVIDERS)) || []
    const providers = raw.map(normProvider)
    let defaults = (await sget<Partial<Record<MediaCapability, string>>>(KEY_DEFAULTS)) || {}
    // 迁移旧单选 selectedVideoProvider → defaults.video
    if (!defaults.video) {
      const legacy = await sget<string>(KEY_SELECTED_LEGACY)
      if (legacy && providers.some((p) => p.id === legacy)) defaults = { ...defaults, video: legacy }
    }
    const keyPresence = await refreshPresence(providers)
    set({ loaded: true, providers, defaults, keyPresence })
  },

  addProvider: async (cfg) => {
    const id = `vp_${nanoid(8)}`
    const capabilities: MediaCapability[] = cfg.capabilities?.length ? cfg.capabilities : ['video']
    const mode = cfg.mode || (capabilities.length === 1 && capabilities[0] === 'tts' ? 'sync-binary' : 'async-poll')
    const provider: MediaProviderConfig = {
      id,
      kind: cfg.kind || 'fal',
      label: cfg.label || (cfg.kind === 'custom-http' ? '自定义 HTTP' : 'fal.ai'),
      capabilities,
      mode,
      model: cfg.model,
      baseURL: cfg.baseURL,
      headers: cfg.headers,
      submitUrl: cfg.submitUrl,
      pollUrl: cfg.pollUrl,
      taskIdPath: cfg.taskIdPath,
      statusPath: cfg.statusPath,
      videoUrlPath: cfg.videoUrlPath,
      bodyTemplate: cfg.bodyTemplate,
      uploadUrl: cfg.uploadUrl,
      uploadUrlPath: cfg.uploadUrlPath,
      voices: cfg.voices,
      enabled: cfg.enabled ?? true,
    }
    const providers = [...get().providers, provider]
    await persist(providers)
    // 为它声明的每种能力补一个默认（若该能力尚无默认）
    const defaults = { ...get().defaults }
    for (const cap of capabilities) if (!defaults[cap]) defaults[cap] = id
    await sset(KEY_DEFAULTS, defaults)
    set({ providers, defaults })
    return id
  },

  updateProvider: async (id, patch) => {
    const providers = get().providers.map((p) => (p.id === id ? normProvider({ ...p, ...patch, id }) : p))
    await persist(providers)
    set({ providers })
  },

  removeProvider: async (id) => {
    const providers = get().providers.filter((p) => p.id !== id)
    await persist(providers)
    await removeKey(id)
    const defaults = { ...get().defaults }
    for (const cap of Object.keys(defaults) as MediaCapability[]) {
      if (defaults[cap] === id) {
        const next = providers.find((p) => (p.capabilities || ['video']).includes(cap))
        if (next) defaults[cap] = next.id
        else delete defaults[cap]
      }
    }
    await sset(KEY_DEFAULTS, defaults)
    const keyPresence = { ...get().keyPresence }
    delete keyPresence[id]
    set({ providers, defaults, keyPresence })
  },

  setDefault: (cap, id) => {
    const defaults = { ...get().defaults }
    if (id) defaults[cap] = id
    else delete defaults[cap]
    void sset(KEY_DEFAULTS, defaults)
    set({ defaults })
  },

  setProviderKey: async (id, apiKey) => {
    if (apiKey) await setKey(id, apiKey)
    else await removeKey(id)
    set({ keyPresence: { ...get().keyPresence, [id]: !!apiKey } })
  },

  providersFor: (cap) => get().providers.filter((p) => (p.capabilities || ['video']).includes(cap)),

  getActiveFor: (cap) => {
    const { providers, defaults } = get()
    const pool = providers.filter((p) => p.enabled && (p.capabilities || ['video']).includes(cap))
    return pool.find((p) => p.id === defaults[cap]) || pool[0] || null
  },

  resolveKey: async (id) => getKey(id),
}))
