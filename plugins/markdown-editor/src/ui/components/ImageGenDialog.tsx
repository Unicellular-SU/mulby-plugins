import { useCallback, useEffect, useRef, useState } from 'react'
import { CornerDownLeft, History, ImagePlus, Loader2, RefreshCw, Sparkles, Square, X } from 'lucide-react'
import {
  DEFAULT_IMAGE_SIZE,
  IMAGE_SIZES,
  filterImageModels,
  runImageGeneration,
  toImageDataUrl,
  type ImageAiClient,
  type ImageGenHandle,
  type ImageModelInfo
} from '../services/imageGen'

/** A history entry shaped for display (URL already resolved by the host). */
export interface ImageHistoryView {
  id: string
  prompt: string
  size: string
  url: string
  createdAt: number
}

interface ImageGenDialogProps {
  open: boolean
  ai: ImageAiClient
  /** Prompt to pre-fill (e.g. the current editor selection). */
  initialPrompt: string
  /** Persisted image model id; '' means "not chosen yet". */
  model: string
  /** This document's previously generated images (newest first). */
  history: ImageHistoryView[]
  onModelChange: (model: string) => void
  /** Records a freshly generated image (raw base64) so it persists in history. */
  onGenerated: (base64: string, prompt: string, size: string) => void | Promise<void>
  /** Inserts a freshly generated image (raw base64) into the document. */
  onInsert: (base64: string, prompt: string) => void | Promise<void>
  /** Inserts a previously generated image (by history id) into the document. */
  onInsertHistory: (id: string) => void | Promise<void>
  onNotify: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  onClose: () => void
}

