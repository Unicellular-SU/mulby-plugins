import { Clapperboard, LayoutGrid, Workflow, Image as ImageIcon, MessageSquareText, Settings, type LucideIcon } from 'lucide-react'

export type AppView = 'home' | 'editor' | 'assets' | 'prompts' | 'settings'

const ITEMS: { view: AppView; icon: LucideIcon; label: string }[] = [
  { view: 'home', icon: LayoutGrid, label: '工程' },
  { view: 'editor', icon: Workflow, label: '画布' },
  { view: 'assets', icon: ImageIcon, label: '素材' },
  { view: 'prompts', icon: MessageSquareText, label: '提示词' },
]

/** 左侧一级界面导航栏（rail）：始终可见，切换工程主页 / 画布 / 素材库 / 提示词库 / 设置。 */
export default function AppRail({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
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
        className={`afs-rail__item${view === 'settings' ? ' is-active' : ''}`}
        onClick={() => onChange('settings')}
        title="设置（供应商 / 全局 / 提示词）"
      >
        <Settings size={18} />
        <span>设置</span>
      </button>
    </nav>
  )
}
