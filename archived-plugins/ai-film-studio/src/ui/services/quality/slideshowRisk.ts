/**
 * 反幻灯片风险评分器（借鉴 OpenMontage `lib/slideshow_risk.py` 的**思路**，按本插件 Storyboard 真实字段自研重写）。
 *
 * 在「花钱生成关键帧/视频之前」就用纯数据判断：这套分镜成片会不会像一串无聊的静态幻灯片。
 * 零 LLM、零网络、纯数组运算——可在 store 派生选择器中随分镜变更实时重算。
 *
 * 维度按本插件**实际拥有的字段**标定（OpenMontage 原版依赖的 shotIntent/lightingKey/informationRole
 * 本插件分镜模型里没有，故改为：景别 / 运镜 / 时长节拍 / 画面描述 / 场景 五维。映射说明见 docs/openmontage-borrowings.md）。
 */
import type { ShotLike, QualityDimension, QualityResult } from './types'
import { verdictFromAvg, VERDICT_LABEL, shotSizeLabel } from './types'
import { ratio, countBy, topCount, mean, stdev, clamp, round1, pct } from './util'

const MIN_SHOTS = 3

/** 维1 景别重复：单一景别过度集中 / 大量未标景别 / 景别零变化 */
function dimFramingRepetition(shots: ShotLike[]): QualityDimension {
  const n = shots.length
  const specified = shots.filter((s) => s.shotSize)
  const missingRatio = ratio(n - specified.length, n)
  const counts = countBy(specified, (s) => s.shotSize)
  const top = topCount(counts)
  const dominant = ratio(top.count, specified.length)
  let score = 0
  const why: string[] = []
  if (missingRatio > 0.6) { score += 1.5; why.push(`${pct(missingRatio)}% 镜头未标景别`) }
  if (specified.length) {
    if (dominant > 0.7) { score += 2.5; why.push(`「${shotSizeLabel(top.key)}」占 ${pct(dominant)}%`) }
    else if (dominant > 0.5) { score += 1.5; why.push(`「${shotSizeLabel(top.key)}」占 ${pct(dominant)}%`) }
  }
  if (specified.length >= 4 && counts.size <= 1) { score += 1.5; why.push('景别几乎无变化') }
  score = clamp(score, 0, 5)
  return {
    name: 'framing_repetition', label: '景别重复', applicable: true, score: round1(score),
    reason: why.length ? `景别同质：${why.join('、')}。` : '景别分布健康。',
  }
}

/** 维2 运镜停滞：固定/无运镜占比过高，或运动镜头动作单一 */
function dimCameraStasis(shots: ShotLike[]): QualityDimension {
  const n = shots.length
  const staticOrEmpty = shots.filter((s) => !s.camera || s.camera === 'static').length
  const staticRatio = ratio(staticOrEmpty, n)
  const moving = shots.filter((s) => s.camera && s.camera !== 'static')
  const moveCounts = countBy(moving, (s) => s.camera)
  let score = staticRatio * 4
  const why: string[] = []
  if (staticRatio > 0) why.push(`${pct(staticRatio)}% 镜头固定/无运镜`)
  if (moving.length >= 3 && moveCounts.size <= 1) { score += 1; why.push('运动镜头动作单一') }
  score = clamp(score, 0, 5)
  return {
    name: 'camera_stasis', label: '运镜停滞', applicable: true, score: round1(score),
    reason: score >= 1 ? `画面缺乏运动：${why.join('、')}——静图久坐易显幻灯片。` : '运镜分布健康。',
  }
}

/** 维3 时长节拍：所有镜头几乎等长 = 机械节拍，缺少长短交替的剪辑呼吸 */
function dimDurationMetronome(shots: ShotLike[]): QualityDimension {
  const durs = shots.map((s) => s.duration).filter((d) => d > 0)
  if (durs.length < 3) {
    return { name: 'duration_metronome', label: '时长节拍', applicable: false, score: 0, reason: '有效时长样本不足，跳过。' }
  }
  const counts = new Map<number, number>()
  for (const d of durs) counts.set(d, (counts.get(d) ?? 0) + 1)
  let modalCount = 0
  for (const c of counts.values()) if (c > modalCount) modalCount = c
  const modalRatio = ratio(modalCount, durs.length)
  const m = mean(durs)
  const cv = m ? stdev(durs) / m : 0
  let score = 0
  const why: string[] = []
  if (modalRatio > 0.8) { score += 2.5; why.push(`${pct(modalRatio)}% 镜头等长`) }
  else if (modalRatio > 0.6) { score += 1.2; why.push(`${pct(modalRatio)}% 镜头同长`) }
  if (cv < 0.12) { score += 1.5; why.push('时长几乎无起伏') }
  score = clamp(score, 0, 5)
  return {
    name: 'duration_metronome', label: '时长节拍', applicable: true, score: round1(score),
    reason: score >= 1 ? `节奏机械：${why.join('、')}——缺少长短交替的剪辑节奏。` : '时长节奏有变化。',
  }
}

