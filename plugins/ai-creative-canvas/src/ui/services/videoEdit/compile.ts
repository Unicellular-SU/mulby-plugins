// 滤镜图编译器：EditStack → 一条（必要时两遍）ffmpeg 命令
// 设计依据：docs/ai-creative-canvas-video-editor.md §3.2 / ⑩附录
//
// 关键约定（时间基契约，B1 修复后）：
//   overlay/字幕/静音的时间窗 (start,end) 以**源时间基**存储（与预览一致：预览 <video> 放的是
//   源文件，playhead=currentTime 为源时间，删除段靠跳播实现、变速不改播放速率，滑块 max=baseDuration）。
//   编译器用 buildTimeMap 的 srcToOut 把源时间折算到输出时间轴（trim 保留段折叠 + 变速倍率 + reverse 镜像），
//   因为 overlay/audio 施加在 trim/setpts 之后、t 已是输出时间基。这样预览与导出对齐。
//   （历史：曾误改为「输出时间基、不折算」，与源时间基的 UI 编辑冲突，trim/变速下时间窗错位——已回正。）
//
// 视频链固定顺序：trim(多段concat) → setpts/reverse(变速) → transpose(方向) →
//   crop/flip/scale/pad(几何) → eq/color/unsharp/vignette(调色) → overlay×N → format
// 音频链固定顺序：atrim → areverse → atempo(变速) → volume → afade → 区间静音 →
//   afftdn(降噪) → loudnorm → asetrate(变调)

import { mediaPath } from '../media'
import type { EditOp, EditStack, OpKind, OverlayParams, TransformParams, ColorParams, AudioParams, ExportParams, SpeedParams, TrimParams } from './types'

export interface OverlayInput {
  kind: 'png' | 'video' | 'subtitle' | 'timecode'
  path?: string // png/video/timecode（timecode 为横排精灵图）
  cues?: { start: number; end: number; path: string }[] // subtitle：每条 cue 一张 PNG
  cellW?: number // timecode：每格宽
  cellH?: number // timecode：每格高
  step?: number // timecode：每格秒数
}
export interface CompileCtx {
  inPath: string
  projectId: string
  hasAudio: boolean
  // 叠加输入（PNG / PiP 视频）：opId → 已落盘输入。由调用方在编译前用 mediaOverlay 备好。
  overlayResolved?: Record<string, OverlayInput>
  /** 测试/集成脚本注入：固定输出路径，绕过 mulby mediaPath */
  resolveOutPath?: (projectId: string, base: string, ext: string) => string | Promise<string>
}
export interface CompileOpts {
  // 执行器探测到某滤镜不可用时，加入对应 key 触发退化重编译
  fallbacks?: Set<string> // 'denoise' | 'colortemperature' | 'lut3d' | ...
}
export interface CompiledPass {
  args: string[]
  outPath: string
  weight: number // 进度权重（passes 间归一）
}
export interface Compiled {
  passes: CompiledPass[]
  finalOut: string
  cleanup: string[] // 中间产物，finally unlink
  outDuration: number
}

// ---- 工具 ----

// 把任意倍率分解为每因子 ∈[0.5,2] 的 atempo 链（保音高变速）
export function buildAtempoChain(rate: number): string {
  const factors: number[] = []
  let r = rate
  while (r > 2.0 + 1e-6) {
    factors.push(2.0)
    r /= 2.0
  }
  while (r < 0.5 - 1e-6) {
    factors.push(0.5)
    r /= 0.5
  }
  factors.push(r)
  return factors.map((f) => `atempo=${f.toFixed(4)}`).join(',')
}

// 取每大类最后一个启用 op（singleton 语义）；overlay 收集全部启用项
function reduceStack(stack: EditStack): { single: Partial<Record<OpKind, EditOp>>; overlays: EditOp[] } {
  const single: Partial<Record<OpKind, EditOp>> = {}
  const overlays: EditOp[] = []
  for (const op of stack.ops) {
    if (!op.enabled) continue
    if (op.kind === 'overlay') overlays.push(op)
    else single[op.kind] = op
  }
  return { single, overlays }
}

// 对外：从栈算输出时长（供 prepareOverlays 等编译外计算）
export function stackOutDuration(stack: EditStack): number {
  const enabled = stack.ops.filter((o) => o.enabled)
  const trim = enabled.find((o) => o.kind === 'trim')?.params as TrimParams | undefined
  const speed = enabled.find((o) => o.kind === 'speed')?.params as SpeedParams | undefined
  return computeOutDuration(stack, trim, speed)
}

