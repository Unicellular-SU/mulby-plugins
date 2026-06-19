import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Bot,
  Check,
  ChevronLeft,
  Copy,
  CornerDownLeft,
  Download,
  History,
  Loader2,
  RefreshCw,
  Replace,
  Sparkles,
  Square,
  X
} from 'lucide-react'
import MdRenderer from './MdRenderer'
import {
  TRANSLATE_LANGUAGES,
  VISION_ACTIONS,
  buildVisionPrompt,
  filterImageEditModels,
  filterVisionModels,
  getVisionAction,
  runImageEdit,
  runVisionChat,
  uploadScreenshot,
  type AiModelLike,
  type VisionActionId,
  type VisionAiClient,
  type VisionRequestHandle
} from '../services/aiVision'

export interface AiPanelProps {
  /** 是否渲染（独立窗口里始终为 true，可省略）。 */
  open?: boolean
  ai: VisionAiClient | undefined
  notify: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  /** 返回当前要发送给 AI 的截图 dataURL；annotated=true 表示带标注。 */
  getImageDataUrl: (annotated: boolean) => string | null
  /** 复制文本到剪贴板。 */
  copyText: (text: string) => void | Promise<void>
  /** 把 AI 修图结果回填到画布（仅同窗口场景提供；独立窗口省略）。 */
  onApplyEditedImage?: (dataUrl: string) => void | Promise<void>
  /** 把 AI 修图结果替换到截图标注窗口（独立窗口跨窗口回传）。 */
  onReplaceScreenshot?: (dataUrl: string) => void | Promise<void>
  /** 复制图片到剪贴板（独立窗口场景提供）。 */
  copyImage?: (dataUrl: string) => void | Promise<void>
  /** 下载/保存图片到磁盘。 */
  saveImage: (dataUrl: string) => void | Promise<void>
  onClose: () => void
  textModel: string
  imageModel: string
  onTextModelChange: (id: string) => void
  onImageModelChange: (id: string) => void
  /** 报告内容自然高度（独立窗口据此自适应窗口高度）。 */
  onContentHeight?: (px: number) => void
  /** 标题区拖动事件（独立无边框窗口用于自绘拖动）。 */
  headerDragHandlers?: {
    onPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove?: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp?: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel?: (event: ReactPointerEvent<HTMLElement>) => void
  }
}

type PanelView = 'compose' | 'result'

