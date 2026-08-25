import { makeAgentTools, makeProjectReadTools } from './agentTools'
import { declareAppearanceChange, revertToInheritedAppearance } from '../../domain/continuityLedger'
import type { AppearanceChange, Asset, AssetVariant, Clip, Episode, ProjectDoc, ProjectMeta, Script, Storyboard, StoryboardCastRef, StoryboardTableScene, VideoTrack } from '../../domain/types'
import type { ProjectState } from '../../store/projectStore'
import { projectAssetIdentityEntityId } from '../../services/assetHub'

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
  return [{ id: `scene-${sceneName}`, sceneName, castNames: ['主角'], segments: [{ id: 'seg1', title: 'Segment', rows: [{ index: 1, videoDesc: 'hidden clue board row', duration: 4, assetRefNames: ['主角'] }] }] }]
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
  seriesBible: { logline: 'A hidden heir returns.', plannedEpisodeCount: 3 },
  novel: [
    { id: 'ch1', index: 0, title: 'Return', text: 'The hidden heir returns.', event: 'Hero returns.', eventState: 'done' },
    { id: 'ch2', index: 1, title: 'Hidden Clue', text: 'The hidden clue appears.', event: 'Hero finds a clue.', eventState: 'done' },
  ],
  scripts: [{ id: 'script-current', name: 'Current Script', content: 'Current episode only.', createdAt: 0, updatedAt: 0 }],
  assets: [{
    id: 'hero',
    type: 'role',
    name: 'Hero',
    aliases: ['主角'],
    elementId: 'el-hero',
    libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot', variantMap: { gala: 'lib-gala' } },
    state: 'done',
    variants: [{ id: 'gala', label: 'Gala', libraryVariantId: 'lib-gala', variantKind: 'makeup' }],
  }],
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
      novelChapterIds: ['ch2'],
      plan: { hook: 'A clue appears.' },
      scripts: [{ id: 'script-ep2', name: 'Hidden Script', content: 'The hidden clue is found in episode two.', createdAt: 0, updatedAt: 0 }],
      storyboards: [{ ...storyboard('sb-ep2', 0, 'The hidden clue glows in the hallway.'), associateAssetIds: ['hero'], castRefs: [{ assetId: 'hero', variantId: 'gala' }] }],
      storyboardTable: table('Hidden clue scene'),
      clips: [{ id: 'clip-ep2', storyboardId: 'sb-ep2', durationSec: 4, state: 'done', videoFilePath: 'ep2.mp4' }],
      track: [{ id: 'track-ep2', storyboardIds: ['sb-ep2'], clipIds: ['clip-ep2'], selectClipId: 'clip-ep2', order: 0 }],
    }),
    episode('ep3', 2, { title: 'Third' }),
  ],
}

const readStorage = new Map<string, unknown>([
  ['assets:registry', []],
  ['assets:boards', []],
  ['projects:index', []],
  ['snapshots', []],
  ['elements:library', [{ id: 'el-hero', kind: 'character', name: 'Hero', aliases: ['主角'], createdAt: 0, updatedAt: 1, version: 2 }]],
  ['studio:index', [{ id: 'p1', name: 'series', artStyle: 'cinematic', videoRatio: '16:9', updatedAt: 0, storyboardCount: 2, episodeCount: 3 }]],
  ['studio:project:p1', doc],
])
;(globalThis as unknown as { window: unknown }).window = {
  mulby: {
    storage: {
      get: async (key: string) => {
        const value = readStorage.get(key)
        return value ? JSON.parse(JSON.stringify(value)) : value
      },
      attachment: { list: async () => [] },
    },
  },
}

const tools = makeProjectReadTools(() => doc)
const searchProject = tools.find((tool) => tool.name === 'search_project')
const getWorkspace = tools.find((tool) => tool.name === 'get_workspace')
const getEpisodes = tools.find((tool) => tool.name === 'get_episodes')
const getSeriesBible = tools.find((tool) => tool.name === 'get_series_bible')
const getContinuityReport = tools.find((tool) => tool.name === 'get_continuity_report')
const getEpisodeHandoff = tools.find((tool) => tool.name === 'get_episode_handoff')
const getScript = tools.find((tool) => tool.name === 'get_script')
const getStoryboards = tools.find((tool) => tool.name === 'get_storyboards')
const getAssets = tools.find((tool) => tool.name === 'get_assets')
const getNovel = tools.find((tool) => tool.name === 'get_novel')
const getStoryboardTable = tools.find((tool) => tool.name === 'get_storyboard_table')
const getTimeline = tools.find((tool) => tool.name === 'get_timeline')

if (!searchProject || !getWorkspace || !getEpisodes || !getSeriesBible || !getContinuityReport || !getEpisodeHandoff || !getScript || !getStoryboards || !getAssets || !getNovel || !getStoryboardTable || !getTimeline) {
  console.error('  FAIL tools exist: required read tools missing')
  process.exit(1)
}

