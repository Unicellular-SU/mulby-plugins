import type { RawImage, SessionRunner } from './types'
import { resizeBilinear, toModelInput } from './imaging'

export interface RecognizedText {
  text: string
  score: number
}

const REC_HEIGHT = 48
const REC_BATCH_SIZE = 6
const REC_MEAN: [number, number, number] = [0.5, 0.5, 0.5]
const REC_STD: [number, number, number] = [0.5, 0.5, 0.5]

/**
 * Build the CTC dictionary from ppocr_keys_v1.txt content.
 * Class 0 is the CTC blank; class i maps to dict[i - 1]. The trailing ' '
 * entry matches PaddleOCR's ppocr_keys_v1 handling (adds the space char).
 */
export function buildDictionary(keysText: string): string[] {
  return [...keysText.split('\n'), ' ']
}

/**
 * Recognize cropped line images, in batches.
 *
 * Mirrors RapidOCR's batching: crops are sorted by aspect ratio, each batch
 * shares a tensor width derived from the widest crop in it
 * (batchW = 48 * maxAspect), and narrower crops are zero-padded. Long lines
 * are therefore never squished — a fixed 320px cap destroys recognition on
 * wide text lines.
 *
 * Results stay aligned 1:1 with the input crops; the caller pairs them with
 * boxes and drops low-confidence lines.
 */
export async function recognizeLines(
  run: SessionRunner,
  crops: RawImage[],
  dict: string[],
): Promise<RecognizedText[]> {
  const results: RecognizedText[] = crops.map(() => ({ text: '', score: 0 }))
  if (crops.length === 0) return results

  const aspects = crops.map((c) => c.width / Math.max(1, c.height))
  const order = crops.map((_, i) => i).sort((a, b) => aspects[a] - aspects[b])

  for (let beg = 0; beg < crops.length; beg += REC_BATCH_SIZE) {
    const batchIdx = order.slice(beg, beg + REC_BATCH_SIZE)
    let maxRatio = 0
    for (const i of batchIdx) maxRatio = Math.max(maxRatio, aspects[i])
    const batchW = Math.max(1, Math.ceil(REC_HEIGHT * maxRatio))

    const plane = REC_HEIGHT * batchW
    const batchData = new Float32Array(batchIdx.length * 3 * plane)
    for (let b = 0; b < batchIdx.length; b++) {
      const crop = crops[batchIdx[b]]
      const resizedW = Math.max(1, Math.min(batchW, Math.ceil(REC_HEIGHT * aspects[batchIdx[b]])))
      const resized = resizeBilinear(crop, resizedW, REC_HEIGHT)
      const input = toModelInput(resized, REC_MEAN, REC_STD)
      const srcPlane = REC_HEIGHT * resizedW
      for (let c = 0; c < 3; c++) {
        for (let y = 0; y < REC_HEIGHT; y++) {
          batchData.set(
            input.data.subarray(c * srcPlane + y * resizedW, c * srcPlane + (y + 1) * resizedW),
            b * 3 * plane + c * plane + y * batchW,
          )
        }
      }
    }

    const output = await run({ data: batchData, dims: [batchIdx.length, 3, REC_HEIGHT, batchW] })
    const steps = output.dims[1]
    const classes = output.dims[2]
    for (let b = 0; b < batchIdx.length; b++) {
      results[batchIdx[b]] = ctcDecode(
        output.data.subarray(b * steps * classes, (b + 1) * steps * classes),
        steps,
        classes,
        dict,
      )
    }
  }
  return results
}

/** Minimum mean character confidence for a line to be kept. */
export const TEXT_SCORE_THRESHOLD = 0.5

/** CTC greedy decode: argmax per step, drop blanks (0) and repeated labels. */
function ctcDecode(data: Float32Array, steps: number, classes: number, dict: string[]): RecognizedText {
  const chars: string[] = []
  const probs: number[] = []
  let prevIdx = -1
  for (let t = 0; t < steps; t++) {
    const offset = t * classes
    let maxIdx = 0
    let maxVal = -Infinity
    for (let c = 0; c < classes; c++) {
      const v = data[offset + c]
      if (v > maxVal) {
        maxVal = v
        maxIdx = c
      }
    }
    if (maxIdx !== 0 && maxIdx !== prevIdx) {
      const ch = dict[maxIdx - 1]
      if (ch) {
        chars.push(ch)
        probs.push(maxVal)
      }
    }
    prevIdx = maxIdx
  }
  const score = probs.length === 0 ? 0 : probs.reduce((a, b) => a + b, 0) / probs.length
  return { text: chars.join(''), score }
}
