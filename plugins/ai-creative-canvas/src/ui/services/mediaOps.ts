import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { createLimiter } from '../util'
import { saveBase64, toFileUrl } from './media'
import * as MI from './mediaImage'
import * as MV from './mediaVideo'

const limiter = createLimiter(2)

export type ImageTool = 'crop' | 'outpaint' | 'upscale' | 'removebg'

const TOOL_LABEL: Record<ImageTool, string> = {
  crop: '裁剪',
  outpaint: '扩图',
  upscale: '高清',
  removebg: '抠像'
}

export async function runImageTool(
  cardId: string,
  tool: ImageTool,
  opts?: { rect?: { left: number; top: number; width: number; height: number }; ratio?: number }
): Promise<void> {
  const g = useGraph.getState()
  const src = g.getActiveBoard().cards[cardId]
  if (!src) return
  if (!src.assetLocalPath && !src.assetUrl) {
    g.updateCard(cardId, { status: 'error', error: '该卡片没有图片' })
    return
  }
  const resultId = g.addCard(
    'image',
    { x: src.x + src.w + 200, y: src.y + src.h / 2 },
    { title: `${src.title} · ${TOOL_LABEL[tool]}`, status: 'running', progress: 0.2, modelId: src.modelId, refIds: [src.id] }
  )
  useTask.getState().inc()
  await limiter(async () => {
    try {
      let res
      if (tool === 'crop') {
        if (!opts?.rect) throw new Error('缺少裁剪区域')
        res = await MI.cropImage(src, opts.rect)
      } else if (tool === 'outpaint') {
        res = await MI.outpaintImage(src, opts?.ratio ?? 0.25)
      } else if (tool === 'upscale') {
        res = await MI.upscaleImage(src)
      } else {
        res = await MI.removeBackground(src)
      }
      const saved = await saveBase64(useGraph.getState().project.id, resultId, res.base64, 'png')
      useGraph.getState().updateCard(resultId, {
        status: 'done',
        progress: 1,
        assetUrl: saved.url,
        assetLocalPath: saved.path,
        mime: res.mime
      })
    } catch (e: any) {
      useGraph.getState().updateCard(resultId, { status: 'error', error: e?.message || String(e), progress: 0 })
    } finally {
      useTask.getState().dec()
    }
  })
}

export async function runGridSlice(cardId: string, rows: number, cols: number): Promise<void> {
  const g = useGraph.getState()
  const src = g.getActiveBoard().cards[cardId]
  if (!src) return
  if (!src.assetLocalPath && !src.assetUrl) {
    g.updateCard(cardId, { status: 'error', error: '该卡片没有图片' })
    return
  }
  useTask.getState().inc()
  await limiter(async () => {
    try {
      const cells = await MI.gridSlice(src, rows, cols)
      const cellW = 150
      const cellH = 160
      const baseX = src.x + src.w + 200
      const baseY = src.y + cellH / 2
      let idx = 0
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = cells[idx++]
          if (!cell) continue
          const center = { x: baseX + c * (cellW + 16) + cellW / 2, y: baseY + r * (cellH + 16) }
          const id = useGraph.getState().addCard('source', center, {
            title: `${src.title} 宫格 ${r + 1}-${c + 1}`,
            status: 'done',
            refIds: [src.id],
            w: cellW,
            h: cellH
          })
          const saved = await saveBase64(useGraph.getState().project.id, id, cell.base64, 'png')
          useGraph.getState().updateCard(id, { assetUrl: saved.url, assetLocalPath: saved.path, mime: cell.mime })
        }
      }
    } catch (e: any) {
      const n = (window as any).mulby?.notification
      n?.show?.('宫格切分失败：' + (e?.message || String(e)), 'error')
    } finally {
      useTask.getState().dec()
    }
  })
}

// ---- 视频工具 ----

export type VideoTool = 'clip' | 'gif' | 'frames' | 'scenes' | 'splitAudio' | 'mute' | 'reverse' | 'compress'

const VTOOL_LABEL: Record<VideoTool, string> = {
  clip: '裁剪',
  gif: 'GIF',
  frames: '抽帧',
  scenes: '镜头',
  splitAudio: '音轨',
  mute: '去音轨',
  reverse: '倒放',
  compress: '压制'
}

function newMediaCard(src: any, kind: any, title: string, path: string, mime: string): void {
  const g = useGraph.getState()
  const id = g.addCard(kind, { x: src.x + src.w + 200, y: src.y + src.h / 2 }, { title, status: 'done', refIds: [src.id] })
  g.updateCard(id, { assetUrl: toFileUrl(path), assetLocalPath: path, mime })
}

function placeImagesGrid(src: any, files: string[], label: string): void {
  const g = useGraph.getState()
  const cellW = 150
  const cellH = 130
  const cols = 4
  const baseX = src.x + src.w + 200
  const baseY = src.y + cellH / 2
  files.forEach((p, i) => {
    const r = Math.floor(i / cols)
    const c = i % cols
    const center = { x: baseX + c * (cellW + 16) + cellW / 2, y: baseY + r * (cellH + 16) }
    const id = g.addCard('source', center, {
      title: `${src.title} ${label}${i + 1}`,
      status: 'done',
      refIds: [src.id],
      w: cellW,
      h: cellH
    })
    g.updateCard(id, { assetUrl: toFileUrl(p), assetLocalPath: p, mime: 'image/png' })
  })
}

export async function runVideoTool(
  cardId: string,
  tool: VideoTool,
  opts?: { start?: number; end?: number; fps?: number }
): Promise<void> {
  const g = useGraph.getState()
  const src = g.getActiveBoard().cards[cardId]
  if (!src) return
  const inPath = src.assetLocalPath
  if (!inPath) {
    g.updateCard(cardId, { status: 'error', error: '请对本地视频文件使用（拖入 mp4 / mov / webm）' })
    return
  }
  const ok = await MV.ensureFfmpeg()
  if (!ok) {
    g.updateCard(cardId, { status: 'error', error: 'FFmpeg 不可用' })
    return
  }
  useTask.getState().inc()
  try {
    const projectId = useGraph.getState().project.id
    if (tool === 'frames' || tool === 'scenes') {
      const files =
        tool === 'frames'
          ? await MV.extractFrames(projectId, inPath, opts?.fps ?? 1)
          : await MV.sceneFrames(projectId, inPath)
      if (files.length === 0) throw new Error('未生成帧')
      placeImagesGrid(src, files, VTOOL_LABEL[tool])
    } else if (tool === 'splitAudio') {
      const out = await MV.splitAudio(projectId, inPath)
      newMediaCard(src, 'audio', `${src.title} · 音轨`, out, 'audio/mp3')
    } else {
      let out: string
      if (tool === 'clip') out = await MV.clip(projectId, inPath, opts?.start ?? 0, opts?.end ?? (opts?.start ?? 0) + 5)
      else if (tool === 'gif') out = await MV.toGif(projectId, inPath)
      else if (tool === 'mute') out = await MV.stripAudio(projectId, inPath)
      else if (tool === 'reverse') out = await MV.reverse(projectId, inPath)
      else out = await MV.compress(projectId, inPath)
      const kind = tool === 'gif' ? 'source' : 'video'
      newMediaCard(src, kind, `${src.title} · ${VTOOL_LABEL[tool]}`, out, tool === 'gif' ? 'image/gif' : 'video/mp4')
    }
  } catch (e: any) {
    const n = (window as any).mulby?.notification
    n?.show?.('视频处理失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}
