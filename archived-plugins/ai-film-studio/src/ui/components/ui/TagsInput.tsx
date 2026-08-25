/**
 * 标签输入 TagsInput —— 可移除标签 pill + 行内输入。Enter/逗号 提交，空输入 Backspace 删末尾。
 * 对外 value/onChange:string[]（去重、trim）。规格 docs §5.1；样式见 styles.css「TagsInput」。
 */
import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X } from 'lucide-react'

export interface TagsInputProps {
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
}

export default function TagsInput({ value, onChange, placeholder, ariaLabel, className }: TagsInputProps) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const t = draft.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setDraft('')
  }
  const removeAt = (i: number) => onChange(value.filter((_, k) => k !== i))
  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div
      className={`afs-tagsinput${className ? ' ' + className : ''}`}
      onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
    >
      {value.map((tag, i) => (
        <span className="afs-tagsinput__tag" key={tag}>
          {tag}
          <button
            type="button"
            className="afs-tagsinput__rm"
            aria-label={`移除 ${tag}`}
            onClick={(e) => {
              e.stopPropagation()
              removeAt(i)
            }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        className="afs-tagsinput__input"
        value={draft}
        placeholder={value.length === 0 ? placeholder : undefined}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
      />
    </div>
  )
}
