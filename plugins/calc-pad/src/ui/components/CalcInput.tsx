// src/ui/components/CalcInput.tsx
import React, { useState, useRef, useEffect } from 'react'
import { evaluate, formatResult } from '../engine/calculator'

interface CalcInputProps {
  prevAns: number
  isActive: boolean
  onAddLine: (expr: string, result: string) => void
  onArrowUp: () => void
  onFocus: () => void
}

export const CalcInput: React.FC<CalcInputProps> = ({
  prevAns,
  isActive,
  onAddLine,
  onArrowUp,
  onFocus
}) => {
  const [expr, setExpr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const focusInput = () => {
      if (isActive && inputRef.current) {
        inputRef.current.focus()
      }
    }

    focusInput()
    window.addEventListener('focus', focusInput)
    return () => window.removeEventListener('focus', focusInput)
  }, [isActive])

  const evalRes = evaluate(expr, prevAns)
  const displayResult = evalRes.error ? (evalRes.error === 'empty' ? '' : 'Error') : formatResult(evalRes.value)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl + C
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const selection = window.getSelection()?.toString()
      if (!selection) {
        e.preventDefault()
        const resultVal = evalRes.error ? '0' : evalRes.value.toString()
        if (typeof window !== 'undefined' && (window as any).mulby) {
          (window as any).mulby.clipboard.writeText(resultVal)
          ;(window as any).mulby.notification.show('已复制当前结果: ' + resultVal)
        }
      }
      return
    }

    if (e.key === 'Enter') {
      e.preventDefault()
      if (expr.trim()) {
        const resultVal = evalRes.error ? '0' : evalRes.value.toString()
        onAddLine(expr, resultVal)
        setExpr('')
      } else if (prevAns !== 0) {
        // Just enter with no input: pull previous answer
        setExpr(formatResult(prevAns).replace(/,/g, ''))
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onArrowUp()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value
    // Auto-prepend 'ans' if user starts with an operator on an empty line
    if (expr === '' && prevAns !== 0 && /^[+\-*/^%×÷]/.test(val)) {
      val = 'ans' + val
    }
    setExpr(val)
  }

  return (
    <div className={`relative flex items-center py-4 bg-orange-100/50 dark:bg-orange-900/20`} onClick={onFocus}>
      {isActive && (
        <div className="absolute left-0 top-3 bottom-3 w-1 bg-orange-500 rounded-r-md"></div>
      )}
      
      <div className="flex-1 px-6 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={expr}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="计算公式"
          className="w-full bg-transparent outline-none font-mono text-[20px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400"
          spellCheck={false}
        />
      </div>

      <div className="flex-shrink-0 px-6 text-right min-w-[120px]">
        <div className="text-[28px] font-mono font-bold text-gray-400 dark:text-gray-500 flex items-center justify-end">
          <span className="font-normal mr-2">=</span>
          {displayResult || <span className="opacity-0">0</span>}
        </div>
      </div>
    </div>
  )
}
