import { castRefsForStoryboard, labelForCastRef, refImageIdForCastRef } from '../../domain/castRefs'
import type { Asset, Storyboard } from '../../domain/types'
import { loadAsset } from '../../services/assets'

export interface GenerationPreflightIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
}

export interface GenerationPreflightResult {
  errors: GenerationPreflightIssue[]
  warnings: GenerationPreflightIssue[]
}

function emptyResult(): GenerationPreflightResult {
  return { errors: [], warnings: [] }
}

function addIssue(result: GenerationPreflightResult, issue: GenerationPreflightIssue): void {
  if (issue.severity === 'error') result.errors.push(issue)
  else result.warnings.push(issue)
}

async function assetBinaryExists(assetId: string, checked: Map<string, boolean>): Promise<boolean> {
  if (checked.has(assetId)) return checked.get(assetId)!
  const exists = !!(await loadAsset(assetId))
  checked.set(assetId, exists)
  return exists
}

async function checkCastReferences(storyboards: Storyboard[], assets: Asset[], checked: Map<string, boolean>, result: GenerationPreflightResult): Promise<void> {
  const byId = new Map(assets.map((asset) => [asset.id, asset]))
  const seen = new Set<string>()
  for (const storyboard of storyboards) {
    for (const ref of castRefsForStoryboard(storyboard)) {
      const key = `${storyboard.id}:${ref.assetId}:${ref.variantId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)

      const asset = byId.get(ref.assetId)
      if (!asset) {
        addIssue(result, { severity: 'error', code: 'missing_cast_asset', message: `分镜 #${storyboard.index + 1} 引用了不存在的资产 ${ref.assetId}` })
        continue
      }

      if (ref.variantId && !asset.variants?.some((variant) => variant.id === ref.variantId)) {
        addIssue(result, { severity: 'error', code: 'missing_cast_variant', message: `分镜 #${storyboard.index + 1} 引用了「${asset.name}」不存在的变体 ${ref.variantId}` })
        continue
      }

      const refImageId = refImageIdForCastRef(asset, ref)
      if (!refImageId) {
        addIssue(result, { severity: 'error', code: 'missing_cast_ref_image', message: `分镜 #${storyboard.index + 1} 的「${labelForCastRef(asset, ref)}」还没有参考图` })
        continue
      }

      if (!(await assetBinaryExists(refImageId, checked))) {
        addIssue(result, { severity: 'error', code: 'missing_cast_ref_binary', message: `分镜 #${storyboard.index + 1} 的「${labelForCastRef(asset, ref)}」参考图已丢失或无法读取` })
      }
    }
  }
}

function previousStoryboard(storyboards: Storyboard[], storyboardId: string): Storyboard | undefined {
  const ordered = [...storyboards].sort((a, b) => a.index - b.index)
  const index = ordered.findIndex((storyboard) => storyboard.id === storyboardId)
  return index > 0 ? ordered[index - 1] : undefined
}

export async function preflightKeyframeGeneration(storyboard: Storyboard, storyboards: Storyboard[], assets: Asset[]): Promise<GenerationPreflightResult> {
  const result = emptyResult()
  const checked = new Map<string, boolean>()
  if (!storyboard.videoDesc.trim() && !storyboard.prompt?.trim()) {
    addIssue(result, { severity: 'error', code: 'empty_storyboard_prompt', message: `分镜 #${storyboard.index + 1} 缺少画面描述或关键帧提示词` })
  }
  if (storyboard.chainFromPrev) {
    const prev = previousStoryboard(storyboards, storyboard.id)
    if (!prev?.keyframeImageId) addIssue(result, { severity: 'error', code: 'missing_previous_keyframe', message: `分镜 #${storyboard.index + 1} 设置了承接上一镜，但上一镜还没有关键帧` })
    else if (!(await assetBinaryExists(prev.keyframeImageId, checked))) {
      addIssue(result, { severity: 'error', code: 'missing_previous_keyframe_binary', message: `分镜 #${storyboard.index + 1} 的上一镜关键帧已丢失或无法读取` })
    }
  }
  await checkCastReferences([storyboard], assets, checked, result)
  return result
}

export async function preflightClipGeneration(
  storyboard: Storyboard,
  referenceStoryboards: Storyboard[],
  assets: Asset[],
  opts: { firstFrameUrl?: string; supportsReferenceImages: boolean },
): Promise<GenerationPreflightResult> {
  const result = emptyResult()
  const checked = new Map<string, boolean>()
  if (!storyboard.keyframeImageId && !opts.firstFrameUrl) {
    addIssue(result, { severity: 'error', code: 'missing_keyframe', message: `分镜 #${storyboard.index + 1} 还没有关键帧` })
  } else if (storyboard.keyframeImageId && !(await assetBinaryExists(storyboard.keyframeImageId, checked))) {
    addIssue(result, { severity: 'error', code: 'missing_keyframe_binary', message: `分镜 #${storyboard.index + 1} 的关键帧已丢失或无法读取` })
  }

  const hasCastReferences = referenceStoryboards.some((item) => castRefsForStoryboard(item).length > 0)
  if (!opts.supportsReferenceImages && hasCastReferences) {
    addIssue(result, { severity: 'warning', code: 'video_provider_ignores_cast_refs', message: '当前视频供应商不支持多参考图，视频阶段不会额外发送资产/变体参考图' })
  }
  await checkCastReferences(referenceStoryboards, assets, checked, result)
  return result
}

export function assertPreflight(result: GenerationPreflightResult): void {
  if (!result.errors.length) return
  throw new Error(result.errors.map((issue) => issue.message).join('\n'))
}
