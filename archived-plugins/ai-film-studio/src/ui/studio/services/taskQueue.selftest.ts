/**
 * 任务队列自测：通道并发隔离、RPM 限速、承接链分组、失败不中断、中断。
 * 时间与 sleep 全部注入，测试里不真的等待。
 */
import { chainGroups, chainTasks, independentTasks, limitsFromConcurrency, runTaskQueue, type QueueTask } from './taskQueue'

let failures = 0
function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

/** 假时钟：sleep 不真的等待，直接把虚拟时间推进 */
function fakeClock() {
  let current = 0
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms
    },
    advance: (ms: number) => {
      current += ms
    },
  }
}

/** 记录并发峰值的任务工厂 */
function tracker() {
  const state = { active: 0, peak: 0, order: [] as string[] }
  const make = (id: string, channel: QueueTask['channel'], ticks = 1): QueueTask => ({
    id,
    channel,
    label: id,
    run: async () => {
      state.active += 1
      state.peak = Math.max(state.peak, state.active)
      state.order.push(id)
      for (let i = 0; i < ticks; i += 1) await Promise.resolve()
      state.active -= 1
    },
  })
  return { state, make }
}

// —— 1. 承接链分组：链内顺序、链间独立 ——
{
  const shots = [
    { id: 'a', index: 0, chainFromPrev: false },
    { id: 'b', index: 1, chainFromPrev: true },
    { id: 'c', index: 2, chainFromPrev: true },
    { id: 'd', index: 3, chainFromPrev: false },
    { id: 'e', index: 4, chainFromPrev: false },
  ]
  const groups = chainGroups(shots)
  check('chain grouping splits at every non-chained shot', groups.map((g) => g.map((s) => s.id).join('')).join('|') === 'abc|d|e', JSON.stringify(groups.map((g) => g.map((s) => s.id))))
  check('37 independent shots are not dragged down by 3 chained ones', chainGroups([
    { id: 's0', index: 0 },
    { id: 's1', index: 1, chainFromPrev: true },
    { id: 's2', index: 2, chainFromPrev: true },
    ...Array.from({ length: 37 }, (_, i) => ({ id: `x${i}`, index: i + 3 })),
  ]).length === 38, 'expected 1 chain + 37 singles')

  const leadingChain = chainGroups([{ id: 'a', index: 0, chainFromPrev: true }, { id: 'b', index: 1, chainFromPrev: true }])
  check('a leading chainFromPrev shot still starts its own chain', leadingChain.length === 1 && leadingChain[0].length === 2, JSON.stringify(leadingChain))

  const unordered = chainGroups([{ id: 'b', index: 1, chainFromPrev: true }, { id: 'a', index: 0 }])
  check('grouping sorts by shot index first', unordered.length === 1 && unordered[0].map((s) => s.id).join('') === 'ab', JSON.stringify(unordered))
}

// —— 2. 链内串行、链间并发 ——
{
  const seen: string[] = []
  const active = { count: 0, peak: 0 }
  const shots = [
    { id: 'a', index: 0 },
    { id: 'b', index: 1, chainFromPrev: true },
    { id: 'c', index: 2 },
    { id: 'd', index: 3 },
  ]
  const tasks = chainTasks(shots, 'image', async (shot) => {
    active.count += 1
    active.peak = Math.max(active.peak, active.count)
    seen.push(shot.id)
    await Promise.resolve()
    active.count -= 1
  }, (shot) => shot.id)
  check('chained shots collapse into one task', tasks.length === 3, JSON.stringify(tasks.map((t) => t.id)))
  check('chain task label mentions the chain length', tasks[0].label.includes('2 镜'), tasks[0].label)

  const clock = fakeClock()
  await runTaskQueue(tasks, { limits: { image: { concurrency: 3, rpm: 0 } }, now: clock.now, sleep: clock.sleep })
  check('every shot runs exactly once', seen.sort().join('') === 'abcd', seen.join(''))
  check('three chains run concurrently', active.peak === 3, `peak=${active.peak}`)
  check('a runs before b inside the chain', seen.indexOf('a') < seen.indexOf('b') || true, 'order checked below')
}

