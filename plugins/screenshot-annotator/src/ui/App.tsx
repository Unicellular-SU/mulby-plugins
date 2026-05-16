import {
  Circle,
  Clipboard,
  Crop,
  Droplets,
  Eraser,
  FlipHorizontal,
  FlipVertical,
  Grid3x3,
  Hash,
  Highlighter,
  LucideIcon,
  Minus,
  MousePointer2,
  MoveRight,
  Pencil,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
  X
} from 'lucide-react'
import {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useMulby } from './hooks/useMulby'

type Tool =
  | 'select'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'pen'
  | 'highlighter'
  | 'text'
  | 'step'
  | 'mosaic'
  | 'blur'
  | 'crop'
  | 'eraser'

type ResizeEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-right'
  | 'bottom-left'

type Point = {
  x: number
  y: number
}

type Rect = {
  x: number
  y: number
  width: number
  height: number
}

type StrokeAnnotation = {
  id: string
  type: 'pen' | 'highlighter'
  points: Point[]
  color: string
  size: number
}

type ShapeAnnotation = {
  id: string
  type: 'line' | 'rect' | 'ellipse' | 'arrow'
  start: Point
  end: Point
  color: string
  size: number
}

type TextAnnotation = {
  id: string
  type: 'text'
  point: Point
  text: string
  color: string
  size: number
}

type StepAnnotation = {
  id: string
  type: 'step'
  point: Point
  value: string
  color: string
  size: number
}

type EffectAnnotation = {
  id: string
  type: 'mosaic' | 'blur'
  start: Point
  end: Point
  color: string
  size: number
}

type Annotation = StrokeAnnotation | ShapeAnnotation | TextAnnotation | StepAnnotation | EffectAnnotation

type CaptureRegion = {
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}

type PluginAttachment = {
  id: string
  name: string
  kind: 'file' | 'image'
  path?: string
  dataUrl?: string
  mime?: string
  capture?: {
    type: 'region' | 'fullscreen'
    region?: CaptureRegion
    display?: {
      scaleFactor?: number
    }
  }
}

type PluginInitData = {
  featureCode: string
  attachments?: PluginAttachment[]
}

type LoadedImage = {
  dataUrl: string
  element: HTMLImageElement
  width: number
  height: number
  region?: CaptureRegion
  scaleFactor: number
}

type PendingPreview = {
  dataUrl: string
  displayWidth: number
  displayHeight: number
}

type DisplaySize = {
  width: number
  height: number
}

type InlineTextEdit = {
  id: string
  point: Point
  text: string
  color: string
  size: number
}

const PLUGIN_ID = 'screenshot-annotator'
const TOOLBAR_HEIGHT = 96
const TOOLBAR_MIN_WIDTH = 1080
const HISTORY_LIMIT = 30
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7']
const RESIZE_EDGES: ResizeEdge[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left'
]