export function ImageGenDialog({
  open,
  ai,
  initialPrompt,
  model,
  history,
  onModelChange,
  onGenerated,
  onInsert,
  onInsertHistory,
  onNotify,
  onClose
}: ImageGenDialogProps) {
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(DEFAULT_IMAGE_SIZE)
  const [models, setModels] = useState<ImageModelInfo[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [running, setRunning] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [previewImage, setPreviewImage] = useState('')
  const [resultImages, setResultImages] = useState<string[]>([])
  // A history entry the user picked to view/insert (takes display precedence
  // over a fresh result until the next generation).
  const [pickedHistory, setPickedHistory] = useState<ImageHistoryView | null>(null)
  const handleRef = useRef<ImageGenHandle | null>(null)
  const modelsFetchedRef = useRef(false)
  const wasOpenRef = useRef(false)

  const fetchModels = useCallback(async () => {
    if (!ai.allModels) {
      return
    }
    setLoadingModels(true)
    try {
      const list = await ai.allModels()
      const imageModels = filterImageModels(Array.isArray(list) ? list : [])
      setModels(imageModels)
      if (imageModels.length > 0) {
        const exists = model && imageModels.some((item) => item.id === model)
        if (!exists) {
          const first = imageModels[0].id
          if (first) {
            onModelChange(first)
          }
        }
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '加载生图模型失败', 'error')
    } finally {
      setLoadingModels(false)
    }
  }, [ai, model, onModelChange, onNotify])

  // Initialize prompt + reset the live output each time the dialog opens. The
  // history strip is fed by props, so prior generations stay visible.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      wasOpenRef.current = true
      setPrompt(initialPrompt)
      setPreviewImage('')
      setResultImages([])
      setPickedHistory(null)
      setStatusMsg('')
      if (!modelsFetchedRef.current) {
        modelsFetchedRef.current = true
        void fetchModels()
      }
    } else if (!open && wasOpenRef.current) {
      wasOpenRef.current = false
      handleRef.current?.abort()
      handleRef.current = null
      setRunning(false)
    }
  }, [open, initialPrompt, fetchModels])

  const stop = useCallback(() => {
    handleRef.current?.abort()
    handleRef.current = null
    setRunning(false)
    setStatusMsg('')
  }, [])

  const handleGenerate = useCallback(async () => {
    if (running) {
      return
    }
    const trimmed = prompt.trim()
    if (!trimmed) {
      onNotify('请先输入或选择生图提示词', 'warning')
      return
    }
    if (!model) {
      onNotify('请先选择生图模型', 'warning')
      return
    }

    setRunning(true)
    setPreviewImage('')
    setResultImages([])
    setPickedHistory(null)
    setStatusMsg('正在生成…')

    const handle = runImageGeneration({
      ai,
      model,
      prompt: trimmed,
      size,
      onPreview: (image) => setPreviewImage(image),
      onStatus: (chunk) => {
        if (chunk.message) {
          setStatusMsg(chunk.message)
        }
      }
    })
    handleRef.current = handle

    try {
      const res = await handle.result
      if (!res.aborted) {
        if (res.images.length > 0) {
          setResultImages(res.images)
          setPreviewImage('')
          // Persist so the image survives even if it is never inserted.
          void onGenerated(res.images[0], trimmed, size)
        } else {
          onNotify('没有生成图片，请重试', 'warning')
        }
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '生图失败', 'error')
    } finally {
      if (handleRef.current === handle) {
        handleRef.current = null
      }
      setRunning(false)
      setStatusMsg('')
    }
  }, [ai, model, onGenerated, onNotify, prompt, running, size])

  const handleInsert = useCallback(() => {
    if (pickedHistory) {
      void onInsertHistory(pickedHistory.id)
      return
    }
    if (resultImages[0]) {
      void onInsert(resultImages[0], prompt.trim())
    }
  }, [onInsert, onInsertHistory, pickedHistory, prompt, resultImages])

  if (!open) {
    return null
  }

  const hasModels = models.length > 0
  const trimmedPrompt = prompt.trim()
  const canGenerate = !running && hasModels && trimmedPrompt.length > 0
  const hasFreshResult = resultImages.length > 0 && !running
  // Display precedence: live preview while running, else a picked history image,
  // else the latest fresh result.
  const displaySrc = running
    ? toImageDataUrl(previewImage || resultImages[0] || '')
    : pickedHistory
      ? pickedHistory.url
      : resultImages[0]
        ? toImageDataUrl(resultImages[0])
        : ''
  const canInsert = !running && (!!pickedHistory || hasFreshResult)

  return (
    <div className="confirm-overlay" role="presentation" onClick={onClose}>
      <div
        className="confirm-dialog ai-dialog image-gen-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-gen-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-header ai-dialog-header">
          <h2 id="image-gen-title" className="confirm-dialog-title ai-dialog-title">
            <ImagePlus size={16} />
            AI 生图
          </h2>
          <button
            type="button"
            className="ai-close-btn"
            aria-label="关闭"
            title="关闭"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <textarea
          className="ai-instruction image-gen-prompt"
          placeholder="描述你想要的图片，例如：一只戴着宇航头盔的橘猫，赛博朋克风格，高细节"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
        />

        <div className="ai-controls-row">
          <label className="ai-field ai-field-model">
            <span className="ai-field-label">模型</span>
            <select
              className="ai-select"
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={loadingModels || !hasModels}
            >
              {hasModels ? (
                models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || item.id}
                  </option>
                ))
              ) : (
                <option value="">{loadingModels ? '加载中…' : '无可用生图模型'}</option>
              )}
            </select>
          </label>
          <label className="ai-field">
            <span className="ai-field-label">尺寸</span>
            <select
              className="ai-select"
              value={size}
              onChange={(event) => setSize(event.target.value)}
            >
              {IMAGE_SIZES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!hasModels && !loadingModels && (
          <p className="ai-action-hint">
            <span className="ai-hint-warn">
              未检测到生图模型，请先在 Mulby 的「AI 设置」中添加 image-generation 模型。
            </span>
          </p>
        )}

        <div className="image-gen-preview" aria-live="polite">
          {displaySrc ? (
            <div className="image-gen-stage">
              <img className="image-gen-img" src={displaySrc} alt="生成结果预览" />
              {running && (
                <div className="image-gen-overlay">
                  <Loader2 size={16} className="ai-spin" />
                  <span>{statusMsg || '生成中…'}</span>
                </div>
              )}
            </div>
          ) : running ? (
            <div className="image-gen-empty">
              <Loader2 size={18} className="ai-spin" />
              <span>{statusMsg || '正在生成…'}</span>
            </div>
          ) : (
            <span className="image-gen-placeholder">输入提示词后点击「生成图片」</span>
          )}
        </div>

        {history.length > 0 && (
          <div className="image-gen-history">
            <div className="image-gen-history-head">
              <History size={13} />
              <span>本文档生图历史（{history.length}）</span>
            </div>
            <div className="image-gen-history-strip">
              {history.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`image-gen-thumb ${pickedHistory?.id === item.id ? 'is-active' : ''}`}
                  title={item.prompt || '历史图片'}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setPickedHistory(item)}
                  onDoubleClick={() => void onInsertHistory(item.id)}
                >
                  <img src={item.url} alt={item.prompt || '历史图片'} loading="lazy" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ai-dialog-actions">
          <div className="ai-actions-left">
            {running ? (
              <button
                type="button"
                className="action-btn ai-stop-btn"
                onMouseDown={(event) => event.preventDefault()}
                onClick={stop}
              >
                <Square size={14} /> 停止
              </button>
            ) : (
              <button
                type="button"
                className="action-btn ai-run-btn"
                disabled={!canGenerate}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleGenerate()}
              >
                {hasFreshResult ? <RefreshCw size={14} /> : <Sparkles size={14} />}
                {hasFreshResult ? '重新生成' : '生成图片'}
              </button>
            )}
          </div>
          <div className="ai-actions-right">
            <button
              type="button"
              className="action-btn ai-apply-btn"
              disabled={!canInsert}
              title={canInsert ? '把图片插入文档' : '生成或选择历史图片后可插入'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleInsert}
            >
              <CornerDownLeft size={14} /> 插入文档
            </button>
          </div>
        </div>

        {(loadingModels || running) && (
          <div className="ai-status-line">
            <Loader2 size={12} className="ai-spin" />
            {loadingModels ? '正在加载生图模型…' : statusMsg || '生成中，可随时停止'}
          </div>
        )}
      </div>
    </div>
  )
}
