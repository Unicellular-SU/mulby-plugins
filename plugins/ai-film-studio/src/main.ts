/// <reference path="./types/mulby.d.ts" />
// 插件后端入口
// 生命周期 + 启动提示。工程结构由前端通过 storage 持久化。
// 后端 rpc：远程视频下载落盘（M4）、OpenAI 兼容配音合成落盘（M5）。
// 走后端的统一原因：规避渲染进程 CORS + 二进制经 base64 落盘避免截断。

declare const mulby: any

type PluginContext = BackendPluginContext

export function onLoad() {
  console.log('[ai-film-studio] loaded')
}

export function onUnload() {
  console.log('[ai-film-studio] unloaded')
}

export function onEnable() {
  console.log('[ai-film-studio] enabled')
}

export function onDisable() {
  console.log('[ai-film-studio] disabled')
}

export async function run(context: PluginContext) {
  void context
  try {
    mulby.notification.show('AI 影视工坊已启动')
  } catch {
    // 忽略通知失败
  }
}

// 确保目录存在（mkdir 非递归，逐级创建，已存在则忽略）
async function ensureDir(dir: string): Promise<void> {
  try {
    const exists = await mulby.filesystem.exists(dir)
    if (!exists) await mulby.filesystem.mkdir(dir)
  } catch {
    // 可能已存在或由上层创建，忽略
  }
}

// Host 方法（供前端 window.mulby.host.call('ai-film-studio', method, ...args) 调用）
export const rpc = {
  // M5 成片导出会用到：把文本/二进制写入指定文件
  async exportToFile(input: { filePath: string; data: string; encoding?: 'utf-8' | 'base64' }) {
    await mulby.filesystem.writeFile(input.filePath, input.data, input.encoding || 'utf-8')
    return { success: true }
  },

  // M4 视频落盘：主进程 fetch 远程视频 → base64 写入 {baseDir}/ai-film-studio/videos/
  // 主进程下载规避渲染进程 CORS；二进制经 base64 落盘避免截断。
  async downloadVideo(input: { url: string; name?: string; baseDir?: string }) {
    try {
      if (!input?.url) return { ok: false, error: '缺少视频地址' }
      if (typeof fetch === 'undefined') return { ok: false, error: '后端环境不支持 fetch，无法下载' }
      let base = input.baseDir
      if (!base) {
        try {
          base = await mulby.system.getPath('userData')
        } catch {
          base = ''
        }
      }
      if (!base) return { ok: false, error: '无法确定存储目录' }
      const root = `${base}/ai-film-studio`
      const dir = `${root}/videos`
      await ensureDir(root)
      await ensureDir(dir)
      const safe = String(input.name || `video_${Date.now()}`)
        .replace(/[^\w.\-]+/g, '_')
        .slice(0, 80)
      const fname = /\.(mp4|webm|mov|mkv|gif)$/i.test(safe) ? safe : `${safe}.mp4`
      const filePath = `${dir}/${fname}`
      const resp = await fetch(input.url)
      if (!resp.ok) return { ok: false, error: `下载失败 HTTP ${resp.status}` }
      const ab = await resp.arrayBuffer()
      const b64 = Buffer.from(ab).toString('base64')
      await mulby.filesystem.writeFile(filePath, b64, 'base64')
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },

  // M5 配音合成：OpenAI 兼容 POST /audio/speech → 二进制音频 base64 落盘
  async synthSpeech(input: {
    baseURL: string
    apiKey: string
    model: string
    voice: string
    input: string
    speed?: number
    format?: string
    baseDir?: string
  }) {
    try {
      if (!input?.input?.trim()) return { ok: false, error: '缺少配音文本' }
      if (!input?.apiKey) return { ok: false, error: '缺少 API Key' }
      if (typeof fetch === 'undefined') return { ok: false, error: '后端环境不支持 fetch，无法合成配音' }
      const format = (input.format || 'mp3').toLowerCase()
      const mime =
        format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/opus' : format === 'aac' ? 'audio/aac' : 'audio/mpeg'
      const url = `${String(input.baseURL || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/speech`
      const resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: input.model || 'tts-1',
          voice: input.voice || 'alloy',
          input: input.input,
          response_format: format,
          speed: input.speed || 1,
        }),
      })
      if (!resp.ok) {
        let detail = ''
        try {
          detail = (await resp.text()).slice(0, 300)
        } catch {
          // 忽略
        }
        return { ok: false, error: `配音请求失败 HTTP ${resp.status}${detail ? ` ${detail}` : ''}` }
      }
      let base = input.baseDir
      if (!base) {
        try {
          base = await mulby.system.getPath('userData')
        } catch {
          base = ''
        }
      }
      if (!base) return { ok: false, error: '无法确定存储目录' }
      const root = `${base}/ai-film-studio`
      const dir = `${root}/audio`
      await ensureDir(root)
      await ensureDir(dir)
      const ab = await resp.arrayBuffer()
      const b64 = Buffer.from(ab).toString('base64')
      const filePath = `${dir}/tts_${Date.now()}.${format === 'aac' ? 'aac' : format === 'wav' ? 'wav' : format === 'opus' ? 'opus' : 'mp3'}`
      await mulby.filesystem.writeFile(filePath, b64, 'base64')
      return { ok: true, path: filePath, base64: b64, mime }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  },
}

const plugin = { onLoad, onUnload, onEnable, onDisable, run, rpc }
export default plugin
