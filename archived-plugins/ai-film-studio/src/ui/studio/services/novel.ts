/**
 * Toonflow 式重构 · 阶段4b/4c：小说导入 + 章节事件提取。
 * 导入：把长文切成章节，供 Agent 长文改编（不丢信息）。
 * 事件：把每章压成「关键事件」要点，作为长文改编的压缩索引（省 token、装得下更多章）。
 */
import { runText } from '../../services/textEngine'
import { useGraphStore } from '../../store/graphStore'
import { evenEpisodeBreaks, normalizeEpisodeBreaks, type PlannedEpisodeBreak } from '../../domain/episodeBreaks'

export { evenEpisodeBreaks, normalizeEpisodeBreaks, type PlannedEpisodeBreak } from '../../domain/episodeBreaks'
export function splitNovelChapters(text: string): { title: string; text: string }[] {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (!t) return []
  // 注意：不能用 \b 结尾——CJK 字符不是 \w，章/回/卷 后无词边界，会导致中文标题全部匹配失败
  const re = /^[ \t]*(第[0-9一二三四五六七八九十百千零两]+[章回节卷篇]|Chapter\s+\d+|卷[0-9一二三四五六七八九十]+).*$/gim
  const heads: { idx: number; title: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(t)) !== null) {
    heads.push({ idx: m.index, title: m[0].trim().slice(0, 40) })
    if (m.index === re.lastIndex) re.lastIndex++ // 防零宽匹配死循环
  }
  if (heads.length >= 2) {
    return heads.map((h, i) => ({
      title: h.title,
      text: t.slice(h.idx, i + 1 < heads.length ? heads[i + 1].idx : t.length).trim(),
    }))
  }
  // 无可识别标题：按 ~2000 字分段
  const size = 2000
  const out: { title: string; text: string }[] = []
  for (let i = 0; i < t.length; i += size) out.push({ title: `第 ${out.length + 1} 段`, text: t.slice(i, i + size) })
  return out
}

const EVENT_SYSTEM =
  '你是小说改编助手。把给定章节提炼为「关键事件」要点：出场人物、地点、关键动作、情绪转折、重要道具。' +
  '中文，分条，简洁，保留改编成短剧所需的全部关键信息，不超过 200 字。直接输出要点，不要解释或标题。'

/** 提取某章关键事件（LLM 压缩，作为长文改编的索引） */
export async function extractEvents(chapterText: string): Promise<string> {
  const model = useGraphStore.getState().selectedModel
  if (!model) throw new Error('未配置文本模型（请在「设置」选择）')
  const r = await runText({ model, system: EVENT_SYSTEM, user: chapterText.slice(0, 6000) })
  return r.content.trim()
}

// —— 分集规划：按情节弧断点切，而不是按章节数硬平分 ——

const BREAK_SYSTEM = `你是短剧总编剧。下面是一本小说按章节顺序排列的事件摘要。
把它们切分成若干集，每集是一个**情节完整、有钩子结尾**的单元。
只输出一个 JSON 对象，不要任何额外文字或代码块围栏：
{"episodes":[{"title":"集标题(12字内)","summary":"本集主线一句话","chapters":[章节序号...]}]}
规则：
- chapters 用输入里给出的序号（从 1 开始），必须**连续且不重叠**，全部章节都要被分配到某一集。
- 断点选在情节弧收束处：一个悬念揭晓、一次决定做出、一个人物登场或退场、视点切换。不要在一场戏中间断开。
- 每集覆盖的章节数可以不同——情节密度高的章节可以独立成集，过场章节可以合并。
- 集标题来自本集的核心冲突，不要用"第X集"这种占位。`

export interface EpisodeBreakDeps {
  model: string
  call?: (system: string, user: string) => Promise<string>
}

/**
 * 让模型按情节弧提出分集断点。喂的是**章节事件摘要**而不是正文，所以长篇也只要一次调用。
 * `targetCount` 只是建议，模型可以按情节密度上下浮动。
 */
export async function planEpisodeBreaks(
  chapters: { title: string; event?: string; text: string }[],
  targetCount: number,
  deps: EpisodeBreakDeps,
): Promise<PlannedEpisodeBreak[]> {
  if (!chapters.length) return []
  const call = deps.call ?? ((system: string, user: string) => runText({ model: deps.model, system, user, jsonMode: true }).then((r) => r.content))
  const digest = chapters
    .map((chapter, index) => `${index + 1}. 【${chapter.title}】${(chapter.event?.trim() || chapter.text).slice(0, 220)}`)
    .join('\n')
    .slice(0, 24000)
  const user = `目标集数约 ${targetCount} 集（可按情节密度上下浮动 ±30%）。共 ${chapters.length} 章：\n${digest}`

  let raw = ''
  try {
    raw = await call(BREAK_SYSTEM, user)
  } catch {
    return evenEpisodeBreaks(chapters.length, targetCount)
  }
  let text = raw.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return evenEpisodeBreaks(chapters.length, targetCount)
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { episodes?: Array<{ title?: string; summary?: string; chapters?: number[] }> }
    const proposed = (parsed.episodes ?? []).map((episode) => ({
      title: typeof episode.title === 'string' ? episode.title : '',
      summary: typeof episode.summary === 'string' ? episode.summary : '',
      // 模型给的是 1-based
      chapterIndexes: Array.isArray(episode.chapters) ? episode.chapters.map((n) => Number(n) - 1) : [],
    }))
    const normalized = normalizeEpisodeBreaks(proposed, chapters.length)
    return normalized.length ? normalized : evenEpisodeBreaks(chapters.length, targetCount)
  } catch {
    return evenEpisodeBreaks(chapters.length, targetCount)
  }
}
