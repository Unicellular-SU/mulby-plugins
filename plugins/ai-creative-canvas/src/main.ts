/// <reference path="./types/mulby.d.ts" />
// AI 创意画布 — 插件后端入口
// 职责：生命周期；以及渲染进程不便/易截断的活：远程媒体落盘、图床 multipart 上传、TTS 二进制合成、导出落盘。
// 画布/工程状态由前端通过 storage 持久化；生成请求与轮询走前端 mulby.http（无 CORS、密钥不进页面）。

declare const mulby: any

type PluginContext = BackendPluginContext

export function onLoad() {
  console.log('[ai-creative-canvas] loaded')
}
export function onUnload() {
  console.log('[ai-creative-canvas] unloaded')
}
export function onEnable() {
  console.log('[ai-creative-canvas] enabled')
}
export function onDisable() {
  console.log('[ai-creative-canvas] disabled')
}

export async function run(context: PluginContext) {
  void context
  try {
    mulby.notification.show('AI 创意画布已启动')
  } catch {
    // 忽略通知失败
  }
}

// ---- 工具 ----

// 逐级创建目录（mkdir 非递归），已存在则忽略
async function ensureDir(dir: string): Promise<void> {
  try {
    const exists = await mulby.filesystem.exists(dir)
    if (!exists) await mulby.filesystem.mkdir(dir)
  } catch {
    // 可能已存在或由上层创建，忽略
  }
}

// 取 JSON 路径（如 data.url / data.0.url）
function getJsonPath(obj: any, path: string): unknown {
  if (!obj || !path) return undefined
  let cur: any = obj
  for (const seg of path.split('.')) {
    if (cur == null) return undefined
    cur = Array.isArray(cur) ? cur[Number(seg)] : cur[seg]
  }
  return cur
}

async function resolveBaseDir(input?: string): Promise<string> {
  if (input) return input
  try {
    return await mulby.system.getPath('userData')
  } catch {
    return ''
  }
}

const ROOT_DIR = 'ai-creative-canvas'

function sanitizeName(name: string, fallback: string): string {
  const safe = String(name || fallback).replace(/[^\w.\-]+/g, '_').slice(0, 80)
  return safe || fallback
}

