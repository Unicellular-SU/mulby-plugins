import assert from 'node:assert/strict'
import { createDefaultProject, useGraph } from '../src/ui/store/graphStore.ts'
import { materializeStoryboardShots, saveStoryboardDoc, shotToVideo } from '../src/ui/services/storyboard.ts'
import {
  createStoryboardDoc,
  readStoryboardDoc,
  sanitizeStoryboardBoard,
  storyboardBacklink,
  storyboardImageState,
  updateStoryboardShot
} from '../src/ui/services/storyboardV2.ts'
import type { Board, Card, Shot } from '../src/ui/types.ts'
import { cardBoundsOverlap } from '../src/ui/services/cardPlacement.ts'

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], boardHistories: {}, clipboard: { cards: [], edges: [] } })
}

function setupOwner(): { ownerId: string; boardId: string } {
  reset()
  const ownerId = useGraph.getState().addCard('text', { x: 100, y: 160 }, {
    title: '短片脚本',
    text: '祖父在厨房给孙女盛汤',
    prompt: ''
  })
  const boardId = useGraph.getState().project.activeBoardId
  useGraph.setState({ boardHistories: {}, selectedIds: [] })
  return { ownerId, boardId }
}

function shots(count = 3): Shot[] {
  return Array.from({ length: count }, (_, index) => ({
    shotNumber: index + 1,
    desc: `画面 ${index + 1}`,
    imagePrompt: `厨房镜头 ${index + 1}`,
    videoPrompt: `镜头缓慢推进 ${index + 1}`,
    shotSize: index % 2 ? '近景' : '中景',
    duration: 5 + index
  }))
}

function testLegacyIdsAreStableAndRegenerationPreservesLinks() {
  const owner = {
    id: 'owner',
    kind: 'text',
    title: '旧分镜',
    text: '故事',
    prompt: '',
    meta: { shots: shots(2) }
  } as unknown as Card
  const first = readStoryboardDoc(owner)!
  const second = readStoryboardDoc(owner)!
  assert.equal(first.id, second.id)
  assert.deepEqual(first.shots.map((shot) => shot.id), second.shots.map((shot) => shot.id), 'V1 懒迁移的稳定 id 不依赖读取次数')

  first.shots[0].imageCardId = 'image-1'
  const regenerated = createStoryboardDoc(owner, [{ ...shots(2)[0], imagePrompt: '新构图' }, shots(2)[1]], first)
  assert.equal(regenerated.shots[0].id, first.shots[0].id)
  assert.equal(regenerated.shots[0].imageCardId, 'image-1')
  assert.equal(regenerated.shots[0].version, first.shots[0].version + 1)
}

function testAtomicAndIdempotentMaterialization() {
  const { ownerId, boardId } = setupOwner()
  const owner = useGraph.getState().getCard(ownerId)!
  const doc = createStoryboardDoc(owner, shots(20))
  const first = materializeStoryboardShots(ownerId, doc)!
  assert.equal(first.created, 20)
  assert.equal(first.updated, 0)
  assert.equal(new Set(first.cardIds).size, 20)
  assert.equal(Object.keys(useGraph.getState().getActiveBoard().cards).length, 21)
  assert.equal(Object.keys(useGraph.getState().getActiveBoard().edges).length, 20)
  assert.equal(useGraph.getState().boardHistories[boardId].past.length, 1, '故事板落地只产生一个 undo')

  const second = materializeStoryboardShots(ownerId, first.doc)!
  assert.equal(second.created, 0)
  assert.equal(second.updated, 0)
  assert.deepEqual(second.cardIds, first.cardIds)
  assert.equal(Object.keys(useGraph.getState().getActiveBoard().cards).length, 21, '重复落地不得复制卡片')
  assert.equal(useGraph.getState().boardHistories[boardId].past.length, 1, '无变化的重复同步不污染撤销历史')

  useGraph.getState().undo()
  assert.equal(Object.keys(useGraph.getState().getActiveBoard().cards).length, 1, '一次撤销移除整个镜头批次')
  useGraph.getState().redo()
  assert.equal(Object.keys(useGraph.getState().getActiveBoard().cards).length, 21)
}

function testEditingMarksExistingOutputStaleAndReusesCard() {
  const { ownerId } = setupOwner()
  const owner = useGraph.getState().getCard(ownerId)!
  const first = materializeStoryboardShots(ownerId, createStoryboardDoc(owner, shots(1)))!
  const imageId = first.cardIds[0]
  useGraph.getState().updateCard(imageId, { assetUrl: 'file:///old.png', assetLocalPath: '/old.png', status: 'done' })

  const changed = updateStoryboardShot(first.doc, first.doc.shots[0].id, { imagePrompt: '改成低机位近景' })
  const saved = saveStoryboardDoc(ownerId, changed)!
  const marked = useGraph.getState().getCard(imageId)!
  assert.equal((marked.meta as any).storyboardInputStale, true)
  assert.equal(storyboardImageState(saved, saved.shots[0], useGraph.getState().getActiveBoard()), 'stale')

  const synced = materializeStoryboardShots(ownerId, saved)!
  assert.equal(synced.created, 0)
  assert.equal(synced.cardIds[0], imageId)
  assert.equal(useGraph.getState().getCard(imageId)!.prompt.includes('改成低机位近景'), true)
  assert.equal((useGraph.getState().getCard(imageId)!.meta as any).storyboardInputStale, true, '同步输入不等于已经重新生成')
}

