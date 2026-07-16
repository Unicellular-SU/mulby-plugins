import assert from 'node:assert/strict'
import {
  buildMaterials,
  extractMentionTokens,
  findUnresolvedMentions,
  replaceMentionInPrompt,
  resolveGenInputs,
  selectedGenMaterials
} from '../src/ui/services/references.ts'
import type { Board, Card } from '../src/ui/types.ts'

function card(id: string, patch: Partial<Card> & Pick<Card, 'kind'>): Card {
  return {
    id,
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    title: patch.title || 'AI 图片',
    prompt: patch.prompt || '',
    text: patch.text,
    refIds: patch.refIds || [],
    assets: patch.assets || [],
    parentId: null,
    status: 'idle',
    params: {},
    ...patch
  } as Card
}

function board(cards: Record<string, Card>): Board {
  return { id: 'b1', name: 'test', cards, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
}

function testExtractMentions() {
  assert.deepEqual(extractMentionTokens('参考 @主角 和 @场景A 的构图'), ['主角', '场景A'])
}

function testUnresolved() {
  const b = board({
    src: card('src', { kind: 'image', title: '主角' }),
    me: card('me', { kind: 'image', prompt: '@主角 @已删除', refIds: ['src'] })
  })
  const mats = buildMaterials(b.cards.me, b)
  assert.deepEqual(findUnresolvedMentions(b.cards.me.prompt, mats), ['已删除'])
}

function testSelectedGenMaterials() {
  const b = board({
    t1: card('t1', { kind: 'text', title: '脚本', text: 'hello' }),
    i1: card('i1', { kind: 'image', title: '参考图', assetUrl: 'x' }),
    me: card('me', { kind: 'image', prompt: '@脚本', refIds: ['t1', 'i1'] })
  })
  const sel = selectedGenMaterials(b.cards.me, b)
  assert.equal(sel.length, 1)
  assert.equal(sel[0].label, '脚本')
  const inputs = resolveGenInputs(b.cards.me, b)
  assert.equal(inputs.texts.length, 1)
  assert.equal(inputs.images.length, 0)
}

function testReplaceMentionOnRename() {
  assert.equal(replaceMentionInPrompt('用 @旧名 的风格', '旧名', '新名'), '用 @新名 的风格')
  assert.equal(replaceMentionInPrompt('@旧名,@旧名2', '旧名', '新名'), '@新名,@旧名2')
}

testExtractMentions()
testUnresolved()
testSelectedGenMaterials()
testReplaceMentionOnRename()
console.log('references: 4 tests OK')
