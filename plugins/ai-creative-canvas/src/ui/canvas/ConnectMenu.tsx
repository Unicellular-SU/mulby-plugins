import { Type, Image as ImageIcon, Video, Music } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { KIND_ACCENT, type CardKind } from '../types'

const OPTIONS: Array<{ kind: CardKind; icon: typeof Type; label: string }> = [
  { kind: 'image', icon: ImageIcon, label: '图片' },
  { kind: 'text', icon: Type, label: '文本' },
  { kind: 'video', icon: Video, label: '视频' },
  { kind: 'audio', icon: Music, label: '音频' }
]

const MENU_W = 150
const MENU_H = 180

export function ConnectMenu() {
  const menu = useUi((s) => s.connectMenu)
  const ss = useUi((s) => s.stageSize)
  if (!menu) return null

  const close = () => useUi.getState().setConnectMenu(null)
  const create = (kind: CardKind) => {
    useGraph.getState().createConnectedNode(kind, { x: menu.wx, y: menu.wy }, menu.sourceIds)
    close()
  }

  const left = Math.max(4, Math.min(menu.sx, ss.w - MENU_W - 4))
  const top = Math.max(4, Math.min(menu.sy, ss.h - MENU_H - 4))

  return (
    <>
      <div data-interactive className="absolute inset-0 z-40" onPointerDown={close} />
      <div
        data-interactive
        className="ace-menu ace-anim-pop absolute z-50 py-1"
        style={{ left, top, width: MENU_W }}
      >
        <div className="px-3 py-1 text-[11px] opacity-50">{menu.sourceIds.length > 1 ? `新建并连接（${menu.sourceIds.length} 个）` : '在此新建并连接'}</div>
        {OPTIONS.map((o) => {
          const Icon = o.icon
          return (
            <button
              key={o.kind}
              onClick={() => create(o.kind)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 text-left"
            >
              <Icon size={15} style={{ color: KIND_ACCENT[o.kind] }} />
              {o.label}
            </button>
          )
        })}
      </div>
    </>
  )
}