function testDeletingOutputClearsOnlyStoryboardLink() {
  const { ownerId } = setupOwner()
  const first = materializeStoryboardShots(ownerId, createStoryboardDoc(useGraph.getState().getCard(ownerId)!, shots(2)))!
  useGraph.getState().removeCards([first.cardIds[0]])
  const owner = useGraph.getState().getCard(ownerId)!
  const doc = readStoryboardDoc(owner)!
  assert.equal(doc.shots.length, 2, '删除产物卡不能删除镜头')
  assert.equal(doc.shots[0].imageCardId, undefined)
  assert.equal(doc.shots[1].imageCardId, first.cardIds[1])
}

function testShotToVideoIsIdempotentForV2() {
  const { ownerId } = setupOwner()
  const first = materializeStoryboardShots(ownerId, createStoryboardDoc(useGraph.getState().getCard(ownerId)!, shots(1)), undefined, { aspect: '1:1' })!
  const imageId = first.cardIds[0]
  assert.equal(useGraph.getState().getCard(imageId)?.params.aspect, '1:1')
  shotToVideo(imageId, { aspect: '1:1', plannedDuration: 1.7, generationDuration: 5 })
  const afterFirst = readStoryboardDoc(useGraph.getState().getCard(ownerId)!)!
  const videoId = afterFirst.shots[0].videoCardId
  assert.ok(videoId)
  const video = useGraph.getState().getCard(videoId!)!
  assert.equal(storyboardBacklink(video)?.stage, 'video')
  assert.equal(video.params.aspect, '1:1')
  assert.equal(video.params.duration, 5)
  assert.equal(video.params.plannedDuration, 1.7)

  shotToVideo(imageId, { aspect: '1:1', plannedDuration: 1.7, generationDuration: 5 })
  const afterSecond = readStoryboardDoc(useGraph.getState().getCard(ownerId)!)!
  assert.equal(afterSecond.shots[0].videoCardId, videoId)
  assert.equal(Object.values(useGraph.getState().getActiveBoard().cards).filter((card) => card.kind === 'video').length, 1)
}

function testLegacyBoardMigrationLinksExistingImage() {
  const owner = {
    id: 'owner', kind: 'text', x: 0, y: 0, w: 320, h: 240, title: '旧分镜', prompt: '', text: '故事', meta: { shots: shots(1) }
  } as unknown as Card
  const image = {
    id: 'image', kind: 'image', x: 400, y: 0, w: 280, h: 320, title: '镜1·中景', prompt: '旧提示', meta: { shot: shots(1)[0] }
  } as unknown as Card
  const board: Board = {
    id: 'board', name: 'board', cards: { owner, image },
    edges: { edge: { id: 'edge', source: 'owner', target: 'image', kind: 'ref' } },
    viewport: { x: 0, y: 0, zoom: 1 }
  }
  const migrated = sanitizeStoryboardBoard(board)
  const doc = readStoryboardDoc(migrated.cards.owner)!
  assert.equal(doc.shots[0].imageCardId, 'image')
  assert.equal(storyboardBacklink(migrated.cards.image)?.shotId, doc.shots[0].id)
  assert.equal('shots' in migrated.cards.owner.meta, false)
}

function testAgentMaterializationAvoidsExistingCards() {
  const { ownerId } = setupOwner()
  const graph = useGraph.getState()
  const blockerId = graph.addCard('group', { x: 760, y: 320 }, { title: '已有内容区', w: 1200, h: 720 })
  const existing = [graph.getCard(ownerId)!, graph.getCard(blockerId)!]
  const materialized = materializeStoryboardShots(ownerId, createStoryboardDoc(graph.getCard(ownerId)!, shots(6)))!
  const images = materialized.cardIds.map((id) => useGraph.getState().getCard(id)!)
  for (const image of images) {
    assert.equal(existing.some((card) => cardBoundsOverlap(image, card)), false, `${image.title} 不得遮盖已有卡片`)
  }
  for (let index = 0; index < images.length; index++) {
    for (let other = index + 1; other < images.length; other++) {
      assert.equal(cardBoundsOverlap(images[index], images[other]), false, '同批静帧卡不得互相重叠')
    }
  }

  const videoIds = images.map((image) => shotToVideo(image.id)!).filter(Boolean)
  const videos = videoIds.map((id) => useGraph.getState().getCard(id)!)
  const nonVideos = Object.values(useGraph.getState().getActiveBoard().cards).filter((card) => card.kind !== 'video')
  for (const video of videos) {
    assert.equal(nonVideos.some((card) => cardBoundsOverlap(video, card)), false, `${video.title} 不得遮盖已有卡片或静帧`)
  }
  for (let index = 0; index < videos.length; index++) {
    for (let other = index + 1; other < videos.length; other++) {
      assert.equal(cardBoundsOverlap(videos[index], videos[other]), false, '同批视频卡不得互相重叠')
    }
  }
}

testLegacyIdsAreStableAndRegenerationPreservesLinks()
testAtomicAndIdempotentMaterialization()
testEditingMarksExistingOutputStaleAndReusesCard()
testDeletingOutputClearsOnlyStoryboardLink()
testShotToVideoIsIdempotentForV2()
testLegacyBoardMigrationLinksExistingImage()
testAgentMaterializationAvoidsExistingCards()
console.log('storyboard v2: 7 tests OK')
