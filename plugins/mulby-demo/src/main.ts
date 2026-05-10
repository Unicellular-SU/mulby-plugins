/// <reference path="./types/mulby.d.ts" />

import { rmSync } from 'node:fs'
import { getCatalogSummary, publicApiCatalog, restrictedApiCatalog } from './shared/api-catalog'

type PluginContext = BackendPluginContext

interface SchedulerCallbackContext extends PluginContext {
  payload?: any
  task?: any
}

const lifecycleState = {
  loadedAt: '',
  loadCount: 0,
  enableCount: 0,
  disableCount: 0,
  unloadCount: 0,
  lastRun: null as null | {
    featureCode?: string
    input?: string
    attachmentCount: number
    at: string
  }
}

let apiRef: any | null = null

function rememberApi(context?: PluginContext) {
  if (context?.api) {
    apiRef = context.api
  }
  return apiRef
}

function backendApi() {
  const api = (globalThis as typeof globalThis & { mulby?: any }).mulby ?? apiRef
  if (!api) {
    throw new Error('Mulby backend API is not available. Run this example after the plugin host has loaded in Mulby.')
  }
  return api
}

function unwrapHostResult<T = unknown>(value: T | { data: T }): T {
  if (value && typeof value === 'object' && 'data' in value && Object.keys(value as Record<string, unknown>).length === 1) {
    return (value as { data: T }).data
  }
  return value as T
}

function toError(error: unknown) {
  return error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) }
}

async function filesystemRoundtrip(api: any) {
  const base = await api.system.getPath('temp')
  const dirPath = api.filesystem.join(base, `mulby-demo-${Date.now()}`)
  const filePath = api.filesystem.join(dirPath, 'source.txt')
  const copyPath = api.filesystem.join(dirPath, 'copy.txt')
  const movedPath = api.filesystem.join(dirPath, 'moved.txt')
  const content = `Mulby demo filesystem roundtrip ${new Date().toISOString()}`

  await api.filesystem.mkdir(dirPath)
  await api.filesystem.writeFile(filePath, content, 'utf-8')
  const exists = await api.filesystem.exists(filePath)
  const readBack = await api.filesystem.readFile(filePath, 'utf-8')
  const stat = await api.filesystem.stat(filePath)
  const ext = api.filesystem.extname?.(filePath)
  const dirname = api.filesystem.dirname?.(filePath)
  const basename = api.filesystem.basename?.(filePath)
  const dataPath = api.filesystem.getDataPath?.('examples', 'filesystem')
  await api.filesystem.copy(filePath, copyPath)
  await api.filesystem.move(copyPath, movedPath)
  const entriesBeforeCleanup = await api.filesystem.readdir(dirPath)
  await api.filesystem.unlink(filePath)
  await api.filesystem.unlink(movedPath)
  rmSync(dirPath, { recursive: true, force: true })

  return {
    dirPath,
    filePath,
    exists,
    readBack,
    size: stat?.size,
    entriesBeforeCleanup,
    cleanup: 'Mulby filesystem.unlink removes files. The demo directory is removed with Node rmSync after all filesystem APIs run.',
    pathHelpers: {
      ext,
      dirname,
      basename,
      dataPath
    }
  }
}

async function windowDragFile(api: any) {
  const base = await api.system.getPath('temp')
  const filePath = api.filesystem.join(base, `mulby-demo-drag-${Date.now()}.txt`)
  await api.filesystem.writeFile(filePath, 'Mulby demo native drag payload', 'utf-8')
  return { filePath }
}

async function shellRunCommand(api: any) {
  return api.shell.runCommand({
    command: process.execPath,
    args: ['-e', 'console.log(JSON.stringify({source:"mulby-demo", ok:true}))'],
    timeoutMs: 10000,
    shell: false
  })
}

