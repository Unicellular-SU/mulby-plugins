import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'icon'
    loading?: boolean
    children: React.ReactNode
}

export function Button({
    variant = 'primary',
    loading = false,
    children,
    className = '',
    disabled,
    ...props
}: ButtonProps) {
    const baseClass = variant === 'icon' ? 'btn btn-icon' : `btn btn-${variant}`

    return (
        <button
            className={`${baseClass} ${className}`}
            disabled={disabled || loading}
            {...props}
        >
            {loading ? <span className="spinner" /> : children}
        </button>
    )
}
