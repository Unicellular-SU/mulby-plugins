/**
 * Toonflow 式重构 · 批量并发池（§3.5/§5.6）：最多 concurrency 个任务同时跑，加速「全部生成」。
 *
 * 安全性：projectStore.mutate 是同步的且每次读最新 doc（各 generate* 用 find-by-id 回写），
 * 故并发的异步任务各自 await 后再 mutate 不会丢更新。承接(chainFromPrev)类需顺序的，调用方传 concurrency=1。
 */
export async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  onTick?: (done: number, total: number) => void
): Promise<void> {
  const total = items.length
  if (!total) return
  const c = Math.min(Math.max(1, Math.floor(concurrency) || 1), total)
  let next = 0
  let done = 0
  async function worker(): Promise<void> {
    while (next < total) {
      const idx = next++
      try {
        await fn(items[idx], idx)
      } catch {
        // 单任务失败不中断整体（各 generate* 内部已落失败态）
      }
      done++
      onTick?.(done, total)
    }
  }
  await Promise.all(Array.from({ length: c }, () => worker()))
}
