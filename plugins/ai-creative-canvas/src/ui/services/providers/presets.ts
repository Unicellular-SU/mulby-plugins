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

// 内置供应商模板（选模板 + 贴 Key 即用，声明式 bodyTemplate）。借鉴 ai-film-studio，国内可直连的排前。
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
    hint: '阿里云百炼 DashScope（人民币）。model 如 wan2.2-i2v-flash（图生）/对应 t2v 模型。Key 为 DASHSCOPE_API_KEY（Bearer）。图生视频的 img_url 需公网可访问（在「图床上传」里配上传接口）。',
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
    id: 'toapis-sora2',
    label: 'toapis · Sora2（OpenAI 兼容聚合）',
    hint: 'toapis 聚合（OpenAI 兼容，人民币）。model 如 sora-2 / sora-2-vvip。图生视频自动经 toapis 图床上传换公开 URL。',
    make: () =>
      base({
        label: 'toapis Sora2',
        model: 'sora-2',
        submitUrl: 'https://toapis.com/v1/videos/generations',
        pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
        taskIdPath: 'id',
        statusField: 'status',
        videoUrlPath: 'result.data.0.url',
        uploadUrl: 'https://toapis.com/v1/uploads/images',
        uploadUrlPath: 'data.url',
        bodyTemplate: '{"model":"{model}","prompt":"{prompt}"{?imageUrl},"image_urls":["{imageUrl}"{?lastImageUrl},"{lastImageUrl}"{/lastImageUrl}]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-veo3',
    label: 'toapis · Veo3 谷歌视频（OpenAI 兼容聚合）',
    hint: 'toapis 聚合。model 如 veo3.1-fast / veo3；图字段 image_urls。图生视频自动上传换公开 URL。',
    make: () =>
      base({
        label: 'toapis Veo3',
        model: 'veo3.1-fast',
        submitUrl: 'https://toapis.com/v1/videos/generations',
        pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
        taskIdPath: 'id',
        statusField: 'status',
        videoUrlPath: 'result.data.0.url',
        uploadUrl: 'https://toapis.com/v1/uploads/images',
        uploadUrlPath: 'data.url',
        bodyTemplate: '{"model":"{model}","prompt":"{prompt}"{?imageUrl},"image_urls":["{imageUrl}"{?lastImageUrl},"{lastImageUrl}"{/lastImageUrl}]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-seedance2',
    label: 'toapis · Seedance 2（自带原生音频）',
    hint: 'toapis Seedance（即梦，自带同步音频）。model=seedance-2 或 seedance-2-fast；首帧→first_frame。分辨率默认 720p，可在请求体改。',
    make: () =>
      base({
        label: 'toapis Seedance2',
        model: 'seedance-2',
        submitUrl: 'https://toapis.com/v1/videos/generations',
        pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
        taskIdPath: 'id',
        statusField: 'status',
        videoUrlPath: 'result.data.0.url',
        uploadUrl: 'https://toapis.com/v1/uploads/images',
        uploadUrlPath: 'data.url',
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}","resolution":"720p","generate_audio":true{?imageUrl},"image_with_roles":[{"url":"{imageUrl}","role":"first_frame"}{?lastImageUrl},{"url":"{lastImageUrl}","role":"last_frame"}{/lastImageUrl}]{/imageUrl}}'
      })
  },
  {
    id: 'openai-compat-video',
    label: 'OpenAI 兼容视频聚合 · 通用',
    hint: '通用：POST /v1/videos/generations → 轮询 GET .../{id} → result.data[0].url。改 submitUrl/pollUrl/model 接同构平台；图字段按模型可能是 image_urls 或 images。',
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
        uploadUrlPath: 'data.url',
        bodyTemplate: '{"model":"{model}","prompt":"{prompt}"{?imageUrl},"image_urls":["{imageUrl}"{?lastImageUrl},"{lastImageUrl}"{/lastImageUrl}]{/imageUrl}}'
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
