export type DirectorBodyType =
  | 'mannequin'
  | 'female'
  | 'broad'
  | 'muscular'
  | 'slim'
  | 'teen'
  | 'teenFemale'
  | 'child'
  | 'childFemale'
  | 'chibi'
  | 'senior'
  | 'seniorFemale'
  | 'heavyFemale'

export type DirectorBodyGroup = 'adult' | 'age' | 'build'

export interface DirectorBodyProportions {
  hipY: number
  pelvisRadius: number
  pelvisScale: [number, number, number]
  legSpread: number
  torsoLowerRadius: number
  torsoUpperRadius: number
  torsoLowerHeight: number
  torsoUpperHeight: number
  torsoLowerScale: [number, number, number]
  torsoUpperScale: [number, number, number]
  shoulderWidth: number
  shoulderRadius: number
  upperArmRadius: number
  upperArmLength: number
  forearmRadius: number
  forearmLength: number
  elbowRadius: number
  wristRadius: number
  handRadius: number
  handScale: [number, number, number]
  thighRadius: number
  thighLength: number
  calfRadius: number
  calfLength: number
  kneeRadius: number
  ankleRadius: number
  footRadius: number
  footLength: number
  footScale: [number, number, number]
  neckRadius: number
  neckHeight: number
  headRadius: number
  headScale: [number, number, number]
  faceOffsetZ: number
  eyeRadius: number
  jointRadiusScale: number
}

export interface DirectorBodyPreset {
  bodyType: DirectorBodyType
  label: string
  promptLabel: string
  group: DirectorBodyGroup
  assetFile: string
  proportions: DirectorBodyProportions
}

const BASE_PROPORTIONS: DirectorBodyProportions = {
  hipY: 0.82,
  pelvisRadius: 0.22,
  pelvisScale: [1.28, 0.68, 0.82],
  legSpread: 0.13,
  torsoLowerRadius: 0.15,
  torsoUpperRadius: 0.19,
  torsoLowerHeight: 0.22,
  torsoUpperHeight: 0.38,
  torsoLowerScale: [0.92, 1, 0.78],
  torsoUpperScale: [1.36, 1.04, 0.88],
  shoulderWidth: 0.31,
  shoulderRadius: 0.105,
  upperArmRadius: 0.065,
  upperArmLength: 0.26,
  forearmRadius: 0.056,
  forearmLength: 0.24,
  elbowRadius: 0.075,
  wristRadius: 0.058,
  handRadius: 0.078,
  handScale: [0.72, 1.08, 0.9],
  thighRadius: 0.088,
  thighLength: 0.34,
  calfRadius: 0.075,
  calfLength: 0.31,
  kneeRadius: 0.082,
  ankleRadius: 0.062,
  footRadius: 0.075,
  footLength: 0.17,
  footScale: [0.96, 0.62, 1.35],
  neckRadius: 0.075,
  neckHeight: 0.12,
  headRadius: 0.19,
  headScale: [0.8, 1, 0.76],
  faceOffsetZ: 0.135,
  eyeRadius: 0.018,
  jointRadiusScale: 1
}

const bodyPreset = (
  bodyType: DirectorBodyType,
  label: string,
  promptLabel: string,
  group: DirectorBodyGroup,
  assetFile: string,
  patch: Partial<DirectorBodyProportions> = {}
): DirectorBodyPreset => ({ bodyType, label, promptLabel, group, assetFile, proportions: { ...BASE_PROPORTIONS, ...patch } })

export const DIRECTOR_BODY_GROUPS: { key: DirectorBodyGroup; label: string }[] = [
  { key: 'adult', label: '成人' },
  { key: 'age', label: '年龄' },
  { key: 'build', label: '体态' }
]

const NEUTRAL_PRESENTATION_BODY_TYPES = new Set<DirectorBodyType>([
  'female',
  'slim',
  'teenFemale',
  'childFemale',
  'seniorFemale',
  'heavyFemale'
])

export const isDirectorNeutralBodyType = (bodyType: DirectorBodyType): boolean =>
  NEUTRAL_PRESENTATION_BODY_TYPES.has(bodyType)

