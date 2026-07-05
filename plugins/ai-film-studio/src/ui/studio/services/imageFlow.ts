/**
 * Toonflow 式重构 · 阶段7（§4.4）：关键帧/资产图二次精修（imageFlow 的多参考图融合）。
 *
 * Toonflow 的 imageFlow 是节点式多参考图合成（upload/generated 节点）。本期落地其核心能力——「选若干参考图 +
 * 提示词 → 合成一张」：用现有 imageEngine.editImage（多参考图融合，= generateFlowImage 等价物），把选中的资产/
 * 关键帧作参考、画风锚定 + 提示词出图，返回新 assetId。节点图编辑（edges）作 P2，先用参考图勾选列表覆盖核心。
 */
import { editImage, generateImage } from '../../services/imageEngine'
import { saveAsset, loadAsset } from '../../services/assets'
import { getStylePack, applyStylePack } from '../../services/stylePacks'
import { useGraphStore } from '../../store/graphStore'
import type { ProjectMeta } from '../../domain/types'

function sizeForRatio(ratio: string): string {
  if (ratio === '9:16') return '768x1344'
  if (ratio === '1:1') return '1024x1024'
  return '1344x768'
}

async function refBase64(assetId: string): Promise<{ base64: string; mime: string } | null> {
  const a = await loadAsset(assetId)
  return a ? { base64: a.base64, mime: a.mime } : null
}

/**
 * 多参考图融合精修：refAssetIds 为选中的参考图（资产库 assetId），prompt 为精修指令。
 * 有参考图 → editImage（首图主参考 + 其余 extraRefs）；无参考图 → 文生图。画风锚定恒附。
 */
export async function runFlowImage(refAssetIds: string[], prompt: string, meta: ProjectMeta): Promise<string> {
  const model = meta.imageModel || useGraphStore.getState().selectedImageModel
  if (!model) throw new Error('未配置图像模型（请在「模型」里选择图像模型）')
  const pack = getStylePack(meta.artStyle)
  const anchor = pack ? applyStylePack(pack, 'keyframe') : ''
  const fullPrompt = [prompt.trim(), anchor].filter(Boolean).join(', ')
  if (!fullPrompt) throw new Error('请填写精修提示词')
  const refs = (await Promise.all(refAssetIds.map((id) => refBase64(id)))).filter(Boolean) as { base64: string; mime: string }[]
  const canEdit = !!window.mulby?.ai?.images?.edit && !!window.mulby?.ai?.attachments?.upload
  if (refs.length && canEdit) {
    const [primary, ...rest] = refs
    const r = await editImage({ model, prompt: fullPrompt, refBase64: primary.base64, refMime: primary.mime, extraRefs: rest })
    return saveAsset(r.base64, r.mime)
  }
  const r = await generateImage({ model, prompt: fullPrompt, size: sizeForRatio(meta.videoRatio) })
  return saveAsset(r.base64, r.mime)
}
