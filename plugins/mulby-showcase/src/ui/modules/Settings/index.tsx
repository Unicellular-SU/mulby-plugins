import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import {
    Bell,
    CheckCircle2,
    Keyboard,
    List,
    MousePointerClick,
    Palette,
    RefreshCw,
    Settings,
    SlidersHorizontal,
    Trash2,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type ThemeActual = 'light' | 'dark'
type DensityMode = 'standard' | 'compact'
type OutputFormat = 'png' | 'webp' | 'mp4'
type LoadingAction = 'shortcut' | 'tray' | null

interface ThemeInfo {
    mode: 'light' | 'dark' | 'system'
    actual: ThemeActual
}

interface InterfacePreferences {
    density: DensityMode
    autoFocusSearch: boolean
    defaultOutputFormat: OutputFormat
    toolbarHints: boolean
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

const SAMPLE_SHORTCUTS = [
    'CommandOrControl+Shift+X',
    'CommandOrControl+Shift+S',
    'Alt+Shift+P',
    'F12',
]

const DEFAULT_PREFERENCES: InterfacePreferences = {
    density: 'standard',
    autoFocusSearch: true,
    defaultOutputFormat: 'png',
    toolbarHints: true,
}

const TRAY_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2563eb"/><path d="M9 21h14M9 16h14M9 11h14" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>'
const TRAY_ICON_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TRAY_ICON_SVG)}`

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function formatTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleTimeString()
}

function formatDateTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleString()
}

function statusText(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

function themeText(theme: ThemeActual) {
    return theme === 'dark' ? '暗色' : '亮色'
}

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Theme API',
        items: [
            { name: 'theme.get()', description: '读取宿主主题模式，插件只做展示。' },
            { name: 'theme.getActual()', description: '读取 system 解析后的实际主题。' },
            { name: 'onThemeChange(callback)', description: '跟随宿主主题变化，不修改宿主主题设置。' },
        ],
    },
    {
        title: 'Global Shortcut API',
        items: [
            { name: 'shortcut.register(accelerator)', description: '注册当前插件的全局快捷键。' },
            { name: 'shortcut.unregister(accelerator)', description: '注销单个快捷键。' },
            { name: 'shortcut.unregisterAll()', description: '注销当前插件注册的全部快捷键。' },
            { name: 'shortcut.isRegistered(accelerator)', description: '检查快捷键是否已注册。' },
            { name: 'shortcut.onTriggered(callback)', description: '监听快捷键触发事件并在卸载时取消监听。' },
        ],
    },
    {
        title: 'Tray API',
        items: [
            { name: 'tray.create(options)', description: '创建当前插件的系统托盘图标。' },
            { name: 'tray.setIcon(icon)', description: '更新托盘图标。' },
            { name: 'tray.setTooltip(tooltip)', description: '更新托盘提示。' },
            { name: 'tray.setTitle(title)', description: '更新 macOS 托盘标题。' },
            { name: 'tray.exists()', description: '检查当前插件托盘是否存在。' },
            { name: 'tray.destroy()', description: '销毁当前插件托盘。' },
        ],
    },
    {
        title: 'Menu API',
        items: [
            { name: 'menu.showContextMenu(items)', description: '显示原生右键菜单并接收选中项。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '只读跟随主题',
        code: `const info = await theme.get()
const actual = await theme.getActual()
const offTheme = onThemeChange(nextTheme => {
  console.log('actual theme changed', nextTheme)
})

offTheme()`,
    },
    {
        title: '注册并监听快捷键',
        code: `const ok = await shortcut.register('CommandOrControl+Shift+X')
const registered = await shortcut.isRegistered('CommandOrControl+Shift+X')

const offShortcut = shortcut.onTriggered(accelerator => {
  console.log('triggered', accelerator)
})

await shortcut.unregister('CommandOrControl+Shift+X')
offShortcut()`,
    },
    {
        title: '托盘与右键菜单',
        code: `await tray.create({ icon: dataUrlIcon, tooltip: 'Showcase' })
await tray.setTooltip('新的提示')
await tray.setTitle('Showcase')

