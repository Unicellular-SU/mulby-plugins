/**
 * Pixelate pipeline: AI 生成的位图 → 像素风纯矢量 SVG sprite。
 *
 * 链路(全部为确定性纯函数,不依赖 DOM / sharp,可在 node 中单测):
 *   RGBA 位图 → downsample(盒式缩放) → removeBackground(边界泛洪抠背景)
 *   → quantize(中位切分调色板量化) → encodeSvg(贪心矩形覆盖 + path 编码)
 *
 * 输出与 slime-sprites.ts 的手工 sprite 同构(按色分组的 <path d="M..h..v..h..z">,
 * shape-rendering="crispEdges"),保证能通过 sprite-sanitize.ts 的白名单净化与
 * 50KB 体积限制。
 *
 * 位图解码(PNG/base64 → RGBA)属于 UI 胶水层,由调用方用 canvas 完成后传入。
 */

/** RGBA 位图,data 长度 = width * height * 4 */
export interface RawImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface PixelateOptions {
  /** 目标边长(正方形网格),默认 64 */
  targetSize?: number
  /** 调色板上限,默认 16 */
  maxColors?: number
  /** 背景泛洪的 RGB 欧氏距离容差,默认 40 */
  backgroundTolerance?: number
  /** alpha 低于该值视为透明(二值化),默认 128 */
  alphaThreshold?: number
  /** SVG 字节上限,超出时自动减半调色板重编码,默认 50KB(与 sanitize 一致) */
  maxBytes?: number
  /** viewBox 策略:tight=不透明像素包围盒(留 1px 边距,默认),full=完整网格 */
  viewBox?: 'tight' | 'full'
}

export interface PixelateResult {
  svg: string
  /** 实际使用的调色板(hex,如 "#1a1916") */
  palette: string[]
  /** 量化后的网格:palette 下标,-1 表示透明 */
  grid: Int16Array
  width: number
  height: number
  opaquePixels: number
}

const DEFAULT_TARGET_SIZE = 64
const DEFAULT_MAX_COLORS = 16
const DEFAULT_BG_TOLERANCE = 40
const DEFAULT_ALPHA_THRESHOLD = 128
const DEFAULT_MAX_BYTES = 50 * 1024

