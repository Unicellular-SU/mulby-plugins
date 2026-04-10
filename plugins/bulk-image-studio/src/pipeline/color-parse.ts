export interface Rgba {
  r: number
  g: number
  b: number
  alpha: number
}

/** 支持 #rgb #rrggbb #rrggbbaa 或 rgba(r,g,b,a) */
export function parseColorToRgba(input: string, defaultAlpha = 1): Rgba {
  const s = input.trim()
  if (s.startsWith('rgba')) {
    const m = s.match(/rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/i)
    if (m) {
      return { r: +m[1], g: +m[2], b: +m[3], alpha: +m[4] }
    }
  }
  if (s.startsWith('rgb')) {
    const m = s.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i)
    if (m) {
      return { r: +m[1], g: +m[2], b: +m[3], alpha: defaultAlpha }
    }
  }
  let hex = s.replace(/^#/, '')
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : defaultAlpha
    return { r, g, b, alpha }
  }
  return { r: 0, g: 0, b: 0, alpha: defaultAlpha }
}
