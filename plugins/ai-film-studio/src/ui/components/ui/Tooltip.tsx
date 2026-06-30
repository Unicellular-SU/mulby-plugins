/**
 * 提示气泡 Tooltip —— 基于 Radix（hover+focus 触发、Esc 关闭、碰撞翻转、便携 Portal）+ 玻璃气泡。
 * 取代 icon-only 按钮上承重的原生 title=''。把 TooltipProvider 挂在 App 根一次，组件处包裹即可。
 * 样式见 styles.css「提示气泡 Tooltip」。
 */
import * as RT from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

/** 挂在应用根一次，统一延迟/连续显示行为。 */
export const TooltipProvider = RT.Provider

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  disabled?: boolean
}

export default function Tooltip({ content, children, side = 'top', disabled }: TooltipProps) {
  if (disabled || content == null || content === '') return <>{children}</>
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content className="afs-tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {content}
          <RT.Arrow className="afs-tooltip__arrow" width={10} height={5} />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  )
}