// 源时间基 → 输出时间基映射。overlay/字幕/静音的时间窗均以源时间基存储（见 types.ts / 头注）。
// 语义：先按 trim 保留段折叠源时间（删除段坍缩到接缝），再除以变速倍率；reverse 镜像；
// boomerang 下同一源瞬间在正放/倒放两段各出现一次，单个 between 无法表达 → 退回全程显示。
interface TimeMap {
  srcToOut(t: number): number
  // 返回 `:enable='between(...)'`（已折算到输出时间基）或 ''（全程/无窗）
  enable(range?: { start: number; end: number }): string
}
function buildTimeMap(stack: EditStack, trim?: TrimParams, speed?: SpeedParams): TimeMap {
  const keeps = (trim?.segments || []).filter((s) => s.keep !== false && s.out > s.in).sort((a, b) => a.in - b.in)
  const rate = speed && speed.rate > 0 ? speed.rate : 1
  const reverse = !!speed?.reverse
  const boomerang = !!speed?.boomerang
  const trimmedDur = keeps.length ? keeps.reduce((a, s) => a + (s.out - s.in), 0) : stack.baseDuration || 0
  const baseOutDur = rate > 0 ? trimmedDur / rate : trimmedDur // 变速后、boomerang/freeze 前的时长（reverse 镜像基准）
  const postTrim = (t: number): number =>
    keeps.length ? keeps.reduce((acc, s) => acc + Math.max(0, Math.min(t, s.out) - s.in), 0) : t
  const srcToOut = (t: number): number => {
    const o = postTrim(t) / rate
    return reverse && !boomerang ? Math.max(0, baseOutDur - o) : o
  }
  const enable = (range?: { start: number; end: number }): string => {
    if (!range) return ''
    if (boomerang) return '' // 无法用单 between 表达，退回全程
    let a = srcToOut(range.start)
    let b = srcToOut(range.end)
    if (a > b) [a, b] = [b, a] // reverse 会翻转首尾
    return `:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'`
  }
  return { srcToOut, enable }
}

// 输出时长：trim 取保留段之和，除以变速倍率，再计回旋(×2)与片尾冻结(+freeze)
function computeOutDuration(stack: EditStack, trim?: TrimParams, speed?: SpeedParams): number {
  let dur = stack.baseDuration || 0
  if (trim?.segments?.length) {
    const kept = trim.segments.filter((s) => s.keep !== false)
    if (kept.length) dur = kept.reduce((a, s) => a + Math.max(0, s.out - s.in), 0)
  }
  const rate = speed && speed.rate > 0 ? speed.rate : 1
  dur = dur / rate
  if (speed?.boomerang) dur *= 2
  if (speed?.freezeEnd && speed.freezeEnd > 0) dur += speed.freezeEnd
  return dur
}

// 图构建器：维护当前 v/a 标签与 filter 语句列表
class Graph {
  parts: string[] = []
  v = '0:v'
  a: string | null
  n = 0
  inputs: { path: string; pre?: string[] }[] = [] // 额外 -i（input 0 之外）；pre 为该输入的前置参数（如 -loop 1）
  constructor(hasAudio: boolean) {
    this.a = hasAudio ? '0:a' : null
  }
  private fresh(p: string): string {
    return `${p}${this.n++}`
  }
  vf(filter: string): void {
    const out = this.fresh('v')
    this.parts.push(`[${this.v}]${filter}[${out}]`)
    this.v = out
  }
  af(filter: string): void {
    if (!this.a) return
    const out = this.fresh('a')
    this.parts.push(`[${this.a}]${filter}[${out}]`)
    this.a = out
  }
  // 把当前 v 拆成 2 路（base/src），返回两个标签；调用方负责消费
  splitV(): [string, string] {
    const base = this.fresh('v')
    const src = this.fresh('v')
    this.parts.push(`[${this.v}]split=2[${base}][${src}]`)
    return [base, src]
  }
  raw(stmt: string): void {
    this.parts.push(stmt)
  }
  setV(label: string): void {
    this.v = label
  }
  addInput(path: string, pre?: string[]): number {
    this.inputs.push({ path, pre })
    return this.inputs.length // input 索引（input 0 是源，故额外输入从 1 起）
  }
  freshLabel(p = 'x'): string {
    return this.fresh(p)
  }
}

