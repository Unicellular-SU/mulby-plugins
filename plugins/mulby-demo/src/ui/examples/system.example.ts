import type { ApiExampleModule } from './types'
import { catalogModule, mulby, playground, text, unavailable } from './helpers'

async function readScreenPlayground() {
  const api = mulby()
  if (!api?.screen) return unavailable('Screen displays')
  const [displays, primary, cursor] = await Promise.all([
    api.screen.getAllDisplays(),
    api.screen.getPrimaryDisplay(),
    api.screen.getCursorScreenPoint()
  ])
  return { ok: true, title: 'Screen displays', data: { displays, primary, cursor } }
}

async function listScreenSourcesPlayground() {
  const api = mulby()
  if (!api?.screen) return unavailable('Screen sources')
  const sources = await api.screen.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 120, height: 90 } })
  return {
    ok: true,
    title: 'Screen sources',
    data: {
      count: sources?.length ?? 0,
      sources: sources?.slice?.(0, 8)
    }
  }
}

async function captureScreenPlayground() {
  const api = mulby()
  if (!api?.screen) return unavailable('Screen capture')
  const shot = await api.screen.capture({ format: 'png' })
  return {
    ok: true,
    title: 'Screen capture',
    data: {
      bytes: shot?.byteLength ?? shot?.length ?? 0,
      note: 'Capture bytes are returned without rendering the full image in JSON output.'
    }
  }
}

async function readPermissionStatuses() {
  const api = mulby()
  if (!api?.permission) return unavailable('Permission status')
  const types = ['geolocation', 'camera', 'microphone', 'screen', 'accessibility']
  const statuses = await Promise.all(types.map(async (type) => [type, await api.permission.getStatus(type)]))
  const canRequest = await Promise.all(types.map(async (type) => [type, await api.permission.canRequest(type)]))
  const accessibilityTrusted = await api.permission.isAccessibilityTrusted()
  return {
    ok: true,
    title: 'Permission status',
    data: {
      statuses: Object.fromEntries(statuses),
      canRequest: Object.fromEntries(canRequest),
      accessibilityTrusted,
      openSystemSettings: typeof api.permission.openSystemSettings
    }
  }
}

async function requestMicrophonePermission() {
  const api = mulby()
  if (!api?.permission) return unavailable('Permission request')
  const result = await api.permission.request('microphone')
  return { ok: true, title: 'Permission request', data: { type: 'microphone', result } }
}

async function readMediaStatuses() {
  const api = mulby()
  if (!api?.media) return unavailable('Media status')
  const [camera, microphone, hasCamera, hasMicrophone] = await Promise.all([
    api.media.getAccessStatus('camera'),
    api.media.getAccessStatus('microphone'),
    api.media.hasCameraAccess(),
    api.media.hasMicrophoneAccess()
  ])
  return { ok: true, title: 'Media status', data: { camera, microphone, hasCamera, hasMicrophone } }
}

async function requestMicrophoneMedia() {
  const api = mulby()
  if (!api?.media) return unavailable('Media request')
  const microphoneRequest = await api.media.askForAccess('microphone')
  return { ok: true, title: 'Media request', data: { microphoneRequest } }
}

async function pasteDemoText() {
  const api = mulby()
  if (!api?.input) return unavailable('Input paste text')
  const result = await api.input.hideMainWindowPasteText('Mulby demo input text')
  const restore = await api.input.restoreWindows?.()
  return { ok: true, title: 'Input paste text', data: { result, restore } }
}

async function simulateEscapeKey() {
  const api = mulby()
  if (!api?.input) return unavailable('Input keyboard')
  const result = await api.input.simulateKeyboardTap('Escape')
  return { ok: true, title: 'Input keyboard', data: { result } }
}

async function simulateMouseProbe() {
  const api = mulby()
  if (!api?.input) return unavailable('Input mouse')
  const move = await api.input.simulateMouseMove(1, 1)
  const click = await api.input.simulateMouseClick(1, 1)
  return { ok: true, title: 'Input mouse', data: { move, click } }
}

const demoShortcut = 'CommandOrControl+Shift+Alt+D'

