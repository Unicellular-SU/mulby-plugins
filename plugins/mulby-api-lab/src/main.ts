/// <reference path="./types/mulby.d.ts" />

const PLUGIN_ID = 'mulby-api-lab'
const TAG = '[mulby-api-lab]'

const dynamicFeatureCodes = [
  'lab:dynamic-today',
  'lab:dynamic-ui-storage',
  'lab:dynamic-window-screen',
  'lab:dynamic-refresh'
]

const manifestFeatureRoutes: Record<string, string> = {
  'lab-main': 'overview',
  'lab-search': 'search',
  'lab-files': 'attachments',
  'lab-over': 'input',
  'lab-precapture': 'screen',
  'lab-silent': 'silent',
  'lab-mainpush': 'plugin',
  'lab-window': 'window'
}

const moduleSummaries: Record<string, string> = {
  system: 'System API exposes app and operating-system metadata, paths, resource usage, and active-window inspection.',
  power: 'Power API reports idle state, battery state, thermal state, and power lifecycle events.',
  tray: 'Tray and trayMenu APIs create plugin tray entries and inspect host tray menu state.',
  permission: 'Permission API checks and requests host-mediated system permissions.',
  security: 'Security API encrypts and decrypts small secrets through OS-backed secure storage.',
  settings: 'Settings API reads and updates Mulby host settings, shortcut recording, startup, and update center state.',
  developer: 'Developer API manages plugin development paths and reloads plugin metadata.',
  app: 'App event APIs expose host-level navigation and plugin lifecycle events to renderer code.',
  log: 'Log API writes, queries, subscribes to, and locates Mulby logs.',
  ai: 'AI API calls text, image, token, model, MCP, skill, and plugin-tool capabilities.',
  window: 'Window API controls attached, detached, child, borderless, search, drag, opacity, and state behavior.',
  theme: 'Theme API reads and sets Mulby color mode and receives theme changes.',
  dialog: 'Dialog API shows open, save, message, and error boxes.',
  menu: 'Menu API opens native context menus and returns the selected item id.',
  notification: 'Notification API sends host notifications.',
  tts: 'TTS API speaks text and controls browser speech synthesis.',
  superPanel: 'Super Panel API inspects and controls the host panel state.',
  shortcut: 'Shortcut API registers global shortcuts and receives trigger events.',
  clipboard: 'Clipboard and clipboardHistory APIs read, write, query, copy, and manage clipboard content.',
  input: 'Input API pastes, types, restores windows, and simulates safe input events.',
  inputMonitor: 'Input Monitor API subscribes to global keyboard and mouse events after permission checks.',
  plugin: 'Plugin API lists, searches, runs, manages, pins, hides, and inspects plugins and commands.',
  pluginStore: 'Plugin Store API fetches store metadata, installs from URLs, and checks installed updates.',
  host: 'Host API lets renderer code call backend rpc methods and status operations.',
  scheduler: 'Scheduler API creates, lists, cancels, pauses, resumes, validates, and receives task events.',
  features: 'Features API registers dynamic commands and MainPush search result callbacks.',
  messaging: 'Messaging API sends, broadcasts, subscribes to, and unsubscribes plugin messages.',
  inbrowser: 'InBrowser API automates isolated browser sessions for navigation, interaction, extraction, and downloads.',
  filesystem: 'Filesystem API reads and writes files through plugin-scoped host operations.',
  storage: 'Storage API stores simple, encrypted, attachment, watched, versioned, and transactional plugin data.',
  shell: 'Shell API opens paths and URLs, shows files, beeps, trashes items, and runs policy-guarded commands.',
  desktop: 'Desktop API searches files and applications.',
  http: 'HTTP API performs host-side GET, POST, PUT, DELETE, and custom requests.',
  network: 'Network API checks online state and receives online/offline events.',
  geolocation: 'Geolocation API checks access and retrieves current location when allowed.',
  media: 'Media API checks camera and microphone permission and browser media access.',
  screen: 'Screen API lists displays and capture sources, captures screens or regions, and picks colors.',
  sharp: 'Sharp API performs host-provided image processing through chainable renderer operations or backend execute.',
  ffmpeg: 'FFmpeg API downloads, checks, and runs audio/video processing tasks.'
}

