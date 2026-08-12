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
  applyDirectorShotSceneState,
  classifyDirectorShot,
  createDirectorShotSceneState,
  createDirectorShotSnapshot,
  createDirectorShotTargetBinding,
  formatDirectorDuration,
  getDirectorShotsDurationMs,
  inferDirectorInspectorTab,
  normalizeDirectorShotDuration,
  removeDirectorSubjectFromShots,
  reorderDirectorShots,
  resolveDirectorShotCamera
} from '../src/ui/canvas/directorWorkflow.ts'
import type { DirectorCam, DirectorScene, DirectorShot, DirectorSubject } from '../src/ui/types.ts'
import {
  collectDirectorSceneAssetIds,
  createDirectorSceneExchangeBundle,
  decodeDirectorSceneBase64,
  encodeDirectorSceneBytes,
  normalizeDirectorScene,
  parseDirectorSceneExchange,
  remapDirectorSceneAssetIds
} from '../src/ui/canvas/directorSceneExchange.ts'
import { inferDirectorPanoramaMime, listDirectorCanvasPanoramas } from '../src/ui/canvas/directorCanvasPanorama.ts'
import { assessDirectorPanoramaQuality, normalizeDirectorEnvironmentControls, withDirectorEnvironmentDefaults } from '../src/ui/canvas/directorEnvironment.ts'
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

  const binding = createDirectorShotTargetBinding(cam, 'hero', [1, 0, 2])
  assert.deepEqual(binding.targetOffset, [-1, 1, -2])
  assert.deepEqual(binding.cameraOffset?.map((value) => Number(value.toFixed(6))), [-1, 1.5, 0.6])
  const followed = resolveDirectorShotCamera({ cam, ...binding }, [3, 0.5, -1])
  assert.deepEqual(followed.pos.map((value) => Number(value.toFixed(6))), [2, 2, -0.4])
  assert.deepEqual(followed.target, [2, 1.5, -3])
  assert.deepEqual(
    followed.pos.map((value, index) => Number((value - followed.target[index]).toFixed(6))),
    cam.pos.map((value, index) => Number((value - cam.target[index]).toFixed(6))),
    '跟随目标移动后必须保持相机与目标点的相对构图'
  )
  assert.deepEqual(resolveDirectorShotCamera({ cam }, null), cam)
}

