import { useCallback, useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import AppRail, { type AppView } from './components/shell/AppRail'
import StudioApp from './studio/StudioApp'
import EditorView from './components/shell/EditorView'
import ProjectHome from './components/views/ProjectHome'
import AssetsView from './components/views/AssetsView'
import PromptLibrary from './components/views/PromptLibrary'
import SettingsView from './components/views/SettingsView'
import LightboxHost from './components/LightboxHost'
import ResultViewer from './components/ResultViewer'
import { TooltipProvider } from './components/ui/Tooltip'
import { ToastViewport } from './components/ui/Toast'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import { PromptProvider } from './components/ui/PromptDialog'
import { useGraphStore, flushSave, requestSave } from './store/graphStore'
import { clearAssetCache } from './services/assets'
import { useProviderStore } from './store/providerStore'
import { usePromptStore } from './store/promptStore'
import { useUiStore } from './store/uiStore'

const PLUGIN_ID = 'ai-film-studio'
const VIEWS: AppView[] = ['studio', 'home', 'editor', 'assets', 'prompts', 'models', 'storage', 'advanced']

export default function App() {
  const init = useGraphStore((s) => s.init)
  const loadModels = useGraphStore((s) => s.loadModels)
  const deleteSelected = useGraphStore((s) => s.deleteSelected)
  const loadProviders = useProviderStore((s) => s.load)
  const loadPrompts = usePromptStore((s) => s.loadGlobal)
  const loadTheme = useUiStore((s) => s.loadTheme)
  const applyHostTheme = useUiStore((s) => s.applyHostTheme)

  const [view, setView] = useState<AppView>('home')

  // 切视图边界：离开画布前先 flush 落盘（修「加载中切页 → 工程丢失」），
  // 但**始终** setView——即便保存被拒也绝不困住用户。
  const go = useCallback(
    (v: AppView) => {
      if (view === 'editor' && v !== 'editor') void flushSave()
      setView(v)
    },
    [view]
  )

  useEffect(() => {
    init()
    loadModels()
    loadProviders()
    loadPrompts()
    // 恢复上次所在界面（裸键 lastView，namespace 'ai-film-studio'）
    void (async () => {
      try {
        const last = await window.mulby?.storage?.get('lastView', PLUGIN_ID)
        if (typeof last === 'string' && VIEWS.includes(last as AppView)) setView(last as AppView)
      } catch {
        // 忽略
      }
    })()
  }, [init, loadModels, loadProviders, loadPrompts])

  // 持久化当前界面
  useEffect(() => {
    void window.mulby?.storage?.set('lastView', view, PLUGIN_ID)
  }, [view])

  // 窗口隐藏/卸载边界：best-effort flush 落盘（宿主无「即将关闭」钩子；beforeunload 无法 await 异步 IPC）
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSave()
    }
    const onPageHide = () => {
      void flushSave()
      clearAssetCache() // 卸载时释放所有 blob/字节缓存（best-effort，非内存上界的唯一来源）
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])

  // 主题：先按宿主/持久化初始化，再监听宿主变更（用户手动切换后不再被宿主覆盖）
  useEffect(() => {
    void loadTheme()
    const dispose = window.mulby?.onThemeChange?.((t) => applyHostTheme(t === 'light' ? 'light' : 'dark'))
    return () => dispose?.()
  }, [loadTheme, applyHostTheme])

  // 全局快捷键：Cmd/Ctrl+S 保存；Delete/Backspace 删除选中节点（仅画布界面、非输入框聚焦时）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void requestSave()
        return
      }
      if (view !== 'editor') return
      const tag = (e.target as HTMLElement)?.tagName
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (!editing && (e.key === 'Delete' || e.key === 'Backspace')) {
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [deleteSelected, view])

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={300}>
      <ReactFlowProvider>
      <ConfirmProvider>
      <PromptProvider>
      <div className="afs-shell">
        <AppRail view={view} onChange={go} />
        <div className="afs-main">
          {view === 'studio' && <StudioApp onHome={() => go('home')} />}
          {view === 'home' && <ProjectHome onOpenCanvas={() => go('editor')} onOpenStudio={() => go('studio')} />}
          {view === 'editor' && <EditorView />}
          {view === 'assets' && <AssetsView />}
          {view === 'prompts' && <PromptLibrary />}
          {view === 'models' && <SettingsView section="models" />}
          {view === 'storage' && <SettingsView section="storage" />}
          {view === 'advanced' && <SettingsView section="advanced" />}
        </div>
      </div>
      <LightboxHost />
      <ResultViewer />
      <ToastViewport />
      </PromptProvider>
      </ConfirmProvider>
      </ReactFlowProvider>
    </TooltipProvider>
  )
}