// Proportion presets are adapted from storyai-3d-director-desk's MIT-licensed
// procedural mannequin. See THIRD_PARTY_NOTICES.md at the plugin root.
export const DIRECTOR_BODY_PRESETS: DirectorBodyPreset[] = [
  bodyPreset('mannequin', '成年男', '成年男性体型', 'adult', 'adult-male.gltf'),
  bodyPreset('female', '成年女', '成年女性体型', 'adult', 'adult-female.gltf', {
    pelvisScale: [1.42, 0.64, 0.8],
    torsoLowerRadius: 0.14,
    torsoUpperRadius: 0.175,
    torsoLowerScale: [0.84, 1, 0.72],
    torsoUpperScale: [1.16, 1.02, 0.8],
    shoulderWidth: 0.275,
    shoulderRadius: 0.092,
    upperArmRadius: 0.056,
    forearmRadius: 0.049,
    thighRadius: 0.082,
    calfRadius: 0.066,
    headScale: [0.78, 1, 0.72]
  }),
  bodyPreset('broad', '宽厚男', '宽厚魁梧男性体型', 'build', 'broad-male.gltf', {
    pelvisScale: [1.42, 0.72, 0.9],
    torsoLowerScale: [1.06, 1, 0.86],
    torsoUpperScale: [1.54, 1.08, 0.96],
    torsoUpperRadius: 0.23,
    torsoUpperHeight: 0.4,
    shoulderWidth: 0.39,
    shoulderRadius: 0.125,
    upperArmRadius: 0.082,
    forearmRadius: 0.071,
    thighRadius: 0.1,
    calfRadius: 0.086,
    headRadius: 0.195
  }),
  bodyPreset('muscular', '健壮男', '肌肉健壮男性体型', 'build', 'muscular-male.gltf', {
    pelvisScale: [1.22, 0.66, 0.82],
    torsoLowerRadius: 0.145,
    torsoUpperRadius: 0.235,
    torsoUpperScale: [1.55, 1.05, 0.92],
    shoulderWidth: 0.38,
    shoulderRadius: 0.13,
    upperArmRadius: 0.088,
    forearmRadius: 0.075,
    thighRadius: 0.104,
    calfRadius: 0.088
  }),
  bodyPreset('slim', '纤细女', '高挑纤细女性体型', 'build', 'slim-female.gltf', {
    pelvisScale: [1.08, 0.58, 0.72],
    torsoLowerRadius: 0.12,
    torsoUpperRadius: 0.145,
    torsoLowerScale: [0.78, 1, 0.68],
    torsoUpperScale: [1.02, 1.02, 0.72],
    shoulderWidth: 0.265,
    shoulderRadius: 0.082,
    upperArmRadius: 0.047,
    forearmRadius: 0.041,
    thighRadius: 0.066,
    calfRadius: 0.055,
    headRadius: 0.18
  }),
  bodyPreset('teen', '少年', '少年男性体型', 'age', 'teen-male.gltf', {
    hipY: 0.68,
    pelvisRadius: 0.18,
    pelvisScale: [1.18, 0.6, 0.76],
    legSpread: 0.11,
    torsoLowerRadius: 0.125,
    torsoLowerHeight: 0.18,
    torsoUpperRadius: 0.15,
    torsoUpperHeight: 0.31,
    torsoLowerScale: [0.82, 0.96, 0.7],
    torsoUpperScale: [1.1, 1.02, 0.76],
    shoulderWidth: 0.26,
    shoulderRadius: 0.082,
    upperArmRadius: 0.05,
    upperArmLength: 0.22,
    forearmRadius: 0.043,
    forearmLength: 0.2,
    thighRadius: 0.071,
    thighLength: 0.28,
    calfRadius: 0.061,
    calfLength: 0.26,
    headRadius: 0.185,
    headScale: [0.83, 1.06, 0.77]
  }),
  bodyPreset('teenFemale', '少女', '少女女性体型', 'age', 'teen-female.gltf', {
    hipY: 0.66,
    pelvisRadius: 0.18,
    pelvisScale: [1.3, 0.58, 0.74],
    legSpread: 0.105,
    torsoLowerRadius: 0.12,
    torsoUpperRadius: 0.14,
    torsoLowerHeight: 0.18,
    torsoUpperHeight: 0.3,
    torsoLowerScale: [0.82, 0.96, 0.68],
    torsoUpperScale: [1.02, 1, 0.72],
    shoulderWidth: 0.235,
    upperArmRadius: 0.047,
    forearmRadius: 0.04,
    thighRadius: 0.068,
    calfRadius: 0.057,
    headRadius: 0.185,
    headScale: [0.83, 1.06, 0.77]
  }),
  bodyPreset('child', '男童', '男童体型', 'age', 'child-male.gltf', {
    hipY: 0.5,
    pelvisRadius: 0.145,
    pelvisScale: [1.06, 0.56, 0.74],
    legSpread: 0.085,
    torsoLowerRadius: 0.105,
    torsoLowerHeight: 0.14,
    torsoUpperRadius: 0.12,
    torsoUpperHeight: 0.23,
    torsoLowerScale: [0.76, 0.92, 0.68],
    torsoUpperScale: [0.98, 0.98, 0.72],
    shoulderWidth: 0.205,
    shoulderRadius: 0.065,
    upperArmRadius: 0.04,
    upperArmLength: 0.15,
    forearmRadius: 0.035,
    forearmLength: 0.135,
    elbowRadius: 0.047,
    wristRadius: 0.038,
    handRadius: 0.052,
    thighRadius: 0.054,
    thighLength: 0.19,
    calfRadius: 0.047,
    calfLength: 0.165,
    kneeRadius: 0.05,
    ankleRadius: 0.04,
    footRadius: 0.052,
    footLength: 0.12,
    neckRadius: 0.05,
    neckHeight: 0.08,
    headRadius: 0.2,
    headScale: [0.9, 1.08, 0.82]
  }),
  bodyPreset('childFemale', '女童', '女童体型', 'age', 'child-female.gltf', {
    hipY: 0.49,
    pelvisRadius: 0.145,
    pelvisScale: [1.16, 0.55, 0.72],
    legSpread: 0.082,
    torsoLowerRadius: 0.102,
    torsoLowerHeight: 0.14,
    torsoUpperRadius: 0.116,
    torsoUpperHeight: 0.225,
    torsoLowerScale: [0.76, 0.92, 0.66],
    torsoUpperScale: [0.94, 0.98, 0.7],
    shoulderWidth: 0.195,
    upperArmRadius: 0.038,
    upperArmLength: 0.15,
    forearmRadius: 0.033,
    forearmLength: 0.135,
    thighRadius: 0.052,
    thighLength: 0.19,
    calfRadius: 0.045,
    calfLength: 0.165,
    headRadius: 0.2,
    headScale: [0.9, 1.08, 0.82]
  }),
  bodyPreset('chibi', '幼儿', '幼儿体型', 'age', 'toddler.gltf', {
    hipY: 0.34,
    pelvisRadius: 0.12,
    pelvisScale: [1.05, 0.56, 0.8],
    legSpread: 0.07,
    torsoLowerRadius: 0.09,
    torsoLowerHeight: 0.09,
    torsoUpperRadius: 0.105,
    torsoUpperHeight: 0.16,
    torsoLowerScale: [0.86, 0.84, 0.74],
    torsoUpperScale: [0.96, 0.94, 0.78],
    shoulderWidth: 0.17,
    shoulderRadius: 0.052,
    upperArmRadius: 0.033,
    upperArmLength: 0.1,
    forearmRadius: 0.029,
    forearmLength: 0.085,
    elbowRadius: 0.037,
    wristRadius: 0.03,
    handRadius: 0.045,
    thighRadius: 0.042,
    thighLength: 0.105,
    calfRadius: 0.037,
    calfLength: 0.095,
    kneeRadius: 0.039,
    ankleRadius: 0.031,
    footRadius: 0.045,
    footLength: 0.085,
    footScale: [1.12, 0.64, 1.52],
    neckRadius: 0.045,
    neckHeight: 0.035,
    headRadius: 0.255,
    headScale: [0.96, 1.04, 0.88],
    faceOffsetZ: 0.19,
    eyeRadius: 0.021,
    jointRadiusScale: 0.9
  }),
  bodyPreset('senior', '老年男', '老年男性体型', 'age', 'senior-male.gltf', {
    hipY: 0.78,
    torsoUpperHeight: 0.36,
    torsoUpperScale: [1.24, 0.98, 0.9],
    shoulderWidth: 0.285,
    upperArmRadius: 0.058,
    forearmRadius: 0.052,
    thighRadius: 0.082,
    calfRadius: 0.07,
    neckHeight: 0.105,
    headRadius: 0.195
  }),
  bodyPreset('seniorFemale', '老年女', '老年女性体型', 'age', 'senior-female.gltf', {
    hipY: 0.75,
    pelvisScale: [1.38, 0.66, 0.84],
    torsoUpperHeight: 0.35,
    torsoUpperScale: [1.08, 0.98, 0.82],
    shoulderWidth: 0.25,
    upperArmRadius: 0.052,
    forearmRadius: 0.047,
    thighRadius: 0.078,
    calfRadius: 0.064,
    neckHeight: 0.1,
    headRadius: 0.195
  }),
  bodyPreset('heavyFemale', '丰腴女', '丰腴女性体型', 'build', 'heavy-female.gltf', {
    pelvisScale: [1.64, 0.78, 0.98],
    torsoLowerRadius: 0.19,
    torsoUpperRadius: 0.22,
    torsoLowerScale: [1.08, 1, 0.92],
    torsoUpperScale: [1.34, 1.04, 1.02],
    shoulderWidth: 0.31,
    upperArmRadius: 0.078,
    forearmRadius: 0.068,
    thighRadius: 0.112,
    calfRadius: 0.086
  })
]

