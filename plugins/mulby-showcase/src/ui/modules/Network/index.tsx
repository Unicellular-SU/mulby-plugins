import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Activity,
    AlertTriangle,
    Clock,
    Download,
    Globe2,
    History,
    Network,
    PenLine,
    Radio,
    RefreshCw,
    Send,
    Wifi,
    WifiOff,
    Zap,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD'

interface HttpResponse {
    status: number
    statusText: string
    headers: Record<string, string>
    data: string
}

interface NetworkEventLogItem {
    type: 'online' | 'offline' | 'checked'
    online: boolean
    timestamp: number
}

interface RequestSnapshot {
    url: string
    method: HttpMethod
    headers: Record<string, string>
    body?: unknown
    timeout: number
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']
const MAX_RESPONSE_PREVIEW = 5000

function formatJson(value: string) {
    try {
        return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
        return value
    }
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function parseJsonObject(text: string): { value: Record<string, string>; error: string | null } {
    if (!text.trim()) return { value: {}, error: null }

    try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { value: {}, error: '请求头必须是 JSON 对象' }
        }

        return {
            value: Object.fromEntries(
                Object.entries(parsed).map(([key, value]) => [key, String(value)])
            ),
            error: null,
        }
    } catch (error) {
        return { value: {}, error: getErrorMessage(error) }
    }
}

function parseBody(text: string): unknown {
    if (!text.trim()) return undefined

    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

function shouldSendBody(method: HttpMethod) {
    return method === 'POST' || method === 'PUT' || method === 'PATCH'
}

function redactHeaders(headers: Record<string, string>) {
    const sensitive = /authorization|cookie|token|secret|api-key|apikey/i
    return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [
            key,
            sensitive.test(key) ? '[redacted]' : value,
        ])
    )
}

function summarizeResponse(response: HttpResponse | null) {
    if (!response) return null

    const formatted = formatJson(response.data)
    return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        dataLength: response.data.length,
        preview: formatted.slice(0, MAX_RESPONSE_PREVIEW),
        truncated: formatted.length > MAX_RESPONSE_PREVIEW,
    }
}

