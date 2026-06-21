import type { ProviderConfig } from './types'
import { toFileUrl } from '../media'
import { PLUGIN_ID } from '../persistence'

function http(): any {
  return (window as any).mulby.http
}
function host(): any {
  return (window as any).mulby.host
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

// 声明式模板路径：bodyTemplate + submitUrl/pollUrl/taskIdPath/statusField/videoUrlPath
async function runViaTemplate(cfg: ProviderConfig, key: string, req: VideoReq, onProgress?: (p: number) => void): Promise<{ url: string }> {
  let imageUrl: string | undefined
  if (req.imageDataUrl) {
    if (cfg.uploadUrl) {
      const b64 = req.imageDataUrl.includes(',') ? req.imageDataUrl.split(',')[1] : req.imageDataUrl
      const r = await host().call(PLUGIN_ID, 'uploadImageToHost', { uploadUrl: cfg.uploadUrl, apiKey: key, base64: b64, field: cfg.uploadField, urlPath: cfg.uploadUrlPath })
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
      const r = await host().call(PLUGIN_ID, 'uploadImageToHost', { uploadUrl: cfg.uploadUrl, apiKey: key, base64: b64, field: cfg.uploadField, urlPath: cfg.uploadUrlPath })
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
  const resp = await httpReq(cfg.submitUrl as string, 'POST', headers, body, cfg.timeoutMs || 600000)
  if (resp.status >= 400) throw new Error(`提交失败 HTTP ${resp.status}: ${String(resp.data).slice(0, 200)}`)
  const data = parse(resp.data)
  let url = jget(data, cfg.videoUrlPath)
  const taskId = jget(data, cfg.taskIdPath)
  if (!url && taskId && cfg.pollUrl) {
    const interval = cfg.pollIntervalMs || 3000
    const timeout = cfg.timeoutMs || 600000
    const fail = (cfg.failValues || 'failed,error,cancelled').split(',').map((s) => s.trim().toLowerCase())
    const startedAt = Date.now()
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - startedAt > timeout) throw new Error('生成超时')
      await sleep(interval)
      const sr = await httpReq(cfg.pollUrl.replace('{taskId}', String(taskId)), 'GET', headers, undefined, 60000)
      const sd = parse(sr.data)
      url = jget(sd, cfg.videoUrlPath)
      if (url) break
      const st = String(jget(sd, cfg.statusField) ?? '').toLowerCase()
      onProgress?.(0.5)
      if (st && fail.includes(st)) throw new Error('生成失败：' + st)
    }
  }
  if (!url || typeof url !== 'string') throw new Error('未获取到结果 URL（检查 taskIdPath/videoUrlPath）')
  onProgress?.(0.95)
  return { url }
}

// 提交 + 轮询，返回结果媒体 URL
export async function runVideoJob(
  cfg: ProviderConfig,
  key: string,
  req: VideoReq,
  onProgress?: (p: number) => void
): Promise<{ url: string }> {
  if (cfg.bodyTemplate && cfg.submitUrl) return runViaTemplate(cfg, key, req, onProgress)
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
      const r = await host().call(PLUGIN_ID, 'uploadImageToHost', {
        uploadUrl: cfg.uploadUrl,
        apiKey: key,
        base64: b64,
        field: cfg.uploadField,
        urlPath: cfg.uploadUrlPath
      })
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
  const resp = await httpReq(submitUrl, 'POST', headers, body, cfg.timeoutMs || 600000)
  if (resp.status >= 400) throw new Error(`提交失败 HTTP ${resp.status}: ${String(resp.data).slice(0, 200)}`)
  const data = parse(resp.data)

  let url = jget(data, cfg.resultPath)
  const taskId = jget(data, cfg.idPath)

  if (!url && taskId && cfg.statusPath) {
    const interval = cfg.pollIntervalMs || 2000
    const timeout = cfg.timeoutMs || 600000
    const done = (cfg.doneValues || 'completed,succeeded,success').split(',').map((s) => s.trim().toLowerCase())
    const fail = (cfg.failValues || 'failed,error,cancelled').split(',').map((s) => s.trim().toLowerCase())
    const startedAt = Date.now()
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - startedAt > timeout) throw new Error('生成超时')
      await sleep(interval)
      const statusUrl = base + (cfg.statusPath || '').replace('{id}', String(taskId))
      const sr = await httpReq(statusUrl, 'GET', headers, undefined, 60000)
      const sd = parse(sr.data)
      url = jget(sd, cfg.resultPath)
      if (url) break
      const st = String(jget(sd, cfg.statusField) ?? '').toLowerCase()
      onProgress?.(0.5)
      if (st && fail.includes(st)) throw new Error('生成失败：' + st)
      if (st && done.includes(st)) {
        url = jget(sd, cfg.resultPath)
        if (url) break
        throw new Error('已完成但未找到结果 URL（检查 resultPath）')
      }
    }
  }

  if (!url || typeof url !== 'string') throw new Error('未获取到结果 URL（检查 idPath/statusPath/resultPath 配置）')
  onProgress?.(0.95)
  return { url }
}

export async function runTts(
  cfg: ProviderConfig,
  key: string,
  text: string,
  opts?: { voice?: string; speed?: number; format?: string }
): Promise<{ path: string; url: string; mime: string }> {
  const r = await host().call(PLUGIN_ID, 'synthSpeech', {
    baseURL: cfg.baseURL,
    apiKey: key,
    model: cfg.ttsModel || 'tts-1',
    voice: opts?.voice || cfg.ttsVoice || 'alloy',
    input: text,
    speed: opts?.speed,
    format: opts?.format || cfg.ttsFormat || 'mp3'
  })
  const d = r?.data
  if (!d?.ok) throw new Error(d?.error || '配音失败')
  return { path: d.path, url: toFileUrl(d.path), mime: d.mime || 'audio/mpeg' }
}
