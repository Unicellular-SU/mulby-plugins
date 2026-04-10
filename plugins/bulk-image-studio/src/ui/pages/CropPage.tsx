import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Area } from 'react-easy-crop'
import Cropper from 'react-easy-crop'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Copy,
  FolderOpen,
  Grid3x3,
  ImageIcon,
  Keyboard,
  Loader2,
  Plus,
  RotateCcw,
  Scissors,
  SkipForward,
  Trash2,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useMulby } from '../hooks/useMulby'
import { loadLastDirs, saveLastDirs } from '../lib/plugin-storage'

const PLUGIN_ID = 'bulk-image-studio'

const ZOOM_MIN = 1
const ZOOM_MAX = 5
const KEYBOARD_NUDGE = 3

const ASPECT_PRESETS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: '自由', ratio: null },
  { id: '1:1', label: '1∶1', ratio: 1 },
  { id: '4:3', label: '4∶3', ratio: 4 / 3 },
  { id: '3:4', label: '3∶4', ratio: 3 / 4 },
  { id: '16:9', label: '16∶9', ratio: 16 / 9 },
  { id: '9:16', label: '9∶16', ratio: 9 / 16 },
  { id: '3:2', label: '3∶2', ratio: 3 / 2 },
  { id: '2:3', label: '2∶3', ratio: 2 / 3 },
  { id: '21:9', label: '21∶9', ratio: 21 / 9 },
]

function baseName(p: string): string {
  const s = p.replace(/\\/g, '/')
  return s.split('/').pop() || ''
}

function joinOut(outDir: string, filePath: string): string {
  const name = baseName(filePath)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : '.png'
  const sep = outDir.includes('\\') ? '\\' : '/'
  const d = outDir.replace(/[/\\]+$/, '')
  return `${d}${sep}${stem}_crop${ext}`
}

function mimeForPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() || 'png'
  const m: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    avif: 'image/avif',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  }
  return m[ext] || 'image/png'
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return !!t.closest('input, textarea, select, [contenteditable="true"]')
}

interface Props {
  seedPaths: string[]
}

