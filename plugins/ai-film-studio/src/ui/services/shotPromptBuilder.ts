/**
 * 5 层电影摄影提示词构建器（借鉴 OpenMontage `lib/shot_prompt_builder.py` 的**思路**，自研重写）。
 *
 * 把分镜的结构化字段编译成「分层」英文提示词，取代「每镜粘贴同一段 style 前缀」导致的全片同质。
 * 固定 5 层顺序：
 *   1 Camera   —— 镜头焦段 + 景深
 *   2 Movement —— 景别 + 运镜（static 省略运镜短语，避免暗示静止）
 *   3 Subject  —— 画面描述 + 材质 + 角色/道具/场景 + 连贯承接
 *   4 Lighting —— 布光 + 色温 + 情绪
 *   5 Style    —— **短 hint**（绝不整段风格前缀粘贴；重型风格注入仍由 stylePacks.applyStylePack 在生成处负责）
 *
 * 纯函数、零运行时依赖（不 import prompts.ts，避免把宿主代码拖进单测），短语字典同时充当 UI 下拉枚举词表。
 * 副作用收益：更多镜头带上真实景别/运镜/布光字段，反过来喂养 #1/#2 质量护栏。
 */

// —— 景别 / 运镜：中英→英文短语（镜像 prompts.ts 的 SHOT_SIZE_PROMPT/CAMERA_MOTION；自带一份保持零依赖）——
const SHOT_SIZE_CN: Record<string, string> = {
  'extreme-wide': '大远景', wide: '远景', full: '全景', medium: '中景', close: '近景', 'extreme-close': '特写',
}
const SHOT_SIZE_PROMPT: Record<string, string> = {
  'extreme-wide': 'extreme wide shot', wide: 'wide shot', full: 'full shot',
  medium: 'medium shot', close: 'close-up', 'extreme-close': 'extreme close-up',
}
const CAMERA_CN: Record<string, string> = {
  static: '固定', 'dolly-in': '推', 'dolly-out': '拉', pan: '摇', tilt: '俯仰',
  tracking: '移/跟', crane: '升降', handheld: '手持', zoom: '变焦',
}
const CAMERA_MOTION: Record<string, string> = {
  static: 'static camera', 'dolly-in': 'slow dolly in', 'dolly-out': 'slow dolly out',
  pan: 'camera pan', tilt: 'camera tilt', tracking: 'tracking shot following the subject',
  crane: 'crane move', handheld: 'handheld camera', zoom: 'zoom',
}
function invert(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) for (const part of v.split('/')) if (part) out[part] = k
  return out
}
const TO_SHOT = invert(SHOT_SIZE_CN)
const TO_CAM = invert(CAMERA_CN)
function normShotSize(raw?: string): string | undefined {
  const s = (raw ?? '').trim()
  if (!s) return undefined
  if (s in SHOT_SIZE_PROMPT) return s
  return TO_SHOT[s]
}
function normCamera(raw?: string): string | undefined {
  const s = (raw ?? '').trim()
  if (!s) return undefined
  if (s in CAMERA_MOTION) return s
  return TO_CAM[s]
}

// —— 电影摄影字段词表（自研整理的通用摄影术语；key=枚举，value=英文短语）——
export type LensKey = 'ultra-wide' | 'wide' | 'normal' | 'portrait' | 'tele' | 'macro'
export const LENS_PHRASE: Record<LensKey, string> = {
  'ultra-wide': '18mm ultra-wide lens', wide: '24mm wide lens', normal: '50mm lens',
  portrait: '85mm portrait lens', tele: '135mm telephoto lens', macro: 'macro lens, extreme detail',
}
export type DofKey = 'deep' | 'medium' | 'shallow' | 'rack'
export const DOF_PHRASE: Record<DofKey, string> = {
  deep: 'deep focus, everything sharp', medium: 'moderate depth of field',
  shallow: 'shallow depth of field, creamy bokeh', rack: 'rack focus pull',
}
export type LightingKey =
  | 'soft' | 'hard' | 'backlit' | 'rim' | 'low-key' | 'high-key'
  | 'golden-hour' | 'blue-hour' | 'neon' | 'candlelit' | 'overcast'
export const LIGHTING_PHRASE: Record<LightingKey, string> = {
  soft: 'soft diffused lighting', hard: 'hard directional lighting, sharp shadows',
  backlit: 'backlit, glowing rim', rim: 'rim lighting separating subject from background',
  'low-key': 'low-key dramatic lighting, deep shadows', 'high-key': 'high-key bright even lighting',
  'golden-hour': 'warm golden hour light', 'blue-hour': 'cool blue hour twilight',
  neon: 'neon-lit, colorful practical lights', candlelit: 'candlelit, warm flickering glow',
  overcast: 'overcast soft daylight',
}
export type ColorTempKey = 'warm' | 'neutral' | 'cool' | 'mixed'
export const COLOR_TEMP_PHRASE: Record<ColorTempKey, string> = {
  warm: 'warm color temperature', neutral: 'neutral white balance',
  cool: 'cool color temperature', mixed: 'mixed warm-cool lighting contrast',
}

