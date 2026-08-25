/**
 * 浮层 Popover —— 基于 Radix（焦点管理 / Esc·外点关闭 / 碰撞翻转 / Portal）+ 玻璃面板。
 * 通用浮动内容容器（如版本历史、行内编辑面板）。trigger 用 asChild 包裹任意按钮。
 * 样式见 styles.css「浮层 Popover」。
 */
import * as RP from '@radix-ui/react-popover'
import type { ReactNode } from 'react'

export const PopoverClose = RP.Close

export interface PopoverProps {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  ariaLabel?: string
}

export default function Popover({ trigger, children, align = 'center', side = 'bottom', className, ariaLabel }: PopoverProps) {
  return (
    <RP.Root>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content
          className={`afs-popover${className ? ' ' + className : ''}`}
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={8}
          aria-label={ariaLabel}
        >
          {children}
          <RP.Arrow className="afs-popover__arrow" width={10} height={5} />
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  )
}
