/**
 * 文本节点的角色化 System Prompt 与输入组装。
 * 约定：自然语言简述 + ```json 代码块，前端用 jsonParse 解析。
 */
import type { PortValue, FilmNodeData } from '../store/graphStore'
import { getPrompt } from '../store/promptStore'
import { JSON_CONTRACT, fillTemplate } from './promptTemplates'

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
      prompt: withStyle(fillTemplate(getPrompt('image.assetCharacter'), { basis })),
      size,
      meta: { name },
    }
  }
  if (data.kind === 'scene') {
    const basis = String(p.refPrompt || p.description || name || '').trim()
    if (!basis) return null
    const size = sizeFromAspect(resolveAspect({}, globals)) || '1344x768'
    return {
      prompt: withStyle(fillTemplate(getPrompt('image.assetScene'), { basis })),
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
        const prompt = withStyle(fillTemplate(getPrompt('image.charImage'), { hint: tripleHint, ref }))
        return { prompt, size, meta: { name: c.name ? String(c.name) : undefined, kind: 'character' } }
      })
    }
    case 'scene-image': {
      // 合并所有连入的场景来源（多个「场景」节点 / 剧本 scenes / 分镜 shots）
      const list = collectJsonArray(inputs['in'], 'scenes', 'shots')
      if (list.length === 0) {
        const desc = valToText(first(inputs, 'in'))
        if (!desc.trim()) return []
        return [{ prompt: withStyle(fillTemplate(getPrompt('image.sceneImage'), { desc })), size }]
      }
      return list.map((s, i) => {
        const desc = String(s.prompt || s.summary || s.description || s.slug || '')
        return {
          prompt: withStyle(fillTemplate(getPrompt('image.sceneImage'), { desc })),
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
          prompt: withStyle(
            fillTemplate(getPrompt('image.keyframe'), { desc, chars: hint ? `, characters — ${hint}` : '' })
          ),
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
      return { system: jsonSystem('text.script'), user }
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
