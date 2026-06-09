/**
 * Vibe 插件「契约」模型与序列化。
 *
 * 设计理念（借鉴 develop-mulby-plugin 技能）：把 manifest.json 当作插件的唯一契约/真相。
 * 新建与改造都先确认一份结构化契约，再由本工具**确定性地**写出 manifest.json（而非交给 AI 猜），
 * AI 只负责按契约实现 src/ 代码。这样可控、可编辑、可验证。
 */

export type FeatureMode = 'ui' | 'silent' | 'detached'
export type PluginTemplate = 'react' | 'basic'

/** Mulby 宿主支持的全部触发类型（与 search-matcher 的 MatchType 对齐） */
export type TriggerType = 'keyword' | 'regex' | 'over' | 'files' | 'img' | 'window'

/**
 * 统一的触发描述。一个字段超集，按 type 取用对应字段；序列化时只写出该 type 需要的字段。
 * `sample` 仅用于 UI 一键试用（不写入 manifest）。
 */
export interface VibeTrigger {
  type: TriggerType
  /** keyword：关键词文本 */
  value?: string
  /** regex：正则字符串；files：匹配文件名的正则 */
  match?: string
  /** 指令显示名（regex/over/files/img/window） */
  label?: string
  /** regex 的人类说明 */
  explain?: string
  /** 输入长度限制（regex/over/files 文件数） */
  minLength?: number
  maxLength?: number
  /** files/img：扩展名（不带点亦可） */
  exts?: string[]
  /** files：文件类型过滤 */
  fileType?: 'file' | 'directory' | 'any'
  /** over：排除正则 */
  exclude?: string
  /** window：应用/标题/bundleId 匹配（"/正则/" 或精确） */
  app?: string
  title?: string
  bundleId?: string
  /** 仅 UI：一键试用时填入搜索框的示例输入（regex/over 用） */
  sample?: string
}

export const TRIGGER_TYPES: Array<{ value: TriggerType; label: string; hint: string }> = [
  { value: 'keyword', label: '关键词', hint: '输入该词触发（支持拼音/首字母），可绑快捷键' },
  { value: 'regex', label: '正则匹配', hint: '输入文本匹配正则即触发：金额/URL/IP/手机号等' },
  { value: 'over', label: '任意文本', hint: '对任意输入文本生效（可设长度/排除）' },
  { value: 'files', label: '文件拖入', hint: '拖入文件/文件夹触发（可限扩展名）' },
  { value: 'img', label: '图片拖入', hint: '拖入图片触发' },
  { value: 'window', label: '活跃窗口', hint: '匹配前台应用/窗口触发' }
]

export interface VibeFeature {
  /** 唯一功能码 */
  code: string
  /** 人类可读说明 */
  explain: string
  /** 运行模式 */
  mode: FeatureMode
  /** 触发方式（支持 keyword/regex/over/files/img/window 多种） */
  triggers: VibeTrigger[]
  /** 命中时向搜索框推送动态选项（查询后端 onMainPush 回调） */
  mainPush?: boolean
  /** 触发该功能时隐藏主窗口 */
  mainHide?: boolean
  /** 启动前先截图，结果作为 attachment 传入 */
  preCapture?: 'region' | 'fullscreen'
  /** 加载的 UI 路由（多路由 React 插件） */
  route?: string
}

export interface VibeTool {
  name: string
  description: string
}

/** 命令执行 profile（对齐 schema CommandExecutionConfig） */
export type ExecProfile = 'sandbox' | 'workspace' | 'trusted'

/** 单场景命令执行配置（direct=插件代码直接调用；ai=插件承载 AI 生成命令） */
export interface VibeCommandScope {
  enabled?: boolean
  defaultProfile?: ExecProfile
  maxProfile?: ExecProfile
}

/** 结构化命令执行权限（schema 推荐，优先于 legacy runCommand） */
export interface VibeCommandExecution {
  direct?: VibeCommandScope
  ai?: VibeCommandScope
}

export const EXEC_PROFILES: ExecProfile[] = ['sandbox', 'workspace', 'trusted']

const numOrU = (v: any): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined)
const arrOrU = (v: any): string[] | undefined => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : undefined)

