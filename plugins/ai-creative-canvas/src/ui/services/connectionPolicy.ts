import type { Card } from '../types'

// 可作为引用目标（消费上游素材去生成）的卡片类型；与 generate.canGenerate 保持一致
const GENERATABLE = new Set(['text', 'image', 'video', 'audio'])

export interface ConnVerdict {
  ok: boolean
  reason?: string
}

// 连接合法性（软引用模型：仅拦截无意义连接，不做端口类型门控）
export function canConnect(source: Card, target: Card): ConnVerdict {
  if (source.id === target.id) return { ok: false, reason: '不能连接到自身' }
  if (source.kind === 'group' || target.kind === 'group') return { ok: false, reason: '分组不能作为连线端点' }
  if (source.kind === 'note' || target.kind === 'note') return { ok: false, reason: '便签不参与引用连线' }
  if (!GENERATABLE.has(target.kind)) return { ok: false, reason: '目标需是可生成卡片（文本/图片/视频/音频）' }
  return { ok: true }
}

// 拖线时「不可连」的目标卡片集合（用于置灰提示）
export function invalidTargetIds(sourceId: string, cards: Record<string, Card>): Set<string> {
  const src = cards[sourceId]
  const out = new Set<string>()
  if (!src) return out
  for (const c of Object.values(cards)) {
    if (c.id === sourceId) continue
    if (!canConnect(src, c).ok) out.add(c.id)
  }
  return out
}
