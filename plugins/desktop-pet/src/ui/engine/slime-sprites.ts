/**
 * Ghost pet sprites based on user-provided high-quality SVG.
 * Base body/outline is shared across all expressions.
 * Only eyes, highlights, blush, and mouth change per expression.
 */

import { ALL_EXPRESSIONS, ALL_POSES, type PetExpression, type PetSpriteSet, type PetSpriteKey } from './pet-standard'

// ====== Solid white fill covering entire ghost silhouette (prevents see-through) ======

const BODY_FILL = `<path fill="#23201e" d="M29 22h6v1h-6zM28 23h1v1h-1zM35 23h2v1h-2zM25 25h1v1h-1zM38 25h1v1h-1zM38 26h1v1h-1zM24 27h1v1h-1zM39 27h1v1h-1zM24 28h1v1h-1zM39 28h1v1h-1zM24 29h1v1h-1zM39 29h1v1h-1zM24 30h1v1h-1zM39 30h1v1h-1zM24 31h1v1h-1zM39 31h1v1h-1zM24 32h1v1h-1zM39 32h1v1h-1zM22 34h1v1h-1zM23 36h1v1h-1zM40 36h1v1h-1zM37 38h1v1h-1zM31 40h2v1h-2z"/>`

// ====== Shared body structure (outline + shading, no face) ======

const BODY_OUTLINE = `<path fill="#1a1916" d="M27 23h1v1h-1zM26 24h1v1h-1zM37 24h1v1h-1zM25 26h1v1h-1zM23 33h1v1h-1zM40 33h1v1h-1zM41 34h1v1h-1zM22 35h1v1h-1zM41 35h1v1h-1zM24 37h2v1h-2zM38 37h2v1h-2zM26 38h1v1h-1zM27 39h4v1h-4zM33 39h4v1h-4z"/>`

const BODY_DARK = `<path fill="#dededd" d="M29 23h6v1h-6zM27 24h10v1h-10zM26 25h12v1h-12zM26 26h12v1h-12zM25 27h14v1h-14zM25 28h14v1h-14zM25 29h14v1h-14zM25 30h14v1h-14zM25 31h14v1h-14zM25 32h14v1h-14zM24 33h16v1h-16zM23 34h18v1h-18zM23 35h2v1h-2zM26 35h12v1h-12zM39 35h2v1h-2zM27 36h10v1h-10zM27 37h2v1h-2zM30 37h4v1h-4zM35 37h2v1h-2zM31 38h2v1h-2z"/>`

const BODY_MAIN = `<path fill="#908f8e" d="M25 35h1v1h-1zM38 35h1v1h-1zM25 36h2v1h-2zM37 36h2v1h-2zM26 37h1v1h-1zM29 37h1v1h-1zM34 37h1v1h-1zM37 37h1v1h-1zM27 38h3v1h-3zM33 38h3v1h-3zM31 39h2v1h-2z"/>`

const BODY_SHADOW = `<path fill="#8a8a89" d="M24 36h1v1h-1zM39 36h1v1h-1zM30 38h1v1h-1zM36 38h1v1h-1z"/>`

const BODY_SHADOW2 = ``

// ====== Face components for expressions ======

interface FaceParts {
  eyes: string
  highlights: string
  blush: string
  mouth: string
}

// Neutral: original cute eyes (from reference SVG)
const NEUTRAL: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 27h1v1H28zM35 27h1v1H35zM27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h3v1H27zM34 29h3v1H34zM28 30h1v1H28z"/>`,
  highlights: '',
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h3v1H26zM35 32h3v1H35zM27 33h1v1H27zM36 33h1v1H36z"/>`,
  mouth: '',
}

// Happy: ^_^ 弯眼 — 尖在上方 y27、两脚在 y28（屏幕 y 向下，这才是朝上的 ^，不是 ∨）
const HAPPY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 27h1v1H28zM27 28h1v1H27zM29 28h1v1H29zM35 27h1v1H35zM34 28h1v1H34zM36 28h1v1H36z"/>`,
  highlights: '',
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h3v1H26zM35 32h3v1H35zM27 33h1v1H27zM36 33h1v1H36z"/>`,
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Sad: same-size droopy eyes, small frown
const SAD: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 28h3v1H27zM34 28h3v1H34zM27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: '',
  blush: '',
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Surprised: slightly round eyes, small O mouth
const SURPRISED: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 27h3v1H27zM34 27h3v1H34zM27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: '',
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h2v1H26zM36 32h2v1H36z"/>`,
  mouth: `<path fill="#1A1916" d="M31 31h1v1H31zM32 31h1v1H32z"/>`,
}

// Sleepy: horizontal line eyes (─_─)
const SLEEPY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: '',
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h2v1H26zM36 32h2v1H36z"/>`,
  mouth: '',
}

// Love: small heart shapes in eye area
const LOVE: FaceParts = {
  eyes: `<path fill="#CF8E8C" d="M27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h3v1H27zM34 29h3v1H34zM28 30h1v1H28zM35 30h1v1H35z"/>`,
  highlights: '',
  blush: '',
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Angry: V-brow above normal-sized eyes
const ANGRY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 27h1v1H27zM36 27h1v1H36zM28 28h1v1H28zM35 28h1v1H35zM27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: '',
  blush: '',
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Excited: sparkle eyes (diamond shape), same area
const EXCITED: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 27h1v1H28zM35 27h1v1H35zM27 28h3v1H27zM34 28h3v1H34zM28 29h1v1H28zM35 29h1v1H35z"/>`,
  highlights: '',
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h3v1H26zM35 32h3v1H35z"/>`,
  mouth: `<path fill="#1A1916" d="M30 31h4v1H30z"/>`,
}

