/**
 * 交付承诺契约（借鉴 OpenMontage `lib/delivery_promise.py` 的**思路**，按本插件 ffmpeg-concat 合成路径自研重写）。
 *
 * 防最致命的静默失败：承诺「运动主导」的成片，实际拼出来一串静态关键帧（i2v 没跑/失败）或图文卡。
 * 关键洞见（直接照搬思想）：**动画图文卡 / 静帧 不计为「运动」**。
 *
 * 用法：合成/导出前，把时间线各镜段投影成 CutLike[]，按项目的交付承诺类型 validateCuts，
 * 运动占比不达标 / 完全无视频产物 → 产出 violations，交由 #4 composeGate 决定阻断或警告。
 * 纯函数、零运行时依赖、可独立单测。
 */
import type { QualityVerdict } from './types'
import { verdictFromAvg } from './types'
import { ratio, clamp, round1, pct } from './util'
import type { Severity } from './variationChecker'

/** 交付承诺类型 */
export type DeliveryPromiseKind =
  | 'motion_led' // 运动主导（必须有视频、运动占比高）
  | 'source_led' // 素材主导（实拍/库存视频为主）
  | 'data_explainer' // 数据讲解（图表/图文为主，可静）
  | 'teacher_explainer' // 口播讲解（讲解为主，可静）
  | 'hybrid' // 图文混合
  | 'still_led' // 静帧主导（明确以静图成片）

interface PromiseRule {
  label: string
  /** 是否允许大量静帧兜底 */
  stillFallbackAllowed: boolean
  /** 是否必须产出视频 */
  requiresVideoGeneration: boolean
  /** 最低运动占比（real-motion 镜段 / 总镜段） */
  minMotionRatio: number
}

export const PROMISE_RULES: Record<DeliveryPromiseKind, PromiseRule> = {
  motion_led: { label: '运动主导', stillFallbackAllowed: false, requiresVideoGeneration: true, minMotionRatio: 0.7 },
  source_led: { label: '素材主导', stillFallbackAllowed: false, requiresVideoGeneration: false, minMotionRatio: 0.3 },
  hybrid: { label: '图文混合', stillFallbackAllowed: true, requiresVideoGeneration: false, minMotionRatio: 0.2 },
  data_explainer: { label: '数据讲解', stillFallbackAllowed: true, requiresVideoGeneration: false, minMotionRatio: 0.0 },
  teacher_explainer: { label: '口播讲解', stillFallbackAllowed: true, requiresVideoGeneration: false, minMotionRatio: 0.0 },
  still_led: { label: '静帧主导', stillFallbackAllowed: true, requiresVideoGeneration: false, minMotionRatio: 0.0 },
}

/** 时间线镜段的最小投影（由 VideoTrack/Clip 在 #4 接线时产出） */
export interface CutLike {
  /** 是否有真实视频产物（有 Clip.videoFilePath 即 true） */
  hasVideo?: boolean
  /** 文件路径/URL（用扩展名兜底判断） */
  source?: string
  /** 段类型：video/animation/avatar(=运动) | text/chart/...(=图文幻灯) | 其余按静帧 */
  kind?: string
  durationSec?: number
}

export interface DeliveryViolation {
  code: string
  severity: Severity
  message: string
  suggestion: string
}

export interface DeliveryResult {
  kind: DeliveryPromiseKind
  label: string
  total: number
  motionCuts: number
  slideCuts: number
  stillCuts: number
  motionRatio: number
  /** 无 high 级违规即视为通过（合成闸门据此） */
  ok: boolean
  verdict: QualityVerdict
  score: number
  violations: DeliveryViolation[]
  summary: string
}

const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi']
const MOTION_KINDS = new Set(['video', 'animation', 'avatar', 'clip'])
const SLIDE_KINDS = new Set([
  'text', 'text_card', 'stat', 'stat_card', 'chart', 'bar_chart', 'line_chart', 'pie_chart',
  'kpi', 'kpi_grid', 'comparison', 'title', 'hero_title', 'callout',
])

