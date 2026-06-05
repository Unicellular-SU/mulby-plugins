import { useEffect, useRef } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  ChevronRight,
  Replace,
  ReplaceAll,
  WholeWord,
  X
} from 'lucide-react'

export type FindReplaceMode = 'find' | 'replace'

interface FindReplaceBarProps {
  open: boolean
  mode: FindReplaceMode
  query: string
  replacement: string
  caseSensitive: boolean
  wholeWord: boolean
  matchCount: number
  currentIndex: number
  onQueryChange: (value: string) => void
  onReplacementChange: (value: string) => void
  onToggleCaseSensitive: () => void
  onToggleWholeWord: () => void
  onToggleMode: () => void
  onNext: () => void
  onPrev: () => void
  onReplaceOne: () => void
  onReplaceAll: () => void
  onClose: () => void
}

export function FindReplaceBar({
  open,
  mode,
  query,
  replacement,
  caseSensitive,
  wholeWord,
  matchCount,
  currentIndex,
  onQueryChange,
  onReplacementChange,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onToggleMode,
  onNext,
  onPrev,
  onReplaceOne,
  onReplaceAll,
  onClose
}: FindReplaceBarProps) {
  const findInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      findInputRef.current?.focus()
      findInputRef.current?.select()
    }
  }, [open])

  if (!open) {
    return null
  }

  const countLabel = query ? (matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : '无结果') : ''

  const handleFindKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) {
        onPrev()
      } else {
        onNext()
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  const handleReplaceKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onReplaceOne()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <div className="find-replace-bar" role="search">
      <button
        type="button"
        className={`find-toggle-mode ${mode === 'replace' ? 'expanded' : ''}`}
        title={mode === 'find' ? '展开替换' : '收起替换'}
        aria-label={mode === 'find' ? '展开替换' : '收起替换'}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleMode}
      >
        <ChevronRight size={14} />
      </button>

      <div className="find-replace-fields">
        <div className="find-row">
          <input
            ref={findInputRef}
            type="text"
            className="find-input"
            placeholder="查找"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleFindKeyDown}
          />
          <span className="find-count">{countLabel}</span>
          <button
            type="button"
            className={`find-flag-btn ${caseSensitive ? 'active' : ''}`}
            title="区分大小写"
            aria-label="区分大小写"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onToggleCaseSensitive}
          >
            <CaseSensitive size={15} />
          </button>
          <button
            type="button"
            className={`find-flag-btn ${wholeWord ? 'active' : ''}`}
            title="全词匹配"
            aria-label="全词匹配"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onToggleWholeWord}
          >
            <WholeWord size={15} />
          </button>
          <button
            type="button"
            className="find-nav-btn"
            title="上一处 (Shift+Enter)"
            aria-label="上一处"
            disabled={matchCount === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onPrev}
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            className="find-nav-btn"
            title="下一处 (Enter)"
            aria-label="下一处"
            disabled={matchCount === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onNext}
          >
            <ArrowDown size={15} />
          </button>
          <button
            type="button"
            className="find-nav-btn find-close-btn"
            title="关闭 (Esc)"
            aria-label="关闭查找"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>

        {mode === 'replace' && (
          <div className="find-row">
            <input
              type="text"
              className="find-input"
              placeholder="替换为"
              value={replacement}
              onChange={(event) => onReplacementChange(event.target.value)}
              onKeyDown={handleReplaceKeyDown}
            />
            <button
              type="button"
              className="find-nav-btn"
              title="替换当前"
              aria-label="替换当前"
              disabled={matchCount === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onReplaceOne}
            >
              <Replace size={15} />
            </button>
            <button
              type="button"
              className="find-nav-btn"
              title="全部替换"
              aria-label="全部替换"
              disabled={matchCount === 0}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onReplaceAll}
            >
              <ReplaceAll size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
