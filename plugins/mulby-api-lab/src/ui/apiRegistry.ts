export type ApiEndpoint = 'Renderer' | 'Backend' | 'Both' | 'Manifest'
export type ApiRisk = 'safe' | 'permission' | 'writes-lab-data' | 'confirm' | 'destructive' | 'long-running' | 'docs-only'
export type ApiDemoMode = 'live' | 'confirm' | 'sandboxed' | 'docs-only'

export interface ApiMethodSpec {
  name: string
  endpoint: ApiEndpoint
  risk: ApiRisk
  demoMode: ApiDemoMode
  note: string
}

export interface ApiModuleSpec {
  id: string
  title: string
  group: string
  summary: string
  methods: ApiMethodSpec[]
}

function method(name: string, endpoint: ApiEndpoint = 'Renderer', risk: ApiRisk = 'safe', demoMode: ApiDemoMode = 'live', note = '模块页展示调用结果或安全说明。'): ApiMethodSpec {
  return { name, endpoint, risk, demoMode, note }
}

function methods(prefix: string, names: string[], endpoint: ApiEndpoint = 'Renderer', risk: ApiRisk = 'safe', demoMode: ApiDemoMode = 'live') {
  return names.map((name) => method(`${prefix}.${name}`, endpoint, risk, demoMode))
}

