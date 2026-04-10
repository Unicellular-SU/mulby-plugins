/**
 * 控制点与几何工具
 * 参考: idootop/reactflow-auto-layout/src/layout/edge/point.ts
 */
import { Position } from '@xyflow/react'

// ============ 类型定义 ============

let _uid = 0
/** 生成唯一 ID */
export function uid(): string {
  return `cp_${++_uid}_${Date.now()}`
}

export interface ControlPoint {
  id: string
  x: number
  y: number
}

export interface NodeRect {
  x: number  // left
  y: number  // top
  width: number
  height: number
}

export interface HandlePosition extends ControlPoint {
  position: Position
}

// ============ 矩形工具 ============

/** 获取矩形的四边坐标 */
export function getRectSides(box: NodeRect) {
  const { x: left, y: top, width, height } = box
  return { top, right: left + width, bottom: top + height, left }
}

/** 获取矩形的四个顶点 */
export function getRectVertices(box: NodeRect): ControlPoint[] {
  const { top, right, bottom, left } = getRectSides(box)
  return [
    { id: uid(), x: left, y: top },
    { id: uid(), x: right, y: top },
    { id: uid(), x: right, y: bottom },
    { id: uid(), x: left, y: bottom },
  ]
}

/** 膨胀矩形（向外扩展 offset） */
export function getExpandedRect(rect: NodeRect, offset: number): NodeRect {
  return {
    x: rect.x - offset,
    y: rect.y - offset,
    width: rect.width + 2 * offset,
    height: rect.height + 2 * offset,
  }
}

/** 点是否在矩形内 */
export function isPointInRect(p: ControlPoint, box: NodeRect): boolean {
  const s = getRectSides(box)
  return p.x >= s.left && p.x <= s.right && p.y >= s.top && p.y <= s.bottom
}

/** 从一组点获取边界 */
export function getSidesFromPoints(points: ControlPoint[]) {
  return {
    left: Math.min(...points.map(p => p.x)),
    right: Math.max(...points.map(p => p.x)),
    top: Math.min(...points.map(p => p.y)),
    bottom: Math.max(...points.map(p => p.y)),
  }
}

// ============ 控制点计算 ============

/** 根据 handle 方向获取偏移后的控制点 */
export function getOffsetPoint(handle: HandlePosition, offset: number): ControlPoint {
  switch (handle.position) {
    case Position.Top: return { id: uid(), x: handle.x, y: handle.y - offset }
    case Position.Bottom: return { id: uid(), x: handle.x, y: handle.y + offset }
    case Position.Left: return { id: uid(), x: handle.x - offset, y: handle.y }
    case Position.Right: return { id: uid(), x: handle.x + offset, y: handle.y }
  }
}

/** 获取矩形和外部顶点形成的包围矩形的四个顶点 */
export function getVerticesFromRectVertex(box: NodeRect, vertex: ControlPoint): ControlPoint[] {
  const points = [vertex, ...getRectVertices(box)]
  const { top, right, bottom, left } = getSidesFromPoints(points)
  return [
    { id: uid(), x: left, y: top },
    { id: uid(), x: right, y: top },
    { id: uid(), x: right, y: bottom },
    { id: uid(), x: left, y: bottom },
  ]
}

/** 获取两个矩形之间的潜在中点和交点 */
export function getCenterPoints(params: {
  source: NodeRect
  target: NodeRect
  sourceOffset: ControlPoint
  targetOffset: ControlPoint
}): ControlPoint[] {
  const { source, target, sourceOffset, targetOffset } = params
  if (sourceOffset.x === targetOffset.x || sourceOffset.y === targetOffset.y) return []

  const vertices = [...getRectVertices(source), ...getRectVertices(target)]
  const outerSides = getSidesFromPoints(vertices)
  const { left, right, top, bottom } = getSidesFromPoints([sourceOffset, targetOffset])
  const cx = (left + right) / 2
  const cy = (top + bottom) / 2

  return [
    { id: uid(), x: cx, y: top },
    { id: uid(), x: right, y: cy },
    { id: uid(), x: cx, y: bottom },
    { id: uid(), x: left, y: cy },
    { id: uid(), x: cx, y: outerSides.top },
    { id: uid(), x: outerSides.right, y: cy },
    { id: uid(), x: cx, y: outerSides.bottom },
    { id: uid(), x: outerSides.left, y: cy },
  ].filter(p => !isPointInRect(p, source) && !isPointInRect(p, target))
}

// ============ 线段工具 ============

export function isEqualPoint(p1: ControlPoint, p2: ControlPoint) {
  return p1.x === p2.x && p1.y === p2.y
}

