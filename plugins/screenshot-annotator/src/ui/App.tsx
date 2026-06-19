import {
  Bot,
  Circle,
  Clipboard,
  Crop,
  Droplets,
  Eraser,
  FlipHorizontal,
  FlipVertical,
  Grid3x3,
  Hash,
  History as HistoryIcon,
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
import HistoryView from './HistoryView'
import {
  createHistoryItem,
  loadHistoryItem,
  updateHistoryItem,
  type ScreenshotHistoryItem
} from './history'
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
  boxWidth?: number
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
  input?: string
  route?: string
  attachments?: PluginAttachment[]
}

type AppMode = 'annotate' | 'history'

type LoadedImage = {
  dataUrl: string
  element: HTMLImageElement
  width: number
  height: number
  region?: CaptureRegion
  capture?: PluginAttachment['capture']
  displaySize?: DisplaySize
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
  boxWidth: number
  insertIndex: number
}

type InlineStepEdit = {
  id: string
  point: Point
  value: string
  color: string
  size: number
}

type ResizeHandle =
  | 'resize-n'
  | 'resize-ne'
  | 'resize-e'
  | 'resize-se'
  | 'resize-s'
  | 'resize-sw'
  | 'resize-w'
  | 'resize-nw'

type EditHandleMode = 'move' | 'line-start' | 'line-end' | 'text-width' | ResizeHandle

type EditHandle = {
  id: string
  mode: EditHandleMode
}

type EditDragState = EditHandle & {
  pointerId: number
  startPoint: Point
  snapshot: Annotation
  annotationsSnapshot: Annotation[]
  moved: boolean
}

const PLUGIN_ID = 'screenshot-annotator'
const TOOLBAR_HEIGHT = 96
const TOOLBAR_MIN_WIDTH = 1080
const HISTORY_LIMIT = 30
const EDIT_HANDLE_VISUAL_SIZE = 10
const EDIT_HANDLE_HIT_VISUAL_SIZE = 18
const TEXT_BOX_DEFAULT_VISUAL_WIDTH = 240
const TEXT_BOX_MIN_WIDTH = 72
const STEP_LABEL_MAX_LENGTH = 6
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

function appendSearchParams(params: URLSearchParams, search: string) {
  const query = search.startsWith('?') ? search.slice(1) : search
  if (!query) {
    return
  }

  new URLSearchParams(query).forEach((value, key) => {
    params.set(key, value)
  })
}

function collectLaunchParams(route?: string) {
  const params = new URLSearchParams()
  appendSearchParams(params, window.location.search)

  const hashQueryIndex = window.location.hash.indexOf('?')
  if (hashQueryIndex >= 0) {
    appendSearchParams(params, window.location.hash.slice(hashQueryIndex + 1))
  }

  if (route) {
    const routeQueryIndex = route.indexOf('?')
    if (routeQueryIndex >= 0) {
      appendSearchParams(params, route.slice(routeQueryIndex + 1))
    } else if (route.startsWith('?')) {
      appendSearchParams(params, route.slice(1))
    }
  }

  return params
}

function parseLaunchMode(data?: Pick<PluginInitData, 'featureCode' | 'route'>): {
  mode: AppMode
  historyItemId?: string
} {
  const params = collectLaunchParams(data?.route)
  const route = data?.route ?? ''
  const modeParam = params.get('mode')
  const historyItemId = params.get('historyItemId') ?? undefined

  if (historyItemId) {
    return { mode: 'annotate', historyItemId }
  }

  if (
    data?.featureCode === 'history' ||
    modeParam === 'history' ||
    route === 'history' ||
    route.endsWith('/history')
  ) {
    return { mode: 'history' }
  }

  return { mode: 'annotate' }
}

function getInitialMode(): AppMode {
  return parseLaunchMode().mode
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
  if (image.displaySize?.width && image.displaySize.height) {
    return image.displaySize
  }

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

function isPointNearRectStroke(point: Point, rect: Rect, tolerance: number) {
  if (rect.width <= 0 || rect.height <= 0) {
    return false
  }

  const insideOuter = isPointInRect(point, rect, tolerance)
  const insideInner =
    rect.width > tolerance * 2 &&
    rect.height > tolerance * 2 &&
    isPointInRect(
      point,
      {
        x: rect.x + tolerance,
        y: rect.y + tolerance,
        width: rect.width - tolerance * 2,
        height: rect.height - tolerance * 2
      }
    )

  return insideOuter && !insideInner
}

function isPointNearEllipseStroke(point: Point, rect: Rect, tolerance: number) {
  const radiusX = rect.width / 2
  const radiusY = rect.height / 2

  if (radiusX <= 0 || radiusY <= 0) {
    return false
  }

  const centerX = rect.x + radiusX
  const centerY = rect.y + radiusY
  const normalizedDistance = Math.hypot(
    (point.x - centerX) / radiusX,
    (point.y - centerY) / radiusY
  )
  const normalizedTolerance = tolerance / Math.max(1, Math.min(radiusX, radiusY))

  return Math.abs(normalizedDistance - 1) <= normalizedTolerance
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

function getEditableAnnotationTypeForTool(tool: Tool): Annotation['type'] | null {
  if (
    tool === 'line' ||
    tool === 'rect' ||
    tool === 'ellipse' ||
    tool === 'arrow' ||
    tool === 'pen' ||
    tool === 'highlighter' ||
    tool === 'text' ||
    tool === 'step' ||
    tool === 'mosaic' ||
    tool === 'blur'
  ) {
    return tool
  }

  return null
}

function visualSizeToImageSize(visualSize: number, imageToCssScale: number) {
  return Math.max(1, visualSize / Math.max(imageToCssScale, 0.01))
}

function isWideTextCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  )
}

function estimateTextWidth(text: string, fontSize: number) {
  return Array.from(text).reduce((width, character) => {
    if (character === ' ') {
      return width + fontSize * 0.34
    }

    if (isWideTextCharacter(character)) {
      return width + fontSize
    }

    return width + fontSize * 0.58
  }, 0)
}

function getTextBoxWidth(annotation: TextAnnotation) {
  const fontSize = Math.max(14, annotation.size)

  if (annotation.boxWidth && Number.isFinite(annotation.boxWidth)) {
    return Math.max(TEXT_BOX_MIN_WIDTH, fontSize * 4, annotation.boxWidth)
  }

  const paddingX = Math.max(8, fontSize * 0.28)
  const estimatedWidth = annotation.text.split(/\r?\n/).reduce((maxWidth, line) => {
    return Math.max(maxWidth, estimateTextWidth(line, fontSize))
  }, 0)

  return Math.max(TEXT_BOX_MIN_WIDTH, fontSize * 4, estimatedWidth + paddingX * 2)
}

