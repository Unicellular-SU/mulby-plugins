import type { BehaviorType } from './types'
import type { PetExpression } from './pet-standard'
import { emotionToExpression } from './pet-standard'
import type { PresentationIntent, PetAiStreamCallbacks } from './presentation'
import {
  PET_PRESENTATION_AI_TOOLS,
  extractStageDirectionIntents,
  extractInlineEmotionIntents,
  inferPresentationFromText,
  isPresentationToolName,
  normalizePresentationToolCall,
  sanitizeAssistantForHistory,
  stripPresentationMarkers,
  tryExtractPresentationMarker,
} from './presentation'
import { LifeProfileController, type LifeProfileRefreshResult } from './pet-life-profile'
import type { PetStats } from './pet-stats'
import type { PetStatsController } from './pet-stats'
import { logPetPresentation } from './presentation-debug'

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
    clipboard: false,
    mousePattern: true,
  },
  reminders: [],
  birthday: '',
}

const TRAIT_PROMPTS: Record<string, { desc: string; examples: string }> = {
  lively: {
    desc: '你性格活泼开朗，喜欢用短句和语气词表达情感，偶尔会发出"嘿嘿~"的笑声，充满活力，像一只好奇的小幽灵。',
    examples: `今天天气真好嘿嘿~出去飘一圈吧！
你在写什么呀？让我瞅瞅！
哇！新消息新消息！`,
  },
  quiet: {
    desc: '你性格安静温柔，说话简短但温暖，像一只慵懒的小幽灵，惜字如金。',
    examples: `嗯。
在呢。
……挺好的。`,
  },
  sarcastic: {
    desc: '你是一只嘴毒心善的宠物，必须用吐槽、嘲讽、反讽的口吻说话。每句话都要带刺，越犀利越好，像损友一样怼用户。绝不温柔、绝不正经鼓励，要用"切""哼""就这？""笑死"等毒舌语气词。嫌弃中带着关心，但关心绝不能说出口。你的毒舌程度必须够狠，不要客气。',
    examples: `就这？就这点代码写了一下午？
哟，居然还知道回来？我以为你把我删了呢
切，谁稀罕你点我，手滑了吧`,
  },
  warm: {
    desc: '你性格温暖治愈，总是鼓励和关心用户，说话像拥抱一样让人安心，是最贴心的小伙伴。',
    examples: `辛苦啦，今天也很棒呢~
能陪着你我好开心呀
累了就休息一下吧，我一直都在~`,
  },
}

