/**
 * 智能边组件：A* 路由 + 圆角折线 + 可拖拽编辑
 *
 * 功能：
 * 1. A* 算法智能路由（避免穿越节点）
 * 2. 圆角折线渲染（直角转弯 + Q 贝塞尔圆角）
 * 3. 可拖拽控制点（Figma 风格交互式编辑）
 * 4. 箭头正确渲染（使用 React Flow SVG defs marker）
 *
 * 拖拽原理：
 * - 水平线段 (y 相同) → 上下拖 → 改变该线段两端 y 坐标
 * - 垂直线段 (x 相同) → 左右拖 → 改变该线段两端 x 坐标
 * - 修改后的控制点存入 edge.data.customPoints，优先于 A* 计算
 */
import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import {
  type EdgeProps,
  EdgeLabelRenderer,
  useInternalNode,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import { computeEdgePath, type EdgeLayout } from '../../layout/edge/routing'
import type { ControlPoint, NodeRect } from '../../layout/edge/point'
import { getExpandedRect } from '../../layout/edge/point'
import { getPathWithRoundCorners, getLabelPosition, distance, getLineCenter } from '../../layout/edge/edge'
import { useFlowStore } from '../../store/flowStore'
import { useEdgeRoutingStore } from '../../store/edgeRoutingStore'

// ============ 主组件 ============

export default function SmartEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  style,
  markerEnd,
  markerStart,
  selected,
}: EdgeProps) {
  const sourceNode = useInternalNode(source)
  const targetNode = useInternalNode(target)
  const reactFlow = useReactFlow()

  // 通过 useStore selector 订阅所有节点的位置和尺寸变化
  // 返回障碍物矩形数组（使用 InternalNode 的 positionAbsolute 获取绝对坐标）
  const obstacleRects = useStore(
    useCallback((state: any) => {
      const rects: NodeRect[] = []
      // state.nodeLookup 是 React Flow v12 的 InternalNode Map
      const nodeLookup: Map<string, any> = state.nodeLookup
      if (!nodeLookup) return rects

      for (const [nodeId, internalNode] of nodeLookup) {
        // 排除 source、target 和 lane 容器
        if (nodeId === source || nodeId === target) continue
        if (internalNode.type === 'lane') continue

        // 使用 InternalNode 的 positionAbsolute（已转换为画布绝对坐标）
        const absPos = internalNode.internals?.positionAbsolute
        if (!absPos) continue

        const w = internalNode.measured?.width ?? internalNode.width ?? 0
        const h = internalNode.measured?.height ?? internalNode.height ?? 0
        if (w <= 0 || h <= 0) continue

        rects.push(getExpandedRect({ x: absPos.x, y: absPos.y, width: w, height: h }, 20))
      }
      return rects
    }, [source, target]),
    // 浅比较：只有当障碍物数量或坐标变化时才触发重渲染
    (a: NodeRect[], b: NodeRect[]) => {
      if (a.length !== b.length) return false
      for (let i = 0; i < a.length; i++) {
        if (a[i].x !== b[i].x || a[i].y !== b[i].y ||
            a[i].width !== b[i].width || a[i].height !== b[i].height) return false
      }
      return true
    }
  )

  // 获取节点矩形（依赖具体几何值而非节点对象引用，避免选中等状态变化触发重算）
  const sourceAbsPos = sourceNode?.internals?.positionAbsolute
  const sourceW = sourceNode?.measured?.width ?? sourceNode?.width ?? 0
  const sourceH = sourceNode?.measured?.height ?? sourceNode?.height ?? 0
  const sourceRect = useMemo(() => {
    if (!sourceAbsPos) return { x: sourceX, y: sourceY, width: 0, height: 0 }
    return { x: sourceAbsPos.x, y: sourceAbsPos.y, width: sourceW, height: sourceH }
  }, [sourceAbsPos?.x, sourceAbsPos?.y, sourceW, sourceH, sourceX, sourceY])

  const targetAbsPos = targetNode?.internals?.positionAbsolute
  const targetW = targetNode?.measured?.width ?? targetNode?.width ?? 0
  const targetH = targetNode?.measured?.height ?? targetNode?.height ?? 0
  const targetRect = useMemo(() => {
    if (!targetAbsPos) return { x: targetX, y: targetY, width: 0, height: 0 }
    return { x: targetAbsPos.x, y: targetAbsPos.y, width: targetW, height: targetH }
  }, [targetAbsPos?.x, targetAbsPos?.y, targetW, targetH, targetX, targetY])

  // 如果有用户自定义的控制点，优先使用；否则 A* 计算
  const customPoints = (data as any)?.customPoints as ControlPoint[] | undefined

  // 边路由全局协调
  const registerEdgePath = useEdgeRoutingStore((s) => s.registerEdgePath)
  const unregisterEdgePath = useEdgeRoutingStore((s) => s.unregisterEdgePath)
  const separatedLayout = useEdgeRoutingStore((s) => s.separatedLayouts.get(id))
  // 订阅版本号变化以获取最新分离结果
  useEdgeRoutingStore((s) => s.version)

  // ref 追踪已注册到 store 的 rawLayout，用于同步检测过期
  const registeredLayoutRef = useRef<EdgeLayout | null>(null)

  const rawEdgeLayout = useMemo(() => {
    if (customPoints && customPoints.length >= 2) {
      // 将首尾端点锚定到当前节点连接点坐标，保持中间控制点不变
      // 这样节点移动时，连线端点跟随移动
      const anchored = [...customPoints]
      anchored[0] = { ...anchored[0], x: sourceX, y: sourceY }
      anchored[anchored.length - 1] = { ...anchored[anchored.length - 1], x: targetX, y: targetY }
      const path = getPathWithRoundCorners(anchored, 12)
      const labelPos = getLabelPosition(anchored)
      return { path, points: anchored, labelPosition: labelPos }
    }
    return computeEdgePath({
      sourceX, sourceY, targetX, targetY,
      sourcePosition, targetPosition,
      sourceRect, targetRect,
      obstacleRects,
    })
  }, [sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
      sourceRect, targetRect, customPoints, obstacleRects])

  // 注册路由结果到全局 store，触发并行边分离
  useEffect(() => {
    if (!customPoints) {
      registerEdgePath(id, rawEdgeLayout)
      registeredLayoutRef.current = rawEdgeLayout
    }
    return () => {
      unregisterEdgePath(id)
      registeredLayoutRef.current = null
    }
  }, [id, rawEdgeLayout, customPoints, registerEdgePath, unregisterEdgePath])

  // 决定最终渲染的路径：
  // - 自定义控制点的边不参与分离
  // - rawEdgeLayout 变化后、useEffect 注册前（同一帧），ref 还是旧值 → 回退到 raw（消除闪烁）
  // - 分离路径直接使用（edgeSeparation 已保证首尾端点不偏移，无需 re-anchor）
  const edgeLayout =
    customPoints ? rawEdgeLayout :
    (!separatedLayout || rawEdgeLayout !== registeredLayoutRef.current) ? rawEdgeLayout :
    separatedLayout
  const { path, points, labelPosition } = edgeLayout

  // 更新 edge 自定义控制点的回调
  const updateCustomPoints = useCallback((newPoints: ControlPoint[]) => {
    reactFlow.setEdges((edges) =>
      edges.map((e) =>
        e.id === id ? { ...e, data: { ...e.data, customPoints: newPoints } } : e
      )
    )
  }, [id, reactFlow])

  // 清除自定义控制点（双击手柄恢复自动路由）
  const clearCustomPoints = useCallback(() => {
    reactFlow.setEdges((edges) =>
      edges.map((e) =>
        e.id === id ? { ...e, data: { ...e.data, customPoints: undefined } } : e
      )
    )
  }, [id, reactFlow])

  // ====== 边标签编辑 ======
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [editLabelValue, setEditLabelValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEditLabel = useCallback(() => {
    setEditLabelValue((label as string) || '')
    setIsEditingLabel(true)
    // 下一帧自动聚焦
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [label])

  const finishEditLabel = useCallback(() => {
    setIsEditingLabel(false)
    const newLabel = editLabelValue.trim()
    // 只在内容变化时更新
    if (newLabel !== (label || '')) {
      useFlowStore.getState().pushHistory()
      reactFlow.setEdges((edges) =>
        edges.map((e) =>
          e.id === id ? { ...e, label: newLabel || undefined } : e
        )
      )
    }
  }, [id, editLabelValue, label, reactFlow])

  const strokeColor = selected ? '#3b82f6' : ((style?.stroke as string) || '#6b7280')
  const strokeWidth = selected ? 2.5 : ((style?.strokeWidth as number) || 2)

  return (
    <>
      {/* 不可见宽路径 — 扩大点击/选择区域 + 双击添加标签 */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
        onDoubleClick={(e) => {
          e.stopPropagation()
          startEditLabel()
        }}
      />
      {/* 可见路径 */}
      <path
        d={path}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        markerEnd={markerEnd}
        markerStart={markerStart}
        className="react-flow__edge-path smart-edge__path"
      />
      {/* 边标签（可编辑） */}
      <EdgeLabelRenderer>
        {isEditingLabel ? (
          <input
            ref={inputRef}
            className="smart-edge__label-input nodrag nopan"
            value={editLabelValue}
            onChange={(e) => setEditLabelValue(e.target.value)}
            onBlur={finishEditLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishEditLabel()
              if (e.key === 'Escape') setIsEditingLabel(false)
            }}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
              pointerEvents: 'all',
            }}
            autoFocus
          />
        ) : label ? (
          <div
            className="smart-edge__label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
              pointerEvents: 'all',
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              startEditLabel()
            }}
          >
            {label}
          </div>
        ) : null}
      </EdgeLabelRenderer>
      {/* 选中时显示可拖拽控制点 */}
      {selected && points.length > 2 && (
        <EdgeLabelRenderer>
          <EdgeControllers
            points={points}
            onUpdatePoints={updateCustomPoints}
            onResetPoints={clearCustomPoints}
            reactFlow={reactFlow}
          />
        </EdgeLabelRenderer>
      )}
    </>
  )
}

