import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// 委托式玻璃 tooltip：监听带 data-tip 的元素 hover，portal 到 body（不被画布 overflow 裁剪、风格统一）
export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    let cur: HTMLElement | null = null
    const show = (e: MouseEvent) => {
      const t = (e.target as HTMLElement)?.closest?.('[data-tip]') as HTMLElement | null
      if (!t) return
      if (t === cur) return
      cur = t
      const text = t.getAttribute('data-tip') || ''
      if (!text) return
      const r = t.getBoundingClientRect()
      setTip({ text, x: r.left + r.width / 2, y: r.top })
    }
    const hide = (e: MouseEvent) => {
      const t = (e.target as HTMLElement)?.closest?.('[data-tip]')
      if (t && t === cur) {
        cur = null
        setTip(null)
      }
    }
    const clear = () => {
      cur = null
      setTip(null)
    }
    document.addEventListener('mouseover', show)
    document.addEventListener('mouseout', hide)
    window.addEventListener('wheel', clear, true)
    window.addEventListener('pointerdown', clear, true)
    return () => {
      document.removeEventListener('mouseover', show)
      document.removeEventListener('mouseout', hide)
      window.removeEventListener('wheel', clear, true)
      window.removeEventListener('pointerdown', clear, true)
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div
      className="ace-glass fixed z-[300] -translate-x-1/2 -translate-y-full pointer-events-none px-2 py-1 text-[11px] whitespace-nowrap"
      style={{ left: tip.x, top: tip.y - 6 }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
