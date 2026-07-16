/**
 * 工作台右侧「AI 制片」对话面板。
 *
 * 相比早期的纯文本气泡，这里把 Agent 的**每一步都展开可视化**：
 * - 分阶段管线：决策 / 编剧 / 美术 / 导演 各成一张卡片，内嵌**思考流**（流式）+ 产出摘要（markdown）；
 * - 工具读取/调用：思考流 + 逐次**工具调用**（名称 / 入参 / 结果）；
 * - 最终回复用 markdown 渲染。
 * 数据来源：进行中回合读 store.agentTrace（实时），历史回合读 memory.steps（已落盘）。
 */
import { useEffect, useRef, useState } from 'react'
import { Bot, Wrench, Clapperboard, Loader2, Send, X, Brain, ChevronRight, Check, AlertCircle, Sparkles, FileText, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import type { AgentStep, MemoryItem } from '../domain/types'
import Markdown from './Markdown'
import { getLogFilePath, logError, logInfo } from '../services/localLog'

const AGENT_ICON: Record<string, LucideIcon> = {
  decision: Sparkles,
  script: FileText,
  assets: Users,
  storyboard: Clapperboard,
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return String(args)
  }
}

function isEmptyArgs(args: unknown): boolean {
  if (args == null) return true
  return typeof args === 'object' && !Array.isArray(args) && Object.keys(args as object).length === 0
}

function StatusDot({ status }: { status?: AgentStep['status'] }) {
  if (status === 'running') return <Loader2 size={13} className="afs-spin afs-trace__dot" />
  if (status === 'error') return <AlertCircle size={13} className="afs-trace__dot is-error" />
  return <Check size={13} className="afs-trace__dot is-done" />
}

/** 思考流折叠块：运行中默认展开（可实时看模型推理），完成后自动收起，可手动切换。 */
function Thinking({ text, running, standalone }: { text: string; running?: boolean; standalone?: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null)
  const prevRunning = useRef(running)
  // 运行中→完成：回到「跟随状态」以真正自动收起（即使用户运行时手动展开过也会复位）
  useEffect(() => {
    if (prevRunning.current && !running) setOverride(null)
    prevRunning.current = running
  }, [running])
  const open = override ?? !!running
  return (
    <div className={`afs-thinking${standalone ? ' is-standalone' : ''}`}>
      <button type="button" className="afs-thinking__toggle" onClick={() => setOverride(!open)}>
        <Brain size={12} />
        <span>思考{open ? '' : ` · ${text.length} 字`}</span>
        <ChevronRight size={12} className={`afs-trace__chev${open ? ' is-open' : ''}`} />
      </button>
      {open ? <div className="afs-thinking__body">{text}</div> : null}
    </div>
  )
}

function Collapsible({ summary, defaultOpen, children }: { summary: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="afs-collap">
      <button type="button" className="afs-collap__toggle" onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={11} className={`afs-trace__chev${open ? ' is-open' : ''}`} />
        {summary}
      </button>
      {open ? <div className="afs-collap__body">{children}</div> : null}
    </div>
  )
}

function StepCard({ step, live }: { step: AgentStep; live?: boolean }) {
  const running = live && step.status === 'running'

  if (step.kind === 'agent') {
    const Icon = AGENT_ICON[step.agent ?? ''] ?? Bot
    return (
      <div className={`afs-trace__step afs-trace__step--agent is-${step.status ?? 'done'}`}>
        <div className="afs-trace__head">
          <Icon size={14} className="afs-trace__icon" />
          <span className="afs-trace__title">{step.title}</span>
          <StatusDot status={step.status} />
        </div>
        {step.thinking?.trim() ? <Thinking text={step.thinking} running={running} /> : null}
        {step.content?.trim() ? (
          <div className="afs-trace__body">
            <Markdown text={step.content} />
          </div>
        ) : null}
      </div>
    )
  }

  if (step.kind === 'tool') {
    return (
      <div className={`afs-trace__step afs-trace__step--tool is-${step.status ?? 'done'}`}>
        <div className="afs-trace__head">
          <Wrench size={13} className="afs-trace__icon" />
          <span className="afs-trace__title">{step.title}</span>
          <StatusDot status={step.status} />
        </div>
        {!isEmptyArgs(step.toolArgs) ? (
          <Collapsible summary="入参">
            <pre className="afs-trace__pre">{formatArgs(step.toolArgs)}</pre>
          </Collapsible>
        ) : null}
        {step.toolResult ? (
          <Collapsible summary="结果" defaultOpen>
            <div className="afs-trace__result">{step.toolResult}</div>
          </Collapsible>
        ) : null}
      </div>
    )
  }

  if (step.kind === 'thinking') {
    return <Thinking text={step.thinking ?? ''} running={running} standalone />
  }

  // text：工具调用之间模型的说明性叙述
  return (
    <div className="afs-trace__text">
      <Markdown text={step.content ?? ''} />
    </div>
  )
}

