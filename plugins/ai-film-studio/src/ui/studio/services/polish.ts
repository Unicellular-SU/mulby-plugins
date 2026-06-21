/**
 * Toonflow 式重构 · 阶段5（§3.2）：资产提示词 AI 润色（视觉手册驱动两段式）。
 *
 * 用画风的美术手册（composeArtPrompt：prefix + art_<kind>(_derivative)）作 system，让文本模型把
 * 「名称 + 中文描述」润色成可直接出图的英文提示词，写回 asset.prompt。出图与润色分两步、更可控。
 * 衍生资产取 _derivative 手册（约束面容/身份不变，只叠服化/状态/场景变体）。audio/clip 资产不润色。
 */
import { runText } from '../../services/textEngine'
import { composeArtPrompt, type ArtAssetKind } from '../../services/skillSystem'
import { useGraphStore } from '../../store/graphStore'
import type { Asset, ProjectMeta } from '../../domain/types'

const KIND: Partial<Record<Asset['type'], ArtAssetKind>> = { role: 'character', scene: 'scene', prop: 'prop' }

// 手册缺失时的兜底约束（保证最低生效，见 §3.2 缺失兜底）
const FALLBACK_SYS =
  '你是 AI 绘画提示词工程师。把给定角色/场景/物品的中文描述润色成一条结构清晰、细节丰富的英文图像生成提示词，' +
  '覆盖外貌/材质/光影/镜头/风格关键词。只输出提示词正文，不要解释、不要引号。'
const DERIVATIVE_NOTE = '这是某资产的【衍生变体】：保持原始面容/身份/体型不变，只改变服装/状态/场景等描述要求的部分。'

export async function polishAssetPrompt(asset: Asset, meta: ProjectMeta): Promise<string> {
  const kind = KIND[asset.type]
  if (!kind) throw new Error('该类型资产（音色/片段）无需润色')
  const model = useGraphStore.getState().selectedModel
  if (!model) throw new Error('未配置文本模型（请在「模型」里选择文本模型）')
  const isDeriv = !!asset.parentAssetId
  const manual = composeArtPrompt(meta.artStyle, kind, { derivative: isDeriv })
  const system = [manual || FALLBACK_SYS, isDeriv ? DERIVATIVE_NOTE : ''].filter(Boolean).join('\n\n')
  const user = `名称：${asset.name}\n描述：${asset.desc || asset.name}\n画风：${meta.artStyle}\n画幅：${meta.videoRatio}\n请输出英文图像生成提示词。`
  const { content } = await runText({ model, system, user })
  return content.trim()
}