export default function CropPage({ seedPaths }: Props) {
  const { dialog, notification, host, filesystem, storage } = useMulby(PLUGIN_ID)
  const [files, setFiles] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [outDir, setOutDir] = useState('')
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [lastPct, setLastPct] = useState<Area | null>(null)
  const pctRef = useRef<Area | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [presetId, setPresetId] = useState<string>('free')
  const [aspectCustomW, setAspectCustomW] = useState(16)
  const [aspectCustomH, setAspectCustomH] = useState(9)
  const [showGrid, setShowGrid] = useState(true)
  const [reuseRelative, setReuseRelative] = useState(false)
  const [relativeTemplate, setRelativeTemplate] = useState<Area | null>(null)
  const [cropMountId, setCropMountId] = useState(0)
  const [containerAspect, setContainerAspect] = useState(4 / 3)
  const [exported, setExported] = useState<Record<string, true>>({})
  const [busy, setBusy] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const filesRef = useRef(files)
  filesRef.current = files
  const applyRef = useRef<() => Promise<void>>(async () => {})
  const skipRef = useRef<() => void>(() => {})
  const goPrevRef = useRef<() => void>(() => {})
  const goNextRef = useRef<() => void>(() => {})
  const setZoomRef = useRef(setZoom)
  setZoomRef.current = setZoom

  goPrevRef.current = () => setIdx((i) => Math.max(0, i - 1))
  goNextRef.current = () =>
    setIdx((i) => {
      const n = filesRef.current.length
      return n <= 0 ? 0 : Math.min(n - 1, i + 1)
    })

  const current = files[idx]
  const exportedCount = useMemo(() => files.filter((p) => exported[p]).length, [files, exported])

  const aspectNumber = useMemo(() => {
    if (presetId === 'free') return containerAspect
    if (presetId === 'custom') {
      const w = Math.max(1, aspectCustomW)
      const h = Math.max(1, aspectCustomH)
      return w / h
    }
    const p = ASPECT_PRESETS.find((x) => x.id === presetId)
    return p?.ratio ?? containerAspect
  }, [presetId, containerAspect, aspectCustomW, aspectCustomH])

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      if (r.width > 8 && r.height > 8) setContainerAspect(r.width / r.height)
    })
    ro.observe(el)
    const r = el.getBoundingClientRect()
    if (r.width > 8 && r.height > 8) setContainerAspect(r.width / r.height)
    return () => ro.disconnect()
  }, [imgSrc])

  const loadImage = useCallback(
    async (p: string) => {
      setImgSrc(null)
      setArea(null)
      setLastPct(null)
      pctRef.current = null
      setNaturalSize(null)
      setZoom(1)
      setCrop({ x: 0, y: 0 })
      setImageLoading(true)
      try {
        const b64 = await filesystem.readFile(p, 'base64')
        if (typeof b64 !== 'string') {
          notification.show('无法读取图片预览', 'error')
          return
        }
        setImgSrc(`data:${mimeForPath(p)};base64,${b64}`)
        setCropMountId((n) => n + 1)
      } catch (e) {
        notification.show(e instanceof Error ? e.message : '读取失败', 'error')
      } finally {
        setImageLoading(false)
      }
    },
    [filesystem, notification]
  )

  useEffect(() => {
    if (seedPaths.length) setFiles((f) => [...new Set([...f, ...seedPaths])])
  }, [seedPaths])

  useEffect(() => {
    void (async () => {
      const dirs = await loadLastDirs(storage)
      if (dirs.cropOutDir) setOutDir(dirs.cropOutDir)
    })()
  }, [storage])

  useEffect(() => {
    if (current) void loadImage(current)
    else {
      setImgSrc(null)
      setImageLoading(false)
    }
  }, [current, loadImage])

  useEffect(() => {
    if (files.length && idx >= files.length) setIdx(Math.max(0, files.length - 1))
  }, [files.length, idx])

  const addFiles = async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif'] }],
    })
    if (picked?.length) {
      setFiles((f) => [...new Set([...f, ...picked])])
      setIdx(0)
    }
  }

  const pickOutDir = async () => {
    const picked = await dialog.showOpenDialog({
      title: '裁剪输出目录',
      properties: ['openDirectory'],
      defaultPath: outDir || undefined,
    })
    if (picked?.[0]) setOutDir(picked[0])
  }

  const removeFile = (p: string) => {
    setFiles((prev) => {
      const i = prev.indexOf(p)
      if (i < 0) return prev
      const next = prev.filter((x) => x !== p)
      setIdx((cur) => {
        if (next.length === 0) return 0
        if (i < cur) return cur - 1
        if (i === cur) return Math.min(i, next.length - 1)
        return cur
      })
      return next
    })
    setExported((ex) => {
      const { [p]: _, ...rest } = ex
      return rest
    })
  }

  const moveFile = (index: number, dir: -1 | 1) => {
    setFiles((list) => {
      const j = index + dir
      if (j < 0 || j >= list.length) return list
      const next = [...list]
      const t = next[index]
      next[index] = next[j]
      next[j] = t
      return next
    })
    setIdx((cur) => {
      if (cur === index) return index + dir
      if (cur === index + dir) return index
      return cur
    })
  }

  const goPrev = () => setIdx((i) => Math.max(0, i - 1))
  const goNext = () =>
    setIdx((i) => (files.length <= 0 ? 0 : Math.min(files.length - 1, i + 1)))

  const resetView = () => {
    setZoom(1)
    setCrop({ x: 0, y: 0 })
    setCropMountId((n) => n + 1)
  }

  const captureTemplateFromView = () => {
    const p = pctRef.current ?? lastPct
    if (!p) {
      notification.show('请先拖动图片，让选区稳定后再捕获', 'warning')
      return
    }
    setRelativeTemplate(p)
    notification.show('已保存相对选区模板（宽高与位置 %）', 'success')
  }

  const applyAndNext = useCallback(async () => {
    if (!current || !area) {
      notification.show('请等待图片加载并调整选区', 'warning')
      return
    }
    if (!outDir) {
      notification.show('请选择输出目录', 'warning')
      return
    }
    const outPath = joinOut(outDir, current)
    const pct = pctRef.current ?? lastPct
    setBusy(true)
    try {
      await host.call('manualCropApply', {
        filePath: current,
        rect: {
          left: Math.round(area.x),
          top: Math.round(area.y),
          width: Math.round(area.width),
          height: Math.round(area.height),
        },
        outPath,
      })
      if (reuseRelative && pct) setRelativeTemplate(pct)
      setExported((ex) => ({ ...ex, [current]: true }))
      void saveLastDirs(storage, { cropOutDir: outDir })
      notification.show(`已保存：${baseName(outPath)}`, 'success')
      if (idx < files.length - 1) setIdx((i) => i + 1)
      else notification.show('已是队列中最后一张', 'success')
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '裁剪失败', 'error')
    } finally {
      setBusy(false)
    }
  }, [area, current, files.length, host, idx, lastPct, notification, outDir, reuseRelative, storage])

  const skip = useCallback(() => {
    if (idx < files.length - 1) setIdx((i) => i + 1)
    else notification.show('已是队列中最后一张', 'success')
  }, [files.length, idx, notification])

  applyRef.current = applyAndNext
  skipRef.current = skip

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      if (e.key === 'Enter') {
        e.preventDefault()
        void applyRef.current()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        skipRef.current()
        return
      }
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        goPrevRef.current()
        return
      }
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        goNextRef.current()
        return
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault()
          setZoomRef.current((z) => Math.min(ZOOM_MAX, Math.round((z + 0.1) * 100) / 100))
          return
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault()
          setZoomRef.current((z) => Math.max(ZOOM_MIN, Math.round((z - 0.1) * 100) / 100))
          return
        }
        if (e.key === '0') {
          e.preventDefault()
          setZoomRef.current(1)
          setCrop({ x: 0, y: 0 })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onCropAreaChange = useCallback((pct: Area, px: Area) => {
    pctRef.current = pct
    setLastPct(pct)
    setArea(px)
  }, [])

  const nextPendingIndex = useMemo(() => {
    const i = files.findIndex((p) => !exported[p])
    return i >= 0 ? i : -1
  }, [files, exported])

  const jumpToNextPending = () => {
    if (nextPendingIndex >= 0) setIdx(nextPendingIndex)
    else notification.show('队列中均已标记导出', 'success')
  }

  const outPreview = current && outDir ? joinOut(outDir, current) : ''

  const initialPct =
    reuseRelative && relativeTemplate && imgSrc ? relativeTemplate : undefined

  return (
    <div className="page batch-page-v2 crop-page-v2">
      <div className="batch-triple">
        <aside className="batch-col batch-col-left batch-aside crop-aside-queue">
          <div className="batch-aside-head">
            <h2>
              <ImageIcon size={16} />
              队列
            </h2>
            <span className="batch-badge">{files.length}</span>
          </div>
          <div className="crop-queue-stats">
            <span className="crop-stat-pill">
              已导出 <strong>{exportedCount}</strong> / {files.length}
            </span>
            {files.length > 0 && (
              <button type="button" className="btn ghost sm crop-jump-pending" onClick={jumpToNextPending}>
                跳到未导出
              </button>
            )}
          </div>
          <p className="hint merge-queue-hint">
            第 {files.length ? idx + 1 : 0} / {files.length} 张。点击切换；箭头调序。
          </p>
          <div className="batch-aside-actions">
            <button type="button" className="btn secondary sm" onClick={addFiles}>
              <Plus size={14} />
              添加
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setFiles([])} disabled={!files.length}>
              <Trash2 size={14} />
              清空
            </button>
          </div>
          <div className="batch-file-scroll">
            {files.length === 0 ? (
              <p className="batch-empty-files">拖入或添加图片后开始裁剪。</p>
            ) : (
              <ul className="batch-file-list merge-file-list">
                {files.map((p, i) => (
                  <li key={p} className="merge-file-li">
                    <button type="button" className={`merge-file-row${i === idx ? ' active' : ''}`} onClick={() => setIdx(i)}>
                      <span className="merge-file-index">
                        {exported[p] ? <CircleCheck size={14} className="crop-done-icon" aria-hidden /> : i + 1}
                      </span>
                      <span className="batch-file-name merge-file-name" title={p}>
                        {baseName(p)}
                      </span>
                    </button>
                    <div className="merge-file-row-tools">
                      <button
                        type="button"
                        className="btn icon-only"
                        aria-label="上移"
                        disabled={i === 0}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveFile(i, -1)
                        }}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn icon-only"
                        aria-label="下移"
                        disabled={i === files.length - 1}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveFile(i, 1)
                        }}
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn icon-only danger"
                        aria-label="移除"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFile(p)
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="batch-col batch-col-center crop-center-col">
          <div className="crop-workspace-head">
            <div className="crop-center-head">
              <h2>
                <Scissors size={16} />
                裁剪工作区
              </h2>
              <div className="crop-workspace-nav">
                <button type="button" className="btn icon-only sm" aria-label="上一张" disabled={idx <= 0} onClick={goPrev}>
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  className="btn icon-only sm"
                  aria-label="下一张"
                  disabled={idx >= files.length - 1}
                  onClick={goNext}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
            <p className="hint crop-file-meta">
              {current ? (
                <>
                  <span className="crop-file-meta-name" title={current}>
                    {baseName(current)}
                  </span>
                  {naturalSize && (
                    <span className="crop-file-meta-dim">
                      原图 {naturalSize.w}×{naturalSize.h}px
                    </span>
                  )}
                  {area && (
                    <span className="crop-file-meta-dim">
                      选区 {Math.round(area.width)}×{Math.round(area.height)}px
                    </span>
                  )}
                </>
              ) : (
                '添加图片后在此调整选区'
              )}
            </p>
          </div>

          <div className="crop-toolbar">
            <div className="crop-preset-row" role="group" aria-label="裁剪比例">
              {ASPECT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`crop-preset-chip${presetId === p.id ? ' active' : ''}`}
                  onClick={() => setPresetId(p.id)}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={`crop-preset-chip${presetId === 'custom' ? ' active' : ''}`}
                onClick={() => setPresetId('custom')}
              >
                自定义
              </button>
            </div>
            {presetId === 'custom' && (
              <div className="crop-custom-aspect grid2">
                <div className="field">
                  <label htmlFor="crop-aspect-w">宽</label>
                  <input
                    id="crop-aspect-w"
                    className="input"
                    type="number"
                    min={1}
                    value={aspectCustomW}
                    onChange={(e) => setAspectCustomW(+e.target.value || 1)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="crop-aspect-h">高</label>
                  <input
                    id="crop-aspect-h"
                    className="input"
                    type="number"
                    min={1}
                    value={aspectCustomH}
                    onChange={(e) => setAspectCustomH(+e.target.value || 1)}
                  />
                </div>
              </div>
            )}
            <div className="crop-toolbar-actions">
              <button
                type="button"
                className={`btn secondary sm${showGrid ? '' : ' ghost'}`}
                onClick={() => setShowGrid((g) => !g)}
                aria-pressed={showGrid}
              >
                <Grid3x3 size={14} />
                网格
              </button>
              <button type="button" className="btn secondary sm" onClick={resetView} disabled={!imgSrc}>
                <RotateCcw size={14} />
                重置视图
              </button>
              <div className="crop-zoom-inline">
                <button type="button" className="btn icon-only sm" aria-label="缩小" disabled={!imgSrc || zoom <= ZOOM_MIN} onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - 0.15))}>
                  <ZoomOut size={16} />
                </button>
                <span className="crop-zoom-label">{zoom.toFixed(2)}×</span>
                <button type="button" className="btn icon-only sm" aria-label="放大" disabled={!imgSrc || zoom >= ZOOM_MAX} onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + 0.15))}>
                  <ZoomIn size={16} />
                </button>
              </div>
            </div>
          </div>

          <div className="crop-center-body">
            {imageLoading && (
              <div className="crop-center-loading">
                <Loader2 size={28} className="merge-preview-spinner" />
                <span>加载中…</span>
              </div>
            )}
            {!imageLoading && imgSrc && (
              <div ref={wrapRef} className="crop-wrap crop-wrap--focus">
                <Cropper
                  key={`${current}-${cropMountId}`}
                  image={imgSrc}
                  crop={crop}
                  zoom={zoom}
                  rotation={0}
                  aspect={aspectNumber}
                  minZoom={ZOOM_MIN}
                  maxZoom={ZOOM_MAX}
                  restrictPosition
                  showGrid={showGrid}
                  zoomWithScroll
                  zoomSpeed={0.65}
                  keyboardStep={KEYBOARD_NUDGE}
                  roundCropAreaPixels
                  objectFit="contain"
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropAreaChange={onCropAreaChange}
                  onCropComplete={onCropAreaChange}
                  initialCroppedAreaPercentages={initialPct}
                  onMediaLoaded={(ms) => setNaturalSize({ w: ms.naturalWidth, h: ms.naturalHeight })}
                  style={{
                    cropAreaStyle: {
                      border: '2px solid rgba(59, 130, 246, 0.95)',
                      boxShadow: '0 0 0 9999em rgba(0,0,0,0.52)',
                    },
                  }}
                  cropperProps={{
                    'aria-label': '裁剪：拖动图片；滚轮缩放；方向键微调（Shift 更细）',
                  }}
                />
              </div>
            )}
            {!imageLoading && !imgSrc && <div className="empty-crop">{current ? '无法显示该图' : '请添加图片'}</div>}
          </div>

          <p className="hint crop-shortcuts-hint">
            <Keyboard size={14} aria-hidden />
            Enter 应用并下一张 · Esc 跳过 · Alt+←/→ 切换图 · Ctrl± 缩放 · Ctrl+0 复位 · 在选框上按方向键平移选区（Shift 精细）
          </p>
        </section>

        <aside className="batch-col batch-col-right batch-toolbox crop-toolbox" aria-label="裁剪选项">
          <div className="batch-toolbox-head">
            <h2>
              <Wrench size={14} />
              输出与批量
            </h2>
          </div>
          <p className="hint batch-toolbox-hint">与常见批量裁剪工具类似：可锁定比例、滚轮缩放、沿用同一相对选区处理一组照片。</p>

          <div className="batch-toolbox-scroll">
            <div className="merge-toolbox-fields crop-toolbox-fields-top">
              <div className="field">
                <label htmlFor="crop-out-dir">输出目录</label>
                <div className="crop-out-dir-row">
                  <input id="crop-out-dir" className="input crop-out-dir-input" readOnly value={outDir} placeholder="必选" />
                  <button type="button" className="btn secondary sm crop-out-dir-btn" onClick={pickOutDir} aria-label="选择目录">
                    <FolderOpen size={16} />
                  </button>
                </div>
              </div>

              {outPreview && (
                <p className="hint crop-out-preview" title={outPreview}>
                  将保存为 <code className="crop-out-code">{baseName(outPreview)}</code>
                </p>
              )}

              <label className="check-row merge-check">
                <input type="checkbox" checked={reuseRelative} onChange={(e) => setReuseRelative(e.target.checked)} />
                每次导出后，用本次相对选区打开下一张（适合同构图批量裁）
              </label>

              <div className="crop-template-actions">
                <button type="button" className="btn secondary sm" disabled={!imgSrc} onClick={captureTemplateFromView}>
                  <Copy size={14} />
                  从当前视图捕获模板
                </button>
                {relativeTemplate && (
                  <button type="button" className="btn ghost sm" onClick={() => setRelativeTemplate(null)}>
                    清除模板
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="batch-toolbox-foot">
            <button type="button" className="btn primary batch-run-btn" disabled={busy || !files.length} onClick={() => void applyAndNext()}>
              <Check size={18} />
              {busy ? '处理中…' : '应用并下一张'}
            </button>
            <button type="button" className="btn secondary batch-run-btn crop-skip-btn" disabled={!files.length} onClick={skip}>
              <SkipForward size={16} />
              跳过
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
