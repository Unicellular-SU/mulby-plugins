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
  connectMenu: { sx: number; sy: number; wx: number; wy: number; sourceIds: string[] } | null
  setConnectMenu: (m: { sx: number; sy: number; wx: number; wy: number; sourceIds: string[] } | null) => void
  preview: { url: string; kind: 'image' | 'video' } | null
  setPreview: (p: { url: string; kind: 'image' | 'video' } | null) => void
  showCompose: boolean
  setShowCompose: (v: boolean) => void
  showTimeline: boolean
  setShowTimeline: (v: boolean) => void
  ctxMenu: { x: number; y: number; cardId: string | null } | null
  setCtxMenu: (m: { x: number; y: number; cardId: string | null } | null) => void
  storyboardCardId: string | null
  setStoryboardCardId: (id: string | null) => void
  showTemplates: boolean
  setShowTemplates: (v: boolean) => void
  snapGrid: boolean
  toggleSnapGrid: () => void
  guides: { vx: number[]; hy: number[] } | null
  setGuides: (g: { vx: number[]; hy: number[] } | null) => void
  paramClipboard: Record<string, unknown> | null
  setParamClipboard: (p: Record<string, unknown> | null) => void
  maskCardId: string | null
  setMaskCardId: (id: string | null) => void
  trimCardId: string | null
  setTrimCardId: (id: string | null) => void
  studioCardId: string | null
  setStudioCardId: (id: string | null) => void
  showTaskCenter: boolean
  setShowTaskCenter: (v: boolean) => void
  connInvalidIds: Set<string> | null
  setConnInvalid: (s: Set<string> | null) => void
  notifyDone: boolean
  toggleNotifyDone: () => void
  showGallery: boolean
  setShowGallery: (v: boolean) => void
  showProjectLibrary: boolean
  setShowProjectLibrary: (v: boolean) => void
  panoCardId: string | null
  setPanoCardId: (id: string | null) => void
  showDirector: boolean
  setShowDirector: (v: boolean) => void
  annotTool: 'pen' | 'arrow' | 'rect' | 'text' | null
  setAnnotTool: (t: 'pen' | 'arrow' | 'rect' | 'text' | null) => void
  annotColor: string
  setAnnotColor: (c: string) => void
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
  setPreview: (preview) => set({ preview }),
  showCompose: false,
  setShowCompose: (showCompose) => set({ showCompose }),
  showTimeline: false,
  setShowTimeline: (showTimeline) => set({ showTimeline }),
  ctxMenu: null,
  setCtxMenu: (ctxMenu) => set({ ctxMenu }),
  storyboardCardId: null,
  setStoryboardCardId: (storyboardCardId) => set({ storyboardCardId }),
  showTemplates: false,
  setShowTemplates: (showTemplates) => set({ showTemplates }),
  snapGrid: false,
  toggleSnapGrid: () => set((s) => ({ snapGrid: !s.snapGrid })),
  guides: null,
  setGuides: (guides) => set({ guides }),
  paramClipboard: null,
  setParamClipboard: (paramClipboard) => set({ paramClipboard }),
  maskCardId: null,
  setMaskCardId: (maskCardId) => set({ maskCardId }),
  trimCardId: null,
  setTrimCardId: (trimCardId) => set({ trimCardId }),
  studioCardId: null,
  setStudioCardId: (studioCardId) => set({ studioCardId }),
  showTaskCenter: false,
  setShowTaskCenter: (showTaskCenter) => set({ showTaskCenter }),
  connInvalidIds: null,
  setConnInvalid: (connInvalidIds) => set({ connInvalidIds }),
  notifyDone: (() => {
    try {
      return localStorage.getItem('ace:notifyDone') !== '0'
    } catch {
      return true
    }
  })(),
  toggleNotifyDone: () =>
    set((s) => {
      const v = !s.notifyDone
      try {
        localStorage.setItem('ace:notifyDone', v ? '1' : '0')
      } catch {
        /* ignore */
      }
      return { notifyDone: v }
    }),
  showGallery: false,
  setShowGallery: (showGallery) => set({ showGallery }),
  showProjectLibrary: false,
  setShowProjectLibrary: (showProjectLibrary) => set({ showProjectLibrary }),
  panoCardId: null,
  setPanoCardId: (panoCardId) => set({ panoCardId }),
  showDirector: false,
  setShowDirector: (showDirector) => set({ showDirector }),
  annotTool: null,
  setAnnotTool: (annotTool) => set({ annotTool }),
  annotColor: '#ef4444',
  setAnnotColor: (annotColor) => set({ annotColor })
}))
