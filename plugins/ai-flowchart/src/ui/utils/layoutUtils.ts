/**
 * 自动布局工具：使用 Dagre 计算有向图节点位置
 *
 * 为什么从 ELK 切换到 Dagre：
 * - Dagre 专为 DAG（有向无环图）设计，对流程图的层级布局更准确
 * - tight-tree ranker 产生紧凑、平衡的布局
 * - Dagre 用中心坐标定位 → 转换为左上角坐标后，同层节点自然居中对齐
 * - 不会出现 ELK layered 的同层 X 散乱问题
 *
 * 参考: idootop/reactflow-auto-layout 的 dagre-tree.ts
 */
import dagre from '@dagrejs/dagre'

// ============ 节点尺寸常量（与 styles.css 保持一致） ============

const NODE_PADDING_X = 22 * 2  // padding: 14px 22px
const NODE_PADDING_Y = 14 * 2
const NODE_MIN_WIDTH = 100     // min-width: 100px
const NODE_MAX_WIDTH = 280     // max-width: 280px（与 styles.css 同步）
const CHAR_WIDTH = 13          // font-size: 13px
const LINE_HEIGHT = 20         // line-height ≈ 20px
const DESC_CHAR_WIDTH = 11     // 描述文字 11px
const DESC_LINE_HEIGHT = 16
const DESC_MARGIN = 4
const DECISION_SIZE = 110      // decision 菱形 110×110

// ============ 类型定义 ============

export interface LayoutNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  measured?: { width: number; height: number }
  style?: Record<string, unknown>
  [key: string]: unknown
}

interface LayoutEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  type?: string
  [key: string]: unknown
}

// ============ 尺寸计算 ============

/**
 * 获取节点尺寸：优先 measured（真实 DOM 尺寸） → 降级文本估算
 */
export function getNodeSize(node: LayoutNode): { width: number; height: number } {
  if (node.measured?.width && node.measured?.height) {
    return { width: node.measured.width, height: node.measured.height }
  }
  return estimateNodeSize(node.type, node.data)
}

function estimateNodeSize(
  type?: string,
  data?: Record<string, unknown>,
): { width: number; height: number } {
  if (type === 'decision') {
    return { width: DECISION_SIZE, height: DECISION_SIZE }
  }

  if (type === 'connector') {
    return { width: 40, height: 40 }
  }

  // ER 图实体节点：按字段数计算高度
  if (type === 'entity') {
    const fields = (data?.fields as any[]) || []
    const ENTITY_HEADER = 36      // 标题栏高度
    const ENTITY_FIELD_HEIGHT = 28 // 每行字段高度
    const ENTITY_PADDING = 8       // 上下内边距
    const ENTITY_MIN_WIDTH = 180
    const ENTITY_MAX_WIDTH = 280

    const label = (data?.label as string) || ''
    const labelWidth = getTextWidth(label, CHAR_WIDTH) + 40
    const fieldWidths = fields.map((f: any) =>
      getTextWidth(`${f.name || ''} ${f.type || ''}`, 11) + 60
    )
    const maxFieldWidth = fieldWidths.length > 0 ? Math.max(...fieldWidths) : 0
    const width = Math.max(ENTITY_MIN_WIDTH, Math.min(ENTITY_MAX_WIDTH, Math.max(labelWidth, maxFieldWidth)))
    const height = ENTITY_HEADER + Math.max(fields.length, 1) * ENTITY_FIELD_HEIGHT + ENTITY_PADDING * 2

    return { width, height }
  }

  // 泳道节点：宽度由布局算法决定，此处给默认值
  if (type === 'lane') {
    return { width: 600, height: 150 }
  }

  const label = (data?.label as string) || ''
  const description = (data?.description as string) || ''

  const labelTextWidth = getTextWidth(label, CHAR_WIDTH)
  const contentWidth = labelTextWidth + NODE_PADDING_X
  const width = Math.max(NODE_MIN_WIDTH, Math.min(NODE_MAX_WIDTH, contentWidth))
  const availableWidth = Math.max(width - NODE_PADDING_X, 1)

  const labelLines = Math.max(1, Math.ceil(labelTextWidth / availableWidth))
  let height = NODE_PADDING_Y + labelLines * LINE_HEIGHT

  if (description) {
    const descWidth = getTextWidth(description, DESC_CHAR_WIDTH)
    const descLines = Math.max(1, Math.ceil(descWidth / availableWidth))
    height += DESC_MARGIN + descLines * DESC_LINE_HEIGHT
  }

  if (type === 'start' || type === 'end') {
    height = Math.max(48, height)
  }

  return { width, height }
}

function getTextWidth(text: string, charWidth: number): number {
  let width = 0
  for (const char of text) {
    width += char.charCodeAt(0) > 0x2E7F ? charWidth : charWidth * 0.6
  }
  return width
}

// ============ Dagre 布局 ============

/**
 * 使用 Dagre 对节点和边进行自动布局
 *
 * Dagre 的关键优势：
 * - setNode 时传入 width/height，Dagre 自动计算不重叠的位置
 * - dagre.layout() 返回的坐标是节点中心点 → 减去半宽半高得到左上角 = 同层自动居中
 * - tight-tree ranker 产生紧凑平衡的层级布局
 */