/** 维4 画面雷同：画面描述空缺/极短，或多镜描述高度近似（模板化分镜） */
function dimDescriptionVariety(shots: ShotLike[]): QualityDimension {
  const n = shots.length
  const descs = shots.map((s) => s.desc)
  const emptyShort = descs.filter((d) => d.length < 6).length
  const emptyRatio = ratio(emptyShort, n)
  const nonEmpty = descs.filter((d) => d.length >= 6)
  const keys = new Set(nonEmpty.map((d) => d.slice(0, 24)))
  const distinctRatio = nonEmpty.length ? ratio(keys.size, nonEmpty.length) : 1
  let score = 0
  const why: string[] = []
  if (emptyRatio > 0.3) { score += emptyRatio * 3; why.push(`${pct(emptyRatio)}% 画面描述空缺/极短`) }
  if (distinctRatio < 0.6) { score += (0.6 - distinctRatio) * 6; why.push('多镜画面描述高度雷同') }
  score = clamp(score, 0, 5)
  return {
    name: 'description_variety', label: '画面雷同', applicable: true, score: round1(score),
    reason: score >= 1 ? `画面同质：${why.join('、')}。` : '画面描述区分度健康。',
  }
}

/** 维5 场景停滞：跨多镜长期不换景（仅在场景标注足够时评估） */
function dimSceneStagnation(shots: ShotLike[]): QualityDimension {
  const n = shots.length
  const withScene = shots.filter((s) => s.sceneId)
  if (withScene.length < n * 0.5) {
    return { name: 'scene_stagnation', label: '场景停滞', applicable: false, score: 0, reason: '场景标注不足，跳过。' }
  }
  const scenes = new Set(withScene.map((s) => s.sceneId))
  const perShot = ratio(scenes.size, n)
  let score = 0
  let why = ''
  if (n >= 6 && scenes.size === 1) { score = 3; why = '全片仅 1 个场景' }
  else if (perShot < 0.2) { score = 2; why = `仅 ${scenes.size} 个场景跨 ${n} 镜` }
  else if (perShot < 0.35) { score = 1; why = '场景切换偏少' }
  return {
    name: 'scene_stagnation', label: '场景停滞', applicable: true, score: round1(score),
    reason: score >= 1 ? `${why}——空间长期不变易显呆板。` : '场景切换健康。',
  }
}

/**
 * 对一组镜头打「幻灯片风险」分。镜头数 < 3 时样本不足，直接判 strong 并跳过。
 * 返回每维分数 + 人读 reason + 汇总评级，供 QualityPanel 展示与合成闸门（#4）判断。
 */
export function scoreSlideshowRisk(shots: ShotLike[]): QualityResult {
  const n = shots.length
  if (n < MIN_SHOTS) {
    return {
      verdict: 'strong', ok: true, avg: 0, dims: [], shotCount: n,
      summary: `镜头数 ${n} < ${MIN_SHOTS}，样本不足，跳过幻灯片风险评估。`,
    }
  }
  const dims = [
    dimFramingRepetition(shots),
    dimCameraStasis(shots),
    dimDurationMetronome(shots),
    dimDescriptionVariety(shots),
    dimSceneStagnation(shots),
  ]
  const active = dims.filter((d) => d.applicable)
  const avg = round1(mean(active.map((d) => d.score)))
  const verdict = verdictFromAvg(avg)
  const worst = [...active].sort((a, b) => b.score - a.score)[0]
  const summary =
    verdict === 'strong'
      ? `镜头结构健康（幻灯片风险 ${avg}/5）。`
      : `幻灯片风险 ${avg}/5 · ${VERDICT_LABEL[verdict]}；最突出：${worst?.label}（${worst?.score}）。`
  return { verdict, ok: verdict !== 'fail', avg, dims, shotCount: n, summary }
}
