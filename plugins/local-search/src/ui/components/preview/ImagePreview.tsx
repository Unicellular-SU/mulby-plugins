import React, { useState, useRef, useEffect, useCallback } from 'react'
import { FileItem, PreviewRenderer, PreviewSource, imageMimeForExt, hasTransparency } from '../../utils'
import { useMulby } from '../../hooks/useMulby'
import { PreviewMeta, FileInfo } from './PreviewChrome'

interface ImageMeta {
  width?: number
  height?: number
  format?: string
}

interface Props {
  file: FileItem
  data: string // svg 文本 | 原始 base64 | 文件路径 | 后端返回的 PNG base64
  source: PreviewSource
  renderer: PreviewRenderer
  meta: ImageMeta | null
  fileInfo: FileInfo | null
}

function buildSrc(file: FileItem, data: string, source: PreviewSource): string {
  if (source === 'backend') return `data:image/png;base64,${data}`
  if (source === 'text') {
    // SVG：文本转 data URI
    try {
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(data)))}`
    } catch {
      return `data:image/svg+xml;utf8,${encodeURIComponent(data)}`
    }
  }
  if (source === 'filepath') return `file://${data}`
  return `data:${imageMimeForExt(file.ext)};base64,${data}`
}

const MIN_SCALE = 0.1
const MAX_SCALE = 10

export default function ImagePreview({ file, data, source, renderer, meta, fileInfo }: Props) {
  const { previewImageAsPng } = useMulby()
  const [src, setSrc] = useState(() => buildSrc(file, data, source))
  const [dims, setDims] = useState<{ w: number; h: number } | null>(
    meta?.width && meta?.height ? { w: meta.width, h: meta.height } : null
  )
  const [format, setFormat] = useState<string | undefined>(meta?.format)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const triedBackend = useRef(false)
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setSrc(buildSrc(file, data, source))
    setDims(meta?.width && meta?.height ? { w: meta.width, h: meta.height } : null)
    setFormat(meta?.format)
    setScale(1)
    setOffset({ x: 0, y: 0 })
    triedBackend.current = renderer === 'image-native' // 后端已解码过的不再回退
  }, [file.path, data, source, renderer, meta])

  // 浏览器解码失败（avif/heic 等）时回退到后端 sharp 解码
  const onError = useCallback(async () => {
    if (triedBackend.current) return
    triedBackend.current = true
    try {
      const res = await previewImageAsPng(file.path)
      if (res?.base64) {
        setSrc(`data:image/png;base64,${res.base64}`)
        if (res.meta?.width && res.meta?.height) setDims({ w: res.meta.width, h: res.meta.height })
        if (res.meta?.format) setFormat(res.meta.format)
      }
    } catch {
      /* 回退失败，保持当前（损坏的）图像，元信息条仍可见 */
    }
  }, [file.path, previewImageAsPng])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (e.deltaY < 0 ? 1.12 : 0.89))))
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    dragOrigin.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragOrigin.current) return
    setOffset({ x: e.clientX - dragOrigin.current.x, y: e.clientY - dragOrigin.current.y })
  }
  const onPointerUp = () => {
    dragOrigin.current = null
  }
  const reset = () => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const onLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth && !dims) setDims({ w: img.naturalWidth, h: img.naturalHeight })
  }

  const transparent = hasTransparency(file.ext)

  return (
    <div className="preview-area flex-1 relative p-4" onWheel={onWheel} onDoubleClick={reset}>
      <div
        className={`preview-img-stage${transparent ? ' checkerboard' : ''}`}
        style={{ cursor: scale > 1 ? 'grab' : 'default' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <img
          src={src}
          alt={file.name}
          className="preview-img"
          draggable={false}
          onLoad={onLoad}
          onError={onError}
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        />
      </div>
      <PreviewMeta
        file={file}
        fileInfo={fileInfo}
        extra={
          dims ? (
            <span>
              {dims.w}×{dims.h}
              {format ? ` · ${format.toUpperCase()}` : ''}
            </span>
          ) : undefined
        }
      />
    </div>
  )
}
