import { useEffect, useState } from 'react'
import { ImagePlus, Eraser, Maximize, Edit3, History, LayoutTemplate } from 'lucide-react'

import GeneratePage from './pages/GeneratePage.tsx'
import RemoveBgPage from './pages/RemoveBgPage.tsx'
import UpscalePage from './pages/UpscalePage.tsx'
import EditPage from './pages/EditPage.tsx'
import HistoryPage from './pages/HistoryPage.tsx'
import { useImageModels } from './hooks/useImageModels.ts'

type Route = 'generate' | 'remove-bg' | 'upscale' | 'edit' | 'history'

export default function App() {
  const [currentRoute, setCurrentRoute] = useState<Route>('generate')
  const { models, selectedModel, setSelectedModel, loading } = useImageModels()

  useEffect(() => {
    // 监听主题变化
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'dark'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    // 接收插件初始化数据，路由分发
    window.mulby?.onPluginInit?.((data: any) => {
      if (data.featureCode === 'ai-image-generate') setCurrentRoute('generate')
      if (data.featureCode === 'ai-image-remove-bg') setCurrentRoute('remove-bg')
      if (data.featureCode === 'ai-image-upscale') setCurrentRoute('upscale')
      if (data.featureCode === 'ai-image-edit') setCurrentRoute('edit')
    })
  }, [])

  const renderContent = () => {
    switch (currentRoute) {
      case 'generate': return <GeneratePage selectedModel={selectedModel} />
      case 'remove-bg': return <RemoveBgPage selectedModel={selectedModel} />
      case 'upscale': return <UpscalePage selectedModel={selectedModel} />
      case 'edit': return <EditPage selectedModel={selectedModel} />
      case 'history': return <HistoryPage />
      default: return <GeneratePage selectedModel={selectedModel} />
    }
  }

  const navItems = [
    { id: 'generate', label: 'AI 生图', icon: <ImagePlus size={20} /> },
    { id: 'remove-bg', label: '去背景', icon: <Eraser size={20} /> },
    { id: 'upscale', label: '无损放大', icon: <Maximize size={20} /> },
    { id: 'edit', label: 'AI 修图', icon: <Edit3 size={20} /> },
    { id: 'history', label: '历史记录', icon: <History size={20} /> }
  ]

  return (
    <div className="flex h-screen w-full bg-slate-50 dark:bg-[#0a0a0f] text-slate-800 dark:text-slate-200 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-white/50 dark:bg-slate-900/50 backdrop-blur-xl border-r border-slate-200 dark:border-slate-800 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <LayoutTemplate size={18} className="text-white" />
          </div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100 tracking-wide">AI 图像处理</h1>
        </div>
        
        <nav className="flex-1 px-4 py-2 space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setCurrentRoute(item.id as Route)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                currentRoute === item.id 
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium border border-indigo-500/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]' 
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-400">当前全局模型</label>
            {loading ? (
              <div className="bg-white/60 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 text-slate-500 text-sm">加载中...</div>
            ) : models.length === 0 ? (
              <div className="bg-amber-50 dark:bg-slate-950/50 border border-amber-200 dark:border-amber-800/50 rounded-lg p-2 text-amber-600 dark:text-amber-400 text-xs">
                未找到图像生成模型
              </div>
            ) : (
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-white/60 dark:bg-slate-950/50 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                {models.map(m => (
                  <option key={m.id} value={m.id}>{m.label || m.id}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden bg-gradient-to-br from-slate-50 to-slate-100 dark:from-[#0a0a0f] dark:to-[#12121a]">
        {renderContent()}
      </main>
    </div>
  )
}
