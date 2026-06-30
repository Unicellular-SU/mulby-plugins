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

// 备好整条栈所有需要 PNG 输入的叠加 op（事务性返回 cleanup 列表，调用方在导出后 unlink）。
// 单个 overlay 渲染失败 → 跳过该层（best-effort），不阻断整条导出。
export async function prepareOverlays(
  stack: EditStack,
  projectId: string
): Promise<{ overlayResolved: Record<string, OverlayInput>; cleanup: string[] }> {
  const overlayResolved: Record<string, OverlayInput> = {}
  const cleanup: string[] = []
  for (const op of stack.ops) {
    if (op.kind !== 'overlay' || !op.enabled) continue
    const p = op.params as OverlayParams
    if (p.sub === 'mosaic' || p.sub === 'pip') continue // mosaic 用源、pip 由调用方解析视频路径
    try {
      const b64 = renderTextPng(p, stack.baseW || 1280, stack.baseH || 720)
      const { path } = await saveBase64(projectId, 'ov', b64, 'png')
      overlayResolved[op.id] = { kind: 'png', path }
      cleanup.push(path)
    } catch {
      /* 跳过该叠加层 */
    }
  }
  return { overlayResolved, cleanup }
}
