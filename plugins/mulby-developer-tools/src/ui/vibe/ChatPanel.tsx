import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Bot, Wrench, Lightbulb, RefreshCw, X, Play, FileText, ExternalLink, Rocket, Package, AlertTriangle, Trash2, ChevronDown, ChevronUp, Image as ImageIcon, StopCircle, RotateCcw, ListChecks, CheckCircle2, Circle, MoreHorizontal, ArrowDown } from 'lucide-react'
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
// 撤销确认卡里列出待撤销文件时的状态标签/配色（与交付页 CHANGE_META 保持一致）
const CHANGE_STATUS_LABEL: Record<'added' | 'modified' | 'deleted', string> = { added: '新增', modified: '修改', deleted: '删除' }
const CHANGE_STATUS_CLS: Record<'added' | 'modified' | 'deleted', string> = {
  added: 'text-emerald-600 dark:text-emerald-400',
  modified: 'text-amber-600 dark:text-amber-400',
  deleted: 'text-rose-600 dark:text-rose-400'
}

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  busy?: boolean
  /** busy 时指示器显示的文案（如「正在生成插件设定…」）；缺省回退到通用「AI 处理中…」 */
  busyHint?: string
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
  pendingPrompt?: { kind: 'confirm' | 'action'; title: string; desc: string; actionLabel: string; danger?: boolean; files?: { status: 'added' | 'modified' | 'deleted'; path: string }[]; onAction: () => void } | null
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
  onSend, disabled, busy, busyHint, routing, aiActive, onStop, streamingText, messages,
  brainstorm, onPickIdea, onMoreIdeas, onUseSeed, onDismissBrainstorm, examples,
  contractPending, onConfirmGenerate,
  plan, planPhase, onStartPlan, onReplan,
  pendingPrompt, onPromptDismiss,
  status, statusBusy, iconBusy, iconProgress, packed, onOpenPlugin, onTryIt, onPack, onRegenIcon, onUndoToBefore, undoing, onClearMessages
}: Props) {
  const { activeSession } = useSession()
  const [text, setText] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const state: VibeSessionState = activeSession?.state || 'initial'
  const allMessages = messages || activeSession?.messages || []

  useEffect(() => {
    if (atBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [allMessages.length, busy, streamingText, routing, atBottom])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 112)}px`
  }

  const send = () => {
    const t = text.trim()
    if (!t || disabled || busy) return
    onSend(t)
    setText('')
    setTimeout(() => {
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      textareaRef.current?.focus()
    }, 0)
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
        对话
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
        <div className="relative flex-1 min-h-0">
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-auto px-3 py-3 space-y-3">
          {allMessages.length === 0 ? (
            <div className="space-y-3">
              <div className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
                用大白话描述你想要的插件，或问我项目情况。
              </div>
              {examples && examples.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500">试试：</div>
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
            allMessages.map((msg, i) => (
              <MessageBubble key={msg.id} msg={msg} grouped={i > 0 && allMessages[i - 1].role === msg.role} />
            ))
          )}
          {routing && !busy && <Thinking tone="indigo" text="正在理解你的意图…" />}
          {busy && (streamingText && streamingText.trim() ? (
            <div className="flex flex-col items-start gap-1">
              <AiLabel />
              <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 px-3 py-2 text-[12px] break-words">
                <Markdown text={streamingText} />
                <span className="inline-block w-1.5 h-3.5 align-middle bg-emerald-500/70 animate-pulse ml-0.5 rounded-sm" />
              </div>
            </div>
          ) : (
            <Thinking tone="emerald" text={busyHint || iconProgress || 'AI 处理中…'} />
          ))}
          <div ref={messagesEndRef} />
          </div>
          {!atBottom && (
            <button
              onClick={() => { setAtBottom(true); messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
              className="absolute bottom-3 right-3 z-10 h-7 w-7 flex items-center justify-center rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400"
              title="回到最新"
            >
              <ArrowDown size={14} />
            </button>
          )}
        </div>
      )}

      {brainstorm && (
        <PanelCard accent="amber" icon={<Lightbulb size={12} />} title="选个方向开始" onClose={onDismissBrainstorm}>
          {brainstorm.loading ? (
            <div className="space-y-1.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-2 animate-pulse">
                  <div className="h-3 w-1/3 bg-slate-200 dark:bg-slate-700 rounded" />
                  <div className="h-2 w-2/3 bg-slate-100 dark:bg-slate-800 rounded mt-1.5" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-auto">
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
              <div className="flex items-center gap-2 pt-0.5">
                <button onClick={onMoreIdeas} className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 py-1">
                  <RefreshCw size={11} /> 再给我几个
                </button>
                {onUseSeed && (
                  <button onClick={onUseSeed} className="flex-1 flex items-center justify-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 py-1">
                    <Play size={10} /> 直接用我说的
                  </button>
                )}
              </div>
            </div>
          )}
        </PanelCard>
      )}

      {pendingPrompt && (
        <PanelCard
          accent={pendingPrompt.danger ? 'rose' : 'sky'}
          icon={pendingPrompt.danger ? <AlertTriangle size={12} /> : <Wrench size={12} />}
          title={pendingPrompt.title}
        >
          <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">{pendingPrompt.desc}</div>
          {pendingPrompt.files && pendingPrompt.files.length > 0 && (
            <div className="mt-1.5 max-h-28 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 divide-y divide-slate-100 dark:divide-slate-800">
              {pendingPrompt.files.map((f) => (
                <div key={f.path} className="flex items-center gap-1.5 px-2 py-1 text-[10px] mono">
                  <span className={CHANGE_STATUS_CLS[f.status]}>{CHANGE_STATUS_LABEL[f.status]}</span>
                  <span className="truncate text-slate-600 dark:text-slate-300">{f.path}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={pendingPrompt.onAction} disabled={busy} className={`h-7 px-2.5 text-[11px] ${pendingPrompt.danger ? 'btn-danger' : 'btn-primary'}`}>
              {pendingPrompt.actionLabel}
            </button>
            <button onClick={onPromptDismiss} className="btn-ghost h-7 px-2.5 text-[11px]">取消</button>
          </div>
        </PanelCard>
      )}

      {!pendingPrompt && planPhase && planPhase !== 'idle' && planPhase !== 'done' && (
        <PanelCard
          accent="indigo"
          icon={<ListChecks size={12} />}
          title={<>开发计划{plan && plan.length > 0 ? `（${plan.filter((t) => t.status === 'done').length}/${plan.length}）` : ''}</>}
          headerRight={planPhase === 'executing' ? <Loader2 size={12} className="animate-spin text-indigo-500" /> : undefined}
        >
          {planPhase === 'planning' && (!plan || plan.length === 0) ? (
            <Thinking tone="indigo" text="AI 正在制定开发计划…" />
          ) : (
            <>
              {plan && plan.length > 0 && (
                <div className="h-1 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden mb-2">
                  <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round((plan.filter((t) => t.status === 'done').length / plan.length) * 100)}%` }} />
                </div>
              )}
              <div className="space-y-0.5 max-h-56 overflow-auto">
                {(plan || []).map((t, i) => {
                  const active = t.status === 'in_progress'
                  return (
                    <div key={t.id} className={`flex items-start gap-1.5 text-[11px] rounded-md px-1.5 py-1 ${active ? 'bg-indigo-500/10' : ''}`}>
                      <span className="mt-0.5 shrink-0">
                        {t.status === 'done' ? <CheckCircle2 size={13} className="text-emerald-500 anim-check" />
                          : t.status === 'in_progress' ? <Loader2 size={13} className="text-indigo-500 animate-spin" />
                          : t.status === 'failed' ? <AlertTriangle size={13} className="text-rose-500" />
                          : <Circle size={13} className="text-slate-300 dark:text-slate-600" />}
                      </span>
                      <div className="min-w-0">
                        <div className={t.status === 'done' ? 'text-slate-400 dark:text-slate-500 line-through' : active ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-700 dark:text-slate-200'}>{i + 1}. {t.title}</div>
                        {t.detail && <div className="text-[10px] text-slate-400 dark:text-slate-500 break-words">{t.detail}</div>}
                      </div>
                    </div>
                  )
                })}
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
                  <div className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">想调整？直接在下面说出想改的地方，我会按你的意见重新规划。</div>
                  {plan && plan.some((t) => t.status === 'done' || t.status === 'failed') && (
                    <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">上次未跑完，点「继续执行」接着完成。</div>
                  )}
                </>
              )}
              {planPhase === 'executing' && (
                <div className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">AI 正在按计划逐步实现，完成一步勾选一步…</div>
              )}
            </>
          )}
        </PanelCard>
      )}

      {!brainstorm && !pendingPrompt && contractPending && (
        <PanelCard accent="emerald" icon={<FileText size={12} />} title="插件设定已就绪">
          <div className="text-[11px] text-slate-700 dark:text-slate-200 font-medium truncate">{contractPending.name}</div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 break-words">{contractPending.summary}</div>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={onConfirmGenerate} disabled={disabled || busy} className="btn-primary h-7 px-2.5 text-[11px]">
              <Play size={12} /> 确认并制定计划
            </button>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">想改设定可点顶部「详情」展开</span>
          </div>
        </PanelCard>
      )}

      {/* 插件操作条：主操作（打开/试用）常驻，次要操作收进「更多」菜单，避免一排按钮拥挤 */}
      {status && (
        <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-1.5 bg-white/40 dark:bg-slate-900/30 flex items-center gap-1.5">
          <button onClick={onOpenPlugin} disabled={statusBusy} className="btn-ghost h-6 px-2 text-[10px]" title="打开插件窗口"><Rocket size={11} /> 打开</button>
          <button onClick={onTryIt} disabled={statusBusy} className="btn-ghost h-6 px-2 text-[10px]" title="复制触发词去主输入框试用"><ExternalLink size={11} /> 试用</button>
          <span className="flex-1" />
          <MoreMenu
            items={[
              { icon: <Package size={13} />, label: packed ? '已打包' : '打包为 .inplugin', onClick: () => onPack?.(), disabled: statusBusy },
              ...(onRegenIcon ? [{ icon: iconBusy ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />, label: '重新生成图标', onClick: () => onRegenIcon(), disabled: statusBusy || iconBusy }] : []),
              ...(onUndoToBefore ? [{ icon: undoing ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />, label: '撤销 AI 改动', onClick: () => onUndoToBefore(), disabled: statusBusy || aiActive || undoing, danger: true }] : []),
            ]}
          />
        </div>
      )}

      <div className="border-t border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/50">
        <div className="flex items-end gap-2 px-3 py-2.5">
          <textarea
            ref={textareaRef}
            className="input-base min-h-[36px] max-h-28 leading-relaxed flex-1 resize-none text-[13px]"
            placeholder={PLACEHOLDER[state]}
            value={text}
            onChange={(e) => { setText(e.target.value); autoGrow() }}
            onKeyDown={handleKeyDown}
            disabled={disabled || busy || routing || state === 'generating'}
            rows={1}
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
          {state === 'generating' ? 'AI 正在生成，暂不可输入…' : busy ? '处理中…可点停止中断' : routing ? '正在理解你的意图…' : '⌘/Ctrl + Enter 发送'}
        </div>
      </div>
    </div>
  )
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

