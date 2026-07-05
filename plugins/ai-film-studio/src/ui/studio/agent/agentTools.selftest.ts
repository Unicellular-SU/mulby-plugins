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
    }),
  ],
}

const tools = makeProjectReadTools(() => doc)
const searchProject = tools.find((tool) => tool.name === 'search_project')
const getWorkspace = tools.find((tool) => tool.name === 'get_workspace')

if (!searchProject || !getWorkspace) {
  console.error('  FAIL tools exist: search_project/get_workspace missing')
  process.exit(1)
}

const search = JSON.parse(await searchProject.execute({ query: 'hidden clue', domains: ['scripts', 'storyboards', 'storyboardTable'], limit: 10 }))
check('search_project finds non-current episode scripts', search.scripts?.some((item: { id: string; episodeId: string }) => item.id === 'script-ep2' && item.episodeId === 'ep2'), JSON.stringify(search.scripts))
check('search_project finds non-current episode storyboards', search.storyboards?.some((item: { id: string; episodeIndex: number }) => item.id === 'sb-ep2' && item.episodeIndex === 2), JSON.stringify(search.storyboards))
check('search_project finds non-current episode storyboard table', search.storyboardTable?.some((item: { scene: { sceneName: string }; episodeId: string }) => item.scene.sceneName === 'Hidden clue scene' && item.episodeId === 'ep2'), JSON.stringify(search.storyboardTable))

const workspace = JSON.parse(await getWorkspace.execute({}))
check('get_workspace counts all episode storyboards', workspace.counts?.storyboards === 2, JSON.stringify(workspace.counts))
check('get_workspace lists script episode ownership', workspace.scripts?.some((item: { id: string; episodeId: string }) => item.id === 'script-ep2' && item.episodeId === 'ep2'), JSON.stringify(workspace.scripts))

if (failures) {
  console.error(`\nagentTools selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nagentTools selftest: ALL PASSED')
