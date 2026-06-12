/**
 * 五官合成器:把内置幽灵的 15 套表情五官叠加到自定义像素身体上,
 * 产出可直接喂给 validateSpriteSet / SvgPetRenderer 的完整 PetSpriteSet。
 *
 * 设计要点:
 * - 姿态差异沿用 CSS transform 动画方案(与内置幽灵一致),
 *   因此所有 pose 共享同一张身体图,只有表情(五官)不同 → 一次生图 = 全套 195 个 key。
 * - 五官以 <g transform="translate(..) scale(..)"> 映射到新身体的脸部锚点,
 *   锚点默认按身体包围盒推导(水平居中、垂直 40% 高度,对齐幽灵脸部的相对位置),
 *   也可由调用方显式传入(例如未来用视觉模型标定)。
 * - 深色身体自动把深色五官反转为浅色,保证可读性。
 * - 输出仅使用 sprite-sanitize 白名单内的元素(svg/g/path)与属性。
 */

import { ALL_EXPRESSIONS, ALL_POSES, type PetExpression, type PetSpriteKey, type PetSpriteSet } from './pet-standard'
import { FACE_BY_EXPRESSION, type FaceParts } from './slime-sprites'
import {
  buildColorPaths,
  computeContentBounds,
  tightViewBox,
  type ContentBounds,
  type PixelateResult,
} from './pixelate-pipeline'

/** 合成器需要的身体数据(即 pixelateToSvg 的产物子集) */
export type PixelBody = Pick<PixelateResult, 'palette' | 'grid' | 'width' | 'height'>

export interface FaceAnchor {
  /** 五官簇中心在身体网格中的目标位置 */
  centerX: number
  centerY: number
  /** 五官缩放倍率(已对齐 0.25 步进) */
  scale: number
}

export interface ComposeMeta {
  id: string
  name: string
  description: string
}

// 内置幽灵的五官坐标系参考:五官簇(眉/眼/腮红/嘴/冷汗)覆盖 x25..39、y26..33,
// 中心约 (32, 29.5);幽灵身体盒为 x22..41 × y22..40,即 20×19。
const GHOST_FACE_CENTER_X = 32
const GHOST_FACE_CENTER_Y = 29.5
const GHOST_BODY_W = 20
const GHOST_BODY_H = 19
/** 幽灵五官中心位于身体盒高度的 (29.5-22)/19 ≈ 0.39 处,取 0.4 作为通用相对高度 */
const FACE_RELATIVE_Y = 0.4
/** 五官簇在自身坐标系的半宽/半高(x25..39 → ±7,y26..33 → ±4),用于估计脸部区域亮度 */
const FACE_HALF_W = 7
const FACE_HALF_H = 4

// 内置五官用色(见 slime-sprites.ts);深色身体时做明暗对调
const EYE_DARK = '#1A1916'
const HIGHLIGHT_LIGHT = '#F7F7F7'
const EYE_LIGHT_REPLACEMENT = '#F2F2F0'
const HIGHLIGHT_DARK_REPLACEMENT = '#23201E'

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * 由身体包围盒推导默认脸部锚点:
 * 水平居中;垂直放在身体高度 40% 处;缩放取"身体盒 / 幽灵身体盒"的短边比,
 * 并对齐到 0.25 步进(减少非整数缩放带来的像素抖动),下限 0.5。
 */
export function computeFaceAnchor(bounds: ContentBounds): FaceAnchor {
  const w = bounds.maxX - bounds.minX + 1
  const h = bounds.maxY - bounds.minY + 1
  const raw = Math.min(w / GHOST_BODY_W, h / GHOST_BODY_H)
  const scale = Math.max(0.5, Math.round(raw * 4) / 4)
  return {
    centerX: round2(bounds.minX + w / 2),
    centerY: round2(bounds.minY + h * FACE_RELATIVE_Y),
    scale,
  }
}

/**
 * 估计锚点处脸部区域的平均亮度,判断是否需要反转五官明暗。
 * 区域内没有不透明像素时回退到全身平均。
 */
