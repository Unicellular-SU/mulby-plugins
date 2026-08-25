/**
 * 分集断点的纯逻辑（无宿主依赖，可单测）。
 * 调用模型的那一层在 `studio/services/novel.ts`。
 */

export interface PlannedEpisodeBreak {
  title: string
  summary: string
  /** 0-based 章节下标 */
  chapterIndexes: number[]
}

/**
 * 章节序号连续、不重叠、全覆盖。
 * 模型很容易漏章、把同一章分给两集、或给出越界序号——漏章意味着原著内容凭空消失，
 * 所以这里宁可把孤儿章节挂到相邻集，也不能让它掉出流水线。
 */
export function normalizeEpisodeBreaks(raw: PlannedEpisodeBreak[], chapterCount: number): PlannedEpisodeBreak[] {
  const taken = new Set<number>()
  const cleaned: PlannedEpisodeBreak[] = []
  for (const item of raw) {
    const indexes = [...new Set(item.chapterIndexes)]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < chapterCount && !taken.has(index))
      .sort((a, b) => a - b)
    if (!indexes.length) continue
    for (const index of indexes) taken.add(index)
    cleaned.push({ title: item.title?.trim() || `第 ${cleaned.length + 1} 集`, summary: item.summary?.trim() || '', chapterIndexes: indexes })
  }

  const missing = Array.from({ length: chapterCount }, (_, index) => index).filter((index) => !taken.has(index))
  for (const index of missing) {
    if (!cleaned.length) {
      cleaned.push({ title: '第 1 集', summary: '', chapterIndexes: [index] })
      continue
    }
    let best = cleaned[0]
    let bestDistance = Infinity
    for (const episode of cleaned) {
      const distance = Math.min(...episode.chapterIndexes.map((item) => Math.abs(item - index)))
      if (distance < bestDistance) {
        bestDistance = distance
        best = episode
      }
    }
    best.chapterIndexes = [...best.chapterIndexes, index].sort((a, b) => a - b)
  }

  return cleaned
    .sort((a, b) => a.chapterIndexes[0] - b.chapterIndexes[0])
    .map((episode, index) => ({ ...episode, title: episode.title || `第 ${index + 1} 集` }))
}

/** 确定性兜底：按目标集数顺序均分（模型不可用或返回无效时使用） */
export function evenEpisodeBreaks(chapterCount: number, episodeCount: number): PlannedEpisodeBreak[] {
  const total = Math.max(1, Math.min(episodeCount, chapterCount || 1))
  const breaks: PlannedEpisodeBreak[] = []
  for (let i = 0; i < total; i += 1) {
    const start = Math.floor((i * chapterCount) / total)
    const end = Math.floor(((i + 1) * chapterCount) / total)
    const chapterIndexes = Array.from({ length: Math.max(0, end - start) }, (_, k) => start + k)
    if (chapterIndexes.length) breaks.push({ title: `第 ${breaks.length + 1} 集`, summary: '', chapterIndexes })
  }
  return breaks
}
