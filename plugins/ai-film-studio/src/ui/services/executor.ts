/**
 * 工作流执行引擎（纯函数）：拓扑排序 + 输入收集 + 输出解析。
 * 具体的节点运行（调用 AI、写回 store）在 graphStore 的 run 动作里完成。
 */
import type { Edge } from '@xyflow/react'
import { getNodeDef } from '../nodes/nodeDefs'
import type { FilmNode, PortValue } from '../store/graphStore'
import { isEphemeralUrl } from './assets'

/** 解析某节点某输出端口的产物：输入节点按参数即时派生，其余取已运行的 outputs */
export function resolveOutput(node: FilmNode, handle: string): PortValue | null {
  const def = getNodeDef(node.data.kind)
  if (!def) return null
  if (def.category === 'input') {
    const p = node.data.params || {}
    if (node.data.kind === 'story' || node.data.kind === 'text') {
      return { type: 'text', text: String(p.text ?? '') }
    }
    if (node.data.kind === 'character') {
      // 'image' 口取已生成/上传的参考图；其余口给角色身份 JSON
      if (handle === 'image') return node.data.outputs?.image ?? null
      // M27：手工授权多时期变体——variantsJson 安全解析为 variants[]（非法 JSON 忽略，不影响单期角色）
      let variants: unknown[] | undefined
      const vj = String(p.variantsJson ?? '').trim()
      if (vj) {
        try {
          const parsed = JSON.parse(vj)
          if (Array.isArray(parsed) && parsed.length) variants = parsed
        } catch {
          // 忽略非法 JSON
        }
      }
      return {
        type: 'json',
        // P1-5(部分)：身份 JSON 带 voiceId，供 tts 逐角色配音的 voiceMap（空则下游回退 narrator）
        json: {
          characters: [
            {
              name: p.name ?? '',
              appearance: p.appearance ?? '',
              ...(p.identity ? { identity: p.identity } : {}), // M27：跨期不变身份
              refPrompt: p.refPrompt ?? '',
              ...(variants ? { variants } : {}), // M27：时期变体 → char-image 逐变体出图、keyframe 按期取图
              ...(p.voiceId ? { voiceId: p.voiceId } : {}),
            },
          ],
        },
      }
    }
    if (node.data.kind === 'scene') {
      if (handle === 'image') return node.data.outputs?.image ?? null
      return {
        type: 'json',
        json: { scenes: [{ slug: p.name ?? '', summary: p.description ?? '', prompt: p.refPrompt ?? '' }] },
      }
    }
    if (node.data.kind === 'prop') {
      // 'image' 口取已生成/上传的物品参考图；其余口给物品身份 JSON（供 keyframe 按名匹配 + 提示注入）
      if (handle === 'image') return node.data.outputs?.image ?? null
      return {
        type: 'json',
        json: { props: [{ name: p.name ?? '', appearance: p.description ?? '', refPrompt: p.refPrompt ?? '' }] },
      }
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

// ============ 产物缓存：inputHash（P1-6）============

/** 稳定序列化：对象键排序，保证同一逻辑输入得到同一字符串（数组保持顺序） */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v as Record<string, unknown>).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`
}

/** 非加密字符串哈希（FNV-1a 32bit，十六进制）；仅作缓存键，无需抗碰撞 */
function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

/**
 * 上游产物指纹：只取稳定标识（assetId/localPath/非临时 url、text、json、meta），
 * 绝不哈希 data:/blob: 等临时 url —— 它们 hydrate 后会变、stripValue 又剥离，会导致缓存永远 miss。
 */
function fingerprintInputs(inputs: Record<string, PortValue[]>): unknown {
  const pick = (v: PortValue): unknown => ({
    type: v.type,
    id: v.assetId ?? v.localPath ?? (v.url && !isEphemeralUrl(v.url) ? v.url : undefined),
    text: v.type === 'text' ? v.text : undefined,
    json: v.type === 'json' ? v.json : undefined,
    meta: v.meta,
    items: v.items?.map(pick),
  })
  return Object.fromEntries(Object.entries(inputs).map(([k, a]) => [k, a.map(pick)]))
}

/**
 * 计算节点的输入指纹哈希：kind + params + salt（由调用方注入全局画风/画幅 + 提示词层版本）+ 上游产物指纹。
 * 命中（== node.data.cache.inputHash 且已有 outputs）即可跳过重跑。纯函数，不调 AI。
 */
export function computeInputHash(node: FilmNode, nodes: FilmNode[], edges: Edge[], salt: string): string {
  const payload = {
    kind: node.data.kind,
    params: node.data.params,
    salt,
    upstream: fingerprintInputs(gatherInputs(node, nodes, edges)),
  }
  return hashString(stableStringify(payload))
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
