/**
 * 边处理工具：
 * 1. 跨分组边重映射：子节点的外部连线 → 重映射到 group 节点
 * 2. 根据节点相对位置自动推断 sourceHandle / targetHandle
 *
 * Handle 命名约定（CustomNodes.tsx）：
 * source:  "bottom" | "right" | "left"
 * target:  默认(top) | "target-left" | "target-right"
 */

import { getNodeSize, type LayoutNode } from './layoutUtils'

interface RawEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  type?: string
  [key: string]: unknown
}

/**
 * 获取节点中心点坐标（group 用绝对坐标，子节点需加上 parent 偏移）
 */
function getNodeCenter(
  node: LayoutNode,
  nodesMap: Map<string, LayoutNode>,
): { cx: number; cy: number } {
  const size = getNodeSize(node)
  let px = node.position.x
  let py = node.position.y

  // 子节点坐标是相对于 parent，需要加上 parent 的绝对坐标
  if (node.parentId) {
    const parent = nodesMap.get(node.parentId as string)
    if (parent) {
      px += parent.position.x
      py += parent.position.y
    }
  }

  return { cx: px + size.width / 2, cy: py + size.height / 2 }
}

/**
 * 跨分组边重映射
 *
 * 规则：
 * - 如果 source 和 target 都在同一个 group 内 → 保持原样（组内连线）
 * - 如果 source 在 group 内、target 在 group 外 → source 重映射到 group
 * - 如果 source 在 group 外、target 在 group 内 → target 重映射到 group
 * - 如果两端分别在不同 group 内 → 两端都重映射到各自的 group
 */
function remapCrossGroupEdges(
  edges: RawEdge[],
  nodesMap: Map<string, LayoutNode>,
): RawEdge[] {
  // group 和 lane 都是容器类型
  const containerIds = new Set(
    Array.from(nodesMap.values())
      .filter((n) => n.type === 'group' || n.type === 'lane')
      .map((n) => n.id)
  )

  // 建立子节点 → group 映射
  const childToContainer = new Map<string, string>()
  nodesMap.forEach((node) => {
    if (node.parentId && containerIds.has(node.parentId as string)) {
      childToContainer.set(node.id, node.parentId as string)
    }
  })

  const seen = new Set<string>() // 去重
  const result: RawEdge[] = []

  for (const edge of edges) {
    const sourceContainer = childToContainer.get(edge.source)
    const targetContainer = childToContainer.get(edge.target)

    // 都在同一容器（或都不在容器） → 保持原样
    if (sourceContainer === targetContainer) {
      result.push(edge)
      continue
    }

    // 泳道模式下：跨泳道的边不需要重映射到容器（直接连子节点），
    // 因为泳道是透明容器，连线应该连接实际的子节点而非泳道本身
    const sourceIsLaneChild = sourceContainer && nodesMap.get(sourceContainer)?.type === 'lane'
    const targetIsLaneChild = targetContainer && nodesMap.get(targetContainer)?.type === 'lane'

    if (sourceIsLaneChild || targetIsLaneChild) {
      // 泳道子节点的跨 lane 连线保持原始 source/target（不重映射到 lane）
      result.push(edge)
      continue
    }

    // group 模式：跨分组 → 重映射到 group
    const newSource = sourceContainer || edge.source
    const newTarget = targetContainer || edge.target

    // 避免自环和重复边
    if (newSource === newTarget) continue
    const key = `${newSource}->${newTarget}`
    if (seen.has(key)) continue
    seen.add(key)

    result.push({
      ...edge,
      source: newSource,
      target: newTarget,
      // 清除原有 handle 信息，让 inferHandles 重新推断
      sourceHandle: undefined,
      targetHandle: undefined,
    })
  }

  return result
}

/**
 * 推断 source 和 target handle
 */