export const getDirectorBodyPreset = (value?: string | null): DirectorBodyPreset =>
  DIRECTOR_BODY_PRESETS.find((preset) => preset.bodyType === value) || DIRECTOR_BODY_PRESETS[0]

export interface DirectorPosePreset {
  k: string
  controls: DirectorPoseControls
  m: Record<string, [number, number, number]>
  offsetY?: number
}

export type DirectorPoseControls = Record<string, number>

const rad = (degree: number) => (degree * Math.PI) / 180

const value = (controls: DirectorPoseControls, key: string) => controls[key] || 0
const tuple = (x: number, y: number, z: number): [number, number, number] => [x, y, z]

/**
 * 程序化人台统一约定：人物正面恒为 +Z，四肢静止时沿 -Y。
 * 姿势只描述“前抬/后屈/外展”等人体语义，所有坐标轴正负号集中在这里转换，
 * 避免单个预设再次把膝盖折到人物正面、把脸转向脚尖。
 */
export function getDirectorProceduralJointDegrees(controls: DirectorPoseControls) {
  const result: Record<string, [number, number, number]> = {
    骨盆: tuple(-value(controls, 'body.pitch'), value(controls, 'body.yaw'), value(controls, 'body.roll')),
    胸: tuple(-value(controls, 'torso.pitch'), value(controls, 'torso.yaw'), value(controls, 'torso.roll')),
    头: tuple(value(controls, 'head.pitch'), value(controls, 'head.yaw'), value(controls, 'head.roll')),
    左肩: tuple(-value(controls, 'leftShoulder.pitch'), value(controls, 'leftShoulder.twist'), value(controls, 'leftShoulder.spread')),
    右肩: tuple(-value(controls, 'rightShoulder.pitch'), value(controls, 'rightShoulder.twist'), value(controls, 'rightShoulder.spread')),
    左肘: tuple(-value(controls, 'leftElbow.bend'), 0, 0),
    右肘: tuple(-value(controls, 'rightElbow.bend'), 0, 0),
    左腕: tuple(-value(controls, 'leftHand.pitch'), value(controls, 'leftHand.twist'), value(controls, 'leftHand.roll')),
    右腕: tuple(-value(controls, 'rightHand.pitch'), value(controls, 'rightHand.twist'), value(controls, 'rightHand.roll')),
    左髋: tuple(-value(controls, 'leftHip.pitch'), value(controls, 'leftHip.twist'), value(controls, 'leftHip.spread')),
    右髋: tuple(-value(controls, 'rightHip.pitch'), value(controls, 'rightHip.twist'), value(controls, 'rightHip.spread')),
    左膝: tuple(value(controls, 'leftKnee.bend'), 0, 0),
    右膝: tuple(value(controls, 'rightKnee.bend'), 0, 0),
    左踝: tuple(value(controls, 'leftFoot.pitch'), value(controls, 'leftFoot.twist'), value(controls, 'leftFoot.roll')),
    右踝: tuple(value(controls, 'rightFoot.pitch'), value(controls, 'rightFoot.twist'), value(controls, 'rightFoot.roll'))
  }
  return Object.fromEntries(Object.entries(result).filter(([, xyz]) => xyz.some(Boolean)))
}

