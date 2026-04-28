import path from 'node:path'
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { optimize } from 'svgo'
import toIco from 'to-ico'
import { sharp, type OverlayOptions, type SharpLike } from './sharp-client'
import type {
  BatchCommitPayload,
  BatchCommitResult,
  BatchDiscardPayload,
  BatchProcessPayload,
  BatchProcessResult,
  BatchStep,
  MulbyFilesystem,
} from './types'
import { buildSingleImagePdf } from './pdf-embed'
import { parseColorToRgba } from './color-parse'
import { fsLog, PLUGIN_LOG } from '../plugin-log'

function sanitizeFileBaseName(s: string): string {
  const t = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim()
  return t.slice(0, 200) || 'output'
}

function applyOutputNameTemplate(
  template: string,
  ctx: { stem: string; extNoDot: string; index: number; date: string; w: number; h: number }
): string {
  return template
    .replace(/\{stem\}/g, ctx.stem)
    .replace(/\{ext\}/g, ctx.extNoDot)
    .replace(/\{index\}/g, String(ctx.index))
    .replace(/\{date\}/g, ctx.date)
    .replace(/\{w\}/g, String(ctx.w))
    .replace(/\{h\}/g, String(ctx.h))
}

async function fsExists(fs: MulbyFilesystem, p: string): Promise<boolean> {
  return await Promise.resolve(fs.exists(p))
}

async function readBuffer(fs: MulbyFilesystem, filePath: string, reason: string): Promise<Buffer> {
  fsLog('readFile', filePath, { reason })
  const raw = await Promise.resolve(fs.readFile(filePath))
  if (Buffer.isBuffer(raw)) return raw
  if (raw instanceof Uint8Array) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
  throw new Error('无法读取为二进制')
}

function normalizeOutFormat(f: string): string {
  if (f === 'jpg') return 'jpeg'
  return f
}

function defaultFormatFromPath(filePath: string): string {
  const e = path.extname(filePath).toLowerCase().replace(/^\./, '')
  if (e === 'jpg') return 'jpeg'
  return e || 'png'
}

function positionToOffset(
  pos: string | undefined,
  cw: number,
  ch: number,
  mw: number,
  mh: number,
  margin: number
): { left: number; top: number } {
  const p = pos ?? 'br'
  switch (p) {
    case 'tl':
      return { left: margin, top: margin }
    case 'tr':
      return { left: Math.max(0, cw - mw - margin), top: margin }
    case 'bl':
      return { left: margin, top: Math.max(0, ch - mh - margin) }
    case 'br':
      return { left: Math.max(0, cw - mw - margin), top: Math.max(0, ch - mh - margin) }
    default:
      return { left: Math.round((cw - mw) / 2), top: Math.round((ch - mh) / 2) }
  }
}

