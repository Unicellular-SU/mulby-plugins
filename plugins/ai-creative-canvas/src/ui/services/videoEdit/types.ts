// 单卡视频剪辑工作台 —— 非破坏式编辑栈数据模型
// 设计依据：docs/ai-creative-canvas-video-editor.md §3.1
// 编辑栈只描述「要做什么」，导出时由 compile.ts 编译成单条 ffmpeg 命令。
// 全部纯 JSON 可序列化 —— 存进 card.meta.editRecipe 可二次编辑的前提。

import { uid } from '../../util'

export type OpKind = 'trim' | 'speed' | 'transform' | 'color' | 'overlay' | 'audio' | 'export'

// 大类编译顺序（物理正确性钉死，不随 UI 重排打乱）。export 永远置尾。
export const OP_KIND_ORDER: OpKind[] = ['trim', 'speed', 'transform', 'color', 'overlay', 'audio', 'export']

export const OP_KIND_LABEL: Record<OpKind, string> = {
  trim: '裁切',
  speed: '变速',
  transform: '几何',
  color: '调色',
  overlay: '叠加',
  audio: '音频',
  export: '导出'
}

// ---- trim：多段保留 / 删中段 / 波纹删除（in/out 恒为源时间基秒）----
export interface TrimSegment {
  in: number
  out: number
  keep: boolean // false=该段被删除（灰罩）
}
export interface TrimParams {
  segments: TrimSegment[]
}

// ---- speed：匀速变速 + 倒放 + 回旋 + 片尾冻结 ----
export interface SpeedParams {
  rate: number // 0.25–4
  reverse: boolean
  pitchCompensate: boolean // 变速是否补偿音高（false=随速变调）
  boomerang?: boolean // 回旋：正放→倒放接合（去音轨）
  freezeEnd?: number // 片尾冻结秒数（末帧保持）
}

// ---- transform：裁画面 / 旋转翻转 / 改画幅 / Ken-Burns ----
export interface CropRect {
  x: number
  y: number
  w: number
  h: number // 全部 0..1 归一
}
export interface KenBurns {
  fromZoom: number
  toZoom: number
  fromX: number // 0..1 焦点
  fromY: number
  toX: number
  toY: number
  ease: 'linear' | 'easeInOut'
}
export type FitMode = 'contain' | 'cover' | 'blur-pad'
export interface TransformParams {
  crop?: CropRect
  rotate?: number // 度；90/180/270 走 transpose，任意角走 rotate 滤镜
  hflip?: boolean
  vflip?: boolean
  outW?: number // 目标画幅（配 fit）
  outH?: number
  fit?: FitMode
  kenBurns?: KenBurns
}

// ---- color：调色面板 + 风格预设 ----
export interface ColorParams {
  brightness?: number // -1..1（eq）
  contrast?: number // 0..2
  saturation?: number // 0..3
  gamma?: number // 0.1..3
  temp?: number // 色温偏移 -100..100
  tint?: number // -100..100
  hue?: number // -180..180
  sharpen?: number // 0..3（unsharp 强度）
  denoise?: number // 0..1（hqdn3d 强度）
  vignette?: number // 0..1
  grain?: number // 0..40（noise）
  lutPath?: string // .cube 绝对路径
  preset?: string // 风格预设 id
  presetStrength?: number // 0..1
}

// ---- overlay：一切文字/图形（canvas→PNG→overlay）----
export type OverlaySub = 'text' | 'watermark' | 'progress' | 'timecode' | 'sticker' | 'pip' | 'mosaic'
export interface OverlayRange {
  start: number // 源时间基秒；编译器按累计 rate 折算
  end: number
}
export interface OverlayParams {
  sub: OverlaySub
  rect: { x: number; y: number; w: number; h: number } // 0..1 归一定位/尺寸
  range?: OverlayRange // 时间窗（缺省=全程）
  // 渲染参数（canvas 重绘的真相，不存 PNG 路径）：
  text?: string
  style?: Record<string, unknown> // 字体/颜色/描边/背景等
  anim?: 'none' | 'fade' | 'slide' | 'typewriter'
  // PiP / 打码专用：
  pipCardId?: string
  blurKind?: 'mosaic' | 'blur'
  pixelSize?: number
}

