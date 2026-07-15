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
  pushSticky: (msg: string, type?: ToastType) => string // 常驻（不自动消失），返回 id 供更新/手动关闭——用于下载等进度提示
  update: (id: string, msg: string, type?: ToastType) => void // 原位更新（进度百分比刷新）
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
  pushSticky: (msg, type = 'info') => {
    const id = uid()
    set((s) => ({ toasts: [...s.toasts, { id, msg, type }] })) // 无 setTimeout：由调用方 update/dismiss 掌控生命周期
    return id
  },
  update: (id, msg, type) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, msg, ...(type ? { type } : {}) } : t)) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))

// 统一入口：组件与服务层均可调用（替换分散的 mulby.notification.show / notify()）
export function toast(msg: string, type: ToastType = 'info') {
  useToasts.getState().push(msg, type)
}
// 常驻进度提示：toastSticky 起一条不自动消失的 toast，toastUpdate 刷新其文案，用完 dismiss。
export function toastSticky(msg: string, type: ToastType = 'info'): string {
  return useToasts.getState().pushSticky(msg, type)
}
export function toastUpdate(id: string, msg: string, type?: ToastType) {
  useToasts.getState().update(id, msg, type)
}
export function toastDismiss(id: string) {
  useToasts.getState().dismiss(id)
}