/** 把宿主 cmd（或字符串简写）解析为 VibeTrigger */
export function cmdToTrigger(c: any): VibeTrigger | null {
  if (typeof c === 'string') {
    const v = c.trim()
    return v ? { type: 'keyword', value: v } : null
  }
  if (!c || typeof c !== 'object') return null
  switch (c.type) {
    case 'keyword':
      return c.value ? { type: 'keyword', value: String(c.value) } : null
    case 'regex':
      return c.match
        ? { type: 'regex', match: String(c.match), label: c.label && String(c.label), explain: c.explain && String(c.explain), minLength: numOrU(c.minLength), maxLength: numOrU(c.maxLength) }
        : null
    case 'over':
      return { type: 'over', label: c.label && String(c.label), exclude: c.exclude && String(c.exclude), minLength: numOrU(c.minLength), maxLength: numOrU(c.maxLength) }
    case 'files':
      return { type: 'files', label: c.label && String(c.label), exts: arrOrU(c.exts), fileType: ['file', 'directory', 'any'].includes(c.fileType) ? c.fileType : undefined, match: c.match && String(c.match), minLength: numOrU(c.minLength), maxLength: numOrU(c.maxLength) }
    case 'img':
      return { type: 'img', label: c.label && String(c.label), exts: arrOrU(c.exts) }
    case 'window': {
      const t: VibeTrigger = { type: 'window', label: c.label && String(c.label), app: c.app && String(c.app), title: c.title && String(c.title), bundleId: c.bundleId && String(c.bundleId) }
      return t.app || t.title || t.bundleId ? t : null
    }
    default:
      return null
  }
}

/** 解析 AI 返回的触发描述（cmd/字符串），并保留 sample */
function normalizeTrigger(raw: any): VibeTrigger | null {
  const t = cmdToTrigger(raw)
  if (!t) return null
  if (raw && typeof raw === 'object' && typeof raw.sample === 'string' && raw.sample.trim()) t.sample = raw.sample.trim()
  return t
}

/** 把 VibeTrigger 序列化为宿主 cmd（剔除空字段与 UI-only 的 sample），无效返回 null */
export function triggerToCmd(t: VibeTrigger): Record<string, unknown> | null {
  switch (t.type) {
    case 'keyword': {
      const value = (t.value || '').trim()
      return value ? { type: 'keyword', value } : null
    }
    case 'regex': {
      const match = (t.match || '').trim()
      if (!match) return null
      const c: Record<string, unknown> = { type: 'regex', match }
      if (t.label?.trim()) c.label = t.label.trim()
      if (t.explain?.trim()) c.explain = t.explain.trim()
      if (typeof t.minLength === 'number') c.minLength = t.minLength
      if (typeof t.maxLength === 'number') c.maxLength = t.maxLength
      return c
    }
    case 'over': {
      const c: Record<string, unknown> = { type: 'over' }
      if (t.label?.trim()) c.label = t.label.trim()
      if (t.exclude?.trim()) c.exclude = t.exclude.trim()
      if (typeof t.minLength === 'number') c.minLength = t.minLength
      if (typeof t.maxLength === 'number') c.maxLength = t.maxLength
      return c
    }
    case 'files': {
      const c: Record<string, unknown> = { type: 'files' }
      if (t.label?.trim()) c.label = t.label.trim()
      const exts = (t.exts || []).map((e) => e.trim()).filter(Boolean)
      if (exts.length) c.exts = exts
      if (t.fileType && t.fileType !== 'any') c.fileType = t.fileType
      if (t.match?.trim()) c.match = t.match.trim()
      if (typeof t.minLength === 'number') c.minLength = t.minLength
      if (typeof t.maxLength === 'number') c.maxLength = t.maxLength
      return c
    }
    case 'img': {
      const c: Record<string, unknown> = { type: 'img' }
      if (t.label?.trim()) c.label = t.label.trim()
      const exts = (t.exts || []).map((e) => e.trim()).filter(Boolean)
      if (exts.length) c.exts = exts
      return c
    }
    case 'window': {
      const c: Record<string, unknown> = { type: 'window' }
      if (t.label?.trim()) c.label = t.label.trim()
      if (t.app?.trim()) c.app = t.app.trim()
      if (t.title?.trim()) c.title = t.title.trim()
      if (t.bundleId?.trim()) c.bundleId = t.bundleId.trim()
      return c.app || c.title || c.bundleId ? c : null
    }
  }
}

