import type { DirectorPoseControls } from './directorMannequin'

export const DIRECTOR_JOINT_NAMES = [
  '骨盆', '胸', '颈', '头',
  '左肩', '左肘', '左腕', '右肩', '右肘', '右腕',
  '左髋', '左膝', '左踝', '右髋', '右膝', '右踝'
] as const

export type DirectorJointName = (typeof DIRECTOR_JOINT_NAMES)[number]
export type DirectorJointAxis = 0 | 1 | 2

export interface DirectorPoseSafetyIssue {
  severity: 'warning' | 'error'
  joint: string
  axis?: DirectorJointAxis
  value: number
  limit: number
  message: string
}

export interface DirectorPoseSafetySummary {
  level: 'safe' | 'warning' | 'error'
  issues: DirectorPoseSafetyIssue[]
}

export const DIRECTOR_JOINT_GROUPS: { label: string; joints: DirectorJointName[] }[] = [
  { label: '躯干', joints: ['骨盆', '胸', '颈', '头'] },
  { label: '手臂', joints: ['左肩', '左肘', '左腕', '右肩', '右肘', '右腕'] },
  { label: '腿部', joints: ['左髋', '左膝', '左踝', '右髋', '右膝', '右踝'] }
]

// 相对绑定姿势的局部旋转软限制。它不是医学诊断，只负责拦截常见的关节反折和超大扭转。
const DEFAULT_LIMIT: [number, number, number] = [120, 120, 120]
export const DIRECTOR_JOINT_LIMITS: Record<DirectorJointName, [number, number, number]> = {
  骨盆: [65, 70, 50],
  胸: [65, 75, 55],
  颈: [55, 75, 45],
  头: [65, 85, 50],
  左肩: [150, 125, 150],
  左肘: [155, 28, 28],
  左腕: [95, 90, 75],
  右肩: [150, 125, 150],
  右肘: [155, 28, 28],
  右腕: [95, 90, 75],
  左髋: [135, 90, 80],
  左膝: [160, 25, 25],
  左踝: [80, 65, 55],
  右髋: [135, 90, 80],
  右膝: [160, 25, 25],
  右踝: [80, 65, 55]
}

const AXIS_LABELS = ['X', 'Y', 'Z'] as const

export function getDirectorJointLimits(joint: string): [number, number, number] {
  return DIRECTOR_JOINT_LIMITS[joint as DirectorJointName] || DEFAULT_LIMIT
}

export function clampDirectorJointDegrees(joint: string, axis: DirectorJointAxis, value: number): number {
  const limit = getDirectorJointLimits(joint)[axis]
  if (!Number.isFinite(value)) return 0
  return Math.max(-limit, Math.min(limit, value))
}

export function validateDirectorJointRotations(
  rotations: Record<string, [number, number, number]>
): DirectorPoseSafetySummary {
  const issues: DirectorPoseSafetyIssue[] = []
  for (const [joint, values] of Object.entries(rotations)) {
    const limits = getDirectorJointLimits(joint)
    values.forEach((value, axis) => {
      const limit = limits[axis]
      if (!Number.isFinite(value)) {
        issues.push({ severity: 'error', joint, axis: axis as DirectorJointAxis, value, limit, message: `${joint}包含无效旋转` })
        return
      }
      const ratio = Math.abs(value) / limit
      if (ratio > 1) {
        issues.push({
          severity: 'error',
          joint,
          axis: axis as DirectorJointAxis,
          value,
          limit,
          message: `${joint} ${AXIS_LABELS[axis]} 轴超出安全范围`
        })
      } else if (ratio >= 0.88) {
        issues.push({
          severity: 'warning',
          joint,
          axis: axis as DirectorJointAxis,
          value,
          limit,
          message: `${joint} ${AXIS_LABELS[axis]} 轴接近活动上限`
        })
      }
    })
  }
  return {
    level: issues.some((issue) => issue.severity === 'error') ? 'error' : issues.length ? 'warning' : 'safe',
    issues
  }
}

const controlLimit = (key: string): { min: number; max: number } => {
  if (key === 'body.offsetY') return { min: -0.8, max: 0.4 }
  if (key.endsWith('Elbow.bend') || key.endsWith('Knee.bend')) return { min: 0, max: 155 }
  if (key.endsWith('Shoulder.pitch')) return { min: -130, max: 130 }
  if (key.endsWith('Shoulder.spread')) return { min: -115, max: 115 }
  if (key.endsWith('Shoulder.twist')) return { min: -90, max: 90 }
  if (key.endsWith('Hip.pitch')) return { min: -75, max: 125 }
  if (key.endsWith('Hip.spread') || key.endsWith('Hip.twist')) return { min: -75, max: 75 }
  if (/^(body|torso|head)\./.test(key)) return { min: -80, max: 80 }
  if (/(Hand|Foot)\./.test(key)) return { min: -95, max: 95 }
  return { min: -180, max: 180 }
}

export function validateDirectorPoseControls(controls: DirectorPoseControls): DirectorPoseSafetySummary {
  const issues: DirectorPoseSafetyIssue[] = []
  for (const [key, value] of Object.entries(controls)) {
    const { min, max } = controlLimit(key)
    if (!Number.isFinite(value) || value < min || value > max) {
      issues.push({
        severity: 'error',
        joint: key,
        value,
        limit: Math.max(Math.abs(min), Math.abs(max)),
        message: `${key} 超出姿势预设安全范围`
      })
    }
  }
  return { level: issues.length ? 'error' : 'safe', issues }
}

export const DIRECTOR_POSE_GROUPS: { id: string; label: string; poses: string[] }[] = [
  { id: 'basic', label: '基础', poses: ['站立', 'T型', '行走', '跑步'] },
  { id: 'low', label: '低姿态', poses: ['坐姿', '蹲下', '单膝跪', '双膝跪'] },
  { id: 'acting', label: '表演', poses: ['叉腰', '倚靠', '鞠躬', '思考', '招手', '伸手', '抱臂', '看手机'] },
  { id: 'action', label: '动作', poses: ['格斗', '踢球', '投掷', '推进'] }
]
