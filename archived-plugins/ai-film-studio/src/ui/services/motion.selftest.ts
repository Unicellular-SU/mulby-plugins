/**
 * motion 自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/motion.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 */
import { interpolate, spring, sampleFrames, lerp } from './motion'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps

// —— interpolate ——
check('线性中点', interpolate(0.5, [0, 1], [0, 10]) === 5, `${interpolate(0.5, [0, 1], [0, 10])}`)
check('clamp 右', interpolate(2, [0, 1], [0, 10], { extrapolate: 'clamp' }) === 10, 'right clamp')
check('clamp 左', interpolate(-1, [0, 1], [0, 10], { extrapolate: 'clamp' }) === 0, 'left clamp')
check('extend 右', interpolate(2, [0, 1], [0, 10], { extrapolate: 'extend' }) === 20, 'extend')
check('identity 右', interpolate(2, [0, 1], [0, 10], { extrapolate: 'identity' }) === 2, 'identity')
check('默认即 clamp', interpolate(5, [0, 1], [0, 10]) === 10, 'default clamp')
check('多段降段', near(interpolate(1.5, [0, 1, 2], [0, 10, 0]), 5), `${interpolate(1.5, [0, 1, 2], [0, 10, 0])}`)
check('左右独立外推', interpolate(2, [0, 1], [0, 10], { extrapolateLeft: 'clamp', extrapolateRight: 'extend' }) === 20, 'mixed')
let threw = false
try { interpolate(0, [0], [0]) } catch { threw = true }
check('长度非法抛错', threw, 'no throw')

// —— spring（默认 config：m1/k100/c10 → 欠阻尼，会过冲）——
check('spring frame0 = from', spring({ frame: 0, fps: 30 }) === 0, `${spring({ frame: 0, fps: 30 })}`)
const settled = spring({ frame: 90, fps: 30 })
check('spring 长帧趋近 to', near(settled, 1, 0.01), `settled=${settled}`)
const peak = spring({ frame: 11, fps: 30 }) // 约过冲峰值附近
check('欠阻尼会过冲 >1', peak > 1, `peak=${peak}`)
const clamped = spring({ frame: 11, fps: 30, config: { overshootClamping: true } })
check('overshootClamping 不超过 to', clamped <= 1 + 1e-9, `clamped=${clamped}`)
// from/to 非 0..1（Ken Burns scale 1→1.15）
const kb0 = spring({ frame: 0, fps: 30, from: 1, to: 1.15 })
const kbS = spring({ frame: 120, fps: 30, from: 1, to: 1.15 })
check('spring from=1', near(kb0, 1), `${kb0}`)
check('spring 趋近 to=1.15', near(kbS, 1.15, 0.01), `${kbS}`)
// 过阻尼单调趋近、无过冲
const over = spring({ frame: 30, fps: 30, config: { damping: 40, stiffness: 100, mass: 1 } })
check('过阻尼不过冲 ≤ to', over <= 1 + 1e-9, `over=${over}`)
check('过阻尼已上升 >0', over > 0, `over=${over}`)

// —— sampleFrames / lerp ——
check('sampleFrames 长度+取值', JSON.stringify(sampleFrames(5, (f) => f)) === JSON.stringify([0, 1, 2, 3, 4]), 'sampleFrames')
check('lerp', lerp(1, 1.2, 0.5) === 1.1, `${lerp(1, 1.2, 0.5)}`)

if (failures) { console.error(`\nmotion selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\nmotion selftest: ALL PASSED')