function ext(s?: string): string {
  const m = (s ?? '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)
  return m ? m[1] : ''
}

/** 把一个镜段分类为 motion / slide / still（动画图文卡不算 motion）。 */
export function classifyCut(cut: CutLike): 'motion' | 'slide' | 'still' {
  if (cut.hasVideo) return 'motion'
  const k = (cut.kind ?? '').toLowerCase()
  if (MOTION_KINDS.has(k)) return 'motion'
  if (VIDEO_EXT.includes(ext(cut.source))) return 'motion'
  if (SLIDE_KINDS.has(k)) return 'slide'
  return 'still'
}

const VIOLATION_WEIGHT: Record<Severity, number> = { low: 0.5, med: 1.0, high: 2.5 }

/** 按交付承诺类型校验时间线镜段，计算运动占比并产出违规。 */
export function validateCuts(cuts: CutLike[], kind: DeliveryPromiseKind): DeliveryResult {
  const rule = PROMISE_RULES[kind]
  const total = cuts.length
  let motion = 0
  let slide = 0
  let still = 0
  for (const c of cuts) {
    const t = classifyCut(c)
    if (t === 'motion') motion += 1
    else if (t === 'slide') slide += 1
    else still += 1
  }
  const motionRatio = ratio(motion, total)

  if (total === 0) {
    return {
      kind, label: rule.label, total: 0, motionCuts: 0, slideCuts: 0, stillCuts: 0, motionRatio: 0,
      ok: true, verdict: 'strong', score: 0, violations: [], summary: `无可校验镜段（${rule.label}）。`,
    }
  }

  const violations: DeliveryViolation[] = []
  if (rule.requiresVideoGeneration && motion === 0) {
    violations.push({
      code: 'no_motion_at_all', severity: 'high',
      message: `承诺「${rule.label}」却没有任何视频产物`,
      suggestion: '先把关键镜跑出 i2v/t2v 视频，或把交付类型改为静帧主导(still_led)。',
    })
  }
  if (motionRatio < rule.minMotionRatio) {
    violations.push({
      code: 'motion_ratio_low', severity: motionRatio < rule.minMotionRatio * 0.5 ? 'high' : 'med',
      message: `运动占比 ${pct(motionRatio)}% 低于「${rule.label}」承诺的 ${pct(rule.minMotionRatio)}%`,
      suggestion: '补足运动镜（i2v/t2v），或下调交付承诺类型。',
    })
  }
  const nonMotionRatio = ratio(slide + still, total)
  if (!rule.stillFallbackAllowed && nonMotionRatio > 0.5) {
    violations.push({
      code: 'still_fallback_overflow', severity: 'high',
      message: `${pct(nonMotionRatio)}% 镜段是静帧/图文，违背「${rule.label}」`,
      suggestion: '若确为静帧短片，请显式改用 still_led；否则补运动镜。',
    })
  }

  const score = round1(clamp(violations.reduce((a, v) => a + VIOLATION_WEIGHT[v.severity], 0), 0, 5))
  const verdict = verdictFromAvg(score)
  const ok = !violations.some((v) => v.severity === 'high')
  const summary =
    violations.length === 0
      ? `交付承诺达成：${rule.label} · 运动占比 ${pct(motionRatio)}%。`
      : `交付承诺风险 ${violations.length} 条（${rule.label} · 运动 ${pct(motionRatio)}% / 需 ${pct(rule.minMotionRatio)}%）。`
  return {
    kind, label: rule.label, total, motionCuts: motion, slideCuts: slide, stillCuts: still,
    motionRatio: round1(motionRatio), ok, verdict, score, violations, summary,
  }
}

export interface BriefHints {
  /** 用户意图/题材文本 */
  intent?: string
  /** 是否已配置视频模型 */
  hasVideoModel?: boolean
}

/** 由项目意图播种交付承诺类型（studio agent 规划阶段调用）。 */
export function classifyFromBrief(h: BriefHints): DeliveryPromiseKind {
  const t = (h.intent ?? '').toLowerCase()
  if (/数据|图表|可视化|chart|data|统计/.test(t)) return 'data_explainer'
  if (/口播|讲解|教程|课程|teach|narrat|explain|tutorial/.test(t)) return 'teacher_explainer'
  if (/素材|实拍|库存|footage|stock|纪录|混剪/.test(t)) return 'source_led'
  if (/图文|幻灯|slide|静态|静帧/.test(t)) return 'still_led'
  if (h.hasVideoModel) return 'motion_led'
  return 'hybrid'
}
