export type EditorTool =
  | 'pen'
  | 'highlighter'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'step'
  | 'mosaic'
  | 'blur'
  | 'crop'
  | 'pan'
  | 'eraser'

export type Point = {
  x: number
  y: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type EditorImage = {
  dataUrl: string
  width: number
  height: number
  label: string
  sourceType: 'region' | 'fullscreen' | 'clipboard' | 'file' | 'attachment'
  capturedAt: number
  originPath?: string
}

type AnnotationBase = {
  id: string
  color: string
}

export type StrokeAnnotation = AnnotationBase & {
  kind: 'pen' | 'highlighter'
  width: number
  points: Point[]
}

export type LineAnnotation = AnnotationBase & {
  kind: 'line' | 'arrow'
  width: number
  start: Point
  end: Point
}

export type RectAnnotation = AnnotationBase & {
  kind: 'rect' | 'ellipse'
  width: number
  start: Point
  end: Point
}

export type MosaicAnnotation = AnnotationBase & {
  kind: 'mosaic'
  rect: Rect
  cellSize: number
}

export type BlurAnnotation = AnnotationBase & {
  kind: 'blur'
  rect: Rect
  radius: number
}

export type TextAnnotation = AnnotationBase & {
  kind: 'text'
  point: Point
  text: string
  size: number
}

export type StepAnnotation = AnnotationBase & {
  kind: 'step'
  point: Point
  value: string
  size: number
}

export type Annotation =
  | StrokeAnnotation
  | LineAnnotation
  | RectAnnotation
  | MosaicAnnotation
  | BlurAnnotation
  | TextAnnotation
  | StepAnnotation

export type DraftAnnotation = Annotation | null

export type ViewportSize = {
  width: number
  height: number
}

/** 视口变换：缩放与平移，用于放大后拖动查看 */
export type ViewportTransform = {
  zoom: number
  panX: number
  panY: number
}

type RenderLayout = ViewportSize & {
  scale: number
  offsetX: number
  offsetY: number
}

const STAGE_PADDING = 28

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function createLayout(
  image: EditorImage,
  viewport: ViewportSize,
  transform?: ViewportTransform | null
): RenderLayout {
  const safeWidth = Math.max(viewport.width, 1)
  const safeHeight = Math.max(viewport.height, 1)
  const availableWidth = Math.max(safeWidth - STAGE_PADDING * 2, 1)
  const availableHeight = Math.max(safeHeight - STAGE_PADDING * 2, 1)
  const fitScale = Math.min(availableWidth / image.width, availableHeight / image.height, 1.15)
  const zoom = transform?.zoom ?? 1
  const scale = fitScale * zoom
  const centerX = (safeWidth - image.width * scale) / 2
  const centerY = (safeHeight - image.height * scale) / 2
  const panX = transform?.panX ?? 0
  const panY = transform?.panY ?? 0

  return {
    width: safeWidth,
    height: safeHeight,
    scale,
    offsetX: centerX + panX,
    offsetY: centerY + panY
  }
}

function projectPoint(point: Point, layout: RenderLayout): Point {
  return {
    x: layout.offsetX + point.x * layout.scale,
    y: layout.offsetY + point.y * layout.scale
  }
}

export function previewSizeToImageSize(
  previewSize: number,
  image: EditorImage | null,
  viewport: ViewportSize,
  transform?: ViewportTransform | null
) {
  if (!image) {
    return previewSize
  }

  const layout = createLayout(image, viewport, transform)
  return Number((previewSize / Math.max(layout.scale, 0.05)).toFixed(2))
}

export function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

export function pointFromPointerEvent(
  event: { clientX: number; clientY: number },
  canvas: HTMLCanvasElement,
  image: EditorImage,
  viewport: ViewportSize,
  clampToBounds = false,
  transform?: ViewportTransform | null
) {
  const rect = canvas.getBoundingClientRect()
  const layout = createLayout(image, viewport, transform)
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const imageX = (localX - layout.offsetX) / layout.scale
  const imageY = (localY - layout.offsetY) / layout.scale

  const withinBounds =
    imageX >= 0 &&
    imageY >= 0 &&
    imageX <= image.width &&
    imageY <= image.height

  if (!withinBounds && !clampToBounds) {
    return null
  }

  return {
    x: clamp(imageX, 0, image.width),
    y: clamp(imageY, 0, image.height)
  }
}

/**
 * 检测图像坐标点是否命中某个标注。
 * 反向遍历以命中最上层的标注。返回命中的标注 ID 或 null。
 * 可选 filterKind 仅检测指定类型。
 */
export function hitTestAnnotation(
  imagePoint: Point,
  annotations: Annotation[],
  filterKind?: Annotation['kind']
): string | null {
  const HIT_MARGIN = 8 // 额外的命中容差（图像像素）

  for (let i = annotations.length - 1; i >= 0; i--) {
    const annotation = annotations[i]
    if (filterKind && annotation.kind !== filterKind) {
      continue
    }

    if (annotation.kind === 'text') {
      const fontSize = Math.max(14, annotation.size)
      const lineHeight = fontSize * 1.25
      const lines = annotation.text.split(/\r?\n/).filter(Boolean)
      const displayLines = lines.length ? lines : ['']
      const estimatedCharWidth = fontSize * 0.7
      const maxLineWidth = displayLines.reduce(
        (max, line) => Math.max(max, line.length * estimatedCharWidth),
        0
      )
      const paddingX = Math.max(8, fontSize * 0.26)
      const paddingY = Math.max(6, fontSize * 0.2)
      const boxWidth = maxLineWidth + paddingX * 2
      const boxHeight = displayLines.length * lineHeight + paddingY * 2

      if (
        imagePoint.x >= annotation.point.x - HIT_MARGIN &&
        imagePoint.x <= annotation.point.x + boxWidth + HIT_MARGIN &&
        imagePoint.y >= annotation.point.y - HIT_MARGIN &&
        imagePoint.y <= annotation.point.y + boxHeight + HIT_MARGIN
      ) {
        return annotation.id
      }
      continue
    }

    if (annotation.kind === 'step') {
      const radius = Math.max(14, annotation.size * 0.5) + HIT_MARGIN
      const dx = imagePoint.x - annotation.point.x
      const dy = imagePoint.y - annotation.point.y
      if (dx * dx + dy * dy <= radius * radius) {
        return annotation.id
      }
      continue
    }

    if (annotation.kind === 'mosaic' || annotation.kind === 'blur') {
      const r = annotation.rect
      if (
        imagePoint.x >= r.x - HIT_MARGIN &&
        imagePoint.x <= r.x + r.width + HIT_MARGIN &&
        imagePoint.y >= r.y - HIT_MARGIN &&
        imagePoint.y <= r.y + r.height + HIT_MARGIN
      ) {
        return annotation.id
      }
      continue
    }

    if (annotation.kind === 'pen' || annotation.kind === 'highlighter') {
      // 用点集包围盒检测
      if (annotation.points.length < 2) {
        continue
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of annotation.points) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      const strokeMargin = HIT_MARGIN + (annotation.width || 4)
      if (
        imagePoint.x >= minX - strokeMargin &&
        imagePoint.x <= maxX + strokeMargin &&
        imagePoint.y >= minY - strokeMargin &&
        imagePoint.y <= maxY + strokeMargin
      ) {
        // 进一步检测：是否靠近某个点
        for (const p of annotation.points) {
          const pdx = imagePoint.x - p.x
          const pdy = imagePoint.y - p.y
          if (pdx * pdx + pdy * pdy <= strokeMargin * strokeMargin) {
            return annotation.id
          }
        }
      }
      continue
    }

    // line / arrow / rect / ellipse：都有 start + end
    const narrow = annotation as LineAnnotation | RectAnnotation
    const rect = normalizeRect(narrow.start, narrow.end)
    const strokeMargin = HIT_MARGIN + (narrow.width || 4)

    if (annotation.kind === 'line' || annotation.kind === 'arrow') {
      // 线段距离检测
      const dist = pointToSegmentDistance(imagePoint, narrow.start, narrow.end)
      if (dist <= strokeMargin) {
        return annotation.id
      }
      continue
    }

    // rect / ellipse：矩形包围盒
    if (
      imagePoint.x >= rect.x - strokeMargin &&
      imagePoint.x <= rect.x + rect.width + strokeMargin &&
      imagePoint.y >= rect.y - strokeMargin &&
      imagePoint.y <= rect.y + rect.height + strokeMargin
    ) {
      return annotation.id
    }
  }

  return null
}

/** 计算点到线段的最短距离 */
function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const lengthSq = abx * abx + aby * aby
  if (lengthSq === 0) {
    const dx = point.x - a.x
    const dy = point.y - a.y
    return Math.sqrt(dx * dx + dy * dy)
  }
  const t = clamp(((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSq, 0, 1)
  const projX = a.x + t * abx
  const projY = a.y + t * aby
  const dx = point.x - projX
  const dy = point.y - projY
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 按偏移量移动标注，返回新的标注对象。
 * delta 为图像坐标空间的位移。
 */
export function moveAnnotation(annotation: Annotation, delta: Point): Annotation {
  switch (annotation.kind) {
    case 'text':
      return { ...annotation, point: { x: annotation.point.x + delta.x, y: annotation.point.y + delta.y } }
    case 'step':
      return { ...annotation, point: { x: annotation.point.x + delta.x, y: annotation.point.y + delta.y } }
    case 'pen':
    case 'highlighter':
      return { ...annotation, points: annotation.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })) }
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
      return {
        ...annotation,
        start: { x: annotation.start.x + delta.x, y: annotation.start.y + delta.y },
        end: { x: annotation.end.x + delta.x, y: annotation.end.y + delta.y }
      }
    case 'mosaic':
      return { ...annotation, rect: { ...annotation.rect, x: annotation.rect.x + delta.x, y: annotation.rect.y + delta.y } }
    case 'blur':
      return { ...annotation, rect: { ...annotation.rect, x: annotation.rect.x + delta.x, y: annotation.rect.y + delta.y } }
    default:
      return annotation
  }
}