export function createRawImage(width: number, height: number): RawImage {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

// ---------------------------------------------------------------------------
// 1) 缩放:alpha 加权盒式平均
// ---------------------------------------------------------------------------

/**
 * 盒式缩放到 targetW × targetH。
 * 颜色按 alpha 加权平均,避免透明区的黑色(0,0,0,0)污染边缘色。
 */
export function downsample(src: RawImage, targetW: number, targetH: number): RawImage {
  if (targetW <= 0 || targetH <= 0) throw new Error('downsample: target size must be positive')
  if (src.width === targetW && src.height === targetH) {
    return { width: targetW, height: targetH, data: new Uint8ClampedArray(src.data) }
  }

  const out = createRawImage(targetW, targetH)
  for (let ty = 0; ty < targetH; ty++) {
    const sy0 = Math.floor((ty * src.height) / targetH)
    const sy1 = Math.max(sy0 + 1, Math.ceil(((ty + 1) * src.height) / targetH))
    for (let tx = 0; tx < targetW; tx++) {
      const sx0 = Math.floor((tx * src.width) / targetW)
      const sx1 = Math.max(sx0 + 1, Math.ceil(((tx + 1) * src.width) / targetW))

      let rSum = 0
      let gSum = 0
      let bSum = 0
      let aSum = 0
      let count = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4
          const a = src.data[i + 3]
          rSum += src.data[i] * a
          gSum += src.data[i + 1] * a
          bSum += src.data[i + 2] * a
          aSum += a
          count++
        }
      }

      const o = (ty * targetW + tx) * 4
      if (aSum === 0) {
        out.data[o] = 0
        out.data[o + 1] = 0
        out.data[o + 2] = 0
        out.data[o + 3] = 0
      } else {
        out.data[o] = Math.round(rSum / aSum)
        out.data[o + 1] = Math.round(gSum / aSum)
        out.data[o + 2] = Math.round(bSum / aSum)
        out.data[o + 3] = Math.round(aSum / count)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 2) 抠背景:边界泛洪
// ---------------------------------------------------------------------------

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * 估计背景参考色:对四条边界像素做粗粒度直方图,取众数。
 * 返回 null 表示边界几乎全透明(已是抠好图,无需处理;
 * 此时若强行取色,参考色会落在贴边的主体上,导致主体被误删)。
 */
export function estimateBackgroundColor(img: RawImage, alphaThreshold = DEFAULT_ALPHA_THRESHOLD): [number, number, number] | null {
  const { width, height, data } = img
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  let opaqueBorder = 0
  let totalBorder = 0

  const visit = (x: number, y: number) => {
    totalBorder++
    const i = (y * width + x) * 4
    if (data[i + 3] < alphaThreshold) return
    opaqueBorder++
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    // 16 级/通道的粗桶,容忍背景的轻微噪声
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.count++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }

  for (let x = 0; x < width; x++) {
    visit(x, 0)
    visit(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    visit(0, y)
    visit(width - 1, y)
  }

  // 边界不透明占比过低 → 生图模型已输出透明底,跳过抠背景以免误删贴边主体
  if (totalBorder === 0 || opaqueBorder / totalBorder < 0.05) return null

  let best: { count: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket
  }
  if (!best) return null
  return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)]
}

/**
 * 从边界做 4 连通泛洪,把与背景参考色距离 ≤ tolerance 的连通区置为透明。
 * 始终与"参考色"比较(而非链式与邻居比较),避免渐变背景一路漂移啃掉主体。
 * 被主体完全包围的同色区域(如眼白)不会被误删。
 */
export function removeBackground(img: RawImage, options?: { tolerance?: number; alphaThreshold?: number }): RawImage {
  const tolerance = options?.tolerance ?? DEFAULT_BG_TOLERANCE
  const alphaThreshold = options?.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD
  const out: RawImage = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }
  const { width, height, data } = out

  const bg = estimateBackgroundColor(out, alphaThreshold)
  if (!bg) return out

  const [bgR, bgG, bgB] = bg
  const isBackgroundLike = (i: number): boolean => {
    if (data[i + 3] < alphaThreshold) return true
    return colorDistance(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB) <= tolerance
  }

  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const pushIfBackground = (x: number, y: number) => {
    const p = y * width + x
    if (visited[p]) return
    visited[p] = 1
    if (isBackgroundLike(p * 4)) stack.push(p)
  }

  for (let x = 0; x < width; x++) {
    pushIfBackground(x, 0)
    pushIfBackground(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    pushIfBackground(0, y)
    pushIfBackground(width - 1, y)
  }

  while (stack.length > 0) {
    const p = stack.pop() as number
    const i = p * 4
    data[i] = 0
    data[i + 1] = 0
    data[i + 2] = 0
    data[i + 3] = 0

    const x = p % width
    const y = (p - x) / width
    if (x > 0) pushIfBackground(x - 1, y)
    if (x < width - 1) pushIfBackground(x + 1, y)
    if (y > 0) pushIfBackground(x, y - 1)
    if (y < height - 1) pushIfBackground(x, y + 1)
  }

  return out
}

// ---------------------------------------------------------------------------
// 3) 量化:中位切分(median cut)
// ---------------------------------------------------------------------------

interface ColorCount {
  r: number
  g: number
  b: number
  count: number
}

interface QuantizeOutput {
  palette: string[]
  /** palette 下标网格,-1 = 透明 */
  grid: Int16Array
  opaquePixels: number
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => v.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * 中位切分调色板量化 + 像素映射。alpha 按阈值二值化(像素风不保留半透明)。
 */
export function quantize(img: RawImage, maxColors = DEFAULT_MAX_COLORS, alphaThreshold = DEFAULT_ALPHA_THRESHOLD): QuantizeOutput {
  if (maxColors < 1) throw new Error('quantize: maxColors must be >= 1')
  const { width, height, data } = img
  const grid = new Int16Array(width * height).fill(-1)

  const colorMap = new Map<number, ColorCount>()
  let opaquePixels = 0
  for (let p = 0; p < width * height; p++) {
    const i = p * 4
    if (data[i + 3] < alphaThreshold) continue
    opaquePixels++
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    const existing = colorMap.get(key)
    if (existing) {
      existing.count++
    } else {
      colorMap.set(key, { r: data[i], g: data[i + 1], b: data[i + 2], count: 1 })
    }
  }

  if (opaquePixels === 0) {
    return { palette: [], grid, opaquePixels: 0 }
  }

  // median cut:每个 box 是一组颜色,反复挑"最大通道跨度"的 box 沿该通道按像素数中位拆分
  let boxes: ColorCount[][] = [[...colorMap.values()]]
  while (boxes.length < maxColors) {
    let splitIndex = -1
    let splitChannel: 'r' | 'g' | 'b' = 'r'
    let bestRange = 0

    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b]
      if (box.length < 2) continue
      for (const channel of ['r', 'g', 'b'] as const) {
        let min = 255
        let max = 0
        for (const c of box) {
          if (c[channel] < min) min = c[channel]
          if (c[channel] > max) max = c[channel]
        }
        const range = max - min
        if (range > bestRange) {
          bestRange = range
          splitIndex = b
          splitChannel = channel
        }
      }
    }

    if (splitIndex < 0) break

    const box = boxes[splitIndex]
    box.sort((a, b) => a[splitChannel] - b[splitChannel])
    const totalCount = box.reduce((sum, c) => sum + c.count, 0)
    let acc = 0
    let cut = 0
    for (; cut < box.length - 1; cut++) {
      acc += box[cut].count
      if (acc * 2 >= totalCount) break
    }
    // 主导色占绝对多数时加权中位点会落在末尾,钳制保证两侧盒子非空,
    // 否则少数色(眼睛/嘴等小面积特征)会被并进主导色
    cut = Math.min(cut, box.length - 2)
    const left = box.slice(0, cut + 1)
    const right = box.slice(cut + 1)
    boxes.splice(splitIndex, 1, left, right)
  }
  boxes = boxes.filter(box => box.length > 0)

  const paletteRgb: [number, number, number][] = boxes.map(box => {
    let rSum = 0
    let gSum = 0
    let bSum = 0
    let count = 0
    for (const c of box) {
      rSum += c.r * c.count
      gSum += c.g * c.count
      bSum += c.b * c.count
      count += c.count
    }
    return [Math.round(rSum / count), Math.round(gSum / count), Math.round(bSum / count)]
  })

  // 颜色 → 最近调色板项(box 平均色可能不再是切分时的归属,统一用最近邻保证一致)
  const nearestCache = new Map<number, number>()
  const nearestPaletteIndex = (r: number, g: number, b: number): number => {
    const key = (r << 16) | (g << 8) | b
    const cached = nearestCache.get(key)
    if (cached !== undefined) return cached
    let best = 0
    let bestDist = Infinity
    for (let pi = 0; pi < paletteRgb.length; pi++) {
      const [pr, pg, pb] = paletteRgb[pi]
      const dist = colorDistance(r, g, b, pr, pg, pb)
      if (dist < bestDist) {
        bestDist = dist
        best = pi
      }
    }
    nearestCache.set(key, best)
    return best
  }

  for (let p = 0; p < width * height; p++) {
    const i = p * 4
    if (data[i + 3] < alphaThreshold) continue
    grid[p] = nearestPaletteIndex(data[i], data[i + 1], data[i + 2])
  }

  return {
    palette: paletteRgb.map(([r, g, b]) => toHex(r, g, b)),
    grid,
    opaquePixels,
  }
}

