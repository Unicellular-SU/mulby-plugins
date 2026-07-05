import { buildEpisodeExportManifest, buildEpisodeSubtitleExport, buildSingleEpisodePackageManifest, episodePackageDirName, producedEpisodeExportItems, seasonPackageDirName } from './episodeExport'
import type { Asset, Episode, ProjectDoc, ProjectMeta, Storyboard } from '../../domain/types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

function meta(): ProjectMeta {
  return { id: 'p1', name: 'My Series: Pilot?', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 }
}

function episode(id: string, index: number, patch: Partial<Episode> = {}): Episode {
  return {
    id,
    index,
    title: `Episode ${index + 1}`,
    scripts: [],
    storyboards: [],
    clips: [],
    track: [],
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

function storyboard(id: string, index: number, castRefs: Storyboard['castRefs']): Storyboard {
  return {
    id,
    index,
    track: 'main',
    videoDesc: `shot ${index + 1}`,
    duration: 4,
    associateAssetIds: castRefs?.map((ref) => ref.assetId) ?? [],
    castRefs,
    shouldGenerateImage: true,
    state: 'idle',
  }
}

function doc(patch: Partial<ProjectDoc>): ProjectDoc {
  return {
    meta: meta(),
    novel: [],
    scripts: [],
    assets: [],
    storyboards: [],
    clips: [],
    track: [],
    memory: [],
    ...patch,
  }
}

const assets: Asset[] = [{ id: 'hero', type: 'role', name: 'Hero', refImageId: 'hero-img', state: 'done' }]
const project = doc({
  assets,
  episodes: [
    episode('ep2', 1, { title: 'Dinner / Reveal', filmPath: 'D:\\films\\ep2.final.mp4', storyboards: [storyboard('sb2', 0, [{ assetId: 'ghost' }])] }),
    episode('ep1', 0, {
      title: 'Pilot',
      filmPath: '/tmp/ep1.mov',
      storyboards: [{ ...storyboard('sb1', 0, [{ assetId: 'hero' }]), dialogues: [{ character: 'Hero', line: 'We keep moving.' }] }],
      clips: [{ id: 'clip1', storyboardId: 'sb1', durationSec: 3, state: 'done', videoFilePath: '/tmp/clip1.mp4' }],
      track: [{ id: 'track1', storyboardIds: ['sb1'], clipIds: ['clip1'], selectClipId: 'clip1', order: 0 }],
    }),
    episode('ep3', 2, { title: 'Not Ready' }),
  ],
})

const items = producedEpisodeExportItems(project)
check('collects produced episodes in episode order', items.map((item) => item.episodeId).join(',') === 'ep1,ep2', JSON.stringify(items))
check('sanitizes exported episode file names and keeps extensions', items[0].fileName === 'E1_Pilot.mov' && items[1].fileName === 'E2_Dinner___Reveal.mp4', JSON.stringify(items.map((item) => item.fileName)))

const dirName = seasonPackageDirName(project, new Date('2026-07-06T01:02:03Z'))
check('builds stable season package directory name', dirName === 'My_Series__Pilot__season_20260706T010203Z', dirName)

const manifest = buildEpisodeExportManifest(project, items.map((item) => ({ ...item, exportedPath: `/exports/${item.fileName}` })), '2026-07-06T01:02:03.000Z')
check('builds season export manifest', manifest.projectId === 'p1' && manifest.episodeCount === 2 && manifest.episodes[1].exportedPath?.endsWith('.mp4') === true, JSON.stringify(manifest))
check('adds delivery asset references to season manifest', manifest.delivery.assetReferences.some((item) => item.assetId === 'hero' && item.episodeId === 'ep1'), JSON.stringify(manifest.delivery.assetReferences))
check('adds missing item report to season manifest', manifest.delivery.missingItems.some((item) => item.code === 'missing_asset' && item.episodeId === 'ep2'), JSON.stringify(manifest.delivery.missingItems))
check('adds subtitle metadata to season manifest', manifest.episodes[0].subtitles?.[0]?.fileName === 'E1_Pilot_subtitles.srt' && manifest.episodes[0].subtitles?.[0]?.cueCount === 1, JSON.stringify(manifest.episodes[0].subtitles))

const ep1 = project.episodes![1]
const subtitle = buildEpisodeSubtitleExport(ep1)
check('builds SRT subtitle export from episode dialogue', !!subtitle && subtitle.text.includes('We keep moving.') && subtitle.text.includes('00:00:03,000'), subtitle?.text ?? 'missing')
const episodeDir = episodePackageDirName(project, ep1, new Date('2026-07-06T01:02:03Z'))
check('builds stable single episode package directory name', episodeDir === 'My_Series__Pilot__E1_Pilot_20260706T010203Z', episodeDir)

const episodeManifest = buildSingleEpisodePackageManifest(project, ep1, '/exports/E1_Pilot.mov', '2026-07-06T01:02:03.000Z', subtitle ? [{ format: 'srt', fileName: subtitle.fileName, cueCount: subtitle.cueCount, exportedPath: '/exports/E1_Pilot_subtitles.srt' }] : undefined)
check('builds single episode package manifest', episodeManifest.episode.index === 1 && episodeManifest.episode.exportedFilmPath === '/exports/E1_Pilot.mov' && episodeManifest.episode.counts.scripts === 0, JSON.stringify(episodeManifest))
check('scopes delivery report to single episode package', episodeManifest.delivery.assetReferences.length === 1 && episodeManifest.delivery.assetReferences[0].assetId === 'hero' && episodeManifest.delivery.missingItems.length === 0, JSON.stringify(episodeManifest.delivery))
check('adds subtitle metadata to single episode package', episodeManifest.episode.subtitles?.[0]?.exportedPath === '/exports/E1_Pilot_subtitles.srt', JSON.stringify(episodeManifest.episode.subtitles))

const currentSnapshotProject = doc({
  currentEpisodeId: 'ep1',
  scripts: [{ id: 'flat-script', name: 'Flat Script', content: 'Current flat script.', createdAt: 0, updatedAt: 0 }],
  storyboards: [{ ...storyboard('flat-sb', 0, [{ assetId: 'hero' }]), dialogues: [{ character: 'Hero', line: 'Fresh current line.' }] }],
  clips: [{ id: 'flat-clip', storyboardId: 'flat-sb', durationSec: 2, state: 'done', videoFilePath: '/tmp/current-clip.mp4' }],
  track: [{ id: 'flat-track', storyboardIds: ['flat-sb'], clipIds: ['flat-clip'], selectClipId: 'flat-clip', order: 0 }],
  assets,
  episodes: [
    episode('ep1', 0, { title: 'Current', filmPath: '/tmp/current.mp4' }),
    episode('ep2', 1, { title: 'Stored', filmPath: '/tmp/stored.mp4', storyboards: [storyboard('stored-sb', 0, [{ assetId: 'hero' }])] }),
  ],
})
const currentSnapshotEpisode = currentSnapshotProject.episodes![0]
const currentSnapshotManifest = buildSingleEpisodePackageManifest(currentSnapshotProject, currentSnapshotEpisode, '/exports/current.mp4')
check(
  'single episode export snapshots current flat episode data',
  currentSnapshotManifest.episode.counts.scripts === 1 &&
    currentSnapshotManifest.episode.counts.storyboards === 1 &&
    currentSnapshotManifest.episode.storyboards[0]?.id === 'flat-sb' &&
    currentSnapshotManifest.episode.subtitles?.[0]?.cueCount === 1,
  JSON.stringify(currentSnapshotManifest.episode),
)
const currentSnapshotItems = producedEpisodeExportItems(currentSnapshotProject).map((item) => ({ ...item, exportedPath: `/exports/${item.fileName}` }))
const currentSnapshotSeasonManifest = buildEpisodeExportManifest(currentSnapshotProject, currentSnapshotItems)
check(
  'season export manifest snapshots current flat subtitles',
  currentSnapshotSeasonManifest.episodes.find((item) => item.episodeId === 'ep1')?.subtitles?.[0]?.cueCount === 1,
  JSON.stringify(currentSnapshotSeasonManifest.episodes),
)

if (failures) {
  console.error(`\nepisodeExport selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nepisodeExport selftest: ALL PASSED')
