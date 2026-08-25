/**
 * 空状态 EmptyState —— 居中图标 + 标题 + 可选提示 + 可选 CTA，背静态极光基底（唯一合法装饰落点）。
 * 纯展示；动作按钮由调用方传入（复用 .afs-btn 系统）。规格 docs §5.2；样式见 styles.css「空状态」。
 */
import { Loader2, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode // CTA 区，传 <button className="afs-btn afs-btn--primary">…</button>
  loading?: boolean // 加载态：以 spinner 取代图标，并给根 role=status aria-live=polite
  as?: 'h2' | 'h3' | 'h4' // 标题层级，默认 h2
  iconSize?: number // 默认 44（规格 40–48）
  className?: string
}

export default function EmptyState({ icon: Icon, title, description, action, loading, as: Heading = 'h2', iconSize = 44, className }: EmptyStateProps) {
  return (
    <div className={`afs-empty${className ? ' ' + className : ''}`} role={loading ? 'status' : undefined} aria-live={loading ? 'polite' : undefined}>
      <span className="afs-empty__icon">
        {loading ? <Loader2 size={iconSize} className="afs-spin" aria-hidden /> : <Icon size={iconSize} aria-hidden />}
      </span>
      <Heading className="afs-empty__title">{title}</Heading>
      {description && <p className="afs-empty__hint">{description}</p>}
      {action && <div className="afs-empty__actions">{action}</div>}
    </div>
  )
}
