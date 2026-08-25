/**
 * 经 mulby.http 的 JSON 请求与 JSON 路径提取工具（供视频适配器使用）。
 * mulby.http 走主进程代理，无 CORS 问题。
 */

export async function httpJson(opts: {
  url: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
}): Promise<unknown> {
  const http = window.mulby?.http
  if (!http?.request) throw new Error('Mulby HTTP 不可用')
  const res = await http.request({
    url: opts.url,
    method: opts.method || 'GET',
    headers: opts.headers,
    body: opts.body,
    timeout: 60000,
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`HTTP ${res.status} ${res.statusText || ''} ${String(res.data || '').slice(0, 200)}`)
  }
  if (!res.data) return {}
  try {
    return JSON.parse(res.data)
  } catch {
    return res.data
  }
}

/** 取 JSON 路径，如 "data.video.url" / "videos.0.url" */
export function getPath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) cur = cur[Number(seg)]
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[seg]
    else return undefined
  }
  return cur
}

/** 依次尝试多个候选路径，返回第一个非空字符串 */
export function firstString(obj: unknown, paths: string[]): string {
  for (const p of paths) {
    const v = getPath(obj, p)
    if (typeof v === 'string' && v) return v
    if (typeof v === 'number') return String(v)
  }
  return ''
}