const search = JSON.parse(await searchProject.execute({ query: 'hidden clue', domains: ['scripts', 'storyboards', 'storyboardTable'], limit: 10 }))
check('search_project finds non-current episode scripts', search.scripts?.some((item: { id: string; episodeId: string }) => item.id === 'script-ep2' && item.episodeId === 'ep2'), JSON.stringify(search.scripts))
check(
  'search_project exposes script episode plan usage',
  search.scripts?.some((item: { id: string; episodePlan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'script-ep2' &&
    item.episodePlan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(search.scripts),
)
check('search_project finds non-current episode storyboards', search.storyboards?.some((item: { id: string; episodeIndex: number }) => item.id === 'sb-ep2' && item.episodeIndex === 2), JSON.stringify(search.storyboards))
check('search_project finds non-current episode storyboard table', search.storyboardTable?.some((item: { scene: { sceneName: string }; episodeId: string }) => item.scene.sceneName === 'Hidden clue scene' && item.episodeId === 'ep2'), JSON.stringify(search.storyboardTable))
check(
  'search_project exposes storyboard cast asset usage',
  search.storyboards?.some((item: { id: string; castAssets?: Array<{ assetId: string; variantId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }> }) =>
    item.id === 'sb-ep2' &&
    item.castAssets?.some(
      (asset) =>
        asset.assetId === 'hero' &&
        asset.variantId === 'gala' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(search.storyboards),
)
check(
  'search_project exposes storyboard episode plan usage',
  search.storyboards?.some((item: { id: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'sb-ep2' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(search.storyboards),
)
check(
  'search_project exposes storyboard table resolved asset usage',
  search.storyboardTable?.some((item: { scene: { sceneName: string; resolvedCastAssets?: Array<{ name: string; assetId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }>; segments?: Array<{ rows?: Array<{ resolvedAssetRefs?: Array<{ name: string; assetId?: string; assetCenterUsage?: { currentProject?: { appearanceLabels?: string[] } } }> }> }> } }) =>
    item.scene.sceneName === 'Hidden clue scene' &&
    item.scene.resolvedCastAssets?.some(
      (asset) =>
        asset.name === '主角' &&
        asset.assetId === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second'),
    ) &&
    item.scene.segments?.[0]?.rows?.[0]?.resolvedAssetRefs?.some(
      (asset) =>
        asset.name === '主角' &&
        asset.assetId === 'hero' &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(search.storyboardTable),
)
check(
  'search_project exposes storyboard table episode plan usage',
  search.storyboardTable?.some((item: { scene: { sceneName: string }; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.scene.sceneName === 'Hidden clue scene' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(search.storyboardTable),
)

const episodeSearch = JSON.parse(await searchProject.execute({ query: 'Second', domains: ['episodes'], limit: 10 }))
check(
  'search_project exposes episode plan asset and variant usage',
  episodeSearch.episodes?.some((item: { id: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'ep2' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(episodeSearch.episodes),
)

const novelSearch = JSON.parse(await searchProject.execute({ query: 'hidden clue appears', domains: ['novel'], limit: 10 }))
check(
  'search_project exposes novel assigned episode plan usage',
  novelSearch.novel?.some((chapter: { id: string; episodes?: Array<{ id: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }> }) =>
    chapter.id === 'ch2' &&
    chapter.episodes?.some(
      (episode) =>
        episode.id === 'ep2' &&
        episode.plan?.castFromStoryboards?.some(
          (asset) =>
            asset.id === 'hero' &&
            asset.assetCenterUsage?.entityId === 'el-hero' &&
            asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
            asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
        ) &&
        true,
    ),
  ),
  JSON.stringify(novelSearch),
)

const assetAliasSearch = JSON.parse(await searchProject.execute({ query: '主角', domains: ['assets'], limit: 10 }))
check('search_project finds assets by alias', assetAliasSearch.assets?.some((item: { id: string; aliases?: string[] }) => item.id === 'hero' && item.aliases?.includes('主角')), JSON.stringify(assetAliasSearch.assets))
check(
  'search_project exposes asset-center usage for assets',
  assetAliasSearch.assets?.some((item: { id: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
    item.id === 'hero' &&
    item.libraryEntityId === 'el-hero' &&
    item.libraryEntityVersion === 1 &&
    item.librarySyncPolicy === 'snapshot' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E1 Episode 1') &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
    item.assetCenterUsage?.currentProject?.appearanceLabels?.some((label) => label.includes('E2 Second') && label.includes('Gala')),
  ),
  JSON.stringify(assetAliasSearch.assets),
)

const aliasFilteredAssets = JSON.parse(await getAssets.execute({ name: '主角', includeImages: false }))
check('get_assets filters by asset aliases', aliasFilteredAssets.assets?.some((item: { id: string }) => item.id === 'hero'), JSON.stringify(aliasFilteredAssets.assets))
check(
  'get_assets exposes asset-center episode and appearance usage',
  aliasFilteredAssets.assets?.some((item: { id: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
    item.id === 'hero' &&
    item.libraryEntityId === 'el-hero' &&
    item.libraryEntityVersion === 1 &&
    item.librarySyncPolicy === 'snapshot' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.join('、') === 'E1 Episode 1、E2 Second' &&
    item.assetCenterUsage?.currentProject?.appearanceLabels?.join('、') === 'E1 Episode 1 · 主形象、E2 Second · Gala',
  ),
  JSON.stringify(aliasFilteredAssets.assets),
)

const workspace = JSON.parse(await getWorkspace.execute({}))
check('get_workspace counts all episode storyboards', workspace.counts?.storyboards === 2, JSON.stringify(workspace.counts))
check('get_workspace exposes series bible summary', workspace.seriesBible?.logline === 'A hidden heir returns.' && workspace.seriesBible?.plannedEpisodeCount === 3, JSON.stringify(workspace.seriesBible))
check('get_workspace lists script episode ownership', workspace.scripts?.some((item: { id: string; episodeId: string }) => item.id === 'script-ep2' && item.episodeId === 'ep2'), JSON.stringify(workspace.scripts))
check(
  'get_workspace exposes script episode plan usage',
  workspace.scripts?.some((item: { id: string; episodePlan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'script-ep2' &&
    item.episodePlan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(workspace.scripts),
)
check('get_workspace exposes skipped series queue state', workspace.episodes?.some((item: { id: string; seriesSkip?: boolean; seriesQueueState?: string }) => item.id === 'ep2' && item.seriesSkip === true && item.seriesQueueState === 'skipped'), JSON.stringify(workspace.episodes))
check(
  'get_workspace exposes episode plan asset and variant usage',
  workspace.episodes?.some((item: { id: string; plan?: { castFromStoryboards?: Array<{ id: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'ep2' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.libraryEntityId === 'el-hero' &&
        asset.libraryEntityVersion === 1 &&
        asset.librarySyncPolicy === 'snapshot' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(workspace.episodes),
)
check('get_workspace exposes asset-center usage summary', workspace.assets?.some((item: { id: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }) => item.id === 'hero' && item.libraryEntityId === 'el-hero' && item.libraryEntityVersion === 1 && item.librarySyncPolicy === 'snapshot' && item.assetCenterUsage?.entityId === 'el-hero' && item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second')), JSON.stringify(workspace.assets))
check(
  'get_workspace exposes storyboard cast asset usage summary',
  workspace.storyboards?.some((item: { id: string; episodeId?: string; castAssets?: Array<{ assetId: string; variantId?: string; variantKind?: string; libraryEntityId?: string; libraryVariantId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }> }) =>
    item.id === 'sb-ep2' &&
    item.episodeId === 'ep2' &&
    item.castAssets?.some(
      (asset) =>
        asset.assetId === 'hero' &&
        asset.variantId === 'gala' &&
        asset.variantKind === 'makeup' &&
        asset.libraryEntityId === 'el-hero' &&
        asset.libraryVariantId === 'lib-gala' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(workspace.storyboards),
)
check(
  'get_workspace exposes storyboard episode plan usage summary',
  workspace.storyboards?.some((item: { id: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'sb-ep2' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(workspace.storyboards),
)
check(
  'get_workspace exposes novel assigned episode plan usage',
  workspace.novel?.some((chapter: { id: string; episodes?: Array<{ id: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }> }) =>
    chapter.id === 'ch2' &&
    chapter.episodes?.some(
      (episode) =>
        episode.id === 'ep2' &&
        episode.plan?.castFromStoryboards?.some(
          (asset) =>
            asset.id === 'hero' &&
            asset.assetCenterUsage?.entityId === 'el-hero' &&
            asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
            asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
        ) &&
        true,
    ),
  ),
  JSON.stringify(workspace.novel),
)
check(
  'get_workspace exposes episode handoff summary',
  workspace.episodes?.some((item: { id: string; handoff?: { suggestionCount?: number; autoRepairableSuggestionCount?: number; suggestions?: Array<{ id: string; kind: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }> } }) =>
    item.id === 'ep2' &&
    !!item.handoff?.suggestionCount &&
    !!item.handoff?.autoRepairableSuggestionCount &&
    item.handoff?.suggestions?.some(
      (suggestion) =>
        suggestion.id === 'asset-image:hero' &&
        suggestion.kind === 'generate_asset_ref_image' &&
        suggestion.assetCenterUsage?.entityId === 'el-hero' &&
        suggestion.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second'),
    ),
  ),
  JSON.stringify(workspace.episodes),
)

const episodesRead = JSON.parse(await getEpisodes.execute({}))
check(
  'get_episodes exposes episode plan asset and variant usage',
  episodesRead.episodes?.some((item: { id: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'ep2' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(episodesRead.episodes),
)

const novelRead = JSON.parse(await getNovel.execute({ chapterId: 'ch2' }))
check(
  'get_novel exposes assigned episode plan usage',
  novelRead.chapters?.some((chapter: { id: string; episodes?: Array<{ id: string; seriesQueueState?: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }> }) =>
    chapter.id === 'ch2' &&
    chapter.episodes?.some(
      (episode) =>
        episode.id === 'ep2' &&
        episode.seriesQueueState === 'skipped' &&
        episode.plan?.castFromStoryboards?.some(
          (asset) =>
            asset.id === 'hero' &&
            asset.assetCenterUsage?.entityId === 'el-hero' &&
            asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
            asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
        ) &&
        true,
    ),
  ),
  JSON.stringify(novelRead),
)

const continuityReport = JSON.parse(await getContinuityReport.execute({}))
check(
  'get_continuity_report exposes cast asset-center usage',
  continuityReport.episodes?.some((episode: { id: string; castUses?: Array<{ assetId: string; variantId?: string; variantKind?: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; libraryVariantId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }> }) =>
    episode.id === 'ep2' &&
    episode.castUses?.some((use) =>
      use.assetId === 'hero' &&
      use.variantId === 'gala' &&
      use.variantId === 'gala' &&
      use.assetCenterUsage?.entityId === 'el-hero' &&
      use.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(continuityReport.episodes),
)
check(
  'get_continuity_report groups issues into the six categories',
  continuityReport.episodes?.some((episode: { id: string; issues?: Array<{ code: string; category?: string; variantId?: string; expectedVariantLabel?: string }> }) =>
    episode.id === 'ep2' &&
    episode.issues?.some((issue) => issue.code === 'missing_ref_image' && issue.category === 'blocking' && issue.variantId === 'gala') &&
    episode.issues?.some((issue) => issue.code === 'unexplained_appearance_change' && issue.category === 'appearance' && issue.expectedVariantLabel === '主形象'),
  ),
  JSON.stringify(continuityReport.episodes),
)

const seriesBible = JSON.parse(await getSeriesBible.execute({}))
check('get_series_bible returns bible and episode plans', seriesBible.seriesBible?.logline === 'A hidden heir returns.' && seriesBible.episodes?.some((item: { episodeId: string; plan?: { hook?: string } }) => item.episodeId === 'ep2' && item.plan?.hook === 'A clue appears.'), JSON.stringify(seriesBible))
check(
  'get_series_bible exposes episode plan asset and variant usage',
  seriesBible.episodes?.some((item: { episodeId: string; plan?: { castFromStoryboards?: Array<{ id: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.episodeId === 'ep2' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.libraryEntityId === 'el-hero' &&
        asset.libraryEntityVersion === 1 &&
        asset.librarySyncPolicy === 'snapshot' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ) &&
    true,
  ),
  JSON.stringify(seriesBible.episodes),
)
check(
  'get_series_bible exposes asset-center usage for planning assets',
  seriesBible.availableAssets?.some((item: { id: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
    item.id === 'hero' &&
    item.libraryEntityId === 'el-hero' &&
    item.libraryEntityVersion === 1 &&
    item.librarySyncPolicy === 'snapshot' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
    item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ),
  JSON.stringify(seriesBible.availableAssets),
)
check(
  'get_series_bible exposes available variant asset-center usage',
  seriesBible.availableVariants?.some((item: { id: string; assetId: string; variantKind?: string; libraryEntityId?: string; libraryVariantId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
    item.id === 'gala' &&
    item.assetId === 'hero' &&
    item.variantKind === 'makeup' &&
    item.libraryEntityId === 'el-hero' &&
    item.libraryVariantId === 'lib-gala' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
    item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ),
  JSON.stringify(seriesBible.availableVariants),
)

const handoff = JSON.parse(await getEpisodeHandoff.execute({ episodeIndex: 2 }))
check('get_episode_handoff exposes prior recap and carried state', handoff.episodeId === 'ep2' && handoff.recaps?.[0]?.episodeId === 'ep1' && handoff.carriedState?.some((cue: { assetId: string; label: string }) => cue.assetId === 'hero'), JSON.stringify(handoff))
check(
  'get_episode_handoff carried state describes the inherited look',
  handoff.carriedState?.some((cue: { assetId: string; assetName: string; assetType: string; assetCenterUsage?: { entityId?: string } }) =>
    cue.assetId === 'hero' && cue.assetName === 'Hero' && cue.assetType === 'role' && cue.assetCenterUsage?.entityId === 'el-hero',
  ),
  JSON.stringify(handoff.carriedState),
)
check(
  'get_episode_handoff only emits reference-image suggestions',
  Array.isArray(handoff.suggestions) &&
    handoff.suggestions.length > 0 &&
    handoff.suggestions.every((item: { kind: string }) => item.kind === 'generate_asset_ref_image' || item.kind === 'generate_variant_ref_image'),
  JSON.stringify(handoff.suggestions),
)
check(
  'get_episode_handoff returns episode plan usage',
  handoff.plan?.castFromStoryboards?.some(
    (asset: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
      asset.id === 'hero' &&
      asset.assetCenterUsage?.entityId === 'el-hero' &&
      asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
      asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ) &&
    true,
  JSON.stringify(handoff.plan),
)
const emptyEpisodeHandoff = JSON.parse(await getEpisodeHandoff.execute({ episodeIndex: 3 }))
check(
  'get_episode_handoff carries prior refs for empty episode',
  emptyEpisodeHandoff.episodeId === 'ep3' && emptyEpisodeHandoff.carriedState?.some((cue: { assetId: string }) => cue.assetId === 'hero'),
  JSON.stringify(emptyEpisodeHandoff),
)

const ep2Script = JSON.parse(await getScript.execute({ episodeIndex: 2, contentLimit: 200 }))
check('get_script reads non-current episode by episode index', ep2Script.id === 'script-ep2' && ep2Script.episodeId === 'ep2' && ep2Script.content?.text.includes('hidden clue'), JSON.stringify(ep2Script))
check(
  'get_script exposes episode plan usage',
  ep2Script.episodePlan?.castFromStoryboards?.some(
    (asset: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
      asset.id === 'hero' &&
      asset.assetCenterUsage?.entityId === 'el-hero' &&
      asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
      asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ) &&
    true,
  JSON.stringify(ep2Script),
)

const ep2Storyboards = JSON.parse(await getStoryboards.execute({ episodeTitle: 'Second' }))
check('get_storyboards reads non-current episode by title', ep2Storyboards.storyboards?.[0]?.id === 'sb-ep2' && ep2Storyboards.episodeId === 'ep2', JSON.stringify(ep2Storyboards))
check(
  'get_storyboards exposes cast asset-center usage',
  ep2Storyboards.storyboards?.[0]?.castAssets?.some((item: { assetId: string; variantId?: string; variantKind?: string; label?: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; libraryVariantId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }) =>
    item.assetId === 'hero' &&
    item.variantId === 'gala' &&
    item.variantKind === 'makeup' &&
    item.label === 'Hero-Gala' &&
    item.libraryEntityId === 'el-hero' &&
    item.libraryEntityVersion === 1 &&
    item.librarySyncPolicy === 'snapshot' &&
    item.libraryVariantId === 'lib-gala' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ),
  JSON.stringify(ep2Storyboards.storyboards),
)
check(
  'get_storyboards returns episode plan usage',
  ep2Storyboards.plan?.castFromStoryboards?.some(
    (asset: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
      asset.id === 'hero' &&
      asset.assetCenterUsage?.entityId === 'el-hero' &&
      asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
      asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ) &&
    true,
  JSON.stringify(ep2Storyboards.plan),
)

const ep2Table = JSON.parse(await getStoryboardTable.execute({ episodeId: 'ep2' }))
check('get_storyboard_table reads non-current episode by id', ep2Table.scenes?.[0]?.sceneName === 'Hidden clue scene' && ep2Table.episodeIndex === 2, JSON.stringify(ep2Table))
check(
  'get_storyboard_table resolves asset-center usage for design refs',
  ep2Table.scenes?.[0]?.resolvedCastAssets?.some((item: { name: string; assetId?: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; variants?: Array<{ id: string; variantKind?: string; libraryVariantId?: string }>; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }) =>
    item.name === '主角' &&
    item.assetId === 'hero' &&
    item.libraryEntityId === 'el-hero' &&
    item.libraryEntityVersion === 1 &&
    item.librarySyncPolicy === 'snapshot' &&
    item.variants?.some((variant) => variant.id === 'gala' && variant.variantKind === 'makeup' && variant.libraryVariantId === 'lib-gala') &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second'),
  ) &&
    ep2Table.scenes?.[0]?.segments?.[0]?.rows?.[0]?.resolvedAssetRefs?.some((item: { name: string; assetId?: string; libraryEntityId?: string; variants?: Array<{ id: string; variantKind?: string; libraryVariantId?: string }>; assetCenterUsage?: { currentProject?: { appearanceLabels?: string[] } } }) =>
      item.name === '主角' &&
      item.assetId === 'hero' &&
      item.libraryEntityId === 'el-hero' &&
      item.variants?.some((variant) => variant.id === 'gala' && variant.variantKind === 'makeup' && variant.libraryVariantId === 'lib-gala') &&
      item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  JSON.stringify(ep2Table.scenes),
)
check(
  'get_storyboard_table returns episode plan usage',
  ep2Table.plan?.castFromStoryboards?.some(
    (asset: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
      asset.id === 'hero' &&
      asset.assetCenterUsage?.entityId === 'el-hero' &&
      asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
      asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ) &&
    true,
  JSON.stringify(ep2Table.plan),
)

const ep2Timeline = JSON.parse(await getTimeline.execute({ episodeIndex: 2 }))
check('get_timeline reads non-current episode by episode index', ep2Timeline.tracks?.[0]?.id === 'track-ep2' && ep2Timeline.clips?.[0]?.id === 'clip-ep2' && ep2Timeline.episodeId === 'ep2', JSON.stringify(ep2Timeline))
check(
  'get_timeline exposes storyboard cast asset-center usage',
  ep2Timeline.tracks?.[0]?.storyboardCastAssets?.some((item: { storyboardId: string; castAssets?: Array<{ assetId: string; variantId?: string; variantKind?: string; libraryEntityId?: string; libraryEntityVersion?: number; librarySyncPolicy?: string; libraryVariantId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }> }) =>
    item.storyboardId === 'sb-ep2' &&
    item.castAssets?.some((cast) =>
      cast.assetId === 'hero' &&
      cast.variantId === 'gala' &&
      cast.variantKind === 'makeup' &&
      cast.libraryEntityId === 'el-hero' &&
      cast.libraryEntityVersion === 1 &&
      cast.librarySyncPolicy === 'snapshot' &&
      cast.libraryVariantId === 'lib-gala' &&
      cast.assetCenterUsage?.entityId === 'el-hero' &&
      cast.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(ep2Timeline.tracks),
)
check(
  'get_timeline returns episode plan usage',
  ep2Timeline.plan?.castFromStoryboards?.some(
    (asset: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
      asset.id === 'hero' &&
      asset.assetCenterUsage?.entityId === 'el-hero' &&
      asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
      asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ) &&
    true,
  JSON.stringify(ep2Timeline.plan),
)
const missingEpisodeRead = JSON.parse(await getScript.execute({ episodeIndex: 99 }))
check('read tools reject invalid explicit episode selectors instead of falling back to current episode', !!missingEpisodeRead.error && !missingEpisodeRead.id, JSON.stringify(missingEpisodeRead))
check(
  'read tool episode candidates expose plan asset usage after invalid selector',
  missingEpisodeRead.episodes?.some((item: { id: string; plan?: { castFromStoryboards?: Array<{ id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }> } }) =>
    item.id === 'ep2' &&
    item.plan?.castFromStoryboards?.some(
      (asset) =>
        asset.id === 'hero' &&
        asset.assetCenterUsage?.entityId === 'el-hero' &&
        asset.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
        asset.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(missingEpisodeRead.episodes),
)
const zeroEpisodeRead = JSON.parse(await getScript.execute({ episodeIndex: 0 }))
check('read tools reject non-positive episode indexes', !!zeroEpisodeRead.error && !zeroEpisodeRead.id, JSON.stringify(zeroEpisodeRead))

function cloneDoc(input: ProjectDoc): ProjectDoc {
  return JSON.parse(JSON.stringify(input)) as ProjectDoc
}

function makeWritableState(initial: ProjectDoc): ProjectState {
  const current = initial
  let nextAsset = 1
  let nextVariant = 1
  let nextScript = 1
  let nextStoryboard = 1
  let nextClip = 1

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
    upsertScript: (s: Partial<Script> & { content: string }) => {
      const id = s.id ?? `script-write-${nextScript++}`
      const index = current.scripts.findIndex((item) => item.id === id)
      const base: Script = index >= 0 ? current.scripts[index] : { id, name: s.name ?? 'Script', content: '', createdAt: 0, updatedAt: 0 }
      const merged: Script = { ...base, ...s, id, content: s.content, updatedAt: 1 }
      if (index >= 0) current.scripts[index] = merged
      else current.scripts.push(merged)
      return id
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
      const refs: StoryboardCastRef[] = sb.castRefs?.length ? [...sb.castRefs] : sb.associateAssetIds.map((id) => ({ assetId: id }))
      const existing = refs.find((ref) => ref.assetId === assetId)
      if (existing) existing.variantId = variantId
      else refs.push({ assetId, variantId })
      sb.castRefs = refs
      sb.associateAssetIds = [...new Set(refs.map((ref) => ref.assetId))]
    },
    setAppearanceChange: (storyboardId: string, appearanceChange: AppearanceChange) => declareAppearanceChange(current, storyboardId, appearanceChange),
    revertAppearanceToInherited: (storyboardId: string, assetId: string) => revertToInheritedAppearance(current, storyboardId, assetId),
    updateAssetVariant: (assetId: string, variantId: string, patch: Partial<AssetVariant>) => {
      const variant = current.assets.find((item) => item.id === assetId)?.variants?.find((item) => item.id === variantId)
      if (variant) Object.assign(variant, patch)
    },
    addAssetVariant: (assetId: string, init?: { label?: string; desc?: string; prompt?: string }) => {
      const asset = current.assets.find((item) => item.id === assetId)
      if (!asset || asset.type === 'audio' || asset.type === 'clip') return ''
      const id = `variant-write-${nextVariant++}`
      asset.variants = [...(asset.variants ?? []), { id, label: init?.label ?? `Variant ${nextVariant}`, desc: init?.desc, prompt: init?.prompt, state: 'idle' }]
      return id
    },
    generateAsset: async (assetId: string) => {
      const asset = current.assets.find((item) => item.id === assetId)
      if (asset) asset.refImageId = `generated-${assetId}`
    },
    generateAssetVariant: async (assetId: string, variantId: string) => {
      const variant = current.assets.find((item) => item.id === assetId)?.variants?.find((item) => item.id === variantId)
      if (variant) {
        variant.refImageId = `generated-${assetId}-${variantId}`
        variant.state = 'done'
      }
    },
    generateKeyframe: async (storyboardId: string) => {
      const sb = current.storyboards.find((item) => item.id === storyboardId)
      if (!sb) return
      sb.keyframeImageId = `keyframe-${storyboardId}`
      sb.state = 'done'
    },
    generateClip: async (storyboardId: string) => {
      const sb = current.storyboards.find((item) => item.id === storyboardId)
      if (!sb) return
      let track = current.track.find((item) => item.storyboardIds.includes(storyboardId))
      if (!track) {
        track = { id: `track-${storyboardId}`, storyboardIds: [storyboardId], clipIds: [], order: current.track.length, duration: sb.duration } satisfies VideoTrack
        current.track.push(track)
      }
      const clip: Clip = {
        id: `clip-write-${nextClip++}`,
        storyboardId,
        trackId: track.id,
        videoFilePath: `${storyboardId}.mp4`,
        durationSec: track.duration ?? sb.duration,
        state: 'done',
        createdAt: nextClip,
      }
      current.clips.push(clip)
      track.clipIds.push(clip.id)
      track.selectClipId = clip.id
    },
    setCurrentEpisodeSeriesSkip: (skip: boolean) => {
      const episode = current.episodes?.find((item) => item.id === current.currentEpisodeId)
      if (episode) episode.seriesSkip = skip || undefined
    },
    updateSeriesBible: (patch: Partial<NonNullable<ProjectDoc['seriesBible']>>) => {
      current.seriesBible = { ...(current.seriesBible ?? {}), ...patch }
    },
    updateEpisodePlan: (episodeId: string, patch: Partial<NonNullable<Episode['plan']>>) => {
      const episode = current.episodes?.find((item) => item.id === episodeId)
      if (episode) episode.plan = { ...(episode.plan ?? {}), ...patch }
    },
    upsertAsset: (a: Partial<Asset> & { type: Asset['type']; name: string }) => {
      const id = a.id ?? `asset-write-${nextAsset++}`
      const index = current.assets.findIndex((item) => item.id === id)
      const base: Asset = index >= 0 ? current.assets[index] : { id, type: a.type, name: a.name, state: 'idle' }
      const merged: Asset = { ...base, ...a, id, aliases: a.aliases?.length ? a.aliases : undefined }
      if (index >= 0) current.assets[index] = merged
      else current.assets.push(merged)
      return id
    },
    linkAssetToLibraryEntity: (assetId: string, entity: { id: string; version?: number; archived?: boolean; variants?: Array<{ id: string; label: string }> }) => {
      if (entity.archived) return false
      const asset = current.assets.find((item) => item.id === assetId)
      if (!asset || asset.parentAssetId || (asset.type !== 'role' && asset.type !== 'scene' && asset.type !== 'prop')) return false
      const variants = entity.variants ?? []
      const byLabel = new Map(variants.map((variant) => [variant.label.toLowerCase(), variant.id]))
      const variantMap: Record<string, string> = {}
      asset.variants = asset.variants?.map((variant) => {
        const libraryVariantId = variant.libraryVariantId ?? byLabel.get(variant.label.toLowerCase())
        if (libraryVariantId) variantMap[variant.id] = libraryVariantId
        return { ...variant, libraryVariantId }
      })
      asset.elementId = entity.id
      asset.libraryLink = {
        entityId: entity.id,
        entityVersion: entity.version,
        syncPolicy: 'snapshot',
        variantMap: Object.keys(variantMap).length ? variantMap : undefined,
        lastSyncedAt: 1,
      }
      asset.rejectedLibraryEntityIds = (asset.rejectedLibraryEntityIds ?? []).filter((id) => id !== entity.id)
      if (!asset.rejectedLibraryEntityIds.length) asset.rejectedLibraryEntityIds = undefined
      return true
    },
    markAssetAsDistinctIdentity: (assetId: string, entityIds: string[]) => {
      const asset = current.assets.find((item) => item.id === assetId)
      if (!asset || asset.parentAssetId || (asset.type !== 'role' && asset.type !== 'scene' && asset.type !== 'prop')) return false
      const ids = [...new Set(entityIds.map((id) => id.trim()).filter(Boolean))]
      if (!ids.length) return false
      asset.rejectedLibraryEntityIds = [...new Set([...(asset.rejectedLibraryEntityIds ?? []), ...ids])]
      const currentEntityId = asset.libraryLink?.entityId || asset.elementId
      if (currentEntityId && ids.includes(currentEntityId)) {
        asset.libraryLink = {
          ...asset.libraryLink,
          entityId: currentEntityId,
          syncPolicy: 'forked',
        }
      }
      return true
    },
    mergeProjectAssetInto: (sourceAssetId: string, targetAssetId: string) => {
      const source = current.assets.find((item) => item.id === sourceAssetId)
      const target = current.assets.find((item) => item.id === targetAssetId)
      if (!source || !target || source.id === target.id || source.type !== target.type) return false
      const byLabel = new Map((target.variants ?? []).map((variant) => [variant.label.toLowerCase(), variant.id]))
      const variantMap: Record<string, string> = {}
      for (const variant of source.variants ?? []) {
        const matched = byLabel.get(variant.label.toLowerCase())
        if (matched) variantMap[variant.id] = matched
        else {
          target.variants = [...(target.variants ?? []), variant]
          variantMap[variant.id] = variant.id
        }
      }
      const rewrite = (storyboards: Storyboard[]) => {
        for (const sb of storyboards) {
          if (!sb.associateAssetIds.includes(source.id) && !sb.castRefs?.some((ref) => ref.assetId === source.id)) continue
          const baseRefs: StoryboardCastRef[] = sb.castRefs?.length ? sb.castRefs : sb.associateAssetIds.map((assetId): StoryboardCastRef => ({ assetId }))
          const refs: StoryboardCastRef[] = baseRefs.map((ref) =>
            ref.assetId === source.id ? { ...ref, assetId: target.id, variantId: ref.variantId ? variantMap[ref.variantId] : undefined } : ref,
          )
          sb.castRefs = refs
          sb.associateAssetIds = [...new Set(refs.map((ref) => ref.assetId))]
        }
      }
      rewrite(current.storyboards)
      for (const episode of current.episodes ?? []) rewrite(episode.storyboards)
      current.assets = current.assets.filter((item) => item.id !== source.id && item.parentAssetId !== source.id)
      return true
    },
    syncAssetFromLibraryEntity: (assetId: string, entity: { id: string; name: string; aliases?: string[]; description?: string; prompt?: string; mediaRefs?: Array<{ assetId?: string; role: string }>; variants?: Array<{ id: string; label: string; kind?: AssetVariant['variantKind']; mediaRefs?: Array<{ assetId?: string }> }>; voiceRef?: { assetId?: string }; lora?: Asset['lora']; version: number }) => {
      const asset = current.assets.find((item) => item.id === assetId)
      if (!asset || asset.parentAssetId || (asset.type !== 'role' && asset.type !== 'scene' && asset.type !== 'prop')) return false
      const currentVariants = asset.variants ?? []
      asset.name = entity.name
      asset.aliases = entity.aliases
      asset.desc = entity.description
      asset.prompt = entity.prompt
      asset.refImageId = entity.mediaRefs?.find((ref) => ref.assetId)?.assetId
      asset.elementId = entity.id
      asset.voiceAssetId = asset.type === 'role' && entity.voiceRef?.assetId ? entity.voiceRef.assetId : asset.voiceAssetId
      asset.audioBindState = asset.type === 'role' && entity.voiceRef?.assetId ? 'done' : asset.audioBindState
      asset.lora = entity.lora
      asset.variants = entity.variants?.map((variant) => {
        const existing = currentVariants.find((item) => item.libraryVariantId === variant.id || item.label === variant.label)
        return {
          id: existing?.id ?? variant.id,
          libraryVariantId: variant.id,
          label: variant.label,
          variantKind: variant.kind,
          refImageId: variant.mediaRefs?.find((ref) => ref.assetId)?.assetId,
        }
      })
      asset.libraryLink = { entityId: entity.id, entityVersion: entity.version, syncPolicy: 'snapshot', lastSyncedAt: 1 }
      asset.rejectedLibraryEntityIds = asset.rejectedLibraryEntityIds?.filter((id) => id !== entity.id)
      if (!asset.rejectedLibraryEntityIds?.length) asset.rejectedLibraryEntityIds = undefined
      return true
    },
    promoteAssetToElement: async (assetId: string) => {
      if (assetId === 'publish-blocked') return false
      const asset = current.assets.find((item) => item.id === assetId)
      if (!asset) return false
      const activeEntityId = projectAssetIdentityEntityId(asset)
      const entityId = activeEntityId || `el-${asset.id}`
      asset.elementId = entityId
      asset.libraryLink = { entityId, entityVersion: (asset.libraryLink?.entityVersion ?? 0) + 1, syncPolicy: 'snapshot', lastSyncedAt: 1 }
      asset.rejectedLibraryEntityIds = asset.rejectedLibraryEntityIds?.filter((id) => id !== entityId)
      if (!asset.rejectedLibraryEntityIds?.length) asset.rejectedLibraryEntityIds = undefined
      asset.variants = asset.variants?.map((variant) => ({ ...variant, libraryVariantId: variant.libraryVariantId ?? variant.id }))
      return true
    },
  }
  return state as unknown as ProjectState
}

const writableDoc = cloneDoc(doc)
writableDoc.assets = [
  {
    id: 'hero',
    type: 'role',
    name: 'Hero',
    aliases: ['主角'],
    elementId: 'el-hero',
    libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot', variantMap: { cloak: 'lib-cloak' } },
    state: 'done',
    variants: [
      { id: 'gala', label: 'Gala' },
      { id: 'cloak', label: 'Cloak', libraryVariantId: 'lib-cloak', variantKind: 'outfit' },
    ],
  },
  { id: 'hall', type: 'scene', name: 'Hall', state: 'done' },
  { id: 'lobby', type: 'scene', name: 'Lobby', state: 'done' },
  { id: 'lantern', type: 'prop', name: 'Lantern', state: 'done' },
  { id: 'no-ref-linked', type: 'role', name: 'No Ref Linked Hero', state: 'done', libraryLink: { entityId: 'el-no-ref', entityVersion: 1, syncPolicy: 'snapshot' } },
  { id: 'sync-target', type: 'role', name: 'Local Hero', refImageId: 'local-hero-img', state: 'done', variants: [{ id: 'local-gala', label: 'Library Gala' }] },
  { id: 'publish-blocked', type: 'role', name: 'Archived Linked Hero', refImageId: 'archived-linked-img', state: 'done', libraryLink: { entityId: 'el-archived', syncPolicy: 'snapshot' } },
  { id: 'hero-duplicate', type: 'role', name: 'Hero Double', aliases: ['影子主角'], state: 'done', libraryLink: { entityId: 'el-hero', syncPolicy: 'snapshot' }, variants: [{ id: 'alt-gala', label: 'Gala' }] },
  { id: 'legacy-linked', type: 'role', name: 'Legacy Linked Hero', refImageId: 'legacy-linked-img', state: 'done', elementId: 'el-legacy-old' },
  { id: 'forked-sync', type: 'role', name: 'Forked Sync Hero', refImageId: 'forked-sync-img', state: 'done', elementId: 'el-forked-old', libraryLink: { entityId: 'el-forked-old', syncPolicy: 'forked' }, rejectedLibraryEntityIds: ['el-forked-old'] },
]
writableDoc.episodes![1].storyboards = [storyboard('sb-ep2-original', 0, 'Second episode original shot.')]
const writeState = makeWritableState(writableDoc)
const writeTools = makeAgentTools(() => writeState)
const upsertScript = writeTools.find((tool) => tool.name === 'upsert_script')
const addAsset = writeTools.find((tool) => tool.name === 'add_asset')
const addStoryboard = writeTools.find((tool) => tool.name === 'add_storyboard')
const updateAsset = writeTools.find((tool) => tool.name === 'update_asset')
const generateAsset = writeTools.find((tool) => tool.name === 'generate_asset')
const generateKeyframe = writeTools.find((tool) => tool.name === 'generate_keyframe')
const generateClip = writeTools.find((tool) => tool.name === 'generate_clip')
const upsertAssetVariant = writeTools.find((tool) => tool.name === 'upsert_asset_variant')
const generateAssetVariant = writeTools.find((tool) => tool.name === 'generate_asset_variant')
const updateSeriesBible = writeTools.find((tool) => tool.name === 'update_series_bible')
const upsertEpisodePlan = writeTools.find((tool) => tool.name === 'upsert_episode_plan')
const applyHandoffSuggestion = writeTools.find((tool) => tool.name === 'apply_episode_handoff_suggestion')
const linkLibraryEntity = writeTools.find((tool) => tool.name === 'link_project_asset_to_library_entity')
const markDistinctIdentity = writeTools.find((tool) => tool.name === 'mark_project_asset_distinct_identity')
const publishProjectAsset = writeTools.find((tool) => tool.name === 'publish_project_asset_to_library')
const syncProjectAsset = writeTools.find((tool) => tool.name === 'sync_project_asset_from_library')
const mergeProjectAsset = writeTools.find((tool) => tool.name === 'merge_project_asset_into')
const setAssetRef = writeTools.find((tool) => tool.name === 'set_storyboard_asset_ref')
const setAppearanceChange = writeTools.find((tool) => tool.name === 'set_appearance_change')
const clearAppearanceChange = writeTools.find((tool) => tool.name === 'clear_appearance_change')
const setCastVariant = writeTools.find((tool) => tool.name === 'set_storyboard_cast_variant')
const setSceneAsset = writeTools.find((tool) => tool.name === 'set_storyboard_scene_asset')
const setEpisodeSeriesSkip = writeTools.find((tool) => tool.name === 'set_episode_series_skip')

if (!upsertScript || !addAsset || !addStoryboard || !updateAsset || !generateAsset || !generateKeyframe || !generateClip || !upsertAssetVariant || !generateAssetVariant || !updateSeriesBible || !upsertEpisodePlan || !applyHandoffSuggestion || !linkLibraryEntity || !markDistinctIdentity || !publishProjectAsset || !syncProjectAsset || !mergeProjectAsset || !setAssetRef || !setAppearanceChange || !clearAppearanceChange || !setCastVariant || !setSceneAsset || !setEpisodeSeriesSkip) {
  console.error('  FAIL write tools exist: required write tools missing')
  process.exit(1)
}

const updatedSeriesBible = JSON.parse(await updateSeriesBible.execute({ logline: 'A sharper season hook.', plannedEpisodeCount: 5, theme: 'revenge' }))
check(
  'update_series_bible writes season planning fields',
  updatedSeriesBible.seriesBible?.logline === 'A sharper season hook.' &&
    updatedSeriesBible.seriesBible?.plannedEpisodeCount === 5 &&
    writableDoc.seriesBible?.theme === 'revenge',
  JSON.stringify(updatedSeriesBible),
)

const addedAsset = JSON.parse(await addAsset.execute({ type: 'prop', name: 'Compass', aliases: ['罗盘'], desc: 'A brass compass.' }))
check(
  'add_asset returns structured asset view',
  addedAsset.id &&
    addedAsset.asset?.id === addedAsset.id &&
    addedAsset.asset?.name === 'Compass' &&
    addedAsset.asset?.type === 'prop' &&
    addedAsset.asset?.aliases?.includes('罗盘') &&
    addedAsset.asset?.desc === 'A brass compass.' &&
    !addedAsset.asset?.assetCenterUsage,
  JSON.stringify(addedAsset),
)

const updatedEpisodePlan = JSON.parse(
  await upsertEpisodePlan.execute({
    episodeTitle: 'Second',
    hook: 'Hero sees the hidden clue.',
    conflict: 'The hallway trap closes.',
    cliffhanger: 'The Gala mask cracks.',
  }),
)
check(
  'upsert_episode_plan writes selected episode plan and resolves names',
  updatedEpisodePlan.episode?.episodeId === 'ep2' &&
    updatedEpisodePlan.plan?.hook === 'Hero sees the hidden clue.' &&
    updatedEpisodePlan.plan?.conflict === 'The hallway trap closes.' &&
    updatedEpisodePlan.plan?.cliffhanger === 'The Gala mask cracks.',
  JSON.stringify(updatedEpisodePlan),
)
check(
  'upsert_episode_plan derives cast from storyboards instead of checkboxes',
  Array.isArray(updatedEpisodePlan.plan?.castFromStoryboards) && updatedEpisodePlan.plan.castFromStoryboards.every((asset: { id: string; variantLabels?: string[] }) => !!asset.id && Array.isArray(asset.variantLabels)),
  JSON.stringify(updatedEpisodePlan.plan),
)

// 补一条 ep2 分镜（原本由已删除的作用域测试建立），供变更点/引用修复测试使用
const addedEp2Storyboard = JSON.parse(
  await addStoryboard.execute({ episodeTitle: 'Second', videoDesc: 'Hero steps into the banquet hall.', cast: ['Hero'], sceneId: 'banquet' }),
)
check('add_storyboard writes into the selected episode', addedEp2Storyboard.episode?.episodeId === 'ep2' && !!addedEp2Storyboard.id, JSON.stringify(addedEp2Storyboard))

const boundVariant = JSON.parse(await setCastVariant.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero', variantLabel: 'Gala' }))
check(
  'set_storyboard_cast_variant writes the selected episode storyboard',
  boundVariant.storyboard?.castRefs?.some((ref: { assetId: string; variantId?: string }) => ref.assetId === 'hero' && ref.variantId === 'gala'),
  JSON.stringify(boundVariant),
)

const scopedVariantStoryboard = writableDoc.storyboards.find((item) => item.index === 1)
if (scopedVariantStoryboard) scopedVariantStoryboard.sceneId = 'banquet'

const declaredChange = JSON.parse(await setAppearanceChange.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero', variantLabel: 'Gala', reason: '换上宴会礼服' }))
const changedStoryboard = writableDoc.storyboards.find((item) => item.id === declaredChange.storyboardId)
check(
  'set_appearance_change records a change point on the selected shot',
  declaredChange.toVariantId === 'gala' &&
    declaredChange.reason === '换上宴会礼服' &&
    changedStoryboard?.stateChanges?.some((change) => change.assetId === 'hero' && change.toVariantId === 'gala' && change.reason === '换上宴会礼服') === true,
  JSON.stringify({ declaredChange, stateChanges: changedStoryboard?.stateChanges }),
)
check(
  'set_appearance_change returns a continuity report with the collapsed code set',
  Array.isArray(declaredChange.continuity?.issues) &&
    declaredChange.continuity.issues.every((issue: { code: string }) =>
      ['dangling_ref', 'missing_ref_image', 'unexplained_appearance_change', 'duplicate_identity', 'scene_asset_inconsistent', 'chapter_coverage', 'unused_project_asset'].includes(issue.code),
    ),
  JSON.stringify(declaredChange.continuity?.issues?.map((issue: { code: string }) => issue.code)),
)

const missingReason = JSON.parse(await setAppearanceChange.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero', variantLabel: 'Gala', reason: '   ' }))
check('set_appearance_change requires a reason', !!missingReason.error, JSON.stringify(missingReason))

const clearedChange = JSON.parse(await clearAppearanceChange.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero' }))
const clearedStoryboard = writableDoc.storyboards.find((item) => item.id === clearedChange.storyboardId)
check(
  'clear_appearance_change drops the change point',
  clearedChange.changed === true && !clearedStoryboard?.stateChanges?.some((change) => change.assetId === 'hero'),
  JSON.stringify({ clearedChange, stateChanges: clearedStoryboard?.stateChanges }),
)

const invalidAssetRefVariant = JSON.parse(await setAssetRef.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero', variantLabel: 'Missing Look' }))
check(
  'set_storyboard_asset_ref invalid variant returns asset lineage',
  !!invalidAssetRefVariant.error &&
    invalidAssetRefVariant.asset?.id === 'hero' &&
    invalidAssetRefVariant.asset?.libraryEntityId === 'el-hero' &&
    invalidAssetRefVariant.asset?.librarySyncPolicy === 'snapshot' &&
    Array.isArray(invalidAssetRefVariant.variants),
  JSON.stringify(invalidAssetRefVariant),
)

const assetRefResult = JSON.parse(await setAssetRef.execute({ episodeTitle: 'Second', index: 2, assetName: 'Lantern', roleInShot: 'supporting' }))
check(
  'set_storyboard_asset_ref adds unused asset to selected storyboard',
  assetRefResult.episode?.episodeId === 'ep2' &&
    assetRefResult.storyboard?.castRefs?.some((ref: { assetId: string; roleInShot?: string }) => ref.assetId === 'lantern' && ref.roleInShot === 'supporting') &&
    assetRefResult.storyboard?.castAssetIds?.includes('lantern'),
  JSON.stringify(assetRefResult),
)
check(
  'set_storyboard_asset_ref returns episode plan context',
  assetRefResult.episode?.plan?.castFromStoryboards?.some((asset: { id: string; librarySyncPolicy?: string }) => asset.id === 'hero' && asset.librarySyncPolicy === 'snapshot') &&
    assetRefResult.episode?.plan?.castFromStoryboards?.some((asset: { id: string }) => asset.id === 'lantern'),
  JSON.stringify(assetRefResult.episode),
)

writableDoc.storyboards.push({ ...storyboard('scene-a', writableDoc.storyboards.length, 'Hall first shot.'), sceneId: 'hallway', associateAssetIds: ['hall'], castRefs: [{ assetId: 'hall' }] })
writableDoc.storyboards.push({ ...storyboard('scene-b', writableDoc.storyboards.length, 'Hall second shot.'), sceneId: 'hallway', associateAssetIds: ['lobby'], castRefs: [{ assetId: 'lobby' }] })
const sceneAssetResult = JSON.parse(await setSceneAsset.execute({ episodeTitle: 'Second', sceneId: 'hallway', sceneAssetName: 'Hall' }))
check(
  'set_storyboard_scene_asset unifies selected scene group',
  sceneAssetResult.storyboards?.length === 2 &&
    sceneAssetResult.storyboards.every((item: { castRefs?: Array<{ assetId: string }> }) => item.castRefs?.some((ref) => ref.assetId === 'hall') && !item.castRefs?.some((ref) => ref.assetId === 'lobby')),
  JSON.stringify(sceneAssetResult),
)
check(
  'set_storyboard_scene_asset returns episode plan context',
  sceneAssetResult.episode?.plan?.castFromStoryboards?.some((asset: { id: string }) => asset.id === 'hall'),
  JSON.stringify(sceneAssetResult.episode),
)

const restoredEpisode = JSON.parse(await setEpisodeSeriesSkip.execute({ episodeTitle: 'Second', skip: false }))
check('set_episode_series_skip restores selected episode queue state', restoredEpisode.episode?.id === 'ep2' && restoredEpisode.episode?.seriesSkip === false && restoredEpisode.episode?.seriesQueueState === 'pending', JSON.stringify(restoredEpisode))

if (failures) {
  console.error(`\nagentTools selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nagentTools selftest: ALL PASSED')
