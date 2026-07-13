import { base64ToArrayBuffer } from '../util'
import { PLUGIN_ID } from './persistence'

function fs(): any {
  return (window as any).mulby?.filesystem
}
function sys(): any {
  return (window as any).mulby?.system
}

// Windows: C:\a\b → file:///C:/a/b ; *nix: /a/b → file:///a/b
export function toFileUrl(path: string): string {
  return 'file:///' + path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function mimeToExt(mime: string): string {
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('gif')) return 'gif'
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  if (mime.includes('wav')) return 'wav'
  return 'png'
}

let baseDirCache: string | null = null
async function mediaDir(projectId: string): Promise<string> {
  if (!baseDirCache) baseDirCache = await sys().getPath('userData')
  const dir = `${baseDirCache}/${PLUGIN_ID}/media/${projectId}`
  try {
    await fs().mkdir(dir) // 递归创建
  } catch {
    /* exists */
  }
  return dir
}

function stamp(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 1e4)}`
}

// 删除某工程的全部磁盘媒体（host 侧递归删文件；宿主无 rmdir，空目录骨架残留零体积）。best-effort。
// 调用方需先确认无其他工程引用该目录（duplicateProject 的副本与原工程共享媒体文件路径）。
export async function removeProjectMediaOnDisk(projectId: string): Promise<void> {
  try {
    await (window as any).mulby?.host?.call(PLUGIN_ID, 'removeProjectMedia', { projectId })
  } catch {
    /* best-effort */
  }
}

export async function saveBase64(
  projectId: string,
  cardId: string,
  base64: string,
  ext = 'png'
): Promise<{ path: string; url: string }> {
  const dir = await mediaDir(projectId)
  const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
  const path = `${dir}/${cardId}_${stamp()}.${ext}`
  await fs().writeFile(path, clean, 'base64')
  return { path, url: toFileUrl(path) }
}

export async function saveBytes(
  projectId: string,
  cardId: string,
  buf: ArrayBuffer,
  mime: string
): Promise<{ path: string; url: string }> {
  const dir = await mediaDir(projectId)
  const path = `${dir}/${cardId}_${stamp()}.${mimeToExt(mime)}`
  await fs().writeFile(path, buf, undefined as any)
  return { path, url: toFileUrl(path) }
}

// 生成媒体目录下的一个新文件路径（用于 ffmpeg 输出）
export async function mediaPath(projectId: string, base: string, ext: string): Promise<string> {
  const dir = await mediaDir(projectId)
  return `${dir}/${base}_${stamp()}.${ext}`
}

// 确保媒体子目录存在并返回其路径（用于抽帧/场景帧等批量输出）
export async function ensureSubDir(projectId: string, sub: string): Promise<string> {
  if (!baseDirCache) baseDirCache = await sys().getPath('userData')
  const dir = `${baseDirCache}/${PLUGIN_ID}/media/${projectId}/${sub}`
  try {
    await fs().mkdir(dir)
  } catch {
    /* exists */
  }
  return dir
}

// 读取本地文件为 ArrayBuffer（用于上传 ai 附件）
export async function readAsArrayBuffer(path: string): Promise<ArrayBuffer> {
  const b64 = (await fs().readFile(path, 'base64')) as string
  return base64ToArrayBuffer(b64)
}

// 把生成输入（本地路径优先，否则 URL）读成 ArrayBuffer
export async function loadImageInput(i: { url?: string; localPath?: string }): Promise<ArrayBuffer | null> {
  try {
    if (i.localPath) return await readAsArrayBuffer(i.localPath)
    if (i.url) return await (await fetch(i.url)).arrayBuffer()
  } catch {
    /* ignore */
  }
  return null
}

export { mimeToExt }