type PanelAccent = 'amber' | 'sky' | 'rose' | 'indigo' | 'emerald'
const PANEL_BAR: Record<PanelAccent, string> = {
  amber: 'bg-amber-400', sky: 'bg-sky-400', rose: 'bg-rose-400', indigo: 'bg-indigo-400', emerald: 'bg-emerald-400'
}
const PANEL_TITLE: Record<PanelAccent, string> = {
  amber: 'text-amber-700 dark:text-amber-300', sky: 'text-sky-700 dark:text-sky-300', rose: 'text-rose-700 dark:text-rose-300',
  indigo: 'text-indigo-700 dark:text-indigo-300', emerald: 'text-emerald-700 dark:text-emerald-300'
}

/** 输入框上方各类浮层的统一外壳：顶部分隔 + 左色条区分语义 + 小图标标题 + 右侧操作位，替代原先各自整块大面积染色 */
function PanelCard({ accent, icon, title, headerRight, onClose, children }: {
  accent: PanelAccent
  icon: React.ReactNode
  title: React.ReactNode
  headerRight?: React.ReactNode
  onClose?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="relative border-t border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/20 px-3 py-2.5 pl-4 anim-in">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${PANEL_BAR[accent]}`} />
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`flex items-center gap-1 text-[11px] font-medium ${PANEL_TITLE[accent]}`}>{icon} {title}</span>
        <span className="flex-1" />
        {headerRight}
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" title="关闭"><X size={13} /></button>}
      </div>
      {children}
    </div>
  )
}

/** 溢出操作菜单（对话区插件操作条次要操作收纳，向上弹出） */
function MoreMenu({ items }: { items: Array<{ icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  if (!items.length) return null
  return (
    <div className="relative" ref={ref}>
      <button className="btn-ghost h-6 px-2 text-[10px]" onClick={() => setOpen((v) => !v)} title="更多操作"><MoreHorizontal size={13} /></button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-30 min-w-[9rem] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1">
          {items.map((it, i) => (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick() }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40 ${it.danger ? 'text-rose-600 dark:text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}>
              <span className="shrink-0">{it.icon}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 统一的「AI 思考中」气泡（理解意图 / 处理中 共用） */
function Thinking({ tone, text }: { tone: 'emerald' | 'indigo'; text: string }) {
  const cls = tone === 'indigo' ? 'text-indigo-500 dark:text-indigo-400' : 'text-emerald-600 dark:text-emerald-400'
  return (
    <div className={`flex items-center gap-1.5 text-[11px] anim-in ${cls}`}>
      <span className="thinking-dots"><span /><span /><span /></span> {text}
    </div>
  )
}

/** AI 发言标识：低调的品牌头像（圆角方块 + Bot 图标）+ 文案；取代每条消息前重复的 ✨ 图标 */
function AiLabel() {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
      <span className="w-[18px] h-[18px] rounded-md bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400 flex items-center justify-center shrink-0">
        <Bot size={12} />
      </span>
      AI
    </div>
  )
}

function MessageBubble({ msg, grouped }: { msg: VibeMessage; grouped?: boolean }) {
  const isUser = msg.role === 'user'
  const [showActions, setShowActions] = useState(false)
  const time = msg.timestamp ? fmtTime(msg.timestamp) : ''
  if (isUser) {
    return (
      <div className="group flex flex-col items-end gap-0.5 anim-in">
        {(time || (msg.intent && INTENT_LABEL[msg.intent])) && (
          <div className="flex items-center gap-1.5 h-3.5">
            {time && <span className="text-[9px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">{time}</span>}
            {msg.intent && INTENT_LABEL[msg.intent] && (
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${INTENT_CLASS[msg.intent] || 'bg-slate-200 text-slate-600'}`}>
                {INTENT_LABEL[msg.intent]}
              </span>
            )}
          </div>
        )}
        <div className="max-w-[85%] rounded-xl rounded-tr-sm bg-emerald-500 text-white px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words">
          {msg.content}
        </div>
      </div>
    )
  }
  return (
    <div className="group flex flex-col items-start gap-1 anim-in">
      {/* 连续的 AI 消息不再重复标识，避免页面上一堆相同图标 */}
      {!grouped && (
        <div className="flex items-center gap-1.5">
          <AiLabel />
          {time && <span className="text-[9px] text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">{time}</span>}
        </div>
      )}
      <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-200 px-3 py-2 text-[12px] break-words">
        <Markdown text={msg.content} />
      </div>
      {msg.actions && msg.actions.length > 0 && (
        <div className="max-w-[92%] w-full text-[10px]">
          <button onClick={() => setShowActions((v) => !v)} className="flex items-center gap-1 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 select-none">
            <Wrench size={10} /> {msg.actions.length} 步操作 <ChevronDown size={10} className={`transition-transform ${showActions ? 'rotate-180' : ''}`} />
          </button>
          {showActions && (
            <div className="mt-1 pl-3 space-y-0.5 border-l border-slate-200 dark:border-slate-700 anim-in">
              {msg.actions.map((a, i) => (
                <div key={i} className="flex items-start gap-1.5 text-slate-500 dark:text-slate-400">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1 ${KIND_DOT[a.kind] || 'bg-slate-400'}`} />
                  <span className="break-words">{a.text}{a.detail ? <span className="text-slate-400 dark:text-slate-500"> · {a.detail}</span> : null}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
