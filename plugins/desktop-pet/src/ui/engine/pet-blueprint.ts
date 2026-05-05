/**
 * Pet Blueprint System
 *
 * AI generates ONE structured "character blueprint" (JSON with body parts).
 * All sprite variants are then programmatically derived by code.
 * This guarantees 100% visual consistency across all states.
 */

export interface Pixel {
  x: number
  y: number
  c: number // palette index
}

export interface PetBlueprint {
  id: string
  name: string
  description: string
  palette: string[] // 4-8 hex colors
  parts: {
    body: Pixel[]
    head: Pixel[]
    leftEye: Pixel[]
    rightEye: Pixel[]
    mouth: Pixel[]
    leftLeg: Pixel[]
    rightLeg: Pixel[]
    leftArm: Pixel[]
    rightArm: Pixel[]
    tail: Pixel[]
    extras: Pixel[] // hat, bow, etc.
  }
  anchors: {
    eyeCenter: { left: { x: number; y: number }; right: { x: number; y: number } }
    mouthCenter: { x: number; y: number }
    bodyCenter: { x: number; y: number }
  }
  createdAt: number
}

export type ExpressionType =
  | 'neutral' | 'happy' | 'sad' | 'surprised'
  | 'sleepy' | 'angry' | 'excited' | 'shy'
  | 'love' | 'confused' | 'proud' | 'scared'

export type PoseType =
  | 'stand' | 'walk_1' | 'walk_2' | 'sit' | 'sleep' | 'jump' | 'wave'

interface ExpressionOverride {
  eyes: Pixel[]
  mouth: Pixel[]
  decorations: Pixel[] // blush, tears, sparkles, etc.
}

/**
 * Generate expression pixel overrides relative to anchor points.
 * Each expression replaces the eye and mouth pixels with a specific pattern.
 */
