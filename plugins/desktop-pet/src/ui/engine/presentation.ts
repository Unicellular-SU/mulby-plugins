/**
 * AI 控制宠物表现：Mulby ai.call 的 function tool + 文本回退标记。
 */
import type { PetExpression, PetPose } from './pet-standard'
import { ALL_EXPRESSIONS, ALL_POSES, emotionToExpression } from './pet-standard'

export const PET_PRESENTATION_TOOL_NAME = 'pet_set_presentation'
export const PET_SHOW_EXPRESSION_TOOL_NAME = 'pet_show_expression'
export const PET_PERFORM_ACTION_TOOL_NAME = 'pet_perform_action'
export const PET_UPDATE_MOOD_TOOL_NAME = 'pet_update_mood'
export const PET_MOVE_TOOL_NAME = 'pet_move'

const FACE_ALIASES: PetExpression[] = [...ALL_EXPRESSIONS]
const FACE_SET = new Set<string>(FACE_ALIASES)
const POSE_SET = new Set<string>(ALL_POSES)
export const EMOTION_LIST = [
  'joy',
  'love',
  'gratitude',
  'amusement',
  'excitement',
  'curiosity',
  'surprise',
  'confusion',
  'sadness',
  'disappointment',
  'worry',
  'anger',
  'annoyance',
  'fear',
  'sleepiness',
  'tiredness',
  'calm',
  'shyness',
  'embarrassment',
  'pride',
  'focus',
  'concentration',
  'dizziness',
  'nervousness',
  'neutral',
  'happy',
  'sad',
  'surprised',
  'sleepy',
  'angry',
  'excited',
  'shy',
  'curious',
  'confused',
  'proud',
  'scared',
  'focused',
  'dizzy',
] as const
const EMOTION_SET = new Set<string>(EMOTION_LIST)
export const ACTION_LIST = [
  'idle',
  'stand',
  'look',
  'chase',
  'wander',
  'walk',
  'walk_1',
  'walk_2',
  'sit',
  'sleep',
  'jump',
  'wave',
  'surprised',
  'happy',
  'cheer',
  'celebrate',
  'wobble',
  'hover',
  'peek',
  'spin',
  'dance',
  'hide',
  'focus',
  'move_left',
  'move_right',
  'move_up',
  'move_down',
  'move_up_left',
  'move_up_right',
  'move_down_left',
  'move_down_right',
] as const
const ANIMATION_LIST = [
  'bounce',
  'spin_bounce',
  'droop',
  'flicker',
  'phase',
  'glow_pulse',
  'hide',
  'wiggle',
  'ascend',
  'wobble',
  'celebrate',
] as const

export type PresentationFace = PetExpression
export type PresentationAction = typeof ACTION_LIST[number]
export type PresentationAnimation = typeof ANIMATION_LIST[number]

export interface PresentationMovement {
  dx: number
  dy: number
}

export interface PresentationIntent {
  face: PresentationFace
  pose?: PetPose
  /** 与 pet-stats applyEmotion 一致的情绪标签（小写） */
  emotion?: string
  animation?: PresentationAnimation
  movement?: PresentationMovement
  durationMs?: number
}

export interface PresentationActionOptions {
  distance?: unknown
  durationMs?: unknown
}

export interface PetAiStreamCallbacks {
  /** 气泡：reply 为对用户可见正文（已去掉表现标记）；reasoning 为推理过程累积 */
  onBubble?: (payload: { reply: string; reasoning: string }) => void
  /** 表情/姿势/心情：tool 来自模型 tool-call；fallback 来自文本标记或 [emotion] */
  onPresentation?: (intent: PresentationIntent, source: 'tool' | 'fallback') => void
}

/**
 * 仅供本插件 UI 内 `mulby.ai.call({ tools: [...] })` 使用。
 * manifest.json 的 `tools` 用于把能力开放给外部 AI Agent，与内联 tools 无关。
 */
