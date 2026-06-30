import { Clapperboard, LayoutGrid, Workflow, Settings, Sun, Moon, type LucideIcon } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'

export type AppView = 'studio' | 'home' | 'editor' | 'assets' | 'prompts' | 'settings'

// 一级导航：项目 / 画布。工作台不再作一级入口——只在从「项目」页打开工作流项目时进入
// （独立空工作台页已删除）；节点画布是独立子系统（自带工程），仍作一级入口。
const ITEMS: { view: AppView; icon: LucideIcon; label: string }[] = [
  { view: 'home', icon: LayoutGrid, label: '项目' }, // 统一项目主页：画布工程 + 工作流项目
  { view: 'editor', icon: Workflow, label: '画布' }, // 独立节点画布（高级编辑）
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