const manifestFeatureRoutesForContract = {
  'lab-main': 'system',
  'lab-search': 'plugin',
  'lab-files': 'manifest',
  'lab-over': 'input',
  'lab-precapture': 'screen',
  'lab-silent': 'silent backend smoke test',
  'lab-mainpush': 'features',
  'lab-window': 'window'
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeError(error: unknown) {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : 'Error'
  }
}

function toPlain(value: unknown) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

async function notify(message: string, type: string = 'info') {
  try {
    await mulby.notification.show(message, type)
  } catch (error) {
    console.warn(`${TAG} notification failed`, error)
  }
}

async function registerTools(api: BackendMulbyAPI) {
  api.tools.register('echo', async (args: AnyRecord, ctx) => {
    ctx?.sendProgress?.({ progress: 1, total: 2, message: 'Validating input' })
    const message = typeof args?.message === 'string' ? args.message : ''
    ctx?.sendProgress?.({ progress: 2, total: 2, message: 'Returning echo payload' })
    return { ok: true, message, receivedAt: Date.now() }
  })

  api.tools.register('summarize_api_module', async (args: AnyRecord, ctx) => {
    ctx?.sendProgress?.({ progress: 1, total: 2, message: 'Looking up API module' })
    const moduleId = String(args?.moduleId || '').trim()
    const summary = moduleSummaries[moduleId] || 'Unknown API module. Use the API Lab UI to browse available module ids.'
    ctx?.sendProgress?.({ progress: 2, total: 2, message: 'Summary ready' })
    return { ok: Boolean(moduleSummaries[moduleId]), moduleId, summary }
  })

  api.tools.register('safe_file_probe', async (args: AnyRecord, ctx) => {
    ctx?.sendProgress?.({ progress: 1, total: 3, message: 'Reading path argument' })
    const filePath = String(args?.path || '').trim()
    if (!filePath) {
      return { ok: false, error: 'path is required' }
    }
    ctx?.sendProgress?.({ progress: 2, total: 3, message: 'Checking file metadata' })
    const exists = await api.filesystem.exists(filePath)
    const stat = exists ? await api.filesystem.stat(filePath) : null
    ctx?.sendProgress?.({ progress: 3, total: 3, message: 'Probe complete' })
    return { ok: true, path: filePath, exists, stat: toPlain(stat) }
  })
}

async function registerDynamicFeatures(api: BackendMulbyAPI) {
  await api.features.setFeature({
    code: 'lab:dynamic-today',
    explain: 'API Lab 动态指令：复制今日日期',
    mode: 'silent',
    cmds: ['api today', 'api日期']
  })

  await api.features.setFeature({
    code: 'lab:dynamic-ui-storage',
    explain: 'API Lab 动态指令：打开存储模块',
    mode: 'ui',
    route: 'storage',
    cmds: ['api storage', 'api存储']
  })

  await api.features.setFeature({
    code: 'lab:dynamic-window-screen',
    explain: 'API Lab 动态指令：独立窗口打开屏幕模块',
    mode: 'detached',
    route: 'screen',
    cmds: ['api screen window', 'api屏幕窗口']
  })

  await api.features.setFeature({
    code: 'lab:dynamic-refresh',
    explain: 'API Lab 动态指令：刷新动态指令',
    mode: 'silent',
    cmds: ['api refresh features', 'api刷新指令']
  })
}

async function registerMainPush(api: BackendMulbyAPI) {
  await api.features.onMainPush(async (action) => {
    const payload = (action.payload || '').replace(/^api-push\s*/i, '').trim().toLowerCase()
    const entries = Object.entries(moduleSummaries)
      .filter(([id, summary]) => !payload || id.includes(payload) || summary.toLowerCase().includes(payload))
      .slice(0, 6)

    return entries.map(([id, summary]) => ({
      title: `API Lab: ${id}`,
      text: summary,
      moduleId: id
    }))
  })

  await api.features.onMainPushSelect(async (action) => {
    const moduleId = String(action.option?.moduleId || '')
    if (moduleId) {
      await api.storage.set('mainpush:last-selection', { moduleId, selectedAt: Date.now() })
      await notify(`MainPush 已选择 ${moduleId}`, 'success')
    }
    return true
  })
}