// ---- 各域 ----

function applyTrim(g: Graph, p: TrimParams, hasAudio: boolean): void {
  const keeps = (p.segments || []).filter((s) => s.keep !== false && s.out > s.in).sort((a, b) => a.in - b.in)
  if (!keeps.length) return
  keeps.forEach((s, i) => {
    g.raw(`[0:v]trim=${s.in.toFixed(3)}:${s.out.toFixed(3)},setpts=PTS-STARTPTS[tv${i}]`)
    if (hasAudio) g.raw(`[0:a]atrim=${s.in.toFixed(3)}:${s.out.toFixed(3)},asetpts=PTS-STARTPTS[ta${i}]`)
  })
  if (keeps.length === 1) {
    g.setV('tv0')
    if (hasAudio) g.a = 'ta0'
    return
  }
  const ins = keeps.map((_, i) => (hasAudio ? `[tv${i}][ta${i}]` : `[tv${i}]`)).join('')
  if (hasAudio) {
    g.raw(`${ins}concat=n=${keeps.length}:v=1:a=1[cv][ca]`)
    g.setV('cv')
    g.a = 'ca'
  } else {
    g.raw(`${ins}concat=n=${keeps.length}:v=1:a=0[cv]`)
    g.setV('cv')
  }
}

function applySpeed(g: Graph, p: SpeedParams, fb: Set<string>): void {
  if (p.reverse) {
    g.vf('reverse')
    g.af('areverse')
  }
  if (p.rate && Math.abs(p.rate - 1) > 1e-6) {
    g.vf(`setpts=PTS/${p.rate.toFixed(4)}`)
    if (p.pitchCompensate !== false) g.af(buildAtempoChain(p.rate))
    else g.af(`asetrate=44100*${p.rate.toFixed(4)},aresample=44100`)
  }
  // 平滑慢动作：仅减速时补帧（minterpolate 慢，含退化跳过）
  if (p.smoothSlowmo && p.rate && p.rate < 1 && !fb.has('minterpolate')) {
    g.vf('minterpolate=fps=60:mi_mode=mci:mc_mode=obmc')
  }
}

// 时间特效（在变速之后、几何之前）：回旋 boomerang + 片尾冻结 freeze
function applyTimeEffects(g: Graph, p: SpeedParams): void {
  if (p.boomerang) {
    const [a, b] = g.splitV()
    const r = g.freshLabel('rv')
    const out = g.freshLabel('v')
    g.raw(`[${b}]reverse[${r}]`)
    g.raw(`[${a}][${r}]concat=n=2:v=1[${out}]`)
    g.setV(out)
    // 回旋去音轨（正放+倒放的音频无意义）。但若 trim/变速已产出具名音频输出（非原始 0:a 输入），
    // 直接置 null 会让该标签悬空 → filter_complex 报 "Output pad not connected"。先 anullsink 消费掉。
    if (g.a && g.a !== '0:a') g.raw(`[${g.a}]anullsink`)
    g.a = null
  }
  if (p.freezeEnd && p.freezeEnd > 0) {
    g.vf(`tpad=stop_mode=clone:stop_duration=${p.freezeEnd.toFixed(2)}`)
    if (g.a) g.af(`apad=pad_dur=${p.freezeEnd.toFixed(2)}`)
  }
}

// 运动残影（多帧混合）：在时间链处理，含退化
function applyMotionTrail(g: Graph, frames: number, fb: Set<string>): void {
  const n = Math.max(2, Math.min(6, Math.round(frames)))
  if (fb.has('tmix')) g.vf('tblend=all_mode=average')
  else g.vf(`tmix=frames=${n}:weights='${Array(n).fill(1).join(' ')}'`)
}

