import { create } from 'zustand'
import type { ProviderConfig, ProviderKind } from '../services/providers/types'
import { PLUGIN_ID } from '../services/persistence'

function storage(): any {
  return (window as any).mulby?.storage
}

interface ProviderState {
  providers: ProviderConfig[]
  activeVideoId: string | null
  activeAudioId: string | null
  loaded: boolean
  load: () => Promise<void>
  persist: () => void
  upsert: (p: ProviderConfig) => void
  remove: (id: string) => void
  setActive: (kind: ProviderKind, id: string | null) => void
  setKey: (id: string, key: string) => Promise<void>
  getKey: (id: string) => Promise<string>
  activeFor: (kind: ProviderKind) => ProviderConfig | null
  exportJson: () => string
  importJson: (text: string) => boolean
}

export const useProviders = create<ProviderState>((set, get) => ({
  providers: [],
  activeVideoId: null,
  activeAudioId: null,
  loaded: false,

  load: async () => {
    try {
      const data = await storage()?.get('providers', PLUGIN_ID)
      if (data && typeof data === 'object') {
        set({
          providers: Array.isArray(data.providers) ? data.providers : [],
          activeVideoId: data.activeVideoId || null,
          activeAudioId: data.activeAudioId || null,
          loaded: true
        })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  persist: () => {
    const { providers, activeVideoId, activeAudioId } = get()
    try {
      storage()?.set('providers', { providers, activeVideoId, activeAudioId }, PLUGIN_ID)
    } catch {
      /* ignore */
    }
  },

  upsert: (p) => {
    set((s) => {
      const i = s.providers.findIndex((x) => x.id === p.id)
      const providers = i >= 0 ? s.providers.map((x) => (x.id === p.id ? p : x)) : [...s.providers, p]
      // 首个该类型 provider 自动设为活跃
      const patch: Partial<ProviderState> = { providers }
      if (p.kind === 'video' && !s.activeVideoId) patch.activeVideoId = p.id
      if (p.kind === 'audio' && !s.activeAudioId) patch.activeAudioId = p.id
      return patch as ProviderState
    })
    get().persist()
  },

  remove: (id) => {
    set((s) => ({
      providers: s.providers.filter((x) => x.id !== id),
      activeVideoId: s.activeVideoId === id ? null : s.activeVideoId,
      activeAudioId: s.activeAudioId === id ? null : s.activeAudioId
    }))
    get().persist()
    try {
      storage()?.encrypted?.remove(`providerKey:${id}`)
    } catch {
      /* ignore */
    }
  },

  setActive: (kind, id) => {
    set(kind === 'video' ? { activeVideoId: id } : { activeAudioId: id })
    get().persist()
  },

  setKey: async (id, key) => {
    try {
      await storage()?.encrypted?.set(`providerKey:${id}`, key)
    } catch {
      /* ignore */
    }
  },

  getKey: async (id) => {
    try {
      return ((await storage()?.encrypted?.get(`providerKey:${id}`)) as string) || ''
    } catch {
      return ''
    }
  },

  activeFor: (kind) => {
    const { providers, activeVideoId, activeAudioId } = get()
    const id = kind === 'video' ? activeVideoId : activeAudioId
    return providers.find((p) => p.id === id) || providers.find((p) => p.kind === kind) || null
  },

  // 导出/导入（不含密钥——密钥单独存 storage.encrypted，导入后需重新填写）
  exportJson: () => {
    const { providers, activeVideoId, activeAudioId } = get()
    return JSON.stringify({ providers, activeVideoId, activeAudioId }, null, 2)
  },

  importJson: (text) => {
    try {
      const data = JSON.parse(text)
      if (!data || !Array.isArray(data.providers)) return false
      set({ providers: data.providers, activeVideoId: data.activeVideoId || null, activeAudioId: data.activeAudioId || null })
      get().persist()
      return true
    } catch {
      return false
    }
  }
}))
