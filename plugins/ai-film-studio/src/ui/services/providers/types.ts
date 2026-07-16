/**
 * 媒体供应商抽象：Mulby 不提供视频/音乐/语音模型，由插件经 mulby.http 自管。
 * 两种调用模式：
 *  - async-poll：统一异步三段式 submit → poll →（completed 后取结果 URL）。用于视频 / 音乐。
 *  - sync-binary：单次请求直接返回音频二进制（OpenAI 兼容 /audio/speech）。用于 TTS（走后端，规避 CORS + 截断）。
 * 一个供应商可声明多种能力（capabilities），对齐 Toonflow「一个 vendor 覆盖多类」。
 */

export type VideoProviderKind = 'fal' | 'custom-http'
export type MediaCapability =
  | 'video'
  | 'music'
  | 'tts'
  | 'nativeAudio' // 视频生成同一前向产出对白/SFX/ambient（Veo3 / Sora2 / Kling Omni / …）
  | 'lipsync' // 把外置音频驱动到既有视频（Sync.so / Wav2Lip / Runway Act-Two）
export type MediaMode = 'async-poll' | 'sync-binary'

// 供应商音频能力描述符（全部可选；旧数据缺省=纯无声视频，安全）
export interface ProviderAudioControl {
  // 开关字段名：'generate_audio'(fal veo) / 'audio'(kling) / '' 表示 prompt-only（官方 Veo/Sora 无开关）
  toggleField?: string
  drivingAudioField?: string // driving-audio 家族：把外置音频 URL 喂入的字段（Wan input.audio_url 等）
  acceptsDrivingAudio?: boolean
  supportsMultiSpeaker?: boolean // 是否支持多角色对白（prompt 内 speaker 标注）
  supportedLangs?: string[] // 口型同步语种
  maxDurationSec?: number // 原生音频段上限（Veo 8s / Kling 15s）
  costMultiplier?: number // 带声相对无声的费用倍率
}

export interface MediaProviderConfig {
  id: string
  kind: VideoProviderKind
  label: string
  // 能力与调用模式（旧数据缺省时归一化为 video + async-poll）
  capabilities?: MediaCapability[]
  mode?: MediaMode
  // fal：model 为 fal 模型路径（如 fal-ai/kling-video/v1/standard/image-to-video）
  // sync-binary(TTS)：model 为语音模型（如 tts-1）
  model?: string
  // 通用：自定义端点（sync-binary 用 baseURL，如 https://api.openai.com/v1）
  baseURL?: string
  headers?: Record<string, string>
  // custom-http(async-poll)：模板
  submitUrl?: string
  pollUrl?: string // 可含 {taskId}
  taskIdPath?: string // submit 响应里 taskId 的 JSON 路径
  statusPath?: string // poll 响应里 status 的 JSON 路径
  videoUrlPath?: string // poll 响应里结果地址（视频/音乐）的 JSON 路径
  // 请求体模板（声明式，适配各家不同 body）：{prompt}{imageUrl}{lastImageUrl}{model}{duration}{size}
  // 支持条件块 {?imageUrl}…{/imageUrl}（变量非空才保留），留空则用通用默认 body
  bodyTemplate?: string
  // 图片上传端点（multipart/form-data，field=file）：用于「仅收公开图片 URL」的图生视频——
  // 本地关键帧(data URL)先经此上传换公开 URL 再提交。结果 URL 默认取 data.url（可配 uploadUrlPath）
  uploadUrl?: string
  uploadUrlPath?: string
  // TTS（sync-binary）默认音色（节点可覆盖）
  voices?: string[]
  // 音频能力描述符（nativeAudio/lipsync 供应商用；缺省=纯无声视频）
  audio?: ProviderAudioControl
  enabled: boolean
}

// 向后兼容别名：历史代码/数据沿用 VideoProviderConfig
export type VideoProviderConfig = MediaProviderConfig

export interface VideoGenRequest {
  prompt: string
  imageUrl?: string // 首帧（data URL 或可访问 URL）
  lastImageUrl?: string // 尾帧（first-last-frame，如 WAN FLF2V / Kling 起止帧）
  referenceImages?: VideoReferenceImage[]
  duration?: number
  size?: string
  aspectRatio?: string // 画幅 16:9 / 9:16 / 1:1（toapis grok 等用 aspect_ratio；不传时供应商常默认竖屏 9:16）
  seed?: number // seed 锁定：整段片段共用同一 seed，跨片段风格/运动更一致（供应商不支持则忽略）
  // 双轨音频（M18-B，全可选）
  audioMode?: 'native' | 'external' | 'silent' // native=模型自带声；external=无声生成留待外置合成；silent=纯无声
  audioPrompt?: string // 拼好的对白/SFX/ambient 文本（prompt-only 家族用）
  dialogue?: { speaker: string; line: string; emotion?: string }[] // 结构化对白（带 speaker 标注的家族用）
  drivingAudioUrl?: string // driving-audio 家族（Wan/Seedance）/ lipsync：把音频 URL 喂入
  videoUrl?: string // P2-8 lipsync：被驱动的视频/静帧 URL
}

export interface VideoReferenceImage {
  url: string
  name?: string
  type?: string
  source?: 'asset' | 'storyboard' | 'frame'
}

export type VideoStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface VideoHandle {
  taskId: string
  statusUrl?: string
  resultUrl?: string
}

export interface VideoPollResult {
  status: VideoStatus
  progress?: number
  videoUrl?: string
  error?: string
}

export interface VideoProviderAdapter {
  submit(req: VideoGenRequest, cfg: VideoProviderConfig, apiKey: string): Promise<VideoHandle>
  poll(handle: VideoHandle, cfg: VideoProviderConfig, apiKey: string): Promise<VideoPollResult>
}
