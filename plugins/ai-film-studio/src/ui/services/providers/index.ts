/**
 * 视频引擎：选择适配器并跑完整三段式（submit → 轮询 → 取地址）。
 * 轮询 ~2s 起步、退避至 5s；默认超时 300s；支持轮询间中断。
 */
import { falAdapter } from './fal'
import { customHttpAdapter } from './customHttp'
import type { VideoProviderAdapter, VideoProviderConfig, VideoGenRequest } from './types'

export * from './types'

export function getAdapter(kind: VideoProviderConfig['kind']): VideoProviderAdapter {
  switch (kind) {
    case 'fal':
      return falAdapter
    case 'custom-http':
      return customHttpAdapter
    default:
      throw new Error(`不支持的供应商类型：${kind}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let aborted = false
export function abortVideo() {
  aborted = true
}

export interface VideoEngineOptions {
  cfg: VideoProviderConfig
  apiKey: string
  req: VideoGenRequest
  timeoutMs?: number
  onProgress?: (p: { status: string; progress?: number }) => void
}

export async function runVideo(opts: VideoEngineOptions): Promise<{ url: string }> {
  aborted = false
  const adapter = getAdapter(opts.cfg.kind)
  const timeout = opts.timeoutMs ?? 300000

  opts.onProgress?.({ status: 'submitting' })
  const handle = await adapter.submit(opts.req, opts.cfg, opts.apiKey)

  const start = Date.now()
  let delay = 2000
  for (;;) {
    if (aborted) throw new Error('已取消')
    await sleep(delay)
    if (aborted) throw new Error('已取消')

    const r = await adapter.poll(handle, opts.cfg, opts.apiKey)
    opts.onProgress?.({ status: r.status, progress: r.progress })

    if (r.status === 'completed') {
      if (!r.videoUrl) throw new Error('未返回视频地址')
      return { url: r.videoUrl }
    }
    if (r.status === 'failed') throw new Error(r.error || '视频生成失败')
    if (Date.now() - start > timeout) throw new Error('视频生成超时')
    delay = Math.min(Math.round(delay * 1.2), 5000)
  }
}