export const PET_PRESENTATION_AI_TOOL = {
  type: 'function' as const,
  function: {
    name: PET_PRESENTATION_TOOL_NAME,
    description:
      '兼容工具：同步设定桌面宠物的表情、可选姿势和心情。优先使用 pet_show_expression / pet_perform_action / pet_update_mood；需要一次性设置多个状态时用本工具。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        face: {
          type: 'string',
          enum: [...FACE_SET],
          description: `表情，必须是之一: ${[...FACE_SET].join(', ')}`,
        },
        pose: {
          type: 'string',
          enum: ALL_POSES,
          description: `可选。姿势: ${ALL_POSES.join(', ')}`,
        },
        emotion: {
          type: 'string',
          enum: EMOTION_LIST,
          description:
            '可选。与系统心情统计一致: joy, sadness, surprise, anger, excitement, sleepiness, calm, shyness, love, curiosity',
        },
        durationMs: {
          type: 'number',
          description: '可选。表现持续时间，1000-15000 毫秒。',
        },
        animation: {
          type: 'string',
          enum: ANIMATION_LIST,
          description: `可选。一次性动画: ${ANIMATION_LIST.join(', ')}`,
        },
        movement: {
          type: 'object',
          description: '可选。移动偏移，例如 {"dx":80,"dy":-40}。',
          properties: {
            dx: { type: 'number' },
            dy: { type: 'number' },
            direction: {
              type: 'string',
              enum: ['left', 'right', 'up', 'down', 'up_left', 'up_right', 'down_left', 'down_right'],
            },
            distance: { type: 'number' },
          },
        },
      },
      required: ['face'],
    },
  },
}

export const PET_SHOW_EXPRESSION_AI_TOOL = {
  type: 'function' as const,
  function: {
    name: PET_SHOW_EXPRESSION_TOOL_NAME,
    description: '让桌面宠物立刻切换表情。回复情绪变化时可以多次调用；正文里不要写 [joy] 这类标签。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        expression: {
          type: 'string',
          enum: [...FACE_SET],
          description: `表情: ${[...FACE_SET].join(', ')}`,
        },
        emotion: {
          type: 'string',
          enum: EMOTION_LIST,
          description: `可选。对应心情统计的情绪标签或表情别名: ${EMOTION_LIST.join(', ')}`,
        },
        durationMs: {
          type: 'number',
          description: '可选。表情持续时间，1000-15000 毫秒。',
        },
      },
      required: ['expression'],
    },
  },
}

export const PET_PERFORM_ACTION_AI_TOOL = {
  type: 'function' as const,
  function: {
    name: PET_PERFORM_ACTION_TOOL_NAME,
    description: '让桌面宠物做一个动作或动画，例如跳、挥手、睡觉、庆祝。回复过程中想让宠物动起来时调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ACTION_LIST,
          description: `动作: ${ACTION_LIST.join(', ')}`,
        },
        emotion: {
          type: 'string',
          enum: EMOTION_LIST,
          description: '可选。动作带来的情绪影响。',
        },
        durationMs: {
          type: 'number',
          description: '可选。动作持续时间，1000-15000 毫秒。',
        },
        animation: {
          type: 'string',
          enum: ANIMATION_LIST,
          description: `可选。强制指定一次性动画: ${ANIMATION_LIST.join(', ')}`,
        },
      },
      required: ['action'],
    },
  },
}

export const PET_MOVE_AI_TOOL = {
  type: 'function' as const,
  function: {
    name: PET_MOVE_TOOL_NAME,
    description: '移动桌面宠物的位置。可用 direction 控制上下左右，也可直接给 dx/dy 像素偏移。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        direction: {
          type: 'string',
          enum: ['left', 'right', 'up', 'down', 'up_left', 'up_right', 'down_left', 'down_right'],
          description: '移动方向。',
        },
        distance: {
          type: 'number',
          description: '可选。移动距离，默认 80 像素，最大 320 像素。',
        },
        dx: {
          type: 'number',
          description: '可选。水平偏移像素，左负右正。',
        },
        dy: {
          type: 'number',
          description: '可选。垂直偏移像素，上负下正。',
        },
        durationMs: {
          type: 'number',
          description: '可选。移动耗时，1000-15000 毫秒。',
        },
      },
    },
  },
}

