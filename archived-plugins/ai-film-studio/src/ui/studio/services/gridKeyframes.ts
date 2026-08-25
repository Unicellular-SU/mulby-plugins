/**
 * 宫格关键帧生成：一次出图产出同场景多镜，再切成单帧。
 *
 * 一致性上这是本插件最强的一招——同一张图里的角色长相、光线方向、色调、材质由模型
 * 自身保证，不依赖任何"keep the same character"式的提示词祈祷。成本上，一个 6 镜场景
 * 从 6 次图像调用压成 1 次。
 *
 * 布局与分组的纯逻辑在 `domain/gridLayout.ts`；这里只负责调模型、切图、落盘。
 */
import { generateImage, editImage } from '../../services/imageEngine'
import { saveAsset, loadAsset } from '../../services/assets'
import { getStylePack, applyStylePack } from '../../services/stylePacks'
import { castRefsForStoryboard, labelForCastRef, refImageIdForCastRef } from '../../domain/castRefs'
import { buildGridPrompt, gridCellRects, gridImageSize, ratioValue, type GridGroup, type GridLayout } from '../../domain/gridLayout'
import { shotSizeEn } from './generate'
import { logInfo } from '../../services/localLog'
import type { Asset, ProjectMeta, Storyboard } from '../../domain/types'

export { planGridGroups } from '../../domain/gridLayout'

/**
 * 在渲染进程把一张大图按归一化裁剪框切成多张 PNG。
 * 用 createImageBitmap + OffscreenCanvas；两者在 Electron 渲染进程都可用，
 * 且不经过 DOM <img>（规避 CSP 对 data: 图的拦截，这个坑 generate.ts 里已经踩过一次）。
 */
export async function sliceImage(
  base64: string,
  mime: string,
  rects: { x: number; y: number; width: number; height: number }[],
): Promise<{ slices: { base64: string; mime: string }[]; sourceWidth: number; sourceHeight: number }> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }))
  const sourceWidth = bitmap.width
  const sourceHeight = bitmap.height
  const out: { base64: string; mime: string }[] = []
  try {
    for (const rect of rects) {
      const sx = Math.round(rect.x * bitmap.width)
      const sy = Math.round(rect.y * bitmap.height)
      const sw = Math.max(1, Math.round(rect.width * bitmap.width))
      const sh = Math.max(1, Math.round(rect.height * bitmap.height))
      const canvas = new OffscreenCanvas(sw, sh)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建离屏画布，当前环境不支持宫格切割')
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const buffer = new Uint8Array(await blob.arrayBuffer())
      let raw = ''
      for (let i = 0; i < buffer.length; i += 1) raw += String.fromCharCode(buffer[i])
      out.push({ base64: btoa(raw), mime: 'image/png' })
    }
  } finally {
    bitmap.close?.()
  }
  return { slices: out, sourceWidth, sourceHeight }
}

export function gridSupported(): boolean {
  return typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function'
}

async function refBase64(assetId?: string): Promise<{ base64: string; mime: string } | null> {
  if (!assetId) return null
  const asset = await loadAsset(assetId)
  return asset ? { base64: asset.base64, mime: asset.mime } : null
}

/** 单格的画面描述：沿用逐镜关键帧那套（描述 + 出场 + 景别），但不重复注入风格——风格在整图级别说一次 */
function cellPrompt(storyboard: Storyboard, assets: Map<string, Asset>): string {
  const basis = (storyboard.prompt || storyboard.videoDesc || '').trim()
  const cast = castRefsForStoryboard(storyboard).map((ref) => labelForCastRef(assets.get(ref.assetId), ref))
  const shot = shotSizeEn(storyboard.shotSize)
  return [basis, cast.length ? `出场：${cast.join('、')}` : '', shot].filter(Boolean).join(', ')
}

export interface GridGenerationResult {
  /** 整张宫格图的资产 id，留档便于复查与重切 */
  gridImageId: string
  /** 分镜 id → 切出的单格图资产 id */
  cellImageIds: Record<string, string>
}

/**
 * 生成一组宫格并切成单帧。
 * 出场资产的参考图仍然会作为 img2img 参考传进去——宫格保证组**内**一致，
 * 参考图保证组**间**（跨场景、跨集）一致，两者叠加才完整。
 */
