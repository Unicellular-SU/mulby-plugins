/**
 * Toonflow 式重构 · 阶段2d：工作台生成服务——把结构化资产/分镜接到现有图像/视频引擎，
 * 并注入项目画风 Skill（经 stylePacks 锚定）。二进制存资产库，结构里只留 assetId。
 */
import { generateImage, editImage } from '../../services/imageEngine'
import { saveAsset, loadAsset } from '../../services/assets'
import { getStylePack, applyStylePack, type StyleRole } from '../../services/stylePacks'
import { useGraphStore } from '../../store/graphStore'
import type { Asset, ProjectMeta, Storyboard } from '../../domain/types'

/** 图像模型：项目级优先，否则用全局选中的图像模型 */
function imageModel(meta: ProjectMeta): string | null {
  return meta.imageModel || useGraphStore.getState().selectedImageModel
}

function sizeForRatio(ratio: string): string {
  if (ratio === '9:16') return '768x1344'
  if (ratio === '1:1') return '1024x1024'
  return '1344x768'
}

const ASSET_ROLE: Record<Asset['type'], StyleRole> = { role: 'character', scene: 'scene', prop: 'prop' }

/** 生成资产参考图：资产描述 + 画风锚定 → 文生图 → 存资产库，返回 assetId */
export async function generateAssetImage(asset: Asset, meta: ProjectMeta): Promise<string> {
  const model = imageModel(meta)
  if (!model) throw new Error('未配置图像模型（请在「设置」里选择图像模型）')
  const basis = (asset.prompt || asset.desc || asset.name || '').trim()
  if (!basis) throw new Error('请先填写资产名称或描述')
  const pack = getStylePack(meta.artStyle)
  const anchor = pack ? applyStylePack(pack, ASSET_ROLE[asset.type]) : ''
  const prompt = [basis, anchor].filter(Boolean).join(', ')
  const r = await generateImage({ model, prompt, size: sizeForRatio(meta.videoRatio) })
  return saveAsset(r.base64, r.mime)
}

/** 取资产库图片纯 base64（供关键帧 img2img 参考） */
async function refBase64(assetId?: string): Promise<{ base64: string; mime: string } | null> {
  if (!assetId) return null
  const a = await loadAsset(assetId)
  return a ? { base64: a.base64, mime: a.mime } : null
}

/**
 * 生成分镜关键帧：分镜画面描述 + 出场资产（作参考图做一致性）+ 画风锚定。
 * 有出场资产参考图且宿主支持图像编辑 → img2img（强一致）；否则文生图。
 */
export async function generateKeyframeImage(sb: Storyboard, assets: Asset[], meta: ProjectMeta): Promise<string> {
  const model = imageModel(meta)
  if (!model) throw new Error('未配置图像模型（请在「设置」里选择图像模型）')
  const basis = (sb.prompt || sb.videoDesc || '').trim()
  if (!basis) throw new Error('请先填写分镜画面描述')
  const pack = getStylePack(meta.artStyle)
  const anchor = pack ? applyStylePack(pack, 'keyframe') : ''
  // 出场资产名注入提示，便于模型对齐
  const cast = assets.filter((a) => sb.associateAssetIds.includes(a.id))
  const castHint = cast.length ? `, 出场：${cast.map((a) => a.name).join('、')}` : ''
  const prompt = [basis + castHint, anchor].filter(Boolean).join(', ')
  const size = sizeForRatio(meta.videoRatio)

  const canEdit = !!window.mulby?.ai?.images?.edit && !!window.mulby?.ai?.attachments?.upload
  const refs = canEdit ? (await Promise.all(cast.map((a) => refBase64(a.refImageId)))).filter(Boolean) as { base64: string; mime: string }[] : []
  if (refs.length) {
    const [primary, ...rest] = refs
    const r = await editImage({ model, prompt, refBase64: primary.base64, refMime: primary.mime, extraRefs: rest })
    return saveAsset(r.base64, r.mime)
  }
  const r = await generateImage({ model, prompt, size })
  return saveAsset(r.base64, r.mime)
}