function applyTransform(g: Graph, p: TransformParams, fb: Set<string>): void {
  if (p.crop) {
    const { x, y, w, h } = p.crop
    g.vf(
      `crop=trunc(iw*${w.toFixed(4)}/2)*2:trunc(ih*${h.toFixed(4)}/2)*2:trunc(iw*${x.toFixed(4)}):trunc(ih*${y.toFixed(4)}),setsar=1`
    )
  }
  if (p.hflip) g.vf('hflip')
  if (p.vflip) g.vf('vflip')
  if (p.rotate) {
    const deg = ((p.rotate % 360) + 360) % 360
    if (deg === 90) g.vf('transpose=1')
    else if (deg === 270) g.vf('transpose=2')
    else if (deg === 180) g.vf('transpose=1,transpose=1')
    else if (deg !== 0) g.vf(`rotate=${deg}*PI/180:fillcolor=black,setsar=1`)
  }
  // 镜像万花筒：取一半 → 翻转拼回（输出尺寸不变）
  if (p.mirror === 'h') {
    const half = g.freshLabel('mh')
    const a = g.freshLabel('ma')
    const b = g.freshLabel('mb')
    const rb = g.freshLabel('mr')
    const out = g.freshLabel('v')
    g.raw(`[${g.v}]crop=trunc(iw/2/2)*2:ih:0:0[${half}]`)
    g.raw(`[${half}]split=2[${a}][${b}]`)
    g.raw(`[${b}]hflip[${rb}]`)
    g.raw(`[${a}][${rb}]hstack[${out}]`)
    g.setV(out)
  } else if (p.mirror === 'v') {
    const half = g.freshLabel('mh')
    const a = g.freshLabel('ma')
    const b = g.freshLabel('mb')
    const rb = g.freshLabel('mr')
    const out = g.freshLabel('v')
    g.raw(`[${g.v}]crop=iw:trunc(ih/2/2)*2:0:0[${half}]`)
    g.raw(`[${half}]split=2[${a}][${b}]`)
    g.raw(`[${b}]vflip[${rb}]`)
    g.raw(`[${a}][${rb}]vstack[${out}]`)
    g.setV(out)
  }
  // 画幅适配（contain/cover/blur-pad）
  if (p.outW && p.outH) applyFit(g, p.outW, p.outH, p.fit || 'contain')
  // 全画面像素化：缩小再放大（neighbor），放大目标偶数化避免 libx264 奇数尺寸报错
  if (p.pixelate && p.pixelate > 1) {
    const n = Math.round(p.pixelate)
    g.vf(`scale=round(iw/${n}):round(ih/${n}):flags=neighbor,scale=trunc(iw*${n}/2)*2:trunc(ih*${n}/2)*2:flags=neighbor,setsar=1`)
  }
  // 镜头抖动：过扫描后在余量内按 sin/cos 振荡裁剪（偏移用表达式约束在 [0,余量]，不越界）
  if (p.shake && p.shake > 0) {
    const k = Math.min(1, p.shake).toFixed(3)
    const F = (3 + p.shake * 9).toFixed(2)
    g.vf(
      `scale=trunc(iw*1.08/2)*2:trunc(ih*1.08/2)*2,crop=trunc(iw/1.08/2)*2:trunc(ih/1.08/2)*2:` +
        `'(iw-ow)/2*(1+${k}*sin(2*PI*t*${F}))':'(ih-oh)/2*(1+${k}*cos(2*PI*t*${(Number(F) * 1.3).toFixed(2)}))',setsar=1`
    )
  }
  // RGB 故障位移。注意：rgbashift 与 chromashift 均在 FFmpeg 4.1 由同一文件(vf_chromashift.c)引入——
  // 旧版缺 rgbashift 时 chromashift 也必缺，退化到 chromashift 名存实亡。故退化路径直接跳过 glitch：
  // 用户失去故障特效但导出不再失败（exportStudio 的退化变体会 toast 告知「部分特效不可用」）。
  if (p.glitch && p.glitch > 0 && !fb.has('rgbashift')) {
    const s = Math.round(p.glitch * 14)
    g.vf(`rgbashift=rh=${s}:bh=${-s}`)
  }
  // 画面去抖（单遍 deshake）
  if (p.deshake) g.vf('deshake=edge=mirror')
}

// 画幅适配，复用于 transform 与 export
function applyFit(g: Graph, W: number, H: number, fit: 'contain' | 'cover' | 'blur-pad'): void {
  if (fit === 'cover') {
    g.vf(`scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`)
  } else if (fit === 'blur-pad') {
    const [bg, fg] = g.splitV()
    const bgb = g.freshLabel('bg')
    const fgs = g.freshLabel('fg')
    const out = g.freshLabel('v')
    g.raw(
      `[${bg}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=luma_radius='min(20,iw/40)':luma_power=2,setsar=1[${bgb}]`
    )
    g.raw(`[${fg}]scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1[${fgs}]`)
    g.raw(`[${bgb}][${fgs}]overlay=(W-w)/2:(H-h)/2[${out}]`)
    g.setV(out)
  } else {
    g.vf(`scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`)
  }
}

