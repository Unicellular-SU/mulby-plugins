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

export type SubtitleMode = 'off' | 'soft' | 'burn'

export interface ComposeOptions {
  clips: string[] // 本地片段路径（按时间线顺序）
  outPath: string
  width: number
  height: number
  fps: number
  audioPath?: string // 可选：配音/音乐
  srtPath?: string // 可选：字幕文件
  subtitleMode: SubtitleMode
  totalSec?: number // 可选：预计成片总时长（用于进度估算）
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

/** ffmpeg subtitles 滤镜路径转义（跨平台：盘符冒号、反斜杠、单引号） */
function escapeSubPath(p: string): string {
  let s = p.replace(/\\/g, '/')
  s = s.replace(/:/g, '\\:')
  s = s.replace(/'/g, "\\'")
  return s
}

/** 构造拼接命令参数 */
export function buildConcatArgs(o: ComposeOptions): string[] {
  const { clips, outPath, width, height, fps, audioPath, srtPath, subtitleMode } = o
  const args: string[] = []
  for (const c of clips) args.push('-i', c)

  let audioIdx = -1
  let srtIdx = -1
  if (audioPath) {
    args.push('-i', audioPath)
    audioIdx = clips.length
  }
  const softSub = subtitleMode === 'soft' && !!srtPath
  if (softSub) {
    args.push('-i', srtPath as string)
    srtIdx = clips.length + (audioPath ? 1 : 0)
  }

  // 视频归一化 + 拼接
  const parts: string[] = []
  const labels: string[] = []
  for (let i = 0; i < clips.length; i++) {
    parts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`
    )
    labels.push(`[v${i}]`)
  }
  let filter = `${parts.join(';')};${labels.join('')}concat=n=${clips.length}:v=1:a=0[vcat]`
  let vmap = '[vcat]'
  if (subtitleMode === 'burn' && srtPath) {
    filter += `;[vcat]subtitles='${escapeSubPath(srtPath)}'[vout]`
    vmap = '[vout]'
  }
  // 配音补静音到与视频等长（-shortest 截到视频结束）
  if (audioIdx >= 0) {
    filter += `;[${audioIdx}:a]apad[aout]`
  }

  args.push('-filter_complex', filter, '-map', vmap)
  if (audioIdx >= 0) args.push('-map', '[aout]')
  if (softSub) args.push('-map', `${srtIdx}:0`, '-c:s', 'mov_text')

  args.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(fps))
  if (audioIdx >= 0) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest')
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

/** 解析 "1280x720" → [w,h] */
export function parseResolution(s: string, fallback: [number, number] = [1280, 720]): [number, number] {
  const m = /^(\d+)\s*[xX]\s*(\d+)$/.exec(String(s || '').trim())
  if (!m) return fallback
  return [Number(m[1]), Number(m[2])]
}
