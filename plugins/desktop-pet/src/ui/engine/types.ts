export type BehaviorType =
  | 'idle'
  | 'chase'
  | 'look'
  | 'wander'
  | 'sit'
  | 'sleep'
  | 'jump'
  | 'surprised'
  | 'happy'
  | 'cheer'
  | 'wobble'
  | 'celebrate'

export type AnimationName =
  | 'idle'
  | 'walk_left'
  | 'walk_right'
  | 'run_left'
  | 'run_right'
  | 'jump'
  | 'sit'
  | 'sleep'
  | 'surprised'
  | 'happy'
  | 'cheer'
  | 'look_left'
  | 'look_right'
  | 'wobble'
  | 'celebrate'

export interface Point {
  x: number
  y: number
}

export interface PetState {
  behavior: BehaviorType
  position: Point
  velocity: Point
  facing: 'left' | 'right'
  idleTimer: number
  lastMousePos: Point
  lastKeyTime: number
  keyBurstCount: number
  wanderTarget: number
  animTimer: number
}

export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

export const MOVE_SPEED = 3
export const RUN_SPEED = 7
export const WANDER_SPEED = 1.2
export const PET_SIZE = 120
