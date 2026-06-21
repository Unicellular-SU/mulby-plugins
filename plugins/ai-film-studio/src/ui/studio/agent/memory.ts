/**
 * Toonflow 式重构 · 阶段9（§6.6）：轻量记忆 / RAG（无 ONNX 版）。
 *
 * Toonflow 用 ONNX 三级记忆（短期 + summary + 向量召回）。插件内简化为：
 * - 短期：注入最近 N 条对话；
 * - 摘要：累积超阈值时 LLM 压缩较早对话成一条 summary，长期留在上下文（省 token、长会话不丢主线）；
 * - 召回：关键词重叠召回较早消息（宿主无可用 embedding 时的降级，§6.6 待决策 R4）。
 * 隔离键复用 MemoryItem.agent 字段（不新增维度）。
 */
import { runText } from '../../services/textEngine'
import { useGraphStore } from '../../store/graphStore'
import { newId } from '../../domain/persistence'
import { kvGet, DEFAULT_MEMORY_CONFIG, STUDIO_KV, type MemoryConfig } from '../../domain/studioKv'
import type { ProjectDoc, MemoryItem } from '../../domain/types'

export async function getMemoryConfig(): Promise<MemoryConfig> {
  const c = await kvGet<Partial<MemoryConfig>>(STUDIO_KV.memoryConfig)
  return { ...DEFAULT_MEMORY_CONFIG, ...(c ?? {}) }
}

const tokenize = (s: string): string[] => (s || '').toLowerCase().match(/[一-龥]|[a-z0-9]+/g) ?? []
const isConv = (m: MemoryItem) => m.role === 'user' || m.role.startsWith('assistant')
const fmt = (m: MemoryItem) => `${m.role === 'user' ? '用户' : '你'}：${m.content}`

/** 召回上下文字符串：历史摘要 + 关键词相关历史 + 近期对话（同步、纯函数）。 */
export function recallContext(doc: ProjectDoc, query: string, cfg: MemoryConfig): string {
  const conv = doc.memory.filter(isConv)
  const summaries = doc.memory.filter((m) => m.role === 'summary')
  const shortTerm = conv.slice(-cfg.shortTermLimit)
  const shortIds = new Set(shortTerm.map((m) => m.id))
  const qtok = new Set(tokenize(query))
  const scored = conv
    .filter((m) => !shortIds.has(m.id) && !m.summarized)
    .map((m) => {
      let hit = 0
      for (const w of tokenize(m.content)) if (qtok.has(w)) hit++
      return { m, score: hit }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.ragLimit)
  const parts: string[] = []
  if (summaries.length) parts.push('## 历史摘要\n' + summaries.map((s) => s.content).join('\n'))
  if (scored.length) parts.push('## 相关历史\n' + scored.map((x) => fmt(x.m)).join('\n'))
  if (shortTerm.length) parts.push('## 近期对话\n' + shortTerm.map(fmt).join('\n'))
  return parts.join('\n\n')
}

/** 累积未摘要对话超阈值时，把较早部分压缩成一条 summary（标 summarized + 追加 summary 消息）。 */
export async function maybeSummarize(doc: ProjectDoc, applyMutation: (fn: (d: ProjectDoc) => void) => void, cfg: MemoryConfig): Promise<void> {
  const conv = doc.memory.filter((m) => isConv(m) && !m.summarized)
  if (conv.length < cfg.messagesPerSummary) return
  const toSummarize = conv.slice(0, conv.length - cfg.shortTermLimit)
  if (toSummarize.length < 4) return
  const model = useGraphStore.getState().selectedModel
  if (!model) return
  const text = toSummarize.map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`).join('\n')
  try {
    const { content } = await runText({
      model,
      system: `把下面的多轮对话压缩成不超过 ${cfg.summaryMaxLength} 字的要点摘要（保留关键决策/人物设定/剧情进度/未完成事项）。只输出摘要正文。`,
      user: text,
    })
    const ids = new Set(toSummarize.map((m) => m.id))
    applyMutation((d) => {
      for (const m of d.memory) if (ids.has(m.id)) m.summarized = true
      d.memory.push({ id: newId('m_'), agent: 'productionAgent', role: 'summary', content: content.trim(), createTime: Date.now(), summarized: true })
    })
  } catch {
    // 摘要失败忽略（不影响主流程）
  }
}
