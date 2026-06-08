import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { MenuItem } from '../services/contextMenu'

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

/** One menu level (the root menu or a fly-out submenu). */
function MenuLevel({
  items,
  onSelect
}: {
  items: MenuItem[]
  onSelect: (id: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  // Inline overrides applied to the open submenu after measuring it, so it never
  // overflows the viewport: flip to the left near the right edge, and shift up
  // when a long submenu (e.g. "插入") would run off the bottom of the window.
  const [subStyle, setSubStyle] = useState<CSSProperties>({})
  const subRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== undefined) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = undefined
    }
  }, [])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => setOpenId(null), 220)
  }, [cancelClose])

  // Measure the open submenu and keep it inside the viewport (runs before paint
  // so there's no visible jump). Sizes are read from offsetWidth/offsetHeight and
  // the parent item's rect — both independent of the submenu's own positioning —
  // so a leftover style from a previously-open submenu can't skew the math.
  useLayoutEffect(() => {
    const el = subRef.current
    const wrap = el?.parentElement
    if (!openId || !el || !wrap) {
      setSubStyle({})
      return
    }
    const margin = 6
    const wrapRect = wrap.getBoundingClientRect()
    const width = el.offsetWidth
    const height = el.offsetHeight
    const style: CSSProperties = {}

    // Horizontal: the submenu's natural left edge is the item's right edge. Flip
    // it to the left when it would overflow the right edge of the window.
    if (wrapRect.right + width > window.innerWidth - margin) {
      style.left = 'auto'
      style.right = '100%'
      style.paddingLeft = 0
      style.paddingRight = '3px'
    }

    // Vertical: the submenu's natural top is the item's top (minus the 6px
    // baseline offset). Shift it up if it would run off the bottom, but never
    // push its top above the viewport.
    const naturalTop = wrapRect.top - 6
    const overflow = naturalTop + height - (window.innerHeight - margin)
    if (overflow > 0) {
      const shift = Math.min(overflow, Math.max(0, naturalTop - margin))
      style.top = `${-6 - shift}px`
    }

    setSubStyle(style)
  }, [openId])

  useEffect(() => cancelClose, [cancelClose])

  return (
    <div className="ctx-menu" role="menu">
      {items.map((item) => {
        if (item.separator) {
          return <div key={item.id} className="ctx-sep" role="separator" />
        }
        const hasSub = !!item.submenu?.length
        const open = openId === item.id
        return (
          <div
            key={item.id}
            className="ctx-item-wrap"
            onMouseEnter={() => {
              cancelClose()
              setOpenId(hasSub ? item.id : null)
            }}
            onMouseLeave={() => {
              if (hasSub) {
                scheduleClose()
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              className={`ctx-item${item.danger ? ' ctx-danger' : ''}${hasSub ? ' ctx-has-sub' : ''}`}
              disabled={item.disabled}
              aria-haspopup={hasSub || undefined}
              aria-expanded={hasSub ? open : undefined}
              onClick={() => {
                if (hasSub) {
                  setOpenId(open ? null : item.id)
                } else if (!item.disabled) {
                  onSelect(item.id)
                }
              }}
            >
              <span className="ctx-label">{item.label}</span>
              {item.shortcut && !hasSub && <span className="ctx-shortcut">{item.shortcut}</span>}
              {hasSub && (
                <span className="ctx-caret" aria-hidden="true">
                  {'\u203A'}
                </span>
              )}
            </button>
            {hasSub && open && (
              <div
                ref={subRef}
                className="ctx-sub"
                style={subStyle}
                onMouseEnter={cancelClose}
                onMouseLeave={scheduleClose}
              >
                <MenuLevel items={item.submenu ?? []} onSelect={onSelect} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Themed right-click menu. Rendered in a portal on document.body, positioned at
 * (x, y) and clamped to the viewport. Closes on Escape, on an outside click, and
 * after selecting a leaf item. Submenus open on hover and flip left near the edge.
 */
export function ContextMenu({ x, y, items, onSelect, onClose }: ContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id)
      onClose()
    },
    [onSelect, onClose]
  )

  // Clamp the root menu inside the viewport once it has a measured size.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) {
      return
    }
    const r = el.getBoundingClientRect()
    let left = x
    let top = y
    if (left + r.width > window.innerWidth - 6) {
      left = Math.max(6, window.innerWidth - r.width - 6)
    }
    if (top + r.height > window.innerHeight - 6) {
      top = Math.max(6, window.innerHeight - r.height - 6)
    }
    setPos({ left, top })
  }, [x, y, items])

  // Focus the first actionable item so keyboard users can drive the menu.
  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLButtonElement>('.ctx-item:not([disabled])')
    first?.focus()
  }, [])

  useEffect(() => {
    const onDocDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      const active = document.activeElement as HTMLElement | null
      if (!active || !rootRef.current?.contains(active)) {
        return
      }
      const menu = active.closest('.ctx-menu')
      if (!menu) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const buttons = Array.from(
          menu.querySelectorAll<HTMLButtonElement>(':scope > .ctx-item-wrap > .ctx-item:not([disabled])')
        )
        const idx = buttons.indexOf(active as HTMLButtonElement)
        const next =
          event.key === 'ArrowDown'
            ? (idx + 1 + buttons.length) % buttons.length
            : (idx - 1 + buttons.length) % buttons.length
        buttons[next]?.focus()
      } else if (event.key === 'ArrowRight') {
        if (active.classList.contains('ctx-has-sub')) {
          event.preventDefault()
          active.click()
          window.setTimeout(() => {
            const child = active.parentElement?.querySelector<HTMLButtonElement>(
              '.ctx-sub .ctx-item:not([disabled])'
            )
            child?.focus()
          }, 0)
        }
      } else if (event.key === 'ArrowLeft') {
        const sub = active.closest('.ctx-sub')
        if (sub) {
          event.preventDefault()
          const parent = sub.parentElement?.querySelector<HTMLButtonElement>(':scope > .ctx-item')
          parent?.focus()
          parent?.click()
        }
      }
    }
    document.addEventListener('mousedown', onDocDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDocDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={rootRef}
      className="ctx-menu-root"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuLevel items={items} onSelect={handleSelect} />
    </div>,
    document.body
  )
}
