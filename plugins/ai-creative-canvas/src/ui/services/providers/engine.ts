import type { ProviderConfig } from './types'
import { toFileUrl } from '../media'
import { PLUGIN_ID } from '../persistence'

function http() {
  return window.mulby.http
}
function host() {
  return window.mulby.host
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
function parse(s: any): any {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s
  } catch {
    return s
  }
}
function jget(obj: any, path?: string): any {
  if (!obj || !path) return undefined
  let cur = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg]
  }
  return cur
}
function setPath(obj: any, path: string, val: any): void {
  const segs = path.split('.')
  let cur = obj
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i]
    if (typeof cur[k] !== 'object' || cur[k] == null) cur[k] = {}
    cur = cur[k]
  }
  cur[segs[segs.length - 1]] = val
}

// 经 mulby.http.request 发请求并显式给足超时（视频提交/轮询都很慢，.post/.get 快捷方法默认超时太短会报 Request timeout）
async function httpReq(url: string, method: 'GET' | 'POST', headers: any, body: any, timeoutMs: number): Promise<{ status: number; data: any }> {
  const h = http()
  if (h?.request) {
    const r = await h.request({ url, method, headers, body, timeout: timeoutMs })
    return { status: r.status, data: r.data }
  }
  return method === 'POST' ? await h.post(url, body, headers) : await h.get(url, headers)
}

// 上游聚合网关常因拉取超时瞬时失败（cURL error 28 / fail_to_fetch_task / 5xx）
function transient(r: { status: number; data: any }): boolean {
  if ([408, 429, 500, 502, 503, 504].includes(r.status)) return true
  return /timed out|timeout|fail_to_fetch|bad gateway|gateway timeout/i.test(String(r.data ?? ''))
}
// 提交带退避重试：这类瞬时上游超时重试几次往往能过
async function submitWithRetry(url: string, headers: any, body: any, timeoutMs: number): Promise<{ status: number; data: any }> {
  let resp = await httpReq(url, 'POST', headers, body, timeoutMs)
  for (let i = 0; i < 2 && resp.status >= 400 && transient(resp); i++) {
    await sleep(3000)
    resp = await httpReq(url, 'POST', headers, body, timeoutMs)
  }
  return resp
}

export interface VideoReq {
  prompt: string
  imageDataUrl?: string
  lastImageDataUrl?: string // 首帧/尾帧模式的尾帧
  model?: string // 节点级模型覆盖（优先于 cfg.model）
  params?: Record<string, unknown>
}

// 把值转义为 JSON 字符串内容（去外层引号）；纯数字串无特殊字符故原样，"duration":{duration} 仍是裸数字
function jsonEsc(s: string): string {
  return JSON.stringify(s).slice(1, -1)
}

// 模板渲染：{?x}…{/x} 条件（可嵌套）+ {x} 替换（值做 JSON 转义，避免提示词换行/引号破坏 JSON）
function renderTemplate(tpl: string, vars: Record<string, string | undefined>): string {
  let out = tpl
  let prev: string
  const cond = /\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g
  do {
    prev = out
    out = out.replace(cond, (_m, k, inner) => (vars[k] ? inner : ''))
  } while (out !== prev)
  return out.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] != null ? jsonEsc(String(vars[k])) : ''))
}

// 仅轮询模板型(pollUrl/{taskId})任务（不提交）——供首次提交后轮询 + 断点续跑复用；返回结果 URL
async function pollTaskTemplate(cfg: ProviderConfig, headers: any, taskId: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<string> {
  const interval = cfg.pollIntervalMs || 3000
  const timeout = cfg.timeoutMs || 600000
  const done = (cfg.doneValues || 'completed,succeeded,success').split(',').map((s) => s.trim().toLowerCase())
  const fail = (cfg.failValues || 'failed,error,cancelled').split(',').map((s) => s.trim().toLowerCase())
  const startedAt = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new Error('已取消(aborted)')
    if (Date.now() - startedAt > timeout) throw new Error('生成超时')
    await sleep(interval)
    if (signal?.aborted) throw new Error('已取消(aborted)')
    let sr: { status: number; data: any }
    try { sr = await httpReq((cfg.pollUrl as string).replace('{taskId}', taskId), 'GET', headers, undefined, 60000) } catch { continue } // 瞬时网络抖动：跳过本次，下一周期再试（不回拨进度）
    if (transient(sr)) continue // 网关瞬时错误：重试，不放弃整任务
    const sd = parse(sr.data)
    const url = jget(sd, cfg.videoUrlPath)
    if (url) return url
    const st = String(jget(sd, cfg.statusField) ?? '').toLowerCase()
    onProgress?.(0.5)
    if (st && fail.includes(st)) throw new Error('生成失败：' + st)
    // 已完成但 videoUrlPath 取不到 URL → 大概率是路径配错，立即快速失败而非空转到超时（与 pollTaskDefault 一致）
    if (st && done.includes(st)) throw new Error('任务已完成但未取到结果 URL（请检查 Provider 的 videoUrlPath 配置）')
  }
}

