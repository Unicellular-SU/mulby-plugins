import { Type, Image as ImageIcon, Video, Music, Package } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { screenToWorld } from '../canvas/viewport'
import type { CardKind } from '../types'

const ITEMS: Array<{ kind: CardKind; icon: typeof Type; label: string; accent: string }> = [
  { kind: 'text', icon: Type, label: '文本', accent: '#10b981' },
  { kind: 'image', icon: ImageIcon, label: '图片', accent: '#6366f1' },
  { kind: 'video', icon: Video, label: '视频', accent: '#ec4899' },
  { kind: 'audio', icon: Music, label: '音频', accent: '#f59e0b' },
  { kind: 'source', icon: Package, label: '素材', accent: '#64748b' }
]

function addAtViewCenter(kind: CardKind) {
  const { stageSize } = useUi.getState()
  const vp = useGraph.getState().getActiveBoard().viewport
  const c = screenToWorld(stageSize.w / 2, stageSize.h / 2, vp)
  useGraph.getState().addCard(kind, {
    x: c.x + (Math.random() * 60 - 30),
    y: c.y + (Math.random() * 60 - 30)
  })
}

export function LeftDock() {
  return (
    <div
      className="w-14 shrink-0 flex flex-col items-center gap-1 py-2 border-r bg-white/70 dark:bg-neutral-900/70"
      style={{ borderColor: 'var(--ace-border)' }}
    >
      {ITEMS.map((it) => {
        const Icon = it.icon
        return (
          <button
            key={it.kind}
            onClick={() => addAtViewCenter(it.kind)}
            title={`添加${it.label}卡片`}
            className="w-11 h-11 grid place-items-center gap-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 group"
          >
            <Icon size={18} style={{ color: it.accent }} className="group-hover:scale-110 transition-transform" />
            <span className="text-[10px] opacity-70">{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}
