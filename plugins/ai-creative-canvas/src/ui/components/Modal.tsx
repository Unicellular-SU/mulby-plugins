import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Z } from '../zlayers'
import { useModalEsc } from '../modalStack'

// 统一模态外壳：玻璃对话框 + 遮罩模糊 + ESC/点遮罩关闭 + 进场动画
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 420
}: {
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  useModalEsc(onClose) // Esc 关闭委托模态栈：多层时只关栈顶（组合期忽略由栈统一处理）

  // 焦点管理：挂载时把焦点移入对话框、卸载时还焦到触发元素——避免焦点遗留在背后画布（Tab 跑出遮罩）。
  // opener 在 render 阶段捕获（早于子元素 autoFocus 的 DOM 提交，拿到的才是真正的触发按钮）。
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null | undefined>(undefined)
  if (openerRef.current === undefined) {
    openerRef.current = (typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null)
  }
  useEffect(() => {
    // 若对话框内已有 autoFocus 元素获焦（如 prompt 输入框），不抢焦；否则聚焦容器
    if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) dialogRef.current.focus()
    return () => {
      try { openerRef.current?.focus?.() } catch { /* opener 可能已卸载 */ }
    }
  }, [])

  // 轻量焦点陷阱：Tab 在对话框内首尾循环，不移出到背后画布元素
  const onTrapKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )
    if (!focusables || focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return createPortal(
    <div className={`fixed inset-0 ${Z.dialog} bg-black/50 backdrop-blur-sm flex items-center justify-center p-6`} onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onTrapKey}
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale flex flex-col max-h-[88vh] text-neutral-800 dark:text-neutral-200 outline-none"
        style={{ width, maxWidth: '100%' }}
      >
        {title != null && (
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
            <div className="font-semibold text-sm">{title}</div>
            <button onClick={onClose} className="opacity-60 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="overflow-auto ace-scroll">{children}</div>
        {footer != null && (
          <div className="px-4 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--ace-border)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
