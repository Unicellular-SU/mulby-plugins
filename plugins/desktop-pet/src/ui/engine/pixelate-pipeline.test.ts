import {
  coverColorWithRects,
  createRawImage,
  downsample,
  encodeSvg,
  estimateBackgroundColor,
  pixelateToSvg,
  quantize,
  removeBackground,
  type RawImage,
} from './pixelate-pipeline'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type Rgba = [number, number, number, number]

function setPixel(img: RawImage, x: number, y: number, [r, g, b, a]: Rgba) {
  const i = (y * img.width + x) * 4
  img.data[i] = r
  img.data[i + 1] = g
  img.data[i + 2] = b
  img.data[i + 3] = a
}

function getPixel(img: RawImage, x: number, y: number): Rgba {
  const i = (y * img.width + x) * 4
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
}

function fillRect(img: RawImage, x: number, y: number, w: number, h: number, color: Rgba) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(img, x + dx, y + dy, color)
    }
  }
}

function makeImage(width: number, height: number, fill?: Rgba): RawImage {
  const img = createRawImage(width, height)
  if (fill) fillRect(img, 0, 0, width, height, fill)
  return img
}

// ---------------------------------------------------------------------------
// downsample
// ---------------------------------------------------------------------------

function testDownsampleAveragesUniformBlocks() {
  // 8×8 源图,每个 2×2 块一种纯色 → 缩到 4×4 后应逐像素等于块色
  const src = makeImage(8, 8)
  const blockColor = (bx: number, by: number): Rgba => [bx * 60, by * 60, (bx + by) * 30, 255]
  for (let by = 0; by < 4; by++) {
    for (let bx = 0; bx < 4; bx++) {
      fillRect(src, bx * 2, by * 2, 2, 2, blockColor(bx, by))
    }
  }

  const out = downsample(src, 4, 4)
  assert(out.width === 4 && out.height === 4, 'downsample should produce 4x4 output')
  for (let by = 0; by < 4; by++) {
    for (let bx = 0; bx < 4; bx++) {
      const expected = blockColor(bx, by)
      const actual = getPixel(out, bx, by)
      assert(
        actual[0] === expected[0] && actual[1] === expected[1] && actual[2] === expected[2] && actual[3] === 255,
        `downsample block (${bx},${by}) expected ${expected} got ${actual}`
      )
    }
  }
}

function testDownsampleIsAlphaWeighted() {
  // 红色不透明 + 全透明黑 各占一半 → 颜色应保持纯红,不被透明黑拉暗
  const src = makeImage(2, 1)
  setPixel(src, 0, 0, [255, 0, 0, 255])
  setPixel(src, 1, 0, [0, 0, 0, 0])

  const out = downsample(src, 1, 1)
  const [r, g, b, a] = getPixel(out, 0, 0)
  assert(r === 255 && g === 0 && b === 0, `alpha-weighted color should stay pure red, got ${[r, g, b]}`)
  assert(a === 128, `averaged alpha should be 128, got ${a}`)
}

function testDownsampleSameSizeReturnsCopy() {
  const src = makeImage(3, 3, [10, 20, 30, 255])
  const out = downsample(src, 3, 3)
  assert(out.data !== src.data, 'same-size downsample should return a copy, not the same buffer')
  assert(out.data.every((v, i) => v === src.data[i]), 'same-size downsample should preserve all bytes')
}

// ---------------------------------------------------------------------------
// removeBackground
// ---------------------------------------------------------------------------

function testRemoveBackgroundClearsBorderConnectedRegion() {
  // 白底 + 居中黑方块 → 白底全透明,方块保留
  const img = makeImage(16, 16, [255, 255, 255, 255])
  fillRect(img, 5, 5, 6, 6, [0, 0, 0, 255])

  const bg = estimateBackgroundColor(img)
  assert(bg !== null, 'background color should be detected')
  assert(bg[0] === 255 && bg[1] === 255 && bg[2] === 255, `estimated background should be white, got ${bg}`)

  const out = removeBackground(img)
  assert(getPixel(out, 0, 0)[3] === 0, 'corner background should become transparent')
  assert(getPixel(out, 15, 15)[3] === 0, 'opposite corner background should become transparent')
  assert(getPixel(out, 4, 8)[3] === 0, 'background pixel adjacent to subject should become transparent')
  for (let y = 5; y < 11; y++) {
    for (let x = 5; x < 11; x++) {
      const [r, g, b, a] = getPixel(out, x, y)
      assert(a === 255 && r === 0 && g === 0 && b === 0, `subject pixel (${x},${y}) should survive`)
    }
  }
}

