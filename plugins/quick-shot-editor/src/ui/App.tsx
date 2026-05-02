import {
  Camera,
  Circle,
  ClipboardPaste,
  Copy,
  Crop,
  Droplets,
  Eraser,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Grid3x3,
  Hand,
  Hash,
  Highlighter,
  ImagePlus,
  LoaderCircle,
  Minus,
  Monitor,
  MoveRight,
  PenTool,
  Plus,
  Redo2,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Type as TypeIcon,
  Undo2
} from 'lucide-react'
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  annotationHasRenderableArea,
  createLayout,
  getImageScale,
  hitTestAnnotation,
  imagePointToScreenPoint,
  moveAnnotation,
  type Annotation,
  type EditorImage,
  type EditorTool,
  exportAnnotatedDataUrl,
  normalizeRect,
  type Point,
  pointFromPointerEvent,
  previewSizeToImageSize,
  renderPreviewCanvas,
  type Rect,
  type ViewportTransform
} from './editor'
import {
  arrayBufferToDataUrl,
  createId,
  dataUrlToArrayBuffer,
  dataUrlToBase64,
  ensurePngPath,
  formatPixels,
  joinSystemPath,
  loadImageElement,
  makeDefaultShotName,
  readImageFileAsDataUrl,
  sleep
} from './image-utils'
import { useMulby } from './hooks/useMulby'

interface PluginAttachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
  attachments?: PluginAttachment[]
}

const PLUGIN_ID = 'quick-shot-editor'
const COLOR_SWATCHES = ['#ff6b6b', '#ff9f43', '#ffd166', '#37d67a', '#39c0ed', '#4f7cff', '#9b6bff']
const HISTORY_LIMIT = 24

const TOOL_OPTIONS: Array<{
  key: EditorTool
  label: string
  icon: typeof PenTool
}> = [
  { key: 'pen', label: '划线', icon: PenTool },
  { key: 'highlighter', label: '高亮', icon: Highlighter },
  { key: 'line', label: '直线', icon: Minus },
  { key: 'arrow', label: '箭头', icon: MoveRight },
  { key: 'rect', label: '框选', icon: Square },
  { key: 'ellipse', label: '圆形', icon: Circle },
  { key: 'text', label: '文本', icon: TypeIcon },
  { key: 'step', label: '编号', icon: Hash },
  { key: 'mosaic', label: '打码', icon: Grid3x3 },
  { key: 'blur', label: '模糊', icon: Droplets },
  { key: 'crop', label: '裁剪选区', icon: Crop },
  { key: 'pan', label: '手型/移动', icon: Hand },
  { key: 'eraser', label: '橡皮擦', icon: Eraser }
]

const STROKE_TOOLS: EditorTool[] = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'ellipse']

