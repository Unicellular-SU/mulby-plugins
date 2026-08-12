import type { ProviderConfig, VideoProviderCapabilities } from './types'

export type ProviderIssueLevel = 'error' | 'warning'

export interface ProviderConfigIssue {
  level: ProviderIssueLevel
  field: string
  message: string
}

export interface ProviderRequestPreview {
  method: 'GET' | 'POST'
  url: string
  headers: Record<string, string>
  body?: unknown
  pollUrl?: string
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function jsonEscape(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

/** 与真实提交链共用的条件模板渲染器，避免“预览能过、实际请求失败”。 */
export function renderProviderTemplate(template: string, vars: Record<string, string | undefined>): string {
  let output = template
  let previous: string
  const condition = /\{\?(\w+)\}([\s\S]*?)\{\/\1\}/g
  do {
    previous = output
    output = output.replace(condition, (_match, key, inner) => (vars[key] ? inner : ''))
  } while (output !== previous)
  return output.replace(/\{(\w+)\}/g, (_match, key) => (vars[key] != null ? jsonEscape(String(vars[key])) : ''))
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean)
  if (!segments.length) return
  let current = target
  for (let index = 0; index < segments.length - 1; index++) {
    const key = segments[index]
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) current[key] = {}
    current = current[key] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values) ? [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))] : []
}

function uniquePositiveNumbers(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(Number).filter((value) => Number.isFinite(value) && value > 0))].sort((a, b) => a - b)
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === 'string')
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
    if (/authorization/i.test(key)) {
      const scheme = value.match(/^([A-Za-z]+)\s+/)?.[1]
      return [key, scheme ? `${scheme} ••••••••` : '••••••••']
    }
    return [key, /api[-_]?key|token|secret|cookie/i.test(key) ? '••••••••' : value]
  }))
}

/** 导入设置时只接受最小可识别结构，避免脏数据污染整个 Provider store。 */
export function isProviderConfigShape(value: unknown): value is ProviderConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<ProviderConfig>
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && (candidate.kind === 'video' || candidate.kind === 'audio')
    && (candidate.type === 'custom-video' || candidate.type === 'openai-tts')
    && typeof candidate.baseURL === 'string'
    && (candidate.headers == null || isStringRecord(candidate.headers))
}

/** 老配置自动从模板/字段推断，新配置的显式声明优先。 */
export function resolveVideoCapabilities(provider: ProviderConfig | null | undefined): Required<Pick<VideoProviderCapabilities, 'textToVideo' | 'imageToVideo' | 'lastFrame' | 'nativeAudio'>> & VideoProviderCapabilities {
  const template = provider?.bodyTemplate || ''
  const explicit = provider?.capabilities || {}
  const inferredImage = /\{imageUrl\}/.test(template) || (!!provider?.imageField && provider.imageMode !== 'none')
  const inferredLastFrame = /\{lastImageUrl\}/.test(template)
  const inferredAudio = /generate_?audio|"audio"\s*:\s*(?:true|1)/i.test(template)
  return {
    textToVideo: explicit.textToVideo ?? true,
    imageToVideo: explicit.imageToVideo ?? inferredImage,
    lastFrame: explicit.lastFrame ?? inferredLastFrame,
    nativeAudio: explicit.nativeAudio ?? inferredAudio,
    aspects: uniqueStrings(explicit.aspects),
    durations: uniquePositiveNumbers(explicit.durations),
    resolutions: uniqueStrings(explicit.resolutions)
  }
}