/** 触发的一行可读描述（UI 摘要用） */
export function triggerLabel(t: VibeTrigger): string {
  switch (t.type) {
    case 'keyword': return `关键词「${t.value || ''}」`
    case 'regex': return `正则 ${t.match || ''}${t.label ? `（${t.label}）` : ''}`
    case 'over': return `任意文本${t.label ? `（${t.label}）` : ''}`
    case 'files': return `文件${t.exts?.length ? ` ${t.exts.join('/')}` : ''}`
    case 'img': return '图片拖入'
    case 'window': return `窗口 ${t.app || t.title || t.bundleId || ''}`
  }
}

/**
 * 契约编辑器暴露的布尔权限开关，严格对齐官方 manifest-schema.json 的 permissions。
 * 注意：schema 中并无 "shell" 权限（openExternal 等无需声明）。
 * `sensitive` 为敏感/隐私权限，UI 折叠在「敏感权限」分组，默认不展开。
 */
export const PERMISSION_OPTIONS = [
  { key: 'clipboard', label: '剪贴板', sensitive: false },
  { key: 'notification', label: '系统通知', sensitive: false },
  { key: 'filesystem', label: '文件读写', sensitive: false },
  { key: 'ai', label: 'AI 能力', sensitive: false },
  { key: 'runCommand', label: '执行命令', sensitive: true },
  { key: 'webview', label: '内嵌网页', sensitive: true },
  { key: 'microphone', label: '麦克风', sensitive: true },
  { key: 'camera', label: '摄像头', sensitive: true },
  { key: 'screen', label: '屏幕录制', sensitive: true },
  { key: 'geolocation', label: '定位', sensitive: true },
  { key: 'accessibility', label: '辅助功能', sensitive: true },
  { key: 'inputMonitor', label: '输入监听', sensitive: true },
  { key: 'contacts', label: '通讯录', sensitive: true },
  { key: 'calendar', label: '日历', sensitive: true }
] as const

export type PermissionKey = (typeof PERMISSION_OPTIONS)[number]['key']

/** 插件分类（manifest.type，enum 对齐 schema） */
export type PluginCategory = 'utility' | 'productivity' | 'developer' | 'system' | 'media' | 'network' | 'ai' | 'entertainment' | 'other'
export const CATEGORY_OPTIONS: Array<{ value: PluginCategory; label: string }> = [
  { value: 'utility', label: '实用工具' },
  { value: 'productivity', label: '效率' },
  { value: 'developer', label: '开发者' },
  { value: 'system', label: '系统' },
  { value: 'media', label: '媒体' },
  { value: 'network', label: '网络' },
  { value: 'ai', label: 'AI' },
  { value: 'entertainment', label: '娱乐' },
  { value: 'other', label: '其他' }
]

export type PlatformKey = 'darwin' | 'win32' | 'linux'
export const PLATFORM_OPTIONS: Array<{ value: PlatformKey; label: string }> = [
  { value: 'darwin', label: 'macOS' },
  { value: 'win32', label: 'Windows' },
  { value: 'linux', label: 'Linux' }
]

/** 独立窗口配置（VibeContract 暴露的常用子集，对齐 schema WindowOptions） */
export interface VibeWindow {
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  type?: 'default' | 'borderless' | 'fullscreen'
  /** 是否显示 Mulby 标题栏（default 默认 true，其他类型默认 false） */
  titleBar?: boolean
  alwaysOnTop?: boolean
  transparent?: boolean
  resizable?: boolean
}

/** 插件行为设置（对齐 schema pluginSetting 常用子集） */
export interface VibeBehavior {
  single?: boolean
  defaultDetached?: boolean
  background?: boolean
  persistent?: boolean
  /** Super Panel 启动此 UI 插件的预期高度 */
  height?: number
}

