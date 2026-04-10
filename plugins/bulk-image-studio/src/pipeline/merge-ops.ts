import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import {
  DEFAULT_MERGE_STRIP_CROP,
  type ManualCropPayload,
  type MergeGifPayload,
  type MergePdfPayload,
  type MergeStripCropRatios,
  type MergeStripPayload,
  type MulbyFilesystem,
} from './types'
import { embedIntoPdf, PDF_A4_H, PDF_A4_W } from './pdf-embed'
import { fsLog, PLUGIN_LOG } from '../plugin-log'

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (h.length < 6) {
    return { r: 255, g: 255, b: 255 }
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

async function readBuffer(fs: MulbyFilesystem, filePath: string, reason: string): Promise<Buffer> {
  fsLog('readFile', filePath, { reason })
  const raw = await Promise.resolve(fs.readFile(filePath))
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
  throw new Error('无法读取为二进制')
}

function stripRatiosToExtract(
  w: number,
  h: number,
  _direction: 'horizontal' | 'vertical',
  r: MergeStripCropRatios
): { left: number; top: number; width: number; height: number } {
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
  const minFrac = 0.02
  let x0 = clamp01(r.x0) * w
  let x1 = clamp01(r.x1) * w
  let y0 = clamp01(r.y0) * h
  let y1 = clamp01(r.y1) * h
  if (x1 < x0) [x0, x1] = [x1, x0]
  if (y1 < y0) [y0, y1] = [y1, y0]
  const minW = Math.max(1, Math.floor(w * minFrac))
  const minH = Math.max(1, Math.floor(h * minFrac))
  if (x1 - x0 < minW) {
    const mid = (x0 + x1) / 2
    x0 = Math.max(0, mid - minW / 2)
    x1 = Math.min(w, x0 + minW)
  }
  if (y1 - y0 < minH) {
    const mid = (y0 + y1) / 2
    y0 = Math.max(0, mid - minH / 2)
    y1 = Math.min(h, y0 + minH)
  }
  return {
    left: Math.round(x0),
    top: Math.round(y0),
    width: Math.max(1, Math.round(x1 - x0)),
    height: Math.max(1, Math.round(y1 - y0)),
  }
}

export async function mergeToPdf(fs: MulbyFilesystem, payload: MergePdfPayload): Promise<void> {
  const { files, outPath, pageLayout = 'perImage', marginPts = 36 } = payload
  console.log(PLUGIN_LOG, '[merge]', 'mergeToPdf', { pageCount: files.length, outPath, pageLayout, marginPts })
  const pdf = await PDFDocument.create()
  const m = Math.max(0, marginPts)
  for (let i = 0; i < files.length; i++) {
    const fp = files[i]
    const bytes = await readBuffer(fs, fp, `mergePdf[${i}]`)
    const img = await embedIntoPdf(pdf, bytes)
    const iw = img.width
    const ih = img.height
    if (pageLayout === 'a4') {
      const innerW = PDF_A4_W - 2 * m
      const innerH = PDF_A4_H - 2 * m
      const scale = Math.min(innerW / iw, innerH / ih)
      const dw = iw * scale
      const dh = ih * scale
      const x = m + (innerW - dw) / 2
      const y = m + (innerH - dh) / 2
      const page = pdf.addPage([PDF_A4_W, PDF_A4_H])
      page.drawImage(img, { x, y, width: dw, height: dh })
    } else {
      const page = pdf.addPage([iw, ih])
      page.drawImage(img, { x: 0, y: 0, width: iw, height: ih })
    }
  }
  const out = await pdf.save()
  fsLog('writeFile', outPath, { reason: 'mergePdf' })
  await Promise.resolve(fs.writeFile(outPath, Buffer.from(out)))
}

export async function mergeToStrip(fs: MulbyFilesystem, payload: MergeStripPayload): Promise<void> {
  const { files, outPath, direction, spacing = 0, background = '#ffffff', stripCropRatios, maxOutputMegapixels = 200 } = payload
  console.log(PLUGIN_LOG, '[merge]', 'mergeToStrip', { direction, fileCount: files.length, outPath, hasCrops: !!stripCropRatios?.length })
  const rawBufs = await Promise.all(files.map((f, i) => readBuffer(fs, f, `mergeStrip[${i}]`)))
  const bufs: Buffer[] = []
  const widths: number[] = []
  const heights: number[] = []
  for (let i = 0; i < rawBufs.length; i++) {
    let buf = rawBufs[i]
    let meta = await sharp(buf, { failOn: 'none', animated: false }).metadata()
    let w = meta.width || 1
    let h = meta.height || 1
    const r = stripCropRatios?.[i] ?? DEFAULT_MERGE_STRIP_CROP
    const fullRect =
      r.x0 <= 1e-6 && r.x1 >= 1 - 1e-6 && r.y0 <= 1e-6 && r.y1 >= 1 - 1e-6
    const needExtract = !fullRect
    if (needExtract) {
      const ex = stripRatiosToExtract(w, h, direction, r)
      buf = await sharp(buf, { failOn: 'none', animated: false }).extract(ex).toBuffer()
      meta = await sharp(buf, { failOn: 'none', animated: false }).metadata()
      w = meta.width || 1
      h = meta.height || 1
    }
    bufs.push(buf)
    widths.push(w)
    heights.push(h)
  }

  let outW = 0
  let outH = 0
  if (direction === 'vertical') {
    outW = Math.max(...widths)
    outH = heights.reduce((a, b) => a + b, 0) + spacing * Math.max(0, files.length - 1)
  } else {
    outW = widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, files.length - 1)
    outH = Math.max(...heights)
  }

  const cap = Math.max(1, maxOutputMegapixels) * 1_000_000
  const px = outW * outH
  if (px > cap) {
    throw new Error(
      `长图输出约 ${Math.round(px / 1_000_000)}MP，超过上限 ${maxOutputMegapixels}MP。请减少张数、缩小单图或调整裁剪。`
    )
  }

  const { r, g, b } = hexToRgb(background)

  const composites: sharp.OverlayOptions[] = []
  let ox = 0
  let oy = 0
  for (let i = 0; i < bufs.length; i++) {
    const buf = bufs[i]
    const w = widths[i]
    const h = heights[i]
    let left = ox
    let top = oy
    if (direction === 'vertical') {
      left = Math.round((outW - w) / 2)
      top = oy
      oy += h + spacing
    } else {
      left = ox
      top = Math.round((outH - h) / 2)
      ox += w + spacing
    }
    composites.push({ input: buf, left, top })
  }

  const canvas = sharp({
    create: {
      width: outW,
      height: outH,
      channels: 3,
      background: { r, g, b },
    },
  })
  const outBuf = await canvas.composite(composites).png().toBuffer()
  const ext = path.extname(outPath).toLowerCase()
  let out = sharp(outBuf, { failOn: 'none' })
  if (ext === '.jpg' || ext === '.jpeg') {
    const j = await out.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
    fsLog('writeFile', outPath, { reason: 'mergeStrip-jpeg' })
    await Promise.resolve(fs.writeFile(outPath, j))
    return
  }
  if (ext === '.webp') {
    const j = await out.webp({ quality: 88 }).toBuffer()
    fsLog('writeFile', outPath, { reason: 'mergeStrip-webp' })
    await Promise.resolve(fs.writeFile(outPath, j))
    return
  }
  fsLog('writeFile', outPath, { reason: 'mergeStrip-png' })
  await Promise.resolve(fs.writeFile(outPath, outBuf))
}