async function svgRoundedMask(w: number, h: number, r: number): Promise<Buffer> {
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="white"/>
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function makeTextWatermarkPng(
  text: string,
  fontSize: number,
  color: string,
  opacity: number,
  rotateDeg: number
): Promise<{ buf: Buffer; w: number; h: number }> {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  const pad = Math.ceil(fontSize * 0.5)
  const tw = Math.max(80, esc.length * fontSize * 0.65 + pad * 2)
  const th = fontSize + pad * 2
  const rgba = parseColorToRgba(color, opacity)
  const svg = `<svg width="${tw}" height="${th}" xmlns="http://www.w3.org/2000/svg">
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial, sans-serif" font-size="${fontSize}"
    fill="rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.alpha})"
    transform="rotate(${rotateDeg}, ${tw / 2}, ${th / 2})">${esc}</text>
</svg>`
  const buf = await sharp(Buffer.from(svg)).png().toBuffer()
  const m = await sharp(buf).metadata()
  return { buf, w: m.width || tw, h: m.height || th }
}

type RasterPipelineState = {
  compressQuality?: number
  outFormat: string | null
  pdfOutput?: { pageLayout: 'perImage' | 'a4'; marginPts: number }
}

async function applyRasterStep(
  img: SharpLike,
  step: BatchStep,
  fs: MulbyFilesystem,
  state: RasterPipelineState
): Promise<SharpLike> {
  switch (step.kind) {
    case 'compress':
      state.compressQuality = step.quality ?? 80
      return img
    case 'convert':
      state.outFormat = normalizeOutFormat(step.format === 'jpg' ? 'jpeg' : step.format)
      return img
    case 'resize': {
      const m = await img.metadata()
      let width = step.width
      let height = step.height
      if (step.percent != null && step.percent > 0) {
        width = Math.max(1, Math.round((m.width || 1) * (step.percent / 100)))
        height = Math.max(1, Math.round((m.height || 1) * (step.percent / 100)))
      }
      if (width == null && height == null) return img
      return img.resize({
        width: width ?? undefined,
        height: height ?? undefined,
        fit: step.fit ?? 'inside',
        withoutEnlargement: false,
      })
    }
    case 'cropAspect': {
      const m = await img.metadata()
      const W = m.width || 1
      const H = m.height || 1
      const ar = step.aspectW / step.aspectH
      const ir = W / H
      let left = 0
      let top = 0
      let cw = W
      let ch = H
      if (ir > ar) {
        cw = Math.round(H * ar)
        ch = H
        left = Math.round((W - cw) / 2)
        if (step.gravity === 'west') left = 0
        if (step.gravity === 'east') left = W - cw
      } else {
        cw = W
        ch = Math.round(W / ar)
        top = Math.round((H - ch) / 2)
        if (step.gravity === 'north') top = 0
        if (step.gravity === 'south') top = H - ch
      }
      return img.extract({ left, top, width: cw, height: ch })
    }
    case 'rotate':
      return img.rotate(step.angle, {
        background: step.background ? parseColorToRgba(step.background, 1) : { r: 0, g: 0, b: 0, alpha: 0 },
      })
    case 'flip': {
      let o = img
      if (step.vertical) o = o.flip()
      if (step.horizontal) o = o.flop()
      return o
    }
    case 'padding': {
      const rgba = parseColorToRgba(step.color ?? '#000000', step.opacity ?? 1)
      return img.extend({
        top: step.top ?? 0,
        bottom: step.bottom ?? 0,
        left: step.left ?? 0,
        right: step.right ?? 0,
        background: rgba,
      })
    }
    case 'rounded': {
      const m = await img.metadata()
      const w = m.width || 1
      const h = m.height || 1
      const minS = Math.min(w, h)
      let r =
        step.fixedRadiusPx ??
        Math.round((minS * (step.percentOfMinSide ?? 10)) / 100)
      r = Math.max(1, Math.min(r, Math.floor(minS / 2)))
      const mask = await svgRoundedMask(w, h, r)
      return img.ensureAlpha().composite([{ input: mask, blend: 'dest-in' }])
    }
    case 'watermarkText': {
      const m = await img.metadata()
      const cw = m.width || 1
      const ch = m.height || 1
      const margin = step.margin ?? 12
      const { buf: wmBuf, w: mw, h: mh } = await makeTextWatermarkPng(
        step.text,
        step.fontSize ?? 24,
        step.color ?? '#ffffff',
        step.opacity ?? 0.6,
        step.rotateDeg ?? 0
      )
      if (step.tile) {
        const composites: OverlayOptions[] = []
        const stepX = mw + margin
        const stepY = mh + margin
        for (let y = -mh; y < ch + mh; y += stepY) {
          for (let x = -mw; x < cw + mw; x += stepX) {
            composites.push({ input: wmBuf, left: Math.round(x), top: Math.round(y), blend: 'over' })
          }
        }
        return img.composite(composites)
      }
      const { left, top } = positionToOffset(step.position, cw, ch, mw, mh, margin)
      return img.composite([{ input: wmBuf, left, top, blend: 'over' }])
    }
    case 'toPdf':
      state.pdfOutput = {
        pageLayout: step.pageLayout ?? 'perImage',
        marginPts: step.marginPts ?? 36,
      }
      return img
    case 'watermarkImage': {
      const wmRaw = await readBuffer(fs, step.path, 'watermarkImage')
      let wm = sharp(wmRaw, { failOn: 'none' })
      const m = await img.metadata()
      const cw = m.width || 1
      const ch = m.height || 1
      const scale = step.scale ?? 0.25
      const tw = Math.max(8, Math.round(cw * scale))
      wm = wm.resize({ width: tw, fit: 'inside' })
      let wmBuf = await wm.ensureAlpha().png().toBuffer()
      if (step.opacity != null && step.opacity < 1) {
        const { data, info } = await sharp(wmBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        const d = Buffer.from(data)
        const op = step.opacity
        for (let i = 3; i < d.length; i += 4) {
          d[i] = Math.round(d[i] * op)
        }
        wmBuf = await sharp(d, {
          raw: { width: info.width, height: info.height, channels: 4 },
        })
          .png()
          .toBuffer()
      }
      const wmMeta = await sharp(wmBuf).metadata()
      const mw = wmMeta.width || 1
      const mh = wmMeta.height || 1
      const margin = step.margin ?? 12
      if (step.rotateDeg) {
        wmBuf = await sharp(wmBuf).rotate(step.rotateDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
      }
      const wmMeta2 = await sharp(wmBuf).metadata()
      const mw2 = wmMeta2.width || mw
      const mh2 = wmMeta2.height || mh
      if (step.tile) {
        const composites: OverlayOptions[] = []
        const stepX = mw2 + margin
        const stepY = mh2 + margin
        for (let y = -mh2; y < ch + mh2; y += stepY) {
          for (let x = -mw2; x < cw + mw2; x += stepX) {
            composites.push({ input: wmBuf, left: Math.round(x), top: Math.round(y), blend: 'over' })
          }
        }
        return img.composite(composites)
      }
      const { left, top } = positionToOffset(step.position, cw, ch, mw2, mh2, margin)
      return img.composite([{ input: wmBuf, left, top, blend: 'over' }])
    }
    default:
      return img
  }
}

async function encodeSharpOutput(
  img: SharpLike,
  format: string,
  quality: number | undefined
): Promise<Buffer> {
  const q = quality ?? 82
  switch (format) {
    case 'jpeg':
      return img.jpeg({ quality: q, mozjpeg: true }).toBuffer()
    case 'png': {
      const level = Math.min(9, Math.max(0, Math.round((100 - q) / 11)))
      return img.png({ compressionLevel: level }).toBuffer()
    }
    case 'webp':
      return img.webp({ quality: q }).toBuffer()
    case 'avif':
      return img.avif({ quality: q }).toBuffer()
    case 'tiff':
      return img.tiff({ compression: 'lzw' }).toBuffer()
    case 'bmp':
      throw new Error('当前 Mulby sharp API 不支持输出 BMP，请选择 PNG/JPEG/WebP/TIFF/AVIF/GIF/ICO')
    case 'gif':
      return img.gif().toBuffer()
    case 'ico': {
      const sizes = [16, 32, 48, 64, 128, 256]
      const pngs = await Promise.all(
        sizes.map((s) => img.clone().resize(s, s, { fit: 'cover' }).png().toBuffer())
      )
      return Buffer.from(await toIco(pngs))
    }
    default:
      return img.png().toBuffer()
  }
}

export async function runBatchProcess(fs: MulbyFilesystem, payload: BatchProcessPayload): Promise<BatchProcessResult> {
  const { files, steps, nameSuffix = '_out', autoExifOrient } = payload
  const tempRoot = path.join(os.tmpdir(), 'mulby-bulk-image-studio', randomBytes(8).toString('hex'))
  console.log(PLUGIN_LOG, '[batch]', 'runBatchProcess', {
    fileCount: files?.length,
    tempRoot,
    nameSuffix,
    stepKinds: steps?.map((s) => s.kind),
  })
  await Promise.resolve(fs.mkdir(tempRoot))

  const staged: BatchProcessResult['staged'] = []
  const errors: BatchProcessResult['errors'] = []

  for (let fi = 0; fi < files.length; fi++) {
    const filePath = files[fi]
    console.log(PLUGIN_LOG, '[batch]', `file[${fi}]`, {
      filePath,
      type: typeof filePath,
      ok: typeof filePath === 'string' && filePath.length > 0,
    })
    try {
      const tempPath = await processSingleFileToTemp(fs, filePath, steps, tempRoot, nameSuffix, fi, {
        autoExifOrient,
      })
      staged.push({ sourcePath: filePath, tempPath })
    } catch (e) {
      errors.push({ file: String(filePath), message: e instanceof Error ? e.message : String(e) })
    }
  }

  console.log(PLUGIN_LOG, '[batch]', 'runBatchProcess done', { staged: staged.length, errors: errors.length })
  return { staged, errors, tempRoot }
}

export async function commitBatchStaging(fs: MulbyFilesystem, payload: BatchCommitPayload): Promise<BatchCommitResult> {
  const { mode, otherDir, nameSuffix = '_out', items, outputNameTemplate } = payload
  const tplRaw = outputNameTemplate?.trim()
  const useTemplate = Boolean(tplRaw && (mode === 'sameDir' || mode === 'otherDir'))
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const written: string[] = []
  const errors: BatchCommitResult['errors'] = []

  for (let idx = 0; idx < items.length; idx++) {
    const { sourcePath, tempPath } = items[idx]
    try {
      const buf = await readBuffer(fs, tempPath, 'commit:readTemp')
      const outExt = path.extname(tempPath).toLowerCase() || '.png'
      const dir = path.dirname(sourcePath)
      const srcExt = path.extname(sourcePath).toLowerCase()
      const stem = path.basename(sourcePath, srcExt)
      let metaWh = { w: 0, h: 0 }
      try {
        const m = await sharp(buf, { failOn: 'none' }).metadata()
        metaWh = { w: m.width ?? 0, h: m.height ?? 0 }
      } catch {
        /* 元数据失败时占位符为 0 */
      }
      const extNoDot = outExt.replace(/^\./, '') || 'png'

      let finalPath: string
      if (mode === 'overwrite') {
        if (srcExt === outExt) {
          finalPath = sourcePath
        } else {
          finalPath = path.join(dir, stem + outExt)
        }
        fsLog('writeFile', finalPath, { reason: 'commit-overwrite', mode })
        await Promise.resolve(fs.writeFile(finalPath, buf))
        if (finalPath !== sourcePath && (await fsExists(fs, sourcePath)) && fs.unlink) {
          await Promise.resolve(fs.unlink(sourcePath))
        }
      } else if (mode === 'sameDir') {
        const base = useTemplate && tplRaw
          ? sanitizeFileBaseName(
              applyOutputNameTemplate(tplRaw, {
                stem,
                extNoDot,
                index: idx + 1,
                date: dateStr,
                w: metaWh.w,
                h: metaWh.h,
              })
            )
          : `${stem}${nameSuffix}`
        finalPath = path.join(dir, `${base}${outExt}`)
        fsLog('writeFile', finalPath, { reason: 'commit-sameDir', mode })
        await Promise.resolve(fs.writeFile(finalPath, buf))
      } else {
        if (!otherDir || typeof otherDir !== 'string' || !otherDir.trim()) {
          throw new Error('未选择目标目录')
        }
        const od = otherDir.trim()
        await Promise.resolve(fs.mkdir(od))
        const base = useTemplate && tplRaw
          ? sanitizeFileBaseName(
              applyOutputNameTemplate(tplRaw, {
                stem,
                extNoDot,
                index: idx + 1,
                date: dateStr,
                w: metaWh.w,
                h: metaWh.h,
              })
            )
          : `${stem}${nameSuffix}`
        finalPath = path.join(od, `${base}${outExt}`)
        fsLog('writeFile', finalPath, { reason: 'commit-otherDir', mode })
        await Promise.resolve(fs.writeFile(finalPath, buf))
      }

      written.push(finalPath)
      if ((await fsExists(fs, tempPath)) && fs.unlink) {
        await Promise.resolve(fs.unlink(tempPath))
      }
    } catch (e) {
      errors.push({ file: sourcePath, message: e instanceof Error ? e.message : String(e) })
    }
  }

  return { written, errors }
}

export async function discardBatchStaging(fs: MulbyFilesystem, payload: BatchDiscardPayload): Promise<void> {
  if (!fs.unlink) return
  for (const { tempPath } of payload.items) {
    try {
      if (await fsExists(fs, tempPath)) {
        await Promise.resolve(fs.unlink(tempPath))
      }
    } catch {
      /* 忽略清理失败 */
    }
  }
}

/** 写入临时目录，返回产出文件的绝对路径 */
async function processSingleFileToTemp(
  fs: MulbyFilesystem,
  filePath: string,
  steps: BatchStep[],
  tempRoot: string,
  nameSuffix: string,
  fileIndex: number,
  opts?: { autoExifOrient?: boolean }
): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath, ext)
  const prefix = `${fileIndex}_`
  console.log(PLUGIN_LOG, '[batch]', 'processSingleFileToTemp', { filePath, ext, tempRoot })

  if (steps.length === 1 && steps[0].kind === 'svgMinify' && ext === '.svg') {
    const buf = await readBuffer(fs, filePath, 'svgMinify-only')
    const o = optimize(buf.toString('utf8'), { path: filePath })
    const outPath = path.join(tempRoot, `${prefix}${base}${nameSuffix}.svg`)
    fsLog('writeFile', outPath, { reason: 'svgMinify-temp', encoding: 'utf-8' })
    await Promise.resolve(fs.writeFile(outPath, o.data, 'utf-8'))
    return outPath
  }

  let work = await readBuffer(fs, filePath, 'processSingleFile:input')
  const state: RasterPipelineState = { outFormat: null }

  for (const step of steps) {
    if (step.kind === 'svgMinify') {
      if (ext !== '.svg') continue
      const o = optimize(work.toString('utf8'), { path: filePath })
      work = Buffer.from(o.data)
      continue
    }
  }

  let img = sharp(work, { density: 300, animated: false, failOn: 'none', limitInputPixels: false })
  if (opts?.autoExifOrient) {
    img = img.rotate()
  }

  for (const step of steps) {
    if (step.kind === 'svgMinify') continue
    img = await applyRasterStep(img, step, fs, state)
  }

  if (state.pdfOutput) {
    const rasterBuf = await img.png().toBuffer()
    const pdfBytes = await buildSingleImagePdf(rasterBuf, state.pdfOutput.pageLayout, state.pdfOutput.marginPts)
    const outPath = path.join(tempRoot, `${prefix}${base}${nameSuffix}.pdf`)
    fsLog('writeFile', outPath, { reason: 'batch-temp-pdf' })
    await Promise.resolve(fs.writeFile(outPath, Buffer.from(pdfBytes)))
    return outPath
  }

  const outFmt = state.outFormat || defaultFormatFromPath(filePath)
  if (outFmt === 'svg') {
    throw new Error('不支持输出为 SVG（请使用「SVG 优化」步骤处理矢量文件）')
  }

  const outBuffer = await encodeSharpOutput(img, outFmt, state.compressQuality)
  const extOut =
    outFmt === 'jpeg'
      ? '.jpg'
      : outFmt === 'tiff'
        ? '.tiff'
        : `.${outFmt}`
  const outPath = path.join(tempRoot, `${prefix}${base}${nameSuffix}${extOut}`)
  fsLog('writeFile', outPath, { reason: 'batch-temp', format: outFmt })
  await Promise.resolve(fs.writeFile(outPath, outBuffer))
  return outPath
}
