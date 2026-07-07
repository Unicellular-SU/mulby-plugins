import { makeAgentTools, makeProjectReadTools } from './agentTools'
import type { Asset, AssetVariant, Episode, ProjectDoc, ProjectMeta, Script, Storyboard, StoryboardCastRef, StoryboardTableScene } from '../../domain/types'
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
  seriesBible: { logline: 'A hidden heir returns.', plannedEpisodeCount: 3, continuityRules: ['Hero keeps the same identity across episodes.'] },
  novel: [],
  scripts: [{ id: 'script-current', name: 'Current Script', content: 'Current episode only.', createdAt: 0, updatedAt: 0 }],
  assets: [{
    id: 'hero',
    type: 'role',
    name: 'Hero',
    aliases: ['主角'],
    elementId: 'el-hero',
    libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot' },
    state: 'done',
    variants: [{ id: 'gala', label: 'Gala', variantKind: 'makeup' }],
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
      plan: { hook: 'A clue appears.', requiredAssetIds: ['hero'], requiredVariantIds: ['gala'] },
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
const getSeriesBible = tools.find((tool) => tool.name === 'get_series_bible')
const getContinuityReport = tools.find((tool) => tool.name === 'get_continuity_report')
const getEpisodeHandoff = tools.find((tool) => tool.name === 'get_episode_handoff')
const getScript = tools.find((tool) => tool.name === 'get_script')
const getStoryboards = tools.find((tool) => tool.name === 'get_storyboards')
const getAssets = tools.find((tool) => tool.name === 'get_assets')
const getStoryboardTable = tools.find((tool) => tool.name === 'get_storyboard_table')
const getTimeline = tools.find((tool) => tool.name === 'get_timeline')

if (!searchProject || !getWorkspace || !getSeriesBible || !getContinuityReport || !getEpisodeHandoff || !getScript || !getStoryboards || !getAssets || !getStoryboardTable || !getTimeline) {
  console.error('  FAIL tools exist: required read tools missing')
  process.exit(1)
}

const search = JSON.parse(await searchProject.execute({ query: 'hidden clue', domains: ['scripts', 'storyboards', 'storyboardTable'], limit: 10 }))
check('search_project finds non-current episode scripts', search.scripts?.some((item: { id: string; episodeId: string }) => item.id === 'script-ep2' && item.episodeId === 'ep2'), JSON.stringify(search.scripts))
check('search_project finds non-current episode storyboards', search.storyboards?.some((item: { id: string; episodeIndex: number }) => item.id === 'sb-ep2' && item.episodeIndex === 2), JSON.stringify(search.storyboards))
check('search_project finds non-current episode storyboard table', search.storyboardTable?.some((item: { scene: { sceneName: string }; episodeId: string }) => item.scene.sceneName === 'Hidden clue scene' && item.episodeId === 'ep2'), JSON.stringify(search.storyboardTable))

const assetAliasSearch = JSON.parse(await searchProject.execute({ query: '主角', domains: ['assets'], limit: 10 }))
check('search_project finds assets by alias', assetAliasSearch.assets?.some((item: { id: string; aliases?: string[] }) => item.id === 'hero' && item.aliases?.includes('主角')), JSON.stringify(assetAliasSearch.assets))
check(
  'search_project exposes asset-center usage for assets',
  assetAliasSearch.assets?.some((item: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
    item.id === 'hero' &&
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
  aliasFilteredAssets.assets?.some((item: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
    item.id === 'hero' &&
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
check('get_workspace exposes skipped series queue state', workspace.episodes?.some((item: { id: string; seriesSkip?: boolean; seriesQueueState?: string }) => item.id === 'ep2' && item.seriesSkip === true && item.seriesQueueState === 'skipped'), JSON.stringify(workspace.episodes))
check('get_workspace exposes episode plans', workspace.episodes?.some((item: { id: string; plan?: { requiredAssets?: Array<{ id: string }>; requiredVariants?: Array<{ id: string }> } }) => item.id === 'ep2' && item.plan?.requiredAssets?.some((asset) => asset.id === 'hero') && item.plan?.requiredVariants?.some((variant) => variant.id === 'gala')), JSON.stringify(workspace.episodes))
check('get_workspace exposes asset-center usage summary', workspace.assets?.some((item: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }) => item.id === 'hero' && item.assetCenterUsage?.entityId === 'el-hero' && item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second')), JSON.stringify(workspace.assets))
check(
  'get_workspace exposes episode handoff summary',
  workspace.episodes?.some((item: { id: string; handoff?: { suggestionCount?: number; autoRepairableSuggestionCount?: number; suggestions?: Array<{ id: string; kind: string }> } }) =>
    item.id === 'ep2' &&
    !!item.handoff?.suggestionCount &&
    !!item.handoff?.autoRepairableSuggestionCount &&
    item.handoff?.suggestions?.some((suggestion) => suggestion.id === 'asset-image:hero' && suggestion.kind === 'generate_asset_ref_image'),
  ),
  JSON.stringify(workspace.episodes),
)

const continuityReport = JSON.parse(await getContinuityReport.execute({}))
check(
  'get_continuity_report exposes cast asset-center usage',
  continuityReport.episodes?.some((episode: { id: string; castUses?: Array<{ assetId: string; variantId?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }> }) =>
    episode.id === 'ep2' &&
    episode.castUses?.some((use) =>
      use.assetId === 'hero' &&
      use.variantId === 'gala' &&
      use.assetCenterUsage?.entityId === 'el-hero' &&
      use.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(continuityReport.episodes),
)

const seriesBible = JSON.parse(await getSeriesBible.execute({}))
check('get_series_bible returns bible and episode plans', seriesBible.seriesBible?.logline === 'A hidden heir returns.' && seriesBible.episodes?.some((item: { episodeId: string; plan?: { hook?: string } }) => item.episodeId === 'ep2' && item.plan?.hook === 'A clue appears.'), JSON.stringify(seriesBible))
check(
  'get_series_bible exposes asset-center usage for planning assets',
  seriesBible.availableAssets?.some((item: { id: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[]; appearanceLabels?: string[] } } }) =>
    item.id === 'hero' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
    item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ),
  JSON.stringify(seriesBible.availableAssets),
)

const handoff = JSON.parse(await getEpisodeHandoff.execute({ episodeIndex: 2 }))
check('get_episode_handoff exposes prior recap and shared cast refs', handoff.episodeId === 'ep2' && handoff.recaps?.[0]?.episodeId === 'ep1' && handoff.sharedAssets?.some((cue: { assetId: string; label: string }) => cue.assetId === 'hero' && cue.label === 'Hero-Gala'), JSON.stringify(handoff))
check(
  'get_episode_handoff exposes episode plan requirements',
  handoff.plannedAssets?.some((item: { assetId: string; requiredVariantIds?: string[] }) => item.assetId === 'hero' && item.requiredVariantIds?.includes('gala')) &&
    handoff.plannedVariants?.some((item: { assetId: string; variantId: string; variantKind?: string; scopeAppliesToEpisode: boolean }) => item.assetId === 'hero' && item.variantId === 'gala' && item.variantKind === 'makeup' && item.scopeAppliesToEpisode === true),
  JSON.stringify(handoff),
)
check(
  'get_episode_handoff exposes structured variant kinds',
  handoff.sharedAssets?.some((cue: { assetId: string; variantId?: string; variantKind?: string }) => cue.assetId === 'hero' && cue.variantId === 'gala' && cue.variantKind === 'makeup') &&
    handoff.suggestions?.some((suggestion: { kind: string; variantId?: string; variantKind?: string }) => suggestion.kind === 'generate_variant_ref_image' && suggestion.variantId === 'gala' && suggestion.variantKind === 'makeup'),
  JSON.stringify(handoff),
)
check(
  'get_episode_handoff exposes asset-center usage for planned and shared assets',
  handoff.plannedAssets?.some((item: { assetId: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }) =>
    item.assetId === 'hero' && item.assetCenterUsage?.entityId === 'el-hero' && item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E1 Episode 1'),
  ) &&
    handoff.sharedAssets?.some((item: { assetId: string; assetCenterUsage?: { currentProject?: { appearanceLabels?: string[] } } }) =>
      item.assetId === 'hero' && item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  JSON.stringify(handoff),
)
const emptyEpisodeHandoff = JSON.parse(await getEpisodeHandoff.execute({ episodeIndex: 3 }))
check(
  'get_episode_handoff carries prior refs for empty episode',
  emptyEpisodeHandoff.episodeId === 'ep3' && emptyEpisodeHandoff.sharedAssets?.some((cue: { assetId: string; label: string; carryForward?: boolean }) => cue.assetId === 'hero' && cue.label === 'Hero-Gala' && cue.carryForward === true),
  JSON.stringify(emptyEpisodeHandoff),
)

const ep2Script = JSON.parse(await getScript.execute({ episodeIndex: 2, contentLimit: 200 }))
check('get_script reads non-current episode by episode index', ep2Script.id === 'script-ep2' && ep2Script.episodeId === 'ep2' && ep2Script.content?.text.includes('hidden clue'), JSON.stringify(ep2Script))

const ep2Storyboards = JSON.parse(await getStoryboards.execute({ episodeTitle: 'Second' }))
check('get_storyboards reads non-current episode by title', ep2Storyboards.storyboards?.[0]?.id === 'sb-ep2' && ep2Storyboards.episodeId === 'ep2', JSON.stringify(ep2Storyboards))
check(
  'get_storyboards exposes cast asset-center usage',
  ep2Storyboards.storyboards?.[0]?.castAssets?.some((item: { assetId: string; variantId?: string; variantKind?: string; label?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }) =>
    item.assetId === 'hero' &&
    item.variantId === 'gala' &&
    item.variantKind === 'makeup' &&
    item.label === 'Hero-Gala' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
  ),
  JSON.stringify(ep2Storyboards.storyboards),
)

const ep2Table = JSON.parse(await getStoryboardTable.execute({ episodeId: 'ep2' }))
check('get_storyboard_table reads non-current episode by id', ep2Table.scenes?.[0]?.sceneName === 'Hidden clue scene' && ep2Table.episodeIndex === 2, JSON.stringify(ep2Table))
check(
  'get_storyboard_table resolves asset-center usage for design refs',
  ep2Table.scenes?.[0]?.resolvedCastAssets?.some((item: { name: string; assetId?: string; variants?: Array<{ id: string; variantKind?: string }>; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }) =>
    item.name === '主角' &&
    item.assetId === 'hero' &&
    item.variants?.some((variant) => variant.id === 'gala' && variant.variantKind === 'makeup') &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second'),
  ) &&
    ep2Table.scenes?.[0]?.segments?.[0]?.rows?.[0]?.resolvedAssetRefs?.some((item: { name: string; assetId?: string; variants?: Array<{ id: string; variantKind?: string }>; assetCenterUsage?: { currentProject?: { appearanceLabels?: string[] } } }) =>
      item.name === '主角' &&
      item.assetId === 'hero' &&
      item.variants?.some((variant) => variant.id === 'gala' && variant.variantKind === 'makeup') &&
      item.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  JSON.stringify(ep2Table.scenes),
)

const ep2Timeline = JSON.parse(await getTimeline.execute({ episodeIndex: 2 }))
check('get_timeline reads non-current episode by episode index', ep2Timeline.tracks?.[0]?.id === 'track-ep2' && ep2Timeline.clips?.[0]?.id === 'clip-ep2' && ep2Timeline.episodeId === 'ep2', JSON.stringify(ep2Timeline))
check(
  'get_timeline exposes storyboard cast asset-center usage',
  ep2Timeline.tracks?.[0]?.storyboardCastAssets?.some((item: { storyboardId: string; castAssets?: Array<{ assetId: string; variantId?: string; variantKind?: string; assetCenterUsage?: { entityId?: string; currentProject?: { appearanceLabels?: string[] } } }> }) =>
    item.storyboardId === 'sb-ep2' &&
    item.castAssets?.some((cast) =>
      cast.assetId === 'hero' &&
      cast.variantId === 'gala' &&
      cast.variantKind === 'makeup' &&
      cast.assetCenterUsage?.entityId === 'el-hero' &&
      cast.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala'),
    ),
  ),
  JSON.stringify(ep2Timeline.tracks),
)
const missingEpisodeRead = JSON.parse(await getScript.execute({ episodeIndex: 99 }))
check('read tools reject invalid explicit episode selectors instead of falling back to current episode', !!missingEpisodeRead.error && !missingEpisodeRead.id, JSON.stringify(missingEpisodeRead))
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
          appliesToEpisodeIds: existing?.appliesToEpisodeIds,
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
    state: 'done',
    variants: [
      { id: 'gala', label: 'Gala', appliesToEpisodeIds: ['ep1'] },
      { id: 'cloak', label: 'Cloak', appliesToEpisodeIds: ['ep1'] },
    ],
  },
  { id: 'hall', type: 'scene', name: 'Hall', state: 'done' },
  { id: 'lobby', type: 'scene', name: 'Lobby', state: 'done' },
  { id: 'lantern', type: 'prop', name: 'Lantern', state: 'done' },
  { id: 'sync-target', type: 'role', name: 'Local Hero', refImageId: 'local-hero-img', state: 'done', variants: [{ id: 'local-gala', label: 'Library Gala', appliesToEpisodeIds: ['ep1'] }] },
  { id: 'publish-blocked', type: 'role', name: 'Archived Linked Hero', refImageId: 'archived-linked-img', state: 'done', libraryLink: { entityId: 'el-archived', syncPolicy: 'snapshot' } },
  { id: 'hero-duplicate', type: 'role', name: 'Hero Double', aliases: ['影子主角'], state: 'done', libraryLink: { entityId: 'el-hero', syncPolicy: 'snapshot' }, variants: [{ id: 'alt-gala', label: 'Gala' }] },
  { id: 'legacy-linked', type: 'role', name: 'Legacy Linked Hero', refImageId: 'legacy-linked-img', state: 'done', elementId: 'el-legacy-old' },
  { id: 'forked-sync', type: 'role', name: 'Forked Sync Hero', refImageId: 'forked-sync-img', state: 'done', elementId: 'el-forked-old', libraryLink: { entityId: 'el-forked-old', syncPolicy: 'forked' }, rejectedLibraryEntityIds: ['el-forked-old'] },
]
writableDoc.episodes![1].storyboards = [storyboard('sb-ep2-original', 0, 'Second episode original shot.')]
const writeState = makeWritableState(writableDoc)
const writeTools = makeAgentTools(() => writeState)
const upsertScript = writeTools.find((tool) => tool.name === 'upsert_script')
const addStoryboard = writeTools.find((tool) => tool.name === 'add_storyboard')
const updateAsset = writeTools.find((tool) => tool.name === 'update_asset')
const generateAsset = writeTools.find((tool) => tool.name === 'generate_asset')
const updateSeriesBible = writeTools.find((tool) => tool.name === 'update_series_bible')
const upsertEpisodePlan = writeTools.find((tool) => tool.name === 'upsert_episode_plan')
const applyHandoffSuggestion = writeTools.find((tool) => tool.name === 'apply_episode_handoff_suggestion')
const linkLibraryEntity = writeTools.find((tool) => tool.name === 'link_project_asset_to_library_entity')
const markDistinctIdentity = writeTools.find((tool) => tool.name === 'mark_project_asset_distinct_identity')
const publishProjectAsset = writeTools.find((tool) => tool.name === 'publish_project_asset_to_library')
const syncProjectAsset = writeTools.find((tool) => tool.name === 'sync_project_asset_from_library')
const mergeProjectAsset = writeTools.find((tool) => tool.name === 'merge_project_asset_into')
const setAssetRef = writeTools.find((tool) => tool.name === 'set_storyboard_asset_ref')
const setVariantScope = writeTools.find((tool) => tool.name === 'set_asset_variant_scope')
const setCastVariant = writeTools.find((tool) => tool.name === 'set_storyboard_cast_variant')
const setSceneAsset = writeTools.find((tool) => tool.name === 'set_storyboard_scene_asset')
const setEpisodeSeriesSkip = writeTools.find((tool) => tool.name === 'set_episode_series_skip')

if (!upsertScript || !addStoryboard || !updateAsset || !generateAsset || !updateSeriesBible || !upsertEpisodePlan || !applyHandoffSuggestion || !linkLibraryEntity || !markDistinctIdentity || !publishProjectAsset || !syncProjectAsset || !mergeProjectAsset || !setAssetRef || !setVariantScope || !setCastVariant || !setSceneAsset || !setEpisodeSeriesSkip) {
  console.error('  FAIL write tools exist: required write tools missing')
  process.exit(1)
}

const updatedSeriesBible = JSON.parse(await updateSeriesBible.execute({ logline: 'A sharper season hook.', plannedEpisodeCount: 5, continuityRules: ['Hero wears Gala only in E2'] }))
check(
  'update_series_bible writes season planning fields',
  updatedSeriesBible.seriesBible?.logline === 'A sharper season hook.' &&
    updatedSeriesBible.seriesBible?.plannedEpisodeCount === 5 &&
    writableDoc.seriesBible?.continuityRules?.includes('Hero wears Gala only in E2') === true,
  JSON.stringify(updatedSeriesBible),
)

const updatedEpisodePlan = JSON.parse(
  await upsertEpisodePlan.execute({
    episodeTitle: 'Second',
    hook: 'Hero sees the hidden clue.',
    conflict: 'The hallway trap closes.',
    cliffhanger: 'The Gala mask cracks.',
    requiredAssetNames: ['Hero', 'Hall'],
    requiredVariants: [{ assetName: 'Hero', variantLabel: 'Gala' }],
  }),
)
check(
  'upsert_episode_plan writes selected episode plan and resolves names',
  updatedEpisodePlan.episode?.episodeId === 'ep2' &&
    updatedEpisodePlan.plan?.hook === 'Hero sees the hidden clue.' &&
    updatedEpisodePlan.plan?.requiredAssetIds?.includes('hero') &&
    updatedEpisodePlan.plan?.requiredAssetIds?.includes('hall') &&
    updatedEpisodePlan.plan?.requiredVariantIds?.includes('gala'),
  JSON.stringify(updatedEpisodePlan),
)

const variantOnlyEpisodePlan = JSON.parse(
  await upsertEpisodePlan.execute({
    episodeTitle: 'Third',
    requiredVariants: [{ assetName: 'Hero', variantLabel: 'Cloak' }],
  }),
)
check(
  'upsert_episode_plan adds parent assets for required variants',
  variantOnlyEpisodePlan.episode?.episodeId === 'ep3' &&
    variantOnlyEpisodePlan.plan?.requiredVariantIds?.includes('cloak') &&
    variantOnlyEpisodePlan.plan?.requiredAssetIds?.includes('hero'),
  JSON.stringify(variantOnlyEpisodePlan),
)

const appliedHandoffSuggestions = JSON.parse(await applyHandoffSuggestion.execute({ episodeTitle: 'Third', allAuto: true }))
const heroAfterHandoff = writableDoc.assets.find((item) => item.id === 'hero')
const cloakAfterHandoff = heroAfterHandoff?.variants?.find((item) => item.id === 'cloak')
check(
  'apply_episode_handoff_suggestion repairs planned handoff inputs',
  appliedHandoffSuggestions.episode?.episodeId === 'ep3' &&
    appliedHandoffSuggestions.applied?.some((item: { kind: string; assetId?: string }) => item.kind === 'generate_asset_ref_image' && item.assetId === 'hero') &&
    appliedHandoffSuggestions.applied?.some((item: { kind: string; variantId?: string }) => item.kind === 'add_variant_episode_scope' && item.variantId === 'cloak') &&
    appliedHandoffSuggestions.applied?.some((item: { kind: string; variantId?: string }) => item.kind === 'generate_variant_ref_image' && item.variantId === 'cloak') &&
    heroAfterHandoff?.refImageId === 'generated-hero' &&
    cloakAfterHandoff?.refImageId === 'generated-hero-cloak' &&
    cloakAfterHandoff?.appliesToEpisodeIds?.includes('ep3') === true &&
    !appliedHandoffSuggestions.remainingSuggestions?.some((item: { id: string }) => item.id.includes('cloak')),
  JSON.stringify({ appliedHandoffSuggestions, heroAfterHandoff, cloakAfterHandoff }),
)

const upsertEp2Script = JSON.parse(await upsertScript.execute({ episodeTitle: 'Second', name: 'Second Script Rewrite', content: 'Second episode targeted rewrite.' }))
const ep1AfterScript = writableDoc.episodes?.find((item) => item.id === 'ep1')
const ep2WrittenScript = writableDoc.scripts.find((item) => item.id === upsertEp2Script.id)
check(
  'upsert_script writes selected non-current episode',
  writableDoc.currentEpisodeId === 'ep2' &&
    upsertEp2Script.episode?.episodeId === 'ep2' &&
    ep2WrittenScript?.content === 'Second episode targeted rewrite.' &&
    ep1AfterScript?.scripts[0]?.content === 'Current episode only.',
  JSON.stringify({ upsertEp2Script, currentScripts: writableDoc.scripts, ep1Scripts: ep1AfterScript?.scripts }),
)

const addedStoryboard = JSON.parse(await addStoryboard.execute({ episodeIndex: 2, videoDesc: 'Second episode new shot.', cast: ['主角'] }))
const ep1AfterAdd = writableDoc.episodes?.find((item) => item.id === 'ep1')
check('add_storyboard writes selected non-current episode', writableDoc.currentEpisodeId === 'ep2' && addedStoryboard.episode?.episodeId === 'ep2' && addedStoryboard.storyboard?.videoDesc === 'Second episode new shot.', JSON.stringify(addedStoryboard))
check('add_storyboard resolves cast aliases', addedStoryboard.storyboard?.castRefs?.some((ref: { assetId: string }) => ref.assetId === 'hero'), JSON.stringify(addedStoryboard.storyboard))
check(
  'add_storyboard returns cast asset-center usage',
  addedStoryboard.storyboard?.castAssets?.some((item: { assetId: string; assetCenterUsage?: { entityId?: string; currentProject?: { episodeLabels?: string[] } } }) =>
    item.assetId === 'hero' &&
    item.assetCenterUsage?.entityId === 'el-hero' &&
    item.assetCenterUsage.currentProject?.episodeLabels?.includes('E2 Second'),
  ),
  JSON.stringify(addedStoryboard.storyboard?.castAssets),
)
check('add_storyboard does not append to previous current episode', !ep1AfterAdd?.storyboards.some((item) => item.videoDesc === 'Second episode new shot.'), JSON.stringify(ep1AfterAdd?.storyboards))

const scopedAddedStoryboard = JSON.parse(
  await addStoryboard.execute({ episodeTitle: 'Second', videoDesc: 'Second episode scoped shot.', sceneId: 'rooftop', castRefs: [{ assetName: 'Hero', variantLabel: 'Cloak' }], ensureScope: true, scopeKind: 'scene' }),
)
check(
  'add_storyboard can persist sceneId and scope bound variants',
  scopedAddedStoryboard.storyboard?.sceneId === 'rooftop' &&
    scopedAddedStoryboard.storyboard?.castRefs?.some((ref: { assetId: string; variantId?: string }) => ref.assetId === 'hero' && ref.variantId === 'cloak') &&
    scopedAddedStoryboard.storyboard?.castAssets?.some((item: { assetId: string; variantId?: string; assetCenterUsage?: { currentProject?: { appearanceLabels?: string[] } } }) =>
      item.assetId === 'hero' &&
      item.variantId === 'cloak' &&
      item.assetCenterUsage?.currentProject?.appearanceLabels?.some((label) => label.includes('Cloak')),
    ) &&
    scopedAddedStoryboard.variants?.some((item: { variant?: { id: string; appliesToSceneIds?: string[] } }) => item.variant?.id === 'cloak' && item.variant.appliesToSceneIds?.includes('rooftop')),
  JSON.stringify(scopedAddedStoryboard),
)

const updatedAsset = JSON.parse(await updateAsset.execute({ assetName: 'Hero', aliases: ['主角', '队长'], aliasMode: 'replace', desc: 'Lead role with a stable identity.' }))
check(
  'update_asset edits existing asset aliases and desc',
  updatedAsset.asset?.id === 'hero' &&
    updatedAsset.asset?.aliases?.includes('主角') &&
    updatedAsset.asset?.aliases?.includes('队长') &&
    updatedAsset.asset?.desc === 'Lead role with a stable identity.' &&
    writableDoc.assets.find((item) => item.id === 'hero')?.aliases?.includes('队长') === true,
  JSON.stringify(updatedAsset),
)

const linkedLibraryAsset = JSON.parse(await linkLibraryEntity.execute({ assetName: 'Hero', libraryEntityId: 'el-hero', entityVersion: 2 }))
check(
  'link_project_asset_to_library_entity links without overwriting project fields',
  linkedLibraryAsset.linked === true &&
    linkedLibraryAsset.asset?.id === 'hero' &&
    linkedLibraryAsset.asset?.name === 'Hero' &&
    linkedLibraryAsset.asset?.elementId === 'el-hero' &&
    linkedLibraryAsset.asset?.libraryLink?.entityId === 'el-hero' &&
    linkedLibraryAsset.asset?.libraryLink?.entityVersion === 2 &&
    linkedLibraryAsset.asset?.assetCenterUsage?.entityId === 'el-hero' &&
    linkedLibraryAsset.asset?.assetCenterUsage?.currentProject?.episodeLabels?.includes('E2 Second') &&
    linkedLibraryAsset.asset?.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Gala') &&
    linkedLibraryAsset.asset?.assetCenterUsage?.currentProject?.appearanceLabels?.includes('E2 Second · Cloak'),
  JSON.stringify(linkedLibraryAsset),
)

const distinctIdentity = JSON.parse(await markDistinctIdentity.execute({ assetName: 'Hero', libraryEntityIds: ['el-rival', 'el-hero'] }))
check(
  'mark_project_asset_distinct_identity stores rejected identity ids and forks current link',
  distinctIdentity.marked === true &&
    distinctIdentity.rejectedLibraryEntityIds?.includes('el-rival') &&
    distinctIdentity.rejectedLibraryEntityIds?.includes('el-hero') &&
    distinctIdentity.asset?.libraryLink?.syncPolicy === 'forked',
  JSON.stringify(distinctIdentity),
)

const legacyDistinctIdentity = JSON.parse(await markDistinctIdentity.execute({ assetId: 'legacy-linked', libraryEntityIds: ['el-legacy-old'] }))
check(
  'mark_project_asset_distinct_identity forks legacy element links',
  legacyDistinctIdentity.marked === true &&
    legacyDistinctIdentity.rejectedLibraryEntityIds?.includes('el-legacy-old') &&
    legacyDistinctIdentity.asset?.libraryLink?.entityId === 'el-legacy-old' &&
    legacyDistinctIdentity.asset?.libraryLink?.syncPolicy === 'forked',
  JSON.stringify(legacyDistinctIdentity),
)
const publishedForkedLegacyAsset = JSON.parse(await publishProjectAsset.execute({ assetId: 'legacy-linked' }))
check(
  'publish_project_asset_to_library saves forked legacy assets as a new identity',
  publishedForkedLegacyAsset.published === true &&
    publishedForkedLegacyAsset.asset?.id === 'legacy-linked' &&
    publishedForkedLegacyAsset.asset?.elementId === 'el-legacy-linked' &&
    publishedForkedLegacyAsset.asset?.libraryLink?.entityId === 'el-legacy-linked' &&
    publishedForkedLegacyAsset.asset?.assetCenterUsage?.entityId === 'el-legacy-linked' &&
    publishedForkedLegacyAsset.asset?.rejectedLibraryEntityIds?.includes('el-legacy-old'),
  JSON.stringify(publishedForkedLegacyAsset),
)

const publishedProjectAsset = JSON.parse(await publishProjectAsset.execute({ assetId: 'sync-target' }))
check(
  'publish_project_asset_to_library publishes a project asset and links the snapshot',
  publishedProjectAsset.published === true &&
    publishedProjectAsset.asset?.id === 'sync-target' &&
    publishedProjectAsset.asset?.elementId === 'el-sync-target' &&
    publishedProjectAsset.asset?.libraryLink?.entityId === 'el-sync-target' &&
    publishedProjectAsset.asset?.assetCenterUsage?.entityId === 'el-sync-target',
  JSON.stringify(publishedProjectAsset),
)
const blockedPublishedProjectAsset = JSON.parse(await publishProjectAsset.execute({ assetId: 'publish-blocked' }))
check(
  'publish_project_asset_to_library reports blocked publish',
  blockedPublishedProjectAsset.published === false && !!blockedPublishedProjectAsset.error && blockedPublishedProjectAsset.asset?.id === 'publish-blocked',
  JSON.stringify(blockedPublishedProjectAsset),
)

;(globalThis as unknown as { window: unknown }).window = {
  mulby: {
    storage: {
      get: async (key: string) =>
        key === 'elements:library'
          ? [
              {
                id: 'el-sync',
                kind: 'character',
                name: 'Synced Hero',
                aliases: ['Synced Alias'],
                identity: 'same face, silver scar',
                description: 'From library snapshot.',
                prompt: 'library prompt',
                refAssetIds: ['synced-main-img'],
                tags: ['lead'],
                voiceId: 'voice-synced',
                lora: { provider: 'fal', ref: 'synced-hero-lora', weight: 0.65 },
                appearanceVariants: [{ id: 'lib-gala', label: 'Library Gala', kind: 'makeup', refAssetIds: ['synced-gala-img'], tags: ['formal'] }],
                createdAt: 0,
                updatedAt: 2,
                version: 4,
              },
              {
                id: 'el-forked-old',
                kind: 'character',
                name: 'Old Forked Hero',
                refAssetIds: ['old-forked-img'],
                createdAt: 0,
                updatedAt: 2,
                version: 7,
              },
            ]
          : [],
    },
  },
}
const implicitForkedSync = JSON.parse(await syncProjectAsset.execute({ assetId: 'forked-sync' }))
check(
  'sync_project_asset_from_library does not implicitly sync forked identity links',
  !!implicitForkedSync.error &&
    implicitForkedSync.asset?.id === 'forked-sync' &&
    implicitForkedSync.asset?.name === 'Forked Sync Hero' &&
    implicitForkedSync.asset?.libraryLink?.syncPolicy === 'forked',
  JSON.stringify(implicitForkedSync),
)
const explicitForkedSync = JSON.parse(await syncProjectAsset.execute({ assetId: 'forked-sync', libraryEntityId: 'el-forked-old' }))
check(
  'sync_project_asset_from_library clears accepted rejected identity ids',
  explicitForkedSync.synced === true &&
    explicitForkedSync.asset?.id === 'forked-sync' &&
    explicitForkedSync.asset?.name === 'Old Forked Hero' &&
    explicitForkedSync.asset?.libraryLink?.entityId === 'el-forked-old' &&
    explicitForkedSync.asset?.libraryLink?.syncPolicy === 'snapshot' &&
    explicitForkedSync.asset?.assetCenterUsage?.entityId === 'el-forked-old' &&
    !explicitForkedSync.asset?.rejectedLibraryEntityIds?.includes('el-forked-old'),
  JSON.stringify(explicitForkedSync),
)
const syncedProjectAsset = JSON.parse(await syncProjectAsset.execute({ assetId: 'sync-target', libraryEntityId: 'el-sync' }))
check(
  'sync_project_asset_from_library updates snapshot fields and preserves local variant scope',
  syncedProjectAsset.synced === true &&
    syncedProjectAsset.asset?.id === 'sync-target' &&
    syncedProjectAsset.asset?.name === 'Synced Hero' &&
    syncedProjectAsset.asset?.refImageId === 'synced-main-img' &&
    syncedProjectAsset.asset?.voiceAssetId === 'voice-synced' &&
    syncedProjectAsset.asset?.audioBindState === 'done' &&
    syncedProjectAsset.asset?.lora?.ref === 'synced-hero-lora' &&
    syncedProjectAsset.asset?.libraryLink?.entityId === 'el-sync' &&
    syncedProjectAsset.asset?.libraryLink?.entityVersion === 4 &&
    syncedProjectAsset.asset?.assetCenterUsage?.entityId === 'el-sync' &&
    syncedProjectAsset.entity?.identity === 'same face, silver scar' &&
    syncedProjectAsset.entity?.voiceRef?.assetId === 'voice-synced' &&
    syncedProjectAsset.entity?.lora?.ref === 'synced-hero-lora' &&
    syncedProjectAsset.entity?.mediaRefs?.some((ref: { assetId?: string; role?: string }) => ref.assetId === 'synced-main-img' && ref.role === 'primary') &&
    syncedProjectAsset.entity?.variants?.some((variant: { id: string; kind?: string; mediaRefs?: Array<{ assetId?: string }> }) => variant.id === 'lib-gala' && variant.kind === 'makeup' && variant.mediaRefs?.some((ref) => ref.assetId === 'synced-gala-img')) &&
    syncedProjectAsset.asset?.variants?.some((variant: { id: string; libraryVariantId?: string; variantKind?: string; appliesToEpisodeIds?: string[]; refImageId?: string }) => variant.id === 'local-gala' && variant.libraryVariantId === 'lib-gala' && variant.variantKind === 'makeup' && variant.appliesToEpisodeIds?.includes('ep1') && variant.refImageId === 'synced-gala-img'),
  JSON.stringify(syncedProjectAsset),
)

await generateAsset.execute({ name: '队长' })
check('generate_asset resolves asset aliases', writableDoc.assets.find((item) => item.id === 'hero')?.refImageId === 'generated-hero', JSON.stringify(writableDoc.assets.find((item) => item.id === 'hero')))

writableDoc.storyboards.push({
  ...storyboard('dup-hero-shot', writableDoc.storyboards.length, 'Duplicate hero appears.'),
  associateAssetIds: ['hero-duplicate'],
  castRefs: [{ assetId: 'hero-duplicate', variantId: 'alt-gala' }],
})
const mergedProjectAsset = JSON.parse(await mergeProjectAsset.execute({ sourceAssetId: 'hero-duplicate', targetAssetId: 'hero' }))
const rewrittenDuplicateShot = writableDoc.storyboards.find((item) => item.id === 'dup-hero-shot')
check(
  'merge_project_asset_into removes source asset and rewrites storyboard refs',
  mergedProjectAsset.merged === true &&
    mergedProjectAsset.sourceStillExists === false &&
    !writableDoc.assets.some((item) => item.id === 'hero-duplicate') &&
    rewrittenDuplicateShot?.castRefs?.some((ref) => ref.assetId === 'hero' && ref.variantId === 'gala') === true,
  JSON.stringify({ mergedProjectAsset, rewrittenDuplicateShot }),
)

const invalidStoryboardIndex = JSON.parse(await setCastVariant.execute({ episodeTitle: 'Second', index: 0, assetName: 'Hero', variantLabel: 'Gala' }))
check('write tools reject non-positive storyboard indexes', !!invalidStoryboardIndex.error, JSON.stringify(invalidStoryboardIndex))

const variantResult = JSON.parse(await setCastVariant.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero', variantLabel: 'Gala' }))
check('set_storyboard_cast_variant writes selected episode storyboard', variantResult.episode?.episodeId === 'ep2' && variantResult.storyboard?.castRefs?.some((ref: { assetId: string; variantId?: string }) => ref.assetId === 'hero' && ref.variantId === 'gala'), JSON.stringify(variantResult))

const scopedVariantStoryboard = writableDoc.storyboards.find((item) => item.id === variantResult.storyboard?.id)
if (scopedVariantStoryboard) scopedVariantStoryboard.sceneId = 'banquet'
const scopedVariantResult = JSON.parse(await setCastVariant.execute({ episodeTitle: 'Second', index: 2, assetName: 'Hero', variantLabel: 'Gala', ensureScope: true, scopeKind: 'scene' }))
check(
  'set_storyboard_cast_variant can scope a bound variant to the selected scene',
  scopedVariantResult.variant?.variant?.appliesToSceneIds?.includes('banquet') === true &&
    scopedVariantResult.storyboard?.castRefs?.some((ref: { assetId: string; variantId?: string }) => ref.assetId === 'hero' && ref.variantId === 'gala'),
  JSON.stringify(scopedVariantResult),
)

const sceneScopeResult = JSON.parse(await setVariantScope.execute({ assetName: 'Hero', variantLabel: 'Gala', scopeKind: 'scene', sceneId: 'banquet' }))
const scopedHeroVariant = writableDoc.assets.find((item) => item.id === 'hero')?.variants?.find((item) => item.id === 'gala')
check(
  'set_asset_variant_scope adds scene scope without replacing episode scope',
  sceneScopeResult.scopeKind === 'scene' &&
    scopedHeroVariant?.appliesToEpisodeIds?.includes('ep1') === true &&
    scopedHeroVariant?.appliesToSceneIds?.includes('banquet') === true,
  JSON.stringify(sceneScopeResult),
)

const removeScopeResult = JSON.parse(await setVariantScope.execute({ assetId: 'hero', variantId: 'gala', scopeKind: 'episode', episodeId: 'ep1', remove: true }))
check(
  'set_asset_variant_scope removes one scope and keeps other scope kinds',
  removeScopeResult.action === 'remove' &&
    !scopedHeroVariant?.appliesToEpisodeIds?.includes('ep1') &&
    scopedHeroVariant?.appliesToSceneIds?.includes('banquet') === true,
  JSON.stringify(removeScopeResult),
)

const assetRefResult = JSON.parse(await setAssetRef.execute({ episodeTitle: 'Second', index: 2, assetName: 'Lantern', roleInShot: 'supporting' }))
check(
  'set_storyboard_asset_ref adds unused asset to selected storyboard',
  assetRefResult.episode?.episodeId === 'ep2' &&
    assetRefResult.storyboard?.castRefs?.some((ref: { assetId: string; roleInShot?: string }) => ref.assetId === 'lantern' && ref.roleInShot === 'supporting') &&
    assetRefResult.storyboard?.castAssetIds?.includes('lantern'),
  JSON.stringify(assetRefResult),
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

const restoredEpisode = JSON.parse(await setEpisodeSeriesSkip.execute({ episodeTitle: 'Second', skip: false }))
check('set_episode_series_skip restores selected episode queue state', restoredEpisode.episode?.id === 'ep2' && restoredEpisode.episode?.seriesSkip === false && restoredEpisode.episode?.seriesQueueState === 'pending', JSON.stringify(restoredEpisode))

if (failures) {
  console.error(`\nagentTools selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nagentTools selftest: ALL PASSED')
