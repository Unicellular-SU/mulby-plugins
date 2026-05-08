import { useEffect, useRef, useCallback } from 'react'
import { SvgPetRenderer } from './engine/svg-renderer'
import {
  createInitialState,
  decideBehavior,
  getVelocity,
  updatePosition,
} from './engine/behavior'
import type { PetState, DisplayBounds, BehaviorType } from './engine/types'
import { PET_SIZE } from './engine/types'
import { AIChatController, DEFAULT_PERSONALITY, type PetPersonality, type TriggerReason, type GeoContext, type PetReminder } from './engine/ai-chat'
import { checkFestival, checkBirthday } from './engine/festivals'
import { AchievementController } from './engine/achievements'
import { PetDiaryController } from './engine/pet-diary'
import { startGame, checkAnswer, getGameAnswer, type GameType, type GameSession } from './engine/mini-games'
import type { PetExpression, PetPose } from './engine/pet-standard'
import type { PresentationIntent } from './engine/presentation'
import { SLIME_SPRITE_SET } from './engine/slime-sprites'
import { PetStatsController, type PetMood } from './engine/pet-stats'

const WIN_SIZE = 80

const MOOD_EXPRESSION: Record<PetMood, PetExpression> = {
  ecstatic: 'excited',
  happy: 'happy',
  content: 'neutral',
  neutral: 'neutral',
  bored: 'sleepy',
  lonely: 'sad',
  sad: 'sad',
  grumpy: 'angry',
  sleepy: 'sleepy',
}

function behaviorToPose(behavior: BehaviorType): PetPose {
  switch (behavior) {
    case 'wander':
    case 'chase':
      return 'walk_1'
    case 'sit':
      return 'sit'
    case 'sleep':
      return 'sleep'
    case 'jump':
      return 'jump'
    case 'happy':
    case 'cheer':
    case 'celebrate':
      return 'wave'
    default:
      return 'stand'
  }
}

function behaviorToExpression(behavior: BehaviorType): PetExpression {
  switch (behavior) {
    case 'happy':
      return 'happy'
    case 'cheer':
      return 'excited'
    case 'celebrate':
      return 'happy'
    case 'surprised':
      return 'surprised'
    case 'wobble':
      return 'surprised'
    case 'sleep':
      return 'sleepy'
    case 'sit':
      return 'sleepy'
    case 'chase':
      return 'excited'
    default:
      return 'neutral'
  }
}

function weatherCodeToName(code: number): string {
  if (code <= 1) return '晴'
  if (code <= 3) return '多云'
  if (code <= 48) return '雾'
  if (code <= 55) return '毛毛雨'
  if (code <= 65) return '雨'
  if (code <= 67) return '冻雨'
  if (code <= 75) return '雪'
  if (code <= 77) return '雪粒'
  if (code <= 82) return '阵雨'
  if (code <= 86) return '阵雪'
  if (code >= 95) return '雷暴'
  return '未知'
}

