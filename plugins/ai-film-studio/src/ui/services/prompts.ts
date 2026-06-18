/**
 * 文本节点的角色化 System Prompt 与输入组装。
 * 约定：自然语言简述 + ```json 代码块，前端用 jsonParse 解析。
 */
import type { PortValue, FilmNodeData } from '../store/graphStore'
import { getPrompt } from '../store/promptStore'
import { JSON_CONTRACT, fillTemplate } from './promptTemplates'
import { getStylePack, applyStylePack, type StyleRole } from './stylePacks'

export interface BuiltPrompt {
  system: string
  user: string
}

// ============ 镜头语法中英映射（P2-5）============
// 引擎内部统一规范为英文枚举键；UI 显中文、prompt 拼英文。中文→枚举由 LABELS 反转生成，
// 兼容 storyboard 当前输出的中文（远景/推/跟…）。
export type ShotSize = 'extreme-wide' | 'wide' | 'full' | 'medium' | 'close' | 'extreme-close'
export type CameraMove = 'static' | 'dolly-in' | 'dolly-out' | 'pan' | 'tilt' | 'tracking' | 'crane' | 'handheld' | 'zoom'

const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  'extreme-wide': '大远景', wide: '远景', full: '全景', medium: '中景', close: '近景', 'extreme-close': '特写',
}
const CAMERA_LABELS: Record<CameraMove, string> = {
  static: '固定', 'dolly-in': '推', 'dolly-out': '拉', pan: '摇', tilt: '俯仰',
  tracking: '移/跟', crane: '升降', handheld: '手持', zoom: '变焦',
}
const SHOT_SIZE_PROMPT: Record<ShotSize, string> = {
  'extreme-wide': 'extreme wide shot', wide: 'wide shot', full: 'full shot',
  medium: 'medium shot', close: 'close-up', 'extreme-close': 'extreme close-up',
}
export const CAMERA_MOTION: Record<CameraMove, string> = {
  static: 'static camera', 'dolly-in': 'slow dolly in', 'dolly-out': 'slow dolly out',
  pan: 'camera pan', tilt: 'camera tilt', tracking: 'tracking shot following the subject',
  crane: 'crane move', handheld: 'handheld camera', zoom: 'zoom',
}

// 中文→枚举反查（'移/跟' 拆成 移、跟 都映射到 tracking）
function invertLabels(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) for (const part of v.split('/')) if (part) out[part] = k
  return out
}
const TO_SHOT_SIZE = invertLabels(SHOT_SIZE_LABELS)
const TO_CAMERA_MOVE = invertLabels(CAMERA_LABELS)

/** 把分镜里的中文 shotSize/camera（或已是英文枚举）规范化为枚举键 */
export function normShotGrammar(shot: Record<string, unknown>): { shotSize?: ShotSize; camera?: CameraMove } {
  const ssRaw = String(shot.shotSize ?? '').trim()
  const cmRaw = String(shot.camera ?? '').trim()
  const shotSize = (TO_SHOT_SIZE[ssRaw] as ShotSize | undefined) ?? (ssRaw in SHOT_SIZE_PROMPT ? (ssRaw as ShotSize) : undefined)
  const camera = (TO_CAMERA_MOVE[cmRaw] as CameraMove | undefined) ?? (cmRaw in CAMERA_MOTION ? (cmRaw as CameraMove) : undefined)
  return { shotSize, camera }
}

/** keyframe 用：景别 + 运镜 的英文短语（可能为空） */
export function shotGrammarPhrase(shot: Record<string, unknown>): string {
  const { shotSize, camera } = normShotGrammar(shot)
  return [shotSize && SHOT_SIZE_PROMPT[shotSize], camera && CAMERA_MOTION[camera]].filter(Boolean).join(', ')
}

/** i2v 用：把 camera 映射为英文运动短语（可能为空） */
export function shotCameraMotion(shot: Record<string, unknown>): string {
  const { camera } = normShotGrammar(shot)
  return camera ? CAMERA_MOTION[camera] : ''
}

// ============ 原生音频提示拼装（M18-B）============
// 把对白/SFX/环境声拼成喂给原生音频视频模型（Veo3/Sora2/Kling Omni…）的音频指令。
// 关键：显式声明对白语言，否则模型默认讲英文——即使台词本身是中文。
export function buildAudioPrompt(
  dialogue: { speaker: string; line: string; emotion?: string }[],
  sfx: string,
  ambient: string,
  lang?: string
): string {
  const parts: string[] = []
  if (dialogue.length) {
    const langTag = lang ? ` (spoken in ${lang}, keep the exact ${lang} wording, do not translate)` : ''
    parts.push(
      `Dialogue${langTag} — ` +
        dialogue
          .map((d) => `${d.speaker}${d.emotion ? ` (${d.emotion})` : ''}: "${d.line}"`)
          .join(' ')
    )
  }
  if (sfx) parts.push(`Sound effects: ${sfx}`)
  if (ambient) parts.push(`Ambient sound: ${ambient}`)
  return parts.join('. ')
}

function valToText(v?: PortValue): string {
  if (!v) return ''
  // JSON 产物优先用结构化内容（剔除模型输出里的自然语言前言）
  if (v.json !== undefined) {
    try {
      return JSON.stringify(v.json, null, 2)
    } catch {
      // 回退到原始文本
    }
  }
  if (v.text && v.text.trim()) return v.text
  return ''
}

function first(inputs: Record<string, PortValue[]>, handle: string): PortValue | undefined {
  return inputs[handle]?.[0]
}

