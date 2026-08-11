import type { DirectorCam, DirectorShot } from '../types'

export type DirectorInspectorTab = 'object' | 'character' | 'camera'

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
}): DirectorShot {
  return {
    ...input,
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
