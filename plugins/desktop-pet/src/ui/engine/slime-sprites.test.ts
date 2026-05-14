import { ALL_EXPRESSIONS, ALL_POSES, type PetSpriteKey } from './pet-standard'
import { SLIME_SPRITE_SET } from './slime-sprites'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function testBuiltInGhostHasEveryPoseExpressionSprite() {
  const missing: PetSpriteKey[] = []

  for (const pose of ALL_POSES) {
    for (const expression of ALL_EXPRESSIONS) {
      const key = `${pose}_${expression}` as PetSpriteKey
      if (!SLIME_SPRITE_SET.sprites[key]) missing.push(key)
    }
  }

  assert(
    missing.length === 0,
    `Built-in ghost is missing ${missing.length} pose/expression sprites: ${missing.join(', ')}`
  )
}

function testBuiltInGhostPoseSpritesKeepSameShape() {
  for (const expression of ALL_EXPRESSIONS) {
    const stand = SLIME_SPRITE_SET.sprites[`stand_${expression}` as PetSpriteKey]
    assert(typeof stand === 'string' && stand.length > 0, `Missing stand sprite for ${expression}`)
    for (const pose of ALL_POSES) {
      const key = `${pose}_${expression}` as PetSpriteKey
      const svg = SLIME_SPRITE_SET.sprites[key]
      assert(typeof svg === 'string' && svg.length > 0, `Missing sprite: ${key}`)
      assert(svg === stand, `${key} should keep the same ghost SVG shape as stand_${expression}`)
      assert(svg.includes('viewBox="19 19 26 24"'), `${key} should keep the original ghost viewBox`)
      assert(!/Z{2,}|zzZ|sleep|icon/i.test(svg), `${key} should not add pose-specific sleep marks or icons`)
    }
  }
}

testBuiltInGhostHasEveryPoseExpressionSprite()
testBuiltInGhostPoseSpritesKeepSameShape()