// 拼接全局设定（若有 json 输入里含 style/aspectRatio）
function globalsHint(inputs: Record<string, PortValue[]>): string {
  for (const arr of Object.values(inputs)) {
    for (const v of arr) {
      if (v.type === 'json' && v.json && typeof v.json === 'object') {
        const g = v.json as Record<string, unknown>
        if (g.style || g.aspectRatio) {
          const parts: string[] = []
          if (g.style) parts.push(`画风：${g.style}`)
          if (g.aspectRatio) parts.push(`画幅：${g.aspectRatio}`)
          return parts.join('，')
        }
      }
    }
  }
  return ''
}

/** 校验文本节点的 JSON 产物是否具备期望结构；返回错误原因（空串=通过） */
export function validateNodeJson(kind: string, json: unknown, ctx?: { sceneIds?: string[]; beatIds?: string[] }): string {
  if (json == null || typeof json !== 'object') return '未能从输出中提取 JSON 对象'
  const j = json as Record<string, unknown>
  const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0
  switch (kind) {
    case 'outline':
      return nonEmptyArray(j.acts) && nonEmptyArray(j.beats) ? '' : 'JSON 缺少非空的 acts / beats 数组'
    case 'script-gen':
      return nonEmptyArray(j.scenes) ? '' : 'JSON 缺少非空的 scenes 数组'
    case 'storyboard': {
      if (!nonEmptyArray(j.shots)) return 'JSON 缺少非空的 shots 数组'
      // §4.3：覆盖校验——仅当上游给了 sceneIds 且分镜确实带了 sceneId（可校验）时才检查，
      // 否则跳过（兼容无结构化场景/旧模板），把「丢后半段」从静默缺陷变可自愈错误。
      const want = ctx?.sceneIds
      if (want && want.length) {
        const shots = j.shots as Array<Record<string, unknown>>
        const covered = new Set(shots.map((s) => String(s.sceneId ?? '')).filter(Boolean))
        if (covered.size > 0) {
          const missing = want.filter((idv) => !covered.has(idv))
          if (missing.length) return `分镜未覆盖场景：${missing.join('、')}`
        }
      }
      return ''
    }
    case 'char-sheet': {
      if (!nonEmptyArray(j.characters)) return 'JSON 缺少非空的 characters 数组'
      // M22a：变体契约阻塞校验——把「同一人物跨时期被合并/未拆分」从静默退化变可自愈错误（§3.2）。
      const chars = j.characters as Array<Record<string, unknown>>
      for (const c of chars) {
        const nm = String(c.name ?? '角色')
        const variants = Array.isArray(c.variants) ? (c.variants as Array<Record<string, unknown>>) : []
        // 外观跨越多个时期（≥2 时代词或"多年后"等时间流逝）却未拆分为 ≥2 变体 → 报错回灌重试
        const idText = `${String(c.identity ?? '')} ${String(c.appearance ?? '')}`
        if (spansMultiplePeriods(idText) && variants.length < 2) {
          return `角色「${nm}」外观跨越多个时期，必须拆分为 variants[]（每个时期一项，含 id/label/appearance/triple；identity 只写不随时间变的特征）`
        }
        // identity 不应同时混入多个时期（应是 age-neutral 身份不变量）
        if (c.identity && spansMultiplePeriods(String(c.identity))) {
          return `角色「${nm}」的 identity 不应混入多个时期（少年/老年/多年后等），各时期外观请放进对应 variant 的 appearance`
        }
        // 变体 id 唯一 + 必备字段
        const seen = new Set<string>()
        for (const v of variants) {
          const vid = String(v.id ?? v.stageKey ?? v.label ?? '')
          if (!vid) return `角色「${nm}」存在缺少 id/label 的变体`
          if (seen.has(vid)) return `角色「${nm}」变体 id 重复：${vid}`
          seen.add(vid)
        }
      }
      return ''
    }
    default:
      return ''
  }
}

/** P2-6：跳轴软告警——同场相邻镜头 screenDirection 翻转且未声明 reverseOf 正反打，疑似跳轴（不阻断） */
export function checkAxisContinuity(shots: Array<Record<string, unknown>>): string[] {
  const warns: string[] = []
  const flip: Record<string, string> = { L2R: 'R2L', R2L: 'L2R', toward: 'away', away: 'toward' }
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1]
    const b = shots[i]
    const aSid = String(a.sceneId ?? '')
    const bSid = String(b.sceneId ?? '')
    if (aSid && bSid && aSid !== bSid) continue
    const aDir = String(a.screenDirection ?? '')
    const bDir = String(b.screenDirection ?? '')
    if (aDir && bDir && flip[aDir] === bDir && String(b.reverseOf ?? '') !== String(a.id ?? '')) {
      warns.push(`镜头 ${String(a.id ?? i)}→${String(b.id ?? i + 1)} 方向翻转（${aDir}→${bDir}）疑似跳轴`)
    }
  }
  return warns
}

/** 构造"带错误反馈"的修复重试 user prompt（把校验错误与上次原文回灌给模型） */
export function buildRepairPrompt(originalUser: string, error: string, lastOutput: string): string {
  return (
    `${originalUser}\n\n———\n【上一次输出无法使用】问题：${error}。\n` +
    `请只输出一个合法的 JSON 对象本身：第一个字符必须是 {，最后一个字符必须是 }；` +
    `不要任何前言、解释、思路、markdown 代码块围栏、注释或尾随逗号。\n` +
    `（你上一次的输出，仅供定位并修正问题）：\n${String(lastOutput || '').slice(0, 3000)}`
  )
}

/** 文本 JSON 节点的最终 System：用户可编辑模板 + 引擎固定追加的硬输出契约（保证可解析） */
function jsonSystem(id: string): string {
  return `${getPrompt(id)}\n\n${JSON_CONTRACT}`
}

const FX_MODE_TO_ID: Record<string, string> = {
  中译英: 'text.fx.zh2en',
  英译中: 'text.fx.en2zh',
  风格化: 'text.fx.stylize',
  扩写: 'text.fx.expand',
}
function promptFxSystem(mode: string): string {
  return getPrompt(FX_MODE_TO_ID[mode] || 'text.fx.expand')
}