export const PET_UPDATE_MOOD_AI_TOOL = {
  type: 'function' as const,
  function: {
    name: PET_UPDATE_MOOD_TOOL_NAME,
    description: '更新桌面宠物的心情统计。只影响长期心情分数；若还要立即变脸，请同时调用 pet_show_expression。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        emotion: {
          type: 'string',
          enum: EMOTION_LIST,
          description: `心情情绪: ${EMOTION_LIST.join(', ')}`,
        },
      },
      required: ['emotion'],
    },
  },
}

export const PET_PRESENTATION_AI_TOOLS = [
  PET_SHOW_EXPRESSION_AI_TOOL,
  PET_PERFORM_ACTION_AI_TOOL,
  PET_MOVE_AI_TOOL,
  PET_UPDATE_MOOD_AI_TOOL,
  PET_PRESENTATION_AI_TOOL,
]

export function isPresentationToolName(name: string): boolean {
  return [
    PET_PRESENTATION_TOOL_NAME,
    PET_SHOW_EXPRESSION_TOOL_NAME,
    PET_PERFORM_ACTION_TOOL_NAME,
    PET_MOVE_TOOL_NAME,
    PET_UPDATE_MOOD_TOOL_NAME,
  ].some(toolName => name === toolName || name.endsWith(`__${toolName}`))
}

function readArgs(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  return typeof raw === 'object' ? raw as Record<string, unknown> : null
}

function clampDurationMs(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return undefined
  return Math.max(1000, Math.min(15000, Math.round(n)))
}

function clampMoveDistance(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return 80
  return Math.max(10, Math.min(320, Math.round(n)))
}

function clampMoveOffset(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n === 0) return null
  return Math.max(-320, Math.min(320, Math.round(n)))
}

const EMOTION_ALIASES: Record<string, string> = {
  neutral: 'calm',
  happy: 'joy',
  sad: 'sadness',
  surprised: 'surprise',
  sleepy: 'sleepiness',
  angry: 'anger',
  excited: 'excitement',
  shy: 'shyness',
  curious: 'curiosity',
  confused: 'confusion',
  proud: 'pride',
  scared: 'fear',
  focused: 'focus',
  dizzy: 'dizziness',
}

function normalizeEmotion(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const emotion = raw.trim().toLowerCase()
  if (EMOTION_ALIASES[emotion]) return EMOTION_ALIASES[emotion]
  return EMOTION_SET.has(emotion) ? emotion : undefined
}

function normalizeAnimation(raw: unknown): PresentationAnimation | undefined {
  if (typeof raw !== 'string') return undefined
  const animation = raw.trim().toLowerCase()
  return ANIMATION_LIST.includes(animation as PresentationAnimation)
    ? animation as PresentationAnimation
    : undefined
}

const DIRECTION_TO_DELTA: Record<string, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
  up_left: [-1, -1],
  up_right: [1, -1],
  down_left: [-1, 1],
  down_right: [1, 1],
}

function normalizeMovementArgs(raw: Record<string, unknown>): PresentationMovement | null {
  const dx = clampMoveOffset(raw.dx)
  const dy = clampMoveOffset(raw.dy)
  if (dx !== null || dy !== null) {
    return { dx: dx ?? 0, dy: dy ?? 0 }
  }

  const directionRaw = typeof raw.direction === 'string' ? raw.direction.trim().toLowerCase() : ''
  const delta = DIRECTION_TO_DELTA[directionRaw]
  if (!delta) return null
  const distance = clampMoveDistance(raw.distance)
  return { dx: delta[0] * distance, dy: delta[1] * distance }
}

function intentWithOptionalFields(intent: PresentationIntent, args: Record<string, unknown>): PresentationIntent {
  const emotion = normalizeEmotion(args.emotion)
  if (emotion) intent.emotion = emotion

  const durationMs = clampDurationMs(args.durationMs)
  if (durationMs) intent.durationMs = durationMs

  const animation = normalizeAnimation(args.animation)
  if (animation) intent.animation = animation

  if (args.movement && typeof args.movement === 'object') {
    const movement = normalizeMovementArgs(args.movement as Record<string, unknown>)
    if (movement) intent.movement = movement
  }

  return intent
}