export async function mergeToGif(fs: MulbyFilesystem, payload: MergeGifPayload): Promise<void> {
  const { files, outPath, frameDelayMs = 100, loop = true, maxSide = 800, paletteReduce } = payload
  const GIFEncoderMod = (await import('gif-encoder-2')) as { default: new (...args: unknown[]) => { start(): void; setRepeat(n: number): void; setDelay(ms: number): void; setQuality(q: number): void; addFrame(buf: Buffer): void; finish(): void; out: { getData(): Buffer } } }
  const GIFEncoder = GIFEncoderMod.default
  console.log(PLUGIN_LOG, '[merge]', 'mergeToGif', { frameCount: files.length, outPath })
  const bufs = await Promise.all(files.map((f, i) => readBuffer(fs, f, `mergeGif[${i}]`)))

  const dims: { tw: number; th: number }[] = []
  let maxW = 0
  let maxH = 0
  for (const b of bufs) {
    const m = await sharp(b, { failOn: 'none', animated: false }).metadata()
    const iw = m.width || 1
    const ih = m.height || 1
    const scale = Math.min(1, maxSide / Math.max(iw, ih))
    const tw = Math.max(1, Math.round(iw * scale))
    const th = Math.max(1, Math.round(ih * scale))
    dims.push({ tw, th })
    maxW = Math.max(maxW, tw)
    maxH = Math.max(maxH, th)
  }

  const normalized: Buffer[] = []
  for (let i = 0; i < bufs.length; i++) {
    const b = bufs[i]
    const { tw, th } = dims[i]
    let chain = sharp(b, { failOn: 'none', animated: false })
      .resize(tw, th, { fit: 'fill' })
      .ensureAlpha()
      .extend({
        top: Math.floor((maxH - th) / 2),
        bottom: Math.ceil((maxH - th) / 2),
        left: Math.floor((maxW - tw) / 2),
        right: Math.ceil((maxW - tw) / 2),
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
    if (paletteReduce) {
      const pngBuf = await chain.png({ palette: true, colors: 128, effort: 7 }).toBuffer()
      chain = sharp(pngBuf, { failOn: 'none' }).ensureAlpha()
    }
    const resized = await chain.raw().toBuffer()
    normalized.push(resized)
  }

  const encoder = new GIFEncoder(maxW, maxH, 'octree', true, normalized.length)
  encoder.start()
  encoder.setRepeat(loop ? 0 : -1)
  encoder.setDelay(Math.max(20, frameDelayMs))
  encoder.setQuality(10)
  for (const frame of normalized) {
    encoder.addFrame(frame)
  }
  encoder.finish()
  const gifBuf = encoder.out.getData()
  fsLog('writeFile', outPath, { reason: 'mergeGif' })
  await Promise.resolve(fs.writeFile(outPath, gifBuf))
}

export async function applyManualCrop(fs: MulbyFilesystem, payload: ManualCropPayload): Promise<void> {
  const { filePath, rect, outPath } = payload
  console.log(PLUGIN_LOG, '[merge]', 'applyManualCrop', { filePath, outPath, rect })
  const buf = await readBuffer(fs, filePath, 'manualCrop:input')
  const ext = path.extname(outPath).toLowerCase()
  let img = sharp(buf, { failOn: 'none', animated: false }).extract({
    left: Math.max(0, Math.round(rect.left)),
    top: Math.max(0, Math.round(rect.top)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  })
  let out: Buffer
  if (ext === '.jpg' || ext === '.jpeg') {
    out = await img.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
  } else if (ext === '.webp') {
    out = await img.webp({ quality: 88 }).toBuffer()
  } else if (ext === '.png') {
    out = await img.png().toBuffer()
  } else {
    out = await img.png().toBuffer()
  }
  fsLog('writeFile', outPath, { reason: 'manualCrop' })
  await Promise.resolve(fs.writeFile(outPath, out))
}
