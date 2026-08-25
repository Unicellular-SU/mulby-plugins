/**
 * Toonflow 式重构 · 阶段4（§5.3）：按模型 + 模式生成段视频提示词。
 *
 * 路由：视频模式优先取段级 videoMode，否则 meta.videoMode，否则按模型名子串推断（wan2.6→单图首帧，
 * seedance→多参，其余→首帧）。生成：system = 视频模式模板(video_modes/<mode>.md) + 画风视频手册
 * (composeArtPrompt storyboard_video)，user = 段内分镜画面/台词/出场资产/时长，走 host runText 单次确定性调用。
 */
import { runText } from '../../services/textEngine'
import { composeArtPrompt, getVideoModeSkill } from '../../services/skillSystem'
import { useGraphStore } from '../../store/graphStore'
import { useProviderStore } from '../../store/providerStore'
import { collectStoryboardVideoReferences, loadAssetDataUrl, supportsVideoReferenceImages } from './videoReferences'
import type { ProjectDoc, VideoTrack, VideoMode, Storyboard } from '../../domain/types'

export function routeVideoMode(model?: string, videoMode?: string): VideoMode {
  const v = (videoMode || '').trim()
  if (v === 'firstFrame' || v === 'startEndFrame' || v === 'multiRef' || v === 'singleImageFirst') return v
  const m = (model || '').toLowerCase()
  if (m.includes('wan') && m.includes('2.6')) return 'singleImageFirst'
  if (m.includes('seedance')) return 'multiRef'
  if (v === '' && (m.includes('first') && m.includes('last'))) return 'startEndFrame'
  return 'firstFrame'
}

export async function generateTrackVideoPrompt(track: VideoTrack, doc: ProjectDoc): Promise<string> {
  const textModel = useGraphStore.getState().selectedModel
  if (!textModel) throw new Error('未配置文本模型（请在「模型」里选择文本模型）')
  const provider = useProviderStore.getState().getActiveFor('video')
  const canSendReferenceImages = supportsVideoReferenceImages(provider)
  const requestedMode = track.videoMode ?? routeVideoMode(doc.meta.videoModel, doc.meta.videoMode)
  const sbs = track.storyboardIds.map((id) => doc.storyboards.find((s) => s.id === id)).filter(Boolean) as Storyboard[]
  if (sbs.length === 0) throw new Error('该段无关联分镜')
  const primaryImageUrl = await loadAssetDataUrl(sbs.find((s) => s.keyframeImageId)?.keyframeImageId)
  const referenceImages = canSendReferenceImages ? await collectStoryboardVideoReferences(sbs, doc.assets, primaryImageUrl) : []
  const mode = requestedMode === 'multiRef' && referenceImages.length === 0 ? 'firstFrame' : requestedMode
  const modeSkill = getVideoModeSkill(mode)
  const artSkill = composeArtPrompt(doc.meta.artStyle, 'storyboard_video')
  const system = [modeSkill, artSkill].filter(Boolean).join('\n\n---\n\n') || '你是视频提示词工程师，把画面描述整理成一条图生视频提示词。'

  const imageRefs = ['@图1=当前段首帧/关键帧', ...referenceImages.map((r, i) => `@图${i + 2}=${r.name || r.type || '参考图'}`)]
  const dur = track.duration ?? (sbs.reduce((a, s) => a + (s.duration || 0), 0) || 5)
  const shots = sbs
    .map((s, i) => {
      const dlg = (s.dialogues ?? []).map((d) => `${d.character}: ${d.line}${d.emotion ? `（${d.emotion}）` : ''}`).join('；')
      const cam = [s.shotSize ? `景别:${s.shotSize}` : '', s.cameraMove ? `运镜:${s.cameraMove}` : ''].filter(Boolean).join(' ')
      return `${i + 1}. ${s.videoDesc}${cam ? `\n   镜头：${cam}` : ''}${dlg ? `\n   台词：${dlg}` : ''}`
    })
    .join('\n')
  const user = [
    `段时长：约 ${dur} 秒`,
    `画幅：${doc.meta.videoRatio}`,
    `参考图片编号顺序（与实际传给视频模型的图片顺序一致）：${imageRefs.join('，')}`,
    referenceImages.length ? `出场资产参考图顺序：${referenceImages.map((r, i) => `@图${i + 2}=${r.name || r.type || '参考图'}`).join('，')}` : '',
    '画面（按分镜顺序）：',
    shots,
  ]
    .filter(Boolean)
    .join('\n')

  const { content } = await runText({ model: textModel, system, user })
  return content.trim()
}