export function normalizePresentationArgs(raw: unknown): PresentationIntent | null {
  const o = readArgs(raw)
  if (!o) return null
  const faceRaw = typeof o.face === 'string' ? o.face.trim() : ''
  if (!faceRaw || !FACE_SET.has(faceRaw)) return null
  const face = faceRaw as PresentationFace

  const intent: PresentationIntent = { face }
  if (typeof o.pose === 'string' && POSE_SET.has(o.pose)) intent.pose = o.pose as PetPose
  return intentWithOptionalFields(intent, o)
}

const ACTION_INTENTS: Record<PresentationAction, PresentationIntent> = {
  idle: { face: 'neutral', pose: 'stand' },
  stand: { face: 'neutral', pose: 'stand' },
  look: { face: 'curious', pose: 'stand', emotion: 'curiosity', animation: 'phase' },
  chase: { face: 'excited', pose: 'walk_1', emotion: 'excitement', animation: 'wobble', movement: { dx: 90, dy: -10 } },
  wander: { face: 'neutral', pose: 'walk_2', emotion: 'calm', animation: 'phase', movement: { dx: 45, dy: 0 } },
  walk: { face: 'neutral', pose: 'walk_1', movement: { dx: 70, dy: 0 } },
  walk_1: { face: 'neutral', pose: 'walk_1', animation: 'wobble' },
  walk_2: { face: 'curious', pose: 'walk_2', emotion: 'curiosity', animation: 'phase' },
  sit: { face: 'sleepy', pose: 'sit' },
  sleep: { face: 'sleepy', pose: 'sleep', emotion: 'sleepiness' },
  jump: { face: 'excited', pose: 'jump', emotion: 'excitement', animation: 'ascend' },
  wave: { face: 'happy', pose: 'wave', emotion: 'joy', animation: 'wiggle' },
  surprised: { face: 'surprised', pose: 'stand', emotion: 'surprise', animation: 'phase' },
  happy: { face: 'happy', pose: 'wave', emotion: 'joy', animation: 'bounce' },
  cheer: { face: 'excited', pose: 'wave', emotion: 'excitement', animation: 'spin_bounce' },
  celebrate: { face: 'love', pose: 'wave', emotion: 'joy', animation: 'celebrate' },
  wobble: { face: 'dizzy', pose: 'stand', emotion: 'dizziness', animation: 'wobble' },
  hover: { face: 'neutral', pose: 'hover', emotion: 'calm', animation: 'phase' },
  peek: { face: 'curious', pose: 'peek', emotion: 'curiosity', animation: 'phase' },
  spin: { face: 'dizzy', pose: 'spin', emotion: 'dizziness', animation: 'wobble' },
  dance: { face: 'excited', pose: 'dance', emotion: 'excitement', animation: 'wiggle' },
  hide: { face: 'shy', pose: 'hide', emotion: 'shyness', animation: 'hide' },
  focus: { face: 'focused', pose: 'focus', emotion: 'focus', animation: 'phase' },
  move_left: { face: 'neutral', pose: 'walk_1', movement: { dx: -80, dy: 0 } },
  move_right: { face: 'neutral', pose: 'walk_1', movement: { dx: 80, dy: 0 } },
  move_up: { face: 'neutral', pose: 'walk_1', movement: { dx: 0, dy: -80 } },
  move_down: { face: 'neutral', pose: 'walk_1', movement: { dx: 0, dy: 80 } },
  move_up_left: { face: 'neutral', pose: 'walk_1', movement: { dx: -80, dy: -80 } },
  move_up_right: { face: 'neutral', pose: 'walk_1', movement: { dx: 80, dy: -80 } },
  move_down_left: { face: 'neutral', pose: 'walk_1', movement: { dx: -80, dy: 80 } },
  move_down_right: { face: 'neutral', pose: 'walk_1', movement: { dx: 80, dy: 80 } },
}

