/**
 * Toonflow 式重构 · 阶段8（§3.4）：音色库 + 角色↔音色 AI 匹配。
 *
 * 复用现有 tts.synthSpeech（OpenAI 兼容 /audio/speech，后端落盘）+ providerStore 的 tts 供应商。
 * 音色 = type:'audio' 资产（name 展示 / voice 供应商音色 id / desc 用于 AI 匹配 / audioFilePath 试听）。
 * 合成注入成片（§5.5）因 ffmpeg AudioTrack 暂无时间偏移，留待阶段10（需 AudioTrack 加 start 或按段拼接）。
 */
import { synthSpeech } from '../../services/tts'
import { runText } from '../../services/textEngine'
import { useProviderStore } from '../../store/providerStore'
import { useGraphStore } from '../../store/graphStore'

/** 当前默认 tts 供应商可选音色 id 列表 */
export function listProviderVoices(): string[] {
  return useProviderStore.getState().getActiveFor('tts')?.voices ?? []
}

/** 合成一段试听音频（落盘），返回本地路径 + base64。voice=供应商音色 id。 */
export async function synthVoiceSample(text: string, voice: string): Promise<{ path: string; base64: string; mime: string }> {
  const ps = useProviderStore.getState()
  const provider = ps.getActiveFor('tts')
  if (!provider) throw new Error('未配置配音(TTS)供应商：请在设置抽屉添加 tts 供应商并设为默认')
  const apiKey = await ps.resolveKey(provider.id)
  if (!apiKey && provider.kind === 'fal') throw new Error('该配音供应商未配置 API Key')
  return synthSpeech(text?.trim() || '你好，这是音色试听。', {
    baseURL: String(provider.baseURL || 'https://api.openai.com/v1'),
    apiKey,
    model: String(provider.model || 'tts-1'),
    voice: voice || provider.voices?.[0] || 'alloy',
    speed: 1,
    format: 'mp3',
  })
}

/** AI 配音匹配：给角色挑最契合的音色，返回 {roleId, voiceAssetId}[]（替代 Toonflow resultTool） */
export async function matchRoleVoices(
  roles: { id: string; name: string; desc?: string }[],
  voices: { id: string; name: string; desc?: string }[]
): Promise<{ roleId: string; voiceAssetId: string }[]> {
  if (!roles.length || !voices.length) return []
  const model = useGraphStore.getState().selectedModel
  if (!model) throw new Error('未配置文本模型（请在「模型」里选择）')
  const system = '你是选角配音导演。给定角色与候选音色，为每个角色挑选最契合的音色。只输出 JSON：{"map":[{"roleId":"","voiceAssetId":""}]}，不要多余文字。'
  const user =
    `角色：\n${roles.map((r) => `- id=${r.id} 名=${r.name}${r.desc ? ` 描述=${r.desc}` : ''}`).join('\n')}\n\n` +
    `候选音色：\n${voices.map((v) => `- id=${v.id} 名=${v.name}${v.desc ? ` 描述=${v.desc}` : ''}`).join('\n')}`
  const { content } = await runText({ model, system, user, jsonMode: true })
  try {
    let s = content.trim()
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(s)
    if (fence) s = fence[1].trim()
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a >= 0 && b > a) s = s.slice(a, b + 1)
    const obj = JSON.parse(s) as { map?: { roleId: string; voiceAssetId: string }[] }
    return Array.isArray(obj.map) ? obj.map.filter((m) => m && m.roleId && m.voiceAssetId) : []
  } catch {
    return []
  }
}
