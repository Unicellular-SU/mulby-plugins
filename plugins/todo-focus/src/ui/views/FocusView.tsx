import { useCallback, useEffect, useState } from 'react'
import { Pause, Play, RotateCcw, SkipForward, X } from 'lucide-react'
import { useTodos } from '../hooks/useTodos'
import { usePomodoro, formatTimer } from '../hooks/usePomodoro'
import { useMulby } from '../hooks/useMulby'
import { DEFAULT_SETTINGS } from '../../types/todo'

const PLUGIN_ID = 'todo-focus'

const PHASE_LABEL = {
  idle: '准备专注',
  focus: '专注中',
  shortBreak: '短休息',
  longBreak: '长休息',
} as const

export default function FocusView() {
  const { todos, settings, stats, recordPomodoro, saveSettings } = useTodos()
  const { notification, window: win } = useMulby(PLUGIN_ID)
  const [showComplete, setShowComplete] = useState(false)

  const effectiveSettings = settings || DEFAULT_SETTINGS
  const activeTodos = todos.filter((t) => !t.done)
  const activeId = effectiveSettings.activeTodoId !== undefined 
    ? effectiveSettings.activeTodoId 
    : (activeTodos.find((t) => t.pinned)?.id || activeTodos[0]?.id)
  const activeTodo = activeTodos.find((t) => t.id === activeId)

  const pomodoroCount = activeTodo?.focusMinutes
    ? Math.floor(activeTodo.focusMinutes / effectiveSettings.pomodoroMinutes)
    : 0

  const onComplete = useCallback(
    (phase: string, completedFocus: boolean) => {
      if (completedFocus) {
        void recordPomodoro(activeId, effectiveSettings.pomodoroMinutes)
        setShowComplete(true)
        setTimeout(() => setShowComplete(false), 1500)
        notification.show('专注完成，休息一下吧', 'success')
      } else if (phase === 'shortBreak' || phase === 'longBreak') {
        notification.show('休息结束，继续加油', 'info')
      }
    },
    [recordPomodoro, activeId, effectiveSettings.pomodoroMinutes, notification]
  )

  const { phase, remaining, running, progress, toggle, reset, skipBreak } = usePomodoro(effectiveSettings, onComplete)

  const isBreak = phase === 'shortBreak' || phase === 'longBreak'

  useEffect(() => {
    void win?.setBackgroundThrottling?.(false)
    void win?.setSize?.(400, 600)
    return () => {
      void win?.setBackgroundThrottling?.(true)
    }
  }, [win])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); reset() }
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); skipBreak() }
      if (e.key === 'Escape') { void win?.close?.() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, reset, skipBreak, win])

  const circumference = 2 * Math.PI * 100
  const dashOffset = circumference * (1 - progress)

  return (
    <div className="focus-view">
      <header className="focus-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span>{PHASE_LABEL[phase]}</span>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} className="flex items-center gap-2">
          <span className="focus-stats">
            今日 {stats?.pomodoroToday ?? 0} 番茄
          </span>
          <button type="button" className="btn-icon" onClick={() => void win?.close?.()} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="focus-task">
        <label htmlFor="focus-todo">当前任务</label>
        <select
          id="focus-todo"
          className="input select"
          value={activeId || ''}
          onChange={(e) => void saveSettings({ activeTodoId: e.target.value })}
        >
          <option value="">无绑定任务</option>
          {activeTodos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {activeTodo && (
          <>
            <p className="focus-task-name">{activeTodo.title}</p>
            <p className="focus-task-count">已专注 {pomodoroCount} 个番茄 · {((activeTodo.focusMinutes || 0) / 60).toFixed(1)}小时</p>
          </>
        )}
      </div>

      <div className={`focus-timer ${showComplete ? 'focus-timer--complete' : ''} ${running ? 'focus-timer--running' : ''}`}>
        <svg className="focus-ring" viewBox="0 0 220 220" aria-hidden>
          <circle className="focus-ring__bg" cx="110" cy="110" r="100" />
          <circle
            className={`focus-ring__fg ${isBreak ? 'focus-ring__fg--break' : ''}`}
            cx="110"
            cy="110"
            r="100"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
          />
        </svg>
        {showComplete ? (
          <div className="focus-complete-check">
            <svg width="48" height="48" viewBox="0 0 48 48">
              <path
                className="focus-check-path"
                d="M12 24L21 33L36 15"
                fill="none"
                stroke="#22c55e"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        ) : (
          <div className="focus-time">
            {formatTimer(phase === 'idle' ? effectiveSettings.pomodoroMinutes * 60 : remaining)}
          </div>
        )}
      </div>

      <div className="focus-actions">
        <button type="button" className="btn-focus" onClick={toggle} aria-label={running ? '暂停' : '开始'} title="开始/暂停 (Space)">
          {running ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
        </button>
        <button type="button" className="btn-ghost" onClick={reset} aria-label="重置" title="重置 (R)">
          <RotateCcw size={22} />
        </button>
        {isBreak && (
          <button type="button" className="btn-ghost" onClick={skipBreak} aria-label="跳过休息" title="跳过休息 (S)">
            <SkipForward size={22} />
          </button>
        )}
      </div>

      <p className="focus-hint">Space 开始/暂停 · R 重置 · S 跳过休息 · Esc 关闭</p>
    </div>
  )
}
