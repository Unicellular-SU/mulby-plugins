import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type WheelEvent as RWheelEvent
} from 'react'
import {
  ArrowUpRight,
  Brush,
  Eraser,
  Hand,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  Type,
  Undo2,
  X
} from 'lucide-react'
import { useEscClose } from '../hooks'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { inpaint, type InpaintOp } from '../services/inpaint'
import { loadImageInput } from '../services/media'
import { toast, type ToastType } from '../store/toastStore'

function notify(message: string, type?: string) {
  toast(message, (type as ToastType) || 'info')
}

type EditorTool = 'pan' | 'mask' | 'erase' | 'arrow' | 'text'
type Point = { x: number; y: number }
type ArrowAnnotation = { kind: 'arrow'; start: Point; end: Point }
type TextAnnotation = { kind: 'text'; point: Point; text: string }
type Annotation = ArrowAnnotation | TextAnnotation
type TextDraft = TextAnnotation & { left: number; top: number }
type ActiveGesture =
  | { kind: 'pan'; pointerId: number; client: Point; initialPan: Point }
  | { kind: 'paint'; pointerId: number }
  | { kind: 'arrow'; pointerId: number; start: Point; end: Point }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const char of Array.from(text)) {
    const next = line + char
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = char
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  if (lines.length <= 4) return lines
  const visible = lines.slice(0, 4)
  visible[3] = visible[3].slice(0, Math.max(1, visible[3].length - 1)) + '…'
  return visible
}

function drawArrow(ctx: CanvasRenderingContext2D, annotation: ArrowAnnotation, unit: number) {
  const { start, end } = annotation
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const head = 15 * unit
  const paint = (color: string, width: number) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6))
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6))
    ctx.stroke()
  }
  paint('rgba(255,255,255,.96)', 7 * unit)
  paint('#ef4444', 4 * unit)
}