function getExpressionOverride(
  blueprint: PetBlueprint,
  expression: ExpressionType
): ExpressionOverride {
  const { eyeCenter, mouthCenter } = blueprint.anchors
  const eyeColor = 1 // typically dark/black in palette
  const blushIdx = findPinkIndex(blueprint.palette)
  const accentIdx = findAccentIndex(blueprint.palette)

  const lx = eyeCenter.left.x
  const ly = eyeCenter.left.y
  const rx = eyeCenter.right.x
  const ry = eyeCenter.right.y
  const mx = mouthCenter.x
  const my = mouthCenter.y

  switch (expression) {
    case 'neutral':
      return {
        eyes: [
          { x: lx, y: ly, c: eyeColor }, { x: lx + 1, y: ly, c: eyeColor },
          { x: lx, y: ly + 1, c: eyeColor }, { x: lx + 1, y: ly + 1, c: eyeColor },
          { x: lx, y: ly + 2, c: eyeColor }, { x: lx + 1, y: ly + 2, c: eyeColor },
          { x: rx, y: ry, c: eyeColor }, { x: rx + 1, y: ry, c: eyeColor },
          { x: rx, y: ry + 1, c: eyeColor }, { x: rx + 1, y: ry + 1, c: eyeColor },
          { x: rx, y: ry + 2, c: eyeColor }, { x: rx + 1, y: ry + 2, c: eyeColor },
        ],
        mouth: [
          { x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor },
        ],
        decorations: [],
      }

    case 'happy':
      return {
        eyes: [
          { x: lx - 1, y: ly, c: eyeColor }, { x: lx + 2, y: ly, c: eyeColor },
          { x: lx, y: ly - 1, c: eyeColor }, { x: lx + 1, y: ly - 1, c: eyeColor },
          { x: rx - 1, y: ry, c: eyeColor }, { x: rx + 2, y: ry, c: eyeColor },
          { x: rx, y: ry - 1, c: eyeColor }, { x: rx + 1, y: ry - 1, c: eyeColor },
        ],
        mouth: [
          { x: mx - 1, y: my, c: eyeColor }, { x: mx, y: my, c: eyeColor },
          { x: mx + 1, y: my, c: eyeColor }, { x: mx + 2, y: my, c: eyeColor },
          { x: mx, y: my + 1, c: eyeColor }, { x: mx + 1, y: my + 1, c: eyeColor },
        ],
        decorations: [
          { x: lx - 3, y: ly + 2, c: blushIdx }, { x: lx - 2, y: ly + 2, c: blushIdx },
          { x: lx - 3, y: ly + 3, c: blushIdx }, { x: lx - 2, y: ly + 3, c: blushIdx },
          { x: rx + 3, y: ry + 2, c: blushIdx }, { x: rx + 4, y: ry + 2, c: blushIdx },
          { x: rx + 3, y: ry + 3, c: blushIdx }, { x: rx + 4, y: ry + 3, c: blushIdx },
        ],
      }

    case 'sad':
      return {
        eyes: [
          { x: lx, y: ly, c: eyeColor }, { x: lx + 1, y: ly, c: eyeColor },
          { x: lx, y: ly + 1, c: eyeColor }, { x: lx + 1, y: ly + 1, c: eyeColor },
          { x: rx, y: ry, c: eyeColor }, { x: rx + 1, y: ry, c: eyeColor },
          { x: rx, y: ry + 1, c: eyeColor }, { x: rx + 1, y: ry + 1, c: eyeColor },
        ],
        mouth: [
          { x: mx - 1, y: my + 1, c: eyeColor }, { x: mx + 2, y: my + 1, c: eyeColor },
          { x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor },
        ],
        decorations: [
          { x: lx, y: ly + 4, c: accentIdx }, { x: lx, y: ly + 5, c: accentIdx },
        ],
      }

    case 'surprised':
      return {
        eyes: [
          { x: lx - 1, y: ly - 1, c: eyeColor }, { x: lx, y: ly - 1, c: eyeColor },
          { x: lx + 1, y: ly - 1, c: eyeColor }, { x: lx + 2, y: ly - 1, c: eyeColor },
          { x: lx - 1, y: ly, c: eyeColor }, { x: lx + 2, y: ly, c: eyeColor },
          { x: lx - 1, y: ly + 1, c: eyeColor }, { x: lx + 2, y: ly + 1, c: eyeColor },
          { x: lx - 1, y: ly + 2, c: eyeColor }, { x: lx, y: ly + 2, c: eyeColor },
          { x: lx + 1, y: ly + 2, c: eyeColor }, { x: lx + 2, y: ly + 2, c: eyeColor },
          { x: rx - 1, y: ry - 1, c: eyeColor }, { x: rx, y: ry - 1, c: eyeColor },
          { x: rx + 1, y: ry - 1, c: eyeColor }, { x: rx + 2, y: ry - 1, c: eyeColor },
          { x: rx - 1, y: ry, c: eyeColor }, { x: rx + 2, y: ry, c: eyeColor },
          { x: rx - 1, y: ry + 1, c: eyeColor }, { x: rx + 2, y: ry + 1, c: eyeColor },
          { x: rx - 1, y: ry + 2, c: eyeColor }, { x: rx, y: ry + 2, c: eyeColor },
          { x: rx + 1, y: ry + 2, c: eyeColor }, { x: rx + 2, y: ry + 2, c: eyeColor },
        ],
        mouth: [
          { x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor },
          { x: mx - 1, y: my, c: eyeColor }, { x: mx + 2, y: my, c: eyeColor },
          { x: mx, y: my + 1, c: eyeColor }, { x: mx + 1, y: my + 1, c: eyeColor },
        ],
        decorations: [],
      }

    case 'sleepy':
      return {
        eyes: [
          { x: lx - 1, y: ly, c: eyeColor }, { x: lx, y: ly, c: eyeColor },
          { x: lx + 1, y: ly, c: eyeColor }, { x: lx + 2, y: ly, c: eyeColor },
          { x: rx - 1, y: ry, c: eyeColor }, { x: rx, y: ry, c: eyeColor },
          { x: rx + 1, y: ry, c: eyeColor }, { x: rx + 2, y: ry, c: eyeColor },
        ],
        mouth: [
          { x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor },
          { x: mx + 2, y: my, c: eyeColor },
        ],
        decorations: [],
      }

    case 'angry':
      return {
        eyes: [
          { x: lx, y: ly, c: eyeColor }, { x: lx + 1, y: ly, c: eyeColor },
          { x: lx, y: ly + 1, c: eyeColor }, { x: lx + 1, y: ly + 1, c: eyeColor },
          { x: lx - 1, y: ly - 1, c: eyeColor }, { x: lx + 2, y: ly - 1, c: eyeColor },
          { x: rx, y: ry, c: eyeColor }, { x: rx + 1, y: ry, c: eyeColor },
          { x: rx, y: ry + 1, c: eyeColor }, { x: rx + 1, y: ry + 1, c: eyeColor },
          { x: rx - 1, y: ry - 1, c: eyeColor }, { x: rx + 2, y: ry - 1, c: eyeColor },
        ],
        mouth: [
          { x: mx - 1, y: my, c: eyeColor }, { x: mx, y: my, c: eyeColor },
          { x: mx + 1, y: my, c: eyeColor }, { x: mx + 2, y: my, c: eyeColor },
        ],
        decorations: [
          { x: lx + 3, y: ly - 3, c: accentIdx }, { x: lx + 4, y: ly - 3, c: accentIdx },
        ],
      }

    case 'excited':
      return {
        eyes: [
          { x: lx, y: ly, c: accentIdx }, { x: lx - 1, y: ly - 1, c: accentIdx },
          { x: lx + 1, y: ly - 1, c: accentIdx }, { x: lx - 1, y: ly + 1, c: accentIdx },
          { x: lx + 1, y: ly + 1, c: accentIdx }, { x: lx, y: ly - 2, c: accentIdx },
          { x: lx, y: ly + 2, c: accentIdx }, { x: lx - 2, y: ly, c: accentIdx },
          { x: lx + 2, y: ly, c: accentIdx },
          { x: rx, y: ry, c: accentIdx }, { x: rx - 1, y: ry - 1, c: accentIdx },
          { x: rx + 1, y: ry - 1, c: accentIdx }, { x: rx - 1, y: ry + 1, c: accentIdx },
          { x: rx + 1, y: ry + 1, c: accentIdx }, { x: rx, y: ry - 2, c: accentIdx },
          { x: rx, y: ry + 2, c: accentIdx }, { x: rx - 2, y: ry, c: accentIdx },
          { x: rx + 2, y: ry, c: accentIdx },
        ],
        mouth: [
          { x: mx - 1, y: my, c: eyeColor }, { x: mx, y: my, c: eyeColor },
          { x: mx + 1, y: my, c: eyeColor }, { x: mx + 2, y: my, c: eyeColor },
          { x: mx - 1, y: my + 1, c: eyeColor }, { x: mx + 2, y: my + 1, c: eyeColor },
          { x: mx, y: my + 2, c: eyeColor }, { x: mx + 1, y: my + 2, c: eyeColor },
        ],
        decorations: [
          { x: 5, y: 5, c: accentIdx }, { x: 6, y: 5, c: accentIdx },
          { x: 57, y: 6, c: accentIdx }, { x: 58, y: 6, c: accentIdx },
          { x: 7, y: 8, c: accentIdx }, { x: 56, y: 9, c: accentIdx },
        ],
      }

    case 'shy':
      return {
        eyes: [
          { x: lx + 1, y: ly, c: eyeColor }, { x: lx + 2, y: ly, c: eyeColor },
          { x: lx + 1, y: ly + 1, c: eyeColor }, { x: lx + 2, y: ly + 1, c: eyeColor },
          { x: rx + 1, y: ry, c: eyeColor }, { x: rx + 2, y: ry, c: eyeColor },
          { x: rx + 1, y: ry + 1, c: eyeColor }, { x: rx + 2, y: ry + 1, c: eyeColor },
        ],
        mouth: [{ x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor }],
        decorations: [
          { x: lx - 3, y: ly + 3, c: blushIdx }, { x: lx - 2, y: ly + 3, c: blushIdx },
          { x: lx - 3, y: ly + 4, c: blushIdx }, { x: lx - 2, y: ly + 4, c: blushIdx },
          { x: lx - 4, y: ly + 4, c: blushIdx },
          { x: rx + 3, y: ry + 3, c: blushIdx }, { x: rx + 4, y: ry + 3, c: blushIdx },
          { x: rx + 3, y: ry + 4, c: blushIdx }, { x: rx + 4, y: ry + 4, c: blushIdx },
          { x: rx + 5, y: ry + 4, c: blushIdx },
        ],
      }

    case 'love':
      return {
        eyes: [
          { x: lx - 1, y: ly, c: blushIdx }, { x: lx + 2, y: ly, c: blushIdx },
          { x: lx - 1, y: ly + 1, c: blushIdx }, { x: lx, y: ly + 1, c: blushIdx },
          { x: lx + 1, y: ly + 1, c: blushIdx }, { x: lx + 2, y: ly + 1, c: blushIdx },
          { x: lx, y: ly + 2, c: blushIdx }, { x: lx + 1, y: ly + 2, c: blushIdx },
          { x: rx - 1, y: ry, c: blushIdx }, { x: rx + 2, y: ry, c: blushIdx },
          { x: rx - 1, y: ry + 1, c: blushIdx }, { x: rx, y: ry + 1, c: blushIdx },
          { x: rx + 1, y: ry + 1, c: blushIdx }, { x: rx + 2, y: ry + 1, c: blushIdx },
          { x: rx, y: ry + 2, c: blushIdx }, { x: rx + 1, y: ry + 2, c: blushIdx },
        ],
        mouth: [
          { x: mx - 1, y: my, c: eyeColor }, { x: mx, y: my, c: eyeColor },
          { x: mx + 1, y: my, c: eyeColor }, { x: mx + 2, y: my, c: eyeColor },
          { x: mx, y: my + 1, c: eyeColor }, { x: mx + 1, y: my + 1, c: eyeColor },
        ],
        decorations: [],
      }

    case 'confused':
      return {
        eyes: [
          { x: lx, y: ly, c: eyeColor }, { x: lx + 1, y: ly, c: eyeColor },
          { x: lx, y: ly + 1, c: eyeColor }, { x: lx + 1, y: ly + 1, c: eyeColor },
          { x: rx, y: ry - 1, c: eyeColor }, { x: rx + 1, y: ry - 1, c: eyeColor },
          { x: rx, y: ry, c: eyeColor }, { x: rx + 1, y: ry, c: eyeColor },
        ],
        mouth: [
          { x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor },
          { x: mx + 2, y: my - 1, c: eyeColor },
        ],
        decorations: [
          { x: rx + 4, y: ry - 5, c: eyeColor }, { x: rx + 5, y: ry - 6, c: eyeColor },
          { x: rx + 4, y: ry - 7, c: eyeColor },
        ],
      }

    case 'proud':
      return {
        eyes: [
          { x: lx - 1, y: ly, c: eyeColor }, { x: lx + 2, y: ly, c: eyeColor },
          { x: lx, y: ly - 1, c: eyeColor }, { x: lx + 1, y: ly - 1, c: eyeColor },
          { x: rx - 1, y: ry, c: eyeColor }, { x: rx + 2, y: ry, c: eyeColor },
          { x: rx, y: ry - 1, c: eyeColor }, { x: rx + 1, y: ry - 1, c: eyeColor },
        ],
        mouth: [
          { x: mx - 1, y: my + 1, c: eyeColor }, { x: mx + 2, y: my + 1, c: eyeColor },
          { x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor },
        ],
        decorations: [
          { x: 6, y: 4, c: accentIdx }, { x: 7, y: 4, c: accentIdx },
          { x: 56, y: 5, c: accentIdx }, { x: 57, y: 5, c: accentIdx },
        ],
      }

    case 'scared':
      return {
        eyes: [
          { x: lx, y: ly - 1, c: eyeColor }, { x: lx + 1, y: ly - 1, c: eyeColor },
          { x: lx - 1, y: ly, c: eyeColor }, { x: lx + 2, y: ly, c: eyeColor },
          { x: lx, y: ly + 1, c: eyeColor }, { x: lx + 1, y: ly + 1, c: eyeColor },
          { x: rx, y: ry - 1, c: eyeColor }, { x: rx + 1, y: ry - 1, c: eyeColor },
          { x: rx - 1, y: ry, c: eyeColor }, { x: rx + 2, y: ry, c: eyeColor },
          { x: rx, y: ry + 1, c: eyeColor }, { x: rx + 1, y: ry + 1, c: eyeColor },
        ],
        mouth: [
          { x: mx, y: my, c: eyeColor }, { x: mx + 1, y: my, c: eyeColor },
          { x: mx - 1, y: my + 1, c: eyeColor }, { x: mx + 2, y: my + 1, c: eyeColor },
          { x: mx, y: my + 1, c: eyeColor }, { x: mx + 1, y: my + 1, c: eyeColor },
        ],
        decorations: [
          { x: rx + 4, y: ry - 3, c: accentIdx }, { x: rx + 5, y: ry - 3, c: accentIdx },
          { x: rx + 4, y: ry - 2, c: accentIdx }, { x: rx + 5, y: ry - 2, c: accentIdx },
          { x: rx + 4, y: ry - 1, c: accentIdx }, { x: rx + 5, y: ry - 1, c: accentIdx },
        ],
      }

    default:
      return { eyes: blueprint.parts.leftEye.concat(blueprint.parts.rightEye), mouth: blueprint.parts.mouth, decorations: [] }
  }
}