export function validateProviderConfig(provider: ProviderConfig, rawHeaders?: string): ProviderConfigIssue[] {
  const issues: ProviderConfigIssue[] = []
  const error = (field: string, message: string) => issues.push({ level: 'error', field, message })
  const warning = (field: string, message: string) => issues.push({ level: 'warning', field, message })

  if (!provider.label.trim()) error('label', '请填写 Provider 名称')
  if (rawHeaders?.trim()) {
    try {
      const parsed = JSON.parse(rawHeaders)
      if (!isStringRecord(parsed)) error('headers', '额外请求头必须是键值均为文本的 JSON 对象')
    } catch {
      error('headers', '额外请求头不是合法 JSON')
    }
  }
  if (provider.healthCheckUrl && !httpUrl(provider.healthCheckUrl)) error('healthCheckUrl', '健康检查地址必须是 http/https URL')

  if (provider.type === 'openai-tts') {
    if (!httpUrl(provider.baseURL)) error('baseURL', 'Base URL 必须是完整的 http/https 地址')
    if (!provider.ttsModel?.trim()) error('ttsModel', '请填写 TTS 模型')
    if (!provider.ttsVoice?.trim()) error('ttsVoice', '请填写音色')
    if (!provider.ttsFormat?.trim()) error('ttsFormat', '请填写输出格式')
    return issues
  }

  const templateMode = provider.bodyTemplate != null
  const capabilities = resolveVideoCapabilities(provider)
  if (templateMode) {
    if (!provider.submitUrl || !httpUrl(provider.submitUrl)) error('submitUrl', '提交 URL 必须是完整的 http/https 地址')
    if (provider.pollUrl && !httpUrl(provider.pollUrl.replace('{taskId}', 'task-demo'))) error('pollUrl', '轮询 URL 不是有效地址')
    if (provider.pollUrl && !provider.pollUrl.includes('{taskId}')) error('pollUrl', '轮询 URL 必须包含 {taskId}')
    if (!provider.bodyTemplate?.includes('{prompt}')) error('bodyTemplate', '请求体模板必须包含 {prompt}')
    if (capabilities.imageToVideo && !provider.bodyTemplate?.includes('{imageUrl}')) error('capabilities.imageToVideo', '已启用图生视频，但请求体模板没有 {imageUrl}')
    if (capabilities.lastFrame && !provider.bodyTemplate?.includes('{lastImageUrl}')) error('capabilities.lastFrame', '已启用尾帧，但请求体模板没有 {lastImageUrl}')
    if (!provider.videoUrlPath?.trim()) error('videoUrlPath', '请填写结果 URL 路径')
    try {
      const preview = buildProviderRequestPreview(provider, false)
      if (!preview.body || typeof preview.body !== 'object') error('bodyTemplate', '请求体模板渲染结果必须是 JSON 对象')
    } catch (cause) {
      error('bodyTemplate', cause instanceof Error ? cause.message : '请求体模板无法渲染')
    }
    if (!provider.pollUrl || !provider.taskIdPath) warning('polling', '未完整配置任务 ID 与轮询地址，仅适用于提交接口直接返回结果 URL 的 Provider')
  } else {
    if (!httpUrl(provider.baseURL)) error('baseURL', 'Base URL 必须是完整的 http/https 地址')
    if (!provider.submitPath?.trim()) error('submitPath', '请填写提交路径')
    if (!provider.promptField?.trim()) error('promptField', '请填写提示词字段')
    if (!provider.resultPath?.trim()) error('resultPath', '请填写结果 URL 路径')
    if (capabilities.imageToVideo && (!provider.imageField?.trim() || !provider.imageMode || provider.imageMode === 'none')) error('capabilities.imageToVideo', '已启用图生视频，请配置图片字段并选择 DataURL 或公网 URL 模式')
    if (capabilities.lastFrame) error('capabilities.lastFrame', '字段映射模式暂不支持尾帧；请改用包含 {lastImageUrl} 的请求体模板')
    if (capabilities.imageToVideo && provider.imageMode === 'url' && !provider.uploadUrl?.trim()) error('uploadUrl', '公网 URL 图片模式需要配置图床上传 URL')
    if (!provider.statusPath?.includes('{id}')) warning('statusPath', '轮询路径未包含 {id}，仅适用于同步返回结果的接口')
    if (provider.extraBody?.trim()) {
      try {
        const parsed = JSON.parse(provider.extraBody)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) error('extraBody', '额外请求体必须是 JSON 对象')
      } catch {
        error('extraBody', '额外请求体不是合法 JSON')
      }
    }
  }

  if (!capabilities.textToVideo && !capabilities.imageToVideo) error('capabilities', '至少启用文生视频或图生视频之一')
  if (capabilities.lastFrame && !capabilities.imageToVideo) error('capabilities.lastFrame', '启用尾帧前必须先启用图生视频')
  if (provider.models?.length && !provider.model) warning('model', '尚未选择默认模型，将使用模型清单第一项')
  if (provider.pollIntervalMs != null && provider.pollIntervalMs < 500) warning('pollIntervalMs', '轮询间隔低于 500ms，可能触发服务端限流')
  return issues
}

export function buildProviderRequestPreview(provider: ProviderConfig, hasKey: boolean): ProviderRequestPreview {
  const headers = redactHeaders({
    'Content-Type': 'application/json',
    ...(provider.headers || {}),
    ...(hasKey ? { Authorization: 'Bearer ••••••••' } : {})
  })
  if (provider.type === 'openai-tts') {
    return {
      method: 'POST',
      url: `${provider.baseURL.replace(/\/$/, '')}/audio/speech`,
      headers,
      body: { model: provider.ttsModel || '', voice: provider.ttsVoice || '', input: '示例配音文本', response_format: provider.ttsFormat || 'mp3' }
    }
  }

  const capabilities = resolveVideoCapabilities(provider)
  if (provider.bodyTemplate != null) {
    const rendered = renderProviderTemplate(provider.bodyTemplate, {
      prompt: '示例视频描述',
      model: provider.model || provider.models?.[0] || 'model-id',
      aspect: capabilities.aspects?.[0] || '16:9',
      duration: String(capabilities.durations?.[0] || 5),
      resolution: capabilities.resolutions?.[0] || '720p',
      imageUrl: capabilities.imageToVideo ? 'https://example.invalid/reference.png' : undefined,
      lastImageUrl: capabilities.lastFrame ? 'https://example.invalid/last-frame.png' : undefined,
      noImage: capabilities.imageToVideo ? undefined : '1'
    })
    let body: unknown
    try {
      body = JSON.parse(rendered)
    } catch {
      throw new Error(`请求体模板渲染后不是合法 JSON：${rendered.slice(0, 160)}`)
    }
    return {
      method: 'POST',
      url: provider.submitUrl || '',
      headers,
      body,
      pollUrl: provider.pollUrl?.replace('{taskId}', 'task-demo')
    }
  }

  const body: Record<string, unknown> = {}
  if (provider.extraBody?.trim()) Object.assign(body, JSON.parse(provider.extraBody))
  body.aspect = capabilities.aspects?.[0] || '16:9'
  body.duration = capabilities.durations?.[0] || 5
  if (capabilities.resolutions?.length) body.resolution = capabilities.resolutions[0]
  if (provider.model || provider.models?.[0]) body.model = provider.model || provider.models?.[0]
  setPath(body, provider.promptField || 'prompt', '示例视频描述')
  if (capabilities.imageToVideo && provider.imageField) setPath(body, provider.imageField, 'https://example.invalid/reference.png')
  return {
    method: provider.method || 'POST',
    url: provider.baseURL.replace(/\/$/, '') + (provider.submitPath || ''),
    headers,
    body,
    pollUrl: provider.statusPath
      ? provider.baseURL.replace(/\/$/, '') + provider.statusPath.replace('{id}', 'task-demo')
      : undefined
  }
}
