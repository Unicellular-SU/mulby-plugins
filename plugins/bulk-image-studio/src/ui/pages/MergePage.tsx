import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronDown,
  ChevronUp,
  FileOutput,
  FileText,
  Film,
  ImageIcon,
  Layers,
  Loader2,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import MergeStripCropEditor from '../MergeStripCropEditor'
import { buildMergeCompositePreview } from '../merge-preview'
import { useMulby } from '../hooks/useMulby'
import type { MergeStripCropRatios } from '../../pipeline/types'
import { DEFAULT_MERGE_STRIP_CROP } from '../../pipeline/types'
import { loadLastDirs, saveLastDirs } from '../lib/plugin-storage'

const PLUGIN_ID = 'bulk-image-studio'

function pathJoinDirFile(dir: string, fileName: string): string {
  const d = dir.replace(/[/\\]+$/, '')
  const sep = d.includes('\\') ? '\\' : '/'
  return `${d}${sep}${fileName}`
}

function parentDirectory(filePath: string): string {
  const m = filePath.match(/^(.+)[/\\][^/\\]+$/)
  return m ? m[1] : ''
}

/** 仅裁剪变化时防抖更新上方合成预览，避免拖动时 loading/清空造成布局闪烁 */
const STRIP_PREVIEW_DEBOUNCE_MS = 140

type MergeMode = 'pdf' | 'strip-h' | 'strip-v' | 'gif'

function baseName(p: string): string {
  const s = p.replace(/\\/g, '/')
  return s.split('/').pop() || ''
}

const MODE_OPTIONS: { mode: MergeMode; label: string; hint?: string; Icon: LucideIcon }[] = [
  { mode: 'pdf', label: '合并为 PDF', Icon: FileText },
  { mode: 'strip-v', label: '纵向长图', Icon: RectangleVertical },
  { mode: 'strip-h', label: '横向长图', Icon: RectangleHorizontal },
  { mode: 'gif', label: '合成 GIF', Icon: Film },
]

interface Props {
  seedPaths: string[]
}