function applyColor(g: Graph, p: ColorParams, fb: Set<string>): void {
  if (p.denoise && p.denoise > 0) g.vf(`hqdn3d=${(p.denoise * 8).toFixed(1)}`)
  const eq: string[] = []
  if (p.brightness) eq.push(`brightness=${p.brightness.toFixed(3)}`)
  if (p.contrast != null && p.contrast !== 1) eq.push(`contrast=${p.contrast.toFixed(3)}`)
  if (p.saturation != null && p.saturation !== 1) eq.push(`saturation=${p.saturation.toFixed(3)}`)
  if (p.gamma != null && p.gamma !== 1) eq.push(`gamma=${p.gamma.toFixed(3)}`)
  if (eq.length) g.vf(`eq=${eq.join(':')}`)
  if (p.temp) {
    if (fb.has('colortemperature')) {
      // 退化：colorbalance 近似（暖=加红减蓝）
      const t = p.temp / 100
      g.vf(`colorbalance=rs=${(t * 0.3).toFixed(3)}:bs=${(-t * 0.3).toFixed(3)}`)
    } else {
      // colortemperature：低开尔文=偏橙暖、高开尔文=偏蓝冷。UI 约定正 temp=暖（暖阳预设 temp>0），
      // 故正 temp 映射到低 K：temp=+100→4000K(暖)，temp=-100→9000K(冷)。方向须与退化路径 colorbalance(正=加红)一致。
      const k = 6500 - p.temp * 25
      g.vf(`colortemperature=temperature=${Math.round(k)}`)
    }
  }
  if (p.tint) g.vf(`colorbalance=gm=${(p.tint / 100 * 0.3).toFixed(3)}`)
  if (p.hue) g.vf(`hue=h=${p.hue.toFixed(1)}`)
  if (p.sharpen && p.sharpen > 0) g.vf(`unsharp=5:5:${p.sharpen.toFixed(2)}:5:5:0`)
  if (p.vignette && p.vignette > 0) g.vf(`vignette=PI/${(5 - p.vignette * 3).toFixed(2)}`)
  if (p.grain && p.grain > 0) g.vf(`noise=alls=${Math.round(p.grain)}:allf=t`)
  if (p.invert) g.vf('negate')
  if (p.lutPath && !fb.has('lut3d')) {
    const esc = p.lutPath.replace(/\\/g, '/').replace(/:/g, '\\:')
    g.vf(`lut3d=file='${esc}'`)
  }
}

// crop 后 overlay 坐标换算（B4b）：用户在「整帧 + clip-path」预览上按原始帧归一坐标定位/画框 overlay，
// 但导出时 crop 先执行、overlay 落在裁剪后帧（main_w/iw = 裁剪宽）。把原始帧归一坐标换算到裁剪帧归一坐标：
// x'=(x-crop.x)/crop.w、y'=(y-crop.y)/crop.h、w'=w/crop.w、h'=h/crop.h。因 overlay PNG 盒宽仍按 rect.w*baseW
// 出绝对像素（见 mediaOverlay），位置换算后 overlay 的绝对内容坐标与尺寸都与预览一致（原先按裁剪帧归一漂移到别处）。
// frame 描边贴合输出边框、非内容锚定（预览按 inset 整帧渲染），单独排除不换算。无 crop 时恒等。
function remapCropRect(
  r: { x: number; y: number; w: number; h: number },
  crop?: { x: number; y: number; w: number; h: number }
): { x: number; y: number; w: number; h: number } {
  if (!crop || crop.w <= 0 || crop.h <= 0) return r
  return { x: (r.x - crop.x) / crop.w, y: (r.y - crop.y) / crop.h, w: r.w / crop.w, h: r.h / crop.h }
}