// ============ 图像节点 Prompt ============

export interface BuiltImagePrompt {
  prompt: string
  size?: string
}

export interface ImageJob {
  prompt: string
  size?: string
  refName?: string // 主参考图：按角色名匹配上游参考图（跨镜一致性）
  refNames?: string[] // 该镜全部出场角色（多角色一致性，附加参考图）
  refCharIds?: string[] // §5.2：与 refNames 同序的稳定 charId（优先于 name 匹配，杜绝同名错脸）
  refVariantIds?: string[] // M22a：与 refNames 同序的形态键（时期/年龄），(charId,variantId) 精确取该期参考图
  refPropNames?: string[] // 该镜出场物品名（按名匹配物品参考图）
  refPropVariantIds?: string[] // M-scene/prop：与 refPropNames 同序的物品状态键
  sceneVariantId?: string // M-scene/prop：本镜场景的时段/天气变体键（选对应场景板）
  meta?: Record<string, unknown> // 写入产物 meta（角色名 / 镜头号）
}

export interface PromptGlobals {
  aspectRatio?: string
  style?: string
  stylePackId?: string // M21：选中的结构化风格包 id（优先于自由 style 字符串注入锚定/负向词）
  dialogueLang?: string // 对白语言（剧本/分镜台词 + 原生音频/配音），默认中文
  filmScale?: string // 成片体量（微短片/短片/单集/长片）——协调大纲节拍/剧本场数/分镜镜头数
}

/** 画幅 → 图像尺寸 */
function sizeFromAspect(aspect?: string): string | undefined {
  switch (aspect) {
    case '16:9':
      return '1280x720'
    case '9:16':
      return '720x1280'
    case '1:1':
      return '1024x1024'
    default:
      return undefined
  }
}

/**
 * 风格统一出口（M21 单一 seam）：优先级 连入 json.style（显式覆盖）> 项目风格包 stylePackId（结构化锚定+负向）
 * > 项目自由画风字符串。role 决定注入哪组锚定（角色/场景/物品/关键帧）。只取风格，不混入画幅。
 */
function resolveStyle(inputs: Record<string, PortValue[]>, globals?: PromptGlobals, role: StyleRole = 'keyframe'): string {
  for (const arr of Object.values(inputs)) {
    for (const v of arr) {
      const g = v.type === 'json' && v.json && typeof v.json === 'object' ? (v.json as Record<string, unknown>) : null
      if (g?.style) return `style: ${String(g.style)}`
    }
  }
  const pack = getStylePack(globals?.stylePackId)
  if (pack) {
    const affix = applyStylePack(pack, role)
    return globals?.style ? `${affix}, ${globals.style}` : affix // 自由画风可叠加在风格包之后
  }
  return globals?.style ? `style: ${globals.style}` : ''
}

/** 画幅：优先连入的全局设定 json，其次项目级全局设定 */
function resolveAspect(inputs: Record<string, PortValue[]>, globals?: PromptGlobals): string | undefined {
  for (const arr of Object.values(inputs)) {
    for (const v of arr) {
      const g = v.type === 'json' && v.json && typeof v.json === 'object' ? (v.json as Record<string, unknown>) : null
      if (g?.aspectRatio) return String(g.aspectRatio)
    }
  }
  return globals?.aspectRatio
}

/**
 * 构建图像生成任务列表（扇出）：角色三视图按每个角色、关键帧按每个镜头、场景按每个场景各产一条，
 * 全局风格/画幅注入所有任务，画幅决定尺寸。返回空数组表示无可用输入。
 */
// 合并多个 json 端口产物里的数组（如多个「人物」节点 + 角色设定的 characters），裸对象也收
function collectJsonArray(vals: PortValue[] | undefined, ...keys: string[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const v of vals || []) {
    const j = v.json && typeof v.json === 'object' ? (v.json as Record<string, unknown>) : null
    if (!j) continue
    let pushed = false
    for (const k of keys) {
      if (Array.isArray(j[k])) {
        out.push(...(j[k] as Array<Record<string, unknown>>))
        pushed = true
        break
      }
    }
    if (!pushed && Object.keys(j).length) out.push(j)
  }
  return out
}

/**
 * 「人物 / 场景」资产节点的「文字生成」参考图任务：无上游，纯靠自身参数 + 项目全局设定。
 * 人物 → 三视图参考表；场景 → 概念图。无可用文字内容时返回 null。
 */
export function buildAssetImageJob(data: FilmNodeData, globals?: PromptGlobals): ImageJob | null {
  const p = data.params || {}
  const name = String(p.name || '')
  // M21：资产节点按自身类型注入对应角色锚定（character/scene/prop）
  const style = resolveStyle({}, globals, data.kind as StyleRole)
  const withStyle = (s: string) => (style ? `${s}, ${style}` : s)
  if (data.kind === 'character') {
    const basis = String(p.refPrompt || p.appearance || name || '').trim()
    if (!basis) return null
    const size = (typeof p.size === 'string' && p.size) || '1024x1024'
    return {
      prompt: withStyle(fillTemplate(getPrompt('image.assetCharacter'), { basis })),
      size,
      meta: { name },
    }
  }
  if (data.kind === 'scene') {
    const variant = String(p.variant || '').trim() // M-scene/prop：时段/天气变体（黄昏/雨夜…）
    const basis = [String(p.refPrompt || p.description || name || '').trim(), variant].filter(Boolean).join('，')
    if (!basis) return null
    const size = sizeFromAspect(resolveAspect({}, globals)) || '1344x768'
    return {
      prompt: withStyle(fillTemplate(getPrompt('image.assetScene'), { basis })),
      size,
      meta: variant ? { name, variantId: variant, variantLabel: variant } : { name },
    }
  }
  if (data.kind === 'prop') {
    const variant = String(p.variant || '').trim() // M-scene/prop：状态变体（破损/发光…）
    const basis = [String(p.refPrompt || p.description || name || '').trim(), variant].filter(Boolean).join('，')
    if (!basis) return null
    const size = (typeof p.size === 'string' && p.size) || '1024x1024'
    return {
      prompt: withStyle(fillTemplate(getPrompt('image.assetProp'), { basis })),
      size,
      meta: variant ? { name, variantId: variant, variantLabel: variant } : { name },
    }
  }
  return null
}