function testRemoveBackgroundKeepsEnclosedHoles() {
  // 主体内部包着一块与背景同色的"眼白" → 因不与边界连通,必须保留
  const img = makeImage(16, 16, [255, 255, 255, 255])
  fillRect(img, 4, 4, 8, 8, [20, 20, 20, 255])
  fillRect(img, 7, 7, 2, 2, [255, 255, 255, 255])

  const out = removeBackground(img)
  assert(getPixel(out, 0, 0)[3] === 0, 'outer background should be removed')
  const [r, g, b, a] = getPixel(out, 7, 7)
  assert(a === 255 && r === 255 && g === 255 && b === 255, 'enclosed white hole must NOT be removed')
}

function testRemoveBackgroundToleratesNoise() {
  // 背景带轻微噪声(±5/通道),容差内应全部移除
  const img = makeImage(12, 12)
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const n = (x + y) % 2 === 0 ? 250 : 255
      setPixel(img, x, y, [n, n, n, 255])
    }
  }
  fillRect(img, 4, 4, 4, 4, [0, 0, 0, 255])

  const out = removeBackground(img, { tolerance: 40 })
  assert(getPixel(out, 0, 0)[3] === 0, 'noisy background pixel should be removed')
  assert(getPixel(out, 1, 0)[3] === 0, 'noisy background pixel variant should be removed')
  assert(getPixel(out, 5, 5)[3] === 255, 'subject should survive noisy background removal')
}

function testRemoveBackgroundSkipsAlreadyTransparentInput() {
  // 生图模型直接输出透明底、且主体贴到边界:不得把贴边主体当背景删掉
  const img = makeImage(16, 16, [0, 0, 0, 0])
  fillRect(img, 7, 0, 1, 16, [200, 30, 30, 255]) // 贴上下边界的红色竖条(边界不透明占比 2/60 ≈ 3.3% < 5%)

  assert(estimateBackgroundColor(img) === null, 'mostly-transparent border should yield null background')

  const out = removeBackground(img)
  assert(getPixel(out, 7, 0)[3] === 255, 'edge-touching subject must survive on transparent input')
  assert(getPixel(out, 7, 15)[3] === 255, 'edge-touching subject must survive on transparent input (bottom)')
}

// ---------------------------------------------------------------------------
// quantize
// ---------------------------------------------------------------------------

function testQuantizePreservesFewColors() {
  const img = makeImage(6, 2)
  fillRect(img, 0, 0, 2, 2, [255, 0, 0, 255])
  fillRect(img, 2, 0, 2, 2, [0, 255, 0, 255])
  fillRect(img, 4, 0, 2, 2, [0, 0, 255, 255])

  const { palette, grid, opaquePixels } = quantize(img, 16)
  assert(opaquePixels === 12, `expected 12 opaque pixels, got ${opaquePixels}`)
  assert(palette.length === 3, `3 distinct colors should yield palette of 3, got ${palette.length}`)
  const sorted = [...palette].sort()
  assert(
    sorted.join(',') === '#0000ff,#00ff00,#ff0000',
    `palette should preserve exact colors, got ${palette.join(',')}`
  )
  assert(grid.every(v => v >= 0), 'fully opaque image should map every pixel to a palette index')
}

function testQuantizeReducesManyColors() {
  // 32 种灰阶 → 压到 ≤16 色,且所有不透明像素都有映射
  const img = makeImage(32, 1)
  for (let x = 0; x < 32; x++) {
    const v = x * 8
    setPixel(img, x, 0, [v, v, v, 255])
  }

  const { palette, grid } = quantize(img, 16)
  assert(palette.length <= 16, `palette must not exceed 16, got ${palette.length}`)
  assert(palette.length > 1, 'gradient should keep multiple palette entries')
  for (let x = 0; x < 32; x++) {
    assert(grid[x] >= 0 && grid[x] < palette.length, `pixel ${x} should map into palette`)
  }
}

function testQuantizeBinarizesAlpha() {
  const img = makeImage(2, 1)
  setPixel(img, 0, 0, [100, 100, 100, 100]) // alpha < 128 → 透明
  setPixel(img, 1, 0, [100, 100, 100, 200]) // alpha ≥ 128 → 不透明

  const { grid, opaquePixels } = quantize(img, 16)
  assert(grid[0] === -1, 'low-alpha pixel should be transparent (-1)')
  assert(grid[1] >= 0, 'high-alpha pixel should be mapped')
  assert(opaquePixels === 1, `expected 1 opaque pixel, got ${opaquePixels}`)
}

