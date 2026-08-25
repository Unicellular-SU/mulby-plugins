/**
 * 运动原语：interpolate + spring（+ sampleFrames 烘焙器）。
 *
 * 是 #7 Ken-Burns/pan/zoom 与 #9 词级字幕共用的时序内核——一套数学同时驱动：
 *   · React 预览（每帧用 rAF 时钟算 progress → 调本模块）
 *   · ffmpeg 导出（用 sampleFrames 把运动按帧烘成数组 → 生成 zoompan/sendcmd 表达式）
 * 使预览与最终渲染时序一致。
 *
 * 纯函数、零依赖、可独立单测。算法为标准教科书内容（线性重映射 + 阻尼谐振子解析解），
 * API 形态对齐 Remotion 习惯以便 #7/#9 复用，自研实现、未拷贝任何第三方源代码。
 */

export type ExtrapolateType = 'extend' | 'clamp' | 'identity'

export interface InterpolateOptions {
  extrapolateLeft?: ExtrapolateType
  extrapolateRight?: ExtrapolateType
  /** 同时设置左右端外推（被 extrapolateLeft/Right 覆盖）。默认 'clamp'。 */
  extrapolate?: ExtrapolateType
}

/**
 * 分段线性重映射：把 input 从 inputRange 映射到 outputRange。
 * inputRange 必须严格递增，长度 ≥2 且与 outputRange 等长。
 * 端点外推：clamp（夹住端值，默认）/ extend（延长直线）/ identity（原值返回）。
 */
export function interpolate(
  input: number,
  inputRange: number[],
  outputRange: number[],
  options?: InterpolateOptions
): number {
  if (inputRange.length < 2 || inputRange.length !== outputRange.length) {
    throw new Error('interpolate: inputRange/outputRange 必须等长且 ≥2')
  }
  const both = options?.extrapolate ?? 'clamp'
  const left = options?.extrapolateLeft ?? both
  const right = options?.extrapolateRight ?? both

  // 定位所在分段（input 落在 [inputRange[i], inputRange[i+1]]）
  let i = 0
  const last = inputRange.length - 1
  for (; i < last - 1; i += 1) {
    if (input < inputRange[i + 1]) break
  }
  const inMin = inputRange[i]
  const inMax = inputRange[i + 1]
  const outMin = outputRange[i]
  const outMax = outputRange[i + 1]

  let x = input
  if (x < inMin) {
    if (left === 'identity') return x
    if (left === 'clamp') x = inMin
    // extend: 保留 x，沿首段直线外推
  }
  if (x > inMax) {
    if (right === 'identity') return x
    if (right === 'clamp') x = inMax
    // extend: 保留 x，沿末段直线外推
  }
  if (outMin === outMax) return outMin
  if (inMin === inMax) return outMin
  return outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin)
}

export interface SpringConfig {
  /** 阻尼 c，默认 10 */
  damping?: number
  /** 质量 m，默认 1 */
  mass?: number
  /** 劲度 k，默认 100 */
  stiffness?: number
  /** 夹住过冲（不超过目标值），默认 false */
  overshootClamping?: boolean
}

export interface SpringParams {
  frame: number
  fps: number
  config?: SpringConfig
  /** 起始值，默认 0 */
  from?: number
  /** 目标值，默认 1 */
  to?: number
  /** 初速度，默认 0 */
  velocity?: number
}

/**
 * 阻尼谐振子解析解：在 frame/fps 时刻给出从 from 趋向 to 的弹簧值。
 * 解析解（非数值积分）→ 与帧率无关、可任意时刻采样。自动按阻尼比选 欠/临界/过 阻尼分支。
 */
export function spring({ frame, fps, config, from = 0, to = 1, velocity = 0 }: SpringParams): number {
  const m = config?.mass ?? 1
  const k = config?.stiffness ?? 100
  const c = config?.damping ?? 10
  const clampOvershoot = config?.overshootClamping ?? false

  const t = Math.max(0, frame) / fps
  if (t === 0) return from

  const omega0 = Math.sqrt(k / m) // 自然角频率
  const zeta = c / (2 * Math.sqrt(k * m)) // 阻尼比
  const x0 = from - to // 相对平衡位置(=to)的初始位移

  let y: number // y(t) = x(t) - to
  if (zeta < 1 - 1e-9) {
    // 欠阻尼（会过冲振荡）
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
    const a = x0
    const b = (velocity + zeta * omega0 * x0) / omegaD
    y = Math.exp(-zeta * omega0 * t) * (a * Math.cos(omegaD * t) + b * Math.sin(omegaD * t))
  } else if (Math.abs(zeta - 1) <= 1e-9) {
    // 临界阻尼（最快无过冲）
    const a = x0
    const b = velocity + omega0 * x0
    y = Math.exp(-omega0 * t) * (a + b * t)
  } else {
    // 过阻尼（缓慢趋近）
    const s = omega0 * Math.sqrt(zeta * zeta - 1)
    const r1 = -zeta * omega0 + s
    const r2 = -zeta * omega0 - s
    const a = (velocity - x0 * r2) / (r1 - r2)
    const b = x0 - a
    y = a * Math.exp(r1 * t) + b * Math.exp(r2 * t)
  }

  let value = to + y
  if (clampOvershoot) value = to >= from ? Math.min(value, to) : Math.max(value, to)
  return value
}

/**
 * 把一个「按帧取值」的运动函数烘焙成定长数组（frame=0..durationInFrames-1）。
 * 用于 ffmpeg 导出：把 interpolate/spring 的逐帧值落地成 zoompan/sendcmd 数据。
 */
export function sampleFrames(durationInFrames: number, fn: (frame: number) => number): number[] {
  const n = Math.max(0, Math.floor(durationInFrames))
  return Array.from({ length: n }, (_, f) => fn(f))
}

/** 线性插值小工具（interpolate 的二点特例，便于直观调用） */
export function lerp(from: number, to: number, progress01: number): number {
  return from + (to - from) * progress01
}
