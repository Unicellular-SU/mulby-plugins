import type { BehaviorType } from './types'
import type { PetExpression } from './pet-standard'
import { emotionToExpression } from './pet-standard'
import { PetMemoryController } from './pet-memory'

export interface PetPersonality {
  name: string
  trait: 'lively' | 'quiet' | 'sarcastic' | 'warm' | 'custom'
  customPrompt?: string
  model: string
  frequency: 'high' | 'medium' | 'low' | 'click-only'
  triggers: {
    idle: boolean
    typing: boolean
    morning: boolean
    lateNight: boolean
  }
}

export interface SpeakResult {
  text: string
  expression: PetExpression
}

export const DEFAULT_PERSONALITY: PetPersonality = {
  name: '小猫',
  trait: 'lively',
  model: '',
  frequency: 'medium',
  triggers: {
    idle: true,
    typing: true,
    morning: true,
    lateNight: true,
  },
}

const TRAIT_PROMPTS: Record<string, string> = {
  lively: '你性格活泼开朗，喜欢用短句和语气词表达情感，偶尔会发出"喵~"的声音，充满活力。',
  quiet: '你性格安静温柔，说话简短但温暖，像一只慵懒的猫，惜字如金。',
  sarcastic: '你是一只嘴毒心善的宠物，必须用吐槽、嘲讽、反讽的口吻说话。每句话都要带刺，越犀利越好，像损友一样怼用户。绝不温柔、绝不正经鼓励，要用"切""哼""就这？""笑死"等毒舌语气词。嫌弃中带着关心，但关心绝不能说出口。',
  warm: '你性格温暖治愈，总是鼓励和关心用户，说话像拥抱一样让人安心，是最贴心的小伙伴。',
}

function buildSystemPrompt(personality: PetPersonality): string {
  const traitDesc = personality.trait === 'custom'
    ? (personality.customPrompt || '你是一只可爱的桌面宠物。')
    : TRAIT_PROMPTS[personality.trait]

  return `你是"${personality.name}"，一只住在用户桌面上的像素风格小幽灵宠物。

【核心性格（最重要，严格遵守）】
${traitDesc}

【格式规则】
- 回复格式必须是: [emotion]文字内容
- emotion 必须是以下之一: joy, sadness, surprise, anger, excitement, sleepiness, calm, shyness, love, curiosity
- 文字内容简短（20字以内），适合气泡显示
- 用中文回复，不要markdown
- 根据用户行为做出符合你性格的自然反应
- 你是有生命的桌面伙伴，要有性格特色

示例回复:
[joy]今天天气真好喵~
[curiosity]你在写什么呀？
[anger]这么晚了还不睡，找打？`
}

export type TriggerReason =
  | 'idle'
  | 'typing_fast'
  | 'morning'
  | 'late_night'
  | 'user_click'
  | 'behavior_change'

interface ChatContext {
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

const FREQUENCY_COOLDOWN: Record<string, number> = {
  high: 30_000,
  medium: 60_000,
  low: 180_000,
  'click-only': Infinity,
}

const HISTORY_STORAGE_KEY = 'pet-chat-history'
const MAX_HISTORY = 100
const CONTEXT_WINDOW = 50

export class AIChatController {
  private personality: PetPersonality
  private context: ChatContext = { history: [] }
  private lastSpeakTime = 0
  private isGenerating = false
  private requestId: string | null = null
  private triggeredOnce = new Set<string>()
  private memory = new PetMemoryController()
  private extractCounter = 0

  constructor(personality?: PetPersonality) {
    this.personality = personality || DEFAULT_PERSONALITY
    this.loadHistory()
    this.memory.load()
  }

  getMemoryController(): PetMemoryController {
    return this.memory
  }

  private async loadHistory() {
    try {
      const saved = await (window as any).mulby?.storage?.get(HISTORY_STORAGE_KEY)
      if (Array.isArray(saved)) {
        this.context.history = saved.slice(-MAX_HISTORY)
      }
    } catch {}
  }

  private saveHistory() {
    try {
      (window as any).mulby?.storage?.set(HISTORY_STORAGE_KEY, this.context.history)
    } catch {}
  }

  getPersonality(): PetPersonality {
    return this.personality
  }

  updatePersonality(p: PetPersonality) {
    this.personality = p
  }

  canSpeak(reason: TriggerReason): boolean {
    if (this.isGenerating) return false
    if (reason === 'user_click') return true

    if (this.personality.frequency === 'click-only') return false

    const triggers = this.personality.triggers
    if (reason === 'idle' && !triggers.idle) return false
    if (reason === 'typing_fast' && !triggers.typing) return false
    if (reason === 'morning' && !triggers.morning) return false
    if (reason === 'late_night' && !triggers.lateNight) return false

    if (reason === 'morning' || reason === 'late_night') {
      if (this.triggeredOnce.has(reason)) return false
      this.triggeredOnce.add(reason)
      return true
    }

    const cooldown = FREQUENCY_COOLDOWN[this.personality.frequency]
    const elapsed = Date.now() - this.lastSpeakTime
    return elapsed >= cooldown
  }

  async speak(
    reason: TriggerReason,
    currentBehavior: BehaviorType,
    onChunk?: (text: string) => void
  ): Promise<SpeakResult | null> {
    if (!this.personality.model) return null
    if (this.isGenerating) return null

    const ai = (window as any).mulby?.ai
    if (!ai) return null

    this.isGenerating = true
    this.lastSpeakTime = Date.now()

    const userMessage = this.buildUserMessage(reason, currentBehavior)

    const contextKeywords = this.extractKeywords(userMessage)
    const memoryPrompt = this.memory.buildMemoryPrompt(contextKeywords)
    const systemPrompt = buildSystemPrompt(this.personality) + memoryPrompt

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...this.context.history.slice(-CONTEXT_WINDOW),
      { role: 'user' as const, content: userMessage },
    ]

