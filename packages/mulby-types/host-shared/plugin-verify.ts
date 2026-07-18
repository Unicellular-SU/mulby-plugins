/**
 * 插件验证（AI / 开发者校验）相关类型与协议常量。
 *
 * 验证在一个隔离的 Mulby「验证模式」进程中运行：通过环境变量
 * `MULBY_VERIFY_PLUGIN=<插件目录>` 触发，加载并冒烟测试单个插件，然后把一份
 * {@link VerifyReport} 以 JSON 形式打印到 stdout，包裹在
 * {@link VERIFY_REPORT_BEGIN} / {@link VERIFY_REPORT_END} 标记之间，
 * 供外部 CLI（mulby-cli）或脚本稳定解析。
 *
 * 这是「让 AI 用 Mulby 检查插件」的稳定契约：输入 = 环境变量，输出 = 标记包裹的 JSON。
 */

export const VERIFY_REPORT_SCHEMA_VERSION = 1

/** stdout 中包裹 JSON 报告的起始标记，便于在日志噪声中稳定提取。 */
export const VERIFY_REPORT_BEGIN = '<<<MULBY_VERIFY_REPORT_BEGIN>>>'
/** stdout 中包裹 JSON 报告的结束标记。 */
export const VERIFY_REPORT_END = '<<<MULBY_VERIFY_REPORT_END>>>'

export type VerifyCheckStatus = 'pass' | 'fail' | 'warn' | 'skip'

export interface VerifyCheck {
  /** 稳定标识，如 `manifest` | `load` | `onload` | `trigger:${code}` | `run:${code}`。 */
  id: string
  title: string
  status: VerifyCheckStatus
  detail?: string
}

export interface VerifyFeatureReport {
  code: string
  explain?: string
  mode?: string
  /** 该功能声明的触发规则（用于展示）。 */
  triggers: string[]
  /** 关键词触发能否在搜索中命中该功能；`null` 表示无法自动判定（如仅 regex / files 触发）。 */
  triggerMatched: boolean | null
  /** 执行结果（静默功能为 host 执行；UI 功能为离屏渲染）。 */
  run: VerifyCheckStatus
  runError?: string
  /** UI 功能的离屏渲染结果（Tier 2）。 */
  uiRender?: {
    rendered: boolean
    /** 插件自身的 console 错误数 */
    consoleErrors: number
    /** 被降级忽略的「宿主桥渠道未注册」提示数 */
    missingBridge: number
    screenshotBytes?: number
  }
}

export interface VerifyLogEntry {
  /** 来源，如 `host`。 */
  source: string
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
}

export interface VerifyReportPluginInfo {
  id: string
  name: string
  displayName?: string
  version?: string
  path: string
  hasUI: boolean
  hasBackground: boolean
}

export interface VerifyReport {
  schemaVersion: number
  /** 总判定：无 `fail` 即通过（strict 模式下 `warn` 也判失败）。 */
  ok: boolean
  verdict: 'pass' | 'fail'
  plugin: VerifyReportPluginInfo
  checks: VerifyCheck[]
  features: VerifyFeatureReport[]
  logs: VerifyLogEntry[]
  /** 致命错误（导致验证无法继续）。 */
  errors: string[]
  durationMs: number
  meta: {
    platform: string
    electron?: string
    node?: string
    timestamp: string
    strict: boolean
    /** 验证模式使用的隔离 userData 目录（供外部清理/排查）。 */
    userDataDir?: string
  }
}

/** PluginManager 向验证器转发的 host 诊断事件。 */
export type HostDiagnosticEvent =
  | { kind: 'console'; pluginName: string; level: 'log' | 'error'; text: string }
  | { kind: 'error'; pluginName: string; text: string }
  | { kind: 'exit'; pluginName: string; code: number }
