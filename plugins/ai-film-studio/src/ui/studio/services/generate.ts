/**
 * Toonflow 式重构 · 阶段2d：工作台生成服务——把结构化资产/分镜接到现有图像/视频引擎，
 * 并注入项目画风 Skill（经 stylePacks 锚定）。二进制存资产库，结构里只留 assetId。
 */
import { generateImage, editImage } from '../../services/imageEngine'
import { saveAsset, loadAsset } from '../../services/assets'
import { getStylePack, applyStylePack, videoStyleTag, type StyleRole } from '../../services/stylePacks'
import { runVideo } from '../../services/providers'
import { downloadVideoToDisk } from '../../services/download'
import { ffmpegAvailable, extractLastFrame } from '../../services/ffmpeg'
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

// 仅出图类资产有画风角色映射；audio(音色)/clip(素材) 不出图（见 §2.1.1）
const ASSET_ROLE: Partial<Record<Asset['type'], StyleRole>> = { role: 'character', scene: 'scene', prop: 'prop' }

// 景别中文→英文（注入关键帧/视频提示词，提升画面构图准确度）
const SHOT_EN: Record<string, string> = {
  大远景: 'extreme wide shot',
  远景: 'wide shot',
  全景: 'full shot',
  中景: 'medium shot',
  近景: 'medium close-up',
  特写: 'close-up',
  大特写: 'extreme close-up',
}
const MOVE_EN: Record<string, string> = {
  固定: 'static camera',
  推: 'dolly in / push in',
  拉: 'dolly out / pull back',
  摇: 'pan',
  移: 'tracking shot',
  跟: 'follow shot',
  升降: 'crane shot',
  环绕: 'orbit shot',
  手持: 'handheld camera',
}
export function shotSizeEn(s?: string): string {
  return s ? SHOT_EN[s] ?? s : ''
}
export function cameraMoveEn(m?: string): string {
  return m ? MOVE_EN[m] ?? m : ''
}

/** 生成资产参考图：资产描述 + 画风锚定 → 文生图 → 存资产库，返回 assetId */
export async function generateAssetImage(asset: Asset, meta: ProjectMeta): Promise<string> {
  if (asset.type === 'audio' || asset.type === 'clip') throw new Error('该类型资产（音色/片段）不支持文生图')
  const model = imageModel(meta)
  if (!model) throw new Error('未配置图像模型（请在「设置」里选择图像模型）')
  const basis = (asset.prompt || asset.desc || asset.name || '').trim()
  if (!basis) throw new Error('请先填写资产名称或描述')
  const pack = getStylePack(meta.artStyle)
  const anchor = pack ? applyStylePack(pack, ASSET_ROLE[asset.type] ?? 'character') : ''
  const prompt = [basis, anchor].filter(Boolean).join(', ')
  const r = await generateImage({ model, prompt, size: sizeForRatio(meta.videoRatio) })
  return saveAsset(r.base64, r.mime)
}

// 衍生约束兜底子句（即使无 _derivative 手册也保证最低身份保持，见 §3.1）
const DERIVATIVE_CLAUSE =
  'keep the exact same face, identity and body proportions as the reference image; only change outfit / state / scene as described, do not alter the character identity'

/**
 * 生成衍生资产图（§3.1）：以父资产成图作 img2img 主参考 → 叠加服化/状态/场景变体，保持身份一致。
 * prompt 优先用 child 已润色的 prompt（衍生润色取 _derivative 手册），否则用描述；恒附 DERIVATIVE_CLAUSE 兜底。
 */
