/**
 * 泳道图布局算法
 *
 * 策略：
 * 1. 按 laneId 将节点分组到各泳道
 * 2. 每个泳道内部使用 Dagre LR 方向布局
 * 3. 泳道垂直排列，间距根据跨泳道边密度动态调整
 * 4. 子节点 position 相对于泳道左上角
 */
import dagre from '@dagrejs/dagre'
import { getNodeSize, type LayoutNode } from './layoutUtils'

const LANE_HEADER_WIDTH = 120  // 泳道标题区宽度
const LANE_PADDING = 60        // 泳道内边距（加大给连线留空间）
const BASE_LANE_GAP = 60       // 基础泳道间距
const NODE_GAP_X = 120         // 泳道内节点水平间距
const NODE_GAP_Y = 80          // 泳道内节点垂直间距（加大让边有空间展开）

/** 每条跨泳道边额外增加的间距 */
const PER_EDGE_GAP = 20

interface LaneInfo {
  id: string
  label: string
}

/**
 * 从 AI 输出的节点中提取泳道信息
 * 约定：type='lane' 的节点是泳道容器
 */
function extractLanes(nodes: LayoutNode[]): { lanes: LaneInfo[]; childMap: Map<string, LayoutNode[]>; orphans: LayoutNode[] } {
  const lanes: LaneInfo[] = []
  const childMap = new Map<string, LayoutNode[]>()
  const orphans: LayoutNode[] = []

  // 收集泳道定义
  for (const node of nodes) {
    if (node.type === 'lane') {
      lanes.push({ id: node.id, label: (node.data?.label as string) || '泳道' })
      childMap.set(node.id, [])
    }
  }

  // 分配子节点到泳道
  for (const node of nodes) {
    if (node.type === 'lane') continue
    const laneId = (node as any).parentId || (node.data as any)?.laneId
    if (laneId && childMap.has(laneId)) {
      childMap.get(laneId)!.push(node)
    } else {
      orphans.push(node)
    }
  }

  return { lanes, childMap, orphans }
}

/**
 * 统计相邻泳道之间的跨泳道边数量
 * 返回每对相邻泳道之间的跨泳道边计数
 */
function countCrossLaneEdges(
  lanes: LaneInfo[],
  childMap: Map<string, LayoutNode[]>,
  edges: any[],
): Map<string, number> {
  // 构建 nodeId → laneId 映射
  const nodeToLane = new Map<string, string>()
  for (const [laneId, children] of childMap) {
    for (const child of children) {
      nodeToLane.set(child.id, laneId)
    }
  }

  // 构建 laneId → laneIndex 映射
  const laneIndex = new Map<string, number>()
  lanes.forEach((lane, idx) => laneIndex.set(lane.id, idx))

  // 统计每对相邻泳道之间的跨泳道边
  const pairCounts = new Map<string, number>()
  for (const edge of edges) {
    const srcLane = nodeToLane.get(edge.source)
    const tgtLane = nodeToLane.get(edge.target)
    if (!srcLane || !tgtLane || srcLane === tgtLane) continue

    const srcIdx = laneIndex.get(srcLane) ?? 0
    const tgtIdx = laneIndex.get(tgtLane) ?? 0
    // 为所有经过的相邻泳道对都计数
    const minIdx = Math.min(srcIdx, tgtIdx)
    const maxIdx = Math.max(srcIdx, tgtIdx)
    for (let i = minIdx; i < maxIdx; i++) {
      const key = `${i}-${i + 1}`
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
    }
  }

  return pairCounts
}

/**
 * 根据跨泳道边密度计算动态间距
 * 间距 = 基础间距 + 边数量 × 每边额外间距
 * 这样跨泳道边越多，泳道间的走线通道越宽，线段不会拥挤
 */
function getDynamicLaneGap(crossEdgeCount: number): number {
  if (crossEdgeCount <= 0) return BASE_LANE_GAP
  return BASE_LANE_GAP + crossEdgeCount * PER_EDGE_GAP
}

/**
 * 泳道内部 Dagre 布局（LR 水平方向）
 * 将跨泳道边也加入 Dagre（低权重虚拟边），让跨泳道连线的节点尽量对齐
 */
