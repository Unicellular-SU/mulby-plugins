// 标注的 canvas 绘制与整图渲染/导出（从 App.tsx 搬移，保持原样）。

import { EDIT_HANDLE_VISUAL_SIZE } from './constants'
import {
  clampRect,
  getAnnotationBounds,
  getResizeHandlePoints,
  normalizeRect,
  visualSizeToImageSize
} from './geometry'
import { getTextBoxWidth, getWrappedTextLines } from './textLayout'
import type { Annotation, LoadedImage, Point, Rect, StepAnnotation, TextAnnotation } from './types'

export function drawTaperedArrow(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  size: number
) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length < 1) {
    return
  }

  const directionX = dx / length
  const directionY = dy / length
  const normalX = -directionY
  const normalY = directionX
  const tailWidth = Math.max(1.5, size * 0.45)
  const shaftWidth = Math.max(tailWidth + 1, size * 1.35)
  const headLength = Math.min(Math.max(12, size * 4.8), length * 0.62)
  const headWidth = Math.max(shaftWidth * 2.45, size * 4.2)
  const headBase = {
    x: end.x - directionX * headLength,
    y: end.y - directionY * headLength
  }

  context.save()
  context.fillStyle = context.strokeStyle
  context.beginPath()
  context.moveTo(
    start.x + normalX * tailWidth / 2,
    start.y + normalY * tailWidth / 2
  )
  context.lineTo(
    headBase.x + normalX * shaftWidth / 2,
    headBase.y + normalY * shaftWidth / 2
  )
  context.lineTo(
    headBase.x + normalX * headWidth / 2,
    headBase.y + normalY * headWidth / 2
  )
  context.lineTo(end.x, end.y)
  context.lineTo(
    headBase.x - normalX * headWidth / 2,
    headBase.y - normalY * headWidth / 2
  )
  context.lineTo(
    headBase.x - normalX * shaftWidth / 2,
    headBase.y - normalY * shaftWidth / 2
  )
  context.lineTo(
    start.x - normalX * tailWidth / 2,
    start.y - normalY * tailWidth / 2
  )
  context.closePath()
  context.fill()

  context.beginPath()
  context.arc(start.x, start.y, tailWidth / 2, 0, Math.PI * 2)
  context.fill()
  context.restore()
}

export function pixelateRect(context: CanvasRenderingContext2D, rect: Rect, cellSize: number) {
  const safeRect = clampRect(rect, context.canvas)
  if (safeRect.width < 2 || safeRect.height < 2) {
    return
  }

  const cell = Math.max(6, Math.round(cellSize))
  const smallCanvas = document.createElement('canvas')
  smallCanvas.width = Math.max(1, Math.ceil(safeRect.width / cell))
  smallCanvas.height = Math.max(1, Math.ceil(safeRect.height / cell))

  const smallContext = smallCanvas.getContext('2d')
  if (!smallContext) {
    return
  }

  smallContext.drawImage(
    context.canvas,
    safeRect.x,
    safeRect.y,
    safeRect.width,
    safeRect.height,
    0,
    0,
    smallCanvas.width,
    smallCanvas.height
  )

  context.save()
  context.imageSmoothingEnabled = false
  context.drawImage(
    smallCanvas,
    0,
    0,
    smallCanvas.width,
    smallCanvas.height,
    safeRect.x,
    safeRect.y,
    safeRect.width,
    safeRect.height
  )
  context.strokeStyle = 'rgba(255, 255, 255, 0.45)'
  context.lineWidth = Math.max(1, cell / 14)
  context.strokeRect(safeRect.x, safeRect.y, safeRect.width, safeRect.height)
  context.restore()
}

export function blurRect(context: CanvasRenderingContext2D, rect: Rect, radius: number) {
  const safeRect = clampRect(rect, context.canvas)
  if (safeRect.width < 2 || safeRect.height < 2) {
    return
  }

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = safeRect.width
  sourceCanvas.height = safeRect.height

  const sourceContext = sourceCanvas.getContext('2d')
  if (!sourceContext) {
    return
  }

  sourceContext.drawImage(
    context.canvas,
    safeRect.x,
    safeRect.y,
    safeRect.width,
    safeRect.height,
    0,
    0,
    safeRect.width,
    safeRect.height
  )

  context.save()
  context.filter = `blur(${Math.max(2, radius)}px)`
  context.drawImage(sourceCanvas, safeRect.x, safeRect.y)
  context.filter = 'none'
  context.setLineDash([10, 7])
  context.strokeStyle = 'rgba(255, 255, 255, 0.42)'
  context.lineWidth = Math.max(1, radius / 8)
  context.strokeRect(safeRect.x, safeRect.y, safeRect.width, safeRect.height)
  context.restore()
}

