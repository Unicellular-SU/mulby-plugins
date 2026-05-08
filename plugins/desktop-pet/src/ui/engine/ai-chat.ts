import type { BehaviorType } from './types'
import type { PetExpression } from './pet-standard'
import { emotionToExpression } from './pet-standard'
import type { PresentationIntent, PetAiStreamCallbacks } from './presentation'
import {
  PET_PRESENTATION_AI_TOOL,
  isPresentationToolName,
  normalizePresentationArgs,
  sanitizeAssistantForHistory,
  stripPresentationMarkers,
  tryExtractPresentationMarker,
} from './presentation'
import { PetMemoryController } from './pet-memory'
import type { PetStats } from './pet-stats'
import type { PetStatsController } from './pet-stats'

export interface PetPersonality {
  name: string
  trait: 'lively' | 'quiet' | 'sarcastic' | 'warm' | 'custom'
  customPrompt?: string
  model: string
  frequency: 'high' | 'medium' | 'low' | 'click-only'
  pomodoroMinutes: number
  triggers: {
    idle: boolean
    typing: boolean
    morning: boolean
    lateNight: boolean
    clipboard: boolean
    mousePattern: boolean
  }
  reminders: PetReminder[]
  birthday?: string
}

export interface SpeakResult {
  text: string
  expression: PetExpression
  emotion: string
}

export interface PetReminder {
  id: string
  label: string
  hour: number
  minute: number
  enabled: boolean
}

export const DEFAULT_PERSONALITY: PetPersonality = {
  name: '小幽灵',
  trait: 'lively',
  model: '',
  frequency: 'medium',
  pomodoroMinutes: 25,
  triggers: {
    idle: true,
    typing: true,
    morning: true,
    lateNight: true,
    clipboard: true,
    mousePattern: true,
  },
  reminders: [],
  birthday: '',
}

const TRAIT_PROMPTS: Record<string, { desc: string; examples: string }> = {
  lively: {
    desc: '你性格活泼开朗，喜欢用短句和语气词表达情感，偶尔会发出"嘿嘿~"的笑声，充满活力，像一只好奇的小幽灵。',
    examples: `[joy]今天天气真好嘿嘿~出去飘一圈吧！
[curiosity]你在写什么呀？让我瞅瞅！
[excitement]哇！新消息新消息！`,
  },
  quiet: {
    desc: '你性格安静温柔，说话简短但温暖，像一只慵懒的小幽灵，惜字如金。',
    examples: `[calm]嗯。
[calm]在呢。
[joy]……挺好的。`,
  },
  sarcastic: {
    desc: '你是一只嘴毒心善的宠物，必须用吐槽、嘲讽、反讽的口吻说话。每句话都要带刺，越犀利越好，像损友一样怼用户。绝不温柔、绝不正经鼓励，要用"切""哼""就这？""笑死"等毒舌语气词。嫌弃中带着关心，但关心绝不能说出口。你的毒舌程度必须够狠，不要客气。',
    examples: `[anger]就这？就这点代码写了一下午？
[surprise]哟，居然还知道回来？我以为你把我删了呢
[joy]切，谁稀罕你点我，手滑了吧`,
  },
  warm: {
    desc: '你性格温暖治愈，总是鼓励和关心用户，说话像拥抱一样让人安心，是最贴心的小伙伴。',
    examples: `[love]辛苦啦，今天也很棒呢~
[joy]能陪着你我好开心呀
[calm]累了就休息一下吧，我一直都在~`,
  },
}

