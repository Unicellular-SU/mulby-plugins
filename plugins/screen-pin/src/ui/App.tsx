import { useEffect, useState, useRef, useCallback } from 'react'

/**
 * 截图置顶插件 - 统一入口：
 * 由 Mulby 在 preCapture 后直接打开 detached 透明窗口：
 * - 图片未准备好时渲染透明空状态
 * - 图片准备好后展示截图，支持拖动、右键关闭、双击关闭
 */

// 附件类型
interface Attachment {
  id: string
  name: string
  size: number
  kind: 'file' | 'image'
  mime?: string
  ext?: string
  path?: string
  dataUrl?: string
  capture?: {
    type: 'region' | 'fullscreen'
    region?: CaptureRegion
    display?: {
      scaleFactor?: number
    }
  }
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
  params?: Record<string, string>
  attachments?: Attachment[]
}

type WindowBounds = { x: number; y: number; width: number; height: number }

type DisplaySize = { width: number; height: number }

type CaptureRegion = {
  x: number
  y: number
  width: number
  height: number
  scaleFactor?: number
}

type DragState = {
  pointerId: number
  startScreenX: number
  startScreenY: number
  startWindowX: number
  startWindowY: number
  lastScreenX: number
  lastScreenY: number
  frameId: number | null
  ready: boolean
}

type PinImageData = {
  dataUrl: string
  region?: CaptureRegion
  scaleFactor: number
}

const LARGE_WINDOW_MARGIN = 24

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getPreviewDisplaySize(data: {
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
      width: Math.max(80, Math.round(data.naturalWidth / data.scaleFactor)),
      height: Math.max(60, Math.round(data.naturalHeight / data.scaleFactor))
    }
  }

  return {
    width: Math.max(240, window.innerWidth),
    height: Math.max(160, window.innerHeight)
  }
}

function buildConstrainedBounds(args: {
  displaySize: DisplaySize
  region?: CaptureRegion
  workArea?: { x: number; y: number; width: number; height: number }
}) {
  const requestedWidth = Math.max(1, Math.round(args.displaySize.width))
  const requestedHeight = Math.max(1, Math.round(args.displaySize.height))

  if (!args.region || !args.workArea) {
    return {
      width: requestedWidth,
      height: requestedHeight
    }
  }

  const shouldInsetLargeWindow =
    requestedWidth >= args.workArea.width - LARGE_WINDOW_MARGIN * 2 ||
    requestedHeight >= args.workArea.height - LARGE_WINDOW_MARGIN * 2
  const safeWorkArea = shouldInsetLargeWindow
    ? {
        x: args.workArea.x + LARGE_WINDOW_MARGIN,
        y: args.workArea.y + LARGE_WINDOW_MARGIN,
        width: Math.max(1, args.workArea.width - LARGE_WINDOW_MARGIN * 2),
        height: Math.max(1, args.workArea.height - LARGE_WINDOW_MARGIN * 2)
      }
    : args.workArea

  const width = Math.max(1, Math.min(requestedWidth, safeWorkArea.width))
  const height = Math.max(1, Math.min(requestedHeight, safeWorkArea.height))

  return {
    x: clamp(args.region.x, safeWorkArea.x, safeWorkArea.x + Math.max(0, safeWorkArea.width - width)),
    y: clamp(args.region.y, safeWorkArea.y, safeWorkArea.y + Math.max(0, safeWorkArea.height - height)),
    width,
    height
  }
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('截图加载失败'))
    image.src = dataUrl
  })
}

