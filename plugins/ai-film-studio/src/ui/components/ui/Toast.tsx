/**
 * 应用内 Toast —— 轻量（zustand store + 视口 + 自动消失），玻璃卡 + 语义左色条。
 * 用法：在 App 根挂一次 <ToastViewport />；任意处调用 toast('已保存', 'success')。
 * 样式见 styles.css「Toast」。注：现有反馈走宿主 window.mulby.notification；此为可选的应用内通道。
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { CheckCircle2, AlertTriangle, XCircle, Info, X, type LucideIcon } from 'lucide-react'

export type ToastLevel = 'success' | 'warning' | 'error' | 'info'
interface ToastItem { id: number; message: string; level: ToastLevel; duration: number }

interface ToastStore {
  items: ToastItem[]
  push: (message: string, level: ToastLevel, duration: number) => void
  dismiss: (id: number) => void
}

let seq = 0
const useToastStore = create<ToastStore>((set) => ({
  items: [],
  push: (message, level, duration) =>
    set((s) => ({ items: [...s.items, { id: ++seq, message, level, duration }] })),
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

/** 触发一个应用内 toast（可在任意处调用，无需 hook）。 */
export function toast(message: string, level: ToastLevel = 'info', duration = 3200) {
  useToastStore.getState().push(message, level, duration)
}

const ICONS: Record<ToastLevel, LucideIcon> = { success: CheckCircle2, warning: AlertTriangle, error: XCircle, info: Info }

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss)
  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), item.duration)
    return () => clearTimeout(t)
  }, [item.id, item.duration, dismiss])
  const Icon = ICONS[item.level]
  return (
    <div className={`afs-toast afs-toast--${item.level}`} role="status" aria-live="polite">
      <Icon size={16} className="afs-toast__icon" />
      <span className="afs-toast__msg">{item.message}</span>
      <button type="button" className="afs-toast__close" aria-label="关闭" onClick={() => dismiss(item.id)}>
        <X size={14} />
      </button>
    </div>
  )
}

/** 挂在 App 根一次。空时渲染 null。 */
export function ToastViewport() {
  const items = useToastStore((s) => s.items)
  if (items.length === 0) return null
  return (
    <div className="afs-toast-viewport" role="region" aria-label="通知">
      {items.map((it) => (
        <ToastCard key={it.id} item={it} />
      ))}
    </div>
  )
}
