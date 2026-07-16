/**
 * 表单字段族 Field / Input / Textarea —— 薄封装，统一 label / help / error / required 与失效态。
 * 复用已令牌化的 .afs-field__input 样式（内陷面 + 焦点环 + 占位符），不重写既有输入框；
 * 供后续表单/设置结构重做时统一字段 API。样式见 styles.css「表单控件」+「字段 Field」。
 */
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

export interface FieldProps {
  label?: ReactNode
  help?: ReactNode
  error?: ReactNode
  required?: boolean
  htmlFor?: string
  className?: string
  children: ReactNode
}

export function Field({ label, help, error, required, htmlFor, className, children }: FieldProps) {
  return (
    <div className={`afs-field${className ? ' ' + className : ''}`}>
      {label != null && (
        <label className="afs-field__label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="afs-field__req"> *</span> : null}
        </label>
      )}
      {children}
      {error != null ? (
        <div className="afs-field__error">{error}</div>
      ) : help != null ? (
        <div className="afs-field__help">{help}</div>
      ) : null}
    </div>
  )
}

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { invalid?: boolean; className?: string }
export function Input({ invalid, className, ...rest }: InputProps) {
  return (
    <input
      className={`afs-field__input${invalid ? ' is-invalid' : ''}${className ? ' ' + className : ''}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
}

export type TextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & { invalid?: boolean; className?: string }
export function Textarea({ invalid, className, ...rest }: TextareaProps) {
  return (
    <textarea
      className={`afs-field__input${invalid ? ' is-invalid' : ''}${className ? ' ' + className : ''}`}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
}