function wrapTextParagraph(
  paragraph: string,
  maxWidth: number,
  measureText: (text: string) => number
) {
  if (!paragraph) {
    return ['']
  }

  const lines: string[] = []
  let currentLine = ''

  Array.from(paragraph.replace(/\t/g, ' ')).forEach((character) => {
    const nextLine = `${currentLine}${character}`
    if (currentLine && measureText(nextLine) > maxWidth) {
      lines.push(currentLine.trimEnd())
      currentLine = character.trimStart()
      return
    }

    currentLine = nextLine
  })

  lines.push(currentLine.trimEnd())
  return lines
}

function getWrappedTextLines(
  annotation: TextAnnotation,
  measureText?: (text: string) => number
) {
  const fontSize = Math.max(14, annotation.size)
  const paddingX = Math.max(8, fontSize * 0.28)
  const boxWidth = getTextBoxWidth(annotation)
  const maxLineWidth = Math.max(fontSize, boxWidth - paddingX * 2)
  const measure = measureText ?? ((line: string) => estimateTextWidth(line, fontSize))
  const lines = annotation.text.split(/\r?\n/).flatMap((paragraph) =>
    wrapTextParagraph(paragraph, maxLineWidth, measure)
  )

  return lines.length ? lines : ['']
}

function getTextBounds(annotation: TextAnnotation): Rect {
  const fontSize = Math.max(14, annotation.size)
  const paddingX = Math.max(8, fontSize * 0.28)
  const paddingY = Math.max(6, fontSize * 0.2)
  const lineHeight = fontSize * 1.25
  const displayLines = getWrappedTextLines(annotation)

  return {
    x: annotation.point.x,
    y: annotation.point.y,
    width: Math.max(TEXT_BOX_MIN_WIDTH, getTextBoxWidth(annotation), paddingX * 2),
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

    if (annotation.type === 'rect') {
      if (isPointNearRectStroke(point, normalizeRect(annotation.start, annotation.end), annotation.size + 8)) {
        return annotation.id
      }
      continue
    }

    if (annotation.type === 'ellipse') {
      if (isPointNearEllipseStroke(point, normalizeRect(annotation.start, annotation.end), annotation.size + 8)) {
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

function snapPointTo45Degrees(origin: Point, point: Point): Point {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const length = Math.hypot(dx, dy)

  if (length === 0) {
    return point
  }

  const snappedAngle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return {
    x: origin.x + Math.cos(snappedAngle) * length,
    y: origin.y + Math.sin(snappedAngle) * length
  }
}

function snapPointToSquare(origin: Point, point: Point): Point {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const side = Math.max(Math.abs(dx), Math.abs(dy))

  return {
    x: origin.x + (dx < 0 ? -side : side),
    y: origin.y + (dy < 0 ? -side : side)
  }
}

function getResizeHandlePoints(rect: Rect): Array<{ mode: ResizeHandle; point: Point }> {
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y
  const bottom = rect.y + rect.height
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2

  return [
    { mode: 'resize-nw', point: { x: left, y: top } },
    { mode: 'resize-n', point: { x: centerX, y: top } },
    { mode: 'resize-ne', point: { x: right, y: top } },
    { mode: 'resize-e', point: { x: right, y: centerY } },
    { mode: 'resize-se', point: { x: right, y: bottom } },
    { mode: 'resize-s', point: { x: centerX, y: bottom } },
    { mode: 'resize-sw', point: { x: left, y: bottom } },
    { mode: 'resize-w', point: { x: left, y: centerY } }
  ]
}

function resizeRectFromHandle(rect: Rect, mode: ResizeHandle, point: Point, keepSquare: boolean) {
  const handle = mode.replace('resize-', '')
  let left = rect.x
  let right = rect.x + rect.width
  let top = rect.y
  let bottom = rect.y + rect.height
  const isCorner = handle.length === 2
  const minSize = 4

  if (keepSquare && isCorner) {
    const fixedCorner = {
      x: handle.includes('w') ? right : left,
      y: handle.includes('n') ? bottom : top
    }
    const controlledPoint = snapPointToSquare(fixedCorner, point)

    if (handle.includes('w')) {
      left = controlledPoint.x
    } else {
      right = controlledPoint.x
    }

    if (handle.includes('n')) {
      top = controlledPoint.y
    } else {
      bottom = controlledPoint.y
    }
  } else {
    if (handle.includes('w')) {
      left = point.x
    }
    if (handle.includes('e')) {
      right = point.x
    }
    if (handle.includes('n')) {
      top = point.y
    }
    if (handle.includes('s')) {
      bottom = point.y
    }
  }

  if (Math.abs(right - left) < minSize) {
    const direction = right >= left ? 1 : -1
    if (handle.includes('w')) {
      left = right - direction * minSize
    } else if (handle.includes('e')) {
      right = left + direction * minSize
    }
  }

  if (Math.abs(bottom - top) < minSize) {
    const direction = bottom >= top ? 1 : -1
    if (handle.includes('n')) {
      top = bottom - direction * minSize
    } else if (handle.includes('s')) {
      bottom = top + direction * minSize
    }
  }

  return {
    start: { x: left, y: top },
    end: { x: right, y: bottom }
  }
}

function resizeAnnotation(
  annotation: Annotation,
  mode: EditHandleMode,
  startPoint: Point,
  currentPoint: Point,
  modifiers: { shiftKey: boolean }
): Annotation {
  if (mode === 'move') {
    return moveAnnotation(annotation, {
      x: currentPoint.x - startPoint.x,
      y: currentPoint.y - startPoint.y
    })
  }

  if ((annotation.type === 'line' || annotation.type === 'arrow') && mode === 'line-start') {
    const nextStart = modifiers.shiftKey
      ? snapPointTo45Degrees(annotation.end, currentPoint)
      : currentPoint
    return { ...annotation, start: nextStart }
  }

  if ((annotation.type === 'line' || annotation.type === 'arrow') && mode === 'line-end') {
    const nextEnd = modifiers.shiftKey
      ? snapPointTo45Degrees(annotation.start, currentPoint)
      : currentPoint
    return { ...annotation, end: nextEnd }
  }

  if ((annotation.type === 'rect' || annotation.type === 'ellipse') && mode.startsWith('resize-')) {
    const nextRect = resizeRectFromHandle(
      normalizeRect(annotation.start, annotation.end),
      mode as ResizeHandle,
      currentPoint,
      modifiers.shiftKey
    )
    return { ...annotation, ...nextRect }
  }

  if (annotation.type === 'text' && mode === 'text-width') {
    return {
      ...annotation,
      boxWidth: Math.max(TEXT_BOX_MIN_WIDTH, currentPoint.x - annotation.point.x)
    }
  }

  return annotation
}

function isPointInHandle(point: Point, handlePoint: Point, handleSize: number) {
  const halfSize = handleSize / 2
  return isPointInRect(
    point,
    {
      x: handlePoint.x - halfSize,
      y: handlePoint.y - halfSize,
      width: handleSize,
      height: handleSize
    }
  )
}

function hitTestEditHandle(
  point: Point,
  annotation: Annotation,
  imageToCssScale: number,
  includeMove = true
): EditHandle | null {
  const hitSize = visualSizeToImageSize(EDIT_HANDLE_HIT_VISUAL_SIZE, imageToCssScale)
  const hitRadius = hitSize / 2

  if (annotation.type === 'line' || annotation.type === 'arrow') {
    if (Math.hypot(point.x - annotation.start.x, point.y - annotation.start.y) <= hitRadius) {
      return { id: annotation.id, mode: 'line-start' }
    }

    if (Math.hypot(point.x - annotation.end.x, point.y - annotation.end.y) <= hitRadius) {
      return { id: annotation.id, mode: 'line-end' }
    }
  }

  if (annotation.type === 'rect' || annotation.type === 'ellipse') {
    const hitHandle = getResizeHandlePoints(normalizeRect(annotation.start, annotation.end)).find((handle) =>
      isPointInHandle(point, handle.point, hitSize)
    )

    if (hitHandle) {
      return { id: annotation.id, mode: hitHandle.mode }
    }
  }

  if (annotation.type === 'text') {
    const bounds = getTextBounds(annotation)
    const widthHandle = {
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height
    }

    if (isPointInHandle(point, widthHandle, hitSize)) {
      return { id: annotation.id, mode: 'text-width' }
    }
  }

  if (includeMove && hitTestAnnotation(point, [annotation]) === annotation.id) {
    return { id: annotation.id, mode: 'move' }
  }

  return null
}

function cursorForEditMode(mode: EditHandleMode, dragging = false) {
  if (mode === 'move') {
    return dragging ? 'grabbing' : 'move'
  }

  if (mode === 'line-start' || mode === 'line-end') {
    return 'crosshair'
  }

  if (mode === 'text-width' || mode === 'resize-e' || mode === 'resize-w') {
    return 'ew-resize'
  }

  if (mode === 'resize-n' || mode === 'resize-s') {
    return 'ns-resize'
  }

  if (mode === 'resize-ne' || mode === 'resize-sw') {
    return 'nesw-resize'
  }

  return 'nwse-resize'
}

function drawTaperedArrow(
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

function drawTextAnnotation(context: CanvasRenderingContext2D, annotation: TextAnnotation) {
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
  context.font = `800 ${Math.max(12, radius * (annotation.value.length > 2 ? 0.82 : 1))}px "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(annotation.value, annotation.point.x, annotation.point.y, radius * 1.55)
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

function drawAnnotationHighlight(
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

function renderCanvas(args: {
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

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const point = value as { x?: unknown; y?: unknown }
  const x = asFiniteNumber(point.x)
  const y = asFiniteNumber(point.y)

  return x === null || y === null ? null : { x, y }
}

function asColor(value: unknown) {
  return typeof value === 'string' && value ? value : COLORS[0]
}

function asSize(value: unknown, fallback: number) {
  const size = asFiniteNumber(value)
  return size === null ? fallback : Math.max(1, size)
}

function normalizeAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((raw): Annotation[] => {
    if (!raw || typeof raw !== 'object') {
      return []
    }

    const annotation = raw as Record<string, unknown>
    const id = typeof annotation.id === 'string' && annotation.id ? annotation.id : createId('history')
    const type = annotation.type
    const color = asColor(annotation.color)

    if (type === 'pen' || type === 'highlighter') {
      const points = Array.isArray(annotation.points)
        ? annotation.points.map(asPoint).filter((point): point is Point => Boolean(point))
        : []

      return [{
        id,
        type,
        points,
        color,
        size: asSize(annotation.size, type === 'highlighter' ? 12 : 5)
      }]
    }

    if (type === 'line' || type === 'rect' || type === 'ellipse' || type === 'arrow') {
      const start = asPoint(annotation.start)
      const end = asPoint(annotation.end)
      if (!start || !end) {
        return []
      }

      return [{
        id,
        type,
        start,
        end,
        color,
        size: asSize(annotation.size, 5)
      }]
    }

    if (type === 'mosaic' || type === 'blur') {
      const start = asPoint(annotation.start)
      const end = asPoint(annotation.end)
      if (!start || !end) {
        return []
      }

      return [{
        id,
        type,
        start,
        end,
        color,
        size: asSize(annotation.size, type === 'mosaic' ? 18 : 14)
      }]
    }

    if (type === 'text') {
      const point = asPoint(annotation.point)
      if (!point) {
        return []
      }

      const boxWidth = asFiniteNumber(annotation.boxWidth)

      return [{
        id,
        type,
        point,
        text: typeof annotation.text === 'string' ? annotation.text : '',
        color,
        size: asSize(annotation.size, 28),
        boxWidth: boxWidth === null ? undefined : boxWidth
      }]
    }

    if (type === 'step') {
      const point = asPoint(annotation.point)
      if (!point) {
        return []
      }

      return [{
        id,
        type,
        point,
        value: typeof annotation.value === 'string' ? annotation.value : '1',
        color,
        size: asSize(annotation.size, 28)
      }]
    }

    return []
  })
}

function getHistoryCaptureRegion(item: ScreenshotHistoryItem): CaptureRegion | undefined {
  const capture = item.capture as { region?: unknown } | undefined
  const region = capture?.region

  if (!region || typeof region !== 'object') {
    return undefined
  }

  const source = region as Record<string, unknown>
  const x = asFiniteNumber(source.x)
  const y = asFiniteNumber(source.y)
  const width = asFiniteNumber(source.width)
  const height = asFiniteNumber(source.height)

  if (x === null || y === null || width === null || height === null) {
    return undefined
  }

  return {
    x,
    y,
    width,
    height,
    scaleFactor: asFiniteNumber(source.scaleFactor) ?? undefined
  }
}

function getHistoryScaleFactor(item: ScreenshotHistoryItem) {
  const capture = item.capture as {
    region?: { scaleFactor?: unknown }
    display?: { scaleFactor?: unknown }
  } | undefined

  return (
    item.imageMeta.scaleFactor ??
    asFiniteNumber(capture?.region?.scaleFactor) ??
    asFiniteNumber(capture?.display?.scaleFactor) ??
    window.devicePixelRatio ??
    1
  )
}

export default function App() {
  const mulby = useMulby(PLUGIN_ID)
  const canvasShellRef = useRef<HTMLElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const imageRef = useRef<LoadedImage | null>(null)
  const activeHistoryItemIdRef = useRef<string | null>(null)
  const activeDraftRef = useRef<Annotation | null>(null)
  const editDragRef = useRef<EditDragState | null>(null)
  const dragStartRef = useRef<Point | null>(null)
  const cropStartRef = useRef<Point | null>(null)
  const textEditSnapshotRef = useRef<Annotation[] | null>(null)
  const inlineTextEditRef = useRef<InlineTextEdit | null>(null)
  const inlineStepEditRef = useRef<InlineStepEdit | null>(null)
  const inlineTextRef = useRef<HTMLTextAreaElement | null>(null)
  const inlineStepRef = useRef<HTMLInputElement | null>(null)
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

  const [mode, setMode] = useState<AppMode>(getInitialMode)
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
  const [activeEditMode, setActiveEditMode] = useState<EditHandleMode | null>(null)
  const [canvasCursor, setCanvasCursor] = useState<string | null>(null)
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  const [draftCropRect, setDraftCropRect] = useState<Rect | null>(null)
  const [inlineTextEdit, setInlineTextEdit] = useState<InlineTextEdit | null>(null)
  const [inlineStepEdit, setInlineStepEdit] = useState<InlineStepEdit | null>(null)
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
    if (editDragRef.current) {
      annotationsRef.current = editDragRef.current.annotationsSnapshot
      setAnnotations(editDragRef.current.annotationsSnapshot)
    }

    activeDraftRef.current = null
    editDragRef.current = null
    dragStartRef.current = null
    cropStartRef.current = null
    textEditSnapshotRef.current = null
    setDraft(null)
    setDraftCropRect(null)
    setCropRect(null)
    setInlineTextEdit(null)
    setInlineStepEdit(null)
    setSelectedAnnotationId(null)
    setActiveEditMode(null)
    setCanvasCursor(null)
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
      return nextImage
    },
    [applyWindowBoundsForImage, replaceAnnotations, resetEditingState]
  )

  const flushInlineEditorsForPersistence = useCallback(() => {
    const currentTextEdit = inlineTextEditRef.current
    if (currentTextEdit) {
      const text = currentTextEdit.text.trim()
      const textAnnotation: TextAnnotation | null = text
        ? {
            id: currentTextEdit.id,
            type: 'text',
            point: currentTextEdit.point,
            text,
            color: currentTextEdit.color,
            size: currentTextEdit.size,
            boxWidth: currentTextEdit.boxWidth
          }
        : null
      const nextAnnotations = textAnnotation
        ? [
            ...annotationsRef.current.slice(0, currentTextEdit.insertIndex),
            textAnnotation,
            ...annotationsRef.current.slice(currentTextEdit.insertIndex)
          ]
        : annotationsRef.current

      annotationsRef.current = nextAnnotations
      setAnnotations(nextAnnotations)
      inlineTextEditRef.current = null
      textEditSnapshotRef.current = null
      setInlineTextEdit(null)
    }

    const currentStepEdit = inlineStepEditRef.current
    if (currentStepEdit) {
      const value = currentStepEdit.value.trim().replace(/\s+/g, ' ').slice(0, STEP_LABEL_MAX_LENGTH)

      if (value) {
        const nextAnnotations = annotationsRef.current.map((annotation) => (
          annotation.id === currentStepEdit.id && annotation.type === 'step'
            ? { ...annotation, value }
            : annotation
        ))
        annotationsRef.current = nextAnnotations
        setAnnotations(nextAnnotations)
      }

      inlineStepEditRef.current = null
      setInlineStepEdit(null)
    }
  }, [])

  const persistCurrentHistory = useCallback(
    async (options?: {
      finalDataUrl?: string
      baseDataUrl?: string
      annotations?: Annotation[]
      imageOverride?: LoadedImage | null
    }) => {
      const historyItemId = activeHistoryItemIdRef.current
      const currentImage = options?.imageOverride ?? imageRef.current

      if (!historyItemId || !currentImage) {
        return null
      }

      flushInlineEditorsForPersistence()

      const currentAnnotations = options?.annotations ?? annotationsRef.current
      const finalDataUrl = options?.finalDataUrl ?? exportPng(currentImage, currentAnnotations)

      return updateHistoryItem(mulby, historyItemId, {
        finalDataUrl,
        baseDataUrl: options?.baseDataUrl,
        annotations: currentAnnotations,
        width: currentImage.width,
        height: currentImage.height,
        displaySize: getDisplaySize(currentImage),
        capture: currentImage.capture,
        imageMeta: {
          mime: 'image/png',
          scaleFactor: currentImage.scaleFactor
        }
      })
    },
    [flushInlineEditorsForPersistence, mulby]
  )

  const persistCurrentHistoryQuietly = useCallback(
    async (options?: Parameters<typeof persistCurrentHistory>[0]) => {
      try {
        await persistCurrentHistory(options)
      } catch (error) {
        console.warn('[screenshot-annotator] 保存截图历史失败:', error)
      }
    },
    [persistCurrentHistory]
  )

  const loadImageFromHistory = useCallback(
    async (historyItemId: string) => {
      const token = imageLoadTokenRef.current + 1
      imageLoadTokenRef.current = token

      try {
        setImage(null)
        setPendingPreview(null)
        replaceAnnotations([], { keepRedo: false })
        setUndoStack([])
        setRedoStack([])
        resetEditingState()
        setStatus('正在载入历史截图')

        const { item, editableDataUrl } = await loadHistoryItem(mulby, historyItemId)
        const element = await loadImage(editableDataUrl)
        if (imageLoadTokenRef.current !== token) {
          return
        }

        const region = getHistoryCaptureRegion(item)
        const nextImage: LoadedImage = {
          dataUrl: editableDataUrl,
          element,
          width: element.naturalWidth,
          height: element.naturalHeight,
          region,
          capture: item.capture as PluginAttachment['capture'],
          displaySize: item.displaySize,
          scaleFactor: getHistoryScaleFactor(item)
        }

        activeHistoryItemIdRef.current = item.id
        setImage(nextImage)
        replaceAnnotations(normalizeAnnotations(item.annotations), { keepRedo: false })
        setUndoStack([])
        setRedoStack([])
        setPendingPreview(null)
        setStatus(`${element.naturalWidth} x ${element.naturalHeight}`)
        void applyWindowBoundsForImage(getDisplaySize(nextImage), region, !region)
      } catch (error) {
        if (imageLoadTokenRef.current !== token) {
          return
        }
        const message = error instanceof Error ? error.message : '历史截图打开失败'
        setStatus(message)
        mulby.notification.show(message, 'error')
      }
    },
    [applyWindowBoundsForImage, mulby, replaceAnnotations, resetEditingState]
  )

  const closeAnnotatorWindow = useCallback(async () => {
    await persistCurrentHistoryQuietly()
    mulby.window.close()
  }, [mulby.window, persistCurrentHistoryQuietly])

  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])

  useEffect(() => {
    imageRef.current = image
  }, [image])

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
    inlineStepEditRef.current = inlineStepEdit
  }, [inlineStepEdit])

  useEffect(() => {
    renderCanvas({
      canvas: canvasRef.current,
      image,
      annotations,
      draft,
      cropRect: draftCropRect ?? cropRect,
      selectedAnnotationId,
      imageToCssScale
    })
  }, [annotations, cropRect, draft, draftCropRect, image, imageToCssScale, selectedAnnotationId])

  useEffect(() => {
    if (mode !== 'annotate') {
      document.documentElement.classList.remove('transparent')
      document.documentElement.classList.add('history-window')
      window.mulby?.window?.setAlwaysOnTop?.(false)
      return () => {
        document.documentElement.classList.remove('history-window')
      }
    }

    document.documentElement.classList.remove('history-window')
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
        if (draft || draftCropRect || cropRect || selectedAnnotationId || activeEditMode) {
          resetEditingState()
          setStatus('已取消选择')
          return
        }

        void closeAnnotatorWindow()
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
    closeAnnotatorWindow,
    cropRect,
    draft,
    draftCropRect,
    activeEditMode,
    mode,
    replaceAnnotations,
    resetEditingState,
    selectedAnnotationId
  ])

  useEffect(() => {
    if (mode !== 'annotate') {
      return
    }

    const onBeforeUnload = () => {
      void persistCurrentHistoryQuietly()
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [mode, persistCurrentHistoryQuietly])

  useEffect(() => {
    const dispose = window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const launch = parseLaunchMode(data)
      setMode(launch.mode)

      if (launch.mode === 'history') {
        return
      }

      if (launch.historyItemId) {
        void loadImageFromHistory(launch.historyItemId)
        return
      }

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
          activeHistoryItemIdRef.current = null
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
            capture: attachment.capture,
            displaySize: region ? previewSize : undefined,
            scaleFactor
          }

          setImage(nextImage)
          setPendingPreview(null)
          setStatus(`${element.naturalWidth} x ${element.naturalHeight}`)

          try {
            const historyItem = await createHistoryItem(mulby, {
              rawDataUrl: dataUrl,
              annotations: [],
              width: nextImage.width,
              height: nextImage.height,
              displaySize: getDisplaySize(nextImage),
              capture: attachment.capture,
              imageMeta: {
                mime: attachment.mime ?? 'image/png',
                scaleFactor
              }
            })
            activeHistoryItemIdRef.current = historyItem.id
          } catch (historyError) {
            console.warn('[screenshot-annotator] 创建截图历史失败:', historyError)
          }

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

    return () => {
      dispose?.()
    }
  }, [applyWindowBoundsForImage, loadImageFromHistory, mulby, replaceAnnotations, resetEditingState])

  useEffect(() => {
    if (inlineTextEdit && inlineTextRef.current) {
      requestAnimationFrame(() => inlineTextRef.current?.focus())
    }
  }, [inlineTextEdit?.id])

  useEffect(() => {
    if (inlineStepEdit && inlineStepRef.current) {
      requestAnimationFrame(() => {
        inlineStepRef.current?.focus()
        inlineStepRef.current?.select()
      })
    }
  }, [inlineStepEdit?.id])

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
    const textAnnotation: TextAnnotation | null = text
      ? {
          id: currentEdit.id,
          type: 'text',
          point: currentEdit.point,
          text,
          color: currentEdit.color,
          size: currentEdit.size,
          boxWidth: currentEdit.boxWidth
        }
      : null
    const nextAnnotations = text
      ? [
          ...annotationsRef.current.slice(0, currentEdit.insertIndex),
          textAnnotation!,
          ...annotationsRef.current.slice(currentEdit.insertIndex)
        ]
      : annotationsRef.current

    replaceAnnotations(nextAnnotations, {
      recordHistory: Boolean(text || baseSnapshot),
      historySnapshot: baseSnapshot ?? annotationsRef.current
    })
    inlineTextEditRef.current = null
    textEditSnapshotRef.current = null
    setInlineTextEdit(null)
    setSelectedAnnotationId(text ? currentEdit.id : null)
    setStatus(text ? (baseSnapshot ? '已更新文字' : '已添加文字') : '已取消文字')
  }, [replaceAnnotations])

  const cancelInlineText = useCallback(() => {
    const currentEdit = inlineTextEditRef.current
    const baseSnapshot = textEditSnapshotRef.current
    if (baseSnapshot) {
      annotationsRef.current = baseSnapshot
      setAnnotations(baseSnapshot)
    }

    textEditSnapshotRef.current = null
    inlineTextEditRef.current = null
    setInlineTextEdit(null)
    setSelectedAnnotationId(baseSnapshot ? currentEdit?.id ?? null : null)
    setStatus('已取消文字')
  }, [])

  const startInlineTextEdit = useCallback((annotation: TextAnnotation) => {
    textEditSnapshotRef.current = annotationsRef.current
    const insertIndex = Math.max(0, annotationsRef.current.findIndex((item) => item.id === annotation.id))
    const nextAnnotations = annotationsRef.current.filter((item) => item.id !== annotation.id)
    annotationsRef.current = nextAnnotations
    setAnnotations(nextAnnotations)
    setSelectedAnnotationId(null)
    setInlineTextEdit({
      id: annotation.id,
      point: annotation.point,
      text: annotation.text,
      color: annotation.color,
      size: annotation.size,
      boxWidth: getTextBoxWidth(annotation),
      insertIndex
    })
  }, [])

  const commitInlineStep = useCallback(() => {
    const currentEdit = inlineStepEditRef.current
    if (!currentEdit) {
      return
    }

    const value = currentEdit.value.trim().replace(/\s+/g, ' ').slice(0, STEP_LABEL_MAX_LENGTH)

    if (!value) {
      inlineStepEditRef.current = null
      setInlineStepEdit(null)
      setSelectedAnnotationId(currentEdit.id)
      setStatus('编号不能为空')
      return
    }

    const target = annotationsRef.current.find((annotation) => annotation.id === currentEdit.id)
    if (target?.type === 'step' && target.value !== value) {
      replaceAnnotations(
        annotationsRef.current.map((annotation) => (
          annotation.id === currentEdit.id && annotation.type === 'step'
            ? { ...annotation, value }
            : annotation
        )),
        { recordHistory: true }
      )
      setStatus('已更新编号')
    }

    inlineStepEditRef.current = null
    setInlineStepEdit(null)
    setSelectedAnnotationId(currentEdit.id)
  }, [replaceAnnotations])

  const cancelInlineStep = useCallback(() => {
    const currentEdit = inlineStepEditRef.current
    inlineStepEditRef.current = null
    setInlineStepEdit(null)
    setSelectedAnnotationId(currentEdit?.id ?? null)
    setStatus('已取消编号编辑')
  }, [])

  const startInlineStepEdit = useCallback((annotation: StepAnnotation) => {
    setSelectedAnnotationId(annotation.id)
    setInlineStepEdit({
      id: annotation.id,
      point: annotation.point,
      value: annotation.value,
      color: annotation.color,
      size: annotation.size
    })
  }, [])

  const getEditHandleAtPoint = useCallback(
    (point: Point, filterType?: Annotation['type']) => {
      const selected = selectedAnnotationId
        ? annotationsRef.current.find((annotation) => annotation.id === selectedAnnotationId)
        : null
      const selectedHandle = selected && (!filterType || selected.type === filterType)
        ? hitTestEditHandle(point, selected, imageToCssScale, false)
        : null

      if (selectedHandle) {
        return selectedHandle
      }

      const hitId = hitTestAnnotation(point, annotationsRef.current, filterType)
      const hitAnnotation = hitId
        ? annotationsRef.current.find((annotation) => annotation.id === hitId)
        : null

      return hitAnnotation
        ? hitTestEditHandle(point, hitAnnotation, imageToCssScale)
        : null
    },
    [imageToCssScale, selectedAnnotationId]
  )

  const startAnnotationEditDrag = useCallback(
    (
      editHandle: EditHandle,
      point: Point,
      event: ReactPointerEvent<HTMLCanvasElement>
    ) => {
      const targetAnnotation = annotationsRef.current.find((annotation) => annotation.id === editHandle.id)
      if (!targetAnnotation) {
        return false
      }

      event.currentTarget.setPointerCapture(event.pointerId)
      editDragRef.current = {
        ...editHandle,
        pointerId: event.pointerId,
        startPoint: point,
        snapshot: targetAnnotation,
        annotationsSnapshot: annotationsRef.current,
        moved: false
      }
      setActiveEditMode(editHandle.mode)
      setCanvasCursor(cursorForEditMode(editHandle.mode, true))
      setStatus(editHandle.mode === 'move' ? '拖动以移动标注' : '拖动控制点调整标注')
      return true
    },
    []
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!image || busy || event.button !== 0) {
        return
      }

      const point = getPointFromClient(event.clientX, event.clientY)

      if (inlineTextEdit) {
        commitInlineText()
      }

      if (inlineStepEdit) {
        commitInlineStep()
      }

      if (tool === 'select') {
        const editHandle = getEditHandleAtPoint(point)
        setSelectedAnnotationId(editHandle?.id ?? null)

        if (editHandle) {
          startAnnotationEditDrag(editHandle, point, event)
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

      const editableType = getEditableAnnotationTypeForTool(tool)
      const editHandle = editableType
        ? getEditHandleAtPoint(point, editableType)
        : null

      if (editHandle) {
        setSelectedAnnotationId(editHandle.id)
        if (startAnnotationEditDrag(editHandle, point, event)) {
          return
        }
      }

      if (tool === 'text') {
        setSelectedAnnotationId(null)
        setInlineTextEdit({
          id: createId('text'),
          point,
          text: '',
          color,
          size: toImageSize(textSize),
          boxWidth: toImageSize(TEXT_BOX_DEFAULT_VISUAL_WIDTH),
          insertIndex: annotationsRef.current.length
        })
        return
      }

      if (tool === 'step') {
        const id = createId('step')
        const nextValue = String(
          annotationsRef.current.filter((annotation) => annotation.type === 'step').length + 1
        )
        replaceAnnotations(
          [
            ...annotationsRef.current,
            {
              id,
              type: 'step',
              point,
              value: nextValue,
              color,
              size: toImageSize(stepSize)
            }
          ],
          { recordHistory: true }
        )
        setSelectedAnnotationId(id)
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
      commitInlineStep,
      getEditHandleAtPoint,
      getPointFromClient,
      image,
      inlineStepEdit,
      inlineTextEdit,
      mosaicSize,
      replaceAnnotations,
      stepSize,
      startAnnotationEditDrag,
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
      const editDrag = editDragRef.current

      if (editDrag && editDrag.pointerId === event.pointerId) {
        const nextAnnotation = resizeAnnotation(
          editDrag.snapshot,
          editDrag.mode,
          editDrag.startPoint,
          point,
          { shiftKey: event.shiftKey }
        )
        const nextAnnotations = annotationsRef.current.map((annotation) =>
          annotation.id === editDrag.id ? nextAnnotation : annotation
        )
        annotationsRef.current = nextAnnotations
        setAnnotations(nextAnnotations)
        editDrag.moved = editDrag.moved ||
          Math.hypot(point.x - editDrag.startPoint.x, point.y - editDrag.startPoint.y) > 0.25
        setCanvasCursor(cursorForEditMode(editDrag.mode, true))
        return
      }

      if (cropStartRef.current && draftCropRect) {
        setDraftCropRect(normalizeRect(cropStartRef.current, point))
        return
      }

      const currentDraft = activeDraftRef.current
      if (!currentDraft || !dragStartRef.current) {
        const editableType = getEditableAnnotationTypeForTool(tool)
        if (tool === 'select' || editableType) {
          const hoverHandle = getEditHandleAtPoint(point, editableType ?? undefined)
          const nextCursor = hoverHandle ? cursorForEditMode(hoverHandle.mode) : null
          setCanvasCursor((currentCursor) => (
            currentCursor === nextCursor ? currentCursor : nextCursor
          ))
        }
        return
      }

      let nextDraft: Annotation

      if (isStrokeAnnotation(currentDraft)) {
        nextDraft = { ...currentDraft, points: [...currentDraft.points, point] }
      } else if (isDragAnnotation(currentDraft)) {
        const nextPoint = event.shiftKey && (currentDraft.type === 'line' || currentDraft.type === 'arrow')
          ? snapPointTo45Degrees(currentDraft.start, point)
          : event.shiftKey && (currentDraft.type === 'rect' || currentDraft.type === 'ellipse')
            ? snapPointToSquare(currentDraft.start, point)
            : point
        nextDraft = { ...currentDraft, end: nextPoint }
      } else {
        nextDraft = currentDraft
      }

      activeDraftRef.current = nextDraft
      setDraft(nextDraft)
    },
    [draftCropRect, getEditHandleAtPoint, getPointFromClient, image, tool]
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Pointer capture may already be released when the pointer leaves the canvas.
      }

      const editDrag = editDragRef.current
      if (editDrag && editDrag.pointerId === event.pointerId) {
        if (editDrag.moved) {
          setUndoStack((stack) => [...stack.slice(-(HISTORY_LIMIT - 1)), editDrag.annotationsSnapshot])
          setRedoStack([])
          setStatus(editDrag.mode === 'move' ? '已移动标注' : '已调整标注')
        }

        editDragRef.current = null
        setActiveEditMode(null)
        setCanvasCursor(null)
        setSelectedAnnotationId(editDrag.id)
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
        setSelectedAnnotationId(currentDraft.id)
        setStatus('已添加标注')
      }
    },
    [draftCropRect, replaceAnnotations]
  )

  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!editDragRef.current && !activeDraftRef.current) {
        setCanvasCursor(null)
      }
      handlePointerUp(event)
    },
    [handlePointerUp]
  )

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Ignore stale pointer capture.
    }

    const editDrag = editDragRef.current
    if (editDrag && editDrag.pointerId === event.pointerId) {
      annotationsRef.current = editDrag.annotationsSnapshot
      setAnnotations(editDrag.annotationsSnapshot)
    }

    activeDraftRef.current = null
    editDragRef.current = null
    dragStartRef.current = null
    cropStartRef.current = null
    setDraft(null)
    setDraftCropRect(null)
    setActiveEditMode(null)
    setCanvasCursor(null)
  }, [])

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!image) {
        return
      }

      const point = getPointFromClient(event.clientX, event.clientY)
      const hitId = hitTestAnnotation(point, annotationsRef.current)
      if (!hitId) {
        return
      }

      const annotation = annotationsRef.current.find((item) => item.id === hitId)
      if (annotation?.type === 'text') {
        startInlineTextEdit(annotation)
        return
      }

      if (annotation?.type === 'step') {
        startInlineStepEdit(annotation)
      }
    },
    [getPointFromClient, image, startInlineStepEdit, startInlineTextEdit]
  )

  const handleClear = useCallback(() => {
    const snapshot = textEditSnapshotRef.current ?? annotationsRef.current
    if (snapshot.length === 0 && !inlineTextEdit && !inlineStepEdit) {
      return
    }

    inlineTextEditRef.current = null
    inlineStepEditRef.current = null
    textEditSnapshotRef.current = null
    setInlineTextEdit(null)
    setInlineStepEdit(null)
    replaceAnnotations([], { recordHistory: snapshot.length > 0, historySnapshot: snapshot })
    setSelectedAnnotationId(null)
    setStatus('已清空')
  }, [inlineStepEdit, inlineTextEdit, replaceAnnotations])

  const handleOpenHistory = useCallback(async () => {
    await persistCurrentHistoryQuietly()
    await mulby.window.create('/index.html?mode=history', {
      width: 960,
      height: 680,
      minWidth: 760,
      minHeight: 520,
      title: '截图历史',
      resizable: true,
      alwaysOnTop: false,
      transparent: false,
      type: 'default',
      titleBar: true
    })
  }, [mulby.window, persistCurrentHistoryQuietly])

  const handleCopy = useCallback(async () => {
    if (!image) {
      return
    }

    if (inlineTextEdit) {
      commitInlineText()
    }

    if (inlineStepEdit) {
      commitInlineStep()
    }

    try {
      const finalDataUrl = exportPng(image, annotationsRef.current)
      await mulby.clipboard.writeImage(finalDataUrl)
      await persistCurrentHistoryQuietly({ finalDataUrl })
      setStatus('已复制')
      mulby.notification.show('已复制到剪贴板', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }, [
    commitInlineStep,
    commitInlineText,
    image,
    inlineStepEdit,
    inlineTextEdit,
    mulby.clipboard,
    mulby.notification,
    persistCurrentHistoryQuietly
  ])

  const handleSave = useCallback(async () => {
    if (!image) {
      return
    }

    if (inlineTextEdit) {
      commitInlineText()
    }

    if (inlineStepEdit) {
      commitInlineStep()
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
      const finalDataUrl = exportPng(image, annotationsRef.current)
      await mulby.filesystem.writeFile(
        finalPath,
        dataUrlToBase64(finalDataUrl),
        'base64'
      )
      await persistCurrentHistoryQuietly({ finalDataUrl })
      setStatus('已保存')
      mulby.notification.show('已保存截图', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }, [
    commitInlineStep,
    commitInlineText,
    image,
    inlineStepEdit,
    inlineTextEdit,
    mulby.dialog,
    mulby.filesystem,
    mulby.notification,
    persistCurrentHistoryQuietly
  ])

  // ── 问 AI ───────────────────────────────────────────────────
  // 在独立窗口里打开「问 AI」：把当前截图快照（带标注 + 原图）写入交接键，
  // 再创建一个普通窗口加载 AI 视图。截图标注窗口尺寸/比例完全不受影响。
  const handleOpenAi = useCallback(async () => {
    const current = imageRef.current
    if (!current) {
      return
    }
    flushInlineEditorsForPersistence()
    const annotated = exportPng(current, annotationsRef.current)
    const original = current.dataUrl
    const handoffId = createId('ai')

    // 把 AI 窗口定位到截图窗口旁边（右侧优先，放不下则左侧）。
    const aiWidth = 380
    const aiHeight = 440
    let position: { x: number; y: number } | null = null
    try {
      const bounds = await mulby.window.getBounds()
      if (bounds) {
        const gap = 10
        const screenW = window.screen.availWidth || 1920
        const rightX = bounds.x + bounds.width + gap
        const x = rightX + aiWidth <= screenW ? rightX : Math.max(0, bounds.x - aiWidth - gap)
        position = { x: Math.round(x), y: Math.round(bounds.y) }
      }
    } catch {
      /* 取不到就用默认位置 */
    }

    try {
      await mulby.storage.set(`ai-handoff-${handoffId}`, { annotated, original, createdAt: Date.now() })
      await mulby.window.create(`/index.html?mode=ai&aiHandoff=${handoffId}`, {
        width: aiWidth,
        height: aiHeight,
        minWidth: 300,
        minHeight: 200,
        title: '问 AI',
        resizable: true,
        alwaysOnTop: true,
        transparent: false,
        type: 'borderless',
        titleBar: false,
        ...(position ?? {})
      })
    } catch (error) {
      mulby.notification.show(error instanceof Error ? error.message : '打开 AI 窗口失败', 'error')
    }
  }, [flushInlineEditorsForPersistence, mulby.notification, mulby.storage, mulby.window])

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

      if (inlineStepEdit) {
        commitInlineStep()
      }

      setBusy(busyLabel)
      setStatus(busyLabel)

      try {
        const currentDataUrl = exportPng(image, annotationsRef.current)
        await persistCurrentHistoryQuietly({ finalDataUrl: currentDataUrl })
        const output = await transform(sharpApi(dataUrlToArrayBuffer(currentDataUrl)))
        const transformedDataUrl = arrayBufferToDataUrl(output)
        const nextImage = await loadTransformedImage(transformedDataUrl, image, successLabel)
        await persistCurrentHistoryQuietly({
          finalDataUrl: transformedDataUrl,
          baseDataUrl: transformedDataUrl,
          annotations: [],
          imageOverride: nextImage
        })
        mulby.notification.show(successLabel, 'success')
      } catch (error) {
        const message = error instanceof Error ? error.message : `${busyLabel}失败`
        setStatus(message)
        mulby.notification.show(message, 'error')
      } finally {
        setBusy(null)
      }
    },
    [
      commitInlineStep,
      commitInlineText,
      image,
      inlineStepEdit,
      inlineTextEdit,
      loadTransformedImage,
      mulby.notification,
      persistCurrentHistoryQuietly
    ]
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
        label: '尺寸',
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
    ? (() => {
        const previewAnnotation: TextAnnotation = {
          id: inlineTextEdit.id,
          type: 'text',
          point: inlineTextEdit.point,
          text: inlineTextEdit.text,
          color: inlineTextEdit.color,
          size: inlineTextEdit.size,
          boxWidth: inlineTextEdit.boxWidth
        }
        const bounds = getTextBounds(previewAnnotation)
        const fontSize = Math.max(14, inlineTextEdit.size * imageToCssScale)

        return {
          left: inlineTextEdit.point.x * imageToCssScale,
          top: inlineTextEdit.point.y * imageToCssScale,
          width: bounds.width * imageToCssScale,
          height: Math.max(42, bounds.height * imageToCssScale),
          fontSize
        }
      })()
    : null
  const inlineStepPosition = inlineStepEdit && image
    ? (() => {
        const radius = Math.max(14, inlineStepEdit.size * 0.7)
        return {
          left: (inlineStepEdit.point.x - radius) * imageToCssScale,
          top: (inlineStepEdit.point.y - radius) * imageToCssScale,
          width: radius * 2 * imageToCssScale,
          height: radius * 2 * imageToCssScale,
          fontSize: Math.max(12, radius * imageToCssScale * 0.78)
        }
      })()
    : null

  if (mode === 'history') {
    return <HistoryView mulby={mulby} />
  }

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
                cursor: activeEditMode
                  ? cursorForEditMode(activeEditMode, true)
                  : canvasCursor ?? undefined
              }}
              onDoubleClick={handleDoubleClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerLeave={handlePointerLeave}
            />
            {inlineTextEdit && inlineTextPosition && (
              <textarea
                ref={inlineTextRef}
                className="inline-text-editor"
                style={{
                  left: inlineTextPosition.left,
                  top: inlineTextPosition.top,
                  width: inlineTextPosition.width,
                  height: inlineTextPosition.height,
                  fontSize: inlineTextPosition.fontSize,
                  color: inlineTextEdit.color,
                  minWidth: Math.max(120, inlineTextPosition.fontSize * 4)
                }}
                value={inlineTextEdit.text}
                onChange={(event) => {
                  const text = event.target.value
                  setInlineTextEdit((current) => (
                    current ? { ...current, text } : null
                  ))
                  if (inlineTextEditRef.current) {
                    inlineTextEditRef.current = { ...inlineTextEditRef.current, text }
                  }
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
            {inlineStepEdit && inlineStepPosition && (
              <input
                ref={inlineStepRef}
                className="inline-step-editor"
                style={{
                  left: inlineStepPosition.left,
                  top: inlineStepPosition.top,
                  width: inlineStepPosition.width,
                  height: inlineStepPosition.height,
                  fontSize: inlineStepPosition.fontSize,
                  backgroundColor: inlineStepEdit.color
                }}
                value={inlineStepEdit.value}
                maxLength={STEP_LABEL_MAX_LENGTH}
                onChange={(event) => {
                  const value = event.target.value.slice(0, STEP_LABEL_MAX_LENGTH)
                  setInlineStepEdit((current) => (
                    current ? { ...current, value } : null
                  ))
                  if (inlineStepEditRef.current) {
                    inlineStepEditRef.current = { ...inlineStepEditRef.current, value }
                  }
                }}
                onBlur={() => {
                  inlineBlurTimerRef.current = setTimeout(() => {
                    inlineBlurTimerRef.current = null
                    commitInlineStep()
                  }, 80)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    if (inlineBlurTimerRef.current) {
                      clearTimeout(inlineBlurTimerRef.current)
                      inlineBlurTimerRef.current = null
                    }
                    commitInlineStep()
                  }
                  if (event.key === 'Escape') {
                    if (inlineBlurTimerRef.current) {
                      clearTimeout(inlineBlurTimerRef.current)
                      inlineBlurTimerRef.current = null
                    }
                    cancelInlineStep()
                  }
                  event.stopPropagation()
                }}
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
                      if (inlineStepEdit && item.key !== 'step') {
                        commitInlineStep()
                      }
                      setTool(item.key)
                      setCanvasCursor(null)
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
              <button className="icon-button" title="截图历史" type="button" onClick={() => void handleOpenHistory()}>
                <HistoryIcon size={18} />
              </button>
              <button className="icon-button" title="撤销" type="button" onClick={handleUndo} disabled={!undoStack.length}>
                <Undo2 size={18} />
              </button>
              <button className="icon-button" title="重做" type="button" onClick={handleRedo} disabled={!redoStack.length}>
                <Redo2 size={18} />
              </button>
              <button
                className="icon-button"
                title="清空标注"
                type="button"
                onClick={handleClear}
                disabled={!annotations.length && !inlineTextEdit && !inlineStepEdit}
              >
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
              <button
                className="command-button ai-ask-button"
                type="button"
                title="在独立窗口里把这张截图发给 AI 解释 / 解题 / 提取文字 / 翻译 / 修图"
                onClick={() => void handleOpenAi()}
                disabled={!image}
              >
                <Bot size={17} />
                问 AI
              </button>
              <button className="command-button" type="button" onClick={() => void handleCopy()} disabled={!image || Boolean(busy)}>
                <Clipboard size={17} />
                复制
              </button>
              <button className="command-button" type="button" onClick={() => void handleSave()} disabled={!image || Boolean(busy)}>
                <Save size={17} />
                保存
              </button>
              <button className="icon-button close-button" title="关闭" type="button" onClick={() => void closeAnnotatorWindow()}>
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