// ============ 交互式控制点编辑 ============

interface EdgeControllersProps {
  points: ControlPoint[]
  onUpdatePoints: (newPoints: ControlPoint[]) => void
  onResetPoints: () => void
  reactFlow: ReturnType<typeof useReactFlow>
}

function EdgeControllers({ points, onUpdatePoints, onResetPoints, reactFlow }: EdgeControllersProps) {
  const segments = useMemo(() => {
    const result: { center: { x: number; y: number }; isHorizontal: boolean; idx: number }[] = []
    for (let i = 0; i < points.length - 1; i++) {
      // 跳过直接连接端点的线段（第一段和最后一段）
      // 因为端点锁定后，拖拽这些线段会产生斜线
      if (i === 0 || i === points.length - 2) continue
      if (distance(points[i], points[i + 1]) < 30) continue
      result.push({
        center: getLineCenter(points[i], points[i + 1]),
        isHorizontal: points[i].y === points[i + 1].y,
        idx: i,
      })
    }
    return result
  }, [points])

  return (
    <>
      {segments.map((seg) => (
        <DragHandle
          key={`h-${seg.idx}`}
          segmentIdx={seg.idx}
          center={seg.center}
          isHorizontal={seg.isHorizontal}
          points={points}
          onUpdatePoints={onUpdatePoints}
          onResetPoints={onResetPoints}
          reactFlow={reactFlow}
        />
      ))}
    </>
  )
}

