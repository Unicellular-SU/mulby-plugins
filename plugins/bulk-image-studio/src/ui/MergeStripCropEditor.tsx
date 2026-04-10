import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { MergeStripCropRatios } from '../pipeline/types'

const MIN_GAP = 0.02

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

type DragKind = 'y0' | 'y1' | 'x0' | 'x1' | 'nw' | 'ne' | 'sw' | 'se' | null

interface InnerLayout {
  x: number
  y: number
  w: number
  h: number
}

export default function MergeStripCropEditor({
  dataUrl,
  loading,
  direction,
  ratios,
  onChange,
  fileLabel,
}: {
  dataUrl: string | null
  loading: boolean
  direction: 'vertical' | 'horizontal'
  ratios: MergeStripCropRatios
  onChange: (r: MergeStripCropRatios) => void
  fileLabel: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const ratiosRef = useRef(ratios)
  const innerRef = useRef<InnerLayout>({ x: 0, y: 0, w: 0, h: 0 })
  const onChangeRef = useRef(onChange)
  const [inner, setInner] = useState<InnerLayout>({ x: 0, y: 0, w: 0, h: 0 })
  const dragRef = useRef<DragKind>(null)

  ratiosRef.current = ratios
  innerRef.current = inner
  onChangeRef.current = onChange

  const updateInner = useCallback(() => {
    const c = containerRef.current
    const img = imgRef.current
    if (!c || !img?.naturalWidth) return
    const iw = c.clientWidth
    const ih = c.clientHeight
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const scale = Math.min(iw / nw, ih / nh, 1)
    const w = nw * scale
    const h = nh * scale
    const next = { x: (iw - w) / 2, y: (ih - h) / 2, w, h }
    innerRef.current = next
    setInner(next)
  }, [])

  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    const ro = new ResizeObserver(() => updateInner())
    ro.observe(c)
    return () => ro.disconnect()
  }, [updateInner])

  useEffect(() => {
    if (!dataUrl) {
      const z = { x: 0, y: 0, w: 0, h: 0 }
      innerRef.current = z
      setInner(z)
    }
  }, [dataUrl])

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const k = dragRef.current
    if (!k || !containerRef.current) return
    e.preventDefault()
    const rect = containerRef.current.getBoundingClientRect()
    const { x, y, w, h } = innerRef.current
    if (w <= 0 || h <= 0) return
    const r = ratiosRef.current
    const oc = onChangeRef.current
    const rx = (e.clientX - rect.left - x) / w
    const ry = (e.clientY - rect.top - y) / h

    if (k === 'y0') {
      const v = clamp01(ry)
      const y0 = Math.min(v, r.y1 - MIN_GAP)
      oc({ ...r, y0: Math.max(0, y0) })
    } else if (k === 'y1') {
      const v = clamp01(ry)
      const y1 = Math.max(v, r.y0 + MIN_GAP)
      oc({ ...r, y1: Math.min(1, y1) })
    } else if (k === 'x0') {
      const v = clamp01(rx)
      const x0 = Math.min(v, r.x1 - MIN_GAP)
      oc({ ...r, x0: Math.max(0, x0) })
    } else if (k === 'x1') {
      const v = clamp01(rx)
      const x1 = Math.max(v, r.x0 + MIN_GAP)
      oc({ ...r, x1: Math.min(1, x1) })
    } else if (k === 'nw') {
      const x0 = Math.max(0, Math.min(clamp01(rx), r.x1 - MIN_GAP))
      const y0 = Math.max(0, Math.min(clamp01(ry), r.y1 - MIN_GAP))
      oc({ ...r, x0, y0 })
    } else if (k === 'ne') {
      const x1 = Math.min(1, Math.max(clamp01(rx), r.x0 + MIN_GAP))
      const y0 = Math.max(0, Math.min(clamp01(ry), r.y1 - MIN_GAP))
      oc({ ...r, x1, y0 })
    } else if (k === 'sw') {
      const x0 = Math.max(0, Math.min(clamp01(rx), r.x1 - MIN_GAP))
      const y1 = Math.min(1, Math.max(clamp01(ry), r.y0 + MIN_GAP))
      oc({ ...r, x0, y1 })
    } else if (k === 'se') {
      const x1 = Math.min(1, Math.max(clamp01(rx), r.x0 + MIN_GAP))
      const y1 = Math.min(1, Math.max(clamp01(ry), r.y0 + MIN_GAP))
      oc({ ...r, x1, y1 })
    }
  }, [])

  const handlePointerEnd = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerEnd)
    window.removeEventListener('pointercancel', handlePointerEnd)
  }, [handlePointerMove])

  const startDrag = useCallback(
    (kind: DragKind, e: React.PointerEvent) => {
      if (!kind) return
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = kind
      window.addEventListener('pointermove', handlePointerMove, { passive: false })
      window.addEventListener('pointerup', handlePointerEnd)
      window.addEventListener('pointercancel', handlePointerEnd)
    },
    [handlePointerMove, handlePointerEnd]
  )

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [handlePointerMove, handlePointerEnd])

  const midH = Math.max(0, (ratios.y1 - ratios.y0) * 100)

  return (
    <div className="merge-strip-editor">
      <p className="hint merge-strip-editor-label">
        <strong>{fileLabel}</strong>
        {' · '}
        {direction === 'vertical' ? '纵向' : '横向'}合并：拖<strong>四边</strong>或<strong>四角</strong>框选参与合并的区域
      </p>
      <div ref={containerRef} className="merge-strip-editor-canvas">
        {loading && (
          <div className="merge-strip-editor-loading">
            <Loader2 size={24} className="merge-preview-spinner" />
            <span>加载图片…</span>
          </div>
        )}
        {!loading && dataUrl && (
          <>
            <img
              ref={imgRef}
              src={dataUrl}
              alt=""
              className="merge-strip-editor-img"
              draggable={false}
              onLoad={updateInner}
            />
            {inner.w > 0 && inner.h > 0 && (
              <div
                className="merge-strip-media"
                style={{ left: inner.x, top: inner.y, width: inner.w, height: inner.h }}
              >
                <div className="merge-strip-dim merge-strip-dim-top" style={{ height: `${ratios.y0 * 100}%` }} />
                <div
                  className="merge-strip-dim merge-strip-dim-bottom"
                  style={{ left: 0, right: 0, top: `${ratios.y1 * 100}%`, bottom: 0 }}
                />
                <div
                  className="merge-strip-dim merge-strip-dim-left"
                  style={{
                    top: `${ratios.y0 * 100}%`,
                    left: 0,
                    width: `${ratios.x0 * 100}%`,
                    height: `${midH}%`,
                  }}
                />
                <div
                  className="merge-strip-dim merge-strip-dim-right"
                  style={{
                    top: `${ratios.y0 * 100}%`,
                    left: `${ratios.x1 * 100}%`,
                    right: 0,
                    height: `${midH}%`,
                  }}
                />
                <button
                  type="button"
                  className="merge-strip-line merge-strip-line-h"
                  style={{ top: `${ratios.y0 * 100}%` }}
                  aria-label="上边界"
                  onPointerDown={(e) => startDrag('y0', e)}
                />
                <button
                  type="button"
                  className="merge-strip-line merge-strip-line-h"
                  style={{ top: `${ratios.y1 * 100}%` }}
                  aria-label="下边界"
                  onPointerDown={(e) => startDrag('y1', e)}
                />
                <button
                  type="button"
                  className="merge-strip-line merge-strip-line-v"
                  style={{ left: `${ratios.x0 * 100}%` }}
                  aria-label="左边界"
                  onPointerDown={(e) => startDrag('x0', e)}
                />
                <button
                  type="button"
                  className="merge-strip-line merge-strip-line-v"
                  style={{ left: `${ratios.x1 * 100}%` }}
                  aria-label="右边界"
                  onPointerDown={(e) => startDrag('x1', e)}
                />
                <button
                  type="button"
                  className="merge-strip-corner merge-strip-corner-nw"
                  style={{ left: `${ratios.x0 * 100}%`, top: `${ratios.y0 * 100}%` }}
                  aria-label="左上角"
                  onPointerDown={(e) => startDrag('nw', e)}
                />
                <button
                  type="button"
                  className="merge-strip-corner merge-strip-corner-ne"
                  style={{ left: `${ratios.x1 * 100}%`, top: `${ratios.y0 * 100}%` }}
                  aria-label="右上角"
                  onPointerDown={(e) => startDrag('ne', e)}
                />
                <button
                  type="button"
                  className="merge-strip-corner merge-strip-corner-sw"
                  style={{ left: `${ratios.x0 * 100}%`, top: `${ratios.y1 * 100}%` }}
                  aria-label="左下角"
                  onPointerDown={(e) => startDrag('sw', e)}
                />
                <button
                  type="button"
                  className="merge-strip-corner merge-strip-corner-se"
                  style={{ left: `${ratios.x1 * 100}%`, top: `${ratios.y1 * 100}%` }}
                  aria-label="右下角"
                  onPointerDown={(e) => startDrag('se', e)}
                />
              </div>
            )}
          </>
        )}
        {!loading && !dataUrl && <div className="merge-strip-editor-empty">无图</div>}
      </div>
    </div>
  )
}
