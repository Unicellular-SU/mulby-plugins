// Positioning helpers for the floating AI selection toolbar (bubble).
//
// The bubble anchors to the current text selection. These pure helpers compute
// where to place a fixed-position element relative to the selection rectangle,
// preferring to float above the selection and flipping below when there is not
// enough room, while always clamping the box inside the viewport. Keeping the
// math here (instead of inline in the component) makes it unit-testable.

export interface BubbleRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface BubbleSize {
  width: number
  height: number
}

export interface BubbleViewport {
  width: number
  height: number
}

export type BubblePlacement = 'top' | 'bottom'

export interface BubblePosition {
  left: number
  top: number
  placement: BubblePlacement
}

export interface ComputeBubbleOptions {
  /** Gap between the selection edge and the bubble (px). */
  gap?: number
  /** Minimum distance kept from each viewport edge (px). */
  margin?: number
}

/**
 * Computes the top-left position (in viewport coordinates) for a bubble of the
 * given size anchored to a selection rectangle. Horizontally the bubble is
 * centered on the selection and clamped into the viewport; vertically it prefers
 * the space above the selection and falls back to below, picking the roomier
 * side when neither fully fits.
 */
export function computeBubblePosition(
  anchor: BubbleRect,
  size: BubbleSize,
  viewport: BubbleViewport,
  options: ComputeBubbleOptions = {}
): BubblePosition {
  const gap = options.gap ?? 8
  const margin = options.margin ?? 8

  const anchorCenterX = anchor.left + anchor.width / 2
  const maxLeft = Math.max(margin, viewport.width - size.width - margin)
  const left = clamp(anchorCenterX - size.width / 2, margin, maxLeft)

  const spaceAbove = anchor.top - margin
  const spaceBelow = viewport.height - anchor.bottom - margin

  let placement: BubblePlacement
  if (spaceAbove >= size.height + gap) {
    placement = 'top'
  } else if (spaceBelow >= size.height + gap) {
    placement = 'bottom'
  } else {
    placement = spaceAbove >= spaceBelow ? 'top' : 'bottom'
  }

  const rawTop = placement === 'top' ? anchor.top - gap - size.height : anchor.bottom + gap
  const maxTop = Math.max(margin, viewport.height - size.height - margin)
  const top = clamp(rawTop, margin, maxTop)

  return { left, top, placement }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }
  return Math.min(Math.max(value, min), max)
}

/** Whether a DOM-like rect is non-empty (a real, visible selection). */
export function isVisibleRect(rect: { width: number; height: number } | null | undefined): boolean {
  return !!rect && (rect.width > 0 || rect.height > 0)
}