function applyOverlays(
  g: Graph,
  ops: EditOp[],
  ctx: CompileCtx,
  baseW: number,
  outDur: number,
  tm: TimeMap,
  crop?: { x: number; y: number; w: number; h: number }
): void {
  for (const op of ops) {
    if (op.kind !== 'overlay') continue
    const p = op.params as OverlayParams
    const en = tm.enable(p.range) // 源时间窗 → 输出时间基 enable
    const rr = p.sub === 'frame' ? p.rect : remapCropRect(p.rect, crop) // crop 后内容锚定 overlay 换算坐标基（B4b）
    const xExpr = `main_w*${rr.x.toFixed(4)}`
    const yExpr = `main_h*${rr.y.toFixed(4)}`
    if (p.sub === 'mosaic') {
      // 局部打码（split 去重 → crop → 模糊/像素化 → overlay 回原位）
      const [base, src] = g.splitV()
      const fg = g.freshLabel('fg')
      const out = g.freshLabel('v')
      const cr = `crop=w='iw*${rr.w.toFixed(4)}':h='ih*${rr.h.toFixed(4)}':x='iw*${rr.x.toFixed(4)}':y='ih*${rr.y.toFixed(4)}'`
      const eff =
        p.blurKind === 'blur'
          ? `boxblur=${Math.round(p.pixelSize || 12)}:2`
          : `scale='iw/${Math.round(p.pixelSize || 14)}':'ih/${Math.round(p.pixelSize || 14)}':flags=neighbor,scale='iw*${Math.round(p.pixelSize || 14)}':'ih*${Math.round(p.pixelSize || 14)}':flags=neighbor`
      g.raw(`[${src}]${cr},${eff}[${fg}]`)
      g.raw(`[${base}][${fg}]overlay=${xExpr}:${yExpr}${en}[${out}]`)
      g.setV(out)
      continue
    }
    // png / pip / subtitle 走外部输入
    const resolved = ctx.overlayResolved?.[op.id]
    if (!resolved) continue // 未备好（PNG 尚未生成）→ 跳过，叠加段会补
    if (p.sub === 'subtitle') {
      // 字幕：每条 cue 一张 PNG，按其时间窗 overlay 串联（底部居中）；cue 时间为源时间基，折算到输出
      for (const cue of resolved.cues || []) {
        const cidx = g.addInput(cue.path)
        const out = g.freshLabel('v')
        const cen = tm.enable({ start: cue.start, end: cue.end }) || `:enable='between(t,${cue.start.toFixed(3)},${cue.end.toFixed(3)})'`
        g.raw(`[${g.v}][${cidx}:v]overlay=${xExpr}:${yExpr}${cen}[${out}]`)
        g.setV(out)
      }
      continue
    }
    if (p.sub === 'timecode' && resolved.path && resolved.cellW) {
      // 精灵图按时间裁出当前格：必须 -loop 1 让单帧 PNG 持续产帧，crop 的 x 才能逐帧求值前推
      // （否则单帧只在 t=0 求值一次，overlay eof_action=repeat 把首格重复到全片 → 时间码永远停在 0:00）。
      // 输出长度由主流经 overlay 收束，-loop 1 的无限输入不会让成片变长。
      const idx = g.addInput(resolved.path, ['-loop', '1'])
      const cw = resolved.cellW
      const ch = resolved.cellH || cw
      const step = resolved.step || 1
      const tcc = g.freshLabel('tc')
      const out = g.freshLabel('v')
      g.raw(`[${idx}:v]crop=${cw}:${ch}:'floor(t/${step})*${cw}':0[${tcc}]`)
      g.raw(`[${g.v}][${tcc}]overlay=${xExpr}:${yExpr}${en}[${out}]`)
      g.setV(out)
      continue
    }
    if (!resolved.path) continue
    if (p.sub === 'progress') {
      // 满幅进度条从左滑入：x 由 -w 推进到 0（输出尺寸恒定，避免变宽绿边）
      const idx = g.addInput(resolved.path)
      const out = g.freshLabel('v')
      const dur = outDur > 0 ? outDur : 1
      g.raw(`[${g.v}][${idx}:v]overlay=x='-w+w*t/${dur.toFixed(3)}':y='${yExpr}'[${out}]`)
      g.setV(out)
      continue
    }
    const idx = g.addInput(resolved.path)
    if (p.sub === 'pip') {
      // 子画面宽 = 基准宽×rect.w（数值偶数化；位置仍用 overlay 的 main_w 表达式自适应）
      const pipW = Math.max(2, Math.round(((baseW || 1280) * p.rect.w) / 2) * 2)
      const scaled = g.freshLabel('pip')
      const out = g.freshLabel('v')
      g.raw(`[${idx}:v]fps=30,setsar=1,scale=${pipW}:-2[${scaled}]`)
      g.raw(`[${g.v}][${scaled}]overlay=${xExpr}:${yExpr}${en}[${out}]`)
      g.setV(out)
    } else {
      // text/watermark/progress/timecode/sticker：PNG 直接 overlay
      const out = g.freshLabel('v')
      g.raw(`[${g.v}][${idx}:v]overlay=${xExpr}:${yExpr}${en}[${out}]`)
      g.setV(out)
    }
  }
}

