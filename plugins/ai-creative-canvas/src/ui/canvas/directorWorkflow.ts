import type { DirectorCam, DirectorShot } from '../types'

export type DirectorInspectorTab = 'object' | 'character' | 'camera'

export const DIRECTOR_DEFAULT_SHOT_DURATION_MS = 4000
export const DIRECTOR_MIN_SHOT_DURATION_MS = 500
export const DIRECTOR_MAX_SHOT_DURATION_MS = 120000

export type DirectorContinuityIssueCode = 'jump-cut' | 'axis-reversal' | 'focal-jump' | 'aspect-change' | 'lighting-change'

export interface DirectorContinuityIssue {
  code: DirectorContinuityIssueCode
  severity: 'warning' | 'info'
  fromId: string
  toId: string
  message: string
}

export function normalizeDirectorShotDuration(durationMs?: number | null): number {
  if (!Number.isFinite(durationMs)) return DIRECTOR_DEFAULT_SHOT_DURATION_MS
  return Math.round(Math.max(DIRECTOR_MIN_SHOT_DURATION_MS, Math.min(DIRECTOR_MAX_SHOT_DURATION_MS, Number(durationMs))) / 100) * 100
}

export function getDirectorShotsDurationMs(shots: DirectorShot[]): number {
  return shots.reduce((total, shot) => total + normalizeDirectorShotDuration(shot.durationMs), 0)
}

export function formatDirectorDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const vectorLength = (value: [number, number, number]) => Math.hypot(value[0], value[1], value[2])
const vectorBetween = (from: [number, number, number], to: [number, number, number]): [number, number, number] => [
  to[0] - from[0],
  to[1] - from[1],
  to[2] - from[2]
]
const vectorDistance = (a: [number, number, number], b: [number, number, number]) => vectorLength(vectorBetween(a, b))
const angleBetweenDegrees = (a: [number, number, number], b: [number, number, number]) => {
  const aLength = vectorLength(a)
  const bLength = vectorLength(b)
  if (aLength < 1e-6 || bLength < 1e-6) return 0
  const cosine = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (aLength * bLength)))
  return Math.acos(cosine) * 180 / Math.PI
}

export function analyzeDirectorShotContinuity(shots: DirectorShot[]): DirectorContinuityIssue[] {
  const issues: DirectorContinuityIssue[] = []
  for (let index = 1; index < shots.length; index++) {
    const previous = shots[index - 1]
    const current = shots[index]
    if (!previous.cam || !current.cam) continue
    const previousDirection = vectorBetween(previous.cam.pos, previous.cam.target)
    const currentDirection = vectorBetween(current.cam.pos, current.cam.target)
    const directionAngle = angleBetweenDegrees(previousDirection, currentDirection)
    const positionDelta = vectorDistance(previous.cam.pos, current.cam.pos)
    const targetDelta = vectorDistance(previous.cam.target, current.cam.target)
    const previousDistance = Math.max(0.01, vectorLength(previousDirection))
    const currentDistance = Math.max(0.01, vectorLength(currentDirection))
    const distanceRatio = Math.max(previousDistance, currentDistance) / Math.min(previousDistance, currentDistance)
    const previousFocal = Math.max(1, previous.cam.focal || 35)
    const currentFocal = Math.max(1, current.cam.focal || 35)
    const focalRatio = Math.max(previousFocal, currentFocal) / Math.min(previousFocal, currentFocal)

    if (directionAngle < 15 && positionDelta < 0.65 && targetDelta < 0.45 && distanceRatio < 1.25 && focalRatio < 1.25) {
      issues.push({
        code: 'jump-cut',
        severity: 'warning',
        fromId: previous.id,
        toId: current.id,
        message: '与上一镜头的机位和景别过近，检查是否会形成跳切'
      })
    } else if (directionAngle > 150) {
      issues.push({
        code: 'axis-reversal',
        severity: 'warning',
        fromId: previous.id,
        toId: current.id,
        message: '机位方向大幅反转，检查人物视线和空间轴线'
      })
    }

    if (focalRatio >= 2 && directionAngle < 45) {
      issues.push({
        code: 'focal-jump',
        severity: 'info',
        fromId: previous.id,
        toId: current.id,
        message: `焦段从 ${Math.round(previousFocal)}mm 变为 ${Math.round(currentFocal)}mm，透视变化明显`
      })
    }
    if (previous.aspect && current.aspect && previous.aspect !== current.aspect) {
      issues.push({
        code: 'aspect-change',
        severity: 'info',
        fromId: previous.id,
        toId: current.id,
        message: `画幅从 ${previous.aspect} 变为 ${current.aspect}`
      })
    }
    if (previous.lighting && current.lighting && previous.lighting !== current.lighting) {
      issues.push({
        code: 'lighting-change',
        severity: 'info',
        fromId: previous.id,
        toId: current.id,
        message: `灯光从“${previous.lighting}”变为“${current.lighting}”`
      })
    }
  }
  return issues
}

export function inferDirectorInspectorTab(kind?: string | null): DirectorInspectorTab {
  if (kind === '人台') return 'character'
  if (kind) return 'object'
  return 'camera'
}

export function classifyDirectorShot(cam?: DirectorCam | null): string {
  if (!cam) return '镜头'
  const dx = cam.pos[0] - cam.target[0]
  const dy = cam.pos[1] - cam.target[1]
  const dz = cam.pos[2] - cam.target[2]
  const distance = Math.hypot(dx, dy, dz)
  if (distance < 1.6) return '特写'
  if (distance < 3.2) return '中景'
  if (distance < 6) return '全景'
  return '远景'
}

export function createDirectorShotSnapshot(input: {
  id: string
  name: string
  cam: DirectorCam
  thumb?: string
  aspect?: string
  lighting?: string
  durationMs?: number
  notes?: string
}): DirectorShot {
  return {
    ...input,
    durationMs: normalizeDirectorShotDuration(input.durationMs),
    notes: input.notes?.trim() || undefined,
    shotType: classifyDirectorShot(input.cam)
  }
}

export function reorderDirectorShots(shots: DirectorShot[], draggedId: string, targetId: string): DirectorShot[] {
  if (!draggedId || draggedId === targetId) return shots
  const from = shots.findIndex((shot) => shot.id === draggedId)
  const to = shots.findIndex((shot) => shot.id === targetId)
  if (from < 0 || to < 0) return shots
  const next = shots.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
