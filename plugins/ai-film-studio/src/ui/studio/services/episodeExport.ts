import type { Episode, ProjectDoc } from '../../domain/types'
import { buildSrt, type SrtClip } from '../../services/subtitles'
import { buildContinuityReport, type ContinuityIssue } from './continuityReport'

export interface EpisodeExportItem {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  sourcePath: string
  fileName: string
}

export interface EpisodeSubtitleExport {
  format: 'srt'
  fileName: string
  exportedPath?: string
  cueCount: number
  error?: string
}

export interface GeneratedEpisodeSubtitle extends EpisodeSubtitleExport {
  text: string
}

export interface EpisodeExportManifestEpisode extends EpisodeExportItem {
  exportedPath?: string
  error?: string
  subtitles?: EpisodeSubtitleExport[]
}

export interface EpisodeExportManifest {
  projectId: string
  projectName: string
  exportedAt: string
  episodeCount: number
  episodes: EpisodeExportManifestEpisode[]
  delivery: EpisodeDeliveryReport
}

export interface EpisodeExportResult {
  cancelled?: boolean
  dir?: string
  manifestPath?: string
  count: number
  errors: string[]
}

export interface SingleEpisodePackageManifest {
  projectId: string
  projectName: string
  exportedAt: string
  delivery: EpisodeDeliveryReport
  episode: {
    id: string
    index: number
    title: string
    summary?: string
    productionRecap?: string
    filmPath?: string
    exportedFilmPath?: string
    producedAt?: number
    counts: {
      scripts: number
      storyboards: number
      clips: number
      tracks: number
    }
    scripts: Episode['scripts']
    storyboards: Episode['storyboards']
    subtitles?: EpisodeSubtitleExport[]
  }
}

export interface EpisodeDeliveryAssetReference {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  storyboardId: string
  storyboardIndex: number
  assetId: string
  assetName: string
  assetType: string
  variantId?: string
  variantLabel?: string
  variantKind?: ContinuityIssue['variantKind']
  label: string
  refImageId?: string
  appliesToEpisode: boolean
}

export interface EpisodeDeliveryIssue extends ContinuityIssue {
  episodeIndex?: number
  episodeTitle?: string
}

export interface EpisodeDeliveryReport {
  assetReferences: EpisodeDeliveryAssetReference[]
  issues: EpisodeDeliveryIssue[]
  missingItems: EpisodeDeliveryIssue[]
}

function safeFileName(value: string, fallback = 'film'): string {
  return (value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 96) || fallback
}

