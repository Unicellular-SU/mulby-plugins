import type { MouseEvent as RMouseEvent } from 'react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'

const MW = 180
const MH = 120

export function Minimap() {
  const board = useGraph((s) => s.getActiveBoard())
  const setViewport = useGraph((s) => s.setViewport)
  const stageSize = useUi((s) => s.stageSize)

  const cards = Object.values(board.cards)
  const v = board.viewport

  // 当前可视世界矩形
  const vx0 = (0 - v.x) / v.zoom
  const vy0 = (0 - v.y) / v.zoom
  const vx1 = (stageSize.w - v.x) / v.zoom
  const vy1 = (stageSize.h - v.y) / v.zoom

  let minX = vx0
  let minY = vy0
  let maxX = vx1
  let maxY = vy1
  for (const c of cards) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + c.w)
    maxY = Math.max(maxY, c.y + c.h)
  }

  const cw = Math.max(1, maxX - minX)
  const ch = Math.max(1, maxY - minY)
  const scale = Math.min((MW - 8) / cw, (MH - 8) / ch)
  const ox = (MW - cw * scale) / 2
  const oy = (MH - ch * scale) / 2
  const toMini = (wx: number, wy: number) => ({ x: ox + (wx - minX) * scale, y: oy + (wy - minY) * scale })

  const onClick = (e: RMouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const wx = minX + (mx - ox) / scale
    const wy = minY + (my - oy) / scale
    setViewport({ ...v, x: stageSize.w / 2 - wx * v.zoom, y: stageSize.h / 2 - wy * v.zoom })
  }

  const a = toMini(vx0, vy0)
  const b = toMini(vx1, vy1)

  return (
    <div
      data-interactive
      className="absolute bottom-3 right-3 rounded-lg border bg-white/85 dark:bg-neutral-900/85 backdrop-blur shadow-md overflow-hidden"
      style={{ width: MW, height: MH, borderColor: 'var(--ace-border)' }}
    >
      <svg width={MW} height={MH} onClick={onClick} className="cursor-pointer block">
        {cards.map((c) => {
          const p = toMini(c.x, c.y)
          return (
            <rect
              key={c.id}
              x={p.x}
              y={p.y}
              width={Math.max(2, c.w * scale)}
              height={Math.max(2, c.h * scale)}
              rx={2}
              className="ace-mini-card"
            />
          )
        })}
        <rect x={a.x} y={a.y} width={Math.max(6, b.x - a.x)} height={Math.max(6, b.y - a.y)} className="ace-mini-view" />
      </svg>
    </div>
  )
}
