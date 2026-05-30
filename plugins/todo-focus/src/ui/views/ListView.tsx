import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, Check, ChevronDown, ChevronRight, Circle, HelpCircle, Pin, Sparkles, Timer, Trash2, X, Zap } from 'lucide-react'
import type { TodoItem } from '../../types/todo'
import { useTodos } from '../hooks/useTodos'
import { parseTodoText, sortTodos } from '../../store/parseQuickCapture'
import AiAssistPanel from '../components/AiAssistPanel'
import PriorityDot from '../components/PriorityDot'
import DueBadge from '../components/DueBadge'
import UndoToast from '../components/UndoToast'
import PriorityPicker from '../components/PriorityPicker'
import DatePicker from '../components/DatePicker'
import ChecklistPanel from '../components/ChecklistPanel'
import StatsView from './StatsView'
import { useMulby } from '../hooks/useMulby'

const PLUGIN_ID = 'todo-focus'

type FilterMode = 'all' | 'active' | 'done' | 'stats'

interface ListViewProps {
  initialInput?: string
}

export default function ListView({ initialInput = '' }: ListViewProps) {
  const {
    todos,
    settings,
    stats,
    loading,
    addTodo,
    updateTodo,
    removeTodo,
    toggleDone,
    saveSettings,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
  } = useTodos()
  const { plugin, notification, window: win } = useMulby(PLUGIN_ID)

  const [newTitle, setNewTitle] = useState(initialInput)
  const [newPriority, setNewPriority] = useState<'high' | 'medium' | 'low' | undefined>()
  const [newDueDate, setNewDueDate] = useState<number | undefined>()
  const [showPriorityPicker, setShowPriorityPicker] = useState(false)
  const [showDatePicker, setShowDatePicker] = useState(false)

  const [filter, setFilter] = useState<FilterMode>('active')
  const [filterText, setFilterText] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [showHelp, setShowHelp] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  const [undoItem, setUndoItem] = useState<TodoItem | null>(null)

  const newInputRef = useRef<HTMLInputElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)

  const sorted = useMemo(() => sortTodos(todos), [todos])

  const filtered = useMemo(() => {
    let list = sorted
    if (filter === 'active') list = list.filter((t) => !t.done)
    if (filter === 'done') list = list.filter((t) => t.done)
    const q = filterText.trim().toLowerCase()
    if (q) list = list.filter((t) => t.title.toLowerCase().includes(q))
    return list
  }, [sorted, filter, filterText])

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1))
    }
  }, [filtered.length, activeIndex])

  const submitNew = useCallback(async () => {
    const parsed = parseTodoText(newTitle)
    if (!parsed) return
    await addTodo(
      parsed.title,
      undefined,
      newPriority ?? parsed.priority,
      newDueDate ?? parsed.dueDate
    )
    setNewTitle('')
    setNewPriority(undefined)
    setNewDueDate(undefined)
    notification.show('已添加', 'success')
    newInputRef.current?.focus()
  }, [addTodo, newTitle, newPriority, newDueDate, notification])

  const startEdit = useCallback((item: TodoItem) => {
    setEditingId(item.id)
    setEditTitle(item.title)
    setTimeout(() => editRef.current?.focus(), 0)
  }, [])

  const commitEdit = useCallback(async () => {
    if (!editingId) return
    const title = editTitle.trim()
    if (title) await updateTodo(editingId, { title })
    setEditingId(null)
  }, [editingId, editTitle, updateTodo])

  const handleDelete = useCallback(
    (id: string, force = false) => {
      if (!force && pendingDeleteId !== id) {
        setPendingDeleteId(id)
        notification.show('再按 d 确认删除', 'info')
        return
      }
      const item = todos.find((t) => t.id === id)
      if (!item) return

      if (undoItem) {
        void removeTodo(undoItem.id)
      }

      setUndoItem(item)
      setPendingDeleteId(null)
    },
    [pendingDeleteId, todos, undoItem, removeTodo, notification]
  )

  const handleUndo = useCallback(() => {
    setUndoItem(null)
  }, [])

  const handleUndoExpire = useCallback(() => {
    if (undoItem) {
      void removeTodo(undoItem.id)
    }
    setUndoItem(null)
  }, [undoItem, removeTodo])

  const filteredWithUndo = useMemo(() => {
    if (!undoItem) return filtered
    return filtered.filter((t) => t.id !== undoItem.id)
  }, [filtered, undoItem])

  const openFeature = useCallback(
    async (featureCode: string) => {
      try {
        await plugin.run?.(PLUGIN_ID, featureCode)
      } catch {
        notification.show(`请在 Mulby 中搜索「${featureCode === 'sticky' ? '便签' : '专注'}」打开`, 'info')
      }
    },
    [plugin, notification]
  )

  const handleImport = useCallback(
    async (titles: string[]) => {
      for (const title of titles) {
        await addTodo(title)
      }
    },
    [addTodo]
  )

  const handleModelChange = useCallback(
    (id: string) => {
      void saveSettings({ aiModelId: id })
    },
    [saveSettings]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (filterOpen && e.key === 'Escape') {
        setFilterOpen(false)
        return
      }

      if (editingId) {
        if (e.key === 'Enter') { e.preventDefault(); void commitEdit() }
        if (e.key === 'Escape') setEditingId(null)
        return
      }

      if (inInput && !e.altKey && !(e.key === '/' && !filterOpen)) return

      const mod = e.metaKey || e.ctrlKey

      if (mod && e.key === 'z' && undoItem) {
        e.preventDefault()
        handleUndo()
        return
      }

      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newInputRef.current?.focus()
        return
      }

      if (e.key === '?' && !inInput) { e.preventDefault(); setShowHelp((h) => !h); return }
      if (e.key === 'n' && !inInput) { e.preventDefault(); newInputRef.current?.focus(); return }
      if (e.key === '/' && !inInput) { e.preventDefault(); setFilterOpen(true); setTimeout(() => filterRef.current?.focus(), 0); return }
      if (e.key === 'f' && !inInput) { e.preventDefault(); void openFeature('focus'); return }
      if (e.key === 's' && !inInput) { e.preventDefault(); void openFeature('sticky'); return }
      if (e.key === '1' && !inInput) { setFilter('all'); return }
      if (e.key === '2' && !inInput) { setFilter('active'); return }
      if (e.key === '3' && !inInput) { setFilter('done'); return }
      if (e.key === '4' && !inInput) { setFilter('stats'); return }

      if (filter === 'stats') return
      if (!filteredWithUndo.length) return

      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, filteredWithUndo.length - 1)); return }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return }

      const current = filteredWithUndo[activeIndex]
      if (!current) return

      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); void toggleDone(current.id); return }
      if (e.key === 'e') { e.preventDefault(); startEdit(current); return }
      if (e.key === 'd') { e.preventDefault(); handleDelete(current.id, e.shiftKey); return }
      if (e.key === 'p') {
        e.preventDefault()
        void (async () => {
          await updateTodo(current.id, { pinned: !current.pinned })
          await saveSettings({ activeTodoId: current.id })
        })()
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        setExpandedId((prev) => prev === current.id ? null : current.id)
        return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    filtered, filteredWithUndo, activeIndex, editingId, filterOpen, filter, undoItem,
    commitEdit, toggleDone, startEdit, handleDelete, handleUndo, updateTodo, saveSettings, openFeature,
  ])

  if (loading) {
    return <div className="loading">加载中…</div>
  }

  return (
    <div className="list-view">
      <header className="header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div className="header-main">
          <h1 className="header-title">待办番茄</h1>
          <p className="header-sub">
            今日番茄 {stats?.pomodoroToday ?? 0} · 专注 {stats?.focusMinutesToday ?? 0} 分钟
          </p>
        </div>
        <div className="header-actions" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setAiOpen(true)}>
            <Sparkles size={14} />
            AI 助手
          </button>
          <button type="button" className="btn-ghost" onClick={() => setShowHelp((h) => !h)} aria-label="快捷键">
            <HelpCircle size={18} />
          </button>
          <button type="button" className="btn-icon" onClick={() => void win?.close?.()} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
      </header>

      {showHelp && (
        <div className="help-bar">
          n 新建 · j/k 移动 · Enter/Space 完成 · e 编辑 · d 删除 · p 置顶 · Tab 子任务 · / 搜索 · f 专注 · s 便签 · 1/2/3/4 筛选
        </div>
      )}

      <div className="composer">
        <div className="composer__row">
          <input
            ref={newInputRef}
            className="input"
            placeholder="添加待办… 支持 !优先级 @截止日期"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNew()
              if (e.key === 'Escape') setNewTitle('')
            }}
          />
          {newPriority && (
            <span className={`composer__tag composer__tag--priority-${newPriority}`} onClick={() => setNewPriority(undefined)}>
              <Zap size={11} className="composer__tag-icon" />
              {newPriority === 'high' ? '高' : newPriority === 'medium' ? '中' : '低'} ×
            </span>
          )}
          {newDueDate && (
            <span className="composer__tag composer__tag--date" onClick={() => setNewDueDate(undefined)}>
              <Calendar size={11} className="composer__tag-icon" />
              {new Date(newDueDate).getMonth() + 1}/{new Date(newDueDate).getDate()} ×
            </span>
          )}
          <button type="button" className="btn-primary" onClick={() => void submitNew()}>
            添加
          </button>
        </div>
        {newTitle.length > 0 && (
          <div className="composer__options">
            <div className="composer__option-wrapper">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setShowDatePicker((v) => !v)}>
                <Calendar size={14} />
                日期
              </button>
              {showDatePicker && <DatePicker value={newDueDate} onChange={setNewDueDate} onClose={() => setShowDatePicker(false)} />}
            </div>
            <div className="composer__option-wrapper">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setShowPriorityPicker((v) => !v)}>
                <Zap size={14} />
                优先级
              </button>
              {showPriorityPicker && <PriorityPicker value={newPriority} onChange={setNewPriority} onClose={() => setShowPriorityPicker(false)} />}
            </div>
          </div>
        )}
      </div>

      {filterOpen && (
        <input
          ref={filterRef}
          className="input filter-input"
          style={{ flex: 'none' }}
          placeholder="过滤待办…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setFilterOpen(false)
              setFilterText('')
              e.preventDefault()
              e.stopPropagation()
            }
          }}
        />
      )}

      <div className="tabs" role="tablist">
        {(['all', 'active', 'done', 'stats'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={filter === mode}
            className={`tab ${filter === mode ? 'active' : ''}`}
            onClick={() => setFilter(mode)}
          >
            {mode === 'all' ? '全部' : mode === 'active' ? '进行中' : mode === 'done' ? '已完成' : '统计'}
          </button>
        ))}
      </div>

      {filter === 'stats' ? (
        <StatsView stats={stats} />
      ) : (
        <>
          <ul className="todo-list" role="listbox" aria-label="待办列表">
            {filteredWithUndo.length === 0 ? (
              <li className="empty">暂无待办，按 n 开始添加</li>
            ) : (
              filteredWithUndo.map((item, index) => {
                const isOverdue = !item.done && item.dueDate && item.dueDate < new Date().setHours(0, 0, 0, 0)
                const hasChecklist = item.checklist && item.checklist.length > 0
                const checklistDone = hasChecklist ? item.checklist!.filter((c) => c.done).length : 0
                const isExpanded = expandedId === item.id

                return (
                  <li key={item.id}>
                    <div
                      id={`todo-${item.id}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={`todo-item ${index === activeIndex ? 'active' : ''} ${item.done ? 'done' : ''} ${isOverdue ? 'overdue' : ''} ${pendingDeleteId === item.id ? 'pending-delete' : ''}`}
                      onClick={() => setActiveIndex(index)}
                      onDoubleClick={() => startEdit(item)}
                    >
                      <button
                        type="button"
                        className="todo-check"
                        onClick={(e) => { e.stopPropagation(); void toggleDone(item.id) }}
                        aria-label={item.done ? '标为未完成' : '完成'}
                      >
                        {item.done ? <Check size={16} /> : <Circle size={16} />}
                      </button>

                      <PriorityDot priority={item.priority} />

                      {editingId === item.id ? (
                        <input
                          ref={editRef}
                          className="input todo-edit"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => void commitEdit()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void commitEdit()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                        />
                      ) : (
                        <span className="todo-title">
                          {item.pinned && <Pin size={12} className="pin-icon" />}
                          {item.title}
                        </span>
                      )}

                      <div className="todo-meta">
                        <DueBadge dueDate={item.dueDate} done={item.done} />
                        {item.focusMinutes && item.focusMinutes > 0 && (
                          <span className="todo-pomodoro" title={`已专注 ${item.focusMinutes} 分钟`}>
                            <Timer size={12} />
                            ×{Math.floor(item.focusMinutes / (settings?.pomodoroMinutes || 25)) || 1}
                          </span>
                        )}
                        {hasChecklist && (
                          <span className={`todo-checklist-badge ${checklistDone === item.checklist!.length ? 'complete' : ''}`}>
                            {checklistDone}/{item.checklist!.length}
                          </span>
                        )}
                        {hasChecklist && (
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : item.id) }}
                            aria-expanded={isExpanded}
                            aria-label="展开子任务"
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        className="btn-icon todo-delete"
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id, e.shiftKey) }}
                        aria-label="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {isExpanded && (
                      <ChecklistPanel
                        items={item.checklist || []}
                        onToggle={(cid) => void toggleChecklistItem(item.id, cid)}
                        onAdd={(text) => void addChecklistItem(item.id, text)}
                        onRemove={(cid) => void removeChecklistItem(item.id, cid)}
                      />
                    )}
                  </li>
                )
              })
            )}
          </ul>

        </>
      )}

      {aiOpen && (
        <>
          <div className="ai-drawer-backdrop" onClick={() => setAiOpen(false)} />
          <aside className="ai-drawer" aria-label="AI 助手抽屉">
            <div className="ai-drawer__head">
              <div className="ai-drawer__title">
                <Sparkles size={16} />
                <span>AI 助手</span>
              </div>
              <button type="button" className="btn-icon" onClick={() => setAiOpen(false)} aria-label="关闭 AI 助手">
                <X size={16} />
              </button>
            </div>
            <AiAssistPanel
              todos={todos}
              modelId={settings?.aiModelId || ''}
              onModelChange={handleModelChange}
              onImport={handleImport}
            />
          </aside>
        </>
      )}

      {undoItem && (
        <UndoToast
          item={undoItem}
          onUndo={handleUndo}
          onExpire={handleUndoExpire}
        />
      )}
    </div>
  )
}
