/**
 * Ken-Burns / pan / zoom 运动表（借鉴 OpenMontage `AnimeScene.tsx` 的 useCameraMotion **思路**，自研）。
 *
 * 给「静图」加镜头运动——补「相机运动只是提示词、静图干坐着」的缺口。
 * 9 个预设；`cameraMotion(preset, progress01)` 返回 {scale, translateXPct, translateYPct}（平移为**画幅比例**，分辨率无关），
 * 同一份数学驱动两条路径：
 *   · 预览：CSS `transform: scale(s) translate(txPct%, tyPct%)`（比例对 CSS % 天然契合）。
 *   · ffmpeg 导出：`kenBurnsZoompan` 生成 `zoompan` 滤镜（用 iw/ih 换算比例→像素，居中 + 平移）。
 *
 * 纯函数、零运行时依赖（仅用 motion.interpolate）。zoompan 字符串结构可单测；**视觉正确性需在 Mulby 内跑真实 ffmpeg 校验**。
 */
import { interpolate } from './motion'

export type KenBurnsPreset =
  | 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right'
  | 'ken-burns' | 'drift-up' | 'drift-down' | 'parallax'

export interface MotionFrame {
  scale: number
  /** X 平移，单位=画幅宽度比例（0.1 = 10%） */
  translateXPct: number
  /** Y 平移，单位=画幅高度比例 */
  translateYPct: number
}

interface PresetDef {
  label: string
  scale: [number, number]
  tx: [number, number]
  ty: [number, number]
}

// 平移以画幅比例表示（report 的 ±35px@参考 换算为 ~0.10）。
const PRESETS: Record<KenBurnsPreset, PresetDef> = {
  static: { label: '固定(微遮边)', scale: [1.02, 1.02], tx: [0, 0], ty: [0, 0] },
  'zoom-in': { label: '推近', scale: [1.0, 1.15], tx: [0, 0], ty: [0, 0] },
  'zoom-out': { label: '拉远', scale: [1.15, 1.0], tx: [0, 0], ty: [0, 0] },
  'pan-left': { label: '左移', scale: [1.12, 1.12], tx: [0.1, -0.1], ty: [0, 0] },
  'pan-right': { label: '右移', scale: [1.12, 1.12], tx: [-0.1, 0.1], ty: [0, 0] },
  'ken-burns': { label: '肯·伯恩斯', scale: [1.0, 1.18], tx: [0, -0.06], ty: [0, -0.04] },
  'drift-up': { label: '上浮', scale: [1.1, 1.1], tx: [0, 0], ty: [0.06, -0.06] },
  'drift-down': { label: '下沉', scale: [1.1, 1.1], tx: [0, 0], ty: [-0.06, 0.06] },
  parallax: { label: '视差', scale: [1.08, 1.14], tx: [0.05, -0.05], ty: [0, 0] },
}

export const KEN_BURNS_PRESETS = Object.keys(PRESETS) as KenBurnsPreset[]
export const KEN_BURNS_OPTIONS: { value: KenBurnsPreset; label: string }[] =
  KEN_BURNS_PRESETS.map((value) => ({ value, label: PRESETS[value].label }))

export function isKenBurnsPreset(s: unknown): s is KenBurnsPreset {
  return typeof s === 'string' && s in PRESETS
}

/** 某预设在进度 p∈[0,1] 处的运动帧（p 越界自动夹断）。 */
export function cameraMotion(preset: KenBurnsPreset, progress01: number): MotionFrame {
  const d = PRESETS[preset]
  const p = Number.isFinite(progress01) ? progress01 : 0
  return {
    scale: interpolate(p, [0, 1], d.scale),
    translateXPct: interpolate(p, [0, 1], d.tx),
    translateYPct: interpolate(p, [0, 1], d.ty),
  }
}

/** 预览用：直接生成 CSS transform 字符串（rAF 时钟传入 progress）。 */
export function kenBurnsCss(preset: KenBurnsPreset, progress01: number): string {
  const m = cameraMotion(preset, progress01)
  return `translate(${(m.translateXPct * 100).toFixed(3)}%, ${(m.translateYPct * 100).toFixed(3)}%) scale(${m.scale.toFixed(4)})`
}

