import type { ProviderConfig } from './types'
import { uid } from '../../util'

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
