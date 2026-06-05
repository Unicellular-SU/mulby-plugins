import assert from 'node:assert/strict'
import {
  exportJson,
  exportSrt,
  exportVtt,
  formatSrtTime,
  formatVttTime,
  mergeSubtitles,
  splitByText,
  splitByTime,
  splitByWord,
  splitSubtitle,
  type SubtitleCue
} from './subtitles'

const cues: SubtitleCue[] = [
  { id: 'a', startMs: 1250, endMs: 3780, text: 'Hello world' },
  { id: 'b', startMs: 4200, endMs: 7100, text: 'Second line', translation: '第二行' }
]

assert.equal(formatSrtTime(3723456), '01:02:03,456')
assert.equal(formatVttTime(3723456), '01:02:03.456')

assert.equal(
  exportSrt(cues),
  [
    '1',
    '00:00:01,250 --> 00:00:03,780',
    'Hello world',
    '',
    '2',
    '00:00:04,200 --> 00:00:07,100',
    'Second line',
    '第二行',
    ''
  ].join('\n')
)

assert.equal(
  exportVtt(cues),
  ['WEBVTT', '', '00:00:01.250 --> 00:00:03.780', 'Hello world', '', '00:00:04.200 --> 00:00:07.100', 'Second line', '第二行', ''].join('\n')
)

assert.deepEqual(JSON.parse(exportJson(cues)), cues)

const split = splitSubtitle({ id: 'x', startMs: 0, endMs: 4000, text: 'first half second half' }, 1800, 10)
assert.deepEqual(split.map((cue) => [cue.startMs, cue.endMs, cue.text]), [
  [0, 1800, 'first half'],
  [1800, 4000, 'second half']
])

const merged = mergeSubtitles(
  { id: 'a', startMs: 0, endMs: 1000, text: 'Hello' },
  { id: 'b', startMs: 1000, endMs: 2000, text: 'world', translation: '世界' }
)
assert.deepEqual(merged, { id: 'a', startMs: 0, endMs: 2000, text: 'Hello world', translation: '世界' })

// splitByText: derives the time boundary from the character ratio (cursor at 50%).
const byText = splitByText({ id: 'c', startMs: 0, endMs: 4000, text: 'aaaa bbbb' }, 4)
assert.deepEqual(
  byText.map((cue) => [cue.startMs, cue.endMs, cue.text]),
  [[0, 1778, 'aaaa'], [1778, 4000, 'bbbb']]
)

// splitByTime: derives the text boundary from the time ratio (boundary at 50%).
const byTime = splitByTime({ id: 'd', startMs: 0, endMs: 2000, text: 'aaaa bbbb' }, 1000)
assert.deepEqual(
  byTime.map((cue) => [cue.startMs, cue.endMs, cue.text]),
  [[0, 1000, 'aaaa'], [1000, 2000, 'bbbb']]
)

// Chinese (no spaces) splits exactly at the cursor index.
const cjk = splitByText({ id: 'e', startMs: 0, endMs: 1000, text: '你好世界' }, 2)
assert.deepEqual(cjk.map((cue) => cue.text), ['你好', '世界'])

// splitByWord: uses the exact word timestamp and re-slices words.
const wordCue: SubtitleCue = {
  id: 'f',
  startMs: 0,
  endMs: 3000,
  text: 'one two three',
  words: [
    { startMs: 0, endMs: 900, text: 'one' },
    { startMs: 1000, endMs: 1900, text: 'two' },
    { startMs: 2000, endMs: 2900, text: 'three' }
  ]
}
const byWord = splitByWord(wordCue, 2)
assert.equal(byWord[0].endMs, 2000)
assert.equal(byWord[1].startMs, 2000)
assert.deepEqual(byWord[0].text, 'one two')
assert.deepEqual(byWord[1].text, 'three')
assert.equal(byWord[0].words?.length, 2)
assert.equal(byWord[1].words?.length, 1)

// Translation is kept only on the left part to avoid duplication.
const withTranslation = splitByTime({ id: 'g', startMs: 0, endMs: 2000, text: 'aaaa bbbb', translation: '甲乙' }, 1000)
assert.equal(withTranslation[0].translation, '甲乙')
assert.equal(withTranslation[1].translation, undefined)

// Boundary is clamped inside (startMs, endMs).
const clamped = splitByTime({ id: 'h', startMs: 500, endMs: 1500, text: 'x y' }, 100000)
assert.equal(clamped[0].endMs, 1499)
