/** 浏览器端合成预览（与最终导出比例一致的可视近似，非字节级相同） */

import type { MergeStripCropRatios } from '../pipeline/types'
import { DEFAULT_MERGE_STRIP_CROP } from '../pipeline/types'

export type MergePreviewMode = 'pdf' | 'strip-h' | 'strip-v' | 'gif'

const PREVIEW_MAX_SIDE = 880

function mimeForPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() || 'png'
  const m: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    avif: 'image/avif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  }
  return m[ext] || 'image/png'
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

async function pathsToImages(
  files: string[],
  readBase64: (path: string) => Promise<unknown>
): Promise<HTMLImageElement[]> {
  const out: HTMLImageElement[] = []
  for (const p of files) {
    const b64 = await readBase64(p)
    if (typeof b64 !== 'string') throw new Error(`无法读取：${p}`)
    const src = `data:${mimeForPath(p)};base64,${b64}`
    out.push(await loadHtmlImage(src))
  }
  return out
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

function sourceSliceForStrip(
  img: HTMLImageElement,
  _direction: 'horizontal' | 'vertical',
  crop?: MergeStripCropRatios
): { sx: number; sy: number; sw: number; sh: number } {
  const W = img.naturalWidth
  const H = img.naturalHeight
  const r = crop ?? DEFAULT_MERGE_STRIP_CROP
  let x0 = clamp01(r.x0) * W
  let x1 = clamp01(r.x1) * W
  let y0 = clamp01(r.y0) * H
  let y1 = clamp01(r.y1) * H
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  const sw = Math.max(1, x1 - x0)
  const sh = Math.max(1, y1 - y0)
  return { sx: x0, sy: y0, sw, sh }
}

/** 整图缩放到目标矩形（PDF / GIF 预览用） */
function drawScaled(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, dw, dh)
}

/** 横向 / 纵向长图合成预览（可选每张裁剪条带） */
export function renderStripPreview(
  imgs: HTMLImageElement[],
  direction: 'horizontal' | 'vertical',
  spacingPx: number,
  background: string,
  maxSide: number,
  crops?: (MergeStripCropRatios | undefined)[]
): string {
  const n = imgs.length
  if (n === 0) return ''

  const pad = 12
  const sp = Math.max(0, spacingPx)

  const slices = imgs.map((img, i) => sourceSliceForStrip(img, direction, crops?.[i]))
  const ws = slices.map((s) => s.sw)
  const hs = slices.map((s) => s.sh)

  let contentW: number
  let contentH: number
  if (direction === 'horizontal') {
    contentW = ws.reduce((a, b) => a + b, 0) + sp * (n - 1)
    contentH = Math.max(...hs)
  } else {
    contentW = Math.max(...ws)
    contentH = hs.reduce((a, b) => a + b, 0) + sp * (n - 1)
  }

  const aw = maxSide - pad * 2
  const ah = maxSide - pad * 2
  const scale = Math.min(1, aw / contentW, ah / contentH)
  const cw = Math.max(1, Math.ceil(contentW * scale + pad * 2))
  const ch = Math.max(1, Math.ceil(contentH * scale + pad * 2))

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = background
  try {
    ctx.fillRect(0, 0, cw, ch)
  } catch {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cw, ch)
  }

  const s = scale
  const spS = sp * s

  if (direction === 'horizontal') {
    let x = pad
    const laneH = contentH * s
    for (let i = 0; i < n; i++) {
      const sl = slices[i]
      const dw = sl.sw * s
      const dh = sl.sh * s
      const y = pad + (laneH - dh) / 2
      ctx.drawImage(imgs[i], sl.sx, sl.sy, sl.sw, sl.sh, x, y, dw, dh)
      x += dw + (i < n - 1 ? spS : 0)
    }
  } else {
    let y = pad
    const laneW = contentW * s
    for (let i = 0; i < n; i++) {
      const sl = slices[i]
      const dw = sl.sw * s
      const dh = sl.sh * s
      const x = pad + (laneW - dw) / 2
      ctx.drawImage(imgs[i], sl.sx, sl.sy, sl.sw, sl.sh, x, y, dw, dh)
      y += dh + (i < n - 1 ? spS : 0)
    }
  }

  return canvas.toDataURL('image/png')
}

