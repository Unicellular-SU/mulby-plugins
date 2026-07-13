import { useModalEsc } from './modalStack'

// 统一「Esc 关闭」：手写模态复用。委托到模态栈——多层模态时仅栈顶响应 Esc（不再各挂各的 window 监听
// 导致一次 Esc 连关多层），组合期 Esc 由栈统一忽略。
// active：模态是否可见（默认 true）。在 `if (!show) return null` 之前调用的模态须传其可见性，
// 否则隐藏时也会入栈成为假栈顶。父级条件挂载（如 {show && <M/>}）的模态用默认值即可。
export function useEscClose(onClose: () => void, active = true): void {
  useModalEsc(onClose, active)
}
