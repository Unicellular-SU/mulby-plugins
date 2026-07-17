// 画布上的内联文字/编号编辑器（从 App.tsx 搬移，blur 提交定时器收进组件内部）。

import { useEffect, useRef } from 'react'
import { STEP_LABEL_MAX_LENGTH } from '../annotations/constants'
import type { InlineStepEdit, InlineTextEdit } from '../annotations/types'

export interface InlineEditorPosition {
  left: number
  top: number
  width: number
  height: number
  fontSize: number
}

interface InlineTextEditorProps {
  edit: InlineTextEdit
  position: InlineEditorPosition
  onTextChange: (text: string) => void
  onCommit: () => void
  onCancel: () => void
}

export function InlineTextEditor({ edit, position, onTextChange, onCommit, onCancel }: InlineTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => textareaRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
    }
  }, [])

  const clearBlurTimer = () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
  }

  return (
    <textarea
      ref={textareaRef}
      className="inline-text-editor"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.height,
        fontSize: position.fontSize,
        color: edit.color,
        minWidth: Math.max(120, position.fontSize * 4)
      }}
      value={edit.text}
      onChange={(event) => onTextChange(event.target.value)}
      onBlur={() => {
        blurTimerRef.current = setTimeout(() => {
          blurTimerRef.current = null
          onCommit()
        }, 80)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          clearBlurTimer()
          onCancel()
        }
        event.stopPropagation()
      }}
      placeholder="输入文字"
    />
  )
}

interface InlineStepEditorProps {
  edit: InlineStepEdit
  position: InlineEditorPosition
  onValueChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}

export function InlineStepEditor({ edit, position, onValueChange, onCommit, onCancel }: InlineStepEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
    }
  }, [])

  const clearBlurTimer = () => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
  }

  return (
    <input
      ref={inputRef}
      className="inline-step-editor"
      style={{
        left: position.left,
        top: position.top,
        width: position.width,
        height: position.height,
        fontSize: position.fontSize,
        backgroundColor: edit.color
      }}
      value={edit.value}
      maxLength={STEP_LABEL_MAX_LENGTH}
      onChange={(event) => onValueChange(event.target.value.slice(0, STEP_LABEL_MAX_LENGTH))}
      onBlur={() => {
        blurTimerRef.current = setTimeout(() => {
          blurTimerRef.current = null
          onCommit()
        }, 80)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          clearBlurTimer()
          onCommit()
        }
        if (event.key === 'Escape') {
          clearBlurTimer()
          onCancel()
        }
        event.stopPropagation()
      }}
    />
  )
}
