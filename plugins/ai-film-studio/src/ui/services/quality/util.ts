/**
 * 质量护栏共用纯函数统计工具。无任何运行时依赖，可独立单测。
 *
 * 设计来源：借鉴 OpenMontage（AGPLv3）反幻灯片/结构变化检测「确定性、零 LLM、纯数组运算」的**思路**，
 * 全部用 TypeScript 自研重写——不拷贝其任何源代码/文本。详见 docs/openmontage-borrowings.md。
 */

/** part/whole，whole 为 0 时返回 0（避免 NaN 污染评分） */
export function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0
}

/** 按 key 计数（忽略空键） */
export function countBy<T>(items: T[], key: (x: T) => string | undefined): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    if (k == null || k === '') continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

/** 出现最多的键及其计数 */
export function topCount(counts: Map<string, number>): { key?: string; count: number } {
  let key: string | undefined
  let count = 0
  for (const [k, c] of counts) if (c > count) { key = k; count = c }
  return { key, count }
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** 总体标准差（n<2 返回 0） */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)))
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** 保留 1 位小数 */
export function round1(x: number): number {
  return Math.round(x * 10) / 10
}

export function pct(x: number): number {
  return Math.round(x * 100)
}