/**
 * Apply a pose transformation to the blueprint pixel positions.
 */
function applyPose(blueprint: PetBlueprint, pose: PoseType): Map<string, Pixel> {
  const pixels = new Map<string, Pixel>()
  const { body, head, leftLeg, rightLeg, leftArm, rightArm, tail, extras } = blueprint.parts

  const addPixels = (list: Pixel[], offsetX = 0, offsetY = 0) => {
    for (const p of list) {
      const key = `${p.x + offsetX},${p.y + offsetY}`
      pixels.set(key, { x: p.x + offsetX, y: p.y + offsetY, c: p.c })
    }
  }

  switch (pose) {
    case 'stand':
      addPixels(body)
      addPixels(head)
      addPixels(leftLeg)
      addPixels(rightLeg)
      addPixels(leftArm)
      addPixels(rightArm)
      addPixels(tail)
      addPixels(extras)
      break

    case 'walk_1':
      addPixels(body)
      addPixels(head)
      addPixels(leftLeg, 0, -2)
      addPixels(rightLeg, 0, 2)
      addPixels(leftArm, 0, 2)
      addPixels(rightArm, 0, -2)
      addPixels(tail, 1, 0)
      addPixels(extras)
      break

    case 'walk_2':
      addPixels(body)
      addPixels(head)
      addPixels(leftLeg, 0, 2)
      addPixels(rightLeg, 0, -2)
      addPixels(leftArm, 0, -2)
      addPixels(rightArm, 0, 2)
      addPixels(tail, -1, 0)
      addPixels(extras)
      break

    case 'sit':
      addPixels(body, 0, 4)
      addPixels(head, 0, 2)
      addPixels(leftLeg, 2, 4)
      addPixels(rightLeg, -2, 4)
      addPixels(leftArm, 0, 4)
      addPixels(rightArm, 0, 4)
      addPixels(tail, 0, 4)
      addPixels(extras, 0, 2)
      break

    case 'sleep':
      addPixels(body, 0, 5)
      addPixels(head, 0, 5)
      addPixels(leftLeg, 3, 5)
      addPixels(rightLeg, -2, 5)
      addPixels(leftArm, 0, 5)
      addPixels(rightArm, 0, 5)
      addPixels(tail, -2, 5)
      addPixels(extras, 0, 5)
      break

    case 'jump':
      addPixels(body, 0, -5)
      addPixels(head, 0, -6)
      addPixels(leftLeg, 0, -3)
      addPixels(rightLeg, 0, -3)
      addPixels(leftArm, 0, -7)
      addPixels(rightArm, 0, -7)
      addPixels(tail, 0, -5)
      addPixels(extras, 0, -6)
      break

    case 'wave':
      addPixels(body)
      addPixels(head)
      addPixels(leftLeg)
      addPixels(rightLeg)
      addPixels(leftArm, -2, -5)
      addPixels(rightArm)
      addPixels(tail)
      addPixels(extras)
      break
  }

  return pixels
}

