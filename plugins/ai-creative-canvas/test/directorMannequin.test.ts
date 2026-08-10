import assert from 'node:assert/strict'
import {
  DIRECTOR_BODY_PRESETS,
  DIRECTOR_POSES,
  getDirectorBodyPreset,
  getDirectorPose
} from '../src/ui/canvas/directorMannequin.ts'

function testBodyPresets() {
  assert.equal(DIRECTOR_BODY_PRESETS.length, 8)
  assert.equal(new Set(DIRECTOR_BODY_PRESETS.map((preset) => preset.bodyType)).size, 8)
  assert.equal(getDirectorBodyPreset('unknown').bodyType, 'mannequin')
  assert.ok(getDirectorBodyPreset('child').proportions.hipY < getDirectorBodyPreset('mannequin').proportions.hipY)
  assert.ok(getDirectorBodyPreset('broad').proportions.shoulderWidth > getDirectorBodyPreset('slim').proportions.shoulderWidth)
  assert.ok(getDirectorBodyPreset('chibi').proportions.headRadius > getDirectorBodyPreset('mannequin').proportions.headRadius)
}

function testPosePresets() {
  assert.equal(DIRECTOR_POSES.length, 20)
  assert.equal(new Set(DIRECTOR_POSES.map((preset) => preset.k)).size, 20)
  assert.deepEqual(getDirectorPose('站立')?.m, {})
  assert.ok(getDirectorPose('T型')?.m['左肩'])
  assert.ok((getDirectorPose('蹲下')?.offsetY || 0) < 0)
  for (const preset of DIRECTOR_POSES) {
    for (const rotation of Object.values(preset.m)) {
      assert.equal(rotation.length, 3)
      assert.ok(rotation.every(Number.isFinite), `${preset.k} 包含非法关节旋转`)
    }
  }
}

testBodyPresets()
testPosePresets()
console.log('director mannequin: 8 body types / 20 poses OK')
