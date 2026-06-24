import type { Card, Viewport } from '../types'

// 世界→屏幕：screen = world * zoom + (x, y)
export function worldToScreen(wx: number, wy: number, v: Viewport) {
  return { x: wx * v.zoom + v.x, y: wy * v.zoom + v.y }
}

// 屏幕→世界
export function screenToWorld(sx: number, sy: number, v: Viewport) {
  return { x: (sx - v.x) / v.zoom, y: (sy - v.y) / v.zoom }
}

export const ZOOM_MIN = 0.1
export const ZOOM_MAX = 4

export function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

// 朝光标(sx,sy 为相对舞台的屏幕坐标)缩放：保持光标处世界点不动
export function zoomAt(v: Viewport, sx: number, sy: number, factor: number): Viewport {
  const zoom = clampZoom(v.zoom * factor)
  const wx = (sx - v.x) / v.zoom
  const wy = (sy - v.y) / v.zoom
  return { zoom, x: sx - wx * zoom, y: sy - wy * zoom }
}

// 适配内容：根据所有卡片 bbox 计算居中缩放（容器尺寸 vw/vh）
export function fitToCards(cards: Card[], vw: number, vh: number, padding = 80): Viewport {
  if (cards.length === 0) return { x: vw / 2, y: vh / 2, zoom: 1 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of cards) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + c.w)
    maxY = Math.max(maxY, c.y + c.h)
  }
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)
  const zoom = clampZoom(Math.min((vw - padding * 2) / bw, (vh - padding * 2) / bh, ZOOM_MAX))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { zoom, x: vw / 2 - cx * zoom, y: vh / 2 - cy * zoom }
}

// 当前可见的世界矩形（视口剔除用）。marginPx 为屏幕像素外扩量，用于平移时预渲染、减少入场弹跳。
export function worldViewRect(v: Viewport, vw: number, vh: number, marginPx = 0) {
  return {
    x: (-v.x - marginPx) / v.zoom,
    y: (-v.y - marginPx) / v.zoom,
    w: (vw + marginPx * 2) / v.zoom,
    h: (vh + marginPx * 2) / v.zoom
  }
}

// 矩形相交（世界坐标）
export function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
