import { useEffect, useRef } from 'react'
import { isImeComposing } from './util'

// 统一「Esc 关闭」：手写模态复用，补齐之前缺失的 ESC 行为（与共享 Modal 一致）。
// ref 化 onClose —— 调用方可在每次渲染传新箭头/可放在早返回之前而不重复订阅。
export function useEscClose(onClose: () => void): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    // 组合期 Esc = 取消 IME 候选，不应连模态一起关掉
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !isImeComposing(e)) ref.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
