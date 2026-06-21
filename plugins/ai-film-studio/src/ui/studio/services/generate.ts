/**
 * Toonflow 式重构 · 阶段2d：工作台生成服务——把结构化资产/分镜接到现有图像/视频引擎，
 * 并注入项目画风 Skill（经 stylePacks 锚定）。二进制存资产库，结构里只留 assetId。
 */
import { generateImage, editImage } from '../../services/imageEngine'
import { saveAsset, loadAsset } from '../../services/assets'
import { getStylePack, applyStylePack, videoStyleTag, type StyleRole } from '../../services/stylePacks'
import { runVideo } from '../../services/providers'
import { downloadVideoToDisk } from '../../services/download'
import { useGraphStore } from '../../store/graphStore'
import { useProviderStore } from '../../store/providerStore'
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

const CONTINUITY_CLAUSE =
  'continue directly from the previous shot, same location, same lighting and color, keep characters consistent in appearance and screen position'

/**
 * 生成分镜关键帧：分镜画面描述 + 出场资产（作参考图做一致性）+ 画风锚定。
 * 连贯性（fix 1 同源）：承接镜头（sb.chainFromPrev + 给了上一镜关键帧 chainBase）→ 由上一帧 img2img 派生，
 * 承载构图/光线/站位，角色/场景参考图退为附加参考；否则有出场资产参考图就 img2img，再否则文生图。
 */
export async function generateKeyframeImage(
  sb: Storyboard,
  assets: Asset[],
  meta: ProjectMeta,
  chainBase?: { base64: string; mime: string } | null
): Promise<string> {
  const model = imageModel(meta)
  if (!model) throw new Error('未配置图像模型（请在「设置」里选择图像模型）')
  const basis = (sb.prompt || sb.videoDesc || '').trim()
  if (!basis) throw new Error('请先填写分镜画面描述')
  const pack = getStylePack(meta.artStyle)
  const anchor = pack ? applyStylePack(pack, 'keyframe') : ''
  const cast = assets.filter((a) => sb.associateAssetIds.includes(a.id))
  const castHint = cast.length ? `, 出场：${cast.map((a) => a.name).join('、')}` : ''
  const chaining = sb.chainFromPrev && chainBase
  const prompt = [basis + castHint, chaining ? CONTINUITY_CLAUSE : '', anchor].filter(Boolean).join(', ')
  const size = sizeForRatio(meta.videoRatio)

  const canEdit = !!window.mulby?.ai?.images?.edit && !!window.mulby?.ai?.attachments?.upload
  const refs = canEdit ? ((await Promise.all(cast.map((a) => refBase64(a.refImageId)))).filter(Boolean) as { base64: string; mime: string }[]) : []
  if (chaining && canEdit) {
    // 承接镜头：上一镜关键帧作主参考，角色/场景参考图作附加 → 同段相邻画格构图/光线/站位一致
    const r = await editImage({ model, prompt, refBase64: chainBase!.base64, refMime: chainBase!.mime, extraRefs: refs })
    return saveAsset(r.base64, r.mime)
  }
  if (refs.length) {
    const [primary, ...rest] = refs
    const r = await editImage({ model, prompt, refBase64: primary.base64, refMime: primary.mime, extraRefs: rest })
    return saveAsset(r.base64, r.mime)
  }
  const r = await generateImage({ model, prompt, size })
  return saveAsset(r.base64, r.mime)
}

/** 取某资产库图片的纯 base64（供承接镜头把上一镜关键帧作参考） */
export async function loadImageBase64(assetId?: string): Promise<{ base64: string; mime: string } | null> {
  return refBase64(assetId)
}

export interface ClipResult {
  url: string
  localPath?: string
  durationSec: number
}

/**
 * 由分镜关键帧生成视频片段：关键帧作首帧 → runVideo（图生视频），注入运动描述 + 画风视频标签。
 * 复用现有 providers（fal/custom-http 异步轮询）。下载落盘供后续 ffmpeg 合成。
 */
export async function generateClipVideo(sb: Storyboard, meta: ProjectMeta, onProgress?: (s: string) => void): Promise<ClipResult> {
  const ps = useProviderStore.getState()
  const provider = ps.getActiveFor('video')
  if (!provider) throw new Error('未配置视频供应商（请在「设置」添加并设为默认）')
  const apiKey = await ps.resolveKey(provider.id)
  const a = sb.keyframeImageId ? await loadAsset(sb.keyframeImageId) : null
  if (!a) throw new Error('请先生成该分镜的关键帧')
  const imageUrl = `data:${a.mime};base64,${a.base64}`
  const vtag = videoStyleTag(meta.artStyle)
  const motion = [sb.videoDesc, vtag, 'animate the first frame only, natural motion that settles at the end, no scene change, no hard cut']
    .filter(Boolean)
    .join(', ')
  const { url } = await runVideo({
    cfg: provider,
    apiKey,
    req: { prompt: motion, imageUrl, duration: sb.duration || 5 },
    onProgress: (p) => onProgress?.(p.status),
  })
  let localPath: string | undefined
  try {
    localPath = await downloadVideoToDisk(url, `clip_${sb.id}`)
  } catch {
    // 忽略下载失败：仍保留远程 url
  }
  return { url, localPath, durationSec: sb.duration || 5 }
}