/**
 * 高精 humanoid 使用人物空间（+X 右、+Y 上、+Z 正面）的世界轴旋转；
 * 运行时再换算到每根骨骼的父空间，因此不依赖模型自身杂乱的局部轴。
 */
export function getDirectorDetailedJointDegrees(controls: DirectorPoseControls) {
  const result: Record<string, [number, number, number]> = {
    骨盆: tuple(-value(controls, 'body.pitch'), value(controls, 'body.yaw'), value(controls, 'body.roll')),
    胸: tuple(-value(controls, 'torso.pitch'), value(controls, 'torso.yaw'), value(controls, 'torso.roll')),
    头: tuple(value(controls, 'head.pitch'), value(controls, 'head.yaw'), value(controls, 'head.roll')),
    左肩: tuple(-value(controls, 'leftShoulder.pitch'), 0, -value(controls, 'leftShoulder.spread')),
    右肩: tuple(-value(controls, 'rightShoulder.pitch'), 0, -value(controls, 'rightShoulder.spread')),
    左肘: tuple(-value(controls, 'leftElbow.bend'), 0, 0),
    右肘: tuple(-value(controls, 'rightElbow.bend'), 0, 0),
    左腕: tuple(-value(controls, 'leftHand.pitch'), 0, value(controls, 'leftHand.roll')),
    右腕: tuple(-value(controls, 'rightHand.pitch'), 0, value(controls, 'rightHand.roll')),
    左髋: tuple(-value(controls, 'leftHip.pitch'), 0, -value(controls, 'leftHip.spread')),
    右髋: tuple(-value(controls, 'rightHip.pitch'), 0, -value(controls, 'rightHip.spread')),
    左膝: tuple(value(controls, 'leftKnee.bend'), 0, 0),
    右膝: tuple(value(controls, 'rightKnee.bend'), 0, 0),
    左踝: tuple(value(controls, 'leftFoot.pitch'), 0, value(controls, 'leftFoot.roll')),
    右踝: tuple(value(controls, 'rightFoot.pitch'), 0, value(controls, 'rightFoot.roll'))
  }
  return Object.fromEntries(Object.entries(result).filter(([, xyz]) => xyz.some(Boolean)))
}

