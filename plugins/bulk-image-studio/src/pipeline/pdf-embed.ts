import { PDFDocument, type PDFImage } from 'pdf-lib'
import { sharp } from './sharp-client'

export const PDF_A4_W = 595.28
export const PDF_A4_H = 841.89

export async function toJpegForPdf(buf: Buffer): Promise<Buffer> {
  return sharp(buf, { failOn: 'none', animated: false }).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
}

export async function embedIntoPdf(pdf: PDFDocument, bytes: Buffer): Promise<PDFImage> {
  try {
    return await pdf.embedJpg(bytes)
  } catch {
    try {
      return await pdf.embedPng(bytes)
    } catch {
      const jpg = await toJpegForPdf(bytes)
      return await pdf.embedJpg(jpg)
    }
  }
}

/** 单张光栅图 → 单页 PDF（与合并 PDF 的 perImage / a4 规则一致） */
export async function buildSingleImagePdf(
  imageBytes: Buffer,
  pageLayout: 'perImage' | 'a4',
  marginPts: number
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const img = await embedIntoPdf(pdf, imageBytes)
  const iw = img.width
  const ih = img.height
  const m = Math.max(0, marginPts)
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
  return pdf.save()
}
