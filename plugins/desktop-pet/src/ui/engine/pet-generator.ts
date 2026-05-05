import type { PetSpriteKey, PetSpriteSet } from './pet-standard'
import { CORE_SPRITES } from './pet-standard'
import type { PetBlueprint, Pixel } from './pet-blueprint'
import { generateAllSprites } from './pet-blueprint'

const BLUEPRINT_PROMPT = `You are an expert 8-bit pixel art designer. Design a cute desktop pet character on a 64x64 pixel grid.

OUTPUT FORMAT:
1. First output the palette (5-7 colors):
PALETTE: #hex0, #hex1, #hex2, #hex3, #hex4

2. Then output the 64x64 grid using these characters:
- '.' = empty/transparent
- '0' = palette color 0 (main body)
- '1' = palette color 1 (dark/outline/eyes)
- '2' = palette color 2 (accent/belly)
- '3' = palette color 3 (secondary)
- '4' = palette color 4 (highlight)
- '5','6' = extra colors if needed

3. Then output body part regions:
REGIONS:
HEAD: row_start-row_end
BODY: row_start-row_end
LEGS: row_start-row_end
LEFT_EYE: x,y (center pixel)
RIGHT_EYE: x,y (center pixel)
MOUTH: x,y (center pixel)

GRID (64 rows, 64 chars each):

DESIGN RULES:
- Character is CENTERED in the 64x64 grid
- Chibi/cute proportions: HEAD is 40-50% of total height, body is compact
- Head occupies roughly rows 6-28, body rows 28-40, legs rows 40-48
- Eyes are 3-4 pixels wide each, positioned in the head area
- Leave 5-8 pixel padding on all sides
- Fill solidly - no single isolated pixels (looks glitchy)
- Use color 1 for outline/dark features (eyes, nose)
- Use color 2 for lighter accent (belly, inner ears)
- Keep it SIMPLE and CUTE - this is pixel art
- Think of classic Game Boy / NES character sprites but with more detail at 64px
- Use the extra resolution for proper ears, tail, rounded shapes, and accessories

Now design the actual pet. Output ONLY the palette, grid (64 lines of 64 chars), and regions. NO other text.`

export interface GenerationProgress {
  total: number
  completed: number
  current: string
  phase: 'generating' | 'rendering'
}

export async function generatePetSpriteSet(
  petDescription: string,
  onProgress?: (progress: GenerationProgress) => void
): Promise<PetSpriteSet | null> {
  const ai = (window as any).mulby?.ai
  if (!ai) return null

  onProgress?.({ total: 2, completed: 0, current: '生成角色设计...', phase: 'generating' })

  let result = ''
  try {
    const req = ai.call(
      {
        model: '',
        messages: [
          { role: 'system', content: BLUEPRINT_PROMPT },
          { role: 'user', content: `Design a cute pixel art pet: ${petDescription}\n\nOutput the PALETTE, GRID (64 rows of 64 chars), and REGIONS. Nothing else.` },
        ],
        params: { maxOutputTokens: 4000, temperature: 0.6 },
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' },
      },
      (chunk: any) => {
        if (chunk.chunkType === 'text' && chunk.content) {
          result += chunk.content
        }
      }
    )
    await req
  } catch (err) {
    console.error('[pet-gen] AI call failed:', err)
    return null
  }

  onProgress?.({ total: 2, completed: 1, current: '渲染所有变体...', phase: 'rendering' })

  const blueprint = parseGridToBlueprint(result, petDescription)
  if (!blueprint) {
    console.error('[pet-gen] Failed to parse grid output:', result.slice(0, 500))
    return null
  }

  const allSprites = generateAllSprites(blueprint)

  const sprites: Partial<Record<PetSpriteKey, string>> = {}
  for (const key of CORE_SPRITES) {
    if (allSprites[key]) {
      sprites[key] = allSprites[key]
    }
  }

  if (!sprites['stand_neutral']) return null

  onProgress?.({ total: 2, completed: 2, current: '完成', phase: 'rendering' })

  const spriteSet: PetSpriteSet = {
    id: `pet_${Date.now()}`,
    name: petDescription.slice(0, 20),
    description: petDescription,
    sprites,
    createdAt: Date.now(),
  }

  try {
    await window.mulby.storage.set('pet-blueprint', blueprint)
  } catch {}

  return spriteSet
}

