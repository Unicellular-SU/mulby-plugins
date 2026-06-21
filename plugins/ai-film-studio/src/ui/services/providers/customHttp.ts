/**
 * 通用 custom-http 适配器：用户填 submit/poll URL 与 JSON 路径，兜底任意供应商。
 * 默认路径覆盖常见命名，最小配置（仅 submitUrl + pollUrl + Key）即可工作。
 */
import { httpJson, getPath, firstString } from './http'
import { toapisVideoModel, buildToapisVideoBody } from './toapisModels'
import type { VideoProviderAdapter, VideoGenRequest, VideoProviderConfig, VideoHandle, VideoPollResult } from './types'

const PLUGIN_ID = 'ai-film-studio'

// grok-video 时长只接受 "6"/"10"/"15"（字符串）；把任意时长就近吸附到合法枚举
function grokSeconds(d: number): string {
  if (d <= 8) return '6'
  if (d <= 12) return '10'
  return '15'
}

function parseDataUrl(u: string): { base64: string; mime: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(u)
  if (!m) return null
  return { mime: m[1] || 'image/png', base64: m[2] || '' }
}

// 「仅收公开 URL」的图生视频：把本地帧(data URL)经供应商图床上传换公开 URL；已是 http(s) 则原样。
async function ensurePublicUrl(url: string | undefined, cfg: VideoProviderConfig, apiKey: string): Promise<string | undefined> {
  if (!url || /^https?:\/\//i.test(url)) return url
  if (!cfg.uploadUrl) return url // 无上传端点：原样传（供应商若不支持 base64 会报错）
  const parsed = parseDataUrl(url)
  if (!parsed) return url
  const host = window.mulby?.host
  if (!host?.call) throw new Error('需要上传关键帧但后端 Host 不可用')
  const res = (await host.call(PLUGIN_ID, 'uploadImage', {
    uploadUrl: cfg.uploadUrl,
    apiKey,
    base64: parsed.base64,
    mime: parsed.mime,
    urlPath: cfg.uploadUrlPath,
  })) as { data?: { ok?: boolean; url?: string; error?: string } } | undefined
  const data = res?.data
  if (!data?.ok || !data.url) throw new Error(data?.error || '关键帧上传失败')
  return data.url
}

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

// 渲染请求体模板：先处理条件块 {?key}…{/key}（变量非空才保留），再替换 {key}。
// 字符串变量做 JSON 内部转义（去外层引号），数字原样，便于嵌入任意 JSON 结构。
function renderBodyTemplate(tpl: string, vars: Record<string, string | number | undefined>): Record<string, unknown> {
  let s = tpl
  // 多趟剥离条件块 {?var}…{/var}，支持嵌套（如 image_with_roles 里嵌 lastImageUrl）；最多 6 趟防御不平衡标记
  for (let pass = 0; pass < 6 && /\{\?\w+\}/.test(s); pass++) {
    s = s.replace(/\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g, (_, k: string, inner: string) => {
      const v = vars[k]
      return v !== undefined && v !== null && String(v) !== '' ? inner : ''
    })
  }
  s = s.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k]
    if (v === undefined || v === null) return ''
    if (typeof v === 'number') return String(v)
    return JSON.stringify(String(v)).slice(1, -1)
  })
  try {
    return JSON.parse(s) as Record<string, unknown>
  } catch (e) {
    throw new Error(`请求体模板渲染后不是合法 JSON：${e instanceof Error ? e.message : String(e)}`)
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
    // 配了 uploadUrl 时，把本地帧先上传换公开 URL（仅收 URL 的供应商如 toapis 需要）
    const imageUrl = await ensurePublicUrl(req.imageUrl, cfg, apiKey)
    const lastImageUrl = await ensurePublicUrl(req.lastImageUrl, cfg, apiKey)
    // M18-B/P2-8：原生音频 driving / lipsync 的视频与音频，按需换公开 URL
    const videoUrl = await ensurePublicUrl(req.videoUrl, cfg, apiKey)
    const drivingAudioUrl = await ensurePublicUrl(req.drivingAudioUrl, cfg, apiKey)
    // 原生音频（prompt-only 家族）：对白/SFX 拼进 prompt
    const effPrompt = req.audioMode === 'native' && req.audioPrompt ? `${req.prompt}\n${req.audioPrompt}` : req.prompt
    let body: Record<string, unknown>
    if (!cfg.bodyTemplate?.trim() && toapisVideoModel(cfg.model)) {
      // 已知 toapis 模型：按模型定义自动拼正确 body（画幅/时长/图像字段/音频/分辨率），免手写模板
      body = buildToapisVideoBody(cfg.model as string, { ...req, prompt: effPrompt, imageUrl, lastImageUrl })
    } else if (cfg.bodyTemplate && cfg.bodyTemplate.trim()) {
      // 声明式模板（各家 body 不同，如火山方舟 content[]、通义万相 input{}）
      body = renderBodyTemplate(cfg.bodyTemplate, {
        prompt: effPrompt,
        imageUrl,
        lastImageUrl,
        model: cfg.model,
        duration: req.duration,
        size: req.size,
        aspectRatio: req.aspectRatio, // {aspectRatio}：画幅，如 grok aspect_ratio
        seconds: req.duration != null ? grokSeconds(req.duration) : undefined, // {seconds}：grok 时长枚举 6/10/15
        seed: req.seed, // 模板可用 {seed} / {?seed}…{/seed} 注入
        videoUrl,
        drivingAudioUrl,
        audioMode: req.audioMode,
      })
    } else {
      // 通用默认 body（兜底）
      body = { prompt: effPrompt }
      if (imageUrl) body.image_url = imageUrl
      if (lastImageUrl) body.tail_image_url = lastImageUrl // 尾帧（供应商不支持则忽略）
      if (req.duration) body.duration = req.duration
      if (req.size) body.size = req.size
      if (req.aspectRatio) body.aspect_ratio = req.aspectRatio // 画幅（供应商不支持则忽略）
      if (req.seed != null) body.seed = req.seed // seed 锁定（供应商不支持则忽略）
      if (videoUrl) body.video_url = videoUrl // P2-8 口型同步：被驱动视频
      if (drivingAudioUrl) body.audio_url = drivingAudioUrl // driving / lipsync 音频
      if (req.audioMode === 'native' && cfg.audio?.toggleField) body[cfg.audio.toggleField] = true
      else if (req.audioMode === 'external' && cfg.audio?.toggleField) body[cfg.audio.toggleField] = false
    }
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
