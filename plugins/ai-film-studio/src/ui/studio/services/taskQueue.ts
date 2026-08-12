/**
 * 生成任务队列：按通道分并发 + RPM 限速 + 承接链分组。
 *
 * 取代 `mapPool(items, chained ? 1 : concurrency, ...)`。旧写法有两个问题：
 *
 * 1. **一颗老鼠屎**：只要整集里有**任意一个** `chainFromPrev` 镜头，整批就退化成串行。
 *    40 个镜头里有 3 个承接镜，其余 37 个也被迫排队。承接约束只存在于链**内部**，
 *    链与链之间完全独立，应该并发。
 * 2. **图像和视频抢同一个并发预算**：两者的供应商、速率限制和单次耗时差一个数量级，
 *    共用一个数字必然是"对图像太慢、对视频太快"。
 *
 * 这里按 image/video/audio/text 分独立通道，每个通道有自己的并发数和每分钟请求上限。
 * 队列本身不认识业务，只调度 `() => Promise<void>`；业务侧把承接链压成一个任务即可。
 */

export type QueueChannel = 'image' | 'video' | 'audio' | 'text'

export interface ChannelLimit {
  /** 同时在跑的任务数 */
  concurrency: number
  /** 每分钟最多发起多少个任务；<=0 表示不限 */
  rpm?: number
}

export type QueueLimits = Partial<Record<QueueChannel, ChannelLimit>>

export const DEFAULT_LIMITS: Record<QueueChannel, ChannelLimit> = {
  // 图像便宜且快，可以铺开；视频贵、慢、供应商限流严，压到 2
  image: { concurrency: 4, rpm: 60 },
  video: { concurrency: 2, rpm: 12 },
  audio: { concurrency: 3, rpm: 60 },
  text: { concurrency: 3, rpm: 60 },
}

export interface QueueTask {
  id: string
  channel: QueueChannel
  /** 展示用标签，进度回调里回传 */
  label: string
  run: () => Promise<void>
}

export interface QueueProgress {
  channel: QueueChannel
  done: number
  total: number
  label: string
  /** 该任务是否抛错；队列不因单点失败停摆 */
  failed?: boolean
  error?: string
}

export interface QueueResult {
  completed: number
  failed: { id: string; label: string; error: string }[]
  aborted: boolean
}

export interface RunQueueOptions {
  limits?: QueueLimits
  onProgress?: (progress: QueueProgress) => void
  isAborted?: () => boolean
  /** 注入便于自测：默认 Date.now / setTimeout */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 滑动窗口限速器：记录最近一分钟的发起时刻，超额就等到最早那次滚出窗口 */
class RateLimiter {
  private readonly stamps: number[] = []

