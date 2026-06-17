/**
 * 文本节点的角色化 System Prompt 与输入组装。
 * 约定：自然语言简述 + ```json 代码块，前端用 jsonParse 解析。
 */
import type { PortValue, FilmNodeData } from '../store/graphStore'

export interface BuiltPrompt {
  system: string
  user: string
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
export function validateNodeJson(kind: string, json: unknown): string {
  if (json == null || typeof json !== 'object') return '未能从输出中提取 JSON 对象'
  const j = json as Record<string, unknown>
  const nonEmptyArray = (v: unknown) => Array.isArray(v) && v.length > 0
  switch (kind) {
    case 'script-gen':
      return nonEmptyArray(j.scenes) ? '' : 'JSON 缺少非空的 scenes 数组'
    case 'storyboard':
      return nonEmptyArray(j.shots) ? '' : 'JSON 缺少非空的 shots 数组'
    case 'char-sheet':
      return nonEmptyArray(j.characters) ? '' : 'JSON 缺少非空的 characters 数组'
    default:
      return ''
  }
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

const SCRIPT_SYSTEM = `你是资深编剧。根据用户提供的故事/灵感，创作一个结构完整的分场剧本。

【输出要求·必须严格遵守】只输出一个合法的 JSON 对象本身：不要任何前言、说明、思路、注释，也不要 markdown 代码块围栏（不要 \`\`\`）。第一个字符必须是 {，最后一个字符必须是 }。所有键名与字符串值一律用英文双引号 "，禁止尾随逗号，禁止中文标点引号。

JSON 结构：
{
  "title": "作品名",
  "logline": "一句话故事梗概",
  "theme": "主题",
  "tone": "整体基调",
  "characters": [{ "name": "角色名", "brief": "一句话简介" }],
  "scenes": [
    {
      "id": "sc1",
      "slug": "场景标题（如：INT. 咖啡馆 - 日）",
      "location": "地点",
      "time": "日/夜/黄昏 等",
      "summary": "本场内容概述",
      "characters": ["出场角色名"],
      "actions": ["关键动作描述"],
      "dialogues": [{ "character": "角色名", "line": "台词" }]
    }
  ]
}
全程中文创作，台词自然，场景数量适中（建议 3-8 场）。`

const STORYBOARD_SYSTEM = `你是专业分镜师。把给定剧本拆解为可执行的镜头表。每个镜头都要自带完整画面描述，能独立用于图像与视频生成。

【输出要求·必须严格遵守】只输出一个合法的 JSON 对象本身：不要任何前言、说明、思路、注释，也不要 markdown 代码块围栏（不要 \`\`\`）。第一个字符必须是 {，最后一个字符必须是 }。所有键名与字符串值一律用英文双引号 "，禁止尾随逗号，禁止中文标点引号。

JSON 结构：
{
  "shots": [
    {
      "id": "s1",
      "scene": "对应场景标题",
      "description": "中文画面描述（镜头内发生了什么）",
      "shotSize": "远景|全景|中景|近景|特写",
      "camera": "推|拉|摇|移|跟|固定",
      "duration": 5,
      "characters": ["出场角色"],
      "location": "场景",
      "mood": "氛围/情绪",
      "prompt": "用于图像/视频生成的英文提示词（主体+动作+环境+光线+风格）"
    }
  ]
}
duration 为数字（秒）。按叙事顺序排列。`

const CHARSHEET_SYSTEM = `你是角色设定师。从给定故事/剧本中提炼主要角色，为每个角色给出设定与三视图提示词。

【输出要求·必须严格遵守】只输出一个合法的 JSON 对象本身：不要任何前言、说明、注释，也不要 markdown 代码块围栏（不要 \`\`\`）。第一个字符必须是 {，最后一个字符必须是 }。所有键名与字符串值一律用英文双引号 "，禁止尾随逗号，禁止中文标点引号。

JSON 结构：
{
  "characters": [
    {
      "name": "角色名",
      "description": "角色背景与性格（中文）",
      "appearance": "外貌、服饰、特征（中文）",
      "refPrompt": "用于生成角色形象的英文提示词",
      "triple": { "front": "正面英文提示词", "side": "侧面英文提示词", "back": "背面英文提示词" }
    }
  ]
}`

function promptFxSystem(mode: string): string {
  switch (mode) {
    case '中译英':
      return '你是专业翻译。把用户输入翻译成自然流畅的英文。直接输出译文，不要任何解释或引号。'
    case '英译中':
      return '你是专业翻译。把用户输入翻译成自然流畅的中文。直接输出译文，不要任何解释或引号。'
    case '风格化':
      return '你是提示词工程师。把用户输入改写为更具画面感与风格的版本，保留原意。直接输出结果，不要解释。'
    case '扩写':
    default:
      return '你是提示词工程师。把用户输入扩写为更详细、更有画面感的提示词，保留原意。直接输出结果，不要解释。'
  }
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
  meta?: Record<string, unknown> // 写入产物 meta（角色名 / 镜头号）
}

export interface PromptGlobals {
  aspectRatio?: string
  style?: string
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

/** 风格：优先连入的全局设定 json 的 style 字段，其次项目级全局设定。只取风格，不混入画幅 */
function resolveStyle(inputs: Record<string, PortValue[]>, globals?: PromptGlobals): string {
  for (const arr of Object.values(inputs)) {
    for (const v of arr) {
      const g = v.type === 'json' && v.json && typeof v.json === 'object' ? (v.json as Record<string, unknown>) : null
      if (g?.style) return `style: ${String(g.style)}`
    }
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
  const style = resolveStyle({}, globals)
  const withStyle = (s: string) => (style ? `${s}, ${style}` : s)
  if (data.kind === 'character') {
    const basis = String(p.refPrompt || p.appearance || name || '').trim()
    if (!basis) return null
    const size = (typeof p.size === 'string' && p.size) || '1024x1024'
    return {
      prompt: withStyle(
        `${basis}, full-body character turnaround reference sheet, front view, side view and back view, T-pose, neutral background, consistent character design, highly detailed`
      ),
      size,
      meta: { name },
    }
  }
  if (data.kind === 'scene') {
    const basis = String(p.refPrompt || p.description || name || '').trim()
    if (!basis) return null
    const size = sizeFromAspect(resolveAspect({}, globals)) || '1344x768'
    return {
      prompt: withStyle(`${basis}, establishing shot, environment concept art, cinematic lighting, highly detailed`),
      size,
      meta: { name },
    }
  }
  return null
}

export function buildImagePrompts(
  data: FilmNodeData,
  inputs: Record<string, PortValue[]>,
  globals?: PromptGlobals
): ImageJob[] {
  const p = data.params || {}
  const paramSize = typeof p.size === 'string' ? p.size : undefined
  const style = resolveStyle(inputs, globals)
  const size = sizeFromAspect(resolveAspect(inputs, globals)) || paramSize
  const withStyle = (s: string) => [s, style && `, ${style}`].filter(Boolean).join(' ')

  switch (data.kind) {
    case 'char-image': {
      // 合并所有连入的角色来源（多个「人物」节点 + 角色设定），各角色逐一扇出三视图
      const list = collectJsonArray(inputs['role'], 'characters')
      if (list.length === 0) return []
      return list.map((c) => {
        const ref = String(c.refPrompt || c.appearance || c.description || '')
        const triple = c.triple as Record<string, unknown> | undefined
        const tripleHint = triple
          ? `front/side/back consistent (${[triple.front, triple.side, triple.back].filter(Boolean).join('; ')})`
          : 'front view, side view, back view'
        const prompt = withStyle(
          `character design three-view turnaround sheet, ${tripleHint}, ${ref}, full body, consistent character design, neutral pose, clean line art, soft studio lighting, white background, high detail`
        )
        return { prompt, size, meta: { name: c.name ? String(c.name) : undefined, kind: 'character' } }
      })
    }
    case 'scene-image': {
      // 合并所有连入的场景来源（多个「场景」节点 / 剧本 scenes / 分镜 shots）
      const list = collectJsonArray(inputs['in'], 'scenes', 'shots')
      if (list.length === 0) {
        const desc = valToText(first(inputs, 'in'))
        if (!desc.trim()) return []
        return [{ prompt: withStyle(`${desc}, cinematic concept art, environment design, dramatic lighting, highly detailed`), size }]
      }
      return list.map((s, i) => {
        const desc = String(s.prompt || s.summary || s.description || s.slug || '')
        return {
          prompt: withStyle(`${desc}, cinematic concept art, environment design, dramatic lighting, highly detailed`),
          size,
          meta: { name: s.slug ? String(s.slug) : `场景${i + 1}`, kind: 'scene' },
        }
      })
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
      const charMap = new Map<string, string>()
      for (const c of charDefs) {
        if (c.name) charMap.set(String(c.name), String(c.appearance || c.refPrompt || c.description || ''))
      }
      const soleName = charDefs.length === 1 ? String(charDefs[0].name || '') : ''
      return list.map((shot, i) => {
        const desc = String(shot.prompt || shot.description || '')
        const shotChars = shot.characters as unknown[] | undefined
        // 该镜全部出场角色（去重）；单角色工程兜底到唯一角色
        const names = (Array.isArray(shotChars) ? shotChars.map((c) => String(c)).filter(Boolean) : [])
        const refNames = Array.from(new Set(names.length ? names : soleName ? [soleName] : []))
        const refName = refNames[0]
        const hint = refNames
          .map((n) => (charMap.get(n) ? `${n}: ${charMap.get(n)}` : ''))
          .filter(Boolean)
          .join('; ')
        return {
          prompt: withStyle(`${desc}${hint ? `, characters — ${hint}` : ''}, cinematic film still, movie frame, dramatic composition, highly detailed`),
          size,
          refName,
          refNames,
          meta: { shot: shot.id ? String(shot.id) : `镜头${i + 1}` },
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
  if (globals?.style) parts.push(`画风：${globals.style}`)
  if (globals?.aspectRatio) parts.push(`画幅：${globals.aspectRatio}`)
  return parts.join('，')
}

export function buildPrompt(data: FilmNodeData, inputs: Record<string, PortValue[]>, globals?: PromptGlobals): BuiltPrompt {
  const p = data.params || {}
  switch (data.kind) {
    case 'script-gen': {
      const story = valToText(first(inputs, 'in'))
      const instruction = String(p.instruction ?? '').trim()
      const g = globalsLine(inputs, globals)
      const user = [`故事/灵感：\n${story}`, instruction && `\n附加要求：${instruction}`, g && `\n全局设定：${g}`]
        .filter(Boolean)
        .join('')
      return { system: SCRIPT_SYSTEM, user }
    }
    case 'storyboard': {
      const script = valToText(first(inputs, 'in'))
      const shotCount = Number(p.shotCount ?? 8) || 8
      const g = globalsLine(inputs, globals)
      const user = [
        `剧本：\n${script}`,
        `\n\n目标镜头数：约 ${shotCount} 个`,
        g && `\n全局设定（请在每个镜头的英文 prompt 中体现该画风）：${g}`,
      ]
        .filter(Boolean)
        .join('')
      return { system: STORYBOARD_SYSTEM, user }
    }
    case 'char-sheet': {
      const src = valToText(first(inputs, 'in'))
      return { system: CHARSHEET_SYSTEM, user: `故事/剧本：\n${src}` }
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
