import { createPortal } from 'react-dom'
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react'
import { Z } from '../zlayers'
import { useToasts, type ToastType } from '../store/toastStore'

const META: Record<ToastType, { icon: typeof Info; color: string }> = {
  success: { icon: CheckCircle2, color: '#10b981' },
  error: { icon: AlertCircle, color: '#ef4444' },
  warning: { icon: AlertTriangle, color: '#f59e0b' },
  info: { icon: Info, color: '#6366f1' }
}

// 全局 toast 容器：portal 到 body，底部居中、column-reverse 堆叠，按 type 着左边框
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  if (!toasts.length) return null
  return createPortal(
    <div className={`fixed ${Z.toast} bottom-4 left-1/2 -translate-x-1/2 flex flex-col-reverse gap-2 pointer-events-none`}>
      {toasts.map((t) => {
        const m = META[t.type]
        const Icon = m.icon
        return (
          <div
            key={t.id}
            className="ace-glass ace-anim-slide pointer-events-auto flex items-center gap-2 pl-3 pr-2 py-2 max-w-[420px] text-sm"
            style={{ borderLeft: `3px solid ${m.color}` }}
          >
            <Icon size={16} style={{ color: m.color }} className="shrink-0" />
            <span className="flex-1 leading-snug" style={{ color: 'var(--text-1)' }}>
              {t.msg}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 opacity-50 hover:opacity-100 rounded p-0.5"
              title="关闭"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
