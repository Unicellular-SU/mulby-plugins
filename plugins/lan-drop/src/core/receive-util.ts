// 接收端共享助手：被设备间协议（receive-server）与手机网关（web-gateway）复用，
// 确保两条入站路径使用同一套经过验证的路径净化 / 落盘 / 容量预检逻辑。

import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { DISK_SPACE_MARGIN } from './runtime'

/** 取单个请求头（多值取首个）。 */
export function header(req: http.IncomingMessage, key: string): string | undefined {
  const v = req.headers[key]
  return Array.isArray(v) ? v[0] : v
}

/** 解码 URI 编码的请求头（失败则原样返回）。 */
export function decodeHeader(value: string | undefined): string {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 取请求来源 IP（去掉 IPv4-mapped IPv6 前缀）。 */
export function remoteIp(req: http.IncomingMessage): string {
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
}

/** 人类可读的字节大小。 */
export function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * 把对端声明的相对路径净化为安全、限定在下载目录内的相对路径：
 * 拆段后剔除空 / '.' / '..'（防穿越），替换 Windows 非法字符与控制字符，
 * 去掉段尾的「.」与空格（Windows 规则），最终以本机分隔符拼接。
 */
export function safeRelPath(rel: string): string {
  return rel
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => s.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/[ .]+$/g, ''))
    .filter((s) => s.length > 0)
    .join(path.sep)
}

/** 同名文件自动追加序号，避免覆盖。 */
export function dedupePath(target: string): string {
  if (!fs.existsSync(target)) return target
  const dir = path.dirname(target)
  const ext = path.extname(target)
  const base = path.basename(target, ext)
  let i = 1
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = path.join(dir, `${base} (${i})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
    i += 1
  }
}

/**
 * 把净化后的相对路径解析为下载目录内的最终落盘路径；越界则回退到根目录的 basename。
 */
export function resolveWithinDownloadDir(downloadDir: string, relName: string, fallbackName: string): string {
  const resolvedRoot = path.resolve(downloadDir)
  let candidate = path.resolve(downloadDir, relName)
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    candidate = path.resolve(downloadDir, fallbackName)
  }
  return candidate
}

/** P2：落盘前预检目标分区可用空间（statfs 不可用时跳过，不阻断）。 */
export async function checkDiskSpace(
  dir: string,
  size: number,
): Promise<{ ok: boolean; reason?: string }> {
  if (!size || size <= 0) return { ok: true }
  try {
    const st = await fs.promises.statfs(dir)
    const free = Number(st.bavail) * Number(st.bsize)
    if (free >= size + DISK_SPACE_MARGIN) return { ok: true }
    return {
      ok: false,
      reason: `磁盘空间不足（需 ${formatSize(size)}，可用 ${formatSize(free)}）`,
    }
  } catch {
    return { ok: true }
  }
}
