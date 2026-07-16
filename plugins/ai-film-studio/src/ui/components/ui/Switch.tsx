/**
 * 开关 Switch —— 无障碍 role=switch（原生 <button> 天然支持 Enter/Space）+ 渐变轨 + 弹簧拇指。
 * 用于带标签的布尔设置行（如「高级模式」）。样式见 styles.css「开关 Switch」区块。
 * 对外 API：checked:boolean / onChange(checked:boolean)。
 */
import { useId, type ReactNode } from 'react'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  disabled?: boolean
  ariaLabel?: string
  size?: 'sm' | 'md'
}

export default function Switch({ checked, onChange, label, disabled, ariaLabel, size = 'md' }: SwitchProps) {
  const id = useId()
  const toggle = () => {
    if (!disabled) onChange(!checked)
  }
  return (
    <span className={`afs-switch-row${disabled ? ' is-disabled' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label == null ? ariaLabel : undefined}
        aria-labelledby={label != null ? `${id}-label` : undefined}
        disabled={disabled}
        className={`afs-switch afs-switch--${size}`}
        data-state={checked ? 'checked' : 'unchecked'}
        onClick={toggle}
      >
        <span className="afs-switch__thumb" />
      </button>
      {label != null && (
        <span id={`${id}-label`} className="afs-switch-label" onClick={toggle}>
          {label}
        </span>
      )}
    </span>
  )
}
