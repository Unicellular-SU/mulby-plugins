/**
 * Toonflow 式重构 · 阶段2f：时间线 → ffmpeg 合成成片（复用现有 ffmpeg 服务）。
 * 按分镜顺序取每镜选用片段（无本地路径则下载落盘）→ composeFilm 拼接 → 输出到 exports/。
 */
import { ensureFfmpeg, composeFilm } from '../../services/ffmpeg'
import { exportPath } from '../../services/fsutil'
import { downloadVideoToDisk } from '../../services/download'
import type { ProjectDoc } from '../../domain/types'

function ratioWH(ratio: string): [number, number] {
  if (ratio === '9:16') return [720, 1280]
  if (ratio === '1:1') return [1024, 1024]
  return [1280, 720]
}

export async function composeProject(doc: ProjectDoc, onProgress?: (text: string, percent?: number) => void): Promise<string> {
  const ordered = [...doc.storyboards].sort((a, b) => a.index - b.index)
  const clipPaths: string[] = []
  const durations: number[] = []
  for (const sb of ordered) {
    const t = doc.track.find((x) => x.storyboardId === sb.id)
    const clip = t
      ? doc.clips.find((c) => c.id === (t.selectClipId || t.clipIds[0]))
      : doc.clips.find((c) => c.storyboardId === sb.id && c.state === 'done')
    if (!clip) continue
    let path = clip.videoFilePath
    if (!path && clip.videoUrl) {
      try {
        path = await downloadVideoToDisk(clip.videoUrl, `clip_${sb.id}`)
      } catch {
        // 下载失败则跳过该片段
      }
    }
    if (path) {
      clipPaths.push(path)
      durations.push(clip.durationSec || sb.duration || 5)
    }
  }
  if (clipPaths.length === 0) throw new Error('没有可合成的视频片段（请先给分镜生成视频）')

  onProgress?.('准备 ffmpeg…')
  const ok = await ensureFfmpeg((p) => onProgress?.(p.text, p.percent))
  if (!ok) throw new Error('ffmpeg 不可用（首次需下载）')

  const [width, height] = ratioWH(doc.meta.videoRatio)
  const outPath = await exportPath(`${(doc.meta.name || 'film').replace(/\s+/g, '_')}_${Date.now()}.mp4`)
  await composeFilm({
    clips: clipPaths,
    outPath,
    width,
    height,
    fps: 24,
    subtitleMode: 'off',
    transition: 'fade', // 整片淡入淡出，片间干净硬切（与连贯性策略一致）
    clipDurations: durations,
    totalSec: durations.reduce((a, b) => a + b, 0),
    onProgress: (p) => onProgress?.(p.text, p.percent),
  })
  return outPath
}
