import type { Card, CardKind, Material, MaterialKind } from '../types'

export interface NodeInputPolicy {
  accepted: readonly MaterialKind[]
  maxByKind?: Partial<Record<MaterialKind, number>>
}

// 节点输入能力的单一真相：连线校验、节点素材导入、引用预览与生成解析必须共用本表。
// 上限按当前真实生成实现声明：视频通用参考只消费首图，首尾帧模式消费前两张图。
const INPUT_POLICY: Record<CardKind, NodeInputPolicy> = {
  text: { accepted: ['text', 'image'] },
  image: { accepted: ['text', 'image'] },
  pano: { accepted: ['text', 'image'] },
  video: { accepted: ['text', 'image'], maxByKind: { image: 1 } },
  audio: { accepted: ['text'] },
  source: { accepted: [] },
  group: { accepted: [] },
  note: { accepted: [] }
}

export function canGenerateKind(kind: CardKind | string): boolean {
  return kind === 'text' || kind === 'image' || kind === 'pano' || kind === 'video' || kind === 'audio'
}

/** 同一种媒体外观可承担“生成节点”或“只读资源节点”；导入资源不能被批量生成意外覆盖。 */
export function canGenerateCard(card: Card): boolean {
  return canGenerateKind(card.kind) && (card.meta as { resourceRole?: unknown })?.resourceRole !== 'source'
}

export function materialKindOfCard(card: Card): MaterialKind | null {
  if (card.kind === 'group' || card.kind === 'note') return null
  if (card.kind === 'text') return 'text'
  if (card.kind === 'video') return 'video'
  if (card.kind === 'audio') return 'audio'
  if (card.kind === 'source') {
    const mime = String(card.mime || '').toLowerCase()
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/x-subrip') return 'text'
  }
  return 'image'
}

export function inputPolicyFor(card: Card): NodeInputPolicy {
  const base = INPUT_POLICY[card.kind]
  if (card.kind !== 'video') return base
  return {
    ...base,
    maxByKind: { ...base.maxByKind, image: card.params?.refMode === 'keyframe' ? 2 : 1 }
  }
}

export function acceptsMaterialKind(card: Card, kind: MaterialKind): boolean {
  return inputPolicyFor(card).accepted.includes(kind)
}

export function acceptedMaterialKinds(card: Card): MaterialKind[] {
  return [...inputPolicyFor(card).accepted]
}

/** 按节点真实消费能力过滤并应用同类数量上限，顺序保持与素材条一致。 */
export function consumableMaterials(card: Card, materials: Material[]): Material[] {
  const policy = inputPolicyFor(card)
  const used: Partial<Record<MaterialKind, number>> = {}
  return materials.filter((material) => {
    if (!policy.accepted.includes(material.kind)) return false
    const next = (used[material.kind] || 0) + 1
    const max = policy.maxByKind?.[material.kind]
    if (max != null && next > max) return false
    used[material.kind] = next
    return true
  })
}

export function materialKindLabel(kind: MaterialKind): string {
  return kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文本'
}