function extName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const match = name.match(/\.([A-Za-z0-9]{1,8})$/)
  return match ? `.${match[1]}` : '.mp4'
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`
}

function timestampPart(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function sortedEpisodes(doc: ProjectDoc): Episode[] {
  return [...(doc.episodes ?? [])].sort((a, b) => a.index - b.index)
}

function sortedStoryboards(episode: Episode): Episode['storyboards'] {
  return [...episode.storyboards].sort((a, b) => a.index - b.index)
}

function episodeExportSnapshot(doc: ProjectDoc, episode: Episode): Episode {
  if (episode.id !== doc.currentEpisodeId) return episode
  return {
    ...episode,
    scripts: doc.scripts,
    storyboards: doc.storyboards,
    storyboardTable: doc.storyboardTable,
    clips: doc.clips,
    track: doc.track,
  }
}

function selectedClipForStoryboard(episode: Episode, storyboardId: string): Episode['clips'][number] | undefined {
  const track = episode.track.find((item) => item.storyboardIds.includes(storyboardId))
  if (track) {
    const clipId = track.selectClipId || track.clipIds[0]
    const selected = episode.clips.find((clip) => clip.id === clipId)
    if (selected) return selected
  }
  return episode.clips.find((clip) => clip.storyboardId === storyboardId && clip.state === 'done')
}

function isUsableSubtitleClip(clip: Episode['clips'][number] | undefined): boolean {
  return !!clip && (clip.state === 'done' || !!clip.videoFilePath || !!clip.videoUrl)
}

function subtitleShotFromStoryboard(storyboard: Episode['storyboards'][number]): Record<string, unknown> {
  return {
    id: storyboard.id,
    dialogues: storyboard.dialogues,
    description: storyboard.videoDesc,
    duration: storyboard.duration,
  }
}

function countSrtCues(text: string): number {
  return (text.match(/-->/g) ?? []).length
}

function subtitleMetadata(subtitle: GeneratedEpisodeSubtitle): EpisodeSubtitleExport {
  return {
    format: subtitle.format,
    fileName: subtitle.fileName,
    exportedPath: subtitle.exportedPath,
    cueCount: subtitle.cueCount,
    error: subtitle.error,
  }
}

export function buildEpisodeSubtitleExport(episode: Episode): GeneratedEpisodeSubtitle | undefined {
  const rows = sortedStoryboards(episode).map((storyboard) => ({
    storyboard,
    clip: selectedClipForStoryboard(episode, storyboard.id),
  }))
  if (rows.length === 0) return undefined
  const hasUsableClips = rows.some((row) => isUsableSubtitleClip(row.clip))
  const subtitleRows = hasUsableClips ? rows.filter((row) => isUsableSubtitleClip(row.clip)) : rows
  const clips: SrtClip[] = subtitleRows.map((row) => ({
    duration: row.clip?.durationSec || row.storyboard.duration || 5,
    shotId: row.storyboard.id,
  }))
  const text = buildSrt(clips, { shots: subtitleRows.map((row) => subtitleShotFromStoryboard(row.storyboard)) })
  if (!text) return undefined
  return {
    format: 'srt',
    fileName: `${safeFileName(`E${episode.index + 1}_${episode.title}_subtitles`, 'subtitles')}.srt`,
    cueCount: countSrtCues(text),
    text,
  }
}

export function producedEpisodeExportItems(doc: ProjectDoc): EpisodeExportItem[] {
  return sortedEpisodes(doc)
    .filter((episode) => !!episode.filmPath)
    .map((episode) => ({
      episodeId: episode.id,
      episodeIndex: episode.index + 1,
      episodeTitle: episode.title,
      sourcePath: episode.filmPath!,
      fileName: `${safeFileName(`E${episode.index + 1}_${episode.title}`)}${extName(episode.filmPath!)}`,
    }))
}

export function seasonPackageDirName(doc: ProjectDoc, date = new Date()): string {
  return `${safeFileName(doc.meta.name || 'series', 'series')}_season_${timestampPart(date)}`
}

export function episodePackageDirName(doc: ProjectDoc, episode: Episode, date = new Date()): string {
  return `${safeFileName(doc.meta.name || 'series', 'series')}_E${episode.index + 1}_${safeFileName(episode.title || 'episode', 'episode')}_${timestampPart(date)}`
}

export function buildEpisodeExportManifest(doc: ProjectDoc, episodes: EpisodeExportManifestEpisode[], exportedAt = new Date().toISOString()): EpisodeExportManifest {
  const manifestEpisodes = episodes.map((item) => {
    if (item.subtitles !== undefined) return item
    const rawEpisode = doc.episodes?.find((entry) => entry.id === item.episodeId)
    const episode = rawEpisode ? episodeExportSnapshot(doc, rawEpisode) : undefined
    const subtitle = episode ? buildEpisodeSubtitleExport(episode) : undefined
    return subtitle ? { ...item, subtitles: [subtitleMetadata(subtitle)] } : item
  })
  const episodeIds = new Set(manifestEpisodes.map((episode) => episode.episodeId))
  return {
    projectId: doc.meta.id,
    projectName: doc.meta.name,
    exportedAt,
    episodeCount: manifestEpisodes.length,
    episodes: manifestEpisodes,
    delivery: buildEpisodeDeliveryReport(doc, episodeIds),
  }
}

export function buildSingleEpisodePackageManifest(
  doc: ProjectDoc,
  episode: Episode,
  exportedFilmPath?: string,
  exportedAt = new Date().toISOString(),
  subtitles?: EpisodeSubtitleExport[],
): SingleEpisodePackageManifest {
  const snapshot = episodeExportSnapshot(doc, episode)
  const episodeSubtitles = subtitles ?? (() => {
    const subtitle = buildEpisodeSubtitleExport(snapshot)
    return subtitle ? [subtitleMetadata(subtitle)] : undefined
  })()
  return {
    projectId: doc.meta.id,
    projectName: doc.meta.name,
    exportedAt,
    delivery: buildEpisodeDeliveryReport(doc, new Set([snapshot.id])),
    episode: {
      id: snapshot.id,
      index: snapshot.index + 1,
      title: snapshot.title,
      summary: snapshot.summary,
      productionRecap: snapshot.productionRecap,
      filmPath: snapshot.filmPath,
      exportedFilmPath,
      producedAt: snapshot.producedAt,
      counts: {
        scripts: snapshot.scripts.length,
        storyboards: snapshot.storyboards.length,
        clips: snapshot.clips.length,
        tracks: snapshot.track.length,
      },
      scripts: snapshot.scripts,
      storyboards: snapshot.storyboards,
      subtitles: episodeSubtitles,
    },
  }
}

function isMissingItemIssue(issue: ContinuityIssue): boolean {
  return issue.severity === 'error' || issue.code.startsWith('missing_') || issue.code.startsWith('invalid_')
}

export function buildEpisodeDeliveryReport(doc: ProjectDoc, episodeIds?: Set<string>): EpisodeDeliveryReport {
  const report = buildContinuityReport(doc)
  const episodeMeta = new Map(report.episodes.map((episode) => [episode.id, episode]))
  const includeEpisode = (episodeId: string | undefined) => !episodeIds || !episodeId || episodeIds.has(episodeId)
  const issues = report.issues
    .filter((issue) => includeEpisode(issue.episodeId))
    .map((issue) => {
      const episode = issue.episodeId ? episodeMeta.get(issue.episodeId) : undefined
      return {
        ...issue,
        episodeIndex: episode?.index,
        episodeTitle: episode?.title,
      }
    })
  const assetReferences = report.episodes
    .filter((episode) => !episodeIds || episodeIds.has(episode.id))
    .flatMap((episode) =>
      episode.castUses.map((use) => ({
        episodeId: episode.id,
        episodeIndex: episode.index,
        episodeTitle: episode.title,
        storyboardId: use.storyboardId,
        storyboardIndex: use.storyboardIndex,
        assetId: use.assetId,
        assetName: use.assetName,
        assetType: use.assetType,
        variantId: use.variantId,
        variantLabel: use.variantLabel,
        variantKind: use.variantKind,
        label: use.label,
        refImageId: use.refImageId,
        appliesToEpisode: use.appliesToEpisode,
      })),
    )
  return {
    assetReferences,
    issues,
    missingItems: issues.filter(isMissingItemIssue),
  }
}

export async function exportProducedEpisodes(doc: ProjectDoc): Promise<EpisodeExportResult> {
  const items = producedEpisodeExportItems(doc)
  if (items.length === 0) throw new Error('没有可导出的已成片剧集')
  const dialog = window.mulby?.dialog
  const filesystem = window.mulby?.filesystem
  if (!dialog || !filesystem) throw new Error('宿主文件系统 API 不可用')

  const dirs = await dialog.showOpenDialog({
    title: '选择全季导出目录',
    buttonLabel: '导出到这里',
    properties: ['openDirectory'],
  })
  const root = dirs?.[0]
  if (!root) return { cancelled: true, count: 0, errors: [] }

  const dir = joinPath(root, seasonPackageDirName(doc))
  await filesystem.mkdir(dir)
  const episodeById = new Map(sortedEpisodes(doc).map((episode) => [episode.id, episodeExportSnapshot(doc, episode)]))
  const exported: EpisodeExportManifestEpisode[] = []
  const errors: string[] = []
  for (const item of items) {
    const exportedPath = joinPath(dir, item.fileName)
    const exportedItem: EpisodeExportManifestEpisode = { ...item, exportedPath }
    try {
      await filesystem.copy(item.sourcePath, exportedPath)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`E${item.episodeIndex} ${item.episodeTitle}: ${message}`)
      exportedItem.error = message
    }
    const episode = episodeById.get(item.episodeId)
    const subtitle = episode ? buildEpisodeSubtitleExport(episode) : undefined
    if (subtitle) {
      const subtitlePath = joinPath(dir, subtitle.fileName)
      const subtitleItem: EpisodeSubtitleExport = { ...subtitleMetadata(subtitle), exportedPath: subtitlePath }
      try {
        await filesystem.writeFile(subtitlePath, subtitle.text, 'utf-8')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`E${item.episodeIndex} ${item.episodeTitle} 字幕: ${message}`)
        subtitleItem.error = message
      }
      exportedItem.subtitles = [subtitleItem]
    }
    exported.push(exportedItem)
  }

  const manifestPath = joinPath(dir, 'manifest.json')
  await filesystem.writeFile(manifestPath, JSON.stringify(buildEpisodeExportManifest(doc, exported), null, 2), 'utf-8')
  return { dir, manifestPath, count: exported.filter((item) => !item.error).length, errors }
}

export async function exportEpisodePackage(doc: ProjectDoc, episode: Episode): Promise<EpisodeExportResult> {
  const snapshot = episodeExportSnapshot(doc, episode)
  if (!snapshot.filmPath) throw new Error('当前集还没有成片可导出')
  const dialog = window.mulby?.dialog
  const filesystem = window.mulby?.filesystem
  if (!dialog || !filesystem) throw new Error('宿主文件系统 API 不可用')

  const dirs = await dialog.showOpenDialog({
    title: `选择 E${episode.index + 1} 导出目录`,
    buttonLabel: '导出到这里',
    properties: ['openDirectory'],
  })
  const root = dirs?.[0]
  if (!root) return { cancelled: true, count: 0, errors: [] }

  const dir = joinPath(root, episodePackageDirName(doc, snapshot))
  await filesystem.mkdir(dir)
  const filmName = `${safeFileName(`E${snapshot.index + 1}_${snapshot.title}`)}${extName(snapshot.filmPath)}`
  const exportedFilmPath = joinPath(dir, filmName)
  const errors: string[] = []
  let copiedFilmPath: string | undefined = exportedFilmPath
  try {
    await filesystem.copy(snapshot.filmPath, exportedFilmPath)
  } catch (error) {
    copiedFilmPath = undefined
    errors.push(error instanceof Error ? error.message : String(error))
  }
  const subtitle = buildEpisodeSubtitleExport(snapshot)
  const subtitles: EpisodeSubtitleExport[] | undefined = subtitle ? [{ ...subtitleMetadata(subtitle), exportedPath: joinPath(dir, subtitle.fileName) }] : undefined
  if (subtitle && subtitles?.[0]) {
    try {
      await filesystem.writeFile(subtitles[0].exportedPath!, subtitle.text, 'utf-8')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`字幕: ${message}`)
      subtitles[0].error = message
    }
  }
  const manifestPath = joinPath(dir, 'episode.json')
  await filesystem.writeFile(
    manifestPath,
    JSON.stringify(buildSingleEpisodePackageManifest(doc, episode, copiedFilmPath, undefined, subtitles), null, 2),
    'utf-8',
  )
  return { dir, manifestPath, count: copiedFilmPath ? 1 : 0, errors }
}
