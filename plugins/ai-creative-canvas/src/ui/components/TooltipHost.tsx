import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '../zlayers'

// 委托式玻璃 tooltip：监听 hover，portal 到 body（不被画布 overflow 裁剪、风格统一）。
// 统一策略：同时接管 [data-tip] 与原生 [title]——hover 原生 title 时临时摘除（抑制系统气泡）、
// 离开时还原，故全站 60+ 处 title 自动获得玻璃样式，无需逐一改调用点。
// 防遮挡：左右钳制在视口内（边缘按钮不被窗口裁掉）、顶部空间不足翻转到元素下方、超长文本限宽换行。
const SEL = '[data-tip], [title], [data-ace-title]'
const TIP_MARGIN = 8 // 距视口边缘最小间距
const TIP_MAX_W = 280 // 超长提示限宽换行
// 粗估气泡宽度（11px 字）：CJK ≈11px/字，其余 ≈6px/字，+padding
function estTipWidth(text: string): number {
  const cjk = (text.match(/[一-鿿　-〿＀-￯]/g) || []).length
  return Math.min(TIP_MAX_W, cjk * 11 + (text.length - cjk) * 6 + 18)
}
export function TooltipHost() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null)

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
      const w = estTipWidth(text)
      // 水平钳制：气泡中心不越过 [margin+w/2, innerWidth-margin-w/2]，边缘按钮不被窗口裁掉
      const cx = r.left + r.width / 2
      const x = Math.min(Math.max(cx, TIP_MARGIN + w / 2), window.innerWidth - TIP_MARGIN - w / 2)
      // 顶部空间不足 → 翻转到元素下方
      const below = r.top < 44
      setTip({ text, x, y: below ? r.bottom : r.top, below })
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
      className={`ace-glass fixed ${Z.tooltip} -translate-x-1/2 ${tip.below ? '' : '-translate-y-full'} pointer-events-none px-2 py-1 text-[11px] whitespace-normal break-words text-center leading-snug`}
      style={{ left: tip.x, top: tip.below ? tip.y + 6 : tip.y - 6, maxWidth: TIP_MAX_W, width: 'max-content' }}
    >
      {tip.text}
    </div>,
    document.body
  )
}
