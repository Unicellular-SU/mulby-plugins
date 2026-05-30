import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Circle, GripVertical, X } from 'lucide-react'
import { useTodos } from '../hooks/useTodos'
import { useMulby } from '../hooks/useMulby'
import PriorityDot from '../components/PriorityDot'
import DueBadge from '../components/DueBadge'
import { sortTodos } from '../../store/parseQuickCapture'
import ChecklistPanel from '../components/ChecklistPanel'

const PLUGIN_ID = 'todo-focus'

export default function StickyView() {
  const { todos, loading, toggleDone, addTodo, reorderTodos, toggleChecklistItem, addChecklistItem, removeChecklistItem } = useTodos()
  const { window: win, notification } = useMulby(PLUGIN_ID)

  const [newTitle, setNewTitle] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const open = sortTodos(todos).filter((t) => !t.done)

  useEffect(() => {
    void win?.setAlwaysOnTop?.(true)
    void win?.setSize?.(320, 480)
    void win?.setBackgroundThrottling?.(false)
  }, [win])

  const handleAdd = useCallback(async () => {
    const title = newTitle.trim()
    if (!title) return
    await addTodo(title)
    setNewTitle('')
    notification.show('已添加', 'success')
  }, [newTitle, addTodo, notification])

  const handleDragStart = (idx: number) => {
    setDragIdx(idx)
  }

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    setDragOverIdx(idx)
  }

  const handleDrop = (idx: number) => {
    if (dragIdx === null || dragIdx === idx) {
      setDragIdx(null)
      setDragOverIdx(null)
      return
    }
    const next = [...open]
    const [moved] = next.splice(dragIdx, 1)
    if (moved) {
      next.splice(idx, 0, moved)
      void reorderTodos(next.map((item) => item.id))
    }
    setDragIdx(null)
    setDragOverIdx(null)
  }

  if (loading) {
    return <div className="sticky-view loading">加载中…</div>
  }

  return (
    <div className="sticky-view">
      <header className="sticky-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <h1>待办便签</h1>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className="flex items-center gap-2">
          <span className="sticky-count">{open.length} 项</span>
          <button type="button" className="btn-icon" onClick={() => void win?.close?.()} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
      </header>

      <input
        className="sticky-input"
        placeholder="快速添加…"
        value={newTitle}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleAdd()
          if (e.key === 'Escape') setNewTitle('')
        }}
      />

      {open.length === 0 ? (
        <p className="sticky-empty">暂无未完成待办</p>
      ) : (
        <ul className="sticky-list">
          {open.map((item, idx) => {
            const hasChecklist = item.checklist && item.checklist.length > 0
            const checklistDone = hasChecklist ? item.checklist!.filter((c) => c.done).length : 0
            const isExpanded = expandedId === item.id

            return (
              <li
                key={item.id}
                className={`sticky-li ${dragOverIdx === idx ? 'drag-over' : ''}`}
                draggable
                style={{ flexDirection: 'column', alignItems: 'stretch' }}
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null) }}
              >
                <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                  <span className="sticky-grip">
                    <GripVertical size={12} />
                  </span>
                  <div className="sticky-row">
                <button
                  type="button"
                  className="sticky-check"
                  style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
                  onClick={(e) => { e.stopPropagation(); void toggleDone(item.id) }}
                  aria-label="完成"
                >
                  {item.done ? <Check size={14} /> : <Circle size={14} />}
                </button>
                <PriorityDot priority={item.priority} size={6} />
                <span 
                  className="sticky-title" 
                  style={{ cursor: hasChecklist ? 'pointer' : 'default' }}
                  onClick={() => hasChecklist && setExpandedId(isExpanded ? null : item.id)}
                >
                  {item.title}
                </span>
                {hasChecklist && (
                  <span className={`todo-checklist-badge ${checklistDone === item.checklist!.length ? 'complete' : ''}`}>
                    {checklistDone}/{item.checklist!.length}
                  </span>
                )}
                {hasChecklist && (
                  <button
                    type="button"
                    className="btn-icon"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : item.id) }}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
                <DueBadge dueDate={item.dueDate} done={item.done} />
              </div>
            </div>
              {isExpanded && (
                <div className="checklist-fullpage" style={{ margin: '4px 12px 12px 32px' }}>
                  <ChecklistPanel
                    items={item.checklist || []}
                    onToggle={(cid) => void toggleChecklistItem(item.id, cid)}
                    onAdd={(text) => void addChecklistItem(item.id, text)}
                    onRemove={(cid) => void removeChecklistItem(item.id, cid)}
                  />
                </div>
              )}
            </li>
          )})}
        </ul>
      )}

      <footer className="sticky-footer">拖拽排序 · 点击圆圈完成</footer>
    </div>
  )
}
