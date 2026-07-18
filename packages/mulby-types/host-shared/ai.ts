import type { CommandCallerIdentity } from './settings'

export interface AiMessageContentText {
  type: 'text'
  text: string
}

export interface AiMessageContentImage {
  type: 'image'
  attachmentId: string
  mimeType?: string
}

export interface AiMessageContentFile {
  type: 'file'
  attachmentId: string
  mimeType?: string
  filename?: string
}

export type AiMessageContent = AiMessageContentText | AiMessageContentImage | AiMessageContentFile

export interface AiCapabilityDebugInfo {
  requested: string[]
  allowed: string[]
  denied: string[]
  reasons: string[]
  selectedSkills?: AiSkillSelectionMeta[]
}

export interface AiPolicyDebugInfo {
  skills: {
    requested?: AiSkillSelection
    selectedSkillIds: string[]
    selectedSkillNames: string[]
    reasons: string[]
  }
  mcp: {
    requested?: AiMcpSelection
    resolved?: AiMcpSelection
  }
  toolContext: {
    requested?: AiToolContext
    resolved?: AiToolContext
  }
  capabilities: {
    requested: string[]
    resolved: string[]
  }
  internalTools: {
    requested: string[]
    resolved: string[]
  }
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content?: string | AiMessageContent[]
  reasoning_content?: string
  /**
   * 流式事件类型（仅 onChunk 过程中出现），用于统一 meta/text/reasoning/tool/error/usage/end 协议。
   * usage：多步工具循环中每轮 LLM 往返结束时推送的真实用量快照（usage=跨轮累计，usage_round=本轮）。
   */
  chunkType?: 'meta' | 'text' | 'reasoning' | 'tool-call' | 'tool-progress' | 'tool-result' | 'error' | 'usage' | 'end'
  capability_debug?: AiCapabilityDebugInfo
  policy_debug?: AiPolicyDebugInfo
  tool_call?: {
    id: string
    name: string
    args?: unknown
  }
  tool_progress?: {
    id?: string
    name: string
    progress: number
    total?: number
    message?: string
  }
  tool_result?: {
    id: string
    name: string
    result?: unknown
  }
  error?: {
    message: string
    code?: string
    category?: string
    retryable?: boolean
    statusCode?: number
  }
  usage?: AiTokenBreakdown
  /** usage chunk 专用：本轮（单次 LLM 往返）的真实用量；provider 可能只返回单侧 */
  usage_round?: { inputTokens?: number; outputTokens?: number }
  /** usage chunk 专用：工具循环轮次（1-based） */
  tool_round?: number
}

export interface AiToolFunction {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties?: boolean
  }
  /**
   * Legacy required fields location. Prefer parameters.required.
   */
  required?: string[]
}

export interface AiTool {
  type: 'function'
  function?: AiToolFunction
}

export type AiMcpServerType = 'stdio' | 'sse' | 'streamableHttp'

export type AiMcpServerInstallSource = 'manual' | 'protocol' | 'builtin'

export interface AiMcpServer {
  id: string
  name: string
  type: AiMcpServerType
  isActive: boolean
  description?: string
  baseUrl?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  timeoutSec?: number
  longRunning?: boolean
  disabledTools?: string[]
  disabledAutoApproveTools?: string[]
  installSource?: AiMcpServerInstallSource
  isTrusted?: boolean
  trustedAt?: number
  installedAt?: number
}

export interface AiMcpDefaults {
  timeoutMs?: number
  longRunningMaxMs?: number
  approvalMode?: 'always' | 'auto-approved-only' | 'never'
}

export interface AiMcpSettings {
  servers: AiMcpServer[]
  defaults?: AiMcpDefaults
}

export interface AiMcpSelection {
  mode?: 'off' | 'manual' | 'auto'
  serverIds?: string[]
  allowedToolIds?: string[]
}

export interface AiMcpTool {
  id: string
  name: string
  description?: string
  serverId: string
  serverName: string
  inputSchema?: unknown
  outputSchema?: unknown
}

export interface AiMcpServerLogEntry {
  timestamp: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  source?: string
  data?: unknown
}

