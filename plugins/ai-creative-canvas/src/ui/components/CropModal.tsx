import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { Card } from '../types'
import { useEscClose } from '../hooks'

interface BoxRect {
  x: number
  y: number
  w: number
  h: number
}

export function CropModal({
  card,
  onCancel,
  onConfirm
}: {
  card: Card
  onCancel: () => void
  onConfirm: (rect: { left: number; top: number; width: number; height: number }) => void
}) {
  useEscClose(onCancel)
  const imgRef = useRef<HTMLImageElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<BoxRect | null>(null)

  const box = () => imgRef.current?.getBoundingClientRect()

  const clampPt = (clientX: number, clientY: number) => {
    const b = box()
    if (!b) return { x: 0, y: 0 }
    return {
      x: Math.min(Math.max(0, clientX - b.left), b.width),
      y: Math.min(Math.max(0, clientY - b.top), b.height)
    }
  }

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    const p = clampPt(e.clientX, e.clientY)
    start.current = p
    setRect({ x: p.x, y: p.y, w: 0, h: 0 })
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const p = clampPt(e.clientX, e.clientY)
    const s = start.current
    setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
  }
  const onUp = () => {
    start.current = null
  }

  const confirm = () => {
    const img = imgRef.current
    const b = box()
    if (!img || !b || !rect || rect.w < 3 || rect.h < 3) {
      onCancel()
      return
    }
    const scaleX = img.naturalWidth / b.width
    const scaleY = img.naturalHeight / b.height
    onConfirm({ left: rect.x * scaleX, top: rect.y * scaleY, width: rect.w * scaleX, height: rect.h * scaleY })
  }

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/70 flex flex-col items-center justify-center gap-3 p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="text-white text-sm">在图片上拖拽框选裁剪区域</div>
      <div className="relative">
        <img
          ref={imgRef}
          src={card.assetUrl || ''}
          draggable={false}
          className="max-w-[80vw] max-h-[70vh] object-contain select-none block rounded"
          alt={card.title}
        />
        <div
          className="absolute inset-0 cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {rect && (
            <div
              className="absolute border-2 border-indigo-400 bg-indigo-400/20"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            />
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="px-4 py-1.5 rounded-md bg-white/15 text-white text-sm hover:bg-white/25">
          取消
        </button>
        <button onClick={confirm} className="px-4 py-1.5 rounded-md bg-indigo-500 text-white text-sm hover:bg-indigo-600">
          确认裁剪
        </button>
      </div>
    </div>
  )
}
