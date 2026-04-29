import {
  Circle,
  Clipboard,
  Droplets,
  Eraser,
  Grid3x3,
  Hash,
  Highlighter,
  LucideIcon,
  Minus,
  MousePointer2,
  MoveRight,
  Pencil,
  Redo2,
  Save,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  | 'eraser'

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

const PLUGIN_ID = 'screenshot-annotator'
const TOOLBAR_HEIGHT = 96
const TOOLBAR_MIN_WIDTH = 760
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7']

const createId = () => {
  if (crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const loadImage = (dataUrl: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('截图图片加载失败'))
    image.src = dataUrl
  })

const dataUrlToBase64 = (dataUrl: string) => dataUrl.split(',', 2)[1] ?? ''

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

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
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

function hitTestAnnotation(point: Point, annotations: Annotation[]) {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index]

    if (annotation.type === 'pen' || annotation.type === 'highlighter') {
      for (let pointIndex = 1; pointIndex < annotation.points.length; pointIndex += 1) {
        if (pointDistanceToSegment(point, annotation.points[pointIndex - 1], annotation.points[pointIndex]) <= annotation.size + 6) {
          return annotation.id
        }
      }
    }

    if (annotation.type === 'line' || annotation.type === 'arrow') {
      if (pointDistanceToSegment(point, annotation.start, annotation.end) <= annotation.size + 8) {
        return annotation.id
      }
    }

    if (
      annotation.type === 'rect' ||
      annotation.type === 'ellipse' ||
      annotation.type === 'mosaic' ||
      annotation.type === 'blur'
    ) {
      if (isPointInRect(point, normalizeRect(annotation.start, annotation.end), annotation.size + 4)) {
        return annotation.id
      }
    }

    if (annotation.type === 'text') {
      const width = Math.max(80, annotation.text.length * annotation.size * 0.62)
      const height = annotation.size * 1.5
      if (isPointInRect(point, { x: annotation.point.x, y: annotation.point.y, width, height }, 8)) {
        return annotation.id
      }
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

function drawArrowHead(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  size: number
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const length = Math.max(14, size * 4)

  context.beginPath()
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - length * Math.cos(angle - Math.PI / 6),
    end.y - length * Math.sin(angle - Math.PI / 6)
  )
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - length * Math.cos(angle + Math.PI / 6),
    end.y - length * Math.sin(angle + Math.PI / 6)
  )
  context.stroke()
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
  context.drawImage(smallCanvas, 0, 0, smallCanvas.width, smallCanvas.height, safeRect.x, safeRect.y, safeRect.width, safeRect.height)
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

  sourceContext.drawImage(context.canvas, safeRect.x, safeRect.y, safeRect.width, safeRect.height, 0, 0, safeRect.width, safeRect.height)

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
  const lines = annotation.text.split(/\r?\n/).filter(Boolean)

  context.save()
  context.font = `700 ${fontSize}px "Segoe UI", "PingFang SC", sans-serif`
  context.textBaseline = 'top'
  context.lineJoin = 'round'
  context.lineWidth = Math.max(2, fontSize * 0.12)
  context.strokeStyle = 'rgba(6, 11, 20, 0.72)'
  context.fillStyle = annotation.color

  lines.forEach((line, index) => {
    const y = annotation.point.y + index * fontSize * 1.25
    context.strokeText(line, annotation.point.x, y)
    context.fillText(line, annotation.point.x, y)
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
    pixelateRect(context, normalizeRect(annotation.start, annotation.end), annotation.size * 3)
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

function renderCanvas(
  canvas: HTMLCanvasElement | null,
  image: LoadedImage | null,
  annotations: Annotation[],
  draft: Annotation | null
) {
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragStartRef = useRef<Point | null>(null)
  const activeDraftRef = useRef<Annotation | null>(null)

  const [image, setImage] = useState<LoadedImage | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draft, setDraft] = useState<Annotation | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(5)
  const [undoStack, setUndoStack] = useState<Annotation[][]>([])
  const [redoStack, setRedoStack] = useState<Annotation[][]>([])
  const [status, setStatus] = useState('等待截图')

  const cssSize = useMemo(() => {
    if (!image) {
      return { width: 0, height: 0 }
    }

    return getDisplaySize(image)
  }, [image])

  const commitAnnotations = useCallback((next: Annotation[]) => {
    setAnnotations((current) => {
      setUndoStack((stack) => [...stack.slice(-29), current])
      setRedoStack([])
      return next
    })
  }, [])

  const getPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current
    if (!canvas) {
      return { x: 0, y: 0 }
    }

    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('transparent')
    window.mulby?.window?.setAlwaysOnTop?.(true)

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (event.key === 'Escape' && !isTyping) {
        window.mulby?.window?.close()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const attachment = data.attachments?.find((item) => item.kind === 'image')
      if (!attachment?.dataUrl) {
        setStatus('没有收到截图')
        return
      }

      void (async () => {
        try {
          const element = await loadImage(attachment.dataUrl!)
          const scaleFactor =
            attachment.capture?.region?.scaleFactor ??
            attachment.capture?.display?.scaleFactor ??
            window.devicePixelRatio ??
            1

          const nextImage = {
            dataUrl: attachment.dataUrl!,
            element,
            width: element.naturalWidth,
            height: element.naturalHeight,
            region: attachment.capture?.region,
            scaleFactor
          }

          setImage(nextImage)
          setAnnotations([])
          setUndoStack([])
          setRedoStack([])
          setStatus(`${element.naturalWidth} x ${element.naturalHeight}`)

          const displaySize = getDisplaySize(nextImage)

          if (attachment.capture?.region) {
            const { x, y, width, height } = attachment.capture.region
            void window.mulby?.window?.setBounds?.({
              x,
              y,
              width: Math.max(width, TOOLBAR_MIN_WIDTH),
              height: height + TOOLBAR_HEIGHT
            })
          } else {
            void (async () => {
              await window.mulby?.window?.setBounds?.({
                width: Math.max(displaySize.width, TOOLBAR_MIN_WIDTH),
                height: displaySize.height + TOOLBAR_HEIGHT
              })
              window.mulby?.window?.center?.()
            })()
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '截图打开失败'
          setStatus(message)
          window.mulby?.notification?.show(message, 'error')
        }
      })()
    })
  }, [])

  useEffect(() => {
    renderCanvas(canvasRef.current, image, annotations, draft)
  }, [annotations, draft, image])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image || tool === 'select') {
      return
    }

    const point = getPoint(event)

    if (tool === 'eraser') {
      const hitId = hitTestAnnotation(point, annotations)
      if (hitId) {
        commitAnnotations(annotations.filter((annotation) => annotation.id !== hitId))
        setStatus('已删除标注')
      }
      return
    }

    if (tool === 'text') {
      const text = window.prompt('输入文字')?.trim()
      if (text) {
        commitAnnotations([
          ...annotations,
          { id: createId(), type: 'text', point, text, color, size: Math.max(18, size * 4) }
        ])
      }
      return
    }

    if (tool === 'step') {
      const nextValue = String(annotations.filter((annotation) => annotation.type === 'step').length + 1)
      commitAnnotations([
        ...annotations,
        { id: createId(), type: 'step', point, value: nextValue, color, size: Math.max(22, size * 4) }
      ])
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = point

    const nextDraft: Annotation = tool === 'pen' || tool === 'highlighter'
      ? { id: createId(), type: tool, points: [point], color, size }
      : {
          id: createId(),
          type: tool,
          start: point,
          end: point,
          color,
          size
        }

    activeDraftRef.current = nextDraft
    setDraft(nextDraft)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const currentDraft = activeDraftRef.current
    if (!currentDraft || !dragStartRef.current) {
      return
    }

    const point = getPoint(event)
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
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const currentDraft = activeDraftRef.current
    if (!currentDraft) {
      return
    }

    event.currentTarget.releasePointerCapture(event.pointerId)
    activeDraftRef.current = null
    dragStartRef.current = null
    setDraft(null)

    let hasArea = false

    if (isStrokeAnnotation(currentDraft)) {
      hasArea = currentDraft.points.length > 1
    } else if (isDragAnnotation(currentDraft)) {
      hasArea =
        Math.abs(currentDraft.end.x - currentDraft.start.x) > 2 ||
        Math.abs(currentDraft.end.y - currentDraft.start.y) > 2
    }

    if (hasArea) {
      commitAnnotations([...annotations, currentDraft])
    }
  }

  const handleUndo = () => {
    setUndoStack((stack) => {
      const previous = stack.at(-1)
      if (!previous) {
        return stack
      }

      setRedoStack((current) => [...current, annotations])
      setAnnotations(previous)
      return stack.slice(0, -1)
    })
  }

  const handleRedo = () => {
    setRedoStack((stack) => {
      const next = stack.at(-1)
      if (!next) {
        return stack
      }

      setUndoStack((current) => [...current, annotations])
      setAnnotations(next)
      return stack.slice(0, -1)
    })
  }

  const handleClear = () => {
    if (annotations.length === 0) {
      return
    }

    commitAnnotations([])
    setStatus('已清空')
  }

  const handleCopy = async () => {
    if (!image) {
      return
    }

    try {
      await mulby.clipboard.writeImage(exportPng(image, annotations))
      setStatus('已复制')
      mulby.notification.show('已复制到剪贴板', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }

  const handleSave = async () => {
    if (!image) {
      return
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
      await mulby.filesystem.writeFile(finalPath, dataUrlToBase64(exportPng(image, annotations)), 'base64')
      setStatus('已保存')
      mulby.notification.show('已保存截图', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }

  const toolItems: Array<{ key: Tool; icon: LucideIcon; label: string }> = [
    { key: 'select', icon: MousePointer2, label: '选择' },
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
    { key: 'eraser', icon: Eraser, label: '橡皮擦' }
  ]

  return (
    <div className="annotator-root">
      <main className="canvas-shell" style={{ height: cssSize.height || `calc(100vh - ${TOOLBAR_HEIGHT}px)` }}>
        {image ? (
          <canvas
            ref={canvasRef}
            className={`annotation-canvas tool-${tool}`}
            style={{
              width: cssSize.width,
              height: cssSize.height
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
        ) : (
          <div className="empty-state">{status}</div>
        )}
      </main>

      <footer className="toolbar">
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
                  onClick={() => setTool(item.key)}
                >
                  <Icon size={18} />
                </button>
              )
            })}
          </div>
          <div className="status-line">{status}</div>
        </div>

        <div className="toolbar-row">
          <div className="tool-group color-group" aria-label="颜色">
            {COLORS.map((item) => (
              <button
                key={item}
                className={`swatch ${color === item ? 'is-active' : ''}`}
                style={{ backgroundColor: item }}
                title={item}
                type="button"
                onClick={() => setColor(item)}
              />
            ))}
          </div>

          <label className="size-control" title="线宽">
            <span>{size}</span>
            <input
              min="2"
              max="14"
              type="range"
              value={size}
              onChange={(event) => setSize(Number(event.target.value))}
            />
          </label>

          <div className="tool-group history-group">
            <button className="icon-button" title="撤销" type="button" onClick={handleUndo} disabled={!undoStack.length}>
              <Undo2 size={18} />
            </button>
            <button className="icon-button" title="重做" type="button" onClick={handleRedo} disabled={!redoStack.length}>
              <Redo2 size={18} />
            </button>
            <button className="icon-button" title="清空" type="button" onClick={handleClear} disabled={!annotations.length}>
              <Trash2 size={18} />
            </button>
          </div>

          <div className="tool-group command-group">
            <button className="command-button" type="button" onClick={handleCopy} disabled={!image}>
              <Clipboard size={17} />
              复制
            </button>
            <button className="command-button" type="button" onClick={handleSave} disabled={!image}>
              <Save size={17} />
              保存
            </button>
            <button className="icon-button close-button" title="关闭" type="button" onClick={() => mulby.window.close()}>
              <X size={18} />
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}