/** 点是否在线段上（加 1.5px 容差处理浮点精度） */
export function isInLine(p: ControlPoint, p1: ControlPoint, p2: ControlPoint): boolean {
  const TOLERANCE = 1.5
  const [xMin, xMax] = p1.x < p2.x ? [p1.x, p2.x] : [p2.x, p1.x]
  const [yMin, yMax] = p1.y < p2.y ? [p1.y, p2.y] : [p2.y, p1.y]
  
  const isHorizLine = Math.abs(p1.y - p2.y) < TOLERANCE && Math.abs(p.y - p1.y) < TOLERANCE
  const isVertLine = Math.abs(p1.x - p2.x) < TOLERANCE && Math.abs(p.x - p1.x) < TOLERANCE
  
  return (
    (isVertLine && p.y >= yMin - TOLERANCE && p.y <= yMax + TOLERANCE) ||
    (isHorizLine && p.x >= xMin - TOLERANCE && p.x <= xMax + TOLERANCE)
  )
}

/** 点是否在直线上（不限于线段范围） */
export function isOnLine(p: ControlPoint, p1: ControlPoint, p2: ControlPoint): boolean {
  return (p1.x === p.x && p.x === p2.x) || (p1.y === p.y && p.y === p2.y)
}

/** 两条线段是否相交 */
function isSegmentsIntersected(
  p0: ControlPoint, p1: ControlPoint,
  p2: ControlPoint, p3: ControlPoint,
): boolean {
  const s1x = p1.x - p0.x, s1y = p1.y - p0.y
  const s2x = p3.x - p2.x, s2y = p3.y - p2.y
  const denom = -s2x * s1y + s1x * s2y
  if (denom === 0) return false
  const s = (s1y * (p2.x - p0.x) - s1x * (p2.y - p0.y)) / denom
  const t = (s2x * (p0.y - p2.y) - s2y * (p0.x - p2.x)) / denom
  return s >= 0 && s <= 1 && t >= 0 && t <= 1
}

/** 线段是否与矩形相交 */
export function isSegmentCrossingRect(p1: ControlPoint, p2: ControlPoint, box: NodeRect): boolean {
  if (box.width === 0 && box.height === 0) return false
  const [tl, tr, br, bl] = getRectVertices(box)
  return (
    isSegmentsIntersected(p1, p2, tl, tr) ||
    isSegmentsIntersected(p1, p2, tr, br) ||
    isSegmentsIntersected(p1, p2, br, bl) ||
    isSegmentsIntersected(p1, p2, bl, tl)
  )
}

// ============ 点集优化 ============

/** 合并相近坐标的点 */
export function mergeClosePoints(points: ControlPoint[], threshold = 4): ControlPoint[] {
  const positions = { x: [] as number[], y: [] as number[] }
  const findPos = (axis: 'x' | 'y', v: number) => {
    v = Math.floor(v)
    const ps = positions[axis]
    let p = ps.find(e => Math.abs(v - e) < threshold)
    if (p == null) { p = v; ps.push(v) }
    return p
  }
  return points.map(p => ({ ...p, x: findPos('x', p.x), y: findPos('y', p.y) }))
}

/** 移除重复点（保留首尾） */
export function removeRepeatPoints(points: ControlPoint[]): ControlPoint[] {
  const lastP = points[points.length - 1]
  const seen = new Set([`${lastP.x}-${lastP.y}`])
  const result: ControlPoint[] = []
  points.forEach((p, i) => {
    if (i === points.length - 1) return result.push(p)
    const key = `${p.x}-${p.y}`
    if (!seen.has(key)) { seen.add(key); result.push(p) }
  })
  return result
}

/** 减少控制点：移除共线的中间点 */
export function reducePoints(points: ControlPoint[]): ControlPoint[] {
  const result = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    if (!isInLine(points[i], points[i - 1], points[i + 1])) {
      result.push(points[i])
    }
  }
  result.push(points[points.length - 1])
  return result
}

/** 优化输入控制点 */
export function optimizeInputPoints(p: {
  edgePoints: ControlPoint[]
  source: HandlePosition
  target: HandlePosition
  sourceOffset: ControlPoint
  targetOffset: ControlPoint
}) {
  const isHoriz = (pos: Position) => pos === Position.Left || pos === Position.Right
  let edgePoints = mergeClosePoints([
    p.source, p.sourceOffset, ...p.edgePoints, p.targetOffset, p.target,
  ])
  const source = edgePoints.shift()!
  const target = edgePoints.pop()!
  const sourceOffset = edgePoints[0]
  const targetOffset = edgePoints[edgePoints.length - 1]

  // 修正 source/target 坐标
  if (isHoriz(p.source.position)) { source.x = p.source.x } else { source.y = p.source.y }
  if (isHoriz(p.target.position)) { target.x = p.target.x } else { target.y = p.target.y }

  edgePoints = removeRepeatPoints(edgePoints).map((pt, i) => ({ ...pt, id: `${i + 1}` }))
  return { source, target, sourceOffset, targetOffset, edgePoints }
}