// ---------------------------------------------------------------------------
// 4) path 编码:贪心矩形覆盖
// ---------------------------------------------------------------------------

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 对单一调色板下标做贪心矩形覆盖:
 * 自上而下扫描,先横向扩展宽度,再纵向扩展整行,显著少于逐行 v1 编码。
 */
export function coverColorWithRects(grid: Int16Array, width: number, height: number, colorIndex: number): Rect[] {
  const rects: Rect[] = []
  const used = new Uint8Array(width * height)

  const matches = (x: number, y: number): boolean => {
    const p = y * width + x
    return grid[p] === colorIndex && used[p] === 0
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!matches(x, y)) continue

      let w = 1
      while (x + w < width && matches(x + w, y)) w++

      let h = 1
      expand: while (y + h < height) {
        for (let dx = 0; dx < w; dx++) {
          if (!matches(x + dx, y + h)) break expand
        }
        h++
      }

      for (let dy = 0; dy < h; dy++) {
        used.fill(1, (y + dy) * width + x, (y + dy) * width + x + w)
      }
      rects.push({ x, y, w, h })
    }
  }

  return rects
}

function rectToPathCommand(rect: Rect): string {
  const v = rect.h === 1 ? 'v1' : `v${rect.h}`
  return `M${rect.x} ${rect.y}h${rect.w}${v}h-${rect.w}z`
}

