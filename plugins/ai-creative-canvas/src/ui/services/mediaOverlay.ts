// 叠加渲染：一切文字/图形在渲染进程用 canvas 画成 PNG，再交给 ffmpeg overlay（字体无关）
// 设计依据：docs/ai-creative-canvas-video-editor.md §4.5 / §8.2。复用 runCollage 的 canvas 范式。

import { saveBase64 } from './media'
import type { EditStack, OverlayParams } from './videoEdit/types'
import type { OverlayInput } from './videoEdit/compile'

interface TextStyle {
  fontSize?: number // px（相对 baseH 自适应缺省）
  fontFamily?: string
  bold?: boolean
  color?: string
  align?: 'left' | 'center'
  stroke?: boolean
  strokeColor?: string
  bg?: string // 背景条颜色（含透明）
  opacity?: number
}

// 贪心换行：优先按空格断（拉丁），无空格则逐字断（中日韩）
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    const hasSpace = /\s/.test(para)
    const units = hasSpace ? para.split(/(\s+)/) : Array.from(para)
    for (const u of units) {
      const test = line + u
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line.trimEnd())
        line = u.trimStart()
      } else {
        line = test
      }
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

// 渲染单个文字/水印/贴纸 overlay 为透明 PNG（base64，无前缀）。盒宽 = rect.w*baseW，行高自适应。
function renderTextPng(p: OverlayParams, baseW: number, baseH: number): string {
  const style = (p.style || {}) as TextStyle
  const boxW = Math.max(8, Math.round(p.rect.w * baseW))
  const fontSize = Number(style.fontSize) || Math.round(baseH * (p.sub === 'sticker' ? 0.16 : 0.06))
  const fam = style.fontFamily || 'sans-serif'
  const font = `${style.bold ? 'bold ' : ''}${fontSize}px ${fam}`
  const pad = Math.round(fontSize * 0.32)
  const text = p.text || (p.sub === 'sticker' ? '⭐' : '')

  const meas = document.createElement('canvas').getContext('2d')!
  meas.font = font
  const lines = wrapText(meas, text, boxW - pad * 2)
  const lineH = Math.round(fontSize * 1.28)
  const h = Math.max(fontSize + pad * 2, lines.length * lineH + pad * 2)

  const canvas = document.createElement('canvas')
  canvas.width = boxW
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, boxW, h)
  if (style.bg) {
    ctx.fillStyle = style.bg
    ctx.fillRect(0, 0, boxW, h)
  }
  ctx.font = font
  ctx.textBaseline = 'top'
  const center = style.align === 'center'
  ctx.textAlign = center ? 'center' : 'left'
  const x = center ? boxW / 2 : pad
  ctx.globalAlpha = style.opacity != null ? style.opacity : p.sub === 'watermark' ? 0.55 : 1
  lines.forEach((ln, i) => {
    const y = pad + i * lineH
    if (style.stroke !== false) {
      ctx.lineWidth = Math.max(2, fontSize * 0.09)
      ctx.lineJoin = 'round'
      ctx.strokeStyle = style.strokeColor || 'rgba(0,0,0,0.85)'
      ctx.strokeText(ln, x, y)
    }
    ctx.fillStyle = style.color || '#ffffff'
    ctx.fillText(ln, x, y)
  })
  return canvas.toDataURL('image/png').split(',')[1]
}

// 相框 / 边框：在 baseW×baseH 透明画布上画边框（中心透明），整帧 overlay
function renderFramePng(p: OverlayParams, baseW: number, baseH: number): string {
  const style = (p.style || {}) as { color?: string; widthPct?: number; radiusPct?: number }
  const canvas = document.createElement('canvas')
  canvas.width = baseW
  canvas.height = baseH
  const ctx = canvas.getContext('2d')!
  const w = Math.max(2, Math.round((style.widthPct ?? 0.03) * Math.min(baseW, baseH)))
  const r = Math.round((style.radiusPct ?? 0) * Math.min(baseW, baseH))
  ctx.lineWidth = w
  ctx.strokeStyle = style.color || '#ffffff'
  const inset = w / 2
  if (r > 0 && typeof (ctx as any).roundRect === 'function') {
    ctx.beginPath()
    ;(ctx as any).roundRect(inset, inset, baseW - w, baseH - w, r)
    ctx.stroke()
  } else {
    ctx.strokeRect(inset, inset, baseW - w, baseH - w)
  }
  return canvas.toDataURL('image/png').split(',')[1]
}

