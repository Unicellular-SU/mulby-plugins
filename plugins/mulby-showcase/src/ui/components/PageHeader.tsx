import React from 'react'
import type { LucideIcon } from 'lucide-react'

interface PageHeaderProps {
    icon: LucideIcon
    title: string
    description?: string
    actions?: React.ReactNode
}

export function PageHeader({ icon, title, description, actions }: PageHeaderProps) {
    const Icon = icon

    return (
        <header className="page-header">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 className="page-title">
                        <Icon className="section-icon page-title-icon" aria-hidden="true" size={22} strokeWidth={2} />
                        <span>{title}</span>
                    </h2>
                    {description && <p className="page-description">{description}</p>}
                </div>
                {actions && <div className="action-bar">{actions}</div>}
            </div>
        </header>
    )
}