export async function onLoad(context?: { api: BackendMulbyAPI }) {
  console.log(`${TAG} loaded at ${nowIso()}`)
  const api = context?.api || mulby
  await registerTools(api)
  await registerDynamicFeatures(api)
  await registerMainPush(api)
}

export function onUnload(context?: { api: BackendMulbyAPI }) {
  console.log(`${TAG} unloaded at ${nowIso()}`)
  const api = context?.api || mulby
  try {
    api.tools.unregister('echo')
    api.tools.unregister('summarize_api_module')
    api.tools.unregister('safe_file_probe')
  } catch {}
}

export function onEnable() {
  console.log(`${TAG} enabled`)
}

export function onDisable() {
  console.log(`${TAG} disabled`)
}

export async function onBackground(context?: { api: BackendMulbyAPI }) {
  const api = context?.api || mulby
  try {
    api.messaging.on(async (message: AnyRecord) => {
      if (message?.type === 'api-lab:ping') {
        await api.messaging.send(message.from, 'api-lab:pong', {
          from: PLUGIN_ID,
          receivedAt: Date.now(),
          payload: message.payload
        })
      }
    })
  } catch (error) {
    console.warn(`${TAG} background messaging unavailable`, error)
  }
}

export async function run(context: BackendPluginContext) {
  const api = context.api
  const featureCode = context.featureCode || 'lab-main'
  console.log(`${TAG} run feature=${featureCode} route=${manifestFeatureRoutes[featureCode] || 'dynamic'}`)

  if (featureCode === 'lab-silent') {
    const appInfo = await api.system.getAppInfo()
    const online = await api.network.isOnline()
    await api.storage.set('silent:last-smoke', {
      at: Date.now(),
      appInfo,
      online
    })
    await notify('API Lab 安全自检完成', 'success')
    return
  }

  if (featureCode === 'lab:dynamic-today') {
    const today = new Date().toLocaleDateString()
    await api.clipboard.writeText(today)
    await notify(`今日日期已复制：${today}`, 'success')
    return
  }

  if (featureCode === 'lab:dynamic-refresh') {
    for (const code of dynamicFeatureCodes) {
      await api.features.removeFeature(code)
    }
    await registerDynamicFeatures(api)
    await notify('API Lab 动态指令已刷新', 'success')
  }
}

export async function onApiLabScheduled(context: { api: BackendMulbyAPI }, payload: AnyRecord, task: TaskLike) {
  await context.api.storage.set('scheduler:last-callback', {
    payload,
    taskId: task?.id,
    ranAt: Date.now()
  })
  await notify(`API Lab 调度任务已执行：${payload?.message || task?.name || 'sample'}`, 'success')
  return { ok: true, payload, taskId: task?.id, ranAt: Date.now() }
}