export function presentationIntentForAction(
  action: PresentationAction,
  options: PresentationActionOptions = {}
): PresentationIntent {
  const base = ACTION_INTENTS[action]
  const intent: PresentationIntent = {
    ...base,
    movement: base.movement ? { ...base.movement } : undefined,
  }
  if (!intent.movement) delete intent.movement

  if (intent.movement && options.distance !== undefined) {
    const distance = clampMoveDistance(options.distance)
    intent.movement = {
      dx: Math.sign(intent.movement.dx) * distance,
      dy: Math.sign(intent.movement.dy) * distance,
    }
  }

  const durationMs = clampDurationMs(options.durationMs)
  if (durationMs) intent.durationMs = durationMs

  return intent
}

export function normalizePresentationToolCall(name: string, rawArgs: unknown): PresentationIntent | null {
  const args = readArgs(rawArgs)
  if (!args) return null

  if (name === PET_PRESENTATION_TOOL_NAME || name.endsWith(`__${PET_PRESENTATION_TOOL_NAME}`)) {
    return normalizePresentationArgs(args)
  }

  if (name === PET_SHOW_EXPRESSION_TOOL_NAME || name.endsWith(`__${PET_SHOW_EXPRESSION_TOOL_NAME}`)) {
    const raw = typeof args.expression === 'string' ? args.expression.trim() : ''
    if (!raw || !FACE_SET.has(raw)) return null
    const intent: PresentationIntent = { face: raw as PresentationFace }
    return intentWithOptionalFields(intent, args)
  }

  if (name === PET_PERFORM_ACTION_TOOL_NAME || name.endsWith(`__${PET_PERFORM_ACTION_TOOL_NAME}`)) {
    const action = typeof args.action === 'string' ? args.action.trim() as PresentationAction : ''
    if (!ACTION_LIST.includes(action as PresentationAction)) return null
    const intent = presentationIntentForAction(action as PresentationAction, { distance: args.distance })
    return intentWithOptionalFields(intent, args)
  }

  if (name === PET_MOVE_TOOL_NAME || name.endsWith(`__${PET_MOVE_TOOL_NAME}`)) {
    const movement = normalizeMovementArgs(args)
    if (!movement) return null
    const intent: PresentationIntent = { face: 'neutral', pose: 'walk_1', movement }
    return intentWithOptionalFields(intent, args)
  }

  if (name === PET_UPDATE_MOOD_TOOL_NAME || name.endsWith(`__${PET_UPDATE_MOOD_TOOL_NAME}`)) {
    const emotion = normalizeEmotion(args.emotion)
    if (!emotion) return null
    return { face: emotionToFace(emotion), emotion }
  }

  return null
}

