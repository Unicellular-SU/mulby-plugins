import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DIRECTOR_BODY_PRESETS,
  DIRECTOR_POSES,
  getDirectorBodyPreset,
  getDirectorDetailedJointDegrees,
  getDirectorProceduralJointDegrees,
  getDirectorPose,
  isDirectorNeutralBodyType
} from '../src/ui/canvas/directorMannequin.ts'
import { DirectorAsyncResourceCache } from '../src/ui/canvas/directorAssetCache.ts'
import {
  classifyDirectorShot,
  createDirectorShotSnapshot,
  inferDirectorInspectorTab,
  reorderDirectorShots
} from '../src/ui/canvas/directorWorkflow.ts'
import type { DirectorCam } from '../src/ui/types.ts'

function testBodyPresets() {
  assert.equal(DIRECTOR_BODY_PRESETS.length, 13)
  assert.equal(new Set(DIRECTOR_BODY_PRESETS.map((preset) => preset.bodyType)).size, 13)
  assert.equal(new Set(DIRECTOR_BODY_PRESETS.map((preset) => preset.assetFile)).size, 13, '每种素体必须使用独立模型文件')
  assert.deepEqual(new Set(DIRECTOR_BODY_PRESETS.map((preset) => preset.group)), new Set(['adult', 'age', 'build']))
  assert.equal(getDirectorBodyPreset('unknown').bodyType, 'mannequin')
  assert.ok(getDirectorBodyPreset('child').proportions.hipY < getDirectorBodyPreset('mannequin').proportions.hipY)
  assert.ok(getDirectorBodyPreset('broad').proportions.shoulderWidth > getDirectorBodyPreset('slim').proportions.shoulderWidth)
  assert.ok(getDirectorBodyPreset('chibi').proportions.headRadius > getDirectorBodyPreset('mannequin').proportions.headRadius)
  assert.match(getDirectorBodyPreset('seniorFemale').promptLabel, /老年女性/)
  assert.match(getDirectorBodyPreset('heavyFemale').promptLabel, /丰腴女性/)
  assert.deepEqual(
    DIRECTOR_BODY_PRESETS.filter((preset) => isDirectorNeutralBodyType(preset.bodyType)).map((preset) => preset.bodyType),
    ['female', 'slim', 'teenFemale', 'childFemale', 'seniorFemale', 'heavyFemale']
  )
}

function testNativeBodyAssets() {
  const assetDir = new URL('../src/ui/public/models/director/', import.meta.url)
  for (const preset of DIRECTOR_BODY_PRESETS) {
    const gltfUrl = new URL(preset.assetFile, assetDir)
    assert.ok(existsSync(gltfUrl), `${preset.assetFile} should exist`)
    const gltf = JSON.parse(readFileSync(gltfUrl, 'utf8'))
    const nodeNames = new Set((gltf.nodes || []).map((node: { name?: string }) => node.name))
    assert.ok(nodeNames.has('pelvis') && nodeNames.has('head'), `${preset.assetFile} should use the shared humanoid rig`)
    assert.ok(Array.isArray(gltf.skins) && gltf.skins.length > 0, `${preset.assetFile} should contain skinning data`)
    const bufferFile = gltf.buffers?.[0]?.uri
    assert.equal(typeof bufferFile, 'string', `${preset.assetFile} should reference an external mesh buffer`)
    const bufferUrl = new URL(bufferFile, assetDir)
    assert.ok(existsSync(bufferUrl), `${bufferFile} should exist`)
    assert.ok(statSync(fileURLToPath(bufferUrl)).size > 500_000, `${bufferFile} should contain the detailed body mesh`)
  }
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

async function testDirectorAssetCache() {
  const cache = new DirectorAsyncResourceCache<string, { id: string }>()
  let calls = 0
  const loader = async () => {
    calls++
    await Promise.resolve()
    return { id: 'adult-male' }
  }
  const [first, second] = await Promise.all([cache.load('mannequin', loader), cache.load('mannequin', loader)])
  assert.equal(calls, 1, '并发选择同一素体时只应发起一次资源请求')
  assert.equal(first, second, '并发请求应复用同一个模板对象')
  assert.equal(cache.peek('mannequin'), first)
  await cache.load('mannequin', loader)
  assert.equal(calls, 1, '成功资源应在当前会话持续复用')

  let retries = 0
  const retryCache = new DirectorAsyncResourceCache<string, string>()
  assert.equal(await retryCache.load('female', async () => { retries++; throw new Error('temporary') }), null)
  assert.equal(await retryCache.load('female', async () => { retries++; return 'loaded' }), 'loaded')
  assert.equal(retries, 2, '失败请求不能被永久缓存，应允许下次选择重试')
}

function testDirectorWorkflow() {
  assert.equal(inferDirectorInspectorTab(null), 'camera')
  assert.equal(inferDirectorInspectorTab('人台'), 'character')
  assert.equal(inferDirectorInspectorTab('道具'), 'object')
  assert.equal(inferDirectorInspectorTab('模型'), 'object')

  const cam: DirectorCam = { pos: [0, 1.5, 2.6], target: [0, 1, 0], focal: 35 }
  assert.equal(classifyDirectorShot(cam), '中景')
  const shot = createDirectorShotSnapshot({ id: 'a', name: '机位1', cam, aspect: '16:9', lighting: '夜景冷调' })
  assert.equal(shot.shotType, '中景')
  assert.equal(shot.aspect, '16:9')
  assert.equal(shot.lighting, '夜景冷调')

  const shots = [
    shot,
    { ...shot, id: 'b', name: '机位2' },
    { ...shot, id: 'c', name: '机位3' }
  ]
  assert.deepEqual(reorderDirectorShots(shots, 'b', 'c').map((item) => item.id), ['a', 'c', 'b'])
  assert.deepEqual(reorderDirectorShots(shots, 'c', 'a').map((item) => item.id), ['c', 'a', 'b'])
  assert.equal(reorderDirectorShots(shots, 'missing', 'a'), shots, '非法拖动不应制造无意义的新数组')
}

testBodyPresets()
testNativeBodyAssets()
testPosePresets()
testDirectorWorkflow()
await testDirectorAssetCache()
console.log('director mannequin: 13 native body meshes / 20 semantic poses / lazy assets / shot workflow OK')
