import type { OcrLine, Point, RawImage, SessionRunner } from './types'
import { runDetection } from './detection'
import { recognizeLines, TEXT_SCORE_THRESHOLD } from './recognition'
import { cropPerspective, rotate90CCW } from './imaging'

/**
 * PP-OCRv4 pipeline (detection -> crop -> recognition) over two ONNX
 * sessions. Pure TypeScript, no DOM / Node / ort imports, so it runs in the
 * plugin UI (WASM) and in Node smoke tests alike.
 */
export class PpOcrEngine {
  constructor(
    private detRunner: SessionRunner,
    private recRunner: SessionRunner,
    private dict: string[],
  ) {}

  /**
   * Recognize text in an RGBA image. Returns lines in reading order
   * (top-to-bottom, left-to-right).
   */
  async recognize(image: RawImage): Promise<OcrLine[]> {
    const { boxes } = await runDetection(this.detRunner, image)
    if (boxes.length === 0) return []

    const crops = boxes.map(({ box }) => {
      let crop = cropPerspective(image, box)
      // Vertical text: rotate tall crops to horizontal (PaddleOCR rule).
      if (crop.height / crop.width >= 1.5) crop = rotate90CCW(crop)
      return crop
    })

    const recs = await recognizeLines(this.recRunner, crops, this.dict)
    const lines: OcrLine[] = []
    for (let i = 0; i < boxes.length; i++) {
      const rec = recs[i]
      if (!rec || rec.text.length === 0 || rec.score < TEXT_SCORE_THRESHOLD) continue
      lines.push({ box: boxes[i].box, text: rec.text, score: rec.score })
    }
    return sortReadingOrder(lines)
  }
}

/**
 * Sort lines into reading order: group by visual line (center-y within half
 * the median line height), groups top-to-bottom, boxes left-to-right.
 */
function sortReadingOrder(lines: OcrLine[]): OcrLine[] {
  if (lines.length <= 1) return lines
  const heights = lines.map((l) => boxHeight(l.box)).sort((a, b) => a - b)
  const medianH = heights[heights.length >> 1] || 1
  const centerY = (l: OcrLine) => (l.box[0][1] + l.box[2][1]) / 2
  const leftX = (l: OcrLine) => Math.min(...l.box.map((p) => p[0]))

  const byY = [...lines].sort((a, b) => centerY(a) - centerY(b))
  const groups: OcrLine[][] = []
  for (const line of byY) {
    const group = groups[groups.length - 1]
    const groupY = group ? group.reduce((s, l) => s + centerY(l), 0) / group.length : 0
    if (group && Math.abs(centerY(line) - groupY) < Math.max(medianH * 0.5, 4)) {
      group.push(line)
    } else {
      groups.push([line])
    }
  }
  for (const group of groups) group.sort((a, b) => leftX(a) - leftX(b))
  return groups.flat()
}

function boxHeight(box: Point[]): number {
  return (
    (Math.hypot(box[0][0] - box[3][0], box[0][1] - box[3][1]) +
      Math.hypot(box[1][0] - box[2][0], box[1][1] - box[2][1])) /
    2
  )
}
