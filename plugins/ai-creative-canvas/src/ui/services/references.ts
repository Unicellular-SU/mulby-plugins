import type { Board, Card, Material, MaterialKind, ProjectDoc } from '../types'
import { acceptsMaterialKind, consumableMaterials, materialKindOfCard } from './nodeCapabilities'
import { materialFromAnchor } from './semanticAssets'

const KIND_LABEL: Record<MaterialKind, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }

// 默认标题（未重命名）→ 这些用自动编号，重命名后用真实名称
const DEFAULT_TITLES = new Set(['AI 图片', 'AI 全景', 'AI 视频', 'AI 文本', 'AI 音频', '素材', '分组'])

// 汇总一个节点的素材：上游连线 + 显式引用 + 本节点上传；标签优先用节点真实名称，否则按 kind 自动编号
export function buildMaterials(card: Card, board: Board, project?: ProjectDoc): Material[] {
  const mats: Material[] = []
  const counters: Record<MaterialKind, number> = { image: 0, video: 0, audio: 0, text: 0 }
  const used = new Set<string>()
  const uniq = (base: string) => {
    let l = base.trim() || '素材'
    let n = 2
    while (used.has(l)) l = `${base}-${n++}`
    used.add(l)
    return l
  }
  const seen = new Set<string>()
  const ownMissing = new Set(
    Array.isArray((card.meta as { missingMediaReferences?: unknown })?.missingMediaReferences)
      ? ((card.meta as { missingMediaReferences: string[] }).missingMediaReferences)
      : []
  )

  // 稳定语义锚点优先于普通卡片引用：视频节点有图片数量上限时，用户明确接受的角色/场景锚点
  // 不应被一张泛化上游图挤出真实生成输入。
  if (project) {
    for (const ref of card.anchorRefs || []) {
      const anchor = project.assetAnchors?.[ref.anchorId]
      if (!anchor || seen.has('anchor:' + anchor.id)) continue
      seen.add('anchor:' + anchor.id)
      const material = materialFromAnchor(anchor, project)
      counters[material.kind]++
      mats.push({ ...material, label: uniq(anchor.name || ref.mention || `${KIND_LABEL[material.kind]}${counters[material.kind]}`) })
    }
  }

  const edgeSources = Object.values(board.edges)
    .filter((e) => e.target === card.id)
    .map((e) => e.source)
  const edgeSet = new Set(edgeSources)
  const explicit = card.refIds.filter((id) => !edgeSet.has(id))

  for (const id of [...edgeSources, ...explicit]) {
    if (id === card.id || seen.has('card:' + id)) continue
    const c = board.cards[id]
    if (!c || c.kind === 'group' || c.kind === 'note') continue
    seen.add('card:' + id)
    const k = materialKindOfCard(c)
    if (!k) continue
    const sourceMissing = Array.isArray((c.meta as { missingMediaReferences?: unknown })?.missingMediaReferences)
      && (c.meta as { missingMediaReferences: string[] }).missingMediaReferences.includes('primary')
    counters[k]++
    const t = (c.title || '').trim()
    const label = uniq(t && !DEFAULT_TITLES.has(t) ? t : `${KIND_LABEL[k]}${counters[k]}`)
    mats.push({
      matId: 'card:' + id,
      origin: edgeSet.has(id) ? 'edge' : 'card',
      kind: k,
      label,
      thumbUrl: sourceMissing ? undefined : c.assetUrl || undefined,
      text: c.text || undefined,
      cardId: id,
      assetUrl: sourceMissing ? undefined : c.assetUrl || undefined,
      assetLocalPath: sourceMissing ? undefined : c.assetLocalPath || undefined,
      mime: c.mime || undefined,
      unavailable: !!sourceMissing
    })
  }

  for (let index = 0; index < (card.assets || []).length; index++) {
    const a = card.assets[index]
    counters[a.kind]++
    const nm = (a.name || '').replace(/\.[^.]+$/, '').trim()
    const label = uniq(nm || `${KIND_LABEL[a.kind]}${counters[a.kind]}`)
    const fileMissing = ownMissing.has(`input:${a.id || index}`)
    // 文本内容已经内嵌在工程 JSON 中，即使其原始文件后来被删除，仍是可用输入。
    const unavailable = fileMissing && !(a.kind === 'text' && !!a.text?.trim())
    mats.push({
      matId: 'upload:' + a.id,
      origin: 'upload',
      kind: a.kind,
      label,
      thumbUrl: !unavailable && a.kind === 'image' ? a.url : undefined,
      text: a.kind === 'text' ? a.text : undefined,
      assetUrl: unavailable ? undefined : a.url,
      assetLocalPath: unavailable ? undefined : a.localPath,
      mime: a.mime,
      unavailable
    })
  }

  return mats
}

