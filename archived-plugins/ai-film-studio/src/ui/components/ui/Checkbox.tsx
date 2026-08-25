/**
 * 自定义复选框 Checkbox —— 无障碍：视觉隐藏的原生 <input type=checkbox>（保留键盘/语义）+ 自绘方框 + 渐变勾。
 * 替换浏览器默认蓝色复选框；样式见 styles.css「自定义复选框 Checkbox」区块。
 * 对外 API 与原生一致：checked:boolean / onChange(checked:boolean)。
 */
import type { ReactNode } from 'react'
import { Check } from 'lucide-react'

export interface CheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

export default function Checkbox({ checked, onChange, label, disabled, ariaLabel, className }: CheckboxProps) {
  return (
    <label className={`afs-checkbox-row${disabled ? ' is-disabled' : ''}${className ? ' ' + className : ''}`}>
      <input
        type="checkbox"
        className="afs-checkbox-input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="afs-checkbox-box" aria-hidden="true">
        <Check size={12} strokeWidth={3} className="afs-checkbox-check" />
      </span>
      {label != null && <span className="afs-checkbox-label">{label}</span>}
    </label>
  )
}
