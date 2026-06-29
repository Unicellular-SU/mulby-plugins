import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '../zlayers'

// 委托式玻璃 tooltip：监听 hover，portal 到 body（不被画布 overflow 裁剪、风格统一）。
// 统一策略：同时接管 [data-tip] 与原生 [title]——hover 原生 title 时临时摘除（抑制系统气泡）、
// 离开时还原，故全站 60+ 处 title 自动获得玻璃样式，无需逐一改调用点。
const SEL = '[data-tip], [title], [data-ace-title]'
export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null)

  useEffect(() => {
    let cur: HTMLElement | null = null
    const restore = () => {
      if (cur && cur.dataset && cur.dataset.aceTitle != null) {
        cur.setAttribute('title', cur.dataset.aceTitle)
        delete cur.dataset.aceTitle
      }
    }
    const show = (e: MouseEvent) => {
      const t = (e.target as HTMLElement)?.closest?.(SEL) as HTMLElement | null
      if (!t || t === cur) return
      restore() // 先还原上一个元素的 title
      cur = t
      // 抑制原生 title 气泡（暂存到 data-ace-title，离开时还原）
      const native = t.getAttribute('title')
      if (native != null) {
        t.dataset.aceTitle = native
        t.removeAttribute('title')
      }
      const text = t.getAttribute('data-tip') || t.dataset.aceTitle || ''
      if (!text) {
        restore()
        cur = null
        return
      }
      const r = t.getBoundingClientRect()
      setTip({ text, x: r.left + r.width / 2, y: r.top })
    }
    const hide = (e: MouseEvent) => {
      const t = (e.target as HTMLElement)?.closest?.(SEL)
      if (t && t === cur) {
        restore()
        cur = null
        setTip(null)
      }
    }
    const clear = () => {
      restore()
      cur = null
      setTip(null)
    }
    document.addEventListener('mouseover', show)
    document.addEventListener('mouseout', hide)
    window.addEventListener('wheel', clear, true)
    window.addEventListener('pointerdown', clear, true)
    return () => {
      restore() // 卸载时若仍 hover，归还 title
      document.removeEventListener('mouseover', show)
      document.removeEventListener('mouseout', hide)
      window.removeEventListener('wheel', clear, true)
      window.removeEventListener('pointerdown', clear, true)
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div
      className={`ace-glass fixed ${Z.tooltip} -translate-x-1/2 -translate-y-full pointer-events-none px-2 py-1 text-[11px] whitespace-nowrap`}
      style={{ left: tip.x, top: tip.y - 6 }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
