/**
 * 自定义下拉 Select —— 基于 Radix（无障碍 + 玻璃弹层），替换原生 <select> 的系统级选项弹层。
 * 设计令牌见 styles.css「自定义下拉 Select」区块；规格见 docs/ai-film-studio-uiux-redesign.md §5.1。
 *
 * 关键：Radix 不允许 <Select.Item value="">（空串保留给「无选择」）。本封装用哨兵值在
 * 边界处做 '' <-> __afs_empty__ 映射，使「跟随默认/未选」之类的空值选项也能正常选中，
 * 同时对外保持与原生 <select> 完全一致的 value:string / onChange(value:string) 语义。
 */
import * as RS from '@radix-ui/react-select'
import { ChevronDown, Check, type LucideIcon } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  icon?: LucideIcon
  disabled?: boolean
  title?: string
}

export interface SelectGroup {
  label: string
  options: SelectOption[]
}

export interface SelectProps {
  value: string
  onChange: (value: string) => void
  options?: SelectOption[]
  groups?: SelectGroup[]
  placeholder?: string
  disabled?: boolean
  title?: string
  ariaLabel?: string
  size?: 'sm' | 'md'
  block?: boolean
  className?: string
  leadingIcon?: LucideIcon
}

const EMPTY = '__afs_empty__'
const toRadix = (v: string) => (v === '' ? EMPTY : v)
const fromRadix = (v: string) => (v === EMPTY ? '' : v)

export default function Select({
  value,
  onChange,
  options = [],
  groups,
  placeholder,
  disabled,
  title,
  ariaLabel,
  size = 'md',
  block,
  className,
  leadingIcon: Leading,
}: SelectProps) {
  const renderItem = (opt: SelectOption) => {
    const Icon = opt.icon
    return (
      <RS.Item key={opt.value} value={toRadix(opt.value)} disabled={opt.disabled} title={opt.title} className="afs-select__option">
        {Icon ? <Icon size={14} className="afs-select__opt-icon" /> : null}
        <RS.ItemText>{opt.label}</RS.ItemText>
        <RS.ItemIndicator className="afs-select__check">
          <Check size={14} />
        </RS.ItemIndicator>
      </RS.Item>
    )
  }
  return (
    <RS.Root value={toRadix(value)} onValueChange={(v) => onChange(fromRadix(v))} disabled={disabled}>
      <RS.Trigger
        className={`afs-select__trigger${size === 'sm' ? ' afs-select__trigger--sm' : ''}${block ? ' afs-select__trigger--block' : ''}${className ? ' ' + className : ''}`}
        title={title}
        aria-label={ariaLabel}
      >
        {Leading ? <Leading size={14} className="afs-select__lead" /> : null}
        <span className="afs-select__valwrap">
          <RS.Value placeholder={placeholder} />
        </span>
        <RS.Icon className="afs-select__chev">
          <ChevronDown size={16} />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className="afs-select__popover" position="popper" sideOffset={6}>
          <RS.Viewport className="afs-select__viewport">
            {options.map(renderItem)}
            {groups?.map((g) => (
              <RS.Group key={g.label}>
                <RS.Label className="afs-select__group-label">{g.label}</RS.Label>
                {g.options.map(renderItem)}
              </RS.Group>
            ))}
            {options.length === 0 && !groups?.length ? <div className="afs-select__empty">无可选项</div> : null}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  )
}
