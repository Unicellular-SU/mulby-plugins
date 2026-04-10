/**
 * 智能边路由入口：计算最优路径控制点
 * 参考: idootop/reactflow-auto-layout/src/layout/edge/algorithms/index.ts
 *
 * 流程：
 * 1. 根据 handle 方向计算 offset 点
 * 2. 判断是否直连 / 距离太近 → 用 simplePath
 * 3. 否则：扩展矩形→收集候选点（含障碍物顶点）→A* 寻路
 * 4. 输出带圆角的 SVG path
 */
import { Position } from '@xyflow/react'
import type { ControlPoint, HandlePosition, NodeRect } from './point'
import {
  getExpandedRect,
  getOffsetPoint,
  getVerticesFromRectVertex,
  getCenterPoints,
  getSidesFromPoints,
  optimizeInputPoints,
  reducePoints,
  uid,
  getRectVertices,
  isPointInRect,
  isSegmentCrossingRect,
} from './point'
import {
  isHorizontalFromPosition,
  areLinesSameDirection,
  getPathWithRoundCorners,
  getLabelPosition,
} from './edge'
import { getAStarPath } from './a-star'
import { getSimplePath } from './simple'

/** 边的布局结果 */
export interface EdgeLayout {
  /** SVG path 字符串 */
  path: string
  /** 控制点列表 */
  points: ControlPoint[]
  /** 标签位置 */
  labelPosition: { x: number; y: number }
}

const DEFAULT_OFFSET = 30
const DEFAULT_BORDER_RADIUS = 12

/**
 * 计算边的最优路径
 */
