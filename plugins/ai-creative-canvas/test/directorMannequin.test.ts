import assert from 'node:assert/strict'
import {
  DIRECTOR_BODY_PRESETS,
  DIRECTOR_POSES,
  getDirectorBodyPreset,
  getDirectorDetailedJointDegrees,
  getDirectorProceduralJointDegrees,
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
    assert.equal(preset.offsetY || 0, preset.controls['body.offsetY'] || 0)
    for (const rotation of Object.values(preset.m)) {
      assert.equal(rotation.length, 3)
      assert.ok(rotation.every(Number.isFinite), `${preset.k} 包含非法关节旋转`)
    }
    for (const [key, amount] of Object.entries(preset.controls)) {
      if (key.endsWith('Knee.bend') || key.endsWith('Elbow.bend')) {
        assert.ok(amount >= 0, `${preset.k} 的 ${key} 必须用正值表达向后屈曲`)
      }
    }
  }

  const kneel = getDirectorPose('双膝跪')!
  const procedural = getDirectorProceduralJointDegrees(kneel.controls)
  assert.ok(procedural['左膝'][0] > 0, '程序化骨架屈膝必须折向人物背面 -Z')
  assert.ok(procedural['右膝'][0] > 0, '程序化骨架屈膝必须折向人物背面 -Z')
  assert.ok(procedural['左髋'][0] > 0, '双膝跪的髋部应略向后，而不是把大腿翻到脸前')

  const sit = getDirectorPose('坐姿')!
  const proceduralSit = getDirectorProceduralJointDegrees(sit.controls)
  assert.ok(proceduralSit['左髋'][0] < 0, '坐姿大腿必须抬向人物正面 +Z')
  assert.ok(proceduralSit['左膝'][0] > 0, '坐姿小腿必须向人物背面屈曲')

  const detailed = getDirectorDetailedJointDegrees(kneel.controls)
  assert.ok(detailed['左膝'][0] > 0, '高精 humanoid 屈膝必须绕人物 +X 折向背面')
  assert.ok(detailed['右膝'][0] > 0, '高精 humanoid 左右膝的世界轴规则必须一致')
}

testBodyPresets()
testPosePresets()
console.log('director mannequin: 8 body types / 20 semantic poses / facing rules OK')