export type AiSkillSource = 'manual' | 'local-dir' | 'zip' | 'npx' | 'json' | 'builtin' | 'system'

export type AiSkillTrustLevel = 'untrusted' | 'reviewed' | 'trusted'

export interface AiSkillSelectionMeta {
  id: string
  source: AiSkillSource
  trustLevel: AiSkillTrustLevel
}

export interface AiSkillMcpPolicy {
  serverIds?: string[]
  allowedToolIds?: string[]
  blockedToolIds?: string[]
}

export interface AiSkillMulbyExtensions {
  mode?: 'manual' | 'auto' | 'both'
  triggerPhrases?: string[]
  capabilities?: string[]
  /**
   * @deprecated Prefer capabilities.
   */
  internalTools?: string[]
  mcpPolicy?: AiSkillMcpPolicy
}

export interface AiSkillDescriptor {
  id: string
  name: string
  description: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  /**
   * Frontmatter key `allowed-tools` (space-delimited string) as normalized tool id list.
   */
  allowedTools?: string[]
  /**
   * SKILL.md body content (loaded lazily at activation time).
   */
  promptTemplate?: string
  /**
   * Parsed from `metadata.mulby.*` keys.
   */
  mulbyExtensions?: AiSkillMulbyExtensions
  /**
   * @deprecated Use mulbyExtensions.mode.
   */
  mode?: 'manual' | 'auto' | 'both'
  /**
   * @deprecated Use mulbyExtensions.triggerPhrases.
   */
  triggerPhrases?: string[]
  /**
   * @deprecated Use mulbyExtensions.capabilities.
   */
  capabilities?: string[]
  /**
   * @deprecated Use mulbyExtensions.internalTools.
   */
  internalTools?: string[]
  /**
   * @deprecated Use mulbyExtensions.mcpPolicy.
   */
  mcpPolicy?: AiSkillMcpPolicy
}

export interface AiSkillRecord {
  id: string
  source: AiSkillSource
  origin?: 'system' | 'app'
  readonly?: boolean
  sourceRef?: string
  installPath?: string
  skillMdPath?: string
  contentHash: string
  enabled: boolean
  trustLevel: AiSkillTrustLevel
  installedAt: number
  updatedAt: number
  descriptor: AiSkillDescriptor
}

export interface AiSkillSettings {
  enabled: boolean
  activeSkillIds: string[]
  records: AiSkillRecord[]
}

export interface AiSkillSelection {
  mode?: 'off' | 'manual' | 'progressive'
  skillIds?: string[]
  variables?: Record<string, string>
}

export interface AiSkillResolveResult {
  selectedSkillIds: string[]
  selectedSkillNames: string[]
  selectedSkills?: AiSkillSelectionMeta[]
  availableSkillsPrompt?: string
  systemPrompts: string[]
  mergedMcp?: AiMcpSelection
  toolContextPatch?: AiToolContext['mcpScope']
  capabilities?: string[]
  /**
   * @deprecated Prefer capabilities.
   */
  internalTools?: string[]
  reasons?: string[]
}

export interface AiSkillPreview {
  selected: AiSkillRecord[]
  systemPrompt: string
  mcpImpact: {
    serverIds?: string[]
    allowedToolIds?: string[]
    blockedToolIds?: string[]
  }
  reasons: string[]
}

export interface AiOption {
  model?: string
  messages: AiMessage[]
  tools?: AiTool[]
  capabilities?: string[]
  /**
   * @deprecated Prefer capabilities.
   */
  internalTools?: string[]
  toolingPolicy?: {
    enableInternalTools?: boolean
    capabilityAllowList?: string[]
    capabilityDenyList?: string[]
  }
  mcp?: AiMcpSelection
  skills?: AiSkillSelection
  params?: AiModelParameters
  toolContext?: AiToolContext
  maxToolSteps?: number  // 工具调用的最大步骤数，默认为 20，最大 300
}