export const apiRegistry: ApiModuleSpec[] = [
  {
    id: 'system',
    title: 'System API',
    group: '系统与应用',
    summary: '系统、应用、路径、图标、资源占用和前台窗口信息。',
    methods: [
      ...methods('system', ['getSystemInfo', 'getAppInfo', 'getAppResourceUsage', 'getPath', 'getEnv', 'getIdleTime', 'getFileIcon', 'getFileIcons', 'getNativeId', 'isDev', 'isMacOS', 'isWindows', 'isLinux', 'getCachedActiveWindow', 'getActiveWindow']),
      method('system.onActiveWindowChange', 'Renderer', 'permission', 'confirm')
    ]
  },
  {
    id: 'power',
    title: 'Power API',
    group: '系统与应用',
    summary: '空闲状态、电池、电源和系统睡眠/恢复事件。',
    methods: methods('power', ['getSystemIdleTime', 'getSystemIdleState', 'isOnBatteryPower', 'getCurrentThermalState', 'onSuspend', 'onResume', 'onAC', 'onBattery', 'onLockScreen', 'onUnlockScreen'], 'Both')
  },
  {
    id: 'tray',
    title: 'Tray API',
    group: '系统与应用',
    summary: '插件托盘图标生命周期和提示信息。',
    methods: [
      method('tray.create', 'Both', 'confirm', 'confirm'),
      method('tray.destroy', 'Both', 'confirm', 'confirm'),
      ...methods('tray', ['setIcon', 'setTooltip', 'setTitle'], 'Both', 'confirm', 'confirm'),
      method('tray.exists', 'Both')
    ]
  },
  {
    id: 'tray-menu',
    title: 'Tray Menu API',
    group: '系统与应用',
    summary: '宿主托盘菜单状态、动作和订阅。',
    methods: [
      method('trayMenu.getState'),
      method('trayMenu.action', 'Renderer', 'confirm', 'confirm'),
      method('trayMenu.close', 'Renderer', 'confirm', 'confirm'),
      method('trayMenu.onState')
    ]
  },
  {
    id: 'permission',
    title: 'Permission API',
    group: '系统与应用',
    summary: '系统权限状态、请求能力和系统设置入口。',
    methods: [
      method('permission.getStatus', 'Both', 'permission'),
      method('permission.request', 'Both', 'permission', 'confirm'),
      method('permission.canRequest', 'Both', 'permission'),
      method('permission.openSystemSettings', 'Both', 'confirm', 'confirm'),
      method('permission.isAccessibilityTrusted', 'Both', 'permission')
    ]
  },
  {
    id: 'security',
    title: 'Security API',
    group: '系统与应用',
    summary: 'OS 支持的字符串加密、解密和可用性检查。',
    methods: methods('security', ['isEncryptionAvailable', 'encryptString', 'decryptString'], 'Both')
  },
  {
    id: 'settings',
    title: 'Settings API',
    group: '系统与应用',
    summary: '宿主设置、快捷键录制、开机启动和更新中心。',
    methods: [
      method('settings.get'),
      method('settings.update', 'Renderer', 'confirm', 'confirm'),
      method('settings.reset', 'Renderer', 'destructive', 'docs-only'),
      ...methods('settings', ['pauseShortcuts', 'resumeShortcuts', 'setShortcutRecordingActive', 'onShortcutCaptured', 'getOpenAtLoginState'], 'Renderer', 'confirm', 'confirm'),
      method('settings.setOpenAtLogin', 'Renderer', 'confirm', 'confirm'),
      ...methods('settings', ['getUpdateCenterState', 'checkAppUpdates', 'openUpdateReleasePage'], 'Renderer', 'safe', 'live'),
      method('settings.downloadUpdate', 'Renderer', 'long-running', 'docs-only'),
      method('settings.installUpdate', 'Renderer', 'destructive', 'docs-only'),
      ...methods('settings', ['onUpdateStateChanged', 'onShortcutStatusChanged'])
    ]
  },
  {
    id: 'developer',
    title: 'Developer API',
    group: '系统与应用',
    summary: '插件开发路径、重载和目录选择。',
    methods: [
      method('developer.addPluginPath', 'Renderer', 'confirm', 'confirm'),
      method('developer.removePluginPath', 'Renderer', 'confirm', 'confirm'),
      method('developer.reloadPlugins', 'Renderer', 'confirm', 'confirm'),
      method('developer.selectDirectory', 'Renderer', 'confirm', 'confirm')
    ]
  },
  {
    id: 'app-events',
    title: 'App Events API',
    group: '系统与应用',
    summary: '宿主系统页、插件管理、AI 设置和插件生命周期事件。',
    methods: [
      ...methods('app', ['onOpenSystemPlugin', 'onSystemPluginBeforeAttach', 'onOpenAiSettings', 'onOpenAiMcpSettings', 'onOpenAiToolsSettings', 'onOpenAiSkillsSettings', 'onOpenPluginStore', 'onOpenPluginManager', 'onOpenBackgroundPlugins', 'onOpenTaskScheduler', 'onOpenLogViewer', 'onOpenStorageExplorer', 'onOpenCommandShortcuts', 'onSetSearchText', 'onMainWindowShow']),
      ...methods('pluginLifecycle', ['onPluginInit', 'onPluginAttach', 'onPluginDetached', 'onPluginLaunchStart', 'onPluginLaunchEnd', 'onPluginOut'])
    ]
  },
  {
    id: 'system-plugin',
    title: 'System Plugin API',
    group: '系统与应用',
    summary: '系统插件附着状态和 ready 通知。',
    methods: [
      method('systemPlugin.setActive', 'Renderer', 'confirm', 'confirm'),
      method('systemPlugin.notifyReadyForAttach', 'Renderer', 'confirm', 'confirm'),
      method('systemPlugin.getActive')
    ]
  },
  {
    id: 'system-page',
    title: 'System Page API',
    group: '系统与应用',
    summary: '打开、关闭、分离、重载和监听 Mulby 系统页。',
    methods: [
      method('systemPage.open', 'Renderer', 'confirm', 'confirm'),
      method('systemPage.close', 'Renderer', 'confirm', 'confirm'),
      method('systemPage.detach', 'Renderer', 'confirm', 'confirm'),
      method('systemPage.reload', 'Renderer', 'confirm', 'confirm'),
      ...methods('systemPage', ['getMode', 'getState', 'onStateChange'])
    ]
  },
  {
    id: 'log',
    title: 'Log API',
    group: '系统与应用',
    summary: '日志写入、查询、订阅和日志目录。',
    methods: [
      ...methods('log', ['debug', 'info', 'warn', 'error'], 'Renderer', 'writes-lab-data', 'sandboxed'),
      method('log.getLogs'),
      method('log.clear', 'Renderer', 'destructive', 'docs-only'),
      ...methods('log', ['getLogsDir', 'subscribe', 'onLog'])
    ]
  },
  {
    id: 'ai',
    title: 'AI API',
    group: '系统与应用',
    summary: '模型调用、工具、MCP、Skills、附件、Token 和图片生成。',
    methods: [
      method('ai.call', 'Both', 'confirm', 'confirm'),
      method('ai.abort'),
      ...methods('ai', ['allModels', 'models.fetch', 'testConnection', 'testConnectionStream', 'settings.get', 'settings.update']),
      ...methods('ai.mcp', ['listServers', 'getServer', 'upsertServer', 'removeServer', 'activateServer', 'deactivateServer', 'restartServer', 'checkServer', 'listTools', 'abort', 'getLogs'], 'Renderer', 'confirm', 'confirm'),
      ...methods('ai.skills', ['list', 'refresh', 'listEnabled', 'get', 'install', 'remove', 'enable', 'disable', 'preview', 'resolve', 'previewForCall'], 'Renderer', 'confirm', 'confirm'),
      ...methods('ai.attachments', ['upload', 'get', 'delete', 'uploadToProvider'], 'Renderer', 'confirm', 'confirm'),
      method('ai.tokens.estimate'),
      ...methods('ai.images', ['generate', 'generateStream', 'edit'], 'Renderer', 'confirm', 'confirm'),
      ...methods('ai.tooling.webSearch', ['get', 'update', 'getSettings', 'setActiveProvider'], 'Renderer', 'confirm', 'confirm'),
      ...methods('ai.tooling.pluginTools', ['getDisabled', 'setDisabled'], 'Renderer', 'confirm', 'confirm'),
      ...methods('ai.mcpServer', ['getState', 'start', 'stop', 'restart', 'regenerateToken', 'getTools', 'getClientConfig', 'refreshTools', 'getConfig', 'updatePort'], 'Renderer', 'confirm', 'confirm')
    ]
  },
  {
    id: 'window',
    title: 'Window API',
    group: '窗口与界面',
    summary: '当前窗口控制、子窗口、父子消息、查找、拖拽和子输入。',
    methods: [
      ...methods('window', ['hide', 'show', 'showInactive', 'focus', 'setTitle', 'setSize', 'setPosition', 'setBounds', 'getBounds', 'setExpendHeight', 'center'], 'Renderer', 'confirm', 'confirm'),
      ...methods('window', ['setAlwaysOnTop', 'setIgnoreMouseEvents', 'setVisibleOnAllWorkspaces', 'setFullScreen', 'setBackgroundThrottling', 'detach', 'close', 'terminatePlugin', 'showPluginMenu', 'reload', 'minimize', 'maximize', 'resizeDrag'], 'Renderer', 'confirm', 'confirm'),
      ...methods('window', ['getMode', 'getWindowType', 'getState', 'findInPage', 'stopFindInPage', 'getOpacity', 'setOpacity', 'onWindowStateChange', 'invalidate']),
      method('window.create', 'Renderer', 'confirm', 'confirm', '创建子窗口并返回 ChildWindowHandle。'),
      method('ChildWindowHandle.show', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.hide', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.close', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.destroy', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.focus', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.showInactive', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setTitle', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setSize', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setPosition', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setBounds', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.getBounds', 'Renderer', 'safe', 'live'),
      method('ChildWindowHandle.setOpacity', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setBackgroundThrottling', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setIgnoreMouseEvents', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setAlwaysOnTop', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setVisibleOnAllWorkspaces', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.setFullScreen', 'Renderer', 'confirm', 'confirm'),
      method('ChildWindowHandle.postMessage', 'Renderer', 'confirm', 'confirm'),
      method('window.sendToParent', 'Renderer', 'confirm', 'confirm'),
      method('window.onChildMessage', 'Renderer'),
      method('window.startDrag', 'Renderer', 'confirm', 'confirm'),
      ...methods('window.subInput', ['set', 'remove', 'setValue', 'focus', 'blur', 'select', 'onChange'], 'Renderer', 'confirm', 'confirm'),
      ...methods('mulbyMain.subInput', ['onEnabled', 'onDisabled', 'onSetValue', 'onFocus', 'onBlur', 'onSelect', 'sendChange'], 'Renderer', 'docs-only', 'docs-only'),
      method('mulbyMain.clipboard.onAutoPaste')
    ]
  },
  {
    id: 'theme',
    title: 'Theme API',
    group: '窗口与界面',
    summary: '主题读取、设置和变更监听。',
    methods: [
      ...methods('theme', ['get', 'set', 'getActual']),
      method('onThemeChange')
    ]
  },
  {
    id: 'dialog',
    title: 'Dialog API',
    group: '窗口与界面',
    summary: '原生打开、保存、消息和错误框。',
    methods: [
      method('dialog.showOpenDialog', 'Both', 'confirm', 'confirm'),
      method('dialog.showSaveDialog', 'Both', 'confirm', 'confirm'),
      method('dialog.showMessageBox', 'Both', 'confirm', 'confirm'),
      method('dialog.showErrorBox', 'Both', 'confirm', 'confirm')
    ]
  },
  {
    id: 'menu',
    title: 'Menu API',
    group: '窗口与界面',
    summary: '原生上下文菜单。',
    methods: [method('menu.showContextMenu', 'Renderer', 'confirm', 'confirm')]
  },
  {
    id: 'notification',
    title: 'Notification API',
    group: '窗口与界面',
    summary: '宿主通知。',
    methods: [method('notification.show', 'Both', 'confirm', 'confirm')]
  },
  {
    id: 'tts',
    title: 'TTS API',
    group: '窗口与界面',
    summary: '文本朗读、暂停、恢复和语音列表。',
    methods: [
      method('tts.speak', 'Renderer', 'confirm', 'confirm'),
      ...methods('tts', ['stop', 'pause', 'resume'], 'Renderer', 'confirm', 'confirm'),
      ...methods('tts', ['getVoices', 'isSpeaking'])
    ]
  },
  {
    id: 'super-panel',
    title: 'Super Panel API',
    group: '窗口与界面',
    summary: '超级面板状态、动作、关闭和监听。',
    methods: [
      method('superPanel.getState'),
      method('superPanel.action', 'Renderer', 'confirm', 'confirm'),
      method('superPanel.close', 'Renderer', 'confirm', 'confirm'),
      method('superPanel.setIgnoreBlur', 'Renderer', 'confirm', 'confirm'),
      method('superPanel.onState')
    ]
  },
  {
    id: 'shortcut',
    title: 'GlobalShortcut API',
    group: '输入与快捷',
    summary: '全局快捷键注册、注销和触发监听。',
    methods: [
      method('shortcut.register', 'Both', 'confirm', 'confirm'),
      method('shortcut.unregister', 'Both', 'confirm', 'confirm'),
      method('shortcut.unregisterAll', 'Both', 'confirm', 'confirm'),
      method('shortcut.isRegistered', 'Both'),
      method('shortcut.onTriggered', 'Both')
    ]
  },
  {
    id: 'clipboard',
    title: 'Clipboard API',
    group: '输入与快捷',
    summary: '文本、图片、文件剪贴板读写和格式判断。',
    methods: [
      method('clipboard.readText'),
      method('clipboard.writeText', 'Both', 'writes-lab-data', 'sandboxed'),
      method('clipboard.readImage'),
      method('clipboard.writeImage', 'Both', 'writes-lab-data', 'confirm'),
      method('clipboard.writeFiles', 'Both', 'writes-lab-data', 'confirm'),
      method('clipboard.readFiles'),
      method('clipboard.getFormat')
    ]
  },
  {
    id: 'clipboard-history',
    title: 'Clipboard History API',
    group: '输入与快捷',
    summary: '剪贴板历史查询、复制、收藏、删除和统计。',
    methods: [
      ...methods('clipboardHistory', ['query', 'get', 'copy', 'toggleFavorite', 'stats']),
      method('clipboardHistory.delete', 'Renderer', 'destructive', 'docs-only'),
      method('clipboardHistory.clear', 'Renderer', 'destructive', 'docs-only')
    ]
  },
  {
    id: 'input',
    title: 'Input API',
    group: '输入与快捷',
    summary: '粘贴、输入、恢复窗口和键鼠模拟。',
    methods: [
      ...methods('input', ['hideMainWindowPasteText', 'hideMainWindowPasteImage', 'hideMainWindowPasteFile', 'hideMainWindowTypeString', 'restoreWindows'], 'Both', 'confirm', 'confirm'),
      ...methods('input', ['simulateKeyboardTap', 'simulateMouseMove', 'simulateMouseClick', 'simulateMouseDoubleClick', 'simulateMouseRightClick'], 'Both', 'confirm', 'confirm')
    ]
  },
  {
    id: 'input-monitor',
    title: 'Input Monitor API',
    group: '输入与快捷',
    summary: '系统级键鼠事件监听。',
    methods: [
      method('inputMonitor.isAvailable', 'Both'),
      method('inputMonitor.requireAccessibility', 'Both', 'permission', 'confirm'),
      method('inputMonitor.start', 'Both', 'permission', 'confirm'),
      method('inputMonitor.stop', 'Both', 'permission', 'confirm'),
      method('inputMonitor.onEvent', 'Both', 'permission', 'confirm')
    ]
  },
  {
    id: 'plugin',
    title: 'Plugin API',
    group: '插件与调度',
    summary: '插件列表、搜索、运行、偏好、快捷键、后台和生命周期。',
    methods: [
      ...methods('plugin', ['getAll', 'listCommands', 'search', 'getMainPushPlugins', 'getRecentUsed', 'getSearchPreferences', 'getReadme', 'listCommandShortcuts', 'validateCommandShortcut', 'listBackground', 'getBackgroundInfo']),
      ...methods('plugin', ['mainPushSelect', 'run', 'runCommand', 'pinFeature', 'unpinFeature', 'hideFeature', 'unhideFeature', 'removeRecentUsage', 'bindCommandShortcut', 'unbindCommandShortcut', 'setCommandDisabled', 'redirect', 'outPlugin', 'startBackground', 'stopBackground', 'stopPlugin', 'prewarm'], 'Renderer', 'confirm', 'confirm'),
      method('plugin.install', 'Renderer', 'destructive', 'docs-only'),
      method('plugin.resolveDroppedFilePaths'),
      method('plugin.enable', 'Renderer', 'destructive', 'docs-only'),
      method('plugin.disable', 'Renderer', 'destructive', 'docs-only'),
      method('plugin.uninstall', 'Renderer', 'destructive', 'docs-only'),
      ...methods('pluginLifecycle', ['onPluginInit', 'onPluginAttach', 'onPluginDetached', 'onPluginLaunchStart', 'onPluginLaunchEnd'])
    ]
  },
  {
    id: 'plugin-store',
    title: 'Plugin Store API',
    group: '插件与调度',
    summary: '插件商店获取、URL 安装和更新检查。',
    methods: [
      method('pluginStore.fetch'),
      method('pluginStore.installFromUrl', 'Renderer', 'destructive', 'docs-only'),
      method('pluginStore.checkUpdatesInstalled'),
      method('pluginStore.updateAll', 'Renderer', 'destructive', 'docs-only')
    ]
  },
  {
    id: 'host',
    title: 'Host API',
    group: '插件与调度',
    summary: 'Renderer 调用插件后端 rpc、状态和重启。',
    methods: [
      method('host.invoke'),
      method('host.call'),
      method('host.status'),
      method('host.restart', 'Renderer', 'confirm', 'confirm'),
      method('export const rpc', 'Backend', 'safe', 'live')
    ]
  },
  {
    id: 'scheduler',
    title: 'Scheduler API',
    group: '插件与调度',
    summary: '任务调度、订阅、查询、暂停、恢复、Cron 和执行记录。',
    methods: [
      ...methods('scheduler', ['subscribe', 'onEvent', 'unsubscribe', 'listTasks', 'getTask', 'getTaskCount', 'getExecutions', 'validateCron', 'getNextCronTime', 'describeCron'], 'Both'),
      ...methods('scheduler', ['schedule', 'cancelTask', 'pauseTask', 'resumeTask', 'cancel', 'pause', 'resume', 'get', 'list', 'deleteTasks', 'cleanupTasks'], 'Both', 'writes-lab-data', 'sandboxed')
    ]
  },
  {
    id: 'features',
    title: 'Features API',
    group: '插件与调度',
    summary: '动态指令、MainPush 和设置跳转。',
    methods: [
      method('features.getFeatures', 'Backend'),
      method('features.setFeature', 'Backend', 'writes-lab-data', 'sandboxed'),
      method('features.removeFeature', 'Backend', 'writes-lab-data', 'sandboxed'),
      method('features.onMainPush', 'Backend'),
      method('features.onMainPushSelect', 'Backend'),
      method('features.redirectHotKeySetting', 'Backend', 'confirm', 'confirm'),
      method('features.redirectAiModelsSetting', 'Backend', 'confirm', 'confirm')
    ]
  },
  {
    id: 'messaging',
    title: 'Messaging API',
    group: '插件与调度',
    summary: '插件间发送、广播、订阅和取消订阅。',
    methods: [
      ...methods('messaging', ['send', 'broadcast', 'on', 'off'], 'Backend', 'writes-lab-data', 'sandboxed')
    ]
  },
  {
    id: 'inbrowser',
    title: 'InBrowser API',
    group: '插件与调度',
    summary: '隔离浏览器自动化、页面提取、截图、PDF、Cookie 和下载。',
    methods: [
      method('inbrowser.goto', 'Renderer', 'confirm', 'confirm'),
      method('inbrowser.run', 'Renderer', 'confirm', 'confirm'),
      method('inbrowser.evaluate', 'Renderer', 'confirm', 'confirm'),
      method('inbrowser.screenshot', 'Renderer', 'confirm', 'confirm'),
      ...methods('inbrowser', ['useragent', 'device', 'click', 'mousedown', 'mouseup', 'dblclick', 'hover', 'type', 'input', 'press', 'show', 'hide', 'viewport', 'css', 'when', 'wait', 'cookies', 'setCookies', 'removeCookies', 'clearCookies', 'value', 'check', 'scroll', 'devTools', 'focus', 'paste', 'end', 'pdf', 'markdown', 'download', 'file', 'drop', 'getIdleInBrowsers', 'setInBrowserProxy', 'clearInBrowserCache'], 'Renderer', 'confirm', 'confirm')
    ]
  },
  {
    id: 'filesystem',
    title: 'Filesystem API',
    group: '文件网络位置',
    summary: '文件读写、目录、元数据、复制移动和路径工具。',
    methods: [
      method('filesystem.readFile', 'Both', 'confirm', 'confirm'),
      method('filesystem.writeFile', 'Both', 'writes-lab-data', 'sandboxed'),
      ...methods('filesystem', ['exists', 'readdir', 'mkdir', 'stat', 'extname', 'join', 'dirname', 'basename'], 'Both'),
      ...methods('filesystem', ['unlink', 'copy', 'move'], 'Both', 'destructive', 'docs-only')
    ]
  },
  {
    id: 'storage',
    title: 'Storage API',
    group: '文件网络位置',
    summary: '普通、加密、附件和批量插件存储。',
    methods: [
      method('storage.get', 'Both'),
      method('storage.set', 'Both', 'writes-lab-data', 'sandboxed'),
      method('storage.remove', 'Both', 'writes-lab-data', 'sandboxed'),
      method('storage.clear', 'Both', 'destructive', 'docs-only'),
      method('storage.keys', 'Both'),
      ...methods('storage.encrypted', ['set', 'get', 'remove', 'has'], 'Both', 'writes-lab-data', 'sandboxed'),
      ...methods('storage.attachment', ['put', 'get', 'getType', 'remove', 'list'], 'Renderer', 'writes-lab-data', 'sandboxed')
    ]
  },
  {
    id: 'shell',
    title: 'Shell API',
    group: '文件网络位置',
    summary: '打开文件/URL、回收站、蜂鸣、命令策略和审计。',
    methods: [
      ...methods('shell', ['openPath', 'openExternal', 'showItemInFolder', 'openFolder', 'trashItem', 'beep'], 'Both', 'confirm', 'confirm'),
      method('shell.runCommand', 'Both', 'confirm', 'confirm'),
      method('shell.getRunCommandPolicy'),
      method('shell.updateRunCommandPolicy', 'Renderer', 'confirm', 'confirm'),
      method('shell.listRunCommandAudit'),
      method('shell.clearRunCommandAudit', 'Renderer', 'destructive', 'docs-only'),
      method('shell.clearRunCommandTrusted', 'Renderer', 'destructive', 'docs-only')
    ]
  },
  {
    id: 'desktop',
    title: 'Desktop API',
    group: '文件网络位置',
    summary: '桌面文件和应用搜索。',
    methods: methods('desktop', ['searchFiles', 'searchApps'])
  },
  {
    id: 'http',
    title: 'HTTP API',
    group: '文件网络位置',
    summary: 'Host 侧 HTTP request/get/post/put/delete。',
    methods: [
      method('http.request', 'Both', 'confirm', 'confirm'),
      method('http.get', 'Both', 'confirm', 'confirm'),
      method('http.post', 'Both', 'confirm', 'confirm'),
      method('http.put', 'Both', 'confirm', 'confirm'),
      method('http.delete', 'Both', 'confirm', 'confirm')
    ]
  },
  {
    id: 'network',
    title: 'Network API',
    group: '文件网络位置',
    summary: '在线状态和 online/offline 事件。',
    methods: methods('network', ['isOnline', 'onOnline', 'onOffline'], 'Both')
  },
  {
    id: 'geolocation',
    title: 'Geolocation API',
    group: '文件网络位置',
    summary: '定位权限、系统设置和当前位置。',
    methods: [
      ...methods('geolocation', ['getAccessStatus', 'canGetPosition'], 'Renderer', 'permission'),
      method('geolocation.requestAccess', 'Renderer', 'permission', 'confirm'),
      method('geolocation.openSettings', 'Renderer', 'confirm', 'confirm'),
      method('geolocation.getCurrentPosition', 'Renderer', 'permission', 'confirm')
    ]
  },
  {
    id: 'media',
    title: 'Media API',
    group: '媒体与图像',
    summary: '摄像头和麦克风访问状态与授权。',
    methods: [
      ...methods('media', ['getAccessStatus', 'hasCameraAccess', 'hasMicrophoneAccess'], 'Both', 'permission'),
      method('media.askForAccess', 'Both', 'permission', 'confirm')
    ]
  },
  {
    id: 'screen',
    title: 'Screen API',
    group: '媒体与图像',
    summary: '显示器、捕获源、截图、取色和坐标转换。',
    methods: [
      ...methods('screen', ['getAllDisplays', 'getPrimaryDisplay', 'getDisplayNearestPoint', 'getDisplayMatching', 'getCursorScreenPoint', 'getSources', 'getWindowBounds', 'getMediaStreamConstraints', 'screenToDipPoint', 'dipToScreenPoint', 'screenToDipRect', 'dipToScreenRect'], 'Both'),
      method('screen.preCapture', 'Manifest', 'permission', 'live', '通过 manifest feature preCapture 字段触发预捕获元数据。'),
      ...methods('screen', ['capture', 'captureRegion', 'screenCapture', 'colorPick'], 'Both', 'permission', 'confirm')
    ]
  },
  {
    id: 'sharp',
    title: 'Sharp API',
    group: '媒体与图像',
    summary: '图像处理、格式转换、元数据、统计和文件输出。',
    methods: [
      method('sharp.sharp', 'Renderer', 'safe', 'live', 'window.mulby.sharp(input, options) 链式入口。'),
      method('sharp.execute'),
      ...methods('sharp', ['resize', 'extract', 'extend', 'trim', 'rotate', 'flip', 'flop', 'affine', 'median', 'blur', 'sharpen', 'flatten', 'grayscale', 'greyscale', 'negate', 'gamma', 'normalise', 'normalize', 'clahe', 'convolve', 'threshold', 'modulate', 'linear', 'recomb', 'tint', 'pipelineColorspace', 'toColorspace', 'removeAlpha', 'ensureAlpha', 'extractChannel', 'joinChannel', 'bandbool', 'composite', 'png', 'jpeg', 'webp', 'gif', 'tiff', 'avif', 'heif', 'raw', 'withMetadata', 'keepExif', 'withExif', 'keepIccProfile', 'withIccProfile', 'timeout', 'tile', 'clone', 'toBuffer', 'metadata', 'stats']),
      method('sharp.toFile', 'Renderer', 'writes-lab-data', 'sandboxed'),
      method('getSharpVersion')
    ]
  },
  {
    id: 'ffmpeg',
    title: 'FFmpeg API',
    group: '媒体与图像',
    summary: '音视频处理、下载、版本和路径。',
    methods: [
      method('ffmpeg.run', 'Renderer', 'long-running', 'docs-only'),
      ...methods('ffmpeg', ['isAvailable', 'getVersion', 'getPath']),
      method('ffmpeg.download', 'Renderer', 'long-running', 'docs-only')
    ]
  },
  {
    id: 'manifest',
    title: 'Manifest Contract',
    group: '插件契约',
    summary: 'manifest 顶层配置、features、cmds、permissions、tools、pluginSetting 和 window。',
    methods: [
      method('manifest.topLevel', 'Manifest', 'safe', 'live'),
      method('manifest.assets', 'Manifest', 'safe', 'live'),
      method('manifest.permissions', 'Manifest', 'safe', 'live'),
      method('manifest.features', 'Manifest', 'safe', 'live'),
      method('manifest.cmds.keyword', 'Manifest', 'safe', 'live'),
      method('manifest.cmds.regex', 'Manifest', 'safe', 'live'),
      method('manifest.cmds.files', 'Manifest', 'safe', 'live'),
      method('manifest.cmds.img', 'Manifest', 'safe', 'live'),
      method('manifest.cmds.over', 'Manifest', 'safe', 'live'),
      method('manifest.cmds.window', 'Manifest', 'safe', 'live'),
      method('manifest.tools', 'Manifest', 'safe', 'live'),
      method('manifest.pluginSetting', 'Manifest', 'safe', 'live'),
      method('manifest.window', 'Manifest', 'safe', 'live'),
      method('manifest.icon', 'Manifest', 'safe', 'live')
    ]
  }
]

export const apiGroups = Array.from(new Set(apiRegistry.map((module) => module.group)))
