import { mediaPath, ensureSubDir, toFileUrl } from './media'

function ff(): any {
  return (window as any).mulby.ffmpeg
}
function notify(msg: string, type?: string) {
  ;(window as any).mulby?.notification?.show?.(msg, type)
}
function readdir(dir: string): Promise<string[]> {
  return (window as any).mulby.filesystem.readdir(dir) as Promise<string[]>
}

export { toFileUrl }

// 首次使用前确保 FFmpeg 就绪（未安装则下载）
export async function ensureFfmpeg(): Promise<boolean> {
  try {
    if (await ff().isAvailable()) return true
    notify('首次使用：正在下载 FFmpeg，请稍候…')
    const r = await ff().download(() => {})
    if (r?.success) {
      notify('FFmpeg 已就绪', 'success')
      return true
    }
    notify('FFmpeg 下载失败：' + (r?.error || ''), 'error')
    return false
  } catch (e: any) {
    notify('FFmpeg 不可用：' + (e?.message || String(e)), 'error')
    return false
  }
}

async function runFf(args: string[], onProgress?: (p: number) => void): Promise<void> {
  const task = ff().run(args, (pr: any) => {
    if (onProgress && typeof pr?.percent === 'number') onProgress(Math.min(1, pr.percent / 100))
  })
  await task.promise
}

export async function clip(projectId: string, inPath: string, start: number, end: number): Promise<string> {
  const dur = Math.max(0.1, end - start)
  const out = await mediaPath(projectId, 'clip', 'mp4')
  await runFf([
    '-i', inPath,
    '-ss', String(start),
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac',
    '-movflags', '+faststart',
    out
  ])
  return out
}

export async function toGif(projectId: string, inPath: string): Promise<string> {
  const out = await mediaPath(projectId, 'clip', 'gif')
  await runFf([
    '-i', inPath,
    '-vf', 'fps=12,scale=360:-1:flags=lanczos,split[s0][s1];[s0]palettegen=[p];[s1][p]paletteuse',
    '-loop', '0',
    out
  ])
  return out
}

export async function extractFrames(projectId: string, inPath: string, fps = 1, max = 24): Promise<string[]> {
  const dir = await ensureSubDir(projectId, `frames_${Date.now()}`)
  await runFf(['-i', inPath, '-vf', `fps=${fps}`, '-frames:v', String(max), `${dir}/frame_%04d.png`])
  const files = await readdir(dir)
  return files.filter((f) => f.endsWith('.png')).sort().map((f) => `${dir}/${f}`)
}

// 场景检测：输出每个镜头切点的代表帧（无需解析 stderr）
export async function sceneFrames(projectId: string, inPath: string, threshold = 0.4, max = 24): Promise<string[]> {
  const dir = await ensureSubDir(projectId, `scenes_${Date.now()}`)
  await runFf([
    '-i', inPath,
    '-vf', `select='gt(scene\\,${threshold})'`,
    '-vsync', 'vfr',
    '-frames:v', String(max),
    `${dir}/scene_%03d.png`
  ])
  const files = await readdir(dir)
  return files.filter((f) => f.endsWith('.png')).sort().map((f) => `${dir}/${f}`)
}

export async function splitAudio(projectId: string, inPath: string): Promise<string> {
  const out = await mediaPath(projectId, 'audio', 'mp3')
  await runFf(['-i', inPath, '-vn', '-map', 'a:0?', '-c:a', 'libmp3lame', '-q:a', '2', out])
  return out
}

export async function stripAudio(projectId: string, inPath: string): Promise<string> {
  const out = await mediaPath(projectId, 'mute', 'mp4')
  await runFf(['-i', inPath, '-an', '-c:v', 'copy', out])
  return out
}

export async function reverse(projectId: string, inPath: string): Promise<string> {
  const out = await mediaPath(projectId, 'reverse', 'mp4')
  await runFf(['-i', inPath, '-vf', 'reverse', '-af', 'areverse', out])
  return out
}

export async function compress(projectId: string, inPath: string): Promise<string> {
  const out = await mediaPath(projectId, 'compress', 'mp4')
  await runFf([
    '-i', inPath,
    '-c:v', 'libx264', '-crf', '28', '-preset', 'fast', '-movflags', '+faststart',
    '-c:a', 'aac',
    out
  ])
  return out
}

// ============ 成片合成（多视频片段 → 一条成片） ============

export type FilmTransition = 'none' | 'xfade' | 'fade'

export interface ComposeOptions {
  clips: string[] // 本地片段路径（按时间线顺序）
  audioPath?: string // 可选：背景音（混在原声之上）
  useClipAudio?: boolean // 是否保留各片段原声（默认 true）
  width: number
  height: number
  fps: number
  transition: FilmTransition
  transitionDur?: number
  onProgress?: (p: number) => void
}