export interface AiToolContext {
  pluginName?: string
  internalTag?: string
  caller?: CommandCallerIdentity
  /** Per-request identifier for scoping runtime state (e.g. skill activation deduplication). */
  requestId?: string
  mcpScope?: {
    allowedServerIds?: string[]
    allowedToolIds?: string[]
  }
}

export interface AiModelParameters {
  contextWindow?: number
  temperatureEnabled?: boolean
  topPEnabled?: boolean
  maxOutputTokensEnabled?: boolean
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  seed?: number
  /**
   * Reasoning effort for reasoning-capable models. Maps to OpenAI-style
   * `reasoning_effort` and AI SDK `providerOptions.openai.reasoningEffort`.
   * Lower = faster / cheaper (good for latency-sensitive uses like autocomplete).
   */
  reasoningEffort?: AiReasoningEffort
  /**
   * Explicitly turn model "thinking" on/off where the provider supports it
   * (e.g. deepseek-v4 `thinking:{type}`, Anthropic extended thinking, Gemini
   * thinkingConfig). Omit to use the provider/model default.
   */
  thinking?: AiThinkingMode
  /**
   * 结构化输出格式。`'json_object'` 约束为合法 JSON；`'json_schema'` 进一步按
   * `jsonSchema` 约束输出结构（OpenAI response_format / AI SDK Output / Gemini responseSchema）。
   * 省略则为普通文本输出。
   */
  responseFormat?: 'json_object' | 'json_schema'
  /**
   * JSON Schema（建议 draft 2020-12 子集）。`responseFormat: 'json_schema'` 时生效，
   * 约束模型输出符合该结构。
   */
  jsonSchema?: Record<string, unknown>
  /** 结构化输出的 schema 名称（OpenAI 需要），省略默认 `output`。 */
  jsonSchemaName?: string
  /** 严格模式（OpenAI `strict` / 增强 schema 遵守）。默认 true。 */
  strict?: boolean
}

export type AiReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'max'
export type AiThinkingMode = 'enabled' | 'disabled'

export type AiModelType = 'text' | 'vision' | 'embedding' | 'reasoning' | 'function_calling' | 'web_search' | 'rerank'

export interface AiModelCapability {
  type: AiModelType
  /**
   * 是否为用户手动选择，如果为true，则表示用户手动选择了该类型，否则表示用户手动禁止了该模型；如果为undefined，则表示使用默认值
   */
  isUserSelected?: boolean
}

export interface AiModel {
  id: string
  label: string
  description: string
  icon?: string
  /**
   * 绑定的 Provider 实例 ID（优先级高于 providerLabel）。
   */
  providerRef?: string
  providerLabel?: string
  /**
   * new-api / cherryin 族模型的协议路由类型。
   */
  endpointType?: AiEndpointType
  /**
   * 模型声明支持的 endpoint 类型列表（可选）。
   */
  supportedEndpointTypes?: AiEndpointType[]
  params?: AiModelParameters
  capabilities?: AiModelCapability[]
  /**
   * 模型的「上下文窗口（token 数）」。注意：与 `params.contextWindow`（历史消息条数窗口）是两回事。
   * 优先级：用户在此显式覆盖 > models.dev 快照/缓存；两者都未知则保持缺省，
   * 消费方保守处理（压缩预算退安全粗下限、占用指示只显示绝对量），不按模型 id 家族猜。
   */
  contextTokens?: number
}

export type AiProviderId =
  | 'openai'
  | 'openai-response'
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'gemini'
  | 'deepseek'
  | 'openrouter'
  | 'azure'
  | 'azure-openai'
  | 'new-api'
  | 'cherryin'
  | 'ollama'
  | 'custom'

export type AiEndpointType =
  | 'openai'
  | 'openai-response'
  | 'anthropic'
  | 'gemini'
  | 'image-generation'
  | 'jina-rerank'

/**
 * `allModels()` 的可选过滤条件。
 * 所有字段均可选，未填写时不过滤对应维度。
 */
