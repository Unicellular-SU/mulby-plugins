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
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const refd = mats.filter((m) => new RegExp('@' + esc(m.label) + '(?=$|[\\s,，。、；;@])').test(card.prompt))
  const selected = refd.length ? refd : mats
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

// 收集一张卡片的引用来源：@ 引用(refIds) + 指向它的连线起点
export function collectRefCards(card: Card, board: Board): Card[] {
  const ids = new Set<string>(card.refIds)
  for (const e of Object.values(board.edges)) {
    if (e.target === card.id) ids.add(e.source)
  }
  ids.delete(card.id)
  return [...ids].map((id) => board.cards[id]).filter(Boolean) as Card[]
}

export interface ResolvedRefs {
  texts: { title: string; text: string }[]
  imageCards: Card[]
}

export function resolveRefs(card: Card, board: Board): ResolvedRefs {
  const refs = collectRefCards(card, board)
  const texts: { title: string; text: string }[] = []
  const imageCards: Card[] = []
  for (const r of refs) {
    if (r.text && (r.kind === 'text' || r.kind === 'source')) texts.push({ title: r.title, text: r.text })
    if ((r.kind === 'image' || r.kind === 'source') && (r.assetLocalPath || r.assetUrl)) imageCards.push(r)
  }
  return { texts, imageCards }
}
