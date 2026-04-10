/**
 * 边的 SVG 路径工具：圆角折线渲染 + 方向判断
 * 参考: idootop/reactflow-auto-layout/src/layout/edge/edge.ts
 */
import { Position } from '@xyflow/react'
import type { ControlPoint, HandlePosition } from './point'

// ============ 方向判断 ============

export function isHorizontalFromPosition(position: Position): boolean {
  return position === Position.Left || position === Position.Right
}

/** 两条线段方向相同（都朝上或都朝下等） */
export function areLinesSameDirection(
  p1: ControlPoint, p2: ControlPoint,
  p3: ControlPoint, p4: ControlPoint,
): boolean {
  return (
    (p1.x === p2.x && p3.x === p4.x && (p1.y - p2.y) * (p3.y - p4.y) > 0) ||
    (p1.y === p2.y && p3.y === p4.y && (p1.x - p2.x) * (p3.x - p4.x) > 0)
  )
}

/** 两条线段方向相反 */
export function areLinesReverseDirection(
  p1: ControlPoint, p2: ControlPoint,
  p3: ControlPoint, p4: ControlPoint,
): boolean {
  return (
    (p1.x === p2.x && p3.x === p4.x && (p1.y - p2.y) * (p3.y - p4.y) < 0) ||
    (p1.y === p2.y && p3.y === p4.y && (p1.x - p2.x) * (p3.x - p4.x) < 0)
  )
}

/** 两条线段是否垂直 */
export function areLinesPerpendicular(
  p1: ControlPoint, p2: ControlPoint,
  p3: ControlPoint, p4: ControlPoint,
): boolean {
  return (p1.x === p2.x && p3.y === p4.y) || (p1.y === p2.y && p3.x === p4.x)
}

/** 连接是否是反向的（target 在 source 上方/左方） */
export function isConnectionBackward(source: HandlePosition, target: HandlePosition): boolean {
  return isHorizontalFromPosition(source.position) ? source.x > target.x : source.y > target.y
}

// ============ 距离 ============

export function distance(p1: ControlPoint, p2: ControlPoint): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y)
}

export function getLineCenter(p1: ControlPoint, p2: ControlPoint): ControlPoint {
  return { id: `center_${p1.id}_${p2.id}`, x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
}

// ============ 圆角折线 SVG path ============

/**
 * 根据控制点生成带圆角的 SVG path
 *
 * 每两个控制点之间是直线，每个转折点添加圆角（Q 曲线）
 * @param points 至少 2 个控制点
 * @param radius 圆角半径
 */
export function getPathWithRoundCorners(points: ControlPoint[], radius: number): string {
  if (points.length < 2) return ''

  const path: string[] = []
  for (let i = 0; i < points.length; i++) {
    if (i === 0) {
      path.push(`M ${points[i].x} ${points[i].y}`)
    } else if (i === points.length - 1) {
      path.push(`L ${points[i].x} ${points[i].y}`)
    } else {
      path.push(getRoundCorner(points[i], points[i - 1], points[i + 1], radius))
    }
  }
  return path.join(' ')
}

/** 在转折点生成圆角 Q 曲线 */
function getRoundCorner(
  center: ControlPoint,
  p1: ControlPoint,
  p2: ControlPoint,
  radius: number,
): string {
  const { x, y } = center

  // 使用容差判断垂直性（消除浮点精度导致的尖角）
  const TOLERANCE = 1.5
  const isPerp =
    (Math.abs(p1.x - x) < TOLERANCE && Math.abs(p2.y - y) < TOLERANCE) ||
    (Math.abs(p1.y - y) < TOLERANCE && Math.abs(p2.x - x) < TOLERANCE)
  if (!isPerp) {
    return `L ${x} ${y}`
  }

  const d1 = distance(center, p1)
  const d2 = distance(center, p2)
  radius = Math.min(d1 / 2, d2 / 2, radius)

  // 同样使用容差判断方向
  const isHorizontal = Math.abs(p1.y - y) < TOLERANCE
  const xDir = isHorizontal ? (p1.x < p2.x ? -1 : 1) : (p1.x < p2.x ? 1 : -1)
  const yDir = isHorizontal ? (p1.y < p2.y ? 1 : -1) : (p1.y < p2.y ? -1 : 1)

  if (isHorizontal) {
    return `L ${x + radius * xDir},${y}Q ${x},${y} ${x},${y + radius * yDir}`
  }
  return `L ${x},${y + radius * yDir}Q ${x},${y} ${x + radius * xDir},${y}`
}

// ============ 标签位置 ============

/** 获取最长线段 */
function getLongestLine(points: ControlPoint[]): [ControlPoint, ControlPoint] {
  let best: [ControlPoint, ControlPoint] = [points[0], points[1]]
  let bestDist = distance(best[0], best[1])
  for (let i = 1; i < points.length - 1; i++) {
    const d = distance(points[i], points[i + 1])
    if (d > bestDist) { bestDist = d; best = [points[i], points[i + 1]] }
  }
  return best
}

/** 计算边标签的位置 */
export function getLabelPosition(points: ControlPoint[], minGap = 20): { x: number; y: number } {
  if (points.length % 2 === 0) {
    const p1 = points[points.length / 2 - 1]
    const p2 = points[points.length / 2]
    if (distance(p1, p2) > minGap) {
      return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    }
  }
  const [s, e] = getLongestLine(points)
  return { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }
}
