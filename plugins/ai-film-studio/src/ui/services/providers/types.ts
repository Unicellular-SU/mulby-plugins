/**
 * 视频供应商抽象：统一异步三段式 submit → poll →（completed 后取 videoUrl）。
 * Mulby 不提供视频模型，由插件经 mulby.http 自管。MVP 内置 fal + custom-http。
 */

export type VideoProviderKind = 'fal' | 'custom-http'

export interface VideoProviderConfig {
  id: string
  kind: VideoProviderKind
  label: string
  // fal：model 为 fal 模型路径（如 fal-ai/kling-video/v1/standard/image-to-video）
  model?: string
  // 通用：自定义端点
  baseURL?: string
  headers?: Record<string, string>
  // custom-http：模板
  submitUrl?: string
  pollUrl?: string // 可含 {taskId}
  taskIdPath?: string // submit 响应里 taskId 的 JSON 路径
  statusPath?: string // poll 响应里 status 的 JSON 路径
  videoUrlPath?: string // poll 响应里视频地址的 JSON 路径
  enabled: boolean
}

export interface VideoGenRequest {
  prompt: string
  imageUrl?: string // 首帧（data URL 或可访问 URL）
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