// ============ 角色三视图（自洽链 + 可选参考图）============
export interface CharViewSet {
  name?: string
  charId?: string
  variantId?: string // M22a：形态键（时期/年龄）。缺省=身份兜底像（base）
  variantLabel?: string
  stageKey?: string
  refName?: string // 用于在「参考图」端口里按角色名匹配上传的人物图
  size?: string
  views: { view: 'front' | 'side' | 'back'; prompt: string }[]
  isBase?: boolean // M22b：age-neutral 底模锚（其 front 作为各变体派生的锁脸参考）
  derives?: boolean // M22b：该变体 front 需从同组底模 front 派生（换龄不换脸）
  baseGroup?: string // 修复 ORD-1：底模与其变体配对的唯一组键（不用 charId/name，避免同名/无名串脸）
}

// M22a：从角色变体对象算稳定形态键（buildCharViewSets 打标与 keyframe 取图必须用同一函数，保证两端一致）
export function variantKey(v: Record<string, unknown>): string {
  return String(v.id ?? v.stageKey ?? v.label ?? '')
}

// M22b：底模锚提示——age-neutral 标准成人正脸，作为跨期锁脸的身份基准
function ageNeutral(s: string): string {
  return [s, 'age-neutral, single canonical adult appearance, neutral expression'].filter(Boolean).join(', ')
}

// M22a：判断一段外观是否"跨越多个时期"（需拆分为 variants）。仅当出现 ≥2 个不同时代词、
// 或显式时间流逝短语时判真——单个「青年男子」不算，避免误伤正常单期角色（§3.2/§3.4）。
const ERA_WORDS = ['少年', '青年', '盛年', '中年', '暮年', '老年', '童年', '幼年']
const TIME_PASSAGE = /多年[后後]|\d+\s*年[后後]|长大[后後]|年老|老去|垂暮|变老/
export function spansMultiplePeriods(text: string): boolean {
  if (!text) return false
  if (TIME_PASSAGE.test(text)) return true
  return ERA_WORDS.filter((w) => text.includes(w)).length >= 2
}

// M22a：为某镜解析角色应使用的形态键。优先 shot.associateAssetIds 显式绑定（在 keyframe 分支处理）；
// 否则归一化关键词匹配（appliesTo ∪ {stageKey,label} 对 shot 的 {beatId,beatType,actId,mood}）；
// 最后按叙事顺序比例兜底（变体设为按时序），保证永远落到某个时期而非糊成一张身份像（§3.3 防 dead-code）。
export function resolveVariantForShot(
  variants: Array<Record<string, unknown>> | undefined,
  shot: Record<string, unknown>,
  i: number,
  total: number
): string | undefined {
  if (!variants || !variants.length) return undefined
  const keys = [shot.beatId, shot.beatType, shot.actId, shot.mood]
    .map((x) => String(x ?? '').toLowerCase().trim())
    .filter(Boolean)
  const hit = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a)))
  for (const v of variants) {
    const tags = [...(Array.isArray(v.appliesTo) ? (v.appliesTo as unknown[]) : []), v.stageKey, v.label]
      .map((x) => String(x ?? '').toLowerCase().trim())
      .filter(Boolean)
    if (tags.some((t) => keys.some((k) => hit(t, k)))) return variantKey(v)
  }
  const idx = total > 1 ? Math.min(variants.length - 1, Math.floor((i / total) * variants.length)) : 0
  return variantKey(variants[idx])
}

/**
 * 把角色设定/人物 拆成「每 (角色 × 变体) 一组三视图」。M22b：有变体时先出 age-neutral 底模(isBase)，
 * 各变体(derives)的 front 由执行层用底模 front 经 editImage 派生（换龄/换装不换脸）；无变体=单组身份像。
 * 各组打 variantId，下游按 (charId,variantId) 精确取图；底模(variantId 缺省)兼作 base 兜底。
 */
