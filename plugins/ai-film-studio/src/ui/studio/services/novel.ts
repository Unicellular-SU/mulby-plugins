/**
 * Toonflow 式重构 · 阶段4b/4c：小说导入 + 章节事件提取。
 * 导入：把长文切成章节，供 Agent 长文改编（不丢信息）。
 * 事件：把每章压成「关键事件」要点，作为长文改编的压缩索引（省 token、装得下更多章）。
 */
import { runText } from '../../services/textEngine'
import { useGraphStore } from '../../store/graphStore'
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