const TEXT_PRESENTATION_RULES: Array<{ intent: PresentationIntent; patterns: RegExp[] }> = [
  {
    intent: { face: 'focused', emotion: 'focus', pose: 'focus', animation: 'phase' },
    patterns: [/专注|认真|盯|研究|分析|处理|排查|看代码|检查|让我看看|我看看/],
  },
  {
    intent: { face: 'confused', emotion: 'confusion', pose: 'stand', animation: 'wobble' },
    patterns: [/迷惑|懵|不懂|看不懂|搞不懂|糊涂|啊[?？]|嗯[?？]/],
  },
  {
    intent: { face: 'scared', emotion: 'fear', pose: 'hide', animation: 'phase' },
    patterns: [/害怕|怕|恐怖|吓死|救命|别吓|慌|紧张|完蛋/],
  },
  {
    intent: { face: 'dizzy', emotion: 'dizziness', pose: 'spin', animation: 'wobble' },
    patterns: [/晕|头大|眼花|绕晕|转晕|乱成一团/],
  },
  {
    intent: { face: 'proud', emotion: 'pride', pose: 'wave', animation: 'bounce' },
    patterns: [/骄傲|得意|夸我|表扬|拿捏|我厉害吧|我很棒|帅吧/],
  },
  {
    intent: { face: 'curious', emotion: 'curiosity', pose: 'peek', animation: 'phase' },
    patterns: [/好奇|看看|瞅瞅|为什么|怎么会|怎么回事|哪儿|哪里/],
  },
  {
    intent: { face: 'excited', emotion: 'excitement', pose: 'dance', animation: 'wobble' },
    patterns: [/兴奋|激动|上头|打节拍|左摇右晃|噼里啪啦|开冲|冲[呀鸭啊]|燃起来|好耶|太棒|厉害|起飞/],
  },
  {
    intent: { face: 'love', emotion: 'love', pose: 'wave', animation: 'glow_pulse' },
    patterns: [/喜欢|爱你|贴贴|小心心|想你|陪着你|抱抱|亲密/],
  },
  {
    intent: { face: 'sleepy', emotion: 'sleepiness', pose: 'sit', animation: 'droop' },
    patterns: [/困|睡|晚了|熬夜|休息|歇|累|疲惫|眯一会|打盹/],
  },
  {
    intent: { face: 'angry', emotion: 'anger', pose: 'stand', animation: 'flicker' },
    patterns: [/生气|气死|烦|暴躁|哼|切|就这|离谱|欠揍|服了|戳我|手痒|上瘾|闹脾气/],
  },
  {
    intent: { face: 'sad', emotion: 'sadness', pose: 'sit', animation: 'droop' },
    patterns: [/难过|伤心|委屈|失落|可怜|失败|糟糕|心疼/],
  },
  {
    intent: { face: 'surprised', emotion: 'surprise', pose: 'stand', animation: 'phase' },
    patterns: [/喂喂|什么|啥|惊|吓|居然|突然|真的假的|火星子|哇|诶|欸|[?？]/],
  },
  {
    intent: { face: 'shy', emotion: 'shyness', pose: 'stand', animation: 'hide' },
    patterns: [/害羞|不好意思|脸红|羞|别看/],
  },
  {
    intent: { face: 'happy', emotion: 'joy', pose: 'wave', animation: 'bounce' },
    patterns: [/开心|嘿嘿|哈哈|笑死|好好好|不错|可以|谢谢|舒服|安心|棒/],
  },
  {
    intent: { face: 'neutral', emotion: 'calm', pose: 'stand' },
    patterns: [/冷静|平静|慢慢|别急|稳住|没事/],
  },
]

const HINT_PRESENTATION_INTENTS: Record<string, PresentationIntent> = {
  idle: { face: 'sleepy', emotion: 'sleepiness', pose: 'sit', animation: 'droop' },
  typing_fast: { face: 'focused', emotion: 'focus', pose: 'focus', animation: 'spin_bounce' },
  morning: { face: 'happy', emotion: 'joy', pose: 'wave', animation: 'bounce' },
  late_night: { face: 'sleepy', emotion: 'sleepiness', pose: 'sit', animation: 'droop' },
  user_click: { face: 'happy', emotion: 'joy', pose: 'wave', animation: 'wiggle' },
  behavior_change: { face: 'surprised', emotion: 'surprise', pose: 'stand', animation: 'phase' },
}

const STAGE_DIRECTION = /[（(]\s*([^（）()]{1,80})\s*[）)]/g
const STAGE_ACTION_WORDS = /打[了个]*[哈呵]欠|[哈呵]欠|一脸|不耐烦|不满|转过身|转身|屁股|背对|飘|绕|转圈|转了|靠近|躲|跳|挥手|睡|打盹|蹭|抖|晃|摇/

export function extractStageDirectionIntents(text: string): PresentationIntent[] {
  const intents: PresentationIntent[] = []
  for (const match of text.matchAll(STAGE_DIRECTION)) {
    const action = match[1].replace(/\s+/g, '')
    if (!STAGE_ACTION_WORDS.test(action)) continue

    if (/打[了个]*[哈呵]欠|[哈呵]欠|睡|打盹/.test(action)) {
      intents.push({ face: 'sleepy', emotion: 'sleepiness', pose: 'sit', animation: 'droop' })
    }
    if (/一脸|不耐烦|不满/.test(action)) {
      intents.push({ face: 'angry', emotion: 'anger', pose: 'stand', animation: 'flicker' })
    }
    if (/转圈|转了|绕/.test(action)) {
      intents.push({ face: 'dizzy', emotion: 'dizziness', pose: 'spin', animation: 'wobble' })
    }
    if (/飘|靠近/.test(action)) {
      intents.push({
        face: 'curious',
        emotion: 'curiosity',
        pose: 'hover',
        animation: 'phase',
        movement: { dx: 80, dy: -20 },
      })
    }
    if (/抖|晃|摇/.test(action)) {
      intents.push({
        face: 'excited',
        emotion: 'excitement',
        pose: 'dance',
        animation: 'wobble',
        movement: { dx: 80, dy: -20 },
      })
    }
    if (/躲|转过身|转身|屁股|背对/.test(action)) {
      intents.push({ face: 'shy', emotion: 'shyness', pose: 'hide', animation: 'hide', movement: { dx: -80, dy: 0 } })
    }
    if (/跳/.test(action)) {
      intents.push({ face: 'excited', emotion: 'excitement', pose: 'jump', animation: 'ascend' })
    }
    if (/挥手/.test(action)) {
      intents.push({ face: 'happy', emotion: 'joy', pose: 'wave', animation: 'wiggle' })
    }
  }
  return intents
}

