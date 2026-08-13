import assert from 'node:assert/strict'
import {
  analysisSampleTimes,
  convertVideoAnalysisToStoryboard,
  cuesForRange,
  formatVideoAnalysisReport,
  materializeVideoAnalysisFrames,
  mergeAnalysisBatch,
  normalizeSceneRanges,
  parseTimedTranscript
} from '../src/ui/services/videoAnalysis.ts'
import { readStoryboardDoc } from '../src/ui/services/storyboardV2.ts'
import { createDefaultProject, useGraph } from '../src/ui/store/graphStore.ts'
import type { VideoAnalysisReport, VideoAnalysisShot } from '../src/ui/types.ts'

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], boardHistories: {}, clipboard: { cards: [], edges: [] } })
}

function shot(index: number, start: number, end: number): VideoAnalysisShot {
  const frames = (['start', 'middle', 'end'] as const).map((role, offset) => ({
    role,
    time: start + (end - start) * offset / 2,
    path: `/tmp/report-${index}-${role}.png`,
    url: `file:///tmp/report-${index}-${role}.png`
  }))
  return {
    id: `analysis-shot-${index}`,
    index,
    start,
    end,
    frames,
    representativeFramePath: frames[1].path,
    representativeFrameUrl: frames[1].url,
    scene: `场景 ${index + 1}`,
    shotSize: '中景',
    composition: '主体居中',
    characters: '人物',
    action: '缓慢转身',
    camera: '三帧中主体逐渐放大',
    color: '暖色逆光',
    mood: '平静',
    learnablePrompt: '中景，人物缓慢转身，镜头谨慎推进',
    dialogue: index === 0 ? '你好' : '',
    transcriptStatus: index === 0 ? 'matched' : 'untranscribed'
  }
}

function report(cardId: string): VideoAnalysisReport {
  return {
    version: 1,
    id: 'analysis-report-1',
    sourceCardId: cardId,
    sourceAssetUrl: 'file:///tmp/source.mp4',
    sourcePath: '/tmp/source.mp4',
    duration: 10,
    threshold: 0.4,
    sampleStrategy: 'start-middle-end',
    shots: [shot(0, 0, 4), shot(1, 4, 10)],
    createdAt: 1,
    updatedAt: 1
  }
}

function testRangesAndSamples() {
  const ranges = normalizeSceneRanges(45, [30, -5, 15, 15.1, 999], { maxDuration: 10, maxShots: 20 })
  assert.equal(ranges[0].start, 0)
  assert.equal(ranges.at(-1)?.end, 45)
  assert.ok(ranges.every((range) => range.end > range.start && range.end - range.start <= 10.001))
  for (let index = 1; index < ranges.length; index++) assert.equal(ranges[index - 1].end, ranges[index].start)

  const capped = normalizeSceneRanges(60, Array.from({ length: 59 }, (_, index) => index + 1), { maxShots: 7 })
  assert.equal(capped.length, 7)
  assert.deepEqual(analysisSampleTimes({ start: 2, end: 2.2 }).map((item) => item.role), ['start', 'middle', 'end'])
  assert.ok(analysisSampleTimes({ start: 2, end: 2.2 }).every((item) => item.time >= 2 && item.time <= 2.2))
}

function testTimedTranscript() {
  const cues = parseTimedTranscript(`WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\n<font>再见</font>`)
  assert.deepEqual(cues.map((cue) => cue.text), ['你好', '再见'])
  assert.equal(cuesForRange(cues, { start: 2.2, end: 3.2 }), '你好 / 再见')
  assert.deepEqual(parseTimedTranscript('这只是普通文案，没有时间码'), [])
}

function testBatchMergeIsIndexStable() {
  const original = [shot(4, 0, 2), shot(8, 2, 4)]
  const merged = mergeAnalysisBatch(original, { shots: [{ index: 8, scene: '雨夜车站', camera: '无法确定' }] })
  assert.equal(merged[0].scene, original[0].scene, '模型缺失的镜头不得错位覆盖')
  assert.equal(merged[1].scene, '雨夜车站')
  assert.equal(merged[1].camera, '无法确定')
  assert.match(formatVideoAnalysisReport({ ...report('video'), shots: merged }), /未转写/)
}

function testMaterializeAndStoryboardAreAtomicAndIdempotent() {
  reset()
  const cardId = useGraph.getState().addCard('video', { x: 100, y: 100 }, {
    title: '源视频',
    status: 'done',
    assetUrl: 'file:///tmp/source.mp4',
    assetLocalPath: '/tmp/source.mp4',
    mime: 'video/mp4'
  })
  const value = report(cardId)
  const boardId = useGraph.getState().project.activeBoardId
  useGraph.setState({ boardHistories: {}, selectedIds: [] })

  const firstFrames = materializeVideoAnalysisFrames(cardId, value)
  const secondFrames = materializeVideoAnalysisFrames(cardId, value)
  assert.deepEqual(secondFrames, firstFrames)
  assert.equal(firstFrames.length, 2)
  assert.ok(firstFrames.every((id) => useGraph.getState().getCard(id)?.kind === 'image'))
  assert.equal(useGraph.getState().getActiveBoard().cards && useGraph.getState().boardHistories[boardId].past.length, 1, '无变化的重复落地不应增加 undo')

  useGraph.setState({ boardHistories: {}, selectedIds: [] })
  const first = convertVideoAnalysisToStoryboard(cardId, value, true)!
  const cardCount = Object.keys(useGraph.getState().getActiveBoard().cards).length
  const second = convertVideoAnalysisToStoryboard(cardId, value, true)!
  assert.equal(second.ownerId, first.ownerId)
  assert.deepEqual(second.frameIds, first.frameIds)
  assert.equal(Object.keys(useGraph.getState().getActiveBoard().cards).length, cardCount)
  assert.equal(useGraph.getState().boardHistories[boardId].past.length, 1, '重复转换没有变化时不增加 undo')
  const owner = useGraph.getState().getCard(first.ownerId)!
  const doc = readStoryboardDoc(owner)!
  assert.deepEqual(doc.shots.map((item) => item.sourceRange), [{ start: 0, end: 4 }, { start: 4, end: 10 }])
  assert.deepEqual(doc.shots.map((item) => item.imageCardId), first.frameIds)
}

testRangesAndSamples()
testTimedTranscript()
testBatchMergeIsIndexStable()
testMaterializeAndStoryboardAreAtomicAndIdempotent()
console.log('video analysis: 4 tests OK')