/**
 * 将图像坐标转换为 stage-surface 容器内的 CSS 像素坐标，
 * 用于在 canvas 上方定位内联输入框等浮层元素。
 */
export function imagePointToScreenPoint(
  imagePoint: Point,
  image: EditorImage,
  viewport: ViewportSize,
  transform?: ViewportTransform | null
): Point {
  const layout = createLayout(image, viewport, transform)
  return {
    x: layout.offsetX + imagePoint.x * layout.scale,
    y: layout.offsetY + imagePoint.y * layout.scale
  }
}

/** 获取当前缩放下图像 1px 对应的 CSS 像素数 */
export function getImageScale(
  image: EditorImage,
  viewport: ViewportSize,
  transform?: ViewportTransform | null
): number {
  const layout = createLayout(image, viewport, transform)
  return layout.scale
}

export function annotationHasRenderableArea(annotation: Annotation) {
  if (annotation.kind === 'pen' || annotation.kind === 'highlighter') {
    return annotation.points.length > 1
  }

  if (annotation.kind === 'mosaic' || annotation.kind === 'blur') {
    return annotation.rect.width > 6 && annotation.rect.height > 6
  }

  if (annotation.kind === 'text') {
    return annotation.text.trim().length > 0
  }

  if (annotation.kind === 'step') {
    return annotation.value.trim().length > 0
  }

  const narrow = annotation as LineAnnotation | RectAnnotation
  const width = Math.abs(narrow.end.x - narrow.start.x)
  const height = Math.abs(narrow.end.y - narrow.start.y)
  return width > 4 || height > 4
}