export interface VibeContract {
  name: string
  displayName: string
  description: string
  version: string
  template: PluginTemplate
  /** 分类（manifest.type） */
  type?: PluginCategory
  /** 作者 */
  author?: string
  /** 平台限制（空 = 全平台） */
  platform?: PlatformKey[]
  features: VibeFeature[]
  permissions: Record<string, boolean>
  /** 结构化命令执行权限（schema 推荐；优先于 legacy runCommand 布尔） */
  commandExecution?: VibeCommandExecution
  tools: VibeTool[]
  /** 独立窗口配置（react/detached 时有意义） */
  window?: VibeWindow
  /** 行为设置 */
  behavior?: VibeBehavior
  needIcon: boolean
  /** 改造模式上下文 */
  isEdit?: boolean
  targetPath?: string
  pluginId?: string
  /** AI 对本次改动的一句话说明（仅改造模式） */
  editSummary?: string
}

export const toKebab = (input: string) =>
  (input || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-plugin'

/** 取首个功能 */
export function primaryFeature(c: VibeContract): VibeFeature | undefined {
  return c.features[0]
}

/** 取一个可用于「一键试用」的示例输入：优先关键词，其次 regex/over 的 sample，最后插件名 */
export function primaryTrigger(c: VibeContract): string {
  const ts = c.features[0]?.triggers || []
  const kw = ts.find((t) => t.type === 'keyword' && t.value?.trim())
  if (kw?.value) return kw.value.trim()
  const sampled = ts.find((t) => t.sample?.trim())
  if (sampled?.sample) return sampled.sample.trim()
  return c.name
}

/** 取首个功能码（plugin.run 需要 featureCode） */
export function primaryFeatureCode(c: VibeContract): string {
  return c.features[0]?.code || 'main'
}

/** 一份合理的默认契约（AI 规划失败时兜底，或编辑器初值） */
export function defaultContract(sentence: string): VibeContract {
  const name = toKebab(sentence).split('-').slice(0, 4).join('-') || 'my-plugin'
  return {
    name,
    displayName: (sentence || name).slice(0, 12),
    description: sentence || name,
    version: '1.0.0',
    template: 'react',
    type: 'utility',
    platform: [],
    features: [
      { code: 'main', explain: sentence || '打开插件', mode: 'detached', triggers: [{ type: 'keyword', value: name }] }
    ],
    permissions: { clipboard: true, notification: true },
    tools: [],
    window: { width: 480, height: 600 },
    behavior: { single: true, defaultDetached: true },
    needIcon: true
  }
}

const CATEGORY_SET = new Set(CATEGORY_OPTIONS.map((o) => o.value))
function parseCategory(v: any): PluginCategory | undefined {
  return typeof v === 'string' && CATEGORY_SET.has(v as PluginCategory) ? (v as PluginCategory) : undefined
}
function parsePlatform(v: any): PlatformKey[] {
  const valid = new Set<PlatformKey>(['darwin', 'win32', 'linux'])
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? [v] : [])
  return arr.map((x) => String(x)).filter((x): x is PlatformKey => valid.has(x as PlatformKey))
}
function parseWindow(v: any): VibeWindow | undefined {
  if (!v || typeof v !== 'object') return undefined
  const w: VibeWindow = {}
  if (numOrU(v.width)) w.width = v.width
  if (numOrU(v.height)) w.height = v.height
  if (numOrU(v.minWidth)) w.minWidth = v.minWidth
  if (numOrU(v.minHeight)) w.minHeight = v.minHeight
  if (numOrU(v.maxWidth)) w.maxWidth = v.maxWidth
  if (numOrU(v.maxHeight)) w.maxHeight = v.maxHeight
  if (['default', 'borderless', 'fullscreen'].includes(v.type)) w.type = v.type
  if (typeof v.titleBar === 'boolean') w.titleBar = v.titleBar
  if (typeof v.alwaysOnTop === 'boolean') w.alwaysOnTop = v.alwaysOnTop
  if (typeof v.transparent === 'boolean') w.transparent = v.transparent
  if (typeof v.resizable === 'boolean') w.resizable = v.resizable
  return Object.keys(w).length ? w : undefined
}
function parseBehavior(v: any): VibeBehavior | undefined {
  if (!v || typeof v !== 'object') return undefined
  const b: VibeBehavior = {}
  if (typeof v.single === 'boolean') b.single = v.single
  if (typeof v.defaultDetached === 'boolean') b.defaultDetached = v.defaultDetached
  if (typeof v.background === 'boolean') b.background = v.background
  if (typeof v.persistent === 'boolean') b.persistent = v.persistent
  if (numOrU(v.height)) b.height = v.height
  return Object.keys(b).length ? b : undefined
}
const EXEC_SET = new Set<ExecProfile>(['sandbox', 'workspace', 'trusted'])
function parseProfile(v: any): ExecProfile | undefined {
  return typeof v === 'string' && EXEC_SET.has(v as ExecProfile) ? (v as ExecProfile) : undefined
}
function parseCommandScope(v: any): VibeCommandScope | undefined {
  if (!v || typeof v !== 'object') return undefined
  const s: VibeCommandScope = {}
  if (typeof v.enabled === 'boolean') s.enabled = v.enabled
  const dp = parseProfile(v.defaultProfile); if (dp) s.defaultProfile = dp
  const mp = parseProfile(v.maxProfile); if (mp) s.maxProfile = mp
  return Object.keys(s).length ? s : undefined
}
function parseCommandExecution(v: any): VibeCommandExecution | undefined {
  if (!v || typeof v !== 'object') return undefined
  const ce: VibeCommandExecution = {}
  const direct = parseCommandScope(v.direct); if (direct) ce.direct = direct
  const ai = parseCommandScope(v.ai); if (ai) ce.ai = ai
  return Object.keys(ce).length ? ce : undefined
}
/** 解析 feature 级高级字段（mainPush/mainHide/preCapture/route） */
function parseFeatureExtras(f: any): Pick<VibeFeature, 'mainPush' | 'mainHide' | 'preCapture' | 'route'> {
  const extras: Pick<VibeFeature, 'mainPush' | 'mainHide' | 'preCapture' | 'route'> = {}
  if (f.mainPush === true) extras.mainPush = true
  if (f.mainHide === true) extras.mainHide = true
  if (f.preCapture === 'region' || f.preCapture === 'fullscreen') extras.preCapture = f.preCapture
  if (typeof f.route === 'string' && f.route.trim()) extras.route = f.route.trim()
  return extras
}
/** feature.code 去重：重复时追加 _2/_3… 保证唯一（B3） */
function dedupeFeatureCodes(features: VibeFeature[]): VibeFeature[] {
  const seen = new Set<string>()
  return features.map((f) => {
    let code = f.code
    if (seen.has(code)) {
      let n = 2
      while (seen.has(`${f.code}_${n}`)) n++
      code = `${f.code}_${n}`
    }
    seen.add(code)
    return code === f.code ? f : { ...f, code }
  })
}
/** 解析版本号：合法 semver 才用，否则回退（B5：不再无条件丢弃 AI 的 version） */
function parseVersion(v: any, fallback = '1.0.0'): string {
  return typeof v === 'string' && /^\d+\.\d+\.\d+([-.].+)?$/.test(v.trim()) ? v.trim() : fallback
}

