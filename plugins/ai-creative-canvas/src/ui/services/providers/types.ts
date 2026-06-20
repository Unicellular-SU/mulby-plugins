export type ProviderKind = 'video' | 'audio'
export type ProviderType = 'openai-tts' | 'custom-video'

export interface ProviderConfig {
  id: string
  label: string
  kind: ProviderKind
  type: ProviderType
  baseURL: string

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
  resultPath?: string // 结果媒体 URL 的 JSON 路径
  pollIntervalMs?: number
  timeoutMs?: number

  // 图生视频需公网图 URL 时的图床上传
  uploadUrl?: string
  uploadField?: string
  uploadUrlPath?: string

  // ---- openai-tts ----
  ttsModel?: string
  ttsVoice?: string
  ttsFormat?: string
}
