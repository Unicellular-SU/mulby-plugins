import { create } from 'zustand'
import { uid } from '../util'

export interface DialogReq {
  id: string
  kind: 'prompt' | 'confirm'
  title?: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  resolve: (v: unknown) => void
}

interface DialogState {
  current: DialogReq | null
  close: (v: unknown) => void
}

export const useDialog = create<DialogState>((set, get) => ({
  current: null,
  close: (v) => {
    const c = get().current
    if (c) c.resolve(v)
    set({ current: null })
  }
}))

function open<T>(req: Omit<DialogReq, 'id' | 'resolve'>): Promise<T> {
  return new Promise<T>((resolve) => {
    useDialog.setState({ current: { ...req, id: uid('dlg'), resolve: resolve as (v: unknown) => void } })
  })
}

// 替换原生 prompt()：返回输入字符串，取消为 null
export function promptDialog(o: { title?: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string }): Promise<string | null> {
  return open<string | null>({ kind: 'prompt', ...o })
}

// 替换原生 confirm()：返回 true/false
export function confirmDialog(o: { title?: string; message?: string; danger?: boolean; confirmLabel?: string; cancelLabel?: string }): Promise<boolean> {
  return open<boolean>({ kind: 'confirm', ...o })
}
