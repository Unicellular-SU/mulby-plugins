import { useEffect, useRef, useCallback, useState } from 'react'
import { SvgPetRenderer } from './engine/svg-renderer'
import { PixelCatRenderer, DEFAULT_COLORS, type PetColorScheme } from './engine/sprite'
import {
  createInitialState,
  decideBehavior,
  getVelocity,
  updatePosition,
  behaviorToAnimation,
} from './engine/behavior'
import type { PetState, DisplayBounds, BehaviorType } from './engine/types'
import { PET_SIZE } from './engine/types'
import { AIChatController, DEFAULT_PERSONALITY, type PetPersonality, type TriggerReason } from './engine/ai-chat'
import type { PetSpriteSet, PetExpression, PetPose } from './engine/pet-standard'
import { SLIME_SPRITE_SET } from './engine/slime-sprites'

const BUBBLE_AREA_HEIGHT = 80
const WIN_WIDTH = 120
const WIN_HEIGHT = PET_SIZE + BUBBLE_AREA_HEIGHT

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
    case 'cheer':
    case 'celebrate':
      return 'happy'
    case 'surprised':
      return 'surprised'
    case 'sleep':
      return 'sleepy'
    default:
      return 'neutral'
  }
}

export default function PetView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<PetState | null>(null)
  const boundsRef = useRef<DisplayBounds | null>(null)
  const svgRendererRef = useRef<SvgPetRenderer | null>(null)
  const canvasRendererRef = useRef<PixelCatRenderer | null>(null)
  const useSvgRef = useRef(false)
  const lastTimeRef = useRef(0)
  const inputSessionRef = useRef<string | null>(null)
  const chatRef = useRef<AIChatController | null>(null)
  const idleCheckRef = useRef(0)
  const lastTypingRef = useRef(0)
  const typingCountRef = useRef(0)
  const typingPauseTimerRef = useRef<number>(0)
  const lastWinPosRef = useRef({ x: -1, y: -1 })
  const currentExpressionRef = useRef<PetExpression>('neutral')
  const expressionTimerRef = useRef<number>(0)

  const [bubbleText, setBubbleText] = useState('')
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const bubbleTimerRef = useRef<number>(0)
  const initedRef = useRef(false)

  const showBubble = useCallback((text: string) => {
    setBubbleText(text)
    setBubbleVisible(true)
    clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleVisible(false)
    }, 5000)
  }, [])

  const updateBubbleText = useCallback((text: string) => {
    setBubbleText(text)
    setBubbleVisible(true)
    clearTimeout(bubbleTimerRef.current)
    bubbleTimerRef.current = window.setTimeout(() => {
      setBubbleVisible(false)
    }, 5000)
  }, [])

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

  const triggerSpeak = useCallback(async (reason: TriggerReason) => {
    const chat = chatRef.current
    const state = stateRef.current
    if (!chat || !state) return
    if (!chat.canSpeak(reason)) return

    const result = await chat.speak(reason, state.behavior, (partial) => {
      updateBubbleText(partial)
    })

    if (result) {
      showBubble(result.text)
      setExpression(result.expression)
    }
  }, [])

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

  const showContextMenu = useCallback(async () => {
    const result = await window.mulby.menu.showContextMenu([
      { label: '设置', id: 'settings' },
      { type: 'separator', label: '' },
      { label: '打招呼', id: 'greet' },
      { label: '加油', id: 'cheer' },
      { label: '休息', id: 'sleep' },
      { type: 'separator', label: '' },
      { label: '隐藏', id: 'hide' },
      { label: '关闭', id: 'close' },
    ])

    const state = stateRef.current
    if (!result) return

    switch (result) {
      case 'settings':
        openSettings()
        break
      case 'greet':
        triggerSpeak('user_click')
        break
      case 'cheer':
        if (state) { state.behavior = 'cheer'; state.animTimer = 0 }
        setExpression('excited')
        break
      case 'sleep':
        if (state) { state.behavior = 'sleep'; state.animTimer = 0 }
        setExpression('sleepy')
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
  }, [openSettings, triggerSpeak, setExpression])

  const init = useCallback(async () => {
    if (initedRef.current) return
    initedRef.current = true

    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    let personality = DEFAULT_PERSONALITY
    try {
      const savedP = await window.mulby.storage.get('pet-personality')
      if (savedP) personality = savedP as PetPersonality
    } catch {}
    const colors = DEFAULT_COLORS

    const spriteSet = SLIME_SPRITE_SET

    if (spriteSet && spriteSet.sprites['stand_neutral']) {
      useSvgRef.current = true
      canvas.style.display = 'none'
      const svgRenderer = new SvgPetRenderer(container, PET_SIZE)
      svgRenderer.loadSpriteSet(spriteSet)
      svgRendererRef.current = svgRenderer
    } else {
      useSvgRef.current = false
      const canvasRenderer = new PixelCatRenderer(canvas)
      canvasRenderer.setColors(colors)
      canvasRendererRef.current = canvasRenderer
    }

    chatRef.current = new AIChatController(personality)

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
      Math.round(state.position.y - BUBBLE_AREA_HEIGHT)
    )

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
          s.lastMousePos = { x: event.x, y: event.y }
          s.idleTimer = 0
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
      if (channel === 'settings-updated' && args[0]) {
        const { personality: newP } = args[0]
        if (newP) {
          chatRef.current?.updatePersonality(newP)
        }
      }
      if (channel === 'sprites-updated' && args[0]) {
        const { spriteSet: newS } = args[0]
        if (newS && newS.sprites['stand_neutral']) {
          useSvgRef.current = true
          if (canvas) canvas.style.display = 'none'
          if (!svgRendererRef.current) {
            svgRendererRef.current = new SvgPetRenderer(container, PET_SIZE)
          }
          svgRendererRef.current.loadSpriteSet(newS)
        } else {
          useSvgRef.current = false
          if (canvas) canvas.style.display = 'block'
          if (svgRendererRef.current) {
            svgRendererRef.current.destroy()
            svgRendererRef.current = null
          }
          if (!canvasRendererRef.current) {
            canvasRendererRef.current = new PixelCatRenderer(canvas)
            canvasRendererRef.current.setColors(colors)
          }
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
      if (s.idleTimer > 300_000) {
        s.idleTimer = 0
        triggerSpeak('idle')
      }
    }, 120_000)

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

    if (useSvgRef.current && svgRendererRef.current) {
      const pose = behaviorToPose(state.behavior)
      const baseExpr = behaviorToExpression(state.behavior)
      const expr = currentExpressionRef.current !== 'neutral'
        ? currentExpressionRef.current
        : baseExpr
      svgRendererRef.current.setPose(pose)
      svgRendererRef.current.setExpression(expr)
      svgRendererRef.current.setFlipped(state.facing === 'left')
      svgRendererRef.current.update(delta)
    } else if (canvasRendererRef.current) {
      const canvas = canvasRef.current
      if (canvas) {
        const animName = behaviorToAnimation(state.behavior, state.facing)
        canvasRendererRef.current.play(animName)
        canvasRendererRef.current.setFlipped(state.facing === 'left')
        canvasRendererRef.current.update(delta)
        canvasRendererRef.current.render()
      }
    }

    const newX = Math.round(state.position.x)
    const newY = Math.round(state.position.y - BUBBLE_AREA_HEIGHT)
    if (newX !== lastWinPosRef.current.x || newY !== lastWinPosRef.current.y) {
      lastWinPosRef.current = { x: newX, y: newY }
      window.mulby.window.setPosition(newX, newY)
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
      if (svgRendererRef.current) {
        svgRendererRef.current.destroy()
      }
    }
  }, [init])

  return (
    <div style={{ width: WIN_WIDTH, height: WIN_HEIGHT, position: 'relative' }}>
      {/* Bubble area (top) */}
      <div
        style={{
          width: WIN_WIDTH,
          height: BUBBLE_AREA_HEIGHT,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          padding: '4px 6px',
          pointerEvents: 'none',
          overflow: 'hidden',
        }}
      >
        {bubbleVisible && bubbleText && (
          <div className="bubble-container bubble-enter">
            <div className="bubble-box">
              <span className="bubble-text">{bubbleText}</span>
            </div>
            <div className="bubble-arrow" />
          </div>
        )}
      </div>

      {/* Pet area (bottom) */}
      <div
        ref={containerRef}
        onClick={() => triggerSpeak('user_click')}
        onContextMenu={e => { e.preventDefault(); showContextMenu() }}
        style={{
          width: PET_SIZE,
          height: PET_SIZE,
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <canvas
          ref={canvasRef}
          width={PET_SIZE}
          height={PET_SIZE}
          style={{
            display: 'block',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        />
      </div>
    </div>
  )
}