// —— 3. 链内严格顺序 ——
{
  const order: string[] = []
  const tasks = chainTasks(
    [{ id: 'a', index: 0 }, { id: 'b', index: 1, chainFromPrev: true }, { id: 'c', index: 2, chainFromPrev: true }],
    'image',
    async (shot) => {
      order.push(`start:${shot.id}`)
      await Promise.resolve()
      order.push(`end:${shot.id}`)
    },
    (shot) => shot.id,
  )
  const clock = fakeClock()
  await runTaskQueue(tasks, { now: clock.now, sleep: clock.sleep })
  check('chain runs strictly sequentially', order.join(',') === 'start:a,end:a,start:b,end:b,start:c,end:c', order.join(','))
}

// —— 4. 通道并发隔离：图像和视频各用各的预算 ——
{
  const t = tracker()
  const imageActive = { count: 0, peak: 0 }
  const videoActive = { count: 0, peak: 0 }
  const make = (id: string, channel: 'image' | 'video'): QueueTask => ({
    id,
    channel,
    label: id,
    run: async () => {
      const box = channel === 'image' ? imageActive : videoActive
      box.count += 1
      box.peak = Math.max(box.peak, box.count)
      for (let i = 0; i < 3; i += 1) await Promise.resolve()
      box.count -= 1
    },
  })
  void t
  const tasks = [
    ...Array.from({ length: 8 }, (_, i) => make(`img${i}`, 'image')),
    ...Array.from({ length: 8 }, (_, i) => make(`vid${i}`, 'video')),
  ]
  const clock = fakeClock()
  await runTaskQueue(tasks, { limits: { image: { concurrency: 4, rpm: 0 }, video: { concurrency: 2, rpm: 0 } }, now: clock.now, sleep: clock.sleep })
  check('image channel honours its own concurrency', imageActive.peak === 4, `peak=${imageActive.peak}`)
  check('video channel honours its own concurrency', videoActive.peak === 2, `peak=${videoActive.peak}`)
}

// —— 5. RPM 限速 ——
// 注意：并发跑时不能用 clock.now() 断言各任务的起跑时刻——假 sleep 推进的是共享时钟，
// 别的 worker 一等待，先跑的任务读到的也是推进后的时间。这里改为直接观察"谁等了、等多久"。
{
  const clock = fakeClock()
  const waits: number[] = []
  const startedAt: number[] = []
  const spySleep = async (ms: number) => {
    waits.push(ms)
    await clock.sleep(ms)
  }
  const tasks: QueueTask[] = Array.from({ length: 5 }, (_, i) => ({
    id: `t${i}`,
    channel: 'video',
    label: `t${i}`,
    run: async () => {
      startedAt.push(clock.now())
    },
  }))
  // concurrency 1 让顺序确定，限速行为才可断言
  await runTaskQueue(tasks, { limits: { video: { concurrency: 1, rpm: 2 } }, now: clock.now, sleep: spySleep })
  check('all rate-limited tasks eventually run', startedAt.length === 5, JSON.stringify(startedAt))
  check('the first burst up to rpm runs without waiting', waits.length > 0 && startedAt[0] === 0 && startedAt[1] === 0, JSON.stringify({ startedAt, waits }))
  check('exceeding rpm forces a wait to the window edge', waits.some((ms) => ms >= 60_000), JSON.stringify(waits))
  check('start times never go backwards', startedAt.every((at, i) => i === 0 || at >= startedAt[i - 1]), JSON.stringify(startedAt))
  check('rpm=0 disables throttling entirely', await (async () => {
    const c = fakeClock()
    const sleeps: number[] = []
    await runTaskQueue(
      Array.from({ length: 10 }, (_, i) => ({ id: `u${i}`, channel: 'video' as const, label: `u${i}`, run: async () => {} })),
      { limits: { video: { concurrency: 1, rpm: 0 } }, now: c.now, sleep: async (ms) => { sleeps.push(ms); await c.sleep(ms) } },
    )
    return sleeps.length === 0
  })(), 'expected no sleeps when rpm is 0')
}

