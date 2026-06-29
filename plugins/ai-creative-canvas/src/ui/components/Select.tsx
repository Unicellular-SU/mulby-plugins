import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { Z } from '../zlayers'

export interface SelectOption {
  value: string
  label: string
  hint?: string
}

// 自定义下拉框：触发按钮 + 通过 Portal 渲染到 body 的浮层（不被任何 overflow 裁剪），明暗主题一致
export function Select({
  value,
  options,
  onChange,
  placeholder,
  className
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const cur = options.find((o) => o.value === value)

  const place = () => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const estH = Math.min(232, options.length * 32 + 8)
    const up = b.bottom + estH > window.innerHeight && b.top - estH > 0
    setPos({ left: b.left, top: up ? b.top : b.bottom, width: b.width, up })
  }

  useEffect(() => {
    if (!open) return
    place()
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const reflow = () => place()
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', reflow)
    window.addEventListener('wheel', reflow, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', reflow)
      window.removeEventListener('wheel', reflow, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <div className={className}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 outline-none"
      >
        <span className="truncate">{cur ? cur.label : placeholder || '选择'}</span>
        <ChevronDown size={13} className="opacity-60 shrink-0" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            data-interactive
            className={`ace-menu ace-anim-pop fixed ${Z.dropdown} py-1 overflow-auto ace-noscroll text-neutral-800 dark:text-neutral-200`}
            style={{
              left: pos.left,
              width: Math.max(pos.width, 132),
              maxHeight: 232,
              ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 })
            }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/10 ${o.value === value ? 'text-indigo-500 font-medium' : ''}`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.hint && <span className="opacity-50 shrink-0">{o.hint}</span>}
                {o.value === value && <Check size={12} className="shrink-0" />}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}
