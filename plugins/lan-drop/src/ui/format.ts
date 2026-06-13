export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 1) return ''
  return `${formatSize(bytesPerSec)}/s`
}

export function formatEta(remaining: number, speed: number): string {
  if (!speed || speed <= 0 || remaining <= 0) return ''
  const sec = Math.ceil(remaining / speed)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`
}

export function formatTime(ts?: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function osLabel(os: string): string {
  if (os === 'win32') return 'Windows'
  if (os === 'darwin') return 'macOS'
  if (os === 'linux') return 'Linux'
  return os || '未知'
}

/** 把设备指纹（公钥指纹/deviceId）按 4 字符分组，便于带外人工核对。 */
export function formatFingerprint(id: string, maxGroups = 8): string {
  if (!id) return ''
  const groups = id.match(/.{1,4}/g) || []
  return groups.slice(0, maxGroups).join(' ')
}
