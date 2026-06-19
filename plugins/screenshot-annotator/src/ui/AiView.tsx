import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMulby } from './hooks/useMulby'
import { RESIZE_EDGES, useFloatingWindow } from './hooks/useFloatingWindow'
import AiPanel from './components/AiPanel'
import type { VisionAiClient } from './services/aiVision'

const PLUGIN_ID = 'screenshot-annotator'
const HEADER_HEIGHT = 46
const MIN_WINDOW_HEIGHT = 220

interface HandoffSnapshot {
  annotated?: string
  original?: string
}

function readQueryParam(name: string): string | null {
  const fromSearch = new URLSearchParams(window.location.search).get(name)
  if (fromSearch) return fromSearch
  const hashQuery = window.location.hash.indexOf('?')
  if (hashQuery >= 0) {
    return new URLSearchParams(window.location.hash.slice(hashQuery + 1)).get(name)
  }
  return null
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(',', 2)[1] ?? ''
}

function defaultFileName(): string {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('')
  return `ai-image-${stamp}.png`
}

function ensurePngPath(path: string): string {
  return path.toLowerCase().endsWith('.png') ? path : `${path}.png`
}

/**
 * 独立「问 AI」浮窗：无边框、置顶、可拖动、可缩放，高度随内容自适应。
 * 通过 ai-handoff-{id} 存储键拿到截图标注窗口打开时快照的两张图（带标注 / 原图）。
 */
