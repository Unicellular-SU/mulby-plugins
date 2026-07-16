/**
 * shotPromptBuilder 自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/shotPromptBuilder.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 */
import { buildShotPrompt, LENS_OPTIONS, LIGHTING_OPTIONS } from './shotPromptBuilder'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}

// 1) 全字段：5 层都出现且顺序正确（Camera<Movement<Subject<Lighting<Style）
const full = buildShotPrompt({
  desc: '少年站在悬崖边眺望远方',
  shotSize: 'close', camera: 'dolly-in',
  lens: 'portrait', dof: 'shallow',
  lighting: 'golden-hour', colorTemp: 'warm',
  textures: 'weathered leather, windblown hair',
  characters: '少年(蓝衣)', setting: '黄昏悬崖', mood: 'hopeful',
  styleHint: 'cinematic anime',
})
console.log(`full → ${full}`)
check('含焦段短语', full.includes('85mm portrait lens'), full)
check('含景别短语', full.includes('close-up'), full)
check('含运镜短语', full.includes('slow dolly in'), full)
check('含描述', full.includes('少年站在悬崖边眺望远方'), full)
check('含布光短语', full.includes('golden hour'), full)
check('含风格短 hint', full.includes('cinematic anime'), full)
const iCam = full.indexOf('85mm'); const iMove = full.indexOf('close-up'); const iSubj = full.indexOf('少年站'); const iLight = full.indexOf('golden hour'); const iStyle = full.indexOf('cinematic anime')
check('5 层顺序正确', iCam < iMove && iMove < iSubj && iSubj < iLight && iLight < iStyle, `${iCam},${iMove},${iSubj},${iLight},${iStyle}`)

// 2) 中文景别/运镜归一化
const cn = buildShotPrompt({ desc: 'x', shotSize: '近景', camera: '推' })
check('中文景别归一', cn.includes('close-up'), cn)
check('中文运镜归一', cn.includes('slow dolly in'), cn)

// 3) static 运镜省略短语（但保留景别）
const st = buildShotPrompt({ desc: 'x', shotSize: 'wide', camera: 'static' })
check('static 不写 static camera', !st.includes('static camera'), st)
check('static 仍含景别', st.includes('wide shot'), st)

// 4) 仅描述：不崩、只返回描述
const min = buildShotPrompt({ desc: '一个空房间' })
check('最小输入只含描述', min === '一个空房间', `"${min}"`)

// 5) 空描述空输入 → 空串
check('全空 → 空串', buildShotPrompt({ desc: '' }) === '', `"${buildShotPrompt({ desc: '' })}"`)

// 6) 下拉选项词表导出可用
check('LENS_OPTIONS 非空且带中文', LENS_OPTIONS.length === 6 && LENS_OPTIONS[0].label.length > 0, `${LENS_OPTIONS.length}`)
check('LIGHTING_OPTIONS 含霓虹', LIGHTING_OPTIONS.some((o) => o.value === 'neon' && o.label === '霓虹'), 'neon label')

if (failures) { console.error(`\nshotPromptBuilder selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\nshotPromptBuilder selftest: ALL PASSED')
