import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    BadgeInfo,
    FileJson,
    Inbox,
    List,
    Megaphone,
    MessageSquare,
    MessageSquareReply,
    PlugZap,
    RefreshCw,
    Send,
    Trash2,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type MessageDirection = 'received' | 'sent' | 'broadcast'
type DirectionFilter = 'all' | MessageDirection
type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type LoadingAction = 'send' | 'broadcast' | 'refresh' | 'clear' | null

interface ShowcaseMessageRecord {
    id: string
    from: string
    to?: string
    type: string
    payload: unknown
    timestamp: number
    direction: MessageDirection
    local?: boolean
    note?: string
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

interface HostCallResponse<T> {
    success: boolean
    data: T
    error?: string
}

interface ShowcaseHost {
    call<T>(method: string, ...args: unknown[]): Promise<HostCallResponse<T>>
}

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'
const DEFAULT_MESSAGE_TYPE = 'showcase-test'
const DEFAULT_BROADCAST_TYPE = 'showcase-broadcast'
const DEFAULT_PAYLOAD = `{
  "text": "Hello from Mulby Showcase",
  "source": "messaging-module"
}`

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function parseJsonPayload(payloadText: string) {
    const trimmed = payloadText.trim()
    if (!trimmed) return {}
    return JSON.parse(trimmed) as unknown
}

function formatDateTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleString()
}

function formatTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleTimeString()
}

