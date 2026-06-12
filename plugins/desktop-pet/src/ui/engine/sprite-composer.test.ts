import { ALL_EXPRESSIONS, ALL_POSES, type PetSpriteKey } from './pet-standard'
import { FACE_BY_EXPRESSION } from './slime-sprites'
import { createRawImage, pixelateToSvg } from './pixelate-pipeline'
import {
  composeExpressionSprite,
  composeSpriteSet,
  computeFaceAnchor,
  isFaceRegionDark,
  type PixelBody,
} from './sprite-composer'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** 构造一个矩形身体:在 64×64 网格的 (x,y) 处铺 w×h 的 0 号色 */
function makeRectBody(palette: string[], x: number, y: number, w: number, h: number): PixelBody {
  const width = 64
  const height = 64
  const grid = new Int16Array(width * height).fill(-1)
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      grid[(y + dy) * width + (x + dx)] = 0
    }
  }
  return { palette, grid, width, height }
}

// ---------------------------------------------------------------------------
// 五官素材表
// ---------------------------------------------------------------------------

function testFaceTableCoversAllExpressions() {
  for (const expression of ALL_EXPRESSIONS) {
    const face = FACE_BY_EXPRESSION[expression]
    assert(face, `FACE_BY_EXPRESSION missing ${expression}`)
    for (const part of [face.eyes, face.highlights, face.blush, face.mouth]) {
      if (part === '') continue
      const tags = [...part.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map(m => m[1].toLowerCase())
      assert(tags.every(t => t === 'path'), `${expression} face part should only contain <path>, got ${tags.join(',')}`)
      const attrs = [...part.matchAll(/\s([a-zA-Z][\w:-]*)="/g)].map(m => m[1].toLowerCase())
      assert(attrs.every(a => a === 'fill' || a === 'd'), `${expression} face part attrs should be fill/d only, got ${attrs.join(',')}`)
    }
  }
}

// ---------------------------------------------------------------------------
// 锚点推导
// ---------------------------------------------------------------------------

function testFaceAnchorMathAndSnapping() {
  // 40×38 身体 → 缩放恰为 2,水平居中,垂直 40% 高度
  const a = computeFaceAnchor({ minX: 12, minY: 10, maxX: 51, maxY: 47 })
  assert(a.scale === 2, `expected scale 2, got ${a.scale}`)
  assert(a.centerX === 32, `expected centerX 32, got ${a.centerX}`)
  assert(a.centerY === 25.2, `expected centerY 25.2, got ${a.centerY}`)

  // 13×13 身体 → raw=0.65 → 对齐 0.25 步进为 0.75
  const b = computeFaceAnchor({ minX: 0, minY: 0, maxX: 12, maxY: 12 })
  assert(b.scale === 0.75, `expected snapped scale 0.75, got ${b.scale}`)

  // 8×8 身体 → raw=0.4 → 下限钳制 0.5
  const c = computeFaceAnchor({ minX: 0, minY: 0, maxX: 7, maxY: 7 })
  assert(c.scale === 0.5, `expected clamped scale 0.5, got ${c.scale}`)
}

// ---------------------------------------------------------------------------
// 单表情合成
// ---------------------------------------------------------------------------

function testComposeContainsBodyAndAnchoredFace() {
  const body = makeRectBody(['#dededd'], 12, 10, 40, 38)
  const svg = composeExpressionSprite(body, 'neutral')

  assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'sprite should start with namespaced svg root')
  assert(svg.includes('viewBox="11 9 42 40"'), `tight viewBox expected "11 9 42 40", svg head: ${svg.slice(0, 200)}`)
  assert(svg.includes('<path fill="#dededd" d="M12 10h40v38h-40z"/>'), 'body should be encoded as one merged rect')
  // anchor: centerX=32, centerY=25.2, scale=2 → tx=32-2*32=-32, ty=25.2-2*29.5=-33.8
  assert(svg.includes('<g transform="translate(-32 -33.8) scale(2)">'), `face group transform mismatch, svg: ${svg.slice(0, 300)}`)
  assert(svg.includes('#1A1916'), 'light body should keep the dark eye color')
  assert(svg.includes('#CF8E8C'), 'neutral face should keep its blush')
}

function testDarkBodyInvertsFaceColors() {
  const body = makeRectBody(['#101010'], 12, 10, 40, 38)
  const anchor = computeFaceAnchor({ minX: 12, minY: 10, maxX: 51, maxY: 47 })
  assert(isFaceRegionDark(body, anchor) === true, 'near-black body should be classified as dark')

  const svg = composeExpressionSprite(body, 'neutral')
  assert(!svg.includes('#1A1916'), 'dark body must not keep dark eyes')
  assert(svg.includes('#F2F2F0'), 'dark body should get light eyes')
  assert(svg.includes('#CF8E8C'), 'blush color should stay unchanged on dark body')

  const lightBody = makeRectBody(['#dededd'], 12, 10, 40, 38)
  assert(isFaceRegionDark(lightBody, anchor) === false, 'light body should not be classified as dark')
}

function testHighlightSwapOnDarkBody() {
  // curious 表情带 #F7F7F7 高光,深色身体上应换成深色高光
  const body = makeRectBody(['#202020'], 12, 10, 40, 38)
  const svg = composeExpressionSprite(body, 'curious')
  assert(!svg.includes('#F7F7F7'), 'light highlights should be swapped away on dark body')
  assert(svg.includes('#23201E'), 'dark replacement highlight should be present')
}

function testEmptyBodyThrows() {
  const body: PixelBody = { palette: [], grid: new Int16Array(64 * 64).fill(-1), width: 64, height: 64 }
  let threw = false
  try {
    composeExpressionSprite(body, 'neutral')
  } catch {
    threw = true
  }
  assert(threw, 'composing on an empty body must throw')
}

// ---------------------------------------------------------------------------
// 全套生成
// ---------------------------------------------------------------------------

function testComposeSpriteSetCoversAllKeysAndSharesBodyAcrossPoses() {
  const body = makeRectBody(['#88aacc'], 16, 16, 32, 32)
  const set = composeSpriteSet(body, { id: 'x'.repeat(100), name: '测试宠物', description: '由单测生成' })

  assert(set.id.length === 64, 'id should be truncated to 64 chars like validateSpriteSet does')
  assert(set.name === '测试宠物' && set.description === '由单测生成', 'meta should pass through')

  let total = 0
  for (const pose of ALL_POSES) {
    for (const expression of ALL_EXPRESSIONS) {
      const key = `${pose}_${expression}` as PetSpriteKey
      const svg = set.sprites[key]
      assert(typeof svg === 'string' && svg.length > 0, `missing sprite ${key}`)
      total++
      const standVariant = set.sprites[`stand_${expression}` as PetSpriteKey]
      assert(svg === standVariant, `${key} should share the same svg as stand_${expression} (pose via CSS)`)
    }
  }
  assert(total === ALL_POSES.length * ALL_EXPRESSIONS.length, `expected full coverage, got ${total}`)

  // 不同表情必须产出不同 sprite(五官在变)
  assert(set.sprites['stand_neutral'] !== set.sprites['stand_happy'], 'different expressions should differ')
}

function testComposedSpritesStayInsideSanitizeWhitelist() {
  const body = makeRectBody(['#88aacc'], 16, 16, 32, 32)
  const allowedTags = new Set(['svg', 'g', 'path'])
  const allowedAttrs = new Set(['xmlns', 'width', 'height', 'viewbox', 'preserveaspectratio', 'shape-rendering', 'fill', 'd', 'transform'])

  for (const expression of ALL_EXPRESSIONS) {
    const svg = composeExpressionSprite(body, expression)
    assert(svg.length <= 50 * 1024, `${expression} sprite must fit the 50KB sanitize cap, got ${svg.length}`)
    const tags = [...svg.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map(m => m[1].toLowerCase())
    assert(tags.every(t => allowedTags.has(t)), `${expression}: unexpected tag ${[...new Set(tags)].join(',')}`)
    const attrs = [...svg.matchAll(/\s([a-zA-Z][\w:-]*)="/g)].map(m => m[1].toLowerCase())
    assert(attrs.every(a => allowedAttrs.has(a)), `${expression}: unexpected attr ${attrs.join(',')}`)
    assert(!svg.includes('style='), 'style attribute is forbidden by sanitizer')
    assert(!svg.includes('href'), 'href is forbidden by sanitizer')
  }
}

// ---------------------------------------------------------------------------
// 与 pixelate-pipeline 的端到端衔接
// ---------------------------------------------------------------------------

function testEndToEndPipelineIntoComposer() {
  // 与 pipeline 端到端用例相同的合成源图:白底 + 蓝色方形宠物 + 黑眼 + 红嘴
  const src = createRawImage(256, 256)
  const fill = (x: number, y: number, w: number, h: number, c: [number, number, number]) => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const i = ((y + dy) * 256 + (x + dx)) * 4
        src.data[i] = c[0]
        src.data[i + 1] = c[1]
        src.data[i + 2] = c[2]
        src.data[i + 3] = 255
      }
    }
  }
  fill(0, 0, 256, 256, [255, 255, 255])
  fill(64, 64, 128, 128, [40, 90, 220])
  fill(96, 96, 16, 16, [10, 10, 10])
  fill(144, 96, 16, 16, [10, 10, 10])
  fill(112, 152, 32, 8, [200, 40, 40])

  const result = pixelateToSvg(src)
  const set = composeSpriteSet(result, { id: 'custom-e2e', name: '端到端', description: '' })

  const standNeutral = set.sprites['stand_neutral']
  assert(typeof standNeutral === 'string', 'stand_neutral must exist (validateSpriteSet hard requirement)')
  assert(standNeutral.includes('<g transform="translate('), 'composed sprite should carry the anchored face group')
  assert(result.palette.some(hex => standNeutral.includes(hex)), 'composed sprite should contain the pipeline body colors')

  let count = 0
  for (const key of Object.keys(set.sprites)) {
    const svg = set.sprites[key as PetSpriteKey]
    assert(typeof svg === 'string' && svg.length <= 50 * 1024, `${key} should fit sanitize size cap`)
    count++
  }
  assert(count === 195, `expected 195 sprites (13 poses × 15 expressions), got ${count}`)
}

testFaceTableCoversAllExpressions()
testFaceAnchorMathAndSnapping()
testComposeContainsBodyAndAnchoredFace()
testDarkBodyInvertsFaceColors()
testHighlightSwapOnDarkBody()
testEmptyBodyThrows()
testComposeSpriteSetCoversAllKeysAndSharesBodyAcrossPoses()
testComposedSpritesStayInsideSanitizeWhitelist()
testEndToEndPipelineIntoComposer()