async function shellSystemActions(api: any) {
  const base = await api.system.getPath('temp')
  const filePath = api.filesystem.join(base, `mulby-demo-shell-${Date.now()}.txt`)
  const trashPath = api.filesystem.join(base, `mulby-demo-trash-${Date.now()}.txt`)
  await api.filesystem.writeFile(filePath, 'Mulby demo shell file', 'utf-8')
  await api.filesystem.writeFile(trashPath, 'Mulby demo trash file', 'utf-8')
  const beep = await api.shell.beep()
  const openPath = await api.shell.openPath(filePath)
  const showItemInFolder = await api.shell.showItemInFolder(filePath)
  const openFolder = await api.shell.openFolder(base)
  const openExternal = await api.shell.openExternal('https://example.com')
  const trashItem = await api.shell.trashItem(trashPath)
  await api.filesystem.unlink(filePath).catch(() => undefined)
  return { filePath, trashPath, beep, openPath, showItemInFolder, openFolder, openExternal, trashItem }
}

async function shellPolicyAudit(api: any) {
  const [policy, audit] = await Promise.all([
    api.shell.getRunCommandPolicy(),
    api.shell.listRunCommandAudit(5)
  ])
  return { policy, audit }
}

async function registerDynamicFeature(api: any) {
  const feature = {
    code: 'dynamic-docs-storage',
    explain: '动态注册：打开 Storage API 示例',
    mode: 'ui',
    route: '#storage',
    cmds: [
      { type: 'keyword', value: 'mulby demo storage' }
    ]
  }

  await api.features.setFeature(feature)
  const features = await api.features.getFeatures(['dynamic-docs-storage'])
  return { feature, features }
}

async function registerDynamicMainPushFeature(api: any) {
  const feature = {
    code: 'dynamic-docs-main-push',
    explain: '动态注册：MainPush API 示例',
    mode: 'ui',
    route: '#features',
    mainPush: true,
    cmds: [
      { type: 'over', label: 'Mulby demo MainPush', minLength: 1, maxLength: 80 }
    ]
  }

  await api.features.setFeature(feature)
  const features = await api.features.getFeatures(['dynamic-docs-main-push'])
  return { feature, features }
}

async function removeDynamicFeature(api: any) {
  const removed = await api.features.removeFeature('dynamic-docs-storage')
  const removedMainPush = await api.features.removeFeature('dynamic-docs-main-push')
  const features = await api.features.getFeatures(['dynamic-docs-storage', 'dynamic-docs-main-push'])
  return { removed, removedMainPush, features }
}

async function redirectFeatureSettings(api: any) {
  const hotKey = await api.features.redirectHotKeySetting?.('Mulby demo MainPush')
  const aiModels = await api.features.redirectAiModelsSetting?.()
  return { hotKey, aiModels }
}

async function registerMainPushHandlers(api: any) {
  await api.features.onMainPush?.((action: { code: string; type: string; payload: string }) => [
    {
      title: `Mulby demo option for ${action.payload || action.code}`,
      text: `Generated by features.onMainPush at ${new Date().toLocaleTimeString()}`,
      code: action.code,
      payload: action.payload
    }
  ])
  await api.features.onMainPushSelect?.((action: { code: string; option?: unknown }) => {
    return {
      handled: true,
      code: action.code,
      option: action.option
    }
  })
  return { registered: true }
}

async function schedulerDescribe(api: any) {
  const expression = '0 */30 * * * *'
  return {
    expression,
    valid: await api.scheduler.validateCron(expression),
    nextTime: await api.scheduler.getNextCronTime(expression),
    description: await api.scheduler.describeCron(expression)
  }
}

async function schedulerDelayTask(api: any) {
  const task = await api.scheduler.schedule({
    name: 'Mulby demo delayed notification',
    type: 'delay',
    delay: 5000,
    callback: 'onDemoScheduledTask',
    payload: {
      message: 'Mulby demo scheduler callback executed.'
    },
    timeout: 10000
  })

  return {
    id: task.id,
    name: task.name,
    status: task.status,
    nextRunTime: task.nextRunTime
  }
}

async function schedulerLifecycle(api: any) {
  const task = await api.scheduler.schedule({
    name: 'Mulby demo scheduler lifecycle task',
    type: 'delay',
    delay: 60000,
    callback: 'onDemoScheduledTask',
    payload: { message: 'Mulby demo scheduler lifecycle task.' },
    timeout: 10000
  })

  const created = await api.scheduler.get(task.id)
  await api.scheduler.pause(task.id)
  const paused = await api.scheduler.get(task.id)
  await api.scheduler.resume(task.id)
  const resumed = await api.scheduler.get(task.id)
  const list = await api.scheduler.list({ limit: 10 })
  await api.scheduler.cancel(task.id)
  const cancelled = await api.scheduler.get(task.id)
  const executions = await api.scheduler.getExecutions?.(task.id, 5)

  return {
    taskId: task.id,
    created,
    paused,
    resumed,
    cancelled,
    listCount: Array.isArray(list) ? list.length : undefined,
    executions
  }
}

