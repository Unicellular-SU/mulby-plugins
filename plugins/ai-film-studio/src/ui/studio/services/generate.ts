/**
 * Toonflow 式重构 · 阶段2d：工作台生成服务——把结构化资产/分镜接到现有图像/视频引擎，
 * 并注入项目画风 Skill（经 stylePacks 锚定）。二进制存资产库，结构里只留 assetId。
 */
import { generateImage, editImage } from '../../services/imageEngine'
import { saveAsset, loadAsset } from '../../services/assets'
import { getStylePack, applyStylePack, videoStyleTag, type StyleRole } from '../../services/stylePacks'
import { getPrompt } from '../../store/promptStore'
import { fillTemplate } from '../../services/promptTemplates'
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

const STD_ASPECTS: Array<[string, number]> = [
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['21:9', 21 / 9],
]

/** 比例吸附到最接近的标准画幅（如 16:9 / 9:16）；供应商注册表会再 snap 到该模型支持的画幅 */
function aspectFromSize(w: number, h: number): string {
  const r = w / h
  let best = STD_ASPECTS[0][0]
  let bd = Infinity
  for (const [name, ratio] of STD_ASPECTS) {
    const diff = Math.abs(Math.log(r / ratio))
    if (diff < bd) {
      bd = diff
      best = name
    }
  }
  return best
}

/**
 * 从 base64 图片头部确定性解码宽高（PNG/JPEG/GIF），不经过 DOM Image——规避渲染层 CSP 拦 data: 图导致读不到尺寸。
 * 用来让视频画幅跟随关键帧首帧的真实比例（不硬编码）。
 */
function decodeImageSize(base64: string): { w: number; h: number } | null {
  try {
    const bin = atob(base64)
    const n = bin.length
    const at = (i: number) => bin.charCodeAt(i) & 0xff
    // PNG：签名 89 50 4E 47 + IHDR，宽@16 高@20（大端）
    if (n > 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
      const w = (at(16) << 24) | (at(17) << 16) | (at(18) << 8) | at(19)
      const h = (at(20) << 24) | (at(21) << 16) | (at(22) << 8) | at(23)
      if (w > 0 && h > 0) return { w, h }
    }
    // GIF：宽/高小端 @6/@8
    if (n > 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) {
      const w = at(6) | (at(7) << 8)
      const h = at(8) | (at(9) << 8)
      if (w > 0 && h > 0) return { w, h }
    }
    // JPEG：FF D8 后扫 SOF 标记，高@+5 宽@+7（大端）
    if (n > 4 && at(0) === 0xff && at(1) === 0xd8) {
      let i = 2
      while (i + 9 < n) {
        if (at(i) !== 0xff) {
          i++
          continue
        }
        const marker = at(i + 1)
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
          i += 2
          continue
        }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const h = (at(i + 5) << 8) | at(i + 6)
          const w = (at(i + 7) << 8) | at(i + 8)
          return w > 0 && h > 0 ? { w, h } : null
        }
        const len = (at(i + 2) << 8) | at(i + 3)
        if (len < 2) break
        i += 2 + len
      }
    }
  } catch {
    // 忽略，回退到项目画幅
  }
  return null
}

// 仅出图类资产有画风角色映射；audio(音色)/clip(素材) 不出图（见 §2.1.1）
const ASSET_ROLE: Partial<Record<Asset['type'], StyleRole>> = { role: 'character', scene: 'scene', prop: 'prop' }

// 构图层模板（与画风无关、确定性强制）：把资产描述包进按类型的版面模板，再追加画风锚定。
// 复用「提示词模板」面板里可编辑的同名模板（与画布工程共享）：人物=五视图设定板（左两面部特写+右正/侧/背，
// 纯白底）、场景=无人空镜、物品=单物品纯底。保证无论是否润色、无论何种画风，版面都稳定可用于下游分镜/视频。
const ASSET_LAYOUT_TPL: Partial<Record<Asset['type'], string>> = {
  role: 'image.charImageBoard',
  scene: 'image.assetScene',
  prop: 'image.assetProp',
}

// 资产参考图尺寸：人物五视图板恒用 16:9 横图（否则被项目竖屏画幅压扁版面）；物品用方图便于居中展示；
// 场景跟随成片画幅（场景图天然要与分镜/视频同比例）。
function assetImageSize(type: Asset['type'], meta: ProjectMeta): string {
  if (type === 'role') return '1344x768'
  if (type === 'prop') return '1024x1024'
  return sizeForRatio(meta.videoRatio)
}

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
  // 构图层：basis 包进按类型的版面模板（charImageBoard 用 {ref}、场景/物品用 {basis}），再叠画风锚定。
  const tplId = ASSET_LAYOUT_TPL[asset.type]
  const body = tplId ? fillTemplate(getPrompt(tplId), { ref: basis, basis }) : basis
  const prompt = [body, anchor].filter(Boolean).join(', ')
  const r = await generateImage({ model, prompt, size: assetImageSize(asset.type, meta) })
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
  // 对白：把台词原文喂进视频提示词，让原生音频模型（如 grok-video-3）真正把每句对白说出来（否则只有画面没声音）
  const dlg = (sb.dialogues ?? [])
    .filter((d) => d.line?.trim())
    .map((d) => `${d.character || '旁白'}：「${d.line.trim()}」`)
    .join('  ')
  const speechCue = dlg ? `\n对白（让出场角色按顺序自然说出，口型与台词同步）：${dlg}` : ''
  // 优先用段视频提示词（§5.3 生成/手改）；无则回退硬拼 motion。有对白时放宽"只动首帧"约束，让角色能开口说话
  const base = promptOverride?.trim()
    ? [promptOverride.trim(), vtag].filter(Boolean).join(', ')
    : dlg
      ? [sb.videoDesc, vtag, 'keep the same scene, no scene change, no hard cut'].filter(Boolean).join(', ')
      : [sb.videoDesc, vtag, 'animate the first frame only, natural motion that settles at the end, no scene change, no hard cut'].filter(Boolean).join(', ')
  const motion = base + speechCue
  // 时长：段时长(durationSec)优先于分镜 duration；钳到视频模型通用区间 [4,15]s；seed 整片共用提一致性
  const duration = Math.min(Math.max(Number(durationSec ?? sb.duration) || 5, 4), 15)
  // 画幅：从关键帧/首帧真实尺寸确定性推断（字节解码，绕开 Image/CSP）；测不出退项目画幅，再不行 16:9（与默认横图一致）
  const ffB64 = !a && firstFrameUrl?.startsWith('data:') ? firstFrameUrl.split(',')[1] : undefined
  const sz = a ? decodeImageSize(a.base64) : ffB64 ? decodeImageSize(ffB64) : null
  const aspectRatio = sz ? aspectFromSize(sz.w, sz.h) : meta.videoRatio || '16:9'
  console.info('[ai-film-studio] 片段画幅 →', aspectRatio, sz ? `(${sz.w}×${sz.h})` : '(图未解出，用项目画幅/16:9)')
  const { url } = await runVideo({
    cfg: provider,
    apiKey,
    req: { prompt: motion, imageUrl, duration, aspectRatio, seed: projectSeed(meta.id) },
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
