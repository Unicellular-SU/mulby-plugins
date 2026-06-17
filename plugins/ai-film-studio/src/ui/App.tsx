import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import AppRail, { type AppView } from './components/shell/AppRail'
import EditorView from './components/shell/EditorView'
import ProjectHome from './components/views/ProjectHome'
import AssetsView from './components/views/AssetsView'
import PromptLibrary from './components/views/PromptLibrary'
import SettingsView from './components/views/SettingsView'
import { useGraphStore } from './store/graphStore'
import { useProviderStore } from './store/providerStore'
import { usePromptStore } from './store/promptStore'
import { useUiStore } from './store/uiStore'

const PLUGIN_ID = 'ai-film-studio'
const VIEWS: AppView[] = ['home', 'editor', 'assets', 'prompts', 'settings']

export default function App() {
  const init = useGraphStore((s) => s.init)
  const loadModels = useGraphStore((s) => s.loadModels)
  const saveProject = useGraphStore((s) => s.saveProject)
  const deleteSelected = useGraphStore((s) => s.deleteSelected)
  const loadProviders = useProviderStore((s) => s.load)
  const loadPrompts = usePromptStore((s) => s.loadGlobal)
  const loadTheme = useUiStore((s) => s.loadTheme)
  const applyHostTheme = useUiStore((s) => s.applyHostTheme)

  const [view, setView] = useState<AppView>('home')

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
        saveProject()
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
  }, [saveProject, deleteSelected, view])

  return (
    <ReactFlowProvider>
      <div className="afs-shell">
        <AppRail view={view} onChange={setView} />
        <div className="afs-main">
          {view === 'home' && <ProjectHome onOpen={() => setView('editor')} />}
          {view === 'editor' && <EditorView />}
          {view === 'assets' && <AssetsView onInserted={() => setView('editor')} />}
          {view === 'prompts' && <PromptLibrary />}
          {view === 'settings' && <SettingsView />}
        </div>
      </div>
    </ReactFlowProvider>
  )
}
