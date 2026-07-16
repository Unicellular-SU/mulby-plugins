import { useEffect } from 'react'
import { CanvasStage } from './canvas/CanvasStage'
import { TopBar } from './components/TopBar'
import { LeftDock } from './components/LeftDock'
import { useGraph } from './store/graphStore'
import { useUi } from './store/uiStore'
import { useProviders } from './store/providerStore'
import { ProviderSettings } from './components/ProviderSettings'
import { ComposeModal } from './components/ComposeModal'
import { TimelineModal } from './components/TimelineModal'
import { StoryboardModal } from './components/StoryboardModal'
import { TemplatePanel } from './components/TemplatePanel'
import { MaskInpaintModal } from './components/MaskInpaintModal'
import { VideoTrimModal } from './components/VideoTrimModal'
import { VideoStudioModal } from './components/VideoStudioModal'
import { TaskCenter } from './components/TaskCenter'
import { Gallery } from './components/Gallery'
import { CardSearch } from './components/CardSearch'
import { ProjectLibrary } from './components/ProjectLibrary'
import { PanoViewer } from './canvas/PanoViewer'
import { DirectorStage } from './canvas/DirectorStage'
import { DialogHost } from './components/DialogHost'
import { ToastHost } from './components/ToastHost'
import { TooltipHost } from './components/TooltipHost'
import { saveProject, saveRecovery, clearRecovery } from './services/persistence'
import { useProject, isLoadedRef } from './store/projectStore'
import { importAttachments } from './services/importMedia'
import { screenToWorld } from './canvas/viewport'
import { debounce } from './util'
import type { ProjectDoc } from './types'

export default function App() {
  // 加载工程（多工程注册表 + 旧单工程自动迁移 + 恢复快照询问）+ 主题
  useEffect(() => {
    const mulby = window.mulby

    void useProject.getState().init()
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
      try { off?.() } catch { /* ignore */ }
      try { offInit?.() } catch { /* ignore */ }
    }
  }, [])

  // 自动保存（防抖）+ 崩溃恢复快照（独立键，更短防抖；主存成功后清除）
  useEffect(() => {
    // 注意：保存键取 doc 自身的 project.id（各载入路径均保证 pid===doc.id），绝不读 useProject.activeId——
    // 切换/删除工程存在窗口期：activeId 已指向新工程、graphStore 里仍是旧 doc，此时在途生成的回调
    // （流式 onChunk/onProgress、abortAllInflightVideos 触发的 catch 置 idle）会经 updateCard 触发本订阅，
    // 按 activeId 键控会把旧工程 doc 整体写到新工程 id 下（串工程覆盖）。id 仍随 p 在「调度时」一起捕获。
    const saveMain = debounce((id: string, p: ProjectDoc) => {
      useUi.getState().setSaving(true)
      saveProject(id, p)
        .then((ok) => {
          if (ok) {
            if (useProject.getState().activeId === id) useProject.getState().syncActiveMeta(p)
            void clearRecovery(id)
          }
        })
        .finally(() => useUi.getState().setSaving(false))
    }, 800)
    const saveRec = debounce((id: string, p: ProjectDoc) => void saveRecovery(id, p, Date.now()), 400)
    let last = useGraph.getState().project
    const unsub = useGraph.subscribe((state) => {
      if (state.project !== last) {
        last = state.project
        if (isLoadedRef(state.project)) return // 载入/切换工程引发的变更，非用户编辑 → 不保存
        if (!useProject.getState().activeId) return // 注册表未初始化完成 → 不保存（避免把初始占位工程写成孤儿键）
        const id = state.project.id
        saveRec(id, state.project)
        saveMain(id, state.project)
      }
    })
    // 关窗/隐藏前尽力抢救一次恢复快照（同样按 doc.id 键控，防止切换窗口期把旧 doc 抢救到新工程的恢复键下）
    const flush = () => {
      try {
        if (!useProject.getState().activeId) return
        const p = useGraph.getState().project
        void saveRecovery(p.id, p, Date.now())
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
      <TimelineModal />
      <ProjectLibrary />
      <PanoViewer />
      <DirectorStage />
      <StoryboardModal />
      <TemplatePanel show={showTemplates} onClose={() => useUi.getState().setShowTemplates(false)} />
      <MaskInpaintModal />
      <VideoTrimModal />
      <VideoStudioModal />
      <TaskCenter />
      <Gallery />
      <CardSearch />
      <DialogHost />
      <ToastHost />
      <TooltipHost />
    </div>
  )
}