export async function generateGridKeyframes(
  group: GridGroup,
  storyboards: Storyboard[],
  assets: Asset[],
  meta: ProjectMeta,
  model: string,
  onProgress?: (text: string) => void,
): Promise<GridGenerationResult> {
  if (!gridSupported()) throw new Error('当前环境不支持宫格切割（缺少 OffscreenCanvas）')
  const byId = new Map(storyboards.map((item) => [item.id, item]))
  const assetById = new Map(assets.map((item) => [item.id, item]))
  const shots = group.shots.map((shot) => byId.get(shot.id)).filter((item): item is Storyboard => !!item)
  if (shots.length < 2) throw new Error('宫格至少需要 2 个分镜')

  const pack = getStylePack(meta.artStyle)
  const styleAnchor = pack ? applyStylePack(pack, 'keyframe') : ''
  const sceneAsset = shots
    .flatMap((shot) => castRefsForStoryboard(shot))
    .map((ref) => assetById.get(ref.assetId))
    .find((asset) => asset?.type === 'scene')

  const prompt = buildGridPrompt(group.layout, shots.map((shot) => cellPrompt(shot, assetById)), {
    styleAnchor,
    sceneHint: sceneAsset ? `${sceneAsset.name}${sceneAsset.desc ? ` — ${sceneAsset.desc}` : ''}` : undefined,
  })

  const { width, height } = gridImageSize(group.layout, ratioValue(meta.videoRatio))
  onProgress?.(`生成 ${group.layout.cols}×${group.layout.rows} 宫格（${shots.length} 镜）`)

  // 收集本组所有出场资产的参考图，保证宫格里的人跟资产库里的人是同一个
  const canEdit = !!window.mulby?.ai?.images?.edit && !!window.mulby?.ai?.attachments?.upload
  const refIds = [
    ...new Set(
      shots.flatMap((shot) =>
        castRefsForStoryboard(shot)
          .map((ref) => refImageIdForCastRef(assetById.get(ref.assetId), ref))
          .filter((id): id is string => !!id),
      ),
    ),
  ]
  const refs = canEdit ? ((await Promise.all(refIds.map(refBase64))).filter(Boolean) as { base64: string; mime: string }[]) : []

  const generated = refs.length
    ? await editImage({ model, prompt, refBase64: refs[0].base64, refMime: refs[0].mime, extraRefs: refs.slice(1) })
    : await generateImage({ model, prompt, size: `${width}x${height}` })

  const gridImageId = await saveAsset(generated.base64, generated.mime)
  onProgress?.('切割宫格…')

  const rects = gridCellRects(group.layout).slice(0, shots.length)
  const { slices, sourceWidth, sourceHeight } = await sliceImage(generated.base64, generated.mime, rects)

  // 模型经常不按请求的尺寸出图。真实宽高比和请求值差太多，说明它没画成宫格
  // （多半是画了一张普通图），这时切出来的每一格都是同一张图的碎片——必须报出来而不是静默交付。
  const expectedRatio = (width || 1) / (height || 1)
  const actualRatio = sourceWidth / Math.max(1, sourceHeight)
  const ratioDrift = Math.abs(Math.log(actualRatio / expectedRatio))
  logInfo('grid', 'generated', {
    sceneId: group.sceneId,
    layout: group.layout.size,
    shots: shots.length,
    usedReferenceImages: refs.length,
    requested: `${width}x${height}`,
    actual: `${sourceWidth}x${sourceHeight}`,
    ratioDrift: Number(ratioDrift.toFixed(3)),
    promptPreview: prompt.slice(0, 600),
  })
  if (ratioDrift > 0.25) {
    const error = new Error(
      `宫格出图比例异常：请求 ${width}×${height}，实际 ${sourceWidth}×${sourceHeight}。` +
        '多半是图像模型没按分格要求出图，已放弃本组宫格并回退逐镜生成。',
    )
    // 原图已落盘，把 id 带出去便于在「原图」里肉眼确认模型到底画了什么
    ;(error as Error & { gridImageId?: string }).gridImageId = gridImageId
    throw error
  }

  const cellImageIds: Record<string, string> = {}
  for (let i = 0; i < shots.length; i += 1) {
    const slice = slices[i]
    if (!slice) continue
    cellImageIds[shots[i].id] = await saveAsset(slice.base64, slice.mime)
  }
  return { gridImageId, cellImageIds }
}

/** 组内镜头数上限内、且环境支持时才走宫格 */
export function shouldUseGrid(layout: GridLayout | null | undefined): boolean {
  return !!layout && gridSupported()
}
