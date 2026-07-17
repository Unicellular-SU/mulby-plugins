import type { Point, RawImage, SessionRunner } from './types'
import {
  minAreaRect,
  offsetConvexPolygon,
  orderBoxPoints,
  pointInPolygon,
  polygonArea,
  polygonLength,
} from './geometry'
import { resizeBilinear, toModelInput } from './imaging'

export interface DetectedBox {
  box: Point[]
  score: number
}

export interface DetectionResult {
  /** Boxes in ORIGINAL image coordinates. */
  boxes: DetectedBox[]
  /** The (possibly resized) image the detection network ran on. */
  resized: RawImage
}

// PaddleOCR DB postprocess defaults
const LIMIT_SIDE = 960
const BASE_SIZE = 32
const DB_THRESH = 0.3
const BOX_THRESH = 0.6
const UNCLIP_RATIO = 1.5
const MAX_CANDIDATES = 1000
const MIN_SIZE = 3
const DET_MEAN: [number, number, number] = [0.485, 0.456, 0.406]
const DET_STD: [number, number, number] = [0.229, 0.224, 0.225]

/**
 * Run text detection: resize -> DB model -> binarize -> connected components
 * -> min-area rects -> score filter -> unclip. Boxes are mapped back to
 * original-image coordinates (crops must be taken from the original image,
 * otherwise small text loses all detail before recognition).
 */
export async function runDetection(run: SessionRunner, image: RawImage): Promise<DetectionResult> {
  const { width, height } = image
  let ratio = 1
  const maxSide = Math.max(width, height)
  if (maxSide > LIMIT_SIDE) ratio = LIMIT_SIDE / maxSide
  const resizedW = Math.max(BASE_SIZE, Math.ceil((width * ratio) / BASE_SIZE) * BASE_SIZE)
  const resizedH = Math.max(BASE_SIZE, Math.ceil((height * ratio) / BASE_SIZE) * BASE_SIZE)
  const resized = resizeBilinear(image, resizedW, resizedH)

  const input = toModelInput(resized, DET_MEAN, DET_STD)
  const output = await run(input)
  const predH = output.dims[2]
  const predW = output.dims[3]
  if (predH !== resizedH || predW !== resizedW) {
    throw new Error(`unexpected det output shape ${output.dims.join('x')}`)
  }
  const prob = output.data // [1,1,H,W] probabilities

  // Binarize
  const bitmap = new Uint8Array(predW * predH)
  for (let i = 0; i < prob.length; i++) {
    bitmap[i] = prob[i] > DB_THRESH ? 1 : 0
  }

  const boxes: DetectedBox[] = []
  for (const component of connectedComponents(bitmap, predW, predH)) {
    if (boxes.length >= MAX_CANDIDATES) break
    const rect = minAreaRect(component)
    if (rect.length < 4) continue
    let box = orderBoxPoints(rect)
    const sside = Math.min(
      Math.hypot(box[0][0] - box[1][0], box[0][1] - box[1][1]),
      Math.hypot(box[1][0] - box[2][0], box[1][1] - box[2][1]),
    )
    if (sside < MIN_SIZE) continue

    const score = boxScore(prob, predW, predH, box)
    if (score < BOX_THRESH) continue

    const unclipDistance = (polygonArea(box) * UNCLIP_RATIO) / (polygonLength(box) || 1)
    const expanded = offsetConvexPolygon(box, Math.abs(unclipDistance))
    const expandedRect = minAreaRect(expanded)
    if (expandedRect.length < 4) continue
    box = orderBoxPoints(expandedRect)
    const sside2 = Math.min(
      Math.hypot(box[0][0] - box[1][0], box[0][1] - box[1][1]),
      Math.hypot(box[1][0] - box[2][0], box[1][1] - box[2][1]),
    )
    if (sside2 < MIN_SIZE + 2) continue

    // Map back to original-image coordinates and clamp to image bounds
    // (x/y scales differ slightly due to rounding to multiples of 32).
    const scaleX = width / predW
    const scaleY = height / predH
    const clipped = box.map(
      ([x, y]): Point => [
        Math.min(width, Math.max(0, Math.round(x * scaleX))),
        Math.min(height, Math.max(0, Math.round(y * scaleY))),
      ],
    )
    boxes.push({ box: clipped, score })
  }

  return { boxes, resized }
}

/** Mean probability inside the box region (PaddleOCR box_score_fast). */
function boxScore(prob: Float32Array, w: number, h: number, box: Point[]): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of box) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const x0 = Math.max(0, Math.floor(minX))
  const x1 = Math.min(w - 1, Math.ceil(maxX))
  const y0 = Math.max(0, Math.floor(minY))
  const y1 = Math.min(h - 1, Math.ceil(maxY))
  let sum = 0
  let count = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, box)) {
        sum += prob[y * w + x]
        count++
      }
    }
  }
  return count === 0 ? 0 : sum / count
}

/**
 * 8-connectivity connected-component labeling (two-pass union-find).
 * Yields pixel lists (one entry per component, pixels as [x, y]).
 */
function* connectedComponents(bitmap: Uint8Array, w: number, h: number): Generator<Point[]> {
  const labels = new Int32Array(w * h)
  const parent: number[] = []
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  const newLabel = () => {
    parent.push(parent.length)
    return parent.length - 1
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!bitmap[idx]) continue
      // neighbors already visited: left, top-left, top, top-right
      const neighbors: number[] = []
      if (x > 0 && bitmap[idx - 1]) neighbors.push(labels[idx - 1])
      if (y > 0) {
        if (x > 0 && bitmap[idx - w - 1]) neighbors.push(labels[idx - w - 1])
        if (bitmap[idx - w]) neighbors.push(labels[idx - w])
        if (x < w - 1 && bitmap[idx - w + 1]) neighbors.push(labels[idx - w + 1])
      }
      if (neighbors.length === 0) {
        labels[idx] = newLabel()
      } else {
        let min = neighbors[0]
        for (const n of neighbors) if (find(n) < find(min)) min = n
        labels[idx] = min
        for (const n of neighbors) union(min, n)
      }
    }
  }

  // Second pass: gather pixels per root label
  const byLabel = new Map<number, Point[]>()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x
      if (!bitmap[idx]) continue
      const root = find(labels[idx])
      let list = byLabel.get(root)
      if (!list) {
        list = []
        byLabel.set(root, list)
      }
      list.push([x, y])
    }
  }
  yield* byLabel.values()
}
