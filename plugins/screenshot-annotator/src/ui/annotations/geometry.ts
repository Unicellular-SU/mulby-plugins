// 标注的纯几何计算与变换（从 App.tsx 搬移，保持原样）。

import { TEXT_BOX_MIN_WIDTH } from './constants'
import { getTextBounds } from './textLayout'
import type {
  Annotation,
  EditHandleMode,
  EffectAnnotation,
  Point,
  Rect,
  ResizeHandle,
  ShapeAnnotation,
  StrokeAnnotation,
  Tool
} from './types'

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

export function clampRect(rect: Rect, canvas: HTMLCanvasElement): Rect {
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

export function pointDistanceToSegment(point: Point, start: Point, end: Point) {
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

export function isPointInRect(point: Point, rect: Rect, padding = 0) {
  return (
    point.x >= rect.x - padding &&
    point.y >= rect.y - padding &&
    point.x <= rect.x + rect.width + padding &&
    point.y <= rect.y + rect.height + padding
  )
}

export function isPointNearRectStroke(point: Point, rect: Rect, tolerance: number) {
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

export function isPointNearEllipseStroke(point: Point, rect: Rect, tolerance: number) {
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

export function isStrokeAnnotation(annotation: Annotation): annotation is StrokeAnnotation {
  return annotation.type === 'pen' || annotation.type === 'highlighter'
}

export function isDragAnnotation(annotation: Annotation): annotation is ShapeAnnotation | EffectAnnotation {
  return (
    annotation.type === 'line' ||
    annotation.type === 'rect' ||
    annotation.type === 'ellipse' ||
    annotation.type === 'arrow' ||
    annotation.type === 'mosaic' ||
    annotation.type === 'blur'
  )
}

export function getEditableAnnotationTypeForTool(tool: Tool): Annotation['type'] | null {
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

export function visualSizeToImageSize(visualSize: number, imageToCssScale: number) {
  return Math.max(1, visualSize / Math.max(imageToCssScale, 0.01))
}

export function getAnnotationBounds(annotation: Annotation): Rect {
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

export function annotationHasRenderableArea(annotation: Annotation) {
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

export function moveAnnotation(annotation: Annotation, delta: Point): Annotation {
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

export function snapPointTo45Degrees(origin: Point, point: Point): Point {
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

export function snapPointToSquare(origin: Point, point: Point): Point {
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  const side = Math.max(Math.abs(dx), Math.abs(dy))

  return {
    x: origin.x + (dx < 0 ? -side : side),
    y: origin.y + (dy < 0 ? -side : side)
  }
}

export function getResizeHandlePoints(rect: Rect): Array<{ mode: ResizeHandle; point: Point }> {
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

export function resizeRectFromHandle(rect: Rect, mode: ResizeHandle, point: Point, keepSquare: boolean) {
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

export function resizeAnnotation(
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
