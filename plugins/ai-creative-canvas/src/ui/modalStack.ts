import { useEffect, useRef } from 'react'
import { uid, isImeComposing } from './util'

// 模态栈：按挂载顺序记录打开的模态，单一 Esc 监听只关**栈顶**一层——杜绝一次 Esc 连关多层
//（如工程库上再开重命名 prompt，Esc 只该关 prompt）。Modal 与 useEscClose 统一委托到此，
// 从而所有模态共享同一套层级语义，而非各挂各的 window 监听互相打架。
type Entry = { id: string; onClose: () => void }
const stack: Entry[] = []
let installed = false

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || isImeComposing(e)) return // 组合期 Esc = 取消 IME 候选，不关模态
  const top = stack[stack.length - 1]
  if (!top) return
  e.preventDefault()
  top.onClose()
}

function ensureListener(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('keydown', onKey) // 唯一模态级 Esc 监听：只关栈顶，无多监听竞争
}

// 把 onClose 注册进模态栈（挂载入栈、卸载出栈）；仅栈顶在 Esc 时被调用。
// active：模态是否真正可见。多数模态在 `if (!show) return null` 之前调 hook（Rules of Hooks 不能条件调用），
// 隐藏时若仍入栈会成为假栈顶——故隐藏时不入栈，active 变化时随之增删。
export function useModalEsc(onClose: () => void, active = true): void {
  const cbRef = useRef(onClose)
  cbRef.current = onClose
  useEffect(() => {
    if (!active) return
    ensureListener()
    const id = uid('modal')
    stack.push({ id, onClose: () => cbRef.current() })
    return () => {
      const i = stack.findIndex((s) => s.id === id)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
