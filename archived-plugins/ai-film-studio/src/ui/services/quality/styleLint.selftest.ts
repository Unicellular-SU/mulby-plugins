/**
 * styleLint 自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/quality/styleLint.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 */
import { styleLint } from './styleLint'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}

// text_baking：中文「写着」
const r1 = styleLint([{ desc: '一块招牌写着「欢迎光临」', index: 3 }])
check('中文文字烧录命中', r1.violations.some((v) => v.rule === 'text_baking' && v.shotIndices[0] === 3), JSON.stringify(r1.violations))

// text_baking：英文 text saying
const r2 = styleLint([{ desc: 'a banner with text saying hello', index: 1 }])
check('英文 text saying 命中', r2.violations.some((v) => v.rule === 'text_baking'), JSON.stringify(r2.violations))

// 引号文字 + 字样
const r3 = styleLint([{ desc: '墙上喷着"自由"字样', index: 2 }])
check('引号+字样 命中', r3.violations.some((v) => v.rule === 'text_baking'), JSON.stringify(r3.violations))

// watermark/logo
const r4 = styleLint([{ desc: '右下角带品牌 logo 和水印', index: 5 }])
check('logo/水印 命中', r4.violations.some((v) => v.rule === 'watermark_logo' && v.shotIndices[0] === 5), JSON.stringify(r4.violations))

// 正常描述不误报
const ok = styleLint([
  { desc: '清晨山谷被薄雾笼罩，远处炊烟袅袅', index: 1 },
  { desc: '少年推门走进院子', index: 2 },
])
check('正常描述零误报', ok.violations.length === 0, JSON.stringify(ok.violations))
check('summary 无问题', ok.summary.includes('未发现'), ok.summary)

// index 缺省回退下标+1
const r5 = styleLint([{ desc: '牌子写着"营业中"' }])
check('缺省 index 回退 1', r5.violations[0]?.shotIndices[0] === 1, JSON.stringify(r5.violations))

if (failures) { console.error(`\nstyleLint selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\nstyleLint selftest: ALL PASSED')
