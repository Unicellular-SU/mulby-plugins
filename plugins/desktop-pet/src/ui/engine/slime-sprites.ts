/**
 * Ghost pet sprites based on user-provided high-quality SVG.
 * Base body/outline is shared across all expressions.
 * Only eyes, highlights, blush, and mouth change per expression.
 */

import type { PetSpriteSet, PetSpriteKey } from './pet-standard'

// ====== Shared body structure (outline + shading, no face) ======

const BODY_OUTLINE = `<path fill="#23201E" d="M29 22h6v1H29zM28 23h1v1H28zM35 23h2v1H35zM25 25h1v1H25zM38 25h1v1H38zM38 26h1v1H38zM24 27h1v1H24zM39 27h1v1H39zM24 28h1v1H24zM39 28h1v1H39zM24 29h1v1H24zM39 29h1v1H39zM24 30h1v1H24zM35 30h1v1H35zM39 30h1v1H39zM24 31h1v1H24zM31 31h2v1H31zM39 31h1v1H39zM24 32h1v1H24zM39 32h1v1H39zM22 34h1v1H22zM23 36h1v1H23zM40 36h1v1H40zM37 38h1v1H37zM31 40h2v1H31z"/>`

const BODY_DARK = `<path fill="#1A1916" d="M27 23h1v1H27zM26 24h1v1H26zM37 24h1v1H37zM25 26h1v1H25zM23 33h1v1H23zM40 33h1v1H40zM41 34h1v1H41zM22 35h1v1H22zM41 35h1v1H41zM24 37h2v1H24zM38 37h2v1H38zM26 38h1v1H26zM27 39h4v1H27zM33 39h4v1H33z"/>`

const BODY_MAIN = `<path fill="#DEDEDD" d="M29 23h6v1H29zM27 24h3v1H27zM31 24h6v1H31zM26 25h3v1H26zM31 25h7v1H31zM26 26h1v1H26zM30 26h8v1H30zM25 27h2v1H25zM30 27h5v1H30zM36 27h3v1H36zM25 28h2v1H25zM30 28h4v1H30zM37 28h2v1H37zM25 29h2v1H25zM30 29h4v1H30zM37 29h2v1H37zM25 30h3v1H25zM29 30h6v1H29zM36 30h3v1H36zM25 31h1v1H25zM27 31h4v1H27zM33 31h4v1H33zM38 31h1v1H38zM25 32h1v1H25zM29 32h6v1H29zM38 32h1v1H38zM24 33h3v1H24zM28 33h8v1H28zM37 33h3v1H37zM23 34h18v1H23zM23 35h2v1H23zM26 35h12v1H26zM39 35h2v1H39zM27 36h10v1H27zM27 37h2v1H27zM30 37h4v1H30zM35 37h2v1H35zM31 38h2v1H31z"/>`

const BODY_SHADOW = `<path fill="#908F8E" d="M25 35h1v1H25zM38 35h1v1H38zM25 36h2v1H25zM37 36h2v1H37zM26 37h1v1H26zM29 37h1v1H29zM34 37h1v1H34zM37 37h1v1H37zM27 38h3v1H27zM33 38h3v1H33zM31 39h2v1H31z"/>`

const BODY_SHADOW2 = `<path fill="#8A8A89" d="M24 36h1v1H24zM39 36h1v1H39zM30 38h1v1H30zM36 38h1v1H36z"/>`

// ====== Face components for expressions ======

interface FaceParts {
  eyes: string
  highlights: string
  blush: string
  mouth: string
}

// Neutral: original cute eyes with highlights (from reference SVG)
const NEUTRAL: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 27h1v1H28zM35 27h1v1H35zM27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h3v1H27zM34 29h3v1H34zM28 30h1v1H28z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27zM27 27h1v1H27zM29 27h1v1H29zM28 28h1v1H28zM35 28h1v1H35z"/>`,
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h3v1H26zM35 32h3v1H35zM27 33h1v1H27zM36 33h1v1H36z"/>`,
  mouth: '',
}

// Happy: upward arc eyes (^_^), same size as neutral
const HAPPY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM28 29h1v1H28zM35 29h1v1H35z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27zM27 27h1v1H27zM29 27h1v1H29z"/>`,
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h3v1H26zM35 32h3v1H35zM27 33h1v1H27zM36 33h1v1H36z"/>`,
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Sad: same-size droopy eyes, small frown
const SAD: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 28h3v1H27zM34 28h3v1H34zM27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27zM27 27h1v1H27z"/>`,
  blush: '',
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Surprised: slightly round eyes, small O mouth
const SURPRISED: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 27h3v1H27zM34 27h3v1H34zM27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27zM28 28h1v1H28zM35 28h1v1H35z"/>`,
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h2v1H26zM36 32h2v1H36z"/>`,
  mouth: `<path fill="#1A1916" d="M31 31h1v1H31zM32 31h1v1H32z"/>`,
}

