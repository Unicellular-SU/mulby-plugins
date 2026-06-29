/**
 * 结构变化 lint（借鉴 OpenMontage `lib/variation_checker.py` 的**思路**，按本插件真实字段自研重写）。
 *
 * 与 slideshowRisk（全局比例评分）互补：本检查器抓 #1 不覆盖的两类问题——
 *   1) **相邻性**：连续同景别 / 连续等长 / 连续同场景 / 相邻画面描述重复（全局比例看不出来）；
 *   2) **词法**：画面描述里的笼统套话（generic phrases 黑名单）。
 * 产出 violations[]（每条含定位镜号 + 可读信息 + quick-fix 建议），供 storyboard 行内 lint 标记与建议 chips。
 *
 * 字段适配：报告原 8 规则里依赖 lightingKey/hero_moment/texture_keywords/shotIntent 的几条本插件无对应字段，
 * 改为 missing_grammar（景别+运镜双缺）/ scene_run（连续同场景）等可由真实数据计算的等价检查。
 */
import type { ShotLike, QualityVerdict } from './types'
import { verdictFromAvg, VERDICT_LABEL, shotSizeLabel } from './types'
import { ratio, countBy, topCount, clamp, round1, pct } from './util'

export type Severity = 'low' | 'med' | 'high'

export interface VariationViolation {
  rule: string
  label: string
  severity: Severity
  /** 涉及的展示镜号（1-based），全局问题为空数组 */
  shotIndices: number[]
  message: string
  suggestion: string
}

export interface VariationResult {
  verdict: QualityVerdict
  ok: boolean
  /** 0..5，越高越同质（按违规严重度加权） */
  score: number
  violations: VariationViolation[]
  summary: string
}

const SEVERITY_WEIGHT: Record<Severity, number> = { low: 0.6, med: 1.0, high: 1.5 }

// —— 笼统套话黑名单（自研整理：泛泛主体/形容词，写了等于没写）。英文项用小写做大小写不敏感匹配。——
const GENERIC_PHRASES = [
  '一个人', '某个人', '一些人', '一群人', '人们', '某人',
  '美丽的', '漂亮的', '好看的', '很美', '非常漂亮', '唯美', '梦幻',
  '现代化', '科技感', '未来感', '高科技', '震撼', '令人惊叹', '神秘的',
  '一个场景', '某个地方', '一个画面',
  'a person', 'someone', 'people', 'beautiful', 'modern', 'futuristic',
  'high-tech', 'cutting-edge', 'stunning', 'sleek', 'amazing', 'epic', 'cinematic shot of',
]

function matchGeneric(desc: string): string[] {
  const lower = desc.toLowerCase()
  const out: string[] = []
  for (const p of GENERIC_PHRASES) {
    const ascii = /^[\x00-\x7f]+$/.test(p)
    if (ascii ? lower.includes(p) : desc.includes(p)) out.push(p)
  }
  return out
}

/** 连续相同键的游程（长度≥minLen），返回值与 0-based 位置数组 */
function runsOf(shots: ShotLike[], key: (s: ShotLike) => string | undefined, minLen: number): { value: string; positions: number[] }[] {
  const out: { value: string; positions: number[] }[] = []
  let i = 0
  while (i < shots.length) {
    const k = key(shots[i])
    if (!k) { i += 1; continue }
    let j = i + 1
    while (j < shots.length && key(shots[j]) === k) j += 1
    if (j - i >= minLen) out.push({ value: k, positions: Array.from({ length: j - i }, (_, t) => i + t) })
    i = j
  }
  return out
}

/** 连续区间显示成 "3–7"，离散显示成 "2、5、9" */
function rangeLabel(nums: number[]): string {
  if (nums.length === 0) return ''
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  return max - min + 1 === nums.length ? `${min}–${max}` : nums.join('、')
}

/**
 * 对一组（按时间线顺序的）镜头做结构变化 lint。
 * 结构类规则需 ≥4 镜才有意义；词法/相邻重复规则任意镜数都跑。
 */