export interface EncodeSvgOptions {
  /** tight=不透明像素包围盒(留 1px 边距,默认),full=完整网格 */
  viewBox?: 'tight' | 'full'
}

/** 不透明像素的包围盒(闭区间),null 表示全透明 */
export interface ContentBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function computeContentBounds(grid: Int16Array, width: number, height: number): ContentBounds | null {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let p = 0; p < width * height; p++) {
    if (grid[p] < 0) continue
    const x = p % width
    const y = (p - x) / width
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return maxX >= 0 ? { minX, minY, maxX, maxY } : null
}

/** 包围盒 → 带 1px 边距的 viewBox 字符串;null(空内容)回退完整网格 */
export function tightViewBox(bounds: ContentBounds | null, width: number, height: number): string {
  if (!bounds) return `0 0 ${width} ${height}`
  const x0 = Math.max(0, bounds.minX - 1)
  const y0 = Math.max(0, bounds.minY - 1)
  const x1 = Math.min(width, bounds.maxX + 2)
  const y1 = Math.min(height, bounds.maxY + 2)
  return `${x0} ${y0} ${x1 - x0} ${y1 - y0}`
}

/** 按调色板逐色做矩形覆盖,产出 <path> 片段数组(空色不产出) */
export function buildColorPaths(palette: string[], grid: Int16Array, width: number, height: number): string[] {
  const paths: string[] = []
  for (let colorIndex = 0; colorIndex < palette.length; colorIndex++) {
    const rects = coverColorWithRects(grid, width, height, colorIndex)
    if (rects.length === 0) continue
    const d = rects.map(rectToPathCommand).join('')
    paths.push(`<path fill="${palette[colorIndex]}" d="${d}"/>`)
  }
  return paths
}

/**
 * 网格 → 单行 SVG 字符串。
 * 输出格式与 slime-sprites.buildSprite 同构,只使用 sprite-sanitize 白名单内的
 * 元素(svg/path)与属性,可直接通过 sanitizeSvgString。
 */
export function encodeSvg(quantized: QuantizeOutput, width: number, height: number, options?: EncodeSvgOptions): string {
  const { palette, grid } = quantized

  const bounds = computeContentBounds(grid, width, height)
  const viewBox = options?.viewBox === 'full'
    ? `0 0 ${width} ${height}`
    : tightViewBox(bounds, width, height)

  const paths = buildColorPaths(palette, grid, width, height)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="${viewBox}" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges">${paths.join('')}</svg>`
}

// ---------------------------------------------------------------------------
// 5) 管线编排
// ---------------------------------------------------------------------------

/**
 * 完整管线:任意尺寸 RGBA 位图 → 像素风矢量 SVG。
 * 若编码结果超出 maxBytes(默认 50KB),自动减半调色板重新量化编码,直至达标。
 */
export function pixelateToSvg(src: RawImage, options?: PixelateOptions): PixelateResult {
  const targetSize = options?.targetSize ?? DEFAULT_TARGET_SIZE
  const maxColors = options?.maxColors ?? DEFAULT_MAX_COLORS
  const tolerance = options?.backgroundTolerance ?? DEFAULT_BG_TOLERANCE
  const alphaThreshold = options?.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES

  const small = downsample(src, targetSize, targetSize)
  const matted = removeBackground(small, { tolerance, alphaThreshold })

  let colors = maxColors
  for (;;) {
    const quantized = quantize(matted, colors, alphaThreshold)
    const svg = encodeSvg(quantized, targetSize, targetSize, { viewBox: options?.viewBox })
    if (svg.length <= maxBytes || colors <= 2) {
      return {
        svg,
        palette: quantized.palette,
        grid: quantized.grid,
        width: targetSize,
        height: targetSize,
        opaquePixels: quantized.opaquePixels,
      }
    }
    colors = Math.max(2, Math.floor(colors / 2))
  }
}
