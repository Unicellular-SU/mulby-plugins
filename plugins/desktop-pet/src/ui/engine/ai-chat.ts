import type { BehaviorType } from './types'

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
  lively: '你性格活泼开朗，喜欢用短句和语气词表达情感，偶尔会发出"喵~"的声音。',
  quiet: '你性格安静温柔，说话简短但温暖，像一只慵懒的猫。',
  sarcastic: '你性格毒舌但不恶意，喜欢吐槽但底色是关心，说话犀利但有趣。',
  warm: '你性格温暖治愈，总是鼓励和关心用户，像一个贴心的小伙伴。',
}

function buildSystemPrompt(personality: PetPersonality): string {
  const traitDesc = personality.trait === 'custom'
    ? (personality.customPrompt || '你是一只可爱的桌面宠物。')
    : TRAIT_PROMPTS[personality.trait]

  return `你是"${personality.name}"，一只住在用户桌面上的像素风格宠物。
${traitDesc}
规则：
- 回复必须简短（15字以内），适合显示在小气泡里
- 用中文回复
- 不要用markdown格式
- 根据用户的行为做出自然反应
- 表现得像一个有生命的桌面伙伴`
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

export class AIChatController {
  private personality: PetPersonality
  private context: ChatContext = { history: [] }
  private lastSpeakTime = 0
  private isGenerating = false
  private requestId: string | null = null

  constructor(personality?: PetPersonality) {
    this.personality = personality || DEFAULT_PERSONALITY
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

    const cooldown = FREQUENCY_COOLDOWN[this.personality.frequency]
    const elapsed = Date.now() - this.lastSpeakTime
    return elapsed >= cooldown
  }

  async speak(
    reason: TriggerReason,
    currentBehavior: BehaviorType,
    onChunk?: (text: string) => void
  ): Promise<string | null> {
    if (!this.personality.model) return null
    if (this.isGenerating) return null

    const ai = (window as any).mulby?.ai
    if (!ai) return null

    this.isGenerating = true
    this.lastSpeakTime = Date.now()

    const userMessage = this.buildUserMessage(reason, currentBehavior)

    const messages = [
      { role: 'system' as const, content: buildSystemPrompt(this.personality) },
      ...this.context.history.slice(-10),
      { role: 'user' as const, content: userMessage },
    ]

    let result = ''

    try {
      const req = ai.call(
        {
          model: this.personality.model,
          messages,
          params: { maxOutputTokens: 50, temperature: 0.9 },
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
            onChunk?.(result)
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
        if (this.context.history.length > 20) {
          this.context.history = this.context.history.slice(-20)
        }
      }

      return result || null
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

  abort() {
    if (this.requestId) {
      const ai = (window as any).mulby?.ai
      ai?.abort?.(this.requestId)
    }
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