export default function App() {
  const {
    clipboard,
    dialog,
    filesystem,
    notification,
    screen,
    sharp,
    shell,
    system,
    window: mulbyWindow
  } = useMulby(PLUGIN_ID)

  const [baseImage, setBaseImage] = useState<EditorImage | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [draftAnnotation, setDraftAnnotation] = useState<Annotation | null>(null)
  const [selectionRect, setSelectionRect] = useState<Rect | null>(null)
  const [draftSelection, setDraftSelection] = useState<Rect | null>(null)
  const [undoStack, setUndoStack] = useState<Annotation[][]>([])
  const [redoStack, setRedoStack] = useState<Annotation[][]>([])
  const [activeTool, setActiveTool] = useState<EditorTool>('arrow')
  const [strokeColor, setStrokeColor] = useState(COLOR_SWATCHES[0])
  const [strokeSize, setStrokeSize] = useState(6)
  const [mosaicSize, setMosaicSize] = useState(18)
  const [blurSize, setBlurSize] = useState(14)
  const [textSize, setTextSize] = useState(28)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [screenSources, setScreenSources] = useState<CaptureSource[]>([])
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [statusLine, setStatusLine] = useState('准备截图。')
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 内联文本编辑状态
  const [inlineTextEdit, setInlineTextEdit] = useState<{
    id: string
    point: Point
    text: string
    size: number
    color: string
  } | null>(null)
  // 拖动已有标注（任意类型）
  const [draggingAnnotationId, setDraggingAnnotationId] = useState<string | null>(null)
  const dragStartRef = useRef<Point>({ x: 0, y: 0 })
  // 选中标注
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  // Shift 按键状态
  const shiftKeyRef = useRef(false)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageElementRef = useRef<HTMLImageElement | null>(null)
  const annotationsRef = useRef<Annotation[]>([])
  const lastInitKeyRef = useRef<string>('')
  const isPanningRef = useRef(false)
  const lastPanClientRef = useRef({ x: 0, y: 0 })
  const spaceKeyRef = useRef(false)
  const inlineTextRef = useRef<HTMLTextAreaElement | null>(null)

  // rAF 节流：避免 pointerMove 高频触发 React 渲染
  const panDeltaRef = useRef({ x: 0, y: 0 })
  const panRafRef = useRef(0)
  const penPointsRef = useRef<Point[]>([])
  const penRafRef = useRef(0)
  const dragDeltaRef = useRef({ x: 0, y: 0 })
  const dragRafRef = useRef(0)
  const draftEndRef = useRef<Point>({ x: 0, y: 0 })
  const draftEndRafRef = useRef(0)
  const mosaicRafRef = useRef(0)
  const mosaicEndRef = useRef<Point>({ x: 0, y: 0 })
  // 供 wheel handler 稳定引用，避免每帧重新注册事件
  const zoomRef = useRef(zoom)
  const panXRef = useRef(panX)
  const panYRef = useRef(panY)
  zoomRef.current = zoom
  panXRef.current = panX
  panYRef.current = panY

  annotationsRef.current = annotations

  // 用 ref 追踪最新 draft/dragging，避免 finishDraft 闭包过期
  const draftAnnotationRef = useRef(draftAnnotation)
  const draggingAnnotationIdRef = useRef(draggingAnnotationId)
  draftAnnotationRef.current = draftAnnotation
  draggingAnnotationIdRef.current = draggingAnnotationId

  const activeToolMeta = useMemo(
    () => TOOL_OPTIONS.find((option) => option.key === activeTool) ?? TOOL_OPTIONS[0],
    [activeTool]
  )

  const quickStats = useMemo(() => {
    if (!baseImage) {
      return null
    }

    return {
      resolution: formatPixels(baseImage.width, baseImage.height)
    }
  }, [baseImage])

  const selectionSummary = useMemo(() => {
    if (!selectionRect) {
      return null
    }

    return formatPixels(Math.round(selectionRect.width), Math.round(selectionRect.height))
  }, [selectionRect])

  const replaceAnnotations = useCallback(
    (next: Annotation[], options?: { recordHistory?: boolean; keepRedo?: boolean }) => {
      if (options?.recordHistory) {
        // 先快照当前 annotations，避免 updater 延迟执行时 ref 已被下方赋值覆盖
        const snapshot = annotationsRef.current
        setUndoStack((current) => [...current.slice(-(HISTORY_LIMIT - 1)), snapshot])
      }

      if (!options?.keepRedo) {
        setRedoStack([])
      }

      annotationsRef.current = next
      setAnnotations(next)
    },
    []
  )

  const hydrateStudioImage = useCallback(
    async (
      dataUrl: string,
      metadata: Omit<EditorImage, 'dataUrl' | 'width' | 'height' | 'capturedAt'> & {
        capturedAt?: number
        status?: string
      }
    ) => {
      const imageElement = await loadImageElement(dataUrl)
      imageElementRef.current = imageElement

      startTransition(() => {
        setBaseImage({
          dataUrl,
          width: imageElement.naturalWidth,
          height: imageElement.naturalHeight,
          label: metadata.label,
          sourceType: metadata.sourceType,
          capturedAt: metadata.capturedAt ?? Date.now(),
          originPath: metadata.originPath
        })
        replaceAnnotations([], { keepRedo: false })
        setDraftAnnotation(null)
        setSelectionRect(null)
        setDraftSelection(null)
        setUndoStack([])
        setRedoStack([])
        setLastSavedPath(null)
        setStatusLine(metadata.status ?? '图片已载入。')
      })
    },
    [replaceAnnotations]
  )

  const refreshScreenSources = useCallback(async () => {
    try {
      const sources = await screen.getSources({
        types: ['screen'],
        thumbnailSize: { width: 420, height: 240 }
      })
      setScreenSources((sources ?? []) as CaptureSource[])
    } catch (error) {
      console.warn('[quick-shot-editor] failed to refresh screen sources', error)
    }
  }, [screen])

  const withCaptureWindowHidden = useCallback(
    async <T,>(task: () => Promise<T>) => {
      try {
        mulbyWindow.hide?.(true)
      } catch (error) {
        console.warn('[quick-shot-editor] unable to hide window before capture', error)
      }

      await sleep(140)

      try {
        return await task()
      } finally {
        await sleep(90)
        mulbyWindow.show?.()
      }
    },
    [mulbyWindow]
  )

  const captureRegionShot = useCallback(
    async (silent = false) => {
      setBusyLabel('等待框选区域')
      setErrorMessage(null)

      try {
        const dataUrl = await withCaptureWindowHidden(() => screen.screenCapture())
        if (!dataUrl) {
          setStatusLine('已取消区域截图。')
          return
        }

        await hydrateStudioImage(dataUrl, {
          label: '区域截图',
          sourceType: 'region',
          status: '区域截图已载入。'
        })

        if (!silent) {
          notification.show('区域截图已进入编辑器', 'success')
        }
      } catch (error) {
        console.error('[quick-shot-editor] region capture failed', error)
        setErrorMessage('区域截图失败，请确认系统已授予截图权限。')
        notification.show('区域截图失败', 'error')
      } finally {
        setBusyLabel(null)
        void refreshScreenSources()
      }
    },
    [hydrateStudioImage, notification, refreshScreenSources, screen, withCaptureWindowHidden]
  )

  const captureFullScreen = useCallback(
    async (sourceId?: string, sourceLabel?: string, silent = false) => {
      setBusyLabel('正在抓取全屏')
      setErrorMessage(null)

      try {
        const buffer = await withCaptureWindowHidden(() =>
          screen.capture({
            sourceId,
            format: 'png'
          })
        )

        if (!buffer) {
          throw new Error('未获取到截图数据')
        }

        const dataUrl = arrayBufferToDataUrl(buffer, 'image/png')
        await hydrateStudioImage(dataUrl, {
          label: sourceLabel ?? '全屏截图',
          sourceType: 'fullscreen',
          status: '全屏截图已载入。'
        })

        if (!silent) {
          notification.show('全屏截图已进入编辑器', 'success')
        }
      } catch (error) {
        console.error('[quick-shot-editor] fullscreen capture failed', error)
        setErrorMessage('全屏截图失败，请尝试重新选择目标屏幕。')
        notification.show('全屏截图失败', 'error')
      } finally {
        setBusyLabel(null)
        void refreshScreenSources()
      }
    },
    [hydrateStudioImage, notification, refreshScreenSources, screen, withCaptureWindowHidden]
  )

  const capturePrimaryDisplay = useCallback(
    async (silent = false) => {
      const primaryDisplay = await screen.getPrimaryDisplay()
      const sources = await screen.getSources({
        types: ['screen'],
        thumbnailSize: { width: 420, height: 240 }
      })
      const match = (sources ?? []).find(
        (source) => source.displayId && String(primaryDisplay.id) === String(source.displayId)
      )

      await captureFullScreen(match?.id, match?.name ?? primaryDisplay.label ?? '主屏', silent)
    },
    [captureFullScreen, screen]
  )

  const openImageFile = useCallback(async () => {
    setErrorMessage(null)

    try {
      const paths = await dialog.showOpenDialog({
        title: '选择要编辑的图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
        properties: ['openFile']
      })

      const selectedPath = paths?.[0]
      if (!selectedPath) {
        return
      }

      setBusyLabel('正在载入图片')
      const dataUrl = await readImageFileAsDataUrl(selectedPath, filesystem)
      await hydrateStudioImage(dataUrl, {
        label: '本地图片',
        sourceType: 'file',
        originPath: selectedPath,
        status: '本地图片已载入。'
      })
      notification.show('图片已进入编辑器', 'success')
    } catch (error) {
      console.error('[quick-shot-editor] failed to open file', error)
      setErrorMessage('读取图片失败，请确认文件格式可用。')
      notification.show('打开图片失败', 'error')
    } finally {
      setBusyLabel(null)
    }
  }, [dialog, filesystem, hydrateStudioImage, notification])

  const openClipboardImage = useCallback(async () => {
    setErrorMessage(null)

    try {
      setBusyLabel('读取剪贴板图片')
      const imageBuffer = await clipboard.readImage()

      if (!imageBuffer) {
        notification.show('剪贴板里暂时没有图片', 'warning')
        return
      }

      const dataUrl = arrayBufferToDataUrl(imageBuffer, 'image/png')
      await hydrateStudioImage(dataUrl, {
        label: '剪贴板图片',
        sourceType: 'clipboard',
        status: '剪贴板图片已载入。'
      })
      notification.show('剪贴板图片已载入', 'success')
    } catch (error) {
      console.error('[quick-shot-editor] failed to read clipboard image', error)
      setErrorMessage('读取剪贴板图片失败。')
      notification.show('读取剪贴板失败', 'error')
    } finally {
      setBusyLabel(null)
    }
  }, [clipboard, hydrateStudioImage, notification])

  const loadAttachmentImage = useCallback(
    async (attachment: PluginAttachment) => {
      setErrorMessage(null)
      setBusyLabel('读取传入图片')

      try {
        let dataUrl = attachment.dataUrl
        if (!dataUrl && attachment.path) {
          dataUrl = await readImageFileAsDataUrl(attachment.path, filesystem)
        }

        if (!dataUrl) {
          throw new Error('附件中没有可用的图片数据')
        }

        await hydrateStudioImage(dataUrl, {
          label: attachment.name || '传入图片',
          sourceType: 'attachment',
          originPath: attachment.path,
          status: '传入图片已载入。'
        })
      } finally {
        setBusyLabel(null)
      }
    },
    [filesystem, hydrateStudioImage]
  )

  const composeCurrentDataUrl = useCallback(() => {
    if (!baseImage || !imageElementRef.current) {
      return null
    }

    return exportAnnotatedDataUrl({
      imageElement: imageElementRef.current,
      image: baseImage,
      annotations: annotationsRef.current
    })
  }, [baseImage])

  const commitFlattenedImage = useCallback(
    async (dataUrl: string, status: string) => {
      if (!baseImage) {
        return
      }

      await hydrateStudioImage(dataUrl, {
        label: baseImage.label,
        sourceType: baseImage.sourceType,
        originPath: baseImage.originPath,
        status
      })
      setSelectionRect(null)
      setDraftSelection(null)
    },
    [baseImage, hydrateStudioImage]
  )

  const runSharpTransform = useCallback(
    async (
      busyText: string,
      successText: string,
      transform: (pipeline: MulbySharpProxy) => Promise<ArrayBuffer>
    ) => {
      if (!baseImage) {
        return
      }

      if (!sharp) {
        notification.show('当前环境没有可用的 sharp API', 'warning')
        return
      }

      const currentDataUrl = composeCurrentDataUrl()
      if (!currentDataUrl) {
        notification.show('当前画面还不能导出', 'warning')
        return
      }

      setBusyLabel(busyText)
      setErrorMessage(null)

      try {
        const output = await transform(sharp(dataUrlToArrayBuffer(currentDataUrl)))
        const nextDataUrl = arrayBufferToDataUrl(output, 'image/png')
        await commitFlattenedImage(nextDataUrl, successText)
        setStatusLine(successText)
        notification.show(successText, 'success')
      } catch (error) {
        console.error('[quick-shot-editor] sharp transform failed', error)
        const detail = error instanceof Error ? error.message : String(error)
        setErrorMessage(`${busyText}失败：${detail}`)
        notification.show(`${busyText}失败`, 'error')
      } finally {
        setBusyLabel(null)
      }
    },
    [baseImage, commitFlattenedImage, composeCurrentDataUrl, notification, sharp]
  )

  const handleCopyImage = useCallback(async () => {
    if (!baseImage || !imageElementRef.current) {
      notification.show('导出图片失败', 'error')
      return
    }

    try {
      const dataUrl = exportAnnotatedDataUrl({
        imageElement: imageElementRef.current,
        image: baseImage,
        annotations: annotationsRef.current
      })
      if (!dataUrl) {
        throw new Error('无法生成图片数据')
      }
      await clipboard.writeImage(dataUrl)
      setStatusLine('已复制到剪贴板。')
      notification.show('已复制到剪贴板', 'success')
    } catch (error) {
      console.error('[quick-shot-editor] copy to clipboard failed', error)
      notification.show('复制到剪贴板失败', 'error')
    }
  }, [baseImage, clipboard, notification])

  const handleSaveImage = useCallback(async () => {
    if (!baseImage || !imageElementRef.current) {
      return
    }

    try {
      const dataUrl = exportAnnotatedDataUrl({
        imageElement: imageElementRef.current,
        image: baseImage,
        annotations: annotationsRef.current
      })
      if (!dataUrl) {
        throw new Error('无法生成图片数据')
      }

      const picturesDir = await system.getPath('pictures')
      const defaultPath = joinSystemPath(
        picturesDir,
        makeDefaultShotName(baseImage.sourceType === 'region' ? 'region-shot' : 'screen-shot')
      )

      const pickedPath = await dialog.showSaveDialog({
        title: '保存截图到本地',
        defaultPath,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      })

      if (!pickedPath) return

      const finalPath = ensurePngPath(pickedPath)
      await filesystem.writeFile(finalPath, dataUrlToBase64(dataUrl), 'base64')
      setLastSavedPath(finalPath)
      setStatusLine('已保存到本地。')
      notification.show('截图已保存到本地', 'success')
    } catch (error) {
      console.error('[quick-shot-editor] failed to save image', error)
      notification.show('保存失败', 'error')
    }
  }, [baseImage, dialog, filesystem, notification, system])

  const handleUndo = useCallback(() => {
    const current = annotationsRef.current
    setUndoStack((history) => {
      const previous = history[history.length - 1]
      if (!previous) {
        return history
      }

      // 用快照值存入 redo 栈，避免 ref 被覆盖后再读取
      setRedoStack((future) => [current, ...future].slice(0, HISTORY_LIMIT))
      annotationsRef.current = previous
      setAnnotations(previous)
      setStatusLine('已撤销。')
      return history.slice(0, -1)
    })
  }, [])

  const handleRedo = useCallback(() => {
    const current = annotationsRef.current
    setRedoStack((history) => {
      const next = history[0]
      if (!next) {
        return history
      }

      // 用快照值存入 undo 栈，避免 ref 被覆盖后再读取
      setUndoStack((past) => [...past.slice(-(HISTORY_LIMIT - 1)), current])
      annotationsRef.current = next
      setAnnotations(next)
      setStatusLine('已重做。')
      return history.slice(1)
    })
  }, [])

  const clearAnnotations = useCallback(() => {
    if (!annotationsRef.current.length) {
      return
    }

    replaceAnnotations([], { recordHistory: true })
    setStatusLine('标注已清空。')
  }, [replaceAnnotations])

  const clearSelection = useCallback(() => {
    setSelectionRect(null)
    setDraftSelection(null)
    setStatusLine('选区已清除。')
  }, [])

  const appendAnnotation = useCallback(
    (annotation: Annotation, message: string) => {
      replaceAnnotations([...annotationsRef.current, annotation], {
        recordHistory: true
      })
      setStatusLine(message)
    },
    [replaceAnnotations]
  )

  const applyCropSelection = useCallback(async () => {
    if (!selectionRect) {
      notification.show('请先拉出一个裁剪选区', 'warning')
      return
    }

    const safeSelection = {
      left: Math.max(0, Math.floor(selectionRect.x)),
      top: Math.max(0, Math.floor(selectionRect.y)),
      width: Math.max(1, Math.floor(selectionRect.width)),
      height: Math.max(1, Math.floor(selectionRect.height))
    }

    await runSharpTransform('正在裁剪', '已裁剪到选区', async (pipeline) =>
      pipeline.extract(safeSelection).png().toBuffer()
    )
  }, [notification, runSharpTransform, selectionRect])

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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialTheme = (params.get('theme') as 'light' | 'dark') || 'light'
    document.documentElement.classList.toggle('dark', initialTheme === 'dark')

    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      const initKey = JSON.stringify({
        featureCode: data.featureCode,
        input: data.input,
        attachments: data.attachments?.map(
          (attachment) => attachment.id || attachment.path || attachment.name
        ),
        nonce: (data as any).nonce
      })

      if (initKey === lastInitKeyRef.current) {
        return
      }

      lastInitKeyRef.current = initKey
      setErrorMessage(null)

      const firstImageAttachment = data.attachments?.find((attachment) => attachment.kind === 'image')

      if (firstImageAttachment && data.featureCode === 'edit-image') {
        void loadAttachmentImage(firstImageAttachment)
        return
      }

      if (data.featureCode === 'quick-region-shot') {
        // preCapture 已前置到主进程，优先从 attachment 读取
        const preCaptured = data.attachments?.find((a: PluginAttachment) => a.kind === 'image')
        if (preCaptured) {
          void loadAttachmentImage(preCaptured)
        } else {
          // 兜底：如果没有预截图数据（host 版本较旧），走旧流程
          void captureRegionShot(true)
        }
        return
      }

      if (data.featureCode === 'quick-full-shot') {
        const preCaptured = data.attachments?.find((a: PluginAttachment) => a.kind === 'image')
        if (preCaptured) {
          void loadAttachmentImage(preCaptured)
        } else {
          void capturePrimaryDisplay(true)
        }
        return
      }

      if (firstImageAttachment) {
        void loadAttachmentImage(firstImageAttachment)
        return
      }

      setStatusLine('准备截图。')
    })

    void refreshScreenSources()
  }, [
    capturePrimaryDisplay,
    captureRegionShot,
    loadAttachmentImage,
    refreshScreenSources
  ])

  useEffect(() => {
    if (!stageRef.current) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const target = entries[0]
      if (!target) {
        return
      }

      setViewport({
        width: Math.max(0, Math.floor(target.contentRect.width)),
        height: Math.max(0, Math.floor(target.contentRect.height))
      })
    })

    observer.observe(stageRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (baseImage) {
      setZoom(1)
      setPanX(0)
      setPanY(0)
    }
  }, [baseImage])

  // 卸载时清理所有 rAF 句柄
  useEffect(() => {
    return () => {
      cancelAnimationFrame(panRafRef.current)
      cancelAnimationFrame(penRafRef.current)
      cancelAnimationFrame(dragRafRef.current)
      cancelAnimationFrame(draftEndRafRef.current)
      cancelAnimationFrame(mosaicRafRef.current)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceKeyRef.current = true
      }
      if (e.key === 'Shift') {
        shiftKeyRef.current = true
      }
      // Delete/Backspace 删除选中标注
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnotationId) {
        // 避免在其他输入框中触发
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return
        }
        e.preventDefault()
        const filtered = annotationsRef.current.filter((a) => a.id !== selectedAnnotationId)
        replaceAnnotations(filtered, { recordHistory: true })
        setSelectedAnnotationId(null)
        setStatusLine('已删除标注。')
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceKeyRef.current = false
        if (isPanningRef.current) {
          isPanningRef.current = false
        }
      }
      if (e.key === 'Shift') {
        shiftKeyRef.current = false
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [selectedAnnotationId, replaceAnnotations])

  const viewportTransform: ViewportTransform | null = useMemo(
    () => (zoom !== 1 || panX !== 0 || panY !== 0 ? { zoom, panX, panY } : null),
    [zoom, panX, panY]
  )

  useEffect(() => {
    if (
      !canvasRef.current ||
      !baseImage ||
      !imageElementRef.current ||
      !viewport.width ||
      !viewport.height
    ) {
      return
    }

    renderPreviewCanvas({
      canvas: canvasRef.current,
      imageElement: imageElementRef.current,
      image: baseImage,
      annotations,
      draftAnnotation,
      viewport,
      selectionRect: draftSelection ?? selectionRect,
      transform: viewportTransform,
      selectedAnnotationId
    })
  }, [annotations, baseImage, draftAnnotation, draftSelection, selectionRect, selectedAnnotationId, viewport, viewportTransform])

  const pointerCursor = useMemo(() => {
    if (activeTool === 'pan') {
      return isPanningRef.current ? 'grabbing' : 'grab'
    }
    if (activeTool === 'eraser') {
      return 'crosshair'
    }
    if (zoom > 1 && spaceKeyRef.current) {
      return 'grab'
    }
    if (activeTool === 'mosaic' || activeTool === 'blur') {
      return 'cell'
    }

    if (activeTool === 'text' || activeTool === 'step') {
      return 'copy'
    }

    return 'crosshair'
  }, [activeTool, zoom])

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      if (!baseImage || !canvasRef.current || !viewport.width || !viewport.height) {
        return
      }
      event.preventDefault()
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      const currentZoom = zoomRef.current
      const newZoom = Math.min(4, Math.max(0.25, currentZoom * (1 - delta * 0.002)))
      if (newZoom === currentZoom) return
      const rect = canvasRef.current.getBoundingClientRect()
      const layout = createLayout(baseImage, viewport, { zoom: currentZoom, panX: panXRef.current, panY: panYRef.current })
      const cx = event.clientX - rect.left
      const cy = event.clientY - rect.top
      const ix = (cx - layout.offsetX) / layout.scale
      const iy = (cy - layout.offsetY) / layout.scale
      const fitScale = layout.scale / currentZoom
      const newScale = fitScale * newZoom
      const newOffsetX = cx - ix * newScale
      const newOffsetY = cy - iy * newScale
      const centerX = (viewport.width - baseImage.width * newScale) / 2
      const centerY = (viewport.height - baseImage.height * newScale) / 2
      setZoom(newZoom)
      setPanX(newOffsetX - centerX)
      setPanY(newOffsetY - centerY)
    },
    [baseImage, viewport]
  )

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!baseImage || !canvasRef.current) {
        return
      }

      // 右键 / 中键 / 空格+左键 始终平移画布
      const forceCanvasPan =
        event.button === 2 ||
        (zoom > 1 &&
          (event.button === 1 || (event.button === 0 && spaceKeyRef.current)))
      if (forceCanvasPan) {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        isPanningRef.current = true
        lastPanClientRef.current = { x: event.clientX, y: event.clientY }
        return
      }

      // 手型(pan)工具左键：先检测是否命中标注 → 选中/拖动标注 / 平移画布
      if (activeTool === 'pan' && event.button === 0) {
        const panStart = pointFromPointerEvent(
          event, canvasRef.current, baseImage, viewport, false, viewportTransform
        )
        if (panStart) {
          const hitId = hitTestAnnotation(panStart, annotationsRef.current)
          if (hitId) {
            event.currentTarget.setPointerCapture(event.pointerId)
            setSelectedAnnotationId(hitId)
            setDraggingAnnotationId(hitId)
            dragStartRef.current = panStart
            replaceAnnotations([...annotationsRef.current], { recordHistory: true, keepRedo: false })
            return
          }
        }
        // 未命中标注，取消选中并平移
        setSelectedAnnotationId(null)
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        isPanningRef.current = true
        lastPanClientRef.current = { x: event.clientX, y: event.clientY }
        return
      }

      // 橡皮擦工具：点击删除命中的标注
      if (activeTool === 'eraser' && event.button === 0) {
        const eraserStart = pointFromPointerEvent(
          event, canvasRef.current, baseImage, viewport, false, viewportTransform
        )
        if (eraserStart) {
          const hitId = hitTestAnnotation(eraserStart, annotationsRef.current)
          if (hitId) {
            const filtered = annotationsRef.current.filter((a) => a.id !== hitId)
            replaceAnnotations(filtered, { recordHistory: true })
            setStatusLine('已擦除标注。')
          }
        }
        return
      }

      const start = pointFromPointerEvent(
        event,
        canvasRef.current,
        baseImage,
        viewport,
        false,
        viewportTransform
      )
      if (!start) {
        return
      }

      const scaledStroke = previewSizeToImageSize(strokeSize, baseImage, viewport, viewportTransform)
      const scaledMosaic = previewSizeToImageSize(mosaicSize, baseImage, viewport, viewportTransform)
      const scaledBlur = previewSizeToImageSize(blurSize, baseImage, viewport, viewportTransform)

      if (activeTool === 'text') {
        // 检测是否点击了已有文本标注 → 拖动（双击编辑由独立的 onDoubleClick 处理）
        const hitId = hitTestAnnotation(start, annotationsRef.current, 'text')
        if (hitId) {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDraggingAnnotationId(hitId)
          dragStartRef.current = start
          replaceAnnotations([...annotationsRef.current], { recordHistory: true, keepRedo: false })
          return
        }

        // 如果有正在编辑的内联文本，先提交
        if (inlineTextEdit) {
          commitInlineText()
        }

        // 在点击位置打开内联输入框
        setInlineTextEdit({
          id: createId('text'),
          point: start,
          text: '',
          size: previewSizeToImageSize(textSize, baseImage, viewport, viewportTransform),
          color: strokeColor
        })
        return
      }

      if (activeTool === 'step') {
        const nextValue = String(
          annotationsRef.current.filter((annotation) => annotation.kind === 'step').length + 1
        )

        appendAnnotation(
          {
            id: createId('step'),
            kind: 'step',
            color: strokeColor,
            point: start,
            value: nextValue,
            size: previewSizeToImageSize(Math.max(28, strokeSize * 3), baseImage, viewport, viewportTransform)
          },
          `已添加编号 ${nextValue}。`
        )
        return
      }

      if (activeTool === 'crop') {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDraftSelection({
          x: start.x,
          y: start.y,
          width: 0,
          height: 0
        })
        return
      }

      const annotationId = createId(activeTool)

      let nextDraft: Annotation
      switch (activeTool) {
        case 'pen':
          nextDraft = {
            id: annotationId,
            kind: 'pen',
            color: strokeColor,
            width: scaledStroke,
            points: [start]
          }
          break
        case 'highlighter':
          nextDraft = {
            id: annotationId,
            kind: 'highlighter',
            color: strokeColor,
            width: previewSizeToImageSize(Math.max(strokeSize * 2.2, 14), baseImage, viewport, viewportTransform),
            points: [start]
          }
          break
        case 'line':
          nextDraft = {
            id: annotationId,
            kind: 'line',
            color: strokeColor,
            width: scaledStroke,
            start,
            end: start
          }
          break
        case 'arrow':
          nextDraft = {
            id: annotationId,
            kind: 'arrow',
            color: strokeColor,
            width: scaledStroke,
            start,
            end: start
          }
          break
        case 'rect':
          nextDraft = {
            id: annotationId,
            kind: 'rect',
            color: strokeColor,
            width: scaledStroke,
            start,
            end: start
          }
          break
        case 'ellipse':
          nextDraft = {
            id: annotationId,
            kind: 'ellipse',
            color: strokeColor,
            width: scaledStroke,
            start,
            end: start
          }
          break
        case 'mosaic':
          nextDraft = {
            id: annotationId,
            kind: 'mosaic',
            color: strokeColor,
            cellSize: scaledMosaic,
            rect: {
              x: start.x,
              y: start.y,
              width: 0,
              height: 0
            }
          }
          break
        case 'blur':
          nextDraft = {
            id: annotationId,
            kind: 'blur',
            color: strokeColor,
            radius: scaledBlur,
            rect: {
              x: start.x,
              y: start.y,
              width: 0,
              height: 0
            }
          }
          break
        default:
          return
      }

      event.currentTarget.setPointerCapture(event.pointerId)
      setDraftAnnotation(nextDraft)
    },
    [
      activeTool,
      appendAnnotation,
      baseImage,
      blurSize,
      inlineTextEdit,
      mosaicSize,
      notification,
      replaceAnnotations,
      strokeColor,
      strokeSize,
      textSize,
      viewport,
      viewportTransform
    ]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!baseImage || !canvasRef.current) return

      if (isPanningRef.current) {
        panDeltaRef.current.x += event.clientX - lastPanClientRef.current.x
        panDeltaRef.current.y += event.clientY - lastPanClientRef.current.y
        lastPanClientRef.current = { x: event.clientX, y: event.clientY }
        if (!panRafRef.current) {
          panRafRef.current = requestAnimationFrame(() => {
            panRafRef.current = 0
            const { x, y } = panDeltaRef.current
            panDeltaRef.current = { x: 0, y: 0 }
            if (x !== 0) setPanX((prev) => prev + x)
            if (y !== 0) setPanY((prev) => prev + y)
          })
        }
        return
      }

      // 拖动已有标注：累积位移，rAF 批量更新
      if (draggingAnnotationId) {
        const currentPoint = pointFromPointerEvent(event, canvasRef.current, baseImage, viewport, true, viewportTransform)
        if (currentPoint) {
          dragDeltaRef.current.x += currentPoint.x - dragStartRef.current.x
          dragDeltaRef.current.y += currentPoint.y - dragStartRef.current.y
          dragStartRef.current = currentPoint
          if (!dragRafRef.current) {
            dragRafRef.current = requestAnimationFrame(() => {
              dragRafRef.current = 0
              const { x, y } = dragDeltaRef.current
              dragDeltaRef.current = { x: 0, y: 0 }
              if (x === 0 && y === 0) return
              const updated = annotationsRef.current.map((a) =>
                a.id === draggingAnnotationId ? moveAnnotation(a, { x, y }) : a
              )
              annotationsRef.current = updated
              setAnnotations(updated)
            })
          }
        }
        return
      }

      const currentPoint = pointFromPointerEvent(event, canvasRef.current, baseImage, viewport, true, viewportTransform)
      if (!currentPoint) return

      if (draftSelection) {
        setDraftSelection(normalizeRect({ x: draftSelection.x, y: draftSelection.y }, currentPoint))
        return
      }

      if (!draftAnnotation) return

      if (draftAnnotation.kind === 'pen' || draftAnnotation.kind === 'highlighter') {
        penPointsRef.current.push(currentPoint)
        if (!penRafRef.current) {
          penRafRef.current = requestAnimationFrame(() => {
            penRafRef.current = 0
            const batch = penPointsRef.current.splice(0)
            if (!batch.length) return
            setDraftAnnotation((prev) => {
              if (!prev || (prev.kind !== 'pen' && prev.kind !== 'highlighter')) return prev
              return { ...prev, points: [...prev.points, ...batch] }
            })
          })
        }
        return
      }

      if (draftAnnotation.kind === 'mosaic' || draftAnnotation.kind === 'blur') {
        mosaicEndRef.current = currentPoint
        if (!mosaicRafRef.current) {
          mosaicRafRef.current = requestAnimationFrame(() => {
            mosaicRafRef.current = 0
            const end = mosaicEndRef.current
            setDraftAnnotation((prev) => {
              if (!prev || (prev.kind !== 'mosaic' && prev.kind !== 'blur')) return prev
              return { ...prev, rect: normalizeRect({ x: prev.rect.x, y: prev.rect.y }, end) }
            })
          })
        }
        return
      }

      // line / arrow / rect / ellipse：只更新 end 点
      draftEndRef.current = currentPoint
      if (!draftEndRafRef.current) {
        draftEndRafRef.current = requestAnimationFrame(() => {
          draftEndRafRef.current = 0
          const end = draftEndRef.current
          setDraftAnnotation((prev) => {
            if (!prev) return prev
            const endPt = (() => {
              if (shiftKeyRef.current && (prev.kind === 'rect' || prev.kind === 'ellipse') && 'start' in prev) {
                const dx = end.x - prev.start.x
                const dy = end.y - prev.start.y
                const side = Math.max(Math.abs(dx), Math.abs(dy))
                return { x: prev.start.x + side * Math.sign(dx), y: prev.start.y + side * Math.sign(dy) }
              }
              return end
            })()
            return { ...prev, end: endPt } as Annotation
          })
        })
      }
    },
    [baseImage, draftAnnotation, draftSelection, draggingAnnotationId, viewport, viewportTransform]
  )

  const finishDraftAnnotation = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      // 取消所有待处理的 rAF
      cancelAnimationFrame(penRafRef.current)
      cancelAnimationFrame(dragRafRef.current)
      cancelAnimationFrame(draftEndRafRef.current)
      cancelAnimationFrame(mosaicRafRef.current)
      penRafRef.current = dragRafRef.current = draftEndRafRef.current = mosaicRafRef.current = 0

      if (isPanningRef.current) {
        isPanningRef.current = false
        cancelAnimationFrame(panRafRef.current)
        panRafRef.current = 0
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
        return
      }

      const dragId = draggingAnnotationIdRef.current
      if (dragId) {
        try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
        setDraggingAnnotationId(null)
        setStatusLine('已移动标注。')
        return
      }

      try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* ignore */ }

      if (draftSelection) {
        if (draftSelection.width > 6 && draftSelection.height > 6) {
          setSelectionRect(draftSelection)
          setStatusLine('裁剪选区已更新。')
        }
        setDraftSelection(null)
        return
      }

      // 用 ref 读取最新 draft，合并未刷新的 rAF 增量
      const currentDraft = draftAnnotationRef.current
      if (!currentDraft) return

      let finalDraft: Annotation = currentDraft
      if ((currentDraft.kind === 'pen' || currentDraft.kind === 'highlighter') && penPointsRef.current.length) {
        finalDraft = { ...currentDraft, points: [...currentDraft.points, ...penPointsRef.current] }
        penPointsRef.current = []
      }
      if ((currentDraft.kind === 'mosaic' || currentDraft.kind === 'blur') && mosaicEndRef.current) {
        const end = mosaicEndRef.current
        finalDraft = { ...currentDraft, rect: normalizeRect({ x: currentDraft.rect.x, y: currentDraft.rect.y }, end) } as Annotation
      }
      if (
        (currentDraft.kind === 'line' || currentDraft.kind === 'arrow' || currentDraft.kind === 'rect' || currentDraft.kind === 'ellipse') &&
        draftEndRef.current
      ) {
        const end = draftEndRef.current
        const endPt = shiftKeyRef.current && (currentDraft.kind === 'rect' || currentDraft.kind === 'ellipse')
          ? (() => {
              const s = (currentDraft as { start: Point }).start
              const dx = end.x - s.x; const dy = end.y - s.y
              const side = Math.max(Math.abs(dx), Math.abs(dy))
              return { x: s.x + side * Math.sign(dx), y: s.y + side * Math.sign(dy) }
            })()
          : end
        finalDraft = { ...currentDraft, end: endPt } as Annotation
      }

      setDraftAnnotation(null)

      if (annotationHasRenderableArea(finalDraft)) {
        replaceAnnotations([...annotationsRef.current, finalDraft], { recordHistory: true })
        setStatusLine(`已添加${activeToolMeta.label}。`)
      }
    },
    [activeToolMeta.label, draftSelection, replaceAnnotations]
  )

  const cancelDraftAnnotation = useCallback(() => {
    isPanningRef.current = false
    cancelAnimationFrame(panRafRef.current)
    cancelAnimationFrame(penRafRef.current)
    cancelAnimationFrame(dragRafRef.current)
    cancelAnimationFrame(draftEndRafRef.current)
    cancelAnimationFrame(mosaicRafRef.current)
    panRafRef.current = penRafRef.current = dragRafRef.current = draftEndRafRef.current = mosaicRafRef.current = 0
    panDeltaRef.current = { x: 0, y: 0 }
    setDraftAnnotation(null)
    setDraftSelection(null)
    setDraggingAnnotationId(null)
  }, [])

  // 提交内联文本编辑
  const commitInlineText = useCallback(() => {
    if (!inlineTextEdit) {
      return
    }
    const text = inlineTextEdit.text.trim()
    if (text) {
      appendAnnotation(
        {
          id: inlineTextEdit.id,
          kind: 'text',
          color: inlineTextEdit.color,
          point: inlineTextEdit.point,
          text,
          size: inlineTextEdit.size
        },
        '已添加文本。'
      )
    }
    setInlineTextEdit(null)
  }, [appendAnnotation, inlineTextEdit])

  // 切换工具时自动提交正在编辑的内联文本 + 清除选中
  useEffect(() => {
    if (inlineTextEdit && activeTool !== 'text') {
      commitInlineText()
    }
    // 切换工具时取消选中（除了切到 pan）
    if (activeTool !== 'pan') {
      setSelectedAnnotationId(null)
    }
  }, [activeTool]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 更新选中标注的属性（颜色、线宽等） */
  const updateSelectedAnnotation = useCallback(
    (patch: Partial<{ color: string; width: number; size: number; cellSize: number; radius: number }>) => {
      if (!selectedAnnotationId) return
      const updated = annotationsRef.current.map((a) => {
        if (a.id !== selectedAnnotationId) return a
        return { ...a, ...patch } as Annotation
      })
      replaceAnnotations(updated, { recordHistory: true })
    },
    [selectedAnnotationId, replaceAnnotations]
  )

  // 选中标注的信息（用于工具栏反映其当前颜色/大小）
  const selectedAnnotation = useMemo(
    () => selectedAnnotationId ? annotations.find((a) => a.id === selectedAnnotationId) ?? null : null,
    [selectedAnnotationId, annotations]
  )
  const effectiveColor = selectedAnnotation?.color ?? strokeColor

  // 内联文本输入框出现时延迟聚焦，避免和 canvas pointerDown 竞争
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (inlineTextEdit && inlineTextRef.current) {
      requestAnimationFrame(() => {
        inlineTextRef.current?.focus()
      })
    }
    return () => {
      if (blurTimerRef.current) {
        clearTimeout(blurTimerRef.current)
        blurTimerRef.current = null
      }
    }
  }, [inlineTextEdit?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const openLastSavedFolder = useCallback(() => {
    if (!lastSavedPath) {
      return
    }

    void shell.showItemInFolder(lastSavedPath)
  }, [lastSavedPath, shell])

  const canEdit = Boolean(baseImage)
  const canAdjustImage = Boolean(baseImage && sharp)
  const isStrokeTool = STROKE_TOOLS.includes(activeTool)

  return (
    <div className="studio-root">
      <div className="top-shell">
        <div className="top-meta">
          {baseImage ? (
            <>
              <span className="meta-chip">{baseImage.label}</span>
              <span className="meta-chip">{quickStats?.resolution}</span>
              <span className="meta-chip">{annotations.length} 标注</span>
              {selectionSummary && <span className="meta-chip">{selectionSummary}</span>}
            </>
          ) : (
            <span className="meta-chip">{statusLine}</span>
          )}
          {busyLabel && (
            <span className="meta-chip busy-chip">
              <LoaderCircle className="spinning" size={14} />
              {busyLabel}
            </span>
          )}
        </div>
      </div>

      {errorMessage && <div className="error-strip">{errorMessage}</div>}

      <div className="workspace-grid balanced-grid">
        <aside className="side-rail left-rail">
          <section className="panel-card rail-card">
            <div className="stack-actions">
              <button
                className="action-row action-row-strong"
                onClick={() => void captureRegionShot()}
                type="button"
              >
                <Camera size={16} />
                区域截图
              </button>
              <button className="action-row" onClick={() => void capturePrimaryDisplay()} type="button">
                <Monitor size={16} />
                全屏截图
              </button>
              <button className="action-row" onClick={() => void openClipboardImage()} type="button">
                <ClipboardPaste size={16} />
                读取剪贴板
              </button>
              <button className="action-row" onClick={() => void openImageFile()} type="button">
                <FolderOpen size={16} />
                导入本地图片
              </button>
            </div>
          </section>

          <section className="panel-card rail-card screens-card">
            <div className="rail-inline">
              <span className="soft-pill">
                <Monitor size={14} />
                屏幕
              </span>
              <button
                className="tool-icon-button utility-button"
                onClick={() => void refreshScreenSources()}
                title="刷新屏幕列表"
                type="button"
              >
                <RefreshCcw size={15} />
              </button>
            </div>

            <div className="screen-list">
              {screenSources.length === 0 ? (
                <div className="screen-empty">暂无可用缩略图</div>
              ) : (
                screenSources.map((source) => (
                  <button
                    key={source.id}
                    className="screen-card"
                    onClick={() => void captureFullScreen(source.id, source.name)}
                    type="button"
                    title={`抓取 ${source.name}`}
                  >
                    <img src={source.thumbnailDataUrl} alt={source.name} />
                    <span>{source.name}</span>
                  </button>
                ))
              )}
            </div>
          </section>
        </aside>

        <section className="stage-panel editor-stage">
          <div className="canvas-toolbar">
            <div className="toolbar-strip">
              {TOOL_OPTIONS.map((tool) => {
                const ToolIcon = tool.icon
                return (
                  <button
                    key={tool.key}
                    className={tool.key === activeTool ? 'tool-icon-button active' : 'tool-icon-button'}
                    onClick={() => setActiveTool(tool.key)}
                    title={tool.label}
                    type="button"
                  >
                    <ToolIcon size={17} />
                  </button>
                )
              })}
            </div>

            <div className="toolbar-divider" />

            <div className="toolbar-strip toolbar-strip-swatches">
              {COLOR_SWATCHES.map((color) => (
                <button
                  key={color}
                  className={color === effectiveColor ? 'swatch active' : 'swatch'}
                  style={{ backgroundColor: color }}
                  type="button"
                  title={`切换颜色 ${color}`}
                  onClick={() => {
                    setStrokeColor(color)
                    if (selectedAnnotation) {
                      updateSelectedAnnotation({ color })
                    }
                  }}
                />
              ))}
            </div>

            <div className="toolbar-divider" />

            <div className="toolbar-range">
              <span>
                {isStrokeTool
                  ? `${strokeSize}px`
                  : activeTool === 'mosaic'
                    ? `${mosaicSize}px`
                    : activeTool === 'blur'
                      ? `${blurSize}px`
                      : activeTool === 'text'
                        ? `${textSize}px`
                        : selectionSummary ?? activeToolMeta.label}
              </span>
              {isStrokeTool && (
                <input
                  type="range"
                  min="2"
                  max="22"
                  value={strokeSize}
                  onChange={(event) => {
                    const v = Number(event.target.value)
                    setStrokeSize(v)
                    if (selectedAnnotation && 'width' in selectedAnnotation) {
                      updateSelectedAnnotation({ width: previewSizeToImageSize(v, baseImage!, viewport, viewportTransform) })
                    }
                  }}
                  title="线宽"
                />
              )}
              {activeTool === 'mosaic' && (
                <input
                  type="range"
                  min="8"
                  max="42"
                  value={mosaicSize}
                  onChange={(event) => setMosaicSize(Number(event.target.value))}
                  title="马赛克颗粒"
                />
              )}
              {activeTool === 'blur' && (
                <input
                  type="range"
                  min="6"
                  max="28"
                  value={blurSize}
                  onChange={(event) => setBlurSize(Number(event.target.value))}
                  title="模糊强度"
                />
              )}
              {activeTool === 'text' && (
                <input
                  type="range"
                  min="18"
                  max="54"
                  value={textSize}
                  onChange={(event) => {
                    const v = Number(event.target.value)
                    setTextSize(v)
                    if (selectedAnnotation && selectedAnnotation.kind === 'text') {
                      updateSelectedAnnotation({ size: previewSizeToImageSize(v, baseImage!, viewport, viewportTransform) })
                    }
                  }}
                  title="文字大小"
                />
              )}
              {/* pan 工具下选中标注时显示大小调整 */}
              {activeTool === 'pan' && selectedAnnotation && 'width' in selectedAnnotation && (
                <input
                  type="range"
                  min="2"
                  max="22"
                  value={strokeSize}
                  onChange={(event) => {
                    const v = Number(event.target.value)
                    setStrokeSize(v)
                    updateSelectedAnnotation({ width: previewSizeToImageSize(v, baseImage!, viewport, viewportTransform) })
                  }}
                  title="线宽"
                />
              )}
              {activeTool === 'pan' && selectedAnnotation && selectedAnnotation.kind === 'text' && (
                <input
                  type="range"
                  min="18"
                  max="54"
                  value={textSize}
                  onChange={(event) => {
                    const v = Number(event.target.value)
                    setTextSize(v)
                    updateSelectedAnnotation({ size: previewSizeToImageSize(v, baseImage!, viewport, viewportTransform) })
                  }}
                  title="文字大小"
                />
              )}
            </div>

            <div className="toolbar-spacer" />

            <div className="toolbar-strip">
              <button
                className="tool-icon-button utility-button"
                disabled={!undoStack.length}
                onClick={handleUndo}
                title="撤销"
                type="button"
              >
                <Undo2 size={16} />
              </button>
              <button
                className="tool-icon-button utility-button"
                disabled={!redoStack.length}
                onClick={handleRedo}
                title="重做"
                type="button"
              >
                <Redo2 size={16} />
              </button>
              <button
                className="tool-icon-button utility-button"
                disabled={!annotations.length}
                onClick={clearAnnotations}
                title="清空标注"
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>

          <div className="stage-surface editor-stage-surface" ref={stageRef}>
            {!baseImage ? (
              <div className="stage-empty compact-empty">
                <ImagePlus size={44} />
                <div className="empty-actions">
                  <button className="primary-action" onClick={() => void captureRegionShot()} type="button">
                    <Camera size={16} />
                    区域截图
                  </button>
                  <button className="secondary-action" onClick={() => void capturePrimaryDisplay()} type="button">
                    <Monitor size={16} />
                    全屏截图
                  </button>
                </div>
              </div>
            ) : (
              <>
                <canvas
                  ref={canvasRef}
                  className="editor-canvas"
                  style={{ cursor: draggingAnnotationId ? 'grabbing' : (activeTool === 'text' ? 'text' : pointerCursor) }}
                  onPointerDown={handlePointerDown}
                  onDoubleClick={(event) => {
                    // 双击编辑已有文本标注
                    if (activeTool !== 'text' || !baseImage || !canvasRef.current) return
                    const pt = pointFromPointerEvent(
                      event as unknown as React.PointerEvent<HTMLCanvasElement>,
                      canvasRef.current, baseImage, viewport, false, viewportTransform
                    )
                    if (!pt) return
                    const hitId = hitTestAnnotation(pt, annotationsRef.current, 'text')
                    if (!hitId) return
                    const hitAnnotation = annotationsRef.current.find((a) => a.id === hitId)
                    if (!hitAnnotation || hitAnnotation.kind !== 'text') return
                    // 从 annotations 移除，打开内联编辑器
                    const filtered = annotationsRef.current.filter((a) => a.id !== hitId)
                    replaceAnnotations(filtered, { recordHistory: true })
                    setDraggingAnnotationId(null)
                    setInlineTextEdit({
                      id: hitAnnotation.id,
                      point: hitAnnotation.point,
                      text: hitAnnotation.text,
                      size: hitAnnotation.size,
                      color: hitAnnotation.color
                    })
                  }}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishDraftAnnotation}
                  onPointerLeave={finishDraftAnnotation}
                  onPointerCancel={cancelDraftAnnotation}
                  onContextMenu={(e) => e.preventDefault()}
                />
                {inlineTextEdit && baseImage && (() => {
                  const screenPt = imagePointToScreenPoint(
                    inlineTextEdit.point,
                    baseImage,
                    viewport,
                    viewportTransform
                  )
                  const scale = getImageScale(baseImage, viewport, viewportTransform)
                  const fontSize = Math.max(14, inlineTextEdit.size * scale)
                  return (
                    <textarea
                      ref={inlineTextRef}
                      className="inline-text-editor"
                      style={{
                        left: screenPt.x,
                        top: screenPt.y,
                        fontSize,
                        lineHeight: 1.25,
                        color: inlineTextEdit.color,
                        minWidth: Math.max(120, fontSize * 4),
                      }}
                      value={inlineTextEdit.text}
                      onChange={(e) =>
                        setInlineTextEdit((prev) => prev ? { ...prev, text: e.target.value } : null)
                      }
                      onBlur={() => {
                        // 延迟提交，避免和 canvas pointerDown 事件竞争
                        blurTimerRef.current = setTimeout(() => {
                          blurTimerRef.current = null
                          commitInlineText()
                        }, 120)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          if (blurTimerRef.current) {
                            clearTimeout(blurTimerRef.current)
                            blurTimerRef.current = null
                          }
                          setInlineTextEdit(null)
                        }
                        e.stopPropagation()
                      }}
                      placeholder="输入文本"
                    />
                  )
                })()}
                <div className="zoom-controls">
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => {
                      const newZoom = Math.max(0.25, zoom - 0.25)
                      setZoom(newZoom)
                      if (newZoom <= 1) {
                        setPanX(0)
                        setPanY(0)
                      }
                    }}
                    title="缩小"
                    aria-label="缩小"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="zoom-label" title="滚轮缩放，空格+拖动平移">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => {
                      setZoom((z) => Math.min(4, z + 0.25))
                    }}
                    title="放大"
                    aria-label="放大"
                  >
                    <Plus size={16} />
                  </button>
                  {(zoom !== 1 || panX !== 0 || panY !== 0) && (
                    <button
                      type="button"
                      className="zoom-btn zoom-reset"
                      onClick={() => {
                        setZoom(1)
                        setPanX(0)
                        setPanY(0)
                      }}
                      title="适应窗口"
                      aria-label="适应窗口"
                    >
                      <RefreshCcw size={14} />
                    </button>
                  )}
                </div>
              </>
            )}

            {busyLabel && (
              <div className="busy-overlay">
                <LoaderCircle className="spinning" size={24} />
                <span>{busyLabel}</span>
              </div>
            )}
          </div>
        </section>

        <aside className="side-rail right-rail">
          <section className="panel-card rail-card">
            <div className="stack-actions">
              <button
                className="action-row action-row-strong"
                onClick={() => void handleSaveImage()}
                disabled={!canEdit}
                type="button"
              >
                <Save size={16} />
                保存到本地
              </button>
              <button
                className="action-row"
                onClick={() => void handleCopyImage()}
                disabled={!canEdit}
                type="button"
              >
                <Copy size={16} />
                复制到剪贴板
              </button>
              <button
                className="action-row"
                onClick={openLastSavedFolder}
                disabled={!lastSavedPath}
                type="button"
              >
                <FolderOpen size={16} />
                打开保存位置
              </button>
            </div>
          </section>

          <section className="panel-card rail-card">
            <div className="rail-inline">
              <span className="soft-pill">
                <Sparkles size={14} />
                调整
              </span>
              {!sharp && <span className="soft-pill muted-pill">未接入 sharp</span>}
            </div>

            <div className="adjust-grid">
              <button
                className="tool-icon-button adjust-button"
                disabled={!canAdjustImage || !selectionRect}
                onClick={() => void applyCropSelection()}
                title="裁剪到当前选区"
                type="button"
              >
                <Crop size={17} />
              </button>
              <button
                className="tool-icon-button adjust-button"
                disabled={!selectionRect}
                onClick={clearSelection}
                title="清除选区"
                type="button"
              >
                <Trash2 size={17} />
              </button>
              <button
                className="tool-icon-button adjust-button"
                disabled={!canAdjustImage}
                onClick={() => void rotateLeft()}
                title="向左旋转"
                type="button"
              >
                <RotateCcw size={17} />
              </button>
              <button
                className="tool-icon-button adjust-button"
                disabled={!canAdjustImage}
                onClick={() => void rotateRight()}
                title="向右旋转"
                type="button"
              >
                <RotateCw size={17} />
              </button>
              <button
                className="tool-icon-button adjust-button"
                disabled={!canAdjustImage}
                onClick={() => void flipHorizontal()}
                title="水平翻转"
                type="button"
              >
                <FlipHorizontal size={17} />
              </button>
              <button
                className="tool-icon-button adjust-button"
                disabled={!canAdjustImage}
                onClick={() => void flipVertical()}
                title="垂直翻转"
                type="button"
              >
                <FlipVertical size={17} />
              </button>
              <button
                className="tool-icon-button adjust-button"
                disabled={!canAdjustImage}
                onClick={() => void applyGreyscale()}
                title="灰度"
                type="button"
              >
                <Circle size={17} />
              </button>
              <button
                className="tool-icon-button adjust-button"
                disabled={!canAdjustImage}
                onClick={() => void applyEnhance()}
                title="一键增强"
                type="button"
              >
                <Sparkles size={17} />
              </button>
            </div>
          </section>

          </aside>
      </div>
    </div>
  )
}