export function checkVariation(shots: ShotLike[]): VariationResult {
  const n = shots.length
  const V: VariationViolation[] = []
  const no = (i: number) => shots[i].index ?? i + 1

  if (n >= 4) {
    // 规则1：单一景别过度集中（已标景别中 >50%）
    const specified = shots.filter((s) => s.shotSize)
    const top = topCount(countBy(specified, (s) => s.shotSize))
    const dom = ratio(top.count, specified.length)
    if (specified.length >= 4 && dom > 0.5) {
      V.push({
        rule: 'dominant_shot_size', label: '景别集中', severity: dom > 0.7 ? 'high' : 'med', shotIndices: [],
        message: `「${shotSizeLabel(top.key)}」占已标景别的 ${pct(dom)}%`,
        suggestion: '插入对比景别（远景交代环境、特写强调情绪）打破单一景别。',
      })
    }

    // 规则2：连续 ≥3 镜同景别
    for (const r of runsOf(shots, (s) => s.shotSize, 3)) {
      V.push({
        rule: 'consecutive_same_size', label: '连续同景别', severity: 'med', shotIndices: r.positions.map(no),
        message: `第 ${rangeLabel(r.positions.map(no))} 镜连续使用「${shotSizeLabel(r.value)}」`,
        suggestion: '连续段里至少换一个景别，制造视觉切分。',
      })
    }

    // 规则3：固定/无运镜占比 >60%
    const staticN = shots.filter((s) => !s.camera || s.camera === 'static').length
    const sr = ratio(staticN, n)
    if (sr > 0.6) {
      V.push({
        rule: 'camera_monotony', label: '运镜单一', severity: sr > 0.8 ? 'high' : 'med', shotIndices: [],
        message: `${pct(sr)}% 镜头固定/无运镜`,
        suggestion: '给关键镜头加入推/拉/移/跟，让画面动起来。',
      })
    }

    // 规则4：连续 ≥4 镜时长完全相同
    for (const r of runsOf(shots, (s) => (s.duration > 0 ? String(s.duration) : undefined), 4)) {
      V.push({
        rule: 'consecutive_same_duration', label: '连续等长', severity: 'low', shotIndices: r.positions.map(no),
        message: `第 ${rangeLabel(r.positions.map(no))} 镜时长均为 ${r.value}s`,
        suggestion: '打乱节奏：关键镜头给更长停留，过场镜头收短。',
      })
    }

    // 规则5：>50% 镜头既无景别也无运镜（镜头语法缺失）
    const missingBoth = shots.filter((s) => !s.shotSize && !s.camera).length
    if (ratio(missingBoth, n) > 0.5) {
      V.push({
        rule: 'missing_grammar', label: '镜头语法缺失', severity: 'med', shotIndices: [],
        message: `${pct(ratio(missingBoth, n))}% 镜头既无景别也无运镜`,
        suggestion: '补齐景别/运镜——缺省会让模型默认平视中景，全片趋同。',
      })
    }

    // 规则6：连续 ≥4 镜处于同一场景（仅在场景标注足够时）
    if (shots.filter((s) => s.sceneId).length >= n * 0.5) {
      for (const r of runsOf(shots, (s) => s.sceneId, 4)) {
        V.push({
          rule: 'scene_run', label: '长期同场景', severity: 'low', shotIndices: r.positions.map(no),
          message: `第 ${rangeLabel(r.positions.map(no))} 镜长期处于同一场景`,
          suggestion: '插入空镜/换机位/切到他处，避免空间停滞。',
        })
      }
    }
  }

  // 规则7（词法，任意镜数）：≥30% 画面描述含笼统套话
  const genericHits: number[] = []
  const phrasesSeen = new Set<string>()
  shots.forEach((s, i) => {
    const hit = matchGeneric(s.desc)
    if (hit.length) { genericHits.push(no(i)); hit.forEach((p) => phrasesSeen.add(p)) }
  })
  if (n > 0 && ratio(genericHits.length, n) >= 0.3) {
    V.push({
      rule: 'generic_phrases', label: '空洞套话', severity: 'high', shotIndices: genericHits,
      message: `${pct(ratio(genericHits.length, n))}% 画面描述含笼统套话（${[...phrasesSeen].slice(0, 4).join('、')}…）`,
      suggestion: '把「谁/做什么/在哪/什么光线材质」写具体，替换泛泛形容词。',
    })
  }

  // 规则8（相邻，任意镜数）：相邻镜头画面描述高度重复
  for (let i = 1; i < n; i += 1) {
    const a = shots[i - 1].desc
    const b = shots[i].desc
    if (a.length >= 6 && a.slice(0, 24) === b.slice(0, 24)) {
      V.push({
        rule: 'duplicate_adjacent_desc', label: '相邻画面重复', severity: 'med', shotIndices: [no(i - 1), no(i)],
        message: `第 ${no(i - 1)}、${no(i)} 镜画面描述高度重复`,
        suggestion: '相邻镜头给出不同的取景/动作/细节，避免复制粘贴。',
      })
    }
  }

  const score = round1(clamp(V.reduce((acc, v) => acc + SEVERITY_WEIGHT[v.severity], 0), 0, 5))
  const verdict = verdictFromAvg(score)
  const summary =
    V.length === 0
      ? '镜头结构变化健康，未发现同质化问题。'
      : `发现 ${V.length} 处结构同质（评分 ${score}/5 · ${VERDICT_LABEL[verdict]}）。`
  return { verdict, ok: verdict !== 'fail', score, violations: V, summary }
}
