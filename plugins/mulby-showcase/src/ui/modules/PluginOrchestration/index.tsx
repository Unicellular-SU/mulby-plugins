import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Activity,
    BadgeInfo,
    Bell,
    BookOpen,
    Boxes,
    CircleStop,
    ExternalLink,
    Gauge,
    Keyboard,
    List,
    PauseCircle,
    Pin,
    Play,
    PlugZap,
    Puzzle,
    RefreshCw,
    Rocket,
    Search,
    ShieldCheck,
    Star,
    Trash2,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'
import { confirmDialog } from '../../utils/dialogs'

type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type LoadingAction =
    | 'refresh'
    | 'search'
    | 'run'
    | 'command'
    | 'redirect'
    | 'recent'
    | 'preferences'
    | 'shortcut'
    | 'command-state'
    | 'background'
    | 'readme'
    | 'main-push'
    | 'out'
    | null

interface OperationLogItem {
    action: string
    status: OperationStatus
    message: string
    timestamp: number
    details?: unknown
}

interface PluginLifecycleEventLog {
    type: 'init' | 'attach' | 'detached' | 'out' | 'launch-start' | 'launch-end'
    timestamp: number
    payload?: unknown
}

interface PluginAttachEvent {
    pluginName: string
    displayName: string
    featureCode: string
    input: string
    attachments?: Attachment[]
    mode: 'panel'
    launchRequestId?: string
}

