import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeft,
  Copy,
  CornerDownLeft,
  HelpCircle,
  ImagePlus,
  Languages,
  ListTree,
  Loader2,
  Maximize2,
  MessageSquare,
  PenLine,
  Replace,
  RotateCcw,
  Sparkles,
  Square,
  Wand2,
  X
} from 'lucide-react'
import {
  TRANSLATE_LANGUAGES,
  buildPrompt,
  getAiAction,
  runAiAction,
  stripCodeFence,
  type AiActionId,
  type AiClient,
  type AiRequestHandle
} from '../services/ai'
import { computeBubblePosition, type BubblePosition, type BubbleRect } from '../services/bubble'
import { renderMarkdownToHtml } from '../services/markdown'

type NotifyType = 'info' | 'success' | 'warning' | 'error'

interface AiBubbleProps {
  /** Selection rectangle in viewport coordinates. The component is only ever
   *  rendered by the parent while a selection exists, so this is non-null. */
  anchor: BubbleRect
  ai: AiClient
  /** Persisted model id; '' means host default. */
  model: string
  /** Captured selection text the AI operates on (may be empty when summoned
   *  via shortcut with no selection). */
  selection: string
  /** Whole-document markdown, used as the input when there is no selection. */
  documentText: string
  /** Fired the first time an action is started, so the parent can pin the
   *  bubble and capture the editor selection range for later applying. */
  onActivate: () => void
  onReplace: (text: string) => void
  onInsert: (text: string) => void
  onCopy: (text: string) => void
  /** Opens the full AI panel with the current selection. */
  onExpand: () => void
  /** Opens the AI image generator, seeded with the selection (or empty). */
  onImage: (prompt: string) => void
  onNotify: (message: string, type?: NotifyType) => void
  onClose: () => void
  /** When this returns true for a mousedown target, the bubble stays open (e.g.
   *  clicks inside the editor while adjusting the selection). */
  shouldKeepOpenOnTarget?: (target: Node) => boolean
}

type BubblePhase = 'menu' | 'input' | 'running' | 'result'

interface MenuItem {
  id: AiActionId
  label: string
  icon: typeof Sparkles
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'polish', label: '润色', icon: Wand2 },
  { id: 'translate', label: '翻译', icon: Languages },
  { id: 'ask', label: '问一问', icon: HelpCircle },
  { id: 'continue', label: '续写', icon: PenLine },
  { id: 'summarize', label: '总结', icon: ListTree },
  { id: 'custom', label: '自定义', icon: MessageSquare }
]

