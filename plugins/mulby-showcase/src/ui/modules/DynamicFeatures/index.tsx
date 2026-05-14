import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    BadgeInfo,
    FileJson,
    List,
    ListChecks,
    Plus,
    PlugZap,
    RefreshCw,
    RotateCcw,
    Trash2,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'
import { confirmDialog } from '../../utils/dialogs'

type DynamicFeatureMode = 'ui' | 'silent' | 'detached'
type DynamicFeatureCmd =
    | string
    | { type: 'keyword'; value: string; explain?: string }
    | { type: 'regex'; match: string; explain?: string; label?: string; minLength?: number; maxLength?: number }
    | { type: 'files'; label?: string; exts?: string[]; fileType?: 'file' | 'directory' | 'any'; match?: string; minLength?: number; maxLength?: number }
    | { type: 'img'; label?: string; exts?: string[] }
    | { type: 'over'; label?: string; exclude?: string; minLength?: number; maxLength?: number }

type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type LoadingAction = 'refresh' | 'set' | 'remove' | 'reset' | null

interface DynamicFeatureRecord {
    code: string
    explain: string
    icon?: string
    platform?: string | string[]
    mode?: DynamicFeatureMode
    route?: string
    mainHide?: boolean
    mainPush?: boolean
    cmds: DynamicFeatureCmd[]
}

interface SetDynamicFeatureInput {
    code?: string
    explain?: string
    keyword?: string
    regex?: string
    mode?: DynamicFeatureMode
    route?: string
    mainHide?: boolean
    mainPush?: boolean
}

interface SetDynamicFeatureResult {
    success: boolean
    feature: DynamicFeatureRecord
    updatedAt: string
}

interface RemoveDynamicFeatureResult {
    success: boolean
    code: string
    removedAt: string
}

interface ResetDynamicFeatureResult {
    success: boolean
    features: DynamicFeatureRecord[]
    resetAt: string
}

interface HostCallResponse<T> {
    success: boolean
    data: T
    error?: string
}

