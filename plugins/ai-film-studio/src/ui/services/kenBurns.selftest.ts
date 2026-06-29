/**
 * kenBurns 自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/kenBurns.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 * 注：仅验证运动数学与 zoompan 串结构；视觉正确性需在 Mulby 内跑真实 ffmpeg。
 */
import { cameraMotion, kenBurnsZoompan, kenBurnsCss, KEN_BURNS_OPTIONS, isKenBurnsPreset } from './kenBurns'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}
const near = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps

// cameraMotion 端点
check('zoom-in p0 scale=1', near(cameraMotion('zoom-in', 0).scale, 1.0), `${cameraMotion('zoom-in', 0).scale}`)
check('zoom-in p1 scale=1.15', near(cameraMotion('zoom-in', 1).scale, 1.15), `${cameraMotion('zoom-in', 1).scale}`)
check('zoom-out p0 scale=1.15', near(cameraMotion('zoom-out', 0).scale, 1.15), `${cameraMotion('zoom-out', 0).scale}`)
check('ken-burns p1 scale=1.18', near(cameraMotion('ken-burns', 1).scale, 1.18), `${cameraMotion('ken-burns', 1).scale}`)
check('ken-burns p1 对角平移', near(cameraMotion('ken-burns', 1).translateXPct, -0.06) && near(cameraMotion('ken-burns', 1).translateYPct, -0.04), JSON.stringify(cameraMotion('ken-burns', 1)))
check('static 全程 scale=1.02', near(cameraMotion('static', 0).scale, 1.02) && near(cameraMotion('static', 1).scale, 1.02), 'static')
check('pan-left 平移反向', cameraMotion('pan-left', 0).translateXPct > 0 && cameraMotion('pan-left', 1).translateXPct < 0, 'pan-left')
check('p 越界夹断(p=2 同 p=1)', near(cameraMotion('zoom-in', 2).scale, cameraMotion('zoom-in', 1).scale), 'clamp')
check('p 中点(0.5)在两端之间', (() => { const s = cameraMotion('zoom-in', 0.5).scale; return s > 1.0 && s < 1.15 })(), 'midpoint')

// kenBurnsCss
check('css 含 scale 与 translate', /scale\(/.test(kenBurnsCss('ken-burns', 0.5)) && /translate\(/.test(kenBurnsCss('ken-burns', 0.5)), kenBurnsCss('ken-burns', 0.5))

// kenBurnsZoompan 结构
const zp = kenBurnsZoompan('zoom-in', { durationSec: 2, fps: 24, width: 1280, height: 720 })
console.log(`zoompan(zoom-in,2s,24fps,1280x720) → ${zp}`)
check('zoompan 前缀', zp.startsWith('zoompan=z='), zp)
check('zoompan d=48', zp.includes('d=48'), zp)
check('zoompan s=1280x720', zp.includes('s=1280x720'), zp)
check('zoompan fps=24', zp.includes('fps=24'), zp)
check('zoompan z 含缩放差 0.15', zp.includes('0.15'), zp)
check('zoompan x 居中表达式', zp.includes('(iw-iw/zoom)/2'), zp)
// 1 帧边界不产生除零
const zp1 = kenBurnsZoompan('static', { durationSec: 0.01, fps: 1, width: 100, height: 100 })
check('极短 1 帧不崩(prog=0)', zp1.includes('d=1') && !zp1.includes('/0'), zp1)

// 选项 / 类型守卫
check('KEN_BURNS_OPTIONS 9 项带中文', KEN_BURNS_OPTIONS.length === 9 && KEN_BURNS_OPTIONS.every((o) => o.label.length > 0), `${KEN_BURNS_OPTIONS.length}`)
check('isKenBurnsPreset 守卫', isKenBurnsPreset('ken-burns') && !isKenBurnsPreset('nope'), 'guard')

if (failures) { console.error(`\nkenBurns selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\nkenBurns selftest: ALL PASSED')
