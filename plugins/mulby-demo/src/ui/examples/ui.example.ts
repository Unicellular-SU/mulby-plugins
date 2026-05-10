import type { ApiExampleModule } from './types'
import { callBackendExample, catalogModule, mulby, playground, text, unavailable } from './helpers'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let activeChildWindow: any | null = null

async function showDialogMessage() {
  const api = mulby()
  if (!api?.dialog) return unavailable('Dialog message')
  const result = await api.dialog.showMessageBox({
    type: 'info',
    title: 'Mulby API Demo',
    message: 'Mulby dialog demo',
    detail: 'This demonstrates dialog.showMessageBox(options).',
    buttons: ['OK', 'Cancel'],
    defaultId: 0,
    cancelId: 1
  })
  return { ok: true, title: 'Dialog message', data: result }
}

async function showOpenSaveDialogs() {
  const api = mulby()
  if (!api?.dialog) return unavailable('Dialog open/save/error')
  const openResult = await api.dialog.showOpenDialog({
    title: 'Mulby demo open dialog',
    properties: ['openFile']
  })
  const saveResult = await api.dialog.showSaveDialog({
    title: 'Mulby demo save dialog',
    defaultPath: 'mulby-demo.txt'
  })
  return { ok: true, title: 'Dialog open/save', data: { openResult, saveResult } }
}

async function showDialogError() {
  const api = mulby()
  if (!api?.dialog) return unavailable('Dialog error')
  const errorResult = await api.dialog.showErrorBox('Mulby demo error box', 'This demonstrates dialog.showErrorBox(title, content).')
  return { ok: true, title: 'Dialog error', data: { errorResult } }
}

async function showNotification() {
  const api = mulby()
  if (!api?.notification) return unavailable('Notification show')
  await api.notification.show('Mulby notification demo', 'info')
  return { ok: true, title: 'Notification show', data: { shown: true, type: 'info' } }
}

async function showSubInput() {
  const api = mulby()
  if (!api?.subInput) return unavailable('Sub input')
  const changes: unknown[] = []
  const off = api.subInput.onChange?.((data: unknown) => changes.push(data))
  const result = await api.subInput.set('Type API search text...', true)
  await api.subInput.setValue?.('Mulby demo')
  await api.subInput.focus?.()
  off?.()
  return { ok: true, title: 'Sub input', data: { result, changes, keptVisible: true } }
}

async function selectSubInput() {
  const api = mulby()
  if (!api?.subInput) return unavailable('Sub input select')
  await api.subInput.focus?.()
  await api.subInput.select?.()
  return { ok: true, title: 'Sub input select', data: { selected: true } }
}

async function removeSubInput() {
  const api = mulby()
  if (!api?.subInput) return unavailable('Sub input remove')
  const result = await api.subInput.remove()
  return { ok: true, title: 'Sub input remove', data: { result } }
}

async function readTheme() {
  const api = mulby()
  if (!api?.theme) return unavailable('Theme read')
  const [theme, actual] = await Promise.all([api.theme.get(), api.theme.getActual()])
  return { ok: true, title: 'Theme read', data: { theme, actual } }
}

async function setThemeMode(mode: 'light' | 'dark' | 'system') {
  const api = mulby()
  if (!api?.theme) return unavailable('Theme set')
  const before = await api.theme.get()
  const result = await api.theme.set(mode)
  const actual = await api.theme.getActual()
  return { ok: true, title: `Theme ${mode}`, data: { before, mode, result, actual } }
}

async function showContextMenu() {
  const api = mulby()
  if (!api?.menu) return unavailable('Context menu')
  const selected = await api.menu.showContextMenu([
    { id: 'inspect', label: 'Inspect module' },
    { type: 'separator' },
    { id: 'copy-code', label: 'Copy code sample' },
    { id: 'toggle', label: 'Checked option', type: 'checkbox', checked: true }
  ])
  return { ok: true, title: 'Context menu', data: { selected } }
}

