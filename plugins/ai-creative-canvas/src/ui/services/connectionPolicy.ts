import type { Card } from '../types'
import { acceptsMaterialKind, canGenerateCard, materialKindLabel, materialKindOfCard } from './nodeCapabilities'

export interface ConnVerdict {
  ok: boolean
  reason?: string
}

// 连接合法性：严格与生成链路的真实输入能力一致，避免“线能连、素材能显示、生成却完全不消费”。
export function canConnect(source: Card, target: Card): ConnVerdict {
  if (source.id === target.id) return { ok: false, reason: '不能连接到自身' }
  if (source.kind === 'group' || target.kind === 'group') return { ok: false, reason: '分组不能作为连线端点' }
  if (source.kind === 'note' || target.kind === 'note') return { ok: false, reason: '便签不参与引用连线' }
  if (!canGenerateCard(target)) return { ok: false, reason: '目标需是可生成卡片（导入的只读资源只能作为上游）' }
  const sourceKind = materialKindOfCard(source)
  if (!sourceKind) return { ok: false, reason: '该节点没有可引用的素材产物' }
  if (!acceptsMaterialKind(target, sourceKind)) {
    return { ok: false, reason: `${target.kind === 'audio' ? '音频' : target.kind === 'video' ? '视频' : target.kind === 'text' ? '文本' : target.kind === 'pano' ? '全景' : '图片'}节点不接受${materialKindLabel(sourceKind)}输入` }
  }
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
