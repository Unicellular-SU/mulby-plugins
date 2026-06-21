import { useState, type PointerEvent as RPointerEvent } from 'react'
import { Play, ChevronDown, ChevronRight, Ungroup, Music, Save } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { generateCard, canGenerate } from '../services/generate'
import { syncPlayGroup } from '../services/syncPlay'
import { saveGroupAsTemplate } from '../services/templates'
import { stageEl } from './stageEl'
import { screenToWorld } from './viewport'
import { isCardInsideGroup, type Card } from '../types'

const COLORS = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6', '#ef4444', '#64748b']

function notify(m: string, t?: string) {
  ;(window as any).mulby?.notification?.show?.(m, t)
}

// 分组框：命名/换色/折叠/生成组/同步播放/存为模板/取消编组；成员归属用 parentId（CanvasStage 拖动带动后代）
export function GroupView({ card, selected }: { card: Card; selected: boolean }) {
  const updateCard = useGraph((s) => s.updateCard)
  const removeCards = useGraph((s) => s.removeCards)
  const color = (card.params?.color as string) || '#6366f1'
  const collapsed = !!card.params?.collapsed
  const [editing, setEditing] = useState(false)

  const allDescendants = (): string[] => {
    const cards = useGraph.getState().getActiveBoard().cards
    const out: string[] = []
    const walk = (gid: string) => {
      for (const c of Object.values(cards)) if (c.parentId === gid) { out.push(c.id); if (c.kind === 'group') walk(c.id) }
    }
    walk(card.id)
    return out
  }

  const toggleCollapse = () => {
    if (collapsed) updateCard(card.id, { h: (card.params?.expandedH as number) || card.h, params: { ...card.params, collapsed: false } })
    else updateCard(card.id, { h: 36, params: { ...card.params, collapsed: true, expandedH: card.h } })
  }

  const genGroup = () => {
    for (const id of allDescendants()) {
      const c = useGraph.getState().getActiveBoard().cards[id]
      if (c && canGenerate(c.kind) && c.status !== 'running' && c.status !== 'queued') void generateCard(id)
    }
  }

  const saveTemplate = () => {
    const name = prompt('模板名称:', card.title || '分组')
    if (!name) return
    const b = useGraph.getState().getActiveBoard()
    void saveGroupAsTemplate(card.id, name, b).then((t) => notify(t ? `已保存模板：${name}` : '保存失败', t ? 'success' : 'error'))
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
      // resize 结束：吸入完全落入的顶层卡 / 弹出移出框的直属子（一次历史）
      const b = useGraph.getState().getActiveBoard()
      const grp = b.cards[card.id]
      if (!grp) return
      const ops: Array<[string, string | null]> = []
      for (const c of Object.values(b.cards)) {
        if (c.id === card.id) continue
        const inside = isCardInsideGroup(c, grp)
        if (c.parentId === card.id && !inside) ops.push([c.id, null]) // 弹出移出框的直属子（含嵌套组）
        else if (c.parentId == null && inside && c.kind !== 'group') ops.push([c.id, card.id]) // 吸入仅限非组顶层卡，避免成环
      }
      if (ops.length) {
        useGraph.getState().pushHistory()
        useGraph.setState((s) => ({
          project: {
            ...s.project,
            updatedAt: Date.now(),
            boards: s.project.boards.map((bd) => {
              if (bd.id !== s.project.activeBoardId) return bd
              const cards = { ...bd.cards }
              for (const [id, p] of ops) if (cards[id]) cards[id] = { ...cards[id], parentId: p }
              return { ...bd, cards }
            })
          }
        }))
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const btn = 'p-1 rounded hover:bg-black/10 dark:hover:bg-white/15'

  return (
    <div
      data-card-id={card.id}
      className={`absolute rounded-xl pointer-events-none ${selected ? 'ring-2' : ''}`}
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
      <div className="absolute top-0 inset-x-0 h-9 flex items-center gap-1.5 px-2 rounded-t-xl pointer-events-auto" style={{ background: color + '22' }}>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
        {editing ? (
          <input
            data-interactive
            autoFocus
            onPointerDown={(e) => e.stopPropagation()}
            value={card.title}
            onChange={(e) => updateCard(card.id, { title: e.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') setEditing(false)
            }}
            className="bg-transparent text-sm font-medium outline-none flex-1 min-w-0 text-neutral-800 dark:text-neutral-100"
          />
        ) : (
          <span
            onDoubleClick={() => setEditing(true)}
            title="双击重命名；按住标题拖动分组"
            className="flex-1 min-w-0 truncate text-sm font-medium select-none cursor-grab text-neutral-800 dark:text-neutral-100"
          >
            {card.title || '分组'}
          </span>
        )}
        {collapsed && <span className="text-xs opacity-60 shrink-0">{allDescendants().length} 项</span>}
        <div data-interactive onPointerDown={(e) => e.stopPropagation()} className="flex items-center gap-0.5 shrink-0">
          <button onClick={genGroup} title="生成组内全部" className={btn}>
            <Play size={13} />
          </button>
          {!collapsed && (
            <button onClick={() => void syncPlayGroup(card.id)} title="同步播放组内视频" className={btn}>
              <Music size={13} />
            </button>
          )}
          <button onClick={saveTemplate} title="保存为模板" className={btn}>
            <Save size={13} />
          </button>
          <button onClick={toggleCollapse} title={collapsed ? '展开' : '折叠'} className={btn}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={() => removeCards([card.id])} title="取消编组" className={btn}>
            <Ungroup size={13} />
          </button>
        </div>
      </div>

      {selected && !collapsed && (
        <div data-interactive onPointerDown={(e) => e.stopPropagation()} className="absolute top-10 left-2 flex gap-1 pointer-events-auto">
          {COLORS.map((c) => (
            <button key={c} onClick={() => updateCard(card.id, { params: { ...card.params, color: c } })} className="w-3.5 h-3.5 rounded-full border border-white/60" style={{ background: c }} />
          ))}
        </div>
      )}

      {!collapsed && (
        <div
          data-interactive
          onPointerDown={startResize}
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize pointer-events-auto"
          style={{ borderRight: `2px solid ${color}99`, borderBottom: `2px solid ${color}99`, borderBottomRightRadius: 10 }}
        />
      )}
    </div>
  )
}
