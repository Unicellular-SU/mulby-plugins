/**
 * 单选组 Radio —— role=radiogroup + 自绘圆点；漫游 tabindex + ←→↑↓ 方向键（移动即选中，跳过 disabled）。
 * 对外 value/onChange:string。规格 docs §5.1；样式见 styles.css「Radio」。
 */
import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

export interface RadioOption {
  value: string
  label: ReactNode
  disabled?: boolean
}

export interface RadioProps {
  value: string
  onChange: (value: string) => void
  options: RadioOption[]
  ariaLabel?: string
  orientation?: 'vertical' | 'horizontal'
  className?: string
}

export default function Radio({ value, onChange, options, ariaLabel, orientation = 'vertical', className }: RadioProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const activeIdx = options.findIndex((o) => o.value === value)
  const firstEnabled = options.findIndex((o) => !o.disabled)
  const rover = activeIdx === -1 || options[activeIdx]?.disabled ? firstEnabled : activeIdx

  const nextEnabled = (start: number, dir: 1 | -1) => {
    const n = options.length
    let i = start
    for (let c = 0; c < n; c++) {
      i = (i + dir + n) % n
      if (!options[i].disabled) return i
    }
    return start
  }
  const onKey = (e: ReactKeyboardEvent, idx: number) => {
    let t = -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') t = nextEnabled(idx, 1)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') t = nextEnabled(idx, -1)
    else return
    e.preventDefault()
    onChange(options[t].value)
    refs.current[t]?.focus()
  }

  return (
    <div className={`afs-radio afs-radio--${orientation}${className ? ' ' + className : ''}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === rover ? 0 : -1}
          disabled={o.disabled}
          className="afs-radio__item"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          <span className="afs-radio__dot" aria-hidden />
          <span className="afs-radio__label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