function inferHandles(
  edge: RawEdge,
  nodesMap: Map<string, LayoutNode>,
  forceInfer = false,
): RawEdge {
  const source = nodesMap.get(edge.source)
  const target = nodesMap.get(edge.target)
  if (!source || !target) return { ...edge, type: edge.type || 'smart' }

  // forceInfer=true（AI 新生成）：清除 handle 全部重新推断
  // forceInfer=false（加载/导入）：保留已有 handle，只填补缺失的
  const result = forceInfer
    ? { ...edge, sourceHandle: undefined as string | undefined, targetHandle: undefined as string | undefined }
    : { ...edge }

  const sc = getNodeCenter(source, nodesMap)
  const tc = getNodeCenter(target, nodesMap)
  const dx = tc.cx - sc.cx
  const dy = tc.cy - sc.cy
  const absDx = Math.abs(dx)
  const absDy = Math.abs(dy)

  // ====== 判断主方向 ======
  const isMainlyHorizontal = absDx > absDy * 0.8 && absDx > 30

  // ====== 泳道跨 lane 连线优化 ======
  const sourceParent = source.parentId ? nodesMap.get(source.parentId as string) : null
  const targetParent = target.parentId ? nodesMap.get(target.parentId as string) : null
  const isCrossLane =
    sourceParent?.type === 'lane' &&
    targetParent?.type === 'lane' &&
    source.parentId !== target.parentId

  if (isCrossLane) {
    // 跨泳道连线：根据泳道上下位置关系选择 handle
    if (!result.sourceHandle) {
      result.sourceHandle = dy > 0 ? 'bottom' : 'right'
    }
    if (!result.targetHandle) {
      result.targetHandle = dy > 0 ? undefined : 'target-left'
    }
    result.type = result.type || 'smart'
    return result
  }

  // ====== source handle 推断 ======
  if (!result.sourceHandle) {
    if (source.type === 'decision') {
      if (dy > 0 && absDx < 50) {
        result.sourceHandle = 'bottom'
      } else if (dx > 30) {
        result.sourceHandle = 'right'
      } else if (dx < -30) {
        result.sourceHandle = 'left'
      } else {
        result.sourceHandle = 'bottom'
      }
    } else {
      if (isMainlyHorizontal) {
        result.sourceHandle = dx > 0 ? 'right' : 'left'
      } else {
        result.sourceHandle = 'bottom'
      }
    }
  }

  // ====== target handle 推断 ======
  if (!result.targetHandle) {
    if (target.type === 'decision') {
      // decision 节点作为 target 时，根据相对位置推断输入 handle
      if (isMainlyHorizontal) {
        result.targetHandle = dx > 0 ? 'target-left' : 'target-right'
      }
      // 纵向时使用默认 top handle（不设 targetHandle）
    } else if (isMainlyHorizontal && source.type !== 'decision') {
      result.targetHandle = dx > 0 ? 'target-left' : 'target-right'
    }
  }

  result.type = result.type || 'smart'

  return result
}

/**
 * 自动修复泳道图中没有输入边的孤儿节点（特别是 decision）
 *
 * AI 生成泳道图时，经常为 decision 生成 "是/否" 输出边，却遗漏输入边。
 * 本函数在布局前运行，自动检测并补充缺失的输入边。
 *
 * 修复策略（优先级从高到低）：
 * 1. 拓扑回溯：从孤儿节点的输出 target 的已有 source 链中回溯，找到逻辑前驱
 * 2. 同泳道位置匹配：按 x 坐标找同泳道中最近的左侧节点作为前驱
 * 3. 跨泳道查找：分析已有 edges 拓扑，找出连向当前泳道的源节点
 */
