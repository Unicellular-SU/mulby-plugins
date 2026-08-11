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
  analyzeDirectorShotContinuity,
  classifyDirectorShot,
  createDirectorShotSnapshot,
  formatDirectorDuration,
  getDirectorShotsDurationMs,
  inferDirectorInspectorTab,
  normalizeDirectorShotDuration,
  reorderDirectorShots
} from '../src/ui/canvas/directorWorkflow.ts'
import type { DirectorCam } from '../src/ui/types.ts'
import { Object3D, Vector3 } from 'three'
import { createDirectorPresetCamera, DIRECTOR_CAMERA_PRESETS } from '../src/ui/canvas/directorCameraPresets.ts'
import { solveDirectorCcdIk } from '../src/ui/canvas/directorIk.ts'
import {
  clampDirectorJointDegrees,
  DIRECTOR_JOINT_NAMES,
  DIRECTOR_POSE_GROUPS,
  validateDirectorJointRotations,
  validateDirectorPoseControls
} from '../src/ui/canvas/directorPoseTools.ts'

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
  assert.equal(shot.durationMs, 4000)
  assert.equal(createDirectorShotSnapshot({ id: 'note', name: '备注镜头', cam, durationMs: 2500, notes: '  停顿后转身  ' }).notes, '停顿后转身')

  const shots = [
    shot,
    { ...shot, id: 'b', name: '机位2' },
    { ...shot, id: 'c', name: '机位3' }
  ]
  assert.deepEqual(reorderDirectorShots(shots, 'b', 'c').map((item) => item.id), ['a', 'c', 'b'])
  assert.deepEqual(reorderDirectorShots(shots, 'c', 'a').map((item) => item.id), ['c', 'a', 'b'])
  assert.equal(reorderDirectorShots(shots, 'missing', 'a'), shots, '非法拖动不应制造无意义的新数组')

  assert.equal(normalizeDirectorShotDuration(undefined), 4000)
  assert.equal(normalizeDirectorShotDuration(100), 500)
  assert.equal(normalizeDirectorShotDuration(200000), 120000)
  assert.equal(normalizeDirectorShotDuration(3456), 3500)
  assert.equal(getDirectorShotsDurationMs([{ ...shot, durationMs: 2500 }, { ...shot, id: 'd', durationMs: 5000 }]), 7500)
  assert.equal(formatDirectorDuration(7500), '0:08')

  const jumpCut = analyzeDirectorShotContinuity([shot, { ...shot, id: 'near', cam: { ...cam, pos: [0.05, 1.5, 2.55] } }])
  assert.ok(jumpCut.some((issue) => issue.code === 'jump-cut' && issue.severity === 'warning'))

  const focalJump = analyzeDirectorShotContinuity([shot, { ...shot, id: 'tele', cam: { ...cam, focal: 85 } }])
  assert.ok(focalJump.some((issue) => issue.code === 'focal-jump' && issue.severity === 'info'))

  const cleanCut = analyzeDirectorShotContinuity([shot, {
    ...shot,
    id: 'clean',
    cam: { pos: [2.6, 1.5, 2.6], target: [0, 1, 0], focal: 35 }
  }])
  assert.equal(cleanCut.length, 0, '有足够角度变化且画幅灯光一致的切换不应误报')

  const reverseCam: DirectorCam = { pos: [0, 1, -2.6], target: [0, 1, 0], focal: 85 }
  const reversal = analyzeDirectorShotContinuity([
    { ...shot, cam, aspect: '16:9', lighting: '默认' },
    { ...shot, id: 'reverse', cam: reverseCam, aspect: '9:16', lighting: '夜景冷调' }
  ])
  assert.ok(reversal.some((issue) => issue.code === 'axis-reversal'))
  assert.ok(reversal.some((issue) => issue.code === 'aspect-change'))
  assert.ok(reversal.some((issue) => issue.code === 'lighting-change'))
}

function testDirectorPoseTools() {
  assert.equal(DIRECTOR_JOINT_NAMES.length, 16)
  assert.equal(new Set(DIRECTOR_POSE_GROUPS.flatMap((group) => group.poses)).size, DIRECTOR_POSES.length)
  for (const preset of DIRECTOR_POSES) {
    assert.equal(validateDirectorPoseControls(preset.controls).level, 'safe', `${preset.k} 应通过姿势控制安全校验`)
  }

  assert.equal(clampDirectorJointDegrees('左膝', 1, 80), 25, '膝关节侧向扭转必须钳到安全范围')
  assert.equal(clampDirectorJointDegrees('头', 0, Number.NaN), 0)
  const warning = validateDirectorJointRotations({ 头: [58, 0, 0] })
  assert.equal(warning.level, 'warning')
  assert.match(warning.issues[0].message, /接近活动上限/)
  const error = validateDirectorJointRotations({ 左肘: [0, 42, 0] })
  assert.equal(error.level, 'error')
  assert.match(error.issues[0].message, /超出安全范围/)
}

function testDirectorCameraPresets() {
  assert.equal(DIRECTOR_CAMERA_PRESETS.length, 8)
  assert.equal(new Set(DIRECTOR_CAMERA_PRESETS.map((preset) => preset.id)).size, 8)
  const context = {
    target: [1, 1, 2] as [number, number, number],
    forward: [0, 0, 1] as [number, number, number],
    right: [1, 0, 0] as [number, number, number],
    scale: 1
  }
  const front = createDirectorPresetCamera('medium-front', context)
  assert.deepEqual(front.target, [1, 1.08, 2])
  assert.ok(Math.abs(front.pos[0] - 1) < 1e-9 && Math.abs(front.pos[1] - 1.2) < 1e-9 && Math.abs(front.pos[2] - 4.35) < 1e-9)
  assert.equal(front.focal, 50)
  const profile = createDirectorPresetCamera('profile-left', context)
  assert.ok(profile.pos[0] < context.target[0], '左侧面机位必须位于人物左侧')
  assert.ok(profile.pos[2] > context.target[2], '侧面机位保留少量正面偏角，避免完全扁平')
}

function testDirectorIk() {
  const root = new Object3D()
  const shoulder = new Object3D()
  const elbow = new Object3D()
  const wrist = new Object3D()
  shoulder.add(elbow)
  elbow.position.set(0, -1, 0)
  elbow.userData.poseBendAxisLocal = [-1, 0, 0]
  elbow.add(wrist)
  wrist.position.set(0, -1, 0)
  root.add(shoulder)
  root.updateMatrixWorld(true)

  const target = new Vector3(0.55, -1.35, 0.45)
  const solved = solveDirectorCcdIk({ root, joints: [elbow, shoulder], effector: wrist, target, iterations: 16 })
  assert.ok(solved.error < 0.025, `IK 末端应接近目标，当前误差 ${solved.error}`)
  assert.ok(wrist.getWorldPosition(new Vector3()).distanceTo(target) < 0.025)

  const unreachable = solveDirectorCcdIk({ root, joints: [elbow, shoulder], effector: wrist, target: new Vector3(20, 0, 0) })
  assert.equal(unreachable.clamped, true)
  assert.ok(unreachable.target.length() < 2, '超出骨长的目标必须钳在可达范围内')
}

testBodyPresets()
testNativeBodyAssets()
testPosePresets()
testDirectorWorkflow()
testDirectorPoseTools()
testDirectorCameraPresets()
testDirectorIk()
await testDirectorAssetCache()
console.log('director mannequin: 13 bodies / 20 poses / shot planning / continuity / camera helpers / safety / IK OK')