export function buildCharViewSets(
  data: FilmNodeData,
  inputs: Record<string, PortValue[]>,
  globals?: PromptGlobals
): CharViewSet[] {
  const p = data.params || {}
  const paramSize = typeof p.size === 'string' ? p.size : undefined
  const style = resolveStyle(inputs, globals, 'character') // M21：角色三视图注入角色锚定
  const size = sizeFromAspect(resolveAspect(inputs, globals)) || paramSize
  const withStyle = (s: string) => [s, style && `, ${style}`].filter(Boolean).join(' ')
  const list = collectJsonArray(inputs['role'], 'characters')
  const mkViews = (ref: string, triple: Record<string, unknown> | undefined) =>
    (['front', 'side', 'back'] as const).map((view) => {
      const viewHint = triple && triple[view] ? String(triple[view]) : `${view} view`
      return { view, prompt: withStyle(fillTemplate(getPrompt('image.charImageView'), { view: viewHint, ref })) }
    })
  return list.flatMap((c, gi): CharViewSet[] => {
    const charId = c.charId ? String(c.charId) : c.name ? String(c.name) : undefined
    const name = c.name ? String(c.name) : undefined
    const identity = String(c.identity || c.refPrompt || c.appearance || c.description || '')
    // 修复 INT-4：变体数硬上限，防失控的角色卡把图量扇成巨大开销
    const variants = (Array.isArray(c.variants) ? (c.variants as Array<Record<string, unknown>>) : []).slice(0, 8)
    if (!variants.length) {
      // 无变体：单组身份像（校验已保证此处只剩单期角色，直接用 appearance/identity，不做有损净化）
      return [{ name, charId, refName: name, size, views: mkViews(identity, c.triple as Record<string, unknown> | undefined) }]
    }
    // 修复 ORD-1：每角色一个唯一组键（取自合并列表下标），底模/变体经它配对，杜绝同名/无名角色 baseFronts 串脸
    const group = `g${gi}`
    // M22b：底模锚（age-neutral，variantId 缺省→兼作 base 兜底）+ 逐变体派生组（front 锁脸到底模）
    const baseSet: CharViewSet = {
      name,
      charId,
      isBase: true,
      baseGroup: group,
      refName: name,
      size,
      views: mkViews(ageNeutral(identity || name || ''), c.triple as Record<string, unknown> | undefined),
    }
    const variantSets: CharViewSet[] = variants.map((v) => {
      // 修复 M22b-1/2：身份文本也注入变体提示词，使无 img2img / 底模失败时仍保身份（底模 front 再叠加图像级锁脸）
      const appearance = [identity, String(v.appearance || v.prompt || v.label || '')].filter(Boolean).join(', ')
      return {
        name,
        charId,
        variantId: variantKey(v),
        variantLabel: v.label ? String(v.label) : undefined,
        stageKey: v.stageKey ? String(v.stageKey) : undefined,
        derives: true,
        baseGroup: group,
        refName: name,
        size,
        views: mkViews(appearance, v.triple as Record<string, unknown> | undefined),
      }
    })
    return [baseSet, ...variantSets]
  })
}

