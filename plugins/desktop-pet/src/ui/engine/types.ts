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
/** 宠物视觉框边长(内层渲染容器) */
export const PET_SIZE = 120
/** 宠物四周预留的动画余量:窗口每边比宠物视觉框大这么多,容纳跳跃/悬浮等位移不被窗口裁切 */
export const PET_MARGIN = 30
/** 宠物窗口边长 = 宠物视觉框 + 两侧动画余量;position 始终表示窗口左上角 */
export const WIN_SIZE = PET_SIZE + PET_MARGIN * 2