function operationLabel(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

function directionLabel(direction: MessageDirection) {
    if (direction === 'received') return '收到'
    if (direction === 'broadcast') return '广播'
    return '发送'
}

function directionStatus(direction: MessageDirection): OperationStatus {
    if (direction === 'received') return 'success'
    if (direction === 'broadcast') return 'warning'
    return 'info'
}

function stringifyPreview(value: unknown, limit = 360) {
    let text: string
    try {
        text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } catch {
        text = String(value)
    }
    return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text
}

function summarizePayload(payload: unknown) {
    const preview = stringifyPreview(payload, 240)
    return {
        type: Array.isArray(payload) ? 'array' : payload === null ? 'null' : typeof payload,
        preview,
        length: preview.length,
    }
}

function summarizeMessage(message: ShowcaseMessageRecord) {
    return {
        id: message.id,
        from: message.from,
        to: message.to,
        type: message.type,
        direction: message.direction,
        local: message.local,
        note: message.note,
        timestamp: message.timestamp,
        payload: summarizePayload(message.payload),
    }
}

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Backend Messaging API',
        items: [
            { name: 'context.api.messaging.on(handler)', description: '在插件后台订阅来自其他插件的消息。' },
            { name: 'context.api.messaging.off(handler)', description: '在卸载或重置时取消后台消息订阅。' },
            { name: 'mulby.messaging.send(targetPluginId, type, payload)', description: '从插件后台发送点对点消息。' },
            { name: 'mulby.messaging.broadcast(type, payload)', description: '从插件后台广播消息给其他已订阅插件。' },
        ],
    },
    {
        title: 'Host RPC Bridge',
        items: [
            { name: 'host.call("sendShowcaseMessage", input)', description: 'UI 请求后台发送点对点消息。' },
            { name: 'host.call("broadcastShowcaseMessage", input)', description: 'UI 请求后台广播消息。' },
            { name: 'host.call("getRecentShowcaseMessages", filter)', description: '读取后台订阅 handler 缓存的最近消息。' },
            { name: 'host.call("clearShowcaseMessages")', description: '清空 showcase 自己维护的最近消息缓存。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '后台订阅并缓存消息',
        code: `let handler

export function onLoad(context) {
  handler = async (message) => {
    recentMessages.unshift(message)
    if (message.type === 'showcase-ping') {
      await context.api.messaging.send(message.from, 'showcase-pong', {
        requestId: message.id
      })
    }
  }
  context.api.messaging.on(handler)
}

export function onUnload(context) {
  context.api.messaging.off(handler)
}`,
    },
    {
        title: '点对点发送',
        code: `await window.mulby.host.call('@mulby/showcase', 'sendShowcaseMessage', {
  targetPluginId: '@mulby/showcase',
  type: 'showcase-test',
  payload: { text: 'hello' }
})`,
    },
    {
        title: '广播消息',
        code: `await window.mulby.host.call('@mulby/showcase', 'broadcastShowcaseMessage', {
  type: 'showcase-broadcast',
  payload: { text: 'hello subscribers' }
})

// broadcast 不会发送给发送者自己，UI 使用本地发送摘要确认动作。`,
    },
]

export function MessagingModule() {
    const { host } = useMulby(SHOWCASE_PLUGIN_ID)
    const showcaseHost = host as unknown as ShowcaseHost
    const notify = useNotification()

    const [targetPluginId, setTargetPluginId] = useState(SHOWCASE_PLUGIN_ID)
    const [messageType, setMessageType] = useState(DEFAULT_MESSAGE_TYPE)
    const [broadcastType, setBroadcastType] = useState(DEFAULT_BROADCAST_TYPE)
    const [payloadText, setPayloadText] = useState(DEFAULT_PAYLOAD)
    const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
    const [typeFilter, setTypeFilter] = useState('')
    const [limit, setLimit] = useState(30)
    const [messages, setMessages] = useState<ShowcaseMessageRecord[]>([])
    const [selectedMessage, setSelectedMessage] = useState<ShowcaseMessageRecord | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [jsonError, setJsonError] = useState('')
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 16))
    }, [])

    const callShowcaseHost = useCallback(async <T,>(method: string, ...args: unknown[]) => {
        const result = await showcaseHost.call<T>(method, ...args)
        if (!result.success) {
            throw new Error(result.error || `RPC 调用失败：${method}`)
        }
        return result.data
    }, [showcaseHost])

    const refreshMessages = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!options.silent) setLoadingAction('refresh')
        try {
            const nextMessages = await callShowcaseHost<ShowcaseMessageRecord[]>('getRecentShowcaseMessages', {
                limit,
                direction: directionFilter,
                type: typeFilter.trim() || undefined,
            })
            setMessages(nextMessages)
            setSelectedMessage(current => {
                if (!current) return nextMessages[0] || null
                return nextMessages.find(message => message.id === current.id) || nextMessages[0] || null
            })
            if (!options.silent) {
                pushOperation({
                    action: 'host.call getRecentShowcaseMessages',
                    status: 'success',
                    message: `已读取 ${nextMessages.length} 条消息`,
                })
            }
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call getRecentShowcaseMessages', status: 'error', message })
            if (!options.silent) notify.error(`读取消息失败: ${message}`)
        } finally {
            if (!options.silent) setLoadingAction(null)
        }
    }, [callShowcaseHost, directionFilter, limit, notify, pushOperation, typeFilter])

    useEffect(() => {
        void refreshMessages({ silent: true })
    }, [refreshMessages])

    const buildPayload = useCallback(() => {
        try {
            const payload = parseJsonPayload(payloadText)
            setJsonError('')
            return payload
        } catch (error) {
            const message = getErrorMessage(error)
            setJsonError(message)
            throw new Error(`JSON 解析失败: ${message}`)
        }
    }, [payloadText])

    const sendMessage = useCallback(async () => {
        const target = targetPluginId.trim()
        if (!target) {
            notify.warning('请输入目标插件 ID')
            return
        }

        setLoadingAction('send')
        try {
            const payload = buildPayload()
            const result = await callShowcaseHost<ShowcaseMessageRecord>('sendShowcaseMessage', {
                targetPluginId: target,
                type: messageType,
                payload,
            })
            pushOperation({
                action: 'host.call sendShowcaseMessage',
                status: 'success',
                message: `已发送 ${result.type} 到 ${result.to || target}`,
                details: summarizeMessage(result),
            })
            notify.success('点对点消息已发送')
            await refreshMessages({ silent: true })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call sendShowcaseMessage', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [buildPayload, callShowcaseHost, messageType, notify, pushOperation, refreshMessages, targetPluginId])

    const sendSelfPing = useCallback(async () => {
        setTargetPluginId(SHOWCASE_PLUGIN_ID)
        setMessageType('showcase-ping')
        setLoadingAction('send')
        try {
            const payload = {
                text: 'ping from showcase UI',
                sentAt: new Date().toISOString(),
            }
            const result = await callShowcaseHost<ShowcaseMessageRecord>('sendShowcaseMessage', {
                targetPluginId: SHOWCASE_PLUGIN_ID,
                type: 'showcase-ping',
                payload,
            })
            pushOperation({
                action: 'host.call sendShowcaseMessage',
                status: 'success',
                message: '已向当前插件发送 showcase-ping',
                details: summarizeMessage(result),
            })
            await refreshMessages({ silent: true })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call sendShowcaseMessage', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, pushOperation, refreshMessages])

    const broadcastMessage = useCallback(async () => {
        setLoadingAction('broadcast')
        try {
            const payload = buildPayload()
            const result = await callShowcaseHost<ShowcaseMessageRecord>('broadcastShowcaseMessage', {
                type: broadcastType,
                payload,
            })
            pushOperation({
                action: 'host.call broadcastShowcaseMessage',
                status: 'success',
                message: `已广播 ${result.type}`,
                details: summarizeMessage(result),
            })
            notify.success('广播消息已发送')
            await refreshMessages({ silent: true })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call broadcastShowcaseMessage', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [broadcastType, buildPayload, callShowcaseHost, notify, pushOperation, refreshMessages])

    const clearMessages = useCallback(async () => {
        setLoadingAction('clear')
        try {
            await callShowcaseHost<{ success: boolean }>('clearShowcaseMessages')
            setMessages([])
            setSelectedMessage(null)
            pushOperation({ action: 'host.call clearShowcaseMessages', status: 'success', message: '已清空最近消息缓存' })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call clearShowcaseMessages', status: 'error', message })
            notify.error(`清空消息失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, pushOperation])

    const stats = useMemo(() => ({
        total: messages.length,
        received: messages.filter(message => message.direction === 'received').length,
        sent: messages.filter(message => message.direction === 'sent').length,
        broadcast: messages.filter(message => message.direction === 'broadcast').length,
    }), [messages])

    const rawData = useMemo(() => ({
        filters: {
            directionFilter,
            typeFilter,
            limit,
        },
        form: {
            targetPluginId,
            messageType,
            broadcastType,
            payloadPreview: payloadText.slice(0, 400),
            jsonError,
        },
        stats,
        selectedMessage: selectedMessage ? summarizeMessage(selectedMessage) : null,
        messages: messages.map(summarizeMessage),
        operationLog,
    }), [broadcastType, directionFilter, jsonError, limit, messageType, messages, operationLog, payloadText, selectedMessage, stats, targetPluginId, typeFilter])

    return (
        <div className="main-content">
            <PageHeader
                icon={MessageSquare}
                title="插件通信"
                description="通过后台 Messaging API 演示插件间点对点消息、广播和订阅缓存"
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => void refreshMessages()} loading={loadingAction === 'refresh'}>
                            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                            刷新
                        </Button>
                        <Button variant="secondary" onClick={() => void clearMessages()} loading={loadingAction === 'clear'}>
                            <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                            清空缓存
                        </Button>
                    </>
                )}
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-value">{stats.total}</div>
                            <div className="stat-label">缓存消息</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{stats.received}</div>
                            <div className="stat-label">已收到</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{stats.sent}</div>
                            <div className="stat-label">点对点发送</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{stats.broadcast}</div>
                            <div className="stat-label">广播摘要</div>
                        </div>
                    </div>

                    <div className="grid grid-2">
                        <Card
                            title="点对点消息"
                            icon={Send}
                            actions={(
                                <>
                                    <Button onClick={() => void sendMessage()} loading={loadingAction === 'send'}>
                                        <Send className="inline-icon" aria-hidden="true" size={14} />
                                        发送
                                    </Button>
                                    <Button variant="secondary" onClick={() => void sendSelfPing()} loading={loadingAction === 'send'}>
                                        <MessageSquareReply className="inline-icon" aria-hidden="true" size={14} />
                                        自测 Ping
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="messaging-target-plugin">目标插件 ID</label>
                                    <input
                                        id="messaging-target-plugin"
                                        className="input"
                                        value={targetPluginId}
                                        onChange={event => setTargetPluginId(event.target.value)}
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="messaging-type">消息类型</label>
                                    <input
                                        id="messaging-type"
                                        className="input"
                                        value={messageType}
                                        onChange={event => setMessageType(event.target.value)}
                                    />
                                </div>
                                <div className="list-row">
                                    <PlugZap className="inline-icon" aria-hidden="true" size={14} />
                                    <span className="list-row-main">目标插件必须已启动并调用 messaging.on 才会处理消息</span>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="广播消息"
                            icon={Megaphone}
                            actions={(
                                <Button onClick={() => void broadcastMessage()} loading={loadingAction === 'broadcast'}>
                                    <Megaphone className="inline-icon" aria-hidden="true" size={14} />
                                    广播
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="messaging-broadcast-type">广播类型</label>
                                    <input
                                        id="messaging-broadcast-type"
                                        className="input"
                                        value={broadcastType}
                                        onChange={event => setBroadcastType(event.target.value)}
                                    />
                                </div>
                                <div className="list-row">
                                    <BadgeInfo className="inline-icon" aria-hidden="true" size={14} />
                                    <span className="list-row-main">宿主广播会发送给其他已订阅插件，不会发回发送者自己</span>
                                </div>
                            </div>
                        </Card>
                    </div>

                    <div style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="消息 Payload" icon={FileJson}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="messaging-payload">JSON Payload</label>
                                    <textarea
                                        id="messaging-payload"
                                        className="textarea"
                                        value={payloadText}
                                        onChange={event => {
                                            setPayloadText(event.target.value)
                                            setJsonError('')
                                        }}
                                        rows={7}
                                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                                    />
                                </div>
                                {jsonError && (
                                    <StatusBadge status="error">{jsonError}</StatusBadge>
                                )}
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="消息过滤" icon={Inbox}>
                            <div className="input-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div className="input-group" style={{ width: 160 }}>
                                    <label className="input-label" htmlFor="messaging-direction-filter">方向</label>
                                    <select
                                        id="messaging-direction-filter"
                                        className="select"
                                        value={directionFilter}
                                        onChange={event => setDirectionFilter(event.target.value as DirectionFilter)}
                                    >
                                        <option value="all">全部方向</option>
                                        <option value="received">收到</option>
                                        <option value="sent">发送</option>
                                        <option value="broadcast">广播</option>
                                    </select>
                                </div>
                                <div className="input-group" style={{ flex: 1, minWidth: 180 }}>
                                    <label className="input-label" htmlFor="messaging-type-filter">类型包含</label>
                                    <input
                                        id="messaging-type-filter"
                                        className="input"
                                        value={typeFilter}
                                        onChange={event => setTypeFilter(event.target.value)}
                                        placeholder="showcase"
                                    />
                                </div>
                                <div className="input-group" style={{ width: 120 }}>
                                    <label className="input-label" htmlFor="messaging-limit">数量</label>
                                    <input
                                        id="messaging-limit"
                                        className="input"
                                        type="number"
                                        min={1}
                                        max={50}
                                        value={limit}
                                        onChange={event => setLimit(Math.max(1, Math.min(50, Number(event.target.value) || 30)))}
                                    />
                                </div>
                            </div>
                        </Card>

                        <Card title="选中消息" icon={BadgeInfo}>
                            {selectedMessage ? (
                                <div className="info-grid">
                                    <span className="info-label">ID</span>
                                    <span className="info-value">{selectedMessage.id}</span>
                                    <span className="info-label">方向</span>
                                    <span className="info-value">{directionLabel(selectedMessage.direction)}</span>
                                    <span className="info-label">From</span>
                                    <span className="info-value">{selectedMessage.from}</span>
                                    <span className="info-label">To</span>
                                    <span className="info-value">{selectedMessage.to || 'broadcast'}</span>
                                    <span className="info-label">类型</span>
                                    <span className="info-value">{selectedMessage.type}</span>
                                    <span className="info-label">时间</span>
                                    <span className="info-value">{formatDateTime(selectedMessage.timestamp)}</span>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <BadgeInfo aria-hidden="true" size={28} />
                                    <p>请选择一条消息</p>
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="最近消息" icon={Inbox}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {messages.length > 0 ? messages.map(message => (
                                    <button
                                        type="button"
                                        className="list-row"
                                        key={message.id}
                                        onClick={() => setSelectedMessage(message)}
                                        style={{
                                            border: selectedMessage?.id === message.id ? '1px solid var(--accent)' : '1px solid transparent',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <StatusBadge status={directionStatus(message.direction)}>{directionLabel(message.direction)}</StatusBadge>
                                        <span className="list-row-main">{message.type}</span>
                                        <span className="list-row-meta">{message.from}</span>
                                        <span className="list-row-meta">{formatTime(message.timestamp)}</span>
                                    </button>
                                )) : (
                                    <div className="empty-state">
                                        <Inbox aria-hidden="true" size={28} />
                                        <p>暂无消息，先发送自测 Ping 或广播一条消息</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card title="Payload 预览" icon={FileJson}>
                            <div className="preview-box" style={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 220 }}>
                                {selectedMessage ? (
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                                        {stringifyPreview(selectedMessage.payload, 1200)}
                                    </pre>
                                ) : (
                                    <span>选中消息后显示 payload</span>
                                )}
                            </div>
                        </Card>
                    </div>

                    <div style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="最近操作" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {operationLog.length > 0 ? operationLog.map((item, index) => (
                                    <div className="list-row" key={`${item.timestamp}-${index}`}>
                                        <StatusBadge status={item.status}>{operationLabel(item.status)}</StatusBadge>
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
