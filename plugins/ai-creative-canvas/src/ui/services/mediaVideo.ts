import { mediaPath, ensureSubDir, toFileUrl } from './media'
import { base64ToArrayBuffer } from '../util'

function ff() {
  return window.mulby.ffmpeg
}
import { toast, toastSticky, toastUpdate, toastDismiss, type ToastType } from '../store/toastStore'
function notify(msg: string, type?: string) {
  toast(msg, (type as ToastType) || 'info')
}
function readdir(dir: string): Promise<string[]> {
  return window.mulby.filesystem.readdir(dir) as Promise<string[]>
}

export { toFileUrl }

// 首次使用前确保 FFmpeg 就绪（未安装则下载）
export async function ensureFfmpeg(): Promise<boolean> {
  try {
    if (await ff().isAvailable()) return true
    // 首次下载（几十 MB）用常驻进度 toast 实时反映百分比，避免用户以为卡死而反复点击
    const tid = toastSticky('首次使用：正在下载 FFmpeg…', 'info')
    try {
      const r = await ff().download((pr: any) => {
        const pct = typeof pr?.percent === 'number' ? Math.max(0, Math.min(100, Math.round(pr.percent))) : null
        const phase = pr?.phase === 'extracting' ? '解压' : pr?.phase === 'done' ? '完成' : '下载'
        toastUpdate(tid, pct != null ? `FFmpeg ${phase}中 ${pct}%` : `FFmpeg ${phase}中…`)
      })
      if (r?.success) {
        toastUpdate(tid, 'FFmpeg 已就绪', 'success')
        setTimeout(() => toastDismiss(tid), 1500) // 终态短暂展示后关闭
        return true
      }
      toastUpdate(tid, 'FFmpeg 下载失败：' + (r?.error || ''), 'error')
      setTimeout(() => toastDismiss(tid), 4700)
      return false
    } catch (e) {
      toastDismiss(tid)
      throw e
    }
  } catch (e: any) {
    notify('FFmpeg 不可用：' + (e?.message || String(e)), 'error')
    return false
  }
}

