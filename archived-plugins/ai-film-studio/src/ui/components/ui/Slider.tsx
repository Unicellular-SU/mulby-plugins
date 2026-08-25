/**
 * 滑块 Slider —— 原生 input[type=range]，已填充轨用内联 --afs-slider-pct 渲染进度。对外 value/onChange:number。
 * 规格 docs §5.1；样式见 styles.css「Slider」。
 */
import type { CSSProperties } from 'react'

export interface SliderProps {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

export default function Slider({ value, onChange, min = 0, max = 100, step = 1, disabled, ariaLabel, className }: SliderProps) {
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  const style = { ['--afs-slider-pct']: `${pct}%` } as CSSProperties
  return (
    <input
      type="range"
      className={`afs-slider${className ? ' ' + className : ''}`}
      style={style}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  )
}
