import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../store/dialogStore'
import { isImeComposing } from '../util'
import { Modal } from './Modal'
import { Button } from './ui'

// 全局 prompt/confirm 对话框宿主：渲染 dialogStore.current（挂在 App 根）
export function DialogHost() {
  const current = useDialog((s) => s.current)
  const close = useDialog((s) => s.close)
  const [val, setVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (current?.kind === 'prompt') {
      setVal(current.defaultValue || '')
      const t = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 30)
      return () => clearTimeout(t)
    }
  }, [current])

  if (!current) return null
  const isPrompt = current.kind === 'prompt'
  const cancel = () => close(isPrompt ? null : false)

  return (
    <Modal
      title={current.title || (isPrompt ? '输入' : '确认')}
      width={400}
      onClose={cancel}
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>{current.cancelLabel || '取消'}</Button>
          <Button variant={current.danger ? 'danger' : 'primary'} onClick={() => close(isPrompt ? val : true)}>{current.confirmLabel || '确定'}</Button>
        </>
      }
    >
      <div className="p-4 flex flex-col gap-2 text-sm">
        {current.message && <div className="opacity-80">{current.message}</div>}
        {isPrompt && (
          <input
            ref={inputRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return // 组合期回车=确认候选，别当对话框提交
              if (e.key === 'Enter') close(val)
            }}
            placeholder={current.placeholder}
            className="ace-input w-full"
          />
        )}
      </div>
    </Modal>
  )
}