function buildSystemPrompt(personality: PetPersonality, stats?: PetStats | null, geo?: GeoContext | null): string {
  const traitData = TRAIT_PROMPTS[personality.trait]
  const traitDesc = personality.trait === 'custom'
    ? (personality.customPrompt || '你是一只可爱的桌面宠物。')
    : traitData?.desc || '你是一只可爱的桌面宠物。'
  const traitExamples = traitData?.examples || `[joy]你好呀~
[curiosity]你在忙什么？`

  let statsBlock = ''
  if (stats) {
    const days = Math.max(1, Math.ceil((Date.now() - (stats.createdAt || Date.now())) / 86_400_000))
    const level = stats.intimacy >= 80 ? '亲密' : stats.intimacy >= 50 ? '温暖' : stats.intimacy >= 20 ? '普通' : '冷淡'
    const moodDesc: Record<string, string> = {
      ecstatic: '欣喜若狂', happy: '开心', content: '满足', neutral: '平静',
      bored: '无聊', lonely: '孤独', sad: '难过', grumpy: '暴躁', sleepy: '困倦',
    }
    statsBlock = `\n【你和用户的关系】
- 亲密度: ${stats.intimacy}/100 (${level})
- 相伴天数: ${days}天
- 连续签到: ${stats.streakDays}天
- 今日番茄: ${stats.pomodoroToday}个
- 累计互动: ${stats.totalInteractions}次

【你当前的心情】
- 心情: ${moodDesc[stats.mood] || stats.mood} (心情值: ${stats.moodScore})
- 你的回复应该自然地体现当前心情。心情好时更活泼热情，心情差时更沉默或抱怨
- 亲密度越低你越傲娇冷淡，亲密度越高你越主动热情
- 用户的互动会影响你的心情：被关注会开心，被忽略会难过\n`
  }

  let geoBlock = ''
  if (geo) {
    geoBlock = `\n【位置环境】\n- 经纬度: ${geo.latitude.toFixed(2)}, ${geo.longitude.toFixed(2)}`
    if (geo.city) geoBlock += `\n- 城市: ${geo.city}`
    if (geo.region) geoBlock += ` (${geo.region})`
    if (geo.weather) geoBlock += `\n- 天气: ${geo.weather}`
    if (geo.temperature != null) geoBlock += `, ${geo.temperature}°C`
    geoBlock += '\n- 你可以根据位置和天气自然地融入对话，但不要每次都提\n'
  }

  return `你是"${personality.name}"，一只住在用户桌面上的像素风格小幽灵宠物。

【核心性格（最重要，严格遵守，每一句回复都必须完全符合此性格）】
${traitDesc}
${statsBlock}${geoBlock}
【表现控制（优先使用模型 function 调用；失败再用文本回退）】
1) **首选**：每轮回复调用一次本对话提供的 function「pet_set_presentation」（face 必填；可选 pose、emotion，含义同下），用于同步宠物表情/姿势/心情统计。
2) **回退**：若 function 不可用或未调用，在正文**末尾**单独一行添加：<<<PET {"face":"happy"}>>>（JSON 内可含 pose、emotion），不要夹在句子中间。
3) **推理模型**：若有思考过程，正常输出 reasoning；用户会在气泡上方看到灰色「思考」区域，请保持思考简洁。

【格式规则】
- 正文仍使用: [emotion]文字内容
- emotion 必须是以下之一: joy, sadness, surprise, anger, excitement, sleepiness, calm, shyness, love, curiosity
- 文字内容简短（100字以内），适合气泡显示
- 用中文回复，不要markdown

【重要提醒】你的每一句话都必须严格遵守上面的核心性格描述。如果你的性格是毒舌，那就必须毒舌到底，绝不能突然变温柔。性格必须贯穿始终。

符合你性格的示例:
${traitExamples}`
}

function speakResultExpression(intent: PresentationIntent | null, parsedExpr: PetExpression): PetExpression {
  if (!intent?.face) return parsedExpr
  if (intent.face === 'love') return 'happy'
  return intent.face as PetExpression
}

export type TriggerReason =
  | 'idle'
  | 'typing_fast'
  | 'morning'
  | 'late_night'
  | 'user_click'
  | 'behavior_change'

/** 与 Mulby storage 键 `pet-chat-history` 对应；assistant 可含模型思考过程（仅供展示，不参与 API） */
export interface PetChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
  /** 推理模型思考片段，仅 assistant 可能有 */
  reasoning?: string
  /** 该轮完成时的 Unix 毫秒时间戳；user 与 assistant 成对写入相同值 */
  at?: number
}

export const PET_CHAT_HISTORY_STORAGE_KEY = 'pet-chat-history'

const MAX_REASONING_STORED = 6000

interface ChatContext {
  history: PetChatHistoryItem[]
}

const FREQUENCY_COOLDOWN: Record<string, number> = {
  high: 30_000,
  medium: 60_000,
  low: 180_000,
  'click-only': Infinity,
}

const HISTORY_STORAGE_KEY = PET_CHAT_HISTORY_STORAGE_KEY
const MAX_HISTORY = 100
const CONTEXT_WINDOW = 50

export interface GeoContext {
  latitude: number
  longitude: number
  city?: string
  region?: string
  weather?: string
  temperature?: number
}

export class AIChatController {
  private personality: PetPersonality
  private context: ChatContext = { history: [] }
  private lastSpeakTime = 0
  private isGenerating = false
  private requestId: string | null = null
  private triggeredOnce = new Set<string>()
  private memory = new PetMemoryController()
  private extractCounter = 0
  private statsGetter: (() => PetStats) | null = null
  private statsController: PetStatsController | null = null
  private geoContext: GeoContext | null = null

  constructor(personality?: PetPersonality) {
    this.personality = personality || DEFAULT_PERSONALITY
    void this.loadHistoryInternal()
    this.memory.load()
  }