/** 把 AI 返回的 JSON 规范化为契约（带兜底） */
export function normalizeContract(raw: any, sentence: string): VibeContract {
  const base = defaultContract(sentence)
  if (!raw || typeof raw !== 'object') return base

  const template: PluginTemplate = raw.template === 'basic' ? 'basic' : 'react'

  const features: VibeFeature[] = Array.isArray(raw.features) && raw.features.length
    ? raw.features
        .filter((f: any) => f && (f.code || f.explain))
        .map((f: any, i: number) => {
          let triggers: VibeTrigger[] = []
          if (Array.isArray(f.triggers)) triggers = f.triggers.map(normalizeTrigger).filter(Boolean) as VibeTrigger[]
          else if (Array.isArray(f.cmds)) triggers = f.cmds.map(normalizeTrigger).filter(Boolean) as VibeTrigger[]
          else if (Array.isArray(f.keywords)) triggers = f.keywords.map((k: any) => String(k).trim()).filter(Boolean).map((v: string) => ({ type: 'keyword' as const, value: v }))
          else if (f.keyword) triggers = [{ type: 'keyword', value: String(f.keyword) }]
          if (!triggers.length) triggers = [{ type: 'keyword', value: toKebab(String(raw.name || base.name)) }]
          return {
            code: toKebab(String(f.code || `feature-${i + 1}`)).replace(/-/g, '_') || `feature_${i + 1}`,
            explain: String(f.explain || f.code || '功能'),
            mode: (['ui', 'silent', 'detached'].includes(f.mode) ? f.mode : (template === 'react' ? 'detached' : 'silent')) as FeatureMode,
            triggers,
            ...parseFeatureExtras(f)
          }
        })
    : base.features

  const permissions: Record<string, boolean> = { ...base.permissions }
  if (raw.permissions && typeof raw.permissions === 'object') {
    for (const opt of PERMISSION_OPTIONS) {
      if (typeof raw.permissions[opt.key] === 'boolean') permissions[opt.key] = raw.permissions[opt.key]
    }
  }

  const tools: VibeTool[] = Array.isArray(raw.tools)
    ? raw.tools
        .filter((t: any) => t && typeof t.name === 'string' && t.name.trim())
        .map((t: any) => ({ name: String(t.name).trim(), description: String(t.description || '') }))
    : []

  const behavior = parseBehavior(raw.behavior) || parseBehavior(raw.pluginSetting) || {
    single: true,
    defaultDetached: features.some((f) => f.mode === 'detached')
  }
  const window = template === 'react' ? (parseWindow(raw.window) || base.window) : parseWindow(raw.window)

  return {
    name: toKebab(String(raw.name || base.name)),
    displayName: String(raw.displayName || base.displayName).slice(0, 32),
    description: String(raw.description || base.description),
    version: parseVersion(raw.version),
    template,
    type: parseCategory(raw.type) || 'utility',
    author: typeof raw.author === 'string' && raw.author.trim() ? raw.author.trim() : undefined,
    platform: parsePlatform(raw.platform),
    features: dedupeFeatureCodes(features.length ? features : base.features),
    permissions,
    commandExecution: parseCommandExecution(raw.commandExecution) || parseCommandExecution(raw.permissions?.commandExecution),
    tools,
    window,
    behavior,
    needIcon: raw.needIcon !== false
  }
}