const SHOWCASE_PLUGIN_ID = '@mulby/showcase'
const DEFAULT_SEARCH_QUERY = 'showcase'
const DEFAULT_ACCELERATOR = 'CommandOrControl+Shift+Y'

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Plugin Discovery',
        items: [
            { name: 'plugin.getAll()', description: '读取已加载插件、功能和基础元数据。' },
            { name: 'plugin.listCommands(pluginId?)', description: '读取功能指令和匹配指令清单。' },
            { name: 'plugin.search(query)', description: '按文本或输入 payload 搜索插件功能入口。' },
            { name: 'plugin.getRecentUsed(limit)', description: '读取最近使用的插件功能。' },
            { name: 'plugin.getReadme(pluginId)', description: '读取指定插件 README 文本。' },
        ],
    },
    {
        title: 'Plugin Launch And Routing',
        items: [
            { name: 'plugin.run(pluginId, featureCode, input)', description: '执行指定插件功能入口。' },
            { name: 'plugin.runCommand(input)', description: '按命令记录执行具体指令。' },
            { name: 'plugin.redirect(labelOrTuple, payload)', description: '从当前插件跳转到其他插件或指定功能。' },
            { name: 'plugin.outPlugin(false)', description: '退出当前插件窗口，页面以确认按钮演示。' },
            { name: 'plugin.prewarm(pluginId)', description: '预热插件 Host 进程，提升后续启动速度。' },
        ],
    },
    {
        title: 'Command State And Shortcuts',
        items: [
            { name: 'plugin.getSearchPreferences()', description: '读取搜索置顶、隐藏等偏好状态。' },
            { name: 'plugin.pinFeature(pluginId, featureCode)', description: '置顶指定插件功能。' },
            { name: 'plugin.unpinFeature(pluginId, featureCode)', description: '取消置顶指定插件功能。' },
            { name: 'plugin.hideFeature(pluginId, featureCode)', description: '隐藏指定插件功能。' },
            { name: 'plugin.unhideFeature(pluginId, featureCode)', description: '恢复隐藏的插件功能。' },
            { name: 'plugin.removeRecentUsage(pluginId, featureCode)', description: '移除指定功能的最近使用记录。' },
            { name: 'plugin.listCommandShortcuts(pluginId?)', description: '列出命令快捷键绑定。' },
            { name: 'plugin.validateCommandShortcut(accelerator, bindingId?)', description: '验证快捷键是否可绑定。' },
            { name: 'plugin.bindCommandShortcut(input)', description: '为可绑定命令创建快捷键绑定。' },
            { name: 'plugin.unbindCommandShortcut(bindingId)', description: '移除命令快捷键绑定。' },
            { name: 'plugin.setCommandDisabled(input)', description: '启用或禁用指定命令。' },
        ],
    },
    {
        title: 'Background And Events',
        items: [
            { name: 'plugin.listBackground()', description: '读取后台插件和活跃 Host 进程状态。' },
            { name: 'plugin.getBackgroundInfo(pluginId)', description: '读取指定后台插件详情。' },
            { name: 'plugin.startBackground(pluginId)', description: '手动启动插件后台进程。' },
            { name: 'plugin.stopBackground(pluginId)', description: '停止指定插件后台进程，页面以确认按钮演示。' },
            { name: 'onPluginInit(callback)', description: '监听当前插件窗口初始化 payload。' },
            { name: 'onPluginAttach(callback)', description: '监听主窗口附着插件事件。' },
            { name: 'onPluginDetached(callback)', description: '监听主窗口插件分离事件。' },
            { name: 'onPluginOut(callback)', description: '监听当前插件退出事件。' },
            { name: 'onPluginLaunchStart(callback)', description: '监听插件功能启动开始事件。' },
            { name: 'onPluginLaunchEnd(callback)', description: '监听插件功能启动结束事件。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '读取插件与指令',
        code: `const plugins = await window.mulby.plugin.getAll()
const commands = await window.mulby.plugin.listCommands('@mulby/showcase')
const results = await window.mulby.plugin.search('showcase')
const recent = await window.mulby.plugin.getRecentUsed(10)`,
    },
    {
        title: '运行功能与命令',
        code: `await window.mulby.plugin.run('@mulby/showcase', 'sysinfo', 'hello')

await window.mulby.plugin.runCommand({
  pluginId: '@mulby/showcase',
  featureCode: 'sysinfo',
  cmdId: command.cmdId,
  cmdSignature: command.cmdSignature,
  input: 'hello'
})`,
    },
    {
        title: '快捷键与命令状态',
        code: `const valid = await window.mulby.plugin.validateCommandShortcut(
  'CommandOrControl+Shift+Y'
)

if (valid.ok) {
  await window.mulby.plugin.bindCommandShortcut({
    pluginId,
    featureCode,
    cmdId,
    cmdSignature,
    commandLabel,
    accelerator
  })
}`,
    },
    {
        title: '生命周期事件',
        code: `const offStart = window.mulby.onPluginLaunchStart((event) => {
  console.log(event.pluginName, event.featureCode)
})

const offEnd = window.mulby.onPluginLaunchEnd((event) => {
  console.log(event.reason)
})

offStart()
offEnd()`,
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

function formatDuration(ms?: number) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return 'N/A'
    if (ms < 1000) return `${Math.round(ms)} ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
    return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

function operationLabel(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

function commandKey(command: PluginCommandItem) {
    return `${command.pluginId}::${command.featureCode}::${command.cmdId}::${command.cmdSignature}`
}

function optionalCommandKey(command: PluginCommandItem | undefined) {
    return command ? commandKey(command) : ''
}

function summarizePlugin(plugin: PluginInfo) {
    return {
        id: plugin.id,
        name: plugin.name,
        displayName: plugin.displayName,
        version: plugin.version,
        enabled: plugin.enabled,
        builtin: plugin.builtin,
        isDev: plugin.isDev,
        featureCount: plugin.features.length,
    }
}

function summarizeCommand(command: PluginCommandItem) {
    return {
        pluginId: command.pluginId,
        featureCode: command.featureCode,
        cmdId: command.cmdId,
        cmdType: command.cmdType,
        commandKind: command.commandKind,
        displayLabel: command.displayLabel,
        bindable: command.bindable,
        disabled: command.disabled,
    }
}

function summarizeSearchResult(result: PluginSearchResult) {
    return {
        pluginId: result.pluginId,
        pluginName: result.pluginName,
        displayName: result.displayName,
        featureCode: result.featureCode,
        featureExplain: result.featureExplain,
        matchType: result.matchType,
        mainPushItems: result.mainPushItems?.map(item => ({
            title: item.title,
            text: item.text,
        })),
    }
}

function summarizeBackground(info: BackgroundPluginInfo) {
    return {
        pluginId: info.pluginId,
        displayName: info.displayName,
        runMode: info.runMode,
        uptime: info.uptime,
        healthy: info.healthy,
        requestCount: info.requestCount,
        errorCount: info.errorCount,
        memoryUsage: info.memoryUsage,
        cpuUsage: info.cpuUsage,
    }
}

function stringifyPreview(value: unknown, limit = 800) {
    let text: string
    try {
        text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    } catch {
        text = String(value)
    }
    return text.length > limit ? `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]` : text
}

export function PluginOrchestrationModule() {
    const {
        plugin,
        onPluginInit,
        onPluginAttach,
        onPluginDetached,
        onPluginOut,
        onPluginLaunchStart,
        onPluginLaunchEnd,
        dialog,
    } = useMulby()
    const notify = useNotification()

    const [plugins, setPlugins] = useState<PluginInfo[]>([])
    const [commands, setCommands] = useState<PluginCommandItem[]>([])
    const [searchResults, setSearchResults] = useState<PluginSearchResult[]>([])
    const [recentResults, setRecentResults] = useState<PluginSearchResult[]>([])
    const [shortcutBindings, setShortcutBindings] = useState<PluginCommandShortcutBindingRecord[]>([])
    const [backgroundPlugins, setBackgroundPlugins] = useState<BackgroundPluginInfo[]>([])
    const [backgroundInfo, setBackgroundInfo] = useState<BackgroundPluginInfo | null>(null)
    const [searchPreferences, setSearchPreferences] = useState<unknown>(null)
    const [readmePreview, setReadmePreview] = useState('')
    const [selectedPluginId, setSelectedPluginId] = useState(SHOWCASE_PLUGIN_ID)
    const [selectedFeatureCode, setSelectedFeatureCode] = useState('sysinfo')
    const [selectedCommandKey, setSelectedCommandKey] = useState('')
    const [selectedBindingId, setSelectedBindingId] = useState('')
    const [searchQuery, setSearchQuery] = useState(DEFAULT_SEARCH_QUERY)
    const [runInput, setRunInput] = useState('hello from plugin orchestration')
    const [accelerator, setAccelerator] = useState(DEFAULT_ACCELERATOR)
    const [validationResult, setValidationResult] = useState<PluginCommandShortcutValidationResult | null>(null)
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [lifecycleEvents, setLifecycleEvents] = useState<PluginLifecycleEventLog[]>([])
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const selectedPlugin = useMemo(
        () => plugins.find(item => item.id === selectedPluginId) || null,
        [plugins, selectedPluginId]
    )

    const selectedFeature = useMemo(
        () => selectedPlugin?.features.find(feature => feature.code === selectedFeatureCode) || null,
        [selectedFeatureCode, selectedPlugin]
    )

    const selectedCommand = useMemo(
        () => commands.find(command => commandKey(command) === selectedCommandKey) || null,
        [commands, selectedCommandKey]
    )

    const selectedBinding = useMemo(
        () => shortcutBindings.find(binding => binding.id === selectedBindingId) || null,
        [selectedBindingId, shortcutBindings]
    )

    const pluginCommands = useMemo(
        () => commands.filter(command => command.pluginId === selectedPluginId),
        [commands, selectedPluginId]
    )

    const pushOperation = useCallback((item: Omit<OperationLogItem, 'timestamp'>) => {
        setOperationLog(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 18))
    }, [])

    const pushLifecycleEvent = useCallback((item: Omit<PluginLifecycleEventLog, 'timestamp'>) => {
        setLifecycleEvents(current => [
            { ...item, timestamp: Date.now() },
            ...current,
        ].slice(0, 18))
    }, [])

    const refreshShortcuts = useCallback(async (pluginId = selectedPluginId) => {
        const bindings = await plugin.listCommandShortcuts(pluginId || undefined)
        setShortcutBindings(bindings)
        setSelectedBindingId(current => (
            current && bindings.some(binding => binding.id === current)
                ? current
                : bindings[0]?.id || ''
        ))
        return bindings
    }, [plugin, selectedPluginId])

    const refreshBackground = useCallback(async () => {
        const list = await plugin.listBackground()
        setBackgroundPlugins(list)
        return list
    }, [plugin])

    const refreshCatalog = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!options.silent) setLoadingAction('refresh')
        try {
            const [nextPlugins, nextCommands, nextRecent, nextBackground] = await Promise.all([
                plugin.getAll(),
                plugin.listCommands(),
                plugin.getRecentUsed(10),
                plugin.listBackground(),
            ])

            setPlugins(nextPlugins)
            setCommands(nextCommands)
            setRecentResults(nextRecent)
            setBackgroundPlugins(nextBackground)

            const nextSelectedPlugin = nextPlugins.find(item => item.id === selectedPluginId)
                || nextPlugins.find(item => item.id === SHOWCASE_PLUGIN_ID)
                || nextPlugins[0]
            if (nextSelectedPlugin) {
                setSelectedPluginId(nextSelectedPlugin.id)
                if (!nextSelectedPlugin.features.some(feature => feature.code === selectedFeatureCode)) {
                    setSelectedFeatureCode(nextSelectedPlugin.features[0]?.code || '')
                }
            }

            setSelectedCommandKey(current => (
                current && nextCommands.some(command => commandKey(command) === current)
                    ? current
                    : optionalCommandKey(nextCommands.find(command => command.pluginId === (nextSelectedPlugin?.id || selectedPluginId)) || nextCommands[0])
            ) || '')

            await refreshShortcuts(nextSelectedPlugin?.id || selectedPluginId)

            if (!options.silent) {
                pushOperation({
                    action: 'plugin.getAll / plugin.listCommands / plugin.getRecentUsed / plugin.listBackground',
                    status: 'success',
                    message: `读取 ${nextPlugins.length} 个插件、${nextCommands.length} 条指令`,
                })
            }
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'refresh plugin catalog', status: 'error', message })
            if (!options.silent) notify.error(message)
        } finally {
            if (!options.silent) setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, refreshShortcuts, selectedFeatureCode, selectedPluginId])

    const searchPlugins = useCallback(async () => {
        setLoadingAction('search')
        try {
            const query = searchQuery.trim() || DEFAULT_SEARCH_QUERY
            const results = await plugin.search(query)
            setSearchResults(results)
            pushOperation({
                action: 'plugin.search',
                status: 'success',
                message: `搜索到 ${results.length} 个结果`,
                details: results.slice(0, 8).map(summarizeSearchResult),
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.search', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, searchQuery])

    const runSelectedFeature = useCallback(async () => {
        if (!selectedPluginId || !selectedFeatureCode) {
            notify.warning('请选择插件和功能')
            return
        }
        setLoadingAction('run')
        try {
            const result = await plugin.run(selectedPluginId, selectedFeatureCode, runInput)
            pushOperation({
                action: 'plugin.run',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `已运行 ${selectedPluginId}/${selectedFeatureCode}` : result.error || '运行失败',
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.run', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, runInput, selectedFeatureCode, selectedPluginId])

    const runSelectedCommand = useCallback(async () => {
        if (!selectedCommand) {
            notify.warning('请选择一个指令')
            return
        }
        setLoadingAction('command')
        try {
            const result = await plugin.runCommand({
                pluginId: selectedCommand.pluginId,
                featureCode: selectedCommand.featureCode,
                cmdId: selectedCommand.cmdId,
                cmdSignature: selectedCommand.cmdSignature,
                input: runInput,
            })
            pushOperation({
                action: 'plugin.runCommand',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `已运行指令 ${selectedCommand.displayLabel}` : result.error || '运行失败',
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.runCommand', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, runInput, selectedCommand])

    const redirectToSelectedFeature = useCallback(async () => {
        if (!selectedPluginId || !selectedFeatureCode) {
            notify.warning('请选择插件和功能')
            return
        }
        setLoadingAction('redirect')
        try {
            const result = await plugin.redirect([selectedPluginId, selectedFeatureCode], { text: runInput })
            pushOperation({
                action: 'plugin.redirect',
                status: result === true ? 'success' : 'info',
                message: result === true ? '已请求跳转' : '宿主返回候选结果',
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.redirect', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, runInput, selectedFeatureCode, selectedPluginId])

    const refreshRecent = useCallback(async () => {
        setLoadingAction('recent')
        try {
            const recent = await plugin.getRecentUsed(12)
            setRecentResults(recent)
            pushOperation({ action: 'plugin.getRecentUsed', status: 'success', message: `读取 ${recent.length} 条最近使用记录` })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.getRecentUsed', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation])

    const loadSearchPreferences = useCallback(async () => {
        setLoadingAction('preferences')
        try {
            const prefs = await plugin.getSearchPreferences()
            setSearchPreferences(prefs)
            pushOperation({ action: 'plugin.getSearchPreferences', status: 'success', message: '已读取搜索偏好' })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.getSearchPreferences', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation])

    const applyFeaturePreference = useCallback(async (action: 'pin' | 'unpin' | 'hide' | 'unhide' | 'remove-recent') => {
        if (!selectedPluginId || !selectedFeatureCode) {
            notify.warning('请选择插件和功能')
            return
        }
        setLoadingAction('preferences')
        try {
            let result: { success: boolean }
            if (action === 'pin') {
                result = await plugin.pinFeature(selectedPluginId, selectedFeatureCode)
            } else if (action === 'unpin') {
                result = await plugin.unpinFeature(selectedPluginId, selectedFeatureCode)
            } else if (action === 'hide') {
                const confirmed = await confirmDialog(dialog, {
                    title: '隐藏功能',
                    message: '隐藏功能会影响搜索结果，确认隐藏当前功能？',
                    confirmLabel: '隐藏',
                })
                if (!confirmed) return
                result = await plugin.hideFeature(selectedPluginId, selectedFeatureCode)
            } else if (action === 'unhide') {
                result = await plugin.unhideFeature(selectedPluginId, selectedFeatureCode)
            } else {
                result = await plugin.removeRecentUsage(selectedPluginId, selectedFeatureCode)
            }

            pushOperation({
                action: `plugin.${action}`,
                status: result.success ? 'success' : 'warning',
                message: `${selectedPluginId}/${selectedFeatureCode}`,
                details: result,
            })
            await loadSearchPreferences()
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: `plugin.${action}`, status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, loadSearchPreferences, notify, plugin, pushOperation, selectedFeatureCode, selectedPluginId])

    const validateShortcut = useCallback(async () => {
        setLoadingAction('shortcut')
        try {
            const result = await plugin.validateCommandShortcut(accelerator, selectedBindingId || undefined)
            setValidationResult(result)
            pushOperation({
                action: 'plugin.validateCommandShortcut',
                status: result.ok ? 'success' : 'warning',
                message: result.ok ? '快捷键可绑定' : result.error || result.state || '快捷键不可用',
                details: result,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.validateCommandShortcut', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [accelerator, notify, plugin, pushOperation, selectedBindingId])

    const bindShortcut = useCallback(async () => {
        if (!selectedCommand) {
            notify.warning('请选择一个指令')
            return
        }
        if (!selectedCommand.bindable) {
            notify.warning('当前指令不可绑定快捷键')
            return
        }
        const confirmed = await confirmDialog(dialog, {
            title: '绑定快捷键',
            message: '绑定快捷键会写入插件命令快捷键配置，确认继续？',
            confirmLabel: '绑定',
        })
        if (!confirmed) return

        setLoadingAction('shortcut')
        try {
            const result = await plugin.bindCommandShortcut({
                pluginId: selectedCommand.pluginId,
                featureCode: selectedCommand.featureCode,
                cmdId: selectedCommand.cmdId,
                cmdSignature: selectedCommand.cmdSignature,
                commandLabel: selectedCommand.displayLabel,
                accelerator,
            })
            pushOperation({
                action: 'plugin.bindCommandShortcut',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `已绑定 ${accelerator}` : result.error || result.state || '绑定失败',
                details: result,
            })
            await refreshShortcuts(selectedCommand.pluginId)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.bindCommandShortcut', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [accelerator, dialog, notify, plugin, pushOperation, refreshShortcuts, selectedCommand])

    const unbindShortcut = useCallback(async () => {
        if (!selectedBinding) {
            notify.warning('请选择一个快捷键绑定')
            return
        }
        const confirmed = await confirmDialog(dialog, {
            title: '解绑快捷键',
            message: `确认解绑 ${selectedBinding.accelerator}？`,
            confirmLabel: '解绑',
        })
        if (!confirmed) return

        setLoadingAction('shortcut')
        try {
            const result = await plugin.unbindCommandShortcut(selectedBinding.id)
            pushOperation({
                action: 'plugin.unbindCommandShortcut',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `已解绑 ${selectedBinding.accelerator}` : '解绑失败',
                details: result,
            })
            await refreshShortcuts(selectedBinding.pluginId)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.unbindCommandShortcut', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, plugin, pushOperation, refreshShortcuts, selectedBinding])

    const toggleCommandDisabled = useCallback(async () => {
        if (!selectedCommand) {
            notify.warning('请选择一个指令')
            return
        }
        const nextDisabled = !selectedCommand.disabled
        const confirmed = await confirmDialog(dialog, {
            title: `${nextDisabled ? '禁用' : '启用'}指令`,
            message: `${nextDisabled ? '禁用' : '启用'}当前指令会影响搜索和快捷键触发，确认继续？`,
            confirmLabel: nextDisabled ? '禁用' : '启用',
        })
        if (!confirmed) return

        setLoadingAction('command-state')
        try {
            const result = await plugin.setCommandDisabled({
                pluginId: selectedCommand.pluginId,
                featureCode: selectedCommand.featureCode,
                cmdId: selectedCommand.cmdId,
                cmdSignature: selectedCommand.cmdSignature,
                disabled: nextDisabled,
            })
            pushOperation({
                action: 'plugin.setCommandDisabled',
                status: result.success ? 'success' : 'warning',
                message: result.success ? (result.disabled ? '指令已禁用' : '指令已启用') : result.error || '状态变更失败',
                details: result,
            })
            const nextCommands = await plugin.listCommands()
            setCommands(nextCommands)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.setCommandDisabled', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, plugin, pushOperation, selectedCommand])

    const readReadme = useCallback(async () => {
        if (!selectedPluginId) return
        setLoadingAction('readme')
        try {
            const text = await plugin.getReadme(selectedPluginId)
            setReadmePreview(text ? text.slice(0, 1600) : '')
            pushOperation({
                action: 'plugin.getReadme',
                status: text ? 'success' : 'info',
                message: text ? `读取 ${text.length} 个字符` : '插件没有 README',
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.getReadme', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, selectedPluginId])

    const prewarmSelectedPlugin = useCallback(async () => {
        if (!selectedPluginId) return
        setLoadingAction('background')
        try {
            await plugin.prewarm(selectedPluginId)
            pushOperation({ action: 'plugin.prewarm', status: 'success', message: `已请求预热 ${selectedPluginId}` })
            await refreshBackground()
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.prewarm', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, refreshBackground, selectedPluginId])

    const startSelectedBackground = useCallback(async () => {
        if (!selectedPluginId) return
        setLoadingAction('background')
        try {
            const result = await plugin.startBackground(selectedPluginId)
            pushOperation({
                action: 'plugin.startBackground',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `已启动后台 ${selectedPluginId}` : result.error || '启动失败',
                details: result,
            })
            await refreshBackground()
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.startBackground', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, refreshBackground, selectedPluginId])

    const stopSelectedBackground = useCallback(async () => {
        if (!selectedPluginId) return
        const confirmed = await confirmDialog(dialog, {
            title: '停止后台插件',
            message: '停止后台插件会中断该插件后台服务，确认继续？',
            confirmLabel: '停止',
        })
        if (!confirmed) return

        setLoadingAction('background')
        try {
            const result = await plugin.stopBackground(selectedPluginId)
            pushOperation({
                action: 'plugin.stopBackground',
                status: result.success ? 'success' : 'warning',
                message: result.success ? `已停止后台 ${selectedPluginId}` : '停止失败',
                details: result,
            })
            await refreshBackground()
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.stopBackground', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, plugin, pushOperation, refreshBackground, selectedPluginId])

    const loadBackgroundInfo = useCallback(async (pluginId = selectedPluginId) => {
        if (!pluginId) return
        setLoadingAction('background')
        try {
            const info = await plugin.getBackgroundInfo(pluginId)
            setBackgroundInfo(info)
            pushOperation({
                action: 'plugin.getBackgroundInfo',
                status: info ? 'success' : 'info',
                message: info ? `读取 ${pluginId} 后台详情` : `${pluginId} 当前没有后台详情`,
                details: info ? summarizeBackground(info) : null,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.getBackgroundInfo', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, selectedPluginId])

    const selectMainPushItem = useCallback(async (result: PluginSearchResult, item: MainPushItem) => {
        setLoadingAction('main-push')
        try {
            const ok = await plugin.mainPushSelect(result.pluginName, {
                code: result.featureCode,
                type: 'text',
                payload: searchQuery,
                option: item,
            })
            pushOperation({
                action: 'plugin.mainPushSelect',
                status: ok ? 'success' : 'warning',
                message: ok ? item.title : 'MainPush 选择未被处理',
                details: { result: summarizeSearchResult(result), item },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.mainPushSelect', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, plugin, pushOperation, searchQuery])

    const exitCurrentPlugin = useCallback(async () => {
        const confirmed = await confirmDialog(dialog, {
            title: '退出 Showcase',
            message: '这会退出当前 Showcase 插件窗口，确认继续？',
            confirmLabel: '退出',
        })
        if (!confirmed) return

        setLoadingAction('out')
        try {
            const ok = await plugin.outPlugin(false)
            pushOperation({
                action: 'plugin.outPlugin',
                status: ok ? 'success' : 'warning',
                message: ok ? '已请求退出当前插件' : '宿主返回退出失败',
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'plugin.outPlugin', status: 'error', message })
            notify.error(message)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, plugin, pushOperation])

    useEffect(() => {
        void refreshCatalog({ silent: true })
    }, [])

    useEffect(() => {
        void refreshShortcuts(selectedPluginId).catch(() => undefined)
    }, [refreshShortcuts, selectedPluginId])

    useEffect(() => {
        const disposers: Disposable[] = [
            onPluginInit((data: PluginInitData) => {
                pushLifecycleEvent({ type: 'init', payload: data })
            }),
            onPluginAttach((data: PluginAttachEvent) => {
                pushLifecycleEvent({ type: 'attach', payload: data })
            }),
            onPluginDetached(() => {
                pushLifecycleEvent({ type: 'detached' })
            }),
            onPluginOut((isKill: boolean) => {
                pushLifecycleEvent({ type: 'out', payload: { isKill } })
            }),
            onPluginLaunchStart((data: PluginLaunchStartEvent) => {
                pushLifecycleEvent({ type: 'launch-start', payload: data })
            }),
            onPluginLaunchEnd((data: PluginLaunchEndEvent) => {
                pushLifecycleEvent({ type: 'launch-end', payload: data })
            }),
        ]

        return () => {
            disposers.forEach(dispose => dispose())
        }
    }, [onPluginAttach, onPluginDetached, onPluginInit, onPluginLaunchEnd, onPluginLaunchStart, onPluginOut, pushLifecycleEvent])

    const stats = useMemo(() => ({
        plugins: plugins.length,
        enabledPlugins: plugins.filter(item => item.enabled).length,
        commands: commands.length,
        bindableCommands: commands.filter(item => item.bindable).length,
        background: backgroundPlugins.length,
        lifecycleEvents: lifecycleEvents.length,
    }), [backgroundPlugins.length, commands, lifecycleEvents.length, plugins])

    const rawData = useMemo(() => ({
        selected: {
            plugin: selectedPlugin ? summarizePlugin(selectedPlugin) : null,
            feature: selectedFeature,
            command: selectedCommand ? summarizeCommand(selectedCommand) : null,
            binding: selectedBinding,
        },
        stats,
        plugins: plugins.map(summarizePlugin),
        commands: commands.slice(0, 80).map(summarizeCommand),
        searchResults: searchResults.map(summarizeSearchResult),
        recentResults: recentResults.map(summarizeSearchResult),
        shortcutBindings,
        backgroundPlugins: backgroundPlugins.map(summarizeBackground),
        backgroundInfo: backgroundInfo ? summarizeBackground(backgroundInfo) : null,
        searchPreferences,
        readmePreview: readmePreview ? `${readmePreview.slice(0, 500)}${readmePreview.length > 500 ? '...[truncated]' : ''}` : '',
        lifecycleEvents,
        operationLog,
    }), [
        backgroundInfo,
        backgroundPlugins,
        commands,
        lifecycleEvents,
        operationLog,
        plugins,
        readmePreview,
        recentResults,
        searchPreferences,
        searchResults,
        selectedBinding,
        selectedCommand,
        selectedFeature,
        selectedPlugin,
        shortcutBindings,
        stats,
    ])

    return (
        <div className="main-content">
            <PageHeader
                icon={Puzzle}
                title="插件编排"
                description="演示插件目录、指令搜索、运行跳转、命令快捷键、后台状态和插件生命周期事件"
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => void refreshCatalog()} loading={loadingAction === 'refresh'}>
                            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                            刷新
                        </Button>
                        <Button variant="secondary" onClick={() => void exitCurrentPlugin()} loading={loadingAction === 'out'}>
                            <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                            退出当前插件
                        </Button>
                    </>
                )}
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-value">{stats.plugins}</div>
                            <div className="stat-label">插件总数</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{stats.commands}</div>
                            <div className="stat-label">指令总数</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{stats.bindableCommands}</div>
                            <div className="stat-label">可绑定指令</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{stats.background}</div>
                            <div className="stat-label">后台或活跃插件</div>
                        </div>
                    </div>

                    <div className="grid grid-2">
                        <Card title="插件目录" icon={Boxes}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="plugin-selected-plugin">选中插件</label>
                                    <select
                                        id="plugin-selected-plugin"
                                        className="select"
                                        value={selectedPluginId}
                                        onChange={event => {
                                            const nextPlugin = plugins.find(item => item.id === event.target.value)
                                            setSelectedPluginId(event.target.value)
                                            setSelectedFeatureCode(nextPlugin?.features[0]?.code || '')
                                            setSelectedCommandKey('')
                                            setReadmePreview('')
                                        }}
                                    >
                                        {plugins.map(item => (
                                            <option key={item.id} value={item.id}>
                                                {item.displayName || item.name} ({item.id})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="plugin-selected-feature">功能</label>
                                    <select
                                        id="plugin-selected-feature"
                                        className="select"
                                        value={selectedFeatureCode}
                                        onChange={event => setSelectedFeatureCode(event.target.value)}
                                    >
                                        {(selectedPlugin?.features || []).map(feature => (
                                            <option key={feature.code} value={feature.code}>
                                                {feature.explain || feature.code}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="info-grid">
                                    <span className="info-label">状态</span>
                                    <span className="info-value">
                                        <StatusBadge status={selectedPlugin?.enabled ? 'success' : 'warning'}>
                                            {selectedPlugin?.enabled ? '已启用' : '未启用'}
                                        </StatusBadge>
                                    </span>
                                    <span className="info-label">版本</span>
                                    <span className="info-value">{selectedPlugin?.version || 'N/A'}</span>
                                    <span className="info-label">功能数</span>
                                    <span className="info-value">{selectedPlugin?.features.length || 0}</span>
                                    <span className="info-label">来源</span>
                                    <span className="info-value">{selectedPlugin?.builtin ? '内置' : selectedPlugin?.isDev ? '开发' : '用户插件'}</span>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="搜索与运行"
                            icon={Search}
                            actions={(
                                <>
                                    <Button onClick={() => void searchPlugins()} loading={loadingAction === 'search'}>
                                        <Search className="inline-icon" aria-hidden="true" size={14} />
                                        搜索
                                    </Button>
                                    <Button variant="secondary" onClick={() => void runSelectedFeature()} loading={loadingAction === 'run'}>
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        运行功能
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="plugin-search-query">搜索文本</label>
                                    <input
                                        id="plugin-search-query"
                                        className="input"
                                        value={searchQuery}
                                        onChange={event => setSearchQuery(event.target.value)}
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="plugin-run-input">运行输入</label>
                                    <input
                                        id="plugin-run-input"
                                        className="input"
                                        value={runInput}
                                        onChange={event => setRunInput(event.target.value)}
                                    />
                                </div>
                                <Button variant="secondary" onClick={() => void redirectToSelectedFeature()} loading={loadingAction === 'redirect'}>
                                    <ExternalLink className="inline-icon" aria-hidden="true" size={14} />
                                    跳转到选中功能
                                </Button>
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="搜索结果" icon={Search}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {searchResults.length > 0 ? searchResults.map(result => (
                                    <div className="list-row" key={`${result.pluginId}-${result.featureCode}-${result.matchType}`}>
                                        <StatusBadge status="info">{result.matchType}</StatusBadge>
                                        <span className="list-row-main">{result.displayName} / {result.featureExplain}</span>
                                        <span className="list-row-meta">{result.pluginId}</span>
                                        {result.mainPushItems?.[0] && (
                                            <Button
                                                variant="secondary"
                                                onClick={() => void selectMainPushItem(result, result.mainPushItems![0])}
                                                loading={loadingAction === 'main-push'}
                                            >
                                                <Bell className="inline-icon" aria-hidden="true" size={14} />
                                                选择推送项
                                            </Button>
                                        )}
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <Search aria-hidden="true" size={28} />
                                        <p>输入关键词后搜索插件功能</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card
                            title="最近使用"
                            icon={Star}
                            actions={(
                                <Button variant="secondary" onClick={() => void refreshRecent()} loading={loadingAction === 'recent'}>
                                    <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                    刷新最近
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {recentResults.length > 0 ? recentResults.map(result => (
                                    <button
                                        type="button"
                                        className="list-row"
                                        key={`${result.pluginId}-${result.featureCode}-${result.matchType}`}
                                        onClick={() => {
                                            setSelectedPluginId(result.pluginId)
                                            setSelectedFeatureCode(result.featureCode)
                                        }}
                                        style={{ cursor: 'pointer', textAlign: 'left' }}
                                    >
                                        <StatusBadge status="success">{result.matchType}</StatusBadge>
                                        <span className="list-row-main">{result.displayName} / {result.featureExplain}</span>
                                        <span className="list-row-meta">{result.pluginId}</span>
                                    </button>
                                )) : (
                                    <div className="empty-state">
                                        <Star aria-hidden="true" size={28} />
                                        <p>暂无最近使用记录</p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="指令与快捷键"
                            icon={Keyboard}
                            actions={(
                                <>
                                    <Button onClick={() => void runSelectedCommand()} loading={loadingAction === 'command'}>
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        运行指令
                                    </Button>
                                    <Button variant="secondary" onClick={() => void toggleCommandDisabled()} loading={loadingAction === 'command-state'}>
                                        {selectedCommand?.disabled ? (
                                            <Play className="inline-icon" aria-hidden="true" size={14} />
                                        ) : (
                                            <PauseCircle className="inline-icon" aria-hidden="true" size={14} />
                                        )}
                                        {selectedCommand?.disabled ? '启用指令' : '禁用指令'}
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="plugin-selected-command">选中指令</label>
                                    <select
                                        id="plugin-selected-command"
                                        className="select"
                                        value={selectedCommandKey}
                                        onChange={event => setSelectedCommandKey(event.target.value)}
                                    >
                                        <option value="">请选择指令</option>
                                        {pluginCommands.map(command => (
                                            <option key={commandKey(command)} value={commandKey(command)}>
                                                {command.displayLabel} / {command.featureExplain}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {selectedCommand ? (
                                    <div className="info-grid">
                                        <span className="info-label">类型</span>
                                        <span className="info-value">{selectedCommand.cmdType} / {selectedCommand.commandKind}</span>
                                        <span className="info-label">可绑定</span>
                                        <span className="info-value">
                                            <StatusBadge status={selectedCommand.bindable ? 'success' : 'warning'}>
                                                {selectedCommand.bindable ? '是' : '否'}
                                            </StatusBadge>
                                        </span>
                                        <span className="info-label">禁用</span>
                                        <span className="info-value">{selectedCommand.disabled ? '是' : '否'}</span>
                                    </div>
                                ) : (
                                    <div className="empty-state">
                                        <Keyboard aria-hidden="true" size={28} />
                                        <p>请选择一个指令</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card
                            title="快捷键绑定"
                            icon={ShieldCheck}
                            actions={(
                                <>
                                    <Button onClick={() => void validateShortcut()} loading={loadingAction === 'shortcut'}>
                                        <ShieldCheck className="inline-icon" aria-hidden="true" size={14} />
                                        校验
                                    </Button>
                                    <Button variant="secondary" onClick={() => void bindShortcut()} loading={loadingAction === 'shortcut'}>
                                        <Keyboard className="inline-icon" aria-hidden="true" size={14} />
                                        绑定
                                    </Button>
                                    <Button variant="secondary" onClick={() => void unbindShortcut()} loading={loadingAction === 'shortcut'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        解绑
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="plugin-accelerator">Accelerator</label>
                                    <input
                                        id="plugin-accelerator"
                                        className="input"
                                        value={accelerator}
                                        onChange={event => setAccelerator(event.target.value)}
                                    />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="plugin-binding">现有绑定</label>
                                    <select
                                        id="plugin-binding"
                                        className="select"
                                        value={selectedBindingId}
                                        onChange={event => setSelectedBindingId(event.target.value)}
                                    >
                                        <option value="">请选择绑定</option>
                                        {shortcutBindings.map(binding => (
                                            <option key={binding.id} value={binding.id}>
                                                {binding.commandLabel} / {binding.accelerator}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {validationResult && (
                                    <StatusBadge status={validationResult.ok ? 'success' : 'warning'}>
                                        {validationResult.ok ? '可绑定' : validationResult.error || validationResult.state || '不可绑定'}
                                    </StatusBadge>
                                )}
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="搜索偏好"
                            icon={Pin}
                            actions={(
                                <Button variant="secondary" onClick={() => void loadSearchPreferences()} loading={loadingAction === 'preferences'}>
                                    <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                                    读取偏好
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="action-bar" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
                                    <Button variant="secondary" onClick={() => void applyFeaturePreference('pin')} loading={loadingAction === 'preferences'}>
                                        <Pin className="inline-icon" aria-hidden="true" size={14} />
                                        置顶
                                    </Button>
                                    <Button variant="secondary" onClick={() => void applyFeaturePreference('unpin')} loading={loadingAction === 'preferences'}>
                                        <Pin className="inline-icon" aria-hidden="true" size={14} />
                                        取消置顶
                                    </Button>
                                    <Button variant="secondary" onClick={() => void applyFeaturePreference('hide')} loading={loadingAction === 'preferences'}>
                                        <PauseCircle className="inline-icon" aria-hidden="true" size={14} />
                                        隐藏
                                    </Button>
                                    <Button variant="secondary" onClick={() => void applyFeaturePreference('unhide')} loading={loadingAction === 'preferences'}>
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        恢复
                                    </Button>
                                    <Button variant="secondary" onClick={() => void applyFeaturePreference('remove-recent')} loading={loadingAction === 'preferences'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        移除最近
                                    </Button>
                                </div>
                                <div className="preview-box" style={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 160 }}>
                                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                                        {searchPreferences ? stringifyPreview(searchPreferences, 1200) : '点击读取偏好查看当前搜索置顶和隐藏状态'}
                                    </pre>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="README 预览"
                            icon={BookOpen}
                            actions={(
                                <Button variant="secondary" onClick={() => void readReadme()} loading={loadingAction === 'readme'}>
                                    <BookOpen className="inline-icon" aria-hidden="true" size={14} />
                                    读取 README
                                </Button>
                            )}
                        >
                            <div className="preview-box" style={{ alignItems: 'stretch', justifyContent: 'flex-start', minHeight: 220 }}>
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12 }}>
                                    {readmePreview || '选择插件后读取 README'}
                                </pre>
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="后台插件"
                            icon={Gauge}
                            actions={(
                                <>
                                    <Button variant="secondary" onClick={() => void prewarmSelectedPlugin()} loading={loadingAction === 'background'}>
                                        <Rocket className="inline-icon" aria-hidden="true" size={14} />
                                        预热
                                    </Button>
                                    <Button variant="secondary" onClick={() => void startSelectedBackground()} loading={loadingAction === 'background'}>
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        启动后台
                                    </Button>
                                    <Button variant="secondary" onClick={() => void stopSelectedBackground()} loading={loadingAction === 'background'}>
                                        <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                                        停止后台
                                    </Button>
                                </>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {backgroundPlugins.length > 0 ? backgroundPlugins.map(info => (
                                    <button
                                        type="button"
                                        className="list-row"
                                        key={info.pluginId}
                                        onClick={() => void loadBackgroundInfo(info.pluginId)}
                                        style={{ cursor: 'pointer', textAlign: 'left' }}
                                    >
                                        <StatusBadge status={info.healthy === false ? 'warning' : 'success'}>{info.runMode}</StatusBadge>
                                        <span className="list-row-main">{info.displayName}</span>
                                        <span className="list-row-meta">{formatDuration(info.uptime)}</span>
                                        <span className="list-row-meta">{info.pluginId}</span>
                                    </button>
                                )) : (
                                    <div className="empty-state">
                                        <Gauge aria-hidden="true" size={28} />
                                        <p>暂无后台或活跃插件记录</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card title="后台详情" icon={Activity}>
                            {backgroundInfo ? (
                                <div className="info-grid">
                                    <span className="info-label">插件</span>
                                    <span className="info-value">{backgroundInfo.pluginId}</span>
                                    <span className="info-label">模式</span>
                                    <span className="info-value">{backgroundInfo.runMode}</span>
                                    <span className="info-label">运行时长</span>
                                    <span className="info-value">{formatDuration(backgroundInfo.uptime)}</span>
                                    <span className="info-label">请求数</span>
                                    <span className="info-value">{backgroundInfo.requestCount ?? 0}</span>
                                    <span className="info-label">错误数</span>
                                    <span className="info-value">{backgroundInfo.errorCount ?? 0}</span>
                                    <span className="info-label">健康</span>
                                    <span className="info-value">{backgroundInfo.healthy === false ? '异常' : '正常'}</span>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <Activity aria-hidden="true" size={28} />
                                    <p>点击后台列表读取详情</p>
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="生命周期事件" icon={PlugZap}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {lifecycleEvents.length > 0 ? lifecycleEvents.map((event, index) => (
                                    <div className="list-row" key={`${event.timestamp}-${index}`}>
                                        <StatusBadge status="info">{event.type}</StatusBadge>
                                        <span className="list-row-main">{formatDateTime(event.timestamp)}</span>
                                        <span className="list-row-meta">{stringifyPreview(event.payload, 220)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <PlugZap aria-hidden="true" size={28} />
                                        <p>当前窗口尚未收到新的插件生命周期事件</p>
                                    </div>
                                )}
                            </div>
                        </Card>

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