export function buildImagePrompts(
  data: FilmNodeData,
  inputs: Record<string, PortValue[]>,
  globals?: PromptGlobals
): ImageJob[] {
  const p = data.params || {}
  const paramSize = typeof p.size === 'string' ? p.size : undefined
  // M21：按生成对象注入对应锚定——场景概念图用 scene，关键帧用 keyframe
  const imgRole: StyleRole = data.kind === 'scene-image' ? 'scene' : data.kind === 'char-image' ? 'character' : 'keyframe'
  const style = resolveStyle(inputs, globals, imgRole)
  const size = sizeFromAspect(resolveAspect(inputs, globals)) || paramSize
  const withStyle = (s: string) => [s, style && `, ${style}`].filter(Boolean).join(' ')

  switch (data.kind) {
    case 'char-image': {
      // 合并所有连入的角色来源（多个「人物」节点 + 角色设定）。P1-5：每角色 × front/side/back 各产一张
      // 独立资产（meta:{charId,view}），供后续按角度条件取图与稳定身份匹配。
      const list = collectJsonArray(inputs['role'], 'characters')
      if (list.length === 0) return []
      const jobs: ImageJob[] = []
      for (const c of list) {
        const ref = String(c.refPrompt || c.appearance || c.description || '')
        const charId = c.charId ? String(c.charId) : c.name ? String(c.name) : undefined
        const triple = c.triple as Record<string, unknown> | undefined
        for (const view of ['front', 'side', 'back'] as const) {
          const viewHint = triple && triple[view] ? String(triple[view]) : `${view} view`
          jobs.push({
            prompt: withStyle(fillTemplate(getPrompt('image.charImageView'), { view: viewHint, ref })),
            size,
            meta: { name: c.name ? String(c.name) : undefined, kind: 'character', charId, view },
          })
        }
      }
      return jobs
    }
    case 'scene-image': {
      // 合并所有连入的场景来源（多个「场景」节点 / 剧本 scenes / 分镜 shots）
      const list = collectJsonArray(inputs['in'], 'scenes', 'shots')
      if (list.length === 0) {
        const desc = valToText(first(inputs, 'in'))
        if (!desc.trim()) return []
        return [{ prompt: withStyle(fillTemplate(getPrompt('image.sceneImage'), { desc })), size }]
      }
      // P2-3：按地点(locationKey/location/slug)去重，同地点只产一张 master plate，其余复用，避免重复且不一致的场景图
      const seen = new Set<string>()
      const jobs: ImageJob[] = []
      list.forEach((s, i) => {
        const locationKey = String(s.locationKey || s.location || s.slug || `场景${i + 1}`)
        if (seen.has(locationKey)) return
        seen.add(locationKey)
        // 场景图只画环境（空镜 establishing plate），不要人物/动作：
        // 剧本场景优先用干净的 location(+time)/slug（不含动作），场景节点/自由文本才用其环境描述。
        const place = String(s.location || '').trim()
        const time = String(s.time || '').trim()
        const desc = place
          ? [place, time].filter(Boolean).join(', ')
          : String(s.description || s.prompt || s.summary || s.slug || '')
        jobs.push({
          prompt: withStyle(fillTemplate(getPrompt('image.sceneImage'), { desc })),
          size,
          meta: {
            name: s.slug ? String(s.slug) : locationKey,
            kind: 'scene',
            locationKey,
            isMasterPlate: true,
            lighting: s.lighting ? String(s.lighting) : undefined,
            palette: Array.isArray(s.palette) ? s.palette : undefined,
          },
        })
      })
      return jobs
    }
    case 'keyframe': {
      // 分镜来源：storyboard 的 shots，或自由文本描述（shot 端口已放宽为 any）
      let list = collectJsonArray(inputs['shot'], 'shots')
      if (list.length === 0) {
        const desc = valToText(first(inputs, 'shot'))
        list = desc.trim() ? [{ description: desc }] : []
      }
      if (list.length === 0) return []
      // 人物上下文（独立「人物」节点 / 角色设定连入 chars 口）：名称 → 外貌，注入提示并用于参考图匹配
      const charDefs = collectJsonArray(inputs['chars'], 'characters')
      // P2-7：charMap 改存结构化角色档案（外貌恒定 + 动机/弧线随节拍变）
      const charMap = new Map<string, { appearance: string; motivation?: string; arc?: Array<Record<string, unknown>>; variants?: Array<Record<string, unknown>> }>()
      const charIdMap = new Map<string, string>() // §5.2：name → charId 反查（稳定主键优先匹配）
      for (const c of charDefs) {
        if (!c.name) continue
        charMap.set(String(c.name), {
          appearance: String(c.appearance || c.refPrompt || c.description || ''),
          motivation: c.motivation ? String(c.motivation) : undefined,
          arc: Array.isArray(c.arc) ? (c.arc as Array<Record<string, unknown>>) : undefined,
          variants: Array.isArray(c.variants) ? (c.variants as Array<Record<string, unknown>>) : undefined, // M22a
        })
        if (c.charId) charIdMap.set(String(c.name), String(c.charId))
      }
      const soleName = charDefs.length === 1 ? String(charDefs[0].name || '') : ''
      // M24-lite：段落规划——storyboard 可在同一次输出里产 segments[]，shots 经 segmentId 继承段落情绪/光影/各角色当前形态变体
      const sbJson = inputs['shot']?.[0]?.json as Record<string, unknown> | undefined
      const segs = Array.isArray(sbJson?.segments) ? (sbJson!.segments as Array<Record<string, unknown>>) : []
      const segMap = new Map<string, { mood?: string; lighting?: string; activeVariants: Map<string, string> }>()
      for (const sg of segs) {
        const av = new Map<string, string>()
        for (const a of Array.isArray(sg.activeVariants) ? (sg.activeVariants as Array<Record<string, unknown>>) : []) {
          const key = String(a.name ?? a.charId ?? '')
          if (key && a.variantId) av.set(key, String(a.variantId))
        }
        const sid = String(sg.id ?? '')
        if (sid) segMap.set(sid, { mood: sg.mood ? String(sg.mood) : undefined, lighting: sg.lighting ? String(sg.lighting) : undefined, activeVariants: av })
      }
      // 物品上下文（「物品」节点连入 props 口）：名称 → 外观，注入提示 + 用于参考图按名匹配
      const propDefs = collectJsonArray(inputs['props'], 'props')
      const propMap = new Map<string, string>()
      for (const pd of propDefs)
        if (pd.name) propMap.set(String(pd.name), String(pd.appearance || pd.refPrompt || pd.description || ''))
      const solePropName = propDefs.length === 1 ? String(propDefs[0].name || '') : ''
      return list.map((shot, i) => {
        const desc = String(shot.prompt || shot.description || '')
        const shotChars = shot.characters as unknown[] | undefined
        // 该镜全部出场角色（去重）；单角色工程兜底到唯一角色
        const names = (Array.isArray(shotChars) ? shotChars.map((c) => String(c)).filter(Boolean) : [])
        const refNames = Array.from(new Set(names.length ? names : soleName ? [soleName] : []))
        const refName = refNames[0]
        // §5.2：与 refNames 同序的 charId（缺失项留空串占位，pickRef 会回退 name）
        const refCharIds = refNames.map((n) => charIdMap.get(n) || '')
        // M22a：与 refNames 同序的形态键。优先 shot.associateAssetIds 显式绑定，否则按变体 appliesTo/时序解析
        const assoc = Array.isArray(shot.associateAssetIds) ? (shot.associateAssetIds as Array<Record<string, unknown>>) : []
        const seg = segMap.get(String(shot.segmentId ?? ''))
        const refVariantIds = refNames.map((n, k) => {
          const cid = refCharIds[k]
          // 优先级：shot 显式绑定 > 段落 activeVariants（M24-lite 权威源）> appliesTo/叙事比例解析
          const explicit = assoc.find((a) => a && (String(a.charId ?? '') === cid || String(a.name ?? '') === n) && a.variantId)
          if (explicit) return String(explicit.variantId)
          const fromSeg = seg?.activeVariants.get(n) ?? (cid ? seg?.activeVariants.get(cid) : undefined)
          if (fromSeg) return fromSeg
          return resolveVariantForShot(charMap.get(n)?.variants, shot, i, list.length) || ''
        })
        // P2-7：本镜所处阶段（优先 beatId，其次 actId/mood），取该角色此刻状态注入；外貌恒定靠参考图保证
        const stageKey = String(shot.beatId || shot.actId || shot.mood || '')
        const stateAt = (rec: { appearance: string; arc?: Array<Record<string, unknown>> }): string => {
          const a =
            (stageKey ? rec.arc?.find((s) => String(s.stage ?? '') === stageKey) : undefined) ??
            (rec.arc && rec.arc.length ? rec.arc[Math.min(i, rec.arc.length - 1)] : undefined)
          return [rec.appearance, a && `now: ${String(a.state ?? '')} (${String(a.emotion ?? '')})`]
            .filter(Boolean)
            .join(', ')
        }
        const hint = refNames
          .map((n) => {
            const r = charMap.get(n)
            return r ? `${n}: ${stateAt(r)}` : ''
          })
          .filter(Boolean)
          .join('; ')
        // 该镜出场物品（shot.props）；单物品工程兜底唯一物品
        const shotProps = shot.props as unknown[] | undefined
        const refPropNames = Array.from(
          new Set(
            Array.isArray(shotProps)
              ? shotProps.map((x) => String(x)).filter(Boolean)
              : solePropName
                ? [solePropName]
                : []
          )
        )
        const propHint = refPropNames.map((n) => (propMap.get(n) ? `${n}: ${propMap.get(n)}` : n)).join('; ')
        // M-scene/prop：物品状态键（与 refPropNames 同序）——优先 shot.associateAssetIds 显式绑定
        const refPropVariantIds = refPropNames.map((n) =>
          String(assoc.find((a) => a && (String(a.propId ?? '') === n || String(a.name ?? '') === n) && a.variantId)?.variantId ?? '')
        )
        // M-scene/prop：本镜场景时段/天气变体——显式绑定 > shot.sceneVariant/timeOfDay > 退回 mood（用关键词匹配场景板）
        const sceneVariantId = String(
          assoc.find((a) => a && (a.sceneId != null || a.kind === 'scene') && a.variantId)?.variantId ??
            shot.sceneVariant ??
            shot.timeOfDay ??
            ''
        )
        // 角色 + 物品 + 段落氛围 合并注入 {chars} 槽（M24-lite：段落 mood/光影继承）
        const segAtmo = seg && (seg.mood || seg.lighting) ? `atmosphere — ${[seg.mood, seg.lighting].filter(Boolean).join(', ')}` : ''
        const subjects = [hint && `characters — ${hint}`, propHint && `key props — ${propHint}`, segAtmo].filter(Boolean).join('; ')
        // P2-5：景别/运镜规范化为英文短语注入 prompt（不再算出即丢）
        const grammar = shotGrammarPhrase(shot)
        return {
          prompt: withStyle(
            fillTemplate(getPrompt('image.keyframe'), {
              shotGrammar: grammar ? `${grammar}, ` : '',
              desc,
              chars: subjects ? `, ${subjects}` : '',
            })
          ),
          size,
          refName,
          refNames,
          refCharIds,
          refVariantIds,
          refPropNames,
          refPropVariantIds,
          sceneVariantId,
          // P0-1：把镜头级生成信息全量带上，供 i2v 逐帧消费（运镜/动作/时长不再在节点边界丢失）
          // M18-B：对白/SFX/环境声也透传，供 i2v 原生音频模式拼 audioPrompt（storyboard 暂无则为 undefined）
          meta: {
            shot: shot.id ? String(shot.id) : `镜头${i + 1}`,
            prompt: String(shot.prompt || desc || ''),
            camera: shot.camera ? String(shot.camera) : undefined,
            shotSize: shot.shotSize ? String(shot.shotSize) : undefined,
            mood: shot.mood ? String(shot.mood) : undefined,
            motion: shot.motion ? String(shot.motion) : undefined,
            duration: typeof shot.duration === 'number' ? shot.duration : Number(shot.duration) || undefined,
            dialogues: Array.isArray(shot.dialogues) ? shot.dialogues : undefined,
            sfx: shot.sfx ?? undefined,
            ambient: shot.ambient ? String(shot.ambient) : undefined,
            // P2-3：本镜地点，供 execNode 调 selectRefs 只取本场 master plate（根治场景图全收污染）
            sceneName: shot.location ? String(shot.location) : undefined,
            locationKey: shot.locationKey ? String(shot.locationKey) : undefined,
            // 镜头顺接（fix #5）：sceneId 判断是否同场，continuousFromPrev 由分镜标注是否紧接上一镜连贯动作
            sceneId: shot.sceneId != null ? String(shot.sceneId) : undefined,
            continuousFromPrev: shot.continuousFromPrev === true || String(shot.continuousFromPrev ?? '') === 'true',
          },
        }
      })
    }
    default:
      return []
  }
}