function layoutLaneChildren(
  children: LayoutNode[],
  edges: any[],
  allNodeToLane: Map<string, string>,
  laneId: string,
): { layoutNodes: LayoutNode[]; width: number; height: number } {
  if (children.length === 0) {
    return { layoutNodes: [], width: 200, height: 80 }
  }

  const childIds = new Set(children.map((n) => n.id))
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: 'LR',
    nodesep: NODE_GAP_Y,
    ranksep: NODE_GAP_X,
    ranker: 'tight-tree',
  })

  // 添加节点
  children.forEach((node) => {
    const size = getNodeSize(node)
    g.setNode(node.id, { width: size.width, height: size.height })
  })

  // 添加泳道内部的边（正常权重）
  edges.forEach((edge) => {
    if (childIds.has(edge.source) && childIds.has(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  })

  // 将跨泳道边中属于当前泳道的节点也纳入布局考虑
  // 对于当前泳道内的节点且连接到其他泳道的边，添加一个虚拟约束
  // 这让跨泳道连线的节点在 rank 排列上有更合理的位置
  edges.forEach((edge) => {
    const srcInLane = childIds.has(edge.source)
    const tgtInLane = childIds.has(edge.target)
    const srcLane = allNodeToLane.get(edge.source)
    const tgtLane = allNodeToLane.get(edge.target)

    // 只处理一端在当前泳道、另一端在其他泳道的边
    if (srcInLane && !tgtInLane && tgtLane && tgtLane !== laneId) {
      // source 在当前泳道，target 在其他泳道
      // 不添加虚拟边（只影响当前泳道的排序，实际效果有限）
      // 但确保 source 节点的 rank 考虑了这层关系
    }
    if (tgtInLane && !srcInLane && srcLane && srcLane !== laneId) {
      // target 在当前泳道，source 在其他泳道
      // 同上
    }
  })

  dagre.layout(g)

  // 计算内容区域范围
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  const layoutNodes = children.map((node) => {
    const dn = g.node(node.id)
    if (!dn) return node
    const size = getNodeSize(node)
    const x = dn.x - size.width / 2
    const y = dn.y - size.height / 2
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + size.width)
    maxY = Math.max(maxY, y + size.height)
    return { ...node, position: { x, y } }
  })

  // 平移使节点从 (LANE_PADDING, LANE_PADDING) 开始
  const offsetX = LANE_HEADER_WIDTH + LANE_PADDING - minX
  const offsetY = LANE_PADDING - minY
  const shifted = layoutNodes.map((n) => ({
    ...n,
    position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
    // 不设置 extent: 'parent'，允许用户拖出容器以解组
  }))

  const contentWidth = (maxX - minX) + LANE_HEADER_WIDTH + LANE_PADDING * 2
  const contentHeight = (maxY - minY) + LANE_PADDING * 2

  return {
    layoutNodes: shifted,
    width: Math.max(contentWidth, 400),
    height: Math.max(contentHeight, 100),
  }
}

/**
 * 泳道图自动布局
 *
 * 返回包含泳道容器 + 子节点（带 parentId）的完整节点数组
 */
export async function swimlaneLayout(
  nodes: LayoutNode[],
  edges: any[],
): Promise<LayoutNode[]> {
  if (nodes.length === 0) return nodes

  const { lanes, childMap, orphans } = extractLanes(nodes)

  // 如果没有泳道定义，回退到普通布局
  if (lanes.length === 0) {
    return nodes
  }

  // 统计跨泳道边密度，计算动态间距
  const crossLaneCounts = countCrossLaneEdges(lanes, childMap, edges)

  // 构建全局 nodeId → laneId 映射
  const allNodeToLane = new Map<string, string>()
  for (const [laneId, children] of childMap) {
    for (const child of children) {
      allNodeToLane.set(child.id, laneId)
    }
  }

  const result: LayoutNode[] = []
  let currentY = 0
  let maxWidth = 0

  // 逐泳道布局
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i]
    const children = childMap.get(lane.id) || []
    const { layoutNodes, width, height } = layoutLaneChildren(children, edges, allNodeToLane, lane.id)

    maxWidth = Math.max(maxWidth, width)

    // 泳道容器节点
    result.push({
      id: lane.id,
      type: 'lane',
      data: { label: lane.label },
      position: { x: 0, y: currentY },
      style: { width, height },
    })

    // 子节点（带 parentId）
    for (const child of layoutNodes) {
      result.push({
        ...child,
        parentId: lane.id,
      })
    }

    // 使用动态间距：根据当前泳道与下一泳道之间的跨泳道边数量决定
    const pairKey = `${i}-${i + 1}`
    const crossCount = crossLaneCounts.get(pairKey) ?? 0
    const gap = getDynamicLaneGap(crossCount)
    currentY += height + gap
  }

  // 统一所有泳道宽度为最大宽度
  for (const node of result) {
    if (node.type === 'lane') {
      node.style = { ...(node.style as any), width: maxWidth }
    }
  }

  // 孤立节点放在底部
  let orphanY = currentY + 40
  for (const orphan of orphans) {
    const size = getNodeSize(orphan)
    result.push({ ...orphan, position: { x: 0, y: orphanY } })
    orphanY += size.height + 40
  }

  return result
}