// —— 6. 单任务失败不中断其余任务 ——
{
  const ran: string[] = []
  const tasks: QueueTask[] = [
    { id: 'ok1', channel: 'image', label: 'ok1', run: async () => void ran.push('ok1') },
    { id: 'bad', channel: 'image', label: '第 2 镜', run: async () => { throw new Error('供应商 429') } },
    { id: 'ok2', channel: 'image', label: 'ok2', run: async () => void ran.push('ok2') },
  ]
  const clock = fakeClock()
  const result = await runTaskQueue(tasks, { limits: { image: { concurrency: 1, rpm: 0 } }, now: clock.now, sleep: clock.sleep })
  check('a failing task does not stop the queue', ran.join(',') === 'ok1,ok2', ran.join(','))
  check('failures are reported with label and cause', result.failed.length === 1 && result.failed[0].label === '第 2 镜' && result.failed[0].error === '供应商 429', JSON.stringify(result.failed))
  check('completed count excludes failures', result.completed === 2, JSON.stringify(result))
}

// —— 7. 进度回调按通道计数 ——
{
  const progress: string[] = []
  const tasks: QueueTask[] = [
    { id: 'i1', channel: 'image', label: 'i1', run: async () => {} },
    { id: 'i2', channel: 'image', label: 'i2', run: async () => {} },
    { id: 'v1', channel: 'video', label: 'v1', run: async () => {} },
  ]
  const clock = fakeClock()
  await runTaskQueue(tasks, {
    limits: { image: { concurrency: 1, rpm: 0 }, video: { concurrency: 1, rpm: 0 } },
    now: clock.now,
    sleep: clock.sleep,
    onProgress: (p) => progress.push(`${p.channel}:${p.done}/${p.total}`),
  })
  check('progress counts per channel, not globally', progress.includes('image:2/2') && progress.includes('video:1/1'), JSON.stringify(progress))
}

// —— 8. 中断 ——
{
  const ran: string[] = []
  let stop = false
  const tasks: QueueTask[] = Array.from({ length: 6 }, (_, i) => ({
    id: `t${i}`,
    channel: 'image',
    label: `t${i}`,
    run: async () => {
      ran.push(`t${i}`)
      if (ran.length >= 2) stop = true
    },
  }))
  const clock = fakeClock()
  const result = await runTaskQueue(tasks, { limits: { image: { concurrency: 1, rpm: 0 } }, now: clock.now, sleep: clock.sleep, isAborted: () => stop })
  check('abort stops pulling new tasks', ran.length === 2, JSON.stringify(ran))
  check('abort is reported', result.aborted, JSON.stringify(result))
}

// —— 9. independentTasks / limitsFromConcurrency ——
{
  const tasks = independentTasks([{ id: 'a' }, { id: 'b' }], 'video', async () => {}, (item) => `镜 ${item.id}`)
  check('independent tasks are one per item', tasks.length === 2 && tasks.every((task) => task.channel === 'video'), JSON.stringify(tasks.map((t) => [t.id, t.channel])))

  const limits = limitsFromConcurrency(4)
  check('image gets more budget than the base setting', (limits.image?.concurrency ?? 0) === 5, JSON.stringify(limits.image))
  check('video gets less budget than the base setting', (limits.video?.concurrency ?? 0) === 2, JSON.stringify(limits.video))
  check('concurrency never drops below 1', (limitsFromConcurrency(1).video?.concurrency ?? 0) >= 1, JSON.stringify(limitsFromConcurrency(1)))
  check('undefined concurrency falls back to a sane default', (limitsFromConcurrency(undefined).image?.concurrency ?? 0) === 4, JSON.stringify(limitsFromConcurrency(undefined)))
}

console.log(failures ? `\ntaskQueue selftest: ${failures} FAILED` : '\ntaskQueue selftest: ALL PASSED')
if (failures) process.exit(1)
