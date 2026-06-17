import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Toolbar from './components/Toolbar'
import NodeLibrary from './components/NodeLibrary'
import FlowCanvas from './components/FlowCanvas'
import Inspector from './components/Inspector'
import ProviderSettings from './components/ProviderSettings'
import GlobalSettings from './components/GlobalSettings'
import { useGraphStore } from './store/graphStore'
import { useProviderStore } from './store/providerStore'

export default function App() {
  const loaded = useGraphStore((s) => s.loaded)
  const init = useGraphStore((s) => s.init)
  const loadModels = useGraphStore((s) => s.loadModels)
  const saveProject = useGraphStore((s) => s.saveProject)
  const deleteSelected = useGraphStore((s) => s.deleteSelected)
  const loadProviders = useProviderStore((s) => s.load)
  const [providersOpen, setProvidersOpen] = useState(false)
  const [globalsOpen, setGlobalsOpen] = useState(false)

  useEffect(() => {
    init()
    loadModels()
    loadProviders()
  }, [init, loadModels, loadProviders])

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

  // 全局快捷键：Cmd/Ctrl+S 保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveProject()
      }
      // Delete / Backspace 删除选中节点（输入框聚焦时不触发）
      const tag = (e.target as HTMLElement)?.tagName
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if (!editing && (e.key === 'Delete' || e.key === 'Backspace')) {
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveProject, deleteSelected])

  return (
    <ReactFlowProvider>
      <div className="afs-app">
        <Toolbar onOpenProviders={() => setProvidersOpen(true)} onOpenGlobals={() => setGlobalsOpen(true)} />
        <ProviderSettings open={providersOpen} onClose={() => setProvidersOpen(false)} />
        <GlobalSettings open={globalsOpen} onClose={() => setGlobalsOpen(false)} />
        <div className="afs-app__body">
          <aside className="afs-app__left">
            <NodeLibrary />
          </aside>
          <main className="afs-app__center">
            {loaded ? <FlowCanvas /> : <div className="afs-loading">加载工程中…</div>}
          </main>
          <aside className="afs-app__right">
            <Inspector />
          </aside>
        </div>
      </div>
    </ReactFlowProvider>
  )
}
