import { useEffect, useState, useRef, useCallback } from 'react'

/**
 * 截图置顶插件 - 统一入口：
 * 通过 onPluginInit 的 route 字段判断当前窗口角色：
 * - 没有 mode=pin → CaptureHost：接收 preCapture 截图，创建 Pin 子窗口
 * - 有 mode=pin → PinWindow：展示截图，支持拖动、右键关闭
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
}

interface PluginInitData {
  pluginName: string
  featureCode: string
  input: string
  mode?: string
  route?: string
  attachments?: Attachment[]
}

export default function App() {
  // 通过 state 切换模式，由 onPluginInit 的 route 决定
  const [viewMode, setViewMode] = useState<'loading' | 'capture' | 'pin'>('loading')
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const hasHandled = useRef(false)

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

  /**
   * 创建 Pin 子窗口
   */
  const createPinWindow = useCallback(async (dataUrl: string) => {
    try {
      const imgSize = await getImageSize(dataUrl)
      const maxW = 800, maxH = 600
      let w = imgSize.width, h = imgSize.height
      if (w > maxW || h > maxH) {
        const scale = Math.min(maxW / w, maxH / h)
        w = Math.round(w * scale)
        h = Math.round(h * scale)
      }

      const encodedData = encodeURIComponent(dataUrl)
      await window.mulby?.window?.create?.(
        `/index.html?mode=pin&img=${encodedData}`,
        {
          width: w,
          height: h,
          type: 'borderless',
          alwaysOnTop: true,
          resizable: true,
          titleBar: false,
          transparent: true,
        } as any
      )
    } catch (err) {
      console.error('[screen-pin] 创建 Pin 窗口失败:', err)
      window.mulby?.notification?.show('创建置顶窗口失败', 'error')
    }

    // 关闭主窗口
    setTimeout(() => {
      window.mulby?.window?.close?.()
    }, 300)
  }, [])

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

      // 通过 route 字段判断是否为 Pin 子窗口
      const route = data.route || ''
      const routeParams = new URLSearchParams(route.split('?')[1] || '')
      const isPinWindow = routeParams.get('mode') === 'pin'

      if (isPinWindow) {
        // ===== Pin 子窗口模式：从 route 参数中提取图片 =====
        const imgParam = routeParams.get('img')
        if (imgParam) {
          setImgSrc(decodeURIComponent(imgParam))
        }
        setViewMode('pin')
        // 确保置顶
        window.mulby?.window?.setAlwaysOnTop?.(true)
      } else {
        // ===== 主窗口模式：接收 preCapture 数据并创建 Pin 子窗口 =====
        setViewMode('capture')
        const imgAttachment = data.attachments?.find(a => a.kind === 'image')
        if (imgAttachment) {
          resolveAttachmentDataUrl(imgAttachment).then(dataUrl => {
            if (dataUrl) {
              createPinWindow(dataUrl)
            } else {
              window.mulby?.notification?.show('未获取到截图数据', 'warning')
            }
          })
        } else {
          window.mulby?.notification?.show('未获取到截图', 'warning')
        }
      }
    })
  }, [createPinWindow, resolveAttachmentDataUrl])

  if (viewMode === 'loading') {
    return <div className="pin-loading"><div className="spinner" /></div>
  }

  if (viewMode === 'capture') {
    return (
      <div className="capture-host">
        <div className="capture-hint">
          <div className="spinner" />
          <span>正在创建置顶窗口...</span>
        </div>
      </div>
    )
  }

  // ===== Pin 模式 =====
  return <PinView imgSrc={imgSrc} />
}

/**
 * Pin 窗口视图：展示截图，支持拖动和右键菜单
 */
function PinView({ imgSrc }: { imgSrc: string | null }) {
  const [currentOpacity, setCurrentOpacity] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  // 调用原生 Window API 设置窗口透明度
  const applyOpacity = useCallback(async (value: number) => {
    try {
      await window.mulby?.window?.setOpacity?.(value)
      setCurrentOpacity(value)
    } catch (err) {
      console.error('[screen-pin] setOpacity 失败:', err)
    }
  }, [])

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
    window.mulby?.window?.close?.()
  }, [])

  if (!imgSrc) {
    return <div className="pin-loading"><div className="spinner" /></div>
  }

  return (
    <div
      ref={containerRef}
      className="pin-container"
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <div className="pin-drag-handle" />
      <img className="pin-image" src={imgSrc} alt="截图" draggable={false} />
      <div className="pin-border" />
    </div>
  )
}

function getImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 400, height: 300 })
    img.src = dataUrl
  })
}
