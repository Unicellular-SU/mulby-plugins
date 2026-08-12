import type { DirectorCam } from '../types'

export interface DirectorCameraPreset {
  id: string
  label: string
  description: string
  focal: number
  forward: number
  side: number
  lift: number
  targetLift: number
  scope: 'subject' | 'scene'
}

export interface DirectorCameraPresetContext {
  target: [number, number, number]
  forward: [number, number, number]
  right: [number, number, number]
  scale: number
}

export const DIRECTOR_CAMERA_PRESETS: DirectorCameraPreset[] = [
  { id: 'portrait', label: '正面特写', description: '面部和肩部', focal: 70, forward: 1.45, side: 0, lift: 0.08, targetLift: 0.5, scope: 'subject' },
  { id: 'medium-front', label: '正面中景', description: '腰部以上', focal: 50, forward: 2.35, side: 0, lift: 0.12, targetLift: 0.08, scope: 'subject' },
  { id: 'profile-left', label: '左侧面', description: '左侧轮廓', focal: 55, forward: 0.12, side: -2.8, lift: 0.12, targetLift: 0.08, scope: 'subject' },
  { id: 'profile-right', label: '右侧面', description: '右侧轮廓', focal: 55, forward: 0.12, side: 2.8, lift: 0.12, targetLift: 0.08, scope: 'subject' },
  { id: 'low-wide', label: '低机位全景', description: '强化主体力量', focal: 32, forward: 4.6, side: 0, lift: -0.55, targetLift: 0, scope: 'scene' },
  { id: 'high-wide', label: '高机位全景', description: '交代空间关系', focal: 32, forward: 4.2, side: 0, lift: 2.8, targetLift: 0, scope: 'scene' },
  { id: 'dialogue', label: '双人对话', description: '居中覆盖双人', focal: 45, forward: 4, side: 0.8, lift: 0.2, targetLift: 0.05, scope: 'scene' },
  { id: 'product', label: '产品 45°', description: '三分之四视角', focal: 65, forward: 2.2, side: 1.45, lift: 0.5, targetLift: 0, scope: 'subject' }
]

const addScaled = (base: [number, number, number], vector: [number, number, number], amount: number) => {
  base[0] += vector[0] * amount
  base[1] += vector[1] * amount
  base[2] += vector[2] * amount
}

export function createDirectorPresetCamera(id: string, context: DirectorCameraPresetContext): DirectorCam {
  const preset = DIRECTOR_CAMERA_PRESETS.find((item) => item.id === id) || DIRECTOR_CAMERA_PRESETS[1]
  const scale = Math.max(0.45, Math.min(2.5, context.scale || 1))
  const target: [number, number, number] = [...context.target]
  target[1] += preset.targetLift * scale
  const pos: [number, number, number] = [...target]
  addScaled(pos, context.forward, preset.forward * scale)
  addScaled(pos, context.right, preset.side * scale)
  pos[1] += preset.lift * scale
  return { pos, target, focal: preset.focal }
}
