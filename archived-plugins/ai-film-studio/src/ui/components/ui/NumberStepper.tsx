/**
 * 数字步进器 NumberStepper —— 原生 <input type=number>（保留语义/键盘）抑制 OS 旋钮 + 自绘 ▲▼ 步进。
 * 同尺寸替换原生数字框：对外 value:number / onChange(value:number)，clamp 由 min/max 保证。
 * 用本地文本缓冲，使小数（如 0.7、负号、中途清空）输入顺畅。样式见 styles.css「数字步进器」。
 */
import { useEffect, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'

export interface NumberStepperProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  ariaLabel?: string
  className?: string
  size?: 'sm' | 'md'
  block?: boolean
}

export default function NumberStepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  disabled,
  ariaLabel,
  className,
  size = 'md',
  block,
}: NumberStepperProps) {
  const [text, setText] = useState(() => String(value))
  // 仅当外部 value 与当前文本的数值不一致时才回填（避免打断「0.」这类中途输入）
  useEffect(() => {
    if (Number(text) !== value) setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const clamp = (n: number) => {
    let v = n
    if (typeof min === 'number') v = Math.max(min, v)
    if (typeof max === 'number') v = Math.min(max, v)
    return v
  }
  const atMin = typeof min === 'number' && value <= min
  const atMax = typeof max === 'number' && value >= max

  return (
    <div className={`afs-stepper${size === 'sm' ? ' afs-stepper--sm' : ''}${block ? ' afs-stepper--block' : ''}${disabled ? ' is-disabled' : ''}${className ? ' ' + className : ''}`}>
      <input
        type="number"
        className="afs-stepper__input"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value !== '' && !Number.isNaN(n)) onChange(clamp(n))
        }}
        onBlur={() => setText(String(value))}
      />
      <span className="afs-stepper__btns">
        <button
          type="button"
          className="afs-stepper__btn"
          aria-label="增加"
          tabIndex={-1}
          disabled={disabled || atMax}
          onClick={() => onChange(clamp(value + step))}
        >
          <ChevronUp size={12} />
        </button>
        <button
          type="button"
          className="afs-stepper__btn"
          aria-label="减少"
          tabIndex={-1}
          disabled={disabled || atMin}
          onClick={() => onChange(clamp(value - step))}
        >
          <ChevronDown size={12} />
        </button>
      </span>
    </div>
  )
}
