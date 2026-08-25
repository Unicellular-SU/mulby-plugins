/**
 * 文本输入对话 PromptDialog —— 基于 Modal 的应用内输入框，替代 window.prompt 的同步门：
 * usePrompt() 返回 (opts) => Promise<string|null>，确认且 trim 非空 → resolve(裁剪值)，
 * 取消/Esc/外点/X 或 trim 后为空 → resolve(null)，使旧 `const n = await prompt(...); if (n && n.trim())` 守卫照旧成立。
 * PromptProvider 在 App 根挂一份共享模态。规格 docs §5.2；样式见 styles.css「Prompt Dialog」。
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import Modal from './Modal'
import { Field, Input } from './Field'

export interface PromptOptions {
  title: ReactNode
  message?: ReactNode
  placeholder?: string
  defaultValue?: string
  confirmLabel?: string
  cancelLabel?: string
  hint?: ReactNode
}

type PromptFn = (opts: PromptOptions) => Promise<string | null>
const PromptCtx = createContext<PromptFn | null>(null)

/** 在 <PromptProvider> 内调用，得到一个返回 Promise<string|null> 的输入函数。 */
export function usePrompt(): PromptFn {
  const fn = useContext(PromptCtx)
  if (!fn) throw new Error('usePrompt 必须在 <PromptProvider> 内使用')
  return fn
}

const DEFAULTS: PromptOptions = { title: '' }

export function PromptProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<PromptOptions>(DEFAULTS)
  const [value, setValue] = useState('')
  const resolverRef = useRef<((v: string | null) => void) | null>(null)

  const prompt = useCallback<PromptFn>((next) => {
    // 重叠调用：先以 null 结算上一个，避免其 Promise 永挂
    if (resolverRef.current) {
      resolverRef.current(null)
      resolverRef.current = null
    }
    setOpts(next)
    setValue(next.defaultValue ?? '')
    setOpen(true)
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  // 重新打开时（含不同 defaultValue）确保输入值正确
  useEffect(() => {
    if (open) setValue(opts.defaultValue ?? '')
  }, [open, opts])

  const settle = (commit: boolean) => {
    if (commit) {
      const t = value.trim()
      resolverRef.current?.(t ? t : null)
    } else {
      resolverRef.current?.(null)
    }
    resolverRef.current = null
    setOpen(false)
  }

  return (
    <PromptCtx.Provider value={prompt}>
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
            <button type="button" className="afs-btn afs-btn--primary" onClick={() => settle(true)}>
              {opts.confirmLabel ?? '确定'}
            </button>
          </>
        }
      >
        <div className="afs-pdlg__body">
          {opts.message ? <p className="afs-pdlg__message">{opts.message}</p> : null}
          <div className="afs-pdlg__field">
            <Field>
              <Input
                autoFocus
                value={value}
                placeholder={opts.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    settle(true)
                  }
                }}
              />
            </Field>
          </div>
          {opts.hint ? <p className="afs-pdlg__hint">{opts.hint}</p> : null}
        </div>
      </Modal>
    </PromptCtx.Provider>
  )
}