export function isFaceRegionDark(body: PixelBody, anchor: FaceAnchor): boolean {
  const { palette, grid, width, height } = body
  const rgb = palette.map(hex => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const)

  const luminanceAt = (p: number): number | null => {
    const colorIndex = grid[p]
    if (colorIndex < 0) return null
    const [r, g, b] = rgb[colorIndex]
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }

  const x0 = Math.max(0, Math.floor(anchor.centerX - anchor.scale * FACE_HALF_W))
  const x1 = Math.min(width - 1, Math.ceil(anchor.centerX + anchor.scale * FACE_HALF_W))
  const y0 = Math.max(0, Math.floor(anchor.centerY - anchor.scale * FACE_HALF_H))
  const y1 = Math.min(height - 1, Math.ceil(anchor.centerY + anchor.scale * FACE_HALF_H))

  let sum = 0
  let count = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const lum = luminanceAt(y * width + x)
      if (lum === null) continue
      sum += lum
      count++
    }
  }

  if (count === 0) {
    for (let p = 0; p < width * height; p++) {
      const lum = luminanceAt(p)
      if (lum === null) continue
      sum += lum
      count++
    }
  }

  if (count === 0) return false
  return sum / count < 0.45
}

/** 深色身体时把深色五官换成浅色、浅色高光换成深色;腮红/冷汗色在明暗背景上均可读,保持不变 */
export function adaptFaceColors(face: FaceParts, darkBody: boolean): FaceParts {
  if (!darkBody) return face
  const swap = (s: string) =>
    s.split(EYE_DARK).join(EYE_LIGHT_REPLACEMENT).split(HIGHLIGHT_LIGHT).join(HIGHLIGHT_DARK_REPLACEMENT)
  return {
    eyes: swap(face.eyes),
    highlights: swap(face.highlights),
    blush: face.blush,
    mouth: swap(face.mouth),
  }
}

/**
 * 合成单个表情的完整 sprite(身体 + 五官)。
 * 身体必须非空(opaquePixels > 0),否则抛错 —— 调用方应在生成阶段就拦截空结果。
 */
export function composeExpressionSprite(body: PixelBody, expression: PetExpression, anchorOverride?: FaceAnchor): string {
  const bounds = computeContentBounds(body.grid, body.width, body.height)
  if (!bounds) throw new Error('composeExpressionSprite: body has no opaque pixels')

  const anchor = anchorOverride ?? computeFaceAnchor(bounds)
  const face = adaptFaceColors(FACE_BY_EXPRESSION[expression], isFaceRegionDark(body, anchor))

  const tx = round2(anchor.centerX - anchor.scale * GHOST_FACE_CENTER_X)
  const ty = round2(anchor.centerY - anchor.scale * GHOST_FACE_CENTER_Y)

  const bodyPaths = buildColorPaths(body.palette, body.grid, body.width, body.height).join('')
  const faceMarkup = `${face.eyes}${face.highlights}${face.blush}${face.mouth}`
  const faceGroup = faceMarkup
    ? `<g transform="translate(${tx} ${ty}) scale(${anchor.scale})">${faceMarkup}</g>`
    : ''

  const viewBox = tightViewBox(bounds, body.width, body.height)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${body.width}" height="${body.height}" viewBox="${viewBox}" preserveAspectRatio="xMidYMax meet" shape-rendering="crispEdges">${bodyPaths}${faceGroup}</svg>`
}

/**
 * 身体 + 15 套五官 → 完整 PetSpriteSet。
 * 与内置幽灵一致:同一表情在所有姿态下共享同一张图,姿态动画由渲染器的 CSS transform 承担。
 */
export function composeSpriteSet(body: PixelBody, meta: ComposeMeta, anchorOverride?: FaceAnchor): PetSpriteSet {
  const byExpression = new Map<PetExpression, string>()
  for (const expression of ALL_EXPRESSIONS) {
    byExpression.set(expression, composeExpressionSprite(body, expression, anchorOverride))
  }

  const sprites: Partial<Record<PetSpriteKey, string>> = {}
  for (const pose of ALL_POSES) {
    for (const expression of ALL_EXPRESSIONS) {
      sprites[`${pose}_${expression}` as PetSpriteKey] = byExpression.get(expression)
    }
  }

  return {
    id: meta.id.slice(0, 64),
    name: meta.name.slice(0, 80),
    description: meta.description.slice(0, 200),
    sprites,
    createdAt: Date.now(),
  }
}