function testDirectorSceneExchange() {
  const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
  const encoded = encodeDirectorSceneBytes(bytes)
  assert.deepEqual([...decodeDirectorSceneBase64(encoded)], [...bytes])
  assert.throws(() => decodeDirectorSceneBase64('not base64'))
  assert.throws(() => decodeDirectorSceneBase64('AAAA', 2), /超过/)

  const raw = {
    subjects: [
      { id: 'hero', kind: '人台', pos: [1, 0, 2], rot: [0, 0, 0], scale: 1, name: '主角' },
      { id: 'hero', kind: '道具', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], name: '桌子' },
      { kind: '道具', pos: [2, 0, 0], rot: [0, 0, 0], scale: 1 }
    ],
    cam: { pos: [0, 1.5, 4], target: [0, 1, 0], focal: 35 },
    shots: [{
      id: 'shot',
      name: '跟随镜头',
      cam: { pos: [0, 1.5, 4], target: [0, 1, 0], focal: 35 },
      targetSubjectId: 'hero',
      targetOffset: [-1, 1, -2],
      cameraOffset: [-1, 1.5, 2],
      sceneState: {
        subjects: [{
          subjectId: 'hero',
          name: '主角',
          kind: '人台',
          pos: [1, 0, 2],
          rot: [0, Math.PI, 0],
          scale: [1, 1, 1],
          bodyType: 'female',
          poseName: '双膝跪',
          visible: true
        }]
      }
    }],
    environment: {
      assetId: 'pano',
      description: '雨夜街道',
      rotation: 999,
      mode: 'grounded',
      cameraHeight: 99,
      horizon: -99,
      exposure: 99,
      environmentIntensity: -2,
      backgroundBlur: 2,
      shadowOpacity: -1,
      width: 8192,
      height: 4096,
      source: 'canvas',
      sourceCardId: 'pano-card'
    }
  }
  const scene = normalizeDirectorScene(raw)
  assert.deepEqual(scene.subjects.map((subject) => subject.id), ['hero', 'hero-2', 'subject-3'])
  assert.equal(scene.shots[0].targetSubjectId, 'hero')
  assert.equal(scene.shots[0].sceneState?.subjects[0].bodyType, 'female')
  assert.equal(scene.shots[0].sceneState?.subjects[0].poseName, '双膝跪')
  assert.equal(scene.environment?.rotation, 180)
  assert.equal(scene.environment?.mode, 'grounded')
  assert.equal(scene.environment?.cameraHeight, 5)
  assert.equal(scene.environment?.horizon, -20)
  assert.equal(scene.environment?.exposure, 3)
  assert.equal(scene.environment?.environmentIntensity, 0)
  assert.equal(scene.environment?.backgroundBlur, 1)
  assert.equal(scene.environment?.shadowOpacity, 0)
  assert.equal(scene.environment?.width, 8192)
  assert.equal(scene.environment?.height, 4096)
  assert.equal(scene.environment?.source, 'canvas')
  assert.equal(scene.environment?.sourceCardId, 'pano-card')
  assert.equal(scene.schemaVersion, 2)

  const withAssets: DirectorScene = {
    ...scene,
    subjects: scene.subjects.map((subject, index) => index === 1 ? { ...subject, assetId: 'model' } : subject)
  }
  assert.deepEqual(collectDirectorSceneAssetIds(withAssets), ['model', 'pano'])
  const remapped = remapDirectorSceneAssetIds(withAssets, new Map([['model', 'new-model'], ['pano', 'new-pano']]))
  assert.equal(remapped.subjects[1].assetId, 'new-model')
  assert.equal(remapped.environment?.assetId, 'new-pano')

  const assets = [{ id: 'pano', mimeType: 'image/jpeg', dataBase64: encoded }]
  const bundle = createDirectorSceneExchangeBundle(scene, assets, 123)
  assert.equal(bundle.exportedAt, 123)
  assert.equal(parseDirectorSceneExchange(bundle).scene.subjects[0].id, 'hero')
  assert.equal(parseDirectorSceneExchange(bundle).scene.environment?.cameraHeight, 5)
  assert.equal(parseDirectorSceneExchange(bundle).scene.environment?.exposure, 3)
  const legacyEnvironment = normalizeDirectorScene({ ...raw, environment: { assetId: 'legacy-pano' } }).environment
  assert.equal(legacyEnvironment?.mode, 'grounded')
  assert.equal(legacyEnvironment?.cameraHeight, 1.6)
  assert.equal(legacyEnvironment?.environmentIntensity, 0.9)
  assert.equal(parseDirectorSceneExchange(raw).assets.length, 0, '旧版裸场景 JSON 应继续可导入')
  assert.throws(() => createDirectorSceneExchangeBundle(scene, [...assets, ...assets]), /重复/)
  assert.throws(() => normalizeDirectorScene({ ...raw, subjects: [{ kind: '灯光' }] }), /类型无效/)
  assert.throws(() => normalizeDirectorScene({
    ...raw,
    shots: [{ ...raw.shots[0], sceneState: { subjects: Array.from({ length: 201 }, () => raw.shots[0].sceneState.subjects[0]) } }]
  }), /对象调度超过 200/)
}

function testDirectorEnvironmentCalibration() {
  assert.deepEqual(normalizeDirectorEnvironmentControls(null), {
    mode: 'grounded',
    cameraHeight: 1.6,
    horizon: 0,
    exposure: 1,
    environmentIntensity: 0.9,
    backgroundBlur: 0,
    shadowOpacity: 0.32
  })
  const calibrated = withDirectorEnvironmentDefaults({
    assetId: 'pano',
    mode: 'infinite',
    cameraHeight: 1.75,
    exposure: 1.2,
    backgroundBlur: 0.25
  })
  assert.equal(calibrated.mode, 'infinite')
  assert.equal(calibrated.cameraHeight, 1.75)
  assert.equal(calibrated.exposure, 1.2)
  assert.equal(calibrated.backgroundBlur, 0.25)
  assert.equal(calibrated.environmentIntensity, 0.9, '缺失的新参数应使用稳定默认值，保证旧工程兼容')

  assert.equal(assessDirectorPanoramaQuality(3000, 1500)?.level, 'preview')
  assert.equal(assessDirectorPanoramaQuality(4096, 2048)?.level, 'standard')
  assert.equal(assessDirectorPanoramaQuality(8192, 4096)?.level, 'high')
  assert.equal(assessDirectorPanoramaQuality(4096, 3000)?.level, 'invalid')
  assert.equal(assessDirectorPanoramaQuality(0, 0), null)
}

