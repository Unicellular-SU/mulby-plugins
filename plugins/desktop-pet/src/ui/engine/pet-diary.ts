import { extractJsonObject } from './json-utils'
import { logPetPresentation } from './presentation-debug'

export interface DiaryEntry {
  date: string
  content: string
  mood: string
  highlights: string[]
  createdAt: number
}

const STORAGE_KEY = 'pet-diary'
const MAX_ENTRIES = 30
const DIARY_CONTENT_MAX = 600
const DIARY_HIGHLIGHT_MAX = 40

function normalizeDiaryEntry(raw: unknown): DiaryEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.date !== 'string' || typeof o.content !== 'string') return null
  const highlights = Array.isArray(o.highlights)
    ? (o.highlights as unknown[])
        .filter(h => typeof h === 'string' && (h as string).length <= DIARY_HIGHLIGHT_MAX)
        .slice(0, 6) as string[]
    : []
  return {
    date: o.date,
    content: o.content.slice(0, DIARY_CONTENT_MAX),
    mood: typeof o.mood === 'string' ? o.mood : 'neutral',
    highlights,
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : Date.now(),
  }
}

export class PetDiaryController {
  private entries: DiaryEntry[] = []

  async load() {
    try {
      const saved = await (window as any).mulby?.storage?.get(STORAGE_KEY)
      if (Array.isArray(saved)) {
        const normalized: DiaryEntry[] = []
        for (const item of saved) {
          const e = normalizeDiaryEntry(item)
          if (e) normalized.push(e)
        }
        this.entries = normalized
      }
    } catch (err) {
      logPetPresentation('diary.load.error', { message: (err as Error)?.message ?? String(err) })
    }
  }

  private async save() {
    try {
      await (window as any).mulby?.storage?.set(STORAGE_KEY, this.entries)
    } catch (err) {
      logPetPresentation('diary.save.error', { message: (err as Error)?.message ?? String(err) })
    }
  }

  getEntries(): DiaryEntry[] {
    return [...this.entries]
  }

  getEntry(date: string): DiaryEntry | undefined {
    return this.entries.find(e => e.date === date)
  }

  hasTodayEntry(): boolean {
    const today = new Date().toISOString().slice(0, 10)
    return this.entries.some(e => e.date === today)
  }

  async generateDiary(
    model: string,
    petName: string,
    stats: { intimacy: number; pomodoroToday: number; totalInteractions: number; mood: string; moodScore: number },
    recentChat: Array<{ role: string; content: string }>,
    recentEvents: string[] = [],
  ) {
    if (this.hasTodayEntry()) return null

    const ai = (window as any).mulby?.ai
    if (!ai || !model) return null

    const today = new Date().toISOString().slice(0, 10)
    const hour = new Date().getHours()
    if (hour < 20) return null

    const chatSummary = recentChat
      .slice(-10)
      .map(m => `${m.role === 'user' ? '主人' : petName}: ${m.content}`)
      .join('\n')
    const eventSummary = recentEvents.slice(-12).join('\n')

    try {
      const resp = await ai.call({
        model,
        messages: [
          {
            role: 'system',
            content: `你是${petName}，一只桌面小幽灵宠物。根据今天的互动数据，用第一人称写一篇可爱的日记（100-150字）。
要求：
- 用宠物的口吻和性格写
- 提及今天的具体事件
- 表达你的心情和感受
- 返回纯 JSON: {"content":"日记内容","highlights":["今日亮点1","亮点2"]}`
          },
          {
            role: 'user',
            content: `今日数据:
- 心情: ${stats.mood} (分值${stats.moodScore})
- 亲密度: ${stats.intimacy}
- 今日番茄钟: ${stats.pomodoroToday}个
- 累计互动: ${stats.totalInteractions}次
- 今日事件:
${eventSummary || '（今天没有特别事件）'}
- 今日对话:
${chatSummary || '（今天没有对话）'}`
          },
        ],
        params: { maxOutputTokens: 250, temperature: 0.8 },
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' },
      })

      if (!resp?.content) return null
      const text = typeof resp.content === 'string' ? resp.content.trim() : ''
      if (!text) return null

      const { data: parsed, reason } = extractJsonObject<{ content?: string; highlights?: unknown }>(text)
      if (!parsed) {
        logPetPresentation('diary.parse-failed', { reason, sample: text.slice(0, 120) })
        return null
      }
      const content = typeof parsed.content === 'string' ? parsed.content.trim() : ''
      if (!content) return null

      const highlights = Array.isArray(parsed.highlights)
        ? (parsed.highlights as unknown[])
            .filter(h => typeof h === 'string' && (h as string).length <= DIARY_HIGHLIGHT_MAX)
            .slice(0, 6) as string[]
        : []

      const entry: DiaryEntry = {
        date: today,
        content: content.slice(0, DIARY_CONTENT_MAX),
        mood: stats.mood,
        highlights,
        createdAt: Date.now(),
      }

      this.entries.push(entry)
      if (this.entries.length > MAX_ENTRIES) {
        this.entries = this.entries.slice(-MAX_ENTRIES)
      }
      await this.save()
      return entry
    } catch (err) {
      logPetPresentation('diary.generate.error', {
        message: (err as Error)?.message ?? String(err),
      })
      return null
    }
  }
}
