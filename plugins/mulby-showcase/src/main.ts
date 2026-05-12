/**
 * Mulby Showcase - Backend Entry
 * 
 * 这个文件展示了插件后端的生命周期钩子和基本结构。
 * 对于纯 UI 插件，后端主要用于初始化和资源管理。
 */

interface PluginContext {
  api: {
    clipboard: {
      readText: () => string
      writeText: (text: string) => Promise<void>
      readImage: () => ArrayBuffer | null
      getFormat: () => string
    }
    clipboardHistory: ClipboardHistoryApi
    notification: {
      show: (message: string, type?: string) => void
    }
    storage: {
      get: (key: string) => Promise<unknown>
      set: (key: string, value: unknown) => Promise<void>
    }
    features: {
      getFeatures: (codes?: string[]) => Array<{ code: string }>
      setFeature: (feature: {
        code: string
        explain?: string
        icon?: string
        platform?: string | string[]
        mode?: 'ui' | 'silent' | 'detached'
        route?: string
        mainHide?: boolean
        mainPush?: boolean
        cmds: Array<string | { type: 'keyword' | 'regex'; value?: string; match?: string; explain?: string }>
      }) => void
      removeFeature: (code: string) => boolean
      redirectHotKeySetting: (cmdLabel: string, autocopy?: boolean) => void
      redirectAiModelsSetting: () => void
    }
  }
  input?: string
  featureCode?: string
}

type ClipboardHistoryType = 'text' | 'image' | 'files'

interface ClipboardHistoryQueryOptions {
  type?: ClipboardHistoryType
  search?: string
  favorite?: boolean
  limit?: number
  offset?: number
}

interface ClipboardHistoryItem {
  id: string
  type: ClipboardHistoryType
  content: string
  plainText?: string
  files?: string[]
  timestamp: number
  size: number
  favorite: boolean
  tags?: string[]
}

interface ClipboardHistoryStats {
  total: number
  text: number
  image: number
  files: number
  favorite: number
}

interface ClipboardHistoryApi {
  query: (options?: ClipboardHistoryQueryOptions) => Promise<ClipboardHistoryItem[]>
  get: (id: string) => Promise<ClipboardHistoryItem | null>
  copy: (id: string) => Promise<{ success: boolean; error?: string }>
  toggleFavorite: (id: string) => Promise<{ success: boolean }>
  delete: (id: string) => Promise<{ success: boolean }>
  clear: () => Promise<{ success: boolean }>
  stats: () => Promise<ClipboardHistoryStats>
}

interface BackendAiApi {
  call(option: AiOption): Promise<AiMessage>
}

interface AiToolDemoInput {
  model?: string
  prompt?: string
}

type SchedulerTaskKind = 'delay' | 'once' | 'repeat'

interface SchedulerTask {
  id: string
  pluginId?: string
  name: string
  type: SchedulerTaskKind
  status: string
  callback: string
  payload?: unknown
  createdAt?: number
  nextRunTime?: number
  executionCount?: number
  failureCount?: number
  [key: string]: unknown
}

interface SchedulerTaskPayload {
  message?: string
  label?: string
  kind?: SchedulerTaskKind
  createdAt?: number
  source?: string
}

interface SchedulerCallbackContext {
  api?: {
    notification?: {
      show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => Promise<void> | void
    }
  }
  payload?: SchedulerTaskPayload
  task?: SchedulerTask
}

interface ScheduleDelayTaskInput {
  delayMs?: number
  message?: string
  name?: string
}

interface ScheduleOnceTaskInput {
  delayMs?: number
  message?: string
  name?: string
}

interface ScheduleRepeatTaskInput {
  cron?: string
  maxExecutions?: number
  message?: string
  name?: string
}

interface BackendSchedulerApi {
  schedule(task: {
    name: string
    type: SchedulerTaskKind
    callback: string
    time?: number
    cron?: string
    delay?: number
    payload?: SchedulerTaskPayload
    maxRetries?: number
    retryDelay?: number
    timeout?: number
    description?: string
    endTime?: number
    maxExecutions?: number
  }): Promise<SchedulerTask>
}

declare const mulby: {
  clipboardHistory: ClipboardHistoryApi
  ai: BackendAiApi
  scheduler: BackendSchedulerApi
  notification: {
    show: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => Promise<void> | void
  }
}