/** 只有确实带有可发送内容的素材才能参与 @ 解析和 Provider 输入。 */
export function isUsableMaterial(material: Material): boolean {
  if (material.unavailable) return false
  if (material.kind === 'text') return !!material.text?.trim()
  return !!(material.assetUrl || material.assetLocalPath || material.thumbUrl)
}

export interface GenImageInput {
  url?: string
  localPath?: string
  mime?: string
}
export interface GenInputs {
  texts: { label: string; text: string }[]
  images: GenImageInput[]
}

export type GenerationPromptPurpose = 'media' | 'text' | 'speech'

export interface ResolvedGenerationPrompt {
  /** 真正交给下游模型的内容提示（画幅、风格等模型参数仍由各生成器追加） */
  text: string
  inputs: GenInputs
  /** 有效 @ 命中后只使用点名素材；无命中则使用全部连线/引用/上传素材 */
  hasExplicitMentions: boolean
  source: 'empty' | 'local' | 'upstream' | 'combined' | 'mentions'
}

function mentionPattern(label: string, flags = ''): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('@' + escaped + '(?=$|[\\s,，。、；;@])', flags)
}

function mentionedMaterials(prompt: string, mats: Material[]): Material[] {
  return mats.filter((m) => mentionPattern(m.label).test(prompt || ''))
}

function inputsFromMaterials(selected: Material[]): GenInputs {
  const texts: { label: string; text: string }[] = []
  const images: GenImageInput[] = []
  for (const m of selected) {
    if (m.kind === 'text' && m.text?.trim()) texts.push({ label: m.label, text: m.text.trim() })
    else if (m.kind === 'image') {
      const url = m.assetUrl || m.thumbUrl
      if (url || m.assetLocalPath) images.push({ url: url || undefined, localPath: m.assetLocalPath, mime: m.mime })
    }
  }
  return { texts, images }
}

/** 连续性派生图只允许消费已解析的身份锚点图片，避免包装/风格/旧引用挤掉产品主图。 */
function continuityPreferredMaterials(card: Card, materials: Material[]): Material[] {
  const continuity = (card.meta as any)?.workflowContinuityV1
  const dependencyIds = Array.isArray(continuity?.dependencyAnchorIds)
    ? continuity.dependencyAnchorIds.filter((value: unknown): value is string => typeof value === 'string' && !!value)
    : []
  if (!dependencyIds.length) return materials
  const allowed = new Set(dependencyIds)
  const identity = materials.filter((material) => !!material.anchorId && allowed.has(material.anchorId) && isUsableMaterial(material))
  if (!identity.length) return materials
  // 文本是上下文，不会改变第一张身份参考图的排序；其它图片引用全部排除。
  return [...identity, ...materials.filter((material) => material.kind === 'text' && isUsableMaterial(material))]
}

// 生成时的有效输入：若提示词 @了某些素材则只取这些（按其真实名称匹配），否则取全部
export function resolveGenInputs(card: Card, board: Board, project?: ProjectDoc): GenInputs {
  const mats = buildMaterials(card, board, project)
  const selected = selectedGenMaterials(card, board, mats)
  return inputsFromMaterials(selected)
}

/** 本次生成将使用的素材（与 resolveGenInputs 同源） */
export function selectedGenMaterials(card: Card, board: Board, mats?: Material[], project?: ProjectDoc): Material[] {
  const available = mats ?? buildMaterials(card, board, project)
  const accepted = continuityPreferredMaterials(card, available.filter((material) => acceptsMaterialKind(card, material.kind) && isUsableMaterial(material)))
  const refd = mentionedMaterials(card.prompt || '', accepted)
  const picked = refd.length ? refd : accepted
  return consumableMaterials(card, picked)
}

function formatTextInputs(texts: GenInputs['texts']): string {
  if (texts.length === 1) return texts[0].text
  return texts.map((t) => `【${t.label}】\n${t.text}`).join('\n\n')
}