async function schedulerRendererCleanup(api: any) {
  const tasks = await api.scheduler.listTasks({ pluginId: 'mulby-demo', limit: 20 })
  const count = await api.scheduler.getTaskCount({ pluginId: 'mulby-demo' })
  const task = Array.isArray(tasks)
    ? tasks.find((item: any) => item?.name === 'Mulby demo scheduler lifecycle task' || item?.name === 'Mulby demo delayed notification')
    : null
  const taskDetail = task ? await api.scheduler.getTask(task.id) : null
  let deleteResult: unknown = null
  if (task?.id) {
    deleteResult = await api.scheduler.deleteTasks([task.id])
  }
  return { count, taskDetail, deleteResult, listed: Array.isArray(tasks) ? tasks.length : tasks }
}

async function lifecycleSnapshot(api: any) {
  const stored = await api.storage.get('mulby-demo:lifecycle')
  return {
    ...lifecycleState,
    stored
  }
}

async function hostInvokeSystemInfo(api: any) {
  const info = await api.system.getSystemInfo()
  return {
    platform: info.platform,
    arch: info.arch,
    cpus: info.cpus
  }
}

async function messagingLoopback(api: any) {
  const received: unknown[] = []
  const handler = (message: unknown) => {
    received.push(message)
  }

  await api.messaging.on(handler)
  await api.messaging.send('mulby-demo', 'mulby-demo:direct', { at: new Date().toISOString() })
  await api.messaging.broadcast('mulby-demo:broadcast', { at: new Date().toISOString() })
  await new Promise((resolve) => setTimeout(resolve, 200))
  await api.messaging.off(handler)
  await api.messaging.off()

  return { received }
}

function trayIcon(color = '#2563eb') {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${color}"/><path d="M18 42V22h8l6 10 6-10h8v20h-7V30l-5 8h-4l-5-8v12h-7z" fill="white"/></svg>`
  )
}

async function trayCreate(api: any) {
  const created = await api.tray.create({
    icon: trayIcon(),
    tooltip: 'Mulby demo tray API',
    title: 'Demo'
  })
  const exists = await api.tray.exists()
  return { created, exists, keptVisible: true }
}

async function trayStatus(api: any) {
  return { exists: await api.tray.exists() }
}

async function trayUpdate(api: any) {
  await api.tray.setTooltip(`Mulby demo tray tooltip ${new Date().toLocaleTimeString()}`)
  await api.tray.setTitle('API')
  await api.tray.setIcon(trayIcon('#0f766e'))
  return { exists: await api.tray.exists(), updated: true }
}

async function trayDestroy(api: any) {
  await api.tray.destroy()
  return { exists: await api.tray.exists(), destroyed: true }
}

async function trayLifecycle(api: any) {
  const icon = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><path d="M18 42V22h8l6 10 6-10h8v20h-7V30l-5 8h-4l-5-8v12h-7z" fill="white"/></svg>'
  )
  const created = await api.tray.create({
    icon,
    tooltip: 'Mulby demo tray API',
    title: 'Demo'
  })
  const existsAfterCreate = await api.tray.exists()
  await api.tray.setTooltip('Mulby demo tray tooltip updated')
  await api.tray.setTitle('API')
  await api.tray.setIcon(icon)
  await api.tray.destroy()
  const existsAfterDestroy = await api.tray.exists()
  return { created, existsAfterCreate, existsAfterDestroy }
}