interface ShowcaseHost {
    call<T>(method: string, ...args: unknown[]): Promise<HostCallResponse<T>>
}

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'
const MAIN_PUSH_CODE = 'showcase:main-push'
const DEFAULT_DYNAMIC_CODE = 'showcase:dynamic-demo'

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Backend Dynamic Features API',
        items: [
            { name: 'features.getFeatures(codes?)', description: '读取当前插件注册的动态指令，可按 code 过滤。' },
            { name: 'features.setFeature(feature)', description: '新增或覆盖当前插件自己的动态指令。' },
            { name: 'features.removeFeature(code)', description: '删除当前插件名下指定动态指令。' },
            { name: 'features.onMainPush(callback)', description: '注册搜索框推送回调，匹配 mainPush feature 时返回额外候选项。' },
            { name: 'features.onMainPushSelect(callback)', description: '处理用户选中 MainPush 候选项后的动作。' },
        ],
    },
    {
        title: 'Host RPC Bridge',
        items: [
            { name: 'host.call("listShowcaseDynamicFeatures")', description: 'UI 通过后端读取动态指令列表。' },
            { name: 'host.call("setShowcaseDynamicFeature", input)', description: 'UI 请求后端创建或更新动态指令。' },
            { name: 'host.call("removeShowcaseDynamicFeature", input)', description: 'UI 请求后端删除指定动态指令。' },
            { name: 'host.call("resetShowcaseDynamicFeatures")', description: '清理并重新注册 showcase 的动态指令示例。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '后端注册动态指令',
        code: `function registerDynamicFeatures(features) {
  features.setFeature({
    code: 'showcase:dynamic-demo',
    explain: '动态指令示例',
    mode: 'ui',
    route: 'features',
    cmds: [
      { type: 'keyword', value: 'showcase dynamic' },
      { type: 'regex', match: '^showcase\\\\s+feature\\\\s+.+' }
    ]
  })
}`,
    },
    {
        title: 'UI 通过 Host RPC 维护指令',
        code: `const { host } = useMulby('@mulby/showcase')

const result = await host.call('setShowcaseDynamicFeature', {
  code: 'showcase:dynamic-demo',
  keyword: 'showcase dynamic',
  mode: 'ui',
  route: 'features'
})`,
    },
    {
        title: 'MainPush 搜索推送',
        code: `features.setFeature({
  code: 'showcase:main-push',
  explain: 'MainPush 搜索推送',
  mode: 'silent',
  mainPush: true,
  cmds: [{ type: 'over', label: 'Showcase MainPush', minLength: 1 }]
})

features.onMainPush(async (action) => [{
  title: action.payload,
  text: '候选项说明',
  value: action.payload
}])

features.onMainPushSelect(async (action) => {
  await mulby.clipboard.writeText(String(action.option.value || ''))
  return false
})`,
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

function operationLabel(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

function modeLabel(mode?: DynamicFeatureMode) {
    if (mode === 'silent') return '后台'
    if (mode === 'detached') return '独立窗口'
    return '附着 UI'
}

function modeStatus(mode?: DynamicFeatureMode): OperationStatus {
    if (mode === 'silent') return 'info'
    if (mode === 'detached') return 'warning'
    return 'success'
}

function cmdLabel(cmd: DynamicFeatureCmd) {
    if (typeof cmd === 'string') return `keyword:${cmd}`
    if (cmd.type === 'keyword') return `keyword:${cmd.value}`
    if (cmd.type === 'regex') return `regex:${cmd.match}`
    if (cmd.type === 'files') return `files:${cmd.label || cmd.match || cmd.exts?.join(',') || cmd.fileType || 'any'}`
    if (cmd.type === 'img') return `img:${cmd.label || cmd.exts?.join(',') || 'image'}`
    return `over:${cmd.label || 'text'}`
}

function summarizeCmds(cmds: DynamicFeatureCmd[]) {
    return cmds.map(cmd => {
        if (typeof cmd === 'string') return { type: 'keyword', value: cmd }
        return cmd
    })
}

function normalizeFeatureForRawData(feature: DynamicFeatureRecord | null) {
    if (!feature) return null
    return {
        ...feature,
        cmds: summarizeCmds(feature.cmds),
    }
}

export function DynamicFeaturesModule() {
    const { host, dialog } = useMulby(SHOWCASE_PLUGIN_ID)
    const showcaseHost = host as unknown as ShowcaseHost
    const notify = useNotification()

    const [features, setFeatures] = useState<DynamicFeatureRecord[]>([])
    const [selectedCode, setSelectedCode] = useState(DEFAULT_DYNAMIC_CODE)
    const [code, setCode] = useState(DEFAULT_DYNAMIC_CODE)
    const [explain, setExplain] = useState('动态指令：页面创建的示例')
    const [keyword, setKeyword] = useState('showcase dynamic')
    const [regex, setRegex] = useState('^showcase\\s+feature\\s+.+')
    const [mode, setMode] = useState<DynamicFeatureMode>('ui')
    const [route, setRoute] = useState('features')
    const [mainHide, setMainHide] = useState(false)
    const [mainPush, setMainPush] = useState(false)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
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

    const selectedFeature = useMemo(() => (
        features.find(feature => feature.code === selectedCode) || features[0] || null
    ), [features, selectedCode])

    const refreshFeatures = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!options.silent) setLoadingAction('refresh')
        try {
            const list = await callShowcaseHost<DynamicFeatureRecord[]>('listShowcaseDynamicFeatures')
            setFeatures(list)
            setSelectedCode(current => (list.some(feature => feature.code === current) ? current : list[0]?.code || DEFAULT_DYNAMIC_CODE))
            if (!options.silent) {
                pushOperation({
                    action: 'host.call listShowcaseDynamicFeatures',
                    status: 'success',
                    message: `已读取 ${list.length} 条动态指令`,
                })
            }
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call listShowcaseDynamicFeatures', status: 'error', message })
            if (!options.silent) notify.error(`读取动态指令失败: ${message}`)
        } finally {
            if (!options.silent) setLoadingAction(null)
        }
    }, [callShowcaseHost, notify, pushOperation])

    useEffect(() => {
        void refreshFeatures({ silent: true })
    }, [refreshFeatures])

    const setFeature = useCallback(async () => {
        setLoadingAction('set')
        try {
            const input: SetDynamicFeatureInput = {
                code,
                explain,
                keyword,
                regex,
                mode,
                route,
                mainHide,
                mainPush,
            }
            const result = await callShowcaseHost<SetDynamicFeatureResult>('setShowcaseDynamicFeature', input)
            setSelectedCode(result.feature.code)
            pushOperation({
                action: 'host.call setShowcaseDynamicFeature',
                status: 'success',
                message: `已更新 ${result.feature.code}`,
                details: result,
            })
            notify.success('动态指令已更新')
            await refreshFeatures({ silent: true })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call setShowcaseDynamicFeature', status: 'error', message })
            notify.error(`更新动态指令失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, code, explain, keyword, mainHide, mainPush, mode, notify, pushOperation, refreshFeatures, regex, route])

    const removeFeature = useCallback(async (targetCode: string) => {
        const confirmed = await confirmDialog(dialog, {
            title: '删除动态指令',
            message: `确定删除动态指令 ${targetCode} 吗？`,
            confirmLabel: '删除',
        })
        if (!confirmed) return
        setLoadingAction('remove')
        try {
            const result = await callShowcaseHost<RemoveDynamicFeatureResult>('removeShowcaseDynamicFeature', { code: targetCode })
            pushOperation({
                action: 'host.call removeShowcaseDynamicFeature',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `已删除 ${result.code}` : `未找到 ${result.code}`,
                details: result,
            })
            if (result.success) notify.success('动态指令已删除')
            await refreshFeatures({ silent: true })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call removeShowcaseDynamicFeature', status: 'error', message })
            notify.error(`删除动态指令失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, dialog, notify, pushOperation, refreshFeatures])

    const resetFeatures = useCallback(async () => {
        const confirmed = await confirmDialog(dialog, {
            title: '重置动态指令',
            message: '确定重置 showcase 动态指令示例吗？',
            confirmLabel: '重置',
        })
        if (!confirmed) return
        setLoadingAction('reset')
        try {
            const result = await callShowcaseHost<ResetDynamicFeatureResult>('resetShowcaseDynamicFeatures')
            setFeatures(result.features)
            setSelectedCode(result.features[0]?.code || DEFAULT_DYNAMIC_CODE)
            pushOperation({
                action: 'host.call resetShowcaseDynamicFeatures',
                status: 'success',
                message: `已重新注册 ${result.features.length} 条动态指令`,
                details: result,
            })
            notify.success('动态指令已重置')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call resetShowcaseDynamicFeatures', status: 'error', message })
            notify.error(`重置动态指令失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, dialog, notify, pushOperation])

    const loadSelectedIntoForm = useCallback(() => {
        if (!selectedFeature) return
        const firstKeyword = selectedFeature.cmds.find(cmd => (
            typeof cmd === 'string' || (typeof cmd === 'object' && cmd.type === 'keyword')
        ))
        const firstRegex = selectedFeature.cmds.find(cmd => typeof cmd === 'object' && cmd.type === 'regex')

        setCode(selectedFeature.code)
        setExplain(selectedFeature.explain)
        setKeyword(typeof firstKeyword === 'string' ? firstKeyword : firstKeyword?.type === 'keyword' ? firstKeyword.value : 'showcase dynamic')
        setRegex(typeof firstRegex === 'object' && firstRegex.type === 'regex' ? firstRegex.match : '')
        setMode(selectedFeature.mode || 'ui')
        setRoute(selectedFeature.route || 'features')
        setMainHide(Boolean(selectedFeature.mainHide))
        setMainPush(Boolean(selectedFeature.mainPush))
    }, [selectedFeature])

    const mainPushFeature = features.find(feature => feature.code === MAIN_PUSH_CODE)
    const dynamicFeatureCount = features.length
    const rawData = useMemo(() => ({
        features: features.map(normalizeFeatureForRawData),
        selectedFeature: normalizeFeatureForRawData(selectedFeature),
        form: {
            code,
            explain,
            keyword,
            regex,
            mode,
            route,
            mainHide,
            mainPush,
        },
        operationLog,
    }), [code, explain, features, keyword, mainHide, mainPush, mode, operationLog, regex, route, selectedFeature])

    return (
        <div className="main-content">
            <PageHeader
                icon={ListChecks}
                title="动态指令"
                description="在插件后台运行时注册、查询、删除动态指令，并演示 MainPush 搜索推送。"
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => void refreshFeatures()} loading={loadingAction === 'refresh'}>
                            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                            刷新
                        </Button>
                        <Button variant="secondary" onClick={() => void resetFeatures()} loading={loadingAction === 'reset'}>
                            <RotateCcw className="inline-icon" aria-hidden="true" size={14} />
                            重置示例
                        </Button>
                    </>
                )}
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-value">{dynamicFeatureCount}</div>
                            <div className="stat-label">动态指令</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{features.filter(feature => feature.mode === 'silent').length}</div>
                            <div className="stat-label">后台指令</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">
                                <StatusBadge status={mainPushFeature ? 'success' : 'warning'}>
                                    {mainPushFeature ? '已注册' : '未注册'}
                                </StatusBadge>
                            </div>
                            <div className="stat-label">MainPush</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{selectedFeature?.code || 'N/A'}</div>
                            <div className="stat-label">选中指令</div>
                        </div>
                    </div>

                    <div className="grid grid-2">
                        <Card
                            title="创建或更新"
                            icon={Plus}
                            actions={(
                                <Button onClick={() => void setFeature()} loading={loadingAction === 'set'}>
                                    <PlugZap className="inline-icon" aria-hidden="true" size={14} />
                                    写入
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="dynamic-feature-code">Code</label>
                                    <input id="dynamic-feature-code" className="input" value={code} onChange={event => setCode(event.target.value)} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="dynamic-feature-explain">说明</label>
                                    <input id="dynamic-feature-explain" className="input" value={explain} onChange={event => setExplain(event.target.value)} />
                                </div>
                                <div className="input-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div className="input-group" style={{ flex: '1 1 180px' }}>
                                        <label className="input-label" htmlFor="dynamic-feature-keyword">Keyword</label>
                                        <input id="dynamic-feature-keyword" className="input" value={keyword} onChange={event => setKeyword(event.target.value)} />
                                    </div>
                                    <div className="input-group" style={{ flex: '1 1 180px' }}>
                                        <label className="input-label" htmlFor="dynamic-feature-regex">Regex</label>
                                        <input id="dynamic-feature-regex" className="input" value={regex} onChange={event => setRegex(event.target.value)} />
                                    </div>
                                </div>
                                <div className="input-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div className="input-group" style={{ width: 150 }}>
                                        <label className="input-label" htmlFor="dynamic-feature-mode">模式</label>
                                        <select id="dynamic-feature-mode" className="select" value={mode} onChange={event => setMode(event.target.value as DynamicFeatureMode)}>
                                            <option value="ui">ui</option>
                                            <option value="silent">silent</option>
                                            <option value="detached">detached</option>
                                        </select>
                                    </div>
                                    <div className="input-group" style={{ flex: '1 1 180px' }}>
                                        <label className="input-label" htmlFor="dynamic-feature-route">Route</label>
                                        <input id="dynamic-feature-route" className="input" value={route} onChange={event => setRoute(event.target.value)} />
                                    </div>
                                </div>
                                <div className="input-row" style={{ flexWrap: 'wrap' }}>
                                    <label className="list-row" style={{ cursor: 'pointer' }}>
                                        <input type="checkbox" checked={mainHide} onChange={event => setMainHide(event.target.checked)} />
                                        <span className="list-row-main">mainHide</span>
                                    </label>
                                    <label className="list-row" style={{ cursor: 'pointer' }}>
                                        <input type="checkbox" checked={mainPush} onChange={event => setMainPush(event.target.checked)} />
                                        <span className="list-row-main">mainPush</span>
                                    </label>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="已注册指令"
                            icon={ListChecks}
                            actions={selectedFeature ? (
                                <Button variant="secondary" onClick={loadSelectedIntoForm}>
                                    <FileJson className="inline-icon" aria-hidden="true" size={14} />
                                    载入表单
                                </Button>
                            ) : null}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {features.length > 0 ? features.map(feature => (
                                    <button
                                        type="button"
                                        className="list-row"
                                        key={feature.code}
                                        onClick={() => setSelectedCode(feature.code)}
                                        style={{
                                            border: feature.code === selectedFeature?.code ? '1px solid var(--accent)' : '1px solid transparent',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <StatusBadge status={modeStatus(feature.mode)}>{modeLabel(feature.mode)}</StatusBadge>
                                        <span className="list-row-main">{feature.code}</span>
                                        <span className="list-row-meta">{feature.mainPush ? 'MainPush' : feature.route || 'N/A'}</span>
                                    </button>
                                )) : (
                                    <div className="empty-state">
                                        <ListChecks aria-hidden="true" size={28} />
                                        <p>暂无动态指令，点击重置示例可重新注册</p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="指令详情"
                            icon={BadgeInfo}
                            actions={selectedFeature ? (
                                <Button variant="secondary" onClick={() => void removeFeature(selectedFeature.code)} loading={loadingAction === 'remove'}>
                                    <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                    删除
                                </Button>
                            ) : null}
                        >
                            {selectedFeature ? (
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    <div className="info-grid">
                                        <span className="info-label">Code</span>
                                        <span className="info-value">{selectedFeature.code}</span>
                                        <span className="info-label">说明</span>
                                        <span className="info-value">{selectedFeature.explain}</span>
                                        <span className="info-label">模式</span>
                                        <span className="info-value">{modeLabel(selectedFeature.mode)}</span>
                                        <span className="info-label">Route</span>
                                        <span className="info-value">{selectedFeature.route || 'N/A'}</span>
                                        <span className="info-label">mainHide</span>
                                        <span className="info-value">{selectedFeature.mainHide ? 'true' : 'false'}</span>
                                        <span className="info-label">mainPush</span>
                                        <span className="info-value">{selectedFeature.mainPush ? 'true' : 'false'}</span>
                                    </div>
                                    <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                        {selectedFeature.cmds.map((cmd, index) => (
                                            <div className="list-row" key={`${selectedFeature.code}-${index}`}>
                                                <List className="inline-icon" aria-hidden="true" size={14} />
                                                <span className="list-row-main">{cmdLabel(cmd)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <BadgeInfo aria-hidden="true" size={28} />
                                    <p>请选择一个动态指令查看详情</p>
                                </div>
                            )}
                        </Card>

                        <Card title="MainPush 验证" icon={PlugZap}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                                    当前插件会在后台注册 <code>{MAIN_PUSH_CODE}</code>。在 Mulby 主搜索框输入任意文本，匹配到该指令后，宿主会调用后台的 MainPush 回调并展示可复制候选项。
                                </p>
                                <div className="info-grid">
                                    <span className="info-label">Feature</span>
                                    <span className="info-value">{MAIN_PUSH_CODE}</span>
                                    <span className="info-label">触发类型</span>
                                    <span className="info-value">over</span>
                                    <span className="info-label">选择行为</span>
                                    <span className="info-value">复制候选值到剪贴板，不打开 UI</span>
                                </div>
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
