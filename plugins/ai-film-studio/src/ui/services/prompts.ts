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

const SCRIPT_SYSTEM = `你是资深编剧。根据用户提供的故事/灵感，创作一个结构完整的分场剧本。

要求：
1. 先用一两句话说明创作思路；
2. 然后输出严格的 JSON（用 \`\`\`json 代码块包裹），代码块内不要任何注释。

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

要求：
1. 先一句话说明拆解思路；
2. 然后输出严格 JSON（用 \`\`\`json 代码块包裹），代码块内不要任何注释。

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

只输出严格 JSON（用 \`\`\`json 代码块包裹），代码块内不要任何注释：
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

function asObj(v?: PortValue): Record<string, unknown> | null {
  if (v?.json && typeof v.json === 'object') return v.json as Record<string, unknown>
  return null
}

function styleHint(inputs: Record<string, PortValue[]>): string {
  const g = globalsHint(inputs)
  return g ? g.replace('画风：', 'style: ').replace('画幅：', 'aspect ') : ''
}

export function buildImagePrompt(
  data: FilmNodeData,
  inputs: Record<string, PortValue[]>
): BuiltImagePrompt {
  const p = data.params || {}
  const size = typeof p.size === 'string' ? p.size : undefined
  const style = styleHint(inputs)

  switch (data.kind) {
    case 'char-image': {
      const roleJson = asObj(first(inputs, 'role'))
      // char-sheet 输出 { characters: [...] }；取第一个角色
      const chars = roleJson?.characters as Array<Record<string, unknown>> | undefined
      const c = (chars && chars[0]) || roleJson || {}
      const ref = String(c.refPrompt || c.appearance || c.description || valToText(first(inputs, 'role')))
      const triple = c.triple as Record<string, unknown> | undefined
      const tripleHint = triple
        ? `front/side/back consistent (${[triple.front, triple.side, triple.back].filter(Boolean).join('; ')})`
        : 'front view, side view, back view'
      const prompt = [
        'character design three-view turnaround sheet,',
        tripleHint + ',',
        ref + ',',
        'full body, consistent character design, neutral pose, clean line art, soft studio lighting, white background, high detail',
        style && `, ${style}`,
      ]
        .filter(Boolean)
        .join(' ')
      return { prompt, size }
    }
    case 'scene-image': {
      const inJson = asObj(first(inputs, 'in'))
      let desc = ''
      if (inJson) {
        const shots = inJson.shots as Array<Record<string, unknown>> | undefined
        const scenes = inJson.scenes as Array<Record<string, unknown>> | undefined
        if (shots && shots[0]) desc = String(shots[0].prompt || shots[0].description || '')
        else if (scenes && scenes[0]) desc = String(scenes[0].summary || scenes[0].slug || '')
      }
      if (!desc) desc = valToText(first(inputs, 'in'))
      const prompt = [desc + ',', 'cinematic concept art, environment design, dramatic lighting, highly detailed', style && `, ${style}`]
        .filter(Boolean)
        .join(' ')
      return { prompt, size }
    }
    case 'keyframe': {
      const shotJson = asObj(first(inputs, 'shot'))
      const shots = shotJson?.shots as Array<Record<string, unknown>> | undefined
      const shot = (shots && shots[0]) || shotJson || {}
      const desc = String(shot.prompt || shot.description || valToText(first(inputs, 'shot')))
      const prompt = [desc + ',', 'cinematic film still, movie frame, dramatic composition, highly detailed', style && `, ${style}`]
        .filter(Boolean)
        .join(' ')
      return { prompt, size }
    }
    default:
      return { prompt: '', size }
  }
}

export function buildPrompt(data: FilmNodeData, inputs: Record<string, PortValue[]>): BuiltPrompt {
  const p = data.params || {}
  switch (data.kind) {
    case 'script-gen': {
      const story = valToText(first(inputs, 'in'))
      const instruction = String(p.instruction ?? '').trim()
      const user = [`故事/灵感：\n${story}`, instruction && `\n附加要求：${instruction}`]
        .filter(Boolean)
        .join('')
      return { system: SCRIPT_SYSTEM, user }
    }
    case 'storyboard': {
      const script = valToText(first(inputs, 'in'))
      const shotCount = Number(p.shotCount ?? 8) || 8
      const g = globalsHint(inputs)
      const user = [
        `剧本：\n${script}`,
        `\n\n目标镜头数：约 ${shotCount} 个`,
        g && `\n全局设定：${g}`,
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
