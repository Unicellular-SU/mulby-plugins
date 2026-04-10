import { useCallback } from 'react'
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  reconnectEdge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BarChart3 } from 'lucide-react'
import { useFlowStore } from '../store/flowStore'
import { nodeTypes } from './nodes/CustomNodes'
import SmartEdge from './edges/SmartEdge'
import HelperLines from './HelperLines'
import { useHelperLines } from '../hooks/useHelperLines'

/** 注册自定义边类型 */
const edgeTypes = { smart: SmartEdge }

/**
 * 检测节点是否在某个 group 节点的范围内
 */
/**
 * 判断节点中心是否在容器范围内
 *
 * 关键：子节点的 position 是相对于 parent 的坐标，
 * 必须转换为绝对坐标后才能与容器的绝对坐标比较。
 */
function isInsideContainer(
  node: Node,
  container: Node,
  allNodes: Node[],
): boolean {
  const gw = (container.style?.width as number) || container.measured?.width || 300
  const gh = (container.style?.height as number) || container.measured?.height || 200
  const gx = container.position.x
  const gy = container.position.y

  // 计算节点的绝对坐标
  const nw = node.measured?.width || 150
  const nh = node.measured?.height || 50
  let nx = node.position.x
  let ny = node.position.y

  // 如果节点有 parent，position 是相对坐标，需要加上 parent 的绝对坐标
  if (node.parentId) {
    const parent = allNodes.find((n) => n.id === node.parentId)
    if (parent) {
      nx += parent.position.x
      ny += parent.position.y
    }
  }

  const ncx = nx + nw / 2
  const ncy = ny + nh / 2

  return ncx > gx && ncx < gx + gw && ncy > gy && ncy < gy + gh
}

export default function FlowCanvas() {
  const {
    nodes,
    edges,
    onEdgesChange,
    onConnect,
    onNodeDragStart,
    deleteSelectedNodes,
    setNodes,
    setEdges,
    pushHistory,
  } = useFlowStore()

  // 对齐辅助线
  const { helperLines, customOnNodesChange } = useHelperLines()

  // 处理键盘删除
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedNodes()
      }
    },
    [deleteSelectedNodes]
  )

  // ====== 边重连接（拖拽箭头更换连接点）======
  const handleReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    pushHistory()
    setEdges(reconnectEdge(oldEdge, newConnection, edges))
  }, [edges, setEdges, pushHistory])

  // ====== 拖拽归组/解组 ======
  const handleNodeDragStop = useCallback((_event: any, draggedNode: Node) => {
    // 容器类型节点本身不能归组到其他容器
    if (draggedNode.type === 'group' || draggedNode.type === 'lane') return

    const { nodes: currentNodes, pushHistory } = useFlowStore.getState()
    // group 和 lane 都是有效容器
    const containers = currentNodes.filter(
      (n) => (n.type === 'group' || n.type === 'lane') && n.id !== draggedNode.id
    )

    // 获取 store 中最新的节点数据（包含拖拽后的 position）
    const latestDraggedNode = currentNodes.find((n) => n.id === draggedNode.id) || draggedNode

    // 检测是否拖入某个容器（group 或 lane）
    let targetContainer: Node | null = null
    for (const c of containers) {
      if (isInsideContainer(latestDraggedNode, c, currentNodes)) {
        targetContainer = c
        break
      }
    }

    const currentParentId = latestDraggedNode.parentId
    const newParentId = targetContainer?.id

    // 没有变化则不处理
    if (currentParentId === newParentId) return

    pushHistory()

    const updatedNodes = currentNodes.map((n) => {
      if (n.id !== latestDraggedNode.id) return n

      if (newParentId && targetContainer) {
        // 归组：先计算绝对坐标，再转为相对坐标
        let absX = n.position.x
        let absY = n.position.y
        if (n.parentId) {
          const oldParent = currentNodes.find((p) => p.id === n.parentId)
          absX += oldParent?.position.x || 0
          absY += oldParent?.position.y || 0
        }
        return {
          ...n,
          parentId: newParentId,
          // 不设置 extent: 'parent'，允许用户拖出容器边界以解组
          extent: undefined,
          position: {
            x: absX - targetContainer.position.x,
            y: absY - targetContainer.position.y,
          },
        }
      } else {
        // 解组：position 转为绝对坐标
        const oldParent = currentNodes.find((p) => p.id === currentParentId)
        const parentX = oldParent?.position.x || 0
        const parentY = oldParent?.position.y || 0
        return {
          ...n,
          parentId: undefined,
          extent: undefined,
          position: {
            x: n.position.x + parentX,
            y: n.position.y + parentY,
          },
        }
      }
    })

    setNodes(updatedNodes)
  }, [setNodes])

  return (
    <div className="flow-canvas" onKeyDown={handleKeyDown} tabIndex={0}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={customOnNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onReconnect={handleReconnect}
        edgesReconnectable
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: 'smart',
          animated: false,
          style: { stroke: '#6b7280', strokeWidth: 2 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#6b7280',
            width: 16,
            height: 16,
          },
        }}
        proOptions={{ hideAttribution: true }}
        className="flow-canvas__react-flow"
      >
        <Controls
          className="flow-canvas__controls"
          showInteractive={false}
        />
        <MiniMap
          className="flow-canvas__minimap"
          nodeColor={(node) => {
            switch (node.type) {
              case 'start': return '#22c55e'
              case 'end': return '#ef4444'
              case 'decision': return '#f59e0b'
              case 'process': return '#3b82f6'
              case 'group': return 'rgba(99, 102, 241, 0.3)'
              default: return '#6b7280'
            }
          }}
          maskColor="rgba(0, 0, 0, 0.6)"
        />
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#374151"
        />
        <HelperLines lines={helperLines} />
      </ReactFlow>

      <div className="flow-canvas__stats">
        节点 {nodes.length} · 连线 {edges.length}
      </div>

      {nodes.length === 0 && (
        <div className="flow-canvas__empty">
          <BarChart3 className="flow-canvas__empty-icon" size={64} />
          <p>在左侧对话面板输入描述</p>
          <p>AI 将为你生成流程图</p>
        </div>
      )}
    </div>
  )
}
