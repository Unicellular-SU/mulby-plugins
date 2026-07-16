/**
 * variationChecker 自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/quality/variationChecker.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 */
import { checkVariation } from './variationChecker'
import type { ShotLike } from './types'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}
function shot(p: Partial<ShotLike>): ShotLike {
  return { desc: '', duration: 0, dialogueCount: 0, ...p }
}

// 1) 健康分镜：景别/运镜/时长/场景都有变化、描述具体、无连续游程 → 0 违规
const good: ShotLike[] = [
  shot({ shotSize: 'wide', camera: 'static', desc: '清晨的山谷被薄雾笼罩，远处有炊烟', duration: 3, sceneId: 's1', index: 1 }),
  shot({ shotSize: 'medium', camera: 'dolly-in', desc: '少年推开木门走进院子', duration: 5, sceneId: 's1', index: 2 }),
  shot({ shotSize: 'close', camera: 'pan', desc: '他的手指拂过墙上的旧照片', duration: 2, sceneId: 's2', index: 3 }),
  shot({ shotSize: 'full', camera: 'tracking', desc: '镜头跟随他穿过长廊', duration: 6, sceneId: 's2', index: 4 }),
  shot({ shotSize: 'extreme-close', camera: 'crane', desc: '一滴水从屋檐落下砸进水缸', duration: 4, sceneId: 's3', index: 5 }),
  shot({ shotSize: 'medium', camera: 'handheld', desc: '集市里摊贩吆喝、孩童奔跑', duration: 8, sceneId: 's3', index: 6 }),
]
const rGood = checkVariation(good)
console.log(`good → ${rGood.summary} (score=${rGood.score})`)
check('健康分镜 0 违规', rGood.violations.length === 0, `got ${rGood.violations.length}: ${rGood.violations.map((v) => v.rule).join(',')}`)
check('健康分镜 ok=true', rGood.ok, `ok=${rGood.ok}`)

// 2) 同质分镜：全中景/全固定/全等长/同场景/套话描述 → 多违规、fail
const bad: ShotLike[] = Array.from({ length: 6 }, (_, i) =>
  shot({ shotSize: 'medium', camera: 'static', desc: '一个人站在一个场景里，很美', duration: 4, sceneId: 's1', index: i + 1 })
)
const rBad = checkVariation(bad)
console.log(`bad  → ${rBad.summary} (score=${rBad.score})`)
const rules = new Set(rBad.violations.map((v) => v.rule))
check('同质分镜 verdict=fail', rBad.verdict === 'fail', `verdict=${rBad.verdict}`)
check('命中 连续同景别', rules.has('consecutive_same_size'), `rules=${[...rules].join(',')}`)
check('命中 运镜单一', rules.has('camera_monotony'), `rules=${[...rules].join(',')}`)
check('命中 空洞套话', rules.has('generic_phrases'), `rules=${[...rules].join(',')}`)
check('连续游程定位含镜号', rBad.violations.some((v) => v.shotIndices.length > 0), 'no positional violation')

// 3) 仅词法触发：3 镜（结构规则不跑），但描述全是套话 → generic_phrases 仍命中
const lex = [
  shot({ shotSize: 'wide', camera: 'pan', desc: '一个美丽的现代城市', duration: 3, index: 1 }),
  shot({ shotSize: 'close', camera: 'tilt', desc: '高科技感的未来场景', duration: 5, index: 2 }),
  shot({ shotSize: 'full', camera: 'tracking', desc: '一个人在某个地方', duration: 7, index: 3 }),
]
const rLex = checkVariation(lex)
check('短分镜仅词法命中 generic_phrases', rLex.violations.some((v) => v.rule === 'generic_phrases'), `rules=${rLex.violations.map((v) => v.rule).join(',')}`)
check('短分镜不触发结构规则', !rLex.violations.some((v) => v.rule === 'consecutive_same_size'), 'structural rule fired on <4 shots')

if (failures) { console.error(`\nvariationChecker selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\nvariationChecker selftest: ALL PASSED')
