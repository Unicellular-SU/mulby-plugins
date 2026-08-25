/**
 * ffmpeg 合成服务（M5）：把多个本地视频片段规范化后拼接成一条成片，
 * 可选烧录/软封装字幕、混入一条配音/音乐音轨。
 *
 * 走宿主 mulby.ffmpeg（主进程真实 ffmpeg 二进制）：
 * - isAvailable / download：首次使用自动按需下载 ffmpeg；
 * - run(args, onProgress) → { promise, kill, quit }：执行并回传进度。
 *
 * 片段分辨率/帧率可能各异，统一用 filter_complex 做 scale+pad+setsar+fps 归一，
 * 再 concat（视频流），避免「不同参数无法拼接」。
 */
import { ensureSubdir, readAsDataUrl } from './fsutil'
import { buildKenBurnsArgs, type KenBurnsPreset } from './kenBurns'

export type SubtitleMode = 'off' | 'soft' | 'burn'

// M18-D：成片音轨。dialogue 为 key（不被压），music/sfx 被对白侧链 duck。
export interface AudioTrack {
  path: string
  role: 'dialogue' | 'music' | 'sfx'
}

export type FilmTransition = 'none' | 'xfade' | 'fade'

export interface ComposeOptions {
  clips: string[] // 本地片段路径（按时间线顺序）
  outPath: string
  width: number
  height: number
  fps: number
  audioPath?: string // 兼容：单条配音/音乐（等价 audioTracks=[{path,role:'music'}]）
  audioTracks?: AudioTrack[] // M18-D：多轨（对白 + BGM + SFX）
  ducking?: boolean // M18-D：对白存在时用 sidechaincompress 压低 BGM/SFX（默认 true）
  srtPath?: string // 可选：字幕文件
  subtitleMode: SubtitleMode
  totalSec?: number // 可选：预计成片总时长（用于进度估算）
  // P2-10 转场：none=硬切（默认）；xfade=镜间交叉淡化（需各片段时长 clipDurations）；fade=整片淡入淡出
  transition?: FilmTransition
  transitionDur?: number // 转场时长（秒），默认 0.5；会被钳制到小于最短片段
  clipDurations?: number[] // 与 clips 对齐的时长（xfade 计算 offset 必需）
  keepClipAudio?: boolean // 工作流成片：无外部音轨时保留各片段自带音频（按序拼成成片音轨）
  onProgress?: (info: { percent?: number; text: string }) => void
}

export interface FfmpegProgressInfo {
  percent?: number
  text: string
}

interface FfmpegTaskLike {
  promise: Promise<void>
  kill: () => void
  quit?: () => void
}

let currentTask: FfmpegTaskLike | null = null

function ff() {
  const f = window.mulby?.ffmpeg
  if (!f) throw new Error('宿主 ffmpeg 能力不可用（请升级 Mulby）')
  return f
}

/** ffmpeg 是否就绪 */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    return await ff().isAvailable()
  } catch {
    return false
  }
}

/** 确保 ffmpeg 可用：不可用则触发下载（带进度回调） */
export async function ensureFfmpeg(onProgress?: (info: FfmpegProgressInfo) => void): Promise<boolean> {
  if (await ffmpegAvailable()) return true
  onProgress?.({ text: '首次使用，正在下载 ffmpeg…', percent: 0 })
  try {
    const r = await ff().download((p) => {
      const phase = p.phase === 'downloading' ? '下载 ffmpeg' : p.phase === 'extracting' ? '解压 ffmpeg' : '准备 ffmpeg'
      onProgress?.({ percent: Math.round(p.percent || 0), text: `${phase}… ${Math.round(p.percent || 0)}%` })
    })
    if (!r?.success) {
      onProgress?.({ text: r?.error || 'ffmpeg 下载失败' })
      return false
    }
  } catch (e) {
    onProgress?.({ text: e instanceof Error ? e.message : 'ffmpeg 下载失败' })
    return false
  }
  return await ffmpegAvailable()
}

export async function ffmpegVersion(): Promise<string | null> {
  try {
    return await ff().getVersion()
  } catch {
    return null
  }
}