function TraceView({ steps, live }: { steps: AgentStep[]; live?: boolean }) {
  return (
    <div className="afs-trace">
      {steps.map((s) => (
        <StepCard key={s.id} step={s} live={live} />
      ))}
    </div>
  )
}

function MessageBubble({ m }: { m: MemoryItem }) {
  if (m.role === 'user') {
    return <div className="afs-studio__msg afs-studio__msg--user">{m.content}</div>
  }
  const isError = m.content.startsWith('出错：')
  return (
    <div className="afs-studio__turn">
      {m.steps?.length ? <TraceView steps={m.steps} /> : null}
      <div className={`afs-studio__msg afs-studio__msg--assistant${isError ? ' is-error' : ''}`}>
        <Markdown text={m.content} />
      </div>
    </div>
  )
}

function LiveTurn({ steps, stage }: { steps?: AgentStep[]; stage?: string }) {
  // 有正在跑的步骤卡片时，卡片自带 spinner，不再重复底部状态；仅在开跑前/步骤间隙显示提示
  const running = steps?.some((s) => s.status === 'running')
  return (
    <div className="afs-studio__turn afs-studio__turn--live">
      {steps?.length ? <TraceView steps={steps} live /> : null}
      {!running && (
        <div className="afs-studio__status">
          <Loader2 size={13} className="afs-spin" /> {stage || '思考中…'}
        </div>
      )}
    </div>
  )
}

export default function AgentPanel() {
  const doc = useProjectStore((s) => s.doc)!
  const runAgent = useProjectStore((s) => s.runAgent)
  const abortAgent = useProjectStore((s) => s.abortAgent)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const busy = useProjectStore((s) => s.agentBusy)
  const stage = useProjectStore((s) => s.agentStage)
  const trace = useProjectStore((s) => s.agentTrace)
  const [text, setText] = useState('')
  const [showManual, setShowManual] = useState(false)
  const msgs = doc.memory.filter((m) => m.role === 'user' || m.role === 'assistant')

  // 贴底自动滚动：仅当用户已在底部附近时跟随新内容，向上翻阅历史时不打扰
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const onScroll = () => {
    const el = scrollRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }
  // 仅在内容真正变化时贴底（新消息 / 流式轨迹 / 状态位），避免每次无关重渲染都强拽到底
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [msgs.length, trace, busy, stage])

  const send = () => {
    if (!text.trim() || busy) return
    const t = text
    setText('')
    void runAgent(t)
  }
  const copyLogPath = async () => {
    try {
      const path = await getLogFilePath()
      await window.mulby?.clipboard?.writeText(path)
      window.mulby?.notification?.show('日志路径已复制', 'success')
      logInfo('agent.panel', 'copyLogPath', { path })
    } catch (e) {
      window.mulby?.notification?.show('复制日志路径失败', 'error')
      logError('agent.panel', 'copyLogPath.error', e)
    }
  }

  return (
    <aside className="afs-studio__agent">
      <div className="afs-studio__agent-head">
        <Bot size={16} /> AI 制片
        <button
          className="afs-studio__manualtoggle"
          title="复制日志文件路径"
          aria-label="复制日志文件路径"
          onClick={() => void copyLogPath()}
        >
          <FileText size={14} />
        </button>
        <button
          className={`afs-studio__manualtoggle${showManual ? ' is-on' : ''}`}
          title="导演手册（全局风格/节奏意图，注入 Agent）"
          aria-pressed={showManual}
          aria-label="导演手册"
          onClick={() => setShowManual((v) => !v)}
        >
          <Clapperboard size={14} />
        </button>
      </div>
      {showManual && (
        <textarea
          className="afs-field__input afs-studio__manual"
          rows={2}
          placeholder="导演手册：全局风格/节奏/调性意图（注入每次 Agent 生成）…"
          value={doc.meta.directorManual ?? ''}
          onChange={(e) => updateMeta({ directorManual: e.target.value })}
        />
      )}
      <div className="afs-studio__agent-msgs" ref={scrollRef} onScroll={onScroll}>
        {msgs.length === 0 && !busy && (
          <p className="afs-studio__hint">
            描述你的短剧（一句话/故事/指令），我会分「决策 → 编剧 → 美术 → 导演」几步来做，每一步的思考与产出都会展开给你看。例如：「把这个故事改成 5 个镜头的悬疑短片，列出人物和场景」。
          </p>
        )}
        {msgs.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {busy && <LiveTurn steps={trace} stage={stage} />}
      </div>
      <div className="afs-studio__agent-input">
        <textarea
          value={text}
          placeholder="描述你的短剧或下一步…（Ctrl/Cmd+Enter 发送）"
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        {busy ? (
          <button className="afs-btn afs-btn--sm" title="停止" onClick={() => abortAgent()}>
            <X size={14} />
          </button>
        ) : (
          <button className="afs-btn afs-btn--gradient afs-btn--sm" disabled={!text.trim()} onClick={send}>
            <Send size={14} />
          </button>
        )}
      </div>
    </aside>
  )
}
