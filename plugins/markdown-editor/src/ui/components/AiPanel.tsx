import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, CornerDownLeft, Loader2, Replace, Settings, Sparkles, Square, X } from 'lucide-react'
import {
  AI_ACTIONS,
  REFINE_PRESETS,
  TRANSLATE_LANGUAGES,
  buildPrompt,
  buildRefinePrompt,
  getAiAction,
  isReasoningModel,
  runAiAction,
  stripCodeFence,
  type AiActionId,
  type AiClient,
  type AiRequestHandle
} from '../services/ai'
import { diffTokens } from '../services/diff'

export interface AiModelOption {
  id: string
  label: string
  /** Model advertises the reasoning capability → slow for inline autocomplete. */
  reasoning?: boolean
}

interface AiPanelProps {
  open: boolean
  ai: AiClient
  /** Currently selected text in the editor (may be empty). */
  selection: string
  /** Whole document markdown, used as fallback / context. */
  documentText: string
  /** Read-only context around the selection (coherence for polish/translate). */
  contextText: string
  /** Persisted model id; '' means "host default". */
  model: string
  onModelChange: (model: string) => void
  /** Inline-completion model id; '' means "follow the main model". */
  completionModel: string
  onCompletionModelChange: (model: string) => void
  /** Whether inline AI completion (ghost text) is currently on. */
  completionEnabled: boolean
  /** Toggle inline AI completion on/off (persisted by App). */
  onToggleCompletion: () => void
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
  contextText,
  model,
  onModelChange,
  completionModel,
  onCompletionModelChange,
  completionEnabled,
  onToggleCompletion,
  onReplaceSelection,
  onInsert,
  onCopy,
  onNotify,
  onClose
}: AiPanelProps) {
  // 'actions' = run AI on text; 'settings' = inline-completion toggle + model.
  const [view, setView] = useState<'actions' | 'settings'>('actions')
  const [action, setAction] = useState<AiActionId>('polish')
  const [language, setLanguage] = useState<string>(TRANSLATE_LANGUAGES[1].value)
  const [instruction, setInstruction] = useState('')
  const [models, setModels] = useState<AiModelOption[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  // Free-form follow-up that refines the current result (multi-turn on output).
  const [refineText, setRefineText] = useState('')
  // Whether the result is shown as a before→after diff against the selection.
  const [diffView, setDiffView] = useState(false)
  // Streamed model reasoning ("thinking"), shown before any output arrives.
  const [reasoning, setReasoning] = useState('')
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
            .map((item) => ({
              id: item.id as string,
              label: item.label || (item.id as string),
              reasoning: isReasoningModel(item)
            }))
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
      setRefineText('')
      setDiffView(false)
      setReasoning('')
      setView('actions')
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
    // Custom can generate from the instruction alone (empty doc is fine);
    // other actions still need source text to operate on.
    if (action !== 'custom' && !primaryText.trim()) {
      onNotify('没有可处理的内容', 'warning')
      return
    }

    const prompt = buildPrompt({
      action,
      text: primaryText,
      documentText,
      language,
      instruction,
      context: hasSelection ? contextText : ''
    })

    setDiffView(false)
    setReasoning('')
    setOutput('')
    setRunning(true)
    const handle = runAiAction({
      ai,
      model: model || undefined,
      prompt,
      onDelta: (delta) => setOutput((prev) => prev + delta),
      onReasoning: (delta) => setReasoning((prev) => prev + delta)
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
  }, [action, ai, contextText, documentText, hasSelection, instruction, language, meta.needsSelection, model, onNotify, primaryText, running])

  // Refine the current result with a follow-up instruction (iterates on output).
  const refine = useCallback(
    async (instr: string) => {
      if (running) {
        return
      }
      const base = output.trim()
      const ins = instr.trim()
      if (!base || !ins) {
        return
      }
      const prompt = buildRefinePrompt(base, ins)
      setRefineText('')
      setDiffView(false)
      setReasoning('')
      setOutput('')
      setRunning(true)
      const handle = runAiAction({
        ai,
        model: model || undefined,
        prompt,
        onDelta: (delta) => setOutput((prev) => prev + delta),
        onReasoning: (delta) => setReasoning((prev) => prev + delta)
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
    },
    [ai, model, onNotify, output, running]
  )

  if (!open) {
    return null
  }

  const trimmedOutput = output.trim()
  const canApply = !running && trimmedOutput.length > 0
  const modelOptionLabel = (item: AiModelOption) =>
    item.reasoning ? `${item.label}（推理 · 较慢）` : item.label
  // The model inline completion actually uses (its own, else the main model).
  const effectiveCompletionId = completionModel || model
  const effectiveCompletionReasoning = effectiveCompletionId
    ? !!models.find((item) => item.id === effectiveCompletionId)?.reasoning
    : false

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
            {view === 'settings' ? 'AI 设置' : 'AI 助手'}
          </h2>
          <div className="ai-header-actions">
            <button
              type="button"
              className={`ai-close-btn${view === 'settings' ? ' is-active' : ''}`}
              aria-label="行内补全设置"
              aria-pressed={view === 'settings'}
              title="行内补全设置"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setView((prev) => (prev === 'settings' ? 'actions' : 'settings'))}
            >
              <Settings size={16} />
            </button>
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
        </div>

        {view === 'settings' ? (
          <div className="ai-settings-page">
            <div className="ai-settings-row">
              <div className="ai-settings-text">
                <span className="ai-settings-title">行内 AI 补全（ghost text）</span>
                <span className="ai-settings-desc">编辑时停顿，光标处给出灰色续写建议，Tab 接受</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={completionEnabled}
                className={`ai-switch${completionEnabled ? ' is-on' : ''}`}
                title={completionEnabled ? '点击关闭' : '点击开启'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onToggleCompletion}
              >
                <span className="ai-switch-knob" />
              </button>
            </div>
            <label className="ai-field ai-field-model ai-settings-field">
              <span className="ai-field-label">行内补全模型</span>
              <select
                className="ai-select"
                value={completionModel}
                onChange={(event) => onCompletionModelChange(event.target.value)}
                disabled={loadingModels}
              >
                <option value={MODEL_DEFAULT_VALUE}>跟随主模型</option>
                {models.map((item) => (
                  <option key={item.id} value={item.id}>{modelOptionLabel(item)}</option>
                ))}
              </select>
            </label>
            <p className="ai-action-hint">
              {effectiveCompletionReasoning ? (
                <span className="ai-hint-warn">
                  当前补全用的是推理模型，逐字补全会很慢——建议选一个普通（非推理）的快速模型。
                </span>
              ) : (
                <span className="ai-hint-muted">
                  行内（Tab）补全延迟敏感，建议用快速的普通模型；留空＝跟随主模型。
                </span>
              )}
              {loadingModels && <span className="ai-hint-muted">（正在加载模型列表…）</span>}
            </p>
          </div>
        ) : (
        <>

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
                <option key={item.id} value={item.id}>{modelOptionLabel(item)}</option>
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
            diffView && hasSelection && !running ? (
              <div className="ai-output-diff">
                {diffTokens(selection, trimmedOutput).map((seg, idx) => (
                  <span
                    key={idx}
                    className={
                      seg.op === 'delete' ? 'ai-diff-del' : seg.op === 'insert' ? 'ai-diff-ins' : undefined
                    }
                  >
                    {seg.text}
                  </span>
                ))}
              </div>
            ) : (
              <pre className="ai-output-text">{output}</pre>
            )
          ) : running && reasoning ? (
            // The model's reasoning while it "thinks", before any output arrives.
            <div className="ai-output-reasoning">{reasoning}</div>
          ) : (
            <span className="ai-output-placeholder">
              {running ? '正在生成…' : '点击下方「生成」开始'}
            </span>
          )}
        </div>

        {!running && trimmedOutput.length > 0 && (
          <div className="ai-refine">
            <div className="ai-refine-chips">
              {REFINE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="ai-refine-chip"
                  title={preset.instruction}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void refine(preset.instruction)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="ai-refine-row">
              <input
                type="text"
                className="ai-refine-input"
                placeholder="继续追问 / 修改要求，回车发送"
                value={refineText}
                onChange={(event) => setRefineText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void refine(refineText)
                  }
                }}
              />
              <button
                type="button"
                className="action-btn ai-refine-send"
                disabled={!refineText.trim()}
                title="发送追问"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void refine(refineText)}
              >
                <CornerDownLeft size={14} />
              </button>
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
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void handleRun()}
              >
                <Sparkles size={14} /> {trimmedOutput ? '重新生成' : '生成'}
              </button>
            )}
            {!running && hasSelection && trimmedOutput.length > 0 && (
              <button
                type="button"
                className={`action-btn${diffView ? ' is-active' : ''}`}
                title={diffView ? '查看结果原文' : '对照改动（替换前预览）'}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setDiffView((value) => !value)}
              >
                {diffView ? '结果' : '对照'}
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
            {loadingModels
              ? '正在加载模型…'
              : reasoning && !output
                ? '思考中，可随时停止'
                : '生成中，可随时停止'}
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}
