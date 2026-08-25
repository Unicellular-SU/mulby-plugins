/**
 * 配音合成（M5）：调用后端 synthSpeech RPC（OpenAI 兼容 /audio/speech）。
 * 走后端的原因同视频下载：① 规避渲染进程 CORS；② 返回的是二进制音频，
 * 主进程取 ArrayBuffer → base64 落盘 {userData}/ai-film-studio/audio/，避免截断。
 * Key 由前端解密后传入（持久层只存密文，见 services/keys.ts）。
 */

const PLUGIN_ID = 'ai-film-studio'

export interface TtsConfig {
  baseURL: string
  apiKey: string
  model: string
  voice: string
  speed?: number
  format?: string
}

interface SynthReply {
  ok?: boolean
  path?: string
  base64?: string
  mime?: string
  error?: string
}

export async function synthSpeech(
  text: string,
  cfg: TtsConfig
): Promise<{ path: string; base64: string; mime: string }> {
  const m = window.mulby
  if (!m?.host?.call) throw new Error('宿主 Host API 不可用，无法合成配音')
  let baseDir = ''
  try {
    baseDir = await m.system.getPath('userData')
  } catch {
    // 后端兜底解析
  }
  const res = (await m.host.call(PLUGIN_ID, 'synthSpeech', {
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey,
    model: cfg.model,
    voice: cfg.voice,
    input: text,
    speed: cfg.speed ?? 1,
    format: cfg.format || 'mp3',
    baseDir,
  })) as { success?: boolean; data?: SynthReply } | undefined
  const data = res?.data
  if (!data?.ok || !data.path) {
    throw new Error(data?.error || '配音合成失败：后端未返回音频')
  }
  return { path: data.path, base64: data.base64 || '', mime: data.mime || 'audio/mpeg' }
}
