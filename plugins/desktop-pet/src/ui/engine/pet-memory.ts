/**
 * Pet memory system — persistent, searchable long-term memories.
 * Pinned memories are always injected into AI context.
 * Non-pinned memories are retrieved by relevance (tag matching + recency + importance).
 */

export interface PetMemory {
  id: string
  type: 'fact' | 'preference' | 'event' | 'habit'
  content: string
  createdAt: number
  importance: number
  lastUsedAt: number
  pinned: boolean
  tags: string[]
}

const STORAGE_KEY = 'pet-memories'
const MAX_PINNED = 10
const RETRIEVE_COUNT = 5

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function isRecent(m: PetMemory, days: number): boolean {
  return Date.now() - m.createdAt < days * 86_400_000
}

function tagMatchScore(memoryTags: string[], contextKeywords: string[]): number {
  if (!contextKeywords.length || !memoryTags.length) return 0
  let hits = 0
  for (const tag of memoryTags) {
    for (const kw of contextKeywords) {
      if (tag.includes(kw) || kw.includes(tag)) {
        hits++
        break
      }
    }
  }
  return hits
}

export class PetMemoryController {
  private memories: PetMemory[] = []
  private conversationCount = 0

  async load() {
    try {
      const saved = await (window as any).mulby?.storage?.get(STORAGE_KEY)
      if (Array.isArray(saved)) {
        this.memories = saved
      }
    } catch {}
  }

  private async save() {
    try {
      await (window as any).mulby?.storage?.set(STORAGE_KEY, this.memories)
    } catch {}
  }

  getAllMemories(): PetMemory[] {
    return [...this.memories]
  }

  getPinnedMemories(): PetMemory[] {
    return this.memories.filter(m => m.pinned)
  }

  retrieve(contextKeywords: string[]): PetMemory[] {
    const pinned = this.memories.filter(m => m.pinned).slice(0, MAX_PINNED)
    const candidates = this.memories.filter(m => !m.pinned)

    const scored = candidates.map(m => {
      let score = tagMatchScore(m.tags, contextKeywords) * 3
      if (isRecent(m, 7)) score += 1
      score += m.importance
      if (Date.now() - m.lastUsedAt < 86_400_000) score += 1
      return { ...m, _score: score }
    })

    scored.sort((a, b) => b._score - a._score)
    const retrieved = scored.slice(0, RETRIEVE_COUNT)

    retrieved.forEach(rm => {
      const orig = this.memories.find(m => m.id === rm.id)
      if (orig) orig.lastUsedAt = Date.now()
    })

    return [...pinned, ...retrieved]
  }

  buildMemoryPrompt(contextKeywords: string[]): string {
    const memories = this.retrieve(contextKeywords)
    if (memories.length === 0) return ''

    let prompt = '\n\n## 你对用户的记忆\n'
    const pinnedMems = memories.filter(m => m.pinned)
    const otherMems = memories.filter(m => !m.pinned)

    pinnedMems.forEach(m => { prompt += `[重要] ${m.content}\n` })
    otherMems.forEach(m => { prompt += `- ${m.content}\n` })
    prompt += '\n请在对话中自然体现你记得这些信息，但不要刻意提及每一条。'
    return prompt
  }

  addMemory(mem: Omit<PetMemory, 'id' | 'createdAt' | 'lastUsedAt'>) {
    const existing = this.memories.find(m =>
      m.content === mem.content || (m.type === mem.type && m.tags.join() === mem.tags.join())
    )
    if (existing) {
      existing.content = mem.content
      existing.importance = Math.max(existing.importance, mem.importance)
      existing.lastUsedAt = Date.now()
    } else {
      this.memories.push({
        ...mem,
        id: generateId(),
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      })
    }
    this.save()
  }

  removeMemory(id: string) {
    this.memories = this.memories.filter(m => m.id !== id)
    this.save()
  }

  togglePin(id: string) {
    const mem = this.memories.find(m => m.id === id)
    if (!mem) return
    if (!mem.pinned && this.getPinnedMemories().length >= MAX_PINNED) return
    mem.pinned = !mem.pinned
    this.save()
  }

  async extractMemoryFromChat(
    model: string,
    recentMessages: Array<{ role: string; content: string }>
  ) {
    this.conversationCount++

    if (recentMessages.length < 2) return

    const ai = (window as any).mulby?.ai
    if (!ai || !model) return

    const chatSummary = recentMessages
      .slice(-6)
      .map(m => `${m.role}: ${m.content}`)
      .join('\n')

    try {
      const resp = await ai.call({
        model,
        messages: [
          {
            role: 'system',
            content: `你是一个记忆提取器。分析以下对话，提取关于用户的1条有价值信息。
要求：
- 只提取用户相关的事实/偏好/习惯/重要事件
- 如果对话没有有价值信息，返回 null
- 返回格式必须是纯 JSON（不要markdown）：
  {"type":"fact|preference|event|habit","content":"简短描述","importance":1-5,"tags":["关键词1","关键词2"],"pinned":false}
- content 必须是第三人称描述用户的信息
- tags 是 2-4 个中文关键词
- importance: fact=4, preference=3, event=2, habit=3
- 只有非常核心的用户身份信息才 pinned=true`
          },
          { role: 'user', content: chatSummary },
        ],
        params: { maxOutputTokens: 150, temperature: 0.3 },
        capabilities: [],
        toolingPolicy: { enableInternalTools: false },
        mcp: { mode: 'off' },
        skills: { mode: 'off' },
      })

      if (!resp?.content) return
      const text = typeof resp.content === 'string' ? resp.content.trim() : ''
      if (!text || text === 'null') return

      const parsed = JSON.parse(text)
      if (parsed && parsed.type && parsed.content) {
        this.addMemory({
          type: parsed.type,
          content: parsed.content,
          importance: parsed.importance || 3,
          pinned: parsed.pinned || false,
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        })
      }
    } catch {}
  }
}
