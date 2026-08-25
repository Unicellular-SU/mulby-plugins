/**
 * 页签 Tabs —— 基于 Radix（role=tablist/tab/tabpanel + 漫游 tabindex + 方向键全由 Radix 提供）。
 * 横向=渐变下划线指示；纵向 vertical-rail=左侧渐变条 + 染色底（沿用 Settings nav 配方）。
 * 对外 value/onChange:string（值非空，无需哨兵）。规格 docs §5.1；样式见 styles.css「Tabs」。
 * 面板可选：调用方既可传 <TabPanel value> 子节点交给 Radix 关联 id，也可仅用列表、由自身状态切换内容。
 */
import * as RT from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface TabItem {
  value: string
  label: string
  icon?: LucideIcon
  count?: number
  disabled?: boolean
}

export interface TabsProps {
  tabs: TabItem[]
  value: string
  onChange: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md'
  ariaLabel?: string
  className?: string
  children?: ReactNode
}

/** Radix 面板：<TabPanel value="x"> 自动获得 role=tabpanel + aria-labelledby + tabindex=0。 */
export const TabPanel = RT.Content

export default function Tabs({ tabs, value, onChange, orientation = 'horizontal', size = 'md', ariaLabel, className, children }: TabsProps) {
  const vert = orientation === 'vertical'
  return (
    <RT.Root value={value} onValueChange={onChange} orientation={orientation}>
      <RT.List className={`afs-tabs${vert ? ' afs-tabs--vert' : ''}${className ? ' ' + className : ''}`} aria-label={ariaLabel}>
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <RT.Trigger
              key={t.value}
              value={t.value}
              disabled={t.disabled}
              className={`afs-tabs__tab${!vert && size === 'sm' ? ' afs-tabs__tab--sm' : ''}`}
            >
              {Icon ? <Icon size={size === 'sm' ? 16 : 18} className="afs-tabs__icon" aria-hidden /> : null}
              <span>{t.label}</span>
              {t.count != null ? <span className="afs-tabs__count">{t.count}</span> : null}
            </RT.Trigger>
          )
        })}
      </RT.List>
      {children}
    </RT.Root>
  )
}