function parseTime(t: string): number | null {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

// 宿主仅暴露 ffmpeg.run（无 ffprobe）：用 -f null 解码一遍取末次 time≈时长
export async function probeDuration(localPath: string): Promise<number | undefined> {
  try {
    let dur: number | undefined
    const task = ff().run(['-i', localPath, '-f', 'null', '-'], (p: any) => {
      if (p?.time) {
        const s = parseTime(p.time)
        if (s != null) dur = s
      }
    })
    await task.promise
    return dur
  } catch {
    return undefined
  }
}

function buildComposeArgs(o: ComposeOptions & { clipDurations?: number[]; totalSec?: number; outPath: string }): string[] {
  const { clips, audioPath, width, height, fps, outPath } = o
  const args: string[] = []
  for (const c of clips) args.push('-i', c)
  if (audioPath) args.push('-i', audioPath)

  // 视频归一化：scale+pad+setsar+fps（不同分辨率/帧率也能拼）
  const parts: string[] = []
  const labels: string[] = []
  for (let i = 0; i < clips.length; i++) {
    parts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p[v${i}]`
    )
    labels.push(`[v${i}]`)
  }

  const transition = o.transition ?? 'none'
  const durs = o.clipDurations && o.clipDurations.length === clips.length ? o.clipDurations : null
  const d = Math.max(0.2, Math.min(o.transitionDur ?? 0.5, (durs ? Math.min(...durs) : 5) * 0.4))
  let filter: string
  let vmap: string
  if (clips.length === 1) {
    filter = parts[0]
    vmap = labels[0]
  } else if (transition === 'xfade' && durs) {
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
  if (transition === 'fade') {
    const total = durs ? durs.reduce((a, b) => a + b, 0) : o.totalSec || 0
    if (total > 2 * d) {
      filter += `;${vmap}fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${(total - d).toFixed(3)}:d=${d.toFixed(3)}[vf]`
      vmap = '[vf]'
    }
  }
  // 音频：默认保留各片段原声（归一化后 concat / 交叉淡化），可叠加背景音
  const useClip = o.useClipAudio !== false
  const aParts: string[] = []
  let amap = ''
  if (useClip) {
    for (let i = 0; i < clips.length; i++) {
      aParts.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`)
    }
    let aclips: string
    if (clips.length === 1) {
      aclips = '[a0]'
    } else if (transition === 'xfade' && durs) {
      let prev = '[a0]'
      for (let i = 1; i < clips.length; i++) {
        const out = i === clips.length - 1 ? '[aclips]' : `[acf${i}]`
        aParts.push(`${prev}[a${i}]acrossfade=d=${d.toFixed(3)}${out}`)
        prev = out
      }
      aclips = '[aclips]'
    } else {
      aParts.push(`${clips.map((_, i) => `[a${i}]`).join('')}concat=n=${clips.length}:v=0:a=1[aclips]`)
      aclips = '[aclips]'
    }
    if (audioPath) {
      aParts.push(`[${clips.length}:a]apad[bgmp]`)
      aParts.push(`${aclips}[bgmp]amix=inputs=2:duration=first:dropout_transition=0[aout]`)
      amap = '[aout]'
    } else {
      amap = aclips
    }
  } else if (audioPath) {
    aParts.push(`[${clips.length}:a]apad[aout]`)
    amap = '[aout]'
  }
  if (aParts.length) filter += ';' + aParts.join(';')

  args.push('-filter_complex', filter, '-map', vmap)
  if (amap) args.push('-map', amap)
  args.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(fps))
  if (amap) {
    args.push('-c:a', 'aac', '-b:a', '192k')
    if (audioPath) args.push('-shortest') // 背景音已 apad 到无限长，按视频收尾
  }
  args.push('-movflags', '+faststart', '-y', outPath)
  return args
}

export async function composeFilm(projectId: string, o: ComposeOptions): Promise<string> {
  const out = await mediaPath(projectId, 'film', 'mp4')
  let clipDurations: number[] | undefined
  if (o.transition === 'xfade' || o.transition === 'fade') {
    clipDurations = []
    for (const c of o.clips) clipDurations.push((await probeDuration(c)) || 5)
  }
  const totalSec = clipDurations?.reduce((a, b) => a + b, 0)
  const useClipAudio = o.useClipAudio !== false
  try {
    const args = buildComposeArgs({ ...o, useClipAudio, clipDurations, totalSec, outPath: out })
    await runFf(args, o.onProgress)
  } catch (e) {
    if (useClipAudio) {
      // 个别片段无音轨导致失败 → 退回不取原声（仅背景音或静音）
      notify('部分片段无音轨，已改为' + (o.audioPath ? '仅背景音' : '静音') + '合成', 'warning')
      const args2 = buildComposeArgs({ ...o, useClipAudio: false, clipDurations, totalSec, outPath: out })
      await runFf(args2, o.onProgress)
    } else {
      throw e
    }
  }
  return out
}
