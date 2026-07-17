import type { ModelInput, Point, RawImage } from './types'

/** Bilinear resize of an RGBA image. */
export function resizeBilinear(src: RawImage, dstW: number, dstH: number): RawImage {
  dstW = Math.max(1, Math.round(dstW))
  dstH = Math.max(1, Math.round(dstH))
  if (dstW === src.width && dstH === src.height) {
    return { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height }
  }
  const dst = new Uint8ClampedArray(dstW * dstH * 4)
  const scaleX = src.width / dstW
  const scaleY = src.height / dstH
  for (let y = 0; y < dstH; y++) {
    const srcY = (y + 0.5) * scaleY - 0.5
    const y0 = Math.max(0, Math.floor(srcY))
    const y1 = Math.min(src.height - 1, y0 + 1)
    const fy = Math.min(1, Math.max(0, srcY - y0))
    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * scaleX - 0.5
      const x0 = Math.max(0, Math.floor(srcX))
      const x1 = Math.min(src.width - 1, x0 + 1)
      const fx = Math.min(1, Math.max(0, srcX - x0))
      const i00 = (y0 * src.width + x0) * 4
      const i01 = (y0 * src.width + x1) * 4
      const i10 = (y1 * src.width + x0) * 4
      const i11 = (y1 * src.width + x1) * 4
      const di = (y * dstW + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = src.data[i00 + c] + (src.data[i01 + c] - src.data[i00 + c]) * fx
        const bottom = src.data[i10 + c] + (src.data[i11 + c] - src.data[i10 + c]) * fx
        dst[di + c] = top + (bottom - top) * fy
      }
    }
  }
  return { data: dst, width: dstW, height: dstH }
}

/**
 * Perspective crop of a quadrilateral region into an axis-aligned image
 * (equivalent to cv2.getPerspectiveTransform + warpPerspective).
 * `box` is [tl, tr, br, bl]; output dimensions follow the quad's edge lengths.
 */
export function cropPerspective(src: RawImage, box: Point[]): RawImage {
  const norm = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const dstW = Math.max(1, Math.round(Math.max(norm(box[0], box[1]), norm(box[2], box[3]))))
  const dstH = Math.max(1, Math.round(Math.max(norm(box[0], box[3]), norm(box[1], box[2]))))

  // Homography mapping destination rect -> source quad (inverse mapping).
  const dstPts: Point[] = [[0, 0], [dstW, 0], [dstW, dstH], [0, dstH]]
  const h = homography(dstPts, box)

  const dst = new Uint8ClampedArray(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const w = h[6] * x + h[7] * y + h[8]
      const sx = (h[0] * x + h[1] * y + h[2]) / w
      const sy = (h[3] * x + h[4] * y + h[5]) / w
      const di = (y * dstW + x) * 4
      if (sx < 0 || sy < 0 || sx > src.width - 1 || sy > src.height - 1) {
        // Outside source: replicate nearest edge pixel (BORDER_REPLICATE).
        const cx = Math.min(src.width - 1, Math.max(0, Math.round(sx)))
        const cy = Math.min(src.height - 1, Math.max(0, Math.round(sy)))
        const si = (cy * src.width + cx) * 4
        dst[di] = src.data[si]
        dst[di + 1] = src.data[si + 1]
        dst[di + 2] = src.data[si + 2]
        dst[di + 3] = 255
        continue
      }
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(src.width - 1, x0 + 1)
      const y1 = Math.min(src.height - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * src.width + x0) * 4
      const i01 = (y0 * src.width + x1) * 4
      const i10 = (y1 * src.width + x0) * 4
      const i11 = (y1 * src.width + x1) * 4
      for (let c = 0; c < 4; c++) {
        const top = src.data[i00 + c] + (src.data[i01 + c] - src.data[i00 + c]) * fx
        const bottom = src.data[i10 + c] + (src.data[i11 + c] - src.data[i10 + c]) * fx
        dst[di + c] = top + (bottom - top) * fy
      }
    }
  }
  return { data: dst, width: dstW, height: dstH }
}

/** Solve a 3x3 homography mapping `from` 4 points onto `to` 4 points. */
function homography(from: Point[], to: Point[]): number[] {
  // 8 equations, 8 unknowns (h33 = 1)
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]
    const [u, v] = to[i]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  // Gaussian elimination with partial pivoting
  const n = 8
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    }
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    ;[b[col], b[pivot]] = [b[pivot], b[col]]
    const div = a[col][col] || 1e-12
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = a[r][col] / div
      for (let c = col; c < n; c++) a[r][c] -= factor * a[col][c]
      b[r] -= factor * b[col]
    }
  }
  const h: number[] = []
  for (let i = 0; i < n; i++) h.push(b[i] / (a[i][i] || 1e-12))
  h.push(1)
  return h
}

/** Rotate an image 90 degrees counter-clockwise (matches np.rot90). */
export function rotate90CCW(src: RawImage): RawImage {
  const dstW = src.height
  const dstH = src.width
  const dst = new Uint8ClampedArray(dstW * dstH * 4)
  for (let ny = 0; ny < dstH; ny++) {
    for (let nx = 0; nx < dstW; nx++) {
      // out[ny][nx] = in[nx][srcW-1-ny]
      const si = (nx * src.width + (src.width - 1 - ny)) * 4
      const di = (ny * dstW + nx) * 4
      dst[di] = src.data[si]
      dst[di + 1] = src.data[si + 1]
      dst[di + 2] = src.data[si + 2]
      dst[di + 3] = src.data[si + 3]
    }
  }
  return { data: dst, width: dstW, height: dstH }
}

/**
 * Convert an RGBA image to a CHW float32 model input in BGR channel order
 * (matching PaddleOCR/RapidOCR, which feed cv2 BGR images).
 */
export function toModelInput(img: RawImage, mean: [number, number, number], std: [number, number, number]): ModelInput {
  const { data, width, height } = img
  const pixels = width * height
  const out = new Float32Array(3 * pixels)
  for (let i = 0; i < pixels; i++) {
    const r = data[i * 4] / 255
    const g = data[i * 4 + 1] / 255
    const b = data[i * 4 + 2] / 255
    // channel order B, G, R — mean/std are applied per BGR position
    out[i] = (b - mean[0]) / std[0]
    out[pixels + i] = (g - mean[1]) / std[1]
    out[2 * pixels + i] = (r - mean[2]) / std[2]
  }
  return { data: out, dims: [1, 3, height, width] }
}
