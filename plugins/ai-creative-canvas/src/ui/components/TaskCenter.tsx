import { X, Loader2, Ban, RotateCw, Clock, Volume2, VolumeX } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { KIND_ACCENT, KIND_LABEL, type Card } from '../types'
import { stopCard, generateCard, canGenerate } from '../services/generate'
import { focusCard } from '../focusCard'

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
        canGenerate(card.kind) && (
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
  for (const b of project.boards) {
    for (const c of Object.values(b.cards)) {
      const e: Entry = { card: c, boardId: b.id, boardName: b.name }
      if (c.status === 'running') running.push(e)
      else if (c.status === 'queued') queued.push(e)
      else if (c.status === 'error') failed.push(e)
    }
  }
  const close = () => useUi.getState().setShowTaskCenter(false)
  const empty = running.length + queued.length + failed.length === 0

  return (
    <div data-interactive className="fixed top-12 right-3 z-40 w-72 max-h-[72vh] ace-glass ace-anim-scale flex flex-col">
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
