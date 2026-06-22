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
import type { ProjectDoc, VideoTrack, VideoMode, Storyboard, Asset } from '../../domain/types'

export function routeVideoMode(model?: string, videoMode?: string): VideoMode {
  const v = (videoMode || '').trim()
  if (v === 'firstFrame' || v === 'startEndFrame' || v === 'multiRef' || v === 'singleImageFirst') return v
  const m = (model || '').toLowerCase()
  if (m.includes('wan') && m.includes('2.6')) return 'singleImageFirst'
  if (m.includes('seedance')) return 'multiRef'
  if (v === '' && (m.includes('first') && m.includes('last'))) return 'startEndFrame'
  return 'firstFrame'
}

/** 段内分镜的出场资产名（按出现顺序去重，供 @图N 编号对应） */
function castNames(sbs: Storyboard[], assets: Asset[]): string[] {
  const byId = new Map(assets.map((a) => [a.id, a]))
  const seen = new Set<string>()
  const out: string[] = []
  for (const sb of sbs) for (const id of sb.associateAssetIds) {
    const a = byId.get(id)
    if (a && !seen.has(a.id)) {
      seen.add(a.id)
      out.push(a.name)
    }
  }
  return out
}

export async function generateTrackVideoPrompt(track: VideoTrack, doc: ProjectDoc): Promise<string> {
  const textModel = useGraphStore.getState().selectedModel
  if (!textModel) throw new Error('未配置文本模型（请在「模型」里选择文本模型）')
  const mode = track.videoMode ?? routeVideoMode(doc.meta.videoModel, doc.meta.videoMode)
  const modeSkill = getVideoModeSkill(mode)
  const artSkill = composeArtPrompt(doc.meta.artStyle, 'storyboard_video')
  const system = [modeSkill, artSkill].filter(Boolean).join('\n\n---\n\n') || '你是视频提示词工程师，把画面描述整理成一条图生视频提示词。'

  const sbs = track.storyboardIds.map((id) => doc.storyboards.find((s) => s.id === id)).filter(Boolean) as Storyboard[]
  if (sbs.length === 0) throw new Error('该段无关联分镜')
  const cast = castNames(sbs, doc.assets)
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
    cast.length ? `出场资产（@图编号顺序）：${cast.map((n, i) => `@图${i + 1}=${n}`).join('，')}` : '',
    '画面（按分镜顺序）：',
    shots,
  ]
    .filter(Boolean)
    .join('\n')

  const { content } = await runText({ model: textModel, system, user })
  return content.trim()
}
