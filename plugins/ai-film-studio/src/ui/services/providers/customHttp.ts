/**
 * 通用 custom-http 适配器：用户填 submit/poll URL 与 JSON 路径，兜底任意供应商。
 * 默认路径覆盖常见命名，最小配置（仅 submitUrl + pollUrl + Key）即可工作。
 */
import { httpJson, getPath, firstString } from './http'
import type { VideoProviderAdapter, VideoGenRequest, VideoProviderConfig, VideoHandle, VideoPollResult } from './types'

const DEFAULT_TASKID_PATHS = ['id', 'request_id', 'requestId', 'task_id', 'taskId', 'data.id', 'data.task_id']
const DEFAULT_STATUS_PATHS = ['status', 'state', 'data.status', 'data.state']
const DEFAULT_VIDEO_PATHS = [
  'video_url',
  'videoUrl',
  'video.url',
  'videos.0.url',
  'output.video.url',
  'output.0.url',
  'output.url',
  'data.video_url',
  'result.url',
  'url',
]

function headers(cfg: VideoProviderConfig, apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(cfg.headers || {}),
  }
}

function normStatus(raw: string): VideoPollResult['status'] {
  const s = raw.toLowerCase()
  if (['completed', 'complete', 'succeeded', 'success', 'done', 'finished'].includes(s)) return 'completed'
  if (['failed', 'error', 'errored', 'canceled', 'cancelled'].includes(s)) return 'failed'
  if (['queued', 'pending', 'in_queue', 'starting'].includes(s)) return 'queued'
  return 'running'
}

export const customHttpAdapter: VideoProviderAdapter = {
  async submit(req: VideoGenRequest, cfg, apiKey) {
    if (!cfg.submitUrl) throw new Error('custom-http 供应商缺少 submitUrl')
    const body: Record<string, unknown> = { prompt: req.prompt }
    if (req.imageUrl) body.image_url = req.imageUrl
    if (req.duration) body.duration = req.duration
    if (req.size) body.size = req.size
    const res = await httpJson({ url: cfg.submitUrl, method: 'POST', headers: headers(cfg, apiKey), body })
    const taskId = cfg.taskIdPath
      ? firstString(res, [cfg.taskIdPath])
      : firstString(res, DEFAULT_TASKID_PATHS)
    if (!taskId) throw new Error('custom-http 提交失败：未解析到 taskId（可配置 taskIdPath）')
    const statusUrl = (cfg.pollUrl || cfg.submitUrl).replace('{taskId}', encodeURIComponent(taskId))
    return { taskId, statusUrl }
  },

  async poll(handle: VideoHandle, cfg, apiKey): Promise<VideoPollResult> {
    if (!handle.statusUrl) return { status: 'failed', error: '缺少 pollUrl' }
    const res = await httpJson({ url: handle.statusUrl, method: 'GET', headers: headers(cfg, apiKey) })
    const rawStatus = cfg.statusPath
      ? String(getPath(res, cfg.statusPath) ?? '')
      : firstString(res, DEFAULT_STATUS_PATHS)
    const status = normStatus(rawStatus)
    const videoUrl = cfg.videoUrlPath
      ? firstString(res, [cfg.videoUrlPath])
      : firstString(res, DEFAULT_VIDEO_PATHS)
    if (status === 'completed') {
      if (!videoUrl) return { status: 'failed', error: '已完成但未解析到视频地址（可配置 videoUrlPath）' }
      return { status: 'completed', videoUrl }
    }
    if (status === 'failed') {
      return { status: 'failed', error: firstString(res, ['error', 'message', 'detail']) || '生成失败' }
    }
    // 有些供应商不返回明确 status，但已带 videoUrl
    if (videoUrl) return { status: 'completed', videoUrl }
    return { status }
  },
}
