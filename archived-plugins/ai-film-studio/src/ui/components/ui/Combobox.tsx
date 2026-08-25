/**
 * 可搜索下拉 Combobox —— 文本输入触发器（前置 Search + 后置 Chevron）+ 过滤玻璃列表。
 * 用于「选项很多」的选择（如模型列表）：键入即过滤、匹配高亮、可选「创建」自由值。
 * 对外语义与 <Select> 一致：value:string / onChange(value:string)。样式见 styles.css「Combobox」。
 *
 * 自带浮层（相对容器 + 绝对列表），不用 Radix Popover —— 组合框需让输入保持焦点，
 * 而 Popover 的焦点接管会与之冲突。无障碍按 ARIA combobox 模式（aria-activedescendant）。
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Search, ChevronDown, Check } from 'lucide-react'
import type { SelectOption } from './Select'

export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  ariaLabel?: string
  size?: 'sm' | 'md'
  block?: boolean
  className?: string
  emptyText?: string
  /** 允许提交未匹配的自由文本（显示「创建 "…"」行）。 */
  allowCreate?: boolean
}

/** 将 label 中匹配 query 的片段包成 <mark>，用于高亮。 */
function highlight(label: string, q: string) {
  if (!q) return label
  const i = label.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return label
  return (
    <>
      {label.slice(0, i)}
      <mark className="afs-combobox__hl">{label.slice(i, i + q.length)}</mark>
      {label.slice(i + q.length)}
    </>
  )
}

export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
  size = 'md',
  block,
  className,
  emptyText = '无匹配',
  allowCreate,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [touched, setTouched] = useState(false) // 是否已编辑过（用于区分「刚打开显示全部」与「正在过滤」）
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()

  const selected = options.find((o) => o.value === value)
  const selectedLabel = selected ? selected.label : value

  const q = touched ? query.trim() : ''
  const filtered = useMemo(() => {
    if (!q) return options
    const lc = q.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(lc) || o.value.toLowerCase().includes(lc))
  }, [options, q])

  const exactMatch = options.some((o) => o.label.toLowerCase() === q.toLowerCase())
  const showCreate = !!allowCreate && q !== '' && !exactMatch
  const itemCount = filtered.length + (showCreate ? 1 : 0)

  // 关闭时收起浮层并把输入恢复为已选标签
  function close() {
    setOpen(false)
    setTouched(false)
    setQuery('')
  }
  function commit(v: string, label: string) {
    onChange(v)
    setOpen(false)
    setTouched(false)
    setQuery(label)
  }
  function openMenu() {
    if (disabled) return
    setOpen(true)
    setTouched(false)
    setQuery(selectedLabel)
    setActive(0)
  }

  // 外点关闭
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])

  // 活动项滚动入视
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`#${CSS.escape(baseId)}-opt-${active}`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open, baseId])

  function selectActive() {
    if (active < filtered.length) {
      const opt = filtered[active]
      if (opt && !opt.disabled) commit(opt.value, opt.label)
    } else if (showCreate) {
      commit(q, q)
    }
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) openMenu()
      else setActive((a) => Math.min(a + 1, itemCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (open) setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      if (open) {
        e.preventDefault()
        selectActive()
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        close()
      }
    } else if (e.key === 'Tab') {
      if (open) close()
    }
  }

  const inputValue = open ? query : selectedLabel
  const activeId = open && itemCount > 0 ? `${baseId}-opt-${active}` : undefined

  return (
    <div
      ref={rootRef}
      className={`afs-combobox${block ? ' afs-combobox--block' : ''}${className ? ' ' + className : ''}`}
    >
      <div className={`afs-combobox__field${size === 'sm' ? ' afs-combobox__field--sm' : ''}${open ? ' is-open' : ''}`}>
        <Search size={14} className="afs-combobox__search" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          className="afs-combobox__input"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${baseId}-list`}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => {
            setQuery(e.target.value)
            setTouched(true)
            setActive(0)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            if (!open) openMenu()
          }}
          onClick={() => {
            if (!open) openMenu()
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="afs-combobox__chev"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onClick={() => (open ? close() : (openMenu(), inputRef.current?.focus()))}
        >
          <ChevronDown size={16} />
        </button>
      </div>
      {open && (
        <div className="afs-combobox__pop" ref={listRef}>
          <div className="afs-combobox__list" role="listbox" id={`${baseId}-list`} aria-label={ariaLabel}>
            {filtered.map((opt, i) => {
              const Icon = opt.icon
              return (
                <div
                  key={opt.value}
                  id={`${baseId}-opt-${i}`}
                  role="option"
                  aria-selected={opt.value === value}
                  title={opt.title}
                  className={`afs-combobox__option${i === active ? ' is-active' : ''}${opt.disabled ? ' is-disabled' : ''}`}
                  onPointerDown={(e) => {
                    e.preventDefault() // 防止输入失焦
                    if (!opt.disabled) commit(opt.value, opt.label)
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  {Icon ? <Icon size={14} className="afs-combobox__opt-icon" /> : null}
                  <span className="afs-combobox__opt-label">{highlight(opt.label, q)}</span>
                  {opt.value === value ? <Check size={14} className="afs-combobox__check" /> : null}
                </div>
              )
            })}
            {showCreate && (
              <div
                id={`${baseId}-opt-${filtered.length}`}
                role="option"
                aria-selected={false}
                className={`afs-combobox__option afs-combobox__create${active === filtered.length ? ' is-active' : ''}`}
                onPointerDown={(e) => {
                  e.preventDefault()
                  commit(q, q)
                }}
                onMouseEnter={() => setActive(filtered.length)}
              >
                创建 “{q}”
              </div>
            )}
            {itemCount === 0 ? <div className="afs-combobox__empty">{emptyText}</div> : null}
          </div>
        </div>
      )}
    </div>
  )
}