// ---- Host RPC（前端 window.mulby.host.call('ai-creative-canvas', method, args) 调用）----
export const rpc = {
  // 远程媒体落盘：主进程 fetch（规避渲染进程 CORS）→ base64 写入 {base}/ai-creative-canvas/{subdir}/
  // 二进制经 base64 落盘避免截断。
  async downloadMedia(input: { url: string; name?: string; subdir?: string; projectId?: string }) {
    try {
      if (!input?.url) return { ok: false, error: '缺少媒体地址' }
      if (typeof fetch === 'undefined') return { ok: false, error: '后端环境不支持 fetch，无法下载' }
      const base = await resolveBaseDir()
      if (!base) return { ok: false, error: '无法确定存储目录' }
      const sub = sanitizeName(input.subdir || (input.projectId ? `media/${input.projectId}` : 'media'), 'media')
      const root = `${base}/${ROOT_DIR}`
      const dir = `${root}/${sub}`
      await ensureDir(root)
      // 逐级创建 media/<projectId>
      let acc = root
      for (const seg of sub.split('/')) {
        acc = `${acc}/${seg}`
        await ensureDir(acc)
      }
      const resp = await fetch(input.url)
      if (!resp.ok) return { ok: false, error: `下载失败 HTTP ${resp.status}` }
      const ct = resp.headers.get('content-type') || ''
      const guessedExt = ct.includes('mp4') ? 'mp4' : ct.includes('webm') ? 'webm' : ct.includes('png') ? 'png'
        : ct.includes('webp') ? 'webp' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg'
        : ct.includes('mpeg') || ct.includes('mp3') ? 'mp3' : ct.includes('wav') ? 'wav' : ''
      let fname = sanitizeName(input.name || `media_${Date.now()}`, `media_${Date.now()}`)
      if (!/\.[a-z0-9]{2,4}$/i.test(fname)) fname = `${fname}.${guessedExt || 'bin'}`
      const filePath = `${dir}/${fname}`
      const ab = await resp.arrayBuffer()
      const b64 = Buffer.from(ab).toString('base64')
      await mulby.filesystem.writeFile(filePath, b64, 'base64')
      return { ok: true, path: filePath, mime: ct || undefined }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  // 本地帧（base64）以 multipart/form-data 传到图床，换公开 URL（供仅收 URL 的图生视频用）。
  async uploadImageToHost(input: {
    uploadUrl: string; apiKey?: string; base64: string; mime?: string; field?: string; urlPath?: string
  }) {
    try {
      if (!input?.uploadUrl) return { ok: false, error: '缺少上传地址' }
      if (!input?.base64) return { ok: false, error: '缺少图片数据' }
      if (typeof fetch === 'undefined' || typeof FormData === 'undefined') return { ok: false, error: '后端环境不支持 fetch/FormData' }
      const mime = input.mime || 'image/png'
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg'
      const buf = Buffer.from(input.base64, 'base64')
      const form = new FormData()
      form.append(input.field || 'file', new Blob([buf], { type: mime }), `frame.${ext}`)
      const resp = await fetch(input.uploadUrl, {
        method: 'POST',
        headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {},
        body: form as any
      })
      if (!resp.ok) {
        let detail = ''
        try { detail = (await resp.text()).slice(0, 300) } catch { /* ignore */ }
        return { ok: false, error: `图片上传失败 HTTP ${resp.status}${detail ? ` ${detail}` : ''}` }
      }
      const json = await resp.json().catch(() => null)
      const url =
        getJsonPath(json, input.urlPath || 'data.url') ||
        getJsonPath(json, 'url') ||
        getJsonPath(json, 'data.0.url') ||
        getJsonPath(json, 'data.image_url')
      if (!url || typeof url !== 'string') return { ok: false, error: '上传成功但未解析到图片 URL（可配置 urlPath）' }
      return { ok: true, url }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  // 配音合成：OpenAI 兼容 POST /audio/speech → 二进制音频 base64 落盘
  async synthSpeech(input: {
    baseURL: string; apiKey: string; model: string; voice: string; input: string
    speed?: number; format?: string; projectId?: string
  }) {
    try {
      if (!input?.input?.trim()) return { ok: false, error: '缺少配音文本' }
      if (!input?.apiKey) return { ok: false, error: '缺少 API Key' }
      if (typeof fetch === 'undefined') return { ok: false, error: '后端环境不支持 fetch，无法合成配音' }
      const format = (input.format || 'mp3').toLowerCase()
      const mime = format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/opus' : format === 'aac' ? 'audio/aac' : 'audio/mpeg'
      const url = `${String(input.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/speech`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model || 'tts-1',
          voice: input.voice || 'alloy',
          input: input.input,
          response_format: format,
          speed: input.speed || 1
        })
      })
      if (!resp.ok) {
        let detail = ''
        try { detail = (await resp.text()).slice(0, 300) } catch { /* ignore */ }
        return { ok: false, error: `配音请求失败 HTTP ${resp.status}${detail ? ` ${detail}` : ''}` }
      }
      const base = await resolveBaseDir()
      if (!base) return { ok: false, error: '无法确定存储目录' }
      const root = `${base}/${ROOT_DIR}`
      const dir = `${root}/audio`
      await ensureDir(root)
      await ensureDir(dir)
      const ab = await resp.arrayBuffer()
      const b64 = Buffer.from(ab).toString('base64')
      const ext = format === 'aac' ? 'aac' : format === 'wav' ? 'wav' : format === 'opus' ? 'opus' : 'mp3'
      const filePath = `${dir}/tts_${Date.now()}.${ext}`
      await mulby.filesystem.writeFile(filePath, b64, 'base64')
      return { ok: true, path: filePath, base64: b64, mime }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  // 导出：把文本/二进制写入指定路径（成片/图片导出）
  async exportFile(input: { filePath: string; data: string; encoding?: 'utf-8' | 'base64' }) {
    try {
      if (!input?.filePath) return { ok: false, error: '缺少导出路径' }
      await mulby.filesystem.writeFile(input.filePath, input.data, input.encoding || 'utf-8')
      return { ok: true, path: input.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
