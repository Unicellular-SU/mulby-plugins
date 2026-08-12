import assert from 'node:assert/strict'
import { collectProjectMedia, rewriteProjectMediaPaths, type RestoredProjectMedia } from '../src/ui/services/projectMedia.ts'
import type { Card, ProjectDoc } from '../src/ui/types.ts'

function project(): ProjectDoc {
  const card = {
    id: 'card-1',
    kind: 'image',
    assetLocalPath: '/old/shared.png',
    assetUrl: 'file:///old/shared.png',
    mime: 'image/png',
    assets: [{ id: 'input-1', kind: 'audio', localPath: '/old/input.wav', url: 'file:///old/input.wav', mime: 'audio/wav' }],
    meta: {
      thumb: 'file:///old/thumb.jpg',
      thumbFor: 'file:///old/shared.png',
      poster: 'file:///old/poster.jpg',
      posterFor: 'file:///old/shared.png',
      fittedFor: '/old/shared.png',
      results: [
        { localPath: '/old/shared.png', url: 'file:///old/shared.png', mime: 'image/png' },
        { localPath: '/old/variant.png', url: 'file:///old/variant.png', mime: 'image/png' }
      ]
    }
  } as unknown as Card
  return {
    id: 'project-1',
    name: 'media test',
    activeBoardId: 'board-1',
    boards: [{ id: 'board-1', name: 'board', cards: { [card.id]: card }, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }],
    globalModelId: null,
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 2
  }
}

function restored(path: string, mime: string): RestoredProjectMedia {
  return { path, url: `file://${path}`, mime }
}

function testCollectsEveryOwnedPathOnce() {
  assert.deepEqual(collectProjectMedia(project()), [
    { id: 'media-1', path: '/old/shared.png', mime: 'image/png' },
    { id: 'media-2', path: '/old/input.wav', mime: 'audio/wav' },
    { id: 'media-3', path: '/old/variant.png', mime: 'image/png' }
  ])
}

function testRewritesPrimaryInputsAndResultHistory() {
  const doc = project()
  const summary = rewriteProjectMediaPaths(doc, new Map([
    ['/old/shared.png', restored('/new/shared.png', 'image/png')],
    ['/old/input.wav', restored('/new/input.wav', 'audio/wav')],
    ['/old/variant.png', restored('/new/variant.png', 'image/png')]
  ]))
  const card = doc.boards[0].cards['card-1']
  const results = card.meta.results as Array<{ localPath: string; url: string }>

  assert.deepEqual(summary, { restoredReferences: 4, missingReferences: 0, restoredCards: 1, missingCards: 0 })
  assert.equal(card.assetLocalPath, '/new/shared.png')
  assert.equal(card.assets[0].localPath, '/new/input.wav')
  assert.equal(results[0].localPath, '/new/shared.png')
  assert.equal(results[1].localPath, '/new/variant.png')
  assert.equal('thumb' in card.meta, false)
  assert.equal('poster' in card.meta, false)
  assert.equal(card.meta.mediaMissing, undefined)
}

function testMarksOnlyUnpackedReferences() {
  const doc = project()
  const summary = rewriteProjectMediaPaths(doc, new Map([
    ['/old/shared.png', restored('/new/shared.png', 'image/png')]
  ]))
  const card = doc.boards[0].cards['card-1']

  assert.deepEqual(summary, { restoredReferences: 2, missingReferences: 2, restoredCards: 1, missingCards: 1 })
  assert.equal(card.meta.mediaMissing, true)
  assert.deepEqual(card.meta.missingMediaReferences, ['input:input-1', 'result:1'])
}

function testCollectsAndRewritesRecipeAndDirectorPaths() {
  const doc = project()
  const card = doc.boards[0].cards['card-1']
  card.meta = {
    ...card.meta,
    sourcePath: '/old/source.mp4',
    editRecipe: {
      version: 1,
      baseDuration: 3,
      ops: [
        { id: 'color', kind: 'color', enabled: true, params: { lutPath: '/old/look.cube' } },
        { id: 'audio', kind: 'audio', enabled: true, params: { bgm: { path: '/old/bgm.mp3', source: 'card', mode: 'mix' } } }
      ]
    }
  }
  doc.director = {
    subjects: [],
    cam: { pos: [0, 0, 1], target: [0, 0, 0], focal: 35 },
    shots: [{ id: 'shot-1', name: 'shot', cam: { pos: [0, 0, 1], target: [0, 0, 0], focal: 35 }, take: 'file:///old/take.png', takes: ['file:///old/take.png'] }]
  }
  const paths = collectProjectMedia(doc).map((entry) => entry.path)
  assert.deepEqual(paths.slice(-4), ['/old/source.mp4', '/old/look.cube', '/old/bgm.mp3', '/old/take.png'])

  const summary = rewriteProjectMediaPaths(doc, new Map(paths.map((path) => [path, restored(path.replace('/old/', '/new/'), path.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream')])))
  const recipe = card.meta.editRecipe as any
  assert.equal(card.meta.sourcePath, '/new/source.mp4')
  assert.equal(recipe.ops[0].params.lutPath, '/new/look.cube')
  assert.equal(recipe.ops[1].params.bgm.path, '/new/bgm.mp3')
  assert.equal(doc.director.shots[0].take, 'file:///new/take.png')
  assert.equal(summary.missingReferences, 0)
}

function testDerivedFilesOnlyParticipateInGcCollection() {
  const doc = project()
  const card = doc.boards[0].cards['card-1']
  card.meta.thumb = 'file:///old/thumb.webp'
  card.meta.poster = 'file:///old/poster.webp'
  assert.equal(collectProjectMedia(doc).some((entry) => entry.path.endsWith('thumb.webp')), false)
  assert.equal(collectProjectMedia(doc, { includeDerived: true }).some((entry) => entry.path.endsWith('thumb.webp')), true)
  assert.equal(collectProjectMedia(doc, { includeDerived: true }).some((entry) => entry.path.endsWith('poster.webp')), true)
}

testCollectsEveryOwnedPathOnce()
testRewritesPrimaryInputsAndResultHistory()
testMarksOnlyUnpackedReferences()
testCollectsAndRewritesRecipeAndDirectorPaths()
testDerivedFilesOnlyParticipateInGcCollection()
console.log('project media: 5 tests OK')