export interface ShotPromptInput {
  /** 画面描述（核心；中/英皆可，原样保留） */
  desc: string
  /** 景别（中文「近景」或英文枚举 'close'），经归一 */
  shotSize?: string
  /** 运镜（中文「推」或英文枚举 'dolly-in'），经归一；static 省略运镜短语 */
  camera?: string
  // —— 可选电影摄影字段（Storyboard 暂无对应字段，预留给 UI 扩展 / Agent 产出）——
  lens?: LensKey
  dof?: DofKey
  lighting?: LightingKey
  colorTemp?: ColorTempKey
  /** 材质/质感关键词（逗号分隔） */
  textures?: string
  // —— 主体上下文（与现有 keyframe 路径一致）——
  characters?: string
  props?: string
  setting?: string
  mood?: string
  /** 是否承接上一镜（连贯） */
  continuity?: boolean
  /** 风格短 hint（通常取 pack.hint 或 anchors.all 浓缩；绝不整段前缀粘贴） */
  styleHint?: string
}

/** 把分镜结构化字段编译成 5 层英文提示词；空层自动省略。 */
export function buildShotPrompt(input: ShotPromptInput): string {
  const layers: string[] = []

  // 1 Camera：焦段 + 景深
  const camera = [input.lens && LENS_PHRASE[input.lens], input.dof && DOF_PHRASE[input.dof]].filter(Boolean).join(', ')
  if (camera) layers.push(camera)

  // 2 Movement：景别 + 运镜（static 省略运镜短语）
  const ss = normShotSize(input.shotSize)
  const cm = normCamera(input.camera)
  const movement = [ss && SHOT_SIZE_PROMPT[ss], cm && cm !== 'static' ? CAMERA_MOTION[cm] : undefined]
    .filter(Boolean)
    .join(', ')
  if (movement) layers.push(movement)

  // 3 Subject：描述 + 材质 + 连贯 + 角色/道具/场景
  const subj: string[] = []
  if (input.desc?.trim()) subj.push(input.desc.trim())
  if (input.textures?.trim()) subj.push(input.textures.trim())
  if (input.continuity) subj.push('continue directly from the previous shot: same location, lighting and character appearance')
  if (input.characters?.trim()) subj.push(`characters — ${input.characters.trim()}`)
  if (input.props?.trim()) subj.push(`key props — ${input.props.trim()}`)
  if (input.setting?.trim()) subj.push(`setting — ${input.setting.trim()}`)
  if (subj.length) layers.push(subj.join('; '))

  // 4 Lighting：布光 + 色温 + 情绪
  const light = [input.lighting && LIGHTING_PHRASE[input.lighting], input.colorTemp && COLOR_TEMP_PHRASE[input.colorTemp]]
    .filter(Boolean)
    .join(', ')
  const lightMood = [light, input.mood?.trim() && `mood — ${input.mood.trim()}`].filter(Boolean).join('; ')
  if (lightMood) layers.push(lightMood)

  // 5 Style：短 hint
  if (input.styleHint?.trim()) layers.push(input.styleHint.trim())

  return layers.join(', ')
}

// —— UI 下拉选项（value=枚举 key，label=中文）；storyboard/keyframe 节点可直接用 ——
export interface SelectOption { value: string; label: string }
const toOptions = (phrase: Record<string, string>, labels: Record<string, string>): SelectOption[] =>
  Object.keys(phrase).map((value) => ({ value, label: labels[value] ?? value }))

export const LENS_OPTIONS: SelectOption[] = toOptions(LENS_PHRASE, {
  'ultra-wide': '超广角 18mm', wide: '广角 24mm', normal: '标准 50mm', portrait: '人像 85mm', tele: '长焦 135mm', macro: '微距',
})
export const DOF_OPTIONS: SelectOption[] = toOptions(DOF_PHRASE, {
  deep: '大景深(全清晰)', medium: '中景深', shallow: '浅景深(虚化)', rack: '变焦点(rack)',
})
export const LIGHTING_OPTIONS: SelectOption[] = toOptions(LIGHTING_PHRASE, {
  soft: '柔光', hard: '硬光', backlit: '逆光', rim: '轮廓光', 'low-key': '低调暗调', 'high-key': '高调亮调',
  'golden-hour': '黄金时刻', 'blue-hour': '蓝调时刻', neon: '霓虹', candlelit: '烛光', overcast: '阴天柔光',
})
export const COLOR_TEMP_OPTIONS: SelectOption[] = toOptions(COLOR_TEMP_PHRASE, {
  warm: '暖调', neutral: '中性', cool: '冷调', mixed: '冷暖对比',
})