// ---- audio：单卡音频精修 ----
export interface AudioParams {
  gainDb?: number // 音量增益 dB
  fadeIn?: number // 秒
  fadeOut?: number
  muteRanges?: OverlayRange[] // 区间静音（源时间基）
  loudnorm?: boolean
  denoise?: boolean
  duck?: boolean // BGM 闪避（需 bgm op 提供旁链，留接口）
  pitchSemitones?: number // 变调 ±12
}

// ---- export：栈尾单例 ----
export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'webp'
export interface ExportParams {
  outW?: number
  outH?: number
  fps?: number
  crf?: number // 画质（libx264）
  bitrate?: number // 目标码率 kbps（两遍 ABR）
  format: ExportFormat
  fit?: FitMode // 画幅适配方式
  platform?: string // 平台预设 id
  fadeIn?: number // 成片首部黑场淡入秒数（视频+音频同步）
  fadeOut?: number // 成片尾部黑场淡出秒数
}

// ---- 编辑操作（按 kind 判别联合）----
interface OpBase {
  id: string
  enabled: boolean // 旁路开关：false=编译跳过、预览不施加（便于 A/B）
  label?: string // 用户可改名
}
export type EditOp =
  | (OpBase & { kind: 'trim'; params: TrimParams })
  | (OpBase & { kind: 'speed'; params: SpeedParams })
  | (OpBase & { kind: 'transform'; params: TransformParams })
  | (OpBase & { kind: 'color'; params: ColorParams })
  | (OpBase & { kind: 'overlay'; params: OverlayParams })
  | (OpBase & { kind: 'audio'; params: AudioParams })
  | (OpBase & { kind: 'export'; params: ExportParams })

export type OpParamsOf<K extends OpKind> = Extract<EditOp, { kind: K }>['params']

// ---- 编辑栈（工作台会话态；导出时序列化进 card.meta.editRecipe）----
export interface EditStack {
  ops: EditOp[] // 顺序=语义顺序；export 强制置尾
  version: 1
  baseDuration: number // probeDuration 一次，缓存
  baseW: number // 方向校正后的真实显示宽高
  baseH: number
  baseRotation?: 0 | 90 | 180 | 270 // 容器 rotate 元数据，供编译器显式 transpose
  needsNormalize?: boolean // 入栈预检判定为 VFR/source/透明 webm 时置 true
}

// 存进 card.meta 的编辑配方（可二次编辑、可重放）
export interface EditRecipe {
  ops: EditOp[]
  version: 1
  baseDuration: number
}

// ---- 默认参数工厂 ----
const DEFAULTS: { [K in OpKind]: () => OpParamsOf<K> } = {
  trim: () => ({ segments: [] }),
  speed: () => ({ rate: 1, reverse: false, pitchCompensate: true }),
  transform: () => ({}),
  color: () => ({}),
  overlay: () => ({ sub: 'text', rect: { x: 0.1, y: 0.8, w: 0.8, h: 0.12 }, text: '文字', anim: 'none' }),
  audio: () => ({}),
  export: () => ({ format: 'mp4', crf: 23 })
}

export function createOp<K extends OpKind>(kind: K, params?: Partial<OpParamsOf<K>>): EditOp {
  const base = DEFAULTS[kind]() as OpParamsOf<K>
  return { id: uid('op'), kind, enabled: true, params: { ...base, ...(params || {}) } } as EditOp
}

// 编辑栈是否「实质为空」（无可编译的启用 op，导出=原样）
export function stackIsNoop(stack: EditStack): boolean {
  return !stack.ops.some((o) => o.enabled && o.kind !== 'export')
}
