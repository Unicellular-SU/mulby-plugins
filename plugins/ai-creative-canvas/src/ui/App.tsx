import { useEffect } from 'react'
import { CanvasStage } from './canvas/CanvasStage'
import { TopBar } from './components/TopBar'
import { LeftDock } from './components/LeftDock'
import { useGraph } from './store/graphStore'
import { useUi } from './store/uiStore'
import { useProviders } from './store/providerStore'
import { ProviderSettings } from './components/ProviderSettings'
import { loadProject, saveProject } from './services/persistence'
import { importAttachments } from './services/importMedia'
import { screenToWorld } from './canvas/viewport'
import { debounce } from './util'
import type { ProjectDoc } from './types'

export default function App() {
  // 加载工程 + 主题
  useEffect(() => {
    let disposed = false
    const mulby = (window as any).mulby

    ;(async () => {
      const p = await loadProject()
      if (!disposed && p) useGraph.getState().replaceProject(p)
    })()

    void useProviders.getState().load()

    const applyTheme = (t: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', t === 'dark')
      useUi.getState().setTheme(t)
    }
    ;(async () => {
      try {
        const info = await mulby?.theme?.get()
        applyTheme(info?.actual === 'dark' ? 'dark' : 'light')
      } catch {
        /* ignore */
      }
    })()
    const off = mulby?.onThemeChange?.((t: 'light' | 'dark') => applyTheme(t))

    // img/files 触发：把拖入 Mulby 的媒体作为素材卡导入
    const offInit = mulby?.onPluginInit?.((data: any) => {
      const atts = data?.attachments
      if (Array.isArray(atts) && atts.length) {
        const vp = useGraph.getState().getActiveBoard().viewport
        const ss = useUi.getState().stageSize
        const world = screenToWorld(ss.w / 2, ss.h / 2, vp)
        void importAttachments(atts, world)
      }
    })

    return () => {
      disposed = true
      try { off?.() } catch { /* ignore */ }
      try { offInit?.() } catch { /* ignore */ }
    }
  }, [])

  // 自动保存（防抖）
  useEffect(() => {
    const save = debounce((p: ProjectDoc) => {
      useUi.getState().setSaving(true)
      saveProject(p).finally(() => useUi.getState().setSaving(false))
    }, 800)
    let last = useGraph.getState().project
    const unsub = useGraph.subscribe((state) => {
      if (state.project !== last) {
        last = state.project
        save(state.project)
      }
    })
    return () => {
      unsub()
      save.cancel()
    }
  }, [])

  const showProviderSettings = useUi((s) => s.showProviderSettings)

  return (
    <div className="h-full w-full flex flex-col text-neutral-800 dark:text-neutral-200">
      <TopBar />
      <div className="flex-1 flex min-h-0">
        <LeftDock />
        <div className="flex-1 relative min-w-0">
          <CanvasStage />
        </div>
      </div>
      {showProviderSettings && <ProviderSettings />}
    </div>
  )
}
