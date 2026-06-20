import type { Board, Card } from '../types'

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
