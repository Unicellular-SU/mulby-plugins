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

function testSemanticAssetsMigrationAndSanitization() {
  const d = doc({
    source: card('source', { kind: 'image', assetUrl: 'file:///role.png', meta: { semanticAnchorId: 'stale' } }),
    target: card('target', {
      kind: 'video',
      anchorRefs: [
        { anchorId: 'role', mention: '旧称', acceptedAt: 3 },
        { anchorId: 'role', mention: '重复', acceptedAt: 4 },
        { anchorId: 'missing', mention: '不存在', acceptedAt: 5 }
      ]
    })
  }, 2)
  ;(d as any).assetAnchors = {
    role: {
      id: 'role',
      role: 'character',
      name: '阿星',
      aliases: [' 主角 ', '', '主角'],
      tags: ['红衣'],
      description: '角色连续性锚点',
      mediaKind: 'image',
      source: { boardId: 'b1', cardId: 'source' },
      revision: 2,
      locked: false,
      createdAt: 1,
      updatedAt: 2
    },
    invalid: { id: 'invalid', role: 'unknown', name: '坏数据', mediaKind: 'image' }
  }

  const migrated = migrateProject(d)
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION)
  assert.deepEqual(Object.keys(migrated.assetAnchors || {}), ['role'])
  assert.deepEqual(migrated.assetAnchors?.role.aliases, ['主角'])
  assert.equal((migrated.boards[0].cards.source.meta as any).semanticAnchorId, 'role')
  assert.deepEqual(migrated.boards[0].cards.target.anchorRefs, [{ anchorId: 'role', mention: '阿星', acceptedAt: 3 }])
}

function testLegacyProjectInitializesEmptyAnchorIndex() {
  const migrated = migrateProject(doc({ source: card('source', { kind: 'image' }) }, 2))
  assert.deepEqual(migrated.assetAnchors, {})
}

function testLegacyStoryboardMigratesWithExistingOutputBacklink() {
  const legacyShot = {
    shotNumber: 1,
    shotSize: '中景',
    duration: 5,
    desc: '祖父在厨房给孙女盛汤',
    imagePrompt: '暖色厨房，中景'
  }
  const legacy = doc({
    owner: card('owner', {
      kind: 'text',
      title: '短片脚本',
      text: '祖父在厨房给孙女盛汤',
      meta: { shots: [legacyShot] }
    }),
    image: card('image', {
      kind: 'image',
      title: '镜1·中景',
      meta: { shot: legacyShot }
    })
  }, 3)
  legacy.boards[0].edges = {
    edge: { id: 'edge', source: 'owner', target: 'image', kind: 'ref' }
  }

  const migrated = migrateProject(legacy)
  const ownerMeta = migrated.boards[0].cards.owner.meta as any
  const imageMeta = migrated.boards[0].cards.image.meta as any
  assert.equal(migrated.schemaVersion, SCHEMA_VERSION)
  assert.equal(ownerMeta.shots, undefined)
  assert.equal(ownerMeta.storyboardV2.version, 2)
  assert.equal(ownerMeta.storyboardV2.shots[0].imageCardId, 'image')
  assert.equal(imageMeta.storyboardBacklink.storyboardId, ownerMeta.storyboardV2.id)
  assert.equal(imageMeta.storyboardBacklink.shotId, ownerMeta.storyboardV2.shots[0].id)
  assert.equal(imageMeta.storyboardBacklink.stage, 'image')
}

testPanoMigration()
testStaleShardUnderV2ManifestStillMigrates()
testMigrationPinsPanoModel()
testPanoSurvivesSanitize()
testSemanticAssetsMigrationAndSanitization()
testLegacyProjectInitializesEmptyAnchorIndex()
testLegacyStoryboardMigratesWithExistingOutputBacklink()
console.log('persistence: 7 tests OK')
