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
  getHistoryCaptureRegion,
  getHistoryScaleFactor,
  loadHistoryItem,
  updateHistoryItem
} from './history'
import { useMulby } from './hooks/useMulby'
import { RESIZE_EDGES, useFloatingWindow } from './hooks/useFloatingWindow'
import Toolbar from './components/Toolbar'
import { InlineStepEditor, InlineTextEditor } from './components/InlineEditors'
import {
  COLORS,
  HISTORY_LIMIT,
  STEP_LABEL_MAX_LENGTH,
  TEXT_BOX_DEFAULT_VISUAL_WIDTH
} from './annotations/constants'
import {
  clamp,
  getEditableAnnotationTypeForTool,
  isDragAnnotation,
  isStrokeAnnotation,
  normalizeRect,
  resizeAnnotation,
  snapPointTo45Degrees,
  snapPointToSquare,
  annotationHasRenderableArea
} from './annotations/geometry'
import { cursorForEditMode, hitTestAnnotation, hitTestEditHandle } from './annotations/hitTest'
import { getTextBounds, getTextBoxWidth } from './annotations/textLayout'
import { exportPng, renderCanvas } from './annotations/render'
import { normalizeAnnotations } from './annotations/normalize'
import type {
  Annotation,
  AppMode,
  CaptureRegion,
  DisplaySize,
  EditDragState,
  EditHandle,
  EditHandleMode,
  InlineStepEdit,
  InlineTextEdit,
  LoadedImage,
  PendingPreview,
  PluginAttachment,
  PluginInitData,
  Point,
  Rect,
  StepAnnotation,
  TextAnnotation,
  Tool
} from './annotations/types'
import {
  arrayBufferToDataUrl,
  createId,
  dataUrlToArrayBuffer,
  dataUrlToBase64,
  defaultPngFileName,
  ensurePngPath,
  loadImage
} from './utils/image'
import { getInitialMode, parseLaunchMode } from './utils/launch'
import {
  buildConstrainedBounds,
  fitDisplaySize,
  getDisplaySize,
  getPreviewDisplaySize
} from './utils/display'