export interface AiModelsFilter {
  /**
   * 按端点类型筛选（单值或多值均可）。
   * 例：只获取图像生成模型：{ endpointType: 'image-generation' }
   */
  endpointType?: AiEndpointType | AiEndpointType[]
  /**
   * 按能力筛选（单值或多值均可），满足任意一个即包含。
   * 例：只获取有视觉能力的模型：{ capability: 'vision' }
   */
  capability?: AiModelType | AiModelType[]
  /**
   * 按 Provider 实例 ID 精确筛选。
   */
  providerId?: string
}

export interface AiProviderConfig {
  /**
   * Provider 实例 ID（用于区分多个同类型实例，如 v3-openai / official-openai）。
   */
  id: AiProviderId | string
  /**
   * Provider 实现类型（不填时向后兼容为 id）。
   */
  type?: AiProviderId | string
  label?: string
  enabled: boolean
  /**
   * 支持单 key 或多 key（逗号分隔，支持转义逗号：`\\,`）。
   */
  apiKey?: string
  baseURL?: string
  apiVersion?: string
  anthropicBaseURL?: string
  headers?: Record<string, string>
  defaultModel?: string
  defaultParams?: AiModelParameters
}

export interface AiSettings {
  providers: AiProviderConfig[]
  models?: AiModel[]
  /**
   * 全局默认模型：当调用方未显式传 model 时优先使用。
   */
  defaultModel?: string
  defaultParams?: AiModelParameters
  mcp?: AiMcpSettings
  skills?: AiSkillSettings
}

export interface AiAttachmentRef {
  attachmentId: string
  mimeType: string
  size: number
  filename?: string
  expiresAt?: string
  purpose?: string
}

export interface AiTokenBreakdown {
  inputTokens: number
  outputTokens: number
}

export interface AiImageGenerateProgressChunk {
  type: 'status' | 'preview'
  stage?: 'start' | 'partial' | 'finalizing' | 'completed' | 'fallback'
  message?: string
  image?: string
  index?: number
  received?: number
  total?: number
}

export interface AiPromiseLike<T> extends Promise<T> {
  abort: () => void
}