/**
 * Render a complete sprite SVG from blueprint + pose + expression.
 */
export function renderSpriteSvg(
  blueprint: PetBlueprint,
  pose: PoseType,
  expression: ExpressionType
): string {
  const pixels = applyPose(blueprint, pose)
  const override = getExpressionOverride(blueprint, expression)

  const eyePositions = new Set<string>()
  for (const p of blueprint.parts.leftEye) eyePositions.add(`${p.x},${p.y}`)
  for (const p of blueprint.parts.rightEye) eyePositions.add(`${p.x},${p.y}`)
  for (const p of blueprint.parts.mouth) eyePositions.add(`${p.x},${p.y}`)

  for (const key of eyePositions) {
    pixels.delete(key)
  }

  for (const p of override.eyes) {
    pixels.set(`${p.x},${p.y}`, p)
  }
  for (const p of override.mouth) {
    pixels.set(`${p.x},${p.y}`, p)
  }
  for (const p of override.decorations) {
    pixels.set(`${p.x},${p.y}`, p)
  }

  const rects: string[] = []
  for (const p of pixels.values()) {
    if (p.x < 0 || p.x >= 64 || p.y < 0 || p.y >= 64) continue
    const color = blueprint.palette[p.c] || blueprint.palette[0]
    rects.push(`<rect x="${p.x}" y="${p.y}" width="1" height="1" fill="${color}"/>`)
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges">${rects.join('')}</svg>`
}

/**
 * Generate all core sprites from a blueprint.
 */
export function generateAllSprites(blueprint: PetBlueprint): Record<string, string> {
  const poses: PoseType[] = ['stand', 'walk_1', 'walk_2', 'sit', 'sleep', 'jump', 'wave']
  const expressions: ExpressionType[] = [
    'neutral', 'happy', 'sad', 'surprised', 'sleepy',
    'angry', 'excited', 'shy', 'love', 'confused', 'proud', 'scared'
  ]

  const sprites: Record<string, string> = {}

  for (const pose of poses) {
    for (const expr of expressions) {
      const key = `${pose}_${expr}`
      sprites[key] = renderSpriteSvg(blueprint, pose, expr)
    }
  }

  return sprites
}

function findPinkIndex(palette: string[]): number {
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i].toUpperCase()
    const r = parseInt(c.slice(1, 3), 16)
    const g = parseInt(c.slice(3, 5), 16)
    const b = parseInt(c.slice(5, 7), 16)
    if (r > 180 && g < 150 && b > 150) return i
  }
  return palette.length > 3 ? 3 : 0
}

function findAccentIndex(palette: string[]): number {
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i].toUpperCase()
    const r = parseInt(c.slice(1, 3), 16)
    const g = parseInt(c.slice(3, 5), 16)
    const b = parseInt(c.slice(5, 7), 16)
    if (r > 200 && g > 150 && b < 100) return i
    if (r < 100 && g > 150 && b > 200) return i
  }
  return Math.min(2, palette.length - 1)
}
