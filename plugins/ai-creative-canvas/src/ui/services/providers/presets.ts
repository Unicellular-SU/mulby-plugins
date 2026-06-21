import type { ProviderConfig } from './types'
import { uid } from '../../util'

// 空白工厂（手动从零配置）
export function presetOpenAiTts(): ProviderConfig {
  return {
    id: uid('prov'),
    label: 'OpenAI 兼容 TTS',
    kind: 'audio',
    type: 'openai-tts',
    baseURL: 'https://api.openai.com/v1',
    ttsModel: 'tts-1',
    ttsVoice: 'alloy',
    ttsFormat: 'mp3'
  }
}

export function presetCustomVideo(): ProviderConfig {
  return {
    id: uid('prov'),
    label: '自定义视频（异步）',
    kind: 'video',
    type: 'custom-video',
    baseURL: 'https://api.example.com',
    submitPath: '/v1/video/generations',
    method: 'POST',
    promptField: 'prompt',
    imageField: 'image_url',
    imageMode: 'none',
    extraBody: '',
    idPath: 'id',
    statusPath: '/v1/video/generations/{id}',
    statusField: 'status',
    doneValues: 'completed,succeeded,success',
    failValues: 'failed,error,cancelled',
    resultPath: 'data.0.url',
    pollIntervalMs: 2000,
    timeoutMs: 600000
  }
}

// toapis 视频全系列（统一 /v1/videos/generations，OpenAI 兼容；选 model 即可切换）
export const TOAPIS_VIDEO_MODELS = [
  'veo3.1-fast',
  'veo3.1-quality',
  'veo3.1-lite',
  'sora-2',
  'sora-2-vvip',
  'seedance-2',
  'seedance-2-fast',
  'seedance-2-mini',
  'doubao-seedance-1-5',
  'doubao-seedance',
  'kling-v3',
  'kling-v3-omni',
  'kling-3.0-turbo',
  'kling-2-6',
  'kling-video-o1',
  'minimax-hailuo-2.3',
  'minimax-hailuo',
  'wan2.6',
  'wan2.6-flash',
  'grok-video',
  'grok-video-1.5-preview',
  'viduq3',
  'gemini-omni-flash',
  'happyhorse'
]

// 通用请求体：model/prompt + 可选 aspect_ratio/duration + image_urls(首/尾帧)
const TOAPIS_BODY =
  '{"model":"{model}","prompt":"{prompt}"{?aspect},"aspect_ratio":"{aspect}"{/aspect}{?duration},"duration":{duration}{/duration}{?imageUrl},"image_urls":["{imageUrl}"{?lastImageUrl},"{lastImageUrl}"{/lastImageUrl}]{/imageUrl}}'

// 内置供应商模板（选模板 + 贴 Key 即用）。借鉴 ai-film-studio + 按 toapis 文档接入视频全系列。
export interface ProviderTemplate {
  id: string
  label: string
  hint: string
  make: () => ProviderConfig
}

const base = (over: Partial<ProviderConfig>): ProviderConfig => ({
  id: uid('prov'),
  label: '视频',
  kind: 'video',
  type: 'custom-video',
  baseURL: '',
  pollIntervalMs: 3000,
  timeoutMs: 600000,
  failValues: 'failed,error,cancelled',
  ...over
})

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'toapis-video',
    label: 'toapis · 视频全系列（Sora/Veo/Kling/Seedance/海螺/万相…）',
    hint: 'toapis 聚合（OpenAI 兼容，人民币）。Key=toapis Key（Bearer）。统一 /v1/videos/generations，选 model 即切换模型；图生视频自动经 toapis 图床上传换公开 URL；首帧/尾帧用 image_urls=[首,尾]。',
    make: () =>
      base({
        label: 'toapis 视频',
        model: 'veo3.1-fast',
        models: TOAPIS_VIDEO_MODELS,
        submitUrl: 'https://toapis.com/v1/videos/generations',
        pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
        taskIdPath: 'id',
        statusField: 'status',
        videoUrlPath: 'result.data.0.url',
        uploadUrl: 'https://toapis.com/v1/uploads/images',
        uploadField: 'file',
        uploadUrlPath: 'data.url',
        bodyTemplate: TOAPIS_BODY
      })
  },
  {
    id: 'volcengine-ark',
    label: '火山方舟 · Seedance/豆包 视频（国内）',
    hint: '火山引擎方舟 Ark（人民币）。model 填模型 ID（如 doubao-seedance-1-0-lite-i2v-250428），Key 为 Ark API Key（Bearer）。图生视频 image_url 用 data URL 直传。',
    make: () =>
      base({
        label: '火山方舟视频',
        model: 'doubao-seedance-1-0-lite-i2v-250428',
        submitUrl: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
        pollUrl: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{taskId}',
        taskIdPath: 'id',
        statusField: 'status',
        videoUrlPath: 'content.video_url',
        bodyTemplate: '{"model":"{model}","content":[{"type":"text","text":"{prompt}"}{?imageUrl},{"type":"image_url","image_url":{"url":"{imageUrl}"}}{/imageUrl}]}'
      })
  },
  {
    id: 'dashscope-wan',
    label: '阿里百炼 · 通义万相 视频（国内）',
    hint: '阿里云百炼 DashScope（人民币）。model 如 wan2.2-i2v-flash。Key 为 DASHSCOPE_API_KEY（Bearer）。图生视频的 img_url 需公网可访问（在「图床上传」里配上传接口）。',
    make: () =>
      base({
        label: '通义万相视频',
        model: 'wan2.2-i2v-flash',
        submitUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
        pollUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks/{taskId}',
        headers: { 'X-DashScope-Async': 'enable' },
        taskIdPath: 'output.task_id',
        statusField: 'output.task_status',
        videoUrlPath: 'output.video_url',
        bodyTemplate: '{"model":"{model}","input":{"prompt":"{prompt}"{?imageUrl},"img_url":"{imageUrl}"{/imageUrl}},"parameters":{}}'
      })
  },
  {
    id: 'openai-compat-video',
    label: 'OpenAI 兼容视频聚合 · 通用（自定义平台）',
    hint: '通用：POST /v1/videos/generations → 轮询 GET .../{id} → result.data[0].url。改 submitUrl/pollUrl/model 接同构平台。',
    make: () =>
      base({
        label: 'OpenAI兼容视频',
        model: 'sora-2',
        submitUrl: 'https://toapis.com/v1/videos/generations',
        pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
        taskIdPath: 'id',
        statusField: 'status',
        videoUrlPath: 'result.data.0.url',
        uploadUrl: 'https://toapis.com/v1/uploads/images',
        uploadField: 'file',
        uploadUrlPath: 'data.url',
        bodyTemplate: TOAPIS_BODY
      })
  },
  {
    id: 'openai-tts',
    label: '语音 TTS · OpenAI 兼容（含国内中转）',
    hint: '同步 /audio/speech 返回音频字节（走后端规避 CORS）。baseURL 填 OpenAI 或国内中转地址。',
    make: () => ({
      id: uid('prov'),
      label: 'OpenAI 语音',
      kind: 'audio',
      type: 'openai-tts',
      baseURL: 'https://api.openai.com/v1',
      ttsModel: 'tts-1',
      ttsVoice: 'alloy',
      ttsFormat: 'mp3'
    })
  }
]
