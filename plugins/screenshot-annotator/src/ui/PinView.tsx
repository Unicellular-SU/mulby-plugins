import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useMulby } from './hooks/useMulby'
import { RESIZE_EDGES, useFloatingWindow } from './hooks/useFloatingWindow'
import { readLaunchQueryParam } from './utils/launch'
import { dataUrlToBase64, defaultPngFileName, ensurePngPath } from './utils/image'

const PLUGIN_ID = 'screenshot-annotator'

type PinHandoff = {
  dataUrl?: string
  createdAt?: number
}

/**
 * 「钉图」窗口（参考 screen-pin 插件）：无边框透明置顶窗口展示截图，
 * 支持拖动移动、拖边缩放、右键菜单（复制/保存/透明度/关闭）、双击或 Esc 关闭。
 * 通过 pin-handoff-{id} 存储键拿到截图标注窗口导出好的图片。
 */
export default function PinView() {
  const mulby = useMulby(PLUGIN_ID)
  const win = window.mulby?.window as unknown as Parameters<typeof useFloatingWindow>[0] | undefined

  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [opacity, setOpacity] = useState(1)

  const floating = useFloatingWindow(win)

  // 透明窗口背景 + 置顶。
  useEffect(() => {
    document.documentElement.classList.remove('history-window', 'ai-window')
    document.documentElement.classList.add('transparent')
    window.mulby?.window?.setAlwaysOnTop?.(true)
    return () => {
      document.documentElement.classList.remove('transparent')
    }
  }, [])

  // 读取并清理交接键。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const handoffId = readLaunchQueryParam('pinHandoff')
      try {
        const handoff = handoffId ? await mulby.storage.get(`pin-handoff-${handoffId}`) : null
        if (cancelled) {
          return
        }
        const url = handoff && typeof handoff === 'object' ? (handoff as PinHandoff).dataUrl : null
        setDataUrl(typeof url === 'string' && url ? url : null)
        if (handoffId) {
          void mulby.storage.remove(`pin-handoff-${handoffId}`)
        }
      } catch {
        if (!cancelled) {
          setDataUrl(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mulby.storage])

  // Esc 关闭。
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

  const notify = useCallback(
    (message: string, type?: 'info' | 'success' | 'warning' | 'error') => {
      mulby.notification?.show?.(message, type ?? 'info')
    },
    [mulby.notification]
  )

  const handleCopy = useCallback(async () => {
    if (!dataUrl) {
      return
    }
    try {
      await mulby.clipboard.writeImage(dataUrl)
      notify('已复制到剪贴板', 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : '复制失败', 'error')
    }
  }, [dataUrl, mulby.clipboard, notify])

  const handleSave = useCallback(async () => {
    if (!dataUrl) {
      return
    }
    try {
      const pickedPath = await mulby.dialog.showSaveDialog({
        title: '保存截图',
        defaultPath: defaultPngFileName('pin'),
        buttonLabel: '保存',
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })
      if (!pickedPath) {
        return
      }
      await mulby.filesystem.writeFile(ensurePngPath(pickedPath), dataUrlToBase64(dataUrl), 'base64')
      notify('已保存截图', 'success')
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', 'error')
    }
  }, [dataUrl, mulby.dialog, mulby.filesystem, notify])

  const applyOpacity = useCallback(async (value: number) => {
    try {
      await window.mulby?.window?.setOpacity?.(value)
      setOpacity(value)
    } catch {
      /* 忽略透明度设置失败 */
    }
  }, [])

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault()
      if (!dataUrl) {
        return
      }
      void mulby.menu
        ?.showContextMenu?.([
          { label: '复制图片', id: 'copy' },
          { label: '保存图片', id: 'save' },
          { label: '', type: 'separator' },
          { label: '透明度 100%', id: 'opacity-100', type: 'radio', checked: opacity === 1 },
          { label: '透明度 80%', id: 'opacity-80', type: 'radio', checked: opacity === 0.8 },
          { label: '透明度 50%', id: 'opacity-50', type: 'radio', checked: opacity === 0.5 },
          { label: '', type: 'separator' },
          { label: '关闭', id: 'close' }
        ])
        .then((result) => {
          if (result === 'copy') void handleCopy()
          if (result === 'save') void handleSave()
          if (result === 'opacity-100') void applyOpacity(1)
          if (result === 'opacity-80') void applyOpacity(0.8)
          if (result === 'opacity-50') void applyOpacity(0.5)
          if (result === 'close') window.mulby?.window?.close?.()
        })
        .catch(() => {})
    },
    [applyOpacity, dataUrl, handleCopy, handleSave, mulby.menu, opacity]
  )

  const handleDoubleClick = useCallback(() => {
    window.mulby?.window?.close?.()
  }, [])

  return (
    <div className="pin-window-root">
      {!loading && dataUrl && (
        <div
          className="pin-window-container"
          onContextMenu={handleContextMenu}
          onDoubleClick={handleDoubleClick}
          {...floating.dragHandlers}
        >
          <img className="pin-window-image" src={dataUrl} alt="置顶截图" draggable={false} />
          <div className="pin-window-border" />
        </div>
      )}
      {!loading && !dataUrl && (
        <div className="pin-window-empty">没有可置顶的截图，请从截图标注窗口点击「钉图」。</div>
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