export interface AiApi {
  call: (option: AiOption, streamCallback?: (chunk: AiMessage) => void) => AiPromiseLike<AiMessage>
  allModels: (filter?: AiModelsFilter) => Promise<AiModel[]>
  testConnection: (input?: { model?: string; providerId?: string; apiKey?: string; baseURL?: string }) => Promise<{ success: boolean; message?: string }>
  testConnectionStream: (
    input: { model?: string; providerId?: string; apiKey?: string; baseURL?: string },
    onChunk: (chunk: { type: 'content' | 'reasoning'; text: string }) => void
  ) => AiPromiseLike<{ success: boolean; message?: string; reasoning?: string }>
  models: {
    fetch: (input: { providerId: string; baseURL?: string; apiKey?: string }) => Promise<{ models: AiModel[]; message?: string }>
  }
  abort: (requestId: string) => Promise<void>
  settings: {
    get: () => Promise<AiSettings>
    update: (next: Partial<AiSettings>) => Promise<AiSettings>
  }
  mcp: {
    listServers: () => Promise<AiMcpServer[]>
    getServer: (serverId: string) => Promise<AiMcpServer | null>
    upsertServer: (server: AiMcpServer) => Promise<AiMcpServer>
    removeServer: (serverId: string) => Promise<void>
    activateServer: (serverId: string) => Promise<AiMcpServer>
    deactivateServer: (serverId: string) => Promise<AiMcpServer>
    restartServer: (serverId: string) => Promise<AiMcpServer>
    checkServer: (serverId: string) => Promise<{ ok: boolean; message?: string }>
    listTools: (serverId: string) => Promise<AiMcpTool[]>
    abort: (callId: string) => Promise<boolean>
    getLogs: (serverId: string) => Promise<AiMcpServerLogEntry[]>
  }
  skills: {
    list: () => Promise<AiSkillRecord[]>
    refresh: () => Promise<AiSkillRecord[]>
    listEnabled: () => Promise<AiSkillRecord[]>
    get: (skillId: string) => Promise<AiSkillRecord | null>
    install: (input: {
      source: 'local-dir' | 'zip' | 'npx'
      ref: string
      skills?: string[]
      command?: string
      trustLevel?: AiSkillTrustLevel
      enabled?: boolean
    }) => Promise<AiSkillRecord[]>
    remove: (skillId: string) => Promise<void>
    enable: (skillId: string) => Promise<AiSkillRecord>
    disable: (skillId: string) => Promise<AiSkillRecord>
    preview: (input: {
      option?: Partial<AiOption>
      skillIds?: string[]
      prompt?: string
    }) => Promise<AiSkillPreview>
    resolve: (option: AiOption) => Promise<AiSkillResolveResult>
  }
  attachments: {
    upload: (input: { filePath?: string; buffer?: ArrayBuffer; mimeType: string; purpose?: string }) => Promise<AiAttachmentRef>
    get: (attachmentId: string) => Promise<AiAttachmentRef | null>
    delete: (attachmentId: string) => Promise<void>
    uploadToProvider: (input: { attachmentId: string; model?: string; providerId?: string; purpose?: string }) => Promise<{ providerId: string; fileId: string; uri?: string }>
  }
  tokens: {
    estimate: (input: {
      model?: string
      messages: AiMessage[]
      attachments?: AiAttachmentRef[]
      outputText?: string
    }) => Promise<AiTokenBreakdown>
  }
  images: {
    generate: (input: { prompt: string; model: string; size?: string; count?: number }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
    generateStream: (
      input: { prompt: string; model: string; size?: string; count?: number },
      onChunk: (chunk: AiImageGenerateProgressChunk) => void
    ) => AiPromiseLike<{ images: string[]; tokens: AiTokenBreakdown }>
    edit: (input: {
      imageAttachmentId: string
      prompt: string
      model: string
      /** 额外参考图（按参考图条件生成 / 多图一致性，如 Gemini 多图）；附在主图之后一并传给模型 */
      referenceAttachmentIds?: string[]
    }) => Promise<{ images: string[]; tokens: AiTokenBreakdown }>
  }
  tooling: {
    webSearch: {
      get: () => Promise<Record<string, unknown>>
      update: (partial: Record<string, unknown>) => Promise<Record<string, unknown>>
      /** 获取当前网络搜索配置（含可用 provider 列表） */
      getSettings: () => Promise<{
        activeProvider: string
        providers: Array<{ id: string; name: string; type: 'local' | 'api' | 'custom' }>
      }>
      /** 修改当前激活的搜索 provider */
      setActiveProvider: (providerId: string) => Promise<{ success: boolean; activeProvider: string }>
    }
    pluginTools: {
      /** 获取用户禁用的插件工具列表（格式 "pluginId:toolName"） */
      getDisabled: () => Promise<string[]>
      /** 设置用户禁用的插件工具列表 */
      setDisabled: (disabledList: string[]) => Promise<string[]>
    }
  }
  /** MCP Server 管理（将插件工具暴露给外部 AI 工具） */
  mcpServer: {
    /** 获取运行状态 */
    getState: () => Promise<{
      status: 'stopped' | 'starting' | 'running' | 'error'
      port: number
      address?: string
      toolCount: number
      error?: string
      startedAt?: number
    }>
    /** 启动 MCP Server */
    start: () => Promise<unknown>
    /** 停止 MCP Server */
    stop: () => Promise<unknown>
    /** 重启 MCP Server */
    restart: () => Promise<unknown>
    /** 重新生成认证 Token */
    regenerateToken: () => Promise<{ token: string }>
    /** 获取已注册的工具列表 */
    getTools: () => Promise<Array<{
      mcpToolName: string
      pluginId: string
      toolName: string
      pluginName: string
    }>>
    /** 获取客户端配置示例 */
    getClientConfig: () => Promise<{
      claudeDesktop: object
      cursor: object
      generic: object
    }>
    /** 刷新工具列表 */
    refreshTools: () => Promise<unknown>
    /** 获取配置（含 token/port/enabled + stdioBridgePath） */
    getConfig: () => Promise<{
      enabled: boolean
      port: number
      token: string
      stdioBridgePath: string
    }>
    /** 更新端口号（需要重启生效） */
    updatePort: (port: number) => Promise<unknown>
  }
}
