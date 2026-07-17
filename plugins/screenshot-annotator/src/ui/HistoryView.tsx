import {
  Clipboard,
  ImageOff,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  X
} from 'lucide-react'
import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  clearHistory,
  deleteHistoryItem,
  listHistoryItems,
  readHistoryImageDataUrl,
  type HistoryApi,
  type ScreenshotHistoryItem
} from './history'
import { dataUrlToBase64, ensurePngPath } from './utils/image'

type HistoryViewProps = {
  mulby: HistoryApi & {
    clipboard: MulbyClipboard
    dialog: MulbyDialog
    notification: MulbyNotification
    window: MulbyWindow
    filesystem: HistoryApi['filesystem'] & MulbyFilesystem
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(timestamp))
}

function formatFullDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(new Date(timestamp))
}

function getDayKey(timestamp: number) {
  const date = new Date(timestamp)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatTimelineLabel(dayStart: number) {
  const today = startOfDay(Date.now())
  const yesterday = today - 24 * 60 * 60 * 1000

  if (dayStart === today) {
    return '今天'
  }

  if (dayStart === yesterday) {
    return '昨天'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(dayStart))
}

function formatTimelineMeta(dayStart: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    weekday: 'short'
  }).format(new Date(dayStart))
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB'
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function historyFileName(item: ScreenshotHistoryItem) {
  const date = new Date(item.createdAt)
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0')
  ].join('')

  return `screenshot-${stamp}.png`
}

