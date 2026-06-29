/**
 * 合成闸门（借鉴 OpenMontage `tools/video/video_compose.py` 的 _pre_compose_validation **两段式思路**自研）。
 *
 * 把 #1 反幻灯片 / #2 结构变化 / #3 交付承诺 三套护栏汇聚成「渲染前阻断 + 渲染后审计」的 choke point：
 *   · 渲染前（evaluateComposeGate）：对**计划中的全部分镜**评估，产出 blocks（应阻断）/ warnings（仅提醒）。
 *   · 渲染后（auditComposed）：对比「计划镜数 vs 实际合成镜数」，识别 motion_led 承诺被静默降级
 *     （本插件 composeProject 会跳过无视频的分镜——这正是「成片偷偷变短/变静」的来源）。
 *
 * 纯函数、零运行时依赖（ProjectDoc 为 type-only import），可独立单测。
 * 接线见 studio/services/compose.ts。
 */
import type { ProjectDoc } from '../../domain/types'
import type { QualityResult } from './types'
import { storyboardToShotLike } from './types'
import { round1, pct } from './util'
import { scoreSlideshowRisk } from './slideshowRisk'
import { checkVariation, type VariationResult } from './variationChecker'
import {
  validateCuts, classifyFromBrief, PROMISE_RULES,
  type CutLike, type DeliveryResult, type DeliveryPromiseKind,
} from './deliveryPromise'

/** 计划分镜 → ShotLike[]（按 index 排序，喂 #1/#2） */
export function projectToShots(doc: ProjectDoc) {
  return [...doc.storyboards].sort((a, b) => a.index - b.index).map(storyboardToShotLike)
}

/** 计划分镜 → CutLike[]（反映每镜当前产出状态：有视频=motion / 仅关键帧=still；喂 #3） */
export function projectToCuts(doc: ProjectDoc): CutLike[] {
  const ordered = [...doc.storyboards].sort((a, b) => a.index - b.index)
  return ordered.map((sb) => {
    const t = doc.track.find((x) => x.storyboardIds.includes(sb.id))
    const clip = t
      ? doc.clips.find((c) => c.id === (t.selectClipId || t.clipIds[0]))
      : doc.clips.find((c) => c.storyboardId === sb.id && c.state === 'done')
    const hasVideo = !!(clip && (clip.videoFilePath || clip.videoUrl) && clip.state !== 'failed')
    const source = clip?.videoFilePath || clip?.videoUrl
    const kind = t?.clipAssetId ? 'clip' : hasVideo ? 'video' : sb.keyframeImageId ? 'image' : 'still'
    return { hasVideo, source, kind, durationSec: clip?.durationSec || sb.duration }
  })
}

export interface ComposeGateResult {
  /** 是否存在应阻断项（严格模式下据此中止合成） */
  blocked: boolean
  slideshow: QualityResult
  variation: VariationResult
  delivery: DeliveryResult
  /** 解析出的交付承诺类型 */
  promiseKind: DeliveryPromiseKind
  /** 应阻断的问题（人读） */
  blocks: string[]
  /** 仅提醒（不阻断） */
  warnings: string[]
  summary: string
}

/**
 * 渲染前评估：聚合三护栏。
 * 阻断口径：交付承诺 high 违规 / 幻灯片风险 fail → block；幻灯片 revise、结构同质 lint → warn（结构 lint 不硬阻断）。
 */
export function evaluateComposeGate(
  doc: ProjectDoc,
  opts?: { promiseKind?: DeliveryPromiseKind }
): ComposeGateResult {
  const shots = projectToShots(doc)
  const cuts = projectToCuts(doc)
  const promiseKind =
    opts?.promiseKind ??
    classifyFromBrief({
      intent: [doc.meta.genre, doc.meta.intro, doc.meta.directorManual].filter(Boolean).join(' '),
      hasVideoModel: !!doc.meta.videoModel,
    })

  const slideshow = scoreSlideshowRisk(shots)
  const variation = checkVariation(shots)
  const delivery = validateCuts(cuts, promiseKind)

  const blocks: string[] = []
  const warnings: string[] = []

  for (const v of delivery.violations) {
    const line = `交付承诺·${v.message}（${v.suggestion}）`
    if (v.severity === 'high') blocks.push(line)
    else warnings.push(line)
  }
  if (slideshow.verdict === 'fail') blocks.push(`幻灯片风险·${slideshow.summary}`)
  else if (slideshow.verdict === 'revise') warnings.push(`幻灯片风险·${slideshow.summary}`)
  if (variation.verdict === 'fail' || variation.verdict === 'revise') warnings.push(`结构同质·${variation.summary}`)

  const blocked = blocks.length > 0
  const summary = blocked
    ? `合成闸门：${blocks.length} 项需修正、${warnings.length} 项提醒`
    : warnings.length
      ? `合成闸门：${warnings.length} 项提醒，可继续`
      : '合成闸门：质量检查通过'
  return { blocked, slideshow, variation, delivery, promiseKind, blocks, warnings, summary }
}

export interface ComposeAudit {
  plannedShots: number
  composedClips: number
  droppedShots: number
  motionRatio: number
  /** motion_led 类承诺下实际运动占比过低 = 静默降级 */
  silentDowngrade: boolean
  message: string
}

/** 渲染后审计：对比计划镜数 vs 实际合成镜数，识别静默降级。 */
export function auditComposed(doc: ProjectDoc, composedClipCount: number, promiseKind: DeliveryPromiseKind): ComposeAudit {
  const planned = doc.storyboards.length
  const dropped = Math.max(0, planned - composedClipCount)
  const motionRatio = planned > 0 ? composedClipCount / planned : 0
  const rule = PROMISE_RULES[promiseKind]
  const silentDowngrade = rule.requiresVideoGeneration && motionRatio < Math.max(0.5, rule.minMotionRatio * 0.7)
  const message =
    dropped > 0
      ? `成片审计：计划 ${planned} 镜，实际合成 ${composedClipCount} 镜，${dropped} 镜因无视频被丢弃（运动占比 ${pct(motionRatio)}%）${silentDowngrade ? ' ⚠ 疑似静默降级' : ''}`
      : `成片审计：${composedClipCount} 镜全部合成（${rule.label}）`
  return { plannedShots: planned, composedClips: composedClipCount, droppedShots: dropped, motionRatio: round1(motionRatio), silentDowngrade, message }
}
