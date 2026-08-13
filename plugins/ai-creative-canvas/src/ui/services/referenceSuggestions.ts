import type { AssetAnchor, Card, Material, ProjectDoc } from '../types'
import { acceptsMaterialKind } from './nodeCapabilities'
import { ASSET_ROLE_LABEL, materialFromAnchor } from './semanticAssets'
import { isUsableMaterial } from './references'
export interface AnchorSuggestion {
  anchor: AssetAnchor
  material: Material
  score: number
  reasons: string[]
}

const ROLE_CUES: Record<AssetAnchor['role'], string[]> = {
  character: ['角色', '人物', '主角', '演员', '主人公'],
  scene: ['场景', '地点', '环境', '室内', '室外', '背景'],
  prop: ['道具', '物件', '产品', '手持', '桌上'],
  voice: ['声音', '配音', '声线', '旁白', '对白'],
  style: ['风格', '视觉', '色调', '美术', '摄影'],
  music: ['音乐', '配乐', '节奏', 'BGM'],
  reference: ['参考', '借鉴', '保持', '一致']
}

function compact(value: unknown): string {
  return String(value || '').toLocaleLowerCase().replace(/[\s,，。、；;：:（）()【】\[\]"'“”‘’_-]+/g, '')
}

function tokens(value: unknown): string[] {
  return [...new Set(String(value || '').toLocaleLowerCase().split(/[\s,，。、；;：:（）()【】\[\]"'“”‘’_\-/]+/).map((item) => item.trim()).filter((item) => item.length >= 2))]
}

function includesTerm(text: string, value: unknown): boolean {
  const term = compact(value)
  return !!term && text.includes(term)
}

/**
 * 第一版 AutoLink：纯本地、确定性评分。只返回建议，不修改卡片，也不调用模型。
 */
export function suggestAssetAnchors(card: Card, project: ProjectDoc, contextText: string, limit = 4): AnchorSuggestion[] {
  const text = compact([card.title, contextText].filter(Boolean).join(' '))
  if (!text) return []
  const bound = new Set((card.anchorRefs || []).map((ref) => ref.anchorId))
  const out: AnchorSuggestion[] = []

  for (const anchor of Object.values(project.assetAnchors || {})) {
    if (bound.has(anchor.id) || anchor.source?.cardId === card.id) continue
    const material = materialFromAnchor(anchor, project)
    if (!acceptsMaterialKind(card, material.kind) || !isUsableMaterial(material)) continue

    let score = 0
    const reasons: string[] = []
    if (includesTerm(text, anchor.name)) {
      score += 100
      reasons.push('名称命中')
    }
    const alias = anchor.aliases.find((value) => includesTerm(text, value))
    if (alias) {
      score += 92
      reasons.push(`别名“${alias}”命中`)
    }
    const matchedTags = anchor.tags.filter((value) => includesTerm(text, value)).slice(0, 2)
    if (matchedTags.length) {
      score += 48 + matchedTags.length * 6
      reasons.push(`标签 ${matchedTags.join('、')}`)
    }
    const descriptionTokens = tokens(anchor.description).filter((value) => includesTerm(text, value)).slice(0, 2)
    if (descriptionTokens.length) {
      score += descriptionTokens.length * 14
      reasons.push(`描述 ${descriptionTokens.join('、')}`)
    }
    if (ROLE_CUES[anchor.role].some((cue) => includesTerm(text, cue))) {
      score += 8
      reasons.push(`${ASSET_ROLE_LABEL[anchor.role]}语境`)
    }
    if (score < 40) continue
    out.push({ anchor, material, score, reasons })
  }

  return out
    .sort((a, b) => b.score - a.score || b.anchor.updatedAt - a.anchor.updatedAt || a.anchor.name.localeCompare(b.anchor.name))
    .slice(0, Math.max(1, limit))
}
