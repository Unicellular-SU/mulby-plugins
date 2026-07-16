/**
 * Toonflow 式重构 · 阶段1（§7.3）：工作台输入焦点跟踪 + 插入。
 *
 * 把左侧资源 Dock 的「提示词片段 / 资产名」插入到「最后聚焦的输入框/文本域」——替代画布的
 * appendTextToSelected（那是面向节点选中的）。对受控组件（value 绑 store）用「原生 value setter +
 * dispatch input 事件」让 React 的 onChange 接管，从而正确写回 projectStore，而非只改 DOM。
 */

type Editable = HTMLTextAreaElement | HTMLInputElement
let lastEl: Editable | null = null

function isEditable(el: EventTarget | null): el is Editable {
  if (!(el instanceof HTMLElement)) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') {
    const t = (el as HTMLInputElement).type
    return t === 'text' || t === 'search' || t === 'url' || t === ''
  }
  return false
}

/** 安装 focusin 监听，记录最后聚焦的可编辑元素。返回卸载函数。 */
export function installFocusTracker(): () => void {
  const onFocus = (e: Event) => {
    if (isEditable(e.target)) lastEl = e.target as Editable
  }
  document.addEventListener('focusin', onFocus)
  return () => document.removeEventListener('focusin', onFocus)
}

export function hasFocusTarget(): boolean {
  return !!lastEl && document.contains(lastEl)
}

/** 在最后聚焦的输入框光标处插入文本（受控组件经原生 setter + input 事件回写 store）。成功返回 true。 */
export function insertAtFocused(text: string): boolean {
  const el = lastEl
  if (!el || !document.contains(el)) return false
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const next = el.value.slice(0, start) + text + el.value.slice(end)
  if (setter) setter.call(el, next)
  else el.value = next
  el.dispatchEvent(new Event('input', { bubbles: true })) // 触发 React onChange → 写回 store
  const caret = start + text.length
  try {
    el.setSelectionRange(caret, caret)
  } catch {
    // 某些 input type 不支持 setSelectionRange，忽略
  }
  el.focus()
  return true
}
