// 小工具（纯前端，无第三方依赖）

export function uid(prefix = ''): string {
  const c = (globalThis as any).crypto
  const r =
    c && typeof c.randomUUID === 'function'
      ? c.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return prefix ? `${prefix}_${r}` : r
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

// IME 组合期判定：中文/日文等输入法拼字未上屏时，Enter/Escape 等 keydown 会先于「确认候选词」触发，
// 若不忽略会把半截拼音提交/把输入框关掉。React 合成事件读 nativeEvent.isComposing；229 为旧浏览器兜底。
// 兼容原生 window KeyboardEvent（直接带 isComposing）与 React 合成事件（isComposing 在 nativeEvent 上）。
export function isImeComposing(e: { nativeEvent?: { isComposing?: boolean }; isComposing?: boolean; keyCode?: number }): boolean {
  return !!(e.nativeEvent?.isComposing ?? e.isComposing) || e.keyCode === 229
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null
  const wrapped = ((...args: any[]) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T & { cancel: () => void }
  wrapped.cancel = () => {
    if (t) clearTimeout(t)
    t = null
  }
  return wrapped
}

// 简单并发限流（替代 p-limit）；额外暴露 pending()/active() 供任务中心读取排队信息
export type Limiter = (<T>(task: () => Promise<T>) => Promise<T>) & { pending: () => number; active: () => number }

export function createLimiter(concurrency: number | (() => number)): Limiter {
  const getMax = typeof concurrency === 'function' ? concurrency : () => concurrency
  let active = 0
  const queue: Array<() => void> = []
  const pump = () => {
    while (active < getMax() && queue.length > 0) {
      const job = queue.shift()!
      active++
      job()
    }
  }
  const run = function <T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--
            pump()
          })
      })
      pump()
    })
  } as Limiter
  run.pending = () => queue.length
  run.active = () => active
  return run
}

export async function blobUrlToArrayBuffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url)
  return await resp.arrayBuffer()
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[])
  }
  return btoa(bin)
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
