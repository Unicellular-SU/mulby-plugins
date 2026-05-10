import type { ApiExampleModule } from './types'
import { attempt, callBackendExample, catalogModule, mulby, playground, text, unavailable } from './helpers'

async function filesystemRoundtripPlayground() {
  const data = await callBackendExample('filesystemRoundtrip')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Filesystem backend roundtrip', data }
}

async function httpGetPlayground() {
  const api = mulby()
  if (!api?.http) return unavailable('HTTP GET')
  const startedAt = performance.now()
  const response = await api.http.get('https://httpbin.org/json')
  return {
    ok: true,
    title: 'HTTP GET',
    data: {
      durationMs: Math.round(performance.now() - startedAt),
      response
    }
  }
}

async function httpPostPlayground() {
  const api = mulby()
  if (!api?.http) return unavailable('HTTP POST')
  const response = await api.http.post('https://httpbin.org/post', {
    source: 'mulby-demo',
    at: new Date().toISOString()
  })
  return { ok: true, title: 'HTTP POST', data: response }
}

async function readNetworkState() {
  const api = mulby()
  if (!api?.network) return unavailable('Network state')
  const online = await api.network.isOnline()
  return { ok: true, title: 'Network state', data: { online } }
}

async function attachNetworkListeners() {
  const api = mulby()
  if (!api?.network) return unavailable('Network listeners')
  let onlineEvents = 0
  let offlineEvents = 0
  const onOnline = () => { onlineEvents += 1 }
  const onOffline = () => { offlineEvents += 1 }
  api.network.onOnline(onOnline)
  api.network.onOffline(onOffline)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
  return { ok: true, title: 'Network listeners', data: { attachedAndRemoved: true, onlineEvents, offlineEvents } }
}

async function readShellPolicy() {
  const data = await callBackendExample('shellPolicyAudit')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Shell policy', data }
}

async function runShellCommand() {
  const data = await callBackendExample('shellRunCommand')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Shell command', data }
}

async function runShellSystemActions() {
  const data = await callBackendExample('shellSystemActions')
  if ((data as any)?.warning) return data as any
  return { ok: true, title: 'Shell system actions', data }
}

async function openInBrowserVisible() {
  const api = mulby()
  if (!api?.inbrowser) return unavailable('InBrowser open')
  const data = await api.inbrowser
    .goto('https://example.com')
    .show()
    .viewport(900, 700)
    .wait('h1')
    .evaluate(() => ({
      title: document.title,
      heading: document.querySelector('h1')?.textContent
    }))
    .run({ show: true, width: 900, height: 700 })
  return {
    ok: true,
    title: 'InBrowser open',
    data: {
      data,
      keptVisible: true,
      note: 'Use idle browser cleanup or close the browser window manually when finished.'
    }
  }
}

async function extractInBrowserContent() {
  const api = mulby()
  if (!api?.inbrowser) return unavailable('InBrowser extract')
  const data = await api.inbrowser
    .goto('https://example.com')
    .show()
    .wait('h1')
    .markdown('body')
    .screenshot('body')
    .evaluate(() => ({ title: document.title, url: window.location.href }))
    .end()
    .run({ show: true, width: 900, height: 700 })
  return { ok: true, title: 'InBrowser extract', data }
}

async function cleanupInBrowser() {
  const api = mulby()
  if (!api?.inbrowser) return unavailable('InBrowser cleanup')
  const idleBefore = await api.inbrowser.getIdleInBrowsers?.()
  const cache = await api.inbrowser.clearInBrowserCache?.()
  const proxy = await attempt('setInBrowserProxy', () => api.inbrowser.setInBrowserProxy?.({ mode: 'direct' }))
  return { ok: true, title: 'InBrowser cleanup', data: { idleBefore, cache, proxy } }
}