async function backendStorageRoundtrip(api: any) {
  const key = 'mulby-demo:backend-storage'
  const value = { at: new Date().toISOString(), source: 'backend' }
  await api.storage.set(key, value)
  const readBack = await api.storage.get(key)
  const has = await api.storage.has?.(key)
  const keys = await api.storage.keys()
  await api.storage.bulkSet?.({
    'mulby-demo:backend-bulk-a': { index: 1 },
    'mulby-demo:backend-bulk-b': { index: 2 }
  })
  const all = await api.storage.getAll?.()
  await api.storage.remove(key)
  await api.storage.remove('mulby-demo:backend-bulk-a')
  await api.storage.remove('mulby-demo:backend-bulk-b')
  await api.storage.clear()
  await api.storage.set('mulby-demo:lifecycle', {
    loadedAt: lifecycleState.loadedAt,
    loadCount: lifecycleState.loadCount,
    restoredAfterClear: true
  })
  return {
    value: readBack,
    has,
    hadKey: keys.includes(key),
    keys: keys.filter((item: string) => item.startsWith('mulby-demo')),
    allBeforeClear: all,
    clearedAndRestoredLifecycle: true
  }
}

async function clipboardHistoryStats(api: any) {
  const stats = await api.clipboardHistory.stats()
  return { stats }
}

async function clipboardHistoryQuery(api: any) {
  const records = await api.clipboardHistory.query({ limit: 5 })
  const first = records[0]
  const firstRecord = first ? await api.clipboardHistory.get(first.id) : null
  let copyResult: unknown = null
  let favoriteToggle: unknown = null

  if (first) {
    copyResult = await api.clipboardHistory.copy(first.id)
    const one = await api.clipboardHistory.toggleFavorite(first.id)
    const two = await api.clipboardHistory.toggleFavorite(first.id)
    favoriteToggle = { one, two }
  }

  return {
    records: records.map((item: any) => ({
      id: item.id,
      type: item.type,
      size: item.size,
      favorite: item.favorite,
      timestamp: item.timestamp
    })),
    firstRecord: firstRecord ? { id: firstRecord.id, type: firstRecord.type, favorite: firstRecord.favorite } : null,
    copyResult,
    favoriteToggle
  }
}

async function clipboardHistoryDeleteGuard(api: any) {
  const deleteResult = await api.clipboardHistory.delete('mulby-demo-nonexistent-id')
  return {
    deleteResult,
    clear: 'Not executed by default because it clears user clipboard history. The API call is intentionally shown in the snippet for explicit manual use.'
  }
}

async function backendSharpSample(api: any) {
  const result = await api.sharp.execute({
    input: {
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: 37, g: 99, b: 235, alpha: 1 }
      }
    },
    operations: [
      { method: 'resize', args: [8, 8] },
      { method: 'metadata', args: [] }
    ]
  })
  return result
}

async function backendAiSnapshot(api: any) {
  const [models, enabledSkills] = await Promise.all([
    api.ai.allModels(),
    api.ai.skills?.listEnabled?.()
  ])
  return {
    models: Array.isArray(models) ? models.slice(0, 5).map((model: any) => ({
      id: model.id,
      label: model.label ?? model.name,
      providerRef: model.providerRef ?? model.providerId
    })) : models,
    enabledSkillCount: Array.isArray(enabledSkills) ? enabledSkills.length : undefined
  }
}

async function pluginToolEcho(api: any) {
  return api.tools.register('mulby_demo_runtime_echo', async (args: unknown) => ({
    ok: true,
    args,
    at: new Date().toISOString()
  }))
}

async function pluginToolUnregister(api: any) {
  return api.tools.unregister('mulby_demo_runtime_echo')
}

const backendExamples: Record<string, (api: any) => Promise<unknown>> = {
  filesystemRoundtrip,
  windowDragFile,
  shellSystemActions,
  shellPolicyAudit,
  shellRunCommand,
  registerDynamicFeature,
  registerDynamicMainPushFeature,
  removeDynamicFeature,
  redirectFeatureSettings,
  registerMainPushHandlers,
  schedulerDescribe,
  schedulerDelayTask,
  schedulerLifecycle,
  schedulerRendererCleanup,
  lifecycleState: lifecycleSnapshot,
  hostInvokeSystemInfo,
  messagingLoopback,
  trayCreate,
  trayStatus,
  trayUpdate,
  trayDestroy,
  trayLifecycle,
  backendStorageRoundtrip,
  clipboardHistoryStats,
  clipboardHistoryQuery,
  clipboardHistoryDeleteGuard,
  backendSharpSample,
  backendAiSnapshot,
  pluginToolEcho,
  pluginToolUnregister
}

