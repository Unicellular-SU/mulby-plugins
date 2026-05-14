import React from 'react'
import { AlertTriangle, Check, Info, X } from 'lucide-react'

interface StatusBadgeProps {
    status: 'success' | 'warning' | 'error' | 'info'
    children: React.ReactNode
}

export function StatusBadge({ status, children }: StatusBadgeProps) {
    const icons = {
        success: Check,
        warning: AlertTriangle,
        error: X,
        info: Info,
    }
    const Icon = icons[status]

    return (
        <span className={`badge badge-${status}`}>
            <Icon className="badge-icon" aria-hidden="true" size={12} strokeWidth={2.4} />
            <span>{children}</span>
        </span>
    )
}
