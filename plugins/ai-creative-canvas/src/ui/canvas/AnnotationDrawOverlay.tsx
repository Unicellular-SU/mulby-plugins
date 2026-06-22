import { useEffect, useState, type PointerEvent as RPointerEvent } from 'react'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { promptDialog } from '../store/dialogStore'
import { uid } from '../util'
import { screenToWorld, worldToScreen } from './viewport'
import { stageEl } from './stageEl'
import { renderAnnotation } from './AnnotationLayer'
import type { Annotation } from '../types'

// 仅在选中标注工具时挂载并捕获指针（覆盖在卡片层之上）；草稿用屏幕坐标预览，提交存世界坐标
export function AnnotationDrawOverlay() {
  const tool = useUi((s) => s.annotTool)
  const color = useUi((s) => s.annotColor)
  const board = useGraph((s) => s.getActiveBoard())
  const [draft, setDraft] = useState<Annotation | null>(null)
  useEffect(() => {
    if (!tool) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.getState().setAnnotTool(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tool])
  if (!tool) return null
  const vp = board.viewport

  const toWorld = (cx: number, cy: number) => {
    const r = stageEl.current?.getBoundingClientRect()
    return screenToWorld(cx - (r?.left || 0), cy - (r?.top || 0), vp)
  }

  const onDown = (e: RPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const w = toWorld(e.clientX, e.clientY)
    if (tool === 'text') {
      void promptDialog({ title: '文字标注', message: '输入文字' }).then((t) => {
        if (t) useGraph.getState().addAnnotation({ id: uid('an'), kind: 'text', color, points: [w], text: t })
      })
      return
    }
    const start: Annotation = { id: uid('an'), kind: tool, color, points: tool === 'pen' ? [w] : [w, w] }
    setDraft(start)
    const move = (ev: PointerEvent) => {
      const p = toWorld(ev.clientX, ev.clientY)
      setDraft((d) => {
        if (!d) return d
        if (d.kind === 'pen') return { ...d, points: [...d.points, p] }
        return { ...d, points: [d.points[0], p] }
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft((d) => {
        if (d) {
          const ok =
            d.kind === 'pen'
              ? d.points.length > 1
              : Math.hypot(d.points[1].x - d.points[0].x, d.points[1].y - d.points[0].y) > 3
          if (ok) useGraph.getState().addAnnotation(d)
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div data-interactive className="absolute inset-0 cursor-crosshair" onPointerDown={onDown}>
      {draft && (
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
          {renderAnnotation(draft, (p) => worldToScreen(p.x, p.y, vp))}
        </svg>
      )}
    </div>
  )
}
