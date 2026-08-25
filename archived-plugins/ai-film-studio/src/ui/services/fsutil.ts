/**
 * 前端文件系统辅助：M5 合成/导出需要把片段、音频、字幕、成片落到本机磁盘。
 * 渲染进程可直接用 mulby.filesystem（写本地文件），仅「下载远程 URL」需走后端（CORS/二进制）。
 * 落点统一在 {userData}/ai-film-studio/<subdir>/。
 */

const ROOT_DIR = 'ai-film-studio'

function fs() {
  const f = window.mulby?.filesystem
  if (!f) throw new Error('宿主文件系统 API 不可用')
  return f
}

async function exists(path: string): Promise<boolean> {
  try {
    return await fs().exists(path)
  } catch {
    return false
  }
}

async function mkdirSafe(path: string): Promise<void> {
  try {
    if (!(await exists(path))) await fs().mkdir(path)
  } catch {
    // 可能并发已创建，忽略
  }
}

/** 取存储根目录 {userData}/ai-film-studio */
export async function getRoot(): Promise<string> {
  let base = ''
  try {
    base = await window.mulby!.system.getPath('userData')
  } catch {
    base = ''
  }
  if (!base) throw new Error('无法确定 userData 目录')
  const root = `${base}/${ROOT_DIR}`
  await mkdirSafe(root)
  return root
}

/** 确保 {root}/<subdir> 存在并返回其绝对路径 */
export async function ensureSubdir(subdir: string): Promise<string> {
  const root = await getRoot()
  const dir = `${root}/${subdir}`
  await mkdirSafe(dir)
  return dir
}

function sanitize(name: string): string {
  return String(name || 'file')
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 80)
}

/** 把 base64 写入 {subdir}/{name}.{ext}，返回绝对路径 */
export async function writeBase64(subdir: string, name: string, ext: string, base64: string): Promise<string> {
  const dir = await ensureSubdir(subdir)
  const safe = sanitize(name)
  const fname = safe.endsWith(`.${ext}`) ? safe : `${safe}.${ext}`
  const path = `${dir}/${fname}`
  await fs().writeFile(path, base64, 'base64')
  return path
}

/** 把文本写入 {subdir}/{name}（name 含扩展名），返回绝对路径 */
export async function writeText(subdir: string, name: string, text: string): Promise<string> {
  const dir = await ensureSubdir(subdir)
  const path = `${dir}/${sanitize(name)}`
  await fs().writeFile(path, text, 'utf-8')
  return path
}

/** 拼一个 {subdir} 下的输出路径（不创建文件，仅返回路径） */
export async function exportPath(name: string): Promise<string> {
  const dir = await ensureSubdir('exports')
  return `${dir}/${sanitize(name)}`
}

/** 本地绝对路径 → file:// URL（兼容 Windows 盘符 + 空格） */
export function toFileUrl(p: string): string {
  if (!p) return ''
  if (/^file:\/\//i.test(p)) return p
  let s = p.replace(/\\/g, '/')
  if (!s.startsWith('/')) s = '/' + s // C:/Users → /C:/Users
  return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/** file:// URL / 普通路径 → 本地路径 */
export function fromFileUrl(u: string): string {
  if (!u) return ''
  if (!/^file:\/\//i.test(u)) return u
  let s = decodeURI(u.replace(/^file:\/\//i, ''))
  if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1) // /C:/ → C:/
  return s
}

/** 从本地文件读回 base64 data URL（用于音频/小文件预览） */
export async function readAsDataUrl(path: string, mime: string): Promise<string> {
  const data = await fs().readFile(path, 'base64')
  const b64 = typeof data === 'string' ? data : ''
  return `data:${mime};base64,${b64}`
}

/** 从本地路径取文件名 */
export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}