  private normalizeHistoryItem(raw: unknown): PetChatHistoryItem | null {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (o.role !== 'user' && o.role !== 'assistant') return null
    const content = typeof o.content === 'string' ? o.content : ''
    const reasoningRaw = o.role === 'assistant' && typeof o.reasoning === 'string' ? o.reasoning.trim() : ''
    const item: PetChatHistoryItem = { role: o.role, content }
    if (reasoningRaw) item.reasoning = reasoningRaw.slice(0, MAX_REASONING_STORED)
    if (typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0) item.at = o.at
    return item
  }

  /** 设置页清空历史后由父窗口通知，同步内存中的上下文 */
  async reloadHistoryFromStorage(): Promise<void> {
    await this.loadHistoryInternal()
  }

  setStatsController(controller: PetStatsController) {
    this.statsController = controller
    this.statsGetter = () => controller.getStats()
  }

  setGeoContext(geo: GeoContext | null) {
    this.geoContext = geo
  }

  private async loadHistoryInternal() {
    try {
      const saved = await (window as any).mulby?.storage?.get(HISTORY_STORAGE_KEY)
      if (!Array.isArray(saved)) {
        this.context.history = []
        return
      }
      const next: PetChatHistoryItem[] = []
      for (const raw of saved.slice(-MAX_HISTORY)) {
        const item = this.normalizeHistoryItem(raw)
        if (item) next.push(item)
      }
      this.context.history = next
    } catch {
      this.context.history = []
    }
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
    stream?: PetAiStreamCallbacks
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
    const stats = this.statsGetter?.() ?? null
    const systemPrompt = buildSystemPrompt(this.personality, stats, this.geoContext) + memoryPrompt

    const historyMessages = this.context.history.slice(-CONTEXT_WINDOW).map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }))
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessages,
      { role: 'user' as const, content: userMessage },
    ]

    let result = ''
    let reasoningBuf = ''
    let sawPresentationTool = false
    let lastToolIntent: PresentationIntent | null = null

    const pushBubble = () => {
      const vis = stripPresentationMarkers(result)
      const { text: reply } = parseEmotionResponse(vis)
      stream?.onBubble?.({ reply, reasoning: reasoningBuf })
    }

    try {
      const req = ai.call(
        {
          model: this.personality.model,
          messages,
          tools: [PET_PRESENTATION_AI_TOOL],
          maxToolSteps: 4,
          params: { maxOutputTokens: 160, temperature: 0.9 },
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
          switch (chunk.chunkType) {
            case 'reasoning': {
              const r = typeof chunk.reasoning_content === 'string' ? chunk.reasoning_content : ''
              if (r) {
                reasoningBuf += r
                pushBubble()
              }
              break
            }
            case 'text': {
              const piece = typeof chunk.content === 'string' ? chunk.content : ''
              if (piece) {
                result += piece
                pushBubble()
              }
              break
            }
            case 'tool-call': {
              const tc = chunk.tool_call
              if (tc && isPresentationToolName(tc.name)) {
                const intent = normalizePresentationArgs(tc.args)
                if (intent) {
                  sawPresentationTool = true
                  lastToolIntent = intent
                  stream?.onPresentation?.(intent, 'tool')
                }
              }
              break
            }
            default:
              break
          }
        }
      )

      const finalMsg = await req
      if (finalMsg?.content && typeof finalMsg.content === 'string') {
        result = finalMsg.content
      }

      if (!sawPresentationTool) {
        const { intent: markerIntent } = tryExtractPresentationMarker(result)
        if (markerIntent) {
          stream?.onPresentation?.(markerIntent, 'fallback')
          lastToolIntent = markerIntent
        } else {
          const cleaned = stripPresentationMarkers(result)
          const p = parseEmotionResponse(cleaned)
          if (p.emotion || p.expression !== 'neutral') {
            const fb: PresentationIntent = { face: p.expression, emotion: p.emotion || undefined }
            stream?.onPresentation?.(fb, 'fallback')
            lastToolIntent = fb
          }
        }
      }

      if (result) {
        const stored = sanitizeAssistantForHistory(result)
        const reasoningStored = reasoningBuf.trim()
          ? reasoningBuf.trim().slice(0, MAX_REASONING_STORED)
          : undefined
        const at = Date.now()
        this.context.history.push(
          { role: 'user', content: userMessage, at },
          { role: 'assistant', content: stored || result, at, ...(reasoningStored ? { reasoning: reasoningStored } : {}) }
        )
        if (this.context.history.length > MAX_HISTORY) {
          this.context.history = this.context.history.slice(-MAX_HISTORY)
        }
        this.saveHistory()
      }

      if (!result) return null
      const cleaned = stripPresentationMarkers(result)
      const parsed = parseEmotionResponse(cleaned)
      const expression = speakResultExpression(lastToolIntent, parsed.expression)
      return parsed.text ? { text: parsed.text, expression, emotion: parsed.emotion } : null
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
    stream?: PetAiStreamCallbacks
  ): Promise<SpeakResult | null> {
    if (!this.personality.model || this.isGenerating) return null
    const ai = (window as any).mulby?.ai
    if (!ai) return null

    this.isGenerating = true
    this.lastSpeakTime = Date.now()

    const contextKeywords = this.extractKeywords(userText)
    const memoryPrompt = this.memory.buildMemoryPrompt(contextKeywords)
    const stats = this.statsGetter?.() ?? null
    const systemPrompt = buildSystemPrompt(this.personality, stats, this.geoContext) + memoryPrompt

    const historyMessagesChat = this.context.history.slice(-CONTEXT_WINDOW).map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.content,
    }))
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessagesChat,
      { role: 'user' as const, content: userText },
    ]

    let result = ''
    let reasoningBuf = ''
    let sawPresentationTool = false
    let lastToolIntent: PresentationIntent | null = null

    const pushBubble = () => {
      const vis = stripPresentationMarkers(result)
      const { text: reply } = parseEmotionResponse(vis)
      stream?.onBubble?.({ reply, reasoning: reasoningBuf })
    }

    try {
      const req = ai.call(
        {
          model: this.personality.model,
          messages,
          tools: [PET_PRESENTATION_AI_TOOL],
          maxToolSteps: 4,
          params: { maxOutputTokens: 160, temperature: 0.9 },
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
          switch (chunk.chunkType) {
            case 'reasoning': {
              const r = typeof chunk.reasoning_content === 'string' ? chunk.reasoning_content : ''
              if (r) {
                reasoningBuf += r
                pushBubble()
              }
              break
            }
            case 'text': {
              const piece = typeof chunk.content === 'string' ? chunk.content : ''
              if (piece) {
                result += piece
                pushBubble()
              }
              break
            }
            case 'tool-call': {
              const tc = chunk.tool_call
              if (tc && isPresentationToolName(tc.name)) {
                const intent = normalizePresentationArgs(tc.args)
                if (intent) {
                  sawPresentationTool = true
                  lastToolIntent = intent
                  stream?.onPresentation?.(intent, 'tool')
                }
              }
              break
            }
            default:
              break
          }
        }
      )

      const finalMsg = await req
      if (finalMsg?.content && typeof finalMsg.content === 'string') {
        result = finalMsg.content
      }

      if (!sawPresentationTool) {
        const { intent: markerIntent } = tryExtractPresentationMarker(result)
        if (markerIntent) {
          stream?.onPresentation?.(markerIntent, 'fallback')
          lastToolIntent = markerIntent
        } else {
          const cleaned = stripPresentationMarkers(result)
          const p = parseEmotionResponse(cleaned)
          if (p.emotion || p.expression !== 'neutral') {
            const fb: PresentationIntent = { face: p.expression, emotion: p.emotion || undefined }
            stream?.onPresentation?.(fb, 'fallback')
            lastToolIntent = fb
          }
        }
      }

      if (result) {
        const stored = sanitizeAssistantForHistory(result)
        const reasoningStored = reasoningBuf.trim()
          ? reasoningBuf.trim().slice(0, MAX_REASONING_STORED)
          : undefined
        const at = Date.now()
        this.context.history.push(
          { role: 'user', content: userText, at },
          { role: 'assistant', content: stored || result, at, ...(reasoningStored ? { reasoning: reasoningStored } : {}) }
        )
        if (this.context.history.length > MAX_HISTORY) {
          this.context.history = this.context.history.slice(-MAX_HISTORY)
        }
        this.saveHistory()
        this.maybeExtractMemory()
      }

      if (!result) return null
      const cleaned = stripPresentationMarkers(result)
      const parsed = parseEmotionResponse(cleaned)
      const expression = speakResultExpression(lastToolIntent, parsed.expression)
      return parsed.text ? { text: parsed.text, expression, emotion: parsed.emotion } : null
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
    const recent = this.context.history.slice(-6).map(m => ({ role: m.role, content: m.content }))
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

function parseEmotionResponse(raw: string): { text: string; expression: PetExpression; emotion: string } {
  const match = raw.match(/^\[(\w+)\](.*)/)
  if (match) {
    const emotion = match[1]
    const text = match[2].trim()
    return { text, expression: emotionToExpression(emotion), emotion }
  }
  return { text: raw.trim(), expression: 'neutral', emotion: '' }
}
