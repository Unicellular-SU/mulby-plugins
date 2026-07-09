import type { Board, Card, Material, MaterialKind } from '../types'

const KIND_LABEL: Record<MaterialKind, string> = { image: '图片', video: '视频', audio: '音频', text: '文本' }

function matKindOfCard(c: Card): MaterialKind {
  if (c.kind === 'video') return 'video'
  if (c.kind === 'audio') return 'audio'
  if (c.kind === 'text') return 'text'
  return 'image' // image | source 都视作图片素材
}

// 默认标题（未重命名）→ 这些用自动编号，重命名后用真实名称
const DEFAULT_TITLES = new Set(['AI 图片', 'AI 视频', 'AI 文本', 'AI 音频', '素材', '分组'])

// 汇总一个节点的素材：上游连线 + 显式引用 + 本节点上传；标签优先用节点真实名称，否则按 kind 自动编号
export function buildMaterials(card: Card, board: Board): Material[] {
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
    const k = matKindOfCard(c)
    counters[k]++
    const t = (c.title || '').trim()
    const label = uniq(t && !DEFAULT_TITLES.has(t) ? t : `${KIND_LABEL[k]}${counters[k]}`)
    mats.push({
      matId: 'card:' + id,
      origin: edgeSet.has(id) ? 'edge' : 'card',
      kind: k,
      label,
      thumbUrl: c.assetUrl || undefined,
      text: c.text || undefined,
      cardId: id,
      assetUrl: c.assetUrl || undefined,
      assetLocalPath: c.assetLocalPath || undefined,
      mime: c.mime || undefined
    })
  }

  for (const a of card.assets || []) {
    counters[a.kind]++
    const nm = (a.name || '').replace(/\.[^.]+$/, '').trim()
    const label = uniq(nm || `${KIND_LABEL[a.kind]}${counters[a.kind]}`)
    mats.push({
      matId: 'upload:' + a.id,
      origin: 'upload',
      kind: a.kind,
      label,
      thumbUrl: a.kind === 'image' ? a.url : undefined,
      assetUrl: a.url,
      assetLocalPath: a.localPath,
      mime: a.mime
    })
  }

  return mats
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

// 生成时的有效输入：若提示词 @了某些素材则只取这些（按其真实名称匹配），否则取全部
export function resolveGenInputs(card: Card, board: Board): GenInputs {
  const mats = buildMaterials(card, board)
  const selected = selectedGenMaterials(card, board, mats)
  const texts: { label: string; text: string }[] = []
  const images: GenImageInput[] = []
  for (const m of selected) {
    if (m.kind === 'text' && m.text) texts.push({ label: m.label, text: m.text })
    else if (m.kind === 'image') {
      const url = m.assetUrl || m.thumbUrl
      if (url || m.assetLocalPath) images.push({ url: url || undefined, localPath: m.assetLocalPath, mime: m.mime })
    }
  }
  return { texts, images }
}

/** 本次生成将使用的素材（与 resolveGenInputs 同源） */
export function selectedGenMaterials(card: Card, board: Board, mats = buildMaterials(card, board)): Material[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const refd = mats.filter((m) => new RegExp('@' + esc(m.label) + '(?=$|[\\s,，。、；;@])').test(card.prompt || ''))
  const picked = refd.length ? refd : mats
  return picked.filter((m) => m.kind === 'text' || m.kind === 'image')
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
