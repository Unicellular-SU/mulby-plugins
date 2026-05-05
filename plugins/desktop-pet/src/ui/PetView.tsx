import { useEffect, useRef, useCallback } from 'react'
import { PixelCatRenderer, DEFAULT_COLORS, type PetColorScheme } from './engine/sprite'
import {
  createInitialState,
  decideBehavior,
  getVelocity,
  updatePosition,
  behaviorToAnimation,
} from './engine/behavior'
import type { PetState, DisplayBounds } from './engine/types'
import { PET_SIZE } from './engine/types'
import { AIChatController, DEFAULT_PERSONALITY, type PetPersonality, type TriggerReason } from './engine/ai-chat'

const BUBBLE_WIDTH = 180
const BUBBLE_HEIGHT = 60

export default function PetView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef<PetState | null>(null)
  const boundsRef = useRef<DisplayBounds | null>(null)
  const rendererRef = useRef<PixelCatRenderer | null>(null)
  const lastTimeRef = useRef(0)
  const inputSessionRef = useRef<string | null>(null)
  const chatRef = useRef<AIChatController | null>(null)
  const idleCheckRef = useRef(0)
  const lastTypingRef = useRef(0)
  const typingCountRef = useRef(0)
  const bubbleWinRef = useRef<any>(null)
  const lastWinPosRef = useRef({ x: -1, y: -1 })

  const showBubble = useCallback(async (text: string) => {
    const bw = bubbleWinRef.current
    if (!bw) return
    try {
      await bw.postMessage('bubble-show', text)
      await bw.show()
      positionBubble()
    } catch {}
  }, [])

  const updateBubble = useCallback(async (text: string) => {
    const bw = bubbleWinRef.current
    if (!bw) return
    try {
      await bw.postMessage('bubble-update', text)
      await bw.show()
      positionBubble()
    } catch {}
  }, [])

  const positionBubble = useCallback(() => {
    const bw = bubbleWinRef.current
    const state = stateRef.current
    if (!bw || !state) return
    try {
      const x = Math.round(state.position.x - BUBBLE_WIDTH / 2 + PET_SIZE / 2)
      const y = Math.round(state.position.y - BUBBLE_HEIGHT - 4)
      bw.setPosition(x, y)
    } catch {}
  }, [])

  const triggerSpeak = useCallback(async (reason: TriggerReason) => {
    const chat = chatRef.current
    const state = stateRef.current
    if (!chat || !state) return
    if (!chat.canSpeak(reason)) return

    const text = await chat.speak(reason, state.behavior, (partial) => {
      updateBubble(partial)
    })

    if (text) {
      showBubble(text)
    }
  }, [showBubble, updateBubble])

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
        break
      case 'sleep':
        if (state) { state.behavior = 'sleep'; state.animTimer = 0 }
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
  }, [openSettings, triggerSpeak])

  const init = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const renderer = new PixelCatRenderer(canvas)
    rendererRef.current = renderer

    let personality = DEFAULT_PERSONALITY
    let colors = DEFAULT_COLORS
    try {
      const savedP = await window.mulby.storage.get('pet-personality')
      if (savedP) personality = savedP as PetPersonality
      const savedC = await window.mulby.storage.get('pet-colors')
      if (savedC) colors = savedC as PetColorScheme
    } catch {}

    renderer.setColors(colors)
    chatRef.current = new AIChatController(personality)

    const display = await window.mulby.screen.getPrimaryDisplay()
    const bounds: DisplayBounds = display.workArea
    boundsRef.current = bounds

    const state = createInitialState(bounds)
    stateRef.current = state

    await window.mulby.window.setPosition(
      Math.round(state.position.x),
      Math.round(state.position.y)
    )

    try {
      const bw = await window.mulby.window.create('?view=bubble', {
        width: BUBBLE_WIDTH,
        height: BUBBLE_HEIGHT,
        type: 'borderless',
        titleBar: false,
        transparent: true,
        alwaysOnTop: true,
        focusable: false,
        skipTaskbar: true,
        ignoreMouseEvents: true,
        forwardMouseEvents: false,
        resizable: false,
        visibleOnAllWorkspaces: true,
        visibleOnFullScreen: true,
      })
      bubbleWinRef.current = bw
      await bw.hide()
    } catch (e) {
      console.error('Create bubble window failed:', e)
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
            triggerSpeak('typing_fast')
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
        const { personality: newP, colors: newC } = args[0]
        if (newP) {
          chatRef.current?.updatePersonality(newP)
        }
        if (newC) {
          rendererRef.current?.setColors(newC)
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
      if (s.idleTimer > 300_000) {
        triggerSpeak('idle')
      }
    }, 60_000)

    lastTimeRef.current = performance.now()
    requestAnimationFrame(gameLoop)
  }, [triggerSpeak])

  const gameLoop = useCallback((timestamp: number) => {
    const state = stateRef.current
    const bounds = boundsRef.current
    const renderer = rendererRef.current
    const canvas = canvasRef.current
    if (!state || !bounds || !renderer || !canvas) {
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

    const animName = behaviorToAnimation(state.behavior, state.facing)
    renderer.play(animName)
    renderer.setFlipped(state.facing === 'left')
    renderer.update(delta)
    renderer.render()

    const newX = Math.round(state.position.x)
    const newY = Math.round(state.position.y)
    if (newX !== lastWinPosRef.current.x || newY !== lastWinPosRef.current.y) {
      lastWinPosRef.current = { x: newX, y: newY }
      window.mulby.window.setPosition(newX, newY)
      positionBubble()
    }

    requestAnimationFrame(gameLoop)
  }, [positionBubble])

  useEffect(() => {
    init()
    return () => {
      if (inputSessionRef.current) {
        window.mulby.inputMonitor.stop(inputSessionRef.current)
      }
      if (idleCheckRef.current) {
        clearInterval(idleCheckRef.current)
      }
      if (bubbleWinRef.current) {
        try { bubbleWinRef.current.close() } catch {}
      }
    }
  }, [init])

  return (
    <canvas
      ref={canvasRef}
      width={PET_SIZE}
      height={PET_SIZE}
      onClick={() => triggerSpeak('user_click')}
      onContextMenu={e => { e.preventDefault(); showContextMenu() }}
      style={{
        background: 'transparent',
        cursor: 'pointer',
        display: 'block',
      }}
    />
  )
}
