import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Activity,
    BadgeInfo,
    Bell,
    CalendarClock,
    CircleStop,
    Clock3,
    Eraser,
    List,
    Pause,
    Play,
    RefreshCw,
    Repeat,
    Search,
    TimerReset,
    Trash2,
} from 'lucide-react'
import { PageHeader, Card, Button, StatusBadge, ApiReferencePanel } from '../../components'
import type { ApiExample, ApiReferenceGroup } from '../../components'
import { useMulby, useNotification } from '../../hooks'
import { confirmDialog } from '../../utils/dialogs'

type SchedulerTaskType = 'once' | 'repeat' | 'delay'
type SchedulerTaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
type StatusFilter = 'all' | SchedulerTaskStatus
type TypeFilter = 'all' | SchedulerTaskType
type OperationStatus = 'success' | 'error' | 'info' | 'warning'
type LoadingAction = 'refresh' | 'delay' | 'once' | 'repeat' | 'cron' | 'subscribe' | 'control' | 'delete' | 'cleanup' | null

interface SchedulerTask {
    id: string
    pluginId?: string
    name?: string
    description?: string
    type?: SchedulerTaskType | string
    status?: SchedulerTaskStatus | string
    callback?: string
    payload?: unknown
    time?: number
    cron?: string
    delay?: number
    timezone?: string
    maxExecutions?: number
    nextRunTime?: number
    lastRunTime?: number
    executionCount?: number
    failureCount?: number
    lastError?: string
    createdAt?: number
    updatedAt?: number
}

interface SchedulerExecution {
    id: string
    taskId: string
    startTime?: number
    endTime?: number
    status?: 'success' | 'failed' | 'timeout' | string
    result?: unknown
    error?: string
    duration?: number
}

interface SchedulerEvent {
    type: string
    timestamp?: number
    taskId?: string
    task?: SchedulerTask
    deletedCount?: number
    taskIds?: string[]
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
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: '全部状态' },
    { value: 'pending', label: '等待中' },
    { value: 'running', label: '运行中' },
    { value: 'paused', label: '已暂停' },
    { value: 'completed', label: '已完成' },
    { value: 'failed', label: '失败' },
    { value: 'cancelled', label: '已取消' },
]
const TYPE_OPTIONS: Array<{ value: TypeFilter; label: string }> = [
    { value: 'all', label: '全部类型' },
    { value: 'delay', label: '延迟任务' },
    { value: 'once', label: '一次性任务' },
    { value: 'repeat', label: '重复任务' },
]

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
}

function formatDateTime(timestamp?: number | string | Date | null) {
    if (!timestamp) return 'N/A'
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
    if (Number.isNaN(date.getTime())) return 'N/A'
    return date.toLocaleString()
}

function formatTime(timestamp?: number | null) {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleTimeString()
}

function formatDuration(duration?: number) {
    if (duration === undefined) return 'N/A'
    if (duration < 1000) return `${duration} ms`
    return `${(duration / 1000).toFixed(2)} s`
}

function taskStatusLabel(status?: string) {
    const labels: Record<string, string> = {
        pending: '等待中',
        running: '运行中',
        paused: '已暂停',
        completed: '已完成',
        failed: '失败',
        cancelled: '已取消',
    }
    return status ? labels[status] || status : '未知'
}

function taskTypeLabel(type?: string) {
    const labels: Record<string, string> = {
        delay: '延迟',
        once: '一次性',
        repeat: '重复',
    }
    return type ? labels[type] || type : '未知'
}

function statusBadge(status?: string): OperationStatus {
    if (status === 'completed' || status === 'success') return 'success'
    if (status === 'failed' || status === 'timeout') return 'error'
    if (status === 'paused' || status === 'cancelled') return 'warning'
    return 'info'
}

function isTerminalTask(task: SchedulerTask | null) {
    return task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled'
}

function summarizePayload(payload: unknown) {
    if (!payload || typeof payload !== 'object') return payload
    const record = payload as Record<string, unknown>
    return {
        kind: record.kind,
        label: record.label,
        source: record.source,
        createdAt: record.createdAt,
        message: typeof record.message === 'string' ? record.message.slice(0, 160) : undefined,
    }
}

function summarizeTask(task: SchedulerTask) {
    return {
        id: task.id,
        pluginId: task.pluginId,
        name: task.name,
        type: task.type,
        status: task.status,
        callback: task.callback,
        nextRunTime: task.nextRunTime,
        lastRunTime: task.lastRunTime,
        executionCount: task.executionCount,
        failureCount: task.failureCount,
        maxExecutions: task.maxExecutions,
        payload: summarizePayload(task.payload),
    }
}

