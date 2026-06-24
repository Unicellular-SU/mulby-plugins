import { useEffect, useRef, type MouseEvent as RMouseEvent } from 'react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { KIND_ACCENT } from '../types'

const MW = 180
const MH = 120

export function Minimap() {
  const board = useGraph((s) => s.getActiveBoard())
  const setViewport = useGraph((s) => s.setViewport)
  const stageSize = useUi((s) => s.stageSize)
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

  // 画布绘制卡片块：仅卡片或布局(min/scale)变化时重绘——平移期布局稳定即跳过，承载万级不卡。
  const cardsRef = board.cards
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = MW * dpr
    cv.height = MH * dpr
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, MW, MH)
    for (const c of Object.values(cardsRef)) {
      const p = toMini(c.x, c.y)
      ctx.fillStyle = (KIND_ACCENT[c.kind] || '#888888') + '99'
      ctx.fillRect(p.x, p.y, Math.max(1.5, c.w * scale), Math.max(1.5, c.h * scale))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsRef, minX, minY, scale, ox, oy])

  const onClick = (e: RMouseEvent<HTMLCanvasElement>) => {
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
      <canvas ref={canvasRef} width={MW} height={MH} style={{ width: MW, height: MH }} onClick={onClick} className="cursor-pointer block" />
      <div
        className="absolute pointer-events-none rounded-[2px]"
        style={{
          left: a.x,
          top: a.y,
          width: Math.max(6, b.x - a.x),
          height: Math.max(6, b.y - a.y),
          border: '1.5px solid var(--accent)',
          background: 'color-mix(in srgb, var(--accent) 12%, transparent)'
        }}
      />
    </div>
  )
}
