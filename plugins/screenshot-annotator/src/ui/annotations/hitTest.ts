// 标注的命中测试与编辑手柄光标映射（从 App.tsx 搬移，保持原样）。

import { EDIT_HANDLE_HIT_VISUAL_SIZE } from './constants'
import {
  getResizeHandlePoints,
  isPointInRect,
  isPointNearEllipseStroke,
  isPointNearRectStroke,
  isStrokeAnnotation,
  normalizeRect,
  pointDistanceToSegment,
  visualSizeToImageSize
} from './geometry'
import { getTextBounds } from './textLayout'
import type { Annotation, EditHandle, EditHandleMode, Point } from './types'

export function hitTestAnnotation(point: Point, annotations: Annotation[], filterType?: Annotation['type']) {
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

export function isPointInHandle(point: Point, handlePoint: Point, handleSize: number) {
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

export function hitTestEditHandle(
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

export function cursorForEditMode(mode: EditHandleMode, dragging = false) {
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
