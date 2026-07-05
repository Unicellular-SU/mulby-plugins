import { makeProjectReadTools } from './agentTools'
import type { Episode, ProjectDoc, ProjectMeta, Storyboard, StoryboardTableScene } from '../../domain/types'

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
  assets: [],
  storyboards: [storyboard('sb-current', 0, 'Current shot only.')],
  clips: [],
  track: [],
  memory: [],
  currentEpisodeId: 'ep1',
  episodes: [
    episode('ep1', 0),
    episode('ep2', 1, {
      title: 'Second',
      scripts: [{ id: 'script-ep2', name: 'Hidden Script', content: 'The hidden clue is found in episode two.', createdAt: 0, updatedAt: 0 }],
      storyboards: [storyboard('sb-ep2', 0, 'The hidden clue glows in the hallway.')],
      storyboardTable: table('Hidden clue scene'),
      clips: [{ id: 'clip-ep2', storyboardId: 'sb-ep2', durationSec: 4, state: 'done', videoFilePath: 'ep2.mp4' }],
      track: [{ id: 'track-ep2', storyboardIds: ['sb-ep2'], clipIds: ['clip-ep2'], selectClipId: 'clip-ep2', order: 0 }],
    }),
  ],
}

const tools = makeProjectReadTools(() => doc)
const searchProject = tools.find((tool) => tool.name === 'search_project')
const getWorkspace = tools.find((tool) => tool.name === 'get_workspace')
const getScript = tools.find((tool) => tool.name === 'get_script')
const getStoryboards = tools.find((tool) => tool.name === 'get_storyboards')
const getStoryboardTable = tools.find((tool) => tool.name === 'get_storyboard_table')
const getTimeline = tools.find((tool) => tool.name === 'get_timeline')

if (!searchProject || !getWorkspace || !getScript || !getStoryboards || !getStoryboardTable || !getTimeline) {
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

const ep2Script = JSON.parse(await getScript.execute({ episodeIndex: 2, contentLimit: 200 }))
check('get_script reads non-current episode by episode index', ep2Script.id === 'script-ep2' && ep2Script.episodeId === 'ep2' && ep2Script.content?.text.includes('hidden clue'), JSON.stringify(ep2Script))

const ep2Storyboards = JSON.parse(await getStoryboards.execute({ episodeTitle: 'Second' }))
check('get_storyboards reads non-current episode by title', ep2Storyboards.storyboards?.[0]?.id === 'sb-ep2' && ep2Storyboards.episodeId === 'ep2', JSON.stringify(ep2Storyboards))

const ep2Table = JSON.parse(await getStoryboardTable.execute({ episodeId: 'ep2' }))
check('get_storyboard_table reads non-current episode by id', ep2Table.scenes?.[0]?.sceneName === 'Hidden clue scene' && ep2Table.episodeIndex === 2, JSON.stringify(ep2Table))

const ep2Timeline = JSON.parse(await getTimeline.execute({ episodeIndex: 2 }))
check('get_timeline reads non-current episode by episode index', ep2Timeline.tracks?.[0]?.id === 'track-ep2' && ep2Timeline.clips?.[0]?.id === 'clip-ep2' && ep2Timeline.episodeId === 'ep2', JSON.stringify(ep2Timeline))

if (failures) {
  console.error(`\nagentTools selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nagentTools selftest: ALL PASSED')
