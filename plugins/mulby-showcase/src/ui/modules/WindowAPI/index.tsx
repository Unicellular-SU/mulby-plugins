import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import {
    AppWindow,
    BellRing,
    Crosshair,
    FileDown,
    Focus,
    Grip,
    Layers,
    LocateFixed,
    Maximize,
    Minimize,
    MousePointer2,
    PanelTopOpen,
    PanelsTopLeft,
    Pin,
    RefreshCw,
    Search,
    Send,
    SquareDashedMousePointer,
    TextCursorInput,
    TimerReset,
    X,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type WindowMode = 'attached' | 'detached'
type WindowType = 'main' | 'detach'
type OperationStatus = 'success' | 'warning' | 'error' | 'info'
type LoadingAction =
    | 'refresh'
    | 'child'
    | 'overlay'
    | 'drag'
    | 'bounds'
    | null

interface WindowBounds {
    x: number
    y: number
    width: number
    height: number
}

interface WindowStateSnapshot {
    isMaximized: boolean
    isAlwaysOnTop: boolean
    opacity: number
}

interface DisplaySnapshot {
    id?: number
    bounds: WindowBounds
    workArea?: WindowBounds
    scaleFactor?: number
    isPrimary?: boolean
}

interface ChildWindowHandle {
    id: number
    show(): Promise<void>
    hide(): Promise<void>
    close(): Promise<void>
    destroy(): Promise<void>
    focus(): Promise<void>
    showInactive(): Promise<void>
    setTitle(title: string): Promise<void>
    setSize(width: number, height: number): Promise<void>
    setPosition(x: number, y: number): Promise<void>
    setBounds(bounds: Partial<WindowBounds>): Promise<boolean>
    getBounds(): Promise<WindowBounds>
    setOpacity(opacity: number): Promise<void>
    setBackgroundThrottling(allowed: boolean): Promise<boolean>
    setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): Promise<void>
    setAlwaysOnTop(flag: boolean, level?: string): Promise<void>
    setVisibleOnAllWorkspaces(flag: boolean, options?: { visibleOnFullScreen?: boolean }): Promise<void>
    setFullScreen(flag: boolean): Promise<void>
    postMessage(channel: string, ...args: unknown[]): Promise<void>
}

interface ChildWindowRecord {
    id: number
    instanceId?: string
    name: string
    kind: 'route' | 'overlay'
    proxy: ChildWindowHandle
    createdAt: number
    bounds: WindowBounds | null
    opacity: number
    alwaysOnTop: boolean
    backgroundThrottling: boolean
    ignoreMouseEvents: boolean
    visibleOnAllWorkspaces: boolean
    fullscreen: boolean
    lastAction: string
}

interface ChildMessage {
    channel: string
    args: unknown[]
    timestamp: number
}

interface ChildClosePayload {
    id?: number
    instanceId?: string
    source?: string
    index?: string
    overlay?: boolean
    label?: string
    at?: number
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

interface ResizeDragState {
    active: boolean
    edge: 'bottom-right'
    startX: number
    startY: number
    baseBounds: WindowBounds
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString()
}

function summarizeArgs(args: unknown[]) {
    try {
        return JSON.stringify(args)
    } catch {
        return String(args)
    }
}

function toWindowBounds(value: unknown): WindowBounds | null {
    if (!value || typeof value !== 'object') return null

    const bounds = value as Partial<WindowBounds>
    if (
        typeof bounds.x !== 'number'
        || typeof bounds.y !== 'number'
        || typeof bounds.width !== 'number'
        || typeof bounds.height !== 'number'
    ) {
        return null
    }

    return {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    }
}

function clampOpacity(value: number) {
    return Math.min(1, Math.max(0.3, value))
}

function pathBasename(path: string) {
    return path.split(/[\\/]/).filter(Boolean).pop() || path
}

function createChildWindowInstanceId() {
    return `child-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function WindowAPIModule() {
    const {
        window: win,
        subInput,
        filesystem,
        system,
        dialog,
        screen,
        onWindowStateChange,
    } = useMulby()
    const notify = useNotification()

    const childWindowsRef = useRef<ChildWindowRecord[]>([])

    const [windowType, setWindowType] = useState<WindowType | '-'>('-')
    const [windowMode, setWindowMode] = useState<WindowMode | '-'>('-')
    const [windowState, setWindowState] = useState<WindowStateSnapshot | null>(null)
    const [bounds, setBounds] = useState<WindowBounds | null>(null)
    const [opacity, setOpacityValue] = useState(1)
    const [alwaysOnTop, setAlwaysOnTop] = useState(false)
    const [backgroundThrottling, setBackgroundThrottling] = useState(true)
    const [ignoreMouseEvents, setIgnoreMouseEvents] = useState(false)
    const [visibleOnAllWorkspaces, setVisibleOnAllWorkspaces] = useState(false)
    const [fullscreen, setFullscreen] = useState(false)
    const [customTitle, setCustomTitle] = useState('Mulby Showcase Window')
    const [subInputEnabled, setSubInputEnabled] = useState(false)
    const [subInputText, setSubInputText] = useState('')
    const [subInputPreset, setSubInputPreset] = useState('由插件写入的 SubInput 内容')
    const [searchText, setSearchText] = useState('窗口')
    const [matchCase, setMatchCase] = useState(false)
    const [findResult, setFindResult] = useState<number | null>(null)
    const [childWindows, setChildWindows] = useState<ChildWindowRecord[]>([])
    const [childMessages, setChildMessages] = useState<ChildMessage[]>([])
    const [dragFilePath, setDragFilePath] = useState('')
    const [generatedTextPath, setGeneratedTextPath] = useState('')
    const [dragHint, setDragHint] = useState('先选择或生成文件')
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [resizeDrag, setResizeDrag] = useState<ResizeDragState | null>(null)

    useEffect(() => {
        childWindowsRef.current = childWindows
    }, [childWindows])

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 12))
    }, [])

    const removeClosedChild = useCallback((payload?: ChildClosePayload) => {
        const matchesPayload = (child: ChildWindowRecord) => {
            const matchesInstance = Boolean(payload?.instanceId && child.instanceId === payload.instanceId)
            const matchesId = Boolean(payload?.id && child.id === payload.id)
            const matchesRouteIndex = Boolean(
                !payload?.instanceId
                && !payload?.id
                && payload?.index
                && child.kind === 'route'
                && child.name === `子窗口 #${payload.index}`
            )