export function fixOrphanNodes(
  nodes: LayoutNode[],
  edges: RawEdge[],
): RawEdge[] {
  // 检查是否有泳道
  const lanes = nodes.filter((n) => n.type === 'lane')
  if (lanes.length === 0) return edges

  const nodesMap = new Map(nodes.map((n) => [n.id, n]))
  // 建立已有输入边的集合
  const hasIncoming = new Set(edges.map((e) => e.target))
  // 建立 source → targets 和 target → sources 映射
  const outgoingMap = new Map<string, string[]>()
  const incomingMap = new Map<string, string[]>()
  for (const edge of edges) {
    if (!outgoingMap.has(edge.source)) outgoingMap.set(edge.source, [])
    outgoingMap.get(edge.source)!.push(edge.target)
    if (!incomingMap.has(edge.target)) incomingMap.set(edge.target, [])
    incomingMap.get(edge.target)!.push(edge.source)
  }

  // 按泳道分组流程节点（排除 lane 容器本身）
  const laneOrder = lanes.map((l) => l.id)
  const laneNodesMap = new Map<string, LayoutNode[]>()
  for (const laneId of laneOrder) {
    laneNodesMap.set(laneId, [])
  }
  for (const node of nodes) {
    if (node.type === 'lane' || !node.parentId) continue
    const laneId = node.parentId as string
    if (laneNodesMap.has(laneId)) {
      laneNodesMap.get(laneId)!.push(node)
    }
  }

  const fixedEdges = [...edges]
  let edgeCounter = edges.length

  // 遍历每个泳道
  for (let laneIdx = 0; laneIdx < laneOrder.length; laneIdx++) {
    const laneId = laneOrder[laneIdx]
    const laneNodes = laneNodesMap.get(laneId) || []

    for (const node of laneNodes) {
      // 跳过 start 节点和已有输入的节点
      if (node.type === 'start' || node.type === 'end' || hasIncoming.has(node.id)) continue

      let predecessor: LayoutNode | null = null

      // 策略1（拓扑回溯）：该孤儿节点有输出边时，看它的 target 是否有其它 source
      // → 这些 source 可能就是孤儿节点应有的逻辑前驱（位于上游泳道的末端节点）
      const orphanTargets = outgoingMap.get(node.id) || []
      if (orphanTargets.length > 0) {
        // 找到同泳道或上游泳道中，有边连向与孤儿节点输出 target 相同区域的节点
        // 回溯方式：找出所有泳道中还没有边指向孤儿节点的、有输出到孤儿所在泳道的节点
        for (let prevLaneIdx = laneIdx - 1; prevLaneIdx >= 0; prevLaneIdx--) {
          const prevLaneNodes = laneNodesMap.get(laneOrder[prevLaneIdx]) || []
          for (let i = prevLaneNodes.length - 1; i >= 0; i--) {
            const candidate = prevLaneNodes[i]
            if (candidate.type === 'end' || candidate.type === 'start') continue
            // 找有输出边且输出边指向当前泳道子节点的节点
            const candidateTargets = outgoingMap.get(candidate.id) || []
            const pointsToCurrentLane = candidateTargets.some((tid) => {
              const tn = nodesMap.get(tid)
              return tn && tn.parentId === laneId
            })
            // 或者该候选节点是泳道末端（有输出但没有指向当前泳道的 — 也可以作为前驱）
            if (pointsToCurrentLane || candidateTargets.length > 0) {
              predecessor = candidate
              break
            }
          }
          if (predecessor) break
        }
      }

      // 策略2（同泳道位置匹配）：按 x 坐标找同泳道中最近的左侧有输出能力的节点
      if (!predecessor) {
        const nodeX = node.position?.x ?? 0
        let bestDist = Infinity
        for (const sibling of laneNodes) {
          if (sibling.id === node.id || sibling.type === 'end') continue
          const sibX = sibling.position?.x ?? 0
          // 找 x 坐标小于当前节点且距离最近的
          if (sibX < nodeX) {
            const dist = nodeX - sibX
            if (dist < bestDist) {
              bestDist = dist
              predecessor = sibling
            }
          }
        }
        // 如果没有位置信息或所有节点都在右侧，退化为数组顺序
        if (!predecessor) {
          const myIdx = laneNodes.indexOf(node)
          for (let i = myIdx - 1; i >= 0; i--) {
            if (laneNodes[i].type !== 'end' && laneNodes[i].type !== 'start') {
              predecessor = laneNodes[i]
              break
            }
          }
        }
      }

      // 策略3（跨泳道兜底）：找上一个泳道中 x 坐标最大（最末端）的有输出节点
      if (!predecessor && laneIdx > 0) {
        for (let prevLaneIdx = laneIdx - 1; prevLaneIdx >= 0; prevLaneIdx--) {
          const prevLaneNodes = laneNodesMap.get(laneOrder[prevLaneIdx]) || []
          let bestCandidate: LayoutNode | null = null
          let bestX = -Infinity
          for (const candidate of prevLaneNodes) {
            if (candidate.type === 'end' || candidate.type === 'start') continue
            const cx = candidate.position?.x ?? 0
            // 优先选有输出边的节点（流程末端）
            const hasOutput = outgoingMap.has(candidate.id)
            if (hasOutput && cx > bestX) {
              bestX = cx
              bestCandidate = candidate
            }
          }
          // 如果没有有输出的，退化为找任意非 start/end 节点
          if (!bestCandidate) {
            for (const candidate of prevLaneNodes) {
              if (candidate.type === 'end' || candidate.type === 'start') continue
              const cx = candidate.position?.x ?? 0
              if (cx > bestX) {
                bestX = cx
                bestCandidate = candidate
              }
            }
          }
          if (bestCandidate) {
            predecessor = bestCandidate
            break
          }
        }
      }

      if (predecessor) {
        edgeCounter++
        const newEdge: RawEdge = {
          id: `auto_fix_edge_${edgeCounter}`,
          source: predecessor.id,
          target: node.id,
          type: 'smart',
        }
        fixedEdges.push(newEdge)
        hasIncoming.add(node.id)
      }
    }
  }

  return fixedEdges
}

/**
 * 批量处理边数据：先修复孤儿节点，再重映射跨分组边，推断 handle，最后分散 decision 输出
 * @param forceInfer true=AI 新生成，强制重新推断所有 handle；false=加载/导入，保留已有 handle
 */
export function processEdges(
  edges: RawEdge[],
  nodes: LayoutNode[],
  forceInfer = false,
): RawEdge[] {
  const nodesMap = new Map(nodes.map((n) => [n.id, n]))

  // 注意：fixOrphanNodes 已移至 useAutoLayout.ts 中布局前调用
  // 这里不再调用，避免合成边无法影响节点布局

  const remapped = remapCrossGroupEdges(edges, nodesMap)
  const inferred = remapped.map((e) => inferHandles(e, nodesMap, forceInfer))

  // ====== decision 节点输出 handle 分散 ======
  const decisionHandleMap = new Map<string, Set<string>>()
  const decisionHandles = ['bottom', 'right', 'left']

  return inferred.map((edge) => {
    const sourceNode = nodesMap.get(edge.source)
    if (!sourceNode || sourceNode.type !== 'decision') return edge

    const used = decisionHandleMap.get(edge.source) || new Set<string>()
    const currentHandle = edge.sourceHandle || 'bottom'

    if (used.has(currentHandle)) {
      const available = decisionHandles.find((h) => !used.has(h))
      if (available) {
        const reassigned = { ...edge, sourceHandle: available }
        used.add(available)
        decisionHandleMap.set(edge.source, used)
        return reassigned
      }
    }

    used.add(currentHandle)
    decisionHandleMap.set(edge.source, used)
    return edge
  })
}
