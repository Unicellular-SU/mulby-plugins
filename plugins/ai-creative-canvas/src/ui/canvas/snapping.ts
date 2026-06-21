import type { Card } from '../types'

export interface SnapResult {
  dx: number
  dy: number
  vx: number[] // 对齐参考线（世界 x）
  hy: number[] // 对齐参考线（世界 y）
}

// 主拖动卡与其它卡的 边/中轴 对齐吸附 + 可选网格吸附。返回修正后的位移与参考线。
export function computeSnap(
  primary: Card,
  wdx: number,
  wdy: number,
  cards: Record<string, Card>,
  dragged: Set<string>,
  zoom: number,
  snapGrid: boolean
): SnapResult {
  const TH = 6 / Math.max(0.0001, zoom) // 屏幕 6px 对应的世界阈值
  const px = primary.x + wdx
  const py = primary.y + wdy
  const w = primary.w
  const h = primary.h
  const sV = [px, px + w / 2, px + w] // left / centerX / right
  const sH = [py, py + h / 2, py + h] // top / centerY / bottom

  let bestVD = TH
  let cdx = 0
  let vLine: number | null = null
  let bestHD = TH
  let cdy = 0
  let hLine: number | null = null

  for (const o of Object.values(cards)) {
    if (dragged.has(o.id) || o.id === primary.id) continue
    const oV = [o.x, o.x + o.w / 2, o.x + o.w]
    const oH = [o.y, o.y + o.h / 2, o.y + o.h]
    for (const s of sV) for (const t of oV) { const d = Math.abs(t - s); if (d < bestVD) { bestVD = d; cdx = t - s; vLine = t } }
    for (const s of sH) for (const t of oH) { const d = Math.abs(t - s); if (d < bestHD) { bestHD = d; cdy = t - s; hLine = t } }
  }

  // 没有卡片对齐时，回退到网格吸附
  if (snapGrid && vLine === null) {
    const G = 24
    const snapped = Math.round(px / G) * G
    if (Math.abs(snapped - px) < TH) cdx = snapped - px
  }
  if (snapGrid && hLine === null) {
    const G = 24
    const snapped = Math.round(py / G) * G
    if (Math.abs(snapped - py) < TH) cdy = snapped - py
  }

  return { dx: wdx + cdx, dy: wdy + cdy, vx: vLine !== null ? [vLine] : [], hy: hLine !== null ? [hLine] : [] }
}
