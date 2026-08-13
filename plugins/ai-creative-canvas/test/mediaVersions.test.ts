import assert from 'node:assert/strict'
import { readCardMediaVersions, readDirectorTakeVersions } from '../src/ui/services/mediaVersions.ts'
import { normalizeReshootRange } from '../src/ui/services/videoReshoot.ts'
import type { Card, DirectorShot } from '../src/ui/types.ts'

function card(): Card {
  return {
    id: 'image-1', kind: 'image', x: 0, y: 0, w: 320, h: 240, title: '图片', prompt: '一只猫', modelId: 'model', providerId: 'provider', params: {},
    status: 'done', progress: 1, error: null, assetUrl: 'file:///a.png', assetLocalPath: '/a.png', attachmentId: null, mime: 'image/png', text: null,
    refIds: [], assets: [], parentId: null,
    meta: { results: [{ url: 'file:///a.png', localPath: '/a.png', mime: 'image/png' }, { url: 'file:///b.png', localPath: '/b.png', mime: 'image/png' }], imageGeneration: { providerId: 'provider', modelId: 'model', sentPrompt: '完整提示', completedAt: 100 } }
  }
}

function testLegacyImageResultsAdaptToStableVersions() {
  const first = readCardMediaVersions(card(), 'generation')
  const second = readCardMediaVersions(card(), 'generation')
  assert.equal(first.items.length, 2)
  assert.equal(first.currentId, first.items[0].id)
  assert.deepEqual(first.items.map((item) => item.id), second.items.map((item) => item.id))
  assert.equal(first.items[1].prompt, '完整提示')
  assert.equal(first.items[1].providerId, 'provider')
}

function testSavedDispositionAndPrimarySelectionSurviveAdapter() {
  const value = card()
  const state = readCardMediaVersions(value, 'generation')
  state.items[1].disposition = 'starred'
  value.assetUrl = 'file:///b.png'
  value.assetLocalPath = '/b.png'
  value.meta.mediaVersionsV1 = state
  const next = readCardMediaVersions(value)
  assert.equal(next.currentId, state.items[1].id)
  assert.equal(next.items[1].disposition, 'starred')
}

function testDirectorTakesUseTheSameVersionShape() {
  const shot = { id: 'shot', name: '镜头', cam: { pos: [0, 0, 1], target: [0, 0, 0], focal: 35 }, take: 'file:///take-2.png', takes: ['file:///take-1.png', 'file:///take-2.png'] } as DirectorShot
  const state = readDirectorTakeVersions(shot)
  assert.equal(state.items.length, 2)
  assert.equal(state.currentId, state.items[1].id)
  assert.equal(state.items[0].source, 'director')
}

function testReshootRangeIsClamped() {
  assert.deepEqual(normalizeReshootRange(-2, 15, 10), { start: 0, end: 10 })
  assert.deepEqual(normalizeReshootRange(9.95, 9.96, 10), { start: 9.9, end: 10 })
}

testLegacyImageResultsAdaptToStableVersions()
testSavedDispositionAndPrimarySelectionSurviveAdapter()
testDirectorTakesUseTheSameVersionShape()
testReshootRangeIsClamped()
console.log('media versions & reshoot: 4 tests OK')
