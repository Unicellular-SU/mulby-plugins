/**
 * 两阶段自动布局 Hook（优化版）
 *
 * 消除闪烁的关键：不再 clear 旧节点
 * 改为：直接设置 hidden → 等测量 → 用真实尺寸重新布局 → 带动画切换为 visible
 *
 * 参考: idootop/reactflow-auto-layout
 */
import { useCallback, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { autoLayout, type LayoutNode } from '../utils/layoutUtils'
import { swimlaneLayout } from '../utils/swimlaneLayout'
import { processEdges, fixOrphanNodes } from '../utils/edgeUtils'
import { useFlowStore } from '../store/flowStore'

/** 等指定帧数 */
function waitFrames(frames = 2): Promise<void> {
  return new Promise((resolve) => {
    let count = 0
    function tick() {
      if (++count >= frames) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export function useAutoLayout() {
  const reactFlow = useReactFlow()
  const isRunningRef = useRef(false)

  /**
   * 完整两阶段布局（消除闪烁版）
   *
   * 策略：不清空旧节点，直接在原位更新
   * 第一阶段：设置新节点（opacity:0）→ 等 React Flow 测量
   * 第二阶段：用真实尺寸布局 → 设为 visible（带 CSS transition 动画）
   */
  const performLayout = useCallback(async (
    rawNodes: any[],
    rawEdges: any[],
    metadata?: any,
    direction: 'TB' | 'LR' = 'TB',
    isAiGenerated = true,
  ) => {
    if (rawNodes.length === 0 || isRunningRef.current) return
    isRunningRef.current = true

    const { setNodes, setEdges, setMetadata, diagramType } = useFlowStore.getState()
    // ER 图默认水平布局，其他类型使用传入的方向
    const effectiveDirection = diagramType === 'er' ? 'LR' : direction

    try {
      const nodesWithPos = rawNodes.map((n: any) => ({
        ...n,
        position: n.position || { x: 0, y: 0 },
      }))

      // AI 生成时：先修复孤儿节点的缺失输入边，使合成边能影响后续布局
      const layoutEdges = isAiGenerated ? fixOrphanNodes(nodesWithPos, rawEdges) : rawEdges

      // ====== 第一阶段：用估算尺寸初步布局 + 设为不可见 ======
      let firstPassNodes: LayoutNode[]
      if (diagramType === 'swimlane') {
        firstPassNodes = await swimlaneLayout(nodesWithPos, layoutEdges)
      } else {
        firstPassNodes = await autoLayout(nodesWithPos, layoutEdges, effectiveDirection)
      }
      const firstPassEdges = processEdges(layoutEdges, firstPassNodes, isAiGenerated)

      // 设节点为"测量态"：占位但用户不可见（opacity:0 比 visibility:hidden 更好，
      // 因为 visibility:hidden 仍占空间但 React Flow 的 ResizeObserver 依然能测量）
      const measureNodes = firstPassNodes.map((n: LayoutNode) => ({
        ...n,
        style: { ...((n.style as any) || {}), opacity: 0 },
      }))
      setNodes(measureNodes)
      setEdges(firstPassEdges)
      if (metadata) setMetadata(metadata)

      // 等待 React Flow 完成 DOM 测量
      const maxWait = 3000
      const start = Date.now()
      while (Date.now() - start < maxWait) {
        await waitFrames(2)
        const currentNodes = reactFlow.getNodes()
        if (currentNodes.length > 0 && currentNodes.every((n: any) => n.measured?.width && n.measured?.height)) {
          break
        }
      }

      // ====== 第二阶段：用真实尺寸重新布局 + 带动画显示 ======
      const measuredNodes = reactFlow.getNodes() as LayoutNode[]

      // 合并 measured 尺寸
      const nodesWithMeasured = nodesWithPos.map((n: LayoutNode) => {
        const mn = measuredNodes.find((m: any) => m.id === n.id)
        return { ...n, measured: mn?.measured || undefined }
      })

      let finalNodes: LayoutNode[]
      if (diagramType === 'swimlane') {
        finalNodes = await swimlaneLayout(nodesWithMeasured, layoutEdges)
      } else {
        finalNodes = await autoLayout(nodesWithMeasured, layoutEdges, effectiveDirection)
      }
      const finalEdges = processEdges(layoutEdges, finalNodes, isAiGenerated)

      // 设为可见，带 CSS transition 动画
      const visibleNodes = finalNodes.map((n: LayoutNode) => ({
        ...n,
        style: {
          ...((n.style as any) || {}),
          opacity: 1,
          // 节点位移过渡动画
          transition: 'transform 0.3s ease, opacity 0.3s ease',
        },
      }))

      setNodes(visibleNodes)
      setEdges(finalEdges)

      // fitView
      await waitFrames(3)
      reactFlow.fitView({ duration: 300, padding: 0.2 })
    } catch (err) {
      console.error('[ai-flowchart] 两阶段布局失败:', err)
    } finally {
      isRunningRef.current = false
    }
  }, [reactFlow])

  /**
   * 快速布局 — 增量渲染时用，不等 DOM 测量
   */
  const performQuickLayout = useCallback(async (
    rawNodes: any[],
    rawEdges: any[],
    metadata?: any,
    isAiGenerated = true,
  ) => {
    if (rawNodes.length === 0) return
    const { setNodes, setEdges, setMetadata, diagramType } = useFlowStore.getState()

    const nodesWithPos = rawNodes.map((n: any) => ({
      ...n,
      position: n.position || { x: 0, y: 0 },
    }))

    // AI 生成时：先修复孤儿节点
    const layoutEdges = isAiGenerated ? fixOrphanNodes(nodesWithPos, rawEdges) : rawEdges

    let layoutNodes: LayoutNode[]
    if (diagramType === 'swimlane') {
      layoutNodes = await swimlaneLayout(nodesWithPos, layoutEdges)
    } else {
      layoutNodes = await autoLayout(nodesWithPos, layoutEdges, diagramType === 'er' ? 'LR' : 'TB')
    }
    const smartEdges = processEdges(layoutEdges, layoutNodes, isAiGenerated)

    setNodes(layoutNodes)
    setEdges(smartEdges)
    if (metadata) setMetadata(metadata)
  }, [])

  return { performLayout, performQuickLayout, isRunning: isRunningRef }
}