export default function PetView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef<PetState | null>(null)
  const boundsRef = useRef<DisplayBounds | null>(null)
  const svgRendererRef = useRef<SvgPetRenderer | null>(null)
  const lastTimeRef = useRef(0)
  const inputSessionRef = useRef<string | null>(null)
  const chatRef = useRef<AIChatController | null>(null)
  const statsRef = useRef<PetStatsController>(new PetStatsController())
  const idleCheckRef = useRef(0)
  const lastTypingRef = useRef(0)
  const typingCountRef = useRef(0)
  const typingPauseTimerRef = useRef<number>(0)
  const lastWinPosRef = useRef({ x: -1, y: -1 })
  const currentExpressionRef = useRef<PetExpression>('neutral')
  const expressionTimerRef = useRef<number>(0)

  const bubbleTimerRef = useRef<number>(0)
  const bubbleProxyRef = useRef<any>(null)
  const bubbleVisibleRef = useRef(false)
  const bubbleSizeRef = useRef({ width: 120, height: 44 })
  const initedRef = useRef(false)
  const pomodoroRef = useRef<number>(0)
  const pomodoroStartRef = useRef(0)
  const chatWindowOpenRef = useRef(false)
  const chatInputProxyRef = useRef<any>(null)
  const longPressRef = useRef<number>(0)
  const longPressFiredRef = useRef(false)
  const geoMissingRef = useRef(false)
  const mouseMoveSumRef = useRef(0)
  const mouseMoveResetRef = useRef(0)
  const clickBurstRef = useRef<number[]>([])
  const lastMousePatternTime = useRef(0)
  const achieveRef = useRef<AchievementController>(new AchievementController())
  const diaryRef = useRef<PetDiaryController>(new PetDiaryController())
  const reminderTimersRef = useRef<number[]>([])
  const festivalCheckedRef = useRef(false)
  const weatherTimerRef = useRef<number>(0)
  const weatherGeoRef = useRef<GeoContext | null>(null)
  const gameSessionRef = useRef<GameSession | null>(null)
  const presentationPoseRef = useRef<{ pose: PetPose; until: number } | null>(null)

  const calcBubbleSize = useCallback((text: string) => {
    const len = text.length
    const width = len <= 12 ? 120 : len <= 25 ? 160 : len <= 50 ? 200 : Math.min(260, 200 + Math.ceil((len - 50) / 20) * 10)
    // 略保守的每行字数，减少中英文混排、标点换行与估算不一致导致的裁切
    const charsPerLine = Math.max(4, Math.floor((width - 16) / 12))
    const lines = Math.max(1, Math.ceil(len / charsPerLine))
    const textHeight = Math.ceil(lines * 15.4)
    const height = textHeight + 10 + 8 + 12
    return { width, height }
  }, [])

  const positionBubble = useCallback((pos: { x: number; y: number }, bubbleWidth: number, bubbleHeight: number) => {
    const winCenterX = pos.x + WIN_SIZE / 2
    const bx = Math.round(winCenterX - bubbleWidth / 2)
    const by = Math.max(0, Math.round(pos.y - bubbleHeight - 4))
    return { x: bx, y: by }
  }, [])

  const bubbleMeasureString = useCallback((reply: string, reasoning: string) => {
    const cap = reasoning.length > 1200 ? `${reasoning.slice(0, 1200)}…` : reasoning
    return cap ? `${cap}\n\n${reply}` : reply
  }, [])

  const showBubble = useCallback((text: string) => {
    const proxy = bubbleProxyRef.current
    if (!proxy) return

    const { width: bubbleWidth, height: bubbleHeight } = calcBubbleSize(text)
    bubbleSizeRef.current = { width: bubbleWidth, height: bubbleHeight }

    const pos = lastWinPosRef.current
    const { x, y } = positionBubble(pos, bubbleWidth, bubbleHeight)

    proxy.setBounds({ x, y, width: bubbleWidth, height: bubbleHeight })
    proxy.postMessage('bubble-update', text)
    proxy.setOpacity(1)
    if (!bubbleVisibleRef.current) {
      proxy.showInactive?.() ?? proxy.show()
    }
    bubbleVisibleRef.current = true

    clearTimeout(bubbleTimerRef.current)
    const duration = text.length > 40 ? 8000 : 5000
    bubbleTimerRef.current = window.setTimeout(() => {
      proxy.setOpacity(0)
      bubbleVisibleRef.current = false
    }, duration)
  }, [positionBubble, calcBubbleSize])

  const updateBubbleText = useCallback((payload: string | { reply: string; reasoning?: string }) => {
    const proxy = bubbleProxyRef.current
    if (!proxy) return

    const reply = typeof payload === 'string' ? payload : payload.reply
    const reasoning = typeof payload === 'string' ? '' : (payload.reasoning ?? '')
    const measure = bubbleMeasureString(reply, reasoning)
    const { width: bubbleWidth, height: bubbleHeight } = calcBubbleSize(measure)
    const prev = bubbleSizeRef.current
    const pos = lastWinPosRef.current

    // 必须先调整子窗口尺寸与位置，再下发文字；否则流式阶段仍为小窗时
    // BubbleOverlayView 使用 flex-end，新内容会从底部堆叠导致上方被裁切。
    if (!bubbleVisibleRef.current) {
      bubbleSizeRef.current = { width: bubbleWidth, height: bubbleHeight }
      const { x, y } = positionBubble(pos, bubbleWidth, bubbleHeight)
      proxy.setBounds({ x, y, width: bubbleWidth, height: bubbleHeight })
      proxy.setOpacity(1)
      proxy.showInactive?.() ?? proxy.show()
      bubbleVisibleRef.current = true
    } else if (bubbleWidth !== prev.width || bubbleHeight !== prev.height) {
      bubbleSizeRef.current = { width: bubbleWidth, height: bubbleHeight }
      const { x, y } = positionBubble(pos, bubbleWidth, bubbleHeight)
      proxy.setBounds({ x, y, width: bubbleWidth, height: bubbleHeight })
    }

    if (typeof payload === 'string') {
      proxy.postMessage('bubble-update', payload)
    } else {
      proxy.postMessage('bubble-update', { reply, reasoning })
    }

    clearTimeout(bubbleTimerRef.current)
    const len = measure.length
    const duration = len > 200 ? 14000 : len > 80 ? 10000 : 7000
    bubbleTimerRef.current = window.setTimeout(() => {
      proxy.setOpacity(0)
      bubbleVisibleRef.current = false
    }, duration)
  }, [positionBubble, calcBubbleSize, bubbleMeasureString])

  const setExpression = useCallback((expression: PetExpression, durationMs = 5000) => {
    currentExpressionRef.current = expression
    if (svgRendererRef.current) {
      svgRendererRef.current.setExpression(expression)
    }
    clearTimeout(expressionTimerRef.current)
    if (expression !== 'neutral') {
      expressionTimerRef.current = window.setTimeout(() => {
        currentExpressionRef.current = 'neutral'
        if (svgRendererRef.current) {
          svgRendererRef.current.setExpression('neutral')
        }
      }, durationMs)
    }
  }, [])

  const applyPresentationIntent = useCallback((intent: PresentationIntent, _source: 'tool' | 'fallback') => {
    const face = intent.face === 'love' ? ('love' as unknown as PetExpression) : intent.face
    setExpression(face, 8000)
    if (intent.pose) {
      presentationPoseRef.current = { pose: intent.pose, until: Date.now() + 6000 }
    }
    if (intent.emotion) {
      statsRef.current.applyEmotion(intent.emotion)
    }
  }, [setExpression])

  const triggerSpeak = useCallback(async (reason: TriggerReason) => {
    if (pomodoroRef.current && reason !== 'user_click') return
    const chat = chatRef.current
    const state = stateRef.current
    if (!chat || !state) return
    if (!chat.canSpeak(reason)) return

    const result = await chat.speak(reason, state.behavior, {
      onBubble: ({ reply, reasoning }) => updateBubbleText({ reply, reasoning }),
      onPresentation: applyPresentationIntent,
    })

    if (result) {
      showBubble(result.text)
      statsRef.current.recordChat()
    }
  }, [applyPresentationIntent, updateBubbleText, showBubble])

  const CHAT_INPUT_WIDTH = 220
  const CHAT_INPUT_HEIGHT = 44

  const openChatInput = useCallback(async () => {
    if (chatWindowOpenRef.current) return
    chatWindowOpenRef.current = true

    const pos = lastWinPosRef.current
    const petCenterX = pos.x + WIN_SIZE / 2
    const inputX = Math.round(petCenterX - CHAT_INPUT_WIDTH / 2)
    const inputY = pos.y + WIN_SIZE + 4

    try {
      const proxy = await window.mulby.window.create('?view=chat-input', {
        width: CHAT_INPUT_WIDTH,
        height: CHAT_INPUT_HEIGHT,
        x: inputX,
        y: inputY,
        type: 'borderless',
        titleBar: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        focusable: true,
        skipTaskbar: true,
      })
      chatInputProxyRef.current = proxy
    } catch (e) {
      console.error('Open chat input failed:', e)
    }
  }, [])

  const handleChatMessage = useCallback(async (text: string) => {
    if (!text.trim()) return

    const session = gameSessionRef.current
    if (session?.active) {
      session.attempts++
      if (text.trim() === '放弃' || text.trim() === '不知道') {
        showBubble(getGameAnswer(session.answer))
        setExpression('sad')
        gameSessionRef.current = null
        return
      }
      const { correct, expression, response } = checkAnswer(text.trim(), session.answer)
      showBubble(response)
      setExpression(expression)
      if (correct) {
        statsRef.current.recordInteraction()
        statsRef.current.recordChat()
        gameSessionRef.current = null
        checkAchievements()
      } else if (session.attempts >= 3) {
        setTimeout(() => {
          showBubble(getGameAnswer(session.answer))
          setExpression('neutral')
          gameSessionRef.current = null
        }, 2500)
      }
      return
    }

    const chat = chatRef.current
    if (!chat) return

    const result = await chat.chat(text.trim(), {
      onBubble: ({ reply, reasoning }) => updateBubbleText({ reply, reasoning }),
      onPresentation: applyPresentationIntent,
    })

    if (result) {
      showBubble(result.text)
      statsRef.current.recordChat()
      statsRef.current.recordInteraction()
    }
  }, [applyPresentationIntent, updateBubbleText, showBubble])

  const openSettings = useCallback(async () => {
    try {
      await window.mulby.window.create('?view=settings', {
        width: 380,
        height: 540,
        title: '宠物设置',
        type: 'default',
        titleBar: true,
        resizable: false,
        transparent: false,
        alwaysOnTop: true,
      })
    } catch (e) {
      console.error('Open settings failed:', e)
    }
  }, [])

  const togglePomodoro = useCallback(() => {
    if (pomodoroRef.current) {
      clearInterval(pomodoroRef.current)
      pomodoroRef.current = 0
      pomodoroStartRef.current = 0
      showBubble('没关系，下次继续~')
      setExpression('sad')
      return
    }

    const minutes = chatRef.current?.getPersonality()?.pomodoroMinutes || 25
    pomodoroStartRef.current = Date.now()
    setExpression('sleepy')
    showBubble(`专注 ${minutes} 分钟开始！`)

    pomodoroRef.current = window.setInterval(() => {
      const elapsed = Date.now() - pomodoroStartRef.current
      const remaining = minutes * 60_000 - elapsed

      if (remaining <= 0) {
        clearInterval(pomodoroRef.current)
        pomodoroRef.current = 0
        pomodoroStartRef.current = 0
        statsRef.current.recordPomodoroComplete(minutes)
        setExpression('excited')
        showBubble('专注完成！休息一下吧~')
        checkAchievements()
        return
      }

      const min = Math.floor(remaining / 60_000)
      const sec = Math.floor((remaining % 60_000) / 1000)
      updateBubbleText(`专注 ${min}:${sec.toString().padStart(2, '0')}`)
    }, 1000)
  }, [showBubble, setExpression])

  const checkAchievements = useCallback(() => {
    const stats = statsRef.current.getStats()
    const newAchs = achieveRef.current.checkAll(stats)
    if (newAchs.length > 0) {
      const first = newAchs[0]
      setTimeout(() => {
        setExpression('excited')
        showBubble(`成就解锁：${first.title}！${first.desc}`)
      }, 1500)
    }
  }, [showBubble, setExpression])

  const scheduleReminders = useCallback((reminders: PetReminder[]) => {
    reminderTimersRef.current.forEach(t => clearTimeout(t))
    reminderTimersRef.current = []
    const now = new Date()
    for (const r of reminders) {
      if (!r.enabled) continue
      const target = new Date(now)
      target.setHours(r.hour, r.minute, 0, 0)
      if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
      const delay = target.getTime() - now.getTime()
      const tid = window.setTimeout(() => {
        showBubble(r.label)
        setExpression('surprised')
        scheduleReminders(reminders)
      }, delay)
      reminderTimersRef.current.push(tid)
    }
  }, [showBubble, setExpression])

  const fetchWeather = useCallback(async (geo: GeoContext) => {
    try {
      const resp = await window.mulby.http.get(
        `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code&timezone=auto`,
        {}
      )
      if (resp.status === 200) {
        const data = JSON.parse(resp.data)
        const temp = data.current?.temperature_2m
        const code = data.current?.weather_code ?? -1
        const weatherName = weatherCodeToName(code)
        const updatedGeo: GeoContext = { ...geo, temperature: temp, weather: weatherName }
        weatherGeoRef.current = updatedGeo
        chatRef.current?.setGeoContext(updatedGeo)
        await window.mulby.storage.set('pet-geo', updatedGeo)
      }
    } catch {}
  }, [])

  const startMiniGame = useCallback(async (type: GameType) => {
    const chat = chatRef.current
    if (!chat) return
    const p = chat.getPersonality()
    if (!p.model) {
      showBubble('还没配置 AI 模型，去设置里选一个吧~')
      return
    }

    showBubble('让我想一个好题目...')
    setExpression('excited')

    const result = await startGame(type, p.model, (text) => updateBubbleText(text))
    if (result) {
      showBubble(result.question)
      setExpression(result.expression)
      gameSessionRef.current = { type, active: true, answer: result.answer ?? '', attempts: 0 }
    } else {
      showBubble('啊，出题失败了...')
      setExpression('sad')
    }
  }, [showBubble, setExpression, updateBubbleText])

  const showContextMenu = useCallback(async () => {
    const stats = statsRef.current.getStats()
    const minutes = chatRef.current?.getPersonality()?.pomodoroMinutes || 25
    const pomodoroLabel = pomodoroRef.current
      ? '停止专注'
      : `开始专注 (${minutes}分钟)`
    const moodLabels: Record<string, string> = {
      ecstatic: '欣喜若狂', happy: '开心', content: '满足', neutral: '平静',
      bored: '无聊', lonely: '孤独', sad: '难过', grumpy: '暴躁', sleepy: '困倦',
    }

    const result = await window.mulby.menu.showContextMenu([
      { label: '对话', id: 'chat' },
      { label: pomodoroLabel, id: 'pomodoro' },
      { type: 'separator', label: '' },
      { label: '猜谜语', id: 'game_riddle' },
      { label: '成语接龙', id: 'game_idiom' },
      { label: '冷知识问答', id: 'game_trivia' },
      { type: 'separator', label: '' },
      { label: `心情: ${moodLabels[stats.mood] || stats.mood}`, id: 'mood', enabled: false },
      { label: `亲密度: ${stats.intimacy}`, id: 'stats', enabled: false },
      { label: `今日番茄: ${stats.pomodoroToday} 个`, id: 'stats2', enabled: false },
      { type: 'separator', label: '' },
      { label: '设置', id: 'settings' },
      { label: '暂时隐藏', id: 'hide' },
      { label: '退出', id: 'close' },
    ])

    if (!result) return

    switch (result) {
      case 'settings':
        openSettings()
        break
      case 'chat':
        openChatInput()
        break
      case 'pomodoro':
        togglePomodoro()
        break
      case 'game_riddle':
        startMiniGame('riddle')
        break
      case 'game_idiom':
        startMiniGame('idiom')
        break
      case 'game_trivia':
        startMiniGame('trivia')
        break
      case 'hide':
        window.mulby.window.hide()
        break
      case 'close':
        if (inputSessionRef.current) {
          window.mulby.inputMonitor.stop(inputSessionRef.current)
        }
        window.mulby.window.terminatePlugin()
        break
    }
  }, [openSettings, openChatInput, setExpression, togglePomodoro, startMiniGame])

  const init = useCallback(async () => {
    if (initedRef.current) return
    initedRef.current = true

    const container = containerRef.current
    if (!container) return

    let personality = DEFAULT_PERSONALITY
    try {
      const savedP = await window.mulby.storage.get('pet-personality')
      if (savedP) personality = { ...DEFAULT_PERSONALITY, ...(savedP as Partial<PetPersonality>) }
    } catch {}
    await statsRef.current.load()
    await achieveRef.current.load()
    await diaryRef.current.load()

    const signedIn = statsRef.current.signIn()
    if (signedIn) {
      setTimeout(() => {
        const streak = statsRef.current.getStats().streakDays
        showBubble(streak > 1 ? `连续签到 ${streak} 天！` : '今日签到~')
        setExpression('happy')
      }, 3000)
    }

    setTimeout(() => checkAchievements(), signedIn ? 5000 : 2000)

    const spriteSet = SLIME_SPRITE_SET
    if (!spriteSet?.sprites['stand_neutral']) {
      console.error('[pet] built-in sprite set is missing stand_neutral')
      return
    }
    const svgRenderer = new SvgPetRenderer(container, PET_SIZE)
    svgRenderer.loadSpriteSet(spriteSet)
    svgRendererRef.current = svgRenderer

    chatRef.current = new AIChatController(personality)
    chatRef.current.setStatsController(statsRef.current)

    try {
      const savedGeo = await window.mulby.storage.get('pet-geo')
      if (savedGeo && typeof savedGeo === 'object') {
        const geo = savedGeo as GeoContext
        weatherGeoRef.current = geo
        chatRef.current.setGeoContext(geo)
        fetchWeather(geo)
        weatherTimerRef.current = window.setInterval(() => {
          const g = weatherGeoRef.current
          if (g) fetchWeather(g)
        }, 30 * 60_000)
      } else {
        geoMissingRef.current = true
        setTimeout(() => {
          if (geoMissingRef.current) {
            showBubble('去设置页开启定位，我就能知道你在哪儿啦~')
          }
        }, signedIn ? 12000 : 8000)
      }
    } catch {}

    if (!festivalCheckedRef.current) {
      festivalCheckedRef.current = true
      const festival = checkFestival()
      const isBirthday = checkBirthday(personality.birthday)
      const greetDelay = signedIn ? 6000 : 4000
      if (isBirthday) {
        setTimeout(() => {
          showBubble('生日快乐！！今天是属于你的特别日子~')
          setExpression('excited')
        }, greetDelay)
      } else if (festival) {
        setTimeout(() => {
          showBubble(festival.greeting)
          setExpression(festival.expression as any)
        }, greetDelay + (signedIn ? 5000 : 0))
      }
    }

    if (personality.reminders?.length) {
      scheduleReminders(personality.reminders)
    }

    const display = await window.mulby.screen.getPrimaryDisplay()
    const bounds: DisplayBounds = display.workArea
    boundsRef.current = bounds

    const state = createInitialState(bounds)
    try {
      const savedPos = await window.mulby.storage.get('pet-position')
      if (savedPos && typeof savedPos === 'object') {
        const sp = savedPos as { x: number; y: number }
        if (sp.x >= bounds.x && sp.x <= bounds.x + bounds.width - PET_SIZE &&
            sp.y >= bounds.y + 80 && sp.y <= bounds.y + bounds.height - PET_SIZE) {
          state.position = sp
        }
      }
    } catch {}
    stateRef.current = state

    await window.mulby.window.setPosition(
      Math.round(state.position.x),
      Math.round(state.position.y)
    )

    await window.mulby.window.setIgnoreMouseEvents(true, { forward: true })

    try {
      const bubbleProxy = await window.mulby.window.create('?view=bubble-overlay', {
        width: 120,
        height: 44,
        x: -200,
        y: -200,
        type: 'borderless',
        titleBar: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        focusable: false,
        skipTaskbar: true,
        ignoreMouseEvents: true,
        forwardMouseEvents: true,
        visibleOnAllWorkspaces: true,
        visibleOnFullScreen: true,
        opacity: 0,
      })
      if (bubbleProxy) {
        bubbleProxyRef.current = bubbleProxy
        setTimeout(() => bubbleProxy.hide(), 500)
      }
    } catch (e) {
      console.error('[pet] create bubble window failed:', e)
    }

    const available = await window.mulby.inputMonitor.isAvailable()
    if (!available) {
      await window.mulby.inputMonitor.requireAccessibility()
    }

    const sessionId = await window.mulby.inputMonitor.start({
      mouse: true,
      keyboard: true,
      throttleMs: 50,
    })
    inputSessionRef.current = sessionId

    if (sessionId) {
      window.mulby.inputMonitor.onEvent((event: any) => {
        const s = stateRef.current
        if (!s) return

        if (event.type === 'mouseMove') {
          const prev = s.lastMousePos
          if (prev.x >= 0) {
            const dx = event.x - prev.x
            const dy = event.y - prev.y
            mouseMoveSumRef.current += Math.sqrt(dx * dx + dy * dy)
          }
          s.lastMousePos = { x: event.x, y: event.y }
          s.idleTimer = 0

          const now = Date.now()
          if (now - mouseMoveResetRef.current > 2000) {
            const mp = chatRef.current?.getPersonality()?.triggers?.mousePattern ?? true
            if (mp && mouseMoveSumRef.current > 3000 && now - lastMousePatternTime.current > 180_000) {
              lastMousePatternTime.current = now
              triggerSpeak('behavior_change')
            }
            mouseMoveSumRef.current = 0
            mouseMoveResetRef.current = now
          }
        }

        if (event.type === 'mouseDown') {
          const now = Date.now()
          clickBurstRef.current.push(now)
          clickBurstRef.current = clickBurstRef.current.filter(t => now - t < 2000)
          const mpClick = chatRef.current?.getPersonality()?.triggers?.mousePattern ?? true
          if (mpClick && clickBurstRef.current.length > 5 && now - lastMousePatternTime.current > 180_000) {
            lastMousePatternTime.current = now
            triggerSpeak('behavior_change')
            clickBurstRef.current = []
          }
        }

        if (event.type === 'keyDown') {
          s.lastKeyTime = Date.now()
          s.idleTimer = 0
          typingCountRef.current++
          const now = Date.now()
          if (now - lastTypingRef.current > 3000) {
            typingCountRef.current = 1
          }
          lastTypingRef.current = now

          if (typingCountRef.current >= 30) {
            typingCountRef.current = 0
            clearTimeout(typingPauseTimerRef.current)
            typingPauseTimerRef.current = window.setTimeout(() => {
              triggerSpeak('typing_fast')
            }, 2000)
          }
        }

        const newBehavior = decideBehavior(s, {
          type: event.type,
          x: event.x ?? 0,
          y: event.y ?? 0,
          button: event.button,
          key: event.key,
          meta: event.meta,
          ctrl: event.ctrl,
          scrollDeltaY: event.scrollDeltaY,
        })

        if (newBehavior !== s.behavior) {
          s.behavior = newBehavior
          s.animTimer = 0
        }
      })
    }

    window.mulby.window.onChildMessage((channel: string, ...args: any[]) => {
      if (channel === 'geo-updated') {
        const payload = args[0]
        clearInterval(weatherTimerRef.current)
        weatherTimerRef.current = 0
        if (
          payload
          && typeof payload === 'object'
          && typeof payload.latitude === 'number'
          && typeof payload.longitude === 'number'
          && !Number.isNaN(payload.latitude)
          && !Number.isNaN(payload.longitude)
        ) {
          const geo = payload as GeoContext
          weatherGeoRef.current = geo
          chatRef.current?.setGeoContext(geo)
          fetchWeather(geo)
          weatherTimerRef.current = window.setInterval(() => {
            const g = weatherGeoRef.current
            if (g) fetchWeather(g)
          }, 30 * 60_000)
          geoMissingRef.current = false
        } else {
          weatherGeoRef.current = null
          chatRef.current?.setGeoContext(null)
        }
      }
      if (channel === 'settings-updated' && args[0]) {
        const { personality: newP } = args[0]
        if (newP) {
          chatRef.current?.updatePersonality(newP)
          if (newP.reminders?.length) scheduleReminders(newP.reminders)
        }
      }
      if (channel === 'chat-history-updated') {
        void chatRef.current?.reloadHistoryFromStorage()
      }
      if (channel === 'chat-message' && args[0]) {
        chatWindowOpenRef.current = false
        chatInputProxyRef.current = null
        const text = typeof args[0] === 'string' ? args[0] : args[0].text
        if (text) handleChatMessage(text)
      }
      if (channel === 'chat-closed') {
        chatWindowOpenRef.current = false
        chatInputProxyRef.current = null
      }
      if (channel === 'sprites-updated' && args[0]) {
        const { spriteSet: newS } = args[0]
        if (newS && newS.sprites['stand_neutral']) {
          if (!svgRendererRef.current) {
            svgRendererRef.current = new SvgPetRenderer(container, PET_SIZE)
          }
          svgRendererRef.current.loadSpriteSet(newS)
        } else if (svgRendererRef.current) {
          svgRendererRef.current.destroy()
          svgRendererRef.current = null
        }
      }
    })

    const hour = new Date().getHours()
    if (hour >= 6 && hour <= 9) {
      setTimeout(() => triggerSpeak('morning'), 2000)
    } else if (hour >= 23 || hour < 5) {
      setTimeout(() => triggerSpeak('late_night'), 2000)
    }

    idleCheckRef.current = window.setInterval(() => {
      const s = stateRef.current
      if (!s) return
      try {
        window.mulby.storage.set('pet-position', { x: s.position.x, y: s.position.y })
      } catch {}
      statsRef.current.decayMood()
      if (s.idleTimer > 300_000) {
        s.idleTimer = 0
        triggerSpeak('idle')
      }

      const hour = new Date().getHours()
      if (hour >= 21 && !diaryRef.current.hasTodayEntry()) {
        const chat = chatRef.current
        if (chat) {
          const p = chat.getPersonality()
          const st = statsRef.current.getStats()
          diaryRef.current.generateDiary(p.model, p.name, st, []).then(entry => {
            if (entry) {
              showBubble('今天的日记写好啦，去设置里看看吧~')
              setExpression('happy')
            }
          })
        }
      }
    }, 120_000)

    let waterMinutes = 0
    let restMinutes = 0
    window.setInterval(() => {
      if (pomodoroRef.current) return
      waterMinutes++
      restMinutes++
      if (waterMinutes >= 45) {
        waterMinutes = 0
        showBubble('该喝水啦~ 💧')
        setExpression('neutral')
      }
      if (restMinutes >= 90) {
        restMinutes = 0
        showBubble('休息一下眼睛吧~ 👀')
        setExpression('sleepy')
      }
    }, 60_000)

    let lastClipText = ''
    let lastClipCommentTime = 0
    window.setInterval(async () => {
      if (pomodoroRef.current) return
      try {
        const text = await window.mulby.clipboard.readText()
        if (!text || text === lastClipText || text.length < 10) return
        lastClipText = text

        const chat = chatRef.current
        if (!chat) return
        const p = chat.getPersonality()
        if (!p.model) return
        if (p.triggers && (p.triggers as any).clipboard === false) return

        const ai = (window as any).mulby?.ai
        if (!ai) return

        const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
        const chineseRatio = chineseCount / text.length

        if (chineseRatio < 0.3 && text.length >= 20) {
          setExpression('surprised')
          const resp = await ai.call({
            model: p.model,
            messages: [
              { role: 'system', content: '你是翻译助手。将用户给出的英文翻译成简洁的中文，只返回翻译结果，不超过50字。' },
              { role: 'user', content: text.slice(0, 200) },
            ],
            params: { maxOutputTokens: 80, temperature: 0.3 },
            capabilities: [],
            toolingPolicy: { enableInternalTools: false },
            mcp: { mode: 'off' },
            skills: { mode: 'off' },
          })
          if (resp?.content) {
            const translated = typeof resp.content === 'string' ? resp.content : ''
            if (translated) {
              showBubble(translated)
              setExpression('happy')
            }
          }
        } else if (chineseRatio >= 0.5 && text.length > 10) {
          const now = Date.now()
          if (now - lastClipCommentTime < 300_000) return
          lastClipCommentTime = now
          const result = await chat.chat(`[用户刚刚复制了一段文字："${text.slice(0, 80)}"]`, {
            onBubble: ({ reply, reasoning }) => updateBubbleText({ reply, reasoning }),
            onPresentation: applyPresentationIntent,
          })
          if (result) {
            showBubble(result.text)
          }
        }
      } catch {}
    }, 5000)

    lastTimeRef.current = performance.now()
    requestAnimationFrame(gameLoop)
  }, [])

  const gameLoop = useCallback((timestamp: number) => {
    const state = stateRef.current
    const bounds = boundsRef.current
    if (!state || !bounds) {
      requestAnimationFrame(gameLoop)
      return
    }

    const delta = timestamp - lastTimeRef.current
    lastTimeRef.current = timestamp

    state.idleTimer += delta
    state.animTimer += delta

    const timeBehavior = decideBehavior(state, null)
    if (timeBehavior !== state.behavior) {
      state.behavior = timeBehavior
      state.animTimer = 0
    }

    state.velocity = getVelocity(state, bounds)
    updatePosition(state, bounds)

    if (svgRendererRef.current) {
      const po = presentationPoseRef.current
      let pose = behaviorToPose(state.behavior)
      if (po && Date.now() < po.until) pose = po.pose
      else if (po && Date.now() >= po.until) presentationPoseRef.current = null

      const behaviorExpr = behaviorToExpression(state.behavior)
      let expr: PetExpression
      if (currentExpressionRef.current !== 'neutral') {
        expr = currentExpressionRef.current
      } else if (behaviorExpr !== 'neutral') {
        expr = behaviorExpr
      } else {
        const mood = statsRef.current.getMood()
        expr = MOOD_EXPRESSION[mood] ?? 'neutral'
      }
      svgRendererRef.current.setPose(pose)
      svgRendererRef.current.setExpression(expr)
      svgRendererRef.current.setFlipped(state.facing === 'left')
      svgRendererRef.current.update(delta)
    }

    const newX = Math.round(state.position.x)
    const newY = Math.round(state.position.y)
    if (newX !== lastWinPosRef.current.x || newY !== lastWinPosRef.current.y) {
      lastWinPosRef.current = { x: newX, y: newY }
      window.mulby.window.setPosition(newX, newY)

      if (bubbleVisibleRef.current && bubbleProxyRef.current) {
        const { width: bw, height: bh } = bubbleSizeRef.current
        const bp = positionBubble({ x: newX, y: newY }, bw, bh)
        bubbleProxyRef.current.setPosition(bp.x, bp.y)
      }

      if (chatWindowOpenRef.current && chatInputProxyRef.current) {
        chatInputProxyRef.current.setPosition(
          Math.round(newX + WIN_SIZE / 2 - CHAT_INPUT_WIDTH / 2),
          newY + WIN_SIZE + 4
        )
      }
    }

    requestAnimationFrame(gameLoop)
  }, [])

  useEffect(() => {
    init()
    return () => {
      if (inputSessionRef.current) {
        window.mulby.inputMonitor.stop(inputSessionRef.current)
      }
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current)
      }
      clearTimeout(typingPauseTimerRef.current)
      clearTimeout(expressionTimerRef.current)
      clearTimeout(bubbleTimerRef.current)
      clearInterval(weatherTimerRef.current)
      reminderTimersRef.current.forEach(t => clearTimeout(t))
      if (svgRendererRef.current) {
        svgRendererRef.current.destroy()
      }
    }
  }, [init])

  return (
    <div
      style={{
        width: WIN_SIZE,
        height: WIN_SIZE,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        ref={containerRef}
        onMouseEnter={() => {
          window.mulby.window.setIgnoreMouseEvents(false)
        }}
        onMouseLeave={() => {
          window.mulby.window.setIgnoreMouseEvents(true, { forward: true })
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          longPressFiredRef.current = false
          longPressRef.current = window.setTimeout(() => {
            longPressFiredRef.current = true
            longPressRef.current = 0
            openChatInput()
          }, 400)
        }}
        onPointerUp={(e) => {
          if (e.button !== 0) return
          if (longPressRef.current) {
            clearTimeout(longPressRef.current)
            longPressRef.current = 0
          }
          if (!longPressFiredRef.current) {
            triggerSpeak('user_click')
            statsRef.current.recordInteraction()
          }
        }}
        onPointerLeave={() => {
          if (longPressRef.current) {
            clearTimeout(longPressRef.current)
            longPressRef.current = 0
          }
        }}
        onContextMenu={e => {
          e.preventDefault()
          if (longPressRef.current) {
            clearTimeout(longPressRef.current)
            longPressRef.current = 0
          }
          longPressFiredRef.current = true
          showContextMenu()
        }}
        style={{
          width: PET_SIZE,
          height: PET_SIZE,
          cursor: 'pointer',
          position: 'relative',
        }}
      />
    </div>
  )
}