export default function HistoryView({ mulby }: HistoryViewProps) {
  const toolbarDragStateRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    currentX: number
    currentY: number
    baseBounds: { x: number; y: number; width: number; height: number }
    rafId: number
  } | null>(null)

  const [items, setItems] = useState<ScreenshotHistoryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({})
  const [preview, setPreview] = useState<string | null>(null)
  const [activeDayKey, setActiveDayKey] = useState('all')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const timelineTicks = useMemo(() => {
    const dayMap = new Map<string, { key: string; label: string; meta: string; count: number; dayStart: number }>()

    items.forEach((item) => {
      const key = getDayKey(item.createdAt)
      const dayStart = startOfDay(item.createdAt)
      const current = dayMap.get(key)

      if (current) {
        current.count += 1
        return
      }

      dayMap.set(key, {
        key,
        label: formatTimelineLabel(dayStart),
        meta: formatTimelineMeta(dayStart),
        count: 1,
        dayStart
      })
    })

    return Array.from(dayMap.values()).sort((a, b) => b.dayStart - a.dayStart)
  }, [items])

  const filteredItems = useMemo(() => {
    if (activeDayKey === 'all') {
      return items
    }

    return items.filter((item) => getDayKey(item.createdAt) === activeDayKey)
  }, [activeDayKey, items])

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null,
    [filteredItems, selectedId]
  )

  useEffect(() => {
    if (activeDayKey !== 'all' && !timelineTicks.some((tick) => tick.key === activeDayKey)) {
      setActiveDayKey('all')
    }
  }, [activeDayKey, timelineTicks])

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedId(null)
      return
    }

    setSelectedId((current) => (
      current && filteredItems.some((item) => item.id === current)
        ? current
        : filteredItems[0].id
    ))
  }, [filteredItems])

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const nextItems = await listHistoryItems(mulby)
      setItems(nextItems)
      setSelectedId((current) => (
        current && nextItems.some((item) => item.id === current)
          ? current
          : nextItems[0]?.id ?? null
      ))

      const nextThumbnails: Record<string, string | null> = {}
      await Promise.all(nextItems.map(async (item) => {
        try {
          nextThumbnails[item.id] = await readHistoryImageDataUrl(mulby, item, 'thumbnail')
        } catch {
          nextThumbnails[item.id] = null
        }
      }))
      setThumbnails(nextThumbnails)
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : '读取历史失败'
      setError(message)
      mulby.notification.show(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [mulby])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const flushToolbarDrag = useCallback(() => {
    const state = toolbarDragStateRef.current
    if (!state) {
      return
    }

    state.rafId = 0
    void mulby.window.setBounds({
      x: state.baseBounds.x + state.currentX - state.startX,
      y: state.baseBounds.y + state.currentY - state.startY,
      width: state.baseBounds.width,
      height: state.baseBounds.height
    })
  }, [mulby.window])

  const shouldStartToolbarDrag = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) {
      return false
    }

    return !target.closest('button, input, textarea, select, a')
  }, [])

  const handleToolbarPointerDown = useCallback(
    async (event: ReactPointerEvent<HTMLElement>) => {
      if (busy || event.button !== 0 || !shouldStartToolbarDrag(event.target)) {
        return
      }

      event.preventDefault()
      const pointerTarget = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.screenX
      const startY = event.screenY
      const fallbackBounds = {
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight
      }
      const baseBounds = await mulby.window.getBounds().catch(() => fallbackBounds) ?? fallbackBounds

      toolbarDragStateRef.current = {
        pointerId,
        startX,
        startY,
        currentX: startX,
        currentY: startY,
        baseBounds,
        rafId: 0
      }

      pointerTarget.setPointerCapture(pointerId)
    },
    [busy, mulby.window, shouldStartToolbarDrag]
  )

  const handleToolbarPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = toolbarDragStateRef.current
      if (!state || state.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()
      state.currentX = event.screenX
      state.currentY = event.screenY

      if (!state.rafId) {
        state.rafId = requestAnimationFrame(flushToolbarDrag)
      }
    },
    [flushToolbarDrag]
  )

  const handleToolbarPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = toolbarDragStateRef.current
      if (!state || state.pointerId !== event.pointerId) {
        return
      }

      event.preventDefault()

      if (state.rafId) {
        cancelAnimationFrame(state.rafId)
        state.rafId = 0
      }

      void mulby.window.setBounds({
        x: state.baseBounds.x + state.currentX - state.startX,
        y: state.baseBounds.y + state.currentY - state.startY,
        width: state.baseBounds.width,
        height: state.baseBounds.height
      })

      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore stale pointer capture.
      }

      toolbarDragStateRef.current = null
    },
    [mulby.window]
  )

  useEffect(() => {
    return () => {
      if (toolbarDragStateRef.current?.rafId) {
        cancelAnimationFrame(toolbarDragStateRef.current.rafId)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedItem) {
      setPreview(null)
      return
    }

    let alive = true
    setPreview(null)
    setError(null)

    void (async () => {
      try {
        const dataUrl = await readHistoryImageDataUrl(mulby, selectedItem, 'final')
        if (alive) {
          setPreview(dataUrl)
        }
      } catch {
        if (alive) {
          setError('历史图片文件缺失')
        }
      }
    })()

    return () => {
      alive = false
    }
  }, [mulby, selectedItem])

  const runAction = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label)
    setError(null)

    try {
      await action()
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : `${label}失败`
      setError(message)
      mulby.notification.show(message, 'error')
    } finally {
      setBusy(null)
    }
  }, [mulby.notification])

  const copySelected = useCallback(async () => {
    if (!selectedItem) {
      return
    }

    await runAction('正在复制', async () => {
      await mulby.clipboard.writeImage(await readHistoryImageDataUrl(mulby, selectedItem, 'final'))
      mulby.notification.show('已复制历史截图', 'success')
    })
  }, [mulby, runAction, selectedItem])

  const saveSelected = useCallback(async () => {
    if (!selectedItem) {
      return
    }

    const pickedPath = await mulby.dialog.showSaveDialog({
      title: '保存历史截图',
      defaultPath: historyFileName(selectedItem),
      buttonLabel: '保存',
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })

    if (!pickedPath) {
      return
    }

    await runAction('正在保存', async () => {
      const dataUrl = await readHistoryImageDataUrl(mulby, selectedItem, 'final')
      await mulby.filesystem.writeFile(ensurePngPath(pickedPath), dataUrlToBase64(dataUrl), 'base64')
      mulby.notification.show('已保存历史截图', 'success')
    })
  }, [mulby, runAction, selectedItem])

  const deleteSelected = useCallback(async () => {
    if (!selectedItem) {
      return
    }

    await runAction('正在删除', async () => {
      await deleteHistoryItem(mulby, selectedItem.id)
      await loadItems()
      mulby.notification.show('已删除历史截图', 'success')
    })
  }, [loadItems, mulby, runAction, selectedItem])

  const clearAll = useCallback(async () => {
    if (!items.length) {
      return
    }

    const result = await mulby.dialog.showMessageBox({
      type: 'warning',
      title: '清空截图历史',
      message: '清空所有截图历史？',
      detail: '这会删除历史索引和已保存的历史图片文件。',
      buttons: ['清空', '取消'],
      defaultId: 1,
      cancelId: 1
    })

    if (result.response !== 0) {
      return
    }

    await runAction('正在清空', async () => {
      await clearHistory(mulby)
      setItems([])
      setSelectedId(null)
      setThumbnails({})
      setPreview(null)
      mulby.notification.show('已清空截图历史', 'success')
    })
  }, [items.length, mulby, runAction])

  const editSelected = useCallback(async () => {
    if (!selectedItem) {
      return
    }

    const displayWidth = selectedItem.displaySize?.width || selectedItem.width || 984
    const displayHeight = selectedItem.displaySize?.height || selectedItem.height || 540

    await runAction('正在打开', async () => {
      await mulby.window.create(
        `/index.html?mode=annotate&historyItemId=${encodeURIComponent(selectedItem.id)}`,
        {
          width: Math.max(1080, Math.min(4096, Math.round(displayWidth))),
          height: Math.max(120, Math.min(4096, Math.round(displayHeight + 96))),
          minWidth: 1080,
          minHeight: 120,
          maxWidth: 4096,
          maxHeight: 4096,
          title: '截图标注',
          type: 'borderless',
          titleBar: false,
          transparent: true,
          alwaysOnTop: true,
          resizable: true
        }
      )
    })
  }, [mulby.window, runAction, selectedItem])

  return (
    <div className="history-root">
      <header
        className="history-toolbar-window"
        onPointerDown={(event) => void handleToolbarPointerDown(event)}
        onPointerMove={handleToolbarPointerMove}
        onPointerUp={handleToolbarPointerUp}
        onPointerCancel={handleToolbarPointerUp}
      >
        <div className="history-title">
          <strong>截图历史</strong>
          <span>{filteredItems.length} / {items.length}</span>
        </div>

        <button className="history-icon-button" type="button" title="刷新" onClick={() => void loadItems()} disabled={loading || Boolean(busy)}>
          <RefreshCw size={17} />
        </button>
        <button className="history-icon-button danger" type="button" title="清空" onClick={() => void clearAll()} disabled={!items.length || Boolean(busy)}>
          <Trash2 size={17} />
        </button>
        <button className="history-icon-button" type="button" title="关闭" onClick={() => mulby.window.close()}>
          <X size={17} />
        </button>
      </header>

      <main className="history-layout">
        <aside className="history-timeline" aria-label="时间刻度">
          <button
            className={`history-timeline-tick ${activeDayKey === 'all' ? 'is-active' : ''}`}
            type="button"
            onClick={() => setActiveDayKey('all')}
          >
            <span className="history-timeline-marker" />
            <span className="history-timeline-content">
              <strong>全部</strong>
              <span>{items.length} 张</span>
            </span>
          </button>

          {timelineTicks.map((tick) => (
            <button
              key={tick.key}
              className={`history-timeline-tick ${activeDayKey === tick.key ? 'is-active' : ''}`}
              type="button"
              onClick={() => setActiveDayKey(tick.key)}
            >
              <span className="history-timeline-marker" />
              <span className="history-timeline-content">
                <strong>{tick.label}</strong>
                <span>{tick.count} 张 · {tick.meta}</span>
              </span>
            </button>
          ))}
        </aside>

        <aside className="history-list" aria-label="截图历史列表">
          {filteredItems.map((item) => {
            const thumbnail = thumbnails[item.id]
            const isSelected = selectedItem?.id === item.id

            return (
              <button
                key={item.id}
                className={`history-list-item ${isSelected ? 'is-selected' : ''}`}
                type="button"
                onClick={() => setSelectedId(item.id)}
              >
                <span className="history-thumb">
                  {thumbnail ? (
                    <img src={thumbnail} alt="" draggable={false} />
                  ) : (
                    <ImageOff size={22} />
                  )}
                </span>
                <span className="history-list-meta">
                  <strong>{formatDate(item.createdAt)}</strong>
                  <span>{item.width} x {item.height}</span>
                  <span>{item.annotations.length} 个对象 · {formatBytes(item.fileSize)}</span>
                </span>
              </button>
            )
          })}

          {!filteredItems.length && (
            <div className="history-empty">
              {loading ? '正在载入' : '暂无历史截图'}
            </div>
          )}
        </aside>

        <section className="history-preview-panel">
          {selectedItem ? (
            <>
              <div className="history-preview-header">
                <div>
                  <strong>{formatFullDate(selectedItem.createdAt)}</strong>
                  <span>{selectedItem.width} x {selectedItem.height} · {formatBytes(selectedItem.fileSize)}</span>
                </div>
                <div className="history-actions">
                  <button type="button" onClick={() => void editSelected()} disabled={Boolean(busy)}>
                    <Pencil size={16} />
                    再编辑
                  </button>
                  <button type="button" onClick={() => void copySelected()} disabled={Boolean(busy)}>
                    <Clipboard size={16} />
                    复制
                  </button>
                  <button type="button" onClick={() => void saveSelected()} disabled={Boolean(busy)}>
                    <Save size={16} />
                    保存
                  </button>
                  <button className="danger" type="button" onClick={() => void deleteSelected()} disabled={Boolean(busy)}>
                    <Trash2 size={16} />
                    删除
                  </button>
                </div>
              </div>

              <div className="history-preview-stage">
                {preview ? (
                  <img src={preview} alt="截图预览" draggable={false} />
                ) : (
                  <div className="history-preview-placeholder">
                    <ImageOff size={30} />
                    <span>{error ?? busy ?? '正在载入预览'}</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="history-preview-placeholder is-empty">
              <ImageOff size={34} />
              <span>{error ?? '暂无历史截图'}</span>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
