/**
 * deliveryPromise 自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/quality/deliveryPromise.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 */
import { validateCuts, classifyCut, classifyFromBrief } from './deliveryPromise'
import type { CutLike } from './deliveryPromise'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}

// classifyCut
check('视频扩展名=motion', classifyCut({ source: 'C:/a/shot1.mp4' }) === 'motion', 'mp4')
check('hasVideo=motion', classifyCut({ hasVideo: true }) === 'motion', 'hasVideo')
check('chart kind=slide', classifyCut({ kind: 'bar_chart' }) === 'slide', 'chart')
check('图片=still', classifyCut({ source: 'C:/a/key.png' }) === 'still', 'png')
check('带 query 的 url 扩展名', classifyCut({ source: 'https://x/y.mp4?token=1' }) === 'motion', 'query')

// motion_led 全视频 → 达成
const allVideo: CutLike[] = Array.from({ length: 5 }, (_, i) => ({ hasVideo: true, source: `s${i}.mp4` }))
const r1 = validateCuts(allVideo, 'motion_led')
console.log(`motion_led 全视频 → ${r1.summary}`)
check('全视频 ok', r1.ok, `ok=${r1.ok}`)
check('全视频 0 违规', r1.violations.length === 0, `${r1.violations.length}`)
check('全视频 motionRatio=1', r1.motionRatio === 1, `${r1.motionRatio}`)

// motion_led 全静帧 → 致命：无视频 + 占比不足 + 静帧溢出
const allStill: CutLike[] = Array.from({ length: 5 }, (_, i) => ({ source: `k${i}.png` }))
const r2 = validateCuts(allStill, 'motion_led')
console.log(`motion_led 全静帧 → ${r2.summary}`)
check('全静帧 ok=false', !r2.ok, `ok=${r2.ok}`)
check('全静帧命中 no_motion_at_all', r2.violations.some((v) => v.code === 'no_motion_at_all'), r2.violations.map((v) => v.code).join(','))
check('全静帧 verdict=fail', r2.verdict === 'fail', `verdict=${r2.verdict}`)

// motion_led 半视频半静帧 → 占比 0.5 < 0.7：med 警告但不致命阻断
const half: CutLike[] = [
  { hasVideo: true }, { hasVideo: true }, { source: 'a.png' }, { source: 'b.png' },
]
const r3 = validateCuts(half, 'motion_led')
check('半视频 motionRatio=0.5', r3.motionRatio === 0.5, `${r3.motionRatio}`)
check('半视频命中 motion_ratio_low', r3.violations.some((v) => v.code === 'motion_ratio_low'), 'no ratio violation')
check('半视频无 high(可警告通过)', r3.ok, `ok=${r3.ok}`)

// still_led 全静帧 → 允许，达成
const r4 = validateCuts(allStill, 'still_led')
check('still_led 全静帧达成', r4.ok && r4.violations.length === 0, `ok=${r4.ok} v=${r4.violations.length}`)

// 空镜段 → 不崩
check('空镜段 ok', validateCuts([], 'motion_led').ok, 'empty')

// classifyFromBrief
check('数据→data_explainer', classifyFromBrief({ intent: '一个数据可视化短片' }) === 'data_explainer', 'data')
check('口播→teacher_explainer', classifyFromBrief({ intent: '知识讲解口播' }) === 'teacher_explainer', 'teach')
check('默认有视频模型→motion_led', classifyFromBrief({ hasVideoModel: true }) === 'motion_led', 'default motion')
check('默认无视频模型→hybrid', classifyFromBrief({}) === 'hybrid', 'default hybrid')

if (failures) { console.error(`\ndeliveryPromise selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\ndeliveryPromise selftest: ALL PASSED')
