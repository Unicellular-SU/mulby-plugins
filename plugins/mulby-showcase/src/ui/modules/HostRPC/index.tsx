import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    BadgeInfo,
    Bell,
    Clipboard,
    Database,
    FileJson,
    List,
    PlugZap,
    Power,
    RefreshCw,
    RotateCcw,
    Send,
    Server,
    ShieldCheck,
    Terminal,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'
import { confirmDialog } from '../../utils/dialogs'

type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type LoadingAction =
    | 'status'
    | 'backend'
    | 'echo'
    | 'notify'
    | 'storage'
    | 'clipboard'
    | 'safe'
    | 'restart'
    | null
type NotifyType = 'info' | 'success' | 'warning' | 'error'

interface HostCallResponse<T> {
    success: boolean
    data: T
    error?: string
}

interface ShowcaseHost {
    call<T>(method: string, ...args: unknown[]): Promise<HostCallResponse<T>>
    invoke<T>(method: string, ...args: unknown[]): Promise<T>
    status(): Promise<HostStatus>
    restart(): Promise<boolean>
}

interface HostStatus {
    ready: boolean
    active: boolean
}

interface BackendStatus {
    ok: boolean
    pluginId: string
    runtime: {
        pid: number | null
        platform: string
        node: string
        uptime: number | null
    }
    rpcNamespace: string
    methodStyle: string
    methods: string[]
    at: string
}

interface EchoResult {
    text: string
    originalText: string
    upperCase: boolean
    length: number
    tags: string[]
    receivedAt: string
}

interface NotifyResult {
    success: boolean
    message: string
    type: NotifyType
    notifiedAt: string
}

interface StorageRoundtripResult {
    success: boolean
    key: string
    stored: unknown
    savedAt: string
}

interface SafeBackendApiResult {
    ok: boolean
    pluginId: string
    backendStatus: BackendStatus
    time: unknown
    storage: {
        key: string
        enabled: boolean
        stored: unknown
        error: string | null
    }
    checkedAt: string
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'
const DEFAULT_STORAGE_KEY = 'host-rpc-demo:roundtrip'
const DEFAULT_STORAGE_VALUE = `{
  "text": "stored through Host RPC",
  "source": "host-rpc-module"
}`

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Renderer Host API',
        items: [
            { name: 'host.status(pluginName)', description: '查询插件 Host 进程是否 ready 和 active。' },
            { name: 'host.call(pluginName, method, ...args)', description: '调用插件后端导出的 rpc 方法，返回 success/data 包装结果。' },
            { name: 'host.invoke(pluginName, method, ...args)', description: '通过插件 Host 调用主进程插件 API namespace，例如 clipboard.readText。' },
            { name: 'host.restart(pluginName)', description: '重启当前插件 Host 进程，适合恢复后端状态或验证加载流程。' },
        ],
    },
    {
        title: 'Backend RPC Namespace',
        items: [
            { name: 'export const rpc', description: '新版推荐导出方式，不注入隐式 context，前端参数和后端入参 1:1 对齐。' },
            { name: 'rpc.getHostRpcBackendStatus()', description: '返回当前插件后台运行时、rpc namespace 和示例方法列表。' },
            { name: 'rpc.echoHostRpcPayload(input)', description: '回显 UI 传入的 payload，演示参数映射和序列化返回。' },
            { name: 'rpc.notifyFromHostRpc(input)', description: '在后台调用 mulby.notification.show 触发宿主通知。' },
            { name: 'rpc.storageRoundtripFromHostRpc(input)', description: '在后台调用 mulby.storage.set/get 做插件自有存储往返。' },
            { name: 'rpc.safeBackendApiCall(input)', description: '组合调用后台状态、时间和存储读取，返回可序列化摘要。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: 'React Hook 自动注入插件 ID',
        code: `const { host } = useMulby('@mulby/showcase')

const status = await host.status()
const result = await host.call('echoHostRpcPayload', {
  text: 'hello',
  upperCase: true
})`,
    },
    {
        title: '后端 rpc 无参数偏移',
        code: `export const rpc = {
  async echoHostRpcPayload(input) {
    await mulby.notification.show('received')
    return {
      text: input.text,
      receivedAt: new Date().toISOString()
    }
  }
}`,
    },
    {
        title: '通过 Host 调用插件 API namespace',
        code: `const text = await host.invoke('clipboard.readText')

// 等价底层调用：
// window.mulby.host.invoke('@mulby/showcase', 'clipboard.readText')`,
    },
]

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function formatDateTime(timestamp?: number | string | null) {
    if (!timestamp) return 'N/A'
    const date = typeof timestamp === 'number' || typeof timestamp === 'string' ? new Date(timestamp) : null
    if (!date || Number.isNaN(date.getTime())) return 'N/A'
    return date.toLocaleString()
}

function formatRuntimeUptime(seconds?: number | null) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'N/A'
    if (seconds < 60) return `${seconds.toFixed(1)} s`
    return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}

