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

// ===== 供应商模板 =====
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

// toapis 统一：/v1/videos/generations，轮询 GET .../{id} → result.data[0].url，图床上传 file→data.url
const toapis = (over: Partial<ProviderConfig>): ProviderConfig =>
  base({
    submitUrl: 'https://toapis.com/v1/videos/generations',
    pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
    taskIdPath: 'id',
    statusField: 'status',
    videoUrlPath: 'result.data.0.url',
    uploadUrl: 'https://toapis.com/v1/uploads/images',
    uploadField: 'file',
    uploadUrlPath: 'data.url',
    ...over
  })

// 占位说明：{prompt} {model} 必有；{imageUrl}/{lastImageUrl} 为上传后的公网图 URL（配合首帧/尾帧开关）；
// {aspect}/{duration} 取自节点参数；{?x}…{/x} 仅在 x 非空时出现；{?noImage} 仅文生视频时出现。
export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  // —— toapis 视频全系列（按各模型真实请求体差异分家族）——
  {
    id: 'toapis-veo3',
    label: 'toapis · Veo3（首尾帧 image_urls）',
    hint: 'Veo3 转发版。model：veo3.1-fast/quality/lite。时长固定 8s（不读时长滑块）；图生视频走 image_urls=[首,尾] 并自动加 metadata.generation_type=frame。',
    make: () =>
      toapis({
        label: 'toapis Veo3',
        model: 'veo3.1-fast',
        models: ['veo3.1-fast', 'veo3.1-quality', 'veo3.1-lite'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?aspect},"aspect_ratio":"{aspect}"{/aspect}{?imageUrl},"image_urls":["{imageUrl}"{?lastImageUrl},"{lastImageUrl}"{/lastImageUrl}],"metadata":{"generation_type":"frame"}{/imageUrl}}'
      })
  },
  {
    id: 'toapis-veo3-official',
    label: 'toapis · Veo3 官方（size/resolution/metadata 驼峰）',
    hint: 'Veo3 官方版命名特殊：比例字段是 size、resolution 在顶层、音频/尾帧在 metadata 驼峰（generateAudio/lastFrame）。model：Veo3.1-quality-official/fast-official。',
    make: () =>
      toapis({
        label: 'toapis Veo3 官方',
        model: 'Veo3.1-quality-official',
        models: ['Veo3.1-quality-official', 'Veo3.1-fast-official'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?aspect},"size":"{aspect}"{/aspect},"resolution":"1080p","metadata":{"generateAudio":true{?lastImageUrl},"lastFrame":"{lastImageUrl}"{/lastImageUrl}}{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-sora2',
    label: 'toapis · Sora2（duration 4/8/12）',
    hint: 'Sora2。model：sora-2-vvip / sora-2-official。时长枚举 4/8/12；图生视频用 image_urls[首帧]，不支持尾帧。',
    make: () =>
      toapis({
        label: 'toapis Sora2',
        model: 'sora-2-vvip',
        models: ['sora-2-vvip', 'sora-2-official'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect}{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-kling',
    label: 'toapis · Kling v3/v2.6（首尾帧 image_with_roles）',
    hint: 'Kling v3 / v2-6：mode=pro(1080P)，首/尾帧用 image_with_roles(first_frame/last_frame)，音频字段是 audio。时长 v3=3–15、v2.6=5或10。',
    make: () =>
      toapis({
        label: 'toapis Kling',
        model: 'kling-v3',
        models: ['kling-v3', 'kling-v2-6'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}","mode":"pro"{?duration},"duration":{duration}{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect}{?imageUrl},"image_with_roles":[{"url":"{imageUrl}","role":"first_frame"}{?lastImageUrl},{"url":"{lastImageUrl}","role":"last_frame"}{/lastImageUrl}]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-kling-turbo',
    label: 'toapis · Kling 3.0 Turbo（reference_images，无尾帧）',
    hint: 'Kling 3.0 Turbo：图生视频用 reference_images[首帧]，不支持尾帧；resolution 顶层(720p/1080p)；aspect_ratio 仅文生视频生效。时长 3–15。',
    make: () =>
      toapis({
        label: 'toapis Kling Turbo',
        model: 'kling-3.0-turbo',
        models: ['kling-3.0-turbo'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?noImage},"aspect_ratio":"{aspect}"{/noImage},"resolution":"1080p"{?imageUrl},"reference_images":["{imageUrl}"]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-kling-omni',
    label: 'toapis · Kling Omni/O1（metadata.image_list + 占位符）',
    hint: 'Kling v3-omni / video-o1：图走 metadata.image_list(type first_frame/end_frame)，提示词需用 <<<image_1>>> 引用首图、<<<image_2>>> 引用尾图。mode=pro。时长 omni 3–15、o1 3–10。',
    make: () =>
      toapis({
        label: 'toapis Kling Omni',
        model: 'kling-v3-omni',
        models: ['kling-v3-omni', 'kling-video-o1'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}","mode":"pro"{?duration},"duration":{duration}{/duration}{?imageUrl},"metadata":{"image_list":[{"image_url":"{imageUrl}","type":"first_frame"}{?lastImageUrl},{"image_url":"{lastImageUrl}","type":"end_frame"}{/lastImageUrl}]}{/imageUrl}}'
      })
  },
  {
    id: 'toapis-seedance2',
    label: 'toapis · Seedance 2（首尾帧 + 原生音频）',
    hint: 'Seedance 2 / fast / mini：自带原生音频(generate_audio)，首/尾帧用 image_with_roles，resolution 顶层。时长 4–15（mini 为枚举 4/8/10/12/15，且不支持首尾帧与音频）。',
    make: () =>
      toapis({
        label: 'toapis Seedance2',
        model: 'seedance-2',
        models: ['seedance-2', 'seedance-2-fast', 'seedance-2-mini'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect},"resolution":"720p","generate_audio":true{?imageUrl},"image_with_roles":[{"url":"{imageUrl}","role":"first_frame"}{?lastImageUrl},{"url":"{lastImageUrl}","role":"last_frame"}{/lastImageUrl}]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-doubao-seedance',
    label: 'toapis · 豆包 Seedance 1.x（metadata.resolution/audio）',
    hint: '豆包 Seedance：1.5-pro 的 resolution/audio 在 metadata 内、首尾帧 image_with_roles。model 还可填 doubao-seedance-1-0-pro-fast/quality（1.0 的 resolution 在顶层，可在请求体微调）。时长 4–12。',
    make: () =>
      toapis({
        label: 'toapis 豆包Seedance',
        model: 'doubao-seedance-1-5-pro',
        models: ['doubao-seedance-1-5-pro', 'doubao-seedance-1-0-pro-fast', 'doubao-seedance-1-0-pro-quality'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect},"metadata":{"resolution":"720p","audio":true}{?imageUrl},"image_with_roles":[{"url":"{imageUrl}","role":"first_frame"}{?lastImageUrl},{"url":"{lastImageUrl}","role":"last_frame"}{/lastImageUrl}]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-hailuo',
    label: 'toapis · 海螺 Hailuo（尾帧走 metadata.last_frame_image）',
    hint: '海螺 MiniMax：首帧用 image_urls、尾帧用 metadata.last_frame_image（仅 Hailuo-02 支持尾帧）；无 aspect_ratio（比例由首帧决定）；resolution 顶层；时长枚举 6/10（1080P 仅 6s）。',
    make: () =>
      toapis({
        label: 'toapis 海螺',
        model: 'MiniMax-Hailuo-2.3',
        models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration},"resolution":"1080P"{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}{?lastImageUrl},"metadata":{"last_frame_image":"{lastImageUrl}"}{/lastImageUrl}}'
      })
  },
  {
    id: 'toapis-wan',
    label: 'toapis · 通义万相 Wan2.6（聚合，自带音频）',
    hint: 'Wan2.6 / flash（toapis 转发）：image_urls[首帧]，audio 默认开；aspect_ratio 仅文生视频；resolution 顶层；时长枚举 5/10/15。',
    make: () =>
      toapis({
        label: 'toapis 万相',
        model: 'wan2.6',
        models: ['wan2.6', 'wan2.6-flash'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}","resolution":"1080p","audio":true{?duration},"duration":{duration}{/duration}{?noImage},"aspect_ratio":"{aspect}"{/noImage}{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-grok',
    label: 'toapis · Grok 视频（seconds 字符串 + images）',
    hint: 'Grok：时长字段是 seconds（字符串枚举 6/10/15）、图字段是 images。model：grok-video-3 / grok-video-1.5-preview（1.5 仅图生视频）。',
    make: () =>
      toapis({
        label: 'toapis Grok',
        model: 'grok-video-3',
        models: ['grok-video-3', 'grok-video-1.5-preview'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"seconds":"{duration}"{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect}{?imageUrl},"images":["{imageUrl}"]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-vidu',
    label: 'toapis · Vidu Q3（首尾帧 image_urls + 音频）',
    hint: 'Vidu Q3：image_urls=[首,尾]，audio 默认开，resolution 顶层(540p/720p/1080p)。model：viduq3-pro/turbo（图可选）/ viduq3（必须带图）。时长 1–16。',
    make: () =>
      toapis({
        label: 'toapis Vidu',
        model: 'viduq3-pro',
        models: ['viduq3-pro', 'viduq3-turbo', 'viduq3'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect},"resolution":"720p","audio":true{?imageUrl},"image_urls":["{imageUrl}"{?lastImageUrl},"{lastImageUrl}"{/lastImageUrl}]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-gemini-omni',
    label: 'toapis · Gemini Omni Flash',
    hint: 'Gemini Omni Flash：image_urls[首帧]（不支持尾帧；0/1/3 张合法，2 张不支持），resolution 顶层(720P/1080p，1080p 仅 16:9)。时长枚举 4/6/10。',
    make: () =>
      toapis({
        label: 'toapis Gemini Omni',
        model: 'gemini_omni_flash',
        models: ['gemini_omni_flash'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect},"resolution":"720P"{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}'
      })
  },
  {
    id: 'toapis-happyhorse',
    label: 'toapis · HappyHorse',
    hint: 'HappyHorse 1.0：image_urls[首帧]，resolution 顶层(720P/1080P)，aspect_ratio 仅文生视频。时长 3–15。',
    make: () =>
      toapis({
        label: 'toapis HappyHorse',
        model: 'happyhorse-1.0',
        models: ['happyhorse-1.0'],
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?noImage},"aspect_ratio":"{aspect}"{/noImage},"resolution":"1080P"{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}'
      })
  },

  // —— 其它平台 ——
  {
    id: 'volcengine-ark',
    label: '火山方舟 · Seedance/豆包 视频（国内直连）',
    hint: '火山引擎方舟 Ark（人民币）。model 如 doubao-seedance-1-0-lite-i2v-250428，Key 为 Ark API Key（Bearer）。图生视频 image_url 用 data URL 直传。',
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
    label: '阿里百炼 · 通义万相 视频（国内直连）',
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
    hint: '通用：POST /v1/videos/generations → 轮询 GET .../{id} → result.data[0].url。改 submitUrl/pollUrl/model 接同构平台；图字段按平台改 image_urls/images。',
    make: () =>
      toapis({
        label: 'OpenAI兼容视频',
        model: 'sora-2',
        bodyTemplate:
          '{"model":"{model}","prompt":"{prompt}"{?duration},"duration":{duration}{/duration}{?aspect},"aspect_ratio":"{aspect}"{/aspect}{?imageUrl},"image_urls":["{imageUrl}"{?lastImageUrl},"{lastImageUrl}"{/lastImageUrl}]{/imageUrl}}'
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