export function drawTextAnnotation(context: CanvasRenderingContext2D, annotation: TextAnnotation) {
  const fontSize = Math.max(14, annotation.size)
  const lineHeight = fontSize * 1.25

  context.save()
  context.font = `700 ${fontSize}px "Segoe UI", "PingFang SC", sans-serif`
  context.textBaseline = 'top'

  const paddingX = Math.max(8, fontSize * 0.28)
  const paddingY = Math.max(6, fontSize * 0.2)
  const blockWidth = getTextBoxWidth(annotation)
  const maxLineWidth = Math.max(fontSize, blockWidth - paddingX * 2)
  const displayLines = getWrappedTextLines(annotation, (line) => context.measureText(line).width)

  context.lineJoin = 'round'
  context.lineWidth = Math.max(2, fontSize * 0.12)
  context.strokeStyle = 'rgba(6, 11, 20, 0.7)'
  context.fillStyle = annotation.color

  displayLines.forEach((line, index) => {
    const y = annotation.point.y + paddingY + index * lineHeight
    context.strokeText(line, annotation.point.x + paddingX, y, maxLineWidth)
    context.fillText(line, annotation.point.x + paddingX, y, maxLineWidth)
  })

  context.restore()
}

export function drawStepAnnotation(context: CanvasRenderingContext2D, annotation: StepAnnotation) {
  const radius = Math.max(14, annotation.size * 0.7)

  context.save()
  context.fillStyle = annotation.color
  context.shadowColor = 'rgba(5, 12, 22, 0.34)'
  context.shadowBlur = 14
  context.beginPath()
  context.arc(annotation.point.x, annotation.point.y, radius, 0, Math.PI * 2)
  context.fill()

  context.shadowBlur = 0
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  context.lineWidth = Math.max(2, radius * 0.12)
  context.stroke()
  context.fillStyle = '#fff'
  context.font = `800 ${Math.max(12, radius * (annotation.value.length > 2 ? 0.82 : 1))}px "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(annotation.value, annotation.point.x, annotation.point.y, radius * 1.55)
  context.restore()
}

export function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation) {
  if (annotation.type === 'mosaic') {
    pixelateRect(context, normalizeRect(annotation.start, annotation.end), annotation.size)
    return
  }

  if (annotation.type === 'blur') {
    blurRect(context, normalizeRect(annotation.start, annotation.end), annotation.size)
    return
  }

  if (annotation.type === 'text') {
    drawTextAnnotation(context, annotation)
    return
  }

  if (annotation.type === 'step') {
    drawStepAnnotation(context, annotation)
    return
  }

  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = annotation.color
  context.lineWidth = annotation.size

  if (annotation.type === 'highlighter') {
    context.globalAlpha = 0.34
    context.lineWidth = annotation.size * 2.5
  }

  if (annotation.type === 'rect') {
    const rect = normalizeRect(annotation.start, annotation.end)
    context.strokeRect(rect.x, rect.y, rect.width, rect.height)
  }

  if (annotation.type === 'ellipse') {
    const rect = normalizeRect(annotation.start, annotation.end)
    context.beginPath()
    context.ellipse(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
      rect.width / 2,
      rect.height / 2,
      0,
      0,
      Math.PI * 2
    )
    context.stroke()
  }

  if (annotation.type === 'line') {
    context.beginPath()
    context.moveTo(annotation.start.x, annotation.start.y)
    context.lineTo(annotation.end.x, annotation.end.y)
    context.stroke()
  }

  if (annotation.type === 'arrow') {
    drawTaperedArrow(context, annotation.start, annotation.end, annotation.size)
  }

  if ((annotation.type === 'pen' || annotation.type === 'highlighter') && annotation.points.length > 1) {
    context.beginPath()
    context.moveTo(annotation.points[0].x, annotation.points[0].y)
    annotation.points.slice(1).forEach((point) => {
      context.lineTo(point.x, point.y)
    })
    context.stroke()
  }

  context.restore()
}

export function drawSelectionOverlay(context: CanvasRenderingContext2D, rect: Rect) {
  if (rect.width < 2 || rect.height < 2) {
    return
  }

  context.save()
  context.fillStyle = 'rgba(3, 8, 15, 0.42)'
  context.beginPath()
  context.rect(0, 0, context.canvas.width, context.canvas.height)
  context.rect(rect.x, rect.y, rect.width, rect.height)
  context.fill('evenodd')

  context.setLineDash([10, 6])
  context.lineWidth = 2
  context.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  context.strokeRect(rect.x, rect.y, rect.width, rect.height)

  context.setLineDash([])
  context.fillStyle = '#ffffff'
  const handleSize = 8
  const halfHandle = handleSize / 2
  const handles = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height]
  ]

  handles.forEach(([x, y]) => {
    context.fillRect(x - halfHandle, y - halfHandle, handleSize, handleSize)
  })

  context.restore()
}

export function drawAnnotationHighlight(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  imageToCssScale: number
) {
  const handleSize = visualSizeToImageSize(EDIT_HANDLE_VISUAL_SIZE, imageToCssScale)
  const halfHandle = handleSize / 2
  const strokeWidth = Math.max(1, visualSizeToImageSize(1.5, imageToCssScale))

  const drawSquareHandle = (point: Point) => {
    context.fillStyle = '#f8fafc'
    context.strokeStyle = '#2563eb'
    context.lineWidth = strokeWidth
    context.fillRect(point.x - halfHandle, point.y - halfHandle, handleSize, handleSize)
    context.strokeRect(point.x - halfHandle, point.y - halfHandle, handleSize, handleSize)
  }

  const drawCircleHandle = (point: Point) => {
    context.fillStyle = '#f8fafc'
    context.strokeStyle = '#2563eb'
    context.lineWidth = strokeWidth
    context.beginPath()
    context.arc(point.x, point.y, halfHandle, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }

  context.save()
  context.setLineDash([8, 5])
  context.lineWidth = strokeWidth
  context.strokeStyle = '#60a5fa'

  if (annotation.type === 'line' || annotation.type === 'arrow') {
    context.beginPath()
    context.moveTo(annotation.start.x, annotation.start.y)
    context.lineTo(annotation.end.x, annotation.end.y)
    context.stroke()
    context.setLineDash([])
    drawCircleHandle(annotation.start)
    drawCircleHandle(annotation.end)
    context.restore()
    return
  }

  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    const rect = normalizeRect(annotation.start, annotation.end)

    if (annotation.type === 'ellipse') {
      context.beginPath()
      context.ellipse(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width / 2,
        rect.height / 2,
        0,
        0,
        Math.PI * 2
      )
      context.stroke()
    } else {
      context.strokeRect(rect.x, rect.y, rect.width, rect.height)
    }

    context.setLineDash([])
    getResizeHandlePoints(rect).forEach((handle) => drawSquareHandle(handle.point))
    context.restore()
    return
  }

  const bounds = getAnnotationBounds(annotation)
  const margin = visualSizeToImageSize(5, imageToCssScale)
  const x = bounds.x - margin
  const y = bounds.y - margin
  const width = bounds.width + margin * 2
  const height = bounds.height + margin * 2

  if (annotation.type === 'step') {
    const radius = Math.max(14, annotation.size * 0.7) + margin
    context.beginPath()
    context.arc(annotation.point.x, annotation.point.y, radius, 0, Math.PI * 2)
    context.stroke()
    context.restore()
    return
  }

  context.strokeRect(x, y, width, height)
  context.setLineDash([])

  if (annotation.type === 'text') {
    drawSquareHandle({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height
    })
  }

  context.restore()
}

export function renderCanvas(args: {
  canvas: HTMLCanvasElement | null
  image: LoadedImage | null
  annotations: Annotation[]
  draft: Annotation | null
  cropRect: Rect | null
  selectedAnnotationId: string | null
  imageToCssScale: number
}) {
  const { canvas, image, annotations, draft, cropRect, selectedAnnotationId, imageToCssScale } = args

  if (!canvas || !image) {
    return
  }

  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  canvas.width = image.width
  canvas.height = image.height
  context.clearRect(0, 0, image.width, image.height)
  context.drawImage(image.element, 0, 0, image.width, image.height)
  annotations.forEach((annotation) => drawAnnotation(context, annotation))

  if (draft) {
    drawAnnotation(context, draft)
  }

  if (cropRect) {
    drawSelectionOverlay(context, cropRect)
  }

  if (selectedAnnotationId) {
    const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedAnnotationId)
    if (selectedAnnotation) {
      drawAnnotationHighlight(context, selectedAnnotation, imageToCssScale)
    }
  }
}

export function exportPng(image: LoadedImage, annotations: Annotation[]) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('无法创建导出画布')
  }

  context.drawImage(image.element, 0, 0, image.width, image.height)
  annotations.forEach((annotation) => drawAnnotation(context, annotation))

  return canvas.toDataURL('image/png')
}
