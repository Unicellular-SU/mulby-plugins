import { useState, useEffect, useCallback } from 'react'

type Theme = 'light' | 'dark'

/**
 * 获取初始主题（从 URL 参数）
 */
function getInitialTheme(): Theme {
    const params = new URLSearchParams(window.location.search)
    return (params.get('theme') as Theme) || 'light'
}

/**
 * 主题管理 Hook
 */
export function useTheme() {
    const [theme, setThemeState] = useState<Theme>(getInitialTheme)

    // 应用主题到 document
    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark')
    }, [theme])

    // 监听主题变化
    useEffect(() => {
        window.mulby?.onThemeChange?.((newTheme: Theme) => {
            setThemeState(newTheme)
        })
    }, [])

    // 手动设置主题
    const setTheme = useCallback(async (mode: 'light' | 'dark' | 'system') => {
        try {
            const result = await window.mulby?.theme?.set(mode)
            if (result?.actual) {
                setThemeState(result.actual)
            }
        } catch (error) {
            console.error('Failed to set theme:', error)
        }
    }, [])

    // 获取当前主题信息
    const getThemeInfo = useCallback(async () => {
        try {
            return await window.mulby?.theme?.get()
        } catch (error) {
            console.error('Failed to get theme:', error)
            return null
        }
    }, [])

    return {
        theme,
        setTheme,
        getThemeInfo,
        isDark: theme === 'dark',
    }
}