export const rpc = {
  async getEnvironmentReport() {
    const pathNames = ['home', 'temp', 'desktop', 'documents', 'downloads', 'logs', 'userData']
    const pathEntries = await Promise.all(pathNames.map(async (name) => {
      try {
        return [name, await mulby.system.getPath(name)]
      } catch (error) {
        return [name, normalizeError(error)]
      }
    }))
    const [
      appInfo,
      systemInfo,
      resourceUsage,
      theme,
      plugins,
      background,
      hostStatus,
      dynamicFeatures
    ] = await Promise.allSettled([
      mulby.system.getAppInfo(),
      mulby.system.getSystemInfo(),
      mulby.system.getAppResourceUsage?.(),
      mulby.theme?.get?.(),
      mulby.plugin?.getAll?.(),
      mulby.plugin?.listBackground?.(),
      mulby.host?.status?.(PLUGIN_ID),
      mulby.features?.getFeatures?.(dynamicFeatureCodes)
    ])

    return {
      pluginId: PLUGIN_ID,
      generatedAt: Date.now(),
      appInfo: appInfo.status === 'fulfilled' ? appInfo.value : normalizeError(appInfo.reason),
      systemInfo: systemInfo.status === 'fulfilled' ? systemInfo.value : normalizeError(systemInfo.reason),
      resourceUsage: resourceUsage.status === 'fulfilled' ? resourceUsage.value : normalizeError(resourceUsage.reason),
      theme: theme.status === 'fulfilled' ? theme.value : normalizeError(theme.reason),
      pluginCount: plugins.status === 'fulfilled' && Array.isArray(plugins.value) ? plugins.value.length : 0,
      background: background.status === 'fulfilled' ? background.value : normalizeError(background.reason),
      hostStatus: hostStatus.status === 'fulfilled' ? hostStatus.value : normalizeError(hostStatus.reason),
      dynamicFeatures: dynamicFeatures.status === 'fulfilled' ? dynamicFeatures.value : normalizeError(dynamicFeatures.reason),
      paths: Object.fromEntries(pathEntries)
    }
  },

  async getOverview() {
    const [appInfo, systemInfo, theme, plugins, background, hostStatus, features] = await Promise.allSettled([
      mulby.system.getAppInfo(),
      mulby.system.getSystemInfo(),
      mulby.theme?.get?.(),
      mulby.plugin?.getAll?.(),
      mulby.plugin?.listBackground?.(),
      mulby.host?.status?.(PLUGIN_ID),
      mulby.features?.getFeatures?.()
    ])

    return {
      pluginId: PLUGIN_ID,
      generatedAt: Date.now(),
      appInfo: appInfo.status === 'fulfilled' ? appInfo.value : normalizeError(appInfo.reason),
      systemInfo: systemInfo.status === 'fulfilled' ? systemInfo.value : normalizeError(systemInfo.reason),
      theme: theme.status === 'fulfilled' ? theme.value : normalizeError(theme.reason),
      pluginCount: plugins.status === 'fulfilled' && Array.isArray(plugins.value) ? plugins.value.length : 0,
      background: background.status === 'fulfilled' ? background.value : normalizeError(background.reason),
      hostStatus: hostStatus.status === 'fulfilled' ? hostStatus.value : normalizeError(hostStatus.reason),
      dynamicFeatures: features.status === 'fulfilled' ? features.value : normalizeError(features.reason)
    }
  },

  async getManifestContract() {
    return {
      pluginId: PLUGIN_ID,
      displayName: 'Mulby API Lab',
      version: '1.0.0',
      featureRoutes: manifestFeatureRoutesForContract,
      permissions: ['clipboard', 'notification', 'screen', 'microphone', 'camera', 'geolocation', 'accessibility', 'inputMonitor', 'runCommand'],
      tools: ['echo', 'summarize_api_module', 'safe_file_probe'],
      dynamicFeatures: dynamicFeatureCodes,
      pluginSetting: {
        single: true,
        background: true,
        height: 720,
        idleTimeoutMs: 'never'
      }
    }
  },

  async listModuleSummaries() {
    return Object.entries(moduleSummaries).map(([id, summary]) => ({ id, summary }))
  },

  async runBackendSmokeTest() {
    const startedAt = Date.now()
    const results: AnyRecord = {}
    for (const [name, operation] of Object.entries({
      appInfo: () => mulby.system.getAppInfo(),
      systemInfo: () => mulby.system.getSystemInfo(),
      paths: () => Promise.all(['home', 'temp', 'userData'].map((key) => mulby.system.getPath(key))),
      network: () => mulby.network.isOnline(),
      storage: async () => {
        const key = 'smoke:backend'
        await mulby.storage.set(key, { at: Date.now() })
        return await mulby.storage.get(key)
      },
      features: () => mulby.features.getFeatures()
    })) {
      try {
        results[name] = { ok: true, value: await operation() }
      } catch (error) {
        results[name] = normalizeError(error)
      }
    }
    return { ok: true, durationMs: Date.now() - startedAt, results }
  },

  async refreshDynamicFeatures() {
    for (const code of dynamicFeatureCodes) {
      await mulby.features.removeFeature(code)
    }
    await registerDynamicFeatures(mulby)
    return await mulby.features.getFeatures(dynamicFeatureCodes)
  },

  async getDynamicFeatures() {
    return await mulby.features.getFeatures(dynamicFeatureCodes)
  },

  async createSampleTask(input?: { delayMs?: number; message?: string }) {
    const delayMs = Math.max(1000, Math.min(Number(input?.delayMs || 5000), 60000))
    const task = await mulby.scheduler.schedule({
      name: 'API Lab sample delay task',
      type: 'delay',
      delay: delayMs,
      callback: 'onApiLabScheduled',
      payload: {
        message: input?.message || 'sample task',
        createdBy: PLUGIN_ID
      },
      timeout: 15000,
      maxRetries: 0
    })
    return task
  },

  async listOwnTasks() {
    return await mulby.scheduler.list({ limit: 20, offset: 0 })
  },

  async cancelTask(taskId: string) {
    await mulby.scheduler.cancel(taskId)
    return { ok: true, taskId }
  },

  async getTaskExecutions(taskId: string) {
    return await mulby.scheduler.getExecutions(taskId, 10)
  },

  async validateCron(expression: string) {
    return {
      expression,
      valid: await mulby.scheduler.validateCron(expression),
      description: await mulby.scheduler.describeCron(expression),
      next: await mulby.scheduler.getNextCronTime(expression)
    }
  },

  async runSafeCommand() {
    const command = process.platform === 'win32' ? 'cmd.exe' : 'node'
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'echo Mulby API Lab'] : ['--version']
    const result = await mulby.shell.runCommand({
      command,
      args,
      timeoutMs: 5000,
      shell: false
    }) as RunCommandResult
    return result
  },

  async prepareSampleFile() {
    const tempDir = await mulby.system.getPath('temp')
    const labDir = await mulby.filesystem.join(tempDir, 'mulby-api-lab')
    const filePath = await mulby.filesystem.join(labDir, 'sample.txt')
    await mulby.filesystem.mkdir(labDir)
    await mulby.filesystem.writeFile(filePath, `Mulby API Lab sample file\ncreated=${nowIso()}\n`, 'utf-8')
    const stat = await mulby.filesystem.stat(filePath)
    const entries = await mulby.filesystem.readdir(labDir)
    return { labDir, filePath, stat, entries }
  },

  async prepareWindowDragFile() {
    const tempDir = await mulby.system.getPath('temp')
    const labDir = await mulby.filesystem.join(tempDir, 'mulby-api-lab')
    const filePath = await mulby.filesystem.join(labDir, 'drag-source.txt')
    await mulby.filesystem.mkdir(labDir)
    await mulby.filesystem.writeFile(filePath, `Mulby API Lab drag sample\ncreated=${nowIso()}\n`, 'utf-8')
    const stat = await mulby.filesystem.stat(filePath)
    return { labDir, filePath, stat }
  },

  async getInBrowserSandboxPaths() {
    const tempDir = await mulby.system.getPath('temp')
    const labDir = await mulby.filesystem.join(tempDir, 'mulby-api-lab')
    const inbrowserDir = await mulby.filesystem.join(labDir, 'inbrowser')
    await mulby.filesystem.mkdir(labDir)
    await mulby.filesystem.mkdir(inbrowserDir)
    return {
      inbrowserDir,
      pdfPath: await mulby.filesystem.join(inbrowserDir, 'example.pdf'),
      screenshotPath: await mulby.filesystem.join(inbrowserDir, 'example.png'),
      downloadPath: await mulby.filesystem.join(inbrowserDir, 'example.html')
    }
  },

  async inspectPath(filePath: string) {
    const exists = await mulby.filesystem.exists(filePath)
    const stat = exists ? await mulby.filesystem.stat(filePath) : null
    return { path: filePath, exists, stat }
  },

  async sendLoopbackMessage(payload?: JsonValue) {
    await mulby.messaging.broadcast('api-lab:ping', {
      payload: payload ?? { source: 'ui' },
      sentAt: Date.now()
    })
    return { ok: true, sentAt: Date.now() }
  },

  async getAiToolStatus() {
    return {
      registeredTools: ['echo', 'summarize_api_module', 'safe_file_probe'],
      note: 'Tools are registered in onLoad through mulby.tools.register and are available to Mulby AI tooling.'
    }
  },

  async callAiWithLocalTool(prompt?: string) {
    const models = await mulby.ai.allModels()
    const model = Array.isArray(models) && models[0]?.id ? models[0].id : undefined
    if (!model) {
      return { ok: false, error: 'No AI model configured in Mulby settings.' }
    }
    const result = await mulby.ai.call({
      model,
      messages: [
        { role: 'system', content: 'Reply briefly. If useful, call the provided tool.' },
        { role: 'user', content: prompt || 'Echo hello from API Lab.' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'backendEcho',
            description: 'Echo a message from the plugin backend.',
            parameters: {
              type: 'object',
              properties: {
                message: { type: 'string' }
              },
              required: ['message'],
              additionalProperties: false
            }
          }
        }
      ],
      toolingPolicy: { enableInternalTools: false },
      mcp: { mode: 'off' },
      skills: { mode: 'off' },
      maxToolSteps: 3
    })
    return result
  },

  async backendEcho(args: AnyRecord) {
    return { ok: true, message: String(args?.message || ''), echoedAt: Date.now() }
  },

  async getPermissionSnapshot() {
    const types = ['geolocation', 'camera', 'microphone', 'notifications', 'screen', 'accessibility', 'contacts', 'calendar']
    const rows = []
    for (const type of types) {
      try {
        const status = await mulby.permission.getStatus(type)
        const canRequest = await mulby.permission.canRequest(type)
        rows.push({ type, status, canRequest })
      } catch (error) {
        rows.push({ type, ...normalizeError(error) })
      }
    }
    return rows
  },

  async getScreenSnapshot() {
    const displays = await mulby.screen.getAllDisplays()
    const cursor = await mulby.screen.getCursorScreenPoint()
    let sources: unknown[] = []
    try {
      sources = await mulby.screen.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 240, height: 140 } })
    } catch (error) {
      sources = [normalizeError(error)]
    }
    return { displays, cursor, sources }
  },

  async getStorageSnapshot() {
    const key = 'snapshot:sample'
    await mulby.storage.set(key, { at: Date.now(), source: PLUGIN_ID })
    return {
      sample: await mulby.storage.get(key),
      all: typeof mulby.storage.getAll === 'function' ? await mulby.storage.getAll() : null,
      keys: typeof mulby.storage.keys === 'function' ? await mulby.storage.keys() : null
    }
  },

  async saveStorageNote(input?: { note?: string }) {
    const note = {
      text: String(input?.note || '').slice(0, 4000),
      savedAt: Date.now(),
      source: PLUGIN_ID
    }
    await mulby.storage.set('api-lab:note', note)

    let encryptedRoundTrip = false
    try {
      if (mulby.storage.encrypted?.set && mulby.storage.encrypted?.get && mulby.storage.encrypted?.remove) {
        await mulby.storage.encrypted.set('api-lab:secret-check', { value: 'ok', at: Date.now() })
        const encryptedValue = await mulby.storage.encrypted.get('api-lab:secret-check')
        encryptedRoundTrip = Boolean(encryptedValue)
        await mulby.storage.encrypted.remove('api-lab:secret-check')
      }
    } catch (error) {
      console.warn(`${TAG} encrypted storage sample failed`, error)
    }

    const keys = typeof mulby.storage.keys === 'function' ? await mulby.storage.keys() : []
    return {
      note: await mulby.storage.get('api-lab:note'),
      keys,
      encryptedRoundTrip
    }
  },

  async clearLabStorage() {
    const keys = ['snapshot:sample', 'smoke:backend', 'silent:last-smoke', 'scheduler:last-callback', 'mainpush:last-selection', 'api-lab:note', 'api-lab:secret-check']
    for (const key of keys) {
      try {
        await mulby.storage.remove(key)
      } catch {}
    }
    return { ok: true, removed: keys }
  }
}

const plugin = {
  onLoad,
  onUnload,
  onEnable,
  onDisable,
  onBackground,
  run,
  onApiLabScheduled,
  rpc
}

export default plugin
