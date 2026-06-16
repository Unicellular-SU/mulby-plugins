/**
 * 工作流执行引擎（纯函数）：拓扑排序 + 输入收集 + 输出解析。
 * 具体的节点运行（调用 AI、写回 store）在 graphStore 的 run 动作里完成。
 */
import type { Edge } from '@xyflow/react'
import { getNodeDef } from '../nodes/nodeDefs'
import type { FilmNode, PortValue } from '../store/graphStore'

/** 解析某节点某输出端口的产物：输入节点按参数即时派生，其余取已运行的 outputs */
export function resolveOutput(node: FilmNode, handle: string): PortValue | null {
  const def = getNodeDef(node.data.kind)
  if (!def) return null
  if (def.category === 'input') {
    const p = node.data.params || {}
    if (node.data.kind === 'story' || node.data.kind === 'text') {
      return { type: 'text', text: String(p.text ?? '') }
    }
    if (node.data.kind === 'global-style') {
      return { type: 'json', json: { aspectRatio: p.aspectRatio ?? '16:9', style: p.style ?? '' } }
    }
  }
  return node.data.outputs?.[handle] ?? null
}

/** 收集某节点所有输入端口的上游产物，按目标端口聚合 */
export function gatherInputs(
  node: FilmNode,
  nodes: FilmNode[],
  edges: Edge[]
): Record<string, PortValue[]> {
  const result: Record<string, PortValue[]> = {}
  for (const e of edges) {
    if (e.target !== node.id) continue
    const src = nodes.find((n) => n.id === e.source)
    if (!src) continue
    const val = resolveOutput(src, e.sourceHandle || 'out')
    if (!val) continue
    const handle = e.targetHandle || 'in'
    ;(result[handle] ||= []).push(val)
  }
  return result
}

/** Kahn 拓扑排序；存在环时把剩余节点追加到末尾，保证全部出现 */
export function topoOrder(nodes: FilmNode[], edges: Edge[]): FilmNode[] {
  const indeg = new Map<string, number>()
  nodes.forEach((n) => indeg.set(n.id, 0))
  edges.forEach((e) => {
    if (indeg.has(e.target)) indeg.set(e.target, (indeg.get(e.target) || 0) + 1)
  })
  const queue = nodes.filter((n) => (indeg.get(n.id) || 0) === 0)
  const order: FilmNode[] = []
  const seen = new Set<string>()
  while (queue.length) {
    const n = queue.shift() as FilmNode
    if (seen.has(n.id)) continue
    seen.add(n.id)
    order.push(n)
    for (const e of edges) {
      if (e.source !== n.id) continue
      const d = (indeg.get(e.target) || 0) - 1
      indeg.set(e.target, d)
      if (d === 0) {
        const tn = nodes.find((x) => x.id === e.target)
        if (tn && !seen.has(tn.id)) queue.push(tn)
      }
    }
  }
  nodes.forEach((n) => {
    if (!seen.has(n.id)) order.push(n)
  })
  return order
}