function applyAudio(g: Graph, p: AudioParams, outDur: number, fb: Set<string>, tm: TimeMap): void {
  if (g.a) {
    if (p.gainDb) g.af(`volume=${p.gainDb.toFixed(2)}dB`)
    if (p.fadeIn && p.fadeIn > 0) g.af(`afade=t=in:st=0:d=${p.fadeIn.toFixed(2)}`)
    if (p.fadeOut && p.fadeOut > 0 && outDur > 2 * p.fadeOut) {
      g.af(`afade=t=out:st=${Math.max(0, outDur - p.fadeOut).toFixed(2)}:d=${p.fadeOut.toFixed(2)}`)
    }
    for (const r of p.muteRanges || []) {
      const en = tm.enable(r) // 源时间窗 → 输出时间基（与视频链同一映射，音频经 atrim/atempo 后也是输出时间基）
      if (en) g.af(`volume=0${en}`)
    }
    if (p.denoise) {
      if (fb.has('denoise')) g.af('highpass=f=80,lowpass=f=12000')
      else g.af('afftdn=nf=-25')
    }
    if (p.loudnorm) g.af('loudnorm=I=-16:TP=-1.5:LRA=11')
    if (p.pitchSemitones) {
      const pr = Math.pow(2, p.pitchSemitones / 12)
      g.af(`asetrate=44100*${pr.toFixed(4)},aresample=44100,atempo=${(1 / pr).toFixed(4)}`)
    }
  }
  // 配乐 / 旁白：第二音频输入 → 混音 / 替换 / 闪避（无原声时仍可 replace/mix）
  if (p.bgm?.path) {
    const idx = g.addInput(p.bgm.path)
    const ms = Math.max(0, Math.round((p.bgm.offset || 0) * 1000))
    const vol = p.bgm.volume ?? 1
    const bg = g.freshLabel('bg')
    g.raw(`[${idx}:a]aresample=44100,adelay=${ms}|${ms},volume=${vol.toFixed(2)}[${bg}]`)
    if (p.bgm.mode === 'replace' || !g.a) {
      g.a = bg // 替换原声（或本无原声）
    } else if (p.bgm.mode === 'duck' && !fb.has('sidechain')) {
      const main = g.freshLabel('am')
      const sc = g.freshLabel('asc')
      const duck = g.freshLabel('dk')
      const mix = g.freshLabel('mx')
      g.raw(`[${g.a}]asplit=2[${main}][${sc}]`)
      g.raw(`[${bg}][${sc}]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[${duck}]`)
      g.raw(`[${main}][${duck}]amix=inputs=2:duration=longest:dropout_transition=0[${mix}]`)
      g.a = mix
    } else {
      const mix = g.freshLabel('mx')
      g.raw(`[${g.a}][${bg}]amix=inputs=2:duration=longest:dropout_transition=0[${mix}]`)
      g.a = mix
    }
  }
}

// ---- 主编译 ----

