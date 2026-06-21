/**
 * Toonflow 式重构 · 阶段4b：小说导入——把长文切成章节，供 Agent 长文改编（不丢信息）。
 * 优先按「第N章/回/卷 / Chapter N」标题切；无标题则按长度分段。
 */
export function splitNovelChapters(text: string): { title: string; text: string }[] {
  const t = text.replace(/\r\n/g, '\n').trim()
  if (!t) return []
  const re = /^[ \t]*(第[0-9一二三四五六七八九十百千零两]+[章回节卷篇]|Chapter\s+\d+|卷[0-9一二三四五六七八九十]+)\b.*$/gim
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
