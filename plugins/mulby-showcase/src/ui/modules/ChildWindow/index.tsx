import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    AppWindow,
    BellRing,
    ContactRound,
    Focus,
    Layers,
    Maximize,
    MessageSquareText,
    RefreshCw,
    Send,
    SlidersHorizontal,
    Users,
    X,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type OperationStatus = 'success' | 'warning' | 'error' | 'info'

interface WindowBounds {
    x: number
    y: number
    width: number
    height: number
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

interface WindowSnapshot {
    type: string
    mode: string
    bounds: WindowBounds | null
    state: {
        isMaximized: boolean
        isAlwaysOnTop: boolean
        opacity?: number
    } | null
    opacity: number | null
}

interface ChildMessage {
    channel: string
    args: unknown[]
    timestamp: number
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
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

function readRouteParams() {
    const searchParams = new URLSearchParams(window.location.search)
    const hash = window.location.hash

    return {
        href: window.location.href,
        hash,
        search: window.location.search,
        source: searchParams.get('source') || undefined,
        index: searchParams.get('index') || undefined,
        overlay: searchParams.get('overlay') === 'true',
        instanceId: searchParams.get('instanceId') || undefined,
    }
}

function mergeRouteParams(
    current: ReturnType<typeof readRouteParams>,
    params?: Record<string, string>
) {
    if (!params) return current

    return {
        ...current,
        source: params.source || current.source,
        index: params.index || current.index,
        overlay: params.overlay === 'true' || current.overlay,
        instanceId: params.instanceId || current.instanceId,
    }
}

interface ChildWindowModuleProps {
    initParams?: Record<string, string>
}

export function ChildWindowModule({ initParams }: ChildWindowModuleProps = {}) {
    const { window: win, onPluginInit } = useMulby()
    const notify = useNotification()

    const [routeParams, setRouteParams] = useState(readRouteParams)
    const [windowLabel, setWindowLabel] = useState(`child-${Date.now() % 10000}`)
    const [snapshot, setSnapshot] = useState<WindowSnapshot>({
        type: '-',
        mode: '-',
        bounds: null,
        state: null,
        opacity: null,
    })
    const [messages, setMessages] = useState<ChildMessage[]>([])
    const [grandchild, setGrandchild] = useState<ChildWindowHandle | null>(null)
    const [grandchildBounds, setGrandchildBounds] = useState<WindowBounds | null>(null)
    const [grandchildMuted, setGrandchildMuted] = useState(false)
    const [messageText, setMessageText] = useState('来自子窗口的消息')
    const [childMessageText, setChildMessageText] = useState('来自上一级窗口的消息')
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const fallbackWindowToken = useMemo(() => `child-${Date.now()}-${Math.random().toString(36).slice(2)}`, [])

    const isOverlay = routeParams.overlay

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 12))
    }, [])

    const loadWindowSnapshot = useCallback(async () => {
        try {
            const [type, mode, bounds, state, opacity] = await Promise.all([
                win.getWindowType(),
                win.getMode(),
                win.getBounds(),
                win.getState(),
                win.getOpacity(),
            ])
            setSnapshot({ type, mode, bounds, state, opacity })
            setWindowLabel(`${type}-${Date.now() % 10000}`)
            pushOperation({
                action: 'window.getState',
                status: 'success',
                message: '已读取当前子窗口状态',
                details: { type, mode, bounds, state, opacity },
            })
        } catch (error) {
            pushOperation({
                action: 'window.getState',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('读取子窗口状态失败')
        }
    }, [notify, pushOperation, win])

    useEffect(() => {
        void loadWindowSnapshot()
    }, [loadWindowSnapshot])

    useEffect(() => {
        if (initParams) {
            setRouteParams(current => mergeRouteParams(current, initParams))
        }
    }, [initParams])

    useEffect(() => {
        return win.onChildMessage((channel, ...args) => {
            const timestamp = Date.now()
            setMessages(current => [
                { channel, args, timestamp },
                ...current,
            ].slice(0, 12))

            if (channel === 'broadcast' && grandchild) {
                void grandchild.postMessage('broadcast', ...args)
            }

            if (channel === 'child-window-closing' || channel === 'child-window-closed') {
                setGrandchild(null)
                setGrandchildBounds(null)
                setGrandchildMuted(false)
            }
        })
    }, [grandchild, win])

    const runWindowAction = useCallback(async (
        action: string,
        callback: () => unknown | Promise<unknown>,
        successMessage: string
    ) => {
        try {
            const details = await callback()
            pushOperation({
                action,
                status: 'success',
                message: successMessage,
                details,
            })
            setTimeout(() => void loadWindowSnapshot(), 120)
        } catch (error) {
            pushOperation({
                action,
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error(`${action} 失败`)
        }
    }, [loadWindowSnapshot, notify, pushOperation])

    useEffect(() => {
        return onPluginInit((data) => {
            if (data.route?.includes('child-window') || data.params) {
                setRouteParams((current) => mergeRouteParams(current, data.params))
                pushOperation({
                    action: 'onPluginInit',
                    status: 'info',
                    message: '已接收子窗口初始化参数',
                    details: {
                        route: data.route,
                        params: data.params,
                    },
                })
            }
        })
    }, [onPluginInit, pushOperation])

    const handleSendToParent = () => {
        const payload = {
            from: windowLabel,
            message: messageText,
            route: routeParams,
            at: Date.now(),
        }
        win.sendToParent('child-event', payload)
        pushOperation({
            action: 'window.sendToParent',
            status: 'success',
            message: '已发送消息给直接父窗口',
            details: payload,
        })
        notify.success('已发送给父窗口')
    }

    const handleRequestRelay = () => {
        const payload = {
            from: windowLabel,
            message: messageText,
            timestamp: Date.now(),
        }
        win.sendToParent('relay-request', payload)
        pushOperation({
            action: 'window.sendToParent relay-request',
            status: 'info',
            message: '已请求父窗口转发给同插件的其他子窗口',
            details: payload,
        })
    }

    const notifyParentClosing = useCallback(() => {
        const payload = {
            instanceId: routeParams.instanceId || fallbackWindowToken,
            source: routeParams.source,
            index: routeParams.index,
            overlay: routeParams.overlay,
            label: windowLabel,
            at: Date.now(),
        }
        win.sendToParent('child-window-closing', payload)
        pushOperation({
            action: 'window.sendToParent child-window-closing',
            status: 'info',
            message: '已通知父窗口当前子窗口将关闭',
            details: payload,
        })
    }, [fallbackWindowToken, pushOperation, routeParams, win, windowLabel])

    const handleCloseCurrentWindow = () => {
        notifyParentClosing()
        void runWindowAction('window.close', () => win.close(), '已请求关闭当前子窗口')
    }

    const handleCreateGrandchild = async () => {
        if (grandchild) {
            notify.warning('已存在下一级子窗口')
            return
        }

        try {
            const proxy = await win.create('child-window', {
                loadMode: 'route',
                width: 520,
                height: 360,
                title: `下一级子窗口 (${windowLabel})`,
                backgroundThrottling: false,
                params: {
                    source: windowLabel,
                    nested: 'true',
                    instanceId: `child-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                },
            }) as ChildWindowHandle | null

            if (!proxy) {
                pushOperation({
                    action: 'window.create grandchild',
                    status: 'warning',
                    message: '宿主未返回下一级子窗口句柄',
                })
                return
            }

            setGrandchild(proxy)
            try {
                setGrandchildBounds(await proxy.getBounds())
            } catch {
                setGrandchildBounds(null)
            }
            pushOperation({
                action: 'window.create grandchild',
                status: 'success',
                message: '已创建下一级子窗口',
                details: { id: proxy.id },
            })
        } catch (error) {
            pushOperation({
                action: 'window.create grandchild',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('创建下一级子窗口失败')
        }
    }

    const handleGrandchildAction = async (
        action: string,
        callback: (proxy: ChildWindowHandle) => Promise<unknown>,
        patch?: { muted?: boolean }
    ) => {
        if (!grandchild) return

        try {
            const details = await callback(grandchild)
            if (patch?.muted !== undefined) setGrandchildMuted(patch.muted)
            if (action === 'getBounds') {
                setGrandchildBounds(details as WindowBounds)
            }
            pushOperation({
                action: `grandchild.${action}`,
                status: 'success',
                message: `下一级子窗口已执行 ${action}`,
                details,
            })
        } catch (error) {
            pushOperation({
                action: `grandchild.${action}`,
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('下一级子窗口操作失败')
        }
    }

    const handleCloseGrandchild = async () => {
        if (!grandchild) return

        try {
            await grandchild.close()
            setGrandchild(null)
            setGrandchildBounds(null)
            setGrandchildMuted(false)
            pushOperation({
                action: 'grandchild.close',
                status: 'success',
                message: '下一级子窗口已关闭',
            })
        } catch (error) {
            pushOperation({
                action: 'grandchild.close',
                status: 'error',
                message: getErrorMessage(error),
            })
            notify.error('关闭下一级子窗口失败')
        }
    }

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'Current Child Window',
            items: [
                { name: 'window.getWindowType()', description: '读取当前子窗口类型。' },
                { name: 'window.getMode()', description: '读取当前子窗口模式。' },
                { name: 'window.getBounds()', description: '读取当前子窗口边界。' },
                { name: 'window.getState()', description: '读取当前子窗口最大化、置顶和透明度状态。' },
                { name: 'window.getOpacity()', description: '读取当前子窗口透明度。' },
                { name: 'window.setTitle(title)', description: '修改当前子窗口标题。' },
                { name: 'window.focus()', description: '请求当前子窗口获得焦点。' },
                { name: 'window.showInactive()', description: '显示当前子窗口但不抢焦点。' },
                { name: 'window.center()', description: '让当前子窗口居中。' },
                { name: 'window.setSize(width, height)', description: '调整当前子窗口大小。' },
                { name: 'window.maximize()', description: '最大化或还原当前子窗口。' },
                { name: 'window.close()', description: '关闭当前子窗口。' },
            ],
        },
        {
            title: 'Parent Child Messaging',
            items: [
                { name: 'window.sendToParent(channel, ...args)', description: '向直接父窗口发送消息。' },
                { name: 'window.onChildMessage(callback)', description: '监听父窗口或本窗口子窗口发来的消息，监听器需要释放。' },
            ],
        },
        {
            title: 'Nested Child Window',
            items: [
                { name: 'window.create("child-window", options)', description: '从当前子窗口继续创建下一级子窗口。' },
                { name: 'child.postMessage(channel, ...args)', description: '向下一级子窗口发送消息。' },
                { name: 'child.getBounds()', description: '读取下一级子窗口边界。' },
                { name: 'child.setOpacity(opacity)', description: '设置下一级子窗口透明度。' },
                { name: 'child.setBackgroundThrottling(allowed)', description: '设置下一级子窗口后台节流。' },
                { name: 'child.focus()', description: '请求下一级子窗口获得焦点。' },
                { name: 'child.close()', description: '关闭下一级子窗口。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '子窗口向父窗口发送消息',
            code: `window.mulby.window.sendToParent('child-event', {
  from: 'child-window',
  message: 'ready',
  at: Date.now()
})

const dispose = window.mulby.window.onChildMessage((channel, ...args) => {
  console.log('received from parent or child:', channel, args)
})

dispose()`,
        },
        {
            title: '子窗口自身控制',
            code: `const bounds = await window.mulby.window.getBounds()
await window.mulby.window.setSize(560, 380)
window.mulby.window.setTitle('Updated Child Window')
window.mulby.window.showInactive()
window.mulby.window.focus()
window.mulby.window.center()

console.log(bounds)`,
        },
        {
            title: '子窗口继续创建下一级窗口',
            code: `const child = await window.mulby.window.create('child-window', {
  loadMode: 'route',
  width: 520,
  height: 360,
  params: { nested: 'true' },
  backgroundThrottling: false
})

await child?.postMessage('parent-msg', { at: Date.now() })
await child?.setOpacity(0.86)
await child?.setBackgroundThrottling(false)`,
        },
    ], [])

    const rawData = useMemo(() => ({
        routeParams,
        fallbackWindowToken,
        windowLabel,
        isOverlay,
        snapshot,
        messages,
        grandchild: grandchild ? {
            id: grandchild.id,
            bounds: grandchildBounds,
            backgroundThrottlingDisabled: grandchildMuted,
        } : null,
        messageText,
        childMessageText,
        operationLog,
    }), [
        childMessageText,
        fallbackWindowToken,
        grandchild,
        grandchildBounds,
        grandchildMuted,
        isOverlay,
        messageText,
        messages,
        operationLog,
        routeParams,
        snapshot,
        windowLabel,
    ])

    return (
        <div className="main-content">
            <PageHeader
                icon={ContactRound}
                title={`子窗口 (${windowLabel})`}
                description="演示子窗口自身控制、父子通信和多级子窗口"
                actions={
                    <Button variant="secondary" onClick={() => void loadWindowSnapshot()}>
                        <RefreshCw aria-hidden="true" size={14} />刷新状态
                    </Button>
                }
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon"><AppWindow aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{snapshot.type}</div>
                            <div className="stat-label">窗口类型</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><Layers aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{snapshot.mode}</div>
                            <div className="stat-label">窗口模式</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><Maximize aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{snapshot.state?.isMaximized ? '最大化' : '正常'}</div>
                            <div className="stat-label">最大化状态</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><SlidersHorizontal aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{snapshot.opacity === null ? '-' : snapshot.opacity.toFixed(2)}</div>
                            <div className="stat-label">透明度</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon"><MessageSquareText aria-hidden="true" size={24} /></div>
                            <div className="stat-value">{messages.length}</div>
                            <div className="stat-label">收到消息</div>
                        </div>
                    </div>

                    {isOverlay && (
                        <Card title="覆盖层状态" icon={BellRing}>
                            <div className="action-bar">
                                <StatusBadge status="warning">borderless</StatusBadge>
                                <StatusBadge status="warning">ignoreMouseEvents</StatusBadge>
                                <StatusBadge status="warning">alwaysOnTop</StatusBadge>
                                <StatusBadge status="info">backgroundThrottling=false</StatusBadge>
                            </div>
                        </Card>
                    )}

                    <div className="grid grid-2">
                        <Card title="父窗口通信" icon={Send}>
                            <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <label className="input-label" htmlFor="parent-message-input">发送内容</label>
                                <input
                                    id="parent-message-input"
                                    className="input"
                                    value={messageText}
                                    onChange={(event) => setMessageText(event.target.value)}
                                />
                            </div>
                            <div className="action-bar">
                                <Button onClick={handleSendToParent}>
                                    <Send aria-hidden="true" size={14} />发送给父窗口
                                </Button>
                                <Button variant="secondary" onClick={handleRequestRelay}>
                                    <Users aria-hidden="true" size={14} />请求父窗口转发
                                </Button>
                            </div>
                        </Card>

                        <Card title="当前子窗口控制" icon={SlidersHorizontal}>
                            <div className="info-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                                <span className="info-label">Bounds</span>
                                <span className="info-value">
                                    {snapshot.bounds ? `${snapshot.bounds.x},${snapshot.bounds.y} ${snapshot.bounds.width}x${snapshot.bounds.height}` : '-'}
                                </span>
                                <span className="info-label">Always On Top</span>
                                <span className="info-value">{snapshot.state?.isAlwaysOnTop ? 'true' : 'false'}</span>
                            </div>
                            <div className="action-bar">
                                <Button variant="secondary" onClick={() => void runWindowAction('window.setTitle', () => win.setTitle(`子窗口 ${formatTime(Date.now())}`), '已更新标题')}>设置标题</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.setSize', () => win.setSize(560, 380), '已设置大小')}>560x380</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.center', () => win.center(), '已居中')}>居中</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.showInactive', () => win.showInactive(), '已不抢焦点显示')}>
                                    <Focus aria-hidden="true" size={14} />showInactive
                                </Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.focus', () => win.focus(), '已请求焦点')}>focus</Button>
                                <Button variant="secondary" onClick={() => void runWindowAction('window.maximize', () => win.maximize(), '已切换最大化')}>最大化/还原</Button>
                                <Button variant="secondary" onClick={handleCloseCurrentWindow}>
                                    <X aria-hidden="true" size={14} />关闭当前窗口
                                </Button>
                            </div>
                        </Card>
                    </div>

                    <Card
                        title="下一级子窗口"
                        icon={Users}
                        actions={
                            <>
                                <Button onClick={() => void handleCreateGrandchild()} disabled={Boolean(grandchild)}>
                                    <AppWindow aria-hidden="true" size={14} />创建下一级
                                </Button>
                                <Button variant="secondary" onClick={() => void handleCloseGrandchild()} disabled={!grandchild}>
                                    <X aria-hidden="true" size={14} />关闭下一级
                                </Button>
                            </>
                        }
                    >
                        <div className="info-grid" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <span className="info-label">Handle</span>
                            <span className="info-value">{grandchild ? `id=${grandchild.id}` : '-'}</span>
                            <span className="info-label">Bounds</span>
                            <span className="info-value">{grandchildBounds ? `${grandchildBounds.x},${grandchildBounds.y} ${grandchildBounds.width}x${grandchildBounds.height}` : '-'}</span>
                        </div>
                        <div className="input-group" style={{ marginBottom: 'var(--spacing-md)' }}>
                            <label className="input-label" htmlFor="child-message-input">发送给下一级</label>
                            <input
                                id="child-message-input"
                                className="input"
                                value={childMessageText}
                                onChange={(event) => setChildMessageText(event.target.value)}
                            />
                        </div>
                        <div className="action-bar">
                            <Button variant="secondary" onClick={() => void handleGrandchildAction('postMessage', proxy => proxy.postMessage('parent-msg', { from: windowLabel, message: childMessageText, at: Date.now() }))} disabled={!grandchild}>发送消息</Button>
                            <Button variant="secondary" onClick={() => void handleGrandchildAction('getBounds', proxy => proxy.getBounds())} disabled={!grandchild}>读取边界</Button>
                            <Button variant="secondary" onClick={() => void handleGrandchildAction('setOpacity', proxy => proxy.setOpacity(0.86))} disabled={!grandchild}>透明度 0.86</Button>
                            <Button variant="secondary" onClick={() => void handleGrandchildAction('setBackgroundThrottling', proxy => proxy.setBackgroundThrottling(grandchildMuted), { muted: !grandchildMuted })} disabled={!grandchild}>
                                {grandchildMuted ? '允许后台节流' : '禁用后台节流'}
                            </Button>
                            <Button variant="secondary" onClick={() => void handleGrandchildAction('focus', proxy => proxy.focus())} disabled={!grandchild}>聚焦</Button>
                        </div>
                    </Card>

                    <div className="grid grid-2">
                        <Card title="收到的消息" icon={MessageSquareText}>
                            <div className="preview-box window-message-log">
                                <div className="window-message-log-content">
                                    {messages.length > 0 ? messages.map((message, index) => (
                                        <div key={`${message.timestamp}-${index}`} className="list-row">
                                            <span className="list-row-main">
                                                [{formatTime(message.timestamp)}] {message.channel}: {summarizeArgs(message.args)}
                                            </span>
                                        </div>
                                    )) : (
                                        <span>等待父窗口或下一级子窗口消息...</span>
                                    )}
                                </div>
                            </div>
                        </Card>

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
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