function drawTextAnnotation(
  ctx: CanvasRenderingContext2D,
  annotation: TextAnnotation,
  unit: number,
  canvasWidth: number,
  canvasHeight: number
) {
  const fontSize = 15 * unit
  const paddingX = 7 * unit
  const paddingY = 5 * unit
  const lineHeight = 20 * unit
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`
  const maxTextWidth = Math.max(100 * unit, Math.min(canvasWidth * 0.48, canvasWidth - paddingX * 4))
  const lines = wrapCanvasText(ctx, annotation.text, maxTextWidth)
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 1)
  const boxWidth = textWidth + paddingX * 2
  const boxHeight = lines.length * lineHeight + paddingY * 2
  const x = clamp(annotation.point.x, paddingX, Math.max(paddingX, canvasWidth - boxWidth - paddingX))
  const y = clamp(annotation.point.y, paddingY, Math.max(paddingY, canvasHeight - boxHeight - paddingY))

  ctx.fillStyle = 'rgba(250,204,21,.96)'
  ctx.strokeStyle = 'rgba(255,255,255,.96)'
  ctx.lineWidth = 2 * unit
  ctx.beginPath()
  ctx.roundRect(x, y, boxWidth, boxHeight, 5 * unit)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#111827'
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => ctx.fillText(line, x + paddingX, y + paddingY + index * lineHeight))
}

function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  unit: number,
  canvasWidth: number,
  canvasHeight: number
) {
  for (const annotation of annotations) {
    if (annotation.kind === 'arrow') drawArrow(ctx, annotation, unit)
    else drawTextAnnotation(ctx, annotation, unit, canvasWidth, canvasHeight)
  }
}

function maskHasContent(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d')
  if (!ctx || !canvas.width || !canvas.height) return false
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) return true
  }
  return false
}

export function MaskInpaintModal() {
  const cardId = useUi((state) => state.maskCardId)
  if (!cardId) return null
  return <Inner cardId={cardId} />
}

function Inner({ cardId }: { cardId: string }) {
  const card = useGraph((state) => state.getActiveBoard().cards[cardId])
  const viewportRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const maskCanvasRef = useRef<HTMLCanvasElement>(null)
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null)
  const activeGesture = useRef<ActiveGesture | null>(null)
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 })
  const [brush, setBrush] = useState(48)
  const [tool, setTool] = useState<EditorTool>('mask')
  const [op, setOp] = useState<InpaintOp>('repaint')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 })
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draftArrow, setDraftArrow] = useState<ArrowAnnotation | null>(null)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)

  const close = () => {
    if (!busy) useUi.getState().setMaskCardId(null)
  }
  useEscClose(close)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const update = () => setViewportSize({ w: viewport.clientWidth, h: viewport.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const fitScale = imageSize.w && imageSize.h && viewportSize.w && viewportSize.h
    ? Math.min(Math.max(1, viewportSize.w - 32) / imageSize.w, Math.max(1, viewportSize.h - 32) / imageSize.h)
    : 1
  const fittedSize = {
    w: imageSize.w ? imageSize.w * fitScale : 0,
    h: imageSize.h ? imageSize.h * fitScale : 0
  }
  const annotationUnit = 1 / Math.max(fitScale, 0.0001)

  useEffect(() => {
    const canvas = annotationCanvasRef.current
    if (!canvas || !imageSize.w || !imageSize.h) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    drawAnnotations(
      ctx,
      draftArrow ? [...annotations, draftArrow] : annotations,
      annotationUnit,
      canvas.width,
      canvas.height
    )
  }, [annotations, draftArrow, imageSize.w, imageSize.h, annotationUnit])

  if (!card || !card.assetUrl) {
    useUi.getState().setMaskCardId(null)
    return null
  }

  const imagePoint = (event: RPointerEvent): Point | null => {
    const canvas = maskCanvasRef.current
    if (!canvas || !canvas.width || !canvas.height) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: clamp((event.clientX - rect.left) * (canvas.width / rect.width), 0, canvas.width),
      y: clamp((event.clientY - rect.top) * (canvas.height / rect.height), 0, canvas.height)
    }
  }

  const beginPaint = (event: RPointerEvent, erase: boolean) => {
    const canvas = maskCanvasRef.current
    const point = imagePoint(event)
    if (!canvas || !point) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    if (!ctx || !rect.width) return
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = 'rgba(236,72,153,1)'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = brush * (canvas.width / rect.width)
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    ctx.lineTo(point.x + 0.01, point.y + 0.01)
    ctx.stroke()
  }

  const continuePaint = (event: RPointerEvent) => {
    const canvas = maskCanvasRef.current
    const point = imagePoint(event)
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !point) return
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }

  const handlePointerDown = (event: RPointerEvent<HTMLDivElement>) => {
    if (busy || textDraft) return
    const viewport = viewportRef.current
    if (!viewport) return
    const shouldPan = event.button === 1 || tool === 'pan'
    if (shouldPan) {
      event.preventDefault()
      viewport.setPointerCapture(event.pointerId)
      activeGesture.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        client: { x: event.clientX, y: event.clientY },
        initialPan: pan
      }
      return
    }
    if (event.button !== 0 || !sceneRef.current?.contains(event.target as Node)) return
    const point = imagePoint(event)
    if (!point) return
    event.preventDefault()

    if (tool === 'text') {
      const bounds = viewport.getBoundingClientRect()
      setTextDraft({
        kind: 'text',
        point,
        text: '',
        left: clamp(event.clientX - bounds.left, 8, Math.max(8, bounds.width - 260)),
        top: clamp(event.clientY - bounds.top + 8, 8, Math.max(8, bounds.height - 46))
      })
      return
    }

    viewport.setPointerCapture(event.pointerId)

    if (tool === 'mask' || tool === 'erase') {
      beginPaint(event, tool === 'erase')
      activeGesture.current = { kind: 'paint', pointerId: event.pointerId }
    } else if (tool === 'arrow') {
      const arrow: ArrowAnnotation = { kind: 'arrow', start: point, end: point }
      activeGesture.current = { kind: 'arrow', pointerId: event.pointerId, start: point, end: point }
      setDraftArrow(arrow)
    }
  }

  const handlePointerMove = (event: RPointerEvent<HTMLDivElement>) => {
    const gesture = activeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (gesture.kind === 'pan') {
      setPan({
        x: gesture.initialPan.x + event.clientX - gesture.client.x,
        y: gesture.initialPan.y + event.clientY - gesture.client.y
      })
    } else if (gesture.kind === 'paint') {
      continuePaint(event)
    } else {
      const point = imagePoint(event)
      if (!point) return
      gesture.end = point
      setDraftArrow({ kind: 'arrow', start: gesture.start, end: point })
    }
  }

  const endPointerGesture = (event: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = activeGesture.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    if (!cancelled && gesture.kind === 'arrow') {
      const length = Math.hypot(gesture.end.x - gesture.start.x, gesture.end.y - gesture.start.y)
      const canvas = maskCanvasRef.current
      const rect = canvas?.getBoundingClientRect()
      const minimumLength = canvas && rect?.width ? 8 * (canvas.width / rect.width) : 8 * annotationUnit
      if (length >= minimumLength) {
        setAnnotations((current) => [...current, { kind: 'arrow', start: gesture.start, end: gesture.end }])
      }
    }
    if (gesture.kind === 'paint') maskCanvasRef.current?.getContext('2d')?.closePath()
    activeGesture.current = null
    setDraftArrow(null)
    try { viewportRef.current?.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  const zoomAround = (nextZoom: number, clientX?: number, clientY?: number) => {
    const next = clamp(nextZoom, 0.25, 6)
    const viewport = viewportRef.current
    if (!viewport || next === zoom) return
    const rect = viewport.getBoundingClientRect()
    const cursor = {
      x: clientX === undefined ? 0 : clientX - rect.left - rect.width / 2,
      y: clientY === undefined ? 0 : clientY - rect.top - rect.height / 2
    }
    const ratio = next / zoom
    setPan({
      x: cursor.x - (cursor.x - pan.x) * ratio,
      y: cursor.y - (cursor.y - pan.y) * ratio
    })
    setZoom(next)
  }

  const handleWheel = (event: RWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    zoomAround(zoom * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY)
  }

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const clearMask = () => {
    const canvas = maskCanvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }

  const clearAll = () => {
    clearMask()
    setAnnotations([])
    setDraftArrow(null)
    setTextDraft(null)
  }

  const commitTextDraft = () => {
    if (!textDraft) return
    const text = textDraft.text.trim()
    if (text) setAnnotations((current) => [...current, { kind: 'text', point: textDraft.point, text }])
    setTextDraft(null)
  }

  const effectiveAnnotations = (): Annotation[] => {
    const draft = textDraft
    const draftText = draft?.text.trim()
    return draft && draftText
      ? [...annotations, { kind: 'text', point: draft.point, text: draftText }]
      : annotations
  }

  // 底图从字节解码（blob→ImageBitmap），避免 file:// 图片绘到 canvas 后 toDataURL 被 taint。
  const buildComposite = async (hasMask: boolean, finalAnnotations: Annotation[]): Promise<string | null> => {
    const maskCanvas = maskCanvasRef.current
    if (!maskCanvas) return null
    const buffer = await loadImageInput({ url: card.assetUrl!, localPath: card.assetLocalPath || undefined })
    if (!buffer) return null
    const bitmap = await createImageBitmap(new Blob([buffer], { type: card.mime || 'image/png' }))
    const output = document.createElement('canvas')
    output.width = maskCanvas.width
    output.height = maskCanvas.height
    const ctx = output.getContext('2d')
    if (!ctx) {
      bitmap.close?.()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, output.width, output.height)
    bitmap.close?.()
    if (hasMask) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(maskCanvas, 0, 0)
      if (op === 'remove') {
        ctx.globalCompositeOperation = 'destination-over'
        ctx.fillStyle = '#00ff00'
        ctx.fillRect(0, 0, output.width, output.height)
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    drawAnnotations(ctx, finalAnnotations, annotationUnit, output.width, output.height)
    return output.toDataURL('image/png')
  }

  const buildMask = (): string | undefined => {
    const source = maskCanvasRef.current
    if (!source) return undefined
    const mask = document.createElement('canvas')
    mask.width = source.width
    mask.height = source.height
    const ctx = mask.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, mask.width, mask.height)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.drawImage(source, 0, 0)
    return mask.toDataURL('image/png')
  }

  const run = async () => {
    const maskCanvas = maskCanvasRef.current
    if (!maskCanvas) return
    const hasMask = maskHasContent(maskCanvas)
    const finalAnnotations = effectiveAnnotations()
    const annotationTexts = finalAnnotations
      .filter((annotation): annotation is TextAnnotation => annotation.kind === 'text')
      .map((annotation) => annotation.text)
    if (!hasMask && !finalAnnotations.length) {
      notify('请涂抹修改区域，或在图片上添加箭头 / 文字标注', 'error')
      return
    }
    if (op === 'repaint' && !prompt.trim() && !annotationTexts.length) {
      notify('请在右侧描述修改内容，或直接在图片上添加文字标注', 'error')
      return
    }

    setBusy(true)
    try {
      const composite = await buildComposite(hasMask, finalAnnotations)
      if (!composite) throw new Error('无法读取或合成原图')
      const mask = hasMask ? buildMask() : undefined
      await inpaint(cardId, op, composite, prompt.trim(), mask, {
        hasAnnotations: finalAnnotations.length > 0,
        annotationTexts
      })
      notify(op === 'remove' ? '已擦除，结果落为新卡' : '局部重绘完成，结果落为新卡', 'success')
      useUi.getState().setMaskCardId(null)
    } catch (error: any) {
      notify('处理失败：' + (error?.message || String(error)), 'error')
    } finally {
      setBusy(false)
    }
  }

  const toolButton = (value: EditorTool, title: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setTool(value)}
      className={`h-8 w-8 grid place-items-center rounded-md transition-colors ${tool === value ? 'bg-indigo-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}
      title={title}
    >
      {icon}
    </button>
  )

  const cursor = tool === 'pan' ? 'grab' : tool === 'text' ? 'text' : 'crosshair'

  return (
    <div className="fixed inset-0 z-[80] bg-black/65 flex items-center justify-center p-3" onClick={close}>
      <div
        data-interactive
        onClick={(event) => event.stopPropagation()}
        className="ace-dialog ace-anim-scale flex flex-col text-neutral-800 dark:text-neutral-200 overflow-hidden"
        style={{ width: 'min(1400px, 96vw)', height: 'min(920px, 94vh)' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--ace-border)' }}>
          <div>
            <div className="flex items-center gap-2 font-semibold"><Brush size={16} className="text-indigo-500" /> 局部编辑</div>
            <div className="mt-0.5 text-[11px] opacity-50">涂抹修改区域，或直接用箭头和文字在图上说明</div>
          </div>
          <button type="button" onClick={close} disabled={busy} className="opacity-60 hover:opacity-100 disabled:opacity-30">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="flex flex-col flex-1 min-w-0 p-3 gap-2">
            <div className="flex items-center gap-1.5 min-h-9 flex-wrap text-sm">
              {toolButton('pan', '移动图片', <Hand size={15} />)}
              {toolButton('mask', '涂抹修改区域', <Brush size={15} />)}
              {toolButton('erase', '擦除涂抹', <Eraser size={15} />)}
              {toolButton('arrow', '画箭头', <ArrowUpRight size={15} />)}
              {toolButton('text', '添加文字标注', <Type size={15} />)}
              <span className="h-5 w-px bg-black/10 dark:bg-white/10 mx-1" />
              {(tool === 'mask' || tool === 'erase') && (
                <>
                  <span className="text-xs opacity-55">笔刷</span>
                  <input type="range" min={8} max={140} value={brush} onChange={(event) => setBrush(Number(event.target.value))} className="w-28" />
                  <span className="text-[11px] tabular-nums opacity-50 w-8">{brush}px</span>
                </>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => setAnnotations((current) => current.slice(0, -1))} disabled={!annotations.length} className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-25" title="撤销最后一个箭头或文字">
                  <Undo2 size={15} />
                </button>
                <button type="button" onClick={clearAll} className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" title="清空遮罩与标注">
                  <RotateCcw size={15} />
                </button>
                <span className="h-5 w-px bg-black/10 dark:bg-white/10 mx-1" />
                <button type="button" onClick={() => zoomAround(zoom / 1.2)} className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" title="缩小"><Minus size={15} /></button>
                <span className="w-12 text-center text-[11px] tabular-nums opacity-60">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => zoomAround(zoom * 1.2)} className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" title="放大"><Plus size={15} /></button>
                <button type="button" onClick={resetView} className="h-8 w-8 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" title="适配窗口"><Maximize2 size={15} /></button>
              </div>
            </div>

            <div
              ref={viewportRef}
              className={`relative flex-1 min-h-0 overflow-hidden rounded-xl border bg-neutral-100 dark:bg-neutral-950 ${busy ? 'pointer-events-none opacity-70' : ''}`}
              style={{ borderColor: 'var(--ace-border)', cursor, touchAction: 'none' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => endPointerGesture(event)}
              onPointerCancel={(event) => endPointerGesture(event, true)}
              onWheel={handleWheel}
            >
              <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle, var(--ace-border) 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div
                  ref={sceneRef}
                  className="relative shadow-2xl"
                  style={{
                    width: fittedSize.w,
                    height: fittedSize.h,
                    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                    transformOrigin: 'center'
                  }}
                >
                  <img
                    src={card.assetUrl}
                    onLoad={(event) => {
                      const image = event.currentTarget
                      setImageSize({ w: image.naturalWidth, h: image.naturalHeight })
                      setPan({ x: 0, y: 0 })
                      setZoom(1)
                    }}
                    draggable={false}
                    className="absolute inset-0 block w-full h-full select-none"
                    alt="待编辑图片"
                  />
                  <canvas
                    ref={maskCanvasRef}
                    width={imageSize.w || 1}
                    height={imageSize.h || 1}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={{ opacity: 0.48 }}
                  />
                  <canvas
                    ref={annotationCanvasRef}
                    width={imageSize.w || 1}
                    height={imageSize.h || 1}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                </div>
              </div>

              {textDraft && (
                <input
                  data-interactive
                  autoFocus
                  value={textDraft.text}
                  onChange={(event) => setTextDraft({ ...textDraft, text: event.target.value.slice(0, 120) })}
                  onBlur={commitTextDraft}
                  onPointerDown={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      commitTextDraft()
                    } else if (event.key === 'Escape') {
                      event.stopPropagation()
                      setTextDraft(null)
                    }
                  }}
                  placeholder="输入修改说明，Enter 完成"
                  className="absolute z-20 w-60 rounded-md border-2 border-yellow-400 bg-yellow-300 px-2.5 py-1.5 text-sm font-medium text-neutral-900 shadow-xl outline-none placeholder:text-neutral-600/60"
                  style={{ left: textDraft.left, top: textDraft.top }}
                />
              )}

              <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/85 pointer-events-none">
                滚轮缩放 · 选择手型后拖动平移 · 标注 {annotations.length} 个
              </div>
            </div>
          </div>

          <aside className="w-[320px] shrink-0 border-l p-4 overflow-auto ace-noscroll flex flex-col gap-4" style={{ borderColor: 'var(--ace-border)' }}>
            <section>
              <div className="text-xs font-medium mb-2">编辑方式</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <button type="button" onClick={() => setOp('repaint')} className={`px-3 py-2 rounded-lg ${op === 'repaint' ? 'bg-indigo-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>局部重绘</button>
                <button type="button" onClick={() => setOp('remove')} className={`px-3 py-2 rounded-lg ${op === 'remove' ? 'bg-indigo-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>擦除移除</button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed opacity-55">
                {op === 'remove' ? '涂抹或标注要移除的物体，模型会补齐自然背景。' : '涂抹需要重绘的区域，或用箭头与文字直接指出修改位置。'}
              </p>
            </section>

            <section>
              <label className="text-xs font-medium block mb-2">修改要求</label>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={op === 'remove' ? '可选：补充背景填补要求' : '例如：把衣服改成红色，保持人物姿势不变'}
                className="ace-input w-full min-h-28 resize-y leading-relaxed"
              />
            </section>

            <section className="rounded-lg bg-indigo-500/[0.08] border border-indigo-500/15 p-3 text-[11px] leading-relaxed">
              <div className="font-medium text-indigo-600 dark:text-indigo-300 mb-1.5">图上标注</div>
              <p className="opacity-65">红色箭头用于指向位置，黄色文字用于写修改要求。标注会发送给模型作为说明，并明确要求模型不要把箭头和文字保留在结果中。</p>
            </section>

            <section className="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3 text-[11px] leading-relaxed opacity-65">
              <div>• 粉色区域：精确限制重绘范围</div>
              <div>• 仅用箭头 / 文字：允许模型按标注理解区域</div>
              <div>• 原图不会覆盖，结果会生成到右侧新卡片</div>
            </section>

            <div className="mt-auto pt-2">
              <button
                type="button"
                onClick={run}
                disabled={busy || !imageSize.w}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium disabled:opacity-60"
              >
                {busy ? <><Loader2 size={15} className="animate-spin" />处理中…</> : <><Brush size={15} />{op === 'remove' ? '擦除标注内容' : '生成局部修改'}</>}
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
