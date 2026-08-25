/**
 * 图标按钮 IconButton —— 方形图标-only 按钮，复用既有 .afs-iconbtn 系统（styles.css L578+）。
 * 必须传 aria-label（图标自身 aria-hidden，无障碍名落在按钮上）。规格 docs §5.1。
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type IconButtonVariant = 'ghost' | 'solid' | 'danger' | 'onmedia' | 'glass'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  icon: ReactNode // lucide 图标元素，如 <Lock size={18} />
  'aria-label': string // 必填
  size?: 'sm' | 'md'
  variant?: IconButtonVariant // 默认 ghost（中性）
  pressed?: boolean // 切换态 → aria-pressed（undefined 时省略）
}

// forwardRef：使其可作为 Radix asChild 触发器（Menu/Popover/Tooltip 等）
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 'md', variant = 'ghost', pressed, className, ...rest },
  ref,
) {
  const cls =
    'afs-iconbtn' +
    (size === 'sm' ? ' afs-iconbtn--sm' : '') +
    (variant !== 'ghost' ? ` afs-iconbtn--${variant}` : '') +
    (className ? ' ' + className : '')
  return (
    <button ref={ref} type="button" className={cls} aria-pressed={pressed} {...rest}>
      <span aria-hidden style={{ display: 'contents' }}>
        {icon}
      </span>
    </button>
  )
})

export default IconButton
