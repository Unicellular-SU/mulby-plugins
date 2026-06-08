import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Sparkles, Wrench, Lightbulb, RefreshCw, X, Play, FileText, ExternalLink, Rocket, Package, AlertTriangle, Trash2, ChevronDown, ChevronUp, Image as ImageIcon, StopCircle, RotateCcw, ListChecks, CheckCircle2, Circle } from 'lucide-react'
import { useSession } from './SessionProvider'
import { Markdown } from './Markdown'
import type { VibeMessage, VibeSessionState, BrainstormOption, VibePlanTodo, VibePlanPhase } from './types'

const PLACEHOLDER: Record<VibeSessionState, string> = {
  initial: '描述你想做的插件，或直接提问…',
  contract: '对契约有什么想法？也可以直接问我…',
  generating: 'AI 正在生成中，请稍候…',
  ready: '问我项目情况，或说「帮我改…」来修改代码…',
  error: '描述问题或让我修复…'
}

const INTENT_LABEL: Record<string, string> = {
  ask: '问答', create: '新建', modify: '修改', run: '运行', package: '打包', rollback: '撤销', icon: '图标'
}
const INTENT_CLASS: Record<string, string> = {
  ask: 'bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300',
  create: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300',
  modify: 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
  run: 'bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300',
  package: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  rollback: 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300',
  icon: 'bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-950/40 dark:text-fuchsia-300'
}
const KIND_DOT: Record<string, string> = {
  write: 'bg-emerald-400', read: 'bg-sky-400', build: 'bg-amber-400',
  load: 'bg-violet-400', error: 'bg-rose-400', ai: 'bg-emerald-400', note: 'bg-slate-400'
}

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  busy?: boolean
  aiActive?: boolean
  /** 正在用 LLM 判断这条消息该触发什么动作（意图路由），期间显示「理解中」并禁用发送 */
  routing?: boolean
  onStop?: () => void
  streamingText?: string
  messages?: VibeMessage[]
  brainstorm?: { loading: boolean; options: BrainstormOption[]; seed: string } | null
  onPickIdea?: (opt: BrainstormOption) => void
  onMoreIdeas?: () => void
  onUseSeed?: () => void
  onDismissBrainstorm?: () => void
  examples?: string[]
  contractPending?: { name: string; summary: string } | null
  onConfirmGenerate?: () => void
  plan?: VibePlanTodo[]
  planPhase?: VibePlanPhase
  onStartPlan?: () => void
  onReplan?: () => void
  pendingPrompt?: { kind: 'confirm' | 'action'; title: string; desc: string; actionLabel: string; danger?: boolean; onAction: () => void } | null
  onPromptDismiss?: () => void
  status?: { name: string; loaded: boolean; trigger: string; icon?: string | null } | null
  statusBusy?: boolean
  iconBusy?: boolean
  iconProgress?: string | null
  packed?: boolean
  onOpenPlugin?: () => void
  onTryIt?: () => void
  onPack?: () => void
  onRegenIcon?: () => void
  onUndoToBefore?: () => void
  undoing?: boolean
  onClearMessages?: () => void
}

