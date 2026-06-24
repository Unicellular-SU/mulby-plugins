// 均匀网格空间索引：把带矩形的实体桶入 cell 网格，按可见矩形查询只命中相交格内的候选，
// 把每帧"遍历全量"O(N) 降为"只看可见格"O(可见)。索引只在卡片/连线变化时重建（平移不变）。

export interface RectItem {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export interface GridIndex {
  cell: number
  count: number
  query: (rect: { x: number; y: number; w: number; h: number }) => string[]
}

export function buildGridIndex(items: Iterable<RectItem>, cell = 600): GridIndex {
  const buckets = new Map<string, string[]>()
  let count = 0
  for (const it of items) {
    count++
    const x0 = Math.floor(it.x / cell)
    const y0 = Math.floor(it.y / cell)
    const x1 = Math.floor((it.x + it.w) / cell)
    const y1 = Math.floor((it.y + it.h) / cell)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = cx + ':' + cy
        const a = buckets.get(k)
        if (a) a.push(it.id)
        else buckets.set(k, [it.id])
      }
    }
  }
  return {
    cell,
    count,
    query(rect) {
      const x0 = Math.floor(rect.x / cell)
      const y0 = Math.floor(rect.y / cell)
      const x1 = Math.floor((rect.x + rect.w) / cell)
      const y1 = Math.floor((rect.y + rect.h) / cell)
      const seen = new Set<string>()
      const out: string[] = []
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const a = buckets.get(cx + ':' + cy)
          if (!a) continue
          for (const id of a) {
            if (!seen.has(id)) {
              seen.add(id)
              out.push(id)
            }
          }
        }
      }
      return out
    }
  }
}