            return matchesInstance || matchesId || matchesRouteIndex
        }

        const removedChild = childWindowsRef.current.find(matchesPayload)
        if (!removedChild) return

        setChildWindows(current => current.filter(child => !matchesPayload(child)))

        pushOperation({
            action: 'child.closed',
            status: 'info',
            message: `${removedChild.name} 已关闭并从列表移除`,
            details: payload,
        })
    }, [pushOperation])

    const loadWindowInfo = useCallback(async () => {
        setLoadingAction('refresh')
        try {
            const [type, mode, state, currentBounds, currentOpacity] = await Promise.all([
                win.getWindowType(),
                win.getMode(),
                win.getState(),
                win.getBounds(),
                win.getOpacity(),
            ])
            setWindowType(type || '-')
            setWindowMode(mode || '-')
            setWindowState(state)
            setBounds(currentBounds)
            setOpacityValue(currentOpacity)
            setAlwaysOnTop(Boolean(state?.isAlwaysOnTop))
            pushOperation({
                action: 'window.getState',
                status: 'success',
                message: '已刷新窗口状态',
                details: { type, mode, state, bounds: currentBounds, opacity: currentOpacity },
            })
        } catch (error) {
            pushOperation({
                action: 'window.getState',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('刷新窗口状态失败')
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, win])

    useEffect(() => {
        void loadWindowInfo()
    }, [loadWindowInfo])

    useEffect(() => {
        return subInput.onChange((data) => {
            setSubInputText(data.text)
        })
    }, [subInput])

    useEffect(() => {
        if (!onWindowStateChange) return undefined

        return onWindowStateChange((state) => {
            setWindowState(current => ({
                isMaximized: state.isMaximized,
                isAlwaysOnTop: current?.isAlwaysOnTop ?? alwaysOnTop,
                opacity: current?.opacity ?? opacity,
            }))
            pushOperation({
                action: 'onWindowStateChange',
                status: 'info',
                message: `窗口最大化状态变为 ${state.isMaximized ? '是' : '否'}`,
                details: state,
            })
        })
    }, [alwaysOnTop, onWindowStateChange, opacity, pushOperation])

    useEffect(() => {
        return win.onChildMessage((channel, ...args) => {
            const timestamp = Date.now()
            setChildMessages(current => [
                { channel, args, timestamp },
                ...current,
            ].slice(0, 12))

            if (channel === 'child-event') {
                notify.info(`收到子窗口消息: ${String(args[0] ?? '')}`)
            }

            if (channel === 'child-window-closing' || channel === 'child-window-closed') {
                const payload = args[0] as ChildClosePayload | undefined
                removeClosedChild(payload)
            }

            if (channel === 'relay-request') {
                const payload = args[0] as { from?: string; message?: string } | undefined
                childWindowsRef.current.forEach((child) => {
                    void child.proxy.postMessage('relayed', {
                        originalFrom: payload?.from,
                        message: payload?.message,
                        relayedAt: timestamp,
                    })
                })
                pushOperation({
                    action: 'window.onChildMessage',
                    status: 'info',
                    message: '已将子窗口请求转发给当前插件创建的其他子窗口',
                    details: { channel, args },
                })
            }
        })
    }, [notify, pushOperation, removeClosedChild, win])

    const updateChild = useCallback((id: number, patch: Partial<ChildWindowRecord>) => {
        setChildWindows(current => current.map(child => (
            child.id === id ? { ...child, ...patch } : child
        )))
    }, [])

    const removeChild = useCallback((id: number) => {
        setChildWindows(current => current.filter(child => child.id !== id))
    }, [])

    const refreshChildBounds = useCallback(async (child: ChildWindowRecord) => {
        const nextBounds = await child.proxy.getBounds()
        updateChild(child.id, { bounds: nextBounds, lastAction: 'getBounds' })
        return nextBounds
    }, [updateChild])

    const runWindowAction = useCallback(async (
        action: string,
        callback: () => unknown | Promise<unknown>,
        options?: { refresh?: boolean; success?: string; warning?: string }
    ) => {
        try {
            const details = await callback()
            pushOperation({
                action,
                status: 'success',
                message: options?.success || '操作已发送到宿主',
                details,
            })
            if (options?.warning) {
                notify.warning(options.warning)
            }
            if (options?.refresh) {
                setTimeout(() => void loadWindowInfo(), 120)
            }
        } catch (error) {
            pushOperation({
                action,
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`${action} 失败`)
        }
    }, [loadWindowInfo, notify, pushOperation])

    const handleSetTitle = () => {
        void runWindowAction('window.setTitle', () => {
            win.setTitle(customTitle)
            return { title: customTitle }
        }, { success: '已设置当前窗口标题' })
    }

    const handleSetSize = (width: number, height: number) => {
        void runWindowAction('window.setSize', () => {
            win.setSize(width, height)
            return { width, height }
        }, { refresh: true, success: `窗口大小已设置为 ${width}x${height}` })
    }

    const handleSetBounds = async () => {
        if (!bounds) {
            notify.warning('请先刷新窗口边界')
            return
        }

        setLoadingAction('bounds')
        try {
            const nextBounds = {
                x: bounds.x + 16,
                y: bounds.y + 16,
                width: Math.max(420, bounds.width),
                height: Math.max(360, bounds.height),
            }
            const success = await win.setBounds(nextBounds)
            setBounds(nextBounds)
            pushOperation({
                action: 'window.setBounds',
                status: success ? 'success' : 'warning',
                message: success ? '窗口边界已更新' : '宿主未应用窗口边界',
                details: nextBounds,
            })
            setTimeout(() => void loadWindowInfo(), 120)
        } catch (error) {
            pushOperation({
                action: 'window.setBounds',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('设置窗口边界失败')
        } finally {
            setLoadingAction(null)
        }
    }

    const handleSetPosition = () => {
        if (!bounds) {
            notify.warning('请先刷新窗口边界')
            return
        }

        void runWindowAction('window.setPosition', () => {
            win.setPosition(bounds.x + 24, bounds.y + 24)
            return { x: bounds.x + 24, y: bounds.y + 24 }
        }, { refresh: true, success: '窗口位置已偏移' })
    }

    const handleSetHeight = (height: number, allowResize = false) => {
        void runWindowAction('window.setExpendHeight', () => {
            win.setExpendHeight(height, allowResize)
            return { height, allowResize }
        }, { refresh: true, success: `窗口高度已设置为 ${height}px` })
    }

    const handleToggleAlwaysOnTop = (flag: boolean) => {
        void runWindowAction('window.setAlwaysOnTop', () => {
            win.setAlwaysOnTop(flag, flag ? 'floating' : undefined)
            setAlwaysOnTop(flag)
            setWindowState(current => current ? { ...current, isAlwaysOnTop: flag } : current)
            return { flag, level: flag ? 'floating' : undefined }
        }, { refresh: true, success: flag ? '已设置当前窗口置顶' : '已取消当前窗口置顶' })
    }

    const handleOpacityChange = (nextOpacity: number) => {
        const normalized = clampOpacity(nextOpacity)
        setOpacityValue(normalized)
        void runWindowAction('window.setOpacity', async () => {
            await win.setOpacity(normalized)
            setWindowState(current => current ? { ...current, opacity: normalized } : current)
            return { opacity: normalized }
        }, { refresh: true, success: `窗口透明度已设置为 ${normalized.toFixed(2)}` })
    }

    const handleToggleBackgroundThrottling = (allowed: boolean) => {
        void runWindowAction('window.setBackgroundThrottling', async () => {
            const success = await win.setBackgroundThrottling(allowed)
            setBackgroundThrottling(allowed)
            return { allowed, success }
        }, { success: allowed ? '已允许后台节流' : '已禁用后台节流' })
    }

    const handleToggleIgnoreMouse = (ignore: boolean) => {
        void runWindowAction('window.setIgnoreMouseEvents', () => {
            win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined)
            setIgnoreMouseEvents(ignore)
            return { ignore, forward: ignore }
        }, {
            success: ignore ? '已开启鼠标事件穿透' : '已关闭鼠标事件穿透',
            warning: ignore ? '鼠标穿透后可能需要使用键盘或宿主窗口控制恢复' : undefined,
        })
    }

    const handleToggleAllWorkspaces = (flag: boolean) => {
        void runWindowAction('window.setVisibleOnAllWorkspaces', () => {
            win.setVisibleOnAllWorkspaces(flag, { visibleOnFullScreen: flag })
            setVisibleOnAllWorkspaces(flag)
            return { flag, visibleOnFullScreen: flag }
        }, { success: flag ? '已请求在所有工作区可见' : '已取消所有工作区可见' })
    }

    const handleToggleFullscreen = (flag: boolean) => {
        void runWindowAction('window.setFullScreen', () => {
            win.setFullScreen(flag)
            setFullscreen(flag)
            return { flag }
        }, { refresh: true, success: flag ? '已进入全屏' : '已退出全屏' })
    }

    const handleResizeGripPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!bounds) {
            notify.warning('请先刷新窗口边界')
            return
        }

        event.currentTarget.setPointerCapture(event.pointerId)
        setResizeDrag({
            active: true,
            edge: 'bottom-right',
            startX: event.screenX,
            startY: event.screenY,
            baseBounds: bounds,
        })
    }

    const handleResizeGripPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!resizeDrag?.active) return

        win.resizeDrag({
            edge: resizeDrag.edge,
            startX: resizeDrag.startX,
            startY: resizeDrag.startY,
            currentX: event.screenX,
            currentY: event.screenY,
            baseBounds: resizeDrag.baseBounds,
        })
    }

    const handleResizeGripPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (resizeDrag?.active) {
            event.currentTarget.releasePointerCapture(event.pointerId)
            setResizeDrag(null)
            setTimeout(() => void loadWindowInfo(), 120)
            pushOperation({
                action: 'window.resizeDrag',
                status: 'info',
                message: '拖拽缩放已结束',
                details: resizeDrag,
            })
        }
    }

    const handleEnableSubInput = async () => {
        try {
            const result = await subInput.set('在这里输入内容...', true)
            setSubInputEnabled(result)
            pushOperation({
                action: 'subInput.set',
                status: result ? 'success' : 'warning',
                message: result ? '子输入框已启用' : '宿主未启用子输入框',
            })
            if (result) notify.success('子输入框已启用')
        } catch (error) {
            pushOperation({
                action: 'subInput.set',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('启用子输入框失败')
        }
    }

    const handleDisableSubInput = async () => {
        try {
            const result = await subInput.remove()
            setSubInputEnabled(false)
            setSubInputText('')
            pushOperation({
                action: 'subInput.remove',
                status: result ? 'success' : 'warning',
                message: result ? '子输入框已移除' : '宿主未返回移除成功',
            })
        } catch (error) {
            pushOperation({
                action: 'subInput.remove',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('移除子输入框失败')
        }
    }

    const handleSetSubInputValue = () => {
        subInput.setValue(subInputPreset)
        setSubInputText(subInputPreset)
        pushOperation({
            action: 'subInput.setValue',
            status: 'success',
            message: '已写入子输入框内容',
            details: { text: subInputPreset },
        })
    }

    const handleFindInPage = async (findNext = false) => {
        if (!searchText.trim()) {
            notify.warning('请输入搜索内容')
            return
        }

        try {
            const requestId = await win.findInPage(searchText.trim(), {
                forward: true,
                findNext,
                matchCase,
            })
            setFindResult(requestId)
            pushOperation({
                action: 'window.findInPage',
                status: 'success',
                message: `查找请求 ID: ${requestId}`,
                details: { text: searchText.trim(), findNext, matchCase },
            })
        } catch (error) {
            pushOperation({
                action: 'window.findInPage',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('查找失败')
        }
    }

    const handleStopFind = () => {
        win.stopFindInPage('clearSelection')
        setFindResult(null)
        pushOperation({
            action: 'window.stopFindInPage',
            status: 'info',
            message: '已停止页面查找并清除选区',
        })
    }

    const addChildRecord = useCallback(async (
        proxy: ChildWindowHandle,
        name: string,
        kind: ChildWindowRecord['kind'],
        patch?: Partial<ChildWindowRecord>
    ) => {
        let childBounds: WindowBounds | null = null
        try {
            childBounds = await proxy.getBounds()
        } catch {
            childBounds = null
        }

        setChildWindows(current => [
            ...current,
            {
                id: proxy.id,
                instanceId: patch?.instanceId,
                name,
                kind,
                proxy,
                createdAt: Date.now(),
                bounds: childBounds ?? patch?.bounds ?? null,
                opacity: patch?.opacity ?? 1,
                alwaysOnTop: patch?.alwaysOnTop ?? false,
                backgroundThrottling: patch?.backgroundThrottling ?? true,
                ignoreMouseEvents: patch?.ignoreMouseEvents ?? false,
                visibleOnAllWorkspaces: patch?.visibleOnAllWorkspaces ?? false,
                fullscreen: patch?.fullscreen ?? false,
                lastAction: 'created',
            },
        ])
    }, [])

    const handleCreateChild = async () => {
        setLoadingAction('child')
        try {
            const childIndex = childWindows.filter(child => child.kind === 'route').length + 1
            const instanceId = createChildWindowInstanceId()
            const childWindowBounds = toWindowBounds(await win.getBounds()) || bounds || { x: 0, y: 0, width: 560, height: 420 }
            const proxy = await win.create('child-window', {
                loadMode: 'route',
                width: childWindowBounds.width,
                height: childWindowBounds.height,
                title: `Showcase 子窗口 #${childIndex}`,
                backgroundThrottling: false,
                params: {
                    source: 'window-api',
                    index: String(childIndex),
                    instanceId,
                },
            }) as ChildWindowHandle | null
            if (!proxy) {
                pushOperation({
                    action: 'window.create',
                    status: 'warning',
                    message: '宿主未返回子窗口句柄',
                })
                return
            }

            await addChildRecord(proxy, `子窗口 #${childIndex}`, 'route', {
                instanceId,
                backgroundThrottling: false,
                bounds: childWindowBounds,
            })
            pushOperation({
                action: 'window.create',
                status: 'success',
                message: `已创建子窗口 #${childIndex}`,
                details: { id: proxy.id, loadMode: 'route', bounds: childWindowBounds },
            })
        } catch (error) {
            pushOperation({
                action: 'window.create',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('创建子窗口失败')
        } finally {
            setLoadingAction(null)
        }
    }

    const handleCreateOverlay = async () => {
        setLoadingAction('overlay')
        try {
            const primary = await screen.getPrimaryDisplay() as DisplaySnapshot
            const displayBounds = toWindowBounds(primary?.bounds) || { x: 0, y: 0, width: 640, height: 420 }
            const overlayWidth = Math.min(420, Math.max(320, displayBounds.width - 160))
            const overlayHeight = 240
            const overlayBounds = {
                x: displayBounds.x + Math.max(24, displayBounds.width - overlayWidth - 80),
                y: displayBounds.y + 80,
                width: overlayWidth,
                height: overlayHeight,
            }
            const instanceId = createChildWindowInstanceId()
            const proxy = await win.create('child-window', {
                loadMode: 'route',
                title: 'Showcase 覆盖层子窗口',
                type: 'borderless',
                titleBar: false,
                x: overlayBounds.x,
                y: overlayBounds.y,
                width: overlayBounds.width,
                height: overlayBounds.height,
                transparent: true,
                alwaysOnTop: true,
                alwaysOnTopLevel: 'screen-saver',
                focusable: false,
                skipTaskbar: true,
                enableLargerThanScreen: true,
                ignoreMouseEvents: true,
                forwardMouseEvents: true,
                visibleOnAllWorkspaces: true,
                visibleOnFullScreen: true,
                backgroundThrottling: false,
                opacity: 0.92,
                params: {
                    source: 'window-api',
                    overlay: 'true',
                    instanceId,
                },
            }) as ChildWindowHandle | null

            if (!proxy) {
                pushOperation({
                    action: 'window.create overlay',
                    status: 'warning',
                    message: '宿主未返回覆盖层子窗口句柄',
                })
                return
            }

            await addChildRecord(proxy, '覆盖层窗口', 'overlay', {
                instanceId,
                bounds: overlayBounds,
                opacity: 0.92,
                alwaysOnTop: true,
                backgroundThrottling: false,
                ignoreMouseEvents: true,
                visibleOnAllWorkspaces: true,
            })
            pushOperation({
                action: 'window.create overlay',
                status: 'success',
                message: '已创建覆盖层子窗口',
                details: { id: proxy.id, bounds: overlayBounds, display: primary },
            })
        } catch (error) {
            pushOperation({
                action: 'window.create overlay',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('创建覆盖层子窗口失败')
        } finally {
            setLoadingAction(null)
        }
    }

    const handleChildAction = async (
        child: ChildWindowRecord,
        label: string,
        callback: (proxy: ChildWindowHandle) => Promise<unknown>,
        patch?: Partial<ChildWindowRecord>
    ) => {
        try {
            const details = await callback(child.proxy)
            updateChild(child.id, { ...patch, lastAction: label })
            pushOperation({
                action: `child.${label}`,
                status: 'success',
                message: `${child.name} 已执行 ${label}`,
                details: { id: child.id, result: details },
            })
        } catch (error) {
            pushOperation({
                action: `child.${label}`,
                status: 'error',
                message: getErrorMessage(error),
                details: { id: child.id },
            })
            notify.error(`${child.name} 操作失败`)
        }
    }

    const handleCloseChild = async (child: ChildWindowRecord, destroy = false) => {
        try {
            if (destroy) {
                await child.proxy.destroy()
            } else {
                await child.proxy.close()
            }
            removeChild(child.id)
            pushOperation({
                action: destroy ? 'child.destroy' : 'child.close',
                status: 'success',
                message: `${child.name} 已${destroy ? '销毁' : '关闭'}`,
                details: { id: child.id },
            })
        } catch (error) {
            pushOperation({
                action: destroy ? 'child.destroy' : 'child.close',
                status: 'error',
                message: getErrorMessage(error),
                details: { id: child.id },
            })
            notify.error('关闭子窗口失败')
        }
    }

    const handleCloseAllChildren = async () => {
        const windows = [...childWindows]
        for (const child of windows) {
            try {
                await child.proxy.close()
            } catch {
                // Child windows can already be closed by the user.
            }
        }
        setChildWindows([])
        setChildMessages([])
        pushOperation({
            action: 'child.closeAll',
            status: 'info',
            message: `已请求关闭 ${windows.length} 个子窗口`,
        })
    }

    const handleBroadcast = async () => {
        const payload = {
            from: 'window-api',
            message: `父窗口广播 ${formatTime(Date.now())}`,
        }
        await Promise.allSettled(childWindows.map(child => child.proxy.postMessage('broadcast', payload)))
        pushOperation({
            action: 'child.postMessage broadcast',
            status: 'success',
            message: `已广播给 ${childWindows.length} 个子窗口`,
            details: payload,
        })
    }

    const handlePickDragFile = async () => {
        try {
            const files = await dialog.showOpenDialog({
                title: '选择要拖出的文件',
                properties: ['openFile'],
            })
            const filePath = files?.[0]
            if (filePath) {
                setDragFilePath(filePath)
                setDragHint(`已选择 ${pathBasename(filePath)}`)
                pushOperation({
                    action: 'dialog.showOpenDialog',
                    status: 'success',
                    message: '已选择拖拽文件',
                    details: { filePath },
                })
            }
        } catch (error) {
            pushOperation({
                action: 'dialog.showOpenDialog',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('选择文件失败')
        }
    }

    const createTempFile = useCallback(async () => {
        setLoadingAction('drag')
        try {
            const tempDir = await system.getPath('temp')
            if (!tempDir) {
                notify.error('无法获取临时目录')
                return ''
            }
            const timestamp = Date.now()
            const filePath = `${tempDir}/mulby-window-drag-${timestamp}.txt`
            const content = [
                'Mulby Showcase Window Drag Demo',
                `createdAt=${new Date(timestamp).toISOString()}`,
                `bounds=${JSON.stringify(bounds)}`,
            ].join('\n')
            await filesystem.writeFile(filePath, content, 'utf-8')
            setGeneratedTextPath(filePath)
            setDragHint(`已生成 ${pathBasename(filePath)}`)
            pushOperation({
                action: 'filesystem.writeFile',
                status: 'success',
                message: '已生成临时拖拽文件',
                details: { filePath },
            })
            return filePath
        } catch (error) {
            pushOperation({
                action: 'filesystem.writeFile',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('生成临时文件失败')
            return ''
        } finally {
            setLoadingAction(null)
        }
    }, [bounds, filesystem, notify, pushOperation, system])

    const handleStartDrag = (filePath: string, event?: DragEvent<HTMLDivElement>) => {
        event?.preventDefault()
        if (!filePath) {
            notify.warning('请先选择或生成文件')
            return
        }

        try {
            win.startDrag(filePath)
            pushOperation({
                action: 'window.startDrag',
                status: 'success',
                message: '已启动系统原生文件拖拽',
                details: { filePath },
            })
        } catch (error) {
            pushOperation({
                action: 'window.startDrag',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('拖拽失败')
        }
    }

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Window Status',
            items: [
                { name: 'window.getWindowType()', description: '获取当前窗口类型，主面板返回 main，独立/子窗口返回 detach。' },
                { name: 'window.getMode()', description: '获取插件窗口模式：attached 或 detached。' },
                { name: 'window.getState()', description: '读取最大化、置顶和透明度状态。' },
                { name: 'window.getBounds()', description: '读取当前窗口屏幕边界。' },
                { name: 'window.getOpacity()', description: '读取当前窗口透明度。' },
                { name: 'onWindowStateChange(callback)', description: '监听窗口最大化状态变化，回调需要在卸载时释放。' },
            ],
        },
        {
            title: 'Current Window Control',
            items: [
                { name: 'window.invalidate()', description: '请求重绘当前窗口。' },
                { name: 'window.show()', description: '显示并聚焦当前窗口。' },
                { name: 'window.showInactive()', description: '显示窗口但不主动抢焦点。' },
                { name: 'window.focus()', description: '请求当前窗口和插件内容获得焦点。' },
                { name: 'window.setTitle(title)', description: '设置当前窗口标题。' },
                { name: 'window.setSize(width, height)', description: '设置当前窗口大小。' },
                { name: 'window.setPosition(x, y)', description: '设置当前窗口左上角坐标。' },
                { name: 'window.setBounds(bounds)', description: '设置当前窗口位置和尺寸，字段可部分传入。' },
                { name: 'window.setExpendHeight(height, allowResize)', description: '只调整窗口高度，可选择放开尺寸限制。' },
                { name: 'window.center()', description: '将当前窗口移动到屏幕中心。' },
                { name: 'window.detach()', description: '将当前插件从主面板分离为独立窗口。' },
                { name: 'window.minimize()', description: '最小化当前窗口。' },
                { name: 'window.maximize()', description: '最大化或还原当前窗口。' },
                { name: 'window.reload()', description: '重新加载当前插件窗口。' },
                { name: 'window.setAlwaysOnTop(flag, level)', description: '设置当前窗口置顶状态和层级。' },
                { name: 'window.setOpacity(opacity)', description: '设置当前窗口透明度。' },
                { name: 'window.setBackgroundThrottling(allowed)', description: '控制当前 WebContents 后台节流。' },
                { name: 'window.setIgnoreMouseEvents(ignore, options)', description: '设置鼠标事件穿透，forward 可继续接收鼠标移动。' },
                { name: 'window.setVisibleOnAllWorkspaces(flag, options)', description: '请求当前窗口在所有工作区可见。' },
                { name: 'window.setFullScreen(flag)', description: '设置当前窗口全屏状态。' },
                { name: 'window.resizeDrag(payload)', description: '自定义边框拖拽缩放时把拖拽数据交给宿主执行。' },
            ],
        },
        {
            title: 'Child Windows',
            items: [
                { name: 'window.create(route, options)', description: '以路由模式创建当前插件的子窗口，返回同插件作用域内的控制句柄。' },
                { name: 'child.show() / hide() / showInactive()', description: '控制子窗口显示状态。' },
                { name: 'child.focus()', description: '请求子窗口获得焦点。' },
                { name: 'child.setTitle(title)', description: '修改子窗口标题。' },
                { name: 'child.setSize(width, height)', description: '修改子窗口大小。' },
                { name: 'child.setPosition(x, y)', description: '修改子窗口坐标。' },
                { name: 'child.setBounds(bounds)', description: '修改子窗口边界。' },
                { name: 'child.getBounds()', description: '读取子窗口边界。' },
                { name: 'child.setOpacity(opacity)', description: '修改子窗口透明度。' },
                { name: 'child.setBackgroundThrottling(allowed)', description: '控制子窗口后台节流。' },
                { name: 'child.setIgnoreMouseEvents(ignore, options)', description: '控制子窗口鼠标穿透。' },
                { name: 'child.setAlwaysOnTop(flag, level)', description: '控制子窗口置顶。' },
                { name: 'child.setVisibleOnAllWorkspaces(flag, options)', description: '控制子窗口全工作区可见。' },
                { name: 'child.setFullScreen(flag)', description: '控制子窗口全屏。' },
                { name: 'child.postMessage(channel, ...args)', description: '向子窗口发送消息。' },
                { name: 'child.close() / destroy()', description: '关闭或销毁当前插件创建的子窗口。' },
            ],
        },
        {
            title: 'Messaging, Search, Drag, SubInput',
            items: [
                { name: 'window.onChildMessage(callback)', description: '监听直接子窗口发来的消息，监听器需要释放。' },
                { name: 'window.findInPage(text, options)', description: '在当前页面内查找文本。' },
                { name: 'window.stopFindInPage(action)', description: '停止页面查找并控制选区行为。' },
                { name: 'window.startDrag(filePath)', description: '以真实本地文件路径启动系统原生拖拽。' },
                { name: 'subInput.set(placeholder, isFocus)', description: '显示宿主子输入框并可请求焦点。' },
                { name: 'subInput.remove()', description: '移除宿主子输入框。' },
                { name: 'subInput.setValue(text)', description: '向宿主子输入框写入文本。' },
                { name: 'subInput.focus() / blur() / select()', description: '控制宿主子输入框焦点和选区。' },
                { name: 'subInput.onChange(callback)', description: '监听宿主子输入框文本变化，监听器需要释放。' },
            ],
        },
        {
            title: 'Related APIs Used By This Page',
            items: [
                { name: 'screen.getPrimaryDisplay()', description: '为覆盖层子窗口计算主显示器边界。' },
                { name: 'dialog.showOpenDialog(options)', description: '选择用于原生拖拽的文件。' },
                { name: 'system.getPath("temp")', description: '获取临时目录以生成演示拖拽文件。' },
                { name: 'filesystem.writeFile(path, data, encoding)', description: '写入演示拖拽文件。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '读取并控制当前窗口',
            code: `const state = await window.mulby.window.getState()
const bounds = await window.mulby.window.getBounds()
const opacity = await window.mulby.window.getOpacity()

await window.mulby.window.setBounds({
  x: bounds.x + 16,
  y: bounds.y + 16,
  width: bounds.width,
  height: bounds.height
})

window.mulby.window.setAlwaysOnTop(true, 'floating')
await window.mulby.window.setOpacity(0.9)`,
        },
        {
            title: '创建路由子窗口并通信',
            code: `const bounds = await window.mulby.window.getBounds()

const child = await window.mulby.window.create('child-window', {
  loadMode: 'route',
  width: bounds?.width ?? 560,
  height: bounds?.height ?? 420,
  title: 'Showcase 子窗口',
  params: { source: 'window-api' }
})

await child?.postMessage('ping', { at: Date.now() })

const dispose = window.mulby.window.onChildMessage((channel, ...args) => {
  console.log(channel, args)
})

dispose()`,
        },
        {
            title: '覆盖层子窗口',
            code: `const display = await window.mulby.screen.getPrimaryDisplay()

const overlay = await window.mulby.window.create('child-window', {
  x: display.bounds.x,
  y: display.bounds.y,
  width: display.bounds.width,
  height: display.bounds.height,
  type: 'borderless',
  titleBar: false,
  transparent: true,
  alwaysOnTop: true,
  alwaysOnTopLevel: 'screen-saver',
  focusable: false,
  skipTaskbar: true,
  ignoreMouseEvents: true,
  forwardMouseEvents: true,
  visibleOnAllWorkspaces: true,
  visibleOnFullScreen: true,
  backgroundThrottling: false
})

await overlay?.setIgnoreMouseEvents(false)`,
        },
        {
            title: 'SubInput、查找和文件拖拽',
            code: `await window.mulby.subInput.set('输入内容...', true)
window.mulby.subInput.setValue('preset')

const requestId = await window.mulby.window.findInPage('窗口', {
  forward: true,
  findNext: false,
  matchCase: false
})
window.mulby.window.stopFindInPage('clearSelection')

window.mulby.window.startDrag('/absolute/path/to/file.txt')`,
        },
    ], [])

    const rawData = useMemo(() => ({
        currentWindow: {
            windowType,
            windowMode,
            windowState,
            bounds,
            opacity,
            alwaysOnTop,
            backgroundThrottling,
            ignoreMouseEvents,
            visibleOnAllWorkspaces,
            fullscreen,
            customTitle,
        },
        subInput: {
            enabled: subInputEnabled,
            text: subInputText,
            preset: subInputPreset,
        },
        findInPage: {
            searchText,
            matchCase,
            findResult,
        },
        childWindows: childWindows.map(child => ({
            id: child.id,
            name: child.name,
            kind: child.kind,
            createdAt: child.createdAt,
            bounds: child.bounds,
            opacity: child.opacity,
            alwaysOnTop: child.alwaysOnTop,
            backgroundThrottling: child.backgroundThrottling,
            ignoreMouseEvents: child.ignoreMouseEvents,
            visibleOnAllWorkspaces: child.visibleOnAllWorkspaces,
            fullscreen: child.fullscreen,
            instanceId: child.instanceId,
            lastAction: child.lastAction,
        })),
        childMessages,
        drag: {
            selectedFile: dragFilePath,
            generatedTextPath,
            hint: dragHint,
        },
        operationLog,
    }), [
        alwaysOnTop,
        backgroundThrottling,
        bounds,
        childMessages,
        childWindows,
        customTitle,
        dragFilePath,
        dragHint,
        findResult,
        fullscreen,
        generatedTextPath,
        ignoreMouseEvents,
        matchCase,
        opacity,
        operationLog,
        searchText,
        subInputEnabled,
        subInputPreset,
        subInputText,
        visibleOnAllWorkspaces,
        windowMode,
        windowState,
        windowType,
    ])

    return (
        <div className="main-content">
            <PageHeader
                icon={PanelsTopLeft}
                title="窗口 API"
                description="当前窗口控制、子窗口、窗口通信、页面查找、文件拖拽与 SubInput"
                actions={
                    <Button variant="secondary" onClick={() => void loadWindowInfo()} loading={loadingAction === 'refresh'}>
                        <RefreshCw aria-hidden="true" size={14} />刷新状态
                    </Button>
                }
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon"><AppWindow aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{windowType}</div>
                            <div className="stat-label">窗口类型</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><PanelTopOpen aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{windowMode}</div>
                            <div className="stat-label">插件模式</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                {windowState?.isMaximized ? <Maximize aria-hidden="true" size={24} /> : <Minimize aria-hidden="true" size={24} />}
                            </div>
                            <div className="stat-value">{windowState?.isMaximized ? '最大化' : '正常'}</div>
                            <div className="stat-label">最大化状态</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><LocateFixed aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{bounds ? `${bounds.width}x${bounds.height}` : '-'}</div>
                            <div className="stat-label">窗口尺寸</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><Pin aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{alwaysOnTop ? '置顶' : '普通'}</div>
                            <div className="stat-label">窗口层级</div>
                        </div>
                    </div>

                    <div className="grid grid-2">
                        <Card title="当前窗口控制" icon={AppWindow}>
                            <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label className="input-label" htmlFor="window-title-input">窗口标题</label>
                                <div className="input-row">
                                    <input
                                        id="window-title-input"
                                        className="input"
                                        value={customTitle}
                                        onChange={(event) => setCustomTitle(event.target.value)}
                                    />
                                    <Button variant="secondary" onClick={handleSetTitle}>设置</Button>
                                </div>
                            </div>

                            <div className="info-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <span className="info-label">Bounds</span>
                                <span className="info-value">{bounds ? `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}` : '-'}</span>
                                <span className="info-label">Opacity</span>
                                <span className="info-value">{opacity.toFixed(2)}</span>
                            </div>

                            <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <Button variant="secondary" onClick={() => handleSetSize(720, 520)}>720x520</Button>
                                <Button variant="secondary" onClick={() => handleSetSize(920, 640)}>920x640</Button>
                                <Button variant="secondary" onClick={() => handleSetHeight(420)}>高度 420</Button>
                                <Button variant="secondary" onClick={() => handleSetHeight(560, true)}>高度 560 可调</Button>
                                <Button variant="secondary" onClick={() => void handleSetBounds()} loading={loadingAction === 'bounds'}>偏移边界</Button>
                                <Button variant="secondary" onClick={handleSetPosition}>偏移位置</Button>
                            </div>

                            <div className="action-bar">
                                <Button variant="secondary" onClick={() => void runWindowAction('window.show', () => win.show(), { success: '已显示并聚焦当前窗口' })}><AppWindow aria-hidden="true" size={14} />显示</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.showInactive', () => win.showInactive(), { success: '已请求不抢焦点显示' })}><Focus aria-hidden="true" size={14} />不抢焦点显示</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.focus', () => win.focus(), { success: '已请求窗口焦点' })}><Crosshair aria-hidden="true" size={14} />聚焦</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.center', () => win.center(), { refresh: true, success: '窗口已居中' })}>居中</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.invalidate', () => win.invalidate(), { success: '已请求窗口重绘' })}>重绘</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.minimize', () => win.minimize(), { success: '已请求最小化' })}>最小化</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.maximize', () => win.maximize(), { refresh: true, success: '已切换最大化状态' })}>最大化/还原</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.detach', () => win.detach(), { refresh: true, success: '已请求分离为独立窗口' })}>分离</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.reload', () => win.reload(), { success: '已请求重新加载' })}>重新加载</Button>
                            </div>
                        </Card>

                        <Card title="窗口行为开关" icon={MousePointer2}>
                            <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label className="input-label" htmlFor="window-opacity-range">透明度</label>
                                <input
                                    id="window-opacity-range"
                                    type="range"
                                    min="0.3"
                                    max="1"
                                    step="0.05"
                                    value={opacity}
                                    onChange={(event) => handleOpacityChange(Number(event.target.value))}
                                />
                            </div>
                            <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <Button variant={alwaysOnTop ? 'primary' : 'secondary'} onClick={() => handleToggleAlwaysOnTop(!alwaysOnTop)}>
                                    <Pin aria-hidden="true" size={14} />{alwaysOnTop ? '取消置顶' : '置顶'}
                                </Button>
                                <Button variant={backgroundThrottling ? 'secondary' : 'primary'} onClick={() => handleToggleBackgroundThrottling(!backgroundThrottling)}>
                                    <TimerReset aria-hidden="true" size={14} />{backgroundThrottling ? '禁用后台节流' : '允许后台节流'}
                                </Button>
                                <Button variant={ignoreMouseEvents ? 'primary' : 'secondary'} onClick={() => handleToggleIgnoreMouse(!ignoreMouseEvents)}>
                                    <SquareDashedMousePointer aria-hidden="true" size={14} />{ignoreMouseEvents ? '关闭鼠标穿透' : '开启鼠标穿透'}
                                </Button>
                                <Button variant={visibleOnAllWorkspaces ? 'primary' : 'secondary'} onClick={() => handleToggleAllWorkspaces(!visibleOnAllWorkspaces)}>
                                    <Layers aria-hidden="true" size={14} />{visibleOnAllWorkspaces ? '取消全工作区' : '全工作区可见'}
                                </Button>
                                <Button variant={fullscreen ? 'primary' : 'secondary'} onClick={() => handleToggleFullscreen(!fullscreen)}>
                                    <Maximize aria-hidden="true" size={14} />{fullscreen ? '退出全屏' : '进入全屏'}
                                </Button>
                            </div>
                            <div
                                role="button"
                                tabIndex={0}
                                className="preview-box"
                                style={{
                                    minHeight: '88px',
                                    cursor: 'nwse-resize',
                                    justifyContent: 'space-between',
                                    gap: 'var(--spacing-md)',
                                }}
                                onPointerDown={handleResizeGripPointerDown}
                                onPointerMove={handleResizeGripPointerMove}
                                onPointerUp={handleResizeGripPointerUp}
                            >
                                <span>按住这里拖动右下角，演示 resizeDrag</span>
                                <Grip aria-hidden="true" size={20} />
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2">
                        <Card title="SubInput" icon={TextCursorInput}>
                            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                <StatusBadge status={subInputEnabled ? 'success' : 'info'}>
                                    {subInputEnabled ? '已启用' : '未启用'}
                                </StatusBadge>
                            </div>
                            <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label className="input-label" htmlFor="subinput-preset">写入内容</label>
                                <input
                                    id="subinput-preset"
                                    className="input"
                                    value={subInputPreset}
                                    onChange={(event) => setSubInputPreset(event.target.value)}
                                />
                            </div>
                            <div className="preview-box" style={{ minHeight: '72px', justifyContent: 'flex-start' }}>
                                {subInputText || '等待宿主子输入框输入...'}
                            </div>
                            <div className="action-bar" style={{ marginTop: 'var(--spacing-md)' }}>
                                <Button onClick={() => void handleEnableSubInput()}>启用</Button>
                                <Button variant="secondary" onClick={handleSetSubInputValue} disabled={!subInputEnabled}>写入</Button>
                                <Button variant="secondary" onClick={() => subInput.focus()} disabled={!subInputEnabled}>聚焦</Button>
                                <Button variant="secondary" onClick={() => subInput.blur()} disabled={!subInputEnabled}>失焦</Button>
                                <Button variant="secondary" onClick={() => subInput.select()} disabled={!subInputEnabled}>全选</Button>
                                <Button variant="secondary" onClick={() => void handleDisableSubInput()} disabled={!subInputEnabled}>移除</Button>
                            </div>
                        </Card>

                        <Card title="页面内查找" icon={Search}>
                            <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label className="input-label" htmlFor="find-text-input">查找文本</label>
                                <input
                                    id="find-text-input"
                                    className="input"
                                    value={searchText}
                                    onChange={(event) => setSearchText(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') void handleFindInPage(findResult !== null)
                                    }}
                                />
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-xs)', marginBottom: 'var(--spacing-md)' }}>
                                <input
                                    type="checkbox"
                                    checked={matchCase}
                                    onChange={(event) => setMatchCase(event.target.checked)}
                                />
                                <span>区分大小写</span>
                            </label>
                            <div className="action-bar">
                                <Button onClick={() => void handleFindInPage(false)}>查找</Button>
                                <Button variant="secondary" onClick={() => void handleFindInPage(true)} disabled={findResult === null}>下一个</Button>
                                <Button variant="secondary" onClick={handleStopFind} disabled={findResult === null}>停止</Button>
                            </div>
                            <div className="info-grid" style={{ marginTop: 'var(--spacing-md)' }}>
                                <span className="info-label">Request ID</span>
                                <span className="info-value">{findResult ?? '-'}</span>
                            </div>
                        </Card>
                    </div>

                    <Card
                        title="子窗口与覆盖层"
                        icon={Layers}
                        actions={
                            <>
                                <Button onClick={() => void handleCreateChild()} loading={loadingAction === 'child'}>
                                    <AppWindow aria-hidden="true" size={14} />创建子窗口
                                </Button>
                                <Button variant="secondary" onClick={() => void handleCreateOverlay()} loading={loadingAction === 'overlay'}>
                                    <PanelTopOpen aria-hidden="true" size={14} />创建覆盖层
                                </Button>
                                <Button variant="secondary" onClick={() => void handleBroadcast()} disabled={childWindows.length === 0}>
                                    <Send aria-hidden="true" size={14} />广播
                                </Button>
                                <Button variant="secondary" onClick={() => void handleCloseAllChildren()} disabled={childWindows.length === 0}>
                                    <X aria-hidden="true" size={14} />关闭全部
                                </Button>
                            </>
                        }
                    >
                        {childWindows.length > 0 ? (
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {childWindows.map((child) => (
                                    <div key={child.id} className="history-item">
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-xs)' }}>
                                                <strong style={{ color: 'var(--text-primary)' }}>{child.name}</strong>
                                                <StatusBadge status={child.kind === 'overlay' ? 'warning' : 'info'}>{child.kind}</StatusBadge>
                                                <span className="list-row-meta">id={child.id}</span>
                                            </div>
                                            <div className="list-row-meta">
                                                {child.bounds ? `${child.bounds.x},${child.bounds.y} ${child.bounds.width}x${child.bounds.height}` : '未读取边界'}
                                                {' | '}
                                                last={child.lastAction}
                                            </div>
                                            <div className="action-bar" style={{ marginTop: 'var(--spacing-sm)' }}>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'show', proxy => proxy.show())}>show</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'showInactive', proxy => proxy.showInactive())}>showInactive</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'hide', proxy => proxy.hide())}>hide</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'focus', proxy => proxy.focus())}>focus</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setTitle', proxy => proxy.setTitle(`${child.name} ${formatTime(Date.now())}`))}>title</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setSize', proxy => proxy.setSize(620, 440), { bounds: child.bounds ? { ...child.bounds, width: 620, height: 440 } : child.bounds })}>size</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setPosition', proxy => proxy.setPosition((child.bounds?.x ?? 80) + 24, (child.bounds?.y ?? 80) + 24))}>position</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setBounds', proxy => proxy.setBounds({ width: 600, height: 420 }))}>bounds</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'getBounds', async () => refreshChildBounds(child))}>getBounds</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setOpacity', proxy => proxy.setOpacity(child.opacity === 1 ? 0.82 : 1), { opacity: child.opacity === 1 ? 0.82 : 1 })}>opacity</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setBackgroundThrottling', proxy => proxy.setBackgroundThrottling(!child.backgroundThrottling), { backgroundThrottling: !child.backgroundThrottling })}>throttle</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setIgnoreMouseEvents', proxy => proxy.setIgnoreMouseEvents(!child.ignoreMouseEvents, !child.ignoreMouseEvents ? { forward: true } : undefined), { ignoreMouseEvents: !child.ignoreMouseEvents })}>mouse</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setAlwaysOnTop', proxy => proxy.setAlwaysOnTop(!child.alwaysOnTop, !child.alwaysOnTop ? 'floating' : undefined), { alwaysOnTop: !child.alwaysOnTop })}>pin</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setVisibleOnAllWorkspaces', proxy => proxy.setVisibleOnAllWorkspaces(!child.visibleOnAllWorkspaces, { visibleOnFullScreen: !child.visibleOnAllWorkspaces }), { visibleOnAllWorkspaces: !child.visibleOnAllWorkspaces })}>workspaces</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'setFullScreen', proxy => proxy.setFullScreen(!child.fullscreen), { fullscreen: !child.fullscreen })}>fullscreen</Button>
                                                <Button variant="secondary" onClick={() => void handleChildAction(child, 'postMessage', proxy => proxy.postMessage('ping', { from: 'window-api', at: Date.now() }))}>message</Button>
                                                <Button variant="secondary" onClick={() => void handleCloseChild(child)}>close</Button>
                                                <Button variant="secondary" onClick={() => void handleCloseChild(child, true)}>destroy</Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <Layers aria-hidden="true" size={32} />
                                <p>尚未创建子窗口</p>
                            </div>
                        )}
                    </Card>

                    <div className="grid grid-2">
                        <Card title="窗口通信日志" icon={BellRing}>
                            <div className="preview-box window-message-log">
                                <div className="window-message-log-content">
                                    {childMessages.length > 0 ? childMessages.map((message, index) => (
                                        <div key={`${message.timestamp}-${index}`} className="list-row">
                                            <span className="list-row-main">
                                                [{formatTime(message.timestamp)}] {message.channel}: {summarizeArgs(message.args)}
                                            </span>
                                        </div>
                                    )) : (
                                        <span>等待子窗口消息...</span>
                                    )}
                                </div>
                            </div>
                        </Card>

                        <Card title="原生文件拖拽" icon={FileDown}>
                            <div className="action-bar" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <Button variant="secondary" onClick={() => void handlePickDragFile()}>选择文件</Button>
                                <Button variant="secondary" onClick={() => void createTempFile()} loading={loadingAction === 'drag'}>生成文本文件</Button>
                            </div>
                            <div
                                draggable={Boolean(dragFilePath || generatedTextPath)}
                                className="preview-box"
                                style={{
                                    minHeight: '120px',
                                    cursor: dragFilePath || generatedTextPath ? 'grab' : 'default',
                                    flexDirection: 'column',
                                    gap: 'var(--spacing-sm)',
                                }}
                                onDragStart={(event) => handleStartDrag(dragFilePath || generatedTextPath, event)}
                            >
                                <FileDown aria-hidden="true" size={28} />
                                <span>{dragHint}</span>
                                {(dragFilePath || generatedTextPath) && (
                                    <code style={{ fontSize: 'var(--font-size-xs)' }}>{pathBasename(dragFilePath || generatedTextPath)}</code>
                                )}
                            </div>
                        </Card>
                    </div>

                    <Card title="最近操作" icon={RefreshCw}>
                        <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                            {operationLog.length > 0 ? operationLog.map((item, index) => (
                                <div key={`${item.timestamp}-${index}`} className="list-row">
                                    <StatusBadge status={item.status}>{item.status}</StatusBadge>
                                    <span className="list-row-main">{item.action}</span>
                                    <span className="list-row-meta">{item.message}</span>
                                    <span className="list-row-meta">{formatTime(item.timestamp)}</span>
                                </div>
                            )) : (
                                <div className="empty-state">
                                    <RefreshCw aria-hidden="true" size={28} />
                                    <p>暂无操作记录</p>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
