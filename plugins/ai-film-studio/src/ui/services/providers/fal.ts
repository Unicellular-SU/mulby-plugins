/**
 * fal.ai 队列适配器（submit → status → result）。
 * 一个 Key 覆盖 Kling / Veo / Sora / Seedance 等；model 为 fal 模型路径。
 * 注意：fal 的 status_url/response_url 由 submit 响应返回，不能从 model 路径重建，需透传。
 */
import { httpJson, getPath, firstString } from './http'
import type { VideoProviderAdapter, VideoGenRequest, VideoProviderConfig, VideoHandle, VideoPollResult } from './types'

const FAL_QUEUE = 'https://queue.fal.run'

function authHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Key ${apiKey}` }
}

function submitUrl(cfg: VideoProviderConfig): string {
  if (cfg.baseURL && cfg.baseURL.trim()) return cfg.baseURL.trim()
  if (!cfg.model) throw new Error('fal 供应商缺少 model（如 fal-ai/kling-video/...）')
  return `${FAL_QUEUE}/${cfg.model.replace(/^\//, '')}`
}

export const falAdapter: VideoProviderAdapter = {
  async submit(req: VideoGenRequest, cfg, apiKey) {
    if (!apiKey) throw new Error('未配置 fal API Key')
    const body: Record<string, unknown> = { prompt: req.prompt }
    if (req.imageUrl) body.image_url = req.imageUrl
    // 尾帧（first-last-frame）：fal 上 Kling/WAN 等以 tail_image_url 接收；不支持的模型会忽略
    if (req.lastImageUrl) body.tail_image_url = req.lastImageUrl
    if (req.duration) body.duration = String(req.duration)
    const res = await httpJson({ url: submitUrl(cfg), method: 'POST', headers: authHeaders(apiKey), body })
    const taskId = firstString(res, ['request_id', 'requestId', 'id'])
    const statusUrl = firstString(res, ['status_url', 'statusUrl'])
    const resultUrl = firstString(res, ['response_url', 'responseUrl'])
    if (!statusUrl) throw new Error('fal 提交失败：未返回 status_url（请检查 model 与 Key）')
    return { taskId, statusUrl, resultUrl }
  },

  async poll(handle: VideoHandle, _cfg, apiKey): Promise<VideoPollResult> {
    if (!handle.statusUrl) return { status: 'failed', error: '缺少 status_url' }
    const s = await httpJson({ url: handle.statusUrl, method: 'GET', headers: authHeaders(apiKey) })
    const status = String(getPath(s, 'status') || '').toUpperCase()
    if (status === 'COMPLETED' || status === 'OK') {
      const resultUrl = handle.resultUrl || handle.statusUrl.replace(/\/status$/, '')
      const r = await httpJson({ url: resultUrl, method: 'GET', headers: authHeaders(apiKey) })
      const videoUrl = firstString(r, [
        'video.url',
        'video',
        'videos.0.url',
        'output.video.url',
        'output.0.url',
        'output.url',
        // 音乐/音频模型（配乐供应商复用同一队列接口）
        'audio.url',
        'audio_file.url',
        'audio.0.url',
        'audio',
        'url',
      ])
      if (!videoUrl) return { status: 'failed', error: '已完成但未找到结果地址（视频/音频）' }
      return { status: 'completed', videoUrl }
    }
    if (status === 'IN_PROGRESS') return { status: 'running' }
    if (status === 'IN_QUEUE' || status === 'QUEUED') return { status: 'queued' }
    if (status === 'FAILED' || status === 'ERROR') {
      return { status: 'failed', error: firstString(s, ['error', 'detail', 'message']) || '生成失败' }
    }
    return { status: 'running' }
  },
}
