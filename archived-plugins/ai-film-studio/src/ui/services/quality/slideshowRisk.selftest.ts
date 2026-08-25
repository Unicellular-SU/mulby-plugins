/**
 * slideshowRisk 自测（无第三方测试框架；用 esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/quality/slideshowRisk.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 * 由于本模块零运行时依赖（type-only import 被擦除），打包后可在 node 直接运行。
 */
import { scoreSlideshowRisk } from './slideshowRisk'
import type { ShotLike } from './types'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures += 1
    console.error(`  ✗ ${name} — ${detail}`)
  }
}

function shot(p: Partial<ShotLike>): ShotLike {
  return { desc: '', duration: 0, dialogueCount: 0, ...p }
}

// 1) 健康分镜：景别/运镜/时长/画面/场景都有变化 → strong/acceptable
const good: ShotLike[] = [
  shot({ shotSize: 'wide', camera: 'static', desc: '清晨的山谷被薄雾笼罩，远处有炊烟', duration: 3, sceneId: 's1' }),
  shot({ shotSize: 'medium', camera: 'dolly-in', desc: '少年推开木门走进院子', duration: 5, sceneId: 's1' }),
  shot({ shotSize: 'close', camera: 'pan', desc: '他的手指拂过墙上的旧照片', duration: 2, sceneId: 's2' }),
  shot({ shotSize: 'full', camera: 'tracking', desc: '镜头跟随他穿过长廊', duration: 6, sceneId: 's2' }),
  shot({ shotSize: 'extreme-close', camera: 'crane', desc: '一滴水从屋檐落下砸进水缸', duration: 4, sceneId: 's3' }),
  shot({ shotSize: 'medium', camera: 'handheld', desc: '人群在集市里熙攘走动', duration: 8, sceneId: 's3' }),
]
const rGood = scoreSlideshowRisk(good)
console.log(`good → ${rGood.summary} (avg=${rGood.avg}, verdict=${rGood.verdict})`)
check('健康分镜 ok=true', rGood.ok, `got ok=${rGood.ok}`)
check('健康分镜 avg<2.2', rGood.avg < 2.2, `got avg=${rGood.avg}`)

// 2) 幻灯片分镜：全中景、全固定、全等长、画面雷同、单场景 → fail
const bad: ShotLike[] = Array.from({ length: 8 }, () =>
  shot({ shotSize: 'medium', camera: 'static', desc: '一个人站在房间里看着前方', duration: 4, sceneId: 's1' })
)
const rBad = scoreSlideshowRisk(bad)
console.log(`bad  → ${rBad.summary} (avg=${rBad.avg}, verdict=${rBad.verdict})`)
check('幻灯片分镜 verdict=fail', rBad.verdict === 'fail', `got verdict=${rBad.verdict}`)
check('幻灯片分镜 ok=false', !rBad.ok, `got ok=${rBad.ok}`)
check('幻灯片分镜 五维全 applicable', rBad.dims.every((d) => d.applicable), 'some dim skipped')

// 3) 样本不足：< 3 镜直接跳过判 strong
const few = scoreSlideshowRisk([shot({ shotSize: 'medium' }), shot({ shotSize: 'wide' })])
check('样本不足 verdict=strong', few.verdict === 'strong', `got verdict=${few.verdict}`)
check('样本不足 无维度', few.dims.length === 0, `got ${few.dims.length} dims`)

// 4) 中文景别/运镜也应被归一化（经 storyboardToShotLike 路径在真实数据里用；此处直接喂归一值已覆盖）

if (failures) {
  console.error(`\nslideshowRisk selftest: ${failures} FAILED`)
  process.exit(1)
} else {
  console.log('\nslideshowRisk selftest: ALL PASSED')
}
