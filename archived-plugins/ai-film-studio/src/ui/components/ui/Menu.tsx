/**
 * 下拉菜单 Menu —— 基于 Radix DropdownMenu（键盘/ARIA/Portal/碰撞翻转）+ 玻璃菜单。
 * 用于卡片 kebab 操作、工具栏溢出等。trigger 用 asChild 包裹任意按钮。
 * 样式见 styles.css「下拉菜单 Menu」。
 */
import { Fragment, type ReactNode } from 'react'
import * as DM from '@radix-ui/react-dropdown-menu'
import { Check, type LucideIcon } from 'lucide-react'

export interface MenuItem {
  label: string
  onSelect?: () => void
  icon?: LucideIcon
  danger?: boolean
  disabled?: boolean
  checked?: boolean
  shortcut?: string
  separatorBefore?: boolean
}

export interface MenuProps {
  trigger: ReactNode
  items: MenuItem[]
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}

export default function Menu({ trigger, items, align = 'end', side = 'bottom' }: MenuProps) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content className="afs-menu" align={align} side={side} sideOffset={6} collisionPadding={8}>
          {items.map((it, i) => {
            const Icon = it.icon
            return (
              <Fragment key={i}>
                {it.separatorBefore && <DM.Separator className="afs-menu__sep" />}
                <DM.Item
                  className={`afs-menu__item${it.danger ? ' afs-menu__item--danger' : ''}`}
                  disabled={it.disabled}
                  onSelect={() => it.onSelect?.()}
                >
                  {Icon ? <Icon size={15} className="afs-menu__icon" /> : null}
                  <span className="afs-menu__label">{it.label}</span>
                  {it.checked ? <Check size={14} className="afs-menu__check" /> : null}
                  {it.shortcut ? <span className="afs-menu__shortcut">{it.shortcut}</span> : null}
                </DM.Item>
              </Fragment>
            )
          })}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}