/** PDF：纵向多页叠放示意（白边 + 分隔，顺序与导出一致） */
export function renderPdfStackPreview(imgs: HTMLImageElement[], maxSide: number): string {
  const n = imgs.length
  if (n === 0) return ''

  const pad = 16
  const pageGap = 14
  const innerPad = 10
  const pageShadow = 3
  const maxPageInnerW = Math.min(340, maxSide - pad * 2 - pageShadow * 2)

  type Lay = { pw: number; ph: number; sw: number; sh: number }
  const lays: Lay[] = []

  for (const img of imgs) {
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const innerW = maxPageInnerW
    const innerH = (innerW / nw) * nh
    const pw = innerW + innerPad * 2
    const ph = innerH + innerPad * 2
    lays.push({ pw, ph, sw: innerW, sh: innerH })
  }

  const stackW = Math.max(...lays.map((l) => l.pw)) + pageShadow * 2
  const stackH = lays.reduce((a, l) => a + l.ph, 0) + pageGap * (n - 1) + pageShadow

  const aw = maxSide - pad * 2
  const ah = maxSide - pad * 2
  const scale = Math.min(1, aw / stackW, ah / stackH)
  const cw = Math.max(1, Math.ceil(stackW * scale + pad * 2))
  const ch = Math.max(1, Math.ceil(stackH * scale + pad * 2))

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#94a3b8'
  try {
    ctx.fillRect(0, 0, cw, ch)
  } catch {
    ctx.fillStyle = '#cbd5e1'
    ctx.fillRect(0, 0, cw, ch)
  }

  let y = pad
  const cx = pad + (stackW * scale) / 2

  for (let i = 0; i < n; i++) {
    const { pw, ph, sw, sh } = lays[i]
    const pwS = pw * scale
    const phS = ph * scale
    const x0 = cx - pwS / 2

    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.fillRect(x0 + pageShadow * scale, y + pageShadow * scale, pwS, phS)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(x0, y, pwS, phS)

    const img = imgs[i]
    const innerWS = sw * scale
    const innerHS = sh * scale
    const ix = x0 + innerPad * scale
    const iy = y + innerPad * scale
    drawScaled(ctx, img, ix, iy, innerWS, innerHS)

    y += phS + pageGap * scale
  }

  return canvas.toDataURL('image/png')
}

/** GIF：按最长边限制生成各帧 data URL，供界面轮播 */
export function renderGifFrameDataUrls(imgs: HTMLImageElement[], maxSide: number): string[] {
  const cap = Math.max(64, Math.min(maxSide, 640))
  return imgs.map((img) => {
    const nw = img.naturalWidth
    const nh = img.naturalHeight
    const r = Math.max(nw, nh) / cap
    const w = Math.max(1, Math.round(nw / r))
    const h = Math.max(1, Math.round(nh / r))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, w, h)
    drawScaled(ctx, img, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  })
}

export async function buildMergeCompositePreview(
  files: string[],
  readBase64: (path: string) => Promise<unknown>,
  mode: MergePreviewMode,
  spacing: number,
  stripBg: string,
  gifMax: number,
  stripCrops?: MergeStripCropRatios[]
): Promise<{ kind: 'static'; dataUrl: string } | { kind: 'gif'; frames: string[] }> {
  const imgs = await pathsToImages(files, readBase64)
  const cropArr = stripCrops?.length ? stripCrops : undefined

  if (mode === 'strip-h') {
    return {
      kind: 'static',
      dataUrl: renderStripPreview(imgs, 'horizontal', spacing, stripBg, PREVIEW_MAX_SIDE, cropArr),
    }
  }
  if (mode === 'strip-v') {
    return {
      kind: 'static',
      dataUrl: renderStripPreview(imgs, 'vertical', spacing, stripBg, PREVIEW_MAX_SIDE, cropArr),
    }
  }
  if (mode === 'pdf') {
    return { kind: 'static', dataUrl: renderPdfStackPreview(imgs, PREVIEW_MAX_SIDE) }
  }
  return { kind: 'gif', frames: renderGifFrameDataUrls(imgs, gifMax) }
}
