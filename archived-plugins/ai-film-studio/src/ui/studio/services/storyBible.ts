/**
 * 故事圣经：对整本原著只跑一次的全局人物/场景/道具提取。
 *
 * 为什么需要它：旧版 `buildContext` 每次子 Agent 调用都把原著正文截到 8000 字塞进 system。
 * 十万字的小说这样只能看到开头，后面的人物一律"新建"，于是同一个人在 E7 变成另一个资产
 * ——一致性问题的相当一部分其实是上下文问题，不是提示词问题。
 *
 * 改法（对齐 ArcReel 的「全局角色/线索提取」）：整本书分块扫一遍，产出一份小表；
 * 之后每集只带「这份表 + 本集章节」，单集上下文与小说总长度解耦。
 */
import { runText } from '../../services/textEngine'
import { mergeBiblePart } from '../../domain/storyBibleFormat'
import type { NovelChapter, StoryBible } from '../../domain/types'

export { formatStoryBible, mergeBiblePart, storyBibleIsStale } from '../../domain/storyBibleFormat'

/** 每块喂给模型的原著字数。取 12000 是因为要在"块内信息完整"和"块数不爆炸"之间折中 */
const CHUNK_CHARS = 12000

const SYSTEM = `你是小说改编的资料员。从给定原著片段中提取**会在改编中反复出现**的人物、场景和关键道具。
只输出一个 JSON 对象，不要任何额外文字或代码块围栏：
{"characters":[{"name":"姓名","aliases":["别称/称谓/绰号"],"desc":"外貌与身份特征，30字内"}],
 "locations":[{"name":"地点名","desc":"环境特征，30字内"}],
 "props":[{"name":"道具名","desc":"外观与作用，30字内"}],
 "worldRules":"时代背景/世界设定要点，80字内（可省略）"}
规则：
- 只收录跨章节复现或对剧情有实际作用的对象；一次性路人、泛指地点不要收。
- aliases 收全：原著里对同一个人的不同称呼（本名、小名、官职、外号）都要写进去，这是后续跨集复用同一资产的依据。
- desc 写可画出来的外部特征，不要写心理活动。
- 找不到就给空数组。`

const MERGE_SYSTEM = `你是资料员。下面是同一本小说不同片段提取出的多份人物/场景/道具表，可能有重复和别名分裂。
把它们合并成一份去重后的总表，只输出一个 JSON 对象（结构与输入一致，不要额外文字）：
{"characters":[{"name":"","aliases":[],"desc":""}],"locations":[{"name":"","desc":""}],"props":[{"name":"","desc":""}],"worldRules":""}
规则：
- 同一对象只保留一条：以最常用的称呼作 name，其余全部并入 aliases。
- desc 取信息最全的一份，必要时综合，仍限 30 字内。
- 按重要性排序，人物最多 30 个，场景最多 20 个，道具最多 20 个。`

export interface StoryBibleProgress {
  (done: number, total: number): void
}

function chunkChapters(chapters: NovelChapter[]): string[] {
  const chunks: string[] = []
  let buffer = ''
  for (const chapter of chapters) {
    const piece = `【${chapter.title}】\n${chapter.event?.trim() || chapter.text}`
    // 单章就超长时独立成块并截断，避免一块塞不下
    if (piece.length >= CHUNK_CHARS) {
      if (buffer) {
        chunks.push(buffer)
        buffer = ''
      }
      chunks.push(piece.slice(0, CHUNK_CHARS))
      continue
    }
    if (buffer.length + piece.length > CHUNK_CHARS) {
      chunks.push(buffer)
      buffer = piece
    } else buffer = buffer ? `${buffer}\n\n${piece}` : piece
  }
  if (buffer) chunks.push(buffer)
  return chunks
}

function parseJson(raw: string): Record<string, unknown> | null {
  let text = (raw || '').trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function cleanEntries(value: unknown, withAliases: boolean): { name: string; aliases?: string[]; desc: string }[] {
  if (!Array.isArray(value)) return []
  const out: { name: string; aliases?: string[]; desc: string }[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name) continue
    const desc = typeof record.desc === 'string' ? record.desc.trim() : ''
    const aliases = withAliases && Array.isArray(record.aliases)
      ? [...new Set(record.aliases.filter((alias): alias is string => typeof alias === 'string' && !!alias.trim()).map((alias) => alias.trim()))].filter((alias) => alias !== name)
      : undefined
    out.push({ name, ...(aliases?.length ? { aliases } : {}), desc })
  }
  return out
}

export interface StoryBibleDeps {
  model: string
  /** 注入便于自测；默认走宿主文本模型 */
  call?: (system: string, user: string) => Promise<string>
}

/**
 * 扫描全书产出故事圣经。分块提取 → 本地按名合并 → 块数 >1 时再让模型做一次别名归并。
 * 本地合并只能按完全同名去重，别名分裂（「阿箬」/「箬儿」）要靠模型那一步。
 */
export async function buildStoryBible(
  chapters: NovelChapter[],
  deps: StoryBibleDeps,
  onProgress?: StoryBibleProgress,
): Promise<StoryBible> {
  const call = deps.call ?? ((system: string, user: string) => runText({ model: deps.model, system, user, jsonMode: true }).then((r) => r.content))
  const chunks = chunkChapters(chapters)
  if (!chunks.length) {
    return { characters: [], locations: [], props: [], sourceChapterCount: 0, extractedAt: Date.now() }
  }

  let characters: StoryBible['characters'] = []
  let locations: StoryBible['locations'] = []
  let props: StoryBible['props'] = []
  const worldRules: string[] = []

  for (let i = 0; i < chunks.length; i += 1) {
    onProgress?.(i, chunks.length)
    const parsed = parseJson(await call(SYSTEM, chunks[i]))
    if (!parsed) continue
    characters = mergeBiblePart(characters, cleanEntries(parsed.characters, true))
    locations = mergeBiblePart(locations, cleanEntries(parsed.locations, false))
    props = mergeBiblePart(props, cleanEntries(parsed.props, false))
    if (typeof parsed.worldRules === 'string' && parsed.worldRules.trim()) worldRules.push(parsed.worldRules.trim())
  }
  onProgress?.(chunks.length, chunks.length)

  // 多块时做一次归并：本地按名去重抓不到别名分裂的同一个人
  if (chunks.length > 1 && (characters.length || locations.length || props.length)) {
    const merged = parseJson(await call(MERGE_SYSTEM, JSON.stringify({ characters, locations, props, worldRules }).slice(0, 24000)))
    if (merged) {
      const mc = cleanEntries(merged.characters, true)
      const ml = cleanEntries(merged.locations, false)
      const mp = cleanEntries(merged.props, false)
      if (mc.length) characters = mc
      if (ml.length) locations = ml
      if (mp.length) props = mp
      if (typeof merged.worldRules === 'string' && merged.worldRules.trim()) {
        return { characters, locations, props, worldRules: merged.worldRules.trim(), sourceChapterCount: chapters.length, extractedAt: Date.now() }
      }
    }
  }

  return {
    characters,
    locations,
    props,
    worldRules: worldRules[0],
    sourceChapterCount: chapters.length,
    extractedAt: Date.now(),
  }
}
