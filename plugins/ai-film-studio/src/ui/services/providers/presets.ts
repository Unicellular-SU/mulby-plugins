/**
 * 媒体供应商预设：选预设 + 贴 Key 即用（声明式，安全，免写代码）。
 * 对齐 Toonflow 的「每供应商一个适配器」，但用声明式配置（含请求体模板）而非可执行 TS（沙箱更安全）。
 * 国内可直连/人民币充值的供应商排在前。
 */
import type { MediaProviderConfig } from './types'

export interface ProviderPreset {
  id: string
  label: string
  hint: string
  config: Partial<MediaProviderConfig>
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'volcengine-ark',
    label: '火山方舟 · Seedance / 豆包 视频（国内）',
    hint: '火山引擎方舟 Ark（人民币）。model 填模型 ID（如 doubao-seedance-1-0-lite-i2v-250428），Key 为 Ark API Key（Bearer）。提示词里可带 --resolution 720p --duration 5。',
    config: {
      kind: 'custom-http',
      capabilities: ['video'],
      mode: 'async-poll',
      label: '火山方舟视频',
      model: 'doubao-seedance-1-0-lite-i2v-250428',
      submitUrl: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
      pollUrl: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{taskId}',
      taskIdPath: 'id',
      statusPath: 'status',
      videoUrlPath: 'content.video_url',
      bodyTemplate:
        '{"model":"{model}","content":[{"type":"text","text":"{prompt}"}{?imageUrl},{"type":"image_url","image_url":{"url":"{imageUrl}"}}{/imageUrl}]}',
    },
  },
  {
    id: 'dashscope-wan',
    label: '阿里百炼 · 通义万相 视频（国内）',
    hint: '阿里云百炼 DashScope（人民币）。model 填万相模型（图生视频如 wan2.2-i2v-flash；文生视频用对应 t2v 模型），Key 为 DASHSCOPE_API_KEY（Bearer）。',
    config: {
      kind: 'custom-http',
      capabilities: ['video'],
      mode: 'async-poll',
      label: '通义万相视频',
      model: 'wan2.2-i2v-flash',
      submitUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis',
      pollUrl: 'https://dashscope.aliyuncs.com/api/v1/tasks/{taskId}',
      headers: { 'X-DashScope-Async': 'enable' },
      taskIdPath: 'output.task_id',
      statusPath: 'output.task_status',
      videoUrlPath: 'output.video_url',
      bodyTemplate:
        '{"model":"{model}","input":{"prompt":"{prompt}"{?imageUrl},"img_url":"{imageUrl}"{/imageUrl}},"parameters":{}}',
    },
  },
  {
    id: 'aggregator-video',
    label: '聚合平台 · 视频（302.AI / 云雾 / 硅基流动…）',
    hint: '聚合平台转发各家原生 API（人民币、国内可用，可拿到可灵/海螺/Seedance/Veo 等）。按平台文档填 submit/poll URL、请求体模板与结果 JSON 路径；Key=平台 Key（Bearer）。',
    config: { kind: 'custom-http', capabilities: ['video'], mode: 'async-poll', label: '聚合视频' },
  },
  {
    id: 'aggregator-music',
    label: '聚合平台 · 音乐/配乐',
    hint: '同上，结果路径指向音频地址（videoUrlPath 填 audio url 路径）。',
    config: { kind: 'custom-http', capabilities: ['music'], mode: 'async-poll', label: '聚合配乐' },
  },
  // —— OpenAI 兼容视频聚合（toapis：统一 /v1/videos/generations 提交 + 轮询 + result.data[0].url）——
  {
    id: 'toapis-sora2',
    label: 'toapis · Sora2（OpenAI 兼容聚合）',
    hint: 'toapis 聚合（OpenAI 兼容）。model 如 sora-2 / sora-2-vvip；Key=toapis Key（Bearer）。文生视频开箱即用；图生视频会自动把关键帧经 toapis 图床上传换公开 URL，无需手动托管。',
    config: {
      kind: 'custom-http',
      capabilities: ['video'],
      mode: 'async-poll',
      label: 'toapis Sora2',
      model: 'sora-2',
      submitUrl: 'https://toapis.com/v1/videos/generations',
      pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
      taskIdPath: 'id',
      statusPath: 'status',
      videoUrlPath: 'result.data.0.url',
      uploadUrl: 'https://toapis.com/v1/uploads/images',
      uploadUrlPath: 'data.url',
      bodyTemplate: '{"model":"{model}","prompt":"{prompt}"{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}',
    },
  },
  {
    id: 'toapis-veo3',
    label: 'toapis · Veo3 谷歌视频（OpenAI 兼容聚合）',
    hint: 'toapis 聚合。model 如 veo3.1-fast / veo3；body 同 Sora2（image_urls）。图生视频自动上传关键帧换公开 URL。',
    config: {
      kind: 'custom-http',
      capabilities: ['video'],
      mode: 'async-poll',
      label: 'toapis Veo3',
      model: 'veo3.1-fast',
      submitUrl: 'https://toapis.com/v1/videos/generations',
      pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
      taskIdPath: 'id',
      statusPath: 'status',
      videoUrlPath: 'result.data.0.url',
      uploadUrl: 'https://toapis.com/v1/uploads/images',
      uploadUrlPath: 'data.url',
      bodyTemplate: '{"model":"{model}","prompt":"{prompt}"{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}',
    },
  },
  {
    id: 'toapis-grok',
    label: 'toapis · Grok 视频（OpenAI 兼容聚合）',
    hint: 'toapis 聚合。model=grok-video-3；图字段用 images（注意与 Sora2/Veo3 的 image_urls 不同）。图生视频自动上传关键帧换公开 URL。',
    config: {
      kind: 'custom-http',
      capabilities: ['video'],
      mode: 'async-poll',
      label: 'toapis Grok',
      model: 'grok-video-3',
      submitUrl: 'https://toapis.com/v1/videos/generations',
      pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
      taskIdPath: 'id',
      statusPath: 'status',
      videoUrlPath: 'result.data.0.url',
      uploadUrl: 'https://toapis.com/v1/uploads/images',
      uploadUrlPath: 'data.url',
      // grok-video-3：aspect_ratio(16:9/9:16/3:2/2:3/1:1) + seconds(6/10/15 字符串) + images（与 Sora2/Veo3 的 image_urls 不同）
      bodyTemplate:
        '{"model":"{model}","prompt":"{prompt}"{?aspectRatio},"aspect_ratio":"{aspectRatio}"{/aspectRatio}{?seconds},"seconds":"{seconds}"{/seconds}{?imageUrl},"images":["{imageUrl}"]{/imageUrl}}',
    },
  },
  {
    id: 'toapis-seedance',
    label: 'toapis · Seedance 2（原生音频 / 首尾帧）',
    hint: 'toapis Seedance（豆包即梦，自带原生音频）。model=seedance-2 或 seedance-2-fast（fast 不支持 1080p）；Key=toapis Key（Bearer）。用 image_with_roles 提交首/尾帧：关键帧→first_frame，下一关键帧→last_frame，自动经 toapis 图床换公开 URL。generate_audio=true 时模型直接生成同步音频；分辨率默认 720p，可在请求体改 480p/1080p。',
    config: {
      kind: 'custom-http',
      capabilities: ['video', 'nativeAudio'],
      mode: 'async-poll',
      label: 'toapis Seedance 2',
      model: 'seedance-2',
      submitUrl: 'https://toapis.com/v1/videos/generations',
      pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
      taskIdPath: 'id',
      statusPath: 'status',
      videoUrlPath: 'result.data.0.url',
      uploadUrl: 'https://toapis.com/v1/uploads/images',
      uploadUrlPath: 'data.url',
      audio: { toggleField: 'generate_audio' },
      // 多模态：image_with_roles(首/尾帧) + video_with_roles(参考视频) + audio_with_roles(参考音频/配乐)，按需出现
      bodyTemplate:
        '{"model":"{model}","prompt":"{prompt}","resolution":"720p","generate_audio":true{?duration},"duration":{duration}{/duration}{?imageUrl},"image_with_roles":[{"url":"{imageUrl}","role":"first_frame"}{?lastImageUrl},{"url":"{lastImageUrl}","role":"last_frame"}{/lastImageUrl}]{/imageUrl}{?videoUrl},"video_with_roles":[{"url":"{videoUrl}","role":"reference_video"}]{/videoUrl}{?drivingAudioUrl},"audio_with_roles":[{"url":"{drivingAudioUrl}","role":"reference_audio"}]{/drivingAudioUrl}}',
    },
  },
  {
    id: 'openai-compat-video',
    label: 'OpenAI 兼容视频聚合 · 通用（自定义平台/模型）',
    hint: '通用：POST /v1/videos/generations → 轮询 GET .../{id} → result.data[0].url。改 baseURL/submitUrl 接同构平台，model 填任意（sora-2 / veo3.1-fast / grok-video-3 / kling-… / 含 Omni 等）。图生视频自动经「图片上传地址」换公开 URL（默认 toapis 图床，换平台请同步改）。请求体字段名按模型调整（image_urls vs images）。',
    config: {
      kind: 'custom-http',
      capabilities: ['video'],
      mode: 'async-poll',
      label: 'OpenAI兼容视频',
      model: 'sora-2',
      submitUrl: 'https://toapis.com/v1/videos/generations',
      pollUrl: 'https://toapis.com/v1/videos/generations/{taskId}',
      taskIdPath: 'id',
      statusPath: 'status',
      videoUrlPath: 'result.data.0.url',
      uploadUrl: 'https://toapis.com/v1/uploads/images',
      uploadUrlPath: 'data.url',
      bodyTemplate: '{"model":"{model}","prompt":"{prompt}"{?imageUrl},"image_urls":["{imageUrl}"]{/imageUrl}}',
    },
  },
  {
    id: 'openai-tts',
    label: '语音 TTS · OpenAI 兼容（含国内中转）',
    hint: '同步 /audio/speech 返回音频字节（走后端规避 CORS）。baseURL 填 OpenAI 或国内中转地址（如 https://api.openai.com/v1）。',
    config: {
      kind: 'custom-http',
      capabilities: ['tts'],
      mode: 'sync-binary',
      label: 'OpenAI 语音',
      baseURL: 'https://api.openai.com/v1',
      model: 'tts-1',
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
    },
  },
  {
    id: 'fal-video',
    label: 'fal · 视频（海外，需海外支付）',
    hint: 'fal.ai 海外平台（大陆充值受限）；model 填 fal 模型路径。',
    config: { kind: 'fal', capabilities: ['video'], mode: 'async-poll', label: 'fal 视频', model: 'fal-ai/kling-video/v1/standard/image-to-video' },
  },
  {
    id: 'fal-music',
    label: 'fal · 配乐（海外）',
    hint: 'fal 音乐模型（返回音频地址）；model 填 fal 音乐模型路径。',
    config: { kind: 'fal', capabilities: ['music'], mode: 'async-poll', label: 'fal 配乐', model: '' },
  },
]
