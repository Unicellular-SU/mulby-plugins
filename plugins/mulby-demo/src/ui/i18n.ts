import type { ApiCategoryId } from '../shared/api-catalog'

export type Language = 'en' | 'zh'

export interface LocalizedText {
  en: string
  zh: string
}

export interface ModuleTranslation {
  title: string
  summary: string
  notes: string[]
}

export interface ExampleTranslation {
  label: string
  description: string
}

export const languageOptions: Array<{ id: Language; label: string }> = [
  { id: 'en', label: 'EN' },
  { id: 'zh', label: '中文' }
]

export function normalizeLanguage(value?: string | null): Language {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function localize(text: string | LocalizedText, language: Language): string {
  return typeof text === 'string' ? text : text[language] ?? text.en
}

export const uiText = {
  brandTitle: { en: 'Mulby API Demo', zh: 'Mulby API 示例' },
  publicModules: { en: 'public modules', zh: '个公开模块' },
  boundaryNotes: { en: 'boundary notes', zh: '条边界说明' },
  searchPlaceholder: { en: 'Search API, method, note', zh: '搜索 API、方法或说明' },
  apiModules: { en: 'API modules', zh: 'API 模块' },
  languageToggle: { en: 'Language', zh: '语言' },
  publicCoverage: { en: 'Public coverage', zh: '公开 API 覆盖' },
  boundaries: { en: 'Boundaries', zh: '边界 API' },
  methods: { en: 'Methods', zh: '方法' },
  methodDetail: { en: 'Method detail', zh: '方法详情' },
  inputs: { en: 'Inputs', zh: '输入参数' },
  returns: { en: 'Returns', zh: '输出参数' },
  methodNotes: { en: 'Method notes', zh: '方法注意事项' },
  required: { en: 'required', zh: '必填' },
  optional: { en: 'optional', zh: '可选' },
  notes: { en: 'Notes', zh: '注意事项' },
  examples: { en: 'Examples', zh: '示例' },
  output: { en: 'Output', zh: '输出' },
  copySnippet: { en: 'Copy snippet', zh: '复制代码片段' },
  copiedSnippet: { en: 'Copied snippet', zh: '已复制代码片段' },
  run: { en: 'Run', zh: '运行' },
  running: { en: 'Running', zh: '运行中' },
  preview: { en: 'Preview', zh: '预览' },
  docsOnlyWarning: {
    en: 'This example is documentation-only and has no runtime action.',
    zh: '此示例仅用于文档说明，没有运行时操作。'
  },
  emptyOutput: {
    en: 'Run an example to inspect its result. Documentation-only examples show the snippet payload.',
    zh: '运行示例后可在这里查看结果。仅文档示例会展示代码片段内容。'
  }
} satisfies Record<string, LocalizedText>

export const safetyTranslations = {
  safe: { en: 'safe', zh: '安全' },
  'writes-plugin-data': { en: 'writes plugin data', zh: '写入插件数据' },
  'opens-system-ui': { en: 'opens system UI', zh: '打开系统界面' },
  'requires-permission': { en: 'requires permission', zh: '需要权限' },
  'preview-only': { en: 'preview only', zh: '仅预览' }
} satisfies Record<string, LocalizedText>

export const categoryTranslations: Record<ApiCategoryId, { label: string; description: string }> = {
  data: {
    label: '数据与持久化',
    description: '插件本地状态、剪贴板数据和安全存储。'
  },
  'files-network': {
    label: '文件、网络与 Shell',
    description: '文件访问、HTTP 请求、浏览器自动化和系统 Shell 集成。'
  },
  ui: {
    label: '窗口与界面',
    description: '窗口、对话框、上下文菜单、通知、托盘、主题和子输入控件。'
  },
  system: {
    label: '系统、设备与权限',
    description: '系统信息、硬件权限、屏幕、输入、电源和桌面搜索。'
  },
  plugin: {
    label: '插件协作',
    description: '清单契约、生命周期、Host RPC、动态功能、消息和调度器。'
  },
  'ai-media': {
    label: 'AI、媒体与处理',
    description: 'AI 调用、插件工具、语音合成、Sharp、FFmpeg 和媒体辅助能力。'
  },
  diagnostics: {
    label: '诊断与日志',
    description: '插件日志写入、查询、清理和实时订阅。'
  },
  restricted: {
    label: '内部或设置专属 API',
    description: '宿主设置、系统页面和内部接口的边界说明。'
  }
}

export const moduleTranslations: Record<string, ModuleTranslation> = {
  storage: {
    title: '存储 Storage',
    summary: '存储插件设置、加密值和附件二进制数据。',
    notes: [
      '渲染端存储可以传入可选命名空间；后端存储默认隔离在当前插件内。',
      '令牌等敏感数据应使用加密存储，二进制数据可使用附件存储并遵守宿主大小限制。'
    ]
  },
  clipboard: {
    title: '剪贴板 Clipboard',
    summary: '读取和写入系统剪贴板中的文本、图片和文件。',
    notes: [
      '剪贴板和剪贴板历史访问需要在 manifest 中声明 `clipboard` 权限。',
      '此示例默认读取文本和格式；写入示例会写入明确标记的演示文本。'
    ]
  },
  'clipboard-history': {
    title: '剪贴板历史 Clipboard History',
    summary: '在显式剪贴板权限下查询和管理 Mulby 剪贴板历史。',
    notes: [
      '剪贴板历史属于用户数据；应使用较小限制，并默认避免展示敏感内容。',
      '当前宿主通过后端 `context.api.clipboardHistory` 稳定暴露剪贴板历史；渲染端示例会通过 Host RPC 调用它。'
    ]
  },
  security: {
    title: '安全加密 Security',
    summary: '使用宿主安全存储加密能力。',
    notes: [
      '持久化密钥请优先使用 `storage.encrypted`；`security.encryptString` 适合显式安全存储转换。',
      '加密可用性取决于当前操作系统的安全存储后端。'
    ]
  },
  filesystem: {
    title: '文件系统 Filesystem',
    summary: '读取、写入、检查和移动文件；后端路径辅助能力在独立示例中展示。',
    notes: [
      '渲染端 API 应作用于用户选择的显式路径或宿主提供的附件。',
      '`join`、`dirname`、`getDataPath` 等后端路径辅助能力通过 Host RPC 展示。'
    ]
  },
  http: {
    title: 'HTTP 请求',
    summary: '通过 Mulby 宿主 API 发起 HTTP 调用。',
    notes: [
      '需要完整控制时使用 `request`；常见动词可使用便捷方法。',
      '此示例调用适合轻量 JSON 响应的 HTTPS 端点。'
    ]
  },
  network: {
    title: '网络 Network',
    summary: '读取网络连通状态，并订阅渲染端连通性事件。',
    notes: [
      '渲染端订阅适合驱动 UI 状态；后端网络 API 主要提供当前连通状态。'
    ]
  },
  shell: {
    title: 'Shell 集成',
    summary: '打开路径和 URL、播放系统声音，并演示受策略保护的命令执行。',
    notes: [
      '`runCommand` 需要 `manifest.permissions.runCommand: true`，并受全局命令策略约束。',
      '可运行命令示例使用后端 `process.execPath` 且关闭 shell；策略仍可能要求用户确认。'
    ]
  },
  inbrowser: {
    title: '内置浏览器 InBrowser',
    summary: '自动化内置浏览器会话，用于导航、提取、截图和下载。',
    notes: [
      'InBrowser 可串联浏览器动作，并通过 `run` 或特定提取方法返回数据。',
      '这里的示例仅预览链式调用，避免意外打开远程页面。'
    ]
  },
  dialog: {
    title: '对话框 Dialog',
    summary: '显示原生打开、保存、消息和错误对话框。',
    notes: [
      'Dialog API 可在渲染端和后端上下文中使用。',
      '消息框适合内联演示；打开和保存对话框应由用户显式触发。'
    ]
  },
  notification: {
    title: '通知 Notification',
    summary: '发送带类型严重级别的宿主通知。',
    notes: [
      '插件发送系统通知时，需要在 manifest 中声明通知权限。'
    ]
  },
  window: {
    title: '窗口 Window',
    summary: '控制当前插件窗口、分离窗口、子窗口、页面内搜索、拖拽和透明度。',
    notes: [
      '窗口 API 会影响当前插件窗口，演示中应优先使用可恢复的控制。',
      '`window.create` 加载同一个 manifest UI 入口，并传入路由或查询信息；默认不会加载任意 HTML。'
    ]
  },
  'sub-input': {
    title: '子输入 Sub Input',
    summary: '控制 Mulby 面板子输入，用于聚焦的文本捕获流程。',
    notes: [
      '面板模式插件需要结构化二级文本输入时，Sub Input 最有用。',
      '工作流结束时应始终移除子输入。'
    ]
  },
  theme: {
    title: '主题 Theme',
    summary: '读取和更改主题模式，并响应实际主题变化。',
    notes: [
      '当配置主题为 `system` 且 UI 需要解析后的明暗状态时，请使用 `getActual`。'
    ]
  },
  menu: {
    title: '菜单 Menu',
    summary: '显示原生上下文菜单，并返回被选择的菜单项 id。',
    notes: [
      '上下文菜单会返回菜单项 id；业务逻辑应使用 id，而不是依赖展示标签。'
    ]
  },
  tray: {
    title: '托盘 Tray',
    summary: '创建和更新插件自有的托盘图标。',
    notes: [
      '每个插件只应创建一个自有托盘项，并在不再需要时销毁。',
      '此界面默认读取托盘是否存在；创建和销毁可通过后端示例方法演示。'
    ]
  },
  system: {
    title: '系统 System',
    summary: '读取操作系统、应用、路径、空闲时间、图标和平台信息。',
    notes: [
      '系统 API 适合诊断和平台差异分支。',
      '避免在面向用户的日志中暴露敏感路径或环境变量。'
    ]
  },
  permission: {
    title: '权限 Permission',
    summary: '检查并请求由宿主代理的系统权限。',
    notes: [
      '请求调用可能显示系统界面；此参考会先读取权限状态。',
      '只有在 manifest 中声明权限后，宿主权限提示才有意义。'
    ]
  },
  power: {
    title: '电源 Power',
    summary: '读取系统电源和空闲状态。',
    notes: [
      '可根据空闲和电池状态推迟后台工作，或降低 CPU 密集型处理。'
    ]
  },
  screen: {
    title: '屏幕 Screen',
    summary: '读取显示器信息，并捕获屏幕或区域数据。',
    notes: [
      '屏幕捕获调用需要 `permissions.screen`，并可能需要操作系统级录屏权限。',
      '此示例默认读取显示器元数据；捕获调用以代码片段形式展示。'
    ]
  },
  media: {
    title: '媒体权限 Media Permissions',
    summary: '检查并请求摄像头和麦克风访问权限。',
    notes: [
      '摄像头和麦克风权限需要在 manifest 中分别声明。'
    ]
  },
  input: {
    title: '输入自动化 Input Automation',
    summary: '向上一个窗口粘贴或输入内容，并模拟键盘或鼠标事件。',
    notes: [
      '输入自动化会影响其他应用；应由用户显式触发，并在粘贴或输入流程后恢复窗口。',
      '此参考将写入和模拟输入示例保留为代码片段，不会直接执行。'
    ]
  },
  'input-monitor': {
    title: '输入监听 Input Monitor',
    summary: '在显式权限下监听全局键盘和鼠标事件。',
    notes: [
      '需要 `inputMonitor` 权限，在 macOS 上通常还需要辅助功能权限。',
      '清理时必须停止监听会话并取消事件订阅。'
    ]
  },
  shortcut: {
    title: '全局快捷键 Global Shortcut',
    summary: '注册插件自有的全局快捷键，并在清理时注销。',
    notes: [
      '快捷键注册应由用户显式触发，并在卸载时注销。',
      '命令快捷键建议使用由 Mulby 设置管理的 `plugin.bindCommandShortcut`。'
    ]
  },
  geolocation: {
    title: '地理位置 Geolocation',
    summary: '在可用时请求并读取当前位置。',
    notes: [
      '请求前先读取访问状态；读取位置需要地理位置权限和系统或浏览器同意。'
    ]
  },
  desktop: {
    title: '桌面搜索 Desktop Search',
    summary: '搜索桌面文件和应用。',
    notes: [
      '桌面搜索示例应使用较小限制，并基于清晰的用户查询。'
    ]
  },
  manifest: {
    title: '插件清单 Plugin Manifest',
    summary: '定义插件契约、触发命令、权限、AI 工具、窗口行为和运行时设置。',
    notes: [
      '`manifest.json` 是插件契约、权限、工具和功能触发器的唯一事实来源。',
      'manifest 中的每个 feature code 都应映射到后端或 UI 行为。'
    ]
  },
  lifecycle: {
    title: '生命周期与运行上下文',
    summary: '后端生命周期钩子和功能调用入口。',
    notes: [
      '后端 API 通过 `context.api` 异步调用，即使渲染端等价方法看起来是同步的，也应使用 await。',
      '`run(context)` 会接收匹配功能的 featureCode、输入文本和附件。',
      '渲染端生命周期监听器应在注册它的 UI 组件卸载时取消订阅。'
    ]
  },
  host: {
    title: '宿主 RPC Host RPC',
    summary: '从插件 UI 调用后端导出方法，并检查宿主进程状态。',
    notes: [
      '新后端方法在支持时优先使用 `rpc` 导出形态；此示例也导出 `host` 以兼容。',
      'Host 方法的输入和输出应保持 JSON 可序列化。'
    ]
  },
  plugin: {
    title: '插件管理 Plugin Management',
    summary: '发现、搜索、运行和管理插件及命令快捷方式。',
    notes: [
      '发现类调用是安全的；安装、卸载、启用、禁用和停止会改变插件环境，应要求明确用户意图。',
      '命令快捷方式 API 适合构建插件管理器或命令面板。'
    ]
  },
  features: {
    title: '动态功能 Dynamic Features',
    summary: '添加或移除运行时命令项，并支持 mainPush 动态选项。',
    notes: [
      '动态功能是插件拥有的运行时入口；code 应保持稳定，临时入口应在清理时移除。',
      '此示例注册确定性的关键词入口，因此重复运行会更新同一个功能。'
    ]
  },
  messaging: {
    title: '消息 Messaging',
    summary: '在插件之间发送直接消息和广播消息。',
    notes: [
      '消息类型应使用命名空间，例如 `mulby-demo:catalog-refresh`。',
      'Messaging 通过后端 `context.api.messaging` 暴露；渲染端示例通过 Host RPC 调用它。'
    ]
  },
  scheduler: {
    title: '调度器 Scheduler',
    summary: '创建延迟、一次性和重复任务，并检查任务状态。',
    notes: [
      '后端创建任务；渲染端列出和管理任务。任务回调必须由插件后端导出。',
      'Cron 表达式使用六个字段：秒、分钟、小时、日期、月份、星期。'
    ]
  },
  tools: {
    title: '插件工具 Plugin Tools',
    summary: '注册可被 AI Agent 发现和调用的插件自有工具。',
    notes: [
      'manifest 中声明的工具名称必须与 `onLoad` 中注册的处理器一致。',
      '处理器应返回 JSON 兼容值，并校验用户提供的参数。'
    ]
  },
  ai: {
    title: 'AI 能力',
    summary: '调用已配置的 AI 提供商、流式返回内容、管理附件、估算 token 并生成图像。',
    notes: [
      'AI 调用依赖用户配置的提供商和模型；使用前应读取模型或设置。',
      '纯文本流程如果需要避免工具执行，应通过文档化的 AI 选项显式关闭工具注入。'
    ]
  },
  tts: {
    title: '文本转语音 Text To Speech',
    summary: '朗读文本并检查语音列表与朗读状态。',
    notes: [
      '选择特定语言语音前，应先使用 `getVoices` 获取可用语音。'
    ]
  },
  sharp: {
    title: 'Sharp 图像处理',
    summary: '使用宿主提供的 Sharp 处理能力，无需在插件中打包原生 sharp。',
    notes: [
      '应使用宿主提供的 Sharp API，而不是将原生 `sharp` 打包进插件。',
      '后端 `context.api.sharp.execute` 适合静默图像处理。'
    ]
  },
  ffmpeg: {
    title: 'FFmpeg 媒体处理',
    summary: '运行宿主管理的 FFmpeg 任务，并检查安装状态。',
    notes: [
      '下载体积可能较大，应由用户显式触发。',
      '此参考只检查可用性和版本，不会触发下载。'
    ]
  },
  log: {
    title: '日志 Log',
    summary: '写入插件日志、查询日志记录、读取日志目录并订阅实时日志事件。',
    notes: [
      '当 Mulby 能解析调用来源插件窗口时，日志记录会按插件隔离。',
      '需要实时日志时先调用 `subscribe` 再注册 `onLog`，并在清理阶段释放监听器。'
    ]
  },
  settings: {
    title: '设置 API 边界',
    summary: '系统级应用设置和更新器操作；第三方示例不应修改宿主设置。',
    notes: [
      '读取宿主设置可能适用于 Mulby 自有设置界面，但第三方插件应避免更改全局用户偏好。',
      '更安全的替代方案：使用插件本地存储和 manifest 声明的命令快捷方式。'
    ]
  },
  developer: {
    title: '开发者 API 边界',
    summary: '用于插件路径管理的开发工作流控制，不属于普通插件行为。',
    notes: [
      '添加或移除插件路径、重载所有插件属于开发者工具，不应放入普通插件流程。',
      '更安全的替代方案：在 README 中记录本地开发步骤，让开发者手动配置路径。'
    ]
  },
  'system-plugin': {
    title: '系统插件 API 边界',
    summary: '为 Mulby 系统插件挂载流程保留。',
    notes: [
      '系统插件挂载 API 用于协调 Mulby 自有系统插件界面。'
    ]
  },
  'system-page': {
    title: '系统页面 API 边界',
    summary: '作为显式宿主 UI 导航动作是安全的，但本示例将其标为边界，避免意外页面切换。',
    notes: [
      '打开系统页面虽然有文档，但此参考避免从示例按钮直接触发导航。',
      '更安全的替代方案：提示用户手动进入设置路径，或使用插件本地 UI。'
    ]
  },
  'super-panel': {
    title: 'Super Panel API 边界',
    summary: '面向 Mulby Super Panel 前端，而不是普通第三方插件窗口。',
    notes: [
      'Super Panel API 用于宿主面板实现和面板专属集成。'
    ]
  },
  'tray-menu': {
    title: '托盘菜单 API 边界',
    summary: '专属于 Mulby 宿主托盘菜单 UI 状态。',
    notes: [
      '托盘菜单状态 API 专属于 Mulby 宿主托盘菜单界面。'
    ]
  },
  'plugin-store': {
    title: '插件商店 Plugin Store',
    summary: '读取插件商店条目、检查已安装插件更新，并以受控方式演示安装和更新流程。',
    notes: [
      '读取调用适合发现插件。安装和更新调用会改变插件环境，所以本示例使用无效本地 URL 和不存在的插件 id 作为保护目标。',
      '真实安装器应传入 HTTPS `.inplugin` 下载地址，并在商店索引提供 `sha256` 时校验摘要。'
    ]
  },
  'app-events': {
    title: '应用与系统事件边界',
    summary: '主要用于宿主导航和系统页面事件；第三方插件可选择性监听，但本参考不触发宿主导航。',
    notes: [
      '只监听与你的插件相关的事件，不要把宿主导航事件 API 当作普通插件控制流。'
    ]
  },
  'ai-system-settings': {
    title: 'AI 系统设置边界',
    summary: 'AI 提供商、MCP 服务器、网络搜索和工具可见性管理属于全局宿主设置。',
    notes: [
      '插件应调用 AI 模型或暴露工具；全局 MCP 服务器、提供商和工具可见性设置属于 Mulby 设置。',
      '更安全的替代方案：使用 `ai.call`、`ai.skills.listEnabled`、`ai.attachments` 和插件工具。'
    ]
  },
  'undocumented-host-internals': {
    title: '未公开宿主内部接口边界',
    summary: '本地类型表面中可见但未被公开文档声明为第三方插件 API 的名称。',
    notes: [
      '如果某个名称出现在本地类型文件中，但没有出现在公开文档里，应视为第三方插件不可用。'
    ]
  }
}

export const exampleTranslations: Record<string, ExampleTranslation> = {
  'storage-roundtrip': {
    label: '写入并读取插件数据',
    description: '将一个小 JSON 对象写入演示键，随后读取并返回该值。'
  },
  'storage-backend-keys': {
    label: '后端键列表与清理',
    description: '通过后端存储写入、读取、列出、清理演示键，并恢复生命周期元数据。'
  },
  'storage-encrypted-attachment': {
    label: '加密与附件存储',
    description: '写入、读取、检查、列出并删除演示专用的加密值和二进制附件。'
  },
  'clipboard-read': {
    label: '读取剪贴板格式和文本',
    description: '读取当前剪贴板格式和文本，不修改剪贴板内容。'
  },
  'clipboard-write-demo': {
    label: '写入演示文本',
    description: '向剪贴板写入带明确标记的演示字符串。'
  },
  'clipboard-history-stats': {
    label: '读取历史统计',
    description: '读取剪贴板历史的聚合统计数量。'
  },
  'clipboard-history-query': {
    label: '查询最近记录',
    description: '最多查询五条最近记录，并且只在输出中展示元数据。'
  },
  'clipboard-history-delete-clear': {
    label: '删除与清理保护示例',
    description: '对不存在的演示 ID 执行删除，并把清空历史保留为需要用户明确编辑的代码。'
  },
  'security-availability': {
    label: '检查加密可用性',
    description: '读取宿主安全存储加密是否可用。'
  },
  'filesystem-temp-roundtrip': {
    label: '后端临时文件往返',
    description: '请求后端在插件数据路径下写入、读取、统计并删除演示文件。'
  },
  'http-verbs': {
    label: '运行 HTTP 动词',
    description: '对轻量 JSON 端点运行 request、GET、POST、PUT 和 DELETE。'
  },
  'network-state': {
    label: '读取在线状态',
    description: '读取宿主报告的网络连通状态。'
  },
  'shell-policy': {
    label: '读取命令策略',
    description: '读取当前 runCommand 策略，不执行任何命令。'
  },
  'shell-backend-command': {
    label: '运行安全后端命令',
    description: '请求后端在关闭 shell 的情况下执行 `node -e`。'
  },
  'shell-system-actions': {
    label: '打开路径并移动演示文件到回收站',
    description: '创建临时演示文件，打开路径、目录和 URL，播放提示音，并只移动演示文件到回收站。'
  },
  'inbrowser-run-example': {
    label: '运行浏览器自动化链',
    description: '针对 example.com 运行真实 InBrowser 链，包括导航、输入、提取、截图、下载和清理。'
  },
  'dialog-message': {
    label: '显示消息框',
    description: '显示包含两个按钮的原生消息框，并返回用户选择的索引。'
  },
  'dialog-open-save-error': {
    label: '打开、保存和错误对话框',
    description: '显示原生打开/保存对话框和错误框，并返回用户是否取消选择。'
  },
  'notification-show': {
    label: '显示通知',
    description: '发送一条信息级演示通知。'
  },
  'window-state': {
    label: '读取窗口状态',
    description: '在可用时读取模式、类型、边界、透明度和最大化/置顶状态。'
  },
  'window-control': {
    label: '控制当前窗口',
    description: '执行显示、聚焦、改标题、改尺寸、改边界、透明度、页面查找和重绘等可恢复窗口操作。'
  },
  'window-child': {
    label: '创建并控制子窗口',
    description: '创建子窗口，调用子窗口句柄方法，发送消息并关闭它。'
  },
  'window-detach-drag-menu': {
    label: '分离、菜单、拖拽和关闭控制',
    description: '用一次性子窗口演示关闭/销毁，打开插件菜单，并触发原生文件拖拽载荷。'
  },
  'sub-input-preview': {
    label: '显示子输入',
    description: '创建带演示占位符的子输入。'
  },
  'sub-input-remove': {
    label: '移除子输入',
    description: '移除当前子输入控件。'
  },
  'theme-read': {
    label: '读取主题',
    description: '读取配置主题和实际生效主题值。'
  },
  'menu-context': {
    label: '显示上下文菜单',
    description: '显示一个小型上下文菜单，并返回被选择的 id。'
  },
  'tray-lifecycle': {
    label: '创建、更新并销毁托盘图标',
    description: '创建插件自有托盘图标，更新图标、提示和标题，检查状态后销毁。'
  },
  'system-info': {
    label: '读取系统和应用信息',
    description: '读取操作系统和 Mulby 应用元数据。'
  },
  'permission-status': {
    label: '读取权限状态',
    description: '读取常见权限状态，不主动请求权限。'
  },
  'power-state': {
    label: '读取电源状态',
    description: '读取空闲时间、空闲状态、电池和热状态。'
  },
  'screen-displays': {
    label: '读取显示器',
    description: '读取所有显示器、主显示器和光标屏幕坐标。'
  },
  'media-status': {
    label: '读取摄像头和麦克风访问',
    description: '读取摄像头和麦克风访问状态，不打开设备。'
  },
  'input-actions': {
    label: '运行输入自动化动作',
    description: '使用演示载荷执行粘贴、输入、键盘和鼠标自动化调用，并在输出中记录失败原因。'
  },
  'input-monitor-available': {
    label: '检查监听可用性',
    description: '检查全局输入监听支持是否可用。'
  },
  'shortcut-register': {
    label: '注册并注销快捷键',
    description: '注册演示全局快捷键、检查状态、监听触发事件、注销并清理插件快捷键。'
  },
  'geolocation-status': {
    label: '读取地理位置状态',
    description: '读取访问状态，以及是否可以请求当前位置。'
  },
  'desktop-search-apps': {
    label: '搜索应用',
    description: '搜索最多五个匹配 “code” 的应用。'
  },
  'manifest-snippet': {
    label: '清单契约片段',
    description: '展示此演示插件使用的关键 manifest 字段。'
  },
  'lifecycle-state': {
    label: '读取后端生命周期状态',
    description: '通过后端 Host RPC 读取生命周期计数器和最近运行上下文。'
  },
  'host-echo': {
    label: '调用后端 echo',
    description: '调用后端 RPC 方法，并返回回显载荷。'
  },
  'host-status': {
    label: '读取后端状态',
    description: '读取此插件的后端进程状态。'
  },
  'host-invoke-restart': {
    label: '调用 API 并重启 Host',
    description: '通过 host.invoke 调用后端 API，随后重启此插件 Host 并再次读取状态。'
  },
  'plugin-list': {
    label: '列出已安装插件',
    description: '读取已安装插件元数据，并返回精简摘要。'
  },
  'plugin-commands': {
    label: '列出命令入口',
    description: '读取此插件暴露的命令。'
  },
  'plugin-run-preferences': {
    label: '运行并更新演示功能偏好',
    description: '运行此插件演示入口，置顶/取消置顶、隐藏/恢复隐藏，并演示命令快捷键和插件管理调用。'
  },
  'plugin-stop-safety': {
    label: '停止插件的保护目标',
    description: '对故意不存在的演示目标调用 stopPlugin，执行 API 路径但不停止参考界面。'
  },
  'plugin-main-push-select': {
    label: '调用 MainPush 选择',
    description: '注册演示 MainPush 功能和处理器后，调用 plugin.mainPushSelect 并读取 MainPush 插件列表。'
  },
  'plugin-store-read': {
    label: '读取商店与更新状态',
    description: '读取已配置插件商店条目，并检查已安装插件更新，不安装任何插件。'
  },
  'plugin-store-guarded-mutations': {
    label: '运行受保护安装与更新调用',
    description: '使用无效本地包 URL 调用 installFromUrl，并用不存在的插件 id 调用 updateAll，执行 API 路径但不真实安装插件。'
  },
  'features-register': {
    label: '注册动态功能',
    description: '调用后端设置一个演示动态功能入口。'
  },
  'features-main-push': {
    label: '注册 MainPush 处理器',
    description: '注册动态 MainPush 功能以及后端 onMainPush/onMainPushSelect 处理器。'
  },
  'features-remove': {
    label: '移除动态演示功能',
    description: '移除演示动态功能，并展示动态功能清理和设置跳转调用。'
  },
  'messaging-broadcast': {
    label: '发送并接收回环消息',
    description: '注册后端消息处理器，发送直接消息并广播消息，随后取消订阅处理器。'
  },
  'scheduler-describe': {
    label: '描述 cron',
    description: '请求后端调度器校验并描述一个 cron 表达式。'
  },
  'scheduler-create-delay': {
    label: '创建延迟通知任务',
    description: '创建一个短延迟任务，调用后端演示调度回调。'
  },
  'scheduler-lifecycle': {
    label: '暂停、恢复、列出并取消任务',
    description: '创建长延迟演示任务，读取、暂停、恢复、列出、取消并读取执行历史。'
  },
  'scheduler-renderer-list-delete': {
    label: '列出并删除调度记录',
    description: '使用渲染端调度器 API 列出演示任务、计数、查看详情、删除演示记录并清理历史。'
  },
  'tools-catalog': {
    label: '检查已注册演示工具',
    description: '通过后端 Host RPC 读取目录摘要；AI Agent 也可通过 `mulby_demo_catalog` 调用同样数据。'
  },
  'ai-models': {
    label: '列出已配置模型',
    description: '读取可用 AI 模型，不发起生成调用。'
  },
  'ai-token-estimate': {
    label: '估算 token',
    description: '在 token 估算可用时，为一条很小的消息估算 token。'
  },
  'tts-voices': {
    label: '列出语音',
    description: '读取可用的语音合成 voice 列表。'
  },
  'tts-speak': {
    label: '朗读短文本',
    description: '朗读一段简短演示语句。'
  },
  'sharp-version': {
    label: '读取 Sharp 版本',
    description: '在宿主暴露时读取 Sharp 运行时版本。'
  },
  'ffmpeg-status': {
    label: '读取 FFmpeg 状态',
    description: '检查 FFmpeg 是否可用，并在可用时读取版本和路径。'
  },
  'log-write-query-subscribe': {
    label: '写入、查询、订阅并清理日志',
    description: '订阅实时日志，写入所有级别日志，查询插件日志，清理演示日志并读取日志目录。'
  },
  'settings-boundary': {
    label: '边界说明',
    description: '系统级应用设置和更新器操作；第三方示例不应修改宿主设置。'
  },
  'developer-boundary': {
    label: '边界说明',
    description: '开发工作流控制只适合插件路径管理，不属于普通插件行为。'
  },
  'system-plugin-boundary': {
    label: '边界说明',
    description: '此 API 为 Mulby 系统插件挂载流程保留。'
  },
  'system-page-boundary': {
    label: '边界说明',
    description: '系统页面导航会改变宿主界面，本参考避免从示例按钮触发。'
  },
  'super-panel-boundary': {
    label: '边界说明',
    description: 'Super Panel API 面向宿主面板前端，而不是普通第三方插件窗口。'
  },
  'tray-menu-boundary': {
    label: '边界说明',
    description: '托盘菜单状态 API 专属于 Mulby 宿主托盘菜单 UI。'
  },
  'app-events-boundary': {
    label: '边界说明',
    description: '这些事件主要用于宿主导航和系统页面，本参考不触发宿主导航。'
  },
  'ai-system-settings-boundary': {
    label: '边界说明',
    description: 'AI 提供商、MCP、网络搜索和工具可见性属于全局宿主设置。'
  },
  'undocumented-host-internals-boundary': {
    label: '边界说明',
    description: '未在公开文档中声明的宿主内部名称不应作为第三方插件 API 使用。'
  }
}
