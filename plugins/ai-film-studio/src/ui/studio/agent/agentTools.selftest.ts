import { makeAgentTools, makeProjectReadTools } from './agentTools'
import type { Episode, ProjectDoc, ProjectMeta, Storyboard, StoryboardTableScene } from '../../domain/types'
import type { ProjectState } from '../../store/projectStore'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

function meta(): ProjectMeta {
  return { id: 'p1', name: 'series', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 }
}

function storyboard(id: string, index: number, videoDesc: string): Storyboard {
  return {
    id,
    index,
    track: 'main',
    videoDesc,
    duration: 4,
    associateAssetIds: [],
    shouldGenerateImage: true,
    state: 'idle',
  }
}

function table(sceneName: string): StoryboardTableScene[] {
  return [{ id: `scene-${sceneName}`, sceneName, castNames: [], segments: [{ id: 'seg1', title: 'Segment', rows: [{ index: 1, videoDesc: 'hidden clue board row', duration: 4, assetRefNames: [] }] }] }]
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

const doc: ProjectDoc = {
  meta: meta(),
  novel: [],
  scripts: [{ id: 'script-current', name: 'Current Script', content: 'Current episode only.', createdAt: 0, updatedAt: 0 }],
  assets: [{ id: 'hero', type: 'role', name: 'Hero', state: 'done', variants: [{ id: 'gala', label: 'Gala' }] }],
  storyboards: [{ ...storyboard('sb-current', 0, 'Current shot only.'), associateAssetIds: ['hero'], castRefs: [{ assetId: 'hero' }] }],
  clips: [],
  track: [],
  memory: [],
  currentEpisodeId: 'ep1',
  episodes: [
    episode('ep1', 0, { productionRecap: 'Hero entered with the original look.' }),
    episode('ep2', 1, {
      title: 'Second',
      seriesSkip: true,
      scripts: [{ id: 'script-ep2', name: 'Hidden Script', content: 'The hidden clue is found in episode two.', createdAt: 0, updatedAt: 0 }],
      storyboards: [{ ...storyboard('sb-ep2', 0, 'The hidden clue glows in the hallway.'), associateAssetIds: ['hero'], castRefs: [{ assetId: 'hero', variantId: 'gala' }] }],
      storyboardTable: table('Hidden clue scene'),
      clips: [{ id: 'clip-ep2', storyboardId: 'sb-ep2', durationSec: 4, state: 'done', videoFilePath: 'ep2.mp4' }],
      track: [{ id: 'track-ep2', storyboardIds: ['sb-ep2'], clipIds: ['clip-ep2'], selectClipId: 'clip-ep2', order: 0 }],
    }),
  ],
}

const tools = makeProjectReadTools(() => doc)
const searchProject = tools.find((tool) => tool.name === 'search_project')
const getWorkspace = tools.find((tool) => tool.name === 'get_workspace')
const getEpisodeHandoff = tools.find((tool) => tool.name === 'get_episode_handoff')
const getScript = tools.find((tool) => tool.name === 'get_script')
const getStoryboards = tools.find((tool) => tool.name === 'get_storyboards')
const getStoryboardTable = tools.find((tool) => tool.name === 'get_storyboard_table')
const getTimeline = tools.find((tool) => tool.name === 'get_timeline')

if (!searchProject || !getWorkspace || !getEpisodeHandoff || !getScript || !getStoryboards || !getStoryboardTable || !getTimeline) {
  console.error('  FAIL tools exist: required read tools missing')
  process.exit(1)
}

const search = JSON.parse(await searchProject.execute({ query: 'hidden clue', domains: ['scripts', 'storyboards', 'storyboardTable'], limit: 10 }))
check('search_project finds non-current episode scripts', search.scripts?.some((item: { id: string; episodeId: string }) => item.id === 'script-ep2' && item.episodeId === 'ep2'), JSON.stringify(search.scripts))
check('search_project finds non-current episode storyboards', search.storyboards?.some((item: { id: string; episodeIndex: number }) => item.id === 'sb-ep2' && item.episodeIndex === 2), JSON.stringify(search.storyboards))
check('search_project finds non-current episode storyboard table', search.storyboardTable?.some((item: { scene: { sceneName: string }; episodeId: string }) => item.scene.sceneName === 'Hidden clue scene' && item.episodeId === 'ep2'), JSON.stringify(search.storyboardTable))

const workspace = JSON.parse(await getWorkspace.execute({}))
check('get_workspace counts all episode storyboards', workspace.counts?.storyboards === 2, JSON.stringify(workspace.counts))
check('get_workspace lists script episode ownership', workspace.scripts?.some((item: { id: string; episodeId: string }) => item.id === 'script-ep2' && item.episodeId === 'ep2'), JSON.stringify(workspace.scripts))
check('get_workspace exposes skipped series queue state', workspace.episodes?.some((item: { id: string; seriesSkip?: boolean; seriesQueueState?: string }) => item.id === 'ep2' && item.seriesSkip === true && item.seriesQueueState === 'skipped'), JSON.stringify(workspace.episodes))

const handoff = JSON.parse(await getEpisodeHandoff.execute({ episodeIndex: 2 }))
check('get_episode_handoff exposes prior recap and shared cast refs', handoff.episodeId === 'ep2' && handoff.recaps?.[0]?.episodeId === 'ep1' && handoff.sharedAssets?.some((cue: { assetId: string; label: string }) => cue.assetId === 'hero' && cue.label === 'Hero-Gala'), JSON.stringify(handoff))

const ep2Script = JSON.parse(await getScript.execute({ episodeIndex: 2, contentLimit: 200 }))
check('get_script reads non-current episode by episode index', ep2Script.id === 'script-ep2' && ep2Script.episodeId === 'ep2' && ep2Script.content?.text.includes('hidden clue'), JSON.stringify(ep2Script))

const ep2Storyboards = JSON.parse(await getStoryboards.execute({ episodeTitle: 'Second' }))
check('get_storyboards reads non-current episode by title', ep2Storyboards.storyboards?.[0]?.id === 'sb-ep2' && ep2Storyboards.episodeId === 'ep2', JSON.stringify(ep2Storyboards))

const ep2Table = JSON.parse(await getStoryboardTable.execute({ episodeId: 'ep2' }))
check('get_storyboard_table reads non-current episode by id', ep2Table.scenes?.[0]?.sceneName === 'Hidden clue scene' && ep2Table.episodeIndex === 2, JSON.stringify(ep2Table))

const ep2Timeline = JSON.parse(await getTimeline.execute({ episodeIndex: 2 }))
check('get_timeline reads non-current episode by episode index', ep2Timeline.tracks?.[0]?.id === 'track-ep2' && ep2Timeline.clips?.[0]?.id === 'clip-ep2' && ep2Timeline.episodeId === 'ep2', JSON.stringify(ep2Timeline))

function cloneDoc(input: ProjectDoc): ProjectDoc {
  return JSON.parse(JSON.stringify(input)) as ProjectDoc
}

function makeWritableState(initial: ProjectDoc): ProjectState {
  const current = initial
  let nextStoryboard = 1

  const syncCurrentEpisode = () => {
    const episode = current.episodes?.find((item) => item.id === current.currentEpisodeId)
    if (!episode) return
    episode.scripts = current.scripts
    episode.storyboards = current.storyboards
    episode.storyboardTable = current.storyboardTable
    episode.clips = current.clips
    episode.track = current.track
  }
  const applyEpisode = (episode: Episode) => {
    current.scripts = episode.scripts
    current.storyboards = episode.storyboards
    current.storyboardTable = episode.storyboardTable
    current.clips = episode.clips
    current.track = episode.track
  }

  const state = {
    get doc() {
      return current
    },
    switchEpisode: (id: string) => {
      if (current.currentEpisodeId === id) return
      syncCurrentEpisode()
      const episode = current.episodes?.find((item) => item.id === id)
      if (!episode) return
      current.currentEpisodeId = episode.id
      applyEpisode(episode)
    },
    upsertStoryboard: (s: Partial<Storyboard> & { videoDesc: string }) => {
      const id = s.id ?? `sb-write-${nextStoryboard++}`
      const index = current.storyboards.findIndex((item) => item.id === id)
      const base = index >= 0 ? current.storyboards[index] : storyboard(id, current.storyboards.length, s.videoDesc)
      const merged: Storyboard = {
        ...base,
        ...s,
        id,
        index: index >= 0 ? base.index : current.storyboards.length,
        videoDesc: s.videoDesc,
        associateAssetIds: s.associateAssetIds ?? base.associateAssetIds ?? [],
        shouldGenerateImage: s.shouldGenerateImage ?? base.shouldGenerateImage ?? true,
        state: s.state ?? base.state ?? 'idle',
      }
      if (index >= 0) current.storyboards[index] = merged
      else current.storyboards.push(merged)
      return id
    },
    setStoryboardCastVariant: (storyboardId: string, assetId: string, variantId: string | undefined) => {
      const sb = current.storyboards.find((item) => item.id === storyboardId)
      if (!sb) return
      const refs = (sb.castRefs?.length ? [...sb.castRefs] : sb.associateAssetIds.map((id) => ({ assetId: id })))
      const existing = refs.find((ref) => ref.assetId === assetId)
      if (existing) existing.variantId = variantId
      else refs.push({ assetId, variantId })
      sb.castRefs = refs
      sb.associateAssetIds = [...new Set(refs.map((ref) => ref.assetId))]
    },
    setCurrentEpisodeSeriesSkip: (skip: boolean) => {
      const episode = current.episodes?.find((item) => item.id === current.currentEpisodeId)
      if (episode) episode.seriesSkip = skip || undefined
    },
  }
  return state as unknown as ProjectState
}

const writableDoc = cloneDoc(doc)
writableDoc.assets = [{ id: 'hero', type: 'role', name: 'Hero', state: 'done', variants: [{ id: 'gala', label: 'Gala' }] }]
writableDoc.episodes![1].storyboards = [storyboard('sb-ep2-original', 0, 'Second episode original shot.')]
const writeState = makeWritableState(writableDoc)
const writeTools = makeAgentTools(() => writeState)
const addStoryboard = writeTools.find((tool) => tool.name === 'add_storyboard')
const setCastVariant = writeTools.find((tool) => tool.name === 'set_storyboard_cast_variant')
const setEpisodeSeriesSkip = writeTools.find((tool) => tool.name === 'set_episode_series_skip')

if (!addStoryboard || !setCastVariant || !setEpisodeSeriesSkip) {
  console.error('  FAIL write tools exist: required write tools missing')
  process.exit(1)
}

const addedStoryboard = JSON.parse(await addStoryboard.execute({ episodeIndex: 2, videoDesc: 'Second episode new shot.', cast: ['Hero'] }))
const ep1AfterAdd = writableDoc.episodes?.find((item) => item.id === 'ep1')
check('add_storyboard writes selected non-current episode', writableDoc.currentEpisodeId === 'ep2' && addedStoryboard.episode?.episodeId === 'ep2' && addedStoryboard.storyboard?.videoDesc === 'Second episode new shot.', JSON.stringify(addedStoryboard))
check('add_storyboard does not append to previous current episode', !ep1AfterAdd?.storyboards.some((item) => item.videoDesc === 'Second episode new shot.'), JSON.stringify(ep1AfterAdd?.storyboards))

const variantResult = JSON.parse(await setCastVariant.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero', variantLabel: 'Gala' }))
check('set_storyboard_cast_variant writes selected episode storyboard', variantResult.episode?.episodeId === 'ep2' && variantResult.storyboard?.castRefs?.some((ref: { assetId: string; variantId?: string }) => ref.assetId === 'hero' && ref.variantId === 'gala'), JSON.stringify(variantResult))

const restoredEpisode = JSON.parse(await setEpisodeSeriesSkip.execute({ episodeTitle: 'Second', skip: false }))
check('set_episode_series_skip restores selected episode queue state', restoredEpisode.episode?.id === 'ep2' && restoredEpisode.episode?.seriesSkip === false && restoredEpisode.episode?.seriesQueueState === 'pending', JSON.stringify(restoredEpisode))

if (failures) {
  console.error(`\nagentTools selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nagentTools selftest: ALL PASSED')
