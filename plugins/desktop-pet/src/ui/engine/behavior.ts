import {
  type PetState,
  type BehaviorType,
  type Point,
  type DisplayBounds,
  MOVE_SPEED,
  RUN_SPEED,
  WANDER_SPEED,
  PET_SIZE,
} from './types'

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function createInitialState(bounds: DisplayBounds): PetState {
  return {
    behavior: 'idle',
    position: {
      x: bounds.x + bounds.width / 2 - PET_SIZE / 2,
      y: bounds.y + bounds.height - PET_SIZE,
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

export function decideBehavior(state: PetState, event: InputEvent | null): BehaviorType {
  const { behavior, position, idleTimer } = state

  if (TRANSIENT_BEHAVIORS.includes(behavior) && state.animTimer < 1500) {
    return behavior
  }

  if (event) {
    state.idleTimer = 0

    if (behavior === 'sleep') return 'surprised'

    switch (event.type) {
      case 'mouseMove': {
        const petCenter = { x: position.x + PET_SIZE / 2, y: position.y + PET_SIZE / 2 }
        const mouse = { x: event.x, y: event.y }
        const dist = distance(petCenter, mouse)
        if (dist > 300) return 'chase'
        if (dist < 150 && dist > 50) return 'look'
        if (behavior === 'chase' && dist < 60) return 'idle'
        return behavior
      }

      case 'mouseDown': {
        const petCenter = { x: position.x + PET_SIZE / 2, y: position.y + PET_SIZE / 2 }
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

  if (idleTimer > 60000 && behavior === 'sit') return 'sleep'
  if (idleTimer > 30000 && behavior !== 'sleep' && behavior !== 'sit') return 'sit'
  if (idleTimer > 8000 && behavior === 'idle') return 'wander'

  return behavior
}

export function getVelocity(state: PetState, bounds: DisplayBounds): Point {
  switch (state.behavior) {
    case 'chase': {
      const dx = state.lastMousePos.x - (state.position.x + PET_SIZE / 2)
      const dy = state.lastMousePos.y - (state.position.y + PET_SIZE / 2)
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < 40) return { x: 0, y: 0 }
      const speed = dist > 200 ? RUN_SPEED : MOVE_SPEED
      return { x: (dx / dist) * speed, y: (dy / dist) * speed }
    }

    case 'wander': {
      const dx = state.wanderTarget - (state.position.x + PET_SIZE / 2)
      if (Math.abs(dx) < 10) {
        state.wanderTarget = bounds.x + Math.random() * (bounds.width - PET_SIZE)
      }
      return { x: dx > 0 ? WANDER_SPEED : -WANDER_SPEED, y: 0 }
    }

    default:
      return { x: 0, y: 0 }
  }
}

export function updatePosition(state: PetState, bounds: DisplayBounds): void {
  state.position.x += state.velocity.x
  state.position.y += state.velocity.y

  state.position.x = Math.max(bounds.x, Math.min(state.position.x, bounds.x + bounds.width - PET_SIZE))
  state.position.y = Math.max(bounds.y, Math.min(state.position.y, bounds.y + bounds.height - PET_SIZE))

  if (state.behavior === 'idle' || state.behavior === 'wander' || state.behavior === 'sit' || state.behavior === 'sleep') {
    state.position.y = bounds.y + bounds.height - PET_SIZE
  }

  if (state.velocity.x > 0.1) state.facing = 'right'
  if (state.velocity.x < -0.1) state.facing = 'left'
}

export function behaviorToAnimation(behavior: BehaviorType, facing: 'left' | 'right'): string {
  switch (behavior) {
    case 'idle': return 'idle'
    case 'chase': return facing === 'right' ? 'run_right' : 'run_left'
    case 'look': return facing === 'right' ? 'look_right' : 'look_left'
    case 'wander': return facing === 'right' ? 'walk_right' : 'walk_left'
    case 'sit': return 'sit'
    case 'sleep': return 'sleep'
    case 'jump': return 'jump'
    case 'surprised': return 'surprised'
    case 'happy': return 'happy'
    case 'cheer': return 'cheer'
    case 'wobble': return 'wobble'
    case 'celebrate': return 'celebrate'
  }
}