export const filesNetworkExamples: ApiExampleModule[] = [
  catalogModule('filesystem', {
    title: 'Filesystem',
    category: 'files-network',
    contexts: ['renderer', 'backend'],
    notes: [
      'Renderer APIs operate on explicit paths from the user or host-provided attachments.',
      'Backend-only path helpers such as `join`, `dirname`, and `getDataPath` are demonstrated through host RPC.'
    ],
    playground: playground(
      text('Filesystem temp workspace', '文件系统临时工作区'),
      text(
        'Runs all filesystem operations in a backend-created temporary demo directory, then reports the files touched.',
        '在后端创建的临时演示目录中运行文件系统操作，并返回涉及的文件。'
      ),
      [
        {
          id: 'filesystem.roundtrip',
          label: text('Run roundtrip', '运行读写流程'),
          description: text('Creates, reads, stats, copies, moves, and removes demo files.', '创建、读取、检查、复制、移动并删除演示文件。'),
          methods: ['filesystem.readFile', 'filesystem.writeFile', 'filesystem.exists', 'filesystem.readdir', 'filesystem.mkdir', 'filesystem.stat', 'filesystem.copy', 'filesystem.move', 'filesystem.unlink', 'filesystem.extname', 'filesystem.join', 'filesystem.dirname', 'filesystem.basename', 'filesystem.getDataPath'],
          safety: 'writes-plugin-data',
          cleanup: true,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'filesystemRoundtrip')`,
          run: filesystemRoundtripPlayground
        }
      ],
      ['status', 'table', 'json']
    ),
    examples: [
      {
        id: 'filesystem-temp-roundtrip',
        label: 'Backend temp file roundtrip',
        description: 'Asks the backend to write, read, stat, and remove a demo file under the plugin data path.',
        methods: ['filesystem.readFile', 'filesystem.writeFile', 'filesystem.exists', 'filesystem.readdir', 'filesystem.mkdir', 'filesystem.stat', 'filesystem.copy', 'filesystem.move', 'filesystem.unlink', 'filesystem.extname', 'filesystem.join', 'filesystem.dirname', 'filesystem.basename', 'filesystem.getDataPath'],
        safety: 'writes-plugin-data',
        code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'filesystemRoundtrip')`,
        async run() {
          const data = await callBackendExample('filesystemRoundtrip')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Filesystem backend roundtrip', data }
        }
      }
    ]
  }),
  catalogModule('http', {
    title: 'HTTP',
    category: 'files-network',
    contexts: ['renderer', 'backend'],
    notes: [
      'Use `request` for full control; convenience helpers cover common verbs.',
      'This demo calls an HTTPS endpoint designed for lightweight JSON responses.'
    ],
    playground: playground(
      text('HTTP request workbench', 'HTTP 请求工作台'),
      text(
        'Run visible GET and POST calls and inspect response payloads, status, and timing.',
        '运行可观察的 GET 和 POST 请求，并查看响应、状态和耗时。'
      ),
      [
        {
          id: 'http.get',
          label: text('GET JSON', 'GET JSON'),
          description: text('Fetches httpbin JSON through Mulby HTTP.', '通过 Mulby HTTP 获取 httpbin JSON。'),
          methods: ['http.get', 'http.request'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.http.get('https://httpbin.org/json')`,
          run: httpGetPlayground
        },
        {
          id: 'http.post',
          label: text('POST payload', 'POST 数据'),
          description: text('Posts a demo JSON body and renders the echoed response.', '提交演示 JSON 请求体并展示回显响应。'),
          methods: ['http.post', 'http.put', 'http.delete'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.http.post('https://httpbin.org/post', { source: 'mulby-demo' })`,
          run: httpPostPlayground
        }
      ],
      ['status', 'json', 'log']
    ),
    examples: [
      {
        id: 'http-verbs',
        label: 'Run HTTP verbs',
        description: 'Runs request, GET, POST, PUT, and DELETE against lightweight JSON endpoints.',
        methods: ['http.request', 'http.get', 'http.post', 'http.put', 'http.delete'],
        safety: 'safe',
        code: `await window.mulby.http.request({ url: 'https://httpbin.org/json', method: 'GET' })\nawait window.mulby.http.get('https://httpbin.org/json')\nawait window.mulby.http.post('https://httpbin.org/post', { source: 'mulby-demo' })`,
        async run() {
          const api = mulby()
          if (!api?.http) return unavailable('HTTP verbs')
          const [request, get, post, put, deleted] = await Promise.all([
            api.http.request({ url: 'https://httpbin.org/json', method: 'GET' }),
            api.http.get('https://httpbin.org/json'),
            api.http.post('https://httpbin.org/post', { source: 'mulby-demo' }),
            api.http.put('https://httpbin.org/put', { source: 'mulby-demo' }),
            api.http.delete('https://httpbin.org/delete')
          ])
          return { ok: true, title: 'HTTP verbs', data: { request, get, post, put, delete: deleted } }
        }
      }
    ]
  }),
  catalogModule('network', {
    title: 'Network',
    category: 'files-network',
    contexts: ['renderer', 'backend'],
    notes: [
      'Renderer subscriptions are useful for UI state. Backend network API focuses on current connectivity state.'
    ],
    playground: playground(
      text('Network monitor', '网络状态监视器'),
      text('Read online state and verify connectivity event listeners can be attached.', '读取在线状态，并验证连通性事件监听可被挂载。'),
      [
        {
          id: 'network.isOnline',
          label: text('Read online state', '读取在线状态'),
          description: text('Reads current network connectivity.', '读取当前网络连通状态。'),
          methods: ['network.isOnline'],
          safety: 'safe',
          cleanup: false,
          code: `const online = await window.mulby.network.isOnline()`,
          run: readNetworkState
        },
        {
          id: 'network.listeners',
          label: text('Attach listeners', '挂载监听'),
          description: text('Registers online/offline listeners and immediately removes browser listeners used by the demo.', '注册 online/offline 监听，并立即移除演示用浏览器监听。'),
          methods: ['network.onOnline', 'network.onOffline'],
          safety: 'safe',
          cleanup: true,
          code: `window.mulby.network.onOnline(() => console.log('online'))\nwindow.mulby.network.onOffline(() => console.log('offline'))`,
          run: attachNetworkListeners
        }
      ],
      ['status', 'log', 'json']
    ),
    examples: [
      {
        id: 'network-state',
        label: 'Read online state',
        description: 'Reads network state and registers online/offline listeners, then removes browser event listeners immediately.',
        methods: ['network.isOnline', 'network.onOnline', 'network.onOffline'],
        safety: 'safe',
        code: `const online = await window.mulby.network.isOnline()\nwindow.mulby.network.onOnline(() => console.log('online'))\nwindow.mulby.network.onOffline(() => console.log('offline'))`,
        async run() {
          const api = mulby()
          if (!api?.network) return unavailable('Network state')
          const online = await api.network.isOnline()
          let onlineEvents = 0
          let offlineEvents = 0
          const onOnline = () => { onlineEvents += 1 }
          const onOffline = () => { offlineEvents += 1 }
          api.network.onOnline(onOnline)
          api.network.onOffline(onOffline)
          window.removeEventListener('online', onOnline)
          window.removeEventListener('offline', onOffline)
          return { ok: true, title: 'Network state', data: { online, listenersRegisteredAndRemoved: true, onlineEvents, offlineEvents } }
        }
      }
    ]
  }),
  catalogModule('shell', {
    title: 'Shell',
    category: 'files-network',
    contexts: ['renderer', 'backend'],
    notes: [
      '`runCommand` requires `manifest.permissions.runCommand: true` and passes through the global command policy.',
      'The runnable command example uses backend `process.execPath` and `shell: false`; policy may still require user consent.'
    ],
    playground: playground(
      text('Shell integration workbench', 'Shell 集成工作台'),
      text('Inspect command policy, run a safe backend command, and trigger explicit system shell actions.', '查看命令策略、运行安全后端命令，并显式触发系统 Shell 操作。'),
      [
        {
          id: 'shell.policy',
          label: text('Read policy', '读取策略'),
          description: text('Reads runCommand policy and recent audit rows.', '读取 runCommand 策略和最近审计记录。'),
          methods: ['shell.getRunCommandPolicy', 'shell.listRunCommandAudit', 'shell.updateRunCommandPolicy', 'shell.clearRunCommandAudit', 'shell.clearRunCommandTrusted'],
          safety: 'safe',
          cleanup: false,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'shellPolicyAudit')`,
          run: readShellPolicy
        },
        {
          id: 'shell.runCommand',
          label: text('Run command', '运行命令'),
          description: text('Runs node -e through backend with shell disabled.', '在后端以关闭 shell 的方式运行 node -e。'),
          methods: ['shell.runCommand'],
          safety: 'requires-permission',
          cleanup: false,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'shellRunCommand')`,
          run: runShellCommand
        },
        {
          id: 'shell.systemActions',
          label: text('System actions', '系统操作'),
          description: text('Creates demo files, opens path/folder/URL, beeps, and trashes only demo files.', '创建演示文件，打开路径/文件夹/URL，播放提示音，并只移除演示文件。'),
          methods: ['shell.openPath', 'shell.openExternal', 'shell.showItemInFolder', 'shell.openFolder', 'shell.trashItem', 'shell.beep'],
          safety: 'opens-system-ui',
          cleanup: true,
          code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'shellSystemActions')`,
          run: runShellSystemActions
        }
      ],
      ['status', 'external', 'json']
    ),
    examples: [
      {
        id: 'shell-policy',
        label: 'Read command policy and audit',
        description: 'Reads the current runCommand policy, policy mutator availability, and recent audit rows through the backend.',
        methods: ['shell.getRunCommandPolicy', 'shell.updateRunCommandPolicy', 'shell.listRunCommandAudit', 'shell.clearRunCommandAudit', 'shell.clearRunCommandTrusted'],
        safety: 'safe',
        code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'shellPolicyAudit')`,
        async run() {
          const data = await callBackendExample('shellPolicyAudit')
          if ((data as any)?.warning) return data as any
          const api = mulby()
          const rendererRestricted = api?.shell
            ? {
                updateRunCommandPolicy: await attempt('updateRunCommandPolicy', () => api.shell.updateRunCommandPolicy?.({})),
                clearRunCommandAudit: await attempt('clearRunCommandAudit', () => api.shell.clearRunCommandAudit?.()),
                clearRunCommandTrusted: await attempt('clearRunCommandTrusted', () => api.shell.clearRunCommandTrusted?.())
              }
            : null
          return { ok: true, title: 'Shell policy and audit', data: { backend: data, rendererRestricted } }
        }
      },
      {
        id: 'shell-backend-command',
        label: 'Run safe backend command',
        description: 'Asks backend to execute `node -e` with shell disabled.',
        methods: ['shell.runCommand'],
        safety: 'requires-permission',
        code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'shellRunCommand')`,
        async run() {
          const data = await callBackendExample('shellRunCommand')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Shell backend command', data }
        }
      },
      {
        id: 'shell-system-actions',
        label: 'Open paths and move demo file to trash',
        description: 'Creates demo temp files, opens path/folder/URL, beeps, shows a file, and trashes only the demo file.',
        methods: ['shell.openPath', 'shell.openExternal', 'shell.showItemInFolder', 'shell.openFolder', 'shell.trashItem', 'shell.beep'],
        safety: 'opens-system-ui',
        code: `await window.mulby.host.call('mulby-demo', 'runBackendExample', 'shellSystemActions')`,
        async run() {
          const data = await callBackendExample('shellSystemActions')
          if ((data as any)?.warning) return data as any
          return { ok: true, title: 'Shell system actions', data }
        }
      }
    ]
  }),
  catalogModule('inbrowser', {
    title: 'InBrowser',
    category: 'files-network',
    contexts: ['renderer'],
    notes: [
      'InBrowser chains browser actions and returns data through `run` or specific extraction methods.',
      'This example opens `https://example.com`, extracts Markdown, evaluates page data, captures a screenshot payload, and closes the session.'
    ],
    playground: playground(
      text('InBrowser automation workbench', 'InBrowser 自动化工作台'),
      text('Open a visible browser session, extract page content, or clean idle sessions/cache explicitly.', '打开可见浏览器会话、提取页面内容，或显式清理空闲会话和缓存。'),
      [
        {
          id: 'inbrowser.goto',
          label: text('Open visible page', '打开可见页面'),
          description: text('Navigates to example.com and keeps the browser visible.', '导航到 example.com 并保持浏览器可见。'),
          methods: ['inbrowser.goto', 'inbrowser.show', 'inbrowser.viewport', 'inbrowser.wait', 'inbrowser.evaluate', 'inbrowser.run'],
          safety: 'opens-system-ui',
          cleanup: false,
          code: `await window.mulby.inbrowser.goto('https://example.com').show().wait('h1').run({ show: true })`,
          run: openInBrowserVisible
        },
        {
          id: 'inbrowser.extract',
          label: text('Extract content', '提取内容'),
          description: text('Runs markdown, screenshot, evaluate, and closes that session.', '运行 markdown、screenshot、evaluate，并关闭该会话。'),
          methods: ['inbrowser.markdown', 'inbrowser.screenshot', 'inbrowser.evaluate', 'inbrowser.end'],
          safety: 'opens-system-ui',
          cleanup: true,
          code: `await window.mulby.inbrowser.goto('https://example.com').markdown('body').screenshot('body').end().run({ show: true })`,
          run: extractInBrowserContent
        },
        {
          id: 'inbrowser.cleanup',
          label: text('Cleanup browser', '清理浏览器'),
          description: text('Reads idle sessions, resets proxy, and clears InBrowser cache.', '读取空闲会话、重置代理并清理 InBrowser 缓存。'),
          methods: ['inbrowser.getIdleInBrowsers', 'inbrowser.setInBrowserProxy', 'inbrowser.clearInBrowserCache'],
          safety: 'safe',
          cleanup: true,
          code: `await window.mulby.inbrowser.getIdleInBrowsers()\nawait window.mulby.inbrowser.clearInBrowserCache()`,
          run: cleanupInBrowser
        }
      ],
      ['status', 'preview', 'external', 'json']
    ),
    examples: [
      {
        id: 'inbrowser-run-example',
        label: 'Run browser automation chain',
        description: 'Runs a real InBrowser chain against example.com, including navigation, input actions, extraction, screenshot, download, evaluate, and cleanup.',
        methods: [
          'inbrowser.goto',
          'inbrowser.useragent',
          'inbrowser.device',
          'inbrowser.viewport',
          'inbrowser.show',
          'inbrowser.hide',
          'inbrowser.click',
          'inbrowser.mousedown',
          'inbrowser.mouseup',
          'inbrowser.dblclick',
          'inbrowser.hover',
          'inbrowser.type',
          'inbrowser.input',
          'inbrowser.value',
          'inbrowser.check',
          'inbrowser.focus',
          'inbrowser.paste',
          'inbrowser.press',
          'inbrowser.scroll',
          'inbrowser.file',
          'inbrowser.drop',
          'inbrowser.wait',
          'inbrowser.when',
          'inbrowser.css',
          'inbrowser.cookies',
          'inbrowser.setCookies',
          'inbrowser.removeCookies',
          'inbrowser.clearCookies',
          'inbrowser.screenshot',
          'inbrowser.pdf',
          'inbrowser.markdown',
          'inbrowser.download',
          'inbrowser.evaluate',
          'inbrowser.devTools',
          'inbrowser.end',
          'inbrowser.run',
          'inbrowser.getIdleInBrowsers',
          'inbrowser.setInBrowserProxy',
          'inbrowser.clearInBrowserCache'
        ],
        safety: 'opens-system-ui',
        code: `await window.mulby.inbrowser\n  .goto('https://example.com')\n  .wait('h1')\n  .click('body')\n  .type('body', 'Mulby demo')\n  .markdown('body')\n  .screenshot('body')\n  .download(() => 'data:text/plain,mulby-demo')\n  .evaluate(() => ({ title: document.title }))\n  .end()\n  .run({ show: true })`,
        async run() {
          const api = mulby()
          if (!api?.inbrowser) return unavailable('InBrowser run')
          const idleBefore = await api.inbrowser.getIdleInBrowsers?.()
          const cache = await api.inbrowser.clearInBrowserCache?.()
          const proxy = await attempt('setInBrowserProxy', () => api.inbrowser.setInBrowserProxy?.({ mode: 'direct' }))
          const data = await api.inbrowser
            .goto('https://example.com')
            .useragent('MulbyDemo/1.0')
            .device({ userAgent: 'MulbyDemo/1.0', size: { width: 900, height: 700 } })
            .viewport(900, 700)
            .show()
            .hide()
            .show()
            .wait('h1')
            .click('body')
            .mousedown('body')
            .mouseup('body')
            .dblclick('body')
            .hover('body')
            .type('body', 'Mulby demo')
            .input('body', 'Mulby demo input')
            .value('body', 'Mulby demo value')
            .check('body', false)
            .focus('body')
            .paste('Mulby demo paste')
            .press('Escape')
            .scroll(0, 10)
            .file('input[type=file]', [])
            .drop('body', [])
            .when('body')
            .css('body { outline: 2px solid #2563eb; }')
            .cookies()
            .setCookies([{ name: 'mulby_demo', value: '1' }])
            .removeCookies('mulby_demo')
            .clearCookies('https://example.com')
            .markdown('body')
            .screenshot('body')
            .pdf()
            .download(() => 'data:text/plain,mulby-demo')
            .devTools('bottom')
            .evaluate(() => ({ title: document.title, heading: document.querySelector('h1')?.textContent }))
            .end()
            .run({ show: true })
          return { ok: true, title: 'InBrowser run', data: { idleBefore, cache, proxy, data } }
        }
      }
    ]
  })
]