  constructor(
    private readonly rpm: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  async acquire(): Promise<void> {
    if (this.rpm <= 0) return
    for (;;) {
      const cutoff = this.now() - 60_000
      while (this.stamps.length && this.stamps[0] <= cutoff) this.stamps.shift()
      if (this.stamps.length < this.rpm) {
        this.stamps.push(this.now())
        return
      }
      // 等最早那次请求滚出 60s 窗口；+50ms 防抖动导致空转
      await this.sleep(Math.max(1, this.stamps[0] - cutoff + 50))
    }
  }
}

/**
 * 跑一批任务。同通道内受并发和 RPM 限制，不同通道完全并行。
 * 单个任务失败只记录不中断——一镜出错不该让另外 39 镜白等。
 */
export async function runTaskQueue(tasks: QueueTask[], options: RunQueueOptions = {}): Promise<QueueResult> {
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? defaultSleep
  const isAborted = options.isAborted ?? (() => false)
  const failed: QueueResult['failed'] = []
  let completed = 0
  let aborted = false

  const byChannel = new Map<QueueChannel, QueueTask[]>()
  for (const task of tasks) byChannel.set(task.channel, [...(byChannel.get(task.channel) ?? []), task])

  await Promise.all(
    [...byChannel.entries()].map(async ([channel, channelTasks]) => {
      const limit = { ...DEFAULT_LIMITS[channel], ...(options.limits?.[channel] ?? {}) }
      const limiter = new RateLimiter(limit.rpm ?? 0, now, sleep)
      const total = channelTasks.length
      let next = 0
      let done = 0

      const worker = async (): Promise<void> => {
        for (;;) {
          if (isAborted()) {
            aborted = true
            return
          }
          const index = next
          if (index >= total) return
          next += 1
          const task = channelTasks[index]
          await limiter.acquire()
          if (isAborted()) {
            aborted = true
            return
          }
          try {
            await task.run()
            completed += 1
            done += 1
            options.onProgress?.({ channel, done, total, label: task.label })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            failed.push({ id: task.id, label: task.label, error: message })
            done += 1
            options.onProgress?.({ channel, done, total, label: task.label, failed: true, error: message })
          }
        }
      }

      const workers = Math.min(Math.max(1, Math.floor(limit.concurrency) || 1), total)
      await Promise.all(Array.from({ length: workers }, () => worker()))
    }),
  )

  return { completed, failed, aborted }
}

// —— 承接链分组 ——

export interface ChainableShot {
  id: string
  index: number
  chainFromPrev?: boolean
}

/**
 * 把分镜按承接关系切成若干条链。链**内部**必须顺序执行（后一镜要用前一镜的产物作参考），
 * 链**之间**互不依赖，可以并发。
 *
 * `chainFromPrev` 表示"承接上一镜"，所以每遇到一个 false 就开一条新链。
 */
export function chainGroups<T extends ChainableShot>(shots: T[]): T[][] {
  const sorted = [...shots].sort((a, b) => a.index - b.index)
  const groups: T[][] = []
  for (const shot of sorted) {
    // 首镜即使标了 chainFromPrev 也没有可承接的对象，单独起链
    if (!shot.chainFromPrev || !groups.length) groups.push([shot])
    else groups[groups.length - 1].push(shot)
  }
  return groups
}

/**
 * 把承接链压成队列任务：一条链 = 一个任务，任务内部串行跑完整条链。
 * 于是"链内顺序、链间并发"这件事不需要队列理解业务，靠任务粒度就表达完了。
 */
export function chainTasks<T extends ChainableShot>(
  shots: T[],
  channel: QueueChannel,
  run: (shot: T) => Promise<void>,
  label: (shot: T) => string,
): QueueTask[] {
  return chainGroups(shots).map((group) => ({
    id: `chain:${group[0].id}`,
    channel,
    label: group.length > 1 ? `${label(group[0])} 等 ${group.length} 镜（承接链）` : label(group[0]),
    run: async () => {
      for (const shot of group) await run(shot)
    },
  }))
}

/** 独立任务（无承接关系）：一镜一任务，全部可并发 */
export function independentTasks<T extends { id: string }>(
  items: T[],
  channel: QueueChannel,
  run: (item: T) => Promise<void>,
  label: (item: T) => string,
): QueueTask[] {
  return items.map((item) => ({ id: item.id, channel, label: label(item), run: () => run(item) }))
}

/** 从项目并发设置推导各通道限制；用户设的是"总体强度"，这里按通道特性放大/收缩 */
export function limitsFromConcurrency(concurrency: number | undefined): QueueLimits {
  const base = Math.max(1, Math.floor(concurrency ?? 3))
  return {
    image: { concurrency: Math.max(1, base + 1), rpm: DEFAULT_LIMITS.image.rpm },
    video: { concurrency: Math.max(1, Math.ceil(base / 2)), rpm: DEFAULT_LIMITS.video.rpm },
    audio: { concurrency: base, rpm: DEFAULT_LIMITS.audio.rpm },
    text: { concurrency: base, rpm: DEFAULT_LIMITS.text.rpm },
  }
}
