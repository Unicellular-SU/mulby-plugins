/**
 * subtitles 词级字幕自测（esbuild 打包到 node 跑）：
 *   npx esbuild src/ui/services/subtitles.selftest.ts --bundle --platform=node --format=esm --outfile=dist/_selftest.mjs && node dist/_selftest.mjs
 */
import {
  estimateWordTimings, applyCorrections, buildCues, renderSrt, renderVtt, renderAss, buildCaptionsFromClips,
} from './subtitles'
import type { CaptionWord } from './subtitles'

let failures = 0
function check(name: string, cond: boolean, detail: string) {
  if (cond) console.log(`  ✓ ${name}`)
  else { failures += 1; console.error(`  ✗ ${name} — ${detail}`) }
}

// estimateWordTimings：CJK 逐字 + 单调 + 末尾贴合区间
const cn = estimateWordTimings('你好世界', 0, 4000)
check('CJK 逐字 4 词', cn.length === 4, `${cn.length}: ${cn.map((w) => w.word).join('|')}`)
check('时序单调递增', cn.every((w, i) => i === 0 || w.startMs >= cn[i - 1].endMs - 1), 'not monotonic')
check('末词贴合区间末', Math.abs(cn[cn.length - 1].endMs - 4000) <= 2, `${cn[cn.length - 1].endMs}`)
const en = estimateWordTimings('Hello world!', 0, 2000)
check('英文按词(标点附着)', en.length === 2 && en[1].word === 'world!', en.map((w) => w.word).join('|'))

// applyCorrections：不区分大小写 + 保留尾标点
const fixed = applyCorrections([{ word: 'teh', startMs: 0, endMs: 100 }, { word: 'Teh,', startMs: 100, endMs: 200 }], { teh: 'the' })
check('纠错小写', fixed[0].word === 'the', fixed[0].word)
check('纠错保留大小写无关+尾标点', fixed[1].word === 'the,', fixed[1].word)

// buildCues：按 maxWords 断条
const many: CaptionWord[] = Array.from({ length: 20 }, (_, i) => ({ word: `w${i}`, startMs: i * 300, endMs: i * 300 + 250 }))
const cues = buildCues(many, { maxWords: 5, maxChars: 999, maxGapMs: 9999 })
check('maxWords=5 → 4 条', cues.length === 4, `${cues.length}`)
check('每条 ≤5 词', cues.every((c) => c.words.length <= 5), 'overflow')
// 大间隔断条
const gapCues = buildCues([{ word: 'a', startMs: 0, endMs: 100 }, { word: 'b', startMs: 2000, endMs: 2100 }], { maxGapMs: 700 })
check('大间隔断条 → 2 条', gapCues.length === 2, `${gapCues.length}`)

// renderSrt
const c2 = buildCues(estimateWordTimings('你好世界，欢迎观看', 0, 4000), { maxWords: 99 })
const srtNone = renderSrt(c2, 'none')
check('SRT none 含 --> 与逗号毫秒', srtNone.includes('-->') && /,\d{3}/.test(srtNone), srtNone.slice(0, 40))
const srtWbw = renderSrt(c2, 'word_by_word')
check('SRT word_by_word 条目更多', (srtWbw.match(/-->/g) || []).length > (srtNone.match(/-->/g) || []).length, 'not more')

// renderVtt
const vtt = renderVtt(c2, 'karaoke')
check('VTT 头部', vtt.startsWith('WEBVTT'), vtt.slice(0, 10))
check('VTT karaoke 内联时间戳', /<\d{2}:\d{2}:\d{2}\.\d{3}>/.test(vtt), vtt)

// renderAss
const ass = renderAss(c2, { highlightColor: '#FFD400', baseColor: '#FFFFFF' })
check('ASS Script Info', ass.includes('[Script Info]') && ass.includes('[V4+ Styles]'), 'no header')
check('ASS Dialogue + \\kf', ass.includes('Dialogue:') && ass.includes('{\\kf'), 'no karaoke')
check('ASS 颜色 BGR', ass.includes('&H0000D4FF'), 'color')

// buildCaptionsFromClips
const caps = buildCaptionsFromClips(
  [{ duration: 3, shotId: 's1' }, { duration: 3, shotId: 's2' }],
  { shots: [{ id: 's1', dialogues: [{ character: '甲', line: '今天天气不错' }] }, { id: 's2', subtitle: 'Hello there' }] },
  { maxWords: 99 }
)
check('从片段生成字幕条 2 条', caps.length === 2, `${caps.length}`)
check('第 2 条起于 3s', Math.abs(caps[1].startMs - 3000) <= 50, `${caps[1].startMs}`)
check('对白去 speaker 前缀', caps[0].text.indexOf('甲') === -1 && caps[0].text.includes('今天天气不错'), caps[0].text)

if (failures) { console.error(`\nsubtitles selftest: ${failures} FAILED`); process.exit(1) }
else console.log('\nsubtitles selftest: ALL PASSED')
