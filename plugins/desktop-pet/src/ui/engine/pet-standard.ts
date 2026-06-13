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
  | 'love'
  | 'curious'
  | 'confused'
  | 'proud'
  | 'scared'
  | 'focused'
  | 'dizzy'

export type PetPose =
  | 'stand'
  | 'walk_1'
  | 'walk_2'
  | 'sit'
  | 'sleep'
  | 'jump'
  | 'wave'
  | 'hover'
  | 'peek'
  | 'spin'
  | 'dance'
  | 'hide'
  | 'focus'

export type PetSpriteKey = `${PetPose}_${PetExpression}`

export const ALL_EXPRESSIONS: PetExpression[] = [
  'neutral', 'happy', 'sad', 'surprised', 'sleepy', 'angry', 'excited', 'shy', 'love',
  'curious', 'confused', 'proud', 'scared', 'focused', 'dizzy'
]

export const ALL_POSES: PetPose[] = [
  'stand', 'walk_1', 'walk_2', 'sit', 'sleep', 'jump', 'wave',
  'hover', 'peek', 'spin', 'dance', 'hide', 'focus'
]

/**
 * Core sprite set: minimal set of sprites needed for a functional pet.
 * These are the SVGs that must be generated for each pet.
 */
export const CORE_SPRITES: PetSpriteKey[] = [
  ...ALL_POSES.flatMap(pose => ALL_EXPRESSIONS.map(expression => `${pose}_${expression}` as PetSpriteKey)),
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
  curiosity: 'curious',
  surprise: 'surprised',
  confusion: 'confused',
  sadness: 'sad',
  disappointment: 'sad',
  worry: 'sad',
  anger: 'angry',
  annoyance: 'angry',
  fear: 'scared',
  sleepiness: 'sleepy',
  tiredness: 'sleepy',
  calm: 'neutral',
  shyness: 'shy',
  embarrassment: 'shy',
  pride: 'proud',
  nervousness: 'scared',
  focus: 'focused',
  concentration: 'focused',
  dizziness: 'dizzy',
}

export function emotionToExpression(emotion: string): PetExpression {
  const lower = emotion.toLowerCase().trim()
  return EXPRESSION_FROM_EMOTION[lower] || 'neutral'
}

// ---------------------------------------------------------------------------
// 自定义形象持久化
// ---------------------------------------------------------------------------

export const PET_CUSTOM_SPRITES_STORAGE_KEY = 'pet-custom-sprite-set'

/** 用户可调的宠物整体不透明度(渲染层),默认 0.7 与内置幽灵观感一致;范围 [0.3, 1] */
export const PET_OPACITY_STORAGE_KEY = 'pet-opacity'
export const DEFAULT_PET_OPACITY = 0.7
export const MIN_PET_OPACITY = 0.3
export const MAX_PET_OPACITY = 1

/** 把任意输入规整为合法的不透明度值;非法时回退默认值 */
export function clampPetOpacity(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_PET_OPACITY
  return Math.min(MAX_PET_OPACITY, Math.max(MIN_PET_OPACITY, n))
}

/** AI 形象历史记录(紧凑格式列表),供设置页回溯/复用历史版本 */
export const PET_APPEARANCE_HISTORY_STORAGE_KEY = 'pet-appearance-history-v1'
/** 历史记录条数上限,超出后丢弃最旧的 */
export const PET_APPEARANCE_HISTORY_LIMIT = 12

/**
 * 落盘用的紧凑格式:同一表情在 13 个姿态下共享同一张 SVG(姿态动画走 CSS),
 * 直接存 195 份会膨胀 13 倍,因此按唯一字符串去重,key 只存下标。
 */
export interface CompactPetSpriteSet {
  v: 1
  id: string
  name: string
  description: string
  createdAt: number
  svgs: string[]
  keys: Partial<Record<PetSpriteKey, number>>
}

const VALID_SPRITE_KEYS = new Set<string>(CORE_SPRITES)

export function compactSpriteSet(set: PetSpriteSet): CompactPetSpriteSet {
  const svgs: string[] = []
  const indexBySvg = new Map<string, number>()
  const keys: Partial<Record<PetSpriteKey, number>> = {}

  for (const [key, svg] of Object.entries(set.sprites)) {
    if (typeof svg !== 'string' || svg.length === 0) continue
    let index = indexBySvg.get(svg)
    if (index === undefined) {
      index = svgs.length
      svgs.push(svg)
      indexBySvg.set(svg, index)
    }
    keys[key as PetSpriteKey] = index
  }

  return {
    v: 1,
    id: set.id,
    name: set.name,
    description: set.description,
    createdAt: set.createdAt,
    svgs,
    keys,
  }
}

/**
 * 紧凑格式 → 完整 PetSpriteSet。对存储数据做防御性校验:
 * 结构不对返回 null;非法 key / 越界下标逐项跳过。
 * 注意:这里只恢复结构,SVG 内容安全由调用方再过 validateSpriteSet 把关。
 */
export function expandSpriteSet(raw: unknown): PetSpriteSet | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return null
  if (!Array.isArray(o.svgs) || !o.keys || typeof o.keys !== 'object') return null

  const svgs = o.svgs as unknown[]
  const sprites: Partial<Record<PetSpriteKey, string>> = {}
  for (const [key, index] of Object.entries(o.keys as Record<string, unknown>)) {
    if (!VALID_SPRITE_KEYS.has(key)) continue
    if (typeof index !== 'number' || !Number.isInteger(index)) continue
    const svg = svgs[index]
    if (typeof svg !== 'string' || svg.length === 0) continue
    sprites[key as PetSpriteKey] = svg
  }

  if (Object.keys(sprites).length === 0) return null

  return {
    id: typeof o.id === 'string' ? o.id : 'custom',
    name: typeof o.name === 'string' ? o.name : '自定义外观',
    description: typeof o.description === 'string' ? o.description : '',
    sprites,
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
  }
}
