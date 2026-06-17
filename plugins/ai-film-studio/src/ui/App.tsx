import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import AppRail, { type AppView } from './components/shell/AppRail'
import EditorView, { type EditorNav } from './components/shell/EditorView'
import ProjectHome from './components/views/ProjectHome'
import AssetsView from './components/views/AssetsView'
import PromptLibrary, { type PromptsTab } from './components/views/PromptLibrary'
import SettingsView from './components/views/SettingsView'
import { useGraphStore } from './store/graphStore'
import { useProviderStore } from './store/providerStore'
import { usePromptStore } from './store/promptStore'

const PLUGIN_ID = 'ai-film-studio'
const VIEWS: AppView[] = ['home', 'editor', 'assets', 'prompts', 'settings']

export default function App() {
  const init = useGraphStore((s) => s.init)
  const loadModels = useGraphStore((s) => s.loadModels)
  const saveProject = useGraphStore((s) => s.saveProject)
  const deleteSelected = useGraphStore((s) => s.deleteSelected)
  const loadProviders = useProviderStore((s) => s.load)
  const loadPrompts = usePromptStore((s) => s.loadGlobal)

  const [view, setView] = useState<AppView>('home')
  const [promptsTab, setPromptsTab] = useState<PromptsTab>('snippets')

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

  // 主题跟随宿主
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'dark'
    document.documentElement.classList.toggle('light', initialTheme === 'light')
    const dispose = window.mulby?.onThemeChange?.((t) => {
      document.documentElement.classList.toggle('light', t === 'light')
    })
    return () => dispose?.()
  }, [])

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

  // 编辑器顶栏跳转：供应商→设置；画风→提示词库(项目风格)；提示词→提示词库(片段)
  const onEditorNav = (t: EditorNav) => {
    if (t === 'providers') {
      setView('settings')
    } else {
      setPromptsTab(t === 'style' ? 'style' : 'snippets')
      setView('prompts')
    }
  }

  return (
    <ReactFlowProvider>
      <div className="afs-shell">
        <AppRail view={view} onChange={setView} />
        <div className="afs-main">
          {view === 'home' && <ProjectHome onOpen={() => setView('editor')} />}
          {view === 'editor' && <EditorView onNavigate={onEditorNav} />}
          {view === 'assets' && <AssetsView onInserted={() => setView('editor')} />}
          {view === 'prompts' && <PromptLibrary tab={promptsTab} onTab={setPromptsTab} />}
          {view === 'settings' && <SettingsView />}
        </div>
      </div>
    </ReactFlowProvider>
  )
}
