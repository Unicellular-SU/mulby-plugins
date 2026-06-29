/**
 * Toonflow 式重构 · 阶段2f：时间线 → ffmpeg 合成成片（复用现有 ffmpeg 服务）。
 * 按分镜顺序取每镜选用片段（无本地路径则下载落盘）→ composeFilm 拼接 → 输出到 exports/。
 */
import { ensureFfmpeg, composeFilm, probeDuration, imageToMotionClip } from '../../services/ffmpeg'
import { exportPath } from '../../services/fsutil'
import { downloadVideoToDisk } from '../../services/download'
import type { ProjectDoc } from '../../domain/types'
import { evaluateComposeGate, auditComposed } from '../../services/quality/composeGate'
import type { DeliveryPromiseKind } from '../../services/quality'
import { cameraMoveToKenBurns } from '../../services/kenBurns'

export interface ComposeOpts {
  /** 严格模式：质量闸门有应阻断项时中止合成（默认 false，仅经 onProgress 提醒） */
  enforceQualityGate?: boolean
  /** 显式交付承诺类型（缺省由项目意图推断） */
  promiseKind?: DeliveryPromiseKind
  /** 对「有关键帧无视频」的分镜用 Ken-Burns 生成运动片段（替代直接丢弃，默认 false） */
  kenBurnsForStills?: boolean
  /** 把分镜关键帧 assetId 解析为本地图片路径（kenBurnsForStills 时必需；由调用方注入资产解析） */
  resolveImagePath?: (assetId: string) => Promise<string | undefined>
}

function ratioWH(ratio: string): [number, number] {
  if (ratio === '9:16') return [720, 1280]
  if (ratio === '1:1') return [1024, 1024]
  return [1280, 720]
}

export async function composeProject(
  doc: ProjectDoc,
  onProgress?: (text: string, percent?: number) => void,
  opts?: ComposeOpts
): Promise<string> {
  // —— 质量闸门（渲染前）：对计划分镜评估幻灯片风险/结构同质/交付承诺，提醒或（严格模式）阻断 ——
  const gate = evaluateComposeGate(doc, { promiseKind: opts?.promiseKind })
  onProgress?.(gate.summary)
  for (const w of gate.warnings) onProgress?.(`提醒：${w}`)
  for (const b of gate.blocks) onProgress?.(`需修正：${b}`)
  if (opts?.enforceQualityGate && gate.blocked) {
    throw new Error(`质量闸门拦截合成（共 ${gate.blocks.length} 项）：\n- ${gate.blocks.join('\n- ')}`)
  }

  const [width, height] = ratioWH(doc.meta.videoRatio)
  // ffmpeg 提前就绪：Ken-Burns 兜底会在收集阶段调用 ffmpeg，故先确保可用
  onProgress?.('准备 ffmpeg…')
  const ok = await ensureFfmpeg((p) => onProgress?.(p.text, p.percent))
  if (!ok) throw new Error('ffmpeg 不可用（首次需下载）')

  const ordered = [...doc.storyboards].sort((a, b) => a.index - b.index)
  const clipPaths: string[] = []
  const fallbackDurs: number[] = []
  for (const sb of ordered) {
    const t = doc.track.find((x) => x.storyboardIds.includes(sb.id))
    const clip = t
      ? doc.clips.find((c) => c.id === (t.selectClipId || t.clipIds[0]))
      : doc.clips.find((c) => c.storyboardId === sb.id && c.state === 'done')
    let path = clip?.videoFilePath
    if (!path && clip?.videoUrl) {
      try {
        path = await downloadVideoToDisk(clip.videoUrl, `clip_${sb.id}`)
      } catch {
        // 下载失败则跳过该片段
      }
    }
    // Ken-Burns 兜底：无视频但有关键帧图 → 用静图按计划运镜生成运动片段（替代直接丢弃，呼应 #4 静默降级）
    if (!path && opts?.kenBurnsForStills && sb.keyframeImageId && opts.resolveImagePath) {
      try {
        const img = await opts.resolveImagePath(sb.keyframeImageId)
        if (img) {
          onProgress?.(`第 ${sb.index} 镜无视频，生成 Ken-Burns 运动片段…`)
          path = await imageToMotionClip(img, cameraMoveToKenBurns(sb.cameraMove), {
            durationSec: sb.duration || 4, fps: 24, width, height,
            onProgress: (p) => onProgress?.(p.text, p.percent),
          })
        }
      } catch {
        // 兜底失败则跳过该镜
      }
    }
    if (path) {
      clipPaths.push(path)
      fallbackDurs.push(clip?.durationSec || sb.duration || 5)
    }
  }
  if (clipPaths.length === 0) throw new Error('没有可合成的视频片段（请先给分镜生成视频）')

  // 用片段真实时长（而非请求时长）——否则成片整片淡出会按请求时长提前淡黑，导致结尾黑屏 + 音画不齐
  onProgress?.('读取片段时长…')
  const durations: number[] = []
  for (let i = 0; i < clipPaths.length; i++) {
    const real = await probeDuration(clipPaths[i])
    durations.push(real && real > 0.1 ? real : fallbackDurs[i])
  }

  const outPath = await exportPath(`${(doc.meta.name || 'film').replace(/\s+/g, '_')}_${Date.now()}.mp4`)
  const base = {
    clips: clipPaths,
    outPath,
    width,
    height,
    fps: 24,
    subtitleMode: 'off' as const,
    transition: doc.meta.transition ?? 'fade', // 整片转场（meta 可选 none/fade/xfade）
    clipDurations: durations,
    totalSec: durations.reduce((a, b) => a + b, 0),
    onProgress: (p: { percent?: number; text: string }) => onProgress?.(p.text, p.percent),
  }
  // 优先保留片段自带音频；若某片段无音轨致拼接失败，回退为无声成片（至少出片）
  try {
    await composeFilm({ ...base, keepClipAudio: true })
  } catch {
    onProgress?.('保留音轨失败，改为无声合成…')
    await composeFilm({ ...base, keepClipAudio: false })
  }

  // —— 渲染后审计：实际合成镜数 vs 计划镜数，识别静默降级 ——
  onProgress?.(auditComposed(doc, clipPaths.length, gate.promiseKind).message)
  return outPath
}
