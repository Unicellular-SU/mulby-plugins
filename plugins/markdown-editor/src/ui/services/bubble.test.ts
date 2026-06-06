import assert from 'node:assert/strict'
import { computeBubblePosition, isVisibleRect, type BubbleRect } from './bubble'

const viewport = { width: 1000, height: 800 }

function rect(partial: Partial<BubbleRect>): BubbleRect {
  const left = partial.left ?? 0
  const top = partial.top ?? 0
  const width = partial.width ?? 0
  const height = partial.height ?? 0
  return {
    left,
    top,
    width,
    height,
    right: partial.right ?? left + width,
    bottom: partial.bottom ?? top + height
  }
}

// Plenty of room above -> placed above, horizontally centered on the selection.
{
  const anchor = rect({ left: 400, top: 300, width: 200, height: 20 })
  const pos = computeBubblePosition(anchor, { width: 240, height: 40 }, viewport)
  assert.equal(pos.placement, 'top')
  // center 500 -> left = 500 - 120 = 380
  assert.equal(pos.left, 380)
  // top = 300 - 8 - 40 = 252
  assert.equal(pos.top, 252)
}

// Not enough room above -> flips below the selection.
{
  const anchor = rect({ left: 400, top: 10, width: 100, height: 20 })
  const pos = computeBubblePosition(anchor, { width: 200, height: 60 }, viewport)
  assert.equal(pos.placement, 'bottom')
  // bottom = 30, top = 30 + 8 = 38
  assert.equal(pos.top, 38)
}

// Selection near the left edge -> clamped to the left margin.
{
  const anchor = rect({ left: 0, top: 400, width: 30, height: 20 })
  const pos = computeBubblePosition(anchor, { width: 240, height: 40 }, viewport, { margin: 8 })
  assert.equal(pos.left, 8)
}

// Selection near the right edge -> clamped so the bubble stays in view.
{
  const anchor = rect({ left: 980, top: 400, width: 20, height: 20 })
  const pos = computeBubblePosition(anchor, { width: 240, height: 40 }, viewport, { margin: 8 })
  // maxLeft = 1000 - 240 - 8 = 752
  assert.equal(pos.left, 752)
}

// Neither side fully fits -> picks the side with more room (here: below).
{
  const tall = { width: 200, height: 700 }
  const anchor = rect({ left: 400, top: 300, width: 100, height: 20 })
  const pos = computeBubblePosition(anchor, tall, viewport)
  // spaceAbove = 300 - 8 = 292, spaceBelow = 800 - 320 - 8 = 472 -> below
  assert.equal(pos.placement, 'bottom')
  // top clamped so it never leaves the viewport: maxTop = 800 - 700 - 8 = 92
  assert.equal(pos.top, 92)
}

// Custom gap is honored.
{
  const anchor = rect({ left: 400, top: 300, width: 100, height: 20 })
  const pos = computeBubblePosition(anchor, { width: 100, height: 40 }, viewport, { gap: 16 })
  // top = 300 - 16 - 40 = 244
  assert.equal(pos.top, 244)
}

// isVisibleRect: empty rects are not visible.
assert.equal(isVisibleRect({ width: 0, height: 0 }), false)
assert.equal(isVisibleRect(null), false)
assert.equal(isVisibleRect({ width: 10, height: 0 }), true)
assert.equal(isVisibleRect({ width: 0, height: 4 }), true)

console.log('markdown-editor bubble unit tests passed')