async function runFf(args: string[], onProgress?: (p: number) => void, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('已取消', 'AbortError')
  const task = ff().run(args, (pr: any) => {
    if (onProgress && typeof pr?.percent === 'number') onProgress(Math.min(1, pr.percent / 100))
  })
  const onAbort = () => {
    try {
      task.kill()
    } catch {
      /* already done */
    }
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await task.promise
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

export { runFf }

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

// 截取某一时刻的单帧 → PNG（用于卡内「截帧」）
export async function frameAt(projectId: string, inPath: string, atSec: number): Promise<string> {
  const out = await mediaPath(projectId, 'frame', 'png')
  await runFf(['-ss', String(Math.max(0, atSec)), '-i', inPath, '-frames:v', '1', '-q:v', '2', out])
  return out
}

// 视频封面：抽首帧 → 缩为小 webp，供视频卡默认展示（免挂 <video> 强制解码/耗解码器）。
// 仅在 ffmpeg 已就绪时生成——避免仅为封面触发 FFmpeg 下载；未就绪返回 null（卡片回退占位/播放时再挂 video）。
export async function makeVideoPoster(projectId: string, cardId: string, localPath: string): Promise<{ path: string; url: string } | null> {
  try {
    if (!(await ff().isAvailable())) return null
    const frame = await frameAt(projectId, localPath, 0)
    const { makeThumbnail } = await import('./mediaImage') // 动态导入避免与 mediaImage 的潜在环
    const thumb = await makeThumbnail(projectId, `${cardId}_poster`, frame, 640)
    if (thumb) {
      try { await window.mulby?.filesystem?.unlink(frame) } catch { /* ignore */ }
      return thumb
    }
    return { path: frame, url: toFileUrl(frame) } // 帧本身已够小，直接用
  } catch {
    return null
  }
}

// 时间轴缩略图：沿全片均匀抽 count 张小图（裁剪时间轴用）
export async function timelineThumbs(projectId: string, inPath: string, count = 12): Promise<{ thumbs: string[]; duration: number }> {
  const duration = (await probeDuration(inPath)) || 0
  const dir = await ensureSubDir(projectId, `tl_${Date.now()}`)
  const fpsExpr = duration > 0 ? `${count}/${duration}` : '1'
  await runFf(['-i', inPath, '-vf', `fps=${fpsExpr},scale=160:-1:flags=fast_bilinear`, '-frames:v', String(count), `${dir}/tl_%03d.png`])
  const files = await readdir(dir)
  return { thumbs: files.filter((f) => f.endsWith('.png')).sort().map((f) => `${dir}/${f}`), duration }
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

// 多轨时间线导出：先按 in/out 预剪每段（复用 clip），再走 composeFilm 拼接/转场/混音
export async function composeTimeline(
  projectId: string,
  o: {
    clips: { path: string; inSec: number; outSec: number; dur: number }[]
    audioTracks?: AudioTrack[]
    transitionDurs?: number[]
    width: number
    height: number
    fps: number
    transition: FilmTransition
    useClipAudio: boolean
    onProgress?: (p: number) => void
  }
): Promise<string> {
  const trimmed: string[] = []
  for (let i = 0; i < o.clips.length; i++) {
    const c = o.clips[i]
    const needTrim = c.inSec > 0.05 || c.outSec < c.dur - 0.05
    trimmed.push(needTrim ? await clip(projectId, c.path, c.inSec, c.outSec) : c.path)
    o.onProgress?.((i / Math.max(1, o.clips.length)) * 0.5) // 前半进度=预剪
  }
  return composeFilm(projectId, {
    clips: trimmed,
    audioTracks: o.audioTracks,
    transitionDurs: o.transitionDurs,
    width: o.width,
    height: o.height,
    fps: o.fps,
    transition: o.transition,
    useClipAudio: o.useClipAudio,
    onProgress: (p) => o.onProgress?.(0.5 + p * 0.5) // 后半=合成
  })
}

// 绿幕抠像：去掉 color 色键。优先输出带透明通道的 webm(vp9)；无 vp9/alpha 支持则退化为合成到背景色 mp4。
export async function chromakey(
  projectId: string,
  inPath: string,
  opts?: { color?: string; similarity?: number; blend?: number; bgColor?: string }
): Promise<{ path: string; mime: string }> {
  const color = opts?.color || '0x00FF00'
  const sim = opts?.similarity ?? 0.1
  const blend = opts?.blend ?? 0.12
  try {
    const out = await mediaPath(projectId, 'chromakey', 'webm')
    await runFf(['-i', inPath, '-vf', `chromakey=${color}:${sim}:${blend},format=yuva420p`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', out])
    return { path: out, mime: 'video/webm' }
  } catch {
    notify('当前 FFmpeg 不支持透明 webm，已退化为合成到背景色', 'warning')
    const bg = opts?.bgColor || '0x000000'
    const out2 = await mediaPath(projectId, 'chromakey', 'mp4')
    await runFf([
      '-i', inPath,
      '-filter_complex',
      `[0:v]chromakey=${color}:${sim}:${blend}[ck];color=c=${bg}:s=2x2[bgc];[bgc][ck]scale2ref[bg][ck2];[bg][ck2]overlay=shortest=1,format=yuv420p[v]`,
      '-map', '[v]',
      '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-movflags', '+faststart',
      out2
    ])
    return { path: out2, mime: 'video/mp4' }
  }
}

// ============ 成片合成（多视频片段 → 一条成片） ============

export type FilmTransition = 'none' | 'xfade' | 'fade'

export interface AudioTrack {
  path: string
  volume?: number // 增益（1=原始）
  offset?: number // 入点延迟（秒）
}

export interface ComposeOptions {
  clips: string[] // 本地片段路径（按时间线顺序）
  audioPath?: string // 兼容旧用法：单条背景音（混在原声之上）
  audioTracks?: AudioTrack[] // v2：多音轨（各带 volume/offset），与 audioPath 二选一
  useClipAudio?: boolean // 是否保留各片段原声（默认 true）
  width: number
  height: number
  fps: number
  transition: FilmTransition
  transitionDur?: number // 全局默认转场时长
  transitionDurs?: number[] // v2：每个相邻间隔的转场时长（长度 = clips.length-1，xfade 时生效）
  onProgress?: (p: number) => void
}

function parseTime(t: string): number | null {
  const m = /(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

// 宿主仅暴露 ffmpeg.run（无 ffprobe）：用 -f null 解码一遍取末次 time≈时长
export async function probeDuration(localPath: string, signal?: AbortSignal): Promise<number | undefined> {
  try {
    if (signal?.aborted) return undefined
    let dur: number | undefined
    const task = ff().run(['-i', localPath, '-f', 'null', '-'], (p: any) => {
      if (p?.time) {
        const s = parseTime(p.time)
        if (s != null) dur = s
      }
    })
    const onAbort = () => {
      try {
        task.kill()
      } catch {
        /* already done */
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await task.promise
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
    return dur
  } catch {
    return undefined
  }
}

// 探测视频真实分辨率（宿主无 ffprobe）：抽首帧 PNG → sharp metadata 读宽高。
// 用途：浏览器 <video> 无法解码（如 HEVC）时 onLoadedMetadata 不触发/videoWidth=0、baseW 恒为占位 16，
// 导致导出的文字/边框/PiP 叠加 PNG 全按 16px 渲染缩成几像素。此路由绕开浏览器解码，直接用 ffmpeg+sharp。
export async function probeResolution(
  projectId: string,
  localPath: string,
  signal?: AbortSignal
): Promise<{ width: number; height: number } | undefined> {
  let framePath: string | undefined
  try {
    if (signal?.aborted) return undefined
    framePath = await frameAt(projectId, localPath, 0)
    if (signal?.aborted) return undefined
    const fsAny = window.mulby?.filesystem
    const b64 = (await fsAny.readFile(framePath, 'base64')) as string
    const meta = await window.mulby.sharp(base64ToArrayBuffer(b64)).metadata()
    const w = Number(meta?.width) || 0
    const h = Number(meta?.height) || 0
    return w > 0 && h > 0 ? { width: w, height: h } : undefined
  } catch {
    return undefined
  } finally {
    if (framePath) {
      try {
        await window.mulby?.filesystem?.unlink(framePath)
      } catch {
        /* ignore */
      }
    }
  }
}

function buildComposeArgs(o: ComposeOptions & { clipDurations?: number[]; totalSec?: number; outPath: string }): string[] {
  const { clips, width, height, fps, outPath } = o
  // 多音轨：优先 audioTracks；否则兼容旧 audioPath（单条）
  const tracks: AudioTrack[] = o.audioTracks?.length ? o.audioTracks : o.audioPath ? [{ path: o.audioPath, volume: 1, offset: 0 }] : []
  const args: string[] = []
  for (const c of clips) args.push('-i', c)
  for (const t of tracks) args.push('-i', t.path)

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
  const defD = o.transitionDur ?? 0.5
  // 每个相邻间隔的转场时长（gap i 在 clip i 与 i+1 之间；i 从 1 计 = clip i-1↔i）
  const gapD = (i: number) => {
    const base = o.transitionDurs?.[i - 1] ?? defD
    const cap = durs ? Math.min(durs[i - 1], durs[i]) * 0.4 : 2
    return Math.max(0.2, Math.min(base, cap))
  }
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
      const d = gapD(i)
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
    // 整片淡入淡出与 xfade 互斥（fade 仅在 concat 路径，视频长=Σdurs，故 total 正确）
    const total = durs ? durs.reduce((a, b) => a + b, 0) : o.totalSec || 0
    const d = Math.max(0.2, Math.min(defD, total * 0.4))
    if (total > 2 * d) {
      filter += `;${vmap}fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${(total - d).toFixed(3)}:d=${d.toFixed(3)}[vf]`
      vmap = '[vf]'
    }
  }

  // 音频：clip 原声(可选，concat/交叉淡化) + 多背景轨(各 adelay/volume) → amix
  const useClip = o.useClipAudio !== false
  const aParts: string[] = []
  const sources: string[] = []
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
        aParts.push(`${prev}[a${i}]acrossfade=d=${gapD(i).toFixed(3)}${out}`)
        prev = out
      }
      aclips = '[aclips]'
    } else {
      aParts.push(`${clips.map((_, i) => `[a${i}]`).join('')}concat=n=${clips.length}:v=0:a=1[aclips]`)
      aclips = '[aclips]'
    }
    sources.push(aclips)
  }
  tracks.forEach((t, j) => {
    const idx = clips.length + j
    const ms = Math.max(0, Math.round((t.offset || 0) * 1000))
    const vol = t.volume ?? 1
    aParts.push(`[${idx}:a]adelay=${ms}|${ms},volume=${vol.toFixed(2)}[bg${j}]`)
    sources.push(`[bg${j}]`)
  })
  const hasBg = tracks.length > 0
  let amap = ''
  if (sources.length === 1) {
    // 单一音源：背景轨需 apad，配合 -shortest 收到视频长（clip 原声本身=视频长，无需 apad）
    if (hasBg && !useClip) {
      aParts.push(`${sources[0]}apad[aout]`)
      amap = '[aout]'
    } else {
      amap = sources[0]
    }
  } else if (sources.length > 1) {
    // amix 默认按输入数归一化(每路 ×1/N) 防多源叠加削波；各轨增益已在上游 volume 调过。
    // 不做 ×N 预乘(会抵消归一化→响亮素材爆音)，也不依赖 normalize=0(旧版 ffmpeg 不支持)——与 v1 一致。
    aParts.push(`${sources.join('')}amix=inputs=${sources.length}:duration=longest:dropout_transition=0[amx]`)
    aParts.push(`[amx]apad[aout]`)
    amap = '[aout]'
  }
  if (aParts.length) filter += ';' + aParts.join(';')

  args.push('-filter_complex', filter, '-map', vmap)
  if (amap) args.push('-map', amap)
  args.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(fps))
  if (amap) {
    args.push('-c:a', 'aac', '-b:a', '192k')
    if (hasBg) args.push('-shortest') // 背景音已 apad 到无限长，按视频收尾
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
