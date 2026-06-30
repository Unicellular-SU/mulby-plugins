// 滤镜图编译器：EditStack → 一条（必要时两遍）ffmpeg 命令
// 设计依据：docs/ai-creative-canvas-video-editor.md §3.2 / ⑩附录
//
// 关键约定（P0 落地决策，偏离原稿 §3.2 的「源时间基 + rate 折算」）：
//   overlay/audio 的时间窗 (start,end) 以**输出时间基**存储（即预览看到的最终时间轴），
//   编译器不再做 rate/trim 折算 —— 因为叠加/音频面板编辑时预览本就是 post-trim/post-speed
//   的成片，用户天然在输出时间轴上选窗。这样规避了一整类时间错位 bug。
//
// 视频链固定顺序：trim(多段concat) → setpts/reverse(变速) → transpose(方向) →
//   crop/flip/scale/pad(几何) → eq/color/unsharp/vignette(调色) → overlay×N → format
// 音频链固定顺序：atrim → areverse → atempo(变速) → volume → afade → 区间静音 →
//   afftdn(降噪) → loudnorm → asetrate(变调)

import { mediaPath } from '../media'
import type { EditOp, EditStack, OpKind, OverlayParams, TransformParams, ColorParams, AudioParams, ExportParams, SpeedParams, TrimParams } from './types'

export interface OverlayInput {
  kind: 'png' | 'video'
  path: string
}
export interface CompileCtx {
  inPath: string
  projectId: string
  hasAudio: boolean
  // 叠加输入（PNG / PiP 视频）：opId → 已落盘输入。由调用方在编译前用 mediaOverlay 备好。
  overlayResolved?: Record<string, OverlayInput>
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
  inputs: string[] = [] // 额外 -i（input 0 之外）
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
  addInput(path: string): number {
    this.inputs.push(path)
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

function applySpeed(g: Graph, p: SpeedParams): void {
  if (p.reverse) {
    g.vf('reverse')
    g.af('areverse')
  }
  if (p.rate && Math.abs(p.rate - 1) > 1e-6) {
    g.vf(`setpts=PTS/${p.rate.toFixed(4)}`)
    if (p.pitchCompensate !== false) g.af(buildAtempoChain(p.rate))
    else g.af(`asetrate=44100*${p.rate.toFixed(4)},aresample=44100`)
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
    g.a = null // 回旋去音轨（正放+倒放的音频无意义）
  }
  if (p.freezeEnd && p.freezeEnd > 0) {
    g.vf(`tpad=stop_mode=clone:stop_duration=${p.freezeEnd.toFixed(2)}`)
    if (g.a) g.af(`apad=pad_dur=${p.freezeEnd.toFixed(2)}`)
  }
}

function applyTransform(g: Graph, p: TransformParams): void {
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
  // 画幅适配（contain/cover/blur-pad）
  if (p.outW && p.outH) applyFit(g, p.outW, p.outH, p.fit || 'contain')
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
      // colortemperature: 4000(暖)–8000(冷)，把 -100..100 映射到该区间
      const k = 6500 + p.temp * 25
      g.vf(`colortemperature=temperature=${Math.round(k)}`)
    }
  }
  if (p.tint) g.vf(`colorbalance=gm=${(p.tint / 100 * 0.3).toFixed(3)}`)
  if (p.hue) g.vf(`hue=h=${p.hue.toFixed(1)}`)
  if (p.sharpen && p.sharpen > 0) g.vf(`unsharp=5:5:${p.sharpen.toFixed(2)}:5:5:0`)
  if (p.vignette && p.vignette > 0) g.vf(`vignette=PI/${(5 - p.vignette * 3).toFixed(2)}`)
  if (p.grain && p.grain > 0) g.vf(`noise=alls=${Math.round(p.grain)}:allf=t`)
  if (p.lutPath && !fb.has('lut3d')) {
    const esc = p.lutPath.replace(/\\/g, '/').replace(/:/g, '\\:')
    g.vf(`lut3d=file='${esc}'`)
  }
}

