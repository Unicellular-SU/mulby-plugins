export type DirectorBodyType = 'mannequin' | 'female' | 'broad' | 'muscular' | 'slim' | 'teen' | 'child' | 'chibi'

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
  patch: Partial<DirectorBodyProportions> = {}
): DirectorBodyPreset => ({ bodyType, label, promptLabel, proportions: { ...BASE_PROPORTIONS, ...patch } })

// Proportion presets are adapted from storyai-3d-director-desk's MIT-licensed
// procedural mannequin. See THIRD_PARTY_NOTICES.md at the plugin root.
export const DIRECTOR_BODY_PRESETS: DirectorBodyPreset[] = [
  bodyPreset('mannequin', '男性', '成年男性体型'),
  bodyPreset('female', '女性', '成年女性体型', {
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
  bodyPreset('broad', '宽厚', '宽厚魁梧体型', {
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
  bodyPreset('muscular', '健壮', '肌肉健壮体型', {
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
  bodyPreset('slim', '纤细', '高挑纤细体型', {
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
  bodyPreset('teen', '少年', '少年体型', {
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
  bodyPreset('child', '儿童', '儿童体型', {
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
  bodyPreset('chibi', '二头身', '二头身卡通体型', {
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
  })
]

export const getDirectorBodyPreset = (value?: string | null): DirectorBodyPreset =>
  DIRECTOR_BODY_PRESETS.find((preset) => preset.bodyType === value) || DIRECTOR_BODY_PRESETS[0]

export interface DirectorPosePreset {
  k: string
  m: Record<string, [number, number, number]>
  offsetY?: number
}

const rad = (degree: number) => (degree * Math.PI) / 180
const pose = (k: string, degrees: Record<string, [number, number, number]>, offsetY = 0): DirectorPosePreset => ({
  k,
  m: Object.fromEntries(Object.entries(degrees).map(([joint, xyz]) => [joint, xyz.map(rad) as [number, number, number]])),
  ...(offsetY ? { offsetY } : {})
})

// The expanded action set follows the MIT-licensed reference project's preset
// vocabulary, translated to this director desk's joint axes and hierarchy.
export const DIRECTOR_POSES: DirectorPosePreset[] = [
  pose('站立', {}),
  pose('T型', { 左肩: [12, 0, -82], 右肩: [12, 0, 82], 左肘: [8, 0, 0], 右肘: [8, 0, 0] }),
  pose('行走', { 左肩: [-24, 0, -5], 右肩: [24, 0, 5], 左髋: [28, 0, 0], 右髋: [-28, 0, 0], 左膝: [-20, 0, 0], 右膝: [-5, 0, 0] }),
  pose('跑步', { 骨盆: [-8, 8, 0], 胸: [-10, -8, 0], 左肩: [-48, 0, -8], 右肩: [48, 0, 8], 左肘: [65, 0, 0], 右肘: [72, 0, 0], 左髋: [44, 0, 0], 右髋: [-50, 0, 0], 左膝: [-56, 0, 0], 右膝: [-26, 0, 0] }, -0.06),
  pose('坐姿', { 胸: [-10, 0, 0], 左髋: [84, 0, 0], 右髋: [84, 0, 0], 左膝: [-88, 0, 0], 右膝: [-88, 0, 0], 左踝: [6, 0, 0], 右踝: [6, 0, 0] }, -0.05),
  pose('蹲下', { 骨盆: [-18, 0, 0], 胸: [-18, 0, 0], 头: [16, 0, 0], 左髋: [74, 0, -8], 右髋: [74, 0, 8], 左膝: [-105, 0, 0], 右膝: [-105, 0, 0], 左肩: [-34, 0, -12], 右肩: [-34, 0, 12], 左肘: [72, 0, 0], 右肘: [72, 0, 0] }, -0.34),
  pose('单膝跪', { 骨盆: [-10, 0, 0], 胸: [-8, 0, 0], 头: [10, 0, 0], 左髋: [58, 0, -8], 左膝: [-78, 0, 0], 左踝: [18, 0, 0], 右髋: [-12, 0, 8], 右膝: [-90, 0, 0], 右踝: [48, 0, 0], 左肩: [-8, -8, -8], 左肘: [28, 0, 0], 右肩: [18, 0, 8], 右肘: [18, 0, 0] }, -0.32),
  pose('双膝跪', { 骨盆: [3, 0, 0], 胸: [8, 0, 0], 左髋: [-8, 0, -4], 右髋: [-8, 0, 4], 左膝: [-112, 0, 0], 右膝: [-112, 0, 0], 左踝: [-18, 0, 0], 右踝: [-18, 0, 0], 左肩: [10, 0, -5], 右肩: [10, 0, 5] }, -0.36),
  pose('叉腰', { 左肩: [-34, 75, -8], 右肩: [-34, -75, 8], 左肘: [78, 0, -28], 右肘: [78, 0, 28], 左腕: [0, 0, -28], 右腕: [0, 0, 28] }),
  pose('倚靠', { 骨盆: [0, 0, -10], 头: [0, 0, 6], 左髋: [0, 0, -8], 右髋: [0, 0, 8], 左膝: [-12, 0, 0] }),
  pose('鞠躬', { 骨盆: [-42, 0, 0], 胸: [-12, 0, 0], 头: [22, 0, 0], 左髋: [38, 0, 0], 右髋: [38, 0, 0], 左肩: [-4, 0, -10], 右肩: [-4, 0, 10], 左肘: [12, 0, 0], 右肘: [12, 0, 0] }, -0.05),
  pose('思考', { 头: [8, -12, 5], 右肩: [-18, -38, 8], 右肘: [82, 0, 28], 右腕: [12, -10, -35], 左肩: [-8, 28, -6], 左肘: [72, 0, -18] }),
  pose('格斗', { 骨盆: [5, -10, 0], 胸: [0, 12, 0], 头: [0, 8, 0], 左肩: [-42, 20, -18], 右肩: [-28, -20, 12], 左肘: [82, 0, -22], 右肘: [78, 0, 22], 左髋: [4, 0, -18], 右髋: [-6, 0, 22], 左膝: [-12, 0, 0], 右膝: [-18, 0, 0] }, -0.08),
  pose('踢球', { 骨盆: [-8, 0, 0], 左髋: [8, 0, -5], 右髋: [-68, 0, 8], 右膝: [-28, 0, 0], 左肩: [-18, 0, -12], 右肩: [24, 0, 16] }),
  pose('投掷', { 骨盆: [5, 14, 0], 胸: [0, -12, 0], 头: [0, 8, 0], 右肩: [38, 28, 68], 右肘: [82, 0, 24], 右腕: [-12, 0, 18], 左肩: [-32, 8, -12], 左肘: [50, 0, -12], 左髋: [22, 0, -12], 右髋: [-12, 0, 18], 左膝: [-30, 0, 0], 右膝: [-12, 0, 0] }, -0.08),
  pose('推进', { 骨盆: [5, 35, 0], 胸: [-6, 0, 0], 头: [6, 0, 0], 左肩: [-88, 6, -11], 右肩: [-88, -6, 11], 左肘: [8, 0, 0], 右肘: [8, 0, 0], 左腕: [-12, 0, 0], 右腕: [-12, 0, 0], 左髋: [38, 0, -12], 右髋: [-20, 0, 14], 左膝: [-42, 0, 0], 右膝: [-20, 0, 0] }, -0.12),
  pose('招手', { 右肩: [-26, 28, 72], 右肘: [82, 0, 24], 右腕: [12, 10, -20], 左肩: [10, 0, -8], 左肘: [16, 0, 0] }),
  pose('伸手', { 右肩: [-72, 0, 6], 右肘: [12, 0, 0], 右腕: [-8, 0, 0], 胸: [-4, 0, 0] }),
  pose('抱臂', { 左肩: [-48, 65, -48], 左肘: [58, 0, -38], 左腕: [-10, 0, 0], 右肩: [-68, -45, 48], 右肘: [58, 0, 38], 右腕: [-10, 0, 18] }),
  pose('看手机', { 头: [18, 0, 0], 右肩: [-24, -28, -6], 右肘: [78, 0, 24], 右腕: [14, 58, -30], 左肩: [10, 0, -8], 左肘: [18, 0, 0] })
]

export const getDirectorPose = (name?: string | null): DirectorPosePreset | undefined =>
  DIRECTOR_POSES.find((preset) => preset.k === name)
