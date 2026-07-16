/**
 * 质量护栏共用类型 + 镜头语法归一化。
 *
 * 本模块刻意保持「零运行时依赖」（只做 type-only import，运行时被擦除），
 * 以便护栏纯函数可在 node 下独立单测、并能在 store 派生选择器中无副作用地反复运行。
 * 词表镜像 services/prompts.ts 的中英映射（那是本插件自有数据，非 OpenMontage 内容）。
 */
import type { Storyboard } from '../../domain/types'
import type { ShotSize, CameraMove } from '../prompts'

/** 归一化后的「镜头」最小投影——护栏只读这些字段，与完整 Storyboard 解耦，便于单测与复用。 */
export interface ShotLike {
  shotSize?: ShotSize
  camera?: CameraMove
  desc: string
  duration: number
  sceneId?: string
  dialogueCount: number
  chainFromPrev?: boolean
  /** 展示用镜号（缺省取数组下标+1）；用于 variationChecker 的「第 X 镜」定位。 */
  index?: number
}

export type QualityVerdict = 'strong' | 'acceptable' | 'revise' | 'fail'

export interface QualityDimension {
  name: string
  label: string
  /** 0..5，越高越「像幻灯片 / 越同质」 */
  score: number
  reason: string
  /** false=数据不足，已跳过，不计入均分 */
  applicable: boolean
}

export interface QualityResult {
  verdict: QualityVerdict
  /** verdict !== 'fail'（供合成/导出闸门判断） */
  ok: boolean
  /** applicable 维度的均分 */
  avg: number
  dims: QualityDimension[]
  shotCount: number
  summary: string
}

// —— 镜头语法归一化（镜像 prompts.ts 的中英词表；自带一份以保持零运行时依赖）——
const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
  'extreme-wide': '大远景', wide: '远景', full: '全景', medium: '中景', close: '近景', 'extreme-close': '特写',
}
const CAMERA_LABELS: Record<CameraMove, string> = {
  static: '固定', 'dolly-in': '推', 'dolly-out': '拉', pan: '摇', tilt: '俯仰',
  tracking: '移/跟', crane: '升降', handheld: '手持', zoom: '变焦',
}
function invert(m: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) for (const part of v.split('/')) if (part) out[part] = k
  return out
}
const TO_SHOT = invert(SHOT_SIZE_LABELS)
const TO_CAM = invert(CAMERA_LABELS)

function normShotSize(raw?: string): ShotSize | undefined {
  const s = (raw ?? '').trim()
  if (!s) return undefined
  if (s in SHOT_SIZE_LABELS) return s as ShotSize
  return TO_SHOT[s] as ShotSize | undefined
}
function normCamera(raw?: string): CameraMove | undefined {
  const s = (raw ?? '').trim()
  if (!s) return undefined
  if (s in CAMERA_LABELS) return s as CameraMove
  return TO_CAM[s] as CameraMove | undefined
}

/** 把完整 Storyboard 投影为 ShotLike（归一化中文/英文景别与运镜） */
export function storyboardToShotLike(sb: Storyboard): ShotLike {
  return {
    shotSize: normShotSize(sb.shotSize),
    camera: normCamera(sb.cameraMove),
    desc: (sb.videoDesc ?? '').trim(),
    duration: Number(sb.duration) || 0,
    sceneId: sb.sceneId,
    dialogueCount: sb.dialogues?.length ?? 0,
    chainFromPrev: sb.chainFromPrev,
    index: sb.index,
  }
}

export function shotSizeLabel(s?: string): string {
  return (s && SHOT_SIZE_LABELS[s as ShotSize]) || s || '未标'
}
export function cameraLabel(c?: string): string {
  return (c && CAMERA_LABELS[c as CameraMove]) || c || '未标'
}

/** 均分 → 评级（阈值随护栏维度数标定） */
export function verdictFromAvg(avg: number): QualityVerdict {
  if (avg < 1.2) return 'strong'
  if (avg < 2.2) return 'acceptable'
  if (avg < 3.2) return 'revise'
  return 'fail'
}

export const VERDICT_LABEL: Record<QualityVerdict, string> = {
  strong: '稳', acceptable: '可接受', revise: '建议返修', fail: '不通过',
}
