/**
 * 分段控件 Segmented —— 互斥单选 + 招牌渐变滑动胶囊（JS 测量定位）。
 * role=radiogroup + 漫游 tabindex + ←→↑↓/Home/End（移动即选中，跳过 disabled，循环）。
 * 对外 value/onChange:string，与 Select 一致。规格 docs §5.1；样式见 styles.css「分段控件 Segmented」。
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'

export interface SegmentedOption {
  value: string
  label?: ReactNode // 省略 => 图标-only 段（请配 ariaLabel 或 title 提供无障碍名）
  icon?: ReactNode
  disabled?: boolean
  title?: string
  ariaLabel?: string // 图标-only 段的无障碍名（优先于 title）
}

export interface SegmentedProps {
  value: string
  onChange: (value: string) => void
  options: SegmentedOption[]
  size?: 'sm' | 'md'
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

export default function Segmented({ value, onChange, options, size = 'md', disabled, ariaLabel, className }: SegmentedProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)

  const activeIdx = options.findIndex((o) => o.value === value)
  const iconOnly = options.every((o) => o.label == null)
  // 漫游 tabindex 落点：活动段；无活动或活动段恰为 disabled 时退回首个可用段（保证组内恒有一个可 Tab 进入）
  const firstEnabled = options.findIndex((o) => !o.disabled)
  const rover = activeIdx === -1 || options[activeIdx]?.disabled ? firstEnabled : activeIdx

  // 测量活动段，定位滑动胶囊（布局期测量避免首帧跳动；ResizeObserver 跟随容器尺寸/文案变化重测）
  useLayoutEffect(() => {
    const measure = () => {
      const btn = btnRefs.current[activeIdx]
      setPill(btn ? { x: btn.offsetLeft, w: btn.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => ro.disconnect()
  }, [activeIdx, options, size])

  const nextEnabled = (start: number, dir: 1 | -1): number => {
    const n = options.length
    let i = start
    for (let c = 0; c < n; c++) {
      i = (i + dir + n) % n
      if (!options[i].disabled) return i
    }
    return start
  }

  const onKey = (e: ReactKeyboardEvent, idx: number) => {
    let target = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = nextEnabled(idx, 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = nextEnabled(idx, -1)
    else if (e.key === 'Home') target = options.findIndex((o) => !o.disabled)
    else if (e.key === 'End') {
      for (let i = options.length - 1; i >= 0; i--)
        if (!options[i].disabled) {
          target = i
          break
        }
    } else return
    e.preventDefault()
    if (target >= 0) {
      onChange(options[target].value)
      btnRefs.current[target]?.focus()
    }
  }

  const pillStyle: CSSProperties | undefined = pill
    ? ({ ['--afs-seg-x']: `${pill.x}px`, ['--afs-seg-w']: `${pill.w}px` } as CSSProperties)
    : undefined

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={`afs-segmented afs-segmented--${size}${iconOnly ? ' afs-segmented--icon' : ''}${disabled ? ' is-disabled' : ''}${className ? ' ' + className : ''}`}
    >
      <span className={`afs-segmented__pill${pill ? '' : ' is-empty'}`} style={pillStyle} aria-hidden />
      {options.map((opt, i) => (
        <button
          key={opt.value}
          ref={(el) => {
            btnRefs.current[i] = el
          }}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          aria-label={opt.label == null ? opt.ariaLabel ?? opt.title : undefined}
          tabIndex={i === rover ? 0 : -1}
          disabled={opt.disabled}
          title={opt.title}
          className="afs-segmented__seg"
          onClick={() => onChange(opt.value)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {opt.icon != null && (
            <span aria-hidden style={{ display: 'contents' }}>
              {opt.icon}
            </span>
          )}
          {opt.label != null && <span>{opt.label}</span>}
        </button>
      ))}
    </div>
  )
}
