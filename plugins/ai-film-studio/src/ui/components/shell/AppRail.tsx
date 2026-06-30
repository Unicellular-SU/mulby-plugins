import { Clapperboard, LayoutGrid, Server, HardDrive, SlidersHorizontal, Sun, Moon, type LucideIcon } from 'lucide-react'
import { useUiStore } from '../../store/uiStore'

export type AppView = 'studio' | 'home' | 'editor' | 'assets' | 'prompts' | 'models' | 'storage' | 'advanced'

// 一级导航：项目 + 设置子项（模型 / 存储 / 高级）。画布与工作台不作一级入口——只能从「项目」页进入。
const ITEMS: { view: AppView; icon: LucideIcon; label: string }[] = [
  { view: 'home', icon: LayoutGrid, label: '项目' }, // 统一项目主页：画布工程 + 工作流项目
  { view: 'models', icon: Server, label: '模型' }, // 模型供应商 / API Key
  { view: 'storage', icon: HardDrive, label: '存储' }, // 素材附件占用与清理
  { view: 'advanced', icon: SlidersHorizontal, label: '高级' }, // 节点提示词（引擎 system prompt）
]

/** 左侧一级界面导航栏（rail）：始终可见——项目 / 模型 / 存储 / 高级；底部主题切换。 */
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
    </nav>
  )
}