/** ffmpeg subtitles 滤镜路径转义（跨平台：保留 Windows 盘符冒号、转义其余冒号/单引号） */
function escapeSubPath(p: string): string {
  let s = p.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(s)) {
    // Windows：盘符冒号（C:）是路径语法，不能转义；仅转义其余冒号
    s = s.slice(0, 2) + s.slice(2).replace(/:/g, '\\:')
  } else {
    s = s.replace(/:/g, '\\:')
  }
  s = s.replace(/'/g, "\\'")
  return s
}

/** P2-10：把转场时长钳制到合理范围（0.2s ~ 最短片段的 40%），避免 xfade offset 为负 */
export function clampTransitionDur(transitionDur: number | undefined, clipDurations?: number[] | null): number {
  const minDur = clipDurations && clipDurations.length ? Math.min(...clipDurations) : 5
  return Math.max(0.2, Math.min(transitionDur ?? 0.5, minDur * 0.4))
}

/** 构造拼接命令参数 */
export function buildConcatArgs(o: ComposeOptions): string[] {
  const { clips, outPath, width, height, fps, srtPath, subtitleMode } = o
  // 归一音轨来源：优先多轨 audioTracks，否则兼容单条 audioPath（视为 music）
  const tracks: AudioTrack[] =
    o.audioTracks && o.audioTracks.length ? o.audioTracks : o.audioPath ? [{ path: o.audioPath, role: 'music' }] : []
  const ducking = o.ducking !== false // 默认开启

  const args: string[] = []
  for (const c of clips) args.push('-i', c)
  // 音轨各占一个输入；下标 = clips.length + 轨序
  for (const t of tracks) args.push('-i', t.path)
  const softSub = subtitleMode === 'soft' && !!srtPath
  let srtIdx = -1
  if (softSub) {
    args.push('-i', srtPath as string)
    srtIdx = clips.length + tracks.length
  }

  // 视频归一化 + 拼接（音频另行分层混音，故 concat a=0）
  const parts: string[] = []
  const labels: string[] = []
  for (let i = 0; i < clips.length; i++) {
    parts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`
    )
    labels.push(`[v${i}]`)
  }
  // P2-10 转场：none=concat 硬切；xfade=镜间交叉淡化级联；fade=整片淡入淡出
  const transition: FilmTransition = o.transition ?? 'none'
  const durs = o.clipDurations && o.clipDurations.length === clips.length ? o.clipDurations : null
  const d = clampTransitionDur(o.transitionDur, durs)
  let filter: string
  let vmap: string
  if (clips.length === 1) {
    filter = parts[0]
    vmap = labels[0]
  } else if (transition === 'xfade' && durs) {
    // xfade 级联：offset = 前序交叠后净长 - d；总长 = Σdur - (N-1)*d
    const xparts: string[] = []
    let prev = labels[0]
    let cum = durs[0]
    for (let i = 1; i < clips.length; i++) {
      const off = Math.max(0, cum - d)
      const out = i === clips.length - 1 ? '[vx]' : `[xf${i}]`
      xparts.push(`${prev}${labels[i]}xfade=transition=fade:duration=${d.toFixed(3)}:offset=${off.toFixed(3)}${out}`)
      cum = cum + durs[i] - d
      prev = out
    }
    filter = `${parts.join(';')};${xparts.join(';')}`
    vmap = '[vx]'
  } else {
    filter = `${parts.join(';')};${labels.join('')}concat=n=${clips.length}:v=1:a=0[vcat]`
    vmap = '[vcat]'
  }
  // 整片淡入淡出（fade 模式）：在拼好的视频上淡入/淡出黑场
  if (transition === 'fade') {
    const total = durs ? durs.reduce((a, b) => a + b, 0) : o.totalSec || 0
    if (total > 2 * d) {
      filter += `;${vmap}fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${(total - d).toFixed(3)}:d=${d.toFixed(3)}[vfade]`
      vmap = '[vfade]'
    }
  }
  if (subtitleMode === 'burn' && srtPath) {
    filter += `;${vmap}subtitles='${escapeSubPath(srtPath)}'[vout]`
    vmap = '[vout]'
  }

  // M18-D：多轨音频 —— 对白(dialogue)顺序拼成总线(key)，music/sfx 混成被压总线，
  // 二者并存时用 sidechaincompress 以对白侧链压低 BGM；最后 apad 到视频长（配 -shortest）。
  const dlgIdxs: number[] = []
  const musIdxs: number[] = []
  tracks.forEach((t, i) => {
    const idx = clips.length + i
    if (t.role === 'dialogue') dlgIdxs.push(idx)
    else musIdxs.push(idx)
  })
  const aFilters: string[] = []
  if (dlgIdxs.length) {
    // 对白逐行按序拼接（无重叠），形成连续对白轨
    if (dlgIdxs.length === 1) aFilters.push(`[${dlgIdxs[0]}:a]aresample=async=1[dlg]`)
    else aFilters.push(`${dlgIdxs.map((i) => `[${i}:a]`).join('')}concat=n=${dlgIdxs.length}:v=0:a=1[dlg]`)
  }
  if (musIdxs.length) {
    if (musIdxs.length === 1) aFilters.push(`[${musIdxs[0]}:a]aresample=async=1[mus]`)
    else aFilters.push(`${musIdxs.map((i) => `[${i}:a]`).join('')}amix=inputs=${musIdxs.length}:duration=longest[mus]`)
  }
  let amap = ''
  if (dlgIdxs.length && musIdxs.length) {
    if (ducking) {
      aFilters.push(`[dlg]asplit=2[dlgkey][dlgsc]`)
      aFilters.push(`[mus][dlgsc]sidechaincompress=threshold=0.03:ratio=4:attack=200:release=1000[musd]`)
      aFilters.push(`[dlgkey][musd]amix=inputs=2:duration=first:dropout_transition=0[amix]`)
    } else {
      aFilters.push(`[dlg][mus]amix=inputs=2:duration=first:dropout_transition=0[amix]`)
    }
    aFilters.push(`[amix]apad[aout]`)
    amap = '[aout]'
  } else if (dlgIdxs.length) {
    aFilters.push(`[dlg]apad[aout]`)
    amap = '[aout]'
  } else if (musIdxs.length) {
    aFilters.push(`[mus]apad[aout]`)
    amap = '[aout]'
  }
  // 片段自带音频（工作流成片）：无外部音轨且开启 keepClipAudio 时，把各片段音频按序拼成成片音轨
  if (!amap && o.keepClipAudio && clips.length) {
    if (clips.length === 1) aFilters.push(`[0:a]aresample=async=1[acat]`)
    else aFilters.push(`${clips.map((_, i) => `[${i}:a]`).join('')}concat=n=${clips.length}:v=0:a=1[acat]`)
    aFilters.push(`[acat]apad[aout]`) // 补静音到视频长，配 -shortest 截到视频结尾，避免音轨略短致提前截断
    amap = '[aout]'
  }
  if (aFilters.length) filter += `;${aFilters.join(';')}`

  args.push('-filter_complex', filter, '-map', vmap)
  if (amap) args.push('-map', amap)
  if (softSub) args.push('-map', `${srtIdx}:0`, '-c:s', 'mov_text')

  args.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(fps))
  if (amap) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest')
  args.push('-movflags', '+faststart', '-y', outPath)
  return args
}

/** 执行拼接合成；失败抛错。烧录字幕失败时由调用方决定是否回退。 */
export async function composeFilm(o: ComposeOptions): Promise<void> {
  const args = buildConcatArgs(o)
  const total = o.totalSec || 0
  const task = ff().run(args, (p) => {
    let percent: number | undefined
    if (typeof p.percent === 'number') percent = Math.round(p.percent)
    else if (total > 0 && p.time) {
      const sec = parseTime(p.time)
      if (sec != null) percent = Math.min(99, Math.round((sec / total) * 100))
    }
    o.onProgress?.({ percent, text: `合成中…${percent != null ? ` ${percent}%` : p.time ? ` ${p.time}` : ''}` })
  }) as FfmpegTaskLike
  currentTask = task
  try {
    await task.promise
  } finally {
    if (currentTask === task) currentTask = null
  }
}

/** 中断正在进行的 ffmpeg 任务 */
export function abortFfmpeg(): void {
  const t = currentTask
  if (!t) return
  try {
    t.kill()
  } catch {
    try {
      t.quit?.()
    } catch {
      // 忽略
    }
  }
  currentTask = null
}

function parseTime(t: string): number | null {
  // HH:MM:SS.xx
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * 读取本地视频的真实时长（秒）。宿主只暴露 ffmpeg.run（无独立 ffprobe），
 * 故用 `-f null -` 解码一遍，取进度回调里最后一次 time≈总时长。失败返回 undefined。
 * 调用方需自行保证 ffmpeg 已就绪（compose 路径已 ensureFfmpeg；其余处先 ffmpegAvailable 再调）。
 */
export async function probeDuration(localPath: string): Promise<number | undefined> {
  try {
    let dur: number | undefined
    const task = ff().run(['-i', localPath, '-f', 'null', '-'], (p) => {
      if (p.time) {
        const s = parseTime(p.time)
        if (s != null) dur = s
      }
    }) as FfmpegTaskLike
    await task.promise.catch(() => {})
    return dur
  } catch {
    return undefined
  }
}

/**
 * 抽取本地视频的最后一帧为 dataURL（片段接龙：上一片段真实尾帧 → 下一片段首帧，保证无缝衔接，
 * 即便供应商不支持首尾帧约束也能接得上）。走宿主 ffmpeg：-sseof -1 定位到末尾约 1s，
 * -update 1 逐帧覆写同一文件 → 最终留下的就是最后一帧。best-effort，失败返回 undefined。
 * 调用方需先确保 ffmpeg 就绪（ffmpegAvailable）。
 */
export async function extractLastFrame(videoLocalPath: string, tag = ''): Promise<string | undefined> {
  try {
    if (!videoLocalPath) return undefined
    const dir = await ensureSubdir('frames')
    const out = `${dir}/last_${tag}_${Date.now()}.jpg`.replace(/\\/g, '/')
    const task = ff().run(['-y', '-sseof', '-1', '-i', videoLocalPath, '-update', '1', '-q:v', '2', out], () => {}) as FfmpegTaskLike
    await task.promise
    return await readAsDataUrl(out, 'image/jpeg')
  } catch {
    return undefined
  }
}

/**
 * 把一张静图按 Ken-Burns 预设生成一段运动视频片段（落盘 mp4，返回路径）。
 * 给「有关键帧无视频」的分镜做运动兜底——替代直接丢弃。调用方需先确保 ffmpeg 就绪。
 * ⚠ zoompan 视觉效果需在 Mulby 内实跑校验。
 */
export async function imageToMotionClip(
  imagePath: string,
  preset: KenBurnsPreset,
  opts: { durationSec: number; fps?: number; width: number; height: number; onProgress?: (i: FfmpegProgressInfo) => void }
): Promise<string> {
  const dir = await ensureSubdir('kenburns')
  const outPath = `${dir}/kb_${preset}_${Date.now()}.mp4`.replace(/\\/g, '/')
  const args = buildKenBurnsArgs(imagePath, preset, {
    durationSec: opts.durationSec, fps: opts.fps, width: opts.width, height: opts.height, outPath,
  })
  const task = ff().run(args, (p) => {
    const percent = typeof p.percent === 'number' ? Math.round(p.percent) : undefined
    opts.onProgress?.({ percent, text: 'Ken-Burns 运动生成中…' })
  }) as FfmpegTaskLike
  currentTask = task
  try {
    await task.promise
  } finally {
    if (currentTask === task) currentTask = null
  }
  return outPath
}

/** 解析 "1280x720" → [w,h] */
export function parseResolution(s: string, fallback: [number, number] = [1280, 720]): [number, number] {
  const m = /^(\d+)\s*[xX]\s*(\d+)$/.exec(String(s || '').trim())
  if (!m) return fallback
  return [Number(m[1]), Number(m[2])]
}
