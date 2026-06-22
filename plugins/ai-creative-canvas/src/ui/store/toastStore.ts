import { create } from 'zustand'
import { uid } from '../util'

export type ToastType = 'success' | 'error' | 'warning' | 'info'
export interface ToastItem {
  id: string
  msg: string
  type: ToastType
}

interface ToastState {
  toasts: ToastItem[]
  push: (msg: string, type?: ToastType) => void
  dismiss: (id: string) => void
}

// 按内容长度估算停留时长（参考 AI-CanvasPro：短提示快闪、长提示久留）
function durationFor(msg: string): number {
  const n = msg.length
  if (n <= 12) return 2500
  if (n <= 40) return 4700
  return 8600
}

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (msg, type = 'info') => {
    const id = uid()
    set((s) => ({ toasts: [...s.toasts, { id, msg, type }] }))
    setTimeout(() => get().dismiss(id), durationFor(msg))
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

// 统一入口：组件与服务层均可调用（替换分散的 mulby.notification.show / notify()）
export function toast(msg: string, type: ToastType = 'info') {
  useToasts.getState().push(msg, type)
}
