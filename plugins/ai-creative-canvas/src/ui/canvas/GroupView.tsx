import { type PointerEvent as RPointerEvent } from 'react'
import { Play, ChevronDown, ChevronRight, Ungroup } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { generateCard, canGenerate } from '../services/generate'
import { stageEl } from './stageEl'
import { screenToWorld } from './viewport'
import type { Card } from '../types'

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444', '#64748b']

// 分组框：命名 + 颜色 + 折叠 + 组内批量生成 + 取消编组；拖动框带动组内成员（在 CanvasStage 处理）
export function GroupView({ card, selected }: { card: Card; selected: boolean }) {
  const updateCard = useGraph((s) => s.updateCard)
  const removeCards = useGraph((s) => s.removeCards)
  const color = (card.params?.color as string) || '#6366f1'
  const collapsed = !!card.params?.collapsed
  const members = (card.params?.members as string[]) || []

  const membersNow = (): string[] => {
    const b = useGraph.getState().getActiveBoard()
    const ids: string[] = []
    for (const o of Object.values(b.cards)) {
      if (o.kind === 'group') continue
      const cx = o.x + o.w / 2
      const cy = o.y + o.h / 2
      if (cx >= card.x && cx <= card.x + card.w && cy >= card.y && cy <= card.y + card.h) ids.push(o.id)
    }
    return ids
  }

  const toggleCollapse = () => {
    if (collapsed) {
      updateCard(card.id, { h: (card.params?.expandedH as number) || card.h, params: { ...card.params, collapsed: false } })
    } else {
      const mem = membersNow()
      updateCard(card.id, { h: 36, params: { ...card.params, collapsed: true, members: mem, expandedH: card.h } })
    }
  }

  const genGroup = () => {
    const ids = collapsed ? members : membersNow()
    for (const id of ids) {
      const c = useGraph.getState().getActiveBoard().cards[id]
      if (c && canGenerate(c.kind) && c.status !== 'running' && c.status !== 'queued') void generateCard(id)
    }
  }

  const startResize = (e: RPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const rect = stageEl.current?.getBoundingClientRect()
      if (!rect) return
      const b = useGraph.getState().getActiveBoard()
      const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top, b.viewport)
      useGraph.getState().updateCard(card.id, { w: Math.max(140, w.x - card.x), h: Math.max(90, w.y - card.y) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      data-card-id={card.id}
      className={`absolute rounded-xl ${selected ? 'ring-2' : ''}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: collapsed ? 36 : card.h,
        background: color + '14',
        border: `1.5px solid ${color}66`,
        ['--tw-ring-color' as any]: color
      }}
    >
      <div className="absolute top-0 inset-x-0 h-9 flex items-center gap-1.5 px-2 rounded-t-xl" style={{ background: color + '22' }}>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        <input
          data-interactive
          onPointerDown={(e) => e.stopPropagation()}
          value={card.title}
          onChange={(e) => updateCard(card.id, { title: e.target.value })}
          className="bg-transparent text-sm font-medium outline-none flex-1 min-w-0 text-neutral-800 dark:text-neutral-100"
        />
        {collapsed && <span className="text-xs opacity-60 shrink-0">{members.length} 项</span>}
        <div data-interactive onPointerDown={(e) => e.stopPropagation()} className="flex items-center gap-0.5 shrink-0">
          <button onClick={genGroup} title="生成组内全部" className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/15">
            <Play size={13} />
          </button>
          <button onClick={toggleCollapse} title={collapsed ? '展开' : '折叠'} className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/15">
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={() => removeCards([card.id])} title="取消编组" className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/15">
            <Ungroup size={13} />
          </button>
        </div>
      </div>

      {selected && !collapsed && (
        <div data-interactive onPointerDown={(e) => e.stopPropagation()} className="absolute top-10 left-2 flex gap-1">
          {COLORS.map((c) => (
            <button key={c} onClick={() => updateCard(card.id, { params: { ...card.params, color: c } })} className="w-3.5 h-3.5 rounded-full border border-white/60" style={{ background: c }} />
          ))}
        </div>
      )}

      {!collapsed && (
        <div
          data-interactive
          onPointerDown={startResize}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{ borderRight: `2px solid ${color}99`, borderBottom: `2px solid ${color}99`, borderBottomRightRadius: 10 }}
        />
      )}
    </div>
  )
}
