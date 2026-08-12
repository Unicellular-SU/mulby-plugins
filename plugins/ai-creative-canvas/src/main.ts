/// <reference path="./types/mulby.d.ts" />
import {
  MAX_REMOTE_MEDIA_BYTES,
  MAX_LOCAL_IMPORT_FILES,
  MAX_TEXT_IMPORT_BYTES,
  MAX_UPLOAD_IMAGE_BYTES,
  decodedBase64ByteLength,
  isTextImportName,
  localImportMime,
  normalizeRemoteHttpUrl
} from './backendGuards'
// AI 创意画布 — 插件后端入口
// 职责：生命周期；以及渲染进程不便/易截断的活：远程媒体落盘、图床 multipart 上传、TTS 二进制合成、导出落盘。
// 画布/工程状态由前端通过 storage 持久化；生成请求与轮询走前端 mulby.http（无 CORS）。
// 密钥策略：静态加密存 storage.encrypted（按插件隔离）；请求时前端解密出明文拼 Authorization: Bearer 头，
// 故明文密钥会短暂进入渲染进程内存——并非「零暴露」，切勿据此误判密钥永不进页面。

// 后端宿主 API（types/mulby.d.ts 已含完整定义）：让 filesystem/system/notification 等 RPC 获得类型检查
declare const mulby: BackendPluginAPIDirect

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

// 创建目录（宿主 mkdir 为递归创建，见 mulby plugin/filesystem.ts），已存在则忽略
async function ensureDir(dir: string): Promise<void> {
  try {
    const exists = await mulby.filesystem.exists(dir)
    if (!exists) await mulby.filesystem.mkdir(dir)
  } catch {
    // 可能已存在或由上层创建，忽略
  }
}

const MB = 1024 * 1024

// 受控二进制拉取：整体超时（AbortSignal.timeout 覆盖含响应体读取的全程）+ 内容类型前缀校验
// （签名 URL 过期常回 200+HTML 错误页，不校验会把 HTML 当媒体落盘）+ 大小上限
// （Content-Length 预检；无声明或声明不实时流式计数兜底，防大文件撑爆 host-worker 内存）。
async function fetchBinaryGuarded(
  url: string,
  init: RequestInit | undefined,
  guard: { timeoutMs: number; maxBytes: number; typePattern?: RegExp; typeLabel?: string; urlLabel?: string }
): Promise<{ ok: true; buf: Buffer; contentType: string } | { ok: false; error: string }> {
  const safeUrl = normalizeRemoteHttpUrl(url, guard.urlLabel)
  const resp = await fetch(safeUrl, { ...(init || {}), signal: AbortSignal.timeout(guard.timeoutMs) })
  if (resp.url) normalizeRemoteHttpUrl(resp.url, `${guard.urlLabel || '远程地址'}的重定向结果`)
  if (!resp.ok) {
    let detail = ''
    try { detail = (await resp.text()).slice(0, 300) } catch { /* ignore */ }
    return { ok: false, error: `HTTP ${resp.status}${detail ? ` ${detail}` : ''}` }
  }
  const ct = (resp.headers.get('content-type') || '').toLowerCase()
  if (guard.typePattern && ct && !guard.typePattern.test(ct)) {
    return { ok: false, error: `${guard.typeLabel || '响应'}类型不符（${ct}）——地址可能已过期或返回了错误页` }
  }
  const declaredRaw = resp.headers.get('content-length') || ''
  const declared = /^\d+$/.test(declaredRaw) ? Number(declaredRaw) : 0
  if (declared > guard.maxBytes) {
    return { ok: false, error: `文件过大（${Math.round(declared / MB)}MB，上限 ${Math.round(guard.maxBytes / MB)}MB）` }
  }
  if (!resp.body) {
    const ab = await resp.arrayBuffer()
    if (ab.byteLength > guard.maxBytes) return { ok: false, error: `文件过大（上限 ${Math.round(guard.maxBytes / MB)}MB）` }
    return { ok: true, buf: Buffer.from(ab), contentType: ct }
  }
  const reader = resp.body.getReader()
  // Content-Length 可信时直接分配最终 Buffer，避免 chunks + Buffer.concat 同时驻留造成近 2 倍峰值。
  // 无 Content-Length 时仍逐块计数；256MB 硬上限确保最坏情况下也不会再出现 500MB→Base64 的超大峰值。
  let target = declared > 0 ? Buffer.allocUnsafe(declared) : null
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const nextTotal = total + value.byteLength
    if (nextTotal > guard.maxBytes) {
      try { await reader.cancel() } catch { /* ignore */ }
      return { ok: false, error: `文件过大（超过上限 ${Math.round(guard.maxBytes / MB)}MB），已中止下载` }
    }
    if (target && nextTotal <= target.length) {
      Buffer.from(value.buffer, value.byteOffset, value.byteLength).copy(target, total)
    } else {
      // 服务端低报 Content-Length 时退回 chunks，仍保留实时上限保护。
      if (target) {
        if (total) chunks.push(target.subarray(0, total))
        target = null
      }
      chunks.push(Buffer.from(value))
    }
    total = nextTotal
  }
  return { ok: true, buf: target ? target.subarray(0, total) : Buffer.concat(chunks, total), contentType: ct }
}

