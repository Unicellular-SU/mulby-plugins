export interface PlacementCardBounds {
  id?: string
  x: number
  y: number
  w: number
  h: number
}

export interface PlacementBoard {
  cards: Record<string, PlacementCardBounds>
}

export interface FindFreeCardSpotOptions {
  margin?: number
  scanStep?: number
  scanColumns?: number
  scanRows?: number
  ignoreCardIds?: ReadonlySet<string>
}

/**
 * 从首选中心点向右、向下寻找能容纳整块内容的空位；扫描区已满时落到现有卡片最下方。
 * 传入的 w/h 可以是一张卡，也可以是整个待创建网格的外包围盒。
 */
export function findFreeCardSpot(
  board: PlacementBoard,
  w: number,
  h: number,
  startX: number,
  startY: number,
  options: FindFreeCardSpotOptions = {}
): { x: number; y: number } {
  const margin = options.margin ?? 24
  const scanStep = options.scanStep ?? 120
  const scanColumns = options.scanColumns ?? 8
  const scanRows = options.scanRows ?? 8
  const cards = Object.values(board.cards).filter((card) => !card.id || !options.ignoreCardIds?.has(card.id))
  const hits = (centerX: number, centerY: number) => cards.some((card) =>
    Math.abs(centerX - (card.x + card.w / 2)) < (w + card.w) / 2 + margin
    && Math.abs(centerY - (card.y + card.h / 2)) < (h + card.h) / 2 + margin
  )
  for (let row = 0; row < scanRows; row++) {
    for (let col = 0; col < scanColumns; col++) {
      const centerX = startX + col * scanStep
      const centerY = startY + row * scanStep
      if (!hits(centerX, centerY)) return { x: centerX, y: centerY }
    }
  }
  const maxY = cards.reduce((value, card) => Math.max(value, card.y + card.h), startY)
  return { x: startX, y: maxY + margin + h / 2 }
}

export function cardBoundsOverlap(a: PlacementCardBounds, b: PlacementCardBounds, margin = 0): boolean {
  return a.x < b.x + b.w + margin
    && a.x + a.w + margin > b.x
    && a.y < b.y + b.h + margin
    && a.y + a.h + margin > b.y
}