/**
 * 把画布的“软引用”解析成确定的模型输入：
 * - 没有有效 @：连线/引用的文本自动成为上游输入；本卡 prompt 是补充要求。
 * - 有有效 @：只选中被点名素材，文本 @ 原位展开成真实内容，图片 @ 改写为附件语义。
 * - 无效 @ 从最终提示中移除，避免把内部卡片名当普通提示词发给模型。
 */
export function resolveGenerationPrompt(
  card: Card,
  board: Board,
  purpose: GenerationPromptPurpose = 'media',
  project?: ProjectDoc
): ResolvedGenerationPrompt {
  const mats = buildMaterials(card, board, project)
  const accepted = mats.filter((material) => acceptsMaterialKind(card, material.kind) && isUsableMaterial(material))
  const selectedPool = continuityPreferredMaterials(card, accepted)
  const mentioned = mentionedMaterials(card.prompt || '', selectedPool)
  const hasExplicitMentions = mentioned.length > 0
  const selected = consumableMaterials(card, hasExplicitMentions ? mentioned : selectedPool)
  const inputs = inputsFromMaterials(selected)
  let local = (card.prompt || '').trim()

  // 先清理用户原始输入里的失效 token，再展开有效文本；避免误删上游文本内容本身带有的 @ 字样。
  for (const token of findUnresolvedMentions(local, accepted)) local = local.replace(mentionPattern(token, 'g'), '')

  if (hasExplicitMentions) {
    for (const m of mentioned) {
      const replacement = m.kind === 'text' ? (m.text || '').trim() : m.kind === 'image' ? `参考图「${m.label}」` : ''
      local = local.replace(mentionPattern(m.label, 'g'), replacement)
    }
  }
  local = local.replace(/[ \t]{2,}/g, ' ').trim()

  if (hasExplicitMentions) {
    return { text: local, inputs, hasExplicitMentions, source: local ? 'mentions' : 'empty' }
  }

  const upstream = formatTextInputs(inputs.texts)
  if (purpose === 'speech') {
    // 配音节点的文本框也是正文；有上游时按“上游正文 → 本节点追加正文”顺序朗读，不注入会被念出的说明标签。
    const text = [upstream, local].filter(Boolean).join('\n\n')
    const source = local && upstream ? 'combined' : local ? 'local' : upstream ? 'upstream' : 'empty'
    return { text, inputs, hasExplicitMentions, source }
  }
  if (purpose === 'text') {
    const text = [local, upstream && `参考资料：\n${upstream}`].filter(Boolean).join('\n\n')
    const source = local && upstream ? 'combined' : local ? 'local' : upstream ? 'upstream' : 'empty'
    return { text, inputs, hasExplicitMentions, source }
  }

  const text = [upstream, local && upstream ? `本节点补充要求：\n${local}` : local].filter(Boolean).join('\n\n')
  const source = local && upstream ? 'combined' : local ? 'local' : upstream ? 'upstream' : 'empty'
  return { text, inputs, hasExplicitMentions, source }
}

/** 提示词中 @token（不含 @ 符号） */
export function extractMentionTokens(prompt: string): string[] {
  const out: string[] = []
  const re = /@([^\s,，。、；;@]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(prompt || ''))) out.push(m[1])
  return out
}

/** 未匹配到当前素材列表的 @ 引用 */
export function findUnresolvedMentions(prompt: string, mats: Material[]): string[] {
  const labels = new Set(mats.map((m) => m.label))
  return extractMentionTokens(prompt).filter((t) => !labels.has(t))
}

/** 某源卡在画布上被下游看到的引用标签（取第一个命中） */
export function findLabelForSourceCard(sourceId: string, board: Board): string | null {
  for (const c of Object.values(board.cards)) {
    if (c.id === sourceId || c.kind === 'group' || c.kind === 'note') continue
    const m = buildMaterials(c, board).find((x) => x.cardId === sourceId)
    if (m) return m.label
  }
  return null
}

/** 卡片改名后，把全画布提示词里的 @旧标签 替换为 @新标签 */
export function replaceMentionInPrompt(prompt: string, oldLabel: string, newLabel: string): string {
  if (!oldLabel || oldLabel === newLabel) return prompt
  const esc = oldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (prompt || '').replace(new RegExp('@' + esc + '(?=$|[\\s,，。、；;@])', 'g'), '@' + newLabel)
}
