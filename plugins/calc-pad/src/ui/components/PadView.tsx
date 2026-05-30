// src/ui/components/PadView.tsx
import React, { useState, useEffect, useRef } from 'react'
import { CalcLine as CalcLineType } from '../store/padStore'
import { CalcLine } from './CalcLine'
import { CalcInput } from './CalcInput'

interface PadViewProps {
  lines: CalcLineType[]
  onAddLine: (expr: string, result: string) => void
  onUpdateLine: (id: string, updates: Partial<CalcLineType>) => void
  onRemoveLine: (id: string) => void
}

export const PadView: React.FC<PadViewProps> = ({
  lines,
  onAddLine,
  onUpdateLine,
  onRemoveLine
}) => {
  // -1 means input row is active
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // When a new line is added, we typically stay at input
    // If lines array length changed significantly, scroll to bottom
    if (containerRef.current && activeIndex === -1) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [lines.length, activeIndex])

  const handleArrowUp = (currentIndex: number) => {
    if (currentIndex === -1) {
      if (lines.length > 0) setActiveIndex(lines.length - 1)
    } else if (currentIndex > 0) {
      setActiveIndex(currentIndex - 1)
    }
  }

  const handleArrowDown = (currentIndex: number) => {
    if (currentIndex === -1) return
    if (currentIndex < lines.length - 1) {
      setActiveIndex(currentIndex + 1)
    } else {
      setActiveIndex(-1)
    }
  }

  let runningAns = 0

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto pb-20 pt-4 custom-scrollbar scroll-smooth">
      {lines.map((line, index) => {
        const prevAns = runningAns
        const numResult = Number(line.result)
        if (!isNaN(numResult)) {
          runningAns = numResult
        }

        return (
          <CalcLine
            key={line.id}
            line={line}
            prevAns={prevAns}
            isActive={activeIndex === index}
            onFocus={() => setActiveIndex(index)}
            onUpdate={(updates) => onUpdateLine(line.id, updates)}
            onRemove={() => onRemoveLine(line.id)}
            onArrowUp={() => handleArrowUp(index)}
            onArrowDown={() => handleArrowDown(index)}
            onReturnToInput={() => setActiveIndex(-1)}
          />
        )
      })}

      <CalcInput
        prevAns={runningAns}
        isActive={activeIndex === -1}
        onFocus={() => setActiveIndex(-1)}
        onArrowUp={() => handleArrowUp(-1)}
        onAddLine={(expr, res) => {
          onAddLine(expr, res)
          setActiveIndex(-1)
        }}
      />
    </div>
  )
}