async function createChildWindow() {
  const api = mulby()
  if (!api?.window) return unavailable('Create child window')
  const messages: unknown[] = []
  const off = api.window.onChildMessage?.((channel: string, ...args: unknown[]) => {
    messages.push({ channel, args })
  })
  const child = await api.window.create('child-demo', {
    width: 560,
    height: 430,
    title: 'Mulby child demo',
    params: { source: 'window.create playground' }
  })
  activeChildWindow = child
  await child?.show?.()
  await child?.focus?.()
  await child?.setTitle?.('Mulby child demo - keep open')
  off?.()
  return {
    ok: true,
    title: 'Create child window',
    data: {
      childId: child?.id,
      keptOpen: true,
      messages,
      next: 'Use Send message, Focus, or Close child from the playground controls.'
    }
  }
}

async function sendChildWindowMessage() {
  if (!activeChildWindow) {
    return {
      ok: false,
      title: 'Send child message',
      warning: 'Create the child window first.'
    }
  }
  await activeChildWindow.postMessage?.('mulby-demo:hello', {
    ok: true,
    at: new Date().toISOString()
  })
  return { ok: true, title: 'Send child message', data: { childId: activeChildWindow.id, sent: true } }
}

async function focusChildWindow() {
  if (!activeChildWindow) {
    return {
      ok: false,
      title: 'Focus child window',
      warning: 'Create the child window first.'
    }
  }
  await activeChildWindow.show?.()
  await activeChildWindow.focus?.()
  return { ok: true, title: 'Focus child window', data: { childId: activeChildWindow.id } }
}

async function closeChildWindow() {
  if (!activeChildWindow) {
    return { ok: true, title: 'Close child window', data: { closed: false, reason: 'No active child window.' } }
  }
  const childId = activeChildWindow.id
  await activeChildWindow.close?.()
  activeChildWindow = null
  return { ok: true, title: 'Close child window', data: { childId, closed: true } }
}

async function createTray() {
  const data = await callBackendExample('trayCreate')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Create tray', data }
}

async function updateTray() {
  const data = await callBackendExample('trayUpdate')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Update tray', data }
}

async function readTray() {
  const data = await callBackendExample('trayStatus')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Read tray status', data }
}

async function destroyTray() {
  const data = await callBackendExample('trayDestroy')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Destroy tray', data }
}

