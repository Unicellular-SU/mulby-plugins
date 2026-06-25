import path from 'node:path'
import { sharp } from './sharp-client'
import type {
  CompressPayload,
  CompressSettings,
  StagedItem,
  BatchCompressResult,
  CommitPayload,
  CommitResult,
  DiscardPayload,
  MetadataRow,
} from './types'

function extToFormat(ext: string): string {
  const e = ext.toLowerCase().replace('.', '')
  if (e === 'jpg' || e === 'jpeg') return 'jpeg'
  return e
}

function pickOutputExt(settings: CompressSettings, inputExt: string): string {
  if (settings.format === 'original') {
    return inputExt.replace('.', '').toLowerCase() === 'jpg' ? '.jpg' : inputExt.toLowerCase()
  }
  return `.${settings.format}`
}

export async function getSingleMetadata(buf: Buffer | ArrayBuffer): Promise<{
  width: number
  height: number
  format: string
  size: number
}> {
  const meta = await sharp(buf).metadata()
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? 'unknown',
    size: Buffer.byteLength(Buffer.isBuffer(buf) ? buf : Buffer.from(buf)),
  }
}

export async function runCompressPipeline(
  fs: any,
  payload: CompressPayload,
  tempRoot: string
): Promise<BatchCompressResult> {
  const { files, settings } = payload
  const staged: StagedItem[] = []
  const errors: { file: string; message: string }[] = []

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]
    try {
      const inputBuf = (await Promise.resolve(fs.readFile(filePath))) as Buffer | ArrayBuffer | Uint8Array
      const beforeSize = Buffer.byteLength(
        Buffer.isBuffer(inputBuf) ? inputBuf : Buffer.from(inputBuf as ArrayBuffer)
      )
      const meta = await sharp(inputBuf).metadata()
      const beforeWidth = meta.width ?? 0
      const beforeHeight = meta.height ?? 0
      const inputFormat = meta.format ?? 'jpeg'
      const inputExt = path.extname(filePath)

      // Build sharp pipeline
      let pipeline = sharp(inputBuf)

      // Resize if specified
      if (settings.maxWidth || settings.maxHeight) {
        pipeline = pipeline.resize(
          settings.maxWidth ?? undefined,
          settings.maxHeight ?? undefined,
          { fit: 'inside', withoutEnlargement: true }
        )
      }

      // Apply format + compression
      const outputExt = pickOutputExt(settings, inputExt)
      const outputFormat = settings.format === 'original' ? extToFormat(inputExt) : settings.format

      if (outputFormat === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: settings.quality, mozjpeg: true, progressive: true })
      } else if (outputFormat === 'png') {
        pipeline = pipeline.png({
          compressionLevel: 9,
          effort: 7,
          palette: settings.quality < 100,
          quality: settings.quality < 100 ? settings.quality : undefined,
        })
      } else if (outputFormat === 'webp') {
        pipeline = pipeline.webp({ quality: settings.quality })
      }

      const stem = path.basename(filePath, inputExt)
      const tempPath = path.join(tempRoot, `${stem}${outputExt}`)
      const info = await pipeline.toFile(tempPath)

      const outStat = await Promise.resolve(fs.stat(tempPath))
      const afterSize = (outStat as any)?.size ?? info.size ?? 0

      // "Larger fallback" guard
      const noResize = !settings.maxWidth && !settings.maxHeight
      const sameFormat = outputFormat === extToFormat(inputExt)
      let keptOriginal = false

      if (noResize && sameFormat && afterSize >= beforeSize) {
        // Keep original — copy to temp instead
        await Promise.resolve(fs.writeFile(tempPath, inputBuf))
        keptOriginal = true
      }

      const finalAfterSize = keptOriginal ? beforeSize : afterSize

      staged.push({
        sourcePath: filePath,
        tempPath,
        beforeSize,
        afterSize: finalAfterSize,
        beforeWidth,
        beforeHeight,
        afterWidth: keptOriginal ? beforeWidth : (info.width ?? beforeWidth),
        afterHeight: keptOriginal ? beforeHeight : (info.height ?? beforeHeight),
        format: outputFormat,
        keptOriginal,
      })
    } catch (e: any) {
      errors.push({ file: filePath, message: e?.message ?? String(e) })
    }
  }

  return { staged, errors, tempRoot }
}

export async function commitCompressStaging(
  fs: any,
  payload: CommitPayload
): Promise<CommitResult> {
  const written: string[] = []
  const errors: { file: string; message: string }[] = []

  for (const item of payload.items) {
    try {
      let destPath: string
      const srcExt = path.extname(item.sourcePath)
      const destExt = path.extname(item.tempPath)

      if (payload.mode === 'overwrite') {
        // If format changed, write alongside old file
        if (srcExt.toLowerCase() !== destExt.toLowerCase()) {
          const stem = path.basename(item.sourcePath, srcExt)
          destPath = path.join(path.dirname(item.sourcePath), `${stem}${destExt}`)
        } else {
          destPath = item.sourcePath
        }
      } else if (payload.mode === 'sameDir') {
        const stem = path.basename(item.sourcePath, srcExt)
        destPath = path.join(path.dirname(item.sourcePath), `${stem}${payload.suffix}${destExt}`)
      } else {
        // otherDir
        const stem = path.basename(item.sourcePath, srcExt)
        destPath = path.join(payload.otherDir ?? path.dirname(item.sourcePath), `${stem}${destExt}`)
      }

      const tempBuf = await Promise.resolve(fs.readFile(item.tempPath))
      await Promise.resolve(fs.writeFile(destPath, tempBuf))
      written.push(destPath)
    } catch (e: any) {
      errors.push({ file: item.sourcePath, message: e?.message ?? String(e) })
    }
  }

  return { written, errors }
}

export async function discardCompressStaging(
  fs: any,
  payload: DiscardPayload
): Promise<void> {
  for (const item of payload.items) {
    try {
      await Promise.resolve(fs.unlink(item.tempPath))
    } catch {
      // Best-effort cleanup
    }
  }
  // Try to remove temp root (may fail if dir not empty — ok)
}