const SHOWCASE_TASK_PREFIX = 'Mulby Showcase'

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numericValue = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numericValue)) return fallback
  return Math.max(min, Math.min(max, Math.round(numericValue)))
}

function normalizeSchedulerMessage(message: string | undefined, fallback: string) {
  const text = message?.trim()
  return text || fallback
}

function schedulerPayload(kind: SchedulerTaskKind, message: string, label: string): SchedulerTaskPayload {
  return {
    kind,
    message,
    label,
    createdAt: Date.now(),
    source: 'scheduler-module'
  }
}

function resolveSchedulerCallbackData(
  context?: SchedulerCallbackContext,
  payload?: SchedulerTaskPayload,
  task?: SchedulerTask
) {
  return {
    payload: payload ?? context?.payload ?? {},
    task: task ?? context?.task
  }
}

async function showSchedulerNotification(
  context: SchedulerCallbackContext | undefined,
  message: string,
  type: 'info' | 'success' | 'warning' | 'error' = 'success'
) {
  const notification = context?.api?.notification ?? mulby.notification
  await notification.show(message, type)
}

/**
 * 插件加载时调用
 * 用于初始化资源、注册服务等
 */
export function onLoad(context?: PluginContext) {
  console.log('[Mulby Showcase] 插件已加载')

  const features = context?.api.features
  if (!features) return

  registerDynamicFeatures(features)
}

/**
 * 插件卸载时调用
 * 用于清理资源、保存状态等
 */
export function onUnload() {
  console.log('[Mulby Showcase] 插件即将卸载')
}

/**
 * 插件启用时调用
 * 用于恢复服务、重新注册等
 */
export function onEnable() {
  console.log('[Mulby Showcase] 插件已启用')
}

/**
 * 插件禁用时调用
 * 用于暂停服务、释放资源等
 */
export function onDisable() {
  console.log('[Mulby Showcase] 插件已禁用')
}

/**
 * 主执行函数
 * 当用户触发插件时调用
 * 
 * @param context - 执行上下文
 * @param context.api - Mulby API 接口
 * @param context.input - 用户输入
 * @param context.feature - 触发的功能代码
 */
export async function run(context: PluginContext) {
  const { notification, clipboard } = context.api

  // 记录功能触发
  console.log(`[Mulby Showcase] 功能触发: ${context.featureCode || 'main'}`)

  // 对于 UI 插件，主要逻辑在前端处理
  // 这里可以做一些后端初始化工作

  // 示例：根据不同功能显示不同通知
  switch (context.featureCode) {
    case 'showcase:today': {
      const today = new Date().toLocaleDateString()
      await clipboard.writeText(today)
      notification.show(`今日日期：${today}`)
      break
    }
    case 'showcase:reverse': {
      const raw = (context.input || '').trim()
      let text = raw
      if (raw.toLowerCase().startsWith('rev ')) {
        text = raw.slice(4)
      } else if (raw.toLowerCase().startsWith('reverse ')) {
        text = raw.slice(8)
      }
      if (!text) {
        notification.show('请输入要反转的文本')
        break
      }
      const reversed = text.split('').reverse().join('')
      await clipboard.writeText(reversed)
      notification.show(`已复制反转结果：${reversed}`)
      break
    }
    case 'showcase:mac-only':
      notification.show('macOS 专用动态指令已触发')
      break
    case 'showcase:refresh-features': {
      const features = context.api.features
      if (!features) {
        notification.show('动态指令 API 不可用')
        break
      }
      for (const code of getDynamicFeatureCodes()) {
        features.removeFeature(code)
      }
      registerDynamicFeatures(features)
      notification.show('动态指令已清理并重新注册')
      break
    }
    case 'sysinfo':
      notification.show('正在加载系统信息...')
      break
    case 'clipboard':
      notification.show('剪贴板管理器已就绪')
      break
    case 'input':
      notification.show('输入控制已就绪')
      break
    case 'screenshot':
      notification.show('截图功能已就绪')
      break
    default:
      // 不显示通知，让 UI 自己处理
      break
  }
}

