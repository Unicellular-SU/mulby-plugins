/**
 * Mulby 开发者工具 — 宿主 ↔ IPC ↔ 插件之间的契约类型。
 *
 * 这些类型是 Agent-5（Developer IPC）与 Agent-4（开发者工具插件）的依赖契约：
 * - `validatePluginAt` 返回 `PluginValidationResult`
 * - `getPluginProjectStatus` 返回 `PluginProjectStatus[]`
 * 任何字段变更须在群内同步。
 */
import type {
  PluginProjectEntry,
  PluginProjectSource,
  PluginProjectType
} from './settings'

/**
 * 校验单个插件目录的结果（不落库）。
 */
export interface PluginValidationResult {
  /** manifest 解析 + 必填字段 + 平台兼容 + main 解析 全部通过 */
  valid: boolean
  /** 失败原因（缺 manifest、缺字段、regex 误用、平台不兼容、main 未找到等） */
  errors: string[]
  /** 非致命提示（如 regex 命令缺 match） */
  warnings: string[]
  /** 解析到的 manifest 摘要（解析失败时为 undefined） */
  manifest?: PluginManifestSummary
  /** 非系统插件的 main 入口是否解析到 */
  mainEntryFound: boolean
  /** 构建产物（manifest.main 指向的文件）是否存在 */
  built: boolean
}

/**
 * manifest 关键字段摘要，用于 UI 展示与状态汇总。
 */
export interface PluginManifestSummary {
  id: string
  name: string
  version: string
  displayName: string
  description?: string
  main?: string
  hasUi: boolean
  featureCount: number
  platform?: string | string[]
}

/**
 * 单个插件在某开发项目下的运行态状态（供 UI 列表）。
 */
export interface PluginProjectPluginStatus {
  id: string
  displayName: string
  path: string
  manifestValid: boolean
  manifestErrors: string[]
  mainEntryFound: boolean
  /** dist/main.js（或 manifest.main）是否存在 */
  built: boolean
  /** 是否已在 PluginManager.plugins 中加载 */
  loaded: boolean
  enabled: boolean
  isDev: boolean
  /** 冲突的另一来源路径（overriddenInstallPath / 同 id 系统插件） */
  idConflictWith?: string
}

/**
 * 一个开发项目（single/collection）及其下插件的状态。
 */
export interface PluginProjectStatus {
  projectId: string
  path: string
  type: PluginProjectType
  source: PluginProjectSource
  label?: string
  /** 目录是否仍存在 */
  exists: boolean
  plugins: PluginProjectPluginStatus[]
}

// ==================== Developer IPC 返回类型（Agent-5 / 阶段C） ====================

/** 通用操作结果（remove/reload/openDir/updateMeta 等） */
export interface DeveloperOpResult {
  success: boolean
  error?: string
}

/** developer:addPluginProject 返回 */
export interface AddPluginProjectResult {
  success: boolean
  project?: PluginProjectEntry
  error?: string
  /** 增量加载时的非致命警告（如部分子插件 manifest 无效） */
  warning?: string
}

/** developer:createPlugin 返回（脚手架） */
export interface CreatePluginResult {
  success: boolean
  path?: string
  log: string
  error?: string
}

/** developer:buildPlugin 返回 */
export interface BuildPluginResult {
  success: boolean
  log: string
  error?: string
}

/** developer:packPlugin 返回 */
export interface PackPluginResult {
  success: boolean
  outFile?: string
  log: string
  error?: string
}
