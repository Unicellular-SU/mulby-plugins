// src/ui/components/CalcLine.tsx
import React, { useRef, useEffect, useState } from 'react'
import { CalcLine as CalcLineType } from '../store/padStore'
import { NoteTag } from './NoteTag'
import { formatResult, evaluate } from '../engine/calculator'

interface CalcLineProps {
  line: CalcLineType
  prevAns: number
  isActive: boolean
  onUpdate: (updates: Partial<CalcLineType>) => void
  onRemove: () => void
  onFocus: () => void
  onArrowUp: () => void
  onArrowDown: () => void
  onReturnToInput: () => void
}

export const CalcLine: React.FC<CalcLineProps> = ({
  line,
  prevAns,
  isActive,
  onUpdate,
  onRemove,
  onFocus,
  onArrowUp,
  onArrowDown,
  onReturnToInput
}) => {
  const [expr, setExpr] = useState(line.expression)
  const [forceEditNote, setForceEditNote] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusInput = () => {
      if (isActive && inputRef.current) {
        inputRef.current.focus()
        // Move cursor to end
        const len = inputRef.current.value.length
        inputRef.current.setSelectionRange(len, len)
      }
    }

    focusInput()
    window.addEventListener('focus', focusInput)
    return () => window.removeEventListener('focus', focusInput)
  }, [isActive])

  useEffect(() => {
    setExpr(line.expression)
  }, [line.expression])

  // Recalculate if expression or prevAns changes
  const evalRes = evaluate(expr, prevAns)
  const displayResult = evalRes.error ? (evalRes.error === 'empty' ? '' : 'Error') : formatResult(evalRes.value)

  useEffect(() => {
    if (displayResult !== 'Error' && displayResult !== '') {
      if (line.result !== evalRes.value.toString()) {
        onUpdate({ result: evalRes.value.toString() })
      }
    }
  }, [displayResult, evalRes.value, line.result])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + C
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const selection = window.getSelection()?.toString()
      if (!selection) {
        e.preventDefault()
        if (typeof window !== 'undefined' && (window as any).mulby) {
          (window as any).mulby.clipboard.writeText(line.result)
          ;(window as any).mulby.notification.show('已复制结果: ' + line.result)
        }
      }
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      onArrowUp()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      onArrowDown()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onUpdate({ expression: expr })
      onReturnToInput()
    } else if (e.key === 'Backspace' && expr === '') {
      e.preventDefault()
      onRemove()
      onArrowUp()
    } else if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      setForceEditNote(true)
    }
  }

  const handleBlur = () => {
    if (expr !== line.expression) {
      onUpdate({ expression: expr })
    }
  }

  const dateStr = new Date(line.timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).replace(/\//g, '/')

  return (
    <div className={`relative flex items-start py-3 group ${isActive ? 'bg-orange-50/50 dark:bg-orange-900/10' : ''}`} onClick={onFocus}>
      {isActive && (
        <div className="absolute left-0 top-3 bottom-3 w-1 bg-orange-400 rounded-r-md transition-all"></div>
      )}
      
      <div className="flex-1 px-6 min-w-0 flex flex-col">
        <input
          ref={inputRef}
          type="text"
          value={expr}
          onChange={e => setExpr(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          className="w-full bg-transparent outline-none font-mono text-[20px] text-gray-800 dark:text-gray-200"
          spellCheck={false}
        />
        {(line.note || isActive || forceEditNote) && (
          <NoteTag 
            note={line.note} 
            forceEdit={forceEditNote}
            onCancelForceEdit={() => setForceEditNote(false)}
            onChange={(note) => {
              setForceEditNote(false)
              onUpdate({ note })
            }} 
          />
        )}
      </div>

      <div className="flex-shrink-0 px-6 text-right flex flex-col items-end min-w-[120px]">
        <div className="text-[28px] font-mono font-bold text-gray-900 dark:text-white flex items-center justify-end">
          <span className="text-gray-400 dark:text-gray-500 font-normal mr-2">=</span>
          {displayResult}
        </div>
        <div className="text-xs text-gray-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity whitespace-pre-line text-right">
          {dateStr.split(' ').join('\n')}
        </div>
      </div>
    </div>
  )
}
