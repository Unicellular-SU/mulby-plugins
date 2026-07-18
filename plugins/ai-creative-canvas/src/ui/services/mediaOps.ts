import { useGraph } from '../store/graphStore'
import { useTask } from '../store/taskStore'
import { createLimiter } from '../util'
import { saveBase64, toFileUrl, loadImageInput } from './media'
import { toast } from '../store/toastStore'
import type { Card } from '../types'
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
  const boardId = g.boardIdOfCard(cardId) // 结果卡落在源卡所在画布（处理途中切换画布也不串板）
  if (!src.assetLocalPath && !src.assetUrl) {
    g.updateCard(cardId, { status: 'error', error: '该卡片没有图片' })
    return
  }
  // 高清放大不改几何 → 全景放大仍是全景卡；裁剪/扩图/抠像改画面几何 → 一律落普通图片卡
  const resultKind = tool === 'upscale' && src.kind === 'pano' ? 'pano' : 'image'
  const resultId = g.addCard(
    resultKind,
    { x: src.x + src.w + 200, y: src.y + src.h / 2 },
    { title: `${src.title} · ${TOOL_LABEL[tool]}`, status: 'running', progress: 0.2, modelId: src.modelId, refIds: [src.id] },
    boardId
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
  const boardId = g.boardIdOfCard(cardId)
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
          }, boardId)
          const saved = await saveBase64(useGraph.getState().project.id, id, cell.base64, 'png')
          useGraph.getState().updateCard(id, { assetUrl: saved.url, assetLocalPath: saved.path, mime: cell.mime })
        }
      }
    } catch (e: any) {
      toast('宫格切分失败：' + (e?.message || String(e)), 'error')
    } finally {
      useTask.getState().dec()
    }
  })
}

// 拼贴：多张图片卡 → 自动网格合成一张（canvas，bytes→ImageBitmap 规避 file:// taint）→ 落新卡
export async function runCollage(cardIds: string[]): Promise<void> {
  const g = useGraph.getState()
  const board = g.getActiveBoard()
  const boardId = board.id
  const cards = cardIds.map((id) => board.cards[id]).filter((c): c is Card => !!c && !!c.assetUrl && (c.kind === 'image' || c.kind === 'pano' || c.kind === 'source'))
  if (cards.length < 2) {
    toast('请选择至少 2 张图片卡', 'error')
    return
  }
  useTask.getState().inc()
  try {
    const CELL = 512
    const n = cards.length
    const cols = Math.ceil(Math.sqrt(n))
    const rows = Math.ceil(n / cols)
    const canvas = document.createElement('canvas')
    canvas.width = cols * CELL
    canvas.height = rows * CELL
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 不可用')
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < n; i++) {
      const c = cards[i]
      const buf = await loadImageInput({ url: c.assetUrl!, localPath: c.assetLocalPath || undefined })
      if (!buf) continue
      const bmp = await createImageBitmap(new Blob([buf], { type: c.mime || 'image/png' }))
      const col = i % cols
      const row = Math.floor(i / cols)
      const scale = Math.max(CELL / bmp.width, CELL / bmp.height) // cover-fit
      const dw = bmp.width * scale
      const dh = bmp.height * scale
      ctx.drawImage(bmp, col * CELL + (CELL - dw) / 2, row * CELL + (CELL - dh) / 2, dw, dh)
      bmp.close?.()
    }
    const base64 = canvas.toDataURL('image/png').split(',')[1]
    const last = cards[cards.length - 1]
    const id = g.addCard('image', { x: last.x + last.w + 220, y: last.y + last.h / 2 }, { title: `拼贴（${n}）`, status: 'done', refIds: cardIds }, boardId)
    const saved = await saveBase64(useGraph.getState().project.id, id, base64, 'png')
    useGraph.getState().updateCard(id, { assetUrl: saved.url, assetLocalPath: saved.path, mime: 'image/png' })
    useGraph.getState().setSelection([id])
  } catch (e: any) {
    toast('拼贴失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}

// 截帧：把视频当前时刻抽成一张图片卡（ffmpeg，规避 canvas taint）
export async function captureFrame(cardId: string, atSec: number): Promise<void> {
  const g = useGraph.getState()
  const src = g.getActiveBoard().cards[cardId]
  if (!src?.assetLocalPath) {
    toast('请对本地视频文件使用', 'error')
    return
  }
  const boardId = g.boardIdOfCard(cardId)
  const ok = await MV.ensureFfmpeg()
  if (!ok) return
  useTask.getState().inc()
  try {
    const out = await MV.frameAt(useGraph.getState().project.id, src.assetLocalPath, atSec)
    newMediaCard(src, 'image', `${src.title} · 截帧`, out, 'image/png', boardId)
  } catch (e: any) {
    toast('截帧失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}

// ---- 视频工具 ----

export type VideoTool = 'clip' | 'gif' | 'frames' | 'scenes' | 'splitAudio' | 'mute' | 'reverse' | 'compress' | 'chromakey'

const VTOOL_LABEL: Record<VideoTool, string> = {
  clip: '裁剪',
  gif: 'GIF',
  frames: '抽帧',
  scenes: '镜头',
  splitAudio: '音轨',
  mute: '去音轨',
  reverse: '倒放',
  compress: '压制',
  chromakey: '绿幕抠像'
}

function newMediaCard(src: any, kind: any, title: string, path: string, mime: string, boardId?: string): void {
  const g = useGraph.getState()
  const id = g.addCard(kind, { x: src.x + src.w + 200, y: src.y + src.h / 2 }, { title, status: 'done', refIds: [src.id] }, boardId)
  g.updateCard(id, { assetUrl: toFileUrl(path), assetLocalPath: path, mime })
}

function placeImagesGrid(src: any, files: string[], label: string, boardId?: string): void {
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
    }, boardId)
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
  const boardId = g.boardIdOfCard(cardId)
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
      placeImagesGrid(src, files, VTOOL_LABEL[tool], boardId)
    } else if (tool === 'splitAudio') {
      const out = await MV.splitAudio(projectId, inPath)
      newMediaCard(src, 'audio', `${src.title} · 音轨`, out, 'audio/mp3', boardId)
    } else if (tool === 'chromakey') {
      const r = await MV.chromakey(projectId, inPath)
      newMediaCard(src, 'video', `${src.title} · 绿幕抠像`, r.path, r.mime, boardId)
    } else {
      let out: string
      if (tool === 'clip') out = await MV.clip(projectId, inPath, opts?.start ?? 0, opts?.end ?? (opts?.start ?? 0) + 5)
      else if (tool === 'gif') out = await MV.toGif(projectId, inPath)
      else if (tool === 'mute') out = await MV.stripAudio(projectId, inPath)
      else if (tool === 'reverse') out = await MV.reverse(projectId, inPath)
      else out = await MV.compress(projectId, inPath)
      const kind = tool === 'gif' ? 'source' : 'video'
      newMediaCard(src, kind, `${src.title} · ${VTOOL_LABEL[tool]}`, out, tool === 'gif' ? 'image/gif' : 'video/mp4', boardId)
    }
  } catch (e: any) {
    toast('视频处理失败：' + (e?.message || String(e)), 'error')
  } finally {
    useTask.getState().dec()
  }
}
