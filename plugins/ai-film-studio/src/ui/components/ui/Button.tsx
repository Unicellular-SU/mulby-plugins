/**
 * 按钮 Button —— 薄封装：把 variant/size 映射到既有 .afs-btn 类系统（见 styles.css「按钮 Button」）。
 * 仅用于带可见文字的动作按钮；图标-only 按钮请用 IconButton。规格 docs §5.1。
 * 对外行为与原生 button 一致（onClick / disabled / aria-* / title 经 ...rest 透传），type 恒为 button（不提交表单）。
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'

export type ButtonVariant = 'secondary' | 'primary' | 'gradient' | 'ghost' | 'danger' | 'danger-solid'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  secondary: '', // 基础 .afs-btn 即次级
  primary: ' afs-btn--primary',
  gradient: ' afs-btn--gradient',
  ghost: ' afs-btn--ghost',
  danger: ' afs-btn--danger', // 仅 hover 显危险色
  'danger-solid': ' afs-btn--stop', // 恒为实心危险色（停止/销毁确认）
}
const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 18 }

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: LucideIcon
  trailingIcon?: LucideIcon
  loading?: boolean // 替换前置图标为 Loader2，并置 aria-busy + 强制 disabled
  block?: boolean // 整宽
  glow?: boolean // 加 .afs-glow 极光辉光（配 variant='gradient'）
  pressed?: boolean // 切换按钮 → aria-pressed（undefined 时省略该属性）
  children: ReactNode
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  leadingIcon: Leading,
  trailingIcon: Trailing,
  loading,
  block,
  glow,
  pressed,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const sz = ICON_SIZE[size]
  const cls =
    'afs-btn' +
    VARIANT_CLASS[variant] +
    (size === 'sm' ? ' afs-btn--sm' : size === 'lg' ? ' afs-btn--lg' : '') +
    (block ? ' afs-btn--block' : '') +
    (glow ? ' afs-glow' : '') +
    (className ? ' ' + className : '')
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} aria-pressed={pressed} {...rest}>
      {loading ? <Loader2 size={sz} className="afs-spin" aria-hidden /> : Leading ? <Leading size={sz} aria-hidden /> : null}
      <span>{children}</span>
      {Trailing ? <Trailing size={sz} aria-hidden /> : null}
    </button>
  )
}
