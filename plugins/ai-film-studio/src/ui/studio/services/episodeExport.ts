import type { Episode, ProjectDoc } from '../../domain/types'

export interface EpisodeExportItem {
  episodeId: string
  episodeIndex: number
  episodeTitle: string
  sourcePath: string
  fileName: string
}

export interface EpisodeExportManifest {
  projectId: string
  projectName: string
  exportedAt: string
  episodeCount: number
  episodes: Array<EpisodeExportItem & { exportedPath?: string; error?: string }>
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
  }
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

export function buildEpisodeExportManifest(doc: ProjectDoc, episodes: EpisodeExportManifest['episodes'], exportedAt = new Date().toISOString()): EpisodeExportManifest {
  return {
    projectId: doc.meta.id,
    projectName: doc.meta.name,
    exportedAt,
    episodeCount: episodes.length,
    episodes,
  }
}

export function buildSingleEpisodePackageManifest(
  doc: ProjectDoc,
  episode: Episode,
  exportedFilmPath?: string,
  exportedAt = new Date().toISOString(),
): SingleEpisodePackageManifest {
  return {
    projectId: doc.meta.id,
    projectName: doc.meta.name,
    exportedAt,
    episode: {
      id: episode.id,
      index: episode.index + 1,
      title: episode.title,
      summary: episode.summary,
      productionRecap: episode.productionRecap,
      filmPath: episode.filmPath,
      exportedFilmPath,
      producedAt: episode.producedAt,
      counts: {
        scripts: episode.scripts.length,
        storyboards: episode.storyboards.length,
        clips: episode.clips.length,
        tracks: episode.track.length,
      },
      scripts: episode.scripts,
      storyboards: episode.storyboards,
    },
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
  const exported: EpisodeExportManifest['episodes'] = []
  const errors: string[] = []
  for (const item of items) {
    const exportedPath = joinPath(dir, item.fileName)
    try {
      await filesystem.copy(item.sourcePath, exportedPath)
      exported.push({ ...item, exportedPath })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`E${item.episodeIndex} ${item.episodeTitle}: ${message}`)
      exported.push({ ...item, exportedPath, error: message })
    }
  }

  const manifestPath = joinPath(dir, 'manifest.json')
  await filesystem.writeFile(manifestPath, JSON.stringify(buildEpisodeExportManifest(doc, exported), null, 2), 'utf-8')
  return { dir, manifestPath, count: exported.filter((item) => !item.error).length, errors }
}

export async function exportEpisodePackage(doc: ProjectDoc, episode: Episode): Promise<EpisodeExportResult> {
  if (!episode.filmPath) throw new Error('当前集还没有成片可导出')
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

  const dir = joinPath(root, episodePackageDirName(doc, episode))
  await filesystem.mkdir(dir)
  const filmName = `${safeFileName(`E${episode.index + 1}_${episode.title}`)}${extName(episode.filmPath)}`
  const exportedFilmPath = joinPath(dir, filmName)
  const errors: string[] = []
  try {
    await filesystem.copy(episode.filmPath, exportedFilmPath)
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  const manifestPath = joinPath(dir, 'episode.json')
  await filesystem.writeFile(
    manifestPath,
    JSON.stringify(buildSingleEpisodePackageManifest(doc, episode, errors.length ? undefined : exportedFilmPath), null, 2),
    'utf-8',
  )
  return { dir, manifestPath, count: errors.length ? 0 : 1, errors }
}
