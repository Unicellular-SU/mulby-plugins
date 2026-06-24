import { useEffect } from 'react'
import { CanvasStage } from './canvas/CanvasStage'
import { TopBar } from './components/TopBar'
import { LeftDock } from './components/LeftDock'
import { useGraph } from './store/graphStore'
import { useUi } from './store/uiStore'
import { useProviders } from './store/providerStore'
import { ProviderSettings } from './components/ProviderSettings'
import { ComposeModal } from './components/ComposeModal'
import { StoryboardModal } from './components/StoryboardModal'
import { TemplatePanel } from './components/TemplatePanel'
import { MaskInpaintModal } from './components/MaskInpaintModal'
import { VideoTrimModal } from './components/VideoTrimModal'
import { TaskCenter } from './components/TaskCenter'
import { Gallery } from './components/Gallery'
import { DialogHost } from './components/DialogHost'
import { ToastHost } from './components/ToastHost'
import { TooltipHost } from './components/TooltipHost'
import { loadProject, saveProject, loadRecovery, saveRecovery, clearRecovery } from './services/persistence'
import { confirmDialog } from './store/dialogStore'
import { importAttachments } from './services/importMedia'
import { screenToWorld } from './canvas/viewport'
import { debounce } from './util'
import type { ProjectDoc } from './types'

export default function App() {
  // 加载工程 + 主题
  useEffect(() => {
    let disposed = false
    const mulby = (window as any).mulby

    const sanitize = (doc: ProjectDoc) => {
      // 旧工程兼容：补 parentId 默认 null；重开时把上次遗留的"进行中/排队"重置为闲置（任务已不在内存，避免卡死转圈）
      for (const b of doc.boards)
        for (const c of Object.values(b.cards)) {
          if ((c as any).parentId === undefined) (c as any).parentId = null
          if (c.status === 'running' || c.status === 'queued') {
            c.status = 'idle'
            c.progress = 0
          }
        }
    }
    ;(async () => {
      const [p, rec] = await Promise.all([loadProject(), loadRecovery()])
      if (disposed) return
      let doc = p
      // 存在恢复快照 = 上次有改动未提交主存（异常关闭）→ 询问是否恢复
      if (rec?.doc) {
        const useRec = await confirmDialog({
          title: '恢复未保存的改动',
          message: '检测到上次可能未正常保存的编辑，是否恢复到最近状态？',
          confirmLabel: '恢复',
          cancelLabel: '用已保存版本'
        })
        if (disposed) return
        if (useRec) doc = rec.doc
        await clearRecovery()
      }
      if (doc) {
        sanitize(doc)
        useGraph.getState().replaceProject(doc)
      }
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

  // 自动保存（防抖）+ 崩溃恢复快照（独立键，更短防抖；主存成功后清除）
  useEffect(() => {
    const saveMain = debounce((p: ProjectDoc) => {
      useUi.getState().setSaving(true)
      saveProject(p)
        .then((ok) => {
          if (ok) void clearRecovery()
        })
        .finally(() => useUi.getState().setSaving(false))
    }, 800)
    const saveRec = debounce((p: ProjectDoc) => void saveRecovery(p, Date.now()), 400)
    let last = useGraph.getState().project
    const unsub = useGraph.subscribe((state) => {
      if (state.project !== last) {
        last = state.project
        saveRec(state.project)
        saveMain(state.project)
      }
    })
    // 关窗/隐藏前尽力抢救一次恢复快照
    const flush = () => {
      try {
        void saveRecovery(useGraph.getState().project, Date.now())
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      unsub()
      saveRec.cancel()
      saveMain.cancel()
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  const showProviderSettings = useUi((s) => s.showProviderSettings)
  const showTemplates = useUi((s) => s.showTemplates)

  return (
    <div className="h-full w-full flex flex-col text-neutral-800 dark:text-neutral-200">
      <TopBar />
      <div className="flex-1 relative min-h-0 min-w-0">
        <CanvasStage />
        <LeftDock />
      </div>
      {showProviderSettings && <ProviderSettings />}
      <ComposeModal />
      <StoryboardModal />
      <TemplatePanel show={showTemplates} onClose={() => useUi.getState().setShowTemplates(false)} />
      <MaskInpaintModal />
      <VideoTrimModal />
      <TaskCenter />
      <Gallery />
      <DialogHost />
      <ToastHost />
      <TooltipHost />
    </div>
  )
}