export async function compileStack(stack: EditStack, ctx: CompileCtx, opts?: CompileOpts): Promise<Compiled> {
  const fb = opts?.fallbacks || new Set<string>()
  const { single, overlays } = reduceStack(stack)
  const trim = single.trim?.params as TrimParams | undefined
  const speed = single.speed?.params as SpeedParams | undefined
  const exp = (single.export?.params as ExportParams | undefined) || ({ format: 'mp4', crf: 23 } as ExportParams)
  const outDuration = computeOutDuration(stack, trim, speed)
  const tm = buildTimeMap(stack, trim, speed)

  const g = new Graph(ctx.hasAudio)

  // 视频链固定顺序
  if (trim) applyTrim(g, trim, ctx.hasAudio)
  if (speed) applySpeed(g, speed, fb)
  if (speed) applyTimeEffects(g, speed)
  if (speed?.motionTrail && speed.motionTrail >= 2) applyMotionTrail(g, speed.motionTrail, fb)
  if (single.transform) applyTransform(g, single.transform.params as TransformParams, fb)
  if (single.color) applyColor(g, single.color.params as ColorParams, fb)
  // crop 与 overlay 同栈时把 crop 传入：编译期换算 overlay 坐标基，导出与整帧预览对齐（B4b）
  const cropRect = (single.transform?.params as TransformParams | undefined)?.crop
  if (overlays.length) applyOverlays(g, overlays, ctx, stack.baseW, outDuration, tm, cropRect)
  // export 画幅（若未在 transform 指定）
  if (exp.outW && exp.outH) applyFit(g, exp.outW, exp.outH, exp.fit || 'contain')

  // 音频链
  if (single.audio) applyAudio(g, single.audio.params as AudioParams, outDuration, fb, tm)

  // 成片首尾黑场淡入淡出（视频 + 音频同步），最后施加
  if (exp.fadeIn && exp.fadeIn > 0) {
    g.vf(`fade=t=in:st=0:d=${exp.fadeIn.toFixed(2)}`)
    if (g.a) g.af(`afade=t=in:st=0:d=${exp.fadeIn.toFixed(2)}`)
  }
  if (exp.fadeOut && exp.fadeOut > 0 && outDuration > 2 * exp.fadeOut) {
    const st = Math.max(0, outDuration - exp.fadeOut).toFixed(2)
    g.vf(`fade=t=out:st=${st}:d=${exp.fadeOut.toFixed(2)}`)
    if (g.a) g.af(`afade=t=out:st=${st}:d=${exp.fadeOut.toFixed(2)}`)
  }

  // 收尾：像素格式
  g.vf('format=yuv420p')

  // 中间产物 mp4（pass1）
  const needSecondPass = exp.format === 'gif' || exp.format === 'webp'
  const pass1Ext = needSecondPass ? 'mp4' : exp.format === 'webm' ? 'webm' : 'mp4'
  const pathFor = ctx.resolveOutPath ?? ((pid, base, ext) => mediaPath(pid, base, ext))
  const pass1Out = await pathFor(ctx.projectId, 'studio', pass1Ext)

  const args: string[] = ['-i', ctx.inPath]
  for (const inp of g.inputs) {
    if (inp.pre) args.push(...inp.pre)
    args.push('-i', inp.path)
  }
  args.push('-filter_complex', g.parts.join(';'), '-map', `[${g.v}]`)
  if (g.a) args.push('-map', `[${g.a}]`)
  else args.push('-an')
  if (exp.fps) args.push('-r', String(exp.fps))
  if (pass1Ext === 'webm') {
    args.push('-c:v', 'libvpx-vp9', '-crf', String(exp.crf ?? 30), '-b:v', '0')
    if (g.a) args.push('-c:a', 'libopus')
  } else {
    args.push('-c:v', 'libx264', '-crf', String(exp.crf ?? 23), '-preset', 'fast', '-pix_fmt', 'yuv420p')
    if (g.a) args.push('-c:a', 'aac', '-b:a', '192k')
    args.push('-movflags', '+faststart')
  }
  // 含配乐/旁白时把成片时长钉到视频长（amix=longest 不会让音频拖长成片）
  if ((single.audio?.params as AudioParams | undefined)?.bgm?.path && outDuration > 0) {
    args.push('-t', outDuration.toFixed(3))
  }
  args.push('-y', pass1Out)

  const passes: CompiledPass[] = [{ args, outPath: pass1Out, weight: needSecondPass ? 0.7 : 1 }]
  const cleanup: string[] = []
  let finalOut = pass1Out

  if (needSecondPass) {
    const ext = exp.format // gif | webp
    const out2 = await pathFor(ctx.projectId, 'studio', ext)
    const fps = exp.fps || 12
    const w = exp.outW || 480
    const args2: string[] =
      ext === 'gif'
        ? [
            '-i',
            pass1Out,
            '-vf',
            `fps=${fps},scale=${w}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`,
            '-loop',
            '0',
            '-y',
            out2
          ]
        : ['-i', pass1Out, '-vf', `fps=${fps},scale=${w}:-1:flags=lanczos`, '-loop', '0', '-c:v', 'libwebp', '-q:v', '75', '-y', out2]
    passes.push({ args: args2, outPath: out2, weight: 0.3 })
    cleanup.push(pass1Out) // 中间 mp4 删除
    finalOut = out2
  }

  return { passes, finalOut, cleanup, outDuration }
}
