import { useCallback, useMemo } from 'react'

type NotificationType = 'info' | 'success' | 'warning' | 'error'

/**
 * 通知 Hook
 */
export function useNotification() {
    const show = useCallback((message: string, type: NotificationType = 'info') => {
        window.mulby?.notification?.show(message, type)
    }, [])

    const success = useCallback((message: string) => {
        show(message, 'success')
    }, [show])

    const error = useCallback((message: string) => {
        show(message, 'error')
    }, [show])

    const warning = useCallback((message: string) => {
        show(message, 'warning')
    }, [show])

    const info = useCallback((message: string) => {
        show(message, 'info')
    }, [show])

    return useMemo(() => ({
        show,
        success,
        error,
        warning,
        info,
    }), [show, success, error, warning, info])
}
