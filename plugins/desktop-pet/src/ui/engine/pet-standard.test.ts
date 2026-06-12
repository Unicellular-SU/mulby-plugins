import {
  ALL_EXPRESSIONS,
  ALL_POSES,
  compactSpriteSet,
  expandSpriteSet,
  type PetSpriteKey,
  type PetSpriteSet,
} from './pet-standard'
import { composeSpriteSet } from './sprite-composer'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** 构造一套"姿态共享同图"的完整套装(与合成器产物同构) */
function makeFullSpriteSet(): PetSpriteSet {
  const grid = new Int16Array(64 * 64).fill(-1)
  for (let y = 20; y < 44; y++) {
    for (let x = 20; x < 44; x++) {
      grid[y * 64 + x] = 0
    }
  }
  return composeSpriteSet(
    { palette: ['#88aacc'], grid, width: 64, height: 64 },
    { id: 'roundtrip', name: '回环', description: '压缩等价性测试' }
  )
}

function testCompactDeduplicatesSharedSprites() {
  const set = makeFullSpriteSet()
  const compact = compactSpriteSet(set)

  assert(compact.v === 1, 'compact format version should be 1')
  assert(Object.keys(compact.keys).length === 195, `all 195 keys should be recorded, got ${Object.keys(compact.keys).length}`)
  assert(
    compact.svgs.length === ALL_EXPRESSIONS.length,
    `poses share the same svg per expression, so unique svgs should be ${ALL_EXPRESSIONS.length}, got ${compact.svgs.length}`
  )

  const full = JSON.stringify(set).length
  const small = JSON.stringify(compact).length
  assert(small < full / 5, `compact form should shrink storage at least 5x (full=${full}, compact=${small})`)
}

function testCompactExpandRoundTripPreservesEverything() {
  const set = makeFullSpriteSet()
  // 模拟 mulby.storage 的 JSON 序列化通道
  const restored = expandSpriteSet(JSON.parse(JSON.stringify(compactSpriteSet(set))))
  assert(restored !== null, 'round trip should succeed')

  assert(restored.id === set.id && restored.name === set.name, 'meta should survive round trip')
  assert(restored.description === set.description, 'description should survive round trip')
  assert(restored.createdAt === set.createdAt, 'createdAt should survive round trip')

  for (const pose of ALL_POSES) {
    for (const expression of ALL_EXPRESSIONS) {
      const key = `${pose}_${expression}` as PetSpriteKey
      assert(restored.sprites[key] === set.sprites[key], `sprite ${key} should be byte-identical after round trip`)
    }
  }
}

function testExpandRejectsGarbage() {
  assert(expandSpriteSet(null) === null, 'null should be rejected')
  assert(expandSpriteSet('not-an-object') === null, 'primitive should be rejected')
  assert(expandSpriteSet({}) === null, 'missing fields should be rejected')
  assert(expandSpriteSet({ v: 2, svgs: [], keys: {} }) === null, 'unknown version should be rejected')
  assert(expandSpriteSet({ v: 1, svgs: 'nope', keys: {} }) === null, 'non-array svgs should be rejected')
  assert(expandSpriteSet({ v: 1, svgs: [], keys: {} }) === null, 'empty mapping should be rejected')
}

function testExpandSkipsInvalidEntries() {
  const restored = expandSpriteSet({
    v: 1,
    id: 'x',
    name: 'x',
    description: '',
    createdAt: 123,
    svgs: ['<svg>a</svg>', 42, ''],
    keys: {
      stand_neutral: 0,
      stand_happy: 1, // 指向非字符串 → 跳过
      stand_sad: 2, // 指向空字符串 → 跳过
      stand_angry: 99, // 越界 → 跳过
      not_a_key: 0, // 非法 key → 跳过
      sit_neutral: '0', // 非整数下标 → 跳过
    },
  })
  assert(restored !== null, 'partially valid data should still expand')
  assert(restored.sprites['stand_neutral'] === '<svg>a</svg>', 'valid entry should survive')
  const keys = Object.keys(restored.sprites)
  assert(keys.length === 1, `only the valid entry should survive, got ${keys.join(',')}`)
  assert(restored.createdAt === 123, 'createdAt should be preserved when valid')
}

testCompactDeduplicatesSharedSprites()
testCompactExpandRoundTripPreservesEverything()
testExpandRejectsGarbage()
testExpandSkipsInvalidEntries()
