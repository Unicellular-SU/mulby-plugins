/**
 * A* 寻路算法：找到边的最优路径
 * 参考: idootop/reactflow-auto-layout/src/layout/edge/algorithms/a-star.ts
 *
 * 使用 Manhattan Distance 作为启发函数
 * 路径只走水平/垂直方向，不穿越源/目标/障碍物节点
 */
import { areLinesSameDirection, areLinesReverseDirection } from './edge'
import {
  type ControlPoint,
  type NodeRect,
  isEqualPoint,
  isSegmentCrossingRect,
} from './point'

interface AStarParams {
  /** 候选控制点集合（不含 source/target） */
  points: ControlPoint[]
  source: ControlPoint
  target: ControlPoint
  sourceRect: NodeRect
  targetRect: NodeRect
  /** 所有其他节点的膨胀矩形（排除 source/target），用于全局避障 */
  obstacleRects?: NodeRect[]
}

/**
 * A* 寻路：在候选点中找到从 start→end 的最优路径
 * @returns sourceOffset→...→targetOffset 的控制点（不含 source/target 本身）
 */
export function getAStarPath({ points, source, target, sourceRect, targetRect, obstacleRects = [] }: AStarParams): ControlPoint[] {
  if (points.length < 3) return points

  const start = points[0]
  const end = points[points.length - 1]
  const openSet: ControlPoint[] = [start]
  const closedSet = new Set<ControlPoint>()
  const cameFrom = new Map<ControlPoint, ControlPoint>()
  const gScore = new Map<ControlPoint, number>().set(start, 0)
  const fScore = new Map<ControlPoint, number>().set(
    start,
    heuristic({ from: start, to: start, start, end, source, target }),
  )

  /** 转弯惩罚：方向改变时增加额外代价，减少不必要的拐弯 */
  const TURN_PENALTY = 40

  while (openSet.length) {
    // 找 fScore 最小的节点
    let current: ControlPoint | undefined
    let currentIdx = 0
    let lowestF = Infinity
    openSet.forEach((p, idx) => {
      const f = fScore.get(p) ?? 0
      if (f < lowestF) { lowestF = f; current = p; currentIdx = idx }
    })

    if (!current) break
    if (current === end) return simplifyPath(buildPath(cameFrom, current), obstacleRects, sourceRect, targetRect)

    openSet.splice(currentIdx, 1)
    closedSet.add(current)

    const curG = gScore.get(current) ?? 0
    const prev = cameFrom.get(current)
    const neighbors = getNeighbors({ points, previous: prev, current, sourceRect, targetRect, obstacleRects })

    for (const nb of neighbors) {
      if (closedSet.has(nb)) continue

      // 计算移动代价 = 距离 + 转弯惩罚
      let moveCost = manhattan(current, nb)
      if (prev) {
        const wasHoriz = prev.y === current.y
        const nowHoriz = current.y === nb.y
        if (wasHoriz !== nowHoriz) moveCost += TURN_PENALTY
      }

      const tentG = curG + moveCost
      const nbG = gScore.get(nb) ?? Infinity
      if (openSet.includes(nb) && tentG >= nbG) continue

      if (!openSet.includes(nb)) openSet.push(nb)
      cameFrom.set(nb, current)
      gScore.set(nb, tentG)
      fScore.set(nb, tentG + heuristic({ from: current, to: nb, start, end, source, target }))
    }
  }

  // 寻路失败，生成正交折线回退路径（避免斜线 + 避免穿越障碍物）
  return getOrthogonalFallback(start, end, obstacleRects)
}

/**
 * 检测路径是否穿越任何障碍物
 */
function pathHitsAnyObstacle(pts: ControlPoint[], obstacles: NodeRect[]): boolean {
  if (obstacles.length === 0) return false
  for (let i = 0; i < pts.length - 1; i++) {
    for (const obs of obstacles) {
      if (isSegmentCrossingRect(pts[i], pts[i + 1], obs)) return true
    }
  }
  return false
}

/**
 * 寻路失败时的正交回退路径（障碍物感知）
 *
 * 策略优先级：
 * 1. 先水平后垂直（HV）— 如果不穿过障碍物
 * 2. 先垂直后水平（VH）— 如果不穿过障碍物
 * 3. Z 形绕行 — 在障碍物外侧增加偏移
 */