export async function autoLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  direction: 'TB' | 'LR' = 'TB',
): Promise<LayoutNode[]> {
  if (nodes.length === 0) return nodes

  if (edges.length === 0) {
    return stackNodesVertically(nodes)
  }

  const GROUP_PADDING = 40
  const GROUP_HEADER = 50  // 标题栏高度（header padding + border + 间距）
  const CHILD_GAP = 50  // 子节点间距，留出连线文字空间

  // ====== 分离 group 和普通节点 ======
  const groupNodes = nodes.filter((n) => n.type === 'group')
  const groupIds = new Set(groupNodes.map((n) => n.id))
  const childNodes = nodes.filter((n) => n.parentId && groupIds.has(n.parentId as string))
  const childIdSet = new Set(childNodes.map((n) => n.id))
  const topLevelNodes = nodes.filter((n) => !groupIds.has(n.id) && !childIdSet.has(n.id))

  // ====== 预计算每个 group 的子节点布局和尺寸 ======
  const groupSizeMap = new Map<string, { width: number; height: number }>()
  const groupChildLayout = new Map<string, LayoutNode[]>()

  for (const group of groupNodes) {
    const children = childNodes.filter((n) => n.parentId === group.id)
    if (children.length === 0) {
      groupSizeMap.set(group.id, { width: 300, height: 200 })
      groupChildLayout.set(group.id, [])
      continue
    }
    let childY = GROUP_HEADER + 10
    const childSizes = children.map((c) => getNodeSize(c))
    const maxChildWidth = Math.max(...childSizes.map((s) => s.width))
    const layoutChildren = children.map((child, i) => {
      const size = childSizes[i]
      const x = GROUP_PADDING + (maxChildWidth - size.width) / 2
      const y = childY
      childY += size.height + CHILD_GAP
      return { ...child, position: { x, y }, extent: 'parent' as const }
    })
    groupSizeMap.set(group.id, {
      width: Math.max(maxChildWidth + GROUP_PADDING * 2, 200),
      height: Math.max(childY + GROUP_PADDING, 100),
    })
    groupChildLayout.set(group.id, layoutChildren)
  }

  // ====== Dagre：顶层节点 + group 节点一起布局 ======
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  const isHorizontal = direction === 'LR'
  g.setGraph({
    rankdir: isHorizontal ? 'LR' : 'TB',
    nodesep: 60, ranksep: 80, ranker: 'tight-tree', align: 'UL', edgesep: 20,
  })

  // 顶层节点加入 Dagre
  topLevelNodes.forEach((node) => {
    const size = getNodeSize(node)
    g.setNode(node.id, { width: size.width, height: size.height })
  })

  // group 节点也加入 Dagre（用预计算的尺寸）
  groupNodes.forEach((node) => {
    const size = groupSizeMap.get(node.id) || { width: 300, height: 200 }
    g.setNode(node.id, { width: size.width, height: size.height })
  })

  // 添加边：子节点的边提升到 group 级别
  const dagreNodeIds = new Set([...topLevelNodes.map((n) => n.id), ...groupNodes.map((n) => n.id)])
  edges.forEach((edge) => {
    let source = edge.source
    let target = edge.target
    // 如果是子节点，映射到其 group
    const sc = childNodes.find((n) => n.id === source)
    const tc = childNodes.find((n) => n.id === target)
    if (sc) source = sc.parentId as string
    if (tc) target = tc.parentId as string
    if (dagreNodeIds.has(source) && dagreNodeIds.has(target) && source !== target) {
      if (!g.hasEdge(source, target)) g.setEdge(source, target)
    }
  })

  try {
    dagre.layout(g)

    // 写回顶层节点
    const layoutTopNodes = topLevelNodes.map((node) => {
      const dn = g.node(node.id)
      if (!dn) return node
      const size = getNodeSize(node)
      return { ...node, position: { x: dn.x - size.width / 2, y: dn.y - size.height / 2 } }
    })

    // 写回 group 节点 + 子节点
    const finalGroupNodes: LayoutNode[] = []
    for (const group of groupNodes) {
      const dn = g.node(group.id)
      const size = groupSizeMap.get(group.id) || { width: 300, height: 200 }
      const gx = dn ? dn.x - size.width / 2 : 0
      const gy = dn ? dn.y - size.height / 2 : 0
      // group 先于子节点出现（React Flow 要求）
      finalGroupNodes.push({
        ...group,
        position: { x: gx, y: gy },
        style: { ...((group.style as any) || {}), width: size.width, height: size.height },
      })
      finalGroupNodes.push(...(groupChildLayout.get(group.id) || []))
    }

    return [...finalGroupNodes, ...layoutTopNodes]
  } catch (err) {
    console.error('[ai-flowchart] Dagre 布局失败，使用简单堆叠:', err)
    return stackNodesVertically(nodes)
  }
}

/**
 * 简单垂直堆叠：所有节点沿纵轴中心线对齐
 */
function stackNodesVertically(nodes: LayoutNode[]): LayoutNode[] {
  const sizes = nodes.map((n) => getNodeSize(n))
  const maxWidth = Math.max(...sizes.map((s) => s.width))
  const centerX = maxWidth / 2

  let currentY = 0
  const gap = 60

  return nodes.map((node, i) => {
    const size = sizes[i]
    const x = centerX - size.width / 2
    const y = currentY
    currentY += size.height + gap
    return {
      ...node,
      position: { x, y },
    }
  })
}
