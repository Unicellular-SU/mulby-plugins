import { useCallback } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import FilmNode from './nodes/FilmNode'
import { DND_MIME } from './NodeLibrary'
import { getNodeDef, CATEGORY_META } from '../nodes/nodeDefs'
import { useGraphStore, isValidConnection, type FilmNode as FilmNodeType } from '../store/graphStore'

const nodeTypes = { film: FilmNode }

function miniMapColor(node: Node): string {
  const kind = (node.data as FilmNodeType['data'])?.kind
  const def = kind ? getNodeDef(kind) : undefined
  return def ? CATEGORY_META[def.category].color : '#64748b'
}

export default function FlowCanvas() {
  const { screenToFlowPosition } = useReactFlow()
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const onNodesChange = useGraphStore((s) => s.onNodesChange)
  const onEdgesChange = useGraphStore((s) => s.onEdgesChange)
  const onConnect = useGraphStore((s) => s.onConnect)
  const addNode = useGraphStore((s) => s.addNode)
  const setSelected = useGraphStore((s) => s.setSelected)

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData(DND_MIME)
      if (!kind) return
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      addNode(kind, position)
    },
    [screenToFlowPosition, addNode]
  )

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => setSelected(node.id), [setSelected])
  const onPaneClick = useCallback(() => setSelected(null), [setSelected])

  const validate = useCallback((c: Connection | Edge) => {
    return isValidConnection(c, useGraphStore.getState().nodes)
  }, [])

  return (
    <div className="afs-canvas" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        isValidConnection={validate}
        fitView
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'default' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a3650" />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={miniMapColor} maskColor="rgba(11,15,23,0.7)" pannable zoomable />
      </ReactFlow>
    </div>
  )
}
