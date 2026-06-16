/**
 * 工作流模板（M6）：预置常用流水线，一键载入为新工程。
 * 声明式定义节点（kind + 位置 + 参数覆盖）与连线（按节点下标 + 端口）；
 * instantiateTemplate 据此生成带新 id 的 FilmNode/Edge（默认参数取自 nodeDefs）。
 */
import { nanoid } from 'nanoid'
import type { Edge } from '@xyflow/react'
import { getNodeDef } from './nodes/nodeDefs'
import type { FilmNode } from './store/graphStore'

export interface TemplateNode {
  kind: string
  x: number
  y: number
  params?: Record<string, unknown>
}
export interface TemplateEdge {
  from: number
  fromHandle?: string // 默认 'out'
  to: number
  toHandle: string
}
export interface WorkflowTemplate {
  id: string
  name: string
  desc: string
  nodes: TemplateNode[]
  edges: TemplateEdge[]
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'text-to-storyboard',
    name: '故事 → 分镜（文本）',
    desc: '一句话故事经剧本生成、分镜脚本，产出结构化镜头表',
    nodes: [
      { kind: 'story', x: 60, y: 180 },
      { kind: 'script-gen', x: 360, y: 180 },
      { kind: 'storyboard', x: 660, y: 180 },
      { kind: 'preview', x: 960, y: 180 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'in' },
      { from: 1, to: 2, toHandle: 'in' },
      { from: 2, to: 3, toHandle: 'in' },
    ],
  },
  {
    id: 'full-pipeline',
    name: '完整影视流水线',
    desc: '故事→剧本→分镜→角色/关键帧→图生视频→合成→导出（含字幕）',
    nodes: [
      { kind: 'global-style', x: 40, y: 40 },
      { kind: 'story', x: 40, y: 240 },
      { kind: 'script-gen', x: 340, y: 240 },
      { kind: 'storyboard', x: 640, y: 240 },
      { kind: 'char-sheet', x: 640, y: 460 },
      { kind: 'char-image', x: 940, y: 460 },
      { kind: 'keyframe', x: 940, y: 200 },
      { kind: 'i2v', x: 1240, y: 200 },
      { kind: 'compose', x: 1540, y: 300 },
      { kind: 'export', x: 1840, y: 300 },
    ],
    edges: [
      { from: 1, to: 2, toHandle: 'in' },
      { from: 2, to: 3, toHandle: 'in' },
      { from: 3, to: 6, toHandle: 'shot' },
      { from: 3, to: 4, toHandle: 'in' },
      { from: 0, to: 5, toHandle: 'style' },
      { from: 4, to: 5, toHandle: 'role' },
      { from: 5, to: 6, toHandle: 'ref' },
      { from: 6, to: 7, toHandle: 'frame' },
      { from: 7, to: 8, toHandle: 'clips' },
      { from: 3, to: 8, toHandle: 'subs' },
      { from: 8, to: 9, toHandle: 'in' },
    ],
  },
  {
    id: 'clips-to-film',
    name: '片段 → 成片（配乐）',
    desc: '参考图生视频 + 本地配乐，合成并导出成片',
    nodes: [
      { kind: 'image-input', x: 60, y: 120 },
      { kind: 'i2v', x: 360, y: 120 },
      { kind: 'audio-input', x: 60, y: 360 },
      { kind: 'compose', x: 660, y: 220 },
      { kind: 'export', x: 960, y: 220 },
    ],
    edges: [
      { from: 0, to: 1, toHandle: 'frame' },
      { from: 1, to: 3, toHandle: 'clips' },
      { from: 2, to: 3, toHandle: 'audio' },
      { from: 3, to: 4, toHandle: 'in' },
    ],
  },
]

/** 把模板实例化为可直接放入 store 的 nodes/edges（新 id、默认参数 + 覆盖） */
export function instantiateTemplate(tpl: WorkflowTemplate): { nodes: FilmNode[]; edges: Edge[] } {
  const ids = tpl.nodes.map(() => `n_${nanoid(6)}`)
  const nodes: FilmNode[] = tpl.nodes.map((tn, i) => {
    const def = getNodeDef(tn.kind)
    const params: Record<string, unknown> = {}
    if (def) for (const p of def.params) if (p.default !== undefined) params[p.key] = p.default
    Object.assign(params, tn.params || {})
    return {
      id: ids[i],
      type: 'film',
      position: { x: tn.x, y: tn.y },
      data: { kind: tn.kind, title: def?.label || tn.kind, params, status: 'idle' },
    }
  })
  const edges: Edge[] = tpl.edges.map((e, i) => ({
    id: `e_${nanoid(6)}_${i}`,
    source: ids[e.from],
    sourceHandle: e.fromHandle || 'out',
    target: ids[e.to],
    targetHandle: e.toHandle,
    type: 'default',
    animated: false,
  }))
  return { nodes, edges }
}