export function computeEdgePath(params: {
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  sourceRect: NodeRect
  targetRect: NodeRect
  /** 所有其他节点矩形（排除 source/target），用于全局避障 */
  obstacleRects?: NodeRect[]
  offset?: number
  borderRadius?: number
}): EdgeLayout {
  const {
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
    sourceRect, targetRect,
    obstacleRects = [],
    offset = DEFAULT_OFFSET,
    borderRadius = DEFAULT_BORDER_RADIUS,
  } = params

  const source: HandlePosition = { id: uid(), x: sourceX, y: sourceY, position: sourcePosition }
  const target: HandlePosition = { id: uid(), x: targetX, y: targetY, position: targetPosition }

  // 1. 偏移点
  const sourceOffset = getOffsetPoint(source, offset)
  const targetOffset = getOffsetPoint(target, offset)
  const expandedSource = getExpandedRect(sourceRect, offset)
  const expandedTarget = getExpandedRect(targetRect, offset)

  // 2. 判断是否太近或直连
  const minOffset = 2 * offset + 10
  const isH = isHorizontalFromPosition(sourcePosition)
  const isSameDir = areLinesSameDirection(source, sourceOffset, targetOffset, target)
  const sides = getSidesFromPoints([source, target, sourceOffset, targetOffset])
  const isTooClose = isH
    ? sides.right - sides.left < minOffset
    : sides.bottom - sides.top < minOffset
  const isDirectConnect = isH
    ? isSameDir && source.x < target.x
    : isSameDir && source.y < target.y

  let edgePoints: ControlPoint[] = []
  let optimized!: ReturnType<typeof optimizeInputPoints>

  // 膨胀障碍物矩形（与 source/target 一样 offset/2）
  const expandedObstacles = obstacleRects.map(r => getExpandedRect(r, offset / 2))

  /**
   * 检查一组控制点路径是否穿越任何障碍物
   */
  const pathHitsObstacle = (pts: ControlPoint[]): boolean => {
    if (expandedObstacles.length === 0) return false
    for (let i = 0; i < pts.length - 1; i++) {
      for (const obs of expandedObstacles) {
        if (isSegmentCrossingRect(pts[i], pts[i + 1], obs)) return true
      }
    }
    return false
  }

  /**
   * 执行 A* 路由（含障碍物避让）
   */
  const doAStarRouting = (): void => {
    edgePoints = [
      ...getVerticesFromRectVertex(expandedSource, targetOffset),
      ...getVerticesFromRectVertex(expandedTarget, sourceOffset),
    ]
    edgePoints = edgePoints.concat(getCenterPoints({
      source: expandedSource,
      target: expandedTarget,
      sourceOffset,
      targetOffset,
    }))

    // 将障碍物矩形的顶点加入候选控制点，扩展寻路空间
    // 只添加不在 source/target 矩形内的顶点
    for (const obsRect of obstacleRects) {
      const expandedObs = getExpandedRect(obsRect, offset / 2)
      const vertices = getRectVertices(expandedObs)
      for (const v of vertices) {
        if (!isPointInRect(v, expandedSource) && !isPointInRect(v, expandedTarget)) {
          edgePoints.push(v)
        }
      }
    }

    // 为长距离连接在节点间隙中生成垂直走线通道候选点
    // 这样 A* 不会所有边都走最左侧，而是分布在各节点列间隙中
    const distY = Math.abs(sourceOffset.y - targetOffset.y)
    if (distY > 80) {
      const minY = Math.min(sourceOffset.y, targetOffset.y)
      const maxY = Math.max(sourceOffset.y, targetOffset.y)

      // 1. 收集所有障碍物 + source/target 的 X 边界
      const xEdges: number[] = []
      for (const obs of obstacleRects) {
        xEdges.push(obs.x, obs.x + obs.width)
      }
      xEdges.push(expandedSource.x, expandedSource.x + expandedSource.width)
      xEdges.push(expandedTarget.x, expandedTarget.x + expandedTarget.width)

      // 排序去重
      const uniqueX = [...new Set(xEdges)].sort((a, b) => a - b)

      // 2. 在全局左右两侧 + 中间间隙生成垂直通道
      const channels: number[] = []
      // 最左侧通道
      if (uniqueX.length > 0) channels.push(uniqueX[0] - offset)
      // 最右侧通道
      if (uniqueX.length > 0) channels.push(uniqueX[uniqueX.length - 1] + offset)
      // 中间间隙通道（在相邻 X 边界之间找足够宽的间隙）
      const MIN_GAP = 30
      for (let i = 0; i < uniqueX.length - 1; i++) {
        const gap = uniqueX[i + 1] - uniqueX[i]
        if (gap >= MIN_GAP) {
          channels.push((uniqueX[i] + uniqueX[i + 1]) / 2)
        }
      }

      // 3. 收集障碍物边界的 Y 坐标作为通道的 Y 步进
      // 确保 A* 图在障碍物边界处连通，不会因为 Y 缺失而回退
      const ySet = new Set<number>()
      ySet.add(minY)
      ySet.add(maxY)
      ySet.add((minY + maxY) / 2)
      // 障碍物上下边界（带 offset 偏移，在障碍物外侧）
      for (const obs of obstacleRects) {
        const obsTop = obs.y - offset / 2
        const obsBottom = obs.y + obs.height + offset / 2
        if (obsTop >= minY && obsTop <= maxY) ySet.add(obsTop)
        if (obsBottom >= minY && obsBottom <= maxY) ySet.add(obsBottom)
      }
      // source/target 的 Y 位置
      ySet.add(sourceOffset.y)
      ySet.add(targetOffset.y)
      const ySteps = [...ySet].sort((a, b) => a - b)

      for (const cx of channels) {
        for (const yy of ySteps) {
          edgePoints.push({ id: uid(), x: cx, y: yy })
        }
      }
    }

    optimized = optimizeInputPoints({ source, target, sourceOffset, targetOffset, edgePoints })
    edgePoints = getAStarPath({
      points: optimized.edgePoints,
      source: optimized.source,
      target: optimized.target,
      sourceRect: getExpandedRect(sourceRect, offset / 2),
      targetRect: getExpandedRect(targetRect, offset / 2),
      obstacleRects: expandedObstacles,
    })
  }

  if (isTooClose || isDirectConnect) {
    // 3a. 先尝试简单路径
    edgePoints = getSimplePath({ source, target, sourceOffset, targetOffset, isDirectConnect })
    optimized = optimizeInputPoints({ source, target, sourceOffset, targetOffset, edgePoints })
    edgePoints = optimized.edgePoints

    // 检查简单路径是否穿越障碍物，穿越则回退到 A* 路由
    const simplePath = [optimized.source, ...edgePoints, optimized.target]
    if (pathHitsObstacle(simplePath)) {
      doAStarRouting()
    }
  } else {
    // 3b. A* 寻路
    doAStarRouting()
  }

  // 4. 最终路径
  const allPoints = reducePoints([optimized.source, ...edgePoints, optimized.target])
  const path = getPathWithRoundCorners(allPoints, borderRadius)
  const labelPosition = getLabelPosition(allPoints)

  return { path, points: allPoints, labelPosition }
}