function getOrthogonalFallback(
  start: ControlPoint,
  end: ControlPoint,
  obstacles: NodeRect[] = [],
): ControlPoint[] {
  // 同一轴线上直连
  if (start.x === end.x || start.y === end.y) {
    return [start, end]
  }

  const ts = Date.now()

  // 方案 A：先水平后垂直（HV）
  const cornerHV: ControlPoint = { id: `fb_hv_${ts}`, x: end.x, y: start.y }
  const pathHV = [start, cornerHV, end]

  // 方案 B：先垂直后水平（VH）
  const cornerVH: ControlPoint = { id: `fb_vh_${ts}`, x: start.x, y: end.y }
  const pathVH = [start, cornerVH, end]

  const hitsA = pathHitsAnyObstacle(pathHV, obstacles)
  const hitsB = pathHitsAnyObstacle(pathVH, obstacles)

  // 优先选不穿过障碍物的方案
  if (!hitsA) return pathHV
  if (!hitsB) return pathVH

  // 两种 L 形都穿过障碍物 → 生成 Z 形绕行
  // 在 start/end 的 x 范围外侧增加偏移
  const DETOUR = 60
  const midX = Math.min(start.x, end.x) - DETOUR
  return [
    start,
    { id: `fb_z1_${ts}`, x: midX, y: start.y },
    { id: `fb_z2_${ts}`, x: midX, y: end.y },
    end,
  ]
}

/** 回溯构建路径 */
function buildPath(cameFrom: Map<ControlPoint, ControlPoint>, current: ControlPoint): ControlPoint[] {
  const path = [current]
  let prev = cameFrom.get(current)
  while (prev) { path.push(prev); prev = cameFrom.get(prev) }
  return path.reverse()
}

/**
 * 路径简化：移除不必要的中间拐点
 * 如果跳过某个中间点，前后两点仍然正交连接且不穿越障碍物，就移除它
 */
function simplifyPath(
  path: ControlPoint[],
  obstacles: NodeRect[],
  sourceRect: NodeRect,
  targetRect: NodeRect,
): ControlPoint[] {
  if (path.length <= 3) return path

  const allRects = [sourceRect, targetRect, ...obstacles]
  const result: ControlPoint[] = [path[0]]

  let i = 0
  while (i < path.length - 1) {
    let furthest = i + 1
    // 尝试跳过中间点直连到更远的点
    for (let j = i + 2; j < path.length; j++) {
      const from = path[i]
      const to = path[j]
      // 必须是正交连接（同一 x 或同一 y，容差 1.5px）
      if (Math.abs(from.x - to.x) > 1.5 && Math.abs(from.y - to.y) > 1.5) continue
      // 不能穿越任何障碍物
      if (allRects.some(r => isSegmentCrossingRect(from, to, r))) continue
      furthest = j
    }
    result.push(path[furthest])
    i = furthest
  }

  return result
}

/**
 * 获取邻居节点：
 * - 必须水平或垂直连线
 * - 不能与前一段反向（避免回头路）
 * - 不能穿越 source/target/障碍物节点
 */
function getNeighbors(params: {
  points: ControlPoint[]
  previous?: ControlPoint
  current: ControlPoint
  sourceRect: NodeRect
  targetRect: NodeRect
  obstacleRects?: NodeRect[]
}): ControlPoint[] {
  const { points, previous, current, sourceRect, targetRect, obstacleRects = [] } = params
  return points.filter(p => {
    if (p === current) return false
    const rightDir = p.x === current.x || p.y === current.y
    const revDir = previous ? areLinesReverseDirection(previous, current, current, p) : false
    return (
      rightDir &&
      !revDir &&
      !isSegmentCrossingRect(p, current, sourceRect) &&
      !isSegmentCrossingRect(p, current, targetRect) &&
      !obstacleRects.some(r => isSegmentCrossingRect(p, current, r))
    )
  })
}

/** 启发函数：Manhattan 距离 + 方向奖励 */
function heuristic(params: {
  from: ControlPoint
  to: ControlPoint
  start: ControlPoint
  end: ControlPoint
  source: ControlPoint
  target: ControlPoint
}): number {
  const { from, to, start, end, source, target } = params
  const base = manhattan(to, start) + manhattan(to, end)
  const startBonus = isEqualPoint(from, start)
    ? (areLinesSameDirection(from, to, source, start) ? -base / 2 : 0)
    : 0
  const endBonus = isEqualPoint(to, end)
    ? (areLinesSameDirection(from, to, end, target) ? -base / 2 : 0)
    : 0
  return base + startBonus + endBonus
}

/** Manhattan 距离 */
function manhattan(p1: ControlPoint, p2: ControlPoint): number {
  return Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y)
}