export async function onLoad(context?: PluginContext) {
  const api = rememberApi(context)
  lifecycleState.loadedAt = new Date().toISOString()
  lifecycleState.loadCount += 1

  if (api?.storage) {
    await api.storage.set('mulby-demo:lifecycle', {
      loadedAt: lifecycleState.loadedAt,
      loadCount: lifecycleState.loadCount
    })
  }

  if (api?.tools) {
    await api.tools.register('mulby_demo_echo', async (args: any) => ({
      ok: true,
      echoed: args,
      at: new Date().toISOString()
    }))

    await api.tools.register('mulby_demo_catalog', async () => ({
      ...getCatalogSummary(),
      publicApis: publicApiCatalog.map((entry) => entry.code),
      restrictedApis: restrictedApiCatalog.map((entry) => entry.code)
    }))
  }
}

export async function onUnload(context?: PluginContext) {
  const api = rememberApi(context)
  lifecycleState.unloadCount += 1
  if (api?.tools) {
    await api.tools.unregister('mulby_demo_echo')
    await api.tools.unregister('mulby_demo_catalog')
  }
}

export async function onEnable(context?: PluginContext) {
  rememberApi(context)
  lifecycleState.enableCount += 1
}

export async function onDisable(context?: PluginContext) {
  rememberApi(context)
  lifecycleState.disableCount += 1
}

export async function run(context: PluginContext) {
  const api = rememberApi(context)
  lifecycleState.lastRun = {
    featureCode: context.featureCode,
    input: context.input,
    attachmentCount: context.attachments?.length ?? 0,
    at: new Date().toISOString()
  }

  if (context.featureCode === 'run-smoke-demo' && api) {
    const summary = getCatalogSummary()
    await api.notification.show(`Mulby demo covers ${summary.publicApiCount} public API modules.`, 'success')
    return summary
  }

  return lifecycleState.lastRun
}

export async function onDemoScheduledTask(context: SchedulerCallbackContext, payload?: any, task?: any) {
  const api = rememberApi(context)
  const message = payload?.message ?? context.payload?.message ?? 'Mulby demo scheduler callback executed.'
  if (api?.notification) {
    await api.notification.show(message, 'success')
  }
  return {
    ok: true,
    message,
    taskId: task?.id ?? context.task?.id,
    at: new Date().toISOString()
  }
}

export const host = {
  async echo(_context: PluginContext, payload: unknown) {
    return {
      ok: true,
      payload,
      at: new Date().toISOString()
    }
  },

  async listBackendExamples() {
    return Object.keys(backendExamples)
  },

  async getCatalogSummary() {
    return {
      ...getCatalogSummary(),
      publicApis: publicApiCatalog.map((entry) => ({
        code: entry.code,
        title: entry.title,
        category: entry.category
      })),
      restrictedApis: restrictedApiCatalog.map((entry) => ({
        code: entry.code,
        title: entry.title,
        reason: entry.reason
      }))
    }
  },

  async runBackendExample(context: PluginContext, exampleId: string) {
    const api = rememberApi(context)
    const example = backendExamples[exampleId]
    if (!example) {
      throw new Error(`Unknown backend example: ${exampleId}`)
    }

    try {
      return await example(api)
    } catch (error) {
      return {
        ok: false,
        exampleId,
        error: toError(error)
      }
    }
  }
}

export const rpc = {
  async echo(payload: unknown) {
    return {
      ok: true,
      payload,
      at: new Date().toISOString()
    }
  },

  async listBackendExamples() {
    return Object.keys(backendExamples)
  },

  async getCatalogSummary() {
    return {
      ...getCatalogSummary(),
      publicApis: publicApiCatalog.map((entry) => ({
        code: entry.code,
        title: entry.title,
        category: entry.category
      })),
      restrictedApis: restrictedApiCatalog.map((entry) => ({
        code: entry.code,
        title: entry.title,
        reason: entry.reason
      }))
    }
  },

  async runBackendExample(exampleId: string) {
    const api = backendApi()
    const example = backendExamples[exampleId]
    if (!example) {
      throw new Error(`Unknown backend example: ${exampleId}`)
    }

    try {
      return unwrapHostResult(await example(api))
    } catch (error) {
      return {
        ok: false,
        exampleId,
        error: toError(error)
      }
    }
  }
}

export default {
  onLoad,
  onUnload,
  onEnable,
  onDisable,
  run,
  onDemoScheduledTask,
  host,
  rpc
}