// Sleepy: horizontal line eyes (─_─)
const SLEEPY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27z"/>`,
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h2v1H26zM36 32h2v1H36z"/>`,
  mouth: '',
}

// Love: small heart shapes in eye area
const LOVE: FaceParts = {
  eyes: `<path fill="#CF8E8C" d="M27 28h1v1H27zM29 28h1v1H29zM34 28h1v1H34zM36 28h1v1H36zM27 29h3v1H27zM34 29h3v1H34zM28 30h1v1H28zM35 30h1v1H35z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27z"/>`,
  blush: '',
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Angry: V-brow above normal-sized eyes
const ANGRY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M27 27h1v1H27zM36 27h1v1H36zM28 28h1v1H28zM35 28h1v1H35zM27 29h3v1H27zM34 29h3v1H34z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29z"/>`,
  blush: '',
  mouth: `<path fill="#1A1916" d="M31 31h2v1H31z"/>`,
}

// Excited: sparkle eyes (diamond shape), same area
const EXCITED: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 27h1v1H28zM35 27h1v1H35zM27 28h3v1H27zM34 28h3v1H34zM28 29h1v1H28zM35 29h1v1H35z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27zM27 28h1v1H27zM34 28h1v1H34z"/>`,
  blush: `<path fill="#CF8E8C" d="M26 31h1v1H26zM37 31h1v1H37zM26 32h3v1H26zM35 32h3v1H35z"/>`,
  mouth: `<path fill="#1A1916" d="M30 31h4v1H30z"/>`,
}

// Shy: small dots + larger blush
const SHY: FaceParts = {
  eyes: `<path fill="#1A1916" d="M28 28h2v1H28zM35 28h2v1H35zM28 29h2v1H28zM35 29h2v1H35z"/>`,
  highlights: `<path fill="#FDFDFD" d="M30 24h1v1H30zM29 25h2v1H29zM27 26h3v1H27z"/>`,
  blush: `<path fill="#CF8E8C" d="M26 31h2v1H26zM36 31h2v1H36zM26 32h3v1H26zM35 32h3v1H35zM27 33h1v1H27zM36 33h1v1H36z"/>`,
  mouth: '',
}

function buildSprite(face: FaceParts): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="19 19 26 24" shape-rendering="crispEdges">${BODY_MAIN}${BODY_OUTLINE}${BODY_DARK}${BODY_SHADOW}${BODY_SHADOW2}${face.eyes}${face.highlights}${face.blush}${face.mouth}</svg>`
}

function buildSpriteSet(): PetSpriteSet {
  const sprites: Partial<Record<PetSpriteKey, string>> = {}

  sprites['stand_neutral'] = buildSprite(NEUTRAL)
  sprites['stand_happy'] = buildSprite(HAPPY)
  sprites['stand_sad'] = buildSprite(SAD)
  sprites['stand_surprised'] = buildSprite(SURPRISED)
  sprites['stand_sleepy'] = buildSprite(SLEEPY)
  sprites['stand_angry'] = buildSprite(ANGRY)
  sprites['stand_excited'] = buildSprite(EXCITED)
  sprites['stand_shy'] = buildSprite(SHY)
  sprites['stand_love'] = buildSprite(LOVE)

  sprites['walk_1_neutral'] = buildSprite(NEUTRAL)
  sprites['walk_1_happy'] = buildSprite(HAPPY)
  sprites['walk_2_neutral'] = buildSprite(NEUTRAL)
  sprites['walk_2_happy'] = buildSprite(HAPPY)

  sprites['sit_neutral'] = buildSprite(SLEEPY)
  sprites['sit_happy'] = buildSprite(HAPPY)
  sprites['sit_sleepy'] = buildSprite(SLEEPY)

  sprites['sleep_sleepy'] = buildSprite(SLEEPY)
  sprites['sleep_neutral'] = buildSprite(SLEEPY)

  sprites['jump_neutral'] = buildSprite(SURPRISED)
  sprites['jump_happy'] = buildSprite(HAPPY)
  sprites['jump_surprised'] = buildSprite(SURPRISED)
  sprites['jump_excited'] = buildSprite(EXCITED)

  sprites['wave_happy'] = buildSprite(HAPPY)
  sprites['wave_neutral'] = buildSprite(NEUTRAL)
  sprites['wave_excited'] = buildSprite(EXCITED)

  return {
    id: 'ghost_cute',
    name: '幽灵宝宝',
    description: '圆润可爱的小幽灵',
    sprites,
    createdAt: Date.now(),
  }
}

export const SLIME_SPRITE_SET = buildSpriteSet()