export default function AiView() {
  const mulby = useMulby(PLUGIN_ID)
  const ai = (window.mulby?.ai as unknown as VisionAiClient) ?? undefined
  const win = window.mulby?.window as unknown as Parameters<typeof useFloatingWindow>[0] | undefined

  const [snapshot, setSnapshot] = useState<HandoffSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [textModel, setTextModel] = useState('')
  const [imageModel, setImageModel] = useState('')

  const autoHeightRef = useRef(true)
  const heightRafRef = useRef(0)
  const contentHeightRef = useRef(0)

  // 用户一旦手动缩放，就停止自适应高度。
  const handleManualResize = useCallback(() => {
    autoHeightRef.current = false
  }, [])

  const floating = useFloatingWindow(win, handleManualResize)

  // 深色窗口背景 + 置顶。
  useEffect(() => {
    document.documentElement.classList.remove('transparent', 'history-window')
    document.documentElement.classList.add('ai-window')
    window.mulby?.window?.setAlwaysOnTop?.(true)
    return () => {
      document.documentElement.classList.remove('ai-window')
    }
  }, [])

  // 根据内容高度自适应窗口高度（仅在用户未手动缩放时）。
  const applyAutoHeight = useCallback(() => {
    heightRafRef.current = 0
    if (!autoHeightRef.current || !win?.getBounds || !win?.setBounds) return
    const maxHeight = Math.round((window.screen.availHeight || 900) * 0.85)
    const headEl = document.querySelector('.ai-panel-head') as HTMLElement | null
    const panelEl = document.querySelector('.ai-panel') as HTMLElement | null
    const headerH = headEl?.offsetHeight ?? HEADER_HEIGHT
    // 目标内容区高度 = 标题栏 + 内容自然高度
    const targetUsable = headerH + contentHeightRef.current
    void win
      .getBounds()
      .then((bounds) => {
        if (!bounds) return
        // 当前内容区高度用面板容器 .ai-panel 的 clientHeight（已排除宿主标题区等占位），
        // 相对增量加到外层 bounds 高度上，迭代收敛到「内容区正好等于目标」。
        const currentUsable = panelEl?.clientHeight ?? window.innerHeight
        const delta = targetUsable - currentUsable
        const next = Math.max(MIN_WINDOW_HEIGHT, Math.min(bounds.height + delta, maxHeight))
        if (Math.abs(delta) <= 2) return
        if (Math.abs(next - bounds.height) <= 2) return
        void win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: next })
      })
      .catch(() => {})
  }, [win])

  const handleContentHeight = useCallback(
    (height: number) => {
      contentHeightRef.current = height
      if (!heightRafRef.current) {
        heightRafRef.current = requestAnimationFrame(applyAutoHeight)
      }
    },
    [applyAutoHeight]
  )

  // 载入交接快照 + 持久化的模型选择。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const handoffId = readQueryParam('aiHandoff')
      try {
        const [handoff, text, image] = await Promise.all([
          handoffId ? mulby.storage.get(`ai-handoff-${handoffId}`) : Promise.resolve(null),
          mulby.storage.get('ai-text-model'),
          mulby.storage.get('ai-image-model')
        ])
        if (cancelled) return
        if (handoff && typeof handoff === 'object') {
          setSnapshot(handoff as HandoffSnapshot)
        }
        if (typeof text === 'string') setTextModel(text)
        if (typeof image === 'string') setImageModel(image)
        if (handoffId) {
          void mulby.storage.remove(`ai-handoff-${handoffId}`)
        }
      } catch {
        /* 忽略：下方会提示无截图 */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mulby.storage])

  const getImageDataUrl = useCallback(
    (annotated: boolean) => {
      if (!snapshot) return null
      return (annotated ? snapshot.annotated : snapshot.original) ?? snapshot.annotated ?? snapshot.original ?? null
    },
    [snapshot]
  )

  const notify = useCallback(
    (message: string, type?: 'info' | 'success' | 'warning' | 'error') => {
      mulby.notification?.show?.(message, type ?? 'info')
    },
    [mulby.notification]
  )

  const copyText = useCallback(
    async (text: string) => {
      try {
        await mulby.clipboard.writeText(text)
        notify('已复制到剪贴板', 'success')
      } catch (error) {
        notify(error instanceof Error ? error.message : '复制失败', 'error')
      }
    },
    [mulby.clipboard, notify]
  )

  const copyImage = useCallback(
    async (dataUrl: string) => {
      try {
        await mulby.clipboard.writeImage(dataUrl)
        notify('图片已复制到剪贴板', 'success')
      } catch (error) {
        notify(error instanceof Error ? error.message : '复制图片失败', 'error')
      }
    },
    [mulby.clipboard, notify]
  )

  const saveImage = useCallback(
    async (dataUrl: string) => {
      try {
        const pickedPath = (await mulby.dialog.showSaveDialog({
          title: '保存 AI 图片',
          defaultPath: defaultFileName(),
          buttonLabel: '保存',
          filters: [{ name: 'PNG Image', extensions: ['png'] }]
        })) as string | undefined
        if (!pickedPath) return
        await mulby.filesystem.writeFile(ensurePngPath(pickedPath), dataUrlToBase64(dataUrl), 'base64')
        notify('已保存图片', 'success')
      } catch (error) {
        notify(error instanceof Error ? error.message : '保存失败', 'error')
      }
    },
    [mulby.dialog, mulby.filesystem, notify]
  )

  const handleTextModelChange = useCallback(
    (id: string) => {
      setTextModel(id)
      void mulby.storage.set('ai-text-model', id)
    },
    [mulby.storage]
  )

  const handleImageModelChange = useCallback(
    (id: string) => {
      setImageModel(id)
      void mulby.storage.set('ai-image-model', id)
    },
    [mulby.storage]
  )

  const hasImage = useMemo(() => Boolean(snapshot?.annotated || snapshot?.original), [snapshot])

  return (
    <div className="ai-window-root">
      {loading ? (
        <div className="ai-window-empty">正在载入截图…</div>
      ) : !hasImage ? (
        <div className="ai-window-empty">没有可用的截图，请从截图标注窗口点击「问 AI」打开。</div>
      ) : (
        <AiPanel
          ai={ai}
          notify={notify}
          getImageDataUrl={getImageDataUrl}
          copyText={copyText}
          copyImage={copyImage}
          saveImage={saveImage}
          onClose={() => window.mulby?.window?.close?.()}
          textModel={textModel}
          imageModel={imageModel}
          onTextModelChange={handleTextModelChange}
          onImageModelChange={handleImageModelChange}
          onContentHeight={handleContentHeight}
          headerDragHandlers={floating.dragHandlers}
        />
      )}

      <div className="ai-resize-layer" aria-hidden="true">
        {RESIZE_EDGES.map((edge) => (
          <div key={edge} className={`ai-resize-handle ai-resize-${edge}`} {...floating.getResizeHandlers(edge)} />
        ))}
      </div>
    </div>
  )
}
