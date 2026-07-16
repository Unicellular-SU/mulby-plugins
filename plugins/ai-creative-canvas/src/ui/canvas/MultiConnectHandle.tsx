import { useState, type PointerEvent as RPointerEvent } from 'react'
import { Plus } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { worldToScreen, screenToWorld } from './viewport'
import { stageEl } from './stageEl'

// 多选时在选区右侧出现一个连接手柄：拉出一根线 → 落到节点(连入全部)/落到空白(新建并连入全部)
export function MultiConnectHandle() {
  const selectedIds = useGraph((s) => s.selectedIds)
  const board = useGraph((s) => s.getActiveBoard())
  const vp = board.viewport
  const [dragging, setDragging] = useState(false)

  // 折叠子树内的卡不可见 → 不作为连接源
  const hidden = new Set<string>()
  const hideDesc = (gid: string) => {
    for (const c of Object.values(board.cards)) if (c.parentId === gid) { hidden.add(c.id); if (c.kind === 'group') hideDesc(c.id) }
  }
  for (const c of Object.values(board.cards)) if (c.kind === 'group' && c.params?.collapsed) hideDesc(c.id)

  const sources = selectedIds.map((id) => board.cards[id]).filter((c) => c && c.kind !== 'group' && c.kind !== 'note' && !hidden.has(c.id))
  if (sources.length < 2) return null

  const maxX = Math.max(...sources.map((c) => c.x + c.w))
  const minY = Math.min(...sources.map((c) => c.y))
  const maxY = Math.max(...sources.map((c) => c.y + c.h))
  const midY = (minY + maxY) / 2
  const p = worldToScreen(maxX, midY, vp)
  const ids = sources.map((c) => c.id)

  const start = (e: RPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    let moved = false
    const move = (ev: PointerEvent) => {
      moved = true
      setDragging(true)
      const rect = stageEl.current?.getBoundingClientRect()
      if (!rect) return
      const b = useGraph.getState().getActiveBoard()
      const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top, b.viewport)
      useUi.getState().setConnectTemp({ x1: maxX, y1: midY, x2: w.x, y2: w.y })
    }
    const detach = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', onCancel)
      useUi.getState().setConnectTemp(null)
      setDragging(false)
    }
    const onCancel = () => detach() // 打断(触摸/笔/系统手势)：仅清理临时线与监听，不连线
    const up = (ev: PointerEvent) => {
      detach()
      if (!moved) return // 仅点一下不拉动 → 不动作
      const g = useGraph.getState()
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const targetId = (el?.closest('[data-card-id]') as HTMLElement | null)?.dataset.cardId
      if (targetId && !ids.includes(targetId) && g.getActiveBoard().cards[targetId]?.kind !== 'group') {
        g.connectAll(ids, targetId) // 连到已有节点：全部连入（一次历史）
      } else if (!targetId) {
        const rect = stageEl.current?.getBoundingClientRect()
        if (rect) {
          const sx = ev.clientX - rect.left
          const sy = ev.clientY - rect.top
          const w = screenToWorld(sx, sy, g.getActiveBoard().viewport)
          useUi.getState().setConnectMenu({ sx, sy, wx: w.x, wy: w.y, sourceIds: ids }) // 空白：新建并全部连入
        }
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      data-interactive
      onPointerDown={start}
      title={`从所选 ${ids.length} 个一起拉出连线（连到节点 / 拖到空白新建）`}
      className="absolute z-30 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-full bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg cursor-crosshair ring-2 ring-white/70"
      style={{ left: p.x + 8, top: p.y, pointerEvents: dragging ? 'none' : 'auto' }}
    >
      <Plus size={14} />
    </div>
  )
}