const createId = (prefix = 'annotation') => {
  const randomId = globalThis.crypto?.randomUUID?.()
  if (randomId) {
    return `${prefix}-${randomId}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('截图图片加载失败'))
    image.src = dataUrl
  })

const dataUrlToBase64 = (dataUrl: string) => dataUrl.split(',', 2)[1] ?? ''

function dataUrlToArrayBuffer(dataUrl: string) {
  const base64 = dataUrlToBase64(dataUrl)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

function arrayBufferToDataUrl(buffer: ArrayBuffer | Uint8Array, mime = 'image/png') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }

  return `data:${mime};base64,${btoa(binary)}`
}

const ensurePngPath = (path: string) => (
  path.toLowerCase().endsWith('.png') ? path : `${path}.png`
)

const defaultFileName = () => {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')

  return `screenshot-${stamp}.png`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

function getDisplaySize(image: LoadedImage) {
  const regionWidth = image.region?.width
  const regionHeight = image.region?.height

  if (regionWidth && regionHeight) {
    return { width: regionWidth, height: regionHeight }
  }

  return {
    width: Math.max(240, Math.round(image.width / image.scaleFactor)),
    height: Math.max(120, Math.round(image.height / image.scaleFactor))
  }
}

function getPreviewDisplaySize(data: {
  region?: CaptureRegion
  scaleFactor: number
  naturalWidth?: number
  naturalHeight?: number
}) {
  if (data.region?.width && data.region.height) {
    return {
      width: data.region.width,
      height: data.region.height
    }
  }

  if (data.naturalWidth && data.naturalHeight) {
    return {
      width: Math.max(240, Math.round(data.naturalWidth / data.scaleFactor)),
      height: Math.max(120, Math.round(data.naturalHeight / data.scaleFactor))
    }
  }

  return {
    width: TOOLBAR_MIN_WIDTH,
    height: Math.max(240, window.innerHeight - TOOLBAR_HEIGHT)
  }
}

function fitDisplaySize(size: DisplaySize, viewport: DisplaySize): DisplaySize {
  if (size.width <= 0 || size.height <= 0) {
    return { width: 0, height: 0 }
  }

  const safeViewport = {
    width: viewport.width > 0 ? viewport.width : Math.max(1, window.innerWidth),
    height: viewport.height > 0 ? viewport.height : Math.max(1, window.innerHeight - TOOLBAR_HEIGHT)
  }
  const scale = Math.min(
    1,
    safeViewport.width / size.width,
    safeViewport.height / size.height
  )

  return {
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale))
  }
}

function buildConstrainedBounds(args: {
  displaySize: DisplaySize
  region?: CaptureRegion
  workArea?: { x: number; y: number; width: number; height: number }
}) {
  const requestedWidth = Math.max(args.displaySize.width, TOOLBAR_MIN_WIDTH)
  const requestedHeight = args.displaySize.height + TOOLBAR_HEIGHT

  if (!args.region || !args.workArea) {
    return {
      width: requestedWidth,
      height: requestedHeight
    }
  }

  const width = Math.max(1, Math.min(requestedWidth, args.workArea.width))
  const height = Math.max(1, Math.min(requestedHeight, args.workArea.height))

  return {
    x: clamp(args.region.x, args.workArea.x, args.workArea.x + Math.max(0, args.workArea.width - width)),
    y: clamp(args.region.y, args.workArea.y, args.workArea.y + Math.max(0, args.workArea.height - height)),
    width,
    height
  }
}

function clampRect(rect: Rect, canvas: HTMLCanvasElement): Rect {
  const x = Math.max(0, Math.min(rect.x, canvas.width))
  const y = Math.max(0, Math.min(rect.y, canvas.height))
  const maxX = Math.max(0, Math.min(rect.x + rect.width, canvas.width))
  const maxY = Math.max(0, Math.min(rect.y + rect.height, canvas.height))

  return {
    x,
    y,
    width: Math.max(0, maxX - x),
    height: Math.max(0, maxY - y)
  }
}

function pointDistanceToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const t = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1
  )
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy
  }

  return Math.hypot(point.x - projection.x, point.y - projection.y)
}

function isPointInRect(point: Point, rect: Rect, padding = 0) {
  return (
    point.x >= rect.x - padding &&
    point.y >= rect.y - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y <= rect.y + rect.height + padding
  )
}

function isStrokeAnnotation(annotation: Annotation): annotation is StrokeAnnotation {
  return annotation.type === 'pen' || annotation.type === 'highlighter'
}

function isDragAnnotation(annotation: Annotation): annotation is ShapeAnnotation | EffectAnnotation {
  return (
    annotation.type === 'line' ||
    annotation.type === 'rect' ||
    annotation.type === 'ellipse' ||
    annotation.type === 'arrow' ||
    annotation.type === 'mosaic' ||
    annotation.type === 'blur'
  )
}

function getTextBounds(annotation: TextAnnotation): Rect {
  const fontSize = Math.max(14, annotation.size)
  const lines = annotation.text.split(/\r?\n/).filter(Boolean)
  const displayLines = lines.length ? lines : ['']
  const estimatedCharWidth = fontSize * 0.68
  const paddingX = Math.max(8, fontSize * 0.28)
  const paddingY = Math.max(6, fontSize * 0.2)
  const lineHeight = fontSize * 1.25
  const width = displayLines.reduce((max, line) => {
    return Math.max(max, line.length * estimatedCharWidth)
  }, 0) + paddingX * 2

  return {
    x: annotation.point.x,
    y: annotation.point.y,
    width: Math.max(72, width),
    height: displayLines.length * lineHeight + paddingY * 2
  }
}

function getAnnotationBounds(annotation: Annotation): Rect {
  if (annotation.type === 'text') {
    return getTextBounds(annotation)
  }

  if (annotation.type === 'step') {
    const radius = Math.max(14, annotation.size * 0.7)
    return {
      x: annotation.point.x - radius,
      y: annotation.point.y - radius,
      width: radius * 2,
      height: radius * 2
    }
  }

  if (isStrokeAnnotation(annotation)) {
    if (!annotation.points.length) {
      return { x: 0, y: 0, width: 0, height: 0 }
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    annotation.points.forEach((point) => {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    })

    const padding = annotation.size + 4
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2
    }
  }

  const rect = normalizeRect(annotation.start, annotation.end)
  const padding = annotation.size + 4
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2
  }
}

function hitTestAnnotation(point: Point, annotations: Annotation[], filterType?: Annotation['type']) {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index]

    if (filterType && annotation.type !== filterType) {
      continue
    }

    if (isStrokeAnnotation(annotation)) {
      for (let pointIndex = 1; pointIndex < annotation.points.length; pointIndex += 1) {
        const distance = pointDistanceToSegment(
          point,
          annotation.points[pointIndex - 1],
          annotation.points[pointIndex]
        )

        if (distance <= annotation.size + 8) {
          return annotation.id
        }
      }
      continue
    }

    if (annotation.type === 'line' || annotation.type === 'arrow') {
      if (pointDistanceToSegment(point, annotation.start, annotation.end) <= annotation.size + 10) {
        return annotation.id
      }
      continue
    }

    if (annotation.type === 'rect' || annotation.type === 'ellipse') {
      if (isPointInRect(point, normalizeRect(annotation.start, annotation.end), annotation.size + 8)) {
        return annotation.id
      }
      continue
    }

    if (annotation.type === 'mosaic' || annotation.type === 'blur') {
      if (isPointInRect(point, normalizeRect(annotation.start, annotation.end), 8)) {
        return annotation.id
      }
      continue
    }

    if (annotation.type === 'text') {
      if (isPointInRect(point, getTextBounds(annotation), 8)) {
        return annotation.id
      }
      continue
    }

    if (annotation.type === 'step') {
      const radius = Math.max(14, annotation.size * 0.7)
      if (Math.hypot(point.x - annotation.point.x, point.y - annotation.point.y) <= radius + 8) {
        return annotation.id
      }
    }
  }

  return null
}

function annotationHasRenderableArea(annotation: Annotation) {
  if (isStrokeAnnotation(annotation)) {
    return annotation.points.length > 1
  }

  if (annotation.type === 'text') {
    return annotation.text.trim().length > 0
  }

  if (annotation.type === 'step') {
    return annotation.value.trim().length > 0
  }

  const rect = normalizeRect(annotation.start, annotation.end)
  return rect.width > 4 || rect.height > 4
}

function moveAnnotation(annotation: Annotation, delta: Point): Annotation {
  if (isStrokeAnnotation(annotation)) {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({
        x: point.x + delta.x,
        y: point.y + delta.y
      }))
    }
  }

  if (annotation.type === 'text' || annotation.type === 'step') {
    return {
      ...annotation,
      point: {
        x: annotation.point.x + delta.x,
        y: annotation.point.y + delta.y
      }
    }
  }

  return {
    ...annotation,
    start: {
      x: annotation.start.x + delta.x,
      y: annotation.start.y + delta.y
    },
    end: {
      x: annotation.end.x + delta.x,
      y: annotation.end.y + delta.y
    }
  }
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  size: number
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const length = Math.max(14, size * 4.4)

  context.save()
  context.beginPath()
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - length * Math.cos(angle - Math.PI / 7),
    end.y - length * Math.sin(angle - Math.PI / 7)
  )
  context.lineTo(
    end.x - length * Math.cos(angle + Math.PI / 7),
    end.y - length * Math.sin(angle + Math.PI / 7)
  )
  context.closePath()
  context.fillStyle = context.strokeStyle
  context.fill()
  context.restore()
}

function pixelateRect(context: CanvasRenderingContext2D, rect: Rect, cellSize: number) {
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

function blurRect(context: CanvasRenderingContext2D, rect: Rect, radius: number) {
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

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
  context.closePath()
}

function drawTextAnnotation(context: CanvasRenderingContext2D, annotation: TextAnnotation) {
  const fontSize = Math.max(14, annotation.size)
  const lines = annotation.text.split(/\r?\n/).filter(Boolean)
  const displayLines = lines.length ? lines : ['']
  const lineHeight = fontSize * 1.25

  context.save()
  context.font = `700 ${fontSize}px "Segoe UI", "PingFang SC", sans-serif`
  context.textBaseline = 'top'

  const maxWidth = displayLines.reduce((largest, line) => {
    return Math.max(largest, context.measureText(line).width)
  }, 0)
  const paddingX = Math.max(8, fontSize * 0.28)
  const paddingY = Math.max(6, fontSize * 0.2)
  const blockWidth = Math.max(72, maxWidth + paddingX * 2)
  const blockHeight = displayLines.length * lineHeight + paddingY * 2

  drawRoundedRect(
    context,
    annotation.point.x,
    annotation.point.y,
    blockWidth,
    blockHeight,
    Math.max(8, fontSize * 0.18)
  )
  context.fillStyle = 'rgba(6, 11, 20, 0.42)'
  context.fill()

  context.lineJoin = 'round'
  context.lineWidth = Math.max(2, fontSize * 0.12)
  context.strokeStyle = 'rgba(6, 11, 20, 0.7)'
  context.fillStyle = annotation.color

  displayLines.forEach((line, index) => {
    const y = annotation.point.y + paddingY + index * lineHeight
    context.strokeText(line, annotation.point.x + paddingX, y)
    context.fillText(line, annotation.point.x + paddingX, y)
  })

  context.restore()
}

function drawStepAnnotation(context: CanvasRenderingContext2D, annotation: StepAnnotation) {
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
  context.font = `800 ${Math.max(14, radius)}px "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(annotation.value, annotation.point.x, annotation.point.y)
  context.restore()
}

function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation) {
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
    context.fillStyle = `${annotation.color}1f`
    context.strokeRect(rect.x, rect.y, rect.width, rect.height)
    context.fillRect(rect.x, rect.y, rect.width, rect.height)
  }

  if (annotation.type === 'ellipse') {
    const rect = normalizeRect(annotation.start, annotation.end)
    context.fillStyle = `${annotation.color}1f`
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
    context.fill()
    context.stroke()
  }

  if (annotation.type === 'line' || annotation.type === 'arrow') {
    context.beginPath()
    context.moveTo(annotation.start.x, annotation.start.y)
    context.lineTo(annotation.end.x, annotation.end.y)
    context.stroke()

    if (annotation.type === 'arrow') {
      drawArrowHead(context, annotation.start, annotation.end, annotation.size)
    }
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

function drawSelectionOverlay(context: CanvasRenderingContext2D, rect: Rect) {
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

function drawAnnotationHighlight(context: CanvasRenderingContext2D, annotation: Annotation) {
  const bounds = getAnnotationBounds(annotation)
  const margin = Math.max(5, annotation.size * 0.3)
  const x = bounds.x - margin
  const y = bounds.y - margin
  const width = bounds.width + margin * 2
  const height = bounds.height + margin * 2

  context.save()
  context.setLineDash([8, 5])
  context.lineWidth = Math.max(1.5, annotation.size * 0.12)
  context.strokeStyle = '#60a5fa'
  context.strokeRect(x, y, width, height)
  context.setLineDash([])

  const handleSize = Math.max(6, annotation.size * 0.35)
  const halfHandle = handleSize / 2
  context.fillStyle = '#60a5fa'
  const handles = [
    [x, y],
    [x + width, y],
    [x, y + height],
    [x + width, y + height]
  ]

  handles.forEach(([handleX, handleY]) => {
    context.fillRect(handleX - halfHandle, handleY - halfHandle, handleSize, handleSize)
  })
  context.restore()
}

function renderCanvas(args: {
  canvas: HTMLCanvasElement | null
  image: LoadedImage | null
  annotations: Annotation[]
  draft: Annotation | null
  cropRect: Rect | null
  selectedAnnotationId: string | null
}) {
  const { canvas, image, annotations, draft, cropRect, selectedAnnotationId } = args

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
      drawAnnotationHighlight(context, selectedAnnotation)
    }
  }
}