/** 从已有 manifest 文本解析出契约（改造模式） */
export function manifestToContract(raw: string, fallbackName: string): VibeContract | null {
  let mf: any
  try { mf = JSON.parse(raw) } catch { return null }
  if (!mf || typeof mf !== 'object') return null

  const id = String(mf.id || mf.name || fallbackName).trim()
  const name = String(mf.name || id).trim()
  const template: PluginTemplate = mf.ui ? 'react' : 'basic'

  const features: VibeFeature[] = Array.isArray(mf.features) && mf.features.length
    ? mf.features.map((f: any, i: number) => ({
        code: String(f.code || `feature_${i + 1}`),
        explain: String(f.explain || f.code || '功能'),
        mode: (['ui', 'silent', 'detached'].includes(f.mode) ? f.mode : (mf.ui ? 'detached' : 'silent')) as FeatureMode,
        triggers: Array.isArray(f.cmds)
          ? (f.cmds.map(cmdToTrigger).filter(Boolean) as VibeTrigger[])
          : [],
        ...parseFeatureExtras(f)
      }))
    : [{ code: 'main', explain: mf.description || '打开插件', mode: (mf.ui ? 'detached' : 'silent') as FeatureMode, triggers: [{ type: 'keyword', value: name }] }]

  const permissions: Record<string, boolean> = {}
  for (const opt of PERMISSION_OPTIONS) {
    permissions[opt.key] = !!(mf.permissions && mf.permissions[opt.key])
  }

  const tools: VibeTool[] = Array.isArray(mf.tools)
    ? mf.tools.filter((t: any) => t?.name).map((t: any) => ({ name: String(t.name), description: String(t.description || '') }))
    : []

  return {
    name: name || id,
    displayName: String(mf.displayName || name || id),
    description: String(mf.description || ''),
    version: parseVersion(mf.version),
    template,
    type: parseCategory(mf.type),
    author: typeof mf.author === 'string' && mf.author.trim() ? mf.author.trim() : undefined,
    platform: parsePlatform(mf.platform),
    features: dedupeFeatureCodes(features),
    permissions,
    commandExecution: parseCommandExecution(mf.permissions?.commandExecution),
    tools,
    window: parseWindow(mf.window),
    behavior: parseBehavior(mf.pluginSetting),
    needIcon: false,
    isEdit: true,
    pluginId: id || name
  }
}

