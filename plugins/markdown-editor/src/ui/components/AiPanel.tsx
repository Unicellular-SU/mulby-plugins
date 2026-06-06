import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, CornerDownLeft, Loader2, Replace, Sparkles, Square, X } from 'lucide-react'
import {
  AI_ACTIONS,
  TRANSLATE_LANGUAGES,
  buildPrompt,
  getAiAction,
  runAiAction,
  stripCodeFence,
  type AiActionId,
  type AiClient,
  type AiRequestHandle
} from '../services/ai'

export interface AiModelOption {
  id: string
  label: string
}

interface AiPanelProps {
  open: boolean
  ai: AiClient
  /** Currently selected text in the editor (may be empty). */
  selection: string
  /** Whole document markdown, used as fallback / context. */
  documentText: string
  /** Persisted model id; '' means "host default". */
  model: string
  onModelChange: (model: string) => void
  /** Replace the current editor selection with text (undoable in App). */
  onReplaceSelection: (text: string) => void
  /** Insert text after the current selection / cursor (undoable in App). */
  onInsert: (text: string) => void
  onCopy: (text: string) => void
  onNotify: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void
  onClose: () => void
}

const MODEL_DEFAULT_VALUE = ''

export function AiPanel({
  open,
  ai,
  selection,
  documentText,
  model,
  onModelChange,
  onReplaceSelection,
  onInsert,
  onCopy,
  onNotify,
  onClose
}: AiPanelProps) {
  const [action, setAction] = useState<AiActionId>('polish')
  const [language, setLanguage] = useState<string>(TRANSLATE_LANGUAGES[1].value)
  const [instruction, setInstruction] = useState('')
  const [models, setModels] = useState<AiModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const handleRef = useRef<AiRequestHandle | null>(null)
  const modelsFetchedRef = useRef(false)
  const outputRef = useRef<HTMLDivElement>(null)

  const meta = getAiAction(action)
  const hasSelection = selection.trim().length > 0
  const primaryText = hasSelection ? selection : documentText

  const fetchModels = useCallback(async () => {
    if (!ai.allModels) {
      return
    }
    setLoadingModels(true)
    try {
      const list = await ai.allModels()
      const normalized = Array.isArray(list)
        ? list
            .filter((item) => item?.id)
            .map((item) => ({ id: item.id as string, label: item.label || (item.id as string) }))
        : []
      setModels(normalized)
    } catch (error) {
      onNotify(error instanceof Error ? error.message : '加载模型失败', 'error')
    } finally {
      setLoadingModels(false)
    }
  }, [ai, onNotify])

  useEffect(() => {
    if (open && !modelsFetchedRef.current) {
      modelsFetchedRef.current = true
      void fetchModels()
    }
  }, [fetchModels, open])

  useEffect(() => {
    if (!open) {
      handleRef.current?.abort()
      handleRef.current = null
      setRunning(false)
      setOutput('')
    }
  }, [open])

  useEffect(() => {
    if (output && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  const stop = useCallback(() => {
    handleRef.current?.abort()
    handleRef.current = null
    setRunning(false)
  }, [])

  const handleRun = useCallback(async () => {
    if (running) {
      return
    }
    if (meta.needsSelection && !hasSelection) {
      onNotify('请先在编辑器中选中要处理的文字', 'warning')
      return
    }
    if (action === 'custom' && !instruction.trim()) {
      onNotify('请先填写自定义指令', 'warning')
      return
    }
    if (!primaryText.trim()) {
      onNotify('没有可处理的内容', 'warning')
      return
    }

    const prompt = buildPrompt({
      action,
      text: primaryText,
      documentText,
      language,
      instruction
    })

    setOutput('')
    setRunning(true)
    const handle = runAiAction({
      ai,
      model: model || undefined,
      prompt,
      onDelta: (delta) => setOutput((prev) => prev + delta)
    })
    handleRef.current = handle

    try {
      const result = await handle.result
      if (!result.aborted) {
        setOutput(stripCodeFence(result.text))
      }
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'AI 调用失败', 'error')
    } finally {
      if (handleRef.current === handle) {
        handleRef.current = null
      }
      setRunning(false)
    }
  }, [action, ai, documentText, hasSelection, instruction, language, meta.needsSelection, model, onNotify, primaryText, running])

  if (!open) {
    return null
  }

  const trimmedOutput = output.trim()
  const canApply = !running && trimmedOutput.length > 0

  return (
    <div className="confirm-overlay" role="presentation" onClick={onClose}>
      <div
        className="confirm-dialog ai-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="confirm-dialog-header ai-dialog-header">
          <h2 id="ai-dialog-title" className="confirm-dialog-title ai-dialog-title">
            <Sparkles size={16} />
            AI 助手
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

        <div className="ai-actions-row" role="tablist" aria-label="AI 操作">
          {AI_ACTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={action === item.id}
              className={`ai-action-chip ${action === item.id ? 'active' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setAction(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <p className="ai-action-hint">
          {meta.hint}
          {meta.needsSelection && !hasSelection && <span className="ai-hint-warn">（需要先选中文字）</span>}
          {!meta.needsSelection && !hasSelection && <span className="ai-hint-muted">（未选中，将处理全文）</span>}
        </p>

        <div className="ai-controls-row">
          {meta.needsLanguage && (
            <label className="ai-field">
              <span className="ai-field-label">目标语言</span>
              <select
                className="ai-select"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {TRANSLATE_LANGUAGES.map((lang) => (
                  <option key={lang.value} value={lang.value}>{lang.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="ai-field ai-field-model">
            <span className="ai-field-label">模型</span>
            <select
              className="ai-select"
              value={model}
              onChange={(event) => onModelChange(event.target.value)}
              disabled={loadingModels}
            >
              <option value={MODEL_DEFAULT_VALUE}>默认模型</option>
              {models.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
        </div>

        {meta.needsInstruction && (
          <textarea
            className="ai-instruction"
            placeholder="例如：把这段改写成正式邮件 / 列出 3 个反驳论点"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={2}
          />
        )}

        <div className="ai-output" ref={outputRef} aria-live="polite">
          {output ? (
            <pre className="ai-output-text">{output}</pre>
          ) : (
            <span className="ai-output-placeholder">
              {running ? '正在生成…' : '点击下方「生成」开始'}
            </span>
          )}
        </div>

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
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleRun()}
              >
                <Sparkles size={14} /> {trimmedOutput ? '重新生成' : '生成'}
              </button>
            )}
          </div>
          <div className="ai-actions-right">
            <button
              type="button"
              className="action-btn"
              disabled={!canApply}
              title="复制结果"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCopy(trimmedOutput)}
            >
              <Copy size={14} /> 复制
            </button>
            <button
              type="button"
              className="action-btn"
              disabled={!canApply}
              title="在选区/光标后插入"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsert(trimmedOutput)}
            >
              <CornerDownLeft size={14} /> 插入
            </button>
            <button
              type="button"
              className="action-btn ai-apply-btn"
              disabled={!canApply || !hasSelection}
              title={hasSelection ? '替换选中文字' : '没有选区可替换'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onReplaceSelection(trimmedOutput)}
            >
              <Replace size={14} /> 替换选区
            </button>
          </div>
        </div>

        {(loadingModels || running) && (
          <div className="ai-status-line">
            <Loader2 size={12} className="ai-spin" />
            {loadingModels ? '正在加载模型…' : '生成中，可随时停止'}
          </div>
        )}
      </div>
    </div>
  )
}