// Shy: small dots + larger blush
const SHY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 28h2v1H28zM35 28h2v1H35zM28 29h2v1H28zM35 29h2v1H35z"/>`,
  highlights: '',
  blush: `<path fill="#CF8E8C" d="M26 31h2v1H26zM36 31h2v1H36zM26 32h3v1H26zM35 32h3v1H35zM27 33h1v1H27zM36 33h1v1H36z"/>`,
  mouth: '',
}

// Curious: almond black outline；眼洞内上格一格眼白、下格瞳孔黑（避免上格透出身体灰）
const CURIOUS: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 27h1v1H28zM35 27h1v1H35zM27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h1v1H27zM28 29h1v1H28zM29 29h1v1H29zM34 29h1v1H34zM35 29h1v1H35zM36 29h1v1H36zM28 30h1v1H28zM35 30h1v1H35z"/>`,
  highlights: `<path fill="#F7F7F7" d="M28 28h1v1H28zM35 28h1v1H35z"/>`,
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h2v1H26zM36 32h2v1H36z"/>`,
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Confused: a clear question mark in the middle of the face
const CONFUSED: FaceParts = {
  eyes: `<path fill="#1A1916" d="M30 27h4v1H30zM29 28h1v1H29zM34 28h1v1H34zM34 29h1v1H34zM33 30h1v1H33zM32 31h1v1H32zM32 33h1v1H32z"/>`,
  highlights: '',
  blush: '',
  mouth: '',
}

// Proud: 与 Happy 同向的 ^ 弯眼 + 折线处眼白；嘴两端在 y30（较高）、中间 y31，呈向上弯的笑
const PROUD: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 27h1v1H28zM27 28h1v1H27zM29 28h1v1H29zM35 27h1v1H35zM34 28h1v1H34zM36 28h1v1H36z"/>`,
  highlights: `<path fill="#F7F7F7" d="M28 28h1v1H28zM35 28h1v1H35z"/>`,
  blush: '',
  mouth: `<path fill="#1A1916" d="M30 30h1v1H30zM34 30h1v1H34zM31 31h3v1H31z"/>`,
}

// Scared: wide eyes, tiny mouth, and a cold sweat pixel
const SCARED: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 27h3v1H27zM34 27h3v1H34zM27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: `<path fill="#8ECFE3" d="M37 26h1v1H37zM38 27h1v1H38zM37 28h1v1H37z"/>`,
  blush: '',
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31zM31 32h2v1H31z"/>`,
}

// Focused: narrowed eyes and a firm mouth
const FOCUSED: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 28h4v1H27zM33 28h4v1H33zM28 29h2v1H28zM34 29h2v1H34z"/>`,
  highlights: '',
  blush: '',
  mouth: `<path fill="#1A1916" d="M30 31h4v1H30z"/>`,
}

// Dizzy: crossed/spiral-like pixel eyes
const DIZZY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 27h1v1H27zM29 27h1v1H29zM34 27h1v1H34zM36 27h1v1H36zM28 28h1v1H28zM35 28h1v1H35zM27 29h1v1H27zM29 29h1v1H29zM34 29h1v1H34zM36 29h1v1H36z"/>`,
  highlights: '',
  blush: `<path fill="#CF8E8C" d="M26 31h2v1H26zM36 31h2v1H36z"/>`,
  mouth: `<path fill="#1A1916" d="M31 32h2v1H31z"/>`,
}

const FACE_BY_EXPRESSION: Record<PetExpression, FaceParts> = {
  neutral: NEUTRAL,
  happy: HAPPY,
  sad: SAD,
  surprised: SURPRISED,
  sleepy: SLEEPY,
  angry: ANGRY,
  excited: EXCITED,
  shy: SHY,
  love: LOVE,
  curious: CURIOUS,
  confused: CONFUSED,
  proud: PROUD,
  scared: SCARED,
  focused: FOCUSED,
  dizzy: DIZZY,
}

function buildSprite(face: FaceParts): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="19 19 26 24" shape-rendering="crispEdges">${BODY_FILL}${BODY_MAIN}${BODY_OUTLINE}${BODY_DARK}${BODY_SHADOW}${BODY_SHADOW2}${face.eyes}${face.highlights}${face.blush}${face.mouth}</svg>`
}

function buildSpriteSet(): PetSpriteSet {
  const sprites: Partial<Record<PetSpriteKey, string>> = {}

  for (const pose of ALL_POSES) {
    for (const expression of ALL_EXPRESSIONS) {
      const key = `${pose}_${expression}` as PetSpriteKey
      sprites[key] = buildSprite(faceForExpression(expression))
    }
  }

  return {
    id: 'ghost_cute',
    name: '幽灵宝宝',
    description: '圆润可爱的小幽灵',
    sprites,
    createdAt: Date.now(),
  }
}

function faceForExpression(expression: PetExpression): FaceParts {
  return FACE_BY_EXPRESSION[expression]
}

export const SLIME_SPRITE_SET = buildSpriteSet()