export async function generateDerivativeImage(child: Asset, parent: Asset, meta: ProjectMeta): Promise<string> {
  if (child.type === 'audio' || child.type === 'clip') throw new Error('该类型资产（音色/片段）不支持衍生出图')
  const model = imageModel(meta)
  if (!model) throw new Error('未配置图像模型（请在「设置」里选择图像模型）')
  const base = await refBase64(parent.refImageId)
  if (!base) throw new Error('请先生成父资产的图片（衍生需以父图为基）')
  const pack = getStylePack(meta.artStyle)
  const anchor = pack ? applyStylePack(pack, ASSET_ROLE[child.type] ?? 'character') : ''
  const basis = (child.prompt || child.desc || child.name || '').trim()
  const prompt = [basis, DERIVATIVE_CLAUSE, anchor].filter(Boolean).join(', ')
  const r = await editImage({ model, prompt, refBase64: base.base64, refMime: base.mime })
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
  const shotHint = shotSizeEn(sb.shotSize) // 景别影响静帧构图（运镜只对视频有意义，关键帧不注入）
  const prompt = [basis + castHint, shotHint, chaining ? CONTINUITY_CLAUSE : '', anchor].filter(Boolean).join(', ')
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

/** 抽取某本地视频片段的真实尾帧 dataURL（best-effort，供顺接片段作首帧；ffmpeg 不可用则返回 undefined） */
export async function clipLastFrameDataUrl(localPath?: string): Promise<string | undefined> {
  if (!localPath || !(await ffmpegAvailable())) return undefined
  return extractLastFrame(localPath)
}

export interface ClipResult {
  url: string
  localPath?: string
  durationSec: number
}

/** 片段生成选项（§5.4 扩参）：首帧顺接 + 段时长覆盖 + 段提示词覆盖 + 进度。 */
export interface ClipGenOptions {
  firstFrameUrl?: string // 承接片段：上一片段真实尾帧作首帧
  durationSec?: number // 段时长覆盖（优先于 sb.duration，钳 [4,15]）
  promptOverride?: string // 段视频提示词（§5.3 生成，优先于硬拼 motion）
  onProgress?: (s: string) => void
}

/** 由项目 id 派生稳定 seed：整片所有片段共用，跨片段风格/运动更一致（供应商不支持则忽略） */
function projectSeed(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 2147483647
}

/**
 * 由分镜关键帧生成视频片段：关键帧作首帧 → runVideo（图生视频），注入运动描述 + 画风视频标签。
 * 顺接（fix4 同源）：承接片段传 firstFrameUrl（上一片段真实尾帧）作首帧，无缝衔接。
 * 复用现有 providers（fal/custom-http 异步轮询）。下载落盘供后续 ffmpeg 合成。
 */
export async function generateClipVideo(sb: Storyboard, meta: ProjectMeta, opts: ClipGenOptions = {}): Promise<ClipResult> {
  const { firstFrameUrl, durationSec, promptOverride, onProgress } = opts
  const ps = useProviderStore.getState()
  const provider = ps.getActiveFor('video')
  if (!provider) throw new Error('未配置视频供应商（请在「设置」添加并设为默认）')
  const apiKey = await ps.resolveKey(provider.id)
  const a = sb.keyframeImageId ? await loadAsset(sb.keyframeImageId) : null
  if (!a && !firstFrameUrl) throw new Error('请先生成该分镜的关键帧')
  const imageUrl = firstFrameUrl || `data:${a!.mime};base64,${a!.base64}`
  const vtag = videoStyleTag(meta.artStyle)
  // 优先用段视频提示词（§5.3 生成/手改）；无则回退硬拼 motion
  const motion = promptOverride?.trim()
    ? [promptOverride.trim(), vtag].filter(Boolean).join(', ')
    : [sb.videoDesc, vtag, 'animate the first frame only, natural motion that settles at the end, no scene change, no hard cut'].filter(Boolean).join(', ')
  // 时长：段时长(durationSec)优先于分镜 duration；钳到视频模型通用区间 [4,15]s；seed 整片共用提一致性
  const duration = Math.min(Math.max(Number(durationSec ?? sb.duration) || 5, 4), 15)
  const { url } = await runVideo({
    cfg: provider,
    apiKey,
    // aspectRatio：跟随项目画幅（16:9/9:16/1:1）——否则 grok 等供应商默认竖屏 9:16
    req: { prompt: motion, imageUrl, duration, aspectRatio: meta.videoRatio, seed: projectSeed(meta.id) },
    onProgress: (p) => onProgress?.(p.status),
  })
  let localPath: string | undefined
  try {
    localPath = await downloadVideoToDisk(url, `clip_${sb.id}`)
  } catch {
    // 忽略下载失败：仍保留远程 url
  }
  return { url, localPath, durationSec: duration }
}
