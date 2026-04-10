/**
 * 节点对齐辅助线 Hook（Figma 风格 Smart Guides）
 *
 * 功能：
 * 1. 拖拽节点时检测与其他节点的中心/边缘对齐
 * 2. 返回水平和垂直辅助线坐标
 * 3. 支持吸附（snap）到对齐位置
 *
 * 参考：React Flow 官方 helper lines 示例
 */
import { useCallback, useState } from 'react'
import type { Node, NodeChange, NodePositionChange } from '@xyflow/react'
import { applyNodeChanges } from '@xyflow/react'
import { useFlowStore } from '../store/flowStore'

/** 辅助线数据 */
export interface HelperLine {
  /** 辅助线位置（flow 坐标） */
  position: number
  /** 方向 */
  orientation: 'horizontal' | 'vertical'
}

/** 吸附阈值（像素） */
const SNAP_THRESHOLD = 5

/**
 * 从节点列表中获取所有对齐参考点
 * 返回: 中心 x/y、左/右/上/下边缘
 */
function getNodeGuidePoints(node: Node) {
  const w = node.measured?.width ?? (node.width as number) ?? 150
  const h = node.measured?.height ?? (node.height as number) ?? 50
  const x = node.position.x
  const y = node.position.y
  return {
    cx: x + w / 2, cy: y + h / 2,
    left: x, right: x + w,
    top: y, bottom: y + h,
    width: w, height: h,
  }
}

/**
 * 检测对齐并返回辅助线 + 吸附后的位置
 */
function computeHelperLines(
  draggingNode: Node,
  otherNodes: Node[],
) {
  const dragPts = getNodeGuidePoints(draggingNode)
  const lines: HelperLine[] = []
  let snapX: number | null = null
  let snapY: number | null = null

  for (const other of otherNodes) {
    const pts = getNodeGuidePoints(other)

    // ====== 垂直对齐（x 轴方向的线） ======
    // 左边缘对齐
    if (Math.abs(dragPts.left - pts.left) < SNAP_THRESHOLD) {
      snapX = pts.left
      lines.push({ position: pts.left, orientation: 'vertical' })
    }
    // 右边缘对齐
    if (Math.abs(dragPts.right - pts.right) < SNAP_THRESHOLD) {
      snapX = pts.right - dragPts.width
      lines.push({ position: pts.right, orientation: 'vertical' })
    }
    // 中心对齐
    if (Math.abs(dragPts.cx - pts.cx) < SNAP_THRESHOLD) {
      snapX = pts.cx - dragPts.width / 2
      lines.push({ position: pts.cx, orientation: 'vertical' })
    }
    // 左对右
    if (Math.abs(dragPts.left - pts.right) < SNAP_THRESHOLD) {
      snapX = pts.right
      lines.push({ position: pts.right, orientation: 'vertical' })
    }
    // 右对左
    if (Math.abs(dragPts.right - pts.left) < SNAP_THRESHOLD) {
      snapX = pts.left - dragPts.width
      lines.push({ position: pts.left, orientation: 'vertical' })
    }

    // ====== 水平对齐（y 轴方向的线） ======
    // 上边缘对齐
    if (Math.abs(dragPts.top - pts.top) < SNAP_THRESHOLD) {
      snapY = pts.top
      lines.push({ position: pts.top, orientation: 'horizontal' })
    }
    // 下边缘对齐
    if (Math.abs(dragPts.bottom - pts.bottom) < SNAP_THRESHOLD) {
      snapY = pts.bottom - dragPts.height
      lines.push({ position: pts.bottom, orientation: 'horizontal' })
    }
    // 中心对齐
    if (Math.abs(dragPts.cy - pts.cy) < SNAP_THRESHOLD) {
      snapY = pts.cy - dragPts.height / 2
      lines.push({ position: pts.cy, orientation: 'horizontal' })
    }
    // 上对下
    if (Math.abs(dragPts.top - pts.bottom) < SNAP_THRESHOLD) {
      snapY = pts.bottom
      lines.push({ position: pts.bottom, orientation: 'horizontal' })
    }
    // 下对上
    if (Math.abs(dragPts.bottom - pts.top) < SNAP_THRESHOLD) {
      snapY = pts.top - dragPts.height
      lines.push({ position: pts.top, orientation: 'horizontal' })
    }
  }

  return { lines, snapX, snapY }
}

/**
 * 对齐辅助线 Hook
 *
 * 用法：
 * 1. 用 customOnNodesChange 替代 store.onNodesChange
 * 2. 用 helperLines 渲染辅助线组件
 */
export function useHelperLines() {
  const [helperLines, setHelperLines] = useState<HelperLine[]>([])

  const customOnNodesChange = useCallback((changes: NodeChange[]) => {
    const { nodes, setNodes } = useFlowStore.getState()

    // 查找正在拖拽的节点
    const positionChange = changes.find(
      (c): c is NodePositionChange => c.type === 'position' && c.dragging === true
    )

    if (positionChange && positionChange.position) {
      const draggingNode = nodes.find((n) => n.id === positionChange.id)
      if (draggingNode) {
        // 临时节点（使用拖拽中的位置）
        const tempNode = { ...draggingNode, position: positionChange.position }
        const otherNodes = nodes.filter((n) => n.id !== positionChange.id)

        const { lines, snapX, snapY } = computeHelperLines(tempNode, otherNodes)
        setHelperLines(lines)

        // 应用吸附
        if (snapX !== null) positionChange.position.x = snapX
        if (snapY !== null) positionChange.position.y = snapY
      }
    } else {
      // 非拖拽操作（或拖拽结束）→ 清除辅助线
      const dragEnd = changes.find(
        (c): c is NodePositionChange => c.type === 'position' && c.dragging === false
      )
      if (dragEnd) setHelperLines([])
    }

    // 正常应用变更
    setNodes(applyNodeChanges(changes, nodes))
  }, [])

  return { helperLines, customOnNodesChange }
}
