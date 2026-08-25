export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatFfmpegTime(sec: number): string {
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 0
  const total = Math.floor(safe)
  const ms = Math.round((safe - total) * 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

export function parseFfmpegTime(value: string | undefined | null): number {
  if (!value || typeof value !== 'string') return NaN
  const parts = value.trim().split(':')
  if (parts.length < 1 || parts.length > 3) return NaN
  let seconds = 0
  for (const part of parts) {
    const num = Number(part)
    if (!Number.isFinite(num)) return NaN
    seconds = seconds * 60 + num
  }
  return seconds
}

export function formatFileStamp(sec: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}`
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const digits = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

export function splitPath(path: string): { dir: string; name: string; stem: string; ext: string } {
  const normalized = path.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  const dir = slashIndex >= 0 ? normalized.slice(0, slashIndex) : '.'
  const name = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
  const dotIndex = name.lastIndexOf('.')
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name
  const ext = dotIndex > 0 ? name.slice(dotIndex + 1).toLowerCase() : ''
  return { dir, name, stem, ext }
}

export function pathToResourceUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('file://')) {
    return normalized
  }
  const segments = normalized.split('/').map((segment, index) => (index === 0 && segment === '' ? '' : encodeURIComponent(segment)))
  return `file://${segments.join('/')}`
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

export function computePercent(progressTimeSec: number | null, hostPercent: number | undefined, totalSec: number | null | undefined): number {
  if (typeof hostPercent === 'number' && Number.isFinite(hostPercent) && hostPercent > 0) {
    return clamp(hostPercent, 0, 99.5)
  }
  if (progressTimeSec !== null && Number.isFinite(progressTimeSec) && totalSec && totalSec > 0) {
    return clamp((progressTimeSec / totalSec) * 100, 0, 99.5)
  }
  return 0
}