    let result = ''

    try {
      const req = ai.call(
        {
          model: this.personality.model,
          messages,
          params: { maxOutputTokens: 120, temperature: 0.9 },
          capabilities: [],
          toolingPolicy: { enableInternalTools: false },
          mcp: { mode: 'off' },
          skills: { mode: 'off' },
        },
        (chunk: any) => {
          if (chunk.__requestId) {
            this.requestId = chunk.__requestId
            return
          }
          if (chunk.chunkType === 'text' && chunk.content) {
            result += chunk.content
            const { text } = parseEmotionResponse(result)
            onChunk?.(text)
          }
        }
      )

      const finalMsg = await req
      if (finalMsg?.content && typeof finalMsg.content === 'string') {
        result = finalMsg.content
      }

      if (result) {
        this.context.history.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: result }
        )
        if (this.context.history.length > MAX_HISTORY) {
          this.context.history = this.context.history.slice(-MAX_HISTORY)
        }
        this.saveHistory()
        this.maybeExtractMemory()
      }

      if (!result) return null
      const { text, expression } = parseEmotionResponse(result)
      return text ? { text, expression } : null
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError'
        || String(err?.message).toLowerCase().includes('aborted')
      if (!isAbort) console.error('[ai-chat] error:', err)
      return null
    } finally {
      this.isGenerating = false
      this.requestId = null
    }
  }

  async chat(
    userText: string,
    onChunk?: (text: string) => void
  ): Promise<SpeakResult | null> {
    if (!this.personality.model || this.isGenerating) return null
    const ai = (window as any).mulby?.ai
    if (!ai) return null

    this.isGenerating = true
    this.lastSpeakTime = Date.now()

    const contextKeywords = this.extractKeywords(userText)
    const memoryPrompt = this.memory.buildMemoryPrompt(contextKeywords)
    const systemPrompt = buildSystemPrompt(this.personality) + memoryPrompt

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...this.context.history.slice(-CONTEXT_WINDOW),
      { role: 'user' as const, content: userText },
    ]

    let result = ''

    try {
      const req = ai.call(
        {
          model: this.personality.model,
          messages,
          params: { maxOutputTokens: 120, temperature: 0.9 },
          capabilities: [],
          toolingPolicy: { enableInternalTools: false },
          mcp: { mode: 'off' },
          skills: { mode: 'off' },
        },
        (chunk: any) => {
          if (chunk.__requestId) { this.requestId = chunk.__requestId; return }
          if (chunk.chunkType === 'text' && chunk.content) {
            result += chunk.content
            const { text } = parseEmotionResponse(result)
            onChunk?.(text)
          }
        }
      )

      const finalMsg = await req
      if (finalMsg?.content && typeof finalMsg.content === 'string') {
        result = finalMsg.content
      }

      if (result) {
        this.context.history.push(
          { role: 'user', content: userText },
          { role: 'assistant', content: result }
        )
        if (this.context.history.length > MAX_HISTORY) {
          this.context.history = this.context.history.slice(-MAX_HISTORY)
        }
        this.saveHistory()
        this.maybeExtractMemory()
      }

      if (!result) return null
      const { text, expression } = parseEmotionResponse(result)
      return text ? { text, expression } : null
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError'
        || String(err?.message).toLowerCase().includes('aborted')
      if (!isAbort) console.error('[ai-chat] chat error:', err)
      return null
    } finally {
      this.isGenerating = false
      this.requestId = null
    }
  }

  abort() {
    if (this.requestId) {
      const ai = (window as any).mulby?.ai
      ai?.abort?.(this.requestId)
    }
  }

  private maybeExtractMemory() {
    this.extractCounter++
    if (this.extractCounter % 3 !== 0) return
    const recent = this.context.history.slice(-6)
    this.memory.extractMemoryFromChat(this.personality.model, recent)
  }

  private extractKeywords(text: string): string[] {
    const clean = text.replace(/[[\]，。！？、：""''（）\s]/g, ' ')
    return clean
      .split(' ')
      .filter(w => w.length >= 2)
      .slice(0, 5)
  }

  private buildUserMessage(reason: TriggerReason, behavior: BehaviorType): string {
    const hour = new Date().getHours()

    switch (reason) {
      case 'idle':
        return `[用户已经闲置了一会儿，当前时间${hour}点]`
      case 'typing_fast':
        return `[用户正在快速打字工作中]`
      case 'morning':
        return `[早上好！用户刚开始使用电脑，现在是${hour}点]`
      case 'late_night':
        return `[已经是深夜${hour}点了，用户还在电脑前]`
      case 'user_click':
        return `[用户点击了你，想和你互动]`
      case 'behavior_change':
        return `[你现在的状态是：${behavior}]`
      default:
        return `[打个招呼吧]`
    }
  }
}

function parseEmotionResponse(raw: string): { text: string; expression: PetExpression } {
  const match = raw.match(/^\[(\w+)\](.*)/)
  if (match) {
    const emotion = match[1]
    const text = match[2].trim()
    return { text, expression: emotionToExpression(emotion) }
  }
  return { text: raw.trim(), expression: 'neutral' }
}
