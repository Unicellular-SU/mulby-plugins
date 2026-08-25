/**
 * 故事圣经的纯逻辑（无宿主依赖，可单测）。
 * 调用模型做提取的那一层在 `studio/services/storyBible.ts`。
 */
import type { StoryBible } from './types'

export type BibleEntry = { name: string; aliases?: string[]; desc: string }

/** 按 name 去重合并；同名并 aliases，desc 取信息更全（更长）的一份 */
export function mergeBiblePart(target: BibleEntry[], incoming: BibleEntry[]): BibleEntry[] {
  const byName = new Map(target.map((item) => [item.name, { ...item }]))
  for (const item of incoming) {
    const existing = byName.get(item.name)
    if (!existing) {
      byName.set(item.name, { ...item })
      continue
    }
    const aliases = [...new Set([...(existing.aliases ?? []), ...(item.aliases ?? [])])]
    if (aliases.length) existing.aliases = aliases
    if (item.desc.length > existing.desc.length) existing.desc = item.desc
  }
  return [...byName.values()]
}

/** 故事圣经是否需要重跑（导入了新章节 / 还没跑过） */
export function storyBibleIsStale(bible: StoryBible | undefined, chapterCount: number): boolean {
  if (!bible) return chapterCount > 0
  return bible.sourceChapterCount < chapterCount
}

/**
 * 压成注入 system 的文本。这段取代旧版「把原著正文截到 8000 字粘进每次调用」——
 * 它的大小只与人物/场景/道具数量有关，与小说总长度无关。
 */
export function formatStoryBible(bible: StoryBible | undefined, limit = 3000): string {
  if (!bible || (!bible.characters.length && !bible.locations.length && !bible.props.length)) return ''
  const line = (item: BibleEntry) => `- ${item.name}${item.aliases?.length ? `（又称：${item.aliases.join('、')}）` : ''}：${item.desc}`
  const sections = [
    bible.worldRules ? `世界设定：${bible.worldRules}` : '',
    bible.characters.length ? `人物：\n${bible.characters.map(line).join('\n')}` : '',
    bible.locations.length ? `场景：\n${bible.locations.map(line).join('\n')}` : '',
    bible.props.length ? `关键道具：\n${bible.props.map(line).join('\n')}` : '',
  ].filter(Boolean)
  const text = `## 故事圣经（全书人物/场景/道具总表，资产命名与复用以此为准）\n${sections.join('\n')}`
  return text.length <= limit ? text : `${text.slice(0, limit - 3)}...`
}
