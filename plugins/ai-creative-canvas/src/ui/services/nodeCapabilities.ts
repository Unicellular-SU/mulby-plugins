import type { Card, CardKind, Material, MaterialKind } from '../types'
import { isRegisteredNodeKind, resolveNodeInputPolicy, resolveNodeSpec, type NodeInputPolicy } from './nodeSpecs'
import type { ProviderConfig } from './providers/types'
import { resolveVideoCapabilities } from './providers/config'

export type { NodeInputPolicy } from './nodeSpecs'

export function canGenerateKind(kind: CardKind | string): boolean {
  return isRegisteredNodeKind(kind) && resolveNodeSpec(kind).lifecycle.generatable
}

/** 同一种媒体外观可承担“生成节点”或“只读资源节点”；导入资源不能被批量生成意外覆盖。 */
export function canGenerateCard(card: Card): boolean {
  return canGenerateKind(card.kind) && (card.meta as { resourceRole?: unknown })?.resourceRole !== 'source'
}

export function materialKindOfCard(card: Card): MaterialKind | null {
  if (card.kind === 'source') {
    const mime = String(card.mime || '').toLowerCase()
    if (mime.startsWith('video/')) return 'video'
    if (mime.startsWith('audio/')) return 'audio'
    if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/x-subrip') return 'text'
    return 'image'
  }
  return resolveNodeSpec(card.kind).output.materialKind || null
}

export function inputPolicyFor(card: Card, provider?: ProviderConfig): NodeInputPolicy {
  return resolveNodeInputPolicy(card.kind, {
    params: card.params,
    provider,
    videoCapabilities: provider ? resolveVideoCapabilities(provider) : undefined
  })
}

export function acceptsMaterialKind(card: Card, kind: MaterialKind, provider?: ProviderConfig): boolean {
  return inputPolicyFor(card, provider).accepted.includes(kind)
}

export function acceptedMaterialKinds(card: Card, provider?: ProviderConfig): MaterialKind[] {
  return [...inputPolicyFor(card, provider).accepted]
}

/** 按节点真实消费能力过滤并应用同类数量上限，顺序保持与素材条一致。 */
export function consumableMaterials(card: Card, materials: Material[], provider?: ProviderConfig): Material[] {
  const policy = inputPolicyFor(card, provider)
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