async function registerDemoShortcut() {
  const api = mulby()
  if (!api?.shortcut) return unavailable('Shortcut register')
  const triggered: string[] = []
  const off = api.shortcut.onTriggered?.((value: string) => triggered.push(value))
  const registered = await api.shortcut.register(demoShortcut)
  const isRegistered = await api.shortcut.isRegistered(demoShortcut)
  off?.()
  return { ok: true, title: 'Shortcut register', data: { accelerator: demoShortcut, registered, isRegistered, triggered } }
}

async function unregisterDemoShortcut() {
  const api = mulby()
  if (!api?.shortcut) return unavailable('Shortcut unregister')
  await api.shortcut.unregister(demoShortcut)
  const afterUnregister = await api.shortcut.isRegistered(demoShortcut)
  return { ok: true, title: 'Shortcut unregister', data: { accelerator: demoShortcut, afterUnregister } }
}

async function unregisterAllShortcuts() {
  const api = mulby()
  if (!api?.shortcut) return unavailable('Shortcut unregister all')
  const result = await api.shortcut.unregisterAll()
  return { ok: true, title: 'Shortcut unregister all', data: { result } }
}

export const systemExamples: ApiExampleModule[] = [
  catalogModule('system', {
    title: 'System',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: [
      'System APIs are useful for diagnostics and platform-specific branching.',
      'Avoid exposing sensitive paths or environment values in user-facing logs.'
    ],
    examples: [
      {
        id: 'system-info',
        label: 'Read system and app info',
        description: 'Reads OS, Mulby app, resource, path, environment, icon, platform, active-window, and native-id data.',
        methods: [
          'system.getSystemInfo',
          'system.getAppInfo',
          'system.getAppResourceUsage',
          'system.getPath',
          'system.getEnv',
          'system.getIdleTime',
          'system.getFileIcon',
          'system.getFileIcons',
          'system.getNativeId',
          'system.isDev',
          'system.isMacOS',
          'system.isWindows',
          'system.isLinux',
          'system.onActiveWindowChange',
          'system.getCachedActiveWindow',
          'system.getActiveWindow'
        ],
        safety: 'safe',
        code: `const system = await window.mulby.system.getSystemInfo()\nconst app = await window.mulby.system.getAppInfo()\nconst tempPath = await window.mulby.system.getPath('temp')\nconst icon = await window.mulby.system.getFileIcon(tempPath, { kind: 'file' })`,
        async run() {
          const api = mulby()
          if (!api?.system) return unavailable('System info')
          const [system, app, resourceUsage, tempPath, homePath, pathEnv, idleTime, nativeId, isDev, isMacOS, isWindows, isLinux] = await Promise.all([
            api.system.getSystemInfo(),
            api.system.getAppInfo(),
            api.system.getAppResourceUsage?.(),
            api.system.getPath('temp'),
            api.system.getPath('home'),
            api.system.getEnv('PATH'),
            api.system.getIdleTime(),
            api.system.getNativeId?.(),
            api.system.isDev?.(),
            api.system.isMacOS(),
            api.system.isWindows(),
            api.system.isLinux()
          ])
          const icon = await api.system.getFileIcon?.(tempPath, { kind: 'file', size: 32 })
          const icons = await api.system.getFileIcons?.([{ key: 'temp', path: tempPath, kind: 'file' }], { size: 32 })
          const activeEvents: unknown[] = []
          const off = api.system.onActiveWindowChange?.((info: unknown) => activeEvents.push(info))
          off?.()
          const cachedActiveWindow = await api.system.getCachedActiveWindow?.()
          const activeWindow = await api.system.getActiveWindow?.()
          return {
            ok: true,
            title: 'System info',
            data: {
              platform: system.platform,
              arch: system.arch,
              cpus: system.cpus,
              totalmem: system.totalmem,
              app: { name: app.name, version: app.version, locale: app.locale },
              resourceUsage,
              tempPath,
              homePath,
              pathEnvPreview: String(pathEnv ?? '').slice(0, 180),
              idleTime,
              nativeId,
              isDev,
              isMacOS,
              isWindows,
              isLinux,
              iconPreview: typeof icon === 'string' ? icon.slice(0, 60) : icon,
              icons,
              cachedActiveWindow,
              activeWindow,
              activeEvents
            }
          }
        }
      }
    ]
  }),
  catalogModule('permission', {
    title: 'Permission',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: [
      'Request calls may show system UI. This reference reads status first.',
      'Manifest permissions are required before host permission prompts are meaningful.'
    ],
    playground: playground(
      text('Permission workbench', '权限工作台'),
      text('Read permission status first, then request only explicit user-selected permissions.', '先读取权限状态，再仅请求用户明确选择的权限。'),
      [
        {
          id: 'permission.status',
          label: text('Read statuses', '读取状态'),
          description: text('Reads common permission status and requestability.', '读取常见权限状态和是否可请求。'),
          methods: ['permission.getStatus', 'permission.canRequest', 'permission.isAccessibilityTrusted', 'permission.openSystemSettings'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.permission.getStatus('microphone')\nawait window.mulby.permission.canRequest('microphone')`,
          run: readPermissionStatuses
        },
        {
          id: 'permission.request',
          label: text('Request microphone', '请求麦克风'),
          description: text('Requests microphone permission through the host.', '通过宿主请求麦克风权限。'),
          methods: ['permission.request'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.permission.request('microphone')`,
          run: requestMicrophonePermission
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'permission-status',
        label: 'Read permission statuses',
        description: 'Reads, requests, checks requestability, and exposes settings access for common permissions.',
        methods: ['permission.getStatus', 'permission.request', 'permission.canRequest', 'permission.openSystemSettings', 'permission.isAccessibilityTrusted'],
        safety: 'opens-system-ui',
        code: `await window.mulby.permission.getStatus('microphone')\nawait window.mulby.permission.canRequest('microphone')\nawait window.mulby.permission.request('microphone')\nawait window.mulby.permission.isAccessibilityTrusted()`,
        async run() {
          const api = mulby()
          if (!api?.permission) return unavailable('Permission status')
          const types = ['geolocation', 'camera', 'microphone', 'screen', 'accessibility']
          const statuses = await Promise.all(types.map(async (type) => [type, await api.permission.getStatus(type)]))
          const canRequest = await Promise.all(types.map(async (type) => [type, await api.permission.canRequest(type)]))
          let microphoneRequest: unknown = null
          try {
            microphoneRequest = await api.permission.request('microphone')
          } catch (error) {
            microphoneRequest = error instanceof Error ? error.message : String(error)
          }
          const accessibilityTrusted = await api.permission.isAccessibilityTrusted()
          return {
            ok: true,
            title: 'Permission status',
            data: {
              statuses: Object.fromEntries(statuses),
              canRequest: Object.fromEntries(canRequest),
              microphoneRequest,
              accessibilityTrusted,
              openSystemSettings: typeof api.permission.openSystemSettings
            }
          }
        }
      }
    ]
  }),
  catalogModule('power', {
    title: 'Power',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: ['Use idle and battery state to defer background work or reduce CPU-heavy processing.'],
    examples: [
      {
        id: 'power-state',
        label: 'Read power state',
        description: 'Reads idle time, idle state, battery, thermal state, and registers all renderer power event listeners before disposing them.',
        methods: ['power.getSystemIdleTime', 'power.getSystemIdleState', 'power.isOnBatteryPower', 'power.getCurrentThermalState', 'power.onSuspend', 'power.onResume', 'power.onAC', 'power.onBattery', 'power.onLockScreen', 'power.onUnlockScreen'],
        safety: 'safe',
        code: `const idle = await window.mulby.power.getSystemIdleTime()`,
        async run() {
          const api = mulby()
          if (!api?.power) return unavailable('Power state')
          const [idleTime, idleState, onBattery, thermal] = await Promise.all([
            api.power.getSystemIdleTime(),
            api.power.getSystemIdleState(60),
            api.power.isOnBatteryPower(),
            api.power.getCurrentThermalState()
          ])
          const events: string[] = []
          const listeners = [
            api.power.onSuspend?.(() => events.push('suspend')),
            api.power.onResume?.(() => events.push('resume')),
            api.power.onAC?.(() => events.push('ac')),
            api.power.onBattery?.(() => events.push('battery')),
            api.power.onLockScreen?.(() => events.push('lock')),
            api.power.onUnlockScreen?.(() => events.push('unlock'))
          ]
          for (const dispose of listeners) dispose?.()
          return { ok: true, title: 'Power state', data: { idleTime, idleState, onBattery, thermal, events } }
        }
      }
    ]
  }),
  catalogModule('screen', {
    title: 'Screen',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: [
      'Screen capture calls require `permissions.screen` and may require OS-level screen recording permission.',
      'This demo reads display metadata by default; capture calls are shown as code snippets.'
    ],
    playground: playground(
      text('Screen capture workbench', '屏幕捕获工作台'),
      text(
        'Inspect displays, list available capture sources, and run explicit capture actions.',
        '检查显示器、列出可捕获源，并显式运行截图操作。'
      ),
      [
        {
          id: 'screen.getAllDisplays',
          label: text('Read displays', '读取显示器'),
          description: text('Shows display bounds, primary display, and cursor position.', '显示显示器边界、主显示器和鼠标位置。'),
          methods: ['screen.getAllDisplays', 'screen.getPrimaryDisplay', 'screen.getCursorScreenPoint', 'screen.getDisplayNearestPoint', 'screen.getDisplayMatching'],
          safety: 'safe',
          cleanup: false,
          code: `const displays = await window.mulby.screen.getAllDisplays()`,
          run: readScreenPlayground
        },
        {
          id: 'screen.getSources',
          label: text('List sources', '列出捕获源'),
          description: text('Lists screen/window capture sources with small thumbnails.', '列出屏幕和窗口捕获源及小缩略图。'),
          methods: ['screen.getSources', 'screen.getWindowBounds', 'screen.getMediaStreamConstraints'],
          safety: 'requires-permission',
          cleanup: false,
          code: `await window.mulby.screen.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 120, height: 90 } })`,
          run: listScreenSourcesPlayground
        },
        {
          id: 'screen.capture',
          label: text('Capture screen', '截取屏幕'),
          description: text('Runs a PNG capture and reports byte size.', '执行 PNG 截图并返回字节大小。'),
          methods: ['screen.capture', 'screen.captureRegion', 'screen.screenCapture', 'screen.colorPick', 'screen.screenToDipPoint', 'screen.dipToScreenPoint', 'screen.screenToDipRect', 'screen.dipToScreenRect'],
          safety: 'requires-permission',
          cleanup: false,
          code: `const shot = await window.mulby.screen.capture({ format: 'png' })`,
          run: captureScreenPlayground
        }
      ],
      ['status', 'preview', 'table', 'json']
    ),
    examples: [
      {
        id: 'screen-displays',
        label: 'Read displays',
        description: 'Reads displays, capture sources, coordinates, constraints, screenshots, and screen capture tool availability.',
        methods: [
          'screen.getAllDisplays',
          'screen.getPrimaryDisplay',
          'screen.getCursorScreenPoint',
          'screen.getDisplayNearestPoint',
          'screen.getDisplayMatching',
          'screen.getSources',
          'screen.getWindowBounds',
          'screen.capture',
          'screen.captureRegion',
          'screen.getMediaStreamConstraints',
          'screen.screenCapture',
          'screen.colorPick',
          'screen.screenToDipPoint',
          'screen.dipToScreenPoint',
          'screen.screenToDipRect',
          'screen.dipToScreenRect'
        ],
        safety: 'requires-permission',
        code: `const displays = await window.mulby.screen.getAllDisplays()\nconst sources = await window.mulby.screen.getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 64 } })\nconst shot = await window.mulby.screen.capture({ format: 'png' })`,
        async run() {
          const api = mulby()
          if (!api?.screen) return unavailable('Screen displays')
          const [displays, primary, cursor] = await Promise.all([
            api.screen.getAllDisplays(),
            api.screen.getPrimaryDisplay(),
            api.screen.getCursorScreenPoint()
          ])
          const nearest = await api.screen.getDisplayNearestPoint(cursor)
          const matching = await api.screen.getDisplayMatching?.(primary.bounds)
          let sources: any[] = []
          let sourcesError: unknown = null
          try {
            sources = await api.screen.getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 64 } })
          } catch (error) {
            sourcesError = error instanceof Error ? error.message : String(error)
          }
          let windowBounds: unknown = null
          try {
            windowBounds = sources[0]?.id ? await api.screen.getWindowBounds?.(sources[0].id) : null
          } catch (error) {
            windowBounds = error instanceof Error ? error.message : String(error)
          }
          let constraints: unknown = null
          try {
            constraints = sources[0]?.id ? await api.screen.getMediaStreamConstraints({ sourceId: sources[0].id, audio: false, frameRate: 5 }) : null
          } catch (error) {
            constraints = error instanceof Error ? error.message : String(error)
          }
          const dipPoint = await api.screen.screenToDipPoint?.(cursor)
          const screenPoint = dipPoint ? await api.screen.dipToScreenPoint?.(dipPoint) : null
          const dipRect = await api.screen.screenToDipRect?.({ ...primary.bounds })
          const screenRect = dipRect ? await api.screen.dipToScreenRect?.(dipRect) : null
          let capture: unknown = null
          let region: unknown = null
          try {
            const shot = await api.screen.capture({ format: 'png' })
            capture = { bytes: shot?.byteLength ?? shot?.length }
          } catch (error) {
            capture = error instanceof Error ? error.message : String(error)
          }
          try {
            const shot = await api.screen.captureRegion({ x: primary.bounds.x, y: primary.bounds.y, width: 1, height: 1 }, { format: 'png' })
            region = { bytes: shot?.byteLength ?? shot?.length }
          } catch (error) {
            region = error instanceof Error ? error.message : String(error)
          }
          return {
            ok: true,
            title: 'Screen displays',
            data: {
              displays,
              primary,
              cursor,
              nearest,
              matching,
              sources: sources.slice?.(0, 3),
              sourcesError,
              windowBounds,
              constraints,
              capture,
              region,
              screenCapture: typeof api.screen.screenCapture,
              colorPick: typeof api.screen.colorPick,
              dipPoint,
              screenPoint,
              dipRect,
              screenRect
            }
          }
        }
      }
    ]
  }),
  catalogModule('media', {
    title: 'Media Permissions',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: ['Camera and microphone permissions must be declared separately in manifest.'],
    playground: playground(
      text('Media permission checker', '媒体权限检查器'),
      text('Read camera and microphone access, then request microphone access explicitly.', '读取摄像头和麦克风访问状态，并显式请求麦克风访问。'),
      [
        {
          id: 'media.status',
          label: text('Read access', '读取访问状态'),
          description: text('Reads camera and microphone access states.', '读取摄像头和麦克风访问状态。'),
          methods: ['media.getAccessStatus', 'media.hasCameraAccess', 'media.hasMicrophoneAccess'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.media.getAccessStatus('camera')\nawait window.mulby.media.hasMicrophoneAccess()`,
          run: readMediaStatuses
        },
        {
          id: 'media.askForAccess',
          label: text('Request microphone', '请求麦克风'),
          description: text('Requests microphone access.', '请求麦克风访问权限。'),
          methods: ['media.askForAccess'],
          safety: 'requires-permission',
          cleanup: false,
          code: `await window.mulby.media.askForAccess('microphone')`,
          run: requestMicrophoneMedia
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'media-status',
        label: 'Read camera/microphone access',
        description: 'Reads and requests camera and microphone access status through the host API.',
        methods: ['media.getAccessStatus', 'media.askForAccess', 'media.hasCameraAccess', 'media.hasMicrophoneAccess'],
        safety: 'requires-permission',
        code: `await window.mulby.media.getAccessStatus('camera')\nawait window.mulby.media.askForAccess('microphone')`,
        async run() {
          const api = mulby()
          if (!api?.media) return unavailable('Media status')
          const [camera, microphone, hasCamera, hasMicrophone] = await Promise.all([
            api.media.getAccessStatus('camera'),
            api.media.getAccessStatus('microphone'),
            api.media.hasCameraAccess(),
            api.media.hasMicrophoneAccess()
          ])
          let microphoneRequest: unknown = null
          try {
            microphoneRequest = await api.media.askForAccess('microphone')
          } catch (error) {
            microphoneRequest = error instanceof Error ? error.message : String(error)
          }
          return { ok: true, title: 'Media status', data: { camera, microphone, hasCamera, hasMicrophone, microphoneRequest } }
        }
      }
    ]
  }),
  catalogModule('input', {
    title: 'Input Automation',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: [
      'Input automation affects other apps. Prefer explicit user actions and restore windows after paste/type flows.',
      'This reference runs the calls with small demo payloads and catches permission or focus errors in the output.'
    ],
    playground: playground(
      text('Input automation controls', '输入自动化控制台'),
      text('Run explicit paste, keyboard, and mouse automation actions with visible result output.', '显式运行粘贴、键盘和鼠标自动化操作，并展示结果。'),
      [
        {
          id: 'input.hideMainWindowPasteText',
          label: text('Paste demo text', '粘贴演示文本'),
          description: text('Hides the main window, pastes text, then restores windows.', '隐藏主窗口、粘贴文本，然后恢复窗口。'),
          methods: ['input.hideMainWindowPasteText', 'input.restoreWindows'],
          safety: 'opens-system-ui',
          cleanup: true,
          code: `await window.mulby.input.hideMainWindowPasteText('Mulby demo')\nawait window.mulby.input.restoreWindows()`,
          run: pasteDemoText
        },
        {
          id: 'input.simulateKeyboardTap',
          label: text('Press Escape', '按下 Escape'),
          description: text('Simulates a small keyboard tap.', '模拟一次小范围键盘按键。'),
          methods: ['input.simulateKeyboardTap', 'input.hideMainWindowTypeString', 'input.hideMainWindowPasteImage', 'input.hideMainWindowPasteFile'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.input.simulateKeyboardTap('Escape')`,
          run: simulateEscapeKey
        },
        {
          id: 'input.mouse',
          label: text('Mouse probe', '鼠标探测'),
          description: text('Moves and clicks at a tiny coordinate used by the reference demo.', '在参考示例的小坐标处移动并点击鼠标。'),
          methods: ['input.simulateMouseMove', 'input.simulateMouseClick', 'input.simulateMouseDoubleClick', 'input.simulateMouseRightClick'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.input.simulateMouseMove(1, 1)\nawait window.mulby.input.simulateMouseClick(1, 1)`,
          run: simulateMouseProbe
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'input-actions',
        label: 'Run input automation actions',
        description: 'Executes paste/type/keyboard/mouse automation calls with demo payloads and restores windows afterward.',
        methods: [
          'input.hideMainWindowPasteText',
          'input.hideMainWindowPasteImage',
          'input.hideMainWindowPasteFile',
          'input.hideMainWindowTypeString',
          'input.restoreWindows',
          'input.simulateKeyboardTap',
          'input.simulateMouseMove',
          'input.simulateMouseClick',
          'input.simulateMouseDoubleClick',
          'input.simulateMouseRightClick'
        ],
        safety: 'opens-system-ui',
        code: `await window.mulby.input.hideMainWindowPasteText('Mulby demo')\nawait window.mulby.input.restoreWindows()\nawait window.mulby.input.simulateKeyboardTap('Escape')`,
        async run() {
          const api = mulby()
          if (!api?.input) return unavailable('Input automation')
          const results: Record<string, unknown> = {}
          const safe = async (name: string, fn: () => Promise<unknown>) => {
            try {
              results[name] = await fn()
            } catch (error) {
              results[name] = error instanceof Error ? error.message : String(error)
            }
          }
          await safe('hideMainWindowPasteText', () => api.input.hideMainWindowPasteText('Mulby demo input text'))
          await safe('hideMainWindowPasteImage', () => api.input.hideMainWindowPasteImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw9LNgAAAABJRU5ErkJggg=='))
          await safe('hideMainWindowPasteFile', () => api.input.hideMainWindowPasteFile([]))
          await safe('hideMainWindowTypeString', () => api.input.hideMainWindowTypeString('Mulby demo'))
          await safe('restoreWindows', () => api.input.restoreWindows())
          await safe('simulateKeyboardTap', () => api.input.simulateKeyboardTap('Escape'))
          await safe('simulateMouseMove', () => api.input.simulateMouseMove(1, 1))
          await safe('simulateMouseClick', () => api.input.simulateMouseClick(1, 1))
          await safe('simulateMouseDoubleClick', () => api.input.simulateMouseDoubleClick?.(1, 1))
          await safe('simulateMouseRightClick', () => api.input.simulateMouseRightClick?.(1, 1))
          return { ok: true, title: 'Input automation', data: results }
        }
      }
    ]
  }),
  catalogModule('input-monitor', {
    title: 'Input Monitor',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: [
      'Requires `inputMonitor` and usually accessibility permission on macOS.',
      'Always stop sessions and unsubscribe listeners during cleanup.'
    ],
    examples: [
      {
        id: 'input-monitor-available',
        label: 'Check monitor availability',
        description: 'Checks availability, requests accessibility, starts a short session if possible, listens, then stops it.',
        methods: ['inputMonitor.isAvailable', 'inputMonitor.requireAccessibility', 'inputMonitor.start', 'inputMonitor.stop', 'inputMonitor.onEvent'],
        safety: 'requires-permission',
        code: `const available = await window.mulby.inputMonitor.isAvailable()\nconst sessionId = available ? await window.mulby.inputMonitor.start({ mouse: true, keyboard: false }) : null\nconst off = window.mulby.inputMonitor.onEvent((event) => console.log(event))\nif (sessionId) await window.mulby.inputMonitor.stop(sessionId)\noff()`,
        async run() {
          const api = mulby()
          if (!api?.inputMonitor) return unavailable('Input monitor availability')
          const available = await api.inputMonitor.isAvailable()
          let accessibility: unknown = null
          try {
            accessibility = await api.inputMonitor.requireAccessibility()
          } catch (error) {
            accessibility = error instanceof Error ? error.message : String(error)
          }
          const events: unknown[] = []
          const off = api.inputMonitor.onEvent?.((event: unknown) => events.push(event))
          const sessionId = available && accessibility === true
            ? await api.inputMonitor.start({ mouse: true, keyboard: false, throttleMs: 100 })
            : null
          if (sessionId) {
            await new Promise((resolve) => setTimeout(resolve, 250))
            await api.inputMonitor.stop(sessionId)
          }
          off?.()
          return { ok: true, title: 'Input monitor availability', data: { available, accessibility, sessionId, events } }
        }
      }
    ]
  }),
  catalogModule('shortcut', {
    title: 'Global Shortcut',
    category: 'system',
    contexts: ['renderer', 'backend'],
    notes: [
      'Register shortcuts on explicit user action and unregister them on unload.',
      'Use `plugin.bindCommandShortcut` for command shortcuts managed by Mulby settings.'
    ],
    playground: playground(
      text('Global shortcut workbench', '全局快捷键工作台'),
      text('Register a demo shortcut, inspect its state, and explicitly unregister it.', '注册演示快捷键、查看状态，并显式注销。'),
      [
        {
          id: 'shortcut.register',
          label: text('Register shortcut', '注册快捷键'),
          description: text('Registers CommandOrControl+Shift+Alt+D.', '注册 CommandOrControl+Shift+Alt+D。'),
          methods: ['shortcut.register', 'shortcut.isRegistered', 'shortcut.onTriggered'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.shortcut.register('CommandOrControl+Shift+Alt+D')`,
          run: registerDemoShortcut
        },
        {
          id: 'shortcut.unregister',
          label: text('Unregister shortcut', '注销快捷键'),
          description: text('Unregisters the demo shortcut.', '注销演示快捷键。'),
          methods: ['shortcut.unregister'],
          safety: 'safe',
          cleanup: true,
          code: `await window.mulby.shortcut.unregister('CommandOrControl+Shift+Alt+D')`,
          run: unregisterDemoShortcut
        },
        {
          id: 'shortcut.unregisterAll',
          label: text('Unregister all', '注销全部'),
          description: text('Clears plugin-owned shortcuts.', '清理插件自有快捷键。'),
          methods: ['shortcut.unregisterAll'],
          safety: 'safe',
          cleanup: true,
          code: `await window.mulby.shortcut.unregisterAll()`,
          run: unregisterAllShortcuts
        }
      ],
      ['status', 'log', 'external', 'json']
    ),
    examples: [
      {
        id: 'shortcut-register',
        label: 'Register and unregister shortcut',
        description: 'Registers a demo global shortcut, checks state, listens for trigger events, unregisters it, and clears plugin-owned shortcuts.',
        methods: ['shortcut.register', 'shortcut.unregister', 'shortcut.unregisterAll', 'shortcut.isRegistered', 'shortcut.onTriggered'],
        safety: 'opens-system-ui',
        code: `const off = window.mulby.shortcut.onTriggered((accelerator) => console.log(accelerator))\nconst ok = await window.mulby.shortcut.register('CommandOrControl+Shift+Alt+D')\nconst registered = await window.mulby.shortcut.isRegistered('CommandOrControl+Shift+Alt+D')\nawait window.mulby.shortcut.unregister('CommandOrControl+Shift+Alt+D')\nawait window.mulby.shortcut.unregisterAll()\noff()`,
        async run() {
          const api = mulby()
          if (!api?.shortcut) return unavailable('Shortcut register')
          const accelerator = 'CommandOrControl+Shift+Alt+D'
          const triggered: string[] = []
          const off = api.shortcut.onTriggered?.((value: string) => triggered.push(value))
          const registered = await api.shortcut.register(accelerator)
          const isRegistered = await api.shortcut.isRegistered(accelerator)
          await api.shortcut.unregister(accelerator)
          const afterUnregister = await api.shortcut.isRegistered(accelerator)
          await api.shortcut.unregisterAll()
          off?.()
          return { ok: true, title: 'Shortcut register', data: { registered, isRegistered, afterUnregister, triggered } }
        }
      }
    ]
  }),
  catalogModule('geolocation', {
    title: 'Geolocation',
    category: 'system',
    contexts: ['renderer'],
    notes: ['Read access status before requesting. Position reads require geolocation permission and OS/browser consent.'],
    examples: [
      {
        id: 'geolocation-status',
        label: 'Read geolocation status',
        description: 'Reads access status, requests access, checks availability, and attempts to read current position.',
        methods: ['geolocation.getAccessStatus', 'geolocation.requestAccess', 'geolocation.canGetPosition', 'geolocation.openSettings', 'geolocation.getCurrentPosition'],
        safety: 'requires-permission',
        code: `const status = await window.mulby.geolocation.getAccessStatus()\nconst granted = await window.mulby.geolocation.requestAccess()\nconst position = await window.mulby.geolocation.getCurrentPosition()`,
        async run() {
          const api = mulby()
          if (!api?.geolocation) return unavailable('Geolocation status')
          const [status, canGetPosition] = await Promise.all([
            api.geolocation.getAccessStatus(),
            api.geolocation.canGetPosition()
          ])
          let access: unknown = null
          try {
            access = await api.geolocation.requestAccess()
          } catch (error) {
            access = error instanceof Error ? error.message : String(error)
          }
          let position: unknown = null
          try {
            position = await api.geolocation.getCurrentPosition()
          } catch (error) {
            position = error instanceof Error ? error.message : String(error)
          }
          return { ok: true, title: 'Geolocation status', data: { status, canGetPosition, access, position, openSettings: typeof api.geolocation.openSettings } }
        }
      }
    ]
  }),
  catalogModule('desktop', {
    title: 'Desktop Search',
    category: 'system',
    contexts: ['renderer'],
    notes: ['Use small limits and clear user-provided queries for desktop search examples.'],
    examples: [
      {
        id: 'desktop-search-apps',
        label: 'Search apps',
        description: 'Searches up to five apps and files matching common demo queries.',
        methods: ['desktop.searchFiles', 'desktop.searchApps'],
        safety: 'safe',
        code: `const apps = await window.mulby.desktop.searchApps('code', 5)\nconst files = await window.mulby.desktop.searchFiles('readme', 5)`,
        async run() {
          const api = mulby()
          if (!api?.desktop) return unavailable('Desktop app search')
          const [apps, files] = await Promise.all([
            api.desktop.searchApps('code', 5),
            api.desktop.searchFiles('readme', 5)
          ])
          return { ok: true, title: 'Desktop search', data: { apps, files } }
        }
      }
    ]
  })
]
