import assert from 'node:assert/strict'
import { migrateProject } from '../src/ui/services/persistence.ts'
import { SCHEMA_VERSION } from '../src/ui/types.ts'
import type { Board, Card, ProjectDoc } from '../src/ui/types.ts'

function card(id: string, patch: Partial<Card> & Pick<Card, 'kind'>): Card {
  return {
    id,
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    title: 'AI 图片',
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

function doc(cards: Record<string, Card>, schemaVersion: number): ProjectDoc {
  const board: Board = { id: 'b1', name: 'test', cards, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
  return {
    id: 'p1',
    name: 'test',
    boards: [board],
    activeBoardId: 'b1',
    globalModelId: null,
    createdAt: 1,
    updatedAt: 1,
    schemaVersion
  }
}

// v1 → v2：图片卡上的 params.pano 开关（未生成）与 meta.pano 标记（已生成）都独立成 pano 卡
function testPanoMigration() {
  const d = migrateProject(
    doc(
      {
        a: card('a', { kind: 'image', params: { pano: '1', aspect: '2:1', resolution: '1K' } }),
        b: card('b', { kind: 'image', assetUrl: 'file:///x.png', meta: { pano: true, results: [] } }),
        c: card('c', { kind: 'image', params: { aspect: '1:1' } }),
        d: card('d', { kind: 'image', meta: { shot: { desc: '分镜' } } }) // meta.shot 分镜卡不得被卷入
      },
      1
    )
  )
  const cards = d.boards[0].cards
  assert.equal(cards.a.kind, 'pano')
  assert.equal((cards.a.params as any).pano, undefined) // 开关字段应被移除
  assert.equal((cards.a.params as any).aspect, '2:1') // 其余参数保留
  assert.equal((cards.a.params as any).resolution, '2K') // 1K 归一到 pano 最低档 2K
  assert.equal(cards.b.kind, 'pano')
  assert.equal((cards.b.meta as any).results.length, 0) // meta 其余字段保留
  assert.equal(cards.c.kind, 'image')
  assert.equal(cards.d.kind, 'image')
  assert.equal(d.schemaVersion, SCHEMA_VERSION)
}

// 关键回归：分片持久化下 v2 manifest 可能配着未重写的 v1 旧分片——迁移必须无条件跑，
// 不能被 schemaVersion===2 短路（否则未编辑画布的全景卡永久失去迁移机会）
function testStaleShardUnderV2ManifestStillMigrates() {
  const d = migrateProject(doc({ s: card('s', { kind: 'image', meta: { pano: true } }) }, SCHEMA_VERSION))
  assert.equal(d.boards[0].cards.s.kind, 'pano')
}

// v1 全景生成忽略 card.modelId、直用工程「360 专用模型」：迁移要把专用模型钉到卡上保持行为；
// 未配专用模型则保留原 modelId
function testMigrationPinsPanoModel() {
  const base = doc({ p: card('p', { kind: 'image', params: { pano: '1' }, modelId: 'general-image' }) }, 1)
  const withDefault = migrateProject({ ...base, defaultPanoModel: 'equirect-lora' })
  assert.equal(withDefault.boards[0].cards.p.modelId, 'equirect-lora')
  const withoutDefault = migrateProject(doc({ p: card('p', { kind: 'image', params: { pano: '1' }, modelId: 'general-image' }) }, 1))
  assert.equal(withoutDefault.boards[0].cards.p.modelId, 'general-image')
}

// pano 卡不能被 sanitizeBoards 当畸形卡剔除
function testPanoSurvivesSanitize() {
  const d = migrateProject(doc({ p: card('p', { kind: 'pano', assetUrl: 'file:///x.png' }) }, SCHEMA_VERSION))
  assert.equal(d.boards[0].cards.p?.kind, 'pano')
}

testPanoMigration()
testStaleShardUnderV2ManifestStillMigrates()
testMigrationPinsPanoModel()
testPanoSurvivesSanitize()
console.log('persistence: 4 tests OK')