export function stripStageDirections(text: string): string {
  return text.replace(STAGE_DIRECTION, (full, action: string) => {
    return STAGE_ACTION_WORDS.test(action.replace(/\s+/g, '')) ? '' : full
  })
}

export function inferPresentationFromText(text: string, hint?: string): PresentationIntent | null {
  const clean = stripPresentationMarkers(text).replace(/\s+/g, '')
  if (clean) {
    for (const rule of TEXT_PRESENTATION_RULES) {
      if (rule.patterns.some(pattern => pattern.test(clean))) {
        return { ...rule.intent }
      }
    }
    return null
  }
  const hintIntent = hint ? HINT_PRESENTATION_INTENTS[hint] : undefined
  return hintIntent ? { ...hintIntent } : null
}

const PET_BLOCK = /<<<PET\s*(\{[\s\S]*?\})\s*>>>/g
const INLINE_MARKER_NAMES = Array.from(new Set([
  ...EMOTION_LIST,
  ...ALL_EXPRESSIONS,
  ...ACTION_LIST,
  '...',
]))
const INLINE_MARKER = new RegExp(
  `\\[(${INLINE_MARKER_NAMES.map(escapeRegExp).join('|')})\\]\\s*`,
  'gi'
)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripPresentationMarkers(text: string): string {
  return stripInlineEmotionMarkers(stripStageDirections(text.replace(PET_BLOCK, ''))).replace(/\n{3,}/g, '\n\n').trim()
}

function emotionToFace(emotion: string): PresentationFace {
  return emotionToExpression(emotion)
}

export function stripInlineEmotionMarkers(text: string): string {
  return text.replace(INLINE_MARKER, '')
}

export function extractInlineEmotionIntents(text: string): PresentationIntent[] {
  const intents: PresentationIntent[] = []
  for (const match of text.matchAll(INLINE_MARKER)) {
    const marker = match[1].toLowerCase()
    if (marker === '...') continue

    const emotion = normalizeEmotion(marker)
    if (emotion) {
      const face = FACE_SET.has(marker)
        ? marker as PresentationFace
        : emotionToFace(emotion)
      intents.push({ face, emotion })
      continue
    }

    if (ACTION_LIST.includes(marker as PresentationAction)) {
      const actionIntent = normalizePresentationToolCall(PET_PERFORM_ACTION_TOOL_NAME, { action: marker })
      if (actionIntent) intents.push(actionIntent)
    }
  }
  return intents
}

/** 提取并移除所有 <<<PET {...}>>> 块，合并为单一 intent（后者覆盖前者） */
export function tryExtractPresentationMarker(text: string): { cleaned: string; intent: PresentationIntent | null } {
  let last: PresentationIntent | null = null
  const cleaned = text.replace(PET_BLOCK, (_m, json: string) => {
    try {
      const p = JSON.parse(json) as unknown
      const n = normalizePresentationArgs(p)
      if (n) last = n
    } catch {
      /* ignore */
    }
    return ''
  })
  return { cleaned: stripInlineEmotionMarkers(cleaned).trim(), intent: last }
}

export function sanitizeAssistantForHistory(content: string): string {
  return stripPresentationMarkers(content).trim()
}
