import { create } from 'zustand'

interface UiState {
  showGrid: boolean
  showMinimap: boolean
  theme: 'light' | 'dark'
  stageSize: { w: number; h: number }
  saving: boolean
  toggleGrid: () => void
  toggleMinimap: () => void
  setTheme: (t: 'light' | 'dark') => void
  setStageSize: (w: number, h: number) => void
  setSaving: (v: boolean) => void
  showProviderSettings: boolean
  setShowProviderSettings: (v: boolean) => void
  connectTemp: { x1: number; y1: number; x2: number; y2: number } | null
  setConnectTemp: (t: { x1: number; y1: number; x2: number; y2: number } | null) => void
  connectMenu: { sx: number; sy: number; wx: number; wy: number; sourceId: string } | null
  setConnectMenu: (m: { sx: number; sy: number; wx: number; wy: number; sourceId: string } | null) => void
  preview: { url: string; kind: 'image' | 'video' } | null
  setPreview: (p: { url: string; kind: 'image' | 'video' } | null) => void
}

export const useUi = create<UiState>((set) => ({
  showGrid: true,
  showMinimap: true,
  theme: 'light',
  stageSize: { w: 1200, h: 800 },
  saving: false,
  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleMinimap: () => set((s) => ({ showMinimap: !s.showMinimap })),
  setTheme: (theme) => set({ theme }),
  setStageSize: (w, h) => set({ stageSize: { w, h } }),
  setSaving: (saving) => set({ saving }),
  showProviderSettings: false,
  setShowProviderSettings: (showProviderSettings) => set({ showProviderSettings }),
  connectTemp: null,
  setConnectTemp: (connectTemp) => set({ connectTemp }),
  connectMenu: null,
  setConnectMenu: (connectMenu) => set({ connectMenu }),
  preview: null,
  setPreview: (preview) => set({ preview })
}))