function drawArrowHead(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  width: number
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const headLength = Math.max(16, width * 4.4)

  context.save()
  context.fillStyle = color
  context.beginPath()
  context.moveTo(end.x, end.y)
  context.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 7),
    end.y - headLength * Math.sin(angle - Math.PI / 7)
  )
  context.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 7),
    end.y - headLength * Math.sin(angle + Math.PI / 7)
  )
  context.closePath()
  context.fill()
  context.restore()
}

function pixelateRect(context: CanvasRenderingContext2D, rect: Rect, cellSize: number) {
  const safeRect = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height))
  }

  if (safeRect.width < 2 || safeRect.height < 2) {
    return
  }

  const smallCanvas = document.createElement('canvas')
  const smallWidth = Math.max(1, Math.round(safeRect.width / Math.max(cellSize, 4)))
  const smallHeight = Math.max(1, Math.round(safeRect.height / Math.max(cellSize, 4)))
  smallCanvas.width = smallWidth
  smallCanvas.height = smallHeight

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
    smallWidth,
    smallHeight
  )

  context.save()
  context.imageSmoothingEnabled = false
  context.drawImage(
    smallCanvas,
    0,
    0,
    smallWidth,
    smallHeight,
    safeRect.x,
    safeRect.y,
    safeRect.width,
    safeRect.height
  )
  context.strokeStyle = 'rgba(255, 255, 255, 0.46)'
  context.lineWidth = Math.max(1, cellSize / 14)
  context.strokeRect(safeRect.x, safeRect.y, safeRect.width, safeRect.height)
  context.restore()
}