export function AiBubble({
  anchor,
  ai,
  model,
  selection,
  documentText,
  onActivate,
  onReplace,
  onInsert,
  onCopy,
  onExpand,
  onImage,
  onNotify,
  onClose,
  shouldKeepOpenOnTarget
}: AiBubbleProps) {
  const [phase, setPhase] = useState<BubblePhase>('menu')
  const [action, setAction] = useState<AiActionId>('polish')
  const [language, setLanguage] = useState<string>(TRANSLATE_LANGUAGES[1].value)
  const [instruction, setInstruction] = useState('')
  const [output, setOutput] = useState('')
  const [pos, setPos] = useState<BubblePosition | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const instructionRef = useRef<HTMLTextAreaElement>(null)
  const handleRef = useRef<AiRequestHandle | null>(null)

  const meta = getAiAction(action)
  const hasSelection = selection.trim().length > 0
  // Without a selection (summoned via shortcut) actions run on the whole doc.
  const primaryText = hasSelection ? selection : documentText
  const visibleItems = MENU_ITEMS.filter((item) => hasSelection || !getAiAction(item.id).needsSelection)

  // Re-measure and reposition whenever the anchor moves or the bubble's size
  // changes (phase transitions grow/shrink the card). A bounded output height
  // keeps the size stable while streaming so we don't reposition on every delta.
  useLayoutEffect(() => {
    const el = bubbleRef.current
    if (!el) {
      return
    }
    const measure = () => {
      const size = { width: el.offsetWidth, height: el.offsetHeight }
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      setPos(computeBubblePosition(anchor, size, viewport))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [anchor, phase])

  // Abort any in-flight request when the bubble unmounts.
  useEffect(() => {
    return () => {
      handleRef.current?.abort()
      handleRef.current = null
    }
  }, [])

  // Esc closes the bubble from any phase.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  // A click outside the bubble dismisses it. The listener is attached after the
  // initial mount/paint, so the click/keypress that summoned the bubble never
  // immediately closes it.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (bubbleRef.current?.contains(target)) {
        return
      }
      if (shouldKeepOpenOnTarget?.(target)) {
        return
      }
      onClose()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [onClose, shouldKeepOpenOnTarget])

  useEffect(() => {
    if (phase === 'input' && meta.needsInstruction) {
      instructionRef.current?.focus()
    }
  }, [meta.needsInstruction, phase])

  const runAction = useCallback(
    async (act: AiActionId, opts?: { language?: string; instruction?: string }) => {
      const lang = opts?.language ?? language
      const instr = opts?.instruction ?? instruction
      if (getAiAction(act).needsSelection && !hasSelection) {
        onNotify('请先选中要处理的文字', 'warning')
        return
      }
      if (act === 'custom' && !instr.trim()) {
        onNotify('请先填写自定义指令', 'warning')
        return
      }
      if (!primaryText.trim()) {
        onNotify('没有可处理的内容', 'warning')
        return
      }

      const prompt = buildPrompt({
        action: act,
        text: primaryText,
        // Use the same text as context for "continue" so it picks up from the
        // selected passage (or the whole document when nothing is selected).
        documentText: primaryText,
        language: lang,
        instruction: instr
      })

      setOutput('')
      setPhase('running')
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
          setPhase('result')
        }
      } catch (error) {
        onNotify(error instanceof Error ? error.message : 'AI 调用失败', 'error')
        setPhase('result')
      } finally {
        if (handleRef.current === handle) {
          handleRef.current = null
        }
      }
    },
    [ai, hasSelection, instruction, language, model, onNotify, primaryText]
  )

  const handlePick = useCallback(
    (act: AiActionId) => {
      // Fire synchronously while the editor selection is still alive (buttons
      // use mousedown preventDefault) so the parent can capture the range.
      onActivate()
      setAction(act)
      const picked = getAiAction(act)
      if (picked.needsInstruction || picked.needsLanguage) {
        setPhase('input')
      } else {
        void runAction(act)
      }
    },
    [onActivate, runAction]
  )

  const stop = useCallback(() => {
    handleRef.current?.abort()
    handleRef.current = null
    setPhase('result')
  }, [])

  const backToMenu = useCallback(() => {
    handleRef.current?.abort()
    handleRef.current = null
    setOutput('')
    setPhase('menu')
  }, [])

  const trimmedOutput = output.trim()
  const canApply = phase === 'result' && trimmedOutput.length > 0

  const style: CSSProperties = pos
    ? { left: `${pos.left}px`, top: `${pos.top}px` }
    : { left: `${anchor.left}px`, top: `${anchor.top}px`, visibility: 'hidden' }

  return (
    <div
      ref={bubbleRef}
      className={`ai-bubble ${phase === 'menu' ? 'ai-bubble-menu' : 'ai-bubble-card'} ${pos ? `placement-${pos.placement}` : ''}`}
      style={style}
      role="dialog"
      aria-label="AI 助手"
      onMouseDown={(event) => {
        // Keep the editor selection while interacting with the menu chips. In
        // the input phase, let the textarea/select receive focus normally.
        if (phase === 'menu') {
          event.preventDefault()
        }
      }}
    >
      {phase === 'menu' && (
        <div className="ai-bubble-menu-row">
          {!hasSelection && <span className="ai-bubble-scope" title="未选中文字，将处理全文">全文</span>}
          {visibleItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className="ai-bubble-chip"
                title={getAiAction(item.id).hint}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handlePick(item.id)}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            )
          })}
          <button
            type="button"
            className="ai-bubble-chip"
            title={hasSelection ? '根据选中文字生成图片' : '输入提示词生成图片'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onImage(hasSelection ? selection : '')}
          >
            <ImagePlus size={14} />
            <span>生图</span>
          </button>
          <span className="ai-bubble-divider" aria-hidden="true" />
          <button
            type="button"
            className="ai-bubble-icon-btn"
            title="打开完整 AI 面板"
            aria-label="打开完整 AI 面板"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onExpand}
          >
            <Maximize2 size={14} />
          </button>
        </div>
      )}

      {phase !== 'menu' && (
        <>
          <div className="ai-bubble-header">
            <span className="ai-bubble-title">
              <Sparkles size={14} />
              {meta.label}
              {!hasSelection && <span className="ai-bubble-scope">全文</span>}
            </span>
            <button
              type="button"
              className="ai-bubble-icon-btn"
              title="关闭"
              aria-label="关闭"
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>

          {phase === 'input' && (
            <div className="ai-bubble-input">
              {meta.needsLanguage && (
                <label className="ai-bubble-field">
                  <span className="ai-bubble-field-label">目标语言</span>
                  <select
                    className="ai-bubble-select"
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                  >
                    {TRANSLATE_LANGUAGES.map((lang) => (
                      <option key={lang.value} value={lang.value}>{lang.label}</option>
                    ))}
                  </select>
                </label>
              )}
              {meta.needsInstruction && (
                <textarea
                  ref={instructionRef}
                  className="ai-bubble-textarea"
                  placeholder="例如：把这段改写成正式邮件 / 列出 3 个反驳论点"
                  value={instruction}
                  rows={2}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void runAction(action, { language, instruction })
                    }
                  }}
                />
              )}
              <p className="ai-bubble-hint">{meta.hint}</p>
              <div className="ai-bubble-actions">
                <button
                  type="button"
                  className="ai-bubble-btn"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={backToMenu}
                >
                  <ArrowLeft size={13} /> 返回
                </button>
                <button
                  type="button"
                  className="ai-bubble-btn ai-bubble-btn-primary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void runAction(action, { language, instruction })}
                >
                  <Sparkles size={13} /> 生成
                </button>
              </div>
            </div>
          )}

          {(phase === 'running' || phase === 'result') && (
            <div className="ai-bubble-result">
              <div className="ai-bubble-output" aria-live="polite">
                {output ? (
                  // "问一问" produces an explanation meant to be read, so render its
                  // Markdown once the result settles. Other actions output text that
                  // goes back into the document, so we keep the raw source visible.
                  // During streaming we always show raw text for live feedback.
                  action === 'ask' && phase === 'result' ? (
                    <div
                      className="ai-bubble-output-md"
                      dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(trimmedOutput) }}
                    />
                  ) : (
                    <pre className="ai-bubble-output-text">{output}</pre>
                  )
                ) : (
                  <span className="ai-bubble-output-placeholder">
                    {phase === 'running' ? '正在生成…' : '没有生成内容，可重试'}
                  </span>
                )}
              </div>

              {phase === 'running' ? (
                <div className="ai-bubble-actions">
                  <span className="ai-bubble-status">
                    <Loader2 size={12} className="ai-bubble-spin" /> 生成中
                  </span>
                  <button
                    type="button"
                    className="ai-bubble-btn ai-bubble-btn-stop"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={stop}
                  >
                    <Square size={12} /> 停止
                  </button>
                </div>
              ) : (
                <div className="ai-bubble-actions ai-bubble-actions-result">
                  <button
                    type="button"
                    className="ai-bubble-btn"
                    title="返回操作菜单"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={backToMenu}
                  >
                    <ArrowLeft size={13} />
                  </button>
                  <button
                    type="button"
                    className="ai-bubble-btn"
                    title="重新生成"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void runAction(action, { language, instruction })}
                  >
                    <RotateCcw size={13} />
                  </button>
                  <span className="ai-bubble-actions-spacer" />
                  <button
                    type="button"
                    className="ai-bubble-btn"
                    disabled={!canApply}
                    title="复制结果"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onCopy(trimmedOutput)}
                  >
                    <Copy size={13} /> 复制
                  </button>
                  <button
                    type="button"
                    className={`ai-bubble-btn ${hasSelection ? '' : 'ai-bubble-btn-primary'}`}
                    disabled={!canApply}
                    title={hasSelection ? '在选区后插入' : '在光标处插入'}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onInsert(trimmedOutput)}
                  >
                    <CornerDownLeft size={13} /> 插入
                  </button>
                  {hasSelection && (
                    <button
                      type="button"
                      className="ai-bubble-btn ai-bubble-btn-primary"
                      disabled={!canApply}
                      title="替换选中文字"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => onReplace(trimmedOutput)}
                    >
                      <Replace size={13} /> 替换
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
