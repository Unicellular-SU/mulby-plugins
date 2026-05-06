/**
 * 8-bit Pixel Pet Standard
 *
 * Defines the standard states (expressions + poses) that every AI-generated pet must have.
 * Each state corresponds to one complete SVG sprite.
 */

export type PetExpression =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'surprised'
  | 'sleepy'
  | 'angry'
  | 'excited'
  | 'shy'

export type PetPose =
  | 'stand'
  | 'walk_1'
  | 'walk_2'
  | 'sit'
  | 'sleep'
  | 'jump'
  | 'wave'

export type PetSpriteKey = `${PetPose}_${PetExpression}`

export const ALL_EXPRESSIONS: PetExpression[] = [
  'neutral', 'happy', 'sad', 'surprised', 'sleepy', 'angry', 'excited', 'shy'
]

export const ALL_POSES: PetPose[] = [
  'stand', 'walk_1', 'walk_2', 'sit', 'sleep', 'jump', 'wave'
]

/**
 * Core sprite set: minimal set of sprites needed for a functional pet.
 * These are the SVGs that must be generated for each pet.
 */
export const CORE_SPRITES: PetSpriteKey[] = [
  'stand_neutral',
  'stand_happy',
  'stand_sad',
  'stand_surprised',
  'stand_sleepy',
  'stand_angry',
  'stand_excited',
  'stand_shy',
  'walk_1_neutral',
  'walk_2_neutral',
  'sit_neutral',
  'sit_happy',
  'sit_sleepy',
  'sleep_sleepy',
  'jump_excited',
  'jump_happy',
  'wave_happy',
  'wave_neutral',
]

export interface PetSpriteSet {
  id: string
  name: string
  description: string
  sprites: Partial<Record<PetSpriteKey, string>>
  createdAt: number
}

export function getSpriteKey(pose: PetPose, expression: PetExpression): PetSpriteKey {
  return `${pose}_${expression}`
}

/**
 * Fallback logic: if a specific pose+expression combo doesn't exist,
 * find the closest available sprite.
 */
export function resolveSpriteKey(
  available: Set<PetSpriteKey>,
  pose: PetPose,
  expression: PetExpression
): PetSpriteKey {
  const exact = getSpriteKey(pose, expression)
  if (available.has(exact)) return exact

  const poseNeutral = getSpriteKey(pose, 'neutral')
  if (available.has(poseNeutral)) return poseNeutral

  const standExpr = getSpriteKey('stand', expression)
  if (available.has(standExpr)) return standExpr

  return 'stand_neutral'
}

export const EXPRESSION_FROM_EMOTION: Record<string, PetExpression> = {
  joy: 'happy',
  love: 'love',
  gratitude: 'happy',
  amusement: 'excited',
  excitement: 'excited',
  curiosity: 'surprised',
  surprise: 'surprised',
  confusion: 'surprised',
  sadness: 'sad',
  disappointment: 'sad',
  worry: 'sad',
  anger: 'angry',
  annoyance: 'angry',
  fear: 'surprised',
  sleepiness: 'sleepy',
  tiredness: 'sleepy',
  calm: 'neutral',
  shyness: 'shy',
  embarrassment: 'shy',
  pride: 'happy',
  nervousness: 'surprised',
}

export function emotionToExpression(emotion: string): PetExpression {
  const lower = emotion.toLowerCase().trim()
  return EXPRESSION_FROM_EMOTION[lower] || 'neutral'
}