export interface ZoompanOpts {
  durationSec: number
  fps?: number
  width: number
  height: number
}

function fmt(n: number): string {
  return String(Math.round(n * 10000) / 10000)
}

/**
 * 生成 ffmpeg `zoompan` 滤镜串：把一张静图按预设做 scale/pan 输出为定长视频帧序列。
 * 逐帧进度 = on/(frames-1)；z 线性插值缩放；x/y 居中后加比例平移（iw/ih 换算）。
 * 用法（next iteration 接 ffmpeg）：`-loop 1 -i img -t dur -vf "<本串>" ...`
 */
export function kenBurnsZoompan(preset: KenBurnsPreset, opts: ZoompanOpts): string {
  const fps = opts.fps ?? 24
  const frames = Math.max(1, Math.round(opts.durationSec * fps))
  const d = PRESETS[preset]
  const [s0, s1] = d.scale
  const prog = frames > 1 ? `(on/${frames - 1})` : '0'
  const z = `${fmt(s0)}+(${fmt(s1 - s0)})*${prog}`
  const txExpr = `${fmt(d.tx[0])}+(${fmt(d.tx[1] - d.tx[0])})*${prog}`
  const tyExpr = `${fmt(d.ty[0])}+(${fmt(d.ty[1] - d.ty[0])})*${prog}`
  const x = `(iw-iw/zoom)/2+iw*(${txExpr})`
  const y = `(ih-ih/zoom)/2+ih*(${tyExpr})`
  return `zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${opts.width}x${opts.height}:fps=${fps}`
}

export interface KenBurnsClipOpts {
  durationSec: number
  fps?: number
  width: number
  height: number
  outPath: string
}

/**
 * 构造「静图 → Ken-Burns 运动视频」的完整 ffmpeg 参数（纯函数，便于单测）。
 * 先 2× 上采样 + 居中裁切（给 zoompan 留分辨率头寸、减少抖动），再 zoompan 到目标尺寸。
 * 用法：`ff().run(buildKenBurnsArgs(img, preset, {...}))`。
 */
export function buildKenBurnsArgs(imagePath: string, preset: KenBurnsPreset, opts: KenBurnsClipOpts): string[] {
  const fps = opts.fps ?? 24
  const { width, height, durationSec, outPath } = opts
  const w2 = width * 2
  const h2 = height * 2
  const zp = kenBurnsZoompan(preset, { durationSec, fps, width, height })
  const vf = `scale=${w2}:${h2}:force_original_aspect_ratio=increase,crop=${w2}:${h2},${zp},format=yuv420p`
  return [
    '-y', '-framerate', String(fps), '-loop', '1', '-i', imagePath, '-t', String(durationSec),
    '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(fps), outPath,
  ]
}

// 运镜 → Ken-Burns 预设映射（让静图兜底片段尊重分镜计划的运镜；中英皆可）。
const CAMERA_TO_KB: Record<string, KenBurnsPreset> = {
  'dolly-in': 'zoom-in', 推: 'zoom-in', 'dolly-out': 'zoom-out', 拉: 'zoom-out',
  pan: 'pan-right', 摇: 'pan-right', tracking: 'pan-left', 移: 'pan-left', 跟: 'pan-left',
  crane: 'drift-up', 升降: 'drift-up', tilt: 'drift-up', 俯仰: 'drift-up',
  handheld: 'parallax', 手持: 'parallax', zoom: 'zoom-in', 变焦: 'zoom-in',
  static: 'static', 固定: 'static',
}

/** 由分镜运镜（中文/英文枚举）选 Ken-Burns 预设；未知回退 ken-burns。 */
export function cameraMoveToKenBurns(raw?: string): KenBurnsPreset {
  const s = (raw ?? '').trim()
  return CAMERA_TO_KB[s] ?? 'ken-burns'
}
