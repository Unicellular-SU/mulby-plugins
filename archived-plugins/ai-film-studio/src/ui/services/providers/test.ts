/**
 * 视频供应商连通性自测：用一次轻量请求校验「端点可达 + Key 是否被接受」，
 * 不真正提交生成任务（不产生费用）。鉴权一般先于路由，401/403 即判定 Key 无效。
 */
import type { VideoProviderConfig } from './types'

export interface ProviderTestResult {
  ok: boolean
  message: string
}

const FAL_QUEUE = 'https://queue.fal.run'

async function probe(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number } | { error: string }> {
  const http = window.mulby?.http
  if (!http?.request) return { error: 'Mulby HTTP 不可用' }
  try {
    const res = await http.request({ url, method: 'GET', headers, timeout: 15000 })
    return { status: res.status }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

export async function testVideoProvider(
  cfg: VideoProviderConfig,
  apiKey: string
): Promise<ProviderTestResult> {
  if (cfg.kind === 'fal') {
    if (!apiKey) return { ok: false, message: '未配置 API Key' }
    if (!cfg.model && !cfg.baseURL) return { ok: false, message: '未设置模型路径' }
    const app = (cfg.baseURL?.trim() || `${FAL_QUEUE}/${(cfg.model || '').replace(/^\//, '')}`).replace(/\/$/, '')
    const url = `${app}/requests/connectivity-test/status`
    const r = await probe(url, { Authorization: `Key ${apiKey}` })
    if ('error' in r) return { ok: false, message: `无法连接：${r.error}` }
    if (r.status === 401 || r.status === 403) return { ok: false, message: `Key 无效或无权限（HTTP ${r.status}）` }
    return { ok: true, message: `连通，Key 已被接受（HTTP ${r.status}）` }
  }

  // custom-http
  const target = (cfg.pollUrl || cfg.submitUrl || '').replace('{taskId}', 'connectivity-test')
  if (!target) return { ok: false, message: '未设置 提交/轮询 URL' }
  const headers: Record<string, string> = {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(cfg.headers || {}),
  }
  const r = await probe(target, headers)
  if ('error' in r) return { ok: false, message: `无法连接：${r.error}` }
  if (r.status === 401 || r.status === 403) return { ok: false, message: `鉴权失败（HTTP ${r.status}）` }
  return { ok: true, message: `端点可达（HTTP ${r.status}）` }
}
