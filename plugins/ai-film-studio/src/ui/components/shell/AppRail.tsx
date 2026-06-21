import { Clapperboard, LayoutGrid, Workflow, Film, Image as ImageIcon, MessageSquareText, Settings, Sun, Moon, type LucideIcon } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'

export type AppView = 'studio' | 'home' | 'editor' | 'assets' | 'prompts' | 'settings'

const ITEMS: { view: AppView; icon: LucideIcon; label: string }[] = [
  { view: 'home', icon: LayoutGrid, label: '项目' }, // 统一项目主页：画布工程 + 工作流项目
  { view: 'studio', icon: Film, label: '工作台' }, // Toonflow 式结构化流水线编辑器
  { view: 'editor', icon: Workflow, label: '画布' }, // 节点图编辑器
  { view: 'assets', icon: ImageIcon, label: '素材' },
  { view: 'prompts', icon: MessageSquareText, label: '提示词' },
]

/** 左侧一级界面导航栏（rail）：始终可见，切换工程主页 / 画布 / 素材库 / 提示词库 / 设置。 */
export default function AppRail({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  return (
    <nav className="afs-rail">
      <div className="afs-rail__brand" title="AI 影视工坊">
        <Clapperboard size={20} />
      </div>
      <div className="afs-rail__items">
        {ITEMS.map((it) => {
          const Icon = it.icon
          return (
            <button
              key={it.view}
              className={`afs-rail__item${view === it.view ? ' is-active' : ''}`}
              onClick={() => onChange(it.view)}
              title={it.label}
            >
              <Icon size={18} />
              <span>{it.label}</span>
            </button>
          )
        })}
      </div>
      <div className="afs-rail__spacer" />
      <button
        className="afs-rail__item"
        onClick={toggleTheme}
        title={theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'}
      >
        {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        <span>{theme === 'light' ? '暗色' : '亮色'}</span>
      </button>
      <button
        className={`afs-rail__item${view === 'settings' ? ' is-active' : ''}`}
        onClick={() => onChange('settings')}
        title="设置（模型供应商 / 外观 / 存储）"
      >
        <Settings size={18} />
        <span>设置</span>
      </button>
    </nav>
  )
}
