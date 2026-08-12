/**
 * 场景组变化度检查（借鉴 cinema-dna §7.7「三联至少变化四项」）。
 *
 * 抓的是现有护栏都抓不到的一类失败：一个场景组里 8 个镜头**每个单独看都没问题**，
 * 但它们的景别、机位、构图机制、光线全一样——成片放出来就是 8 张几乎相同的图配不同台词。
 * slideshowRisk 看的是全片比例，variationChecker 看的是相邻两镜，都覆盖不到"一整组同质"。
 *
 * 规则：同一 sceneId 内，相邻镜之间至少要在若干维度上发生变化；整组的维度覆盖度也要够。
 */
import type { ShotDesign, Storyboard } from '../../domain/types'

export interface SceneVariationShot {
  id: string
  index: number
  sceneId?: string
  shotSize?: string
  cameraMove?: string
  design?: ShotDesign
}

export interface SceneVariationIssue {
  sceneId: string
  storyboardIds: string[]
  shotIndexes: number[]
  severity: 'low' | 'med' | 'high'
  message: string
  suggestion: string
}

export interface SceneVariationResult {
  issues: SceneVariationIssue[]
  /** 各场景组的变化维度数，供 UI 展示 */
  groups: { sceneId: string; shots: number; variedDimensions: number }[]
}

/** cinema-dna 要求三联至少变化四项；这里取同一套维度 */
const DIMENSIONS = ['shotSize', 'cameraMove', 'viewerPosition', 'compositionMechanism', 'imagingBase'] as const

function dimensionValues(shot: SceneVariationShot): Record<(typeof DIMENSIONS)[number], string> {
  return {
    shotSize: (shot.shotSize ?? '').trim(),
    cameraMove: (shot.cameraMove ?? '').trim(),
    viewerPosition: (shot.design?.viewerPosition ?? '').trim(),
    compositionMechanism: (shot.design?.compositionMechanism ?? '').trim(),
    // 成像基底**应该**整组一致（那是风格统一），所以它不计入"需要变化"，只用于识别整组是否什么都没标
    imagingBase: (shot.design?.imagingBase ?? '').trim(),
  }
}

/** 组内实际发生变化的维度数（imagingBase 不算——它本来就该统一） */
function variedDimensionCount(shots: SceneVariationShot[]): number {
  let varied = 0
  for (const dimension of DIMENSIONS) {
    if (dimension === 'imagingBase') continue
    const values = new Set(shots.map((shot) => dimensionValues(shot)[dimension]).filter(Boolean))
    if (values.size > 1) varied += 1
  }
  return varied
}

export function checkSceneVariation(shots: SceneVariationShot[]): SceneVariationResult {
  const groups = new Map<string, SceneVariationShot[]>()
  for (const shot of shots) {
    const sceneId = shot.sceneId?.trim()
    if (!sceneId) continue
    groups.set(sceneId, [...(groups.get(sceneId) ?? []), shot])
  }

  const issues: SceneVariationIssue[] = []
  const summary: SceneVariationResult['groups'] = []

  for (const [sceneId, raw] of groups) {
    const group = [...raw].sort((a, b) => a.index - b.index)
    if (group.length < 3) continue // 两镜的组谈不上"同质"
    const varied = variedDimensionCount(group)
    summary.push({ sceneId, shots: group.length, variedDimensions: varied })

    // 整组维度覆盖：3 镜以上至少要在 2 个维度上变化，6 镜以上要 3 个
    const required = group.length >= 6 ? 3 : 2
    if (varied < required) {
      issues.push({
        sceneId,
        storyboardIds: group.map((shot) => shot.id),
        shotIndexes: group.map((shot) => shot.index + 1),
        severity: varied === 0 ? 'high' : 'med',
        message: `场景组「${sceneId}」有 ${group.length} 个镜头，但只在 ${varied} 个维度上有变化（景别/运镜/观众位置/构图机制）。成片会像同一张图配不同台词。`,
        suggestion: `至少让 ${required} 个维度动起来：换景别、换机位高度、换观看立场，或给不同镜头选不同的构图机制。`,
      })
      continue
    }

    // 相邻镜完全一样：即使整组够多样，连着两三镜一模一样仍然会露馅
    const identicalRuns: SceneVariationShot[][] = []
    let run: SceneVariationShot[] = [group[0]]
    for (let i = 1; i < group.length; i += 1) {
      const prev = dimensionValues(group[i - 1])
      const current = dimensionValues(group[i])
      const same = DIMENSIONS.filter((d) => d !== 'imagingBase').every((d) => prev[d] === current[d])
      if (same) run.push(group[i])
      else {
        if (run.length >= 3) identicalRuns.push(run)
        run = [group[i]]
      }
    }
    if (run.length >= 3) identicalRuns.push(run)

    for (const identical of identicalRuns) {
      issues.push({
        sceneId,
        storyboardIds: identical.map((shot) => shot.id),
        shotIndexes: identical.map((shot) => shot.index + 1),
        severity: 'med',
        message: `场景组「${sceneId}」里 #${identical.map((shot) => shot.index + 1).join(' #')} 连续 ${identical.length} 镜的景别、运镜和构图机制完全相同。`,
        suggestion: '给其中至少一镜换个景别或观看立场，避免连续机位重复。',
      })
    }
  }

  return { issues, groups: summary }
}

/** 从完整 Storyboard 投影 */
export function storyboardToVariationShot(sb: Storyboard): SceneVariationShot {
  return { id: sb.id, index: sb.index, sceneId: sb.sceneId, shotSize: sb.shotSize, cameraMove: sb.cameraMove, design: sb.shotDesign }
}
