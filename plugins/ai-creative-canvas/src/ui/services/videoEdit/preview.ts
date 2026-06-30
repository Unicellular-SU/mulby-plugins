// HTML5 <video> 近似实时预览模型：把编辑栈映射成 CSS filter/transform/clip + 叠加 DOM
// 设计依据：docs/ai-creative-canvas-video-editor.md §3.3
// 调参只改 CSS / playbackRate，不触发任何 ffmpeg。映射不了的（色温/曲线/LUT/暗角/
// 锐化/变速倒放/blur-pad/Ken-Burns/mosaic/pip）置 exact=false，UI 角标「近似预览，导出更准」。

import type { EditStack, ColorParams, TransformParams, SpeedParams, OverlayParams, TrimParams } from './types'

export interface PreviewOverlay {
  id: string
  sub: string
  left: number // 0..1
  top: number
  width: number
  text?: string
  style?: Record<string, unknown>
  range?: { start: number; end: number }
  cues?: { start: number; end: number; text: string }[] // 字幕
}
export interface PreviewModel {
  filter: string
  transform: string
  clipPath?: string
  playbackRate: number
  overlays: PreviewOverlay[]
  exact: boolean
  keeps?: { in: number; out: number }[] // trim 保留段（输出预览跳过删除段）
}

export function stackToPreview(stack: EditStack | null): PreviewModel {
  const empty: PreviewModel = { filter: 'none', transform: 'none', playbackRate: 1, overlays: [], exact: true }
  if (!stack) return empty
  let exact = true
  const enabled = stack.ops.filter((o) => o.enabled)

  // 调色 → CSS filter
  const color = enabled.find((o) => o.kind === 'color')?.params as ColorParams | undefined
  const fParts: string[] = []
  if (color) {
    if (color.brightness) fParts.push(`brightness(${(1 + color.brightness).toFixed(3)})`)
    if (color.contrast != null && color.contrast !== 1) fParts.push(`contrast(${color.contrast})`)
    if (color.saturation != null && color.saturation !== 1) fParts.push(`saturate(${color.saturation})`)
    if (color.hue) fParts.push(`hue-rotate(${color.hue}deg)`)
    if (color.invert) fParts.push('invert(1)')
    if (color.gamma || color.temp || color.tint || color.sharpen || color.vignette || color.grain || color.lutPath || color.preset) exact = false
  }

  // 几何 → transform / clip-path
  const tf = enabled.find((o) => o.kind === 'transform')?.params as TransformParams | undefined
  const tParts: string[] = []
  let clipPath: string | undefined
  if (tf) {
    if (tf.rotate) tParts.push(`rotate(${tf.rotate}deg)`)
    if (tf.hflip) tParts.push('scaleX(-1)')
    if (tf.vflip) tParts.push('scaleY(-1)')
    if (tf.crop) {
      const c = tf.crop
      // inset(top right bottom left)，归一→百分比
      clipPath = `inset(${(c.y * 100).toFixed(2)}% ${((1 - c.x - c.w) * 100).toFixed(2)}% ${((1 - c.y - c.h) * 100).toFixed(2)}% ${(c.x * 100).toFixed(2)}%)`
    }
    if (tf.kenBurns || tf.fit === 'blur-pad' || (tf.pixelate && tf.pixelate > 1) || (tf.mirror && tf.mirror !== 'none')) exact = false
  }

  // 变速 → playbackRate
  const sp = enabled.find((o) => o.kind === 'speed')?.params as SpeedParams | undefined
  const rate = sp?.rate && sp.rate > 0 ? sp.rate : 1
  if (sp?.reverse || sp?.boomerang || (sp?.freezeEnd && sp.freezeEnd > 0)) exact = false

  // 叠加 → DOM
  const overlays: PreviewOverlay[] = enabled
    .filter((o) => o.kind === 'overlay')
    .map((o) => {
      const p = o.params as OverlayParams
      return { id: o.id, sub: p.sub, left: p.rect.x, top: p.rect.y, width: p.rect.w, text: p.text, style: p.style, range: p.range, cues: p.cues }
    })
  if (overlays.some((o) => o.sub === 'mosaic' || o.sub === 'pip' || o.sub === 'progress' || o.sub === 'timecode')) exact = false

  // 裁切 → 保留段
  const trimP = enabled.find((o) => o.kind === 'trim')?.params as TrimParams | undefined
  const keeps = trimP?.segments
    ?.filter((s) => s.keep !== false && s.out > s.in)
    .sort((a, b) => a.in - b.in)
    .map((s) => ({ in: s.in, out: s.out }))

  return { filter: fParts.join(' ') || 'none', transform: tParts.join(' ') || 'none', clipPath, playbackRate: rate, overlays, exact, keeps: keeps?.length ? keeps : undefined }
}
