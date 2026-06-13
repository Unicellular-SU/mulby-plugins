import {
  type PetState,
  type BehaviorType,
  type Point,
  type DisplayBounds,
  MOVE_SPEED,
  RUN_SPEED,
  WANDER_SPEED,
  WIN_SIZE,
} from './types'

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function createInitialState(bounds: DisplayBounds, winSize: number = WIN_SIZE): PetState {
  return {
    behavior: 'idle',
    position: {
      x: bounds.x + bounds.width / 2 - winSize / 2,
      y: bounds.y + bounds.height - winSize - 40,
    },
    velocity: { x: 0, y: 0 },
    facing: 'right',
    idleTimer: 0,
    lastMousePos: { x: 0, y: 0 },
    lastKeyTime: 0,
    keyBurstCount: 0,
    wanderTarget: bounds.x + bounds.width / 2,
    animTimer: 0,
  }
}

interface InputEvent {
  type: 'mouseMove' | 'mouseDown' | 'mouseUp' | 'mouseScroll' | 'keyDown' | 'keyUp'
  x: number
  y: number
  button?: 'left' | 'right' | 'middle'
  key?: string
  meta?: boolean
  ctrl?: boolean
  scrollDeltaY?: number
}

const TRANSIENT_BEHAVIORS: BehaviorType[] = [
  'jump', 'surprised', 'happy', 'cheer', 'wobble', 'celebrate',
]

export function decideBehavior(state: PetState, event: InputEvent | null, winSize: number = WIN_SIZE): BehaviorType {
  const { behavior, position, idleTimer } = state

  if (TRANSIENT_BEHAVIORS.includes(behavior) && state.animTimer < 1500) {
    return behavior
  }

  if (event) {
    state.idleTimer = 0

    if (behavior === 'sleep') return 'surprised'

    switch (event.type) {
      case 'mouseMove': {
        const petCenter = { x: position.x + winSize / 2, y: position.y + winSize / 2 }
        const mouse = { x: event.x, y: event.y }
        const dist = distance(petCenter, mouse)
        if (dist > 300) return 'chase'
        if (dist < 200 && dist > 80) return 'look'
        if (behavior === 'chase' && dist < CHASE_STOP_DIST + 20) return 'idle'
        return behavior
      }

      case 'mouseDown': {
        const petCenter = { x: position.x + winSize / 2, y: position.y + winSize / 2 }
        const mouse = { x: event.x, y: event.y }
        const dist = distance(petCenter, mouse)
        if (dist < 120) {
          return event.button === 'right' ? 'surprised' : 'happy'
        }
        return behavior
      }

      case 'mouseScroll':
        return 'wobble'

      case 'keyDown': {
        state.keyBurstCount++
        if (state.keyBurstCount > 15) {
          state.keyBurstCount = 0
          return 'cheer'
        }
        if (event.key === 's' && (event.meta || event.ctrl)) {
          return 'celebrate'
        }
        return behavior
      }
    }
  }

  if (event?.type !== 'keyDown') {
    state.keyBurstCount = Math.max(0, state.keyBurstCount - 0.5)
  }

  if (behavior === 'chase' || behavior === 'look') return behavior

  if (idleTimer > 60000 && behavior === 'sit') return 'sleep'
  if (idleTimer > 30000 && behavior !== 'sleep' && behavior !== 'sit') return 'sit'
  if (idleTimer > 8000 && behavior === 'idle') return 'wander'

  return behavior
}

export function stopMouseFollow(state: PetState): void {
  if (state.behavior === 'chase' || state.behavior === 'look') {
    state.behavior = 'idle'
    state.animTimer = 0
  }
  state.velocity = { x: 0, y: 0 }
}

const CHASE_STOP_DIST = 100

export function getVelocity(state: PetState, bounds: DisplayBounds, winSize: number = WIN_SIZE): Point {
  switch (state.behavior) {
    case 'chase': {
      const petCx = state.position.x + winSize / 2
      const petCy = state.position.y + winSize / 2
      const dx = state.lastMousePos.x - petCx
      const dy = state.lastMousePos.y - petCy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < CHASE_STOP_DIST) return { x: 0, y: 0 }
      const targetX = state.lastMousePos.x - (dx / dist) * CHASE_STOP_DIST
      const targetY = state.lastMousePos.y - (dy / dist) * CHASE_STOP_DIST
      const tdx = targetX - petCx
      const tdy = targetY - petCy
      const tdist = Math.sqrt(tdx * tdx + tdy * tdy)
      if (tdist < 3) return { x: 0, y: 0 }
      const speed = dist > 250 ? RUN_SPEED : MOVE_SPEED
      return { x: (tdx / tdist) * speed, y: (tdy / tdist) * speed }
    }

    case 'wander': {
      const dx = state.wanderTarget - (state.position.x + winSize / 2)
      if (Math.abs(dx) < 10) {
        state.wanderTarget = bounds.x + Math.random() * (bounds.width - winSize)
      }
      return { x: dx > 0 ? WANDER_SPEED : -WANDER_SPEED, y: 0 }
    }

    default:
      return { x: 0, y: 0 }
  }
}

export function updatePosition(state: PetState, bounds: DisplayBounds, winSize: number = WIN_SIZE): void {
  const MAX_STEP = 10
  const vx = Math.max(-MAX_STEP, Math.min(MAX_STEP, state.velocity.x))
  const vy = Math.max(-MAX_STEP, Math.min(MAX_STEP, state.velocity.y))
  state.position.x += vx
  state.position.y += vy

  state.position.x = Math.max(bounds.x, Math.min(state.position.x, bounds.x + bounds.width - winSize))
  const minY = bounds.y + 80
  state.position.y = Math.max(minY, Math.min(state.position.y, bounds.y + bounds.height - winSize))

  if (state.velocity.x > 0.1) state.facing = 'right'
  if (state.velocity.x < -0.1) state.facing = 'left'
}