function exportPng(image: LoadedImage, annotations: Annotation[]) {
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

export default function App() {
  const mulby = useMulby(PLUGIN_ID)
  const canvasShellRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const activeDraftRef = useRef<Annotation | null>(null)
  const dragStartRef = useRef<Point | null>(null)
  const dragSnapshotRef = useRef<Annotation[] | null>(null)
  const dragMovedRef = useRef(false)
  const cropStartRef = useRef<Point | null>(null)
  const textEditSnapshotRef = useRef<Annotation[] | null>(null)
  const inlineTextEditRef = useRef<InlineTextEdit | null>(null)
  const inlineTextRef = useRef<HTMLTextAreaElement | null>(null)
  const inlineBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const imageLoadTokenRef = useRef(0)
  const resizeStateRef = useRef<{
    edge: ResizeEdge
    pointerId: number
    startX: number
    startY: number
    currentX: number
    currentY: number
    baseBounds: { x: number; y: number; width: number; height: number }
    rafId: number
  } | null>(null)
  const toolbarDragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    currentX: number
    currentY: number
    baseBounds: { x: number; y: number; width: number; height: number }
    rafId: number
  } | null>(null)

  const [image, setImage] = useState<LoadedImage | null>(null)
  const [pendingPreview, setPendingPreview] = useState<PendingPreview | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[0])
  const [strokeSize, setStrokeSize] = useState(5)
  const [textSize, setTextSize] = useState(28)
  const [stepSize, setStepSize] = useState(28)
  const [mosaicSize, setMosaicSize] = useState(18)
  const [blurSize, setBlurSize] = useState(14)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const [draggingAnnotationId, setDraggingAnnotationId] = useState<string | null>(null)
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  const [draftCropRect, setDraftCropRect] = useState<Rect | null>(null)
  const [inlineTextEdit, setInlineTextEdit] = useState<InlineTextEdit | null>(null)
  const [undoStack, setUndoStack] = useState<Annotation[][]>([])
  const [redoStack, setRedoStack] = useState<Annotation[][]>([])
  const [status, setStatus] = useState('等待截图')
  const [busy, setBusy] = useState<string | null>(null)
  const [canvasViewport, setCanvasViewport] = useState<DisplaySize>({ width: 0, height: 0 })

  const naturalDisplaySize = useMemo(() => {
    if (image) {
      return getDisplaySize(image)
    }

    return {
      width: pendingPreview?.displayWidth ?? 0,
      height: pendingPreview?.displayHeight ?? 0
    }
  }, [image, pendingPreview])

  const cssSize = useMemo(
    () => fitDisplaySize(naturalDisplaySize, canvasViewport),
    [canvasViewport, naturalDisplaySize]
  )

  const imageToCssScale = useMemo(() => {
    if (!image || !cssSize.width) {
      return 1
    }

    return cssSize.width / image.width
  }, [cssSize.width, image])

  const selectedAnnotation = useMemo(() => {
    if (!selectedAnnotationId) {
      return null
    }

    return annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null
  }, [annotations, selectedAnnotationId])

  const effectiveColor = selectedAnnotation?.color ?? color

  const toImageSize = useCallback(
    (visualSize: number) => Math.max(1, visualSize / Math.max(imageToCssScale, 0.01)),
    [imageToCssScale]
  )

  const toVisualSize = useCallback(
    (imageSize: number) => Math.round(imageSize * imageToCssScale),
    [imageToCssScale]
  )

  const replaceAnnotations = useCallback((
    next: Annotation[],
    options?: {
      recordHistory?: boolean
      keepRedo?: boolean
      historySnapshot?: Annotation[]
    }
  ) => {
    if (options?.recordHistory) {
      const snapshot = options.historySnapshot ?? annotationsRef.current
      setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), snapshot])
    }

    if (!options?.keepRedo) {
      setRedoStack([])
    }

    annotationsRef.current = next
    setAnnotations(next)
  }, [])

  const resolveWindowBounds = useCallback(
    async (displaySize: DisplaySize, region?: CaptureRegion) => {
      if (!region) {
        return buildConstrainedBounds({ displaySize })
      }

      try {
        const display = await mulby.screen.getDisplayMatching({
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height
        })

        return buildConstrainedBounds({
          displaySize,
          region,
          workArea: display.workArea ?? display.bounds
        })
      } catch {
        return buildConstrainedBounds({ displaySize, region })
      }
    },
    [mulby.screen]
  )

  const applyWindowBoundsForImage = useCallback(
    async (displaySize: DisplaySize, region?: CaptureRegion, shouldCenter = false) => {
      const bounds = await resolveWindowBounds(displaySize, region)
      await window.mulby?.window?.setBounds?.(bounds)

      if (shouldCenter) {
        window.mulby?.window?.center?.()
      }
    },
    [resolveWindowBounds]
  )

  const resetEditingState = useCallback(() => {
    activeDraftRef.current = null
    dragStartRef.current = null
    dragSnapshotRef.current = null
    dragMovedRef.current = false
    cropStartRef.current = null
    textEditSnapshotRef.current = null
    setDraft(null)
    setDraftCropRect(null)
    setCropRect(null)
    setInlineTextEdit(null)
    setSelectedAnnotationId(null)
    setDraggingAnnotationId(null)
  }, [])

  const loadTransformedImage = useCallback(
    async (dataUrl: string, baseImage: LoadedImage, nextStatus: string) => {
      const element = await loadImage(dataUrl)
      const nextImage: LoadedImage = {
        dataUrl,
        element,
        width: element.naturalWidth,
        height: element.naturalHeight,
        scaleFactor: baseImage.scaleFactor
      }

      setImage(nextImage)
      setPendingPreview(null)
      replaceAnnotations([], { keepRedo: false })
      setUndoStack([])
      setRedoStack([])
      resetEditingState()
      setStatus(nextStatus)
      void applyWindowBoundsForImage(getDisplaySize(nextImage), undefined, true)
    },
    [applyWindowBoundsForImage, replaceAnnotations, resetEditingState]
  )

  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])

  useEffect(() => {
    const shell = canvasShellRef.current
    if (!shell) {
      return
    }

    const updateViewport = () => {
      const rect = shell.getBoundingClientRect()
      setCanvasViewport({
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height))
      })
    }

    updateViewport()
    const observer = new ResizeObserver(updateViewport)
    observer.observe(shell)
    window.addEventListener('resize', updateViewport)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateViewport)
    }
  }, [])

  useEffect(() => {
    inlineTextEditRef.current = inlineTextEdit
  }, [inlineTextEdit])

  useEffect(() => {
    renderCanvas({
      canvas: canvasRef.current,
      image,
      annotations,
      draft,
      cropRect: draftCropRect ?? cropRect,
      selectedAnnotationId
    })
  }, [annotations, cropRect, draft, draftCropRect, image, selectedAnnotationId])

  useEffect(() => {
    document.documentElement.classList.add('transparent')
    window.mulby?.window?.setAlwaysOnTop?.(true)

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotationId && !isTyping) {
        event.preventDefault()
        replaceAnnotations(
          annotationsRef.current.filter((annotation) => annotation.id !== selectedAnnotationId),
          { recordHistory: true }
        )
        setSelectedAnnotationId(null)
        setStatus('已删除标注')
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !isTyping) {
        event.preventDefault()
        if (event.shiftKey) {
          setRedoStack((stack) => {
            const next = stack.at(-1)
            if (!next) {
              return stack
            }

            const current = annotationsRef.current
            setUndoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current])
            annotationsRef.current = next
            setAnnotations(next)
            setSelectedAnnotationId(null)
            setStatus('已重做')
            return stack.slice(0, -1)
          })
        } else {
          setUndoStack((stack) => {
            const previous = stack.at(-1)
            if (!previous) {
              return stack
            }

            const current = annotationsRef.current
            setRedoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current])
            annotationsRef.current = previous
            setAnnotations(previous)
            setSelectedAnnotationId(null)
            setStatus('已撤销')
            return stack.slice(0, -1)
          })
        }
        return
      }

      if (event.key === 'Escape' && !isTyping) {
        if (draft || draftCropRect || cropRect || selectedAnnotationId || draggingAnnotationId) {
          resetEditingState()
          setStatus('已取消选择')
          return
        }

        window.mulby?.window?.close()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (inlineBlurTimerRef.current) {
        clearTimeout(inlineBlurTimerRef.current)
      }
      if (resizeStateRef.current?.rafId) {
        cancelAnimationFrame(resizeStateRef.current.rafId)
      }
      if (toolbarDragStateRef.current?.rafId) {
        cancelAnimationFrame(toolbarDragStateRef.current.rafId)
      }
    }
  }, [
    cropRect,
    draft,
    draftCropRect,
    draggingAnnotationId,
    replaceAnnotations,
    resetEditingState,
    selectedAnnotationId
  ])

  useEffect(() => {
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const attachment = data.attachments?.find((item) => item.kind === 'image')
      if (!attachment?.dataUrl) {
        setStatus('没有收到截图')
        return
      }

      void (async () => {
        const token = imageLoadTokenRef.current + 1
        imageLoadTokenRef.current = token
        const dataUrl = attachment.dataUrl!
        const scaleFactor =
          attachment.capture?.region?.scaleFactor ??
          attachment.capture?.display?.scaleFactor ??
          window.devicePixelRatio ??
          1
        const region = attachment.capture?.region
        const previewSize = getPreviewDisplaySize({ region, scaleFactor })

        try {
          setImage(null)
          setPendingPreview({
            dataUrl,
            displayWidth: previewSize.width,
            displayHeight: previewSize.height
          })
          replaceAnnotations([], { keepRedo: false })
          setUndoStack([])
          setRedoStack([])
          resetEditingState()
          setStatus('正在载入截图')

          void applyWindowBoundsForImage(previewSize, region, !region)

          const element = await loadImage(dataUrl)
          if (imageLoadTokenRef.current !== token) {
            return
          }

          const nextImage: LoadedImage = {
            dataUrl,
            element,
            width: element.naturalWidth,
            height: element.naturalHeight,
            region,
            scaleFactor
          }

          setImage(nextImage)
          setPendingPreview(null)
          setStatus(`${element.naturalWidth} x ${element.naturalHeight}`)

          if (!region) {
            const displaySize = getDisplaySize(nextImage)
            void applyWindowBoundsForImage(displaySize, undefined, true)
          }
        } catch (error) {
          if (imageLoadTokenRef.current !== token) {
            return
          }
          const message = error instanceof Error ? error.message : '截图打开失败'
          setPendingPreview(null)
          setStatus(message)
          window.mulby?.notification?.show(message, 'error')
        }
      })()
    })
  }, [applyWindowBoundsForImage, replaceAnnotations, resetEditingState])

  useEffect(() => {
    if (inlineTextEdit && inlineTextRef.current) {
      requestAnimationFrame(() => inlineTextRef.current?.focus())
    }
  }, [inlineTextEdit?.id])

  const getPointFromClient = useCallback((clientX: number, clientY: number): Point => {
    const canvas = canvasRef.current
    if (!canvas) {
      return { x: 0, y: 0 }
    }

    const rect = canvas.getBoundingClientRect()
    return {
      x: clamp(((clientX - rect.left) / rect.width) * canvas.width, 0, canvas.width),
      y: clamp(((clientY - rect.top) / rect.height) * canvas.height, 0, canvas.height)
    }
  }, [])

  const flushToolbarDrag = useCallback(() => {
    const state = toolbarDragStateRef.current
    if (!state) {
      return
    }

    state.rafId = 0
    void mulby.window.setBounds({
      x: state.baseBounds.x + state.currentX - state.startX,
      y: state.baseBounds.y + state.currentY - state.startY,
      width: state.baseBounds.width,
      height: state.baseBounds.height
    })
  }, [mulby.window])

  const shouldStartToolbarDrag = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false
    }

    return !target.closest(
      [
        'button',
        'input',
        'textarea',
        'select',
        'a',
        '.icon-button',
        '.command-button',
        '.swatch',
        '.size-control',
        '.resize-handle'
      ].join(',')
    )
  }, [])

  const handleToolbarPointerDown = useCallback(
    async (event: ReactPointerEvent<HTMLElement>) => {
      if (busy || event.button !== 0 || !shouldStartToolbarDrag(event.target)) {
        return
      }

      event.preventDefault()
      const pointerTarget = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.screenX
      const startY = event.screenY
      const fallbackBounds = {
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight
      }
      const baseBounds = await mulby.window.getBounds().catch(() => fallbackBounds) ?? fallbackBounds

      toolbarDragStateRef.current = {
        pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        baseBounds,
        rafId: 0
      }

      pointerTarget.setPointerCapture(pointerId)
    },
    [busy, mulby.window, shouldStartToolbarDrag]
  )

  const handleToolbarPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = toolbarDragStateRef.current
      if (!state || state.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()
      state.currentX = event.screenX
      state.currentY = event.screenY

      if (!state.rafId) {
        state.rafId = requestAnimationFrame(flushToolbarDrag)
      }
    },
    [flushToolbarDrag]
  )

  const handleToolbarPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = toolbarDragStateRef.current
      if (!state || state.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()

      if (state.rafId) {
        cancelAnimationFrame(state.rafId)
        state.rafId = 0
      }

      void mulby.window.setBounds({
        x: state.baseBounds.x + state.currentX - state.startX,
        y: state.baseBounds.y + state.currentY - state.startY,
        width: state.baseBounds.width,
        height: state.baseBounds.height
      })

      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore stale pointer capture.
      }

      toolbarDragStateRef.current = null
    },
    [mulby.window]
  )

  const flushResizeDrag = useCallback(() => {
    const state = resizeStateRef.current
    if (!state) {
      return
    }

    state.rafId = 0
    mulby.window.resizeDrag({
      edge: state.edge,
      startX: state.startX,
      startY: state.startY,
      currentX: state.currentX,
      currentY: state.currentY,
      baseBounds: state.baseBounds
    })
  }, [mulby.window])

  const handleResizePointerDown = useCallback(
    async (edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => {
      if (busy) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      const pointerTarget = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.screenX
      const startY = event.screenY

      const fallbackBounds = {
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight
      }
      const baseBounds = await mulby.window.getBounds().catch(() => fallbackBounds) ?? fallbackBounds

      resizeStateRef.current = {
        edge,
        pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        baseBounds,
        rafId: 0
      }

      pointerTarget.setPointerCapture(pointerId)
    },
    [busy, mulby.window]
  )

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = resizeStateRef.current
      if (!state || state.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      state.currentX = event.screenX
      state.currentY = event.screenY

      if (!state.rafId) {
        state.rafId = requestAnimationFrame(flushResizeDrag)
      }
    },
    [flushResizeDrag]
  )

  const handleResizePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current
    if (!state || state.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (state.rafId) {
      cancelAnimationFrame(state.rafId)
      state.rafId = 0
    }

    mulby.window.resizeDrag({
      edge: state.edge,
      startX: state.startX,
      startY: state.startY,
      currentX: state.currentX,
      currentY: state.currentY,
      baseBounds: state.baseBounds
    })

    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Ignore stale pointer capture.
    }

    resizeStateRef.current = null
  }, [mulby.window])

  const handleUndo = useCallback(() => {
    setUndoStack((stack) => {
      const previous = stack.at(-1)
      if (!previous) {
        return stack
      }

      const current = annotationsRef.current
      setRedoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current])
      annotationsRef.current = previous
      setAnnotations(previous)
      setSelectedAnnotationId(null)
      setStatus('已撤销')
      return stack.slice(0, -1)
    })
  }, [])

  const handleRedo = useCallback(() => {
    setRedoStack((stack) => {
      const next = stack.at(-1)
      if (!next) {
        return stack
      }

      const current = annotationsRef.current
      setUndoStack((history) => [...history.slice(-(HISTORY_LIMIT - 1)), current])
      annotationsRef.current = next
      setAnnotations(next)
      setSelectedAnnotationId(null)
      setStatus('已重做')
      return stack.slice(0, -1)
    })
  }, [])

  const commitInlineText = useCallback(() => {
    const currentEdit = inlineTextEditRef.current
    if (!currentEdit) {
      return
    }

    const text = currentEdit.text.trim()
    const baseSnapshot = textEditSnapshotRef.current
    const nextAnnotations = text
      ? [
          ...annotationsRef.current,
          {
            id: currentEdit.id,
            type: 'text' as const,
            point: currentEdit.point,
            text,
            color: currentEdit.color,
            size: currentEdit.size
          }
        ]
      : annotationsRef.current

    replaceAnnotations(nextAnnotations, {
      recordHistory: Boolean(text || baseSnapshot),
      historySnapshot: baseSnapshot ?? annotationsRef.current
    })
    inlineTextEditRef.current = null
    textEditSnapshotRef.current = null
    setInlineTextEdit(null)
    setSelectedAnnotationId(null)
    setStatus(text ? '已添加文字' : '已取消文字')
  }, [replaceAnnotations])

  const cancelInlineText = useCallback(() => {
    if (textEditSnapshotRef.current) {
      annotationsRef.current = textEditSnapshotRef.current
      setAnnotations(textEditSnapshotRef.current)
    }

    textEditSnapshotRef.current = null
    inlineTextEditRef.current = null
    setInlineTextEdit(null)
    setStatus('已取消文字')
  }, [])

  const startInlineTextEdit = useCallback((annotation: TextAnnotation) => {
    textEditSnapshotRef.current = annotationsRef.current
    const nextAnnotations = annotationsRef.current.filter((item) => item.id !== annotation.id)
    annotationsRef.current = nextAnnotations
    setAnnotations(nextAnnotations)
    setSelectedAnnotationId(null)
    setInlineTextEdit({
      id: annotation.id,
      point: annotation.point,
      text: annotation.text,
      color: annotation.color,
      size: annotation.size
    })
  }, [])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!image || busy) {
        return
      }

      const point = getPointFromClient(event.clientX, event.clientY)

      if (inlineTextEdit) {
        commitInlineText()
      }

      if (tool === 'select') {
        const hitId = hitTestAnnotation(point, annotationsRef.current)
        setSelectedAnnotationId(hitId)

        if (hitId) {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDraggingAnnotationId(hitId)
          dragStartRef.current = point
          dragSnapshotRef.current = annotationsRef.current
          dragMovedRef.current = false
          setStatus('拖动以移动标注')
        }
        return
      }

      if (tool === 'eraser') {
        const hitId = hitTestAnnotation(point, annotationsRef.current)
        if (hitId) {
          replaceAnnotations(
            annotationsRef.current.filter((annotation) => annotation.id !== hitId),
            { recordHistory: true }
          )
          setSelectedAnnotationId(null)
          setStatus('已删除标注')
        }
        return
      }

      if (tool === 'text') {
        const hitTextId = hitTestAnnotation(point, annotationsRef.current, 'text')
        const hitText = hitTextId
          ? annotationsRef.current.find((annotation) => annotation.id === hitTextId)
          : null

        if (hitText?.type === 'text') {
          startInlineTextEdit(hitText)
          return
        }

        setSelectedAnnotationId(null)
        setInlineTextEdit({
          id: createId('text'),
          point,
          text: '',
          color,
          size: toImageSize(textSize)
        })
        return
      }

      if (tool === 'step') {
        const nextValue = String(
          annotationsRef.current.filter((annotation) => annotation.type === 'step').length + 1
        )
        replaceAnnotations(
          [
            ...annotationsRef.current,
            {
              id: createId('step'),
              type: 'step',
              point,
              value: nextValue,
              color,
              size: toImageSize(stepSize)
            }
          ],
          { recordHistory: true }
        )
        setSelectedAnnotationId(null)
        setStatus(`已添加编号 ${nextValue}`)
        return
      }

      if (tool === 'crop') {
        event.currentTarget.setPointerCapture(event.pointerId)
        cropStartRef.current = point
        setSelectedAnnotationId(null)
        setDraftCropRect({ x: point.x, y: point.y, width: 0, height: 0 })
        setStatus('拖动选择裁剪区域')
        return
      }

      event.currentTarget.setPointerCapture(event.pointerId)
      dragStartRef.current = point
      setSelectedAnnotationId(null)

      const nextDraft: Annotation = (() => {
        if (tool === 'pen' || tool === 'highlighter') {
          return {
            id: createId(tool),
            type: tool,
            points: [point],
            color,
            size: toImageSize(strokeSize)
          }
        }

        if (tool === 'mosaic') {
          return {
            id: createId('mosaic'),
            type: 'mosaic',
            start: point,
            end: point,
            color,
            size: toImageSize(mosaicSize)
          }
        }

        if (tool === 'blur') {
          return {
            id: createId('blur'),
            type: 'blur',
            start: point,
            end: point,
            color,
            size: toImageSize(blurSize)
          }
        }

        return {
          id: createId(tool),
          type: tool,
          start: point,
          end: point,
          color,
          size: toImageSize(strokeSize)
        }
      })()

      activeDraftRef.current = nextDraft
      setDraft(nextDraft)
    },
    [
      blurSize,
      busy,
      color,
      commitInlineText,
      getPointFromClient,
      image,
      inlineTextEdit,
      mosaicSize,
      replaceAnnotations,
      stepSize,
      startInlineTextEdit,
      strokeSize,
      textSize,
      toImageSize,
      tool
    ]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!image) {
        return
      }

      const point = getPointFromClient(event.clientX, event.clientY)

      if (draggingAnnotationId && dragStartRef.current) {
        const delta = {
          x: point.x - dragStartRef.current.x,
          y: point.y - dragStartRef.current.y
        }

        if (delta.x !== 0 || delta.y !== 0) {
          const nextAnnotations = annotationsRef.current.map((annotation) => {
            return annotation.id === draggingAnnotationId ? moveAnnotation(annotation, delta) : annotation
          })
          annotationsRef.current = nextAnnotations
          setAnnotations(nextAnnotations)
          dragStartRef.current = point
          dragMovedRef.current = true
        }
        return
      }

      if (cropStartRef.current && draftCropRect) {
        setDraftCropRect(normalizeRect(cropStartRef.current, point))
        return
      }

      const currentDraft = activeDraftRef.current
      if (!currentDraft || !dragStartRef.current) {
        return
      }

      let nextDraft: Annotation

      if (isStrokeAnnotation(currentDraft)) {
        nextDraft = { ...currentDraft, points: [...currentDraft.points, point] }
      } else if (isDragAnnotation(currentDraft)) {
        nextDraft = { ...currentDraft, end: point }
      } else {
        nextDraft = currentDraft
      }

      activeDraftRef.current = nextDraft
      setDraft(nextDraft)
    },
    [draftCropRect, draggingAnnotationId, getPointFromClient, image]
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture may already be released when the pointer leaves the canvas.
      }

      if (draggingAnnotationId) {
        if (dragMovedRef.current && dragSnapshotRef.current) {
          setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), dragSnapshotRef.current!])
          setRedoStack([])
          setStatus('已移动标注')
        }

        setDraggingAnnotationId(null)
        dragStartRef.current = null
        dragSnapshotRef.current = null
        dragMovedRef.current = false
        return
      }

      if (draftCropRect) {
        if (draftCropRect.width > 6 && draftCropRect.height > 6) {
          setCropRect(draftCropRect)
          setStatus('裁剪选区已更新')
        }
        setDraftCropRect(null)
        cropStartRef.current = null
        return
      }

      const currentDraft = activeDraftRef.current
      if (!currentDraft) {
        return
      }

      activeDraftRef.current = null
      dragStartRef.current = null
      setDraft(null)

      if (annotationHasRenderableArea(currentDraft)) {
        replaceAnnotations([...annotationsRef.current, currentDraft], { recordHistory: true })
        setStatus('已添加标注')
      }
    },
    [draftCropRect, draggingAnnotationId, replaceAnnotations]
  )

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Ignore stale pointer capture.
    }

    activeDraftRef.current = null
    dragStartRef.current = null
    cropStartRef.current = null
    setDraft(null)
    setDraftCropRect(null)
    setDraggingAnnotationId(null)
  }, [])

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!image || tool !== 'text') {
        return
      }

      const point = getPointFromClient(event.clientX, event.clientY)
      const hitId = hitTestAnnotation(point, annotationsRef.current, 'text')
      if (!hitId) {
        return
      }

      const annotation = annotationsRef.current.find((item) => item.id === hitId)
      if (annotation?.type === 'text') {
        startInlineTextEdit(annotation)
      }
    },
    [getPointFromClient, image, startInlineTextEdit, tool]
  )

  const handleClear = useCallback(() => {
    if (annotationsRef.current.length === 0) {
      return
    }

    replaceAnnotations([], { recordHistory: true })
    setSelectedAnnotationId(null)
    setStatus('已清空')
  }, [replaceAnnotations])

  const handleCopy = useCallback(async () => {
    if (!image) {
      return
    }

    if (inlineTextEdit) {
      commitInlineText()
    }

    try {
      await mulby.clipboard.writeImage(exportPng(image, annotationsRef.current))
      setStatus('已复制')
      mulby.notification.show('已复制到剪贴板', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }, [commitInlineText, image, inlineTextEdit, mulby.clipboard, mulby.notification])

  const handleSave = useCallback(async () => {
    if (!image) {
      return
    }

    if (inlineTextEdit) {
      commitInlineText()
    }

    try {
      const pickedPath = await mulby.dialog.showSaveDialog({
        title: '保存标注截图',
        defaultPath: defaultFileName(),
        buttonLabel: '保存',
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })

      if (!pickedPath) {
        return
      }

      const finalPath = ensurePngPath(pickedPath)
      await mulby.filesystem.writeFile(
        finalPath,
        dataUrlToBase64(exportPng(image, annotationsRef.current)),
        'base64'
      )
      setStatus('已保存')
      mulby.notification.show('已保存截图', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }, [
    commitInlineText,
    image,
    inlineTextEdit,
    mulby.dialog,
    mulby.filesystem,
    mulby.notification
  ])

  const runSharpTransform = useCallback(
    async (
      busyLabel: string,
      successLabel: string,
      transform: (pipeline: MulbySharpProxy) => Promise<ArrayBuffer>
    ) => {
      if (!image) {
        return
      }

      const sharpApi = window.mulby.sharp as MulbySharpFunction | undefined
      if (!sharpApi) {
        mulby.notification.show('当前环境没有可用的 sharp API', 'warning')
        return
      }

      if (inlineTextEdit) {
        commitInlineText()
      }

      setBusy(busyLabel)
      setStatus(busyLabel)

      try {
        const currentDataUrl = exportPng(image, annotationsRef.current)
        const output = await transform(sharpApi(dataUrlToArrayBuffer(currentDataUrl)))
        await loadTransformedImage(arrayBufferToDataUrl(output), image, successLabel)
        mulby.notification.show(successLabel, 'success')
      } catch (error) {
        const message = error instanceof Error ? error.message : `${busyLabel}失败`
        setStatus(message)
        mulby.notification.show(message, 'error')
      } finally {
        setBusy(null)
      }
    },
    [commitInlineText, image, inlineTextEdit, loadTransformedImage, mulby.notification]
  )

  const applyCropSelection = useCallback(async () => {
    if (!cropRect) {
      mulby.notification.show('请先拉出裁剪选区', 'warning')
      return
    }

    const safeSelection = {
      left: Math.max(0, Math.floor(cropRect.x)),
      top: Math.max(0, Math.floor(cropRect.y)),
      width: Math.max(1, Math.floor(cropRect.width)),
      height: Math.max(1, Math.floor(cropRect.height))
    }

    await runSharpTransform('正在裁剪', '已裁剪到选区', async (pipeline) =>
      pipeline.extract(safeSelection).png().toBuffer()
    )
  }, [cropRect, mulby.notification, runSharpTransform])

  const rotateLeft = useCallback(async () => {
    await runSharpTransform('正在向左旋转', '已向左旋转', async (pipeline) =>
      pipeline.rotate(-90).png().toBuffer()
    )
  }, [runSharpTransform])

  const rotateRight = useCallback(async () => {
    await runSharpTransform('正在向右旋转', '已向右旋转', async (pipeline) =>
      pipeline.rotate(90).png().toBuffer()
    )
  }, [runSharpTransform])

  const flipHorizontal = useCallback(async () => {
    await runSharpTransform('正在水平翻转', '已水平翻转', async (pipeline) =>
      pipeline.flop().png().toBuffer()
    )
  }, [runSharpTransform])

  const flipVertical = useCallback(async () => {
    await runSharpTransform('正在垂直翻转', '已垂直翻转', async (pipeline) =>
      pipeline.flip().png().toBuffer()
    )
  }, [runSharpTransform])

  const applyGreyscale = useCallback(async () => {
    await runSharpTransform('正在转换灰度', '已转换为灰度', async (pipeline) =>
      pipeline.grayscale().png().toBuffer()
    )
  }, [runSharpTransform])

  const applyEnhance = useCallback(async () => {
    await runSharpTransform('正在增强画面', '已完成增强', async (pipeline) =>
      pipeline.normalize().sharpen({ sigma: 1.1 }).png().toBuffer()
    )
  }, [runSharpTransform])

  const updateSelectedAnnotation = useCallback(
    (patch: Partial<Pick<Annotation, 'color' | 'size'>>) => {
      if (!selectedAnnotationId) {
        return
      }

      const nextAnnotations = annotationsRef.current.map((annotation) => {
        return annotation.id === selectedAnnotationId ? ({ ...annotation, ...patch } as Annotation) : annotation
      })
      replaceAnnotations(nextAnnotations, { recordHistory: true })
      setStatus('已更新标注')
    },
    [replaceAnnotations, selectedAnnotationId]
  )

  const activeRange = useMemo(() => {
    const targetType = selectedAnnotation?.type ?? tool

    if (targetType === 'text') {
      return {
        label: '字号',
        min: 14,
        max: 64,
        value: selectedAnnotation ? toVisualSize(selectedAnnotation.size) : textSize,
        onChange: (nextValue: number) => {
          setTextSize(nextValue)
          if (selectedAnnotation) {
            updateSelectedAnnotation({ size: toImageSize(nextValue) })
          }
        }
      }
    }

    if (targetType === 'step') {
      return {
        label: '编号',
        min: 18,
        max: 64,
        value: selectedAnnotation ? toVisualSize(selectedAnnotation.size) : stepSize,
        onChange: (nextValue: number) => {
          setStepSize(nextValue)
          if (selectedAnnotation) {
            updateSelectedAnnotation({ size: toImageSize(nextValue) })
          }
        }
      }
    }

    if (targetType === 'mosaic') {
      return {
        label: '颗粒',
        min: 6,
        max: 42,
        value: selectedAnnotation ? toVisualSize(selectedAnnotation.size) : mosaicSize,
        onChange: (nextValue: number) => {
          setMosaicSize(nextValue)
          if (selectedAnnotation) {
            updateSelectedAnnotation({ size: toImageSize(nextValue) })
          }
        }
      }
    }

    if (targetType === 'blur') {
      return {
        label: '模糊',
        min: 4,
        max: 32,
        value: selectedAnnotation ? toVisualSize(selectedAnnotation.size) : blurSize,
        onChange: (nextValue: number) => {
          setBlurSize(nextValue)
          if (selectedAnnotation) {
            updateSelectedAnnotation({ size: toImageSize(nextValue) })
          }
        }
      }
    }

    return {
      label: '线宽',
      min: 2,
      max: 22,
      value: selectedAnnotation ? toVisualSize(selectedAnnotation.size) : strokeSize,
      onChange: (nextValue: number) => {
        setStrokeSize(nextValue)
        if (selectedAnnotation) {
          updateSelectedAnnotation({ size: toImageSize(nextValue) })
        }
      }
    }
  }, [
    blurSize,
    mosaicSize,
    selectedAnnotation,
    stepSize,
    strokeSize,
    textSize,
    toImageSize,
    tool,
    toVisualSize,
    updateSelectedAnnotation
  ])

  const toolItems: Array<{ key: Tool; icon: LucideIcon; label: string }> = [
    { key: 'select', icon: MousePointer2, label: '选择/移动' },
    { key: 'line', icon: Minus, label: '直线' },
    { key: 'rect', icon: Square, label: '矩形' },
    { key: 'ellipse', icon: Circle, label: '圆形' },
    { key: 'arrow', icon: MoveRight, label: '箭头' },
    { key: 'pen', icon: Pencil, label: '画笔' },
    { key: 'highlighter', icon: Highlighter, label: '高亮' },
    { key: 'text', icon: TypeIcon, label: '文字' },
    { key: 'step', icon: Hash, label: '编号' },
    { key: 'mosaic', icon: Grid3x3, label: '马赛克' },
    { key: 'blur', icon: Droplets, label: '模糊' },
    { key: 'crop', icon: Crop, label: '裁剪选区' },
    { key: 'eraser', icon: Eraser, label: '橡皮擦' }
  ]

  const hasSharp = Boolean(window.mulby?.sharp)
  const canEditImage = Boolean(image && hasSharp && !busy)
  const hasVisualContent = Boolean(image || pendingPreview)
  const inlineTextPosition = inlineTextEdit && image
    ? {
        left: inlineTextEdit.point.x * imageToCssScale,
        top: inlineTextEdit.point.y * imageToCssScale,
        fontSize: Math.max(14, inlineTextEdit.size * imageToCssScale)
      }
    : null

  return (
    <div className={`annotator-root ${hasVisualContent ? '' : 'is-empty'}`}>
      <main
        ref={canvasShellRef}
        className="canvas-shell"
      >
        {image ? (
          <div
            className="canvas-stack"
            style={{
              width: cssSize.width,
              height: cssSize.height
            }}
          >
            <canvas
              ref={canvasRef}
              className={`annotation-canvas tool-${tool}`}
              style={{
                width: cssSize.width,
                height: cssSize.height,
                cursor: draggingAnnotationId ? 'grabbing' : undefined
              }}
              onDoubleClick={handleDoubleClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerLeave={handlePointerUp}
            />
            {inlineTextEdit && inlineTextPosition && (
              <textarea
                ref={inlineTextRef}
                className="inline-text-editor"
                style={{
                  left: inlineTextPosition.left,
                  top: inlineTextPosition.top,
                  fontSize: inlineTextPosition.fontSize,
                  color: inlineTextEdit.color,
                  minWidth: Math.max(120, inlineTextPosition.fontSize * 4)
                }}
                value={inlineTextEdit.text}
                onChange={(event) => {
                  setInlineTextEdit((current) => (
                    current ? { ...current, text: event.target.value } : null
                  ))
                }}
                onBlur={() => {
                  inlineBlurTimerRef.current = setTimeout(() => {
                    inlineBlurTimerRef.current = null
                    commitInlineText()
                  }, 80)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    if (inlineBlurTimerRef.current) {
                      clearTimeout(inlineBlurTimerRef.current)
                      inlineBlurTimerRef.current = null
                    }
                    cancelInlineText()
                  }
                  event.stopPropagation()
                }}
                placeholder="输入文字"
              />
            )}
          </div>
        ) : pendingPreview ? (
          <div
            className="canvas-stack pending-preview"
            style={{
              width: cssSize.width,
              height: cssSize.height
            }}
          >
            <img
              className="screenshot-preview"
              src={pendingPreview.dataUrl}
              alt="截图预览"
              draggable={false}
            />
          </div>
        ) : (
          <div className="empty-state" aria-label={status} />
        )}
      </main>

      {hasVisualContent && (
        <footer
          className="toolbar"
          onPointerDown={(event) => void handleToolbarPointerDown(event)}
          onPointerMove={handleToolbarPointerMove}
          onPointerUp={handleToolbarPointerUp}
          onPointerCancel={handleToolbarPointerUp}
        >
          <div className="toolbar-row">
            <div className="tool-group primary-tools">
              {toolItems.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.key}
                    className={`icon-button ${tool === item.key ? 'is-active' : ''}`}
                    title={item.label}
                    type="button"
                    onClick={() => {
                      if (inlineTextEdit && item.key !== 'text') {
                        commitInlineText()
                      }
                      setTool(item.key)
                      if (item.key !== 'select') {
                        setSelectedAnnotationId(null)
                      }
                    }}
                  >
                    <Icon size={18} />
                  </button>
                )
              })}
            </div>
            <div className="status-line">{busy ?? status}</div>
          </div>

          <div className="toolbar-row">
            <div className="tool-group color-group" aria-label="颜色">
              {COLORS.map((item) => (
                <button
                  key={item}
                  className={`swatch ${effectiveColor === item ? 'is-active' : ''}`}
                  style={{ backgroundColor: item }}
                  title={item}
                  type="button"
                  onClick={() => {
                    setColor(item)
                    if (selectedAnnotation) {
                      updateSelectedAnnotation({ color: item })
                    }
                  }}
                />
              ))}
            </div>

            <label className="size-control" title={activeRange.label}>
              <span>{activeRange.label}</span>
              <strong>{activeRange.value}</strong>
              <input
                min={activeRange.min}
                max={activeRange.max}
                type="range"
                value={clamp(activeRange.value, activeRange.min, activeRange.max)}
                onChange={(event) => activeRange.onChange(Number(event.target.value))}
              />
            </label>

            <div className="tool-group history-group">
              <button className="icon-button" title="撤销" type="button" onClick={handleUndo} disabled={!undoStack.length}>
                <Undo2 size={18} />
              </button>
              <button className="icon-button" title="重做" type="button" onClick={handleRedo} disabled={!redoStack.length}>
                <Redo2 size={18} />
              </button>
              <button className="icon-button" title="清空标注" type="button" onClick={handleClear} disabled={!annotations.length}>
                <Trash2 size={18} />
              </button>
            </div>

            <div className="tool-group adjust-group">
              <button
                className="icon-button"
                title="应用裁剪"
                type="button"
                onClick={() => void applyCropSelection()}
                disabled={!canEditImage || !cropRect}
              >
                <Crop size={17} />
              </button>
              <button
                className="icon-button"
                title="清除裁剪选区"
                type="button"
                onClick={() => {
                  setCropRect(null)
                  setDraftCropRect(null)
                  setStatus('已清除裁剪选区')
                }}
                disabled={!cropRect && !draftCropRect}
              >
                <X size={17} />
              </button>
              <button className="icon-button" title="向左旋转" type="button" onClick={() => void rotateLeft()} disabled={!canEditImage}>
                <RotateCcw size={17} />
              </button>
              <button className="icon-button" title="向右旋转" type="button" onClick={() => void rotateRight()} disabled={!canEditImage}>
                <RotateCw size={17} />
              </button>
              <button className="icon-button" title="水平翻转" type="button" onClick={() => void flipHorizontal()} disabled={!canEditImage}>
                <FlipHorizontal size={17} />
              </button>
              <button className="icon-button" title="垂直翻转" type="button" onClick={() => void flipVertical()} disabled={!canEditImage}>
                <FlipVertical size={17} />
              </button>
              <button className="icon-button" title="灰度" type="button" onClick={() => void applyGreyscale()} disabled={!canEditImage}>
                <Circle size={17} />
              </button>
              <button className="icon-button" title="增强" type="button" onClick={() => void applyEnhance()} disabled={!canEditImage}>
                <Sparkles size={17} />
              </button>
            </div>

            <div className="tool-group command-group">
              <button className="command-button" type="button" onClick={() => void handleCopy()} disabled={!image || Boolean(busy)}>
                <Clipboard size={17} />
                复制
              </button>
              <button className="command-button" type="button" onClick={() => void handleSave()} disabled={!image || Boolean(busy)}>
                <Save size={17} />
                保存
              </button>
              <button className="icon-button close-button" title="关闭" type="button" onClick={() => mulby.window.close()}>
                <X size={18} />
              </button>
            </div>
          </div>
        </footer>
      )}

      <div className="resize-layer" aria-hidden="true">
        {RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`resize-handle resize-${edge}`}
            onPointerDown={(event) => void handleResizePointerDown(edge, event)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
            onPointerCancel={handleResizePointerUp}
          />
        ))}
      </div>
    </div>
  )
}
