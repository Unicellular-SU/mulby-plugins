/**
 * 搜索框 SearchField —— 前置 Search 图标 + 输入 + 清除 X 的胶囊。对外 value/onChange:string。
 * 统一各处的内联搜索框。规格 docs §5.1；样式见 styles.css「SearchField」。
 */
import { Search, X } from 'lucide-react'
import type { InputHTMLAttributes } from 'react'

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'type' | 'className'> {
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
  size?: 'sm' | 'md'
  block?: boolean
  className?: string
}

export default function SearchField({ value, onChange, ariaLabel, size = 'md', block, className, placeholder, ...rest }: SearchFieldProps) {
  return (
    <div className={`afs-search${size === 'sm' ? ' afs-search--sm' : ''}${block ? ' afs-search--block' : ''}${className ? ' ' + className : ''}`}>
      <Search size={14} className="afs-search__icon" aria-hidden />
      <input
        type="text"
        className="afs-search__input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        {...rest}
      />
      {value && (
        <button type="button" className="afs-search__clear" aria-label="清除搜索" onClick={() => onChange('')}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
