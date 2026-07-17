// 截图显示尺寸与窗口边界计算（从 App.tsx 搬移，保持原样）。

import { TOOLBAR_HEIGHT, TOOLBAR_MIN_WIDTH } from '../annotations/constants'
import { clamp } from '../annotations/geometry'
import type { CaptureRegion, DisplaySize, LoadedImage } from '../annotations/types'

export function getDisplaySize(image: LoadedImage) {
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

export function getPreviewDisplaySize(data: {
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

export function fitDisplaySize(size: DisplaySize, viewport: DisplaySize): DisplaySize {
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

export function buildConstrainedBounds(args: {
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
