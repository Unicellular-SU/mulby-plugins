export type ProviderKind = 'video' | 'audio'
export type ProviderType = 'openai-tts' | 'custom-video'

export type ImageReferenceMode = 'single' | 'keyframes' | 'multi'
export type ImageReferenceTransport = 'dataurl' | 'url' | 'either'

export interface VideoReferenceInputCapabilities {
  images?: {
    /** 单次请求可消费的图片数。旧 Provider 未声明时按 imageToVideo/lastFrame 推断为 0/1/2。 */
    max?: number
    modes?: ImageReferenceMode[]
    transport?: ImageReferenceTransport
  }
  videos?: {
    /** 单次请求可消费的参考视频数；当前仅发送公开 http(s) URL。 */
    max?: number
    transport?: 'url'
  }
  /** 是否允许图片与视频同时出现在一次请求中。 */
  mixed?: boolean
}

export interface VideoProviderCapabilities {
  textToVideo?: boolean
  imageToVideo?: boolean
  lastFrame?: boolean
  nativeAudio?: boolean
  aspects?: string[]
  durations?: number[]
  resolutions?: string[]
  referenceInputs?: VideoReferenceInputCapabilities
}

/** 可选费用声明。未填写时生成计划必须明确显示“费用未知”，不得伪造估算。 */
export interface ProviderPricing {
  currency: string
  perRequest?: number
  perSecond?: number
  confirmAbove?: number
}

export interface ProviderConfig {
  id: string
  label: string
  kind: ProviderKind
  type: ProviderType
  baseURL: string
  /** 可选的无计费 GET 探测地址；未配置时只能检查服务域名是否可达。 */
  healthCheckUrl?: string
  /** 供节点面板裁剪无效参数；旧配置缺失时由请求模板自动推断。 */
  capabilities?: VideoProviderCapabilities
  pricing?: ProviderPricing

  // ---- custom-video（异步 submit + poll，字段/路径可配） ----
  submitPath?: string // 例 /v1/video/generations
  method?: 'POST' | 'GET'
  promptField?: string // 请求体中提示词字段（支持点路径），默认 prompt
  imageField?: string // 图生视频：图片字段
  imageMode?: 'none' | 'url' | 'dataurl'
  extraBody?: string // 额外请求体（JSON 字符串）合并
  idPath?: string // 提交响应里任务 id 的 JSON 路径
  statusPath?: string // 轮询地址（含 {id}）
  statusField?: string // 轮询响应里状态字段的 JSON 路径
  doneValues?: string // 终态(成功) csv
  failValues?: string // 终态(失败) csv
  resultPath?: string // 结果媒体 URL 的 JSON 路径；可用 | 按优先级声明多个回退路径
  pollIntervalMs?: number
  /** 轮询退避序列；每次查询依次取值，超过数组后重复最后一项。响应头 Retry-After 优先。 */
  pollScheduleMs?: number[]
  timeoutMs?: number
  /** 瞬时 HTTP 错误后的额外提交次数；默认 2。无幂等保证或可能重复计费时应设为 0。 */
  submitRetries?: number

  // 图生视频需公网图 URL 时的图床上传
  uploadUrl?: string
  uploadField?: string
  uploadUrlPath?: string

  // ---- 声明式模板路径（bodyTemplate 存在时优先；适配火山/阿里/toapis 等真实 API） ----
  model?: string // 默认模型（节点未选时用）
  models?: string[] // 可选模型清单（设置页/节点下拉，如 toapis 视频全系列）
  bodyTemplate?: string // 占位 {prompt}/{imageUrl}/{model}/{duration}… + 条件 {?x}…{/x}
  submitUrl?: string // 完整提交 URL
  pollUrl?: string // 完整轮询 URL（含 {taskId}）
  taskIdPath?: string // 提交响应里任务 id 路径
  videoUrlPath?: string // 结果媒体 URL 路径；可用 | 按优先级声明多个回退路径
  headers?: Record<string, string> // 额外请求头

  // ---- openai-tts ----
  ttsModel?: string
  ttsVoice?: string
  ttsFormat?: string
}
