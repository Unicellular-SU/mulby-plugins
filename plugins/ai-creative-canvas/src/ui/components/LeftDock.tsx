import { useState } from 'react'
import { Type, Image as ImageIcon, Compass, Video, Music, StickyNote, Upload, Loader2 } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { screenToWorld } from '../canvas/viewport'
import { KIND_ACCENT, type CardKind } from '../types'
import { importPaths, pickImportPaths } from '../services/importMedia'

const ITEMS: Array<{ kind: CardKind; icon: typeof Type; label: string }> = [
  { kind: 'text', icon: Type, label: '文本' },
  { kind: 'image', icon: ImageIcon, label: '图片' },
  { kind: 'pano', icon: Compass, label: '全景' },
  { kind: 'video', icon: Video, label: '视频' },
  { kind: 'audio', icon: Music, label: '音频' },
  { kind: 'note', icon: StickyNote, label: '便签' }
]

function addAtViewCenter(kind: CardKind) {
  const c = viewCenter()
  useGraph.getState().addCard(kind, {
    x: c.x + (Math.random() * 60 - 30),
    y: c.y + (Math.random() * 60 - 30)
  })
}

function viewCenter() {
  const { stageSize } = useUi.getState()
  const vp = useGraph.getState().getActiveBoard().viewport
  return screenToWorld(stageSize.w / 2, stageSize.h / 2, vp)
}

export function LeftDock() {
  const [importing, setImporting] = useState(false)
  const chooseResources = async () => {
    setImporting(true)
    try {
      const paths = await pickImportPaths()
      if (paths.length) await importPaths(paths, viewCenter())
    } finally {
      setImporting(false)
    }
  }
  return (
    <div
      data-interactive
      className="ace-glass absolute left-3 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 p-1.5"
    >
      {ITEMS.map((it) => {
        const Icon = it.icon
        return (
          <button
            key={it.kind}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-ace-kind', it.kind)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => addAtViewCenter(it.kind)}
            className="w-11 h-11 grid place-items-center gap-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 group cursor-grab active:cursor-grabbing"
          >
            <Icon size={18} style={{ color: KIND_ACCENT[it.kind] }} className="group-hover:scale-110 transition-transform" />
            <span className="text-[10px] opacity-70">{it.label}</span>
          </button>
        )
      })}
      <div className="w-8 border-t my-0.5" style={{ borderColor: 'var(--ace-border)' }} />
      <button
        onClick={() => void chooseResources()}
        disabled={importing}
        title="从本地导入图片、视频、音频或文本"
        className="w-11 h-11 grid place-items-center gap-0.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
      >
        {importing ? <Loader2 size={18} className="animate-spin text-indigo-500" /> : <Upload size={18} className="text-indigo-500" />}
        <span className="text-[10px] opacity-70">导入</span>
      </button>
    </div>
  )
}
