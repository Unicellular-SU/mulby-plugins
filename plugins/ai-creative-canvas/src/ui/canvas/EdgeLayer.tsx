import { useState, type PointerEvent as RPointerEvent } from 'react'
import type { Board } from '../types'
import { useGraph } from '../store/graphStore'
import { worldToScreen } from './viewport'

interface TempEdge {
  x1: number
  y1: number
  x2: number
  y2: number
} // 世界坐标

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(30, Math.abs(x2 - x1) / 2)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

// 屏幕坐标 SVG（铺满舞台，随视口换算）。放在卡片层之下。
export function EdgeLayer({ board, temp, hidden }: { board: Board; temp?: TempEdge | null; hidden?: Set<string> }) {
  const removeEdge = useGraph((s) => s.removeEdge)
  const [hover, setHover] = useState<string | null>(null)
  const cards = board.cards
  const vp = board.viewport

  return (
    <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', overflow: 'visible' }}>
      {Object.values(board.edges).map((e) => {
        const s = cards[e.source]
        const t = cards[e.target]
        if (!s || !t) return null
        if (hidden && (hidden.has(e.source) || hidden.has(e.target))) return null // 折叠组内的连线随之隐藏
        const a = worldToScreen(s.x + s.w, s.y + s.h / 2, vp)
        const b = worldToScreen(t.x, t.y + t.h / 2, vp)
        const d = bezier(a.x, a.y, b.x, b.y)
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        const hovered = hover === e.id
        const onDel = (ev: RPointerEvent<SVGElement>) => {
          ev.stopPropagation()
          removeEdge(e.id)
          setHover(null)
        }
        return (
          <g key={e.id} onMouseEnter={() => setHover(e.id)} onMouseLeave={() => setHover((h) => (h === e.id ? null : h))}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onPointerDown={onDel} />
            <path d={d} className={`ace-edge ${hovered ? 'ace-edge-hover' : ''}`} fill="none" />
            {hovered && (
              <g style={{ pointerEvents: 'all', cursor: 'pointer' }} onPointerDown={onDel}>
                <circle cx={mid.x} cy={mid.y} r={8} className="ace-edge-del-bg" />
                <line x1={mid.x - 3.5} y1={mid.y - 3.5} x2={mid.x + 3.5} y2={mid.y + 3.5} className="ace-edge-del-x" />
                <line x1={mid.x + 3.5} y1={mid.y - 3.5} x2={mid.x - 3.5} y2={mid.y + 3.5} className="ace-edge-del-x" />
              </g>
            )}
          </g>
        )
      })}
      {temp && (() => {
        const a = worldToScreen(temp.x1, temp.y1, vp)
        const b = worldToScreen(temp.x2, temp.y2, vp)
        return <path d={bezier(a.x, a.y, b.x, b.y)} className="ace-edge ace-edge-temp" fill="none" />
      })()}
    </svg>
  )
}
