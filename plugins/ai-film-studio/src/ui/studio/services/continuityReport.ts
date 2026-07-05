import { castRefsForStoryboard, labelForCastRef, refImageIdForCastRef } from '../../domain/castRefs'
import type { Asset, Episode, ProjectDoc, Storyboard, StoryboardCastRef } from '../../domain/types'

export interface ContinuityIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  episodeId?: string
  storyboardId?: string
  storyboardIndex?: number
  assetId?: string
  variantId?: string
}

export interface ContinuityCastUse {
  storyboardId: string
  storyboardIndex: number
  assetId: string
  assetName: string
  assetType: Asset['type']
  variantId?: string
  variantLabel?: string
  label: string
  refImageId?: string
  appliesToEpisode: boolean
}

export interface ContinuityEpisodeReport {
  id: string
  index: number
  title: string
  current: boolean
  storyboards: number
  castUses: ContinuityCastUse[]
  issues: ContinuityIssue[]
}

export interface ContinuityReport {
  currentEpisodeId?: string
  episodes: ContinuityEpisodeReport[]
  issues: ContinuityIssue[]
}

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function episodeStoryboards(doc: ProjectDoc, episode: Episode): Storyboard[] {
  return episode.id === doc.currentEpisodeId ? doc.storyboards : episode.storyboards
}

function episodeList(doc: ProjectDoc): Episode[] {
  const episodes = sortedEpisodes(doc)
  if (episodes.length) return episodes
  return [
    {
      id: doc.currentEpisodeId ?? 'current',
      index: 0,
      title: '当前集',
      scripts: doc.scripts,
      storyboards: doc.storyboards,
      storyboardTable: doc.storyboardTable,
      clips: doc.clips,
      track: doc.track,
      createdAt: doc.meta.createdAt,
      updatedAt: doc.meta.updatedAt,
    },
  ]
}

function variantAppliesToEpisode(asset: Asset, ref: StoryboardCastRef, episodeId: string): boolean {
  if (!ref.variantId) return true
  const variant = asset.variants?.find((item) => item.id === ref.variantId)
  const ids = variant?.appliesToEpisodeIds ?? []
  return !ids.length || ids.includes(episodeId)
}

export function buildContinuityReport(doc: ProjectDoc): ContinuityReport {
  const assets = new Map(doc.assets.map((asset) => [asset.id, asset]))
  const episodes = episodeList(doc)
  const episodeReports: ContinuityEpisodeReport[] = []
  const allIssues: ContinuityIssue[] = []
  const chapterIds = new Set(doc.novel.map((chapter) => chapter.id))
  const assignedChapterIds = new Set<string>()
  const chapterEpisodeRefs = new Map<string, { id: string; index: number; title: string; report: ContinuityEpisodeReport }[]>()

  for (const episode of episodes) {
    const storyboards = episodeStoryboards(doc, episode)
    const report: ContinuityEpisodeReport = {
      id: episode.id,
      index: episode.index + 1,
      title: episode.title,
      current: episode.id === doc.currentEpisodeId,
      storyboards: storyboards.length,
      castUses: [],
      issues: [],
    }
    const addIssue = (issue: ContinuityIssue) => {
      report.issues.push(issue)
      allIssues.push(issue)
    }

    if (doc.novel.length > 0 && episodes.length > 1) {
      const assigned = episode.novelChapterIds ?? []
      if (!assigned.length) {
        addIssue({ severity: 'warning', code: 'episode_without_chapters', episodeId: episode.id, message: `E${episode.index + 1}「${episode.title}」还没有分配原著章节` })
      }
      for (const chapterId of assigned) {
        if (chapterIds.has(chapterId)) {
          assignedChapterIds.add(chapterId)
          const refs = chapterEpisodeRefs.get(chapterId) ?? []
          refs.push({ id: episode.id, index: episode.index + 1, title: episode.title, report })
          chapterEpisodeRefs.set(chapterId, refs)
        } else addIssue({ severity: 'warning', code: 'invalid_episode_chapter', episodeId: episode.id, message: `E${episode.index + 1}「${episode.title}」引用了不存在的原著章节 ${chapterId}` })
      }
    }

    for (const storyboard of [...storyboards].sort((a, b) => a.index - b.index)) {
      for (const ref of castRefsForStoryboard(storyboard)) {
        const base = { episodeId: episode.id, storyboardId: storyboard.id, storyboardIndex: storyboard.index + 1, assetId: ref.assetId, variantId: ref.variantId }
        const asset = assets.get(ref.assetId)
        if (!asset) {
          addIssue({ ...base, severity: 'error', code: 'missing_asset', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 引用了不存在的资产 ${ref.assetId}` })
          continue
        }
        const variant = ref.variantId ? asset.variants?.find((item) => item.id === ref.variantId) : undefined
        if (ref.variantId && !variant) {
          addIssue({ ...base, severity: 'error', code: 'missing_variant', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 引用了「${asset.name}」不存在的变体 ${ref.variantId}` })
        }
        const appliesToEpisode = variantAppliesToEpisode(asset, ref, episode.id)
        if (!appliesToEpisode) {
          addIssue({ ...base, severity: 'warning', code: 'variant_out_of_episode_scope', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 使用了未标记适用于本集的「${labelForCastRef(asset, ref)}」` })
        }
        const refImageId = refImageIdForCastRef(asset, ref)
        if (!refImageId) {
          addIssue({ ...base, severity: 'error', code: 'missing_ref_image', message: `E${episode.index + 1} 分镜 #${storyboard.index + 1} 的「${labelForCastRef(asset, ref)}」没有参考图` })
        }
        report.castUses.push({
          storyboardId: storyboard.id,
          storyboardIndex: storyboard.index + 1,
          assetId: asset.id,
          assetName: asset.name,
          assetType: asset.type,
          variantId: ref.variantId,
          variantLabel: variant?.label,
          label: labelForCastRef(asset, ref),
          refImageId,
          appliesToEpisode,
        })
      }
    }
    episodeReports.push(report)
  }

  if (doc.novel.length > 0 && episodes.length > 1) {
    for (const chapter of doc.novel) {
      if (!assignedChapterIds.has(chapter.id)) {
        allIssues.push({ severity: 'warning', code: 'unassigned_chapter', message: `原著章节「${chapter.title}」还没有分配到任何剧集` })
      }
      const refs = chapterEpisodeRefs.get(chapter.id) ?? []
      if (refs.length > 1) {
        const labels = refs.map((ref) => `E${ref.index}「${ref.title}」`).join('、')
        for (const ref of refs) {
          const issue: ContinuityIssue = { severity: 'warning', code: 'duplicated_chapter_assignment', episodeId: ref.id, message: `原著章节「${chapter.title}」同时分配给 ${labels}` }
          ref.report.issues.push(issue)
          allIssues.push(issue)
        }
      }
    }
  }

  return { currentEpisodeId: doc.currentEpisodeId, episodes: episodeReports, issues: allIssues }
}