function operationLabel(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

function parseJsonOrText(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return ''
    try {
        return JSON.parse(trimmed) as unknown
    } catch {
        return value
    }
}

function stringifyPreview(value: unknown, limit = 700) {
    let text: string
    try {
        text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } catch {
        text = String(value)
    }
    return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text
}

function summarizeValue(value: unknown, limit = 360) {
    if (typeof value === 'string') {
        return {
            type: 'string',
            length: value.length,
            preview: value.length > limit ? `${value.slice(0, limit)}...[truncated]` : value,
        }
    }
    if (Array.isArray(value)) {
        return {
            type: 'array',
            length: value.length,
            preview: stringifyPreview(value.slice(0, 8), limit),
        }
    }
    if (value && typeof value === 'object') {
        return {
            type: 'object',
            keys: Object.keys(value as Record<string, unknown>).slice(0, 16),
            preview: stringifyPreview(value, limit),
        }
    }
    return {
        type: value === null ? 'null' : typeof value,
        preview: String(value),
    }
}

function summarizeClipboardText(text: string | null) {
    if (text === null) return null
    return {
        type: 'text',
        length: text.length,
        preview: text.length > 240 ? `${text.slice(0, 240)}...[truncated]` : text,
    }
}

export function HostRPCModule() {
    const { host, dialog } = useMulby(SHOWCASE_PLUGIN_ID)
    const showcaseHost = host as unknown as ShowcaseHost
    const notify = useNotification()

    const [hostStatus, setHostStatus] = useState<HostStatus | null>(null)
    const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null)
    const [echoText, setEchoText] = useState('Hello from Host RPC')
    const [echoUpperCase, setEchoUpperCase] = useState(false)
    const [echoTags, setEchoTags] = useState('showcase, rpc')
    const [echoResult, setEchoResult] = useState<EchoResult | null>(null)
    const [notifyMessage, setNotifyMessage] = useState('来自 Host RPC 模块的后台通知')
    const [notifyType, setNotifyType] = useState<NotifyType>('info')
    const [notifyResult, setNotifyResult] = useState<NotifyResult | null>(null)
    const [storageKey, setStorageKey] = useState(DEFAULT_STORAGE_KEY)
    const [storageValueText, setStorageValueText] = useState(DEFAULT_STORAGE_VALUE)
    const [storageResult, setStorageResult] = useState<StorageRoundtripResult | null>(null)
    const [clipboardText, setClipboardText] = useState<string | null>(null)
    const [safeCallResult, setSafeCallResult] = useState<SafeBackendApiResult | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 18))
    }, [])

    const callShowcaseHost = useCallback(async <T,>(method: string, ...args: unknown[]) => {
        const result = await showcaseHost.call<T>(method, ...args)
        if (!result.success) {
            throw new Error(result.error || `RPC 调用失败：${method}`)
        }
        return result.data
    }, [showcaseHost])

    const refreshStatus = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!options.silent) setLoadingAction('status')
        try {
            const status = await showcaseHost.status()
            setHostStatus(status)
            if (!options.silent) {
                pushOperation({
                    action: 'host.status',
                    status: 'success',
                    message: status.ready ? 'Host 已就绪' : 'Host 未就绪',
                    details: status,
                })
            }
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.status', status: 'error', message })
            if (!options.silent) notify.error(`Host 状态读取失败: ${message}`)
        } finally {
            if (!options.silent) setLoadingAction(null)
        }
    }, [notify, pushOperation, showcaseHost])

    const getBackendStatus = useCallback(async () => {
        setLoadingAction('backend')
        try {
            const result = await callShowcaseHost<BackendStatus>('getHostRpcBackendStatus')
            setBackendStatus(result)
            pushOperation({
                action: 'host.call getHostRpcBackendStatus',
                status: 'success',
                message: `后台 ${result.runtime.platform} / ${result.runtime.node}`,
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call getHostRpcBackendStatus', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, pushOperation])

    const sendEcho = useCallback(async () => {
        setLoadingAction('echo')
        try {
            const tags = echoTags
                .split(',')
                .map(tag => tag.trim())
                .filter(Boolean)
            const result = await callShowcaseHost<EchoResult>('echoHostRpcPayload', {
                text: echoText,
                upperCase: echoUpperCase,
                tags,
            })
            setEchoResult(result)
            pushOperation({
                action: 'host.call echoHostRpcPayload',
                status: 'success',
                message: `返回 ${result.length} 个字符`,
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call echoHostRpcPayload', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, echoTags, echoText, echoUpperCase, notify, pushOperation])

    const notifyFromHostRpc = useCallback(async () => {
        setLoadingAction('notify')
        try {
            const result = await callShowcaseHost<NotifyResult>('notifyFromHostRpc', {
                message: notifyMessage,
                type: notifyType,
            })
            setNotifyResult(result)
            pushOperation({
                action: 'host.call notifyFromHostRpc',
                status: 'success',
                message: `${result.type}: ${result.message}`,
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call notifyFromHostRpc', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, notifyMessage, notifyType, pushOperation])

    const storageRoundtrip = useCallback(async () => {
        setLoadingAction('storage')
        try {
            const value = parseJsonOrText(storageValueText)
            const result = await callShowcaseHost<StorageRoundtripResult>('storageRoundtripFromHostRpc', {
                key: storageKey,
                value,
            })
            setStorageResult(result)
            pushOperation({
                action: 'host.call storageRoundtripFromHostRpc',
                status: 'success',
                message: `已写入并读取 ${result.key}`,
                details: {
                    key: result.key,
                    stored: summarizeValue(result.stored),
                },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call storageRoundtripFromHostRpc', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, pushOperation, storageKey, storageValueText])

    const readClipboardViaHostRpcInvoke = useCallback(async () => {
        setLoadingAction('clipboard')
        try {
            const text = await showcaseHost.invoke<string>('clipboard.readText')
            setClipboardText(text)
            pushOperation({
                action: 'host.invoke clipboard.readText',
                status: 'success',
                message: `读取到 ${text.length} 个字符`,
                details: summarizeClipboardText(text),
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.invoke clipboard.readText', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, showcaseHost])

    const safeBackendApiCall = useCallback(async () => {
        setLoadingAction('safe')
        try {
            const result = await callShowcaseHost<SafeBackendApiResult>('safeBackendApiCall', {
                includeTime: true,
                includeStoredValue: true,
                storageKey,
            })
            setSafeCallResult(result)
            setBackendStatus(result.backendStatus)
            pushOperation({
                action: 'host.call safeBackendApiCall',
                status: result.storage.error ? 'warning' : 'success',
                message: result.storage.error || '后台组合调用完成',
                details: {
                    pluginId: result.pluginId,
                    storage: {
                        key: result.storage.key,
                        stored: summarizeValue(result.storage.stored),
                        error: result.storage.error,
                    },
                },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call safeBackendApiCall', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, pushOperation, storageKey])

    const restartHost = useCallback(async () => {
        const confirmed = await confirmDialog(dialog, {
            title: '重启插件 Host',
            message: '重启当前插件 Host 进程会短暂中断后台 RPC，确认继续？',
            confirmLabel: '重启',
        })
        if (!confirmed) return

        setLoadingAction('restart')
        try {
            const ok = await showcaseHost.restart()
            setHostStatus(null)
            setBackendStatus(null)
            pushOperation({
                action: 'host.restart',
                status: ok ? 'success' : 'warning',
                message: ok ? '已请求重启 Host' : '宿主返回重启失败',
            })
            window.setTimeout(() => {
                void refreshStatus({ silent: true })
            }, 800)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.restart', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, pushOperation, refreshStatus, showcaseHost])

    useEffect(() => {
        void refreshStatus({ silent: true })
    }, [refreshStatus])

    const rawData = useMemo(() => ({
        pluginId: SHOWCASE_PLUGIN_ID,
        hostStatus,
        backendStatus,
        form: {
            echoText,
            echoUpperCase,
            echoTags,
            notifyType,
            notifyMessageLength: notifyMessage.length,
            storageKey,
            storageValue: summarizeValue(parseJsonOrText(storageValueText)),
        },
        results: {
            echoResult,
            notifyResult,
            storageResult: storageResult
                ? {
                    ...storageResult,
                    stored: summarizeValue(storageResult.stored),
                }
                : null,
            clipboardText: summarizeClipboardText(clipboardText),
            safeCallResult: safeCallResult
                ? {
                    ...safeCallResult,
                    storage: {
                        ...safeCallResult.storage,
                        stored: summarizeValue(safeCallResult.storage.stored),
                    },
                }
                : null,
        },
        operationLog,
    }), [
        backendStatus,
        clipboardText,
        echoResult,
        echoTags,
        echoText,
        echoUpperCase,
        hostStatus,
        notifyMessage,
        notifyResult,
        notifyType,
        operationLog,
        safeCallResult,
        storageKey,
        storageResult,
        storageValueText,
    ])

    return (
        <div className="main-content">
            <PageHeader
                icon={Terminal}
                title="Host RPC"
                description="演示 UI 调用插件后台 rpc、通过 Host 调用插件 API namespace，以及查询和重启插件 Host 进程"
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => void refreshStatus()} loading={loadingAction === 'status'}>
                            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                            刷新状态
                        </Button>
                        <Button variant="secondary" onClick={() => void restartHost()} loading={loadingAction === 'restart'}>
                            <RotateCcw className="inline-icon" aria-hidden="true" size={14} />
                            重启 Host
                        </Button>
                    </>
                )}
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-value">{hostStatus?.ready ? 'Ready' : 'Unknown'}</div>
                            <div className="stat-label">Host Ready</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{hostStatus?.active ? 'Active' : 'Idle'}</div>
                            <div className="stat-label">Host Active</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{backendStatus?.runtime.platform || 'N/A'}</div>
                            <div className="stat-label">Backend Platform</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{operationLog.length}</div>
                            <div className="stat-label">操作记录</div>
                        </div>
                    </div>

                    <div className="grid grid-2">
                        <Card
                            title="Host 状态"
                            icon={Power}
                            actions={(
                                <Button onClick={() => void getBackendStatus()} loading={loadingAction === 'backend'}>
                                    <Server className="inline-icon" aria-hidden="true" size={14} />
                                    后台状态
                                </Button>
                            )}
                        >
                            <div className="info-grid">
                                <span className="info-label">插件 ID</span>
                                <span className="info-value">{SHOWCASE_PLUGIN_ID}</span>
                                <span className="info-label">Ready</span>
                                <span className="info-value">
                                    <StatusBadge status={hostStatus?.ready ? 'success' : 'warning'}>
                                        {hostStatus?.ready ? '已就绪' : '未知'}
                                    </StatusBadge>
                                </span>
                                <span className="info-label">Active</span>
                                <span className="info-value">
                                    <StatusBadge status={hostStatus?.active ? 'success' : 'info'}>
                                        {hostStatus?.active ? '活跃' : '空闲或未知'}
                                    </StatusBadge>
                                </span>
                                <span className="info-label">RPC 风格</span>
                                <span className="info-value">{backendStatus?.methodStyle || 'rpc namespace'}</span>
                            </div>
                        </Card>

                        <Card title="后台运行时" icon={Server}>
                            {backendStatus ? (
                                <div className="info-grid">
                                    <span className="info-label">PID</span>
                                    <span className="info-value">{backendStatus.runtime.pid ?? 'N/A'}</span>
                                    <span className="info-label">平台</span>
                                    <span className="info-value">{backendStatus.runtime.platform}</span>
                                    <span className="info-label">Node</span>
                                    <span className="info-value">{backendStatus.runtime.node}</span>
                                    <span className="info-label">Uptime</span>
                                    <span className="info-value">{formatRuntimeUptime(backendStatus.runtime.uptime)}</span>
                                    <span className="info-label">更新时间</span>
                                    <span className="info-value">{formatDateTime(backendStatus.at)}</span>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <Server aria-hidden="true" size={28} />
                                    <p>点击后台状态读取 rpc 运行时信息</p>
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="rpc 回显"
                            icon={Send}
                            actions={(
                                <Button onClick={() => void sendEcho()} loading={loadingAction === 'echo'}>
                                    <Send className="inline-icon" aria-hidden="true" size={14} />
                                    调用 echo
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="host-rpc-echo-text">文本</label>
                                    <textarea
                                        id="host-rpc-echo-text"
                                        className="textarea"
                                        rows={4}
                                        value={echoText}
                                        onChange={event => setEchoText(event.target.value)}
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="host-rpc-echo-tags">标签，逗号分隔</label>
                                    <input
                                        id="host-rpc-echo-tags"
                                        className="input"
                                        value={echoTags}
                                        onChange={event => setEchoTags(event.target.value)}
                                    />
                                </div>
                                <label className="list-row" style={{ cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={echoUpperCase}
                                        onChange={event => setEchoUpperCase(event.target.checked)}
                                    />
                                    <span className="list-row-main">后台返回时转为大写</span>
                                </label>
                            </div>
                        </Card>

                        <Card title="Echo 结果" icon={FileJson}>
                            {echoResult ? (
                                <div className="preview-box" style={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 220 }}>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                                        {stringifyPreview(echoResult, 1200)}
                                    </pre>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <FileJson aria-hidden="true" size={28} />
                                    <p>调用 echoHostRpcPayload 后显示结果</p>
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="后台通知"
                            icon={Bell}
                            actions={(
                                <Button onClick={() => void notifyFromHostRpc()} loading={loadingAction === 'notify'}>
                                    <Bell className="inline-icon" aria-hidden="true" size={14} />
                                    触发通知
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="host-rpc-notify-message">通知内容</label>
                                    <input
                                        id="host-rpc-notify-message"
                                        className="input"
                                        value={notifyMessage}
                                        onChange={event => setNotifyMessage(event.target.value)}
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="host-rpc-notify-type">类型</label>
                                    <select
                                        id="host-rpc-notify-type"
                                        className="select"
                                        value={notifyType}
                                        onChange={event => setNotifyType(event.target.value as NotifyType)}
                                    >
                                        <option value="info">info</option>
                                        <option value="success">success</option>
                                        <option value="warning">warning</option>
                                        <option value="error">error</option>
                                    </select>
                                </div>
                                {notifyResult && (
                                    <StatusBadge status={notifyResult.type}>{notifyResult.message}</StatusBadge>
                                )}
                            </div>
                        </Card>

                        <Card
                            title="后台存储往返"
                            icon={Database}
                            actions={(
                                <Button onClick={() => void storageRoundtrip()} loading={loadingAction === 'storage'}>
                                    <Database className="inline-icon" aria-hidden="true" size={14} />
                                    写入并读取
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="host-rpc-storage-key">Key</label>
                                    <input
                                        id="host-rpc-storage-key"
                                        className="input"
                                        value={storageKey}
                                        onChange={event => setStorageKey(event.target.value)}
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="host-rpc-storage-value">JSON 或文本值</label>
                                    <textarea
                                        id="host-rpc-storage-value"
                                        className="textarea"
                                        rows={5}
                                        value={storageValueText}
                                        onChange={event => setStorageValueText(event.target.value)}
                                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                                    />
                                </div>
                                {storageResult && (
                                    <div className="list-row">
                                        <StatusBadge status="success">已保存</StatusBadge>
                                        <span className="list-row-main">{storageResult.key}</span>
                                        <span className="list-row-meta">{formatDateTime(storageResult.savedAt)}</span>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="host.invoke 调用插件 API"
                            icon={Clipboard}
                            actions={(
                                <Button onClick={() => void readClipboardViaHostRpcInvoke()} loading={loadingAction === 'clipboard'}>
                                    <Clipboard className="inline-icon" aria-hidden="true" size={14} />
                                    读取剪贴板
                                </Button>
                            )}
                        >
                            <div className="preview-box" style={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 180 }}>
                                {clipboardText !== null ? (
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                                        {clipboardText || '[empty clipboard text]'}
                                    </pre>
                                ) : (
                                    <div className="empty-state" style={{ margin: 'auto' }}>
                                        <Clipboard aria-hidden="true" size={28} />
                                        <p>通过 host.invoke('clipboard.readText') 读取文本剪贴板</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card
                            title="后台安全组合调用"
                            icon={ShieldCheck}
                            actions={(
                                <Button onClick={() => void safeBackendApiCall()} loading={loadingAction === 'safe'}>
                                    <PlugZap className="inline-icon" aria-hidden="true" size={14} />
                                    组合调用
                                </Button>
                            )}
                        >
                            {safeCallResult ? (
                                <div className="info-grid">
                                    <span className="info-label">插件</span>
                                    <span className="info-value">{safeCallResult.pluginId}</span>
                                    <span className="info-label">存储 Key</span>
                                    <span className="info-value">{safeCallResult.storage.key}</span>
                                    <span className="info-label">存储状态</span>
                                    <span className="info-value">
                                        <StatusBadge status={safeCallResult.storage.error ? 'warning' : 'success'}>
                                            {safeCallResult.storage.error || '读取完成'}
                                        </StatusBadge>
                                    </span>
                                    <span className="info-label">检查时间</span>
                                    <span className="info-value">{formatDateTime(safeCallResult.checkedAt)}</span>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <ShieldCheck aria-hidden="true" size={28} />
                                    <p>组合调用会返回后台状态、时间和存储读取摘要</p>
                                </div>
                            )}
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
                                        <BadgeInfo aria-hidden="true" size={28} />
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