const PLUGIN_ID = 'screenshot-annotator'

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
  const imageLoadTokenRef = useRef(0)
  // 滑块连续拖动时标记当前撤销会话（值为标注 id），用于把一次拖动合并成一条撤销记录。
  const sizeEditSessionRef = useRef<string | null>(null)
  const annotationsPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
      const element = await loadImage(dataUrl, '截图图片加载失败')
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

  // 轻量持久化：只把已提交的标注写回历史索引，不重渲染 PNG（供防抖即存使用）。
  const persistCurrentAnnotations = useCallback(async () => {
    const historyItemId = activeHistoryItemIdRef.current
    const currentImage = imageRef.current

    if (!historyItemId || !currentImage) {
      return
    }

    await updateHistoryItem(mulby, historyItemId, {
      annotations: annotationsRef.current,
      width: currentImage.width,
      height: currentImage.height,
      displaySize: getDisplaySize(currentImage),
      capture: currentImage.capture,
      imageMeta: {
        mime: 'image/png',
        scaleFactor: currentImage.scaleFactor
      }
    })
  }, [mulby])

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
        const element = await loadImage(editableDataUrl, '截图图片加载失败')
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

  const closeAnnotatorWindow = useCallback(async (options?: { skipPersist?: boolean }) => {
    if (annotationsPersistTimerRef.current) {
      clearTimeout(annotationsPersistTimerRef.current)
      annotationsPersistTimerRef.current = null
    }
    if (!options?.skipPersist) {
      await persistCurrentHistoryQuietly()
    }
    mulby.window.close()
  }, [mulby.window, persistCurrentHistoryQuietly])

  useEffect(() => {
    annotationsRef.current = annotations
  }, [annotations])

  useEffect(() => {
    imageRef.current = image
  }, [image])

  // 接收来自「问 AI」子窗口的「替换截图」消息：把 AI 修图结果作为新底图载入画布。
  useEffect(() => {
    if (mode !== 'annotate') {
      return
    }
    const win = window.mulby?.window
    if (!win?.onChildMessage) {
      return
    }
    const off = win.onChildMessage((channel: string, ...args: unknown[]) => {
      if (channel !== 'apply-edited-image') {
        return
      }
      const dataUrl = args[0]
      const base = imageRef.current
      if (typeof dataUrl === 'string' && dataUrl && base) {
        void loadTransformedImage(dataUrl, base, '已替换为 AI 修图结果')
      }
    }) as unknown as (() => void) | { dispose?: () => void } | undefined
    return () => {
      try {
        if (typeof off === 'function') off()
        else off?.dispose?.()
      } catch {
        /* ignore */
      }
    }
  }, [mode, loadTransformedImage])

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

  // 标注变化后做一次轻量持久化（防抖）。窗口被异常关闭（宿主终止/崩溃）时，
  // beforeunload 里的异步持久化来不及完成，这里用「提交后即存」代替它兜底。
  useEffect(() => {
    if (mode !== 'annotate' || !activeHistoryItemIdRef.current) {
      return
    }

    if (annotationsPersistTimerRef.current) {
      clearTimeout(annotationsPersistTimerRef.current)
    }
    annotationsPersistTimerRef.current = setTimeout(() => {
      annotationsPersistTimerRef.current = null
      void persistCurrentAnnotations().catch((error) => {
        console.warn('[screenshot-annotator] 保存标注历史失败:', error)
      })
    }, 800)

    return () => {
      if (annotationsPersistTimerRef.current) {
        clearTimeout(annotationsPersistTimerRef.current)
        annotationsPersistTimerRef.current = null
      }
    }
  }, [annotations, mode, persistCurrentAnnotations])

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

          const element = await loadImage(dataUrl, '截图图片加载失败')
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

  // 工具栏拖动 + 窗口边缘缩放与「问 AI」浮窗共用同一套实现。
  const floating = useFloatingWindow(mulby.window as unknown as Parameters<typeof useFloatingWindow>[0], {
    disabled: Boolean(busy),
    dragExcludeSelector: [
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
  })

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

  const handleInlineTextChange = useCallback((text: string) => {
    setInlineTextEdit((current) => (
      current ? { ...current, text } : null
    ))
    if (inlineTextEditRef.current) {
      inlineTextEditRef.current = { ...inlineTextEditRef.current, text }
    }
  }, [])

  const handleInlineStepChange = useCallback((value: string) => {
    setInlineStepEdit((current) => (
      current ? { ...current, value } : null
    ))
    if (inlineStepEditRef.current) {
      inlineStepEditRef.current = { ...inlineStepEditRef.current, value }
    }
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
      // 复制即完成本次标注使命：已持久化过，直接关窗。
      await closeAnnotatorWindow({ skipPersist: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '复制失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }, [
    closeAnnotatorWindow,
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
        defaultPath: defaultPngFileName('screenshot'),
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
      // 保存完毕即完成本次标注使命：已持久化过，直接关窗。
      await closeAnnotatorWindow({ skipPersist: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败'
      setStatus(message)
      mulby.notification.show(message, 'error')
    }
  }, [
    closeAnnotatorWindow,
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
        transparent: true,
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

  const handleClearCropSelection = useCallback(() => {
    setCropRect(null)
    setDraftCropRect(null)
    setStatus('已清除裁剪选区')
  }, [])

  const handleSelectTool = useCallback(
    (nextTool: Tool) => {
      if (inlineTextEdit && nextTool !== 'text') {
        commitInlineText()
      }
      if (inlineStepEdit && nextTool !== 'step') {
        commitInlineStep()
      }
      setTool(nextTool)
      setCanvasCursor(null)
      if (nextTool !== 'select') {
        setSelectedAnnotationId(null)
      }
    },
    [commitInlineStep, commitInlineText, inlineStepEdit, inlineTextEdit]
  )

  const updateSelectedAnnotation = useCallback(
    (patch: Partial<Pick<Annotation, 'color' | 'size'>>, options?: { coalesceSession?: boolean }) => {
      if (!selectedAnnotationId) {
        return
      }

      const nextAnnotations = annotationsRef.current.map((annotation) => {
        return annotation.id === selectedAnnotationId ? ({ ...annotation, ...patch } as Annotation) : annotation
      })

      if (options?.coalesceSession && sizeEditSessionRef.current === selectedAnnotationId) {
        // 同一次滑块拖动的后续 tick 不再产生新的撤销记录。
        replaceAnnotations(nextAnnotations)
      } else {
        sizeEditSessionRef.current = options?.coalesceSession ? selectedAnnotationId : null
        replaceAnnotations(nextAnnotations, { recordHistory: true })
      }
      setStatus('已更新标注')
    },
    [replaceAnnotations, selectedAnnotationId]
  )

  // 滑块一次拖动结束（pointerup/keyup）后收尾会话，下次拖动重新记一条撤销。
  const clearSizeEditSession = useCallback(() => {
    sizeEditSessionRef.current = null
  }, [])

  const handleColorChange = useCallback(
    (nextColor: string) => {
      setColor(nextColor)
      if (selectedAnnotation) {
        updateSelectedAnnotation({ color: nextColor })
      }
    },
    [selectedAnnotation, updateSelectedAnnotation]
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
            updateSelectedAnnotation({ size: toImageSize(nextValue) }, { coalesceSession: true })
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
            updateSelectedAnnotation({ size: toImageSize(nextValue) }, { coalesceSession: true })
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
            updateSelectedAnnotation({ size: toImageSize(nextValue) }, { coalesceSession: true })
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
            updateSelectedAnnotation({ size: toImageSize(nextValue) }, { coalesceSession: true })
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
          updateSelectedAnnotation({ size: toImageSize(nextValue) }, { coalesceSession: true })
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

  const activeRangeWithCommit = useMemo(
    () => ({ ...activeRange, onCommit: clearSizeEditSession }),
    [activeRange, clearSizeEditSession]
  )

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
              <InlineTextEditor
                edit={inlineTextEdit}
                position={inlineTextPosition}
                onTextChange={handleInlineTextChange}
                onCommit={commitInlineText}
                onCancel={cancelInlineText}
              />
            )}
            {inlineStepEdit && inlineStepPosition && (
              <InlineStepEditor
                edit={inlineStepEdit}
                position={inlineStepPosition}
                onValueChange={handleInlineStepChange}
                onCommit={commitInlineStep}
                onCancel={cancelInlineStep}
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
        <Toolbar
          tool={tool}
          onSelectTool={handleSelectTool}
          effectiveColor={effectiveColor}
          onColorChange={handleColorChange}
          range={activeRangeWithCommit}
          statusText={busy ?? status}
          onOpenHistory={() => void handleOpenHistory()}
          canUndo={undoStack.length > 0}
          canRedo={redoStack.length > 0}
          onUndo={handleUndo}
          onRedo={handleRedo}
          clearDisabled={!annotations.length && !inlineTextEdit && !inlineStepEdit}
          onClear={handleClear}
          canEditImage={canEditImage}
          applyCropDisabled={!canEditImage || !cropRect}
          cropClearDisabled={!cropRect && !draftCropRect}
          onApplyCrop={() => void applyCropSelection()}
          onClearCrop={handleClearCropSelection}
          onRotateLeft={() => void rotateLeft()}
          onRotateRight={() => void rotateRight()}
          onFlipHorizontal={() => void flipHorizontal()}
          onFlipVertical={() => void flipVertical()}
          onGreyscale={() => void applyGreyscale()}
          onEnhance={() => void applyEnhance()}
          aiDisabled={!image}
          exportDisabled={!image || Boolean(busy)}
          onOpenAi={() => void handleOpenAi()}
          onCopy={() => void handleCopy()}
          onSave={() => void handleSave()}
          onClose={() => void closeAnnotatorWindow()}
          dragHandlers={floating.dragHandlers}
        />
      )}

      <div className="resize-layer" aria-hidden="true">
        {RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`resize-handle resize-${edge}`}
            {...floating.getResizeHandlers(edge)}
          />
        ))}
      </div>
    </div>
  )
}
