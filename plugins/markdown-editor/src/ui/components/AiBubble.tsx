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
  MoreHorizontal,
  PenLine,
  Replace,
  RotateCcw,
  Sparkles,
  Square,
  Wand2,
  X
} from 'lucide-react'
import {
  REFINE_PRESETS,
  TRANSLATE_LANGUAGES,
  buildPrompt,
  buildRefinePrompt,
  getAiAction,
  runAiAction,
  stripCodeFence,
  type AiActionId,
  type AiClient,
  type AiRequestHandle
} from '../services/ai'
import { computeBubblePosition, type BubblePosition, type BubbleRect } from '../services/bubble'
import { renderMarkdownToHtml } from '../services/markdown'
import { diffTokens } from '../services/diff'

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
  /** Read-only context around the selection (coherence for polish/translate). */
  contextText: string
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

// 'image' is a pseudo-action: it opens the image generator rather than running a
// text AiAction, but it lives in the same menu so it can share the overflow.
type MenuEntryId = AiActionId | 'image'

interface MenuItem {
  id: MenuEntryId
  label: string
  icon: typeof Sparkles
}

const MENU_ITEMS: MenuItem[] = [
  { id: 'polish', label: '润色', icon: Wand2 },
  { id: 'translate', label: '翻译', icon: Languages },
  { id: 'ask', label: '问一问', icon: HelpCircle },
  { id: 'continue', label: '续写', icon: PenLine },
  { id: 'summarize', label: '总结', icon: ListTree },
  { id: 'custom', label: '自定义', icon: MessageSquare },
  { id: 'image', label: '生图', icon: ImagePlus }
]

// How many actions stay inline in the compact toolbar; the rest fold into a
// "更多" dropdown so the bubble stays small but every tool is one click away.
const PRIMARY_COUNT = 3

export function AiBubble({
  anchor,
  ai,
  model,
  selection,
  documentText,
  contextText,
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
  // Free-form follow-up that refines the current result (multi-turn on output).
  const [refineText, setRefineText] = useState('')
  // Whether the result is shown as a before→after diff against the selection.
  const [diffView, setDiffView] = useState(false)
  // Streamed model reasoning ("thinking"), shown before any output arrives.
  const [reasoning, setReasoning] = useState('')
  const [pos, setPos] = useState<BubblePosition | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const instructionRef = useRef<HTMLTextAreaElement>(null)
  const handleRef = useRef<AiRequestHandle | null>(null)

  const meta = getAiAction(action)
  const hasSelection = selection.trim().length > 0
  // Without a selection (summoned via shortcut) actions run on the whole doc.
  const primaryText = hasSelection ? selection : documentText
  // 生图 always shows; selection-only text actions are hidden without a selection.
  const visibleItems = MENU_ITEMS.filter(
    (item) => item.id === 'image' || hasSelection || !getAiAction(item.id).needsSelection
  )
  const primaryItems = visibleItems.slice(0, PRIMARY_COUNT)
  const overflowItems = visibleItems.slice(PRIMARY_COUNT)
  const hintFor = (item: MenuItem): string =>
    item.id === 'image'
      ? hasSelection
        ? '根据选中文字生成图片'
        : '输入提示词生成图片'
      : getAiAction(item.id).hint

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
      // Custom can generate from the instruction alone (empty doc is fine);
      // other actions still need source text to operate on.
      if (act !== 'custom' && !primaryText.trim()) {
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
        instruction: instr,
        // Surrounding context improves coherence for polish/translate; only
        // meaningful when a real selection exists.
        context: hasSelection ? contextText : ''
      })

      setDiffView(false)
      setReasoning('')
      setOutput('')
      setPhase('running')
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
    [ai, contextText, hasSelection, instruction, language, model, onNotify, primaryText]
  )

  // Refine the current result with a follow-up instruction. Operates on the
  // latest output (not the original source), so refinements stack across rounds.
  const refine = useCallback(
    async (instr: string) => {
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
      setPhase('running')
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
    [ai, model, onNotify, output]
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

  // Dispatches a menu entry: 生图 opens the image generator, everything else is
  // a normal text action. Always closes the "更多" dropdown first.
  const handleEntry = useCallback(
    (item: MenuItem) => {
      setMoreOpen(false)
      if (item.id === 'image') {
        onImage(hasSelection ? selection : '')
        return
      }
      handlePick(item.id)
    },
    [handlePick, hasSelection, onImage, selection]
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
    setRefineText('')
    setDiffView(false)
    setMoreOpen(false)
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
          {primaryItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                className="ai-bubble-chip"
                title={hintFor(item)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleEntry(item)}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            )
          })}
          {overflowItems.length > 0 && (
            <div className="ai-bubble-more">
              <button
                type="button"
                className={`ai-bubble-chip${moreOpen ? ' is-active' : ''}`}
                title="更多操作"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <MoreHorizontal size={14} />
                <span>更多</span>
              </button>
              {moreOpen && (
                <div className="ai-bubble-more-pop" role="menu">
                  {overflowItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className="ai-bubble-more-item"
                        title={hintFor(item)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleEntry(item)}
                      >
                        <Icon size={14} />
                        <span>{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
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
                  // Diff preview: show the before→after change against the selection
                  // so the user reviews edits before replacing.
                  diffView && hasSelection && phase === 'result' ? (
                    <div className="ai-bubble-output-diff">
                      {diffTokens(selection, trimmedOutput).map((seg, idx) => (
                        <span
                          key={idx}
                          className={
                            seg.op === 'delete'
                              ? 'ai-diff-del'
                              : seg.op === 'insert'
                                ? 'ai-diff-ins'
                                : undefined
                          }
                        >
                          {seg.text}
                        </span>
                      ))}
                    </div>
                  ) : // "问一问" produces an explanation meant to be read, so render its
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
                ) : phase === 'running' && reasoning ? (
                  // Show the model's reasoning while it "thinks", before any output.
                  <div className="ai-bubble-output-reasoning">{reasoning}</div>
                ) : (
                  <span className="ai-bubble-output-placeholder">
                    {phase === 'running' ? '正在生成…' : '没有生成内容，可重试'}
                  </span>
                )}
              </div>

              {phase === 'result' && trimmedOutput.length > 0 && (
                <div className="ai-bubble-refine">
                  <div className="ai-bubble-refine-chips">
                    {REFINE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="ai-bubble-refine-chip"
                        title={preset.instruction}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void refine(preset.instruction)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="ai-bubble-refine-row">
                    <input
                      type="text"
                      className="ai-bubble-refine-input"
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
                      className="ai-bubble-btn ai-bubble-btn-primary ai-bubble-refine-send"
                      disabled={!refineText.trim()}
                      title="发送追问"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void refine(refineText)}
                    >
                      <CornerDownLeft size={13} />
                    </button>
                  </div>
                </div>
              )}

              {phase === 'running' ? (
                <div className="ai-bubble-actions">
                  <span className="ai-bubble-status">
                    <Loader2 size={12} className="ai-bubble-spin" /> {reasoning && !output ? '思考中' : '生成中'}
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
                  {hasSelection && (
                    <button
                      type="button"
                      className={`ai-bubble-btn${diffView ? ' is-active' : ''}`}
                      title={diffView ? '查看结果原文' : '对照改动（替换前预览）'}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setDiffView((value) => !value)}
                    >
                      {diffView ? '结果' : '对照'}
                    </button>
                  )}
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