export default function App() {
  const [viewMode, setViewMode] = useState<'loading' | 'pin'>('loading')
  const [pinImage, setPinImage] = useState<PinImageData | null>(null)
  const hasHandled = useRef(false)

  const closeCurrentWindowSoon = useCallback((delay = 120) => {
    window.setTimeout(() => {
      window.mulby?.window?.close?.()
    }, delay)
  }, [])

  /**
   * 从附件中提取截图 Data URL
   */
  const resolveAttachmentDataUrl = useCallback(async (attachment: Attachment): Promise<string | null> => {
    if (attachment.dataUrl) return attachment.dataUrl
    if (attachment.path) {
      try {
        const base64 = await window.mulby?.filesystem?.readFile(attachment.path, 'base64')
        if (base64) {
          const mime = attachment.mime || 'image/png'
          return `data:${mime};base64,${base64}`
        }
      } catch (err) {
        console.error('[screen-pin] 读取附件文件失败:', err)
      }
    }
    return null
  }, [])

  const resolveWindowBounds = useCallback(async (displaySize: DisplaySize, region?: CaptureRegion) => {
    if (!region) {
      return buildConstrainedBounds({ displaySize })
    }

    try {
      const display = await window.mulby?.screen?.getDisplayMatching?.({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height
      })

      return buildConstrainedBounds({
        displaySize,
        region,
        workArea: display?.workArea ?? display?.bounds
      })
    } catch {
      return buildConstrainedBounds({ displaySize, region })
    }
  }, [])

  const applyWindowBoundsForImage = useCallback(async (
    displaySize: DisplaySize,
    region?: CaptureRegion,
    shouldCenter = false
  ) => {
    const bounds = await resolveWindowBounds(displaySize, region)
    await window.mulby?.window?.setBounds?.(bounds)

    if (shouldCenter) {
      window.mulby?.window?.center?.()
    }
  }, [resolveWindowBounds])

  const openPinImage = useCallback(async (nextImage: PinImageData) => {
    const previewSize = getPreviewDisplaySize({
      region: nextImage.region,
      scaleFactor: nextImage.scaleFactor
    })

    setPinImage(nextImage)
    setViewMode('pin')
    window.mulby?.window?.setAlwaysOnTop?.(true)
    void applyWindowBoundsForImage(previewSize, nextImage.region, !nextImage.region)

    try {
      const image = await loadImage(nextImage.dataUrl)
      if (!nextImage.region) {
        const displaySize = getPreviewDisplaySize({
          scaleFactor: nextImage.scaleFactor,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight
        })
        void applyWindowBoundsForImage(displaySize, undefined, true)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '截图加载失败'
      console.error('[screen-pin] 截图加载失败:', err)
      window.mulby?.notification?.show(message, 'error')
      closeCurrentWindowSoon()
    }
  }, [applyWindowBoundsForImage, closeCurrentWindowSoon])

  useEffect(() => {
    // 初始化主题
    const urlParams = new URLSearchParams(window.location.search)
    const themeParam = urlParams.get('theme') as 'light' | 'dark'
    if (themeParam) {
      document.documentElement.classList.toggle('dark', themeParam === 'dark')
    }
    window.mulby?.onThemeChange?.((newTheme: 'light' | 'dark') => {
      document.documentElement.classList.toggle('dark', newTheme === 'dark')
    })

    window.mulby?.onPluginInit?.((data: PluginInitData) => {
      if (hasHandled.current) return
      hasHandled.current = true

      // 兼容旧版子窗口 route / params；新版直接使用 preCapture 附件。
      const route = data.route || ''
      const routeParams = new URLSearchParams(route.split('?')[1] || '')
      const searchParams = new URLSearchParams(window.location.search)
      const initParams = data.params || {}

      const legacyImgParam = initParams.img || routeParams.get('img') || searchParams.get('img')
      if (legacyImgParam) {
        void openPinImage({
          dataUrl: decodeURIComponent(legacyImgParam),
          scaleFactor: window.devicePixelRatio || 1
        })
        return
      }

      const imgAttachment = data.attachments?.find(a => a.kind === 'image')
      if (imgAttachment) {
        resolveAttachmentDataUrl(imgAttachment).then(dataUrl => {
          if (dataUrl) {
            void openPinImage({
              dataUrl,
              region: imgAttachment.capture?.region,
              scaleFactor:
                imgAttachment.capture?.region?.scaleFactor ??
                imgAttachment.capture?.display?.scaleFactor ??
                window.devicePixelRatio ??
                1
            })
          } else {
            window.mulby?.notification?.show('未获取到截图数据', 'warning')
            closeCurrentWindowSoon()
          }
        })
      } else {
        window.mulby?.notification?.show('未获取到截图', 'warning')
        closeCurrentWindowSoon()
      }
    })
  }, [closeCurrentWindowSoon, openPinImage, resolveAttachmentDataUrl])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.mulby?.window?.close?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  if (viewMode === 'loading') {
    return null
  }

  // ===== Pin 模式 =====
  return <PinView imgSrc={pinImage?.dataUrl ?? null} />
}

/**
 * Pin 窗口视图：展示截图，支持拖动和右键菜单
 */
function PinView({ imgSrc }: { imgSrc: string | null }) {
  const [currentOpacity, setCurrentOpacity] = useState(1)
  const [isImageReady, setIsImageReady] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<DragState | null>(null)

  const cancelDragFrame = useCallback(() => {
    const dragState = dragStateRef.current
    if (dragState?.frameId !== null && dragState?.frameId !== undefined) {
      window.cancelAnimationFrame(dragState.frameId)
      dragState.frameId = null
    }
  }, [])

  // 调用原生 Window API 设置窗口透明度
  const applyOpacity = useCallback(async (value: number) => {
    try {
      await window.mulby?.window?.setOpacity?.(value)
      setCurrentOpacity(value)
    } catch (err) {
      console.error('[screen-pin] setOpacity 失败:', err)
    }
  }, [])

  const moveWindowToPointer = useCallback((dragState: DragState) => {
    const nextX = Math.round(dragState.startWindowX + dragState.lastScreenX - dragState.startScreenX)
    const nextY = Math.round(dragState.startWindowY + dragState.lastScreenY - dragState.startScreenY)
    const win = window.mulby?.window

    if (win?.setPosition) {
      win.setPosition(nextX, nextY)
    } else if (win?.setBounds) {
      void win.setBounds({ x: nextX, y: nextY })
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return

    const win = window.mulby?.window
    if (!win?.getBounds || (!win.setBounds && !win.setPosition)) return

    const pointerId = e.pointerId
    const startScreenX = e.screenX
    const startScreenY = e.screenY
    e.currentTarget.setPointerCapture(pointerId)

    void win.getBounds().then((bounds: WindowBounds | null) => {
      if (!bounds || dragStateRef.current?.pointerId !== pointerId) return

      dragStateRef.current.startWindowX = bounds.x
      dragStateRef.current.startWindowY = bounds.y
      dragStateRef.current.ready = true
    }).catch((err: unknown) => {
      console.error('[screen-pin] 获取窗口位置失败:', err)
      dragStateRef.current = null
    })

    dragStateRef.current = {
      pointerId,
      startScreenX,
      startScreenY,
      startWindowX: 0,
      startWindowY: 0,
      lastScreenX: startScreenX,
      lastScreenY: startScreenY,
      frameId: null,
      ready: false,
    }
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== e.pointerId) return

    dragState.lastScreenX = e.screenX
    dragState.lastScreenY = e.screenY

    if (!dragState.ready) return
    if (dragState.frameId !== null) return

    dragState.frameId = window.requestAnimationFrame(() => {
      dragState.frameId = null
      moveWindowToPointer(dragState)
    })
  }, [moveWindowToPointer])

  const finishPointerDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== e.pointerId) return

    cancelDragFrame()
    dragStateRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Pointer capture may already be released by the browser.
    }
  }, [cancelDragFrame])

  useEffect(() => {
    return () => {
      cancelDragFrame()
      dragStateRef.current = null
    }
  }, [cancelDragFrame])

  useEffect(() => {
    setIsImageReady(false)
  }, [imgSrc])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    window.mulby?.menu?.showContextMenu([
      { label: '复制图片', id: 'copy' },
      { label: '保存图片', id: 'save' },
      { type: 'separator' },
      { label: '透明度 100%', id: 'opacity-100', type: 'radio', checked: currentOpacity === 1 },
      { label: '透明度 80%', id: 'opacity-80', type: 'radio', checked: currentOpacity === 0.8 },
      { label: '透明度 50%', id: 'opacity-50', type: 'radio', checked: currentOpacity === 0.5 },
      { type: 'separator' },
      { label: '关闭', id: 'close' },
    ] as any).then((result: any) => {
      if (!result) return
      const id = typeof result === 'string' ? result : result?.id
      switch (id) {
        case 'copy': handleCopy(); break
        case 'save': handleSave(); break
        case 'opacity-100': applyOpacity(1); break
        case 'opacity-80': applyOpacity(0.8); break
        case 'opacity-50': applyOpacity(0.5); break
        case 'close': window.mulby?.window?.close?.(); break
      }
    }).catch(() => {})
  }, [currentOpacity, imgSrc])

  const handleCopy = useCallback(async () => {
    if (!imgSrc) return
    try {
      await window.mulby?.clipboard?.writeImage(imgSrc)
      window.mulby?.notification?.show('已复制到剪贴板')
    } catch (err) {
      console.error('[screen-pin] 复制失败:', err)
    }
  }, [imgSrc])

  const handleSave = useCallback(async () => {
    if (!imgSrc) return
    try {
      const savePath = await window.mulby?.dialog?.showSaveDialog({
        title: '保存截图',
        defaultPath: `screenshot_${Date.now()}.png`,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      })
      if (savePath) {
        const base64Data = imgSrc.split(',')[1]
        await window.mulby?.filesystem?.writeFile(savePath, base64Data, 'base64')
        window.mulby?.notification?.show('已保存截图')
      }
    } catch (err) {
      console.error('[screen-pin] 保存失败:', err)
    }
  }, [imgSrc])

  const handleDoubleClick = useCallback(() => {
    cancelDragFrame()
    dragStateRef.current = null
    window.mulby?.window?.close?.()
  }, [cancelDragFrame])

  if (!imgSrc) {
    return null
  }

  return (
    <div
      ref={containerRef}
      className={`pin-container ${isImageReady ? 'is-ready' : 'is-waiting'}`}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
    >
      <img
        className="pin-image"
        src={imgSrc}
        alt="截图"
        draggable={false}
        onLoad={() => {
          setIsImageReady(true)
          window.mulby?.window?.show?.()
          window.mulby?.window?.setAlwaysOnTop?.(true)
        }}
        onError={() => {
          window.mulby?.notification?.show('截图加载失败', 'error')
          window.mulby?.window?.close?.()
        }}
      />
      <div className="pin-border" />
    </div>
  )
}