// 进度条：满幅纯色条 PNG（由编译器用滑动 overlay 表达式从左推进）
function renderProgressBarPng(p: OverlayParams, baseW: number, baseH: number): string {
  const style = (p.style || {}) as { color?: string; heightPct?: number }
  const h = Math.max(3, Math.round((style.heightPct ?? 0.014) * baseH))
  const canvas = document.createElement('canvas')
  canvas.width = baseW
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = style.color || '#ff2d55'
  ctx.fillRect(0, 0, baseW, h)
  return canvas.toDataURL('image/png').split(',')[1]
}

function tcLabel(s: number): string {
  const m = Math.floor(s / 60)
  const x = Math.floor(s % 60)
  return `${m}:${x.toString().padStart(2, '0')}`
}
// 时间码精灵图：横排每格一个时间标签，编译器按时间裁出当前格
function renderTimecodePng(p: OverlayParams, outDur: number, baseH: number): { b64: string; cellW: number; cellH: number; step: number } {
  const style = (p.style || {}) as { color?: string; fontSize?: number }
  const fontSize = Number(style.fontSize) || Math.round(baseH * 0.05)
  const cellH = Math.round(fontSize * 1.5)
  const cellW = Math.round(fontSize * 3.2)
  const dur = Math.max(1, outDur)
  const step = Math.max(1, Math.ceil(dur / 120)) // 限格数 ≤~120，避免超宽画布
  const cells = Math.max(1, Math.ceil(dur / step))
  const canvas = document.createElement('canvas')
  canvas.width = cells * cellW
  canvas.height = cellH
  const ctx = canvas.getContext('2d')!
  ctx.font = `bold ${fontSize}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < cells; i++) {
    const cx = i * cellW + cellW / 2
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(i * cellW + 4, cellH * 0.12, cellW - 8, cellH * 0.76)
    ctx.lineWidth = Math.max(2, fontSize * 0.08)
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(tcLabel(i * step), cx, cellH / 2)
    ctx.fillStyle = style.color || '#ffffff'
    ctx.fillText(tcLabel(i * step), cx, cellH / 2)
  }
  return { b64: canvas.toDataURL('image/png').split(',')[1], cellW, cellH, step }
}

// 备好整条栈所有需要 PNG 输入的叠加 op（事务性返回 cleanup 列表，调用方在导出后 unlink）。
// 单个 overlay 渲染失败 → 跳过该层（best-effort），不阻断整条导出。
export async function prepareOverlays(
  stack: EditStack,
  projectId: string,
  outDur = 0
): Promise<{ overlayResolved: Record<string, OverlayInput>; cleanup: string[] }> {
  const overlayResolved: Record<string, OverlayInput> = {}
  const cleanup: string[] = []
  const bw = stack.baseW || 1280
  const bh = stack.baseH || 720
  for (const op of stack.ops) {
    if (op.kind !== 'overlay' || !op.enabled) continue
    const p = op.params as OverlayParams
    if (p.sub === 'mosaic' || p.sub === 'pip') continue // mosaic 用源、pip 由调用方解析视频路径
    try {
      if (p.sub === 'timecode') {
        const tc = renderTimecodePng(p, outDur || stack.baseDuration || 1, bh)
        const { path } = await saveBase64(projectId, 'ov', tc.b64, 'png')
        overlayResolved[op.id] = { kind: 'timecode', path, cellW: tc.cellW, cellH: tc.cellH, step: tc.step }
        cleanup.push(path)
        continue
      }
      if (p.sub === 'subtitle') {
        // 每条 cue 渲一张 PNG（最多 80 条，超出截断防输入爆炸）
        const cues = (p.cues || []).filter((c) => c.text.trim() && c.end > c.start).slice(0, 80)
        const out: { start: number; end: number; path: string }[] = []
        for (const c of cues) {
          const cueParams: OverlayParams = { sub: 'text', rect: p.rect, text: c.text, style: { align: 'center', ...(p.style || {}) } }
          const { path } = await saveBase64(projectId, 'ov', renderTextPng(cueParams, bw, bh), 'png')
          out.push({ start: c.start, end: c.end, path })
          cleanup.push(path)
        }
        overlayResolved[op.id] = { kind: 'subtitle', cues: out }
        continue
      }
      const b64 = p.sub === 'frame' ? renderFramePng(p, bw, bh) : p.sub === 'progress' ? renderProgressBarPng(p, bw, bh) : renderTextPng(p, bw, bh)
      const { path } = await saveBase64(projectId, 'ov', b64, 'png')
      overlayResolved[op.id] = { kind: 'png', path }
      cleanup.push(path)
    } catch {
      /* 跳过该叠加层 */
    }
  }
  return { overlayResolved, cleanup }
}