export function NetworkModule() {
    const { http, network } = useMulby()
    const notify = useNotification()

    const [isOnline, setIsOnline] = useState<boolean | null>(null)
    const [url, setUrl] = useState('https://httpbin.org/get')
    const [method, setMethod] = useState<HttpMethod>('GET')
    const [headers, setHeaders] = useState('{\n  "Content-Type": "application/json"\n}')
    const [body, setBody] = useState('{\n  "key": "value"\n}')
    const [timeoutMs, setTimeoutMs] = useState(30000)
    const [response, setResponse] = useState<HttpResponse | null>(null)
    const [requestError, setRequestError] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [responseTime, setResponseTime] = useState<number | null>(null)
    const [lastRequest, setLastRequest] = useState<RequestSnapshot | null>(null)
    const [networkEvents, setNetworkEvents] = useState<NetworkEventLogItem[]>([])

    const recordNetworkEvent = useCallback((type: NetworkEventLogItem['type'], online: boolean) => {
        setNetworkEvents(current => [
            { type, online, timestamp: Date.now() },
            ...current,
        ].slice(0, 8))
    }, [])

    const checkOnline = useCallback(async () => {
        try {
            const online = await network.isOnline()
            setIsOnline(online)
            recordNetworkEvent('checked', online)
        } catch (error) {
            notify.error(`网络状态检测失败: ${getErrorMessage(error)}`)
            setIsOnline(null)
        }
    }, [network, notify, recordNetworkEvent])

    useEffect(() => {
        void checkOnline()

        network.onOnline(() => {
            setIsOnline(true)
            recordNetworkEvent('online', true)
            notify.success('网络已恢复')
        })

        network.onOffline(() => {
            setIsOnline(false)
            recordNetworkEvent('offline', false)
            notify.warning('网络已断开')
        })
    }, [checkOnline, network, notify, recordNetworkEvent])

    const runRequest = useCallback(async (request: {
        url: string
        method: HttpMethod
        headers?: Record<string, string>
        body?: unknown
        timeout?: number
        shortcut?: 'get' | 'post' | 'put' | 'delete'
    }) => {
        if (!request.url.trim()) {
            notify.warning('请输入 URL')
            return
        }

        setLoading(true)
        setResponse(null)
        setRequestError(null)
        const startTime = Date.now()
        const timeout = request.timeout ?? timeoutMs
        const requestHeaders = request.headers ?? {}
        const snapshot: RequestSnapshot = {
            url: request.url,
            method: request.method,
            headers: redactHeaders(requestHeaders),
            body: request.body,
            timeout,
        }
        setLastRequest(snapshot)

        try {
            let result: HttpResponse

            if (request.shortcut === 'get') {
                result = await http.get(request.url, requestHeaders)
            } else if (request.shortcut === 'post') {
                result = await http.post(request.url, request.body, requestHeaders)
            } else if (request.shortcut === 'put') {
                result = await http.put(request.url, request.body, requestHeaders)
            } else if (request.shortcut === 'delete') {
                result = await http.delete(request.url, requestHeaders)
            } else {
                result = await http.request({
                    url: request.url,
                    method: request.method,
                    headers: requestHeaders,
                    body: request.body,
                    timeout,
                })
            }

            setResponseTime(Date.now() - startTime)
            setResponse(result)
            notify.success(`请求完成: ${result.status}`)
        } catch (error) {
            const message = getErrorMessage(error)
            setResponseTime(Date.now() - startTime)
            setRequestError(message)
            notify.error(`请求失败: ${message}`)
        } finally {
            setLoading(false)
        }
    }, [http, notify, timeoutMs])

    const handleRequest = useCallback(async () => {
        const parsedHeaders = parseJsonObject(headers)
        if (parsedHeaders.error) {
            setRequestError(`请求头 JSON 无效: ${parsedHeaders.error}`)
            notify.error('请求头 JSON 无效')
            return
        }

        await runRequest({
            url: url.trim(),
            method,
            headers: parsedHeaders.value,
            body: shouldSendBody(method) ? parseBody(body) : undefined,
            timeout: timeoutMs,
        })
    }, [body, headers, method, notify, runRequest, timeoutMs, url])

    const handleQuickTest = useCallback(async (test: 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head') => {
        const now = Date.now()

        if (test === 'get') {
            setUrl('https://httpbin.org/get')
            setMethod('GET')
            await runRequest({ url: 'https://httpbin.org/get', method: 'GET', shortcut: 'get' })
            return
        }

        if (test === 'post') {
            setUrl('https://httpbin.org/post')
            setMethod('POST')
            setBody(`{\n  "test": true,\n  "timestamp": ${now}\n}`)
            await runRequest({
                url: 'https://httpbin.org/post',
                method: 'POST',
                shortcut: 'post',
                body: { test: true, timestamp: now },
                headers: { 'Content-Type': 'application/json' },
            })
            return
        }

        if (test === 'put') {
            setUrl('https://httpbin.org/put')
            setMethod('PUT')
            setBody(`{\n  "updated": true,\n  "timestamp": ${now}\n}`)
            await runRequest({
                url: 'https://httpbin.org/put',
                method: 'PUT',
                shortcut: 'put',
                body: { updated: true, timestamp: now },
                headers: { 'Content-Type': 'application/json' },
            })
            return
        }

        if (test === 'delete') {
            setUrl('https://httpbin.org/delete')
            setMethod('DELETE')
            await runRequest({ url: 'https://httpbin.org/delete', method: 'DELETE', shortcut: 'delete' })
            return
        }

        if (test === 'patch') {
            setUrl('https://httpbin.org/patch')
            setMethod('PATCH')
            setBody(`{\n  "patched": true,\n  "timestamp": ${now}\n}`)
            await runRequest({
                url: 'https://httpbin.org/patch',
                method: 'PATCH',
                body: { patched: true, timestamp: now },
                headers: { 'Content-Type': 'application/json' },
            })
            return
        }

        setUrl('https://httpbin.org/status/204')
        setMethod('HEAD')
        await runRequest({
            url: 'https://httpbin.org/status/204',
            method: 'HEAD',
        })
    }, [runRequest])

    const responseBodyPreview = useMemo(() => {
        if (!response) return ''
        const formatted = formatJson(response.data)
        return `${formatted.slice(0, MAX_RESPONSE_PREVIEW)}${formatted.length > MAX_RESPONSE_PREVIEW ? '\n...[已截断]' : ''}`
    }, [response])

    const apiGroups: ApiReferenceGroup[] = useMemo(() => [
        {
            title: 'HTTP API',
            items: [
                { name: 'http.request(options)', description: '发起完整 HTTP 请求，支持 GET、POST、PUT、DELETE、PATCH、HEAD。' },
                { name: 'http.get(url, headers)', description: 'GET 快捷方法。' },
                { name: 'http.post(url, body, headers)', description: 'POST 快捷方法，object 请求体会自动 JSON 序列化。' },
                { name: 'http.put(url, body, headers)', description: 'PUT 快捷方法。' },
                { name: 'http.delete(url, headers)', description: 'DELETE 快捷方法。' },
            ],
        },
        {
            title: 'Network API',
            items: [
                { name: 'network.isOnline()', description: '检测当前网络是否在线。' },
                { name: 'network.onOnline(callback)', description: '监听渲染进程 online 事件。' },
                { name: 'network.onOffline(callback)', description: '监听渲染进程 offline 事件。' },
            ],
        },
    ], [])

    const apiExamples: ApiExample[] = useMemo(() => [
        {
            title: '完整 HTTP 请求',
            code: `const response = await window.mulby.http.request({
  url: 'https://api.example.com/data',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: { key: 'value' },
  timeout: 5000
})

console.log(response.status, response.data)`,
        },
        {
            title: '快捷请求方法',
            code: `const users = await window.mulby.http.get('https://api.example.com/users')

await window.mulby.http.post(
  'https://api.example.com/users',
  { name: 'Mulby' },
  { 'Content-Type': 'application/json' }
)

await window.mulby.http.delete('https://api.example.com/users/1')`,
        },
        {
            title: '网络状态监听',
            code: `const online = await window.mulby.network.isOnline()
console.log('online:', online)

window.mulby.network.onOnline(() => {
  console.log('network restored')
})

window.mulby.network.onOffline(() => {
  console.log('network disconnected')
})`,
        },
    ], [])

    const rawData = useMemo(() => {
        const parsedHeaders = parseJsonObject(headers)

        return {
            network: {
                isOnline,
                events: networkEvents,
            },
            requestForm: {
                url,
                method,
                timeoutMs,
                headers: parsedHeaders.error ? { parseError: parsedHeaders.error } : redactHeaders(parsedHeaders.value),
                body: shouldSendBody(method) ? parseBody(body) : undefined,
            },
            lastRequest,
            responseTime,
            response: summarizeResponse(response),
            error: requestError,
        }
    }, [body, headers, isOnline, lastRequest, method, networkEvents, requestError, response, responseTime, timeoutMs, url])

    return (
        <div className="main-content">
            <PageHeader
                icon={Network}
                title="网络与 HTTP"
                description="HTTP 请求测试和网络状态监控"
                actions={<Button variant="secondary" onClick={checkOnline}><RefreshCw aria-hidden="true" size={14} />刷新状态</Button>}
            />
            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-icon">
                                {isOnline ? <Wifi aria-hidden="true" size={24} /> : <WifiOff aria-hidden="true" size={24} />}
                            </div>
                            <div className="stat-value">{isOnline === null ? '检测中' : isOnline ? '在线' : '离线'}</div>
                            <div className="stat-label">网络状态</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Activity aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{response?.status ?? '-'}</div>
                            <div className="stat-label">最近状态码</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <Clock aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{responseTime === null ? '-' : `${responseTime} ms`}</div>
                            <div className="stat-label">请求耗时</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-icon">
                                <History aria-hidden="true" size={24} />
                            </div>
                            <div className="stat-value">{networkEvents.length}</div>
                            <div className="stat-label">状态事件</div>
                        </div>
                    </div>

                    <Card title="网络状态" icon={Radio}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-lg)', flexWrap: 'wrap' }}>
                            <StatusBadge status={isOnline ? 'success' : isOnline === false ? 'error' : 'info'}>
                                {isOnline === null ? '检测中' : isOnline ? '在线' : '离线'}
                            </StatusBadge>
                        </div>
                    </Card>

                    <Card title="快速测试" icon={Zap}>
                        <div className="action-bar">
                            <Button variant="secondary" onClick={() => void handleQuickTest('get')} loading={loading && method === 'GET'}>
                                <Download aria-hidden="true" size={14} />GET
                            </Button>
                            <Button variant="secondary" onClick={() => void handleQuickTest('post')} loading={loading && method === 'POST'}>
                                <Send aria-hidden="true" size={14} />POST
                            </Button>
                            <Button variant="secondary" onClick={() => void handleQuickTest('put')} loading={loading && method === 'PUT'}>
                                <Send aria-hidden="true" size={14} />PUT
                            </Button>
                            <Button variant="secondary" onClick={() => void handleQuickTest('delete')} loading={loading && method === 'DELETE'}>
                                <AlertTriangle aria-hidden="true" size={14} />DELETE
                            </Button>
                            <Button variant="secondary" onClick={() => void handleQuickTest('patch')} loading={loading && method === 'PATCH'}>
                                <PenLine aria-hidden="true" size={14} />PATCH
                            </Button>
                            <Button variant="secondary" onClick={() => void handleQuickTest('head')} loading={loading && method === 'HEAD'}>
                                <Globe2 aria-hidden="true" size={14} />HEAD
                            </Button>
                        </div>
                    </Card>

                    <Card title="自定义请求" icon={PenLine}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                            <div className="input-row" style={{ alignItems: 'center' }}>
                                <select
                                    className="select"
                                    value={method}
                                    onChange={(event) => setMethod(event.target.value as HttpMethod)}
                                    style={{ width: 110 }}
                                >
                                    {METHODS.map(item => (
                                        <option value={item} key={item}>{item}</option>
                                    ))}
                                </select>
                                <input
                                    className="input"
                                    type="text"
                                    value={url}
                                    onChange={(event) => setUrl(event.target.value)}
                                    placeholder="输入 URL"
                                />
                                <Button onClick={handleRequest} loading={loading}><Send aria-hidden="true" size={14} />发送</Button>
                            </div>

                            <div className="input-row">
                                <div className="input-group" style={{ width: 160 }}>
                                    <label className="input-label">超时毫秒</label>
                                    <input
                                        className="input"
                                        type="number"
                                        min={1000}
                                        step={1000}
                                        value={timeoutMs}
                                        onChange={(event) => setTimeoutMs(Math.max(1000, Number(event.target.value) || 30000))}
                                    />
                                </div>
                            </div>

                            {shouldSendBody(method) && (
                                <div className="input-group">
                                    <label className="input-label">请求体 (JSON 或文本)</label>
                                    <textarea
                                        className="textarea"
                                        value={body}
                                        onChange={(event) => setBody(event.target.value)}
                                        rows={4}
                                        style={{ fontFamily: 'monospace', fontSize: '12px' }}
                                    />
                                </div>
                            )}

                            <div className="input-group">
                                <label className="input-label">请求头 (JSON 对象)</label>
                                <textarea
                                    className="textarea"
                                    value={headers}
                                    onChange={(event) => setHeaders(event.target.value)}
                                    rows={3}
                                    style={{ fontFamily: 'monospace', fontSize: '12px' }}
                                />
                            </div>
                        </div>
                    </Card>

                    {requestError && (
                        <Card title="请求错误" icon={AlertTriangle}>
                            <StatusBadge status="error">{requestError}</StatusBadge>
                        </Card>
                    )}

                    {response && (
                        <Card
                            title="响应结果"
                            icon={Download}
                            actions={
                                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
                                    {responseTime !== null && (
                                        <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                            {responseTime} ms
                                        </span>
                                    )}
                                    <StatusBadge status={response.status < 400 ? 'success' : 'error'}>
                                        {response.status} {response.statusText || 'HTTP'}
                                    </StatusBadge>
                                </div>
                            }
                        >
                            <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                <div className="input-label" style={{ marginBottom: 'var(--spacing-xs)' }}>响应头</div>
                                <CodeBlock>{JSON.stringify(response.headers, null, 2)}</CodeBlock>
                            </div>
                            <div>
                                <div className="input-label" style={{ marginBottom: 'var(--spacing-xs)' }}>响应体</div>
                                <CodeBlock>{responseBodyPreview || '[空响应体]'}</CodeBlock>
                            </div>
                        </Card>
                    )}

                    {networkEvents.length > 0 && (
                        <Card title="网络事件" icon={History}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {networkEvents.map(event => (
                                    <div className="list-row" key={`${event.timestamp}-${event.type}`}>
                                        <StatusBadge status={event.online ? 'success' : 'error'}>
                                            {event.type === 'checked' ? '检测' : event.type === 'online' ? '恢复' : '断开'}
                                        </StatusBadge>
                                        <div className="list-row-main">{event.online ? 'online' : 'offline'}</div>
                                        <div className="list-row-meta">{new Date(event.timestamp).toLocaleTimeString()}</div>
                                    </div>
                                ))}
                            </div>
                        </Card>
                    )}
                </div>

                <ApiReferencePanel apiGroups={apiGroups} examples={apiExamples} rawData={rawData} />
            </div>
        </div>
    )
}