function summarizeExecution(execution: SchedulerExecution) {
    return {
        id: execution.id,
        taskId: execution.taskId,
        status: execution.status,
        startTime: execution.startTime,
        endTime: execution.endTime,
        duration: execution.duration,
        error: execution.error,
        resultType: execution.result === null ? 'null' : typeof execution.result,
    }
}

function operationLabel(status: OperationStatus) {
    if (status === 'success') return '成功'
    if (status === 'warning') return '警告'
    if (status === 'error') return '失败'
    return '信息'
}

const apiGroups: ApiReferenceGroup[] = [
    {
        title: 'Backend Scheduler',
        items: [
            { name: 'mulby.scheduler.schedule(task)', description: '在插件后端创建 once、repeat 或 delay 任务。' },
            { name: 'onShowcaseDelayTask(context, payload, task)', description: '延迟任务执行时由宿主调用的插件导出回调。' },
            { name: 'onShowcaseOnceTask(context, payload, task)', description: '一次性任务执行时由宿主调用的插件导出回调。' },
            { name: 'onShowcaseRepeatTask(context, payload, task)', description: '重复任务执行时由宿主调用的插件导出回调。' },
        ],
    },
    {
        title: 'Renderer Scheduler',
        items: [
            { name: 'scheduler.listTasks(filter)', description: '按插件、状态、类型和分页读取任务列表。' },
            { name: 'scheduler.getTask(taskId)', description: '读取单个任务详情。' },
            { name: 'scheduler.getTaskCount(filter)', description: '读取当前过滤条件下的任务数量。' },
            { name: 'scheduler.getExecutions(taskId, limit)', description: '读取任务执行历史。' },
            { name: 'scheduler.pauseTask(taskId)', description: '暂停等待中的任务。' },
            { name: 'scheduler.resumeTask(taskId)', description: '恢复已暂停任务。' },
            { name: 'scheduler.cancelTask(taskId)', description: '取消任务。' },
            { name: 'scheduler.deleteTasks(taskIds)', description: '删除显式选择的任务记录。' },
            { name: 'scheduler.cleanupTasks(olderThan)', description: '按宿主规则清理终态任务记录。' },
        ],
    },
    {
        title: 'Events And Cron',
        items: [
            { name: 'scheduler.subscribe()', description: '订阅调度事件流。' },
            { name: 'scheduler.onEvent(callback)', description: '注册事件回调并返回取消监听函数。' },
            { name: 'scheduler.unsubscribe()', description: '取消当前窗口的调度事件订阅。' },
            { name: 'scheduler.validateCron(expression)', description: '校验 6 位 Cron 表达式。' },
            { name: 'scheduler.describeCron(expression)', description: '读取 Cron 的中文描述。' },
            { name: 'scheduler.getNextCronTime(expression, after)', description: '计算下一次触发时间。' },
        ],
    },
]

const apiExamples: ApiExample[] = [
    {
        title: '通过后台 RPC 创建任务',
        code: `const result = await window.mulby.host.call('@mulby/showcase', 'scheduleShowcaseDelayTask', {
  delayMs: 5000,
  message: '延迟任务执行'
})

if (result.success) {
  console.log(result.data.id)
}`,
    },
    {
        title: '插件后端导出调度回调',
        code: `export async function onShowcaseDelayTask(context, payload, task) {
  await context.api.notification.show(payload?.message || '任务已执行', 'success')
  return {
    success: true,
    taskId: task?.id,
    executedAt: new Date().toISOString()
  }
}`,
    },
    {
        title: '列表、事件和控制',
        code: `const subscribeResult = await scheduler.subscribe()
const off = scheduler.onEvent((event) => {
  console.log(event.type, event.taskId)
})

const tasks = await scheduler.listTasks({
  pluginId: '@mulby/showcase',
  limit: 20
})

await scheduler.pauseTask(tasks[0].id)
await scheduler.resumeTask(tasks[0].id)
await scheduler.cancelTask(tasks[0].id)
off()
await scheduler.unsubscribe()`,
    },
    {
        title: 'Cron 工具',
        code: `const expression = '0 */5 * * * *'
const valid = await scheduler.validateCron(expression)
if (valid) {
  const description = await scheduler.describeCron(expression)
  const nextTime = await scheduler.getNextCronTime(expression)
  console.log(description, nextTime)
}`,
    },
]

