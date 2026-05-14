import React from 'react'
import type { LucideIcon } from 'lucide-react'

interface CardProps {
    title?: string
    icon?: LucideIcon
    children: React.ReactNode
    actions?: React.ReactNode
    className?: string
}

export function Card({ title, icon, children, actions, className = '' }: CardProps) {
    const Icon = icon

    return (
        <div className={`card ${className}`}>
            {(title || actions) && (
                <div className="card-header">
                    {title && (
                        <h3 className="card-title">
                            {Icon && <Icon className="card-icon" aria-hidden="true" size={16} strokeWidth={2} />}
                            <span>{title}</span>
                        </h3>
                    )}
                    {actions && <div className="action-bar">{actions}</div>}
                </div>
            )}
            <div className="card-content">{children}</div>
        </div>
    )
}
