import { useEffect, useRef, useState } from 'react'
import { useDialog } from '../store/dialogStore'
import { Modal } from './Modal'

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
          <button onClick={cancel} className="px-3 py-1.5 rounded-md text-sm bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15">
            {current.cancelLabel || '取消'}
          </button>
          <button
            onClick={() => close(isPrompt ? val : true)}
            className={`px-3 py-1.5 rounded-md text-sm text-white ${current.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-500 hover:bg-indigo-600'}`}
          >
            {current.confirmLabel || '确定'}
          </button>
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