const pose = (k: string, controls: DirectorPoseControls): DirectorPosePreset => ({
  k,
  controls,
  m: Object.fromEntries(
    Object.entries(getDirectorProceduralJointDegrees(controls)).map(([joint, xyz]) => [joint, xyz.map(rad) as [number, number, number]])
  ),
  ...(value(controls, 'body.offsetY') ? { offsetY: value(controls, 'body.offsetY') } : {})
})

// 动作语义与参考项目的 MIT 姿势词汇保持一致；轴向由上面的两个转换器统一处理。
export const DIRECTOR_POSES: DirectorPosePreset[] = [
  pose('站立', {}),
  pose('T型', { 'leftShoulder.spread': -70, 'rightShoulder.spread': 70, 'leftShoulder.pitch': 15, 'rightShoulder.pitch': 15, 'leftElbow.bend': 10, 'rightElbow.bend': 10 }),
  pose('行走', { 'leftShoulder.pitch': 20, 'rightShoulder.pitch': -20, 'leftHip.pitch': -20, 'rightHip.pitch': 20, 'leftKnee.bend': 12, 'rightKnee.bend': 4 }),
  pose('跑步', { 'body.pitch': -8, 'torso.pitch': -10, 'leftShoulder.pitch': 42, 'rightShoulder.pitch': -42, 'leftElbow.bend': 65, 'rightElbow.bend': 72, 'leftHip.pitch': -35, 'rightHip.pitch': 40, 'leftKnee.bend': 56, 'rightKnee.bend': 26, 'body.offsetY': -0.06 }),
  pose('坐姿', { 'torso.pitch': -10, 'leftHip.pitch': 80, 'rightHip.pitch': 80, 'leftKnee.bend': 90, 'rightKnee.bend': 90 }),
  pose('蹲下', { 'body.offsetY': -0.43, 'body.pitch': -26, 'torso.pitch': -24, 'head.pitch': 22, 'leftHip.pitch': 92, 'rightHip.pitch': 92, 'leftKnee.bend': 112, 'rightKnee.bend': 112, 'leftShoulder.pitch': 52, 'rightShoulder.pitch': 50, 'leftShoulder.spread': -10, 'rightShoulder.spread': 10, 'leftElbow.bend': 80, 'rightElbow.bend': 76 }),
  pose('单膝跪', { 'body.offsetY': -0.42, 'body.pitch': -16, 'torso.pitch': -10, 'head.pitch': 12, 'leftHip.pitch': 68, 'leftKnee.bend': 86, 'leftFoot.pitch': 20, 'rightHip.pitch': -15, 'rightKnee.bend': 80, 'rightFoot.pitch': 60, 'leftShoulder.pitch': 5, 'leftShoulder.spread': 10, 'leftShoulder.twist': -10, 'leftElbow.bend': 30, 'rightShoulder.pitch': -18, 'rightShoulder.spread': 10, 'rightElbow.bend': 18 }),
  pose('双膝跪', { 'body.offsetY': -0.4, 'body.pitch': 2, 'torso.pitch': 8, 'head.pitch': -2, 'leftShoulder.pitch': -10, 'rightShoulder.pitch': -10, 'leftShoulder.spread': -5, 'rightShoulder.spread': 5, 'leftElbow.bend': 8, 'rightElbow.bend': 8, 'leftHip.pitch': -8, 'rightHip.pitch': -8, 'leftKnee.bend': 126, 'rightKnee.bend': 126, 'leftFoot.pitch': -20, 'rightFoot.pitch': -20 }),
  pose('叉腰', { 'leftShoulder.pitch': -10, 'rightShoulder.pitch': -10, 'leftShoulder.spread': -35, 'rightShoulder.spread': 35, 'leftShoulder.twist': 30, 'rightShoulder.twist': -30, 'leftElbow.bend': 105, 'rightElbow.bend': 105, 'leftHand.roll': -25, 'rightHand.roll': 25 }),
  pose('倚靠', { 'body.roll': -10, 'leftHip.spread': -8, 'rightHip.spread': 8, 'head.roll': 6 }),
  pose('鞠躬', { 'body.pitch': -46, 'torso.pitch': -10, 'head.pitch': 20, 'leftHip.pitch': 49, 'rightHip.pitch': 49, 'leftShoulder.pitch': 5, 'rightShoulder.pitch': 5, 'leftShoulder.spread': 10, 'rightShoulder.spread': -10, 'leftElbow.bend': 12, 'rightElbow.bend': 12 }),
  pose('思考', { 'rightShoulder.pitch': 8, 'rightShoulder.twist': -40, 'rightElbow.bend': 90, 'rightHand.roll': -40, 'rightHand.pitch': 15, 'rightHand.twist': -10, 'leftShoulder.pitch': 8, 'leftShoulder.twist': 40, 'leftElbow.bend': 90 }),
  pose('格斗', { 'body.yaw': -10, 'body.pitch': 5, 'torso.yaw': 8, 'head.yaw': 8, 'leftShoulder.pitch': 48, 'leftShoulder.spread': -16, 'leftShoulder.twist': 22, 'rightShoulder.pitch': 30, 'rightShoulder.twist': -22, 'leftElbow.bend': 86, 'rightElbow.bend': 84, 'leftHip.spread': -18, 'rightHip.spread': 22, 'leftHip.pitch': 4, 'rightHip.pitch': -6, 'leftKnee.bend': 12, 'rightKnee.bend': 18 }),
  pose('踢球', { 'leftHip.pitch': -8, 'rightHip.pitch': 58, 'rightKnee.bend': 35, 'leftShoulder.pitch': 18, 'rightShoulder.pitch': -24 }),
  pose('投掷', { 'body.offsetY': -0.12, 'body.pitch': 5, 'body.yaw': 14, 'torso.yaw': -10, 'head.yaw': 8, 'rightShoulder.pitch': 76, 'rightShoulder.spread': -14, 'rightShoulder.twist': 28, 'rightElbow.bend': 86, 'rightHand.roll': 18, 'rightHand.pitch': -12, 'leftShoulder.pitch': 34, 'leftShoulder.spread': 10, 'leftShoulder.twist': 8, 'leftElbow.bend': 54, 'leftHand.pitch': -10, 'leftHip.spread': -12, 'rightHip.spread': 18, 'leftHip.pitch': 24, 'rightHip.pitch': -10, 'leftKnee.bend': 30, 'rightKnee.bend': 14, 'leftFoot.pitch': -8, 'rightFoot.roll': 6 }),
  pose('推进', { 'body.offsetY': -0.16, 'body.pitch': 5, 'body.yaw': 38, 'torso.pitch': -4, 'head.pitch': 6, 'leftShoulder.pitch': 92, 'rightShoulder.pitch': 92, 'leftShoulder.spread': -11, 'rightShoulder.spread': 11, 'leftShoulder.twist': 6, 'rightShoulder.twist': -6, 'leftElbow.bend': 6, 'rightElbow.bend': 6, 'leftHand.pitch': -14, 'rightHand.pitch': -14, 'leftHip.spread': -12, 'rightHip.spread': 14, 'leftHip.pitch': 38, 'rightHip.pitch': -20, 'leftKnee.bend': 42, 'rightKnee.bend': 20, 'leftFoot.pitch': -6, 'rightFoot.roll': 8 }),
  pose('招手', { 'rightShoulder.pitch': 60, 'rightShoulder.twist': 30, 'rightElbow.bend': 90, 'rightHand.roll': -20, 'rightHand.pitch': 12, 'rightHand.twist': 10, 'leftShoulder.pitch': -10, 'leftShoulder.spread': 8, 'leftElbow.bend': 18, 'leftHand.pitch': -8 }),
  pose('伸手', { 'rightShoulder.pitch': 50, 'rightElbow.bend': 12 }),
  pose('抱臂', { 'leftShoulder.pitch': 10, 'leftShoulder.spread': -55, 'leftShoulder.twist': 30, 'leftElbow.bend': 115, 'leftHand.roll': -15, 'rightShoulder.pitch': 12, 'rightShoulder.spread': 55, 'rightShoulder.twist': -30, 'rightElbow.bend': 115, 'rightHand.roll': 15 }),
  pose('看手机', { 'head.pitch': 18, 'rightShoulder.pitch': 20, 'rightShoulder.spread': -4, 'rightShoulder.twist': -30, 'rightElbow.bend': 82, 'rightHand.roll': -30, 'rightHand.pitch': 14, 'rightHand.twist': 60, 'leftShoulder.pitch': -10, 'leftShoulder.spread': 8, 'leftElbow.bend': 16, 'leftHand.pitch': -8 })
]

export const getDirectorPose = (name?: string | null): DirectorPosePreset | undefined =>
  DIRECTOR_POSES.find((preset) => preset.k === name)