export async function onShowcaseDelayTask(
  context?: SchedulerCallbackContext,
  payload?: SchedulerTaskPayload,
  task?: SchedulerTask
) {
  const data = resolveSchedulerCallbackData(context, payload, task)
  const message = normalizeSchedulerMessage(data.payload.message, 'Showcase 延迟任务已执行')
  await showSchedulerNotification(context, message, 'success')

  return {
    success: true,
    kind: 'delay',
    message,
    taskId: data.task?.id,
    executedAt: new Date().toISOString()
  }
}

export async function onShowcaseOnceTask(
  context?: SchedulerCallbackContext,
  payload?: SchedulerTaskPayload,
  task?: SchedulerTask
) {
  const data = resolveSchedulerCallbackData(context, payload, task)
  const message = normalizeSchedulerMessage(data.payload.message, 'Showcase 一次性任务已执行')
  await showSchedulerNotification(context, message, 'success')

  return {
    success: true,
    kind: 'once',
    message,
    taskId: data.task?.id,
    executedAt: new Date().toISOString()
  }
}

export async function onShowcaseRepeatTask(
  context?: SchedulerCallbackContext,
  payload?: SchedulerTaskPayload,
  task?: SchedulerTask
) {
  const data = resolveSchedulerCallbackData(context, payload, task)
  const message = normalizeSchedulerMessage(data.payload.message, 'Showcase 重复任务已执行')
  await showSchedulerNotification(context, message, 'info')

  return {
    success: true,
    kind: 'repeat',
    message,
    taskId: data.task?.id,
    executionCount: data.task?.executionCount,
    executedAt: new Date().toISOString()
  }
}

export const rpc = {
  getShowcaseTime(input?: { timezone?: string }) {
    const timezone = input?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
    const now = new Date()

    return {
      iso: now.toISOString(),
      timezone,
      local: now.toLocaleString('zh-CN', { timeZone: timezone }),
      timestamp: now.getTime()
    }
  },

  getShowcaseEcho(input?: { text?: string; upperCase?: boolean }) {
    const text = input?.text || ''

    return {
      text: input?.upperCase ? text.toUpperCase() : text,
      length: text.length,
      receivedAt: new Date().toISOString()
    }
  },

  async runAiToolDemo(input?: AiToolDemoInput) {
    const prompt = input?.prompt?.trim() || '请先获取当前时间，再回显一段简短文本。'
    const option: AiOption = {
      model: input?.model || undefined,
      messages: [
        {
          role: 'system',
          content: '你正在 Mulby Showcase 示例插件中运行。需要本地信息时，优先调用提供的函数工具。'
        },
        { role: 'user', content: prompt }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'getShowcaseTime',
            description: '获取当前时间和时区信息。',
            parameters: {
              type: 'object',
              properties: {
                timezone: {
                  type: 'string',
                  description: '可选 IANA 时区，例如 Asia/Shanghai。'
                }
              },
              additionalProperties: false
            }
          }
        },
        {
          type: 'function',
          function: {
            name: 'getShowcaseEcho',
            description: '回显文本并返回长度，用于演示插件后端 helper 被 AI 工具调用。',
            parameters: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '要回显的文本。' },
                upperCase: { type: 'boolean', description: '是否转为大写。' }
              },
              required: ['text'],
              additionalProperties: false
            }
          }
        }
      ],
      maxToolSteps: 4,
      mcp: { mode: 'off' },
      skills: { mode: 'off' },
      toolingPolicy: { enableInternalTools: false },
      params: {
        temperature: 0.2,
        maxOutputTokens: 600
      }
    }

    const message = await mulby.ai.call(option)

    return {
      content: message.content,
      reasoning: message.reasoning_content,
      usage: message.usage,
      toolCall: message.tool_call,
      toolResult: message.tool_result,
      policyDebug: message.policy_debug
    }
  },

  queryClipboardHistory(options?: ClipboardHistoryQueryOptions) {
    return mulby.clipboardHistory.query(options)
  },

  getClipboardHistoryItem(id: string) {
    return mulby.clipboardHistory.get(id)
  },

  copyClipboardHistoryItem(id: string) {
    return mulby.clipboardHistory.copy(id)
  },

  toggleClipboardHistoryFavorite(id: string) {
    return mulby.clipboardHistory.toggleFavorite(id)
  },

  deleteClipboardHistoryItem(id: string) {
    return mulby.clipboardHistory.delete(id)
  },

  clearClipboardHistory() {
    return mulby.clipboardHistory.clear()
  },

  getClipboardHistoryStats() {
    return mulby.clipboardHistory.stats()
  },

  scheduleShowcaseDelayTask(input?: ScheduleDelayTaskInput) {
    const delayMs = clampNumber(input?.delayMs, 5000, 1000, 24 * 60 * 60 * 1000)
    const message = normalizeSchedulerMessage(input?.message, 'Showcase 延迟任务已执行')

    return mulby.scheduler.schedule({
      name: input?.name?.trim() || `${SHOWCASE_TASK_PREFIX} Delay`,
      description: 'Mulby Showcase 任务调度模块创建的延迟任务。',
      type: 'delay',
      delay: delayMs,
      callback: 'onShowcaseDelayTask',
      payload: schedulerPayload('delay', message, '延迟任务'),
      maxRetries: 0,
      timeout: 15000
    })
  },

  scheduleShowcaseOnceTask(input?: ScheduleOnceTaskInput) {
    const delayMs = clampNumber(input?.delayMs, 30000, 1000, 7 * 24 * 60 * 60 * 1000)
    const message = normalizeSchedulerMessage(input?.message, 'Showcase 一次性任务已执行')

    return mulby.scheduler.schedule({
      name: input?.name?.trim() || `${SHOWCASE_TASK_PREFIX} Once`,
      description: 'Mulby Showcase 任务调度模块创建的一次性任务。',
      type: 'once',
      time: Date.now() + delayMs,
      callback: 'onShowcaseOnceTask',
      payload: schedulerPayload('once', message, '一次性任务'),
      maxRetries: 0,
      timeout: 15000
    })
  },

  scheduleShowcaseRepeatTask(input?: ScheduleRepeatTaskInput) {
    const cron = input?.cron?.trim() || '0 */1 * * * *'
    const maxExecutions = clampNumber(input?.maxExecutions, 3, 1, 24)
    const message = normalizeSchedulerMessage(input?.message, 'Showcase 重复任务已执行')

    return mulby.scheduler.schedule({
      name: input?.name?.trim() || `${SHOWCASE_TASK_PREFIX} Repeat`,
      description: 'Mulby Showcase 任务调度模块创建的重复任务，默认限制执行次数以避免长期残留。',
      type: 'repeat',
      cron,
      callback: 'onShowcaseRepeatTask',
      payload: schedulerPayload('repeat', message, '重复任务'),
      maxExecutions,
      maxRetries: 0,
      timeout: 15000
    })
  }
}

