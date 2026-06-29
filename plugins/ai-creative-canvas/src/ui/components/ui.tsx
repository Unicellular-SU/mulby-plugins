import { type ReactNode, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'

// 统一原子组件：按钮 / 空态 / 加载态。集中样式，消除散落的 indigo-500/600↔600/700、留白/透明度不一。
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-indigo-500 hover:bg-indigo-600 text-white',
  secondary: 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-neutral-800 dark:text-neutral-200',
  danger: 'bg-red-500 hover:bg-red-600 text-white',
  ghost: 'hover:bg-black/5 dark:hover:bg-white/10 text-neutral-800 dark:text-neutral-200'
}

export function Button({
  variant = 'primary',
  loading,
  disabled,
  className = '',
  children,
  ...rest
}: { variant?: Variant; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT[variant]} ${className}`}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

// 空态：图标(可选) + 文案，居中留白统一
export function Empty({ icon, text }: { icon?: ReactNode; text: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center text-sm opacity-50">
      {icon}
      <div>{text}</div>
    </div>
  )
}

// 加载态：旋转图标 + 文案
export function Loading({ text = '加载中…' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm opacity-60">
      <Loader2 size={16} className="animate-spin" /> {text}
    </div>
  )
}
