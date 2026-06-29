import { useCallback, useMemo, useState } from 'react'
import {
    Activity,
    AlertTriangle,
    Bug,
    CircleX,
    Globe2,
    Info,
    List,
    Network,
    Send,
    Server,
    Terminal,
    TriangleAlert,
    WandSparkles,
    Zap,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, CodeBlock, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'

type OperationStatus = 'success' | 'error' | 'info' | 'warning'

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
}

interface ShowcaseHost {
    call<T>(method: string, ...args: unknown[]): Promise<{ success: boolean; data: T; error?: string }>
}

interface BackendLogResult {
    ok: boolean
    pluginId: string
    levels: string[]
    at: string
}

interface BackendNetworkProbeItem {
    via: 'mulby.http' | 'backend-fetch' | 'backend-http'
    url: string
    status?: number
    ok: boolean
    durationMs: number
    error?: string
}

interface BackendNetworkProbeResult {
    ok: boolean
    pluginId: string
    url: string
    results: BackendNetworkProbeItem[]
    at: string
}

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'
const PROBE_URL = 'https://httpbin.org/get'
const FAIL_URL = 'https://httpbin.org/status/404'

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
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

const apiGroups: ApiReferenceGroup[] = [
    {
        title: '控制台日志',
        items: [
            { name: 'console.log / info / warn / error / debug', description: '前端（渲染进程）日志直接出现在插件 DevTools 控制台。' },
            { name: '后端 console.*', description: '插件后端（main.js / utilityProcess）的 console 输出会被回灌到插件 DevTools，前缀 [plugin-backend]，无需查看宿主日志。' },
        ],
    },
    {
        title: '网络可观测性（开发者模式）',
        items: [
            { name: 'window.mulby.http.*', description: '主进程发出的请求，在控制台以 [network:mulby.http] 分组呈现。' },
            { name: 'window.mulby.ai.call', description: 'AI 调用，在控制台以 [network:mulby.ai] 分组呈现（需先配置模型）。' },
            { name: '后端 fetch / http(s)', description: '后端第三方库 / 原生 fetch 的请求以 [network:backend-fetch] / [network:backend-http] 呈现。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '前提：开启开发者模式',
        code: `设置 → 开发者：
1) 打开「开发者模式」
2) 打开「打开插件窗口时自动打开 DevTools」
然后切到 DevTools 的 Console 标签。`,
    },
    {
        title: '前端日志（直接出现在控制台）',
        code: `console.log('普通日志', { a: 1 })
console.warn('警告')
console.error('错误', new Error('demo'))`,
    },
    {
        title: '网络请求（控制台分组）',
        code: `// [network:mulby.http] GET ... → 200 (xx ms)
await window.mulby.http.get('https://httpbin.org/get')

// 后端 main.js 里：
await mulby.http.get(url)        // [network:mulby.http]
await fetch(url)                 // [network:backend-fetch]
require('node:https').get(url)   // [network:backend-http]`,
    },
]

export function DevtoolsModule() {
    const { http, ai, host } = useMulby(SHOWCASE_PLUGIN_ID)
    const showcaseHost = host as unknown as ShowcaseHost
    const notify = useNotification()

    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    const [lastProbe, setLastProbe] = useState<BackendNetworkProbeResult | null>(null)

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [{ ...item, timestamp: Date.now() }, ...current].slice(0, 20))
    }, [])

    // ---- 前端控制台日志 ----
    const emitRendererConsole = useCallback(() => {
        const ts = new Date().toISOString()
        console.debug('[showcase] console.debug —— 调试级日志', { ts })
        console.log('[showcase] console.log —— 普通日志', { sample: true, ts })
        console.info('[showcase] console.info —— 信息级日志')
        console.warn('[showcase] console.warn —— 警告级日志')
        console.error('[showcase] console.error —— 错误级日志', new Error('演示错误（可忽略）'))
        // eslint-disable-next-line no-console
        console.group('[showcase] console.group —— 分组日志')
        console.log('分组内子项 1')
        console.log('分组内子项 2', { nested: { ok: true } })
        // eslint-disable-next-line no-console
        console.groupEnd()
        // eslint-disable-next-line no-console
        console.table?.([{ name: 'a', value: 1 }, { name: 'b', value: 2 }])
        pushOperation({ action: 'console.* (前端)', status: 'success', message: '已输出 debug/log/info/warn/error/group/table，见 DevTools 控制台' })
        notify.success('已输出前端控制台日志，请查看 DevTools Console')
    }, [notify, pushOperation])

    // ---- 后端控制台日志 ----
    const emitBackendConsole = useCallback(async () => {
        setLoadingAction('backend-log')
        try {
            const result = await showcaseHost.call<BackendLogResult>('emitBackendLogs', {
                message: 'Mulby Showcase 后端日志测试',
            })
            if (!result.success) throw new Error(result.error || '后端日志调用失败')
            pushOperation({
                action: 'host.call emitBackendLogs',
                status: 'success',
                message: '后端已输出日志，应在控制台以 [plugin-backend] 前缀出现',
            })
            notify.success('后端日志已触发，请查看 DevTools Console 的 [plugin-backend] 行')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call emitBackendLogs', status: 'error', message })
            notify.error(`后端日志触发失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, showcaseHost])

    // ---- 前端网络（mulby.http）----
    const runRendererHttp = useCallback(async (mode: 'ok' | 'fail') => {
        const action = mode === 'ok' ? 'http-get' : 'http-fail'
        setLoadingAction(action)
        const url = mode === 'ok' ? PROBE_URL : FAIL_URL
        console.info(`[showcase] 触发 mulby.http.get(${url})，请在控制台查看 [network:mulby.http] 分组`)
        try {
            const res = await http.get(url)
            pushOperation({
                action: 'mulby.http.get (前端)',
                status: res.status < 400 ? 'success' : 'warning',
                message: `${url} → ${res.status}（控制台见 [network:mulby.http]）`,
            })
            notify.success(`请求完成: ${res.status}`)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'mulby.http.get (前端)', status: 'error', message })
            notify.error(`请求失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [http, notify, pushOperation])

    // ---- 前端网络（mulby.ai）----
    const runRendererAi = useCallback(async () => {
        setLoadingAction('ai')
        console.info('[showcase] 触发 mulby.ai.call，请在控制台查看 [network:mulby.ai] 分组')
        try {
            const message = await ai.call({
                messages: [{ role: 'user', content: '用一句话介绍 Mulby。' }],
            })
            const text = typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '')
            pushOperation({
                action: 'mulby.ai.call (前端)',
                status: 'success',
                message: `AI 返回 ${text.length} 字（控制台见 [network:mulby.ai]）`,
            })
            notify.success('AI 调用完成，请查看控制台')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'mulby.ai.call (前端)', status: 'error', message: `${message}（需先在设置中配置 AI 模型）` })
            notify.warning(`AI 调用失败（多为未配置模型）: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [ai, notify, pushOperation])

    // ---- 后端网络探测（mulby.http + fetch + https）----
    const runBackendNetwork = useCallback(async () => {
        setLoadingAction('backend-net')
        console.info('[showcase] 触发后端网络探测，请在控制台查看 [network:mulby.http] / [network:backend-fetch] / [network:backend-http]')
        try {
            const result = await showcaseHost.call<BackendNetworkProbeResult>('backendNetworkProbe', { url: PROBE_URL })
            if (!result.success) throw new Error(result.error || '后端网络探测失败')
            setLastProbe(result.data)
            const okCount = result.data.results.filter(item => item.ok).length
            pushOperation({
                action: 'host.call backendNetworkProbe',
                status: okCount === result.data.results.length ? 'success' : 'warning',
                message: `后端发起 ${result.data.results.length} 个请求，${okCount} 个成功（控制台见三种 [network:*]）`,
            })
            notify.success('后端网络探测完成，请查看 DevTools Console')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call backendNetworkProbe', status: 'error', message })
            notify.error(`后端网络探测失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, showcaseHost])

    const rawData = useMemo(() => ({
        prerequisite: '设置 → 开发者：开启「开发者模式」与「打开插件窗口时自动打开 DevTools」',
        consoleTab: '在插件 DevTools 的 Console 标签查看输出',
        expected: {
            前端日志: 'console.* 直接出现',
            后端日志: '[plugin-backend] 前缀',
            'mulby.http': '[network:mulby.http] 分组',
            'mulby.ai': '[network:mulby.ai] 分组',
            后端fetch: '[network:backend-fetch] 分组',
            后端https: '[network:backend-http] 分组',
        },
        lastProbe,
        operationLog,
    }), [lastProbe, operationLog])

    return (
        <div className="main-content">
            <PageHeader
                icon={Bug}
                title="DevTools 排查"
                description="在插件 DevTools 控制台直接排查日志与网络，无需翻看宿主日志。"
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <Card title="前提条件" icon={Info}>
                        <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                            <StatusBadge status="info">
                                设置 → 开发者：开启「开发者模式」+「打开插件窗口时自动打开 DevTools」
                            </StatusBadge>
                            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                                打开后切到 DevTools 的 <strong>Console</strong> 标签，再点击下面的按钮，对照「期望输出」核对。
                                网络分组仅在开发者模式下注入；前端 console 始终可见。
                            </div>
                        </div>
                    </Card>

                    <Card title="控制台日志" icon={Terminal}>
                        <div className="action-bar">
                            <Button onClick={emitRendererConsole}>
                                <Terminal aria-hidden="true" size={14} />前端日志（各级）
                            </Button>
                            <Button variant="secondary" onClick={() => void emitBackendConsole()} loading={loadingAction === 'backend-log'}>
                                <Server aria-hidden="true" size={14} />后端日志（[plugin-backend]）
                            </Button>
                        </div>
                        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            前端日志直接出现在控制台；后端日志来自 utilityProcess，被回灌为 <code>[plugin-backend]</code> 行——这正是「不用看宿主日志」的关键。
                        </div>
                    </Card>

                    <Card title="网络请求（前端 / 主进程）" icon={Network}>
                        <div className="action-bar">
                            <Button variant="secondary" onClick={() => void runRendererHttp('ok')} loading={loadingAction === 'http-get'}>
                                <Send aria-hidden="true" size={14} />mulby.http GET
                            </Button>
                            <Button variant="secondary" onClick={() => void runRendererHttp('fail')} loading={loadingAction === 'http-fail'}>
                                <AlertTriangle aria-hidden="true" size={14} />mulby.http 失败 (404)
                            </Button>
                            <Button variant="secondary" onClick={() => void runRendererAi()} loading={loadingAction === 'ai'}>
                                <WandSparkles aria-hidden="true" size={14} />mulby.ai 调用
                            </Button>
                        </div>
                        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            控制台会出现 <code>[network:mulby.http]</code> / <code>[network:mulby.ai]</code> 分组（含方法、URL、状态码、耗时、请求/响应头）。
                            失败请求显示红色 <code>→ ERR</code> 或 4xx。AI 调用需先在设置中配置模型。
                        </div>
                    </Card>

                    <Card title="网络请求（后端 / utilityProcess）" icon={Globe2}>
                        <div className="action-bar">
                            <Button onClick={() => void runBackendNetwork()} loading={loadingAction === 'backend-net'}>
                                <Zap aria-hidden="true" size={14} />后端综合网络探测
                            </Button>
                        </div>
                        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                            后端会依次发起 <code>mulby.http.get</code>、原生 <code>fetch</code>、<code>node:https.get</code>，
                            对应控制台 <code>[network:mulby.http]</code>、<code>[network:backend-fetch]</code>、<code>[network:backend-http]</code> 三种分组。
                        </div>
                        {lastProbe && (
                            <div style={{ marginTop: 'var(--spacing-md)' }}>
                                <div className="input-label" style={{ marginBottom: 'var(--spacing-xs)' }}>后端探测结果</div>
                                <CodeBlock>{JSON.stringify(lastProbe, null, 2)}</CodeBlock>
                            </div>
                        )}
                    </Card>

                    <Card title="期望输出对照" icon={Activity}>
                        <CodeBlock>{`前端 console.*        →  直接出现在控制台
后端 console.*        →  [plugin-backend] ...
window.mulby.http     →  [network:mulby.http] GET <url> → 200 (xx ms)
window.mulby.ai.call  →  [network:mulby.ai] call model:... → OK
后端 fetch            →  [network:backend-fetch] GET <url> → 200
后端 node:https.get   →  [network:backend-http] GET <url> → 200`}</CodeBlock>
                    </Card>

                    <Card title="最近操作" icon={List}>
                        <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                            {operationLog.length > 0 ? operationLog.map((item, index) => {
                                const Icon = item.status === 'error' ? CircleX : item.status === 'warning' ? TriangleAlert : Info
                                return (
                                    <div className="list-row" key={`${item.timestamp}-${index}`}>
                                        <StatusBadge status={item.status}>{operationLabel(item.status)}</StatusBadge>
                                        <span className="list-row-main">
                                            <Icon aria-hidden="true" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                                            {item.action}
                                        </span>
                                        <span className="list-row-meta">{item.message}</span>
                                        <span className="list-row-meta">{formatTime(item.timestamp)}</span>
                                    </div>
                                )
                            }) : (
                                <div className="empty-state">
                                    <Bug aria-hidden="true" size={28} />
                                    <p>点击上方按钮后，操作记录会显示在这里；详细输出请看 DevTools 控制台</p>
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
