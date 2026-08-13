import assert from 'node:assert/strict'
import { createDefaultProject, useGraph } from '../src/ui/store/graphStore.ts'
import { layoutStoryboardCards, materializeStoryboardShots, saveStoryboardDoc } from '../src/ui/services/storyboard.ts'
import { createStoryboardDoc, removeStoryboardShot, storyboardBacklink } from '../src/ui/services/storyboardV2.ts'
import { filterStoryboardShots, listProjectStoryboards, virtualShotWindow } from '../src/ui/services/storyboardWorkspace.ts'
import type { AssetAnchor, Board, Card, ProjectDoc, Shot } from '../src/ui/types.ts'

function reset() {
  useGraph.setState({ project: createDefaultProject(), selectedIds: [], boardHistories: {}, clipboard: { cards: [], edges: [] } })
}

function shots(count: number): Shot[] {
  return Array.from({ length: count }, (_, index) => ({
    shotNumber: index + 1,
    desc: `画面 ${index + 1}`,
    imagePrompt: index === 1 ? '雨夜车站，女孩等待列车' : `厨房镜头 ${index + 1}`,
    videoPrompt: `缓慢推进 ${index + 1}`,
    scene: index === 1 ? '车站' : '厨房',
    character: index === 1 ? '女孩' : '祖父',
    duration: 5
  }))
}

function ownerCard(id: string, title: string): Card {
  return {
    id, kind: 'text', x: 0, y: 0, w: 300, h: 220, title, prompt: '', text: title,
    modelId: null, providerId: null, params: {}, status: 'idle', progress: 0, error: null,
    assetUrl: null, assetLocalPath: null, attachmentId: null, mime: null, refIds: [], assets: [], meta: {}, parentId: null
  }
}

function testProjectProjectionAndFilters() {
  const ownerA = ownerCard('owner-a', '厨房短片')
  const ownerB = ownerCard('owner-b', '车站短片')
  const docA = createStoryboardDoc(ownerA, shots(3))
  docA.shots[0].anchorIds = ['grandpa']
  docA.shots[1].anchorIds = ['girl']
  ownerA.meta = { storyboardV2: docA }
  ownerB.meta = { storyboardV2: createStoryboardDoc(ownerB, shots(1)) }
  const boardA: Board = { id: 'a', name: '主画布', cards: { [ownerA.id]: ownerA }, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
  const boardB: Board = { id: 'b', name: '补充', cards: { [ownerB.id]: ownerB }, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
  const project: ProjectDoc = { ...createDefaultProject(), boards: [boardA, boardB], activeBoardId: boardA.id }
  const entries = listProjectStoryboards(project)
  assert.equal(entries.length, 2)
  assert.deepEqual(new Set(entries.map((entry) => entry.boardId)), new Set(['a', 'b']))

  const anchors: Record<string, AssetAnchor> = {
    grandpa: { id: 'grandpa', role: 'character', name: '祖父', aliases: ['爷爷'], tags: [], description: '', mediaKind: 'image', revision: 1, locked: false, createdAt: 1, updatedAt: 1 },
    girl: { id: 'girl', role: 'character', name: '女孩', aliases: [], tags: [], description: '', mediaKind: 'image', revision: 1, locked: false, createdAt: 1, updatedAt: 1 }
  }
  const entryA = entries.find((entry) => entry.owner.id === ownerA.id)!
  assert.deepEqual(filterStoryboardShots(entryA, anchors, { query: '雨夜车站' }).map((shot) => shot.shotNumber), [2])
  assert.deepEqual(filterStoryboardShots(entryA, anchors, { anchorIds: new Set(['grandpa']) }).map((shot) => shot.shotNumber), [1])
  assert.equal(filterStoryboardShots(entryA, anchors, { state: 'needs-attention' }).length, 3, '未落地镜头属于需处理')
}

function testHundredShotVirtualWindow() {
  const range = virtualShotWindow(100, 82, 4100, 720)
  assert.ok(range.start > 40 && range.start < 55)
  assert.ok(range.end - range.start <= 20, '100 镜只渲染视口附近的有限行')
  assert.equal(range.totalHeight, 8200)
  assert.equal(range.offset, range.start * 82)
}

function testAtomicStoryboardLayoutLeavesUnrelatedCardsUntouched() {
  reset()
  const ownerId = useGraph.getState().addCard('text', { x: 250, y: 300 }, { title: '100 镜脚本', text: '长片脚本' })
  const unrelatedId = useGraph.getState().addCard('note', { x: -200, y: -120 }, { title: '不要移动我' })
  const owner = useGraph.getState().getCard(ownerId)!
  const unrelatedBefore = useGraph.getState().getCard(unrelatedId)!
  const first = materializeStoryboardShots(ownerId, createStoryboardDoc(owner, shots(100)))!
  const boardId = useGraph.getState().project.activeBoardId
  useGraph.setState({ boardHistories: {}, selectedIds: [] })

  const result = layoutStoryboardCards(ownerId, first.doc)!
  assert.equal(result.cardIds.length, 100)
  assert.ok(result.moved > 0)
  assert.equal(useGraph.getState().boardHistories[boardId].past.length, 1, '100 镜排版只产生一次 undo')
  const after = useGraph.getState().getActiveBoard()
  const ownerAfter = after.cards[ownerId]
  const firstCard = after.cards[first.doc.shots[0].imageCardId!]
  const lastCard = after.cards[first.doc.shots[99].imageCardId!]
  assert.equal(firstCard.x, ownerAfter.x + ownerAfter.w + 120)
  assert.equal(firstCard.y, ownerAfter.y)
  assert.equal(lastCard.y, ownerAfter.y + 99 * 370)
  assert.equal(after.cards[unrelatedId].x, unrelatedBefore.x)
  assert.equal(after.cards[unrelatedId].y, unrelatedBefore.y)

  const repeated = layoutStoryboardCards(ownerId, first.doc)!
  assert.equal(repeated.moved, 0)
  assert.equal(useGraph.getState().boardHistories[boardId].past.length, 1, '重复排版不污染撤销历史')
  useGraph.getState().undo()
  assert.notEqual(useGraph.getState().getActiveBoard().cards[first.doc.shots[99].imageCardId!].y, lastCard.y)
}

function testDeletingShotKeepsOutputAsDetachedFreeCard() {
  reset()
  const ownerId = useGraph.getState().addCard('text', { x: 0, y: 0 }, { text: '单镜脚本' })
  const first = materializeStoryboardShots(ownerId, createStoryboardDoc(useGraph.getState().getCard(ownerId)!, shots(1)))!
  const imageId = first.cardIds[0]
  saveStoryboardDoc(ownerId, removeStoryboardShot(first.doc, first.doc.shots[0].id))
  const image = useGraph.getState().getCard(imageId)
  assert.ok(image, '删除镜头不删除已生成或已落地的自由卡片')
  assert.equal(storyboardBacklink(image), null, '删除镜头后清除失效 backlink')
}

testProjectProjectionAndFilters()
testHundredShotVirtualWindow()
testAtomicStoryboardLayoutLeavesUnrelatedCardsUntouched()
testDeletingShotKeepsOutputAsDetachedFreeCard()
console.log('storyboard workspace: 4 tests OK')
