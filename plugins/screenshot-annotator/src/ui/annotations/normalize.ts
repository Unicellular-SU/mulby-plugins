// 外部数据（历史记录）到标注结构的归一化（从 App.tsx 搬移，保持原样）。

import { createId } from '../utils/image'
import { COLORS } from './constants'
import type { Annotation, Point } from './types'

export function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function asPoint(value: unknown): Point | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const point = value as { x?: unknown; y?: unknown }
  const x = asFiniteNumber(point.x)
  const y = asFiniteNumber(point.y)

  return x === null || y === null ? null : { x, y }
}

export function asColor(value: unknown) {
  return typeof value === 'string' && value ? value : COLORS[0]
}

export function asSize(value: unknown, fallback: number) {
  const size = asFiniteNumber(value)
  return size === null ? fallback : Math.max(1, size)
}

export function normalizeAnnotations(value: unknown): Annotation[] {
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