// 同时导出为 module.exports 以保持兼容性
const plugin = { onLoad, onUnload, onEnable, onDisable, run }
export default plugin

function getDynamicFeatureCodes(): string[] {
  return [
    'showcase:today',
    'showcase:reverse',
    'showcase:mac-only',
    'showcase:refresh-features',
    'showcase:ui-settings',
    'showcase:ui-detached'
  ]
}

function registerDynamicFeatures(features: NonNullable<PluginContext['api']['features']>) {
  features.setFeature({
    code: 'showcase:today',
    explain: '动态指令：显示今日日期',
    mode: 'silent',
    cmds: ['today', '日期']
  })

  features.setFeature({
    code: 'showcase:reverse',
    explain: '动态指令：反转输入文本',
    mode: 'silent',
    cmds: [
      { type: 'keyword', value: 'reverse' },
      { type: 'regex', match: '^rev\\s+.+', explain: 'rev 开头文本' }
    ]
  })

  features.setFeature({
    code: 'showcase:mac-only',
    explain: '动态指令：仅 macOS 可见',
    mode: 'silent',
    platform: 'darwin',
    cmds: ['mac only', 'macos']
  })

  features.setFeature({
    code: 'showcase:refresh-features',
    explain: '动态指令：清理并刷新指令',
    mode: 'silent',
    cmds: ['清理动态指令', '刷新动态指令', 'refresh features']
  })

  features.setFeature({
    code: 'showcase:ui-settings',
    explain: '动态指令：打开设置面板',
    mode: 'ui',
    route: 'settings',
    cmds: ['showcase settings', 'showcase ui']
  })

  features.setFeature({
    code: 'showcase:ui-detached',
    explain: '动态指令：以独立窗口打开',
    mode: 'detached',
    route: 'settings',
    cmds: ['showcase detached', 'showcase window']
  })
}