// 仅轮询默认(idPath/statusPath/{id})任务（不提交）——供首次提交后轮询 + 断点续跑复用；返回结果 URL
async function pollTaskDefault(cfg: ProviderConfig, headers: any, base: string, taskId: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<string> {
  const interval = cfg.pollIntervalMs || 2000
  const timeout = cfg.timeoutMs || 600000
  const done = (cfg.doneValues || 'completed,succeeded,success').split(',').map((s) => s.trim().toLowerCase())
  const fail = (cfg.failValues || 'failed,error,cancelled').split(',').map((s) => s.trim().toLowerCase())
  const startedAt = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) throw new Error('已取消(aborted)')
    if (Date.now() - startedAt > timeout) throw new Error('生成超时')
    await sleep(interval)
    if (signal?.aborted) throw new Error('已取消(aborted)')
    const statusUrl = base + (cfg.statusPath || '').replace('{id}', taskId)
    let sr: { status: number; data: any }
    try { sr = await httpReq(statusUrl, 'GET', headers, undefined, 60000) } catch { continue } // 瞬时网络抖动：跳过本次，下一周期再试（不回拨进度）
    if (transient(sr)) continue // 网关瞬时错误：重试，不放弃整任务
    const sd = parse(sr.data)
    let url = jget(sd, cfg.resultPath)
    if (url) return url
    const st = String(jget(sd, cfg.statusField) ?? '').toLowerCase()
    onProgress?.(0.5)
    if (st && fail.includes(st)) throw new Error('生成失败：' + st)
    if (st && done.includes(st)) {
      url = jget(sd, cfg.resultPath)
      if (url) return url
      throw new Error('已完成但未找到结果 URL（检查 resultPath）')
    }
  }
}