function blurRect(context: CanvasRenderingContext2D, rect: Rect, radius: number) {
  const safeRect = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height))
  }

  if (safeRect.width < 4 || safeRect.height < 4) {
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
  context.strokeStyle = 'rgba(255, 255, 255, 0.42)'
  context.lineWidth = Math.max(1, radius / 8)
  context.setLineDash([10, 7])
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

function drawTextAnnotation(
  context: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  layout: RenderLayout
) {
  const point = projectPoint(annotation.point, layout)
  const fontSize = Math.max(14, annotation.size * layout.scale)
  const lines = annotation.text.split(/\r?\n/).filter(Boolean)
  const displayLines = lines.length ? lines : ['']
  const lineHeight = fontSize * 1.25

  context.save()
  context.font = `700 ${fontSize}px "Bahnschrift", "Segoe UI Variable Display", "PingFang SC", sans-serif`
  context.textBaseline = 'top'

  const maxWidth = displayLines.reduce((largest, line) => {
    return Math.max(largest, context.measureText(line).width)
  }, 0)

  const paddingX = Math.max(8, fontSize * 0.26)
  const paddingY = Math.max(6, fontSize * 0.2)
  const blockWidth = maxWidth + paddingX * 2
  const blockHeight = displayLines.length * lineHeight + paddingY * 2

  drawRoundedRect(context, point.x, point.y, blockWidth, blockHeight, Math.max(10, fontSize * 0.2))
  context.fillStyle = 'rgba(9, 15, 25, 0.42)'
  context.fill()

  context.lineJoin = 'round'
  context.lineWidth = Math.max(2, fontSize * 0.14)
  context.strokeStyle = 'rgba(6, 11, 20, 0.68)'
  context.fillStyle = annotation.color

  displayLines.forEach((line, index) => {
    const textY = point.y + paddingY + index * lineHeight
    context.strokeText(line, point.x + paddingX, textY)
    context.fillText(line, point.x + paddingX, textY)
  })

  context.restore()
}

function drawStepAnnotation(
  context: CanvasRenderingContext2D,
  annotation: StepAnnotation,
  layout: RenderLayout
) {
  const point = projectPoint(annotation.point, layout)
  const radius = Math.max(14, annotation.size * layout.scale * 0.5)

  context.save()
  context.fillStyle = annotation.color
  context.shadowColor = 'rgba(5, 12, 22, 0.34)'
  context.shadowBlur = 16
  context.beginPath()
  context.arc(point.x, point.y, radius, 0, Math.PI * 2)
  context.fill()

  context.shadowBlur = 0
  context.strokeStyle = 'rgba(255, 255, 255, 0.9)'
  context.lineWidth = Math.max(2, radius * 0.12)
  context.stroke()

  context.fillStyle = '#fffdf9'
  context.font = `800 ${Math.max(14, radius)}px "Bahnschrift", "Segoe UI Variable Display", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(annotation.value, point.x, point.y + 0.5)
  context.restore()
}

function drawSelectionOverlay(context: CanvasRenderingContext2D, layout: RenderLayout, rect: Rect) {
  const start = projectPoint({ x: rect.x, y: rect.y }, layout)
  const end = projectPoint(
    {
      x: rect.x + rect.width,
      y: rect.y + rect.height
    },
    layout
  )
  const safeRect = normalizeRect(start, end)

  if (safeRect.width < 2 || safeRect.height < 2) {
    return
  }

  context.save()
  context.fillStyle = 'rgba(3, 8, 15, 0.5)'
  context.beginPath()
  context.rect(0, 0, layout.width, layout.height)
  context.rect(safeRect.x, safeRect.y, safeRect.width, safeRect.height)
  context.fill('evenodd')

  context.setLineDash([10, 6])
  context.lineWidth = 2
  context.strokeStyle = 'rgba(255, 255, 255, 0.92)'
  context.strokeRect(safeRect.x, safeRect.y, safeRect.width, safeRect.height)

  context.setLineDash([])
  context.fillStyle = '#ffffff'
  const handleSize = 8
  const halfHandle = handleSize / 2
  const handles = [
    [safeRect.x, safeRect.y],
    [safeRect.x + safeRect.width, safeRect.y],
    [safeRect.x, safeRect.y + safeRect.height],
    [safeRect.x + safeRect.width, safeRect.y + safeRect.height]
  ]

  handles.forEach(([x, y]) => {
    context.fillRect(x - halfHandle, y - halfHandle, handleSize, handleSize)
  })

  context.restore()
}

function drawAnnotation(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  layout: RenderLayout
) {
  if (annotation.kind === 'mosaic') {
    const start = projectPoint({ x: annotation.rect.x, y: annotation.rect.y }, layout)
    const end = projectPoint(
      {
        x: annotation.rect.x + annotation.rect.width,
        y: annotation.rect.y + annotation.rect.height
      },
      layout
    )
    pixelateRect(context, normalizeRect(start, end), annotation.cellSize * layout.scale)
    return
  }

  if (annotation.kind === 'blur') {
    const start = projectPoint({ x: annotation.rect.x, y: annotation.rect.y }, layout)
    const end = projectPoint(
      {
        x: annotation.rect.x + annotation.rect.width,
        y: annotation.rect.y + annotation.rect.height
      },
      layout
    )
    blurRect(context, normalizeRect(start, end), annotation.radius * layout.scale)
    return
  }

  if (annotation.kind === 'text') {
    drawTextAnnotation(context, annotation, layout)
    return
  }

  if (annotation.kind === 'step') {
    drawStepAnnotation(context, annotation, layout)
    return
  }

  context.save()
  context.strokeStyle = annotation.color
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.lineWidth = annotation.width * layout.scale

  if (annotation.kind === 'pen' || annotation.kind === 'highlighter') {
    const [firstPoint, ...restPoints] = annotation.points
    if (!firstPoint) {
      context.restore()
      return
    }

    const start = projectPoint(firstPoint, layout)
    context.beginPath()
    context.moveTo(start.x, start.y)

    restPoints.forEach((point) => {
      const projected = projectPoint(point, layout)
      context.lineTo(projected.x, projected.y)
    })

    if (annotation.kind === 'highlighter') {
      context.globalAlpha = 0.34
    }

    context.stroke()
    context.restore()
    return
  }

  const narrow = annotation as LineAnnotation | RectAnnotation
  const start = projectPoint(narrow.start, layout)
  const end = projectPoint(narrow.end, layout)

  if (annotation.kind === 'rect' || annotation.kind === 'ellipse') {
    const rect = normalizeRect(start, end)
    context.fillStyle = `${annotation.color}1f`

    if (annotation.kind === 'rect') {
      context.strokeRect(rect.x, rect.y, rect.width, rect.height)
      context.fillRect(rect.x, rect.y, rect.width, rect.height)
    } else {
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

    context.restore()
    return
  }

  context.beginPath()
  context.moveTo(start.x, start.y)
  context.lineTo(end.x, end.y)
  context.stroke()

  if (annotation.kind === 'arrow') {
    drawArrowHead(context, start, end, annotation.color, annotation.width * layout.scale)
  }

  context.restore()
}

function paintStageBackdrop(
  context: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number
) {
  context.save()
  context.clearRect(0, 0, canvasWidth, canvasHeight)

  const gradient = context.createLinearGradient(0, 0, canvasWidth, canvasHeight)
  gradient.addColorStop(0, '#081520')
  gradient.addColorStop(1, '#183249')
  context.fillStyle = gradient
  context.fillRect(0, 0, canvasWidth, canvasHeight)

  context.globalAlpha = 0.08
  context.strokeStyle = '#ffffff'
  for (let x = 0; x < canvasWidth; x += 24) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, canvasHeight)
    context.stroke()
  }

  for (let y = 0; y < canvasHeight; y += 24) {
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(canvasWidth, y)
    context.stroke()
  }

  context.restore()
}

function paintImage(
  context: CanvasRenderingContext2D,
  imageElement: HTMLImageElement,
  image: EditorImage,
  layout: RenderLayout
) {
  context.save()
  context.shadowColor = 'rgba(3, 8, 17, 0.32)'
  context.shadowBlur = 36
  context.shadowOffsetY = 14
  context.fillStyle = '#07111b'
  context.fillRect(
    layout.offsetX,
    layout.offsetY,
    image.width * layout.scale,
    image.height * layout.scale
  )
  context.drawImage(
    imageElement,
    layout.offsetX,
    layout.offsetY,
    image.width * layout.scale,
    image.height * layout.scale
  )
  context.restore()
}

/**
 * 计算标注在图像坐标空间中的包围盒。
 */
export function getAnnotationBounds(annotation: Annotation): Rect {
  switch (annotation.kind) {
    case 'text': {
      const fontSize = Math.max(14, annotation.size)
      const lineHeight = fontSize * 1.25
      const lines = annotation.text.split(/\r?\n/).filter(Boolean)
      const displayLines = lines.length ? lines : ['']
      const estimatedCharWidth = fontSize * 0.7
      const maxLineWidth = displayLines.reduce(
        (max, line) => Math.max(max, line.length * estimatedCharWidth), 0
      )
      const px = Math.max(8, fontSize * 0.26)
      const py = Math.max(6, fontSize * 0.2)
      return { x: annotation.point.x, y: annotation.point.y, width: maxLineWidth + px * 2, height: displayLines.length * lineHeight + py * 2 }
    }
    case 'step': {
      const r = Math.max(14, annotation.size * 0.5)
      return { x: annotation.point.x - r, y: annotation.point.y - r, width: r * 2, height: r * 2 }
    }
    case 'mosaic':
    case 'blur':
      return { ...annotation.rect }
    case 'pen':
    case 'highlighter': {
      if (annotation.points.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 }
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const p of annotation.points) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      const w = annotation.width || 4
      return { x: minX - w, y: minY - w, width: maxX - minX + w * 2, height: maxY - minY + w * 2 }
    }
    default: {
      // line / arrow / rect / ellipse
      const narrow = annotation as LineAnnotation | RectAnnotation
      const rect = normalizeRect(narrow.start, narrow.end)
      const w = narrow.width || 4
      return { x: rect.x - w, y: rect.y - w, width: rect.width + w * 2, height: rect.height + w * 2 }
    }
  }
}

/**
 * 绘制标注选中高亮框（蓝色虚线 + 角点手柄）。
 */
function drawAnnotationHighlight(
  context: CanvasRenderingContext2D,
  annotation: Annotation,
  layout: RenderLayout
) {
  const bounds = getAnnotationBounds(annotation)
  const topLeft = projectPoint({ x: bounds.x, y: bounds.y }, layout)
  const bottomRight = projectPoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, layout)
  const margin = 4
  const rx = topLeft.x - margin
  const ry = topLeft.y - margin
  const rw = bottomRight.x - topLeft.x + margin * 2
  const rh = bottomRight.y - topLeft.y + margin * 2

  context.save()
  context.setLineDash([6, 4])
  context.lineWidth = 1.5
  context.strokeStyle = '#4f7cff'
  context.strokeRect(rx, ry, rw, rh)
  context.setLineDash([])

  // 四角手柄
  const handleSize = 6
  const hs = handleSize / 2
  context.fillStyle = '#4f7cff'
  const corners = [
    [rx, ry], [rx + rw, ry],
    [rx, ry + rh], [rx + rw, ry + rh]
  ]
  for (const [cx, cy] of corners) {
    context.fillRect(cx - hs, cy - hs, handleSize, handleSize)
  }
  context.restore()
}

export function renderPreviewCanvas(args: {
  canvas: HTMLCanvasElement
  imageElement: HTMLImageElement
  image: EditorImage
  annotations: Annotation[]
  draftAnnotation: DraftAnnotation
  viewport: ViewportSize
  selectionRect?: Rect | null
  transform?: ViewportTransform | null
  selectedAnnotationId?: string | null
}) {
  const { canvas, imageElement, image, annotations, draftAnnotation, viewport, selectionRect, transform, selectedAnnotationId } = args
  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  const dpr = window.devicePixelRatio || 1
  const cssWidth = Math.max(1, Math.floor(viewport.width))
  const cssHeight = Math.max(1, Math.floor(viewport.height))
  canvas.width = Math.round(cssWidth * dpr)
  canvas.height = Math.round(cssHeight * dpr)
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`

  context.setTransform(1, 0, 0, 1, 0, 0)
  context.scale(dpr, dpr)

  paintStageBackdrop(context, cssWidth, cssHeight)

  const layout = createLayout(image, viewport, transform)
  paintImage(context, imageElement, image, layout)

  annotations.forEach((annotation) => {
    drawAnnotation(context, annotation, layout)
  })

  if (draftAnnotation) {
    drawAnnotation(context, draftAnnotation, layout)
  }

  if (selectionRect) {
    drawSelectionOverlay(context, layout, selectionRect)
  }

  // 绘制选中标注的高亮框
  if (selectedAnnotationId) {
    const selectedAnnotation = annotations.find((a) => a.id === selectedAnnotationId)
    if (selectedAnnotation) {
      drawAnnotationHighlight(context, selectedAnnotation, layout)
    }
  }

  context.save()
  context.strokeStyle = 'rgba(255, 255, 255, 0.24)'
  context.lineWidth = 1
  context.strokeRect(
    layout.offsetX - 0.5,
    layout.offsetY - 0.5,
    image.width * layout.scale + 1,
    image.height * layout.scale + 1
  )
  context.restore()
}

export function exportAnnotatedDataUrl(args: {
  imageElement: HTMLImageElement
  image: EditorImage
  annotations: Annotation[]
}) {
  const { imageElement, image, annotations } = args
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = image.width
  exportCanvas.height = image.height

  const context = exportCanvas.getContext('2d')
  if (!context) {
    return null
  }

  const layout: RenderLayout = {
    width: image.width,
    height: image.height,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  }

  context.drawImage(imageElement, 0, 0, image.width, image.height)
  annotations.forEach((annotation) => {
    drawAnnotation(context, annotation, layout)
  })

  return exportCanvas.toDataURL('image/png')
}

/** 异步版本：使用 toBlob 进行非阻塞 PNG 编码，避免大图卡住主线程 */
export function exportAnnotatedBlob(args: {
  imageElement: HTMLImageElement
  image: EditorImage
  annotations: Annotation[]
}): Promise<Blob | null> {
  const { imageElement, image, annotations } = args
  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = image.width
  exportCanvas.height = image.height

  const context = exportCanvas.getContext('2d')
  if (!context) {
    return Promise.resolve(null)
  }

  const layout: RenderLayout = {
    width: image.width,
    height: image.height,
    scale: 1,
    offsetX: 0,
    offsetY: 0
  }

  context.drawImage(imageElement, 0, 0, image.width, image.height)
  annotations.forEach((annotation) => {
    drawAnnotation(context, annotation, layout)
  })

  return new Promise((resolve) => {
    exportCanvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}
