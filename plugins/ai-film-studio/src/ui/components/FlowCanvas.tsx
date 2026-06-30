import { useCallback, useEffect, useMemo } from 'react'
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
  type Viewport,
} from '@xyflow/react'
import FilmNode from './nodes/FilmNode'
import { DND_MIME, DND_ASSET, DND_ELEMENT, DND_SNIPPET } from './NodeLibrary'
import { getNodeDef } from '../nodes/nodeDefs'
import { useGraphStore, isValidConnection, type FilmNode as FilmNodeType } from '../store/graphStore'
import { useAssetStore } from '../store/assetStore'
import { usePromptStore, resolveSnippet } from '../store/promptStore'
import { useUiStore } from '../store/uiStore'

const nodeTypes = { film: FilmNode }

export default function FlowCanvas() {
  const { screenToFlowPosition } = useReactFlow()
  const theme = useUiStore((s) => s.theme)
  // 画布 SVG 颜色：Background/MiniMap 走 SVG fill 属性，不解析 var()，故按主题取令牌等值；
  // 分类色用 getComputedStyle 读 --afs-cat-*（随 theme 重算）。
  const dotColor = theme === 'light' ? 'rgba(71,85,105,0.32)' : 'rgba(255,255,255,0.07)'
  const maskColor = theme === 'light' ? 'rgba(0,0,0,0.30)' : 'rgba(0,0,0,0.42)'
  const catColors = useMemo(() => {
    const root = getComputedStyle(document.documentElement)
    const get = (c: string) => root.getPropertyValue(`--afs-cat-${c}`).trim() || '#64748b'
    return { input: get('input'), text: get('text'), image: get('image'), video: get('video'), audio: get('audio'), output: get('output') } as Record<string, string>
  }, [theme])
  const miniMapColor = useCallback(
    (node: Node): string => {
      const kind = (node.data as FilmNodeType['data'])?.kind
      const def = kind ? getNodeDef(kind) : undefined
      return (def && catColors[def.category]) || '#64748b'
    },
    [catColors]
  )
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const viewport = useGraphStore((s) => s.viewport)
  // P2-13：视口变更持久化（防抖落盘在 store.setViewport 内）
  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => {
    useGraphStore.getState().setViewport(vp)
  }, [])
  // P2-13：Cmd/Ctrl+D 复制选中节点（在输入框内不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        const el = document.activeElement
        const tag = el?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement | null)?.isContentEditable) return
        e.preventDefault()
        useGraphStore.getState().duplicateSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
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
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const kind = e.dataTransfer.getData(DND_MIME)
      if (kind) {
        addNode(kind, position)
        return
      }
      const assetId = e.dataTransfer.getData(DND_ASSET)
      if (assetId) {
        const rec = useAssetStore.getState().assets.find((a) => a.id === assetId)
        if (rec) void useGraphStore.getState().insertAssetNode(rec, position)
        return
      }
      const elId = e.dataTransfer.getData(DND_ELEMENT)
      if (elId) {
        const el = useAssetStore.getState().elements.find((x) => x.id === elId)
        if (el) void useGraphStore.getState().insertElementNode(el, position)
        return
      }
      const snipId = e.dataTransfer.getData(DND_SNIPPET)
      if (snipId) {
        const s = usePromptStore.getState().snippets.find((x) => x.id === snipId)
        if (s) {
          const ok = useGraphStore.getState().appendTextToSelected(resolveSnippet(s))
          window.mulby?.notification?.show(ok ? '已插入片段到选中节点' : '请先选中一个含文本参数的节点', ok ? 'success' : 'warning')
        }
      }
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
        onMoveEnd={onMoveEnd}
        isValidConnection={validate}
        fitView={!viewport}
        defaultViewport={viewport ?? undefined}
        snapToGrid
        snapGrid={[16, 16]}
        minZoom={0.2}
        maxZoom={2}
        defaultEdgeOptions={{ type: 'default' }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color={dotColor} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={miniMapColor} maskColor={maskColor} pannable zoomable />
      </ReactFlow>
    </div>
  )
}
