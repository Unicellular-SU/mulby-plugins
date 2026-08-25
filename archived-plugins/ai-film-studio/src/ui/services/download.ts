/**
 * 视频下载落盘：调用后端 RPC（主进程 fetch + filesystem 写入）把远程视频保存到本机。
 * 走主进程的原因：① 规避渲染进程跨域 CORS；② mulby.http 返回 string 不适合二进制，
 * 主进程用 Node fetch 取 ArrayBuffer 再以 base64 写盘，避免二进制截断。
 * 落点：{userData}/ai-film-studio/videos/，userData 由前端解析后传入（后端兜底再取）。
 */

const PLUGIN_ID = 'ai-film-studio'

interface DownloadReply {
  ok?: boolean
  path?: string
  error?: string
}

export async function downloadVideoToDisk(url: string, name?: string): Promise<string> {
  const m = window.mulby
  if (!m?.host?.call) throw new Error('宿主 Host API 不可用，无法下载到本地')
  let baseDir = ''
  try {
    baseDir = await m.system.getPath('userData')
  } catch {
    // 后端会再尝试解析
  }
  const res = (await m.host.call(PLUGIN_ID, 'downloadVideo', { url, name, baseDir })) as
    | { success?: boolean; data?: DownloadReply }
    | undefined
  const data = res?.data
  if (!data?.ok || !data.path) {
    throw new Error(data?.error || '下载失败：后端未返回文件路径')
  }
  return data.path
}

/** 从本地路径取文件名（兼容 / 与 \\） */
export function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p
}