function parseGridToBlueprint(raw: string, description: string): PetBlueprint | null {
  try {
    const paletteMatch = raw.match(/PALETTE:\s*(#[0-9A-Fa-f]{3,6}(?:\s*,\s*#[0-9A-Fa-f]{3,6})+)/)
    if (!paletteMatch) return null

    const palette = paletteMatch[1].split(',').map(c => c.trim().toUpperCase())
    if (palette.length < 4) return null

    const gridLines: string[] = []
    const lines = raw.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 64 && /^[.0-9]+$/.test(trimmed)) {
        gridLines.push(trimmed)
      } else if (trimmed.length > 56 && trimmed.length <= 72 && /^[.\s0-9]+$/.test(trimmed)) {
        const cleaned = trimmed.replace(/\s/g, '').slice(0, 64).padEnd(64, '.')
        if (cleaned.length === 64) gridLines.push(cleaned)
      }
    }

    if (gridLines.length < 30) return null
    while (gridLines.length < 64) gridLines.push('.'.repeat(64))
    if (gridLines.length > 64) gridLines.length = 64

    let headStart = 64, headEnd = 0
    let bodyStart = 64, bodyEnd = 0
    let legStart = 64, legEnd = 0

    const regionsMatch = raw.match(/REGIONS:[\s\S]*?(?:HEAD|BODY|LEGS|LEFT_EYE|RIGHT_EYE|MOUTH)[\s\S]*?(?=\n\n|\Z|$)/)
    if (regionsMatch) {
      const regionText = regionsMatch[0]
      const headMatch = regionText.match(/HEAD:\s*(\d+)\s*-\s*(\d+)/)
      const bodyMatch = regionText.match(/BODY:\s*(\d+)\s*-\s*(\d+)/)
      const legMatch = regionText.match(/LEGS:\s*(\d+)\s*-\s*(\d+)/)
      if (headMatch) { headStart = parseInt(headMatch[1]); headEnd = parseInt(headMatch[2]) }
      if (bodyMatch) { bodyStart = parseInt(bodyMatch[1]); bodyEnd = parseInt(bodyMatch[2]) }
      if (legMatch) { legStart = parseInt(legMatch[1]); legEnd = parseInt(legMatch[2]) }
    }

    if (headStart >= headEnd) {
      headStart = 8; headEnd = 28; bodyStart = 28; bodyEnd = 40; legStart = 40; legEnd = 48
    }

    let leftEyeX = 0, leftEyeY = 0, rightEyeX = 0, rightEyeY = 0
    let mouthX = 0, mouthY = 0

    const eyeLeftMatch = raw.match(/LEFT_EYE:\s*(\d+)\s*,\s*(\d+)/)
    const eyeRightMatch = raw.match(/RIGHT_EYE:\s*(\d+)\s*,\s*(\d+)/)
    const mouthMatch = raw.match(/MOUTH:\s*(\d+)\s*,\s*(\d+)/)

    if (eyeLeftMatch) { leftEyeX = parseInt(eyeLeftMatch[1]); leftEyeY = parseInt(eyeLeftMatch[2]) }
    if (eyeRightMatch) { rightEyeX = parseInt(eyeRightMatch[1]); rightEyeY = parseInt(eyeRightMatch[2]) }
    if (mouthMatch) { mouthX = parseInt(mouthMatch[1]); mouthY = parseInt(mouthMatch[2]) }

    const allPixels: Pixel[] = []
    for (let y = 0; y < gridLines.length; y++) {
      for (let x = 0; x < gridLines[y].length; x++) {
        const ch = gridLines[y][x]
        if (ch !== '.') {
          const colorIdx = parseInt(ch)
          if (!isNaN(colorIdx) && colorIdx < palette.length) {
            allPixels.push({ x, y, c: colorIdx })
          }
        }
      }
    }

    if (allPixels.length < 20) return null

    if (!leftEyeX && !leftEyeY) {
      const darkPixelsInHead = allPixels.filter(
        p => p.c === 1 && p.y >= headStart && p.y <= headEnd
      )
      if (darkPixelsInHead.length >= 2) {
        darkPixelsInHead.sort((a, b) => a.x - b.x)
        const mid = Math.floor(darkPixelsInHead.length / 2)
        const leftGroup = darkPixelsInHead.slice(0, mid)
        const rightGroup = darkPixelsInHead.slice(mid)
        if (leftGroup.length > 0) {
          leftEyeX = Math.round(leftGroup.reduce((s, p) => s + p.x, 0) / leftGroup.length)
          leftEyeY = Math.round(leftGroup.reduce((s, p) => s + p.y, 0) / leftGroup.length)
        }
        if (rightGroup.length > 0) {
          rightEyeX = Math.round(rightGroup.reduce((s, p) => s + p.x, 0) / rightGroup.length)
          rightEyeY = Math.round(rightGroup.reduce((s, p) => s + p.y, 0) / rightGroup.length)
        }
      }
      if (!leftEyeX) { leftEyeX = 22; leftEyeY = 20 }
      if (!rightEyeX) { rightEyeX = 38; rightEyeY = 20 }
      if (!mouthX) { mouthX = Math.round((leftEyeX + rightEyeX) / 2); mouthY = Math.max(leftEyeY, rightEyeY) + 5 }
    }

    const head: Pixel[] = []
    const body: Pixel[] = []
    const legs: Pixel[] = []
    const eyes: Pixel[] = []
    const mouth: Pixel[] = []

    const eyeRadius = 4
    const mouthRadius = 3

    for (const p of allPixels) {
      const distToLeftEye = Math.abs(p.x - leftEyeX) + Math.abs(p.y - leftEyeY)
      const distToRightEye = Math.abs(p.x - rightEyeX) + Math.abs(p.y - rightEyeY)
      const distToMouth = Math.abs(p.x - mouthX) + Math.abs(p.y - mouthY)

      if (distToLeftEye <= eyeRadius || distToRightEye <= eyeRadius) {
        if (p.c === 1) { eyes.push(p); continue }
      }
      if (distToMouth <= mouthRadius && p.c === 1) {
        mouth.push(p); continue
      }

      if (p.y >= headStart && p.y <= headEnd) head.push(p)
      else if (p.y >= legStart && p.y <= legEnd) legs.push(p)
      else if (p.y > headEnd && p.y < legStart) body.push(p)
      else body.push(p)
    }

    const leftEyePixels = eyes.filter(p => p.x <= (leftEyeX + rightEyeX) / 2)
    const rightEyePixels = eyes.filter(p => p.x > (leftEyeX + rightEyeX) / 2)

    const centerX = Math.round(allPixels.reduce((s, p) => s + p.x, 0) / allPixels.length)
    const leftLegs = legs.filter(p => p.x <= centerX)
    const rightLegs = legs.filter(p => p.x > centerX)

    const blueprint: PetBlueprint = {
      id: `bp_${Date.now()}`,
      name: description.slice(0, 20),
      description,
      palette,
      parts: {
        body,
        head,
        leftEye: leftEyePixels.length > 0 ? leftEyePixels : [{ x: leftEyeX, y: leftEyeY, c: 1 }],
        rightEye: rightEyePixels.length > 0 ? rightEyePixels : [{ x: rightEyeX, y: rightEyeY, c: 1 }],
        mouth: mouth.length > 0 ? mouth : [{ x: mouthX, y: mouthY, c: 1 }],
        leftLeg: leftLegs,
        rightLeg: rightLegs,
        leftArm: [],
        rightArm: [],
        tail: [],
        extras: [],
      },
      anchors: {
        eyeCenter: {
          left: { x: leftEyeX, y: leftEyeY },
          right: { x: rightEyeX, y: rightEyeY },
        },
        mouthCenter: { x: mouthX, y: mouthY },
        bodyCenter: { x: centerX, y: Math.round((bodyStart + bodyEnd) / 2) },
      },
      createdAt: Date.now(),
    }

    return blueprint
  } catch (err) {
    console.error('[pet-gen] Parse error:', err)
    return null
  }
}

export async function regenerateSprite(): Promise<null> {
  return null
}
