import assert from 'node:assert/strict'
import { suggestAssetAnchors } from '../src/ui/services/referenceSuggestions.ts'
import { makeAssetAnchor, materialFromAnchor } from '../src/ui/services/semanticAssets.ts'
import type { Board, Card, ProjectDoc } from '../src/ui/types.ts'

function card(id: string, kind: Card['kind'], patch: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    title: kind === 'text' ? 'AI 文本' : 'AI 图片',
    prompt: '',
    modelId: null,
    providerId: null,
    params: {},
    status: 'idle',
    progress: 0,
    error: null,
    assetUrl: null,
    assetLocalPath: null,
    attachmentId: null,
    mime: null,
    text: null,
    refIds: [],
    assets: [],
    meta: {},
    parentId: null,
    ...patch
  }
}

function project(cards: Record<string, Card>): ProjectDoc {
  const board: Board = { id: 'board-1', name: '画布', cards, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
  return {
    id: 'project-1',
    name: '语义素材测试',
    boards: [board],
    activeBoardId: board.id,
    globalModelId: null,
    assetAnchors: {},
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 3
  }
}

function testUnlockedAnchorTracksSourceCard() {
  const doc = project({ source: card('source', 'image', { assetUrl: 'file:///v1.png', assetLocalPath: '/v1.png', mime: 'image/png' }) })
  const anchor = makeAssetAnchor(doc, 'source', { role: 'character', name: '阿星', locked: false })
  doc.assetAnchors = { [anchor.id]: anchor }
  assert.equal(materialFromAnchor(anchor, doc).assetLocalPath, '/v1.png')

  doc.boards[0].cards.source = { ...doc.boards[0].cards.source, assetUrl: 'file:///v2.png', assetLocalPath: '/v2.png' }
  assert.equal(materialFromAnchor(anchor, doc).assetLocalPath, '/v2.png', '未锁定锚点应跟随源卡最新产物')

  delete doc.boards[0].cards.source
  assert.equal(materialFromAnchor(anchor, doc).unavailable, true, '源卡删除后未锁定锚点应明确失效')
}

function testLockedAnchorPinsCurrentMedia() {
  const doc = project({ source: card('source', 'image', { assetUrl: 'file:///v1.png', assetLocalPath: '/v1.png', mime: 'image/png' }) })
  const anchor = makeAssetAnchor(doc, 'source', { role: 'character', name: '阿星', locked: true })
  assert.equal(anchor.locked, true)
  assert.equal(anchor.pinnedMedia?.assetLocalPath, '/v1.png')

  doc.boards[0].cards.source = { ...doc.boards[0].cards.source, assetUrl: 'file:///v2.png', assetLocalPath: '/v2.png' }
  assert.equal(materialFromAnchor(anchor, doc).assetLocalPath, '/v1.png', '锁定锚点不得被源卡后续生成覆盖')
  const renamed = makeAssetAnchor(doc, 'source', { id: anchor.id, role: 'character', name: '阿星新称', locked: true }, anchor)
  assert.equal(renamed.pinnedMedia?.assetLocalPath, '/v1.png', '只编辑锚点信息不得悄悄改锁定版本')

  delete doc.boards[0].cards.source
  assert.equal(materialFromAnchor(anchor, doc).assetLocalPath, '/v1.png', '锁定锚点应在源卡删除后继续可用')
}

function testAutoLinkUsesAliasesAndNeverMutates() {
  const target = card('target', 'video', { title: '第 3 镜', prompt: '小满推开门走入雨夜街道' })
  const doc = project({
    source: card('source', 'image', { assetUrl: 'file:///role.png', assetLocalPath: '/role.png' }),
    target
  })
  const anchor = makeAssetAnchor(doc, 'source', {
    role: 'character',
    name: '林小满',
    aliases: ['小满'],
    description: '穿红色风衣的年轻记者',
    tags: ['记者']
  })
  doc.assetAnchors = { [anchor.id]: anchor }

  const suggestions = suggestAssetAnchors(target, doc, target.prompt)
  assert.equal(suggestions[0]?.anchor.id, anchor.id)
  assert.equal(suggestions[0]?.reasons.some((reason) => reason.includes('别名')), true)
  assert.deepEqual(target.anchorRefs, undefined, 'AutoLink 只给建议，不能暗中改工程')

  const boundTarget = { ...target, anchorRefs: [{ anchorId: anchor.id, mention: anchor.name, acceptedAt: 1 }] }
  assert.deepEqual(suggestAssetAnchors(boundTarget, doc, boundTarget.prompt), [], '已绑定锚点不应重复建议')
}

testUnlockedAnchorTracksSourceCard()
testLockedAnchorPinsCurrentMedia()
testAutoLinkUsesAliasesAndNeverMutates()
console.log('semantic assets: 3 tests OK')
