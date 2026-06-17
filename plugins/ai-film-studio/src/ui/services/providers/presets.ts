/**
 * 媒体供应商预设：选预设 + 贴 Key 即用（声明式，安全，免写代码）。
 * 对齐 Toonflow 的「每供应商一个适配器」，但用声明式配置而非可执行 TS（沙箱更安全）。
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
    id: 'fal-video',
    label: 'fal · 视频（Kling / Veo / Sora / Seedance…）',
    hint: '一个 fal Key 覆盖多模型；model 填 fal 模型路径，I2V 用 image-to-video、T2V 用 text-to-video。',
    config: {
      kind: 'fal',
      capabilities: ['video'],
      mode: 'async-poll',
      label: 'fal 视频',
      model: 'fal-ai/kling-video/v1/standard/image-to-video',
    },
  },
  {
    id: 'fal-music',
    label: 'fal · 配乐/音乐',
    hint: 'fal 音乐模型（返回音频地址，已适配音频 url 解析）；model 填 fal 音乐模型路径。',
    config: { kind: 'fal', capabilities: ['music'], mode: 'async-poll', label: 'fal 配乐', model: '' },
  },
  {
    id: 'openai-tts',
    label: 'OpenAI 兼容 · 语音 TTS（同步）',
    hint: '同步 /audio/speech 返回音频字节（走后端，规避 CORS）；baseURL 如 https://api.openai.com/v1。',
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
    id: 'custom-video',
    label: '自定义 HTTP · 视频（异步）',
    hint: '填 submit/poll URL 与结果 JSON 路径，兜底任意异步视频供应商。',
    config: { kind: 'custom-http', capabilities: ['video'], mode: 'async-poll', label: '自定义视频' },
  },
  {
    id: 'custom-music',
    label: '自定义 HTTP · 音乐（异步）',
    hint: '同自定义视频，结果路径指向音频地址（videoUrlPath 填音频 url 路径）。',
    config: { kind: 'custom-http', capabilities: ['music'], mode: 'async-poll', label: '自定义配乐' },
  },
]