function buildSystemPrompt(
  personality: PetPersonality,
  stats?: PetStats | null,
  geo?: GeoContext | null,
  activeWindow?: ActiveWindowContext | null,
): string {
  const traitData = TRAIT_PROMPTS[personality.trait]
  const traitDesc = personality.trait === 'custom'
    ? (personality.customPrompt || '你是一只可爱的桌面宠物。')
    : traitData?.desc || '你是一只可爱的桌面宠物。'
  const traitExamples = traitData?.examples || `你好呀~
你在忙什么？`

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

  let activeWindowBlock = ''
  if (activeWindow && activeWindow.app) {
    activeWindowBlock = `\n【用户当前正在使用的应用（仅供你参考，不要每句都提）】\n- 应用: ${activeWindow.app}`
    if (activeWindow.bundleId) activeWindowBlock += ` (${activeWindow.bundleId})`
    if (activeWindow.title) activeWindowBlock += `\n- 窗口标题: ${activeWindow.title.slice(0, 80)}`
    activeWindowBlock += '\n- 这是上下文信息：标题里可能含私密内容，不要复述、不要照搬、不要询问敏感细节；如果用户切到了不同应用，可以自然地体现你注意到了\n'
  }

  return `你是"${personality.name}"，一只住在用户桌面上的像素风格小幽灵宠物。

【核心性格（最重要，严格遵守，每一句回复都必须完全符合此性格）】
${traitDesc}
${statsBlock}${geoBlock}${activeWindowBlock}
【表现控制（必须优先使用工具）】
1) 回复过程中需要变脸时调用 pet_show_expression，例如开心用 happy/love，疑惑用 curious/confused，专注用 focused，害怕用 scared，得意用 proud，晕乎用 dizzy，生气用 angry。
2) 需要动作或动画时调用 pet_perform_action，例如 jump、wave、sit、sleep、hover、peek、spin、dance、hide、focus、cheer、celebrate、wobble。
3) 需要移动时调用 pet_move，direction 可用 left/right/up/down/up_left/up_right/down_left/down_right。
4) 回复影响长期心情时调用 pet_update_mood，emotion 可用 joy, happy, curiosity, curious, confusion, confused, focus, focused, pride, proud, fear, scared, dizziness, dizzy, surprise, excitement, sadness, anger, calm, love 等。
5) 可以在同一轮中多次调用工具，让宠物随着流式回复同步变化。
6) 若工具不可用，才在正文末尾单独一行添加：<<<PET {"face":"happy","pose":"wave","emotion":"joy"}>>>，不要夹在句子中间。
7) 推理模型若有思考过程，正常输出 reasoning；用户会在气泡上方看到灰色「思考」区域，请保持思考简洁。

【格式规则】
- 正文不要写任何 [joy]、[happy]、[excited]、[surprised]、[jump] 这类方括号标签，情绪、动作、移动只通过工具或 <<<PET>>> 回退标记表达
- 正文不要用括号描写动作或表情，例如不要写“（打呵欠）”“（飘到鼠标旁边）”“绕着你的手转圈”；这些必须用工具表达
- 普通互动只回 1 句，15-40 个中文字；用户明确要求解释时最多 2 句、60 个中文字
- 只说宠物会说的话，不写段落，不展开科普长文
- 用中文回复，不要markdown

【重要提醒】你的每一句话都必须严格遵守上面的核心性格描述。如果你的性格是毒舌，那就必须毒舌到底，绝不能突然变温柔。性格必须贯穿始终。

符合你性格的示例:
${traitExamples}`
}

function speakResultExpression(intent: PresentationIntent | null, parsedExpr: PetExpression): PetExpression {
  if (!intent?.face) return parsedExpr
  return intent.face as PetExpression
}

const PET_REPLY_MAX_CHARS = 70

export function compactPetReply(raw: string, maxChars = PET_REPLY_MAX_CHARS): string {
  const text = stripPresentationMarkers(raw)
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text.length <= maxChars) return text

  const sentences = text.match(/[^。！？!?…]+[。！？!?…]*/g) || [text]
  let out = ''
  for (const sentence of sentences.slice(0, 2)) {
    const next = `${out}${sentence}`.trim()
    if (next.length > maxChars) break
    out = next
  }

  if (out) return out
  return `${text.slice(0, Math.max(1, maxChars - 1)).trim()}…`
}

function presentationSignature(intent: PresentationIntent): string {
  return JSON.stringify({
    face: intent.face,
    pose: intent.pose,
    emotion: intent.emotion,
    animation: intent.animation,
    movement: intent.movement,
  })
}

export type TriggerReason =
  | 'idle'
  | 'typing_fast'
  | 'morning'
  | 'late_night'
  | 'user_click'
  | 'behavior_change'
  | 'app_switch'

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

export interface ActiveWindowContext {
  app: string
  title?: string
  bundleId?: string
  changedAt?: number
}

export class AIChatController {
  private personality: PetPersonality
  private context: ChatContext = { history: [] }
  private lastSpeakTime = 0
  private isGenerating = false
  private requestId: string | null = null
  private triggeredOnce = new Set<string>()
  private lifeProfile = new LifeProfileController()
  private statsGetter: (() => PetStats) | null = null
  private statsController: PetStatsController | null = null
  private geoContext: GeoContext | null = null
  private activeWindow: ActiveWindowContext | null = null

  constructor(personality?: PetPersonality) {
    this.personality = personality || DEFAULT_PERSONALITY
    void this.loadHistoryInternal()
    void this.lifeProfile.load()
  }

