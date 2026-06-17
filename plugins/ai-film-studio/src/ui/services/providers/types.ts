/**
 * 媒体供应商抽象：Mulby 不提供视频/音乐/语音模型，由插件经 mulby.http 自管。
 * 两种调用模式：
 *  - async-poll：统一异步三段式 submit → poll →（completed 后取结果 URL）。用于视频 / 音乐。
 *  - sync-binary：单次请求直接返回音频二进制（OpenAI 兼容 /audio/speech）。用于 TTS（走后端，规避 CORS + 截断）。
 * 一个供应商可声明多种能力（capabilities），对齐 Toonflow「一个 vendor 覆盖多类」。
 */

export type VideoProviderKind = 'fal' | 'custom-http'
export type MediaCapability = 'video' | 'music' | 'tts'
export type MediaMode = 'async-poll' | 'sync-binary'

export interface MediaProviderConfig {
  id: string
  kind: VideoProviderKind
  label: string
  // 能力与调用模式（旧数据缺省时归一化为 video + async-poll）
  capabilities?: MediaCapability[]
  mode?: MediaMode
  // fal：model 为 fal 模型路径（如 fal-ai/kling-video/v1/standard/image-to-video）
  // sync-binary(TTS)：model 为语音模型（如 tts-1）
  model?: string
  // 通用：自定义端点（sync-binary 用 baseURL，如 https://api.openai.com/v1）
  baseURL?: string
  headers?: Record<string, string>
  // custom-http(async-poll)：模板
  submitUrl?: string
  pollUrl?: string // 可含 {taskId}
  taskIdPath?: string // submit 响应里 taskId 的 JSON 路径
  statusPath?: string // poll 响应里 status 的 JSON 路径
  videoUrlPath?: string // poll 响应里结果地址（视频/音乐）的 JSON 路径
  // TTS（sync-binary）默认音色（节点可覆盖）
  voices?: string[]
  enabled: boolean
}

// 向后兼容别名：历史代码/数据沿用 VideoProviderConfig
export type VideoProviderConfig = MediaProviderConfig

export interface VideoGenRequest {
  prompt: string
  imageUrl?: string // 首帧（data URL 或可访问 URL）
  lastImageUrl?: string // 尾帧（first-last-frame，如 WAN FLF2V / Kling 起止帧）
  duration?: number
  size?: string
}

export type VideoStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface VideoHandle {
  taskId: string
  statusUrl?: string
  resultUrl?: string
}

export interface VideoPollResult {
  status: VideoStatus
  progress?: number
  videoUrl?: string
  error?: string
}

export interface VideoProviderAdapter {
  submit(req: VideoGenRequest, cfg: VideoProviderConfig, apiKey: string): Promise<VideoHandle>
  poll(handle: VideoHandle, cfg: VideoProviderConfig, apiKey: string): Promise<VideoPollResult>
}