export function ChatPanel({
  onSend, disabled, busy, routing, aiActive, onStop, streamingText, messages,
  brainstorm, onPickIdea, onMoreIdeas, onUseSeed, onDismissBrainstorm, examples,
  contractPending, onConfirmGenerate,
  plan, planPhase, onStartPlan, onReplan,
  pendingPrompt, onPromptDismiss,
  status, statusBusy, iconBusy, iconProgress, packed, onOpenPlugin, onTryIt, onPack, onRegenIcon, onUndoToBefore, undoing, onClearMessages
}: Props) {
  const { activeSession } = useSession()
  const [text, setText] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const state: VibeSessionState = activeSession?.state || 'initial'
  const allMessages = messages || activeSession?.messages || []

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allMessages.length, busy, streamingText, routing])

  const send = () => {
    const t = text.trim()
    if (!t || disabled || busy) return
    onSend(t)
    setText('')
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
        <Sparkles size={12} className="text-emerald-500" /> 对话
        <span className="flex-1" />
        {allMessages.length > 0 && (
          <>
            <button
              onClick={onClearMessages}
              className="text-slate-400 hover:text-rose-500 transition-colors"
              title="清空当前对话记录"
            >
              <Trash2 size={12} />
            </button>
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              title={collapsed ? '展开对话记录' : '隐藏对话记录（腾出空间）'}
            >
              {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            </button>
          </>
        )}
      </div>

      {status && (
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-900/40 shrink-0 anim-in">
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="relative w-5 h-5 rounded-md overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-800/60 flex items-center justify-center">
              {status.icon ? <img src={status.icon} alt="图标" className="w-full h-full object-contain" /> : <span className={`w-2 h-2 rounded-full ${status.loaded ? 'bg-emerald-400' : 'bg-amber-400'}`} />}
              {iconBusy && <span className="absolute inset-0 bg-slate-900/40 flex items-center justify-center"><Loader2 size={10} className="text-white animate-spin" /></span>}
            </span>
            <span className="font-medium text-slate-700 dark:text-slate-200 truncate flex-1">{status.name}</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{status.loaded ? '已载入' : '已构建'}</span>
          </div>
          {status.trigger && <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">触发词：{status.trigger}</div>}
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {onUndoToBefore && (
              <button
                onClick={onUndoToBefore}
                disabled={statusBusy || aiActive || undoing}
                className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium rounded-md text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 border border-amber-300/70 dark:border-amber-700/60 hover:bg-amber-100 dark:hover:bg-amber-900/50 disabled:opacity-50"
                title="一键撤销到本次 AI 改动之前（可逆，丢弃的改动仍可在版本列表恢复）"
              >
                {undoing ? <Loader2 size={11} className="animate-spin" /> : <RotateCcw size={11} />} 撤销 AI 改动
              </button>
            )}
            <button onClick={onOpenPlugin} disabled={statusBusy} className="btn-ghost h-6 px-2 text-[10px]" title="打开插件窗口"><Rocket size={11} /> 打开</button>
            <button onClick={onTryIt} disabled={statusBusy} className="btn-ghost h-6 px-2 text-[10px]" title="复制触发词去主输入框试用"><ExternalLink size={11} /> 试用</button>
            <button onClick={onPack} disabled={statusBusy} className="btn-ghost h-6 px-2 text-[10px]" title="打包为 .inplugin"><Package size={11} /> {packed ? '已打包' : '打包'}</button>
            {onRegenIcon && <button onClick={onRegenIcon} disabled={statusBusy || iconBusy} className="btn-ghost h-6 px-2 text-[10px]" title="让 AI 按插件主题与功能重新生成图标">{iconBusy ? <Loader2 size={11} className="animate-spin" /> : <ImageIcon size={11} />} 图标</button>}
          </div>
        </div>
      )}

      {collapsed ? (
        <>
          <button
            onClick={() => setCollapsed(false)}
            className="shrink-0 px-3 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-slate-700 hover:text-slate-600 dark:hover:text-slate-300 text-left"
          >
            对话记录已隐藏（{allMessages.length} 条）· 点击展开
          </button>
          <div className="flex-1 min-h-0" />
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto px-3 py-3 space-y-3">
          {allMessages.length === 0 ? (
            <div className="space-y-3">
              <div className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                在这里用大白话和 AI 对话：可以<strong className="text-slate-500 dark:text-slate-300">提问</strong>（只看代码、不改动），
                也可以说<strong className="text-slate-500 dark:text-slate-300">「帮我改…」</strong>让 AI 修改。
              </div>
              {examples && examples.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500">试试这些（点一下直接发）：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {examples.map((ex) => (
                      <button
                        key={ex}
                        onClick={() => { if (!disabled && !busy) onSend(ex) }}
                        disabled={disabled || busy}
                        className="text-[11px] px-2 py-1 rounded-full border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-400/60 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors disabled:opacity-50 text-left"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            allMessages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
          )}
          {routing && !busy && (
            <div className="flex items-center gap-1.5 text-[11px] text-indigo-500 dark:text-indigo-400 anim-in">
              <span className="thinking-dots"><span /><span /><span /></span> 正在理解你的意图…
            </div>
          )}
          {busy && (streamingText && streamingText.trim() ? (
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                <Sparkles size={10} className="text-emerald-500" /> AI
              </div>
              <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 px-3 py-2 text-[12px] break-words">
                <Markdown text={streamingText} />
                <span className="inline-block w-1.5 h-3.5 align-middle bg-emerald-500/70 animate-pulse ml-0.5 rounded-sm" />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 anim-in">
              <span className="thinking-dots"><span /><span /><span /></span> {iconProgress || 'AI 处理中…'}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {brainstorm && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2.5 bg-amber-50/60 dark:bg-amber-950/10 space-y-1.5 max-h-64 overflow-auto anim-in">
          <div className="flex items-center justify-between text-[11px] font-medium text-amber-700 dark:text-amber-300">
            <span className="flex items-center gap-1"><Lightbulb size={12} /> 选个方向开始</span>
            <button onClick={onDismissBrainstorm} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" title="关闭，自己描述"><X size={13} /></button>
          </div>
          {brainstorm.loading ? (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 py-1.5"><Loader2 size={12} className="animate-spin" /> AI 正在发散想法…</div>
          ) : (
            <>
              {brainstorm.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => onPickIdea?.(opt)}
                  className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors px-2.5 py-2"
                >
                  <div className="text-[12px] font-medium text-slate-700 dark:text-slate-200">{opt.title}</div>
                  {opt.pitch && <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 break-words">{opt.pitch}</div>}
                  {opt.trigger && <div className="text-[9px] text-amber-600 dark:text-amber-400 mt-1">触发：{opt.trigger}</div>}
                </button>
              ))}
              <div className="flex items-center gap-2">
                <button onClick={onMoreIdeas} className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 py-1">
                  <RefreshCw size={11} /> 再给我几个
                </button>
                {onUseSeed && (
                  <button onClick={onUseSeed} className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 py-1">
                    <Play size={10} /> 直接用我说的
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {pendingPrompt && (
        <div className={`border-t border-slate-200 dark:border-slate-700 px-3 py-2.5 anim-in ${pendingPrompt.danger ? 'bg-rose-50/60 dark:bg-rose-950/10' : 'bg-sky-50/60 dark:bg-sky-950/10'}`}>
          <div className={`flex items-center gap-1 text-[11px] font-medium mb-0.5 ${pendingPrompt.danger ? 'text-rose-700 dark:text-rose-300' : 'text-sky-700 dark:text-sky-300'}`}>
            {pendingPrompt.danger ? <AlertTriangle size={12} /> : <Wrench size={12} />} {pendingPrompt.title}
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">{pendingPrompt.desc}</div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={pendingPrompt.onAction} disabled={busy} className={`h-7 px-2.5 text-[11px] ${pendingPrompt.danger ? 'btn-danger' : 'btn-primary'}`}>
              {pendingPrompt.actionLabel}
            </button>
            <button onClick={onPromptDismiss} className="btn-ghost h-7 px-2.5 text-[11px]">取消</button>
          </div>
        </div>
      )}

      {!pendingPrompt && planPhase && planPhase !== 'idle' && planPhase !== 'done' && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2.5 bg-indigo-50/60 dark:bg-indigo-950/10 anim-in">
          <div className="flex items-center justify-between text-[11px] font-medium text-indigo-700 dark:text-indigo-300 mb-1">
            <span className="flex items-center gap-1">
              <ListChecks size={12} /> 开发计划{plan && plan.length > 0 ? `（${plan.filter((t) => t.status === 'done').length}/${plan.length}）` : ''}
            </span>
            {planPhase === 'executing' && <Loader2 size={12} className="animate-spin text-indigo-500" />}
          </div>
          {planPhase === 'planning' && (!plan || plan.length === 0) ? (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 py-1">
              <Loader2 size={12} className="animate-spin" /> AI 正在制定开发计划…
            </div>
          ) : (
            <>
              <div className="space-y-1 mt-1 max-h-56 overflow-auto">
                {(plan || []).map((t, i) => (
                  <div key={t.id} className="flex items-start gap-1.5 text-[11px]">
                    <span className="mt-0.5 shrink-0">
                      {t.status === 'done' ? <CheckCircle2 size={13} className="text-emerald-500 anim-check" />
                        : t.status === 'in_progress' ? <Loader2 size={13} className="text-indigo-500 animate-spin" />
                        : t.status === 'failed' ? <AlertTriangle size={13} className="text-rose-500" />
                        : <Circle size={13} className="text-slate-300 dark:text-slate-600" />}
                    </span>
                    <div className="min-w-0">
                      <div className={t.status === 'done' ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200'}>{i + 1}. {t.title}</div>
                      {t.detail && <div className="text-[10px] text-slate-400 dark:text-slate-500 break-words">{t.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
              {planPhase === 'review' && (
                <>
                  <div className="mt-2 flex items-center gap-2">
                    <button onClick={onStartPlan} disabled={busy} className="btn-primary h-7 px-2.5 text-[11px]">
                      <Play size={12} /> {plan && plan.some((t) => t.status === 'done') ? '继续执行' : '开始执行'}
                    </button>
                    <button onClick={onReplan} disabled={busy} className="btn-ghost h-7 px-2.5 text-[11px]">
                      <RefreshCw size={11} /> 重新规划
                    </button>
                  </div>
                  {plan && plan.some((t) => t.status === 'done' || t.status === 'failed') && (
                    <div className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">上次未跑完，点「继续执行」或在下方输入「继续」即可接着完成。</div>
                  )}
                </>
              )}
              {planPhase === 'executing' && (
                <div className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">AI 正在按计划逐步实现，完成一步勾选一步…</div>
              )}
            </>
          )}
        </div>
      )}

      {!brainstorm && !pendingPrompt && contractPending && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2.5 bg-emerald-50/60 dark:bg-emerald-950/10 anim-in">
          <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 mb-1">
            <FileText size={12} /> 插件设定已就绪
          </div>
          <div className="text-[11px] text-slate-700 dark:text-slate-200 font-medium truncate">{contractPending.name}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 break-words">{contractPending.summary}</div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={onConfirmGenerate} disabled={disabled || busy} className="btn-primary h-7 px-2.5 text-[11px]">
              <Play size={12} /> 确认并制定计划
            </button>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">想改设定可点顶部「详情」展开</span>
          </div>
        </div>
      )}

      <div className="border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/50">
        <div className="flex items-end gap-2 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            className="input-base min-h-[36px] max-h-28 leading-relaxed flex-1 resize-none text-[13px]"
            placeholder={PLACEHOLDER[state]}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled || busy || routing || state === 'generating'}
            rows={2}
          />
          {(aiActive || routing) && onStop ? (
            <button
              className="btn-danger shrink-0 h-9 px-3"
              onClick={onStop}
              title={routing ? '取消理解' : '停止当前 AI 生成'}
            >
              <StopCircle size={14} /> 停止
            </button>
          ) : (
            <button
              className="btn-primary shrink-0 h-9 px-3"
              onClick={send}
              disabled={disabled || busy || !text.trim() || state === 'generating'}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          )}
        </div>
        <div className="px-3 pb-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          ⌘/Ctrl + Enter 发送 · 提问只读不改码，说「改/修复」才动手
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: VibeMessage }) {
  const isUser = msg.role === 'user'
  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1 anim-in">
        {msg.intent && INTENT_LABEL[msg.intent] && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${INTENT_CLASS[msg.intent] || 'bg-slate-200 text-slate-600'}`}>
            {INTENT_LABEL[msg.intent]}
          </span>
        )}
        <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-emerald-500 text-white px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-1 anim-in">
      <div className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
        <Sparkles size={10} className="text-emerald-500" /> AI
      </div>
      <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 px-3 py-2 text-[12px] break-words">
        <Markdown text={msg.content} />
      </div>
      {msg.actions && msg.actions.length > 0 && (
        <details className="max-w-[92%] w-full text-[10px]">
          <summary className="cursor-pointer text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 flex items-center gap-1 select-none">
            <Wrench size={10} /> {msg.actions.length} 步操作
          </summary>
          <div className="mt-1 pl-3 space-y-0.5 border-l border-slate-200 dark:border-slate-700">
            {msg.actions.map((a, i) => (
              <div key={i} className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${KIND_DOT[a.kind] || 'bg-slate-400'}`} />
                <span className="break-words">{a.text}{a.detail ? <span className="text-slate-400 dark:text-slate-500"> · {a.detail}</span> : null}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