// ---------------------------------------------------------------------------
// coverColorWithRects / encodeSvg
// ---------------------------------------------------------------------------

function testRectCoverMergesFullSquare() {
  const grid = new Int16Array(16).fill(0)
  const rects = coverColorWithRects(grid, 4, 4, 0)
  assert(rects.length === 1, `solid 4x4 should merge into a single rect, got ${rects.length}`)
  const r = rects[0]
  assert(r.x === 0 && r.y === 0 && r.w === 4 && r.h === 4, `expected full-square rect, got ${JSON.stringify(r)}`)
}

function testRectCoverIsExactAndNonOverlapping() {
  // L 形图案:验证矩形覆盖面积恰好等于像素数且无重叠
  const width = 6
  const height = 6
  const grid = new Int16Array(width * height).fill(-1)
  const lShape: Array<[number, number]> = []
  for (let y = 0; y < 5; y++) lShape.push([1, y])
  for (let x = 2; x < 5; x++) lShape.push([x, 4])
  for (const [x, y] of lShape) grid[y * width + x] = 0

  const rects = coverColorWithRects(grid, width, height, 0)
  const painted = new Uint8Array(width * height)
  let area = 0
  for (const r of rects) {
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const p = (r.y + dy) * width + (r.x + dx)
        assert(painted[p] === 0, `rect cover must not overlap at (${r.x + dx},${r.y + dy})`)
        assert(grid[p] === 0, `rect cover must not paint outside the shape at (${r.x + dx},${r.y + dy})`)
        painted[p] = 1
        area++
      }
    }
  }
  assert(area === lShape.length, `covered area ${area} should equal shape size ${lShape.length}`)
}

function testEncodeSvgStructureAndTightViewBox() {
  // 8×8 网格,内容在 (3,3)-(4,4) → tight viewBox 应为 "2 2 4 4"(含 1px 边距)
  const width = 8
  const height = 8
  const grid = new Int16Array(width * height).fill(-1)
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]] as Array<[number, number]>) {
    grid[y * width + x] = 0
  }

  const svg = encodeSvg({ palette: ['#102030'], grid, opaquePixels: 4 }, width, height)
  assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'svg should start with namespaced root')
  assert(svg.includes('shape-rendering="crispEdges"'), 'svg should keep crispEdges like built-in sprites')
  assert(svg.includes('viewBox="2 2 4 4"'), `tight viewBox expected "2 2 4 4", svg: ${svg}`)
  assert(svg.includes('<path fill="#102030" d="M3 3h2v2h-2z"/>'), `expected merged rect path, svg: ${svg}`)

  const fullSvg = encodeSvg({ palette: ['#102030'], grid, opaquePixels: 4 }, width, height, { viewBox: 'full' })
  assert(fullSvg.includes('viewBox="0 0 8 8"'), 'full viewBox should span the whole grid')
}