function serializeCommandScope(s?: VibeCommandScope): Record<string, unknown> | undefined {
  if (!s || s.enabled !== true) return undefined
  const o: Record<string, unknown> = { enabled: true }
  if (s.defaultProfile) o.defaultProfile = s.defaultProfile
  if (s.maxProfile) o.maxProfile = s.maxProfile
  return o
}
function serializeCommandExecution(ce?: VibeCommandExecution): Record<string, unknown> | undefined {
  if (!ce) return undefined
  const o: Record<string, unknown> = {}
  const d = serializeCommandScope(ce.direct); if (d) o.direct = d
  const a = serializeCommandScope(ce.ai); if (a) o.ai = a
  return Object.keys(o).length ? o : undefined
}

/** 把契约确定性地序列化为 manifest 对象；改造时在 base（原 manifest）上做最小覆盖 */
export function contractToManifest(c: VibeContract, base?: any): Record<string, unknown> {
  const m: Record<string, any> = base && typeof base === 'object' ? { ...base } : {}

  m.id = m.id || c.name
  m.name = m.name || c.name
  m.version = c.version || m.version || '1.0.0'
  m.displayName = c.displayName
  m.description = c.description
  m.main = m.main || 'dist/main.js'
  // B4：仅在会真正产出图标（needIcon）或 base 已有图标时才声明 icon，
  // 避免 needIcon=false 时引用一个不存在的 icon.png。
  if (!m.icon && c.needIcon) m.icon = 'icon.png'

  if (c.type) m.type = c.type
  if (c.author?.trim()) m.author = c.author.trim()

  // 平台：0 或 3 个 = 全平台 → 省略；1 个写字符串，2 个写数组
  const plats = (c.platform || []).filter((p, i, a) => a.indexOf(p) === i)
  if (plats.length === 1) m.platform = plats[0]
  else if (plats.length === 2) m.platform = plats
  else delete m.platform

  // 是否真的需要界面：只有存在 ui/detached 功能才声明 ui 入口。
  // 关键：即使 template 选了 react，但所有功能都是 silent（纯命令/无界面），也不写 ui，
  // 否则宿主会按「有界面」尝试打开窗口，而插件其实没有 UI → 打开失败。
  const needsUi = c.features.some((f) => f.mode === 'ui' || f.mode === 'detached')
  if (c.template === 'react' && needsUi) {
    m.ui = m.ui || 'ui/index.html'
  } else {
    delete m.ui
  }

  m.features = c.features.map((f) => {
    const cmds = (f.triggers || []).map(triggerToCmd).filter(Boolean) as Record<string, unknown>[]
    const feat: Record<string, unknown> = {
      code: f.code,
      explain: f.explain,
      mode: f.mode,
      cmds: cmds.length ? cmds : [{ type: 'keyword', value: f.code || c.name }]
    }
    if (f.mainPush) feat.mainPush = true
    if (f.mainHide) feat.mainHide = true
    if (f.preCapture) feat.preCapture = f.preCapture
    if (f.route?.trim()) feat.route = f.route.trim()
    return feat
  })

  // 窗口：保留 base.window，叠加契约里有值的字段；basic 模板无界面则不写
  const winSrc = c.window || {}
  const winClean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(winSrc)) {
    if (v !== undefined && v !== '' && !(typeof v === 'number' && !isFinite(v))) winClean[k] = v
  }
  if (needsUi) {
    const merged = { ...(base?.window && typeof base.window === 'object' ? base.window : {}), ...winClean }
    if (Object.keys(merged).length) m.window = merged
  } else {
    delete m.window
  }

  // 权限：保留 base 中结构化/未覆盖的权限（commandExecution、envKeys 等），只写为 true 的布尔开关
  const perms: Record<string, any> = {}
  if (base?.permissions && typeof base.permissions === 'object') {
    for (const [k, v] of Object.entries(base.permissions)) {
      if (!PERMISSION_OPTIONS.some((o) => o.key === k)) perms[k] = v
    }
  }
  for (const opt of PERMISSION_OPTIONS) if (c.permissions[opt.key]) perms[opt.key] = true
  // 结构化命令执行（schema 推荐）：契约里有则写/覆盖；契约未设则保留 base 已复制的值
  const ce = serializeCommandExecution(c.commandExecution)
  if (ce) perms.commandExecution = ce
  if (Object.keys(perms).length) m.permissions = perms
  else delete m.permissions

  // pluginSetting：保留 base，叠加行为设置
  const ps: Record<string, any> = (m.pluginSetting && typeof m.pluginSetting === 'object') ? { ...m.pluginSetting } : {}
  const beh = c.behavior || {}
  if (typeof beh.single === 'boolean') ps.single = beh.single
  if (typeof beh.defaultDetached === 'boolean') ps.defaultDetached = beh.defaultDetached
  if (typeof beh.background === 'boolean') ps.background = beh.background
  if (typeof beh.persistent === 'boolean') ps.persistent = beh.persistent
  if (typeof beh.height === 'number' && isFinite(beh.height) && beh.height > 0) ps.height = beh.height
  if (ps.single === undefined) ps.single = true
  if (ps.defaultDetached === undefined) ps.defaultDetached = c.features.some((f) => f.mode === 'detached')
  // 无界面插件强制非独立窗口，纠正历史上被错误置为 true 的 base manifest
  if (!needsUi) ps.defaultDetached = false
  m.pluginSetting = ps

  if (c.tools.length) {
    m.tools = c.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: 'object', properties: {}, additionalProperties: true }
    }))
  } else if (m.tools) {
    delete m.tools
  }

  return m
}