const selected = await menu.showContextMenu([
  { label: '紧凑模式', id: 'density-compact', type: 'radio', checked: true },
  { label: '', type: 'separator' },
  { label: '禁用示例', id: 'disabled', enabled: false }
])`,
    },
]

export function SettingsModule() {
    const { theme, onThemeChange, shortcut, tray, menu } = useMulby()
    const notify = useNotification()

    const [themeInfo, setThemeInfo] = useState<ThemeInfo | null>(null)
    const [actualTheme, setActualTheme] = useState<ThemeActual | null>(null)
    const [preferences, setPreferences] = useState<InterfacePreferences>(DEFAULT_PREFERENCES)
    const [registeredShortcuts, setRegisteredShortcuts] = useState<string[]>([])
    const [newShortcut, setNewShortcut] = useState(SAMPLE_SHORTCUTS[0])
    const [lastTriggered, setLastTriggered] = useState<{ accelerator: string; count: number; timestamp: number } | null>(null)
    const [trayExists, setTrayExists] = useState(false)
    const [lastMenuSelection, setLastMenuSelection] = useState<string | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 16))
    }, [])

    const updatePreference = useCallback(<K extends keyof InterfacePreferences>(key: K, value: InterfacePreferences[K]) => {
        setPreferences(current => ({ ...current, [key]: value }))
    }, [])

    const refreshTheme = useCallback(async () => {
        if (!theme) {
            pushOperation({
                action: 'theme.get/getActual',
                status: 'warning',
                message: '当前宿主未暴露主题 API',
            })
            return
        }

        try {
            const [info, actual] = await Promise.all([
                theme.get(),
                theme.getActual(),
            ])
            setThemeInfo(info)
            setActualTheme(actual)
        } catch (error) {
            pushOperation({
                action: 'theme.get/getActual',
                status: 'error',
                message: getErrorMessage(error),
            })
        }
    }, [pushOperation, theme])

    const refreshTray = useCallback(async () => {
        try {
            setTrayExists(await tray.exists())
        } catch (error) {
            pushOperation({
                action: 'tray.exists',
                status: 'error',
                message: getErrorMessage(error),
            })
        }
    }, [pushOperation, tray])

    useEffect(() => {
        void refreshTheme()
        void refreshTray()
    }, [refreshTheme, refreshTray])

    useEffect(() => {
        const dispose = onThemeChange((nextTheme) => {
            setActualTheme(nextTheme)
            setThemeInfo(current => current ? { ...current, actual: nextTheme } : current)
            pushOperation({
                action: 'onThemeChange',
                status: 'info',
                message: `实际主题变更为 ${themeText(nextTheme)}`,
            })
        })
        return dispose
    }, [onThemeChange, pushOperation])

    useEffect(() => {
        const dispose = shortcut.onTriggered((accelerator) => {
            setLastTriggered(current => ({
                accelerator,
                count: current?.accelerator === accelerator ? current.count + 1 : 1,
                timestamp: Date.now(),
            }))
            pushOperation({
                action: 'shortcut.onTriggered',
                status: 'success',
                message: `快捷键已触发: ${accelerator}`,
            })
            notify.success(`快捷键触发: ${accelerator}`)
        })
        return dispose
    }, [notify, pushOperation, shortcut])

    const handleRegisterShortcut = useCallback(async () => {
        const accelerator = newShortcut.trim()
        if (!accelerator) {
            notify.warning('请输入快捷键')
            return
        }

        setLoadingAction('shortcut')
        try {
            const alreadyRegistered = await shortcut.isRegistered(accelerator)
            if (alreadyRegistered) {
                setRegisteredShortcuts(current => current.includes(accelerator) ? current : [...current, accelerator])
                pushOperation({
                    action: 'shortcut.isRegistered',
                    status: 'info',
                    message: `${accelerator} 已注册`,
                })
                notify.info('快捷键已经注册')
                return
            }

            const success = await shortcut.register(accelerator)
            if (!success) {
                pushOperation({
                    action: 'shortcut.register',
                    status: 'warning',
                    message: `${accelerator} 注册失败，可能被占用`,
                })
                notify.warning('快捷键注册失败，可能已被占用')
                return
            }

            setRegisteredShortcuts(current => current.includes(accelerator) ? current : [...current, accelerator])
            pushOperation({
                action: 'shortcut.register',
                status: 'success',
                message: `${accelerator} 已注册`,
            })
            notify.success(`快捷键 ${accelerator} 已注册`)
        } catch (error) {
            pushOperation({
                action: 'shortcut.register',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`注册快捷键失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [newShortcut, notify, pushOperation, shortcut])

    const handleUnregisterShortcut = useCallback(async (accelerator: string) => {
        setLoadingAction('shortcut')
        try {
            await shortcut.unregister(accelerator)
            setRegisteredShortcuts(current => current.filter(item => item !== accelerator))
            pushOperation({
                action: 'shortcut.unregister',
                status: 'success',
                message: `${accelerator} 已注销`,
            })
            notify.success(`快捷键 ${accelerator} 已注销`)
        } catch (error) {
            pushOperation({
                action: 'shortcut.unregister',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`注销快捷键失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, shortcut])

    const handleUnregisterAllShortcuts = useCallback(async () => {
        setLoadingAction('shortcut')
        try {
            await shortcut.unregisterAll()
            setRegisteredShortcuts([])
            pushOperation({
                action: 'shortcut.unregisterAll',
                status: 'success',
                message: '当前插件注册的快捷键已全部注销',
            })
            notify.success('快捷键已全部注销')
        } catch (error) {
            pushOperation({
                action: 'shortcut.unregisterAll',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`注销快捷键失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, shortcut])

    const handleCreateTray = useCallback(async () => {
        setLoadingAction('tray')
        try {
            const success = await tray.create({
                icon: TRAY_ICON_DATA_URL,
                tooltip: `Mulby Showcase: ${preferences.defaultOutputFormat.toUpperCase()}`,
                title: preferences.density === 'compact' ? 'Compact' : 'Showcase',
            })
            setTrayExists(await tray.exists())
            pushOperation({
                action: 'tray.create/exists',
                status: success ? 'success' : 'warning',
                message: success ? '托盘已创建' : '托盘创建未成功',
            })
            if (success) notify.success('托盘已创建')
            else notify.warning('托盘创建未成功')
        } catch (error) {
            pushOperation({
                action: 'tray.create',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`创建托盘失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, preferences.defaultOutputFormat, preferences.density, pushOperation, tray])

    const handleUpdateTray = useCallback(async () => {
        setLoadingAction('tray')
        try {
            await tray.setIcon(TRAY_ICON_DATA_URL)
            await tray.setTooltip(`界面密度: ${preferences.density} / 默认输出 ${preferences.defaultOutputFormat.toUpperCase()}`)
            await tray.setTitle(preferences.density === 'compact' ? 'Compact' : 'Showcase')
            setTrayExists(await tray.exists())
            pushOperation({
                action: 'tray.setIcon/setTooltip/setTitle',
                status: 'success',
                message: '托盘展示信息已更新',
            })
            notify.success('托盘展示信息已更新')
        } catch (error) {
            pushOperation({
                action: 'tray.setIcon/setTooltip/setTitle',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`更新托盘失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, preferences.defaultOutputFormat, preferences.density, pushOperation, tray])

    const handleDestroyTray = useCallback(async () => {
        setLoadingAction('tray')
        try {
            await tray.destroy()
            setTrayExists(false)
            pushOperation({
                action: 'tray.destroy',
                status: 'success',
                message: '托盘已销毁',
            })
            notify.success('托盘已销毁')
        } catch (error) {
            pushOperation({
                action: 'tray.destroy',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`销毁托盘失败: ${getErrorMessage(error)}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, tray])

    const handleContextMenu = useCallback(async (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault()
        try {
            const selectedId = await menu.showContextMenu([
                { label: '标准密度', id: 'density-standard', type: 'radio', checked: preferences.density === 'standard' },
                { label: '紧凑密度', id: 'density-compact', type: 'radio', checked: preferences.density === 'compact' },
                { label: '', type: 'separator' },
                { label: '自动聚焦搜索', id: 'toggle-autofocus', type: 'checkbox', checked: preferences.autoFocusSearch },
                { label: '显示工具提示', id: 'toggle-hints', type: 'checkbox', checked: preferences.toolbarHints },
                {
                    label: '默认输出格式',
                    id: 'format',
                    submenu: [
                        { label: 'PNG', id: 'format-png', type: 'radio', checked: preferences.defaultOutputFormat === 'png' },
                        { label: 'WebP', id: 'format-webp', type: 'radio', checked: preferences.defaultOutputFormat === 'webp' },
                        { label: 'MP4', id: 'format-mp4', type: 'radio', checked: preferences.defaultOutputFormat === 'mp4' },
                    ],
                },
                { label: '', type: 'separator' },
                { label: '禁用项示例', id: 'disabled', enabled: false },
            ])

            setLastMenuSelection(selectedId)
            if (!selectedId) return

            if (selectedId === 'density-standard' || selectedId === 'density-compact') {
                updatePreference('density', selectedId.replace('density-', '') as DensityMode)
            } else if (selectedId === 'toggle-autofocus') {
                updatePreference('autoFocusSearch', !preferences.autoFocusSearch)
            } else if (selectedId === 'toggle-hints') {
                updatePreference('toolbarHints', !preferences.toolbarHints)
            } else if (selectedId.startsWith('format-')) {
                updatePreference('defaultOutputFormat', selectedId.replace('format-', '') as OutputFormat)
            }

            pushOperation({
                action: 'menu.showContextMenu',
                status: 'success',
                message: `已选择菜单项 ${selectedId}`,
            })
        } catch (error) {
            pushOperation({
                action: 'menu.showContextMenu',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`显示右键菜单失败: ${getErrorMessage(error)}`)
        }
    }, [menu, notify, preferences, pushOperation, updatePreference])

    const rawData = useMemo(() => ({
        theme: {
            info: themeInfo,
            actual: actualTheme,
            note: 'This page reads and follows theme state but does not mutate host theme settings.',
        },
        localInterfacePreferences: preferences,
        shortcuts: {
            registered: registeredShortcuts,
            lastTriggered,
        },
        tray: {
            exists: trayExists,
            icon: 'data-url redacted',
        },
        contextMenu: {
            lastSelection: lastMenuSelection,
        },
        operations: operationLog,
    }), [
        actualTheme,
        lastMenuSelection,
        lastTriggered,
        operationLog,
        preferences,
        registeredShortcuts,
        themeInfo,
        trayExists,
    ])

    return (
        <div className="main-content">
            <PageHeader
                icon={Settings}
                title="插件界面设置"
                description="主题跟随、快捷键、托盘和原生菜单"
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div style={{ display: 'grid', gap: 'var(--spacing-lg)', minWidth: 0 }}>
                        <Card
                            title="界面偏好草稿"
                            icon={SlidersHorizontal}
                            actions={(
                                <Button variant="secondary" onClick={() => setPreferences(DEFAULT_PREFERENCES)}>
                                    <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                    重置
                                </Button>
                            )}
                        >
                            <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                                <div className="stat-item">
                                    <div className="stat-value">{preferences.density === 'compact' ? '紧凑' : '标准'}</div>
                                    <div className="stat-label">界面密度</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{actualTheme ? themeText(actualTheme) : 'N/A'}</div>
                                    <div className="stat-label">实际主题</div>
                                </div>
                                <div className="stat-item">
                                    <div className="stat-value">{preferences.defaultOutputFormat.toUpperCase()}</div>
                                    <div className="stat-label">默认输出</div>
                                </div>
                            </div>

                            <div className="input-row">
                                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', color: 'var(--text-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={preferences.autoFocusSearch}
                                        onChange={event => updatePreference('autoFocusSearch', event.target.checked)}
                                    />
                                    自动聚焦搜索
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', color: 'var(--text-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={preferences.toolbarHints}
                                        onChange={event => updatePreference('toolbarHints', event.target.checked)}
                                    />
                                    显示工具提示
                                </label>
                            </div>
                        </Card>

                        <div className="grid-2">
                            <Card title="主题跟随" icon={Palette}>
                                <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                    <div className="list-row">
                                        <Palette className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">theme.get()</span>
                                        <span className="list-row-meta">{themeInfo?.mode ?? 'N/A'}</span>
                                        <span className="list-row-meta">{themeInfo ? themeText(themeInfo.actual) : 'N/A'}</span>
                                    </div>
                                    <div className="list-row">
                                        <Palette className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">theme.getActual()</span>
                                        <span className="list-row-meta">{actualTheme ? themeText(actualTheme) : 'N/A'}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                                        这里仅读取并跟随宿主主题，不调用会改变宿主全局主题设置的方法。
                                    </div>
                                </div>
                            </Card>

                            <Card
                                title="系统托盘"
                                icon={Bell}
                                actions={(
                                    <Button variant="secondary" onClick={() => void refreshTray()}>
                                        <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                        刷新
                                    </Button>
                                )}
                            >
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    <div>
                                        状态: <StatusBadge status={trayExists ? 'success' : 'info'}>
                                            {trayExists ? '已创建' : '未创建'}
                                        </StatusBadge>
                                    </div>
                                    <div className="action-bar">
                                        <Button variant="secondary" onClick={() => void handleCreateTray()} loading={loadingAction === 'tray'} disabled={trayExists}>
                                            <Bell className="inline-icon" aria-hidden="true" size={14} />
                                            创建托盘
                                        </Button>
                                        <Button variant="secondary" onClick={() => void handleUpdateTray()} loading={loadingAction === 'tray'} disabled={!trayExists}>
                                            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                            更新托盘
                                        </Button>
                                        <Button variant="secondary" onClick={() => void handleDestroyTray()} loading={loadingAction === 'tray'} disabled={!trayExists}>
                                            <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                            销毁托盘
                                        </Button>
                                    </div>
                                </div>
                            </Card>
                        </div>

                        <Card title="快捷键与右键菜单" icon={Keyboard}>
                            <div className="grid-2">
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    <div className="input-row">
                                        <input
                                            className="input"
                                            value={newShortcut}
                                            onChange={event => setNewShortcut(event.target.value)}
                                            placeholder="CommandOrControl+Shift+X"
                                        />
                                        <Button onClick={() => void handleRegisterShortcut()} loading={loadingAction === 'shortcut'}>
                                            <Keyboard className="inline-icon" aria-hidden="true" size={14} />
                                            注册
                                        </Button>
                                    </div>

                                    <div className="action-bar">
                                        {SAMPLE_SHORTCUTS.map(accelerator => (
                                            <Button
                                                key={accelerator}
                                                variant="secondary"
                                                onClick={() => setNewShortcut(accelerator)}
                                            >
                                                {accelerator.replace('CommandOrControl', 'Cmd')}
                                            </Button>
                                        ))}
                                    </div>

                                    {registeredShortcuts.length > 0 ? (
                                        <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                            {registeredShortcuts.map(accelerator => (
                                                <div className="list-row" key={accelerator}>
                                                    <Keyboard className="inline-icon" aria-hidden="true" size={14} />
                                                    <span className="list-row-main">{accelerator}</span>
                                                    <Button variant="secondary" onClick={() => void handleUnregisterShortcut(accelerator)}>
                                                        删除
                                                    </Button>
                                                </div>
                                            ))}
                                            <Button variant="secondary" onClick={() => void handleUnregisterAllShortcuts()} loading={loadingAction === 'shortcut'}>
                                                注销全部
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="empty-state">
                                            <Keyboard aria-hidden="true" size={28} />
                                            <p>还没有注册演示快捷键</p>
                                        </div>
                                    )}

                                    {lastTriggered && (
                                        <div className="list-row">
                                            <CheckCircle2 className="inline-icon" aria-hidden="true" size={14} />
                                            <span className="list-row-main">{lastTriggered.accelerator}</span>
                                            <span className="list-row-meta">触发 {lastTriggered.count} 次</span>
                                            <span className="list-row-meta">{formatTime(lastTriggered.timestamp)}</span>
                                        </div>
                                    )}
                                </div>

                                <div
                                    onContextMenu={handleContextMenu}
                                    className="preview-box"
                                    style={{ minHeight: 220, cursor: 'context-menu', flexDirection: 'column', gap: 'var(--spacing-sm)' }}
                                >
                                    <MousePointerClick aria-hidden="true" size={28} />
                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>在此区域右键点击</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>
                                        菜单只修改当前页面草稿；持久化存储示例已移到“存储与安全”模块。
                                    </div>
                                    {lastMenuSelection && (
                                        <StatusBadge status="info">
                                            {lastMenuSelection}
                                        </StatusBadge>
                                    )}
                                </div>
                            </div>
                        </Card>

                        <Card title="最近操作" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.length > 0 ? operationLog.map((item, index) => (
                                    <div className="list-row" key={`${item.timestamp}-${index}`}>
                                        <StatusBadge status={item.status}>{statusText(item.status)}</StatusBadge>
                                        <span className="list-row-main">{item.action}</span>
                                        <span className="list-row-meta">{item.message}</span>
                                        <span className="list-row-meta">{formatDateTime(item.timestamp)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <List aria-hidden="true" size={28} />
                                        <p>暂无操作记录</p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
