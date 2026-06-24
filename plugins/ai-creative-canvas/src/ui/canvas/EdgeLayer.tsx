import { useState, type PointerEvent as RPointerEvent } from 'react'
import type { Board } from '../types'
import { useGraph } from '../store/graphStore'
import { worldToScreen, rectsIntersect } from './viewport'

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
export function EdgeLayer({ board, temp, selected, cull, edgeIds }: { board: Board; temp?: TempEdge | null; selected?: Set<string>; cull?: { x: number; y: number; w: number; h: number } | null; edgeIds?: string[] | null }) {
  const removeEdge = useGraph((s) => s.removeEdge)
  const [hover, setHover] = useState<string | null>(null)
  const cards = board.cards
  const vp = board.viewport
  // 虚拟化时 edgeIds 为空间索引查到的可见连线子集（O(可见)）；否则遍历全量
  const edgeList = edgeIds ? edgeIds.map((id) => board.edges[id]).filter(Boolean) : Object.values(board.edges)

  // 折叠组：把落在折叠子树内的端点改接到「最外层折叠组」的边框，
  // 于是跨界的进/出连线各保留一根（同向去重），组内连线隐藏。
  const anchorOf = (id: string): string => {
    let p = cards[id]?.parentId ?? null
    let top: string | null = null
    while (p) {
      const pc = cards[p]
      if (!pc) break
      if (pc.kind === 'group' && (pc.params as Record<string, unknown>)?.collapsed) top = p
      p = pc.parentId
    }
    return top ?? id
  }

  const seen = new Set<string>()

  return (
    <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none', overflow: 'visible' }}>
      {edgeList.map((e) => {
        const sa = anchorOf(e.source)
        const ta = anchorOf(e.target)
        if (sa === ta) return null // 组内连线，折叠后隐藏
        const key = sa + '>' + ta
        if (seen.has(key)) return null // 跨界线同向去重为一根
        seen.add(key)
        const s = cards[sa]
        const t = cards[ta]
        if (!s || !t) return null
        // 视口剔除：两端锚点的包围盒（略外扩，避免水平/垂直线零尺寸漏判）不相交可见区则跳过
        if (cull) {
          const ax = s.x + s.w
          const ay = s.y + s.h / 2
          const bx = t.x
          const by = t.y + t.h / 2
          const ebox = { x: Math.min(ax, bx) - 2, y: Math.min(ay, by) - 2, w: Math.abs(bx - ax) + 4, h: Math.abs(by - ay) + 4 }
          if (!rectsIntersect(cull, ebox)) return null
        }
        const active = !!selected && (selected.has(e.source) || selected.has(e.target)) // 端点被选中 → 关联高亮
        const rerouted = sa !== e.source || ta !== e.target
        const a = worldToScreen(s.x + s.w, s.y + s.h / 2, vp)
        const b = worldToScreen(t.x, t.y + t.h / 2, vp)
        const d = bezier(a.x, a.y, b.x, b.y)

        // 跨界聚合线：接到折叠组边框，不可删（删除请展开组）
        if (rerouted) {
          return <path key={key} d={d} className={`ace-edge ${active ? 'ace-edge-active' : ''}`} fill="none" style={{ pointerEvents: 'none', opacity: 0.75 }} />
        }

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
            <path d={d} className={`ace-edge ${hovered ? 'ace-edge-hover' : active ? 'ace-edge-active' : ''}`} fill="none" />
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
      {temp &&
        (() => {
          const a = worldToScreen(temp.x1, temp.y1, vp)
          const b = worldToScreen(temp.x2, temp.y2, vp)
          return <path d={bezier(a.x, a.y, b.x, b.y)} className="ace-edge ace-edge-temp" fill="none" />
        })()}
    </svg>
  )
}
