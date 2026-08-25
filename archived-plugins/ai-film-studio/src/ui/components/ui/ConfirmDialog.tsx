/**
 * 确认对话 ConfirmDialog —— 基于 Modal 的应用内确认，替代 window.confirm 的同步门：
 * useConfirm() 返回 (opts) => Promise<boolean>，确认 resolve(true)，取消/Esc/外点/X resolve(false)，
 * 调用方保持原有 `if (await confirm({...}))` 写法。ConfirmProvider 在 App 根挂一份共享模态。规格 docs §5.2。
 *
 * 注：本文件为基础设施（已建未接线）；将 ConfirmProvider 挂到 App 根并迁移 14 处 window.confirm/prompt
 * 属同步→异步的结构改造，留待逐屏可视验证阶段。
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'

export interface ConfirmOptions {
  title: ReactNode
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>
const ConfirmCtx = createContext<ConfirmFn | null>(null)

/** 在 <ConfirmProvider> 内调用，得到一个返回 Promise<boolean> 的确认函数。 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmCtx)
  if (!fn) throw new Error('useConfirm 必须在 <ConfirmProvider> 内使用')
  return fn
}

const DEFAULTS: ConfirmOptions = { title: '', message: '' }

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<ConfirmOptions>(DEFAULTS)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((next) => {
    // 若已有未结算的确认（重叠调用），先以 false 结算上一个，避免其 Promise 永久挂起
    if (resolverRef.current) {
      resolverRef.current(false)
      resolverRef.current = null
    }
    setOpts(next)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = (v: boolean) => {
    resolverRef.current?.(v)
    resolverRef.current = null
    setOpen(false)
  }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={open}
        onOpenChange={(o) => {
          if (!o) settle(false)
        }}
        title={opts.title}
        size="confirm"
        footer={
          <>
            <button type="button" className="afs-btn" onClick={() => settle(false)}>
              {opts.cancelLabel ?? '取消'}
            </button>
            <button type="button" className={`afs-btn ${opts.danger ? 'afs-btn--danger' : 'afs-btn--primary'}`} onClick={() => settle(true)}>
              {opts.danger ? <AlertTriangle size={15} aria-hidden /> : null}
              {opts.confirmLabel ?? '确定'}
            </button>
          </>
        }
      >
        {opts.danger ? <AlertTriangle size={20} className="afs-dialog__icon" aria-hidden /> : null}
        <div>{opts.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  )
}
