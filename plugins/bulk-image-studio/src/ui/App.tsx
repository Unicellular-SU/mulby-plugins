import { useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { Images, Layers, Scissors } from 'lucide-react'
import { useMulby } from './hooks/useMulby'
import BatchPage from './pages/BatchPage'
import MergePage from './pages/MergePage'
import CropPage from './pages/CropPage'

interface Attachment {
  id?: string
  name?: string
  path?: string
  kind?: 'file' | 'image'
}

interface PluginInitData {
  pluginName?: string
  featureCode?: string
  route?: string
  attachments?: Attachment[]
}

const PLUGIN_ID = 'bulk-image-studio'

export default function App() {
  const { host } = useMulby(PLUGIN_ID)
  const [seedPaths, setSeedPaths] = useState<string[]>([])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const paths = (data.attachments ?? [])
        .map((a) => a.path)
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
      if (paths.length) {
        setSeedPaths((prev) => [...new Set([...prev, ...paths])])
      }
      if (data.route) {
        const r = data.route.replace(/^\//, '')
        window.location.hash = `#/${r}`
      }
    })

    void (async () => {
      try {
        const res = await host.call('getPendingInit')
        const d = res?.data as { route?: string; paths?: string[] } | undefined
        if (d?.paths?.length) {
          setSeedPaths((prev) => [...new Set([...prev, ...d.paths!])])
        }
        if (d?.route) {
          const r = d.route.replace(/^\//, '')
          window.location.hash = `#/${r}`
        }
      } catch {
        /* host 未就绪时忽略 */
      }
    })()
  }, [host])

  return (
    <div className="studio-root">
      <header className="studio-header">
        <div className="studio-brand">
          <Images size={22} />
          <span>图片批量工坊</span>
        </div>
        <nav className="studio-nav">
          <NavLink className="nav-item" to="/batch">
            <Layers size={16} />
            批量处理
          </NavLink>
          <NavLink className="nav-item" to="/merge">
            <Images size={16} />
            合并
          </NavLink>
          <NavLink className="nav-item" to="/crop">
            <Scissors size={16} />
            手动裁剪
          </NavLink>
        </nav>
      </header>
      <main className="studio-main">
        <Routes>
          <Route path="/" element={<Navigate to="/batch" replace />} />
          <Route path="/batch" element={<BatchPage seedPaths={seedPaths} />} />
          <Route path="/merge" element={<MergePage seedPaths={seedPaths} />} />
          <Route path="/crop" element={<CropPage seedPaths={seedPaths} />} />
        </Routes>
      </main>
    </div>
  )
}