// ============ 可拖拽手柄 ============

interface DragHandleProps {
  segmentIdx: number
  center: { x: number; y: number }
  isHorizontal: boolean
  points: ControlPoint[]
  onUpdatePoints: (newPoints: ControlPoint[]) => void
  onResetPoints: () => void
  reactFlow: ReturnType<typeof useReactFlow>
}

function DragHandle({
  segmentIdx,
  center,
  isHorizontal,
  points,
  onUpdatePoints,
  onResetPoints,
  reactFlow,
}: DragHandleProps) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef<{ screenX: number; screenY: number; points: ControlPoint[] } | null>(null)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // 记录历史快照（用于撤销/重做）
    useFlowStore.getState().pushHistory()
    setDragging(true)
    dragStartRef.current = {
      screenX: e.clientX,
      screenY: e.clientY,
      points: points.map(p => ({ ...p })), // 深拷贝当前控制点
    }
  }, [points])

  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return

      const { screenX, screenY, points: startPoints } = dragStartRef.current

      // 将屏幕像素差转换为 flow 坐标差
      const startFlow = reactFlow.screenToFlowPosition({ x: screenX, y: screenY })
      const currentFlow = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      const deltaX = currentFlow.x - startFlow.x
      const deltaY = currentFlow.y - startFlow.y

      // 克隆控制点并修改对应线段（锁定首尾端点不动）
      const newPoints = startPoints.map(p => ({ ...p }))
      const firstIdx = 0
      const lastIdx = newPoints.length - 1
      const p1Idx = segmentIdx
      const p2Idx = segmentIdx + 1

      if (isHorizontal) {
        // 水平线段 → 上下拖 → 改变 y（首尾端点锁定）
        if (p1Idx !== firstIdx && p1Idx !== lastIdx) newPoints[p1Idx].y += deltaY
        if (p2Idx !== firstIdx && p2Idx !== lastIdx) newPoints[p2Idx].y += deltaY
      } else {
        // 垂直线段 → 左右拖 → 改变 x（首尾端点锁定）
        if (p1Idx !== firstIdx && p1Idx !== lastIdx) newPoints[p1Idx].x += deltaX
        if (p2Idx !== firstIdx && p2Idx !== lastIdx) newPoints[p2Idx].x += deltaX
      }

      onUpdatePoints(newPoints)
    }

    const handleMouseUp = () => {
      setDragging(false)
      dragStartRef.current = null
    }

    // 绑定到 window 以确保拖拽到边界外也能响应
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, segmentIdx, isHorizontal, reactFlow, onUpdatePoints])

  return (
    <div
      className={`smart-edge__handle nodrag nopan ${dragging ? 'smart-edge__handle--dragging' : ''}`}
      style={{
        position: 'absolute',
        transform: `translate(-50%, -50%) translate(${center.x}px, ${center.y}px)`,
        width: isHorizontal ? '8px' : '24px',
        height: isHorizontal ? '24px' : '8px',
        borderRadius: '4px',
        background: dragging ? '#1d4ed8' : (hovered ? '#2563eb' : '#3b82f6'),
        border: '1.5px solid #fff',
        cursor: isHorizontal ? 'row-resize' : 'col-resize',
        pointerEvents: 'all',
        opacity: dragging ? 1 : (hovered ? 1 : 0.7),
        transition: dragging ? 'none' : 'opacity 0.15s, background 0.15s',
        zIndex: 100,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onResetPoints() // 双击恢复自动路由
      }}
      title="拖拽调整路径 · 双击恢复自动"
    />
  )
}