/** 序列化为 manifest.json 文本（2 空格缩进 + 末尾换行） */
export function manifestJson(c: VibeContract, base?: any): string {
  return JSON.stringify(contractToManifest(c, base), null, 2) + '\n'
}

/** 契约的一行摘要（用于时间线/日志） */
export function contractSummary(c: VibeContract): string {
  const feat = c.features.map((f) => `${f.code}(${f.mode})`).join(', ')
  return `${c.name} · ${c.template} · ${feat || '无功能'}`
}

/**
 * 生成前校验契约（B1）：拦截会写出不符合 manifest-schema 的畸形 manifest 的情况
 * （空展示名/描述、空/重复功能码、缺说明、触发全部无效等）。返回错误消息数组，空 = 通过。
 */
export function validateContract(c: VibeContract): string[] {
  const errs: string[] = []
  const name = toKebab(c.name || '')
  if (!name) errs.push('插件名（id）不能为空')
  else if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) errs.push('插件名只能含小写字母/数字/中划线，且以字母或数字开头')
  if (!c.displayName?.trim()) errs.push('展示名不能为空')
  if (!c.description?.trim()) errs.push('一句话描述不能为空')
  if (!/^\d+\.\d+\.\d+([-.].+)?$/.test((c.version || '').trim())) errs.push('版本号需符合 x.y.z 格式')
  if (!c.features?.length) errs.push('至少需要一个功能入口')
  const codes = new Set<string>()
  c.features?.forEach((f, i) => {
    const code = (f.code || '').trim()
    const tag = code || `#${i + 1}`
    if (!code) errs.push(`功能 #${i + 1} 缺少功能码 code`)
    else {
      if (codes.has(code)) errs.push(`功能码「${code}」重复，需唯一`)
      codes.add(code)
    }
    if (!f.explain?.trim()) errs.push(`功能「${tag}」缺少说明 explain`)
    const triggers = f.triggers || []
    const validTriggers = triggers.map(triggerToCmd).filter(Boolean)
    if (triggers.length > 0 && validTriggers.length === 0) {
      errs.push(`功能「${tag}」的触发方式都不完整（如关键词为空、正则缺 match、窗口缺 app/title/bundleId）`)
    }
  })
  return errs
}
