import { X, Loader2, Ban, RotateCw, Clock, Volume2, VolumeX, Bot, ChevronRight } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { KIND_ACCENT, KIND_LABEL, type Card } from '../types'
import { stopCard, generateCard, canGenerate } from '../services/generate'
import { focusCard } from '../focusCard'
import { useWorkflowUi } from '../store/workflowStore'
import { Z } from '../zlayers'

interface Entry { card: Card; boardId: string; boardName: string }

function statusText(c: Card, queueIdx: number): string {
  if (c.status === 'queued') return `排队中 · 第 ${queueIdx + 1} 位`
  if (c.status === 'running') return `处理中 · ${Math.round((c.progress || 0) * 100)}%`
  if (c.status === 'error') return c.error || '失败'
  return ''
}

function Row({ entry, queueIdx, foreign }: { entry: Entry; queueIdx: number; foreign: boolean }) {
  const { card, boardId, boardName } = entry
  const accent = KIND_ACCENT[card.kind]
  const active = card.status === 'running' || card.status === 'queued'
  const jump = () => focusCard(boardId, card.id) // 跨画布定位：切画布 + 居中 + 选中，而非只改选中态
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accent }} />
      <button onClick={jump} className="flex-1 min-w-0 text-left" title="定位到该卡片">
        <div className="text-xs font-medium truncate">
          {card.title || KIND_LABEL[card.kind]}
          {foreign && <span className="ml-1 opacity-40 font-normal">· {boardName}</span>}
        </div>
        <div className={`text-[10px] truncate ${card.status === 'error' ? 'text-red-500' : 'opacity-60'}`}>{statusText(card, queueIdx)}</div>
        {card.status === 'running' && (
          <div className="mt-1 h-1 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
            <div className="h-full rounded-full transition-[width] duration-150" style={{ width: `${Math.round((card.progress || 0) * 100)}%`, background: accent }} />
          </div>
        )}
      </button>
      {active ? (
        <button onClick={() => void stopCard(card.id)} title="取消" className="shrink-0 w-6 h-6 grid place-items-center rounded-md text-red-500 hover:bg-red-500/10">
          <Ban size={13} />
        </button>
      ) : (
        canGenerate(card) && (
          <button onClick={() => void generateCard(card.id)} title="重试" className="shrink-0 w-6 h-6 grid place-items-center rounded-md hover:bg-black/10 dark:hover:bg-white/10">
            <RotateCw size={13} />
          </button>
        )
      )}
    </div>
  )
}

// 任务中心：从**全部画布**卡片状态派生的进行中 / 失败列表（进度、取消、重试、跨画布定位）。
// 扫全部画布而非仅活动画布——否则与顶栏全局计数、跨画布续跑脱节（非活动画布的任务看不到也管不了）。
export function TaskCenter() {
  const show = useUi((s) => s.showTaskCenter)
  const project = useGraph((s) => s.project)
  const notifyDone = useUi((s) => s.notifyDone)
  if (!show) return null

  const activeBoardId = project.activeBoardId
  const running: Entry[] = []
  const queued: Entry[] = []
  const failed: Entry[] = []
  const workflows = Object.values(project.workflowRuns || {}).filter((run) => run.status !== 'completed' && run.status !== 'canceled')
  for (const b of project.boards) {
    for (const c of Object.values(b.cards)) {
      const e: Entry = { card: c, boardId: b.id, boardName: b.name }
      if (c.status === 'running') running.push(e)
      else if (c.status === 'queued') queued.push(e)
      else if (c.status === 'error') failed.push(e)
    }
  }
  const close = () => useUi.getState().setShowTaskCenter(false)
  const empty = running.length + queued.length + failed.length + workflows.length === 0

  return (
    <div data-interactive className={`fixed top-12 right-3 ${Z.panel} w-72 max-h-[72vh] ace-glass ace-anim-scale flex flex-col`}>
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--ace-border)' }}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Clock size={14} className="text-indigo-500" /> 任务中心
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => useUi.getState().toggleNotifyDone()}
            title={notifyDone ? '完成提示音：开（点击关闭）' : '完成提示音：关（点击开启）'}
            className="opacity-60 hover:opacity-100"
          >
            {notifyDone ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button onClick={close} className="opacity-60 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto ace-scroll p-1.5">
        {empty && <div className="py-8 text-center text-xs opacity-50">暂无进行中或失败的任务</div>}
        {workflows.length > 0 && <div className="px-1.5 py-1 text-[10px] uppercase tracking-wide opacity-50 flex items-center gap-1"><Bot size={10} /> 工作流（{workflows.length}）</div>}
        {workflows.map((run) => (
          <button key={run.id} type="button" onClick={() => { useWorkflowUi.getState().setSelectedRunId(run.id); useUi.getState().setShowAgent(true); close() }} className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left hover:bg-black/5 dark:hover:bg-white/10">
            {run.status === 'running' ? <Loader2 size={12} className="animate-spin text-indigo-500" /> : run.status === 'error' || run.status === 'stale' ? <Ban size={12} className="text-red-500" /> : <Clock size={12} className="text-amber-500" />}
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium truncate">{run.brief.title}</span><span className={`block text-[10px] ${run.status === 'error' || run.status === 'stale' ? 'text-red-500' : 'opacity-55'}`}>{run.status === 'running' ? '执行中' : run.status === 'paused' ? '等待确认或继续' : run.status === 'error' ? '步骤失败，等待处理' : run.status === 'stale' ? '源文本已变化' : '待确认'}</span></span>
            <ChevronRight size={12} className="opacity-35" />
          </button>
        ))}
        {(running.length > 0 || queued.length > 0) && (
          <div className="px-1.5 py-1 text-[10px] uppercase tracking-wide opacity-50 flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> 进行中（{running.length + queued.length}）
          </div>
        )}
        {running.map((e) => (
          <Row key={e.card.id} entry={e} queueIdx={-1} foreign={e.boardId !== activeBoardId} />
        ))}
        {queued.map((e, i) => (
          <Row key={e.card.id} entry={e} queueIdx={i} foreign={e.boardId !== activeBoardId} />
        ))}
        {failed.length > 0 && <div className="px-1.5 py-1 mt-1 text-[10px] uppercase tracking-wide text-red-500/70">失败（{failed.length}）</div>}
        {failed.map((e) => (
          <Row key={e.card.id} entry={e} queueIdx={-1} foreign={e.boardId !== activeBoardId} />
        ))}
      </div>
    </div>
  )
}
