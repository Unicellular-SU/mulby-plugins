import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Z } from '../zlayers'

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className={`fixed inset-0 ${Z.dialog} bg-black/50 backdrop-blur-sm flex items-center justify-center p-6`} onClick={onClose}>
      <div
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale flex flex-col max-h-[88vh] text-neutral-800 dark:text-neutral-200"
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