/** 全局设定一行：优先连入节点，其次项目级全局设定 */
function globalsLine(inputs: Record<string, PortValue[]>, globals?: PromptGlobals): string {
  const wired = globalsHint(inputs)
  if (wired) return wired
  const parts: string[] = []
  // M21：选了风格包则把其锚定作为画风注入文本节点（storyboard 据此写 style-aware 英文 prompt）
  const pack = getStylePack(globals?.stylePackId)
  if (pack) parts.push(`画风：${[pack.anchors.all, globals?.style].filter(Boolean).join('，')}`)
  else if (globals?.style) parts.push(`画风：${globals.style}`)
  if (globals?.aspectRatio) parts.push(`画幅：${globals.aspectRatio}`)
  return parts.join('，')
}

/**
 * 成片体量规格：协调大纲节拍/剧本场数/分镜镜头数。仅「微短片」给出压缩指令与镜头硬上限，
 * 其余档位返回与历史一致的区间（beats/shotBudget 为空=不覆盖结构默认），保证存量工程零回归。
 */
export function scaleSpec(scale?: string): { beats: string; scenes: string; shotBudget: string; maxShots: number } {
  switch (String(scale || '短片')) {
    case '微短片':
      return {
        beats: '约 3 个核心节拍（开场 → 转折 → 结局），1 幕即可，切勿铺成完整 15 拍',
        scenes: '共 1-2 场',
        shotBudget: '全片总共约 3-5 个镜头（少而精，不要每场都铺满）',
        maxShots: 6,
      }
    case '单集':
      return { beats: '', scenes: '共约 12-24 场', shotBudget: '', maxShots: 0 }
    case '长片':
      return { beats: '', scenes: '共约 30-60 场（含完整三幕）', shotBudget: '', maxShots: 0 }
    default: // 短片
      return { beats: '', scenes: '场景数量适中（建议 3-8 场）', shotBudget: '', maxShots: 0 }
  }
}

/** 当前生效体量：script-gen 的 targetLength 显式覆盖优先（非「跟随全局」），否则跟随项目全局 filmScale */
export function effectiveScale(p: Record<string, unknown>, globals?: PromptGlobals): string {
  const t = String(p.targetLength ?? '跟随全局')
  if (t && t !== '跟随全局') return t
  return String(globals?.filmScale || '短片')
}