export function AiPanel({
  open = true,
  ai,
  notify,
  getImageDataUrl,
  copyText,
  onApplyEditedImage,
  onReplaceScreenshot,
  copyImage,
  saveImage,
  onClose,
  textModel,
  imageModel,
  onTextModelChange,
  onImageModelChange,
  onContentHeight,
  headerDragHandlers
}: AiPanelProps) {
  const [view, setView] = useState<PanelView>('compose')
  const [action, setAction] = useState<VisionActionId>('explain')
  const [instruction, setInstruction] = useState('')
  const [language, setLanguage] = useState(TRANSLATE_LANGUAGES[0].value)
  const [annotated, setAnnotated] = useState(true)
  const [models, setModels] = useState<AiModelLike[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [running, setRunning] = useState(false)
  const [answer, setAnswer] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [resultImage, setResultImage] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const chatHandleRef = useRef<VisionRequestHandle | null>(null)
  const modelsFetchedRef = useRef(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  // 上报内容自然高度（供独立窗口自适应）。监听内容尺寸变化。
  useEffect(() => {
    const el = contentRef.current
    if (!el || !onContentHeight) {
      return
    }
    const report = () => onContentHeight(el.scrollHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onContentHeight, view])

  const meta = getVisionAction(action)
  const isEdit = Boolean(meta.isImageEdit)

  const visionModels = useMemo(() => filterVisionModels(models), [models])
  const imageModels = useMemo(() => filterImageEditModels(models), [models])
  const activeModels = isEdit ? imageModels : visionModels
  const activeModel = isEdit ? imageModel : textModel
  const hasResult = isEdit ? Boolean(resultImage) : Boolean(answer.trim())

  const fetchModels = useCallback(async () => {
    if (!ai?.allModels) {
      return
    }
    setLoadingModels(true)
    try {
      const list = await ai.allModels()
      setModels(Array.isArray(list) ? list : [])
    } catch (error) {
      notify(error instanceof Error ? error.message : '加载模型列表失败', 'error')
    } finally {
      setLoadingModels(false)
    }
  }, [ai, notify])

  // 面板首次打开时拉取一次模型列表。
  useEffect(() => {
    if (open && !modelsFetchedRef.current) {
      modelsFetchedRef.current = true
      void fetchModels()
    }
  }, [open, fetchModels])

  // 模型列表就绪后，若当前选择不在可用列表中，回退到第一个。
  useEffect(() => {
    if (visionModels.length > 0 && !visionModels.some((m) => m.id === textModel)) {
      onTextModelChange(visionModels[0].id)
    }
  }, [visionModels, textModel, onTextModelChange])
  useEffect(() => {
    if (imageModels.length > 0 && !imageModels.some((m) => m.id === imageModel)) {
      onImageModelChange(imageModels[0].id)
    }
  }, [imageModels, imageModel, onImageModelChange])

  const stop = useCallback(() => {
    chatHandleRef.current?.abort()
    chatHandleRef.current = null
    setRunning(false)
  }, [])

  // 关闭面板时中断进行中的请求。
  useEffect(() => {
    if (!open) {
      chatHandleRef.current?.abort()
      chatHandleRef.current = null
      setRunning(false)
    }
  }, [open])

  useEffect(() => () => {
    chatHandleRef.current?.abort()
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current)
    }
  }, [])

  const handleModelChange = useCallback(
    (id: string) => {
      if (isEdit) {
        onImageModelChange(id)
      } else {
        onTextModelChange(id)
      }
    },
    [isEdit, onImageModelChange, onTextModelChange]
  )

  // 切换动作时清掉上一次的结果，回到填写视图，避免结果与动作错位。
  const handleActionChange = useCallback((next: VisionActionId) => {
    setAction(next)
    setAnswer('')
    setReasoning('')
    setResultImage(null)
    setView('compose')
  }, [])

  const run = useCallback(async () => {
    if (running || !ai) {
      return
    }
    if (meta.needsInstruction && !instruction.trim()) {
      notify(isEdit ? '请先输入修图指令' : '请先输入你的问题', 'warning')
      return
    }
    const dataUrl = getImageDataUrl(annotated)
    if (!dataUrl) {
      notify('没有可用的截图', 'warning')
      return
    }
    if (activeModels.length === 0) {
      notify(isEdit ? '未检测到可用的生图模型，请先在「AI 设置」中添加' : '未检测到支持视觉的模型，请先在「AI 设置」中添加', 'warning')
      return
    }

    setRunning(true)
    setAnswer('')
    setReasoning('')
    setResultImage(null)
    setView('result')

    try {
      const { attachmentId, mimeType } = await uploadScreenshot(ai, dataUrl, isEdit ? 'image-edit' : 'vision')

      if (isEdit) {
        const image = await runImageEdit({
          ai,
          model: activeModel,
          attachmentId,
          prompt: instruction.trim()
        })
        setResultImage(image)
        notify('AI 修图完成', 'success')
      } else {
        const prompt = buildVisionPrompt({ action, language, instruction, annotated })
        const handle = runVisionChat({
          ai,
          model: activeModel,
          prompt,
          attachmentId,
          mimeType,
          onDelta: (text) => setAnswer((prev) => prev + text),
          onReasoning: (text) => setReasoning((prev) => prev + text)
        })
        chatHandleRef.current = handle
        const res = await handle.result
        if (!res.aborted && !res.text.trim()) {
          notify('模型没有返回内容，请重试', 'warning')
        }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : 'AI 处理失败', 'error')
    } finally {
      chatHandleRef.current = null
      setRunning(false)
    }
  }, [
    action,
    activeModel,
    activeModels.length,
    ai,
    annotated,
    getImageDataUrl,
    instruction,
    isEdit,
    language,
    meta.needsInstruction,
    notify,
    running
  ])

  const handleCopyAnswer = useCallback(async () => {
    if (!answer.trim()) {
      return
    }
    await copyText(answer)
    setCopied(true)
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 1600)
  }, [answer, copyText])

  if (!open) {
    return null
  }

  const hasModels = activeModels.length > 0
  const canRun = !running && hasModels && (!meta.needsInstruction || instruction.trim().length > 0)

  return (
    <aside className="ai-panel" aria-label="问 AI 面板">
      <header className="ai-panel-head" {...(headerDragHandlers ?? {})}>
        <span className="ai-panel-title">
          {view === 'result' ? (
            <button type="button" className="ai-panel-back" title="返回" onClick={() => setView('compose')}>
              <ChevronLeft size={18} />
            </button>
          ) : (
            <Bot size={16} />
          )}
          {view === 'result' ? meta.label : '问 AI'}
        </span>
        <div className="ai-panel-head-actions">
          {view === 'compose' && hasResult && (
            <button type="button" className="ai-head-btn" title="查看上次结果" onClick={() => setView('result')}>
              <History size={15} />
            </button>
          )}
          {view === 'result' && running && (
            <button type="button" className="ai-head-btn" title="停止" onClick={stop}>
              <Square size={15} />
            </button>
          )}
          {view === 'result' && !running && !isEdit && answer && (
            <>
              <button
                type="button"
                className="ai-head-btn"
                title={copied ? '已复制' : '复制回答'}
                onClick={() => void handleCopyAnswer()}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
              <button type="button" className="ai-head-btn" title="重新回答" onClick={() => void run()}>
                <RefreshCw size={15} />
              </button>
            </>
          )}
          {view === 'result' && !running && isEdit && resultImage && (
            <>
              {onReplaceScreenshot && (
                <button
                  type="button"
                  className="ai-head-btn ai-head-btn-accent"
                  title="替换截图（回到截图窗口继续标注）"
                  onClick={() => void onReplaceScreenshot(resultImage)}
                >
                  <Replace size={15} />
                </button>
              )}
              {onApplyEditedImage && (
                <button
                  type="button"
                  className="ai-head-btn"
                  title="应用到画布"
                  onClick={() => void onApplyEditedImage(resultImage)}
                >
                  <CornerDownLeft size={15} />
                </button>
              )}
              {copyImage && (
                <button type="button" className="ai-head-btn" title="复制图片" onClick={() => void copyImage(resultImage)}>
                  <Copy size={15} />
                </button>
              )}
              <button type="button" className="ai-head-btn" title="下载" onClick={() => void saveImage(resultImage)}>
                <Download size={15} />
              </button>
              <button type="button" className="ai-head-btn" title="重新生成" onClick={() => void run()}>
                <RefreshCw size={15} />
              </button>
            </>
          )}
          <button type="button" className="ai-panel-close" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>

      {view === 'compose' ? (
        <div className="ai-panel-body">
         <div className="ai-panel-measure" ref={contentRef}>
          <div className="ai-action-chips">
            {VISION_ACTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`ai-chip ${action === item.id ? 'is-active' : ''}`}
                onClick={() => handleActionChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <p className="ai-panel-hint">{meta.hint}</p>

          {meta.needsLanguage && (
            <label className="ai-panel-field">
              <span>目标语言</span>
              <select
                className="ai-panel-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {TRANSLATE_LANGUAGES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {meta.needsInstruction && (
            <textarea
              className="ai-panel-instruction"
              placeholder={isEdit ? '例如：把背景换成纯白、去掉水印、加上柔和光晕…' : '输入你想问的问题…'}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              rows={3}
            />
          )}

          <div className="ai-panel-options">
            <div className="ai-seg" role="group" aria-label="发送图片">
              <button
                type="button"
                className={`ai-seg-btn ${annotated ? 'is-active' : ''}`}
                onClick={() => setAnnotated(true)}
              >
                带标注
              </button>
              <button
                type="button"
                className={`ai-seg-btn ${!annotated ? 'is-active' : ''}`}
                onClick={() => setAnnotated(false)}
              >
                原图
              </button>
            </div>

            <select
              className="ai-panel-select ai-model-select"
              value={activeModel}
              onChange={(event) => handleModelChange(event.target.value)}
              disabled={loadingModels || !hasModels}
              title={hasModels ? '选择模型' : '无可用模型'}
            >
              {hasModels ? (
                activeModels.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || item.id}
                  </option>
                ))
              ) : (
                <option value="">{loadingModels ? '加载中…' : '无可用模型'}</option>
              )}
            </select>
          </div>

          {!hasModels && !loadingModels && (
            <p className="ai-panel-warn">
              {isEdit
                ? '未检测到生图模型，请在 Mulby「AI 设置」中添加 image-generation 模型。'
                : '未检测到支持视觉的模型，请在 Mulby「AI 设置」中添加多模态模型。'}
            </p>
          )}

          <div className="ai-panel-run">
            <button type="button" className="ai-run-btn" onClick={() => void run()} disabled={!canRun}>
              {isEdit ? <Sparkles size={14} /> : <Bot size={14} />}
              {isEdit ? '生成' : '发送给 AI'}
            </button>
          </div>
         </div>
        </div>
      ) : (
        <div className="ai-panel-body">
         <div className="ai-panel-measure ai-result-view" ref={contentRef}>
          {!isEdit ? (
            <>
              {reasoning && (
                <details className="ai-reasoning" open={running && !answer}>
                  <summary>思考过程</summary>
                  <div className="ai-reasoning-body md-content">
                    <MdRenderer content={reasoning} />
                  </div>
                </details>
              )}
              <div className="ai-answer md-content" aria-live="polite">
                {answer ? <MdRenderer content={answer} /> : running ? <span className="ai-muted">正在思考…</span> : null}
                {running && <span className="ai-caret" />}
              </div>
            </>
          ) : running ? (
            <div className="ai-image-loading">
              <Loader2 size={18} className="ai-spin" />
              <span>正在生成…</span>
            </div>
          ) : resultImage ? (
            <img className="ai-result-image" src={resultImage} alt="AI 修图结果" />
          ) : null}
         </div>
        </div>
      )}
    </aside>
  )
}

export default AiPanel