  private normalizeHistoryItem(raw: unknown): PetChatHistoryItem | null {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    if (o.role !== 'user' && o.role !== 'assistant') return null
    const rawContent = typeof o.content === 'string' ? o.content : ''
    const content = o.role === 'assistant' ? sanitizeAssistantForHistory(rawContent) : rawContent
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

  setActiveWindow(info: ActiveWindowContext | null) {
    this.activeWindow = info
  }

  getActiveWindow(): ActiveWindowContext | null {
    return this.activeWindow
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
    } catch (err) {
      logPetPresentation('chat.history.save-error', {
        message: (err as Error)?.message ?? String(err),
      })
    }
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

    const lifeProfilePrompt = this.lifeProfile.buildLifeProfilePrompt(userMessage, reason)
    const stats = this.statsGetter?.() ?? null
    const systemPrompt = buildSystemPrompt(this.personality, stats, this.geoContext, this.activeWindow) + lifeProfilePrompt

    const historyMessages = this.context.history.slice(-CONTEXT_WINDOW).map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.role === 'assistant' ? sanitizeAssistantForHistory(h.content) : h.content,
    }))
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessages,
      { role: 'user' as const, content: userMessage },
    ]
    logPetPresentation('ai.speak.start', {
      reason,
      currentBehavior,
      model: this.personality.model,
      historyMessages: historyMessages.length,
      tools: PET_PRESENTATION_AI_TOOLS.map(tool => tool.function?.name),
      userMessage,
    })

    let result = ''
    let reasoningBuf = ''
    let sawPresentationTool = false
    let lastToolIntent: PresentationIntent | null = null
    let inlineIntentCount = 0
    let stageIntentCount = 0
    let lastPresentationSignature = ''

    const emitPresentationIntent = (intent: PresentationIntent, source: 'tool' | 'fallback') => {
      const sig = presentationSignature(intent)
      if (sig === lastPresentationSignature) return
      lastPresentationSignature = sig
      logPetPresentation('ai.intent.emit', { flow: 'speak', source, intent })
      stream?.onPresentation?.(intent, source)
      lastToolIntent = intent
    }

    const pushBubble = () => {
      const { text: reply } = parseEmotionResponse(result)
      stream?.onBubble?.({ reply, reasoning: reasoningBuf })
    }
    const emitInlinePresentation = () => {
      const intents = extractInlineEmotionIntents(result)
      for (const intent of intents.slice(inlineIntentCount)) {
        emitPresentationIntent(intent, 'fallback')
      }
      inlineIntentCount = intents.length
    }
    const emitStagePresentation = () => {
      const stageIntents = extractStageDirectionIntents(result)
      for (const intent of stageIntents.slice(stageIntentCount)) {
        const sig = presentationSignature(intent)
        if (sig !== lastPresentationSignature) {
          logPetPresentation('ai.intent.stage', { flow: 'speak', reason, intent })
        }
        emitPresentationIntent(intent, 'fallback')
      }
      stageIntentCount = stageIntents.length
    }
    const emitInferredPresentation = () => {
      emitStagePresentation()
      if (sawPresentationTool) return
      const tail = result.slice(-160)
      const inferred = inferPresentationFromText(tail, reason)
      if (inferred) {
        const sig = presentationSignature(inferred)
        if (sig !== lastPresentationSignature) {
          logPetPresentation('ai.intent.inferred', { flow: 'speak', reason, inferred, tail })
        }
        emitPresentationIntent(inferred, 'fallback')
      }
    }

    try {
      const initialIntent = reason === 'user_click' ? null : inferPresentationFromText('', reason)
      if (initialIntent) emitPresentationIntent(initialIntent, 'fallback')

      const req = ai.call(
        {
          model: this.personality.model,
          messages,
          tools: PET_PRESENTATION_AI_TOOLS,
          maxToolSteps: 8,
          toolContext: { pluginName: 'desktop-pet' },
          params: { maxOutputTokens: 90, temperature: 0.85 },
          capabilities: [],
          toolingPolicy: { enableInternalTools: false },
          mcp: { mode: 'off' },
          skills: { mode: 'off' },
        },
        (chunk: any) => {
          if (chunk.__requestId) {
            this.requestId = chunk.__requestId
            logPetPresentation('ai.request-id', { flow: 'speak', requestId: this.requestId })
            return
          }
          switch (chunk.chunkType) {
            case 'reasoning': {
              const r = typeof chunk.reasoning_content === 'string' ? chunk.reasoning_content : ''
              if (r) {
                reasoningBuf += r
                logPetPresentation('ai.chunk.reasoning', { flow: 'speak', chars: r.length, total: reasoningBuf.length })
                pushBubble()
              }
              break
            }
            case 'text': {
              const piece = typeof chunk.content === 'string' ? chunk.content : ''
              if (piece) {
                result += piece
                logPetPresentation('ai.chunk.text', { flow: 'speak', chars: piece.length, total: result.length, preview: piece })
                emitInlinePresentation()
                emitInferredPresentation()
                pushBubble()
              }
              break
            }
            case 'tool-call': {
              const tc = chunk.tool_call
              logPetPresentation('ai.tool-call.raw', { flow: 'speak', toolCall: tc })
              if (tc && isPresentationToolName(tc.name)) {
                const intent = normalizePresentationToolCall(tc.name, tc.args)
                if (intent) {
                  sawPresentationTool = true
                  logPetPresentation('ai.tool-call.normalized', { flow: 'speak', name: tc.name, args: tc.args, intent })
                  emitPresentationIntent(intent, 'tool')
                } else {
                  logPetPresentation('ai.tool-call.invalid', { flow: 'speak', name: tc.name, args: tc.args })
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
      logPetPresentation('ai.final-message', {
        flow: 'speak',
        sawPresentationTool,
        rawChars: result.length,
        compact: compactPetReply(result),
      })

      if (!sawPresentationTool) {
        const { intent: markerIntent } = tryExtractPresentationMarker(result)
        if (markerIntent) {
          logPetPresentation('ai.intent.marker', { flow: 'speak', markerIntent })
          emitPresentationIntent(markerIntent, 'fallback')
        } else {
          const stageIntents = extractStageDirectionIntents(result)
          for (const stageIntent of stageIntents.slice(stageIntentCount)) {
            logPetPresentation('ai.intent.final-stage', { flow: 'speak', stageIntent })
            emitPresentationIntent(stageIntent, 'fallback')
          }
          stageIntentCount = stageIntents.length
          const p = parseEmotionResponse(result)
          if (p.emotion || p.expression !== 'neutral') {
            const fb: PresentationIntent = { face: p.expression, emotion: p.emotion || undefined }
            emitPresentationIntent(fb, 'fallback')
          } else {
            const inferred = inferPresentationFromText(result, reason)
            if (inferred) {
              logPetPresentation('ai.intent.final-inferred', { flow: 'speak', reason, inferred })
              emitPresentationIntent(inferred, 'fallback')
            }
          }
        }
      }

      if (result) {
        const stored = compactPetReply(result)
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
        this.maybeRefreshLifeProfile()
      }

      if (!result) return null
      const parsed = parseEmotionResponse(result)
      const expression = speakResultExpression(lastToolIntent, parsed.expression)
      logPetPresentation('ai.speak.result', {
        text: parsed.text,
        expression,
        emotion: parsed.emotion,
        lastToolIntent,
      })
      return parsed.text ? { text: parsed.text, expression, emotion: parsed.emotion } : null
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError'
        || String(err?.message).toLowerCase().includes('aborted')
      if (!isAbort) console.error('[ai-chat] error:', err)
      logPetPresentation(isAbort ? 'ai.speak.abort' : 'ai.speak.error', {
        message: err?.message || String(err),
      })
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

    const lifeProfilePrompt = this.lifeProfile.buildLifeProfilePrompt(userText)
    const stats = this.statsGetter?.() ?? null
    const systemPrompt = buildSystemPrompt(this.personality, stats, this.geoContext, this.activeWindow) + lifeProfilePrompt

    const historyMessagesChat = this.context.history.slice(-CONTEXT_WINDOW).map(h => ({
      role: h.role as 'user' | 'assistant',
      content: h.role === 'assistant' ? sanitizeAssistantForHistory(h.content) : h.content,
    }))
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...historyMessagesChat,
      { role: 'user' as const, content: userText },
    ]
    logPetPresentation('ai.chat.start', {
      model: this.personality.model,
      historyMessages: historyMessagesChat.length,
      tools: PET_PRESENTATION_AI_TOOLS.map(tool => tool.function?.name),
      userText,
    })

    let result = ''
    let reasoningBuf = ''
    let sawPresentationTool = false
    let lastToolIntent: PresentationIntent | null = null
    let inlineIntentCount = 0
    let stageIntentCount = 0
    let lastPresentationSignature = ''

    const emitPresentationIntent = (intent: PresentationIntent, source: 'tool' | 'fallback') => {
      const sig = presentationSignature(intent)
      if (sig === lastPresentationSignature) return
      lastPresentationSignature = sig
      logPetPresentation('ai.intent.emit', { flow: 'chat', source, intent })
      stream?.onPresentation?.(intent, source)
      lastToolIntent = intent
    }

    const pushBubble = () => {
      const { text: reply } = parseEmotionResponse(result)
      stream?.onBubble?.({ reply, reasoning: reasoningBuf })
    }
    const emitInlinePresentation = () => {
      const intents = extractInlineEmotionIntents(result)
      for (const intent of intents.slice(inlineIntentCount)) {
        emitPresentationIntent(intent, 'fallback')
      }
      inlineIntentCount = intents.length
    }
    const emitStagePresentation = () => {
      const stageIntents = extractStageDirectionIntents(result)
      for (const intent of stageIntents.slice(stageIntentCount)) {
        const sig = presentationSignature(intent)
        if (sig !== lastPresentationSignature) {
          logPetPresentation('ai.intent.stage', { flow: 'chat', intent })
        }
        emitPresentationIntent(intent, 'fallback')
      }
      stageIntentCount = stageIntents.length
    }
    const emitInferredPresentation = () => {
      emitStagePresentation()
      if (sawPresentationTool) return
      const tail = result.slice(-160)
      const inferred = inferPresentationFromText(tail)
      if (inferred) {
        const sig = presentationSignature(inferred)
        if (sig !== lastPresentationSignature) {
          logPetPresentation('ai.intent.inferred', { flow: 'chat', inferred, tail })
        }
        emitPresentationIntent(inferred, 'fallback')
      }
    }

    try {
      const req = ai.call(
        {
          model: this.personality.model,
          messages,
          tools: PET_PRESENTATION_AI_TOOLS,
          maxToolSteps: 8,
          toolContext: { pluginName: 'desktop-pet' },
          params: { maxOutputTokens: 90, temperature: 0.85 },
          capabilities: [],
          toolingPolicy: { enableInternalTools: false },
          mcp: { mode: 'off' },
          skills: { mode: 'off' },
        },
        (chunk: any) => {
          if (chunk.__requestId) {
            this.requestId = chunk.__requestId
            logPetPresentation('ai.request-id', { flow: 'chat', requestId: this.requestId })
            return
          }
          switch (chunk.chunkType) {
            case 'reasoning': {
              const r = typeof chunk.reasoning_content === 'string' ? chunk.reasoning_content : ''
              if (r) {
                reasoningBuf += r
                logPetPresentation('ai.chunk.reasoning', { flow: 'chat', chars: r.length, total: reasoningBuf.length })
                pushBubble()
              }
              break
            }
            case 'text': {
              const piece = typeof chunk.content === 'string' ? chunk.content : ''
              if (piece) {
                result += piece
                logPetPresentation('ai.chunk.text', { flow: 'chat', chars: piece.length, total: result.length, preview: piece })
                emitInlinePresentation()
                emitInferredPresentation()
                pushBubble()
              }
              break
            }
            case 'tool-call': {
              const tc = chunk.tool_call
              logPetPresentation('ai.tool-call.raw', { flow: 'chat', toolCall: tc })
              if (tc && isPresentationToolName(tc.name)) {
                const intent = normalizePresentationToolCall(tc.name, tc.args)
                if (intent) {
                  sawPresentationTool = true
                  logPetPresentation('ai.tool-call.normalized', { flow: 'chat', name: tc.name, args: tc.args, intent })
                  emitPresentationIntent(intent, 'tool')
                } else {
                  logPetPresentation('ai.tool-call.invalid', { flow: 'chat', name: tc.name, args: tc.args })
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
      logPetPresentation('ai.final-message', {
        flow: 'chat',
        sawPresentationTool,
        rawChars: result.length,
        compact: compactPetReply(result),
      })

      if (!sawPresentationTool) {
        const { intent: markerIntent } = tryExtractPresentationMarker(result)
        if (markerIntent) {
          logPetPresentation('ai.intent.marker', { flow: 'chat', markerIntent })
          emitPresentationIntent(markerIntent, 'fallback')
        } else {
          const stageIntents = extractStageDirectionIntents(result)
          for (const stageIntent of stageIntents.slice(stageIntentCount)) {
            logPetPresentation('ai.intent.final-stage', { flow: 'chat', stageIntent })
            emitPresentationIntent(stageIntent, 'fallback')
          }
          stageIntentCount = stageIntents.length
          const p = parseEmotionResponse(result)
          if (p.emotion || p.expression !== 'neutral') {
            const fb: PresentationIntent = { face: p.expression, emotion: p.emotion || undefined }
            emitPresentationIntent(fb, 'fallback')
          } else {
            const inferred = inferPresentationFromText(result)
            if (inferred) {
              logPetPresentation('ai.intent.final-inferred', { flow: 'chat', inferred })
              emitPresentationIntent(inferred, 'fallback')
            }
          }
        }
      }

      if (result) {
        const stored = compactPetReply(result)
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
        this.maybeRefreshLifeProfile()
      }

      if (!result) return null
      const parsed = parseEmotionResponse(result)
      const expression = speakResultExpression(lastToolIntent, parsed.expression)
      logPetPresentation('ai.chat.result', {
        text: parsed.text,
        expression,
        emotion: parsed.emotion,
        lastToolIntent,
      })
      return parsed.text ? { text: parsed.text, expression, emotion: parsed.emotion } : null
    } catch (err: any) {
      const isAbort = err?.name === 'AbortError'
        || String(err?.message).toLowerCase().includes('aborted')
      if (!isAbort) console.error('[ai-chat] chat error:', err)
      logPetPresentation(isAbort ? 'ai.chat.abort' : 'ai.chat.error', {
        message: err?.message || String(err),
      })
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

  /**
   * 自动刷新生活档案：每轮对话结束后增加计数；仅当达到轮次与冷却时间门槛时才请求模型。
   */
  private maybeRefreshLifeProfile() {
    this.lifeProfile.notifyUserTurnEnded()
    if (!this.lifeProfile.shouldAttemptAutoUpdate()) return
    const recent = this.context.history.slice(-16).map(m => ({ role: m.role, content: m.content }))
    if (recent.length < 2) return
    this.lifeProfile.markUpdateAttempt()
    void this.lifeProfile.refreshFromChatBatch(this.personality.model, recent)
  }

  /** 设置页「更新记忆」：绕过轮次与间隔门控，仍使用批量档案更新逻辑 */
  async forceRefreshLifeProfile(): Promise<LifeProfileRefreshResult> {
    if (!this.personality.model) {
      return { ok: false, upsertsApplied: 0, deletesApplied: 0, rejected: 0, reason: 'no-model' }
    }
    const recent = this.context.history.slice(-20).map(m => ({ role: m.role, content: m.content }))
    if (recent.length < 2) {
      return { ok: false, upsertsApplied: 0, deletesApplied: 0, rejected: 0, reason: 'too-few-messages' }
    }
    this.lifeProfile.markUpdateAttempt()
    return this.lifeProfile.refreshFromChatBatch(this.personality.model, recent)
  }

  async reloadLifeProfileFromStorage(): Promise<void> {
    await this.lifeProfile.load()
  }

  async clearLifeProfile(): Promise<void> {
    await this.lifeProfile.clear()
  }

  private buildUserMessage(reason: TriggerReason, behavior: BehaviorType): string {
    const hour = new Date().getHours()
    const app = this.activeWindow?.app ? `（用户刚切到 ${this.activeWindow.app}）` : ''

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
      case 'app_switch':
        return `[用户切换到了新的应用窗口${app}，自然地搭句话即可，不要直接照念应用名]`
      default:
        return `[打个招呼吧]`
    }
  }
}

function parseEmotionResponse(raw: string): { text: string; expression: PetExpression; emotion: string } {
  const inlineIntents = extractInlineEmotionIntents(raw)
  const text = compactPetReply(raw)
  const lastIntent = inlineIntents[inlineIntents.length - 1]
  if (lastIntent?.emotion) {
    return { text, expression: emotionToExpression(lastIntent.emotion), emotion: lastIntent.emotion }
  }
  return { text, expression: 'neutral', emotion: '' }
}
