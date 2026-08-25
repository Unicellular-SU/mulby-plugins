/**
 * 行内可编辑文本 InlineEdit —— 点击文本变输入；Enter 提交、Esc 取消、失焦提交（空/未变则保持原值）。
 * 对外 value/onChange:string。规格 docs §5.1；样式见 styles.css「InlineEdit」。
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export interface InlineEditProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}

export default function InlineEdit({ value, onChange, placeholder, ariaLabel, className }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  // 进入编辑时以当前 value 初始化并聚焦全选（仅在 editing 切到 true 时）
  useEffect(() => {
    if (editing) {
      setDraft(value)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const commit = () => {
    const t = draft.trim()
    if (t && t !== value) onChange(t)
    setEditing(false)
  }
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`afs-inlineedit__input${className ? ' ' + className : ''}`}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
      />
    )
  }
  return (
    <button type="button" className={`afs-inlineedit${className ? ' ' + className : ''}`} title="点击编辑" aria-label={ariaLabel} onClick={() => setEditing(true)}>
      {value || <span className="afs-inlineedit__ph">{placeholder}</span>}
    </button>
  )
}