function testDirectorShotSceneState() {
  const subjects: DirectorSubject[] = [
    {
      id: 'hero',
      kind: '人台',
      name: '主角',
      desc: '穿灰色外套',
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      bodyType: 'female',
      poseName: '站立',
      poseSchemaVersion: 2,
      poseOffsetY: 0,
      joints: { 头: [0.1, 0, 0] },
      visible: true,
      locked: true
    },
    { id: 'table', kind: '道具', name: '桌子', pos: [1, 0, 0], rot: [0, 0, 0], scale: 1, visible: true }
  ]
  const state = createDirectorShotSceneState(subjects)
  assert.equal(state.subjects.length, 2)
  subjects[0].pos[0] = 99
  subjects[0].joints!.头[0] = 99
  assert.deepEqual(state.subjects[0].pos, [0, 0, 0], '快照必须与后续运行时变换隔离')
  assert.deepEqual(state.subjects[0].joints?.头, [0.1, 0, 0], '关节快照必须深拷贝')

  const current: DirectorSubject[] = [
    { ...subjects[0], pos: [4, 0, 2], rot: [0, Math.PI, 0], desc: '更新后的角色描述', bodyType: 'seniorFemale', locked: false },
    { ...subjects[1], pos: [8, 0, 0], visible: false },
    { id: 'new-prop', kind: '道具', name: '后来添加的灯', pos: [0, 2, 0], rot: [0, 0, 0], scale: 1 }
  ]
  const restored = applyDirectorShotSceneState(current, state)
  assert.deepEqual(restored[0].pos, [0, 0, 0])
  assert.equal(restored[0].bodyType, 'female')
  assert.equal(restored[0].desc, '更新后的角色描述', '镜头调度不应覆盖全局语义描述')
  assert.equal(restored[0].locked, false, '镜头调度不应覆盖编辑锁定状态')
  assert.deepEqual(restored[1].pos, [1, 0, 0])
  assert.equal(restored[1].visible, true)
  assert.deepEqual(restored[2], current[2], '拍摄后新增的对象应保留当前状态')

  const cam: DirectorCam = { pos: [0, 1.5, 2.6], target: [0, 1, 0], focal: 35 }
  const previous: DirectorShot = { id: 'a', name: '前镜头', cam, sceneState: state }
  const changedState = createDirectorShotSceneState(restored)
  changedState.subjects[0] = {
    ...changedState.subjects[0],
    pos: [3, 0, 0],
    rot: [0, Math.PI, 0],
    poseName: '奔跑',
    visible: false
  }
  const currentShot: DirectorShot = { id: 'b', name: '后镜头', cam: { ...cam, pos: [2.5, 1.5, 2.6] }, sceneState: changedState }
  const issues = analyzeDirectorShotContinuity([previous, currentShot])
  for (const code of ['subject-position', 'subject-facing', 'subject-pose', 'subject-visibility']) {
    assert.ok(issues.some((issue) => issue.code === code), `连续性检查应报告 ${code}`)
  }

  const tracked: DirectorShot = {
    ...previous,
    targetSubjectId: 'hero',
    targetOffset: [0, 1, 0],
    cameraOffset: [0, 1.5, 3]
  }
  const pruned = removeDirectorSubjectFromShots([tracked], 'hero')
  assert.equal(pruned[0].targetSubjectId, undefined)
  assert.equal(pruned[0].sceneState?.subjects.some((item) => item.subjectId === 'hero'), false)
  assert.equal(removeDirectorSubjectFromShots(pruned, 'missing'), pruned, '无匹配对象时应保持数组引用')
}

function testDirectorCanvasPanoramas() {
  const board: any = {
    cards: {
      later: { id: 'later', kind: 'pano', status: 'done', title: '山谷', prompt: '清晨山谷', assetUrl: 'file:///valley.webp', assetLocalPath: '/valley.webp', mime: 'image/webp', x: 10, y: 20 },
      first: { id: 'first', kind: 'pano', status: 'done', title: '城市', prompt: '雨夜城市', assetUrl: 'file:///city.png', x: 30, y: 10 },
      running: { id: 'running', kind: 'pano', status: 'running', title: '生成中', assetUrl: 'blob:preview', x: 0, y: 0 },
      image: { id: 'image', kind: 'image', status: 'done', title: '普通图片', assetUrl: 'file:///image.png', x: 0, y: 0 }
    }
  }
  const panoramas = listDirectorCanvasPanoramas(board)
  assert.deepEqual(panoramas.map((item) => item.id), ['first', 'later'])
  assert.equal(panoramas[0].description, '雨夜城市')
  assert.equal(inferDirectorPanoramaMime(panoramas[0]), 'image/png')
  assert.equal(inferDirectorPanoramaMime(panoramas[1]), 'image/webp')
  assert.equal(inferDirectorPanoramaMime({ assetUrl: 'https://example.com/pano.jpg?token=1' }), 'image/jpeg')
  assert.deepEqual(listDirectorCanvasPanoramas(null), [])
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
testDirectorSceneExchange()
testDirectorShotSceneState()
testDirectorCanvasPanoramas()
testDirectorEnvironmentCalibration()
testDirectorPoseTools()
testDirectorCameraPresets()
testDirectorIk()
await testDirectorAssetCache()
console.log('director mannequin: 13 bodies / 20 poses / per-shot blocking / grounded panoramas / continuity / safety / IK OK')
