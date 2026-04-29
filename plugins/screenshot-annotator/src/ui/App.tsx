import {
  MousePointer2,
  Pencil,
  Redo2,
  Save,
  Square,
  X,
  Clipboard,
  MoveRight,
  Undo2
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMulby } from './hooks/useMulby'

type Tool = 'select' | 'rect' | 'arrow' | 'pen'

type Point = {
  x: number
  y: number
}

type RectAnnotation = {
  id: string
  type: 'rect'
  start: Point
  end: Point
  color: string
  size: number
}

type ArrowAnnotation = {
  id: string
  type: 'arrow'
  start: Point
  end: Point
  color: string
  size: number
}

type PenAnnotation = {
  id: string
  type: 'pen'
  points: Point[]
  color: string
  size: number
}

type Annotation = RectAnnotation | ArrowAnnotation | PenAnnotation

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
const TOOLBAR_HEIGHT = 56
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

function drawAnnotation(context: CanvasRenderingContext2D, annotation: Annotation) {
  context.save()
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = annotation.color
  context.lineWidth = annotation.size

  if (annotation.type === 'rect') {
    const x = Math.min(annotation.start.x, annotation.end.x)
    const y = Math.min(annotation.start.y, annotation.end.y)
    const width = Math.abs(annotation.end.x - annotation.start.x)
    const height = Math.abs(annotation.end.y - annotation.start.y)
    context.strokeRect(x, y, width, height)
  }

  if (annotation.type === 'arrow') {
    context.beginPath()
    context.moveTo(annotation.start.x, annotation.start.y)
    context.lineTo(annotation.end.x, annotation.end.y)
    context.stroke()
    drawArrowHead(context, annotation.start, annotation.end, annotation.size)
  }

  if (annotation.type === 'pen' && annotation.points.length > 1) {
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

    const regionWidth = image.region?.width
    const regionHeight = image.region?.height

    if (regionWidth && regionHeight) {
      return { width: regionWidth, height: regionHeight }
    }

    return {
      width: Math.max(240, Math.round(image.width / image.scaleFactor)),
      height: Math.max(120, Math.round(image.height / image.scaleFactor))
    }
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
      if (event.key === 'Escape') {
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

          if (attachment.capture?.region) {
            const { x, y, width, height } = attachment.capture.region
            void window.mulby?.window?.setBounds?.({
              x,
              y,
              width: Math.max(width, TOOLBAR_MIN_WIDTH),
              height: height + TOOLBAR_HEIGHT
            })
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

    event.currentTarget.setPointerCapture(event.pointerId)
    const point = getPoint(event)
    dragStartRef.current = point

    const nextDraft: Annotation = tool === 'pen'
      ? { id: createId(), type: 'pen', points: [point], color, size }
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
    const nextDraft: Annotation = currentDraft.type === 'pen'
      ? { ...currentDraft, points: [...currentDraft.points, point] }
      : { ...currentDraft, end: point }

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

    const hasArea = currentDraft.type === 'pen'
      ? currentDraft.points.length > 1
      : Math.abs(currentDraft.end.x - currentDraft.start.x) > 2 ||
        Math.abs(currentDraft.end.y - currentDraft.start.y) > 2

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

  const toolItems: Array<{ key: Tool; icon: typeof MousePointer2; label: string }> = [
    { key: 'select', icon: MousePointer2, label: '选择' },
    { key: 'rect', icon: Square, label: '矩形' },
    { key: 'arrow', icon: MoveRight, label: '箭头' },
    { key: 'pen', icon: Pencil, label: '画笔' }
  ]

  return (
    <div className="annotator-root">
      <main className="canvas-shell" style={{ height: cssSize.height || 'calc(100vh - 56px)' }}>
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
        <div className="tool-group">
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

        <div className="tool-group">
          <button className="icon-button" title="撤销" type="button" onClick={handleUndo} disabled={!undoStack.length}>
            <Undo2 size={18} />
          </button>
          <button className="icon-button" title="重做" type="button" onClick={handleRedo} disabled={!redoStack.length}>
            <Redo2 size={18} />
          </button>
        </div>

        <div className="status-line">{status}</div>

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
      </footer>
    </div>
  )
}