/** P2-2：剧本篇幅提示——sceneCount 显式优先，否则按生效体量给场景区间 */
function resolveSceneHint(p: Record<string, unknown>, globals?: PromptGlobals): string {
  const n = Number(p.sceneCount)
  if (Number.isFinite(n) && n > 0) return `共约 ${n} 场（可按叙事需要 ±1）`
  return scaleSpec(effectiveScale(p, globals)).scenes
}

export function buildPrompt(data: FilmNodeData, inputs: Record<string, PortValue[]>, globals?: PromptGlobals): BuiltPrompt {
  const p = data.params || {}
  switch (data.kind) {
    case 'outline': {
      const story = valToText(first(inputs, 'in'))
      const structure = String(p.structure ?? 'Save-the-Cat')
      const id = structure === 'Story-Circle' ? 'text.outline.storycircle' : 'text.outline.savecat'
      const instruction = String(p.instruction ?? '').trim()
      // 成片体量压缩节拍：微短片不要铺满 15 拍（根治"想要 4 镜小故事却给 15 拍宏大叙事"）
      const beats = scaleSpec(globals?.filmScale).beats
      const user = [
        `故事/灵感：\n${story}`,
        beats && `\n本片体量：${globals?.filmScale} → 节拍预算：${beats}（请据此精简，覆盖核心起承转合即可）`,
        instruction && `\n附加要求：${instruction}`,
      ]
        .filter(Boolean)
        .join('')
      return { system: jsonSystem(id), user }
    }
    case 'script-gen': {
      const inVal = first(inputs, 'in')
      // P2-1：识别上游 outline（含 beats），切换为「按节拍铺场」模式并要求 scene 标注 actId/beatId
      const j =
        inVal?.type === 'json' && inVal.json && typeof inVal.json === 'object'
          ? (inVal.json as Record<string, unknown>)
          : null
      const hasOutline = !!j && Array.isArray(j.beats) && (j.beats as unknown[]).length > 0
      const story = valToText(inVal)
      const instruction = String(p.instruction ?? '').trim()
      // P2-2：篇幅控制——sceneCount 显式优先，否则按生效体量（targetLength 覆盖 > 全局 filmScale）给区间
      const sceneHint = resolveSceneHint(p, globals)
      const g = globalsLine(inputs, globals)
      const system = `${fillTemplate(getPrompt('text.script'), { sceneHint })}\n\n${JSON_CONTRACT}`
      const user = [
        hasOutline ? `故事大纲（acts/beats/arcs）：\n${story}` : `故事/灵感：\n${story}`,
        hasOutline &&
          `\n要求：按 beats 顺序逐节拍铺设场景，每个 scene 标注其 actId/beatId（只引用大纲中真实出现的 id），确保覆盖全部 beats（尤其结尾节拍，不得省略后半段）。`,
        `\n篇幅：${sceneHint}`,
        `\n对白语言：所有台词(dialogues[].line)一律用「${globals?.dialogueLang || '中文'}」创作，自然口语、逐字保留不要翻译。`,
        instruction && `\n附加要求：${instruction}`,
        g && `\n全局设定：${g}`,
      ]
        .filter(Boolean)
        .join('')
      return { system, user }
    }
    case 'storyboard': {
      const inVal = first(inputs, 'in')
      const script = valToText(inVal)
      // P2-1：按 scene 数自适应/每场 N 镜，必须覆盖全部场景（防止丢后半段）
      const scenes = collectJsonArray(inputs['in'], 'scenes')
      const perScene = Number(p.shotsPerScene ?? 3) || 3
      const mode = String(p.shotMode ?? '每场N镜')
      const isSingleScene = scenes.length <= 1
      const g = globalsLine(inputs, globals)
      // 成片体量总镜头预算（仅微短片给出，覆盖每场 N 镜，直接控总量）
      const budget = scaleSpec(globals?.filmScale).shotBudget
      const guide = budget
        ? `${budget}。覆盖核心情节即可，不必每场都铺满，按叙事顺序排列。`
        : scenes.length === 0
          ? `把剧本拆为镜头表，按叙事顺序覆盖全部内容、不得截断后半段（约 ${Math.max(perScene * 2, 6)} 个镜头）。`
          : mode === '总量自适应'
            ? `按叙事密度自适应分配镜头，每个 scene 至少 1 镜，必须覆盖全部 ${scenes.length} 个场景，不得遗漏后半段。`
            : isSingleScene
              ? `把本场拆为约 ${perScene} 个镜头。`
              : `每个 scene 拆约 ${perScene} 个镜头，必须覆盖全部 ${scenes.length} 个场景（逐场输出，不得截断）。`
      const user = [
        `剧本${isSingleScene && scenes.length ? '（单场）' : ''}：\n${script}`,
        `\n\n${guide}`,
        scenes.length > 0 && `\n每个 shot 标注 sceneId（引用 scene.id），并继承该 scene 的 actId/beatId。`,
        `\n台词：把剧本里该镜对应的对白填入该 shot 的 dialogues（用「${globals?.dialogueLang || '中文'}」、逐字保留不要翻译；这一镜没人说话才省略）。`,
        g && `\n全局设定（请在每个镜头的英文 prompt 中体现该画风）：${g}`,
      ]
        .filter(Boolean)
        .join('')
      return { system: jsonSystem('text.storyboard'), user }
    }
    case 'char-sheet': {
      const src = valToText(first(inputs, 'in'))
      return { system: jsonSystem('text.charsheet'), user: `故事/剧本：\n${src}` }
    }
    case 'prompt-fx': {
      const text = valToText(first(inputs, 'in'))
      const mode = String(p.mode ?? '扩写')
      return { system: promptFxSystem(mode), user: text }
    }
    default:
      return { system: '', user: '' }
  }
}
