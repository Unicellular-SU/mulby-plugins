import { useEffect, useRef } from 'react'

// 统一「Esc 关闭」：手写模态复用，补齐之前缺失的 ESC 行为（与共享 Modal 一致）。
// ref 化 onClose —— 调用方可在每次渲染传新箭头/可放在早返回之前而不重复订阅。
export function useEscClose(onClose: () => void): void {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') ref.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
