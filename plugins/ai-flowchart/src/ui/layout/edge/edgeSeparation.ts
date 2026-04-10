/**
 * 并行边分离：检测共享相同正交线段的边路径，施加偏移以避免重叠
 *
 * 工作原理：
 * 1. 遍历所有边的路径线段，提取正交段（水平或垂直）
 * 2. 将相似的线段按方向和位置聚类（共享同一条直线且有重叠范围）
 * 3. 对同一聚类中的边施加等间距偏移，使它们分开
 */
import type { ControlPoint } from './point'
import type { EdgeLayout } from './routing'
import { getPathWithRoundCorners, getLabelPosition } from './edge'
import { reducePoints, uid } from './point'

/** 并行边分离间距（像素） */
const EDGE_SEPARATION = 14

/** 正交线段描述 */
interface OrthSegment {
  /** 所属边 ID */
  edgeId: string
  /** 是否水平线段 */
  isHorizontal: boolean
  /** 固定轴坐标（水平段的 y / 垂直段的 x） */
  fixedValue: number
  /** 变化轴的起始值 */
  varStart: number
  /** 变化轴的结束值 */
  varEnd: number
  /** 在原始 points 中的起始控制点索引 */
  pointIdx: number
}

/**
 * 对一组边路径进行并行边分离
 *
 * @param edgeLayouts - 每条边的路由结果 Map<edgeId, EdgeLayout>
 * @param borderRadius - 圆角半径
 * @returns 分离后的边路由结果
 */
export function separateParallelEdges(
  edgeLayouts: Map<string, EdgeLayout>,
  borderRadius = 12,
): Map<string, EdgeLayout> {
  if (edgeLayouts.size <= 1) return edgeLayouts

  // 1. 收集所有正交线段
  const allSegments: OrthSegment[] = []
  for (const [edgeId, layout] of edgeLayouts) {
    const { points } = layout
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i]
      const p2 = points[i + 1]
      if (p1.x === p2.x) {
        // 垂直线段
        allSegments.push({
          edgeId,
          isHorizontal: false,
          fixedValue: p1.x,
          varStart: Math.min(p1.y, p2.y),
          varEnd: Math.max(p1.y, p2.y),
          pointIdx: i,
        })
      } else if (p1.y === p2.y) {
        // 水平线段
        allSegments.push({
          edgeId,
          isHorizontal: true,
          fixedValue: p1.y,
          varStart: Math.min(p1.x, p2.x),
          varEnd: Math.max(p1.x, p2.x),
          pointIdx: i,
        })
      }
    }
  }

  // 2. 聚类：同方向、固定值相近（±2px）、变化轴有重叠的线段
  const clusters: OrthSegment[][] = []
  const assigned = new Set<number>()

  for (let i = 0; i < allSegments.length; i++) {
    if (assigned.has(i)) continue
    const cluster = [allSegments[i]]
    assigned.add(i)

    for (let j = i + 1; j < allSegments.length; j++) {
      if (assigned.has(j)) continue
      const a = allSegments[i]
      const b = allSegments[j]
      // 必须不属于同一条边、同方向、固定值相近
      if (a.edgeId === b.edgeId) continue
      if (a.isHorizontal !== b.isHorizontal) continue
      if (Math.abs(a.fixedValue - b.fixedValue) > 4) continue
      // 变化轴必须有重叠
      const overlapStart = Math.max(a.varStart, b.varStart)
      const overlapEnd = Math.min(a.varEnd, b.varEnd)
      if (overlapEnd - overlapStart < 10) continue // 至少 10px 重叠才算并行

      cluster.push(b)
      assigned.add(j)
    }

    if (cluster.length > 1) {
      clusters.push(cluster)
    }
  }

  if (clusters.length === 0) return edgeLayouts

  // 3. 对每个聚类施加偏移
  // 记录每条边需要应用的偏移: Map<edgeId, Map<pointIdx, { dx, dy }>>
  const offsets = new Map<string, Map<number, { dx: number; dy: number }>>()

  for (const cluster of clusters) {
    const n = cluster.length
    // 偏移范围：从 -(n-1)/2 * SEP 到 +(n-1)/2 * SEP
    for (let k = 0; k < n; k++) {
      const seg = cluster[k]
      const shift = (k - (n - 1) / 2) * EDGE_SEPARATION

      if (!offsets.has(seg.edgeId)) offsets.set(seg.edgeId, new Map())
      const edgeOffsets = offsets.get(seg.edgeId)!

      if (seg.isHorizontal) {
        // 水平线段 → 垂直偏移 dy
        edgeOffsets.set(seg.pointIdx, { dx: 0, dy: shift })
      } else {
        // 垂直线段 → 水平偏移 dx
        edgeOffsets.set(seg.pointIdx, { dx: shift, dy: 0 })
      }
    }
  }

  // 4. 应用偏移，重新生成路径
  const result = new Map<string, EdgeLayout>()
  for (const [edgeId, layout] of edgeLayouts) {
    const edgeOffsets = offsets.get(edgeId)
    if (!edgeOffsets || edgeOffsets.size === 0) {
      result.set(edgeId, layout)
      continue
    }

    // 克隆控制点并应用偏移（首尾端点永不偏移，保持锚定在 handle 上）
    const lastIdx = layout.points.length - 1
    const newPoints: ControlPoint[] = layout.points.map((p, i) => {
      // 首尾端点不偏移，防止连线脱离节点 handle
      if (i === 0 || i === lastIdx) return p
      let dx = 0, dy = 0
      // 检查当前点是否属于某个需要偏移的线段
      for (const [segIdx, offset] of edgeOffsets) {
        if (i === segIdx || i === segIdx + 1) {
          dx += offset.dx
          dy += offset.dy
        }
      }
      if (dx === 0 && dy === 0) return p
      return { id: uid(), x: p.x + dx, y: p.y + dy }
    })

    const reduced = reducePoints(newPoints)
    const path = getPathWithRoundCorners(reduced, borderRadius)
    const labelPosition = getLabelPosition(reduced)
    result.set(edgeId, { path, points: reduced, labelPosition })
  }

  return result
}