export default function MergePage({ seedPaths }: Props) {
  const { dialog, notification, host, filesystem, storage } = useMulby(PLUGIN_ID)
  const [files, setFiles] = useState<string[]>([])
  const [previewStatic, setPreviewStatic] = useState<string | null>(null)
  const [gifFrames, setGifFrames] = useState<string[]>([])
  const [gifFrameIx, setGifFrameIx] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [mode, setMode] = useState<MergeMode>('pdf')
  const [spacing, setSpacing] = useState(0)
  const [stripBg, setStripBg] = useState('#ffffff')
  const [gifDelay, setGifDelay] = useState(120)
  const [gifLoop, setGifLoop] = useState(true)
  const [gifMax, setGifMax] = useState(720)
  const [gifPaletteReduce, setGifPaletteReduce] = useState(false)
  const [pdfPageLayout, setPdfPageLayout] = useState<'perImage' | 'a4'>('perImage')
  const [pdfMarginPts, setPdfMarginPts] = useState(36)
  const [stripMaxMp, setStripMaxMp] = useState(200)
  const [busy, setBusy] = useState(false)
  const [stripCropByPath, setStripCropByPath] = useState<Record<string, MergeStripCropRatios>>({})
  const [cropEditIndex, setCropEditIndex] = useState(0)
  const [editorSrc, setEditorSrc] = useState<string | null>(null)
  const [editorLoading, setEditorLoading] = useState(false)
  const mergePreviewNonCropKeyRef = useRef<string>('')
  const mergeSaveDirRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    setFiles([...new Set(seedPaths)])
  }, [seedPaths])

  useEffect(() => {
    void (async () => {
      const dirs = await loadLastDirs(storage)
      let d = dirs.mergeSaveDir?.trim()
      if (d && /\.(pdf|gif|png|jpe?g|webp)$/i.test(d)) d = parentDirectory(d) || d
      if (d) mergeSaveDirRef.current = d
    })()
  }, [storage])

  useEffect(() => {
    setStripCropByPath((prev) => {
      const next: Record<string, MergeStripCropRatios> = {}
      for (const p of files) {
        next[p] = prev[p] ?? { ...DEFAULT_MERGE_STRIP_CROP }
      }
      return next
    })
  }, [files])

  useEffect(() => {
    if (cropEditIndex >= files.length) setCropEditIndex(Math.max(0, files.length - 1))
  }, [files.length, cropEditIndex])

  const stripCropList = useMemo(
    () => files.map((p) => stripCropByPath[p] ?? DEFAULT_MERGE_STRIP_CROP),
    [files, stripCropByPath]
  )

  const editPath = files[cropEditIndex]

  useEffect(() => {
    if (!editPath) {
      setEditorSrc(null)
      setEditorLoading(false)
      return
    }
    let cancelled = false
    setEditorLoading(true)
    setEditorSrc(null)
    void (async () => {
      try {
        const b64 = await filesystem.readFile(editPath, 'base64')
        if (cancelled) return
        if (typeof b64 !== 'string') {
          setEditorLoading(false)
          return
        }
        const ext = editPath.split('.').pop()?.toLowerCase() || 'png'
        const mime =
          {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            webp: 'image/webp',
            gif: 'image/gif',
            bmp: 'image/bmp',
            avif: 'image/avif',
            tif: 'image/tiff',
            tiff: 'image/tiff',
          }[ext] || 'image/png'
        setEditorSrc(`data:${mime};base64,${b64}`)
      } catch {
        if (!cancelled) setEditorSrc(null)
      } finally {
        if (!cancelled) setEditorLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editPath, filesystem])

  useEffect(() => {
    if (files.length === 0) {
      setPreviewStatic(null)
      setGifFrames([])
      setPreviewLoading(false)
      mergePreviewNonCropKeyRef.current = ''
      return
    }

    const nonCropKey = `${files.join('\0')}\0${mode}\0${spacing}\0${stripBg}\0${gifMax}`
    const isStrip = mode === 'strip-h' || mode === 'strip-v'
    const prevKey = mergePreviewNonCropKeyRef.current
    const cropOnlyRefresh =
      isStrip && prevKey !== '' && prevKey === nonCropKey
    mergePreviewNonCropKeyRef.current = nonCropKey

    let cancelled = false
    let debounceId: number | undefined

    const runBuild = (silent: boolean) => {
      void (async () => {
        try {
          if (!silent) {
            setPreviewLoading(true)
            setPreviewStatic(null)
            setGifFrames([])
          }
          const stripCrops = isStrip ? stripCropList : undefined
          const r = await buildMergeCompositePreview(
            files,
            (p) => filesystem.readFile(p, 'base64'),
            mode,
            spacing,
            stripBg,
            gifMax,
            stripCrops
          )
          if (cancelled) return
          if (r.kind === 'static') setPreviewStatic(r.dataUrl)
          else setGifFrames(r.frames)
        } catch (e) {
          if (!cancelled) {
            notification.show(e instanceof Error ? e.message : '合成预览生成失败', 'error')
          }
        } finally {
          if (!cancelled) setPreviewLoading(false)
        }
      })()
    }

    if (cropOnlyRefresh) {
      debounceId = window.setTimeout(() => runBuild(true), STRIP_PREVIEW_DEBOUNCE_MS)
    } else {
      runBuild(false)
    }

    return () => {
      cancelled = true
      if (debounceId !== undefined) window.clearTimeout(debounceId)
    }
  }, [files, mode, spacing, stripBg, gifMax, filesystem, notification, stripCropList])

  useEffect(() => {
    if (mode !== 'gif' || gifFrames.length === 0) {
      setGifFrameIx(0)
      return
    }
    setGifFrameIx(0)
    const t = Math.max(50, gifDelay)
    const id = window.setInterval(() => {
      setGifFrameIx((prev) => {
        if (gifLoop) return (prev + 1) % gifFrames.length
        if (prev >= gifFrames.length - 1) return prev
        return prev + 1
      })
    }, t)
    return () => clearInterval(id)
  }, [mode, gifFrames, gifDelay, gifLoop])

  const addFiles = async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff', 'tif', 'avif'] }],
    })
    if (picked?.length) setFiles((f) => [...new Set([...f, ...picked])])
  }

  const removeFile = (p: string) => {
    setFiles((f) => f.filter((x) => x !== p))
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
  }

  const runMerge = async () => {
    if (files.length < 2) {
      notification.show('请至少选择两张图片', 'warning')
      return
    }
    let fileName = 'merged'
    let filters: { name: string; extensions: string[] }[] = []
    if (mode === 'pdf') {
      fileName += '.pdf'
      filters = [{ name: 'PDF', extensions: ['pdf'] }]
    } else if (mode === 'gif') {
      fileName += '.gif'
      filters = [{ name: 'GIF', extensions: ['gif'] }]
    } else {
      fileName += '.png'
      filters = [
        { name: 'PNG', extensions: ['png'] },
        { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
        { name: 'WebP', extensions: ['webp'] },
      ]
    }
    const hint = mergeSaveDirRef.current
    const defaultPath = hint ? pathJoinDirFile(hint, fileName) : fileName
    const outPath = await dialog.showSaveDialog({
      title: '保存合并结果',
      defaultPath,
      filters,
    })
    if (!outPath) return

    setBusy(true)
    try {
      if (mode === 'pdf') {
        await host.call('mergePdf', {
          files,
          outPath,
          pageLayout: pdfPageLayout,
          ...(pdfPageLayout === 'a4' ? { marginPts: pdfMarginPts } : {}),
        })
      } else if (mode === 'strip-h') {
        await host.call('mergeStrip', {
          files,
          outPath,
          direction: 'horizontal',
          spacing,
          background: stripBg,
          stripCropRatios: stripCropList,
          maxOutputMegapixels: stripMaxMp,
        })
      } else if (mode === 'strip-v') {
        await host.call('mergeStrip', {
          files,
          outPath,
          direction: 'vertical',
          spacing,
          background: stripBg,
          stripCropRatios: stripCropList,
          maxOutputMegapixels: stripMaxMp,
        })
      } else {
        await host.call('mergeGif', {
          files,
          outPath,
          frameDelayMs: gifDelay,
          loop: gifLoop,
          maxSide: gifMax,
          paletteReduce: gifPaletteReduce,
        })
      }
      const dir = parentDirectory(outPath)
      if (dir) {
        mergeSaveDirRef.current = dir
        void saveLastDirs(storage, { mergeSaveDir: dir })
      }
      notification.show('合并完成', 'success')
    } catch (e) {
      notification.show(e instanceof Error ? e.message : '合并失败', 'error')
    } finally {
      setBusy(false)
    }
  }

  const previewHint = (() => {
    if (files.length === 0) return '添加图片后，将按当前合并方式显示合成示意'
    if (mode === 'pdf') return '按页顺序纵向叠放示意（实际 PDF 为多页文档）'
    if (mode === 'strip-h') return '横向拼接示意（四边矩形裁剪、间距与背景）；点左侧条目切换编辑'
    if (mode === 'strip-v') return '纵向拼接示意（四边矩形裁剪、间距与背景）；点左侧条目切换编辑'
    return `GIF 轮播示意 · 帧间隔 ${gifDelay} ms${gifLoop ? ' · 循环' : ''}`
  })()

  const showGif = mode === 'gif' && gifFrames.length > 0 && !previewLoading
  const showStatic = !previewLoading && previewStatic && !showGif
  const stripMode = mode === 'strip-h' || mode === 'strip-v'
  const editRatios = editPath ? stripCropByPath[editPath] ?? DEFAULT_MERGE_STRIP_CROP : DEFAULT_MERGE_STRIP_CROP

  const setEditRatios = useCallback(
    (r: MergeStripCropRatios) => {
      if (!editPath) return
      setStripCropByPath((prev) => ({ ...prev, [editPath]: r }))
    },
    [editPath]
  )

  return (
    <div className="page batch-page-v2 merge-page-v2">
      <div className="batch-triple">
        <aside className="batch-col batch-col-left batch-aside">
          <div className="batch-aside-head">
            <h2>
              <ImageIcon size={16} />
              合并顺序
            </h2>
            <span className="batch-badge">{files.length}</span>
          </div>
          <p className="hint merge-queue-hint">
            自上而下为合并顺序。{stripMode ? '点条目后在中间拖四边或四角裁剪。' : ''}可用箭头调整顺序。
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
              <p className="batch-empty-files">尚未添加图片。合并至少需要 2 张。</p>
            ) : (
              <ul className="batch-file-list merge-file-list">
                {files.map((p, index) => (
                  <li key={p} className="merge-file-li">
                    <button
                      type="button"
                      className={`merge-file-row${stripMode && cropEditIndex === index ? ' active' : ''}`}
                      onClick={() => setCropEditIndex(index)}
                    >
                      <span className="merge-file-index">{index + 1}</span>
                      <span className="batch-file-name merge-file-name" title={p}>
                        {baseName(p)}
                      </span>
                    </button>
                    <div className="merge-file-row-tools">
                      <button
                        type="button"
                        className="btn icon-only"
                        aria-label="上移"
                        disabled={index === 0}
                        onClick={() => moveFile(index, -1)}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn icon-only"
                        aria-label="下移"
                        disabled={index === files.length - 1}
                        onClick={() => moveFile(index, 1)}
                      >
                        <ChevronDown size={14} />
                      </button>
                      <button type="button" className="btn icon-only danger" aria-label="移除此项" onClick={() => removeFile(p)}>
                        <X size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="batch-col batch-col-center merge-preview-col merge-preview-col-split">
          <div className="merge-preview-head">
            <h2>
              <Layers size={16} />
              合成预览
            </h2>
            <p className="hint merge-preview-sub">{previewHint}</p>
          </div>
          {stripMode && files.length > 0 ? (
            <>
              <div className="merge-strip-preview-panel">
                {previewLoading && (
                  <div className="merge-preview-loading merge-preview-loading-compact" aria-busy>
                    <Loader2 size={22} className="merge-preview-spinner" />
                    <span>更新预览…</span>
                  </div>
                )}
                {showGif && (
                  <div className="merge-preview-gif-wrap">
                    <img src={gifFrames[gifFrameIx]} alt="" className="merge-preview-gif-img" draggable={false} />
                    <span className="merge-preview-gif-badge">
                      第 {gifFrameIx + 1} / {gifFrames.length} 帧
                    </span>
                  </div>
                )}
                {showStatic && (
                  <img src={previewStatic!} alt="" className="merge-preview-composite-img merge-strip-total-preview" draggable={false} />
                )}
                {!previewLoading && !showGif && !showStatic && (
                  <div className="merge-preview-placeholder merge-preview-placeholder-compact">
                    <p>无法生成预览</p>
                  </div>
                )}
              </div>
              <div className="merge-strip-editor-panel">
                <MergeStripCropEditor
                  dataUrl={editorSrc}
                  loading={editorLoading}
                  direction={mode === 'strip-v' ? 'vertical' : 'horizontal'}
                  ratios={editRatios}
                  onChange={setEditRatios}
                  fileLabel={`第 ${cropEditIndex + 1} 张 · ${editPath ? baseName(editPath) : ''}`}
                />
              </div>
            </>
          ) : (
            <div className="merge-preview-body">
              {previewLoading && (
                <div className="merge-preview-loading" aria-busy>
                  <Loader2 size={28} className="merge-preview-spinner" />
                  <span>正在生成合成预览…</span>
                </div>
              )}
              {showGif && (
                <div className="merge-preview-gif-wrap">
                  <img src={gifFrames[gifFrameIx]} alt="" className="merge-preview-gif-img" draggable={false} />
                  <span className="merge-preview-gif-badge">
                    第 {gifFrameIx + 1} / {gifFrames.length} 帧
                  </span>
                </div>
              )}
              {showStatic && <img src={previewStatic!} alt="" className="merge-preview-composite-img" draggable={false} />}
              {!previewLoading && !showGif && !showStatic && files.length > 0 && (
                <div className="merge-preview-placeholder">
                  <Layers size={40} strokeWidth={1.25} className="merge-preview-placeholder-icon" />
                  <p>无法生成预览</p>
                </div>
              )}
              {!previewLoading && files.length === 0 && (
                <div className="merge-preview-placeholder">
                  <Layers size={40} strokeWidth={1.25} className="merge-preview-placeholder-icon" />
                  <p>添加图片后即可查看合成示意</p>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="batch-col batch-col-right batch-toolbox merge-toolbox" aria-label="合并工具箱">
          <div className="batch-toolbox-head">
            <h2>
              <Wrench size={14} />
              工具箱
            </h2>
          </div>
          <p className="hint batch-toolbox-hint">选择输出方式，按需填写参数后合并。</p>

          <div className="batch-toolbox-scroll">
            <div className="batch-add-bar">
              <span className="batch-add-label" id="merge-mode-label">
                合并方式
              </span>
              <div className="batch-add-grid batch-add-grid-toolbox" role="group" aria-labelledby="merge-mode-label">
                {MODE_OPTIONS.map(({ mode: m, label, hint, Icon }) => (
                  <button
                    key={m}
                    type="button"
                    className={`batch-add-tile batch-add-tile--toolbox-row${mode === m ? ' selected' : ''}`}
                    title={hint ? `${label}（${hint}）` : label}
                    onClick={() => setMode(m)}
                  >
                    <span className="batch-add-tile-icon" aria-hidden>
                      <Icon size={16} strokeWidth={1.65} />
                    </span>
                    <span className="batch-add-tile-text">
                      <span className="batch-add-tile-label">{label}</span>
                      {hint ? <span className="batch-add-tile-hint">{hint}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {mode === 'pdf' && (
              <div className="merge-toolbox-fields">
                <div className="field">
                  <label htmlFor="merge-pdf-layout">页面版式</label>
                  <select
                    id="merge-pdf-layout"
                    className="input"
                    value={pdfPageLayout}
                    onChange={(e) => setPdfPageLayout(e.target.value as 'perImage' | 'a4')}
                  >
                    <option value="perImage">每页随图尺寸</option>
                    <option value="a4">A4 内接居中</option>
                  </select>
                </div>
                {pdfPageLayout === 'a4' ? (
                  <div className="field">
                    <label htmlFor="merge-pdf-margin">四边留白（pt）</label>
                    <input
                      id="merge-pdf-margin"
                      className="input"
                      type="number"
                      min={0}
                      value={pdfMarginPts}
                      onChange={(e) => setPdfMarginPts(+e.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            )}

            {(mode === 'strip-h' || mode === 'strip-v') && (
              <div className="merge-toolbox-fields">
                <div className="field">
                  <label htmlFor="merge-spacing">间距 px</label>
                  <input
                    id="merge-spacing"
                    className="input"
                    type="number"
                    min={0}
                    value={spacing}
                    onChange={(e) => setSpacing(+e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="merge-strip-bg">背景色</label>
                  <input id="merge-strip-bg" className="input" value={stripBg} onChange={(e) => setStripBg(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="merge-strip-max-mp">输出像素上限（百万像素）</label>
                  <input
                    id="merge-strip-max-mp"
                    className="input"
                    type="number"
                    min={1}
                    max={2000}
                    value={stripMaxMp}
                    onChange={(e) => setStripMaxMp(+e.target.value)}
                  />
                </div>
              </div>
            )}

            {mode === 'gif' && (
              <div className="merge-toolbox-fields">
                <div className="field">
                  <label htmlFor="merge-gif-delay">帧间隔 ms</label>
                  <input
                    id="merge-gif-delay"
                    className="input"
                    type="number"
                    min={20}
                    value={gifDelay}
                    onChange={(e) => setGifDelay(+e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="merge-gif-max">最长边上限 px</label>
                  <input
                    id="merge-gif-max"
                    className="input"
                    type="number"
                    min={64}
                    value={gifMax}
                    onChange={(e) => setGifMax(+e.target.value)}
                  />
                </div>
                <label className="check-row merge-check">
                  <input type="checkbox" checked={gifLoop} onChange={(e) => setGifLoop(e.target.checked)} />
                  循环播放
                </label>
                <label className="check-row merge-check">
                  <input type="checkbox" checked={gifPaletteReduce} onChange={(e) => setGifPaletteReduce(e.target.checked)} />
                  GIF 减色（实验，调色板 PNG）
                </label>
              </div>
            )}
          </div>

          <div className="batch-toolbox-foot">
            <button type="button" className="btn primary batch-run-btn" disabled={busy || files.length < 2} onClick={runMerge}>
              <FileOutput size={18} />
              {busy ? '处理中…' : '选择保存位置并合并'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