// 断点续跑：仅凭已持久化的 taskId 重新轮询在途视频任务（不重新提交），返回结果 URL
export async function resumeVideoJob(cfg: ProviderConfig, key: string, taskId: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<{ url: string }> {
  if (cfg.bodyTemplate && cfg.submitUrl) {
    if (!cfg.pollUrl) throw new Error('该视频 Provider 未配置 pollUrl，无法断点续跑')
    const headers: any = { 'Content-Type': 'application/json', ...(cfg.headers || {}) }
    if (key) headers['Authorization'] = `Bearer ${key}`
    return { url: await pollTaskTemplate(cfg, headers, taskId, onProgress, signal) }
  }
  if (!cfg.statusPath) throw new Error('该视频 Provider 未配置 statusPath，无法断点续跑')
  const headers: any = { 'Content-Type': 'application/json' }
  if (key) headers['Authorization'] = `Bearer ${key}`
  const base = cfg.baseURL.replace(/\/$/, '')
  return { url: await pollTaskDefault(cfg, headers, base, taskId, onProgress, signal) }
}

// 声明式模板路径：bodyTemplate + submitUrl/pollUrl/taskIdPath/statusField/videoUrlPath。
// 仅提交、拿到 url/taskId 即返回（轮询交给 resumeVideoJob，二者同一 pollTaskTemplate 路径）。
async function submitViaTemplate(cfg: ProviderConfig, key: string, req: VideoReq, onProgress?: (p: number) => void, onTask?: (taskId: string) => void): Promise<{ url?: string; taskId?: string }> {
  let imageUrl: string | undefined
  if (req.imageDataUrl) {
    if (cfg.uploadUrl) {
      const b64 = req.imageDataUrl.includes(',') ? req.imageDataUrl.split(',')[1] : req.imageDataUrl
      const r = (await host().call(PLUGIN_ID, 'uploadImageToHost', { uploadUrl: cfg.uploadUrl, apiKey: key, base64: b64, field: cfg.uploadField, urlPath: cfg.uploadUrlPath })) as { data?: { url?: string; error?: string } }
      const u = r?.data?.url
      if (!u) throw new Error('图片上传失败：' + (r?.data?.error || '检查 uploadUrl'))
      imageUrl = u
    } else {
      imageUrl = req.imageDataUrl
    }
  }
  let lastImageUrl: string | undefined
  if (req.lastImageDataUrl) {
    if (cfg.uploadUrl) {
      const b64 = req.lastImageDataUrl.includes(',') ? req.lastImageDataUrl.split(',')[1] : req.lastImageDataUrl
      const r = (await host().call(PLUGIN_ID, 'uploadImageToHost', { uploadUrl: cfg.uploadUrl, apiKey: key, base64: b64, field: cfg.uploadField, urlPath: cfg.uploadUrlPath })) as { data?: { url?: string; error?: string } }
      lastImageUrl = r?.data?.url || undefined
    } else {
      lastImageUrl = req.lastImageDataUrl
    }
  }
  const vars: Record<string, string | undefined> = {
    prompt: req.prompt,
    model: req.model || cfg.model,
    imageUrl,
    lastImageUrl,
    noImage: imageUrl ? undefined : '1' // 用于「仅文生视频才出现」的字段，如 {?noImage}"aspect_ratio":…{/noImage}
  }
  if (req.params) for (const [k, v] of Object.entries(req.params)) if (v != null) vars[k] = String(v)
  const bodyStr = renderTemplate(cfg.bodyTemplate as string, vars)
  let body: any
  try {
    body = JSON.parse(bodyStr)
  } catch {
    throw new Error('请求体模板渲染后不是合法 JSON：' + bodyStr.slice(0, 200))
  }
  const headers: any = { 'Content-Type': 'application/json', ...(cfg.headers || {}) }
  if (key) headers['Authorization'] = `Bearer ${key}`
  onProgress?.(0.1)
  const resp = await submitWithRetry(cfg.submitUrl as string, headers, body, cfg.timeoutMs || 600000)
  if (resp.status >= 400) throw new Error(`提交失败 HTTP ${resp.status}: ${String(resp.data).slice(0, 200)}`)
  const data = parse(resp.data)
  const url = jget(data, cfg.videoUrlPath)
  const taskId = jget(data, cfg.taskIdPath)
  if (taskId) onTask?.(String(taskId))
  return { url: typeof url === 'string' ? url : undefined, taskId: taskId ? String(taskId) : undefined }
}

// 默认路径：提交视频任务、拿到 url/taskId 即返回（轮询交给 resumeVideoJob 的 pollTaskDefault）。
async function submitDefault(cfg: ProviderConfig, key: string, req: VideoReq, onProgress?: (p: number) => void, onTask?: (taskId: string) => void): Promise<{ url?: string; taskId?: string }> {
  const body: any = {}
  if (cfg.extraBody && cfg.extraBody.trim()) {
    try {
      Object.assign(body, JSON.parse(cfg.extraBody))
    } catch {
      throw new Error('额外请求体不是合法 JSON')
    }
  }
  if (req.params) Object.assign(body, req.params) // 节点参数（时长/比例等）合并入请求体
  setPath(body, cfg.promptField || 'prompt', req.prompt)

  if (req.imageDataUrl && cfg.imageField && cfg.imageMode && cfg.imageMode !== 'none') {
    if (cfg.imageMode === 'dataurl') {
      setPath(body, cfg.imageField, req.imageDataUrl)
    } else {
      // 上传图床换公网 URL（后端 multipart）
      const b64 = req.imageDataUrl.includes(',') ? req.imageDataUrl.split(',')[1] : req.imageDataUrl
      const r = (await host().call(PLUGIN_ID, 'uploadImageToHost', {
        uploadUrl: cfg.uploadUrl,
        apiKey: key,
        base64: b64,
        field: cfg.uploadField,
        urlPath: cfg.uploadUrlPath
      })) as { data?: { url?: string; error?: string } }
      const url = r?.data?.url
      if (!url) throw new Error('图片上传失败：' + (r?.data?.error || '未配置 uploadUrl'))
      setPath(body, cfg.imageField, url)
    }
  }

  const headers: any = { 'Content-Type': 'application/json' }
  if (key) headers['Authorization'] = `Bearer ${key}`

  const base = cfg.baseURL.replace(/\/$/, '')
  const submitUrl = base + (cfg.submitPath || '')
  onProgress?.(0.1)
  const resp = await submitWithRetry(submitUrl, headers, body, cfg.timeoutMs || 600000)
  if (resp.status >= 400) throw new Error(`提交失败 HTTP ${resp.status}: ${String(resp.data).slice(0, 200)}`)
  const data = parse(resp.data)
  const url = jget(data, cfg.resultPath)
  const taskId = jget(data, cfg.idPath)
  if (taskId) onTask?.(String(taskId))
  return { url: typeof url === 'string' ? url : undefined, taskId: taskId ? String(taskId) : undefined }
}

// 仅提交视频任务、拿到 taskId（或同步 url）即返回，不轮询——供 generate.ts 在并发池内提交、拿到 taskId
// 即释放槽位，轮询交由池外 resumeVideoJob 续跑（长视频不再挂满整个 poll 周期饿死文/图队列，E6）。
export async function submitVideoJob(
  cfg: ProviderConfig,
  key: string,
  req: VideoReq,
  onProgress?: (p: number) => void,
  onTask?: (taskId: string) => void
): Promise<{ url?: string; taskId?: string }> {
  return cfg.bodyTemplate && cfg.submitUrl ? submitViaTemplate(cfg, key, req, onProgress, onTask) : submitDefault(cfg, key, req, onProgress, onTask)
}

// 提交 + 轮询，返回结果媒体 URL（提交与轮询二段复用 submitVideoJob/resumeVideoJob，二者各自分发模板/默认路径）
export async function runVideoJob(
  cfg: ProviderConfig,
  key: string,
  req: VideoReq,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
  onTask?: (taskId: string) => void
): Promise<{ url: string }> {
  const { url, taskId } = await submitVideoJob(cfg, key, req, onProgress, onTask)
  if (url) {
    onProgress?.(0.95)
    return { url }
  }
  if (taskId) {
    const r = await resumeVideoJob(cfg, key, taskId, onProgress, signal)
    onProgress?.(0.95)
    return r
  }
  throw new Error('未获取到结果 URL（检查 taskIdPath/videoUrlPath 或 idPath/statusPath/resultPath 配置）')
}

export async function runTts(
  cfg: ProviderConfig,
  key: string,
  text: string,
  opts?: { voice?: string; speed?: number; format?: string; projectId?: string }
): Promise<{ path: string; url: string; mime: string }> {
  const r = (await host().call(PLUGIN_ID, 'synthSpeech', {
    baseURL: cfg.baseURL,
    apiKey: key,
    model: cfg.ttsModel || 'tts-1',
    voice: opts?.voice || cfg.ttsVoice || 'alloy',
    input: text,
    speed: opts?.speed,
    format: opts?.format || cfg.ttsFormat || 'mp3',
    projectId: opts?.projectId // 落盘到 media/<projectId>，随工程删除清理
  })) as { data?: { ok?: boolean; path: string; mime?: string; error?: string } }
  const d = r?.data
  if (!d?.ok) throw new Error(d?.error || '配音失败')
  return { path: d.path, url: toFileUrl(d.path), mime: d.mime || 'audio/mpeg' }
}

// 连通性探测：对 submitUrl/baseURL 的 origin 发一次 GET（不真正提交任务），报告可达性
export async function testProvider(cfg: ProviderConfig, key: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    let url = cfg.submitUrl || (cfg.baseURL ? cfg.baseURL.replace(/\/$/, '') + (cfg.submitPath || '') : '')
    if (!url) return { ok: false, error: '未配置 URL' }
    try {
      url = new URL(url).origin
    } catch {
      /* 非法 URL 直接用原串 */
    }
    const headers: Record<string, string> = {}
    if (key) headers['Authorization'] = `Bearer ${key}`
    const r = await httpReq(url, 'GET', headers, undefined, 15000)
    return { ok: r.status > 0 && r.status < 500, status: r.status }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}
