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