function testEncodeSvgStaysInsideSanitizeWhitelist() {
  // 静态校验输出只含 svg/path 标签和白名单属性(sprite-sanitize 依赖 DOM,无法在 node 直接跑)
  const width = 4
  const height = 4
  const grid = new Int16Array(width * height)
  for (let p = 0; p < grid.length; p++) grid[p] = p % 2
  const svg = encodeSvg({ palette: ['#000000', '#ffffff'], grid, opaquePixels: 16 }, width, height)

  const tags = [...svg.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map(m => m[1].toLowerCase())
  assert(tags.every(t => t === 'svg' || t === 'path'), `only svg/path tags allowed, got ${[...new Set(tags)].join(',')}`)

  const allowedAttrs = new Set(['xmlns', 'width', 'height', 'viewbox', 'preserveaspectratio', 'shape-rendering', 'fill', 'd'])
  const attrs = [...svg.matchAll(/\s([a-zA-Z][\w:-]*)="/g)].map(m => m[1].toLowerCase())
  assert(attrs.every(a => allowedAttrs.has(a)), `unexpected attribute outside whitelist: ${attrs.join(',')}`)
  assert(!svg.includes('style='), 'style attribute is forbidden by sanitizer')
  assert(!svg.includes('href'), 'href is forbidden by sanitizer')
}

function testEncodeSvgHandlesEmptyContent() {
  const grid = new Int16Array(16).fill(-1)
  const svg = encodeSvg({ palette: [], grid, opaquePixels: 0 }, 4, 4)
  assert(svg.includes('viewBox="0 0 4 4"'), 'empty content should fall back to full viewBox')
  assert(!svg.includes('<path'), 'empty content should produce no path elements')
}

// ---------------------------------------------------------------------------
// pixelateToSvg 端到端
// ---------------------------------------------------------------------------

function testPipelineEndToEnd() {
  // 256×256 源图:白底 + 蓝色方形宠物(128×128) + 黑色眼睛 + 红色嘴(全部对齐 4px 网格)
  const src = makeImage(256, 256, [255, 255, 255, 255])
  fillRect(src, 64, 64, 128, 128, [40, 90, 220, 255])
  fillRect(src, 96, 96, 16, 16, [10, 10, 10, 255])
  fillRect(src, 144, 96, 16, 16, [10, 10, 10, 255])
  fillRect(src, 112, 152, 32, 8, [200, 40, 40, 255])

  const result = pixelateToSvg(src)

  assert(result.width === 64 && result.height === 64, 'default target size should be 64')
  assert(result.opaquePixels === 32 * 32, `pet should occupy exactly 1024 cells, got ${result.opaquePixels}`)
  assert(result.svg.length > 0 && result.svg.length <= 50 * 1024, `svg size should be within 50KB, got ${result.svg.length}`)
  assert(result.svg.startsWith('<svg'), 'pipeline should output an svg root')
  assert(result.palette.length >= 3, `expected at least body/eye/mouth colors, got ${result.palette.join(',')}`)
  assert(result.palette.every(c => /^#[0-9a-f]{6}$/.test(c)), `palette entries must be hex colors, got ${result.palette.join(',')}`)

  // 背景必须被移除:调色板里不应有接近白色的颜色
  for (const hex of result.palette) {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    assert(!(r > 230 && g > 230 && b > 230), `white background leaked into palette: ${hex}`)
  }

  // grid 与 svg 一致性:四角透明,宠物中心是身体色
  assert(result.grid[0] === -1, 'top-left cell should be transparent after matting')
  const center = 32 * 64 + 32
  assert(result.grid[center] >= 0, 'pet center should be opaque')
}

function testPipelineShrinksPaletteToFitMaxBytes() {
  // 构造最坏情况:64×64 内相邻像素永不同色(16 色循环),迫使初次编码超限后自动减色
  const src = makeImage(64, 64)
  const palette16: Rgba[] = []
  for (let i = 0; i < 16; i++) {
    palette16.push([i * 16, 255 - i * 16, ((i * 40) % 256 + 256) % 256, 255])
  }
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      setPixel(src, x, y, palette16[(x + 2 * y) % 16])
    }
  }

  const result = pixelateToSvg(src, { backgroundTolerance: 0 })
  assert(result.svg.length <= 50 * 1024, `svg must respect 50KB cap, got ${result.svg.length}`)
  assert(result.palette.length <= 16, 'palette must stay within limit')
}

function testPipelineHandlesFullyTransparentInput() {
  const src = makeImage(128, 128, [0, 0, 0, 0])
  const result = pixelateToSvg(src)
  assert(result.opaquePixels === 0, 'fully transparent input should yield zero opaque pixels')
  assert(result.palette.length === 0, 'fully transparent input should yield empty palette')
  assert(result.svg.startsWith('<svg') && !result.svg.includes('<path'), 'empty result should still be a valid empty svg')
}

testDownsampleAveragesUniformBlocks()
testDownsampleIsAlphaWeighted()
testDownsampleSameSizeReturnsCopy()
testRemoveBackgroundClearsBorderConnectedRegion()
testRemoveBackgroundKeepsEnclosedHoles()
testRemoveBackgroundToleratesNoise()
testRemoveBackgroundSkipsAlreadyTransparentInput()
testQuantizePreservesFewColors()
testQuantizeReducesManyColors()
testQuantizeBinarizesAlpha()
testRectCoverMergesFullSquare()
testRectCoverIsExactAndNonOverlapping()
testEncodeSvgStructureAndTightViewBox()
testEncodeSvgStaysInsideSanitizeWhitelist()
testEncodeSvgHandlesEmptyContent()
testPipelineEndToEnd()
testPipelineShrinksPaletteToFitMaxBytes()
testPipelineHandlesFullyTransparentInput()
