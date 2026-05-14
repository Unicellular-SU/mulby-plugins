import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Bug,
    CircleX,
    FileText,
    FolderOpen,
    Info,
    List,
    Radio,
    RefreshCw,
    Trash2,
    TriangleAlert,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'
import { confirmDialog } from '../../utils/dialogs'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'
type LogEntryLevel = LogLevel | 'crash'
type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type LoadingAction = 'write' | 'load' | 'clear' | 'dir' | 'subscribe' | null

interface LogEntry {
    timestamp: number
    level: LogEntryLevel
    pluginId: string
    message: string
    args?: unknown[]
    crashDetails?: {
        reason: string
        exitCode?: number
        windowId?: number
    }
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'
const DEFAULT_LOG_MESSAGE = 'Mulby Showcase log API test'
const DEFAULT_LOG_ARGS = `{
  "source": "log-module",
  "sample": true
}`

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Log Write API',
        items: [
            { name: 'log.debug(message, ...args)', description: '写入 debug 级别插件日志。' },
            { name: 'log.info(message, ...args)', description: '写入 info 级别插件日志。' },
            { name: 'log.warn(message, ...args)', description: '写入 warn 级别插件日志。' },
            { name: 'log.error(message, ...args)', description: '写入 error 级别插件日志。' },
        ],
    },
    {
        title: 'Log Query and Live API',
        items: [
            { name: 'log.getLogs(options?)', description: '按插件、级别和数量读取最近日志。' },
            { name: 'log.clear(pluginId?)', description: '清理日志；示例默认只清理当前插件。' },
            { name: 'log.getLogsDir()', description: '返回宿主日志目录路径。' },
            { name: 'log.subscribe()', description: '开启当前窗口的实时日志推送。' },
            { name: 'log.onLog(callback)', description: '订阅 log:new 事件，返回 disposer。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '写入结构化日志',
        code: `const { log } = useMulby()

log.info('operation completed', {
  source: 'log-module',
  requestId: 'demo'
})`,
    },
    {
        title: '查询当前插件日志',
        code: `const entries = await log.getLogs({
  pluginId: '@mulby/showcase',
  level: 'info',
  limit: 50
})`,
    },
    {
        title: '订阅实时日志',
        code: `await log.subscribe()
const dispose = log.onLog((entry) => {
  console.log(entry.level, entry.message)
})

dispose()`,
    },
]

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function formatDateTime(timestamp?: number | string | null) {
    if (!timestamp) return 'N/A'
    const date = new Date(timestamp)
    return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString()
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

function levelLabel(level: LogEntryLevel) {
    if (level === 'debug') return 'Debug'
    if (level === 'info') return 'Info'
    if (level === 'warn') return 'Warn'
    if (level === 'error') return 'Error'
    return 'Crash'
}

function levelStatus(level: LogEntryLevel): OperationStatus {
    if (level === 'error' || level === 'crash') return 'error'
    if (level === 'warn') return 'warning'
    if (level === 'debug') return 'info'
    return 'success'
}

function parseArgs(argsText: string) {
    const trimmed = argsText.trim()
    if (!trimmed) return []
    try {
        const parsed = JSON.parse(trimmed) as unknown
        return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
        return [argsText]
    }
}

function stringifyPreview(value: unknown, limit = 280) {
    let text: string
    try {
        text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } catch {
        text = String(value)
    }
    return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text
}

function summarizeLogEntry(entry: LogEntry) {
    return {
        timestamp: entry.timestamp,
        level: entry.level,
        pluginId: entry.pluginId,
        message: entry.message.length > 300 ? `${entry.message.slice(0, 300)}...[truncated]` : entry.message,
        args: entry.args?.map(arg => stringifyPreview(arg, 220)),
        crashDetails: entry.crashDetails,
    }
}

function logIcon(level: LogLevel) {
    if (level === 'debug') return Bug
    if (level === 'warn') return TriangleAlert
    if (level === 'error') return CircleX
    return Info
}

export function LogModule() {
    const { log, dialog } = useMulby()
    const notify = useNotification()
    const liveLogDisposerRef = useRef<Disposable | null>(null)

    const [level, setLevel] = useState<LogLevel>('info')
    const [message, setMessage] = useState(DEFAULT_LOG_MESSAGE)
    const [argsText, setArgsText] = useState(DEFAULT_LOG_ARGS)
    const [filterPluginId, setFilterPluginId] = useState(SHOWCASE_PLUGIN_ID)
    const [filterLevel, setFilterLevel] = useState<'' | LogEntryLevel>('')
    const [limit, setLimit] = useState(50)
    const [logs, setLogs] = useState<LogEntry[]>([])
    const [liveEntries, setLiveEntries] = useState<LogEntry[]>([])
    const [logsDir, setLogsDir] = useState('')
    const [subscribed, setSubscribed] = useState(false)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 16))
    }, [])

    const loadLogs = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!options.silent) setLoadingAction('load')
        try {
            const entries = await log.getLogs({
                pluginId: filterPluginId.trim() || undefined,
                level: filterLevel || undefined,
                limit,
            })
            setLogs(entries)
            if (!options.silent) {
                pushOperation({
                    action: 'log.getLogs',
                    status: 'success',
                    message: `已读取 ${entries.length} 条日志`,
                })
            }
        } catch (error) {
            const nextMessage = getErrorMessage(error)
            pushOperation({ action: 'log.getLogs', status: 'error', message: nextMessage })
            if (!options.silent) notify.error(`读取日志失败: ${nextMessage}`)
        } finally {
            if (!options.silent) setLoadingAction(null)
        }
    }, [filterLevel, filterPluginId, limit, log, notify, pushOperation])

    const loadLogsDir = useCallback(async () => {
        setLoadingAction('dir')
        try {
            const dir = await log.getLogsDir()
            setLogsDir(dir)
            pushOperation({ action: 'log.getLogsDir', status: 'success', message: dir })
            notify.success('已读取日志目录')
        } catch (error) {
            const nextMessage = getErrorMessage(error)
            pushOperation({ action: 'log.getLogsDir', status: 'error', message: nextMessage })
            notify.error(`读取日志目录失败: ${nextMessage}`)
        } finally {
            setLoadingAction(null)
        }
    }, [log, notify, pushOperation])

    const writeLogEntry = useCallback(async () => {
        setLoadingAction('write')
        try {
            const args = parseArgs(argsText)
            if (level === 'debug') {
                log.debug(message, ...args)
            } else if (level === 'warn') {
                log.warn(message, ...args)
            } else if (level === 'error') {
                log.error(message, ...args)
            } else {
                log.info(message, ...args)
            }

            pushOperation({
                action: `log.${level}`,
                status: levelStatus(level),
                message: `已写入 ${levelLabel(level)} 日志`,
                details: { message, args },
            })
            notify.success('日志已写入')
            window.setTimeout(() => void loadLogs({ silent: true }), 120)
        } catch (error) {
            const nextMessage = getErrorMessage(error)
            pushOperation({ action: `log.${level}`, status: 'error', message: nextMessage })
            notify.error(`写入日志失败: ${nextMessage}`)
        } finally {
            setLoadingAction(null)
        }
    }, [argsText, level, loadLogs, log, message, notify, pushOperation])

    const clearLogs = useCallback(async () => {
        const pluginId = filterPluginId.trim()
        const target = pluginId || '全部插件'
        const confirmed = await confirmDialog(dialog, {
            title: '清理日志',
            message: `确定清理 ${target} 的内存日志吗？`,
            confirmLabel: '清理',
        })
        if (!confirmed) return

        setLoadingAction('clear')
        try {
            await log.clear(pluginId || undefined)
            setLogs([])
            setLiveEntries(current => pluginId ? current.filter(entry => entry.pluginId !== pluginId) : [])
            pushOperation({ action: 'log.clear', status: 'success', message: `已清理 ${target}` })
            notify.success('日志已清理')
        } catch (error) {
            const nextMessage = getErrorMessage(error)
            pushOperation({ action: 'log.clear', status: 'error', message: nextMessage })
            notify.error(`清理日志失败: ${nextMessage}`)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, filterPluginId, log, notify, pushOperation])

    const startSubscription = useCallback(async () => {
        if (liveLogDisposerRef.current) return
        setLoadingAction('subscribe')
        try {
            await log.subscribe()
            const dispose = log.onLog((entry) => {
                setLiveEntries(current => [entry, ...current].slice(0, 40))
            })
            liveLogDisposerRef.current = dispose
            setSubscribed(true)
            pushOperation({ action: 'log.subscribe + log.onLog', status: 'success', message: '实时日志订阅已开启' })
            notify.success('实时日志订阅已开启')
        } catch (error) {
            const nextMessage = getErrorMessage(error)
            pushOperation({ action: 'log.subscribe + log.onLog', status: 'error', message: nextMessage })
            notify.error(`订阅实时日志失败: ${nextMessage}`)
        } finally {
            setLoadingAction(null)
        }
    }, [log, notify, pushOperation])

    const stopSubscription = useCallback(() => {
        liveLogDisposerRef.current?.()
        liveLogDisposerRef.current = null
        setSubscribed(false)
        pushOperation({ action: 'log.onLog disposer', status: 'info', message: '实时日志订阅已停止' })
    }, [pushOperation])

    useEffect(() => {
        void loadLogs({ silent: true })
        void loadLogsDir()
    }, [])

    useEffect(() => () => {
        liveLogDisposerRef.current?.()
        liveLogDisposerRef.current = null
    }, [])

    const LevelIcon = logIcon(level)
    const rawData = useMemo(() => ({
        filter: {
            pluginId: filterPluginId,
            level: filterLevel,
            limit,
        },
        writer: {
            level,
            message,
            parsedArgs: parseArgs(argsText).map(arg => stringifyPreview(arg)),
        },
        logsDir,
        subscribed,
        logs: logs.map(summarizeLogEntry),
        liveEntries: liveEntries.map(summarizeLogEntry),
        operationLog,
    }), [argsText, filterLevel, filterPluginId, level, limit, liveEntries, logs, logsDir, message, operationLog, subscribed])

    return (
        <div className="main-content">
            <PageHeader
                icon={FileText}
                title="日志"
                description="写入、查询、清理和订阅当前宿主的插件日志。"
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => void loadLogs()} loading={loadingAction === 'load'}>
                            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                            刷新日志
                        </Button>
                        {subscribed ? (
                            <Button variant="secondary" onClick={stopSubscription} loading={loadingAction === 'subscribe'}>
                                <Radio className="inline-icon" aria-hidden="true" size={14} />
                                停止订阅
                            </Button>
                        ) : (
                            <Button variant="secondary" onClick={() => void startSubscription()} loading={loadingAction === 'subscribe'}>
                                <Radio className="inline-icon" aria-hidden="true" size={14} />
                                实时订阅
                            </Button>
                        )}
                    </>
                )}
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-value">{logs.length}</div>
                            <div className="stat-label">查询结果</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{liveEntries.length}</div>
                            <div className="stat-label">实时日志</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">
                                <StatusBadge status={subscribed ? 'success' : 'info'}>{subscribed ? '已订阅' : '未订阅'}</StatusBadge>
                            </div>
                            <div className="stat-label">实时状态</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{logsDir ? '已读取' : 'N/A'}</div>
                            <div className="stat-label">日志目录</div>
                        </div>
                    </div>

                    <div className="grid grid-2">
                        <Card
                            title="写入日志"
                            icon={FileText}
                            actions={(
                                <Button onClick={() => void writeLogEntry()} loading={loadingAction === 'write'}>
                                    <LevelIcon className="inline-icon" aria-hidden="true" size={14} />
                                    写入
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div className="input-group" style={{ width: 150 }}>
                                        <label className="input-label" htmlFor="log-level">级别</label>
                                        <select id="log-level" className="select" value={level} onChange={event => setLevel(event.target.value as LogLevel)}>
                                            <option value="debug">debug</option>
                                            <option value="info">info</option>
                                            <option value="warn">warn</option>
                                            <option value="error">error</option>
                                        </select>
                                    </div>
                                    <div className="input-group" style={{ flex: '1 1 220px' }}>
                                        <label className="input-label" htmlFor="log-message">消息</label>
                                        <input id="log-message" className="input" value={message} onChange={event => setMessage(event.target.value)} />
                                    </div>
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="log-args">参数 JSON 或文本</label>
                                    <textarea id="log-args" className="textarea" value={argsText} onChange={event => setArgsText(event.target.value)} />
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="查询与清理"
                            icon={List}
                            actions={(
                                <>
                                    <Button variant="secondary" onClick={() => void loadLogs()} loading={loadingAction === 'load'}>
                                        <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                        查询
                                    </Button>
                                    <Button variant="secondary" onClick={() => void clearLogs()} loading={loadingAction === 'clear'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        清理
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div className="input-group" style={{ flex: '1 1 220px' }}>
                                        <label className="input-label" htmlFor="log-plugin-filter">Plugin ID</label>
                                        <input id="log-plugin-filter" className="input" value={filterPluginId} onChange={event => setFilterPluginId(event.target.value)} />
                                    </div>
                                    <div className="input-group" style={{ width: 140 }}>
                                        <label className="input-label" htmlFor="log-level-filter">级别</label>
                                        <select id="log-level-filter" className="select" value={filterLevel} onChange={event => setFilterLevel(event.target.value as '' | LogEntryLevel)}>
                                            <option value="">全部</option>
                                            <option value="debug">debug</option>
                                            <option value="info">info</option>
                                            <option value="warn">warn</option>
                                            <option value="error">error</option>
                                            <option value="crash">crash</option>
                                        </select>
                                    </div>
                                    <div className="input-group" style={{ width: 110 }}>
                                        <label className="input-label" htmlFor="log-limit">数量</label>
                                        <input id="log-limit" className="input" type="number" min={1} max={500} value={limit} onChange={event => setLimit(Math.max(1, Math.min(500, Number(event.target.value) || 50)))} />
                                    </div>
                                </div>
                                <div className="info-grid">
                                    <span className="info-label">目录</span>
                                    <span className="info-value">{logsDir || 'N/A'}</span>
                                </div>
                                <Button variant="secondary" onClick={() => void loadLogsDir()} loading={loadingAction === 'dir'}>
                                    <FolderOpen className="inline-icon" aria-hidden="true" size={14} />
                                    读取日志目录
                                </Button>
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="查询结果" icon={FileText}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {logs.length > 0 ? logs.map((entry, index) => (
                                    <div className="list-row" key={`${entry.timestamp}-${entry.level}-${index}`}>
                                        <StatusBadge status={levelStatus(entry.level)}>{levelLabel(entry.level)}</StatusBadge>
                                        <span className="list-row-main">{entry.message}</span>
                                        <span className="list-row-meta">{entry.pluginId}</span>
                                        <span className="list-row-meta">{formatTime(entry.timestamp)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <FileText aria-hidden="true" size={28} />
                                        <p>当前过滤条件下暂无日志</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card title="实时日志" icon={Radio}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {liveEntries.length > 0 ? liveEntries.map((entry, index) => (
                                    <div className="list-row" key={`${entry.timestamp}-${index}`}>
                                        <StatusBadge status={levelStatus(entry.level)}>{levelLabel(entry.level)}</StatusBadge>
                                        <span className="list-row-main">{entry.message}</span>
                                        <span className="list-row-meta">{entry.pluginId}</span>
                                        <span className="list-row-meta">{formatTime(entry.timestamp)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <Radio aria-hidden="true" size={28} />
                                        <p>开启实时订阅后会显示新写入的日志</p>
                                    </div>
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
