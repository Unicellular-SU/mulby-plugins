import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

// 无边框浮窗的自绘拖动 + 缩放（复用宿主 window.setBounds / resizeDrag），
// 与截图标注窗口同款机制，供独立「问 AI」窗口使用。

export type ResizeEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left'

export const RESIZE_EDGES: ResizeEdge[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left'
]

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface FloatingWindowApi {
  getBounds: () => Promise<Bounds>
  setBounds: (bounds: Bounds) => void | Promise<void>
  resizeDrag: (payload: {
    edge: ResizeEdge
    startX: number
    startY: number
    currentX: number
    currentY: number
    baseBounds: Bounds
  }) => void
}

function readBounds(win?: FloatingWindowApi): Promise<Bounds> {
  const fallback: Bounds = {
    x: window.screenX,
    y: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight
  }
  if (!win?.getBounds) return Promise.resolve(fallback)
  return win.getBounds().then((b) => b ?? fallback).catch(() => fallback)
}

export interface FloatingWindowOptions {
  /** 用户手动缩放窗口时回调（例如停止高度自适应）。 */
  onManualResize?: () => void
  /** 拖动时命中这些选择器的元素不触发拖动，默认 'button, input, textarea, select, a'。 */
  dragExcludeSelector?: string
  /** 为 true 时禁止开始拖动/缩放（例如忙碌状态）。 */
  disabled?: boolean
}

const DEFAULT_DRAG_EXCLUDE_SELECTOR = 'button, input, textarea, select, a'

export function useFloatingWindow(win: FloatingWindowApi | undefined, options?: FloatingWindowOptions) {
  const onManualResize = options?.onManualResize
  const dragExcludeSelector = options?.dragExcludeSelector ?? DEFAULT_DRAG_EXCLUDE_SELECTOR
  const disabled = options?.disabled ?? false
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    currentX: number
    currentY: number
    base: Bounds
    rafId: number
  } | null>(null)
  const resizeRef = useRef<{
    edge: ResizeEdge
    pointerId: number
    startX: number
    startY: number
    currentX: number
    currentY: number
    base: Bounds
    rafId: number
  } | null>(null)

  // 卸载时取消未执行的 rAF，避免窗口关闭后仍回调 setBounds/resizeDrag。
  useEffect(() => () => {
    if (dragRef.current?.rafId) {
      cancelAnimationFrame(dragRef.current.rafId)
    }
    if (resizeRef.current?.rafId) {
      cancelAnimationFrame(resizeRef.current.rafId)
    }
  }, [])

  // ── 拖动（标题区）─────────────────────────────────────────
  const flushDrag = useCallback(() => {
    const state = dragRef.current
    if (!state || !win) return
    state.rafId = 0
    void win.setBounds({
      x: state.base.x + state.currentX - state.startX,
      y: state.base.y + state.currentY - state.startY,
      width: state.base.width,
      height: state.base.height
    })
  }, [win])

  const onDragPointerDown = useCallback(
    async (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || disabled) return
      if (event.target instanceof Element && event.target.closest(dragExcludeSelector)) {
        return
      }
      event.preventDefault()
      const target = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.screenX
      const startY = event.screenY
      const base = await readBounds(win)
      dragRef.current = { pointerId, startX, startY, currentX: startX, currentY: startY, base, rafId: 0 }
      try {
        target.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
    },
    [disabled, dragExcludeSelector, win]
  )

  const onDragPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragRef.current
      if (!state || state.pointerId !== event.pointerId) return
      event.preventDefault()
      state.currentX = event.screenX
      state.currentY = event.screenY
      if (!state.rafId) state.rafId = requestAnimationFrame(flushDrag)
    },
    [flushDrag]
  )

  const onDragPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragRef.current
      if (!state || state.pointerId !== event.pointerId) return
      event.preventDefault()
      if (state.rafId) {
        cancelAnimationFrame(state.rafId)
        state.rafId = 0
      }
      void win?.setBounds({
        x: state.base.x + state.currentX - state.startX,
        y: state.base.y + state.currentY - state.startY,
        width: state.base.width,
        height: state.base.height
      })
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      dragRef.current = null
    },
    [win]
  )

  // ── 缩放（边/角手柄）──────────────────────────────────────
  const flushResize = useCallback(() => {
    const state = resizeRef.current
    if (!state || !win) return
    state.rafId = 0
    win.resizeDrag({
      edge: state.edge,
      startX: state.startX,
      startY: state.startY,
      currentX: state.currentX,
      currentY: state.currentY,
      baseBounds: state.base
    })
  }, [win])

  const onResizePointerDown = useCallback(
    async (edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) return
      event.preventDefault()
      event.stopPropagation()
      onManualResize?.()
      const target = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.screenX
      const startY = event.screenY
      const base = await readBounds(win)
      resizeRef.current = { edge, pointerId, startX, startY, currentX: startX, currentY: startY, base, rafId: 0 }
      try {
        target.setPointerCapture(pointerId)
      } catch {
        /* ignore */
      }
    },
    [disabled, onManualResize, win]
  )

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = resizeRef.current
      if (!state || state.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      state.currentX = event.screenX
      state.currentY = event.screenY
      if (!state.rafId) state.rafId = requestAnimationFrame(flushResize)
    },
    [flushResize]
  )

  const onResizePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = resizeRef.current
      if (!state || state.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopPropagation()
      if (state.rafId) {
        cancelAnimationFrame(state.rafId)
        state.rafId = 0
      }
      win?.resizeDrag({
        edge: state.edge,
        startX: state.startX,
        startY: state.startY,
        currentX: state.currentX,
        currentY: state.currentY,
        baseBounds: state.base
      })
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* ignore */
      }
      resizeRef.current = null
    },
    [win]
  )

  return {
    dragHandlers: {
      onPointerDown: onDragPointerDown,
      onPointerMove: onDragPointerMove,
      onPointerUp: onDragPointerUp,
      onPointerCancel: onDragPointerUp
    },
    getResizeHandlers: (edge: ResizeEdge) => ({
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void onResizePointerDown(edge, event),
      onPointerMove: onResizePointerMove,
      onPointerUp: onResizePointerUp,
      onPointerCancel: onResizePointerUp
    })
  }
}