export const uiExamples: ApiExampleModule[] = [
  catalogModule('dialog', {
    title: 'Dialog',
    category: 'ui',
    contexts: ['renderer', 'backend'],
    notes: [
      'Dialog APIs are available in renderer and backend contexts.',
      'Message boxes are safe for inline demos; open/save dialogs should be user-triggered.'
    ],
    playground: playground(
      text('Native dialog workbench', '原生对话框工作台'),
      text(
        'Open real Mulby native dialogs and inspect the selected response.',
        '打开真实的 Mulby 原生对话框，并查看用户选择结果。'
      ),
      [
        {
          id: 'dialog.showMessageBox',
          label: text('Message box', '消息框'),
          description: text('Shows a native message box and returns the button index.', '显示原生消息框并返回按钮索引。'),
          methods: ['dialog.showMessageBox'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.dialog.showMessageBox({ message: 'Mulby dialog demo', buttons: ['OK', 'Cancel'] })`,
          run: showDialogMessage
        },
        {
          id: 'dialog.showOpenDialog',
          label: text('Open and save', '打开与保存'),
          description: text('Shows native open and save dialogs.', '显示原生打开和保存对话框。'),
          methods: ['dialog.showOpenDialog', 'dialog.showSaveDialog'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.dialog.showOpenDialog({ properties: ['openFile'] })\nawait window.mulby.dialog.showSaveDialog({ defaultPath: 'mulby-demo.txt' })`,
          run: showOpenSaveDialogs
        },
        {
          id: 'dialog.showErrorBox',
          label: text('Error box', '错误框'),
          description: text('Shows a native error box.', '显示原生错误框。'),
          methods: ['dialog.showErrorBox'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `window.mulby.dialog.showErrorBox('Mulby demo', 'Error box demo')`,
          run: showDialogError
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'dialog-message',
        label: 'Show message box',
        description: 'Displays a native message box with two buttons and returns the selected index.',
        methods: ['dialog.showMessageBox'],
        safety: 'opens-system-ui',
        code: `const result = await window.mulby.dialog.showMessageBox({ message: 'Mulby dialog demo', buttons: ['OK', 'Cancel'] })`,
        async run() {
          const api = mulby()
          if (!api?.dialog) return unavailable('Dialog message')
          const result = await api.dialog.showMessageBox({
            type: 'info',
            title: 'Mulby API Demo',
            message: 'Mulby dialog demo',
            detail: 'This demonstrates dialog.showMessageBox(options).',
            buttons: ['OK', 'Cancel'],
            defaultId: 0,
            cancelId: 1
          })
          return { ok: true, title: 'Dialog message', data: result }
        }
      },
      {
        id: 'dialog-open-save-error',
        label: 'Open, save, and error dialogs',
        description: 'Shows native open and save dialogs and an error box, returning whether the user cancelled selection.',
        methods: ['dialog.showOpenDialog', 'dialog.showSaveDialog', 'dialog.showErrorBox'],
        safety: 'opens-system-ui',
        code: `await window.mulby.dialog.showOpenDialog({ properties: ['openFile'] })\nawait window.mulby.dialog.showSaveDialog({ defaultPath: 'mulby-demo.txt' })\nwindow.mulby.dialog.showErrorBox('Mulby demo', 'Error box demo')`,
        async run() {
          const api = mulby()
          if (!api?.dialog) return unavailable('Dialog open/save/error')
          const openResult = await api.dialog.showOpenDialog({
            title: 'Mulby demo open dialog',
            properties: ['openFile']
          })
          const saveResult = await api.dialog.showSaveDialog({
            title: 'Mulby demo save dialog',
            defaultPath: 'mulby-demo.txt'
          })
          const errorResult = await api.dialog.showErrorBox('Mulby demo error box', 'This demonstrates dialog.showErrorBox(title, content).')
          return { ok: true, title: 'Dialog open/save/error', data: { openResult, saveResult, errorResult } }
        }
      }
    ]
  }),
  catalogModule('notification', {
    title: 'Notification',
    category: 'ui',
    contexts: ['renderer', 'backend'],
    notes: ['Requires notification permission in manifest for plugins that send system notifications.'],
    playground: playground(
      text('Notification sender', '通知发送器'),
      text('Send a real host notification and inspect the result.', '发送真实宿主通知并查看结果。'),
      [
        {
          id: 'notification.show',
          label: text('Show notification', '显示通知'),
          description: text('Sends an informational notification.', '发送一条信息级通知。'),
          methods: ['notification.show'],
          safety: 'requires-permission',
          cleanup: false,
          code: `window.mulby.notification.show('Mulby notification demo', 'info')`,
          run: showNotification
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'notification-show',
        label: 'Show notification',
        description: 'Sends an informational demo notification.',
        methods: ['notification.show'],
        safety: 'requires-permission',
        code: `window.mulby.notification.show('Mulby notification demo', 'info')`,
        async run() {
          const api = mulby()
          if (!api?.notification) return unavailable('Notification show')
          await api.notification.show('Mulby notification demo', 'info')
          return { ok: true, title: 'Notification show', data: { shown: true } }
        }
      }
    ]
  }),
  catalogModule('window', {
    title: 'Window',
    category: 'ui',
    contexts: ['renderer'],
    notes: [
      'Window APIs affect the current plugin window. Prefer reversible controls in demos.',
      '`window.create` loads the same manifest UI entry and passes route/query information; it does not load arbitrary HTML by default.'
    ],
    playground: playground(
      text('Live child window workbench', '子窗口实时工作台'),
      text(
        'Create a real child window, keep it visible, then control it with explicit follow-up actions.',
        '创建真实子窗口并保持可见，再通过后续按钮控制它。'
      ),
      [
        {
          id: 'window.create',
          label: text('Create child', '创建子窗口'),
          description: text('Creates a child window and leaves it open for inspection.', '创建子窗口并保持打开，便于观察。'),
          methods: ['window.create'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `const child = await window.mulby.window.create('child-demo', { width: 560, height: 430, title: 'Mulby child demo' })`,
          run: createChildWindow
        },
        {
          id: 'window.postMessage',
          label: text('Send message', '发送消息'),
          description: text('Posts a message to the active child window.', '向当前子窗口发送消息。'),
          methods: ['window.onChildMessage', 'window.sendToParent'],
          safety: 'safe',
          cleanup: false,
          code: `await child.postMessage('mulby-demo:hello', { ok: true })`,
          run: sendChildWindowMessage
        },
        {
          id: 'window.focusChild',
          label: text('Focus child', '聚焦子窗口'),
          description: text('Shows and focuses the active child window.', '显示并聚焦当前子窗口。'),
          methods: ['window.show', 'window.focus'],
          safety: 'safe',
          cleanup: false,
          code: `await child.show()\nawait child.focus()`,
          run: focusChildWindow
        },
        {
          id: 'window.closeChild',
          label: text('Close child', '关闭子窗口'),
          description: text('Closes the child window only when explicitly requested.', '仅在用户明确点击时关闭子窗口。'),
          methods: ['window.close'],
          safety: 'opens-system-ui',
          cleanup: true,
          code: `await child.close()`,
          run: closeChildWindow
        }
      ],
      ['status', 'log', 'external', 'json']
    ),
    examples: [
      {
        id: 'window-state',
        label: 'Read window state',
        description: 'Reads mode, type, bounds, opacity, and maximize/top state when available.',
        methods: ['window.getBounds', 'window.getOpacity', 'window.getMode', 'window.getWindowType', 'window.getState', 'window.onWindowStateChange'],
        safety: 'safe',
        code: `const state = await window.mulby.window.getState()\nconst bounds = await window.mulby.window.getBounds()`,
        async run() {
          const api = mulby()
          if (!api?.window) return unavailable('Window state')
          const [state, bounds, mode, type, opacity] = await Promise.all([
            api.window.getState?.(),
            api.window.getBounds?.(),
            api.window.getMode?.(),
            api.window.getWindowType?.(),
            api.window.getOpacity?.()
          ])
          const stateChanges: unknown[] = []
          const off = api.onWindowStateChange?.((next: unknown) => stateChanges.push(next))
          off?.()
          return { ok: true, title: 'Window state', data: { state, bounds, mode, type, opacity, stateChanges } }
        }
      },
      {
        id: 'window-control',
        label: 'Control current window',
        description: 'Shows, focuses, retitles, resizes, repositions, changes bounds, toggles opacity and background throttling, searches in page, and invalidates the current window.',
        methods: ['window.hide', 'window.show', 'window.showInactive', 'window.focus', 'window.setTitle', 'window.setSize', 'window.setPosition', 'window.setBounds', 'window.setExpendHeight', 'window.center', 'window.setAlwaysOnTop', 'window.setOpacity', 'window.setIgnoreMouseEvents', 'window.setVisibleOnAllWorkspaces', 'window.setFullScreen', 'window.setBackgroundThrottling', 'window.findInPage', 'window.stopFindInPage', 'window.invalidate'],
        safety: 'safe',
        code: `await window.mulby.window.show()\nawait window.mulby.window.focus()\nawait window.mulby.window.setTitle('Mulby API Demo')\nawait window.mulby.window.setSize(1180, 820)\nawait window.mulby.window.setOpacity(0.98)\nawait window.mulby.window.setOpacity(1)`,
        async run() {
          const api = mulby()
          if (!api?.window) return unavailable('Window control')
          const before = await api.window.getBounds?.()
          await api.window.hide?.(false)
          await wait(80)
          await api.window.show?.()
          await api.window.showInactive?.()
          await api.window.focus?.()
          await api.window.setTitle?.('Mulby API Demo')
          await api.window.setSize?.(1180, 820)
          if (before) {
            await api.window.setPosition?.(before.x, before.y)
          }
          await api.window.setBounds?.({
            x: before?.x,
            y: before?.y,
            width: Math.min(before?.width ?? 1180, 1180),
            height: Math.min(before?.height ?? 820, 820)
          })
          await api.window.setExpendHeight?.(820, true)
          await api.window.center?.()
          await api.window.setAlwaysOnTop?.(false)
          await api.window.setIgnoreMouseEvents?.(false)
          await api.window.setVisibleOnAllWorkspaces?.(false)
          await api.window.setFullScreen?.(false)
          await api.window.setBackgroundThrottling?.(true)
          const findResult = await api.window.findInPage?.('Mulby')
          await api.window.stopFindInPage?.('clearSelection')
          await api.window.setOpacity?.(0.98)
          await api.window.setOpacity?.(1)
          await api.window.invalidate?.()
          const after = await api.window.getBounds?.()
          return { ok: true, title: 'Window control', data: { before, after, findResult } }
        }
      },
      {
        id: 'window-child',
        label: 'Create and control child window',
        description: 'Creates a child window, exercises child handle actions, sends a message, listens for child messages, and leaves it open for explicit cleanup.',
        methods: ['window.create', 'window.sendToParent', 'window.onChildMessage'],
        safety: 'opens-system-ui',
        code: `const child = await window.mulby.window.create('child-demo', { width: 520, height: 420, title: 'Mulby child demo', params: { source: 'window.create' } })\nawait child?.setTitle('Mulby child demo')\nawait child?.postMessage('mulby-demo:hello', { ok: true })\n// Keep the child open until the user explicitly closes it.`,
        async run() {
          return createChildWindow()
        }
      },
      {
        id: 'window-detach-drag-menu',
        label: 'Detach, menu, drag, reload, and close controls',
        description: 'Creates a disposable child window to close/destroy, opens the plugin menu, starts a file drag payload, and exposes remaining disruptive controls.',
        methods: ['window.detach', 'window.close', 'window.terminatePlugin', 'window.showPluginMenu', 'window.reload', 'window.minimize', 'window.maximize', 'window.resizeDrag', 'window.startDrag'],
        safety: 'opens-system-ui',
        code: `await window.mulby.window.showPluginMenu()\n// window.mulby.window.detach()\n// window.mulby.window.reload()\n// window.mulby.window.close()`,
        async run() {
          const api = mulby()
          if (!api?.window) return unavailable('Window disruptive controls')
          const menu = await api.window.showPluginMenu?.()
          const child = await api.window.create?.('disruptive-demo', {
            width: 360,
            height: 260,
            title: 'Mulby disposable window'
          })
          await child?.show?.()
          await child?.close?.()
          const childForDestroy = await api.window.create?.('destroy-demo', {
            width: 320,
            height: 220,
            title: 'Mulby destroy demo'
          })
          await childForDestroy?.destroy?.()
          const dragFile = await callBackendExample('windowDragFile')
          if (!((dragFile as any)?.warning) && typeof (dragFile as any)?.filePath === 'string') {
            api.window.startDrag?.((dragFile as any).filePath)
          }
          const before = await api.window.getBounds?.()
          api.window.resizeDrag?.({
            edge: 'bottom-right',
            startX: before?.x ?? 0,
            startY: before?.y ?? 0,
            currentX: (before?.x ?? 0) + 1,
            currentY: (before?.y ?? 0) + 1,
            baseBounds: before ?? { x: 0, y: 0, width: 1180, height: 820 }
          })
          return {
            ok: true,
            title: 'Window disruptive controls',
            data: {
              menu,
              childClosed: child?.id,
              childDestroyed: childForDestroy?.id,
              dragFile,
              available: {
                detach: typeof api.window.detach,
                close: typeof api.window.close,
                terminatePlugin: typeof api.window.terminatePlugin,
                reload: typeof api.window.reload,
                minimize: typeof api.window.minimize,
                maximize: typeof api.window.maximize,
                resizeDrag: typeof api.window.resizeDrag,
                startDrag: typeof api.window.startDrag
              },
              note: 'detach, reload, minimize, maximize, terminatePlugin, and closing the current reference window are exposed as copied snippets because executing them would interrupt this reference UI.'
            }
          }
        }
      }
    ]
  }),
  catalogModule('sub-input', {
    title: 'Sub Input',
    category: 'ui',
    contexts: ['renderer'],
    notes: [
      'Sub input is most useful when a panel-mode plugin wants structured secondary text input.',
      'Always remove the sub input when a workflow ends.'
    ],
    playground: playground(
      text('Sub input controller', '子输入控制器'),
      text(
        'Attach a host sub input, set a value, focus/select it, and remove it explicitly.',
        '挂载宿主子输入框，设置值、聚焦/选择，并显式移除。'
      ),
      [
        {
          id: 'subInput.set',
          label: text('Show sub input', '显示子输入'),
          description: text('Creates and focuses a sub input with demo text.', '创建并聚焦带演示文本的子输入框。'),
          methods: ['subInput.set', 'subInput.setValue', 'subInput.focus', 'subInput.onChange'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.subInput.set('Type API search text...', true)\nawait window.mulby.subInput.setValue('Mulby demo')`,
          run: showSubInput
        },
        {
          id: 'subInput.select',
          label: text('Focus and select', '聚焦并全选'),
          description: text('Focuses and selects the current sub input.', '聚焦并全选当前子输入内容。'),
          methods: ['subInput.focus', 'subInput.select', 'subInput.blur'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.subInput.focus()\nawait window.mulby.subInput.select()`,
          run: selectSubInput
        },
        {
          id: 'subInput.remove',
          label: text('Remove sub input', '移除子输入'),
          description: text('Removes the current sub input.', '移除当前子输入框。'),
          methods: ['subInput.remove'],
          safety: 'safe',
          cleanup: true,
          code: `await window.mulby.subInput.remove()`,
          run: removeSubInput
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'sub-input-preview',
        label: 'Show sub input',
        description: 'Creates a sub input with a demo placeholder.',
        methods: ['subInput.set', 'subInput.setValue', 'subInput.focus', 'subInput.blur', 'subInput.select', 'subInput.onChange'],
        safety: 'safe',
        code: `const off = window.mulby.subInput.onChange((data) => console.log(data.text))\nawait window.mulby.subInput.set('Type API search text...', true)\nawait window.mulby.subInput.setValue('Mulby demo')\nawait window.mulby.subInput.focus()\nawait window.mulby.subInput.select()\nawait window.mulby.subInput.blur()\noff()`,
        async run() {
          const api = mulby()
          if (!api?.subInput) return unavailable('Sub input')
          const changes: unknown[] = []
          const off = api.subInput.onChange?.((data: unknown) => changes.push(data))
          const result = await api.subInput.set('Type API search text...', true)
          await api.subInput.setValue?.('Mulby demo')
          await api.subInput.focus?.()
          await api.subInput.select?.()
          await api.subInput.blur?.()
          off?.()
          return { ok: true, title: 'Sub input', data: { result, changes } }
        }
      },
      {
        id: 'sub-input-remove',
        label: 'Remove sub input',
        description: 'Removes the current sub input.',
        methods: ['subInput.remove'],
        safety: 'safe',
        code: `await window.mulby.subInput.remove()`,
        async run() {
          const api = mulby()
          if (!api?.subInput) return unavailable('Sub input remove')
          const result = await api.subInput.remove()
          return { ok: true, title: 'Sub input remove', data: { result } }
        }
      }
    ]
  }),
  catalogModule('theme', {
    title: 'Theme',
    category: 'ui',
    contexts: ['renderer'],
    notes: ['Use `getActual` when the configured theme is `system` and the UI needs the resolved light/dark value.'],
    playground: playground(
      text('Theme switcher', '主题切换器'),
      text('Read the configured theme and switch between light, dark, and system modes.', '读取当前主题，并在亮色、暗色和跟随系统之间切换。'),
      [
        {
          id: 'theme.get',
          label: text('Read theme', '读取主题'),
          description: text('Reads configured and actual theme values.', '读取配置主题和实际主题。'),
          methods: ['theme.get', 'theme.getActual', 'onThemeChange'],
          safety: 'safe',
          cleanup: false,
          code: `const theme = await window.mulby.theme.get()\nconst actual = await window.mulby.theme.getActual()`,
          run: readTheme
        },
        {
          id: 'theme.set.dark',
          label: text('Set dark', '设为暗色'),
          description: text('Sets theme mode to dark.', '将主题模式设为暗色。'),
          methods: ['theme.set'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.theme.set('dark')`,
          run: () => setThemeMode('dark')
        },
        {
          id: 'theme.set.system',
          label: text('Follow system', '跟随系统'),
          description: text('Restores theme mode to system.', '将主题模式恢复为跟随系统。'),
          methods: ['theme.set'],
          safety: 'safe',
          cleanup: true,
          code: `await window.mulby.theme.set('system')`,
          run: () => setThemeMode('system')
        }
      ],
      ['status', 'preview', 'json']
    ),
    examples: [
      {
        id: 'theme-read',
        label: 'Read theme',
        description: 'Reads configured and actual theme values, sets the current mode back to its existing value, and subscribes to theme changes.',
        methods: ['theme.get', 'theme.set', 'theme.getActual', 'onThemeChange'],
        safety: 'safe',
        code: `const theme = await window.mulby.theme.get()\nconst actual = await window.mulby.theme.getActual()\nconst off = window.mulby.onThemeChange((theme) => console.log(theme))\nawait window.mulby.theme.set(theme.mode ?? theme)\noff()`,
        async run() {
          const api = mulby()
          if (!api?.theme) return unavailable('Theme read')
          const [theme, actual] = await Promise.all([api.theme.get(), api.theme.getActual()])
          const changes: unknown[] = []
          const off = api.onThemeChange?.((next: unknown) => changes.push(next))
          const currentMode = typeof theme === 'string' ? theme : theme?.mode ?? theme?.theme ?? 'system'
          const setResult = await api.theme.set(currentMode)
          off?.()
          return { ok: true, title: 'Theme read', data: { theme, actual, setResult, changes } }
        }
      }
    ]
  }),
  catalogModule('menu', {
    title: 'Menu',
    category: 'ui',
    contexts: ['renderer'],
    notes: ['Context menu item ids are returned to the caller; use ids rather than labels for logic.'],
    playground: playground(
      text('Context menu tester', '上下文菜单测试器'),
      text('Open a real context menu and inspect the selected item id.', '打开真实上下文菜单并查看被选中的菜单项 id。'),
      [
        {
          id: 'menu.showContextMenu',
          label: text('Show menu', '显示菜单'),
          description: text('Shows normal, separator, and checkbox items.', '显示普通项、分隔符和复选框项。'),
          methods: ['menu.showContextMenu'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `const selected = await window.mulby.menu.showContextMenu([{ id: 'inspect', label: 'Inspect module' }])`,
          run: showContextMenu
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'menu-context',
        label: 'Show context menu',
        description: 'Shows a small context menu and returns the selected id.',
        methods: ['menu.showContextMenu'],
        safety: 'opens-system-ui',
        code: `const id = await window.mulby.menu.showContextMenu([{ id: 'copy', label: 'Copy' }])`,
        async run() {
          const api = mulby()
          if (!api?.menu) return unavailable('Context menu')
          const selected = await api.menu.showContextMenu([
            { id: 'inspect', label: 'Inspect module' },
            { type: 'separator' },
            { id: 'copy-code', label: 'Copy code sample' }
          ])
          return { ok: true, title: 'Context menu', data: { selected } }
        }
      }
    ]
  }),
  catalogModule('tray', {
    title: 'Tray',
    category: 'ui',
    contexts: ['renderer', 'backend'],
    notes: [
      'Create only one plugin-owned tray item and destroy it when no longer needed.',
      'This UI reads existence by default; create/destroy is available through backend demo methods.'
    ],
    playground: playground(
      text('Tray lifecycle workbench', '托盘生命周期工作台'),
      text(
        'Create, inspect, update, and explicitly destroy the plugin-owned tray item.',
        '创建、查看、更新并显式销毁插件自有托盘项。'
      ),
      [
        {
          id: 'tray.create',
          label: text('Create tray', '创建托盘'),
          description: text('Creates a plugin tray item and leaves it visible.', '创建插件托盘项并保持可见。'),
          methods: ['tray.create'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'trayCreate')`,
          run: createTray
        },
        {
          id: 'tray.setTooltip',
          label: text('Update tray', '更新托盘'),
          description: text('Updates tooltip and title on the current tray item.', '更新当前托盘项的提示和标题。'),
          methods: ['tray.setIcon', 'tray.setTooltip', 'tray.setTitle'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'trayUpdate')`,
          run: updateTray
        },
        {
          id: 'tray.exists',
          label: text('Read status', '读取状态'),
          description: text('Reads whether the plugin tray exists.', '读取插件托盘是否存在。'),
          methods: ['tray.exists'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'trayStatus')`,
          run: readTray
        },
        {
          id: 'tray.destroy',
          label: text('Destroy tray', '销毁托盘'),
          description: text('Destroys the plugin tray item when requested.', '在用户明确点击时销毁插件托盘项。'),
          methods: ['tray.destroy'],
          safety: 'opens-system-ui',
          cleanup: true,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'trayDestroy')`,
          run: destroyTray
        }
      ],
      ['status', 'log', 'external', 'json']
    ),
    examples: [
      {
        id: 'tray-lifecycle',
        label: 'Create, update, and destroy tray icon',
        description: 'Creates a plugin-owned tray icon, updates icon/tooltip/title, checks state, then destroys it.',
        methods: ['tray.create', 'tray.destroy', 'tray.setIcon', 'tray.setTooltip', 'tray.setTitle', 'tray.exists'],
        safety: 'opens-system-ui',
        code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'trayLifecycle')`,
        async run() {
          const data = await callBackendExample('trayLifecycle')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Tray lifecycle', data }
        }
      }
    ]
  })
]