// 递归删除目录下全部文件（宿主 filesystem 只有 unlink 无 rmdir——空目录骨架会残留，零体积可接受）
async function removeDirFiles(dir: string): Promise<number> {
  let n = 0
  try {
    if (!(await mulby.filesystem.exists(dir))) return 0
    for (const name of await mulby.filesystem.readdir(dir)) {
      const p = `${dir}/${name}`
      try {
        const st: any = await mulby.filesystem.stat(p)
        if (st?.isDirectory) n += await removeDirFiles(p)
        else {
          await mulby.filesystem.unlink(p)
          n++
        }
      } catch {
        // 单个条目失败不阻断其余清理
      }
    }
  } catch {
    // best-effort
  }
  return n
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
  // 纯点序列（. / .. / ...）必须归一为 _：白名单保留 '.'，否则 '..' 会原样通过并逃逸出落盘根目录
  const safe = String(name || fallback).replace(/[^\w.\-]+/g, '_').replace(/^\.+$/, '_').slice(0, 80)
  return safe || fallback
}

// ---- Host RPC（前端 window.mulby.host.call('ai-creative-canvas', method, args) 调用）----
export const rpc = {
  // 远程媒体落盘：主进程 fetch（规避渲染进程 CORS）→ Buffer 直写 {base}/ai-creative-canvas/media/<projectId>/
  // 落盘路径完全由后端拼接，不接受任何路径型入参（杜绝 ../ 目录逃逸）；
  // 目录布局与 UI 端 media.ts / README 约定一致（media/<projectId> 两级）。host.call 可被其他插件指名调用，入参按不可信处理。
  async downloadMedia(input: { url: string; name?: string; projectId?: string }) {
    try {
      if (!input?.url) return { ok: false, error: '缺少媒体地址' }
      if (typeof fetch === 'undefined') return { ok: false, error: '后端环境不支持 fetch，无法下载' }
      const base = await resolveBaseDir()
      if (!base) return { ok: false, error: '无法确定存储目录' }
      const dir = input.projectId
        ? `${base}/${ROOT_DIR}/media/${sanitizeName(input.projectId, 'proj')}`
        : `${base}/${ROOT_DIR}/media`
      await ensureDir(dir)
      const r = await fetchBinaryGuarded(input.url, undefined, {
        timeoutMs: 10 * 60_000, // 生成的长视频可达数百 MB，给足 10 分钟
        maxBytes: MAX_REMOTE_MEDIA_BYTES,
        typePattern: /^(image|video|audio)\//,
        typeLabel: '媒体',
        urlLabel: '媒体地址'
      })
      if (!r.ok) return { ok: false, error: `下载失败 ${r.error}` }
      const ct = r.contentType
      const guessedExt = ct.includes('mp4') ? 'mp4' : ct.includes('webm') ? 'webm' : ct.includes('png') ? 'png'
        : ct.includes('webp') ? 'webp' : ct.includes('jpeg') || ct.includes('jpg') ? 'jpg'
        : ct.includes('mpeg') || ct.includes('mp3') ? 'mp3' : ct.includes('wav') ? 'wav' : ''
      let fname = sanitizeName(input.name || `media_${Date.now()}`, `media_${Date.now()}`)
      if (!/\.[a-z0-9]{2,4}$/i.test(fname)) fname = `${fname}.${guessedExt || 'bin'}`
      const filePath = `${dir}/${fname}`
      // 后端 API 支持 Buffer：避免转成体积再膨胀 1/3 的 Base64 字符串。
      await mulby.filesystem.writeFile(filePath, r.buf)
      return { ok: true, path: filePath, mime: ct || undefined }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  // 删除某工程的全部磁盘媒体：media/<pid> 与 A5 修复前 host 下载的遗留目录 media_<pid>。
  // 调用方（projectStore.deleteProject）负责先确认无其他工程引用这些文件（duplicateProject 的副本共享原工程媒体路径）。
  async removeProjectMedia(input: { projectId: string }) {
    try {
      const pid = sanitizeName(String(input?.projectId || ''), '')
      if (!pid) return { ok: false, error: '缺少工程 id' }
      const base = await resolveBaseDir()
      if (!base) return { ok: false, error: '无法确定存储目录' }
      const root = `${base}/${ROOT_DIR}`
      const removed = (await removeDirFiles(`${root}/media/${pid}`)) + (await removeDirFiles(`${root}/media_${pid}`))
      return { ok: true, removed }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  // 系统拖拽 / 打开文件对话框导入：前端只负责同步提取路径，实际读取与复制放在后端，
  // 避免渲染沙箱拒绝路径访问，也避免大媒体在 ArrayBuffer → Base64 → RPC 间多次膨胀。
  // 仅接受画布支持的白名单扩展名；目标目录与文件名均由后端决定。
  async importLocalResources(input: { projectId: string; paths: string[] }) {
    const items: Array<{ name: string; mime: string; path?: string; text?: string; size: number }> = []
    const failures: Array<{ name: string; reason: string }> = []
    try {
      const rawPaths = Array.isArray(input?.paths) ? input.paths : []
      const paths = [...new Set(rawPaths.map((p) => String(p || '').trim()).filter(Boolean))]
      if (!paths.length) return { ok: false, items, failures, error: '没有可导入的本地路径' }
      if (paths.length > MAX_LOCAL_IMPORT_FILES) {
        return { ok: false, items, failures, error: `一次最多导入 ${MAX_LOCAL_IMPORT_FILES} 个文件` }
      }
      const base = await resolveBaseDir()
      if (!base) return { ok: false, items, failures, error: '无法确定存储目录' }
      const projectId = sanitizeName(String(input?.projectId || ''), 'proj')
      const dir = `${base}/${ROOT_DIR}/media/${projectId}`
      await ensureDir(dir)

      for (let i = 0; i < paths.length; i++) {
        const sourcePath = paths[i]
        const name = mulby.filesystem.basename(sourcePath) || `resource_${i + 1}`
        const mime = localImportMime(name)
        if (!mime) {
          failures.push({ name, reason: '不支持的文件类型' })
          continue
        }
        try {
          const stat = await mulby.filesystem.stat(sourcePath)
          if (!stat || stat.isDirectory || stat.isFile === false) throw new Error('不是可读取的文件')
          const size = Number(stat.size || 0)
          if (isTextImportName(name)) {
            if (size > MAX_TEXT_IMPORT_BYTES) {
              throw new Error(`文本过大（上限 ${Math.round(MAX_TEXT_IMPORT_BYTES / MB)}MB）`)
            }
            const content = await mulby.filesystem.readFile(sourcePath, 'utf-8')
            if (typeof content !== 'string') throw new Error('文本编码无法识别')
            items.push({ name, mime, text: content, size })
            continue
          }
          const safeName = sanitizeName(name, `resource_${i + 1}`)
          const targetPath = `${dir}/import_${Date.now()}_${i}_${safeName}`
          await mulby.filesystem.copy(sourcePath, targetPath)
          items.push({ name, mime, path: targetPath, size })
        } catch (error) {
          failures.push({ name, reason: error instanceof Error ? error.message : String(error) })
        }
      }
      return { ok: items.length > 0, items, failures, error: items.length ? undefined : '没有成功导入的文件' }
    } catch (error) {
      return { ok: false, items, failures, error: error instanceof Error ? error.message : String(error) }
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
      if (!/^image\//i.test(mime)) return { ok: false, error: '上传内容必须是图片' }
      const estimated = decodedBase64ByteLength(input.base64)
      if (estimated > MAX_UPLOAD_IMAGE_BYTES) {
        return { ok: false, error: `图片过大（上限 ${Math.round(MAX_UPLOAD_IMAGE_BYTES / MB)}MB）` }
      }
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : 'jpg'
      const buf = Buffer.from(input.base64, 'base64')
      if (!buf.length) return { ok: false, error: '图片数据无效' }
      if (buf.byteLength > MAX_UPLOAD_IMAGE_BYTES) {
        return { ok: false, error: `图片过大（上限 ${Math.round(MAX_UPLOAD_IMAGE_BYTES / MB)}MB）` }
      }
      const form = new FormData()
      form.append(input.field || 'file', new Blob([buf], { type: mime }), `frame.${ext}`)
      const uploadUrl = normalizeRemoteHttpUrl(input.uploadUrl, '图片上传地址')
      const resp = await fetch(uploadUrl, {
        method: 'POST',
        headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {},
        body: form as any,
        signal: AbortSignal.timeout(120_000)
      })
      if (resp.url) normalizeRemoteHttpUrl(resp.url, '图片上传地址的重定向结果')
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
      return { ok: true, url: normalizeRemoteHttpUrl(url, '图片结果地址') }
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
      const r = await fetchBinaryGuarded(
        url,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: input.model || 'tts-1',
            voice: input.voice || 'alloy',
            input: input.input,
            response_format: format,
            speed: input.speed || 1
          })
        },
        {
          timeoutMs: 120_000,
          maxBytes: 50 * MB,
          typePattern: /^(audio\/|application\/octet-stream)/, // 部分兼容服务以 octet-stream 回二进制
          typeLabel: '音频',
          urlLabel: '配音服务地址'
        }
      )
      if (!r.ok) return { ok: false, error: `配音请求失败 ${r.error}` }
      const base = await resolveBaseDir()
      if (!base) return { ok: false, error: '无法确定存储目录' }
      const root = `${base}/${ROOT_DIR}`
      // 按工程归档到 media/<projectId>（与其他媒体一致，随工程删除清理）；无 projectId 时退回旧共享目录
      const dir = input.projectId ? `${root}/media/${sanitizeName(input.projectId, 'proj')}` : `${root}/audio`
      await ensureDir(dir)
      const ext = format === 'aac' ? 'aac' : format === 'wav' ? 'wav' : format === 'opus' ? 'opus' : 'mp3'
      const filePath = `${dir}/tts_${Date.now()}.${ext}`
      await mulby.filesystem.writeFile(filePath, r.buf)
      // 只回 path/mime：音频已落盘，无需再把整段 base64 跨 IPC 传回渲染进程（长音频负载翻倍，F13）
      return { ok: true, path: filePath, mime }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
