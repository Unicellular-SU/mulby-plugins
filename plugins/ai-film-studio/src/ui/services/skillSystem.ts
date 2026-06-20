/**
 * Skill 系统（Toonflow 式重构 · 阶段1）：按「画风」组织的提示词知识库。
 *
 * 目录约定（src/ui/skills/）：
 *   art_skills/<styleId>/prefix.md                      该画风全局美学基线（色盘/光影/硬约束/严禁项…）
 *   art_skills/<styleId>/director_skills/<kind>.md       导演技法（分镜规划/分镜表/分镜）
 *   art_skills/<styleId>/art_prompt/<kind>.md            美术提示词（人物/场景/物品/分镜视频）
 *   art_skills/<styleId>/art_prompt/<kind>_derivative.md 衍生版（同资产的变体/换装/状态）
 *   agent/<name>.md                                     Agent 系统提示词（后续阶段用）
 *
 * 每个 .md 带 frontmatter：name / description / metaData。运行时按需拼接 prefix + 对应技能。
 * 用户覆盖（在线编辑）后续接 kvStore；本阶段先用内置文件。
 */

// Vite 把所有技能 .md 作为原始字符串打包进产物（无需运行时读盘）
const RAW = import.meta.glob('../skills/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export type ArtAssetKind = 'character' | 'scene' | 'prop' | 'storyboard_video'
export type DirectorKind = 'planning_style' | 'storyboard' | 'storyboard_table_style'

import type { StylePack } from './stylePacks'

export interface SkillDoc {
  name: string
  description: string
  metaData?: string
  /** 全部 frontmatter 键值（含 anchor/videoTag/negative 等扩展字段） */
  fm: Record<string, string>
  body: string
  /** 规范化后的相对路径，如 art_skills/cinematic_realistic/prefix.md */
  rel: string
}

export interface ArtStyle {
  id: string
  label: string
  description: string
}

/** 解析 frontmatter（--- ... ---）+ 正文 */
function parseSkill(raw: string, rel: string): SkillDoc {
  const fm: Record<string, string> = {}
  let body = raw
  const m = /^﻿?---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw)
  if (m) {
    body = m[2]
    for (const line of m[1].split('\n')) {
      const kv = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
      if (!kv) continue
      fm[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return { name: fm.name || rel, description: fm.description || '', metaData: fm.metaData, fm, body: body.trim(), rel }
}

/** path → SkillDoc 注册表（key 为规范化相对路径） */
const REGISTRY: Map<string, SkillDoc> = (() => {
  const map = new Map<string, SkillDoc>()
  for (const [abs, raw] of Object.entries(RAW)) {
    const rel = abs.replace(/^.*\/skills\//, '') // 截到 skills/ 之后
    map.set(rel, parseSkill(raw, rel))
  }
  return map
})()

function get(rel: string): SkillDoc | undefined {
  return REGISTRY.get(rel)
}

/** 列出全部画风（来自 art_skills/<id>/prefix.md 的 frontmatter） */
export function listArtStyles(): ArtStyle[] {
  const out: ArtStyle[] = []
  for (const [rel, doc] of REGISTRY) {
    const m = /^art_skills\/([^/]+)\/prefix\.md$/.exec(rel)
    if (m) out.push({ id: m[1], label: doc.name || m[1], description: doc.description })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function hasArtStyle(styleId: string): boolean {
  return REGISTRY.has(`art_skills/${styleId}/prefix.md`)
}

/** 取某画风的全局美学基线（prefix） */
export function getPrefix(styleId: string): string {
  return get(`art_skills/${styleId}/prefix.md`)?.body ?? ''
}

/**
 * 拼接某画风、某资产类型的美术提示词技能：prefix + art_prompt/<kind>(_derivative)。
 * derivative=true 取衍生版（同资产的变体/换装/状态），缺衍生版则回退基础版。
 */
export function composeArtPrompt(styleId: string, kind: ArtAssetKind, opts?: { derivative?: boolean }): string {
  const prefix = getPrefix(styleId)
  const base = `art_skills/${styleId}/art_prompt/${kind}.md`
  const deriv = `art_skills/${styleId}/art_prompt/${kind}_derivative.md`
  const skill = (opts?.derivative ? get(deriv) : undefined)?.body ?? get(base)?.body ?? ''
  return [prefix, skill].filter(Boolean).join('\n\n---\n\n')
}

/** 拼接某画风的导演技法：prefix + director_skills/<kind> */
export function composeDirectorPrompt(styleId: string, kind: DirectorKind): string {
  const prefix = getPrefix(styleId)
  const skill = get(`art_skills/${styleId}/director_skills/director_${kind}.md`)?.body ?? ''
  return [prefix, skill].filter(Boolean).join('\n\n---\n\n')
}

/** 取 Agent 系统提示词（agent/<name>.md，后续阶段 Agent runtime 用） */
export function getAgentSkill(name: string): string {
  return get(`agent/${name}.md`)?.body ?? ''
}

/**
 * 把画风 Skill 桥接成现有的结构化 StylePack（阶段1b）：
 * 从 prefix.md frontmatter 的 anchor/anchorCharacter/anchorScene/anchorProp/videoTag/negative 抽取可直接追加的锚定词，
 * 喂给现有 resolveStyle/applyStylePack 确定性管线——画风即刻生效；完整 skill 正文留给阶段3 的 Agent。
 */
export function skillStylePacks(): StylePack[] {
  const out: StylePack[] = []
  for (const s of listArtStyles()) {
    const fm = get(`art_skills/${s.id}/prefix.md`)?.fm ?? {}
    const all = fm.anchor || ''
    if (!all) continue // 没声明 anchor 的画风不进确定性管线（仍可被 Agent 用完整正文）
    out.push({
      id: s.id,
      label: s.label,
      hint: s.description,
      anchors: {
        all,
        character: fm.anchorCharacter || undefined,
        scene: fm.anchorScene || undefined,
        prop: fm.anchorProp || undefined,
        consistency: fm.anchorConsistency || undefined,
      },
      negative: fm.negative || undefined,
      videoTag: fm.videoTag || undefined,
    })
  }
  return out
}

/** 调试/设置面板用：列出全部已加载技能 */
export function listSkills(): SkillDoc[] {
  return [...REGISTRY.values()]
}