function applyOverlays(g: Graph, ops: EditOp[], ctx: CompileCtx): void {
  for (const op of ops) {
    if (op.kind !== 'overlay') continue
    const p = op.params as OverlayParams
    const en = p.range ? `:enable='between(t,${p.range.start.toFixed(3)},${p.range.end.toFixed(3)})'` : ''
    const xExpr = `main_w*${p.rect.x.toFixed(4)}`
    const yExpr = `main_h*${p.rect.y.toFixed(4)}`
    if (p.sub === 'mosaic') {
      // 局部打码（split 去重 → crop → 模糊/像素化 → overlay 回原位）
      const [base, src] = g.splitV()
      const fg = g.freshLabel('fg')
      const out = g.freshLabel('v')
      const cr = `crop=w='iw*${p.rect.w.toFixed(4)}':h='ih*${p.rect.h.toFixed(4)}':x='iw*${p.rect.x.toFixed(4)}':y='ih*${p.rect.y.toFixed(4)}'`
      const eff =
        p.blurKind === 'blur'
          ? `boxblur=${Math.round(p.pixelSize || 12)}:2`
          : `scale='iw/${Math.round(p.pixelSize || 14)}':'ih/${Math.round(p.pixelSize || 14)}':flags=neighbor,scale='iw*${Math.round(p.pixelSize || 14)}':'ih*${Math.round(p.pixelSize || 14)}':flags=neighbor`
      g.raw(`[${src}]${cr},${eff}[${fg}]`)
      g.raw(`[${base}][${fg}]overlay=${xExpr}:${yExpr}${en}[${out}]`)
      g.setV(out)
      continue
    }
    // png / pip 走外部输入
    const resolved = ctx.overlayResolved?.[op.id]
    if (!resolved) continue // 未备好（PNG 尚未生成）→ 跳过，叠加段会补
    const idx = g.addInput(resolved.path)
    if (p.sub === 'pip') {
      const scaled = g.freshLabel('pip')
      const out = g.freshLabel('v')
      g.raw(`[${idx}:v]fps=30,setsar=1,scale=main_w*${p.rect.w.toFixed(4)}:-1[${scaled}]`)
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

function applyAudio(g: Graph, p: AudioParams, outDur: number, fb: Set<string>): void {
  if (!g.a) return
  if (p.gainDb) g.af(`volume=${p.gainDb.toFixed(2)}dB`)
  if (p.fadeIn && p.fadeIn > 0) g.af(`afade=t=in:st=0:d=${p.fadeIn.toFixed(2)}`)
  if (p.fadeOut && p.fadeOut > 0 && outDur > 2 * p.fadeOut) {
    g.af(`afade=t=out:st=${Math.max(0, outDur - p.fadeOut).toFixed(2)}:d=${p.fadeOut.toFixed(2)}`)
  }
  for (const r of p.muteRanges || []) {
    g.af(`volume=0:enable='between(t,${r.start.toFixed(3)},${r.end.toFixed(3)})'`)
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

// ---- 主编译 ----

export async function compileStack(stack: EditStack, ctx: CompileCtx, opts?: CompileOpts): Promise<Compiled> {
  const fb = opts?.fallbacks || new Set<string>()
  const { single, overlays } = reduceStack(stack)
  const trim = single.trim?.params as TrimParams | undefined
  const speed = single.speed?.params as SpeedParams | undefined
  const exp = (single.export?.params as ExportParams | undefined) || ({ format: 'mp4', crf: 23 } as ExportParams)
  const outDuration = computeOutDuration(stack, trim, speed)

  const g = new Graph(ctx.hasAudio)

  // 视频链固定顺序
  if (trim) applyTrim(g, trim, ctx.hasAudio)
  if (speed) applySpeed(g, speed)
  if (speed) applyTimeEffects(g, speed)
  if (single.transform) applyTransform(g, single.transform.params as TransformParams)
  if (single.color) applyColor(g, single.color.params as ColorParams, fb)
  if (overlays.length) applyOverlays(g, overlays, ctx)
  // export 画幅（若未在 transform 指定）
  if (exp.outW && exp.outH) applyFit(g, exp.outW, exp.outH, exp.fit || 'contain')

  // 音频链
  if (single.audio) applyAudio(g, single.audio.params as AudioParams, outDuration, fb)

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
  const pass1Out = await mediaPath(ctx.projectId, 'studio', pass1Ext)

  const args: string[] = ['-i', ctx.inPath]
  for (const inp of g.inputs) args.push('-i', inp)
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
  args.push('-y', pass1Out)

  const passes: CompiledPass[] = [{ args, outPath: pass1Out, weight: needSecondPass ? 0.7 : 1 }]
  const cleanup: string[] = []
  let finalOut = pass1Out

  if (needSecondPass) {
    const ext = exp.format // gif | webp
    const out2 = await mediaPath(ctx.projectId, 'studio', ext)
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