export function SchedulerModule() {
    const { scheduler, host, dialog } = useMulby(SHOWCASE_PLUGIN_ID)
    const showcaseHost = host as unknown as ShowcaseHost
    const notify = useNotification()

    const [tasks, setTasks] = useState<SchedulerTask[]>([])
    const [taskCount, setTaskCount] = useState(0)
    const [selectedTaskId, setSelectedTaskId] = useState('')
    const [selectedTask, setSelectedTask] = useState<SchedulerTask | null>(null)
    const [executions, setExecutions] = useState<SchedulerExecution[]>([])
    const [events, setEvents] = useState<SchedulerEvent[]>([])
    const [operationLog, setOperationLog] = useState<OperationLogItem[]>([])
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
    const [pageSize, setPageSize] = useState(20)
    const [offset, setOffset] = useState(0)
    const [subscribed, setSubscribed] = useState(false)
    const [delayMs, setDelayMs] = useState('5000')
    const [onceDelayMs, setOnceDelayMs] = useState('30000')
    const [repeatCron, setRepeatCron] = useState('0 */1 * * * *')
    const [repeatMaxExecutions, setRepeatMaxExecutions] = useState('3')
    const [delayMessage, setDelayMessage] = useState('Showcase 延迟任务已执行')
    const [onceMessage, setOnceMessage] = useState('Showcase 一次性任务已执行')
    const [repeatMessage, setRepeatMessage] = useState('Showcase 重复任务已执行')
    const [cronExpression, setCronExpression] = useState('0 */5 * * * *')
    const [cronValid, setCronValid] = useState<boolean | null>(null)
    const [cronDescription, setCronDescription] = useState('')
    const [nextCronTime, setNextCronTime] = useState('')
    const [loadingAction, setLoadingAction] = useState<LoadingAction>(null)

    const selectedTaskIdRef = useRef('')
    const eventDisposerRef = useRef<Disposable | null>(null)

    useEffect(() => {
        selectedTaskIdRef.current = selectedTaskId
    }, [selectedTaskId])

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

    const loadTaskDetails = useCallback(async (taskId: string) => {
        if (!taskId) {
            setSelectedTask(null)
            setExecutions([])
            return
        }

        const [task, taskExecutions] = await Promise.all([
            scheduler.getTask(taskId),
            scheduler.getExecutions(taskId, 20),
        ])
        setSelectedTask(task as SchedulerTask | null)
        setExecutions((taskExecutions || []) as SchedulerExecution[])
    }, [scheduler])

    const refreshTasks = useCallback(async (options: { silent?: boolean } = {}) => {
        if (!options.silent) setLoadingAction('refresh')
        try {
            const filter = {
                pluginId: SHOWCASE_PLUGIN_ID,
                status: statusFilter === 'all' ? undefined : statusFilter,
                type: typeFilter === 'all' ? undefined : typeFilter,
                limit: pageSize,
                offset,
            }
            const countFilter = {
                pluginId: SHOWCASE_PLUGIN_ID,
                status: filter.status,
                type: filter.type,
            }
            const [nextTasks, nextCount] = await Promise.all([
                scheduler.listTasks(filter),
                scheduler.getTaskCount(countFilter),
            ])
            const normalizedTasks = (nextTasks || []) as SchedulerTask[]
            setTasks(normalizedTasks)
            setTaskCount(nextCount)

            const currentSelection = selectedTaskIdRef.current
            const preferredTaskId = currentSelection && normalizedTasks.some(task => task.id === currentSelection)
                ? currentSelection
                : normalizedTasks[0]?.id || ''
            selectedTaskIdRef.current = preferredTaskId
            setSelectedTaskId(preferredTaskId)
            await loadTaskDetails(preferredTaskId)

            if (!options.silent) {
                pushOperation({
                    action: 'scheduler.listTasks/getTaskCount',
                    status: 'success',
                    message: `已读取 ${normalizedTasks.length}/${nextCount} 个 showcase 任务`,
                    details: countFilter,
                })
            }
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'scheduler.listTasks/getTaskCount', status: 'error', message })
            if (!options.silent) notify.error(`刷新任务失败: ${message}`)
        } finally {
            if (!options.silent) setLoadingAction(null)
        }
    }, [loadTaskDetails, notify, offset, pageSize, pushOperation, scheduler, statusFilter, typeFilter])

    useEffect(() => {
        void refreshTasks({ silent: true })
    }, [refreshTasks])

    useEffect(() => {
        return () => {
            eventDisposerRef.current?.()
            eventDisposerRef.current = null
            void scheduler.unsubscribe()
        }
    }, [scheduler])

    const selectTask = useCallback(async (taskId: string) => {
        selectedTaskIdRef.current = taskId
        setSelectedTaskId(taskId)
        try {
            await loadTaskDetails(taskId)
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'scheduler.getTask/getExecutions', status: 'error', message })
            notify.error(`读取任务详情失败: ${message}`)
        }
    }, [loadTaskDetails, notify, pushOperation])

    const scheduleDelayTask = useCallback(async () => {
        setLoadingAction('delay')
        try {
            const task = await callShowcaseHost<SchedulerTask>('scheduleShowcaseDelayTask', {
                delayMs: Number(delayMs),
                message: delayMessage,
            })
            selectedTaskIdRef.current = task.id
            setSelectedTaskId(task.id)
            await refreshTasks({ silent: true })
            await loadTaskDetails(task.id)
            pushOperation({
                action: 'host.call scheduleShowcaseDelayTask',
                status: 'success',
                message: `已创建延迟任务 ${task.id}`,
                details: summarizeTask(task),
            })
            notify.success('延迟任务已创建')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call scheduleShowcaseDelayTask', status: 'error', message })
            notify.error(`创建延迟任务失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, delayMessage, delayMs, loadTaskDetails, notify, pushOperation, refreshTasks])

    const scheduleOnceTask = useCallback(async () => {
        setLoadingAction('once')
        try {
            const task = await callShowcaseHost<SchedulerTask>('scheduleShowcaseOnceTask', {
                delayMs: Number(onceDelayMs),
                message: onceMessage,
            })
            selectedTaskIdRef.current = task.id
            setSelectedTaskId(task.id)
            await refreshTasks({ silent: true })
            await loadTaskDetails(task.id)
            pushOperation({
                action: 'host.call scheduleShowcaseOnceTask',
                status: 'success',
                message: `已创建一次性任务 ${task.id}`,
                details: summarizeTask(task),
            })
            notify.success('一次性任务已创建')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call scheduleShowcaseOnceTask', status: 'error', message })
            notify.error(`创建一次性任务失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, loadTaskDetails, notify, onceDelayMs, onceMessage, pushOperation, refreshTasks])

    const scheduleRepeatTask = useCallback(async () => {
        setLoadingAction('repeat')
        try {
            const valid = await scheduler.validateCron(repeatCron.trim())
            if (!valid) {
                notify.warning('Cron 表达式无效')
                pushOperation({ action: 'scheduler.validateCron', status: 'warning', message: repeatCron })
                return
            }

            const task = await callShowcaseHost<SchedulerTask>('scheduleShowcaseRepeatTask', {
                cron: repeatCron.trim(),
                maxExecutions: Number(repeatMaxExecutions),
                message: repeatMessage,
            })
            selectedTaskIdRef.current = task.id
            setSelectedTaskId(task.id)
            await refreshTasks({ silent: true })
            await loadTaskDetails(task.id)
            pushOperation({
                action: 'host.call scheduleShowcaseRepeatTask',
                status: 'success',
                message: `已创建重复任务 ${task.id}`,
                details: summarizeTask(task),
            })
            notify.success('重复任务已创建')
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'host.call scheduleShowcaseRepeatTask', status: 'error', message })
            notify.error(`创建重复任务失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [callShowcaseHost, loadTaskDetails, notify, pushOperation, refreshTasks, repeatCron, repeatMaxExecutions, repeatMessage, scheduler])

    const runCronTools = useCallback(async () => {
        const expression = cronExpression.trim()
        if (!expression) {
            notify.warning('请输入 Cron 表达式')
            return
        }

        setLoadingAction('cron')
        try {
            const valid = await scheduler.validateCron(expression)
            setCronValid(valid)
            if (!valid) {
                setCronDescription('')
                setNextCronTime('')
                pushOperation({ action: 'scheduler.validateCron', status: 'warning', message: `${expression} 无效` })
                return
            }

            const [description, nextTime] = await Promise.all([
                scheduler.describeCron(expression),
                scheduler.getNextCronTime(expression),
            ])
            setCronDescription(description)
            setNextCronTime(formatDateTime(nextTime))
            pushOperation({
                action: 'scheduler.validateCron/describeCron/getNextCronTime',
                status: 'success',
                message: description,
                details: { expression, nextTime },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'scheduler.validateCron/describeCron/getNextCronTime', status: 'error', message })
            notify.error(`Cron 工具执行失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [cronExpression, notify, pushOperation, scheduler])

    const startEventSubscription = useCallback(async () => {
        setLoadingAction('subscribe')
        try {
            const result = await scheduler.subscribe()
            if (!result.success) {
                throw new Error(result.error || '订阅失败')
            }

            eventDisposerRef.current?.()
            eventDisposerRef.current = scheduler.onEvent((event) => {
                const schedulerEvent = event as SchedulerEvent
                setEvents(current => [schedulerEvent, ...current].slice(0, 30))
                void refreshTasks({ silent: true })

                const currentTaskId = selectedTaskIdRef.current
                if (schedulerEvent.taskId && schedulerEvent.taskId === currentTaskId) {
                    void loadTaskDetails(currentTaskId)
                }
            })
            setSubscribed(true)
            pushOperation({ action: 'scheduler.subscribe/onEvent', status: 'success', message: '已订阅调度事件' })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'scheduler.subscribe/onEvent', status: 'error', message })
            notify.error(`订阅事件失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [loadTaskDetails, notify, pushOperation, refreshTasks, scheduler])

    const stopEventSubscription = useCallback(async () => {
        setLoadingAction('subscribe')
        try {
            eventDisposerRef.current?.()
            eventDisposerRef.current = null
            const result = await scheduler.unsubscribe()
            if (!result.success) {
                throw new Error(result.error || '取消订阅失败')
            }
            setSubscribed(false)
            pushOperation({ action: 'scheduler.unsubscribe', status: 'success', message: '已取消调度事件订阅' })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'scheduler.unsubscribe', status: 'error', message })
            notify.error(`取消订阅失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [notify, pushOperation, scheduler])

    const controlSelectedTask = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
        if (!selectedTask) {
            notify.warning('请先选择任务')
            return
        }

        setLoadingAction('control')
        try {
            if (action === 'pause') {
                await scheduler.pauseTask(selectedTask.id)
            } else if (action === 'resume') {
                await scheduler.resumeTask(selectedTask.id)
            } else {
                await scheduler.cancelTask(selectedTask.id)
            }
            await refreshTasks({ silent: true })
            await loadTaskDetails(selectedTask.id)
            pushOperation({
                action: `scheduler.${action}Task`,
                status: 'success',
                message: `${action} ${selectedTask.id}`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: `scheduler.${action}Task`, status: 'error', message })
            notify.error(`任务控制失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [loadTaskDetails, notify, pushOperation, refreshTasks, scheduler, selectedTask])

    const deleteSelectedTask = useCallback(async () => {
        if (!selectedTask) {
            notify.warning('请先选择任务')
            return
        }
        if (!isTerminalTask(selectedTask)) {
            const confirmed = await confirmDialog(dialog, {
                title: '删除未完成任务',
                message: '该任务尚未进入终态，仍要删除这条任务记录吗？',
                confirmLabel: '删除',
            })
            if (!confirmed) return
        }

        setLoadingAction('delete')
        try {
            const result = await scheduler.deleteTasks([selectedTask.id])
            selectedTaskIdRef.current = ''
            setSelectedTaskId('')
            setSelectedTask(null)
            setExecutions([])
            await refreshTasks({ silent: true })
            pushOperation({
                action: 'scheduler.deleteTasks',
                status: result.success ? 'success' : 'warning',
                message: `删除 ${result.deletedCount} 条任务记录`,
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'scheduler.deleteTasks', status: 'error', message })
            notify.error(`删除任务失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, pushOperation, refreshTasks, scheduler, selectedTask])

    const cleanupTerminalTasks = useCallback(async () => {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
        const confirmed = await confirmDialog(dialog, {
            title: '清理终态任务',
            message: '将调用 scheduler.cleanupTasks 清理 7 天前已完成、失败或已取消的任务记录，继续？',
            confirmLabel: '清理',
        })
        if (!confirmed) return

        setLoadingAction('cleanup')
        try {
            const result = await scheduler.cleanupTasks(sevenDaysAgo)
            await refreshTasks({ silent: true })
            pushOperation({
                action: 'scheduler.cleanupTasks',
                status: result.success ? 'success' : 'warning',
                message: `清理 ${result.deletedCount} 条终态记录`,
                details: { olderThan: sevenDaysAgo },
            })
        } catch (error) {
            const message = getErrorMessage(error)
            pushOperation({ action: 'scheduler.cleanupTasks', status: 'error', message })
            notify.error(`清理任务失败: ${message}`)
        } finally {
            setLoadingAction(null)
        }
    }, [dialog, notify, pushOperation, refreshTasks, scheduler])

    const canGoPrevious = offset > 0
    const canGoNext = offset + pageSize < taskCount

    const rawData = useMemo(() => ({
        filters: {
            pluginId: SHOWCASE_PLUGIN_ID,
            statusFilter,
            typeFilter,
            pageSize,
            offset,
        },
        subscribed,
        taskCount,
        tasks: tasks.map(summarizeTask),
        selectedTask: selectedTask ? summarizeTask(selectedTask) : null,
        executions: executions.map(summarizeExecution),
        events: events.slice(0, 10),
        cron: {
            expression: cronExpression,
            valid: cronValid,
            description: cronDescription,
            nextTime: nextCronTime,
        },
        operationLog,
    }), [cronDescription, cronExpression, cronValid, events, executions, nextCronTime, offset, operationLog, pageSize, selectedTask, statusFilter, subscribed, taskCount, tasks, typeFilter])

    return (
        <div className="main-content">
            <PageHeader
                icon={CalendarClock}
                title="任务调度"
                description="创建插件后台任务，查看任务列表、执行历史、事件流和 Cron 工具"
                actions={(
                    <>
                        <Button variant="secondary" onClick={() => void refreshTasks()} loading={loadingAction === 'refresh'}>
                            <RefreshCw className="inline-icon" aria-hidden="true" size={14} />
                            刷新
                        </Button>
                        {subscribed ? (
                            <Button variant="secondary" onClick={() => void stopEventSubscription()} loading={loadingAction === 'subscribe'}>
                                <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                                停止事件
                            </Button>
                        ) : (
                            <Button variant="secondary" onClick={() => void startEventSubscription()} loading={loadingAction === 'subscribe'}>
                                <Activity className="inline-icon" aria-hidden="true" size={14} />
                                订阅事件
                            </Button>
                        )}
                    </>
                )}
            />

            <div className="page-with-api-panel">
                <div className="page-content">
                    <div className="stats-grid" style={{ marginBottom: 'var(--spacing-lg)' }}>
                        <div className="stat-item">
                            <div className="stat-value">{taskCount}</div>
                            <div className="stat-label">Showcase 任务总数</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{tasks.length}</div>
                            <div className="stat-label">当前页</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">
                                <StatusBadge status={subscribed ? 'success' : 'info'}>{subscribed ? '已订阅' : '未订阅'}</StatusBadge>
                            </div>
                            <div className="stat-label">事件流</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{selectedTask ? taskStatusLabel(selectedTask.status) : 'N/A'}</div>
                            <div className="stat-label">选中任务</div>
                        </div>
                    </div>

                    <Card title="过滤与分页" icon={Search}>
                        <div className="input-row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div className="input-group" style={{ width: 160 }}>
                                <label className="input-label" htmlFor="scheduler-status-filter">状态</label>
                                <select
                                    id="scheduler-status-filter"
                                    className="select"
                                    value={statusFilter}
                                    onChange={event => {
                                        setStatusFilter(event.target.value as StatusFilter)
                                        setOffset(0)
                                    }}
                                >
                                    {STATUS_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="input-group" style={{ width: 160 }}>
                                <label className="input-label" htmlFor="scheduler-type-filter">类型</label>
                                <select
                                    id="scheduler-type-filter"
                                    className="select"
                                    value={typeFilter}
                                    onChange={event => {
                                        setTypeFilter(event.target.value as TypeFilter)
                                        setOffset(0)
                                    }}
                                >
                                    {TYPE_OPTIONS.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="input-group" style={{ width: 120 }}>
                                <label className="input-label" htmlFor="scheduler-page-size">每页</label>
                                <input
                                    id="scheduler-page-size"
                                    className="input"
                                    type="number"
                                    min={5}
                                    max={50}
                                    value={pageSize}
                                    onChange={event => setPageSize(Math.max(5, Math.min(50, Number(event.target.value) || 20)))}
                                />
                            </div>
                            <Button variant="secondary" disabled={!canGoPrevious} onClick={() => setOffset(current => Math.max(0, current - pageSize))}>
                                上一页
                            </Button>
                            <Button variant="secondary" disabled={!canGoNext} onClick={() => setOffset(current => current + pageSize)}>
                                下一页
                            </Button>
                            <span className="list-row-meta">offset {offset}</span>
                        </div>
                    </Card>

                    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', marginTop: 'var(--spacing-lg)' }}>
                        <Card title="延迟任务" icon={Clock3}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-delay-ms">延迟毫秒</label>
                                    <input id="scheduler-delay-ms" className="input" type="number" min={1000} value={delayMs} onChange={event => setDelayMs(event.target.value)} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-delay-message">通知内容</label>
                                    <input id="scheduler-delay-message" className="input" value={delayMessage} onChange={event => setDelayMessage(event.target.value)} />
                                </div>
                                <Button onClick={() => void scheduleDelayTask()} loading={loadingAction === 'delay'}>
                                    <Bell className="inline-icon" aria-hidden="true" size={14} />
                                    创建延迟任务
                                </Button>
                            </div>
                        </Card>

                        <Card title="一次性任务" icon={CalendarClock}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-once-delay">多久后执行</label>
                                    <input id="scheduler-once-delay" className="input" type="number" min={1000} value={onceDelayMs} onChange={event => setOnceDelayMs(event.target.value)} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-once-message">通知内容</label>
                                    <input id="scheduler-once-message" className="input" value={onceMessage} onChange={event => setOnceMessage(event.target.value)} />
                                </div>
                                <Button onClick={() => void scheduleOnceTask()} loading={loadingAction === 'once'}>
                                    <CalendarClock className="inline-icon" aria-hidden="true" size={14} />
                                    创建一次性任务
                                </Button>
                            </div>
                        </Card>

                        <Card title="重复任务" icon={Repeat}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-repeat-cron">Cron</label>
                                    <input id="scheduler-repeat-cron" className="input" value={repeatCron} onChange={event => setRepeatCron(event.target.value)} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-repeat-limit">最大执行次数</label>
                                    <input id="scheduler-repeat-limit" className="input" type="number" min={1} max={24} value={repeatMaxExecutions} onChange={event => setRepeatMaxExecutions(event.target.value)} />
                                </div>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-repeat-message">通知内容</label>
                                    <input id="scheduler-repeat-message" className="input" value={repeatMessage} onChange={event => setRepeatMessage(event.target.value)} />
                                </div>
                                <Button onClick={() => void scheduleRepeatTask()} loading={loadingAction === 'repeat'}>
                                    <Repeat className="inline-icon" aria-hidden="true" size={14} />
                                    创建重复任务
                                </Button>
                            </div>
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card title="任务列表" icon={List}>
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {tasks.length > 0 ? tasks.map(task => (
                                    <button
                                        type="button"
                                        className="list-row"
                                        key={task.id}
                                        onClick={() => void selectTask(task.id)}
                                        style={{
                                            border: task.id === selectedTaskId ? '1px solid var(--accent)' : '1px solid transparent',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <StatusBadge status={statusBadge(task.status)}>{taskStatusLabel(task.status)}</StatusBadge>
                                        <span className="list-row-main">{task.name || task.id}</span>
                                        <span className="list-row-meta">{taskTypeLabel(task.type)}</span>
                                        <span className="list-row-meta">{formatTime(task.nextRunTime)}</span>
                                    </button>
                                )) : (
                                    <div className="empty-state">
                                        <CalendarClock aria-hidden="true" size={28} />
                                        <p>当前过滤条件下没有任务</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        <Card
                            title="任务详情与执行"
                            icon={BadgeInfo}
                            actions={selectedTask ? (
                                <>
                                    <Button variant="secondary" onClick={() => void controlSelectedTask('pause')} loading={loadingAction === 'control'} disabled={selectedTask.status !== 'pending'}>
                                        <Pause className="inline-icon" aria-hidden="true" size={14} />
                                        暂停
                                    </Button>
                                    <Button variant="secondary" onClick={() => void controlSelectedTask('resume')} loading={loadingAction === 'control'} disabled={selectedTask.status !== 'paused'}>
                                        <Play className="inline-icon" aria-hidden="true" size={14} />
                                        恢复
                                    </Button>
                                    <Button variant="secondary" onClick={() => void controlSelectedTask('cancel')} loading={loadingAction === 'control'} disabled={selectedTask.status === 'completed' || selectedTask.status === 'cancelled'}>
                                        <CircleStop className="inline-icon" aria-hidden="true" size={14} />
                                        取消
                                    </Button>
                                    <Button variant="secondary" onClick={() => void deleteSelectedTask()} loading={loadingAction === 'delete'}>
                                        <Trash2 className="inline-icon" aria-hidden="true" size={14} />
                                        删除
                                    </Button>
                                </>
                            ) : null}
                        >
                            {selectedTask ? (
                                <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                    <div className="info-grid">
                                        <span className="info-label">ID</span>
                                        <span className="info-value">{selectedTask.id}</span>
                                        <span className="info-label">类型</span>
                                        <span className="info-value">{taskTypeLabel(selectedTask.type)}</span>
                                        <span className="info-label">状态</span>
                                        <span className="info-value">{taskStatusLabel(selectedTask.status)}</span>
                                        <span className="info-label">回调</span>
                                        <span className="info-value">{selectedTask.callback || 'N/A'}</span>
                                        <span className="info-label">下次执行</span>
                                        <span className="info-value">{formatDateTime(selectedTask.nextRunTime)}</span>
                                        <span className="info-label">执行次数</span>
                                        <span className="info-value">{selectedTask.executionCount ?? 0} / {selectedTask.maxExecutions ?? 'N/A'}</span>
                                        <span className="info-label">失败次数</span>
                                        <span className="info-value">{selectedTask.failureCount ?? 0}</span>
                                    </div>
                                    <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                        {executions.length > 0 ? executions.map(execution => (
                                            <div className="list-row" key={execution.id}>
                                                <StatusBadge status={statusBadge(execution.status)}>{execution.status || 'unknown'}</StatusBadge>
                                                <span className="list-row-main">{formatDateTime(execution.startTime)}</span>
                                                <span className="list-row-meta">{formatDuration(execution.duration)}</span>
                                                <span className="list-row-meta">{execution.error || '无错误'}</span>
                                            </div>
                                        )) : (
                                            <div className="empty-state">暂无执行记录</div>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="empty-state">
                                    <BadgeInfo aria-hidden="true" size={28} />
                                    <p>请选择一个任务查看详情</p>
                                </div>
                            )}
                        </Card>
                    </div>

                    <div className="grid grid-2" style={{ marginTop: 'var(--spacing-lg)' }}>
                        <Card
                            title="Cron 工具"
                            icon={TimerReset}
                            actions={(
                                <Button variant="secondary" onClick={() => void runCronTools()} loading={loadingAction === 'cron'}>
                                    <TimerReset className="inline-icon" aria-hidden="true" size={14} />
                                    校验
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                <div className="input-group">
                                    <label className="input-label" htmlFor="scheduler-cron-tool">Cron 表达式</label>
                                    <input id="scheduler-cron-tool" className="input" value={cronExpression} onChange={event => setCronExpression(event.target.value)} />
                                </div>
                                <div className="info-grid">
                                    <span className="info-label">有效性</span>
                                    <span className="info-value">
                                        <StatusBadge status={cronValid === null ? 'info' : cronValid ? 'success' : 'error'}>
                                            {cronValid === null ? '未校验' : cronValid ? '有效' : '无效'}
                                        </StatusBadge>
                                    </span>
                                    <span className="info-label">描述</span>
                                    <span className="info-value">{cronDescription || 'N/A'}</span>
                                    <span className="info-label">下次执行</span>
                                    <span className="info-value">{nextCronTime || 'N/A'}</span>
                                </div>
                            </div>
                        </Card>

                        <Card
                            title="事件流与清理"
                            icon={Activity}
                            actions={(
                                <Button variant="secondary" onClick={() => void cleanupTerminalTasks()} loading={loadingAction === 'cleanup'}>
                                    <Eraser className="inline-icon" aria-hidden="true" size={14} />
                                    清理 7 天前终态
                                </Button>
                            )}
                        >
                            <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                {events.length > 0 ? events.slice(0, 8).map((event, index) => (
                                    <div className="list-row" key={`${event.type}-${event.timestamp}-${index}`}>
                                        <Activity className="inline-icon" aria-hidden="true" size={14} />
                                        <span className="list-row-main">{event.type}</span>
                                        <span className="list-row-meta">{event.taskId || `${event.deletedCount ?? 0} items`}</span>
                                        <span className="list-row-meta">{formatTime(event.timestamp)}</span>
                                    </div>
                                )) : (
                                    <div className="empty-state">
                                        <Activity aria-hidden="true" size={28} />
                                        <p>订阅事件后会显示任务创建、暂停、完成、失败等事件</p>
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
