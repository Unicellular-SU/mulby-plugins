import { buildEpisodeProductionHandoff, buildEpisodeProductionRecap, currentEpisodeUsesCastRef, episodeComposeReadiness, episodeProductionContinuityBlockers, episodeSeriesQueueState, formatEpisodeProductionContinuityError, hasEpisodeProductionState, invalidateEpisodeProduction, invalidateEpisodesUsingAsset, invalidateEpisodesUsingCastRef, invalidateProductionScope, missingReferencedVariantImages, pendingEpisodesForSeries, productionScopeForStoryboard, productionScopeForTrack, projectDocForProductionScope, setStoryboardCastVariantForScope } from './episodeProduction'
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
  return { id: 'p1', name: 'series', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 }
}

function storyboard(id: string, index: number, castRefs: Storyboard['castRefs'], patch: Partial<Storyboard> = {}): Storyboard {
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
    ...patch,
  }
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

const assets: Asset[] = [
  {
    id: 'hero',
    type: 'role',
    name: 'Hero',
    refImageId: 'hero-main',
    state: 'done',
    variants: [
      { id: 'gala', label: 'Gala' },
      { id: 'battle', label: 'Battle', refImageId: 'hero-battle' },
    ],
  },
  { id: 'voice', type: 'audio', name: 'Voice', state: 'idle', variants: [{ id: 'radio', label: 'Radio' }] },
]

const missing = missingReferencedVariantImages(
  doc({
    assets,
    storyboards: [
      storyboard('s1', 0, [{ assetId: 'hero', variantId: 'gala' }]),
      storyboard('s2', 1, [{ assetId: 'hero', variantId: 'gala' }, { assetId: 'hero', variantId: 'battle' }, { assetId: 'voice', variantId: 'radio' }]),
      storyboard('s3', 2, [{ assetId: 'missing', variantId: 'ghost' }, { assetId: 'hero' }]),
    ],
  }),
)
check('collects only referenced missing variant images', missing.length === 1 && missing[0]?.assetId === 'hero' && missing[0]?.variantId === 'gala', JSON.stringify(missing))

const planned = doc({
  currentEpisodeId: 'ep1',
  storyboards: [storyboard('current', 0, [{ assetId: 'prop' }])],
  episodes: [
    episode('ep1', 0, { storyboards: [] }),
    episode('ep2', 1, { storyboards: [storyboard('ep2-shot', 0, [])], filmPath: 'done.mp4' }),
    episode('ep3', 2, { storyboards: [] }),
    episode('ep4', 3, { storyboards: [storyboard('ep4-shot', 0, [])], track: [{ id: 'ep4-track', storyboardIds: ['ep4-shot'], clipIds: [], order: 0 }], filmError: 'failed' }),
    episode('ep5', 4, { storyboards: [storyboard('ep5-shot', 0, [])], seriesSkip: true }),
    episode('ep6', 5, { status: 'done', storyboards: [storyboard('ep6-shot', 0, [])] }),
  ],
})
const pending = pendingEpisodesForSeries(planned)
check('series production uses current flat storyboards and skips completed, failed, or held episodes', pending.map((item) => item.id).join(',') === 'ep1,ep6', JSON.stringify(pending.map((item) => item.id)))
check('classifies failed episodes as held for explicit retry', episodeSeriesQueueState(planned, planned.episodes![3]) === 'failed', episodeSeriesQueueState(planned, planned.episodes![3]))
check('does not treat done status without film path as completed', episodeSeriesQueueState(planned, planned.episodes![5]) === 'pending', episodeSeriesQueueState(planned, planned.episodes![5]))
check('skips manually held episodes from series production', episodeSeriesQueueState(planned, planned.episodes![4]) === 'skipped' && !pendingEpisodesForSeries(planned).some((item) => item.id === 'ep5'), JSON.stringify(pendingEpisodesForSeries(planned).map((item) => item.id)))
planned.episodes![4].seriesSkip = false
check('restoring a held episode returns it to the series queue', pendingEpisodesForSeries(planned).map((item) => item.id).join(',') === 'ep1,ep5,ep6', JSON.stringify(pendingEpisodesForSeries(planned).map((item) => item.id)))
const resetFailedEpisode = invalidateEpisodeProduction(planned.episodes![3])
check('resetting a failed episode returns it to the series queue', resetFailedEpisode && pendingEpisodesForSeries(planned).map((item) => item.id).join(',') === 'ep1,ep4,ep5,ep6', JSON.stringify(pendingEpisodesForSeries(planned).map((item) => item.id)))
const nonCurrentScope = productionScopeForStoryboard(planned, 'ep4-shot')
const nonCurrentTrackScope = productionScopeForTrack(planned, 'ep4-track')
const nonCurrentFlatDoc = projectDocForProductionScope(planned, nonCurrentTrackScope)
check(
  'finds non-current episode production scope by storyboard id',
  !!nonCurrentScope && !nonCurrentScope.current && nonCurrentScope.episode?.id === 'ep4' && nonCurrentScope.storyboards[0]?.id === 'ep4-shot',
  JSON.stringify(nonCurrentScope?.episode),
)
check(
  'finds non-current episode production scope by track id',
  !!nonCurrentTrackScope && !nonCurrentTrackScope.current && nonCurrentTrackScope.episode?.id === 'ep4' && nonCurrentTrackScope.track[0]?.id === 'ep4-track',
  JSON.stringify(nonCurrentTrackScope?.episode),
)
check(
  'projects non-current production scope into flat doc view',
  nonCurrentFlatDoc.currentEpisodeId === 'ep4' && nonCurrentFlatDoc.storyboards[0]?.id === 'ep4-shot' && nonCurrentFlatDoc.track[0]?.id === 'ep4-track',
  JSON.stringify({ currentEpisodeId: nonCurrentFlatDoc.currentEpisodeId, storyboards: nonCurrentFlatDoc.storyboards, track: nonCurrentFlatDoc.track }),
)
Object.assign(planned.episodes![3], { filmPath: 'ep4.mp4', status: 'done' as const })
const invalidatedScopedEpisode = invalidateProductionScope(planned, nonCurrentScope)
check(
  'invalidates the episode matched by production scope',
  invalidatedScopedEpisode && planned.episodes![3].status === 'planned' && !planned.episodes![3].filmPath,
  JSON.stringify(planned.episodes![3]),
)
const scopedCastVariantDoc = doc({
  currentEpisodeId: 'ep1',
  storyboards: [storyboard('ep1-scope-shot', 0, [{ assetId: 'hero' }])],
  episodes: [
    episode('ep1', 0, { status: 'done', filmPath: 'ep1.mp4' }),
    episode('ep2', 1, { status: 'done', filmPath: 'ep2.mp4', storyboards: [storyboard('ep2-scope-shot', 0, [])] }),
  ],
})
const scopedCastVariantSet = setStoryboardCastVariantForScope(scopedCastVariantDoc, 'ep2-scope-shot', 'hero', 'battle')
const scopedCastVariantStoryboard = scopedCastVariantDoc.episodes![1].storyboards[0]
check(
  'sets cast variants on non-current episode storyboards without touching current flat data',
  scopedCastVariantSet &&
    scopedCastVariantStoryboard.associateAssetIds.includes('hero') &&
    scopedCastVariantStoryboard.castRefs?.some((ref) => ref.assetId === 'hero' && ref.variantId === 'battle') === true &&
    !scopedCastVariantDoc.storyboards[0].castRefs?.some((ref) => ref.variantId === 'battle'),
  JSON.stringify({ current: scopedCastVariantDoc.storyboards[0], target: scopedCastVariantStoryboard }),
)
check(
  'invalidates only the episode containing the cast variant edit',
  scopedCastVariantDoc.episodes![0].filmPath === 'ep1.mp4' && scopedCastVariantDoc.episodes![1].status === 'planned' && !scopedCastVariantDoc.episodes![1].filmPath,
  JSON.stringify(scopedCastVariantDoc.episodes),
)
check('detects current episode main cast reference use', currentEpisodeUsesCastRef(planned, 'prop'), JSON.stringify(planned.storyboards))
const variantOnly = doc({ currentEpisodeId: 'ep1', storyboards: [storyboard('variant-only', 0, [{ assetId: 'hero', variantId: 'battle' }])], episodes: [episode('ep1', 0)] })
check('does not treat variant use as main cast reference use', !currentEpisodeUsesCastRef(variantOnly, 'hero') && currentEpisodeUsesCastRef(variantOnly, 'hero', 'battle'), 'variant-only use should not invalidate main refs')

const crossEpisodeRefs = doc({
  currentEpisodeId: 'ep1',
  storyboards: [storyboard('ep1-main', 0, [{ assetId: 'prop' }])],
  episodes: [
    episode('ep1', 0, { status: 'done', filmPath: 'ep1.mp4' }),
    episode('ep2', 1, { status: 'done', filmPath: 'ep2.mp4', storyboards: [storyboard('ep2-main', 0, [{ assetId: 'prop' }])] }),
    episode('ep3', 2, { status: 'done', filmPath: 'ep3.mp4', storyboards: [storyboard('ep3-variant', 0, [{ assetId: 'hero', variantId: 'battle' }])] }),
  ],
})
const invalidatedMainRefs = invalidateEpisodesUsingCastRef(crossEpisodeRefs, 'prop')
check('invalidates every produced episode that uses a shared main asset ref', invalidatedMainRefs === 2 && !crossEpisodeRefs.episodes![0].filmPath && !crossEpisodeRefs.episodes![1].filmPath && !!crossEpisodeRefs.episodes![2].filmPath, JSON.stringify(crossEpisodeRefs.episodes))
const invalidatedVariantRefs = invalidateEpisodesUsingCastRef(crossEpisodeRefs, 'hero', 'battle')
check('invalidates produced non-current episode that uses a shared variant ref', invalidatedVariantRefs === 1 && !crossEpisodeRefs.episodes![2].filmPath, JSON.stringify(crossEpisodeRefs.episodes))

const deletedAssetRefs = doc({
  currentEpisodeId: 'ep1',
  storyboards: [storyboard('ep1-main-delete', 0, [{ assetId: 'hero' }])],
  episodes: [
    episode('ep1', 0, { status: 'done', filmPath: 'ep1.mp4' }),
    episode('ep2', 1, { status: 'done', filmPath: 'ep2.mp4', storyboards: [storyboard('ep2-variant-delete', 0, [{ assetId: 'hero', variantId: 'battle' }])] }),
  ],
})
const invalidatedDeletedAsset = invalidateEpisodesUsingAsset(deletedAssetRefs, 'hero')
check('invalidates all produced episodes that use a deleted shared asset', invalidatedDeletedAsset === 2 && !deletedAssetRefs.episodes![0].filmPath && !deletedAssetRefs.episodes![1].filmPath, JSON.stringify(deletedAssetRefs.episodes))

const produced = episode('done', 0, { status: 'done', filmPath: 'film.mp4', filmError: 'old error', producedAt: 123, productionRecap: 'old recap', updatedAt: 10 })
const changed = invalidateEpisodeProduction(produced)
check('invalidates produced episode state', changed && produced.status === 'planned' && !produced.filmPath && !produced.filmError && !produced.producedAt && !produced.productionRecap && produced.updatedAt >= 10, JSON.stringify(produced))

const untouched = episode('draft', 1, { status: 'draft' })
check('leaves untouched episode unchanged', !invalidateEpisodeProduction(untouched), JSON.stringify(untouched))
check('detects recap-only production state', hasEpisodeProductionState(episode('recap', 2, { productionRecap: 'old recap' })), 'recap-only state was not detected')

const recapDoc = doc({
  currentEpisodeId: 'ep1',
  novel: [{ id: 'c1', index: 0, title: 'Opening', text: 'chapter text' }],
  scripts: [{ id: 'script', name: 'Script', content: 'Hero enters the gala and notices the locked door.', createdAt: 0, updatedAt: 0 }],
  assets,
  storyboards: [
    storyboard('r1', 0, [{ assetId: 'hero', variantId: 'battle' }]),
    storyboard('r2', 1, [{ assetId: 'hero', variantId: 'gala' }]),
  ],
  clips: [{ id: 'clip1', storyboardId: 'r1', durationSec: 4, state: 'done' }],
  episodes: [episode('ep1', 0, { title: 'Pilot', novelChapterIds: ['c1'], filmPath: 'film.mp4' })],
})
const recap = buildEpisodeProductionRecap(recapDoc, recapDoc.episodes![0])
check('builds episode production recap from current flat data', recap.includes('E1「Pilot」') && recap.includes('Opening') && recap.includes('Hero-Battle') && recap.includes('1/2'), recap)

const partialComposeDoc = doc({
  storyboards: [storyboard('ready-shot', 0, []), storyboard('missing-shot', 1, [])],
  clips: [{ id: 'clip-ready', storyboardId: 'ready-shot', durationSec: 4, state: 'done', videoUrl: 'https://example.test/ready.mp4' }],
  track: [
    { id: 'track-ready', storyboardIds: ['ready-shot'], clipIds: ['clip-ready'], selectClipId: 'clip-ready', order: 0 },
    { id: 'track-missing', storyboardIds: ['missing-shot'], clipIds: [], order: 1 },
  ],
})
const partialComposeReadiness = episodeComposeReadiness(partialComposeDoc)
check(
  'blocks composing an incomplete episode when any storyboard lacks a usable clip',
  !partialComposeReadiness.ready && partialComposeReadiness.readyCount === 1 && partialComposeReadiness.missingStoryboardIds.join(',') === 'missing-shot',
  JSON.stringify(partialComposeReadiness),
)
partialComposeDoc.clips.push({ id: 'clip-missing', storyboardId: 'missing-shot', durationSec: 4, state: 'done', videoFilePath: 'D:\\films\\missing.mp4' })
partialComposeDoc.track[1].clipIds = ['clip-missing']
partialComposeDoc.track[1].selectClipId = 'clip-missing'
const completeComposeReadiness = episodeComposeReadiness(partialComposeDoc)
check('allows composing only after every storyboard has a usable selected clip', completeComposeReadiness.ready && completeComposeReadiness.readyCount === 2, JSON.stringify(completeComposeReadiness))

const handoffAssets: Asset[] = [
  {
    ...assets[0],
    variants: [
      { id: 'gala', label: 'Gala', appliesToEpisodeIds: ['ep3'] },
      { id: 'battle', label: 'Battle', refImageId: 'hero-battle' },
    ],
  },
  { id: 'prop', type: 'prop', name: 'Key', refImageId: 'key-main', state: 'done' },
]
const handoffDoc = doc({
  currentEpisodeId: 'ep2',
  assets: handoffAssets,
  storyboards: [storyboard('ep2-shot', 0, [{ assetId: 'hero', variantId: 'gala' }, { assetId: 'prop' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      productionRecap: 'Hero stayed in Battle look after the chase.',
      storyboards: [storyboard('ep1-shot', 0, [{ assetId: 'hero', variantId: 'battle' }, { assetId: 'prop' }])],
    }),
    episode('ep2', 1, { title: 'Gala', plan: { requiredAssetIds: ['hero', 'prop'], requiredVariantIds: ['gala'] } }),
    episode('ep3', 2, {
      title: 'Aftermath',
      storyboards: [storyboard('ep3-shot', 0, [{ assetId: 'hero', variantId: 'gala' }, { assetId: 'prop' }])],
    }),
  ],
})
const handoff = buildEpisodeProductionHandoff(handoffDoc, handoffDoc.episodes![1])
const heroCue = handoff.sharedAssets.find((cue) => cue.assetId === 'hero')
check('builds cross-episode handoff recaps from prior produced episodes', handoff.recaps.length === 1 && handoff.recaps[0].episodeId === 'ep1' && handoff.recaps[0].recap.includes('Battle'), JSON.stringify(handoff.recaps))
check(
  'includes episode plan assets and variants in production handoff',
  handoff.plannedAssets.some((item) => item.assetId === 'hero' && item.requiredVariantIds.includes('gala')) &&
    handoff.plannedAssets.some((item) => item.assetId === 'prop') &&
    handoff.plannedVariants.some((item) => item.assetId === 'hero' && item.variantId === 'gala' && item.scopeAppliesToEpisode === false && item.appliesToEpisodeIds?.includes('ep3')),
  JSON.stringify({ plannedAssets: handoff.plannedAssets, plannedVariants: handoff.plannedVariants }),
)
check('builds shared asset handoff cues for current episode refs', !!heroCue && heroCue.label === 'Hero-Gala' && heroCue.appearances.map((item) => item.episodeId).join(',') === 'ep1,ep3', JSON.stringify(heroCue))
check('suggests handoff fixes for scoped and missing variant refs', handoff.suggestions.some((item) => item.kind === 'add_variant_episode_scope' && item.variantId === 'gala') && handoff.suggestions.some((item) => item.kind === 'generate_variant_ref_image' && item.variantId === 'gala'), JSON.stringify(handoff.suggestions))
check('suggests creating an episode-specific variant for reused main refs', handoff.suggestions.some((item) => item.kind === 'create_episode_variant' && item.assetId === 'prop'), JSON.stringify(handoff.suggestions))
const propVariantSuggestion = handoff.suggestions.find((item) => item.kind === 'create_episode_variant' && item.assetId === 'prop')
check('seeds episode variant prompt from previous appearance', !!propVariantSuggestion?.autoRepairable && propVariantSuggestion.variantLabel === 'E2 Gala形态' && !!propVariantSuggestion.variantPrompt?.includes('E1') && propVariantSuggestion.variantPrompt.includes('Key'), JSON.stringify(propVariantSuggestion))

const plannedOnlyHandoffDoc = doc({
  currentEpisodeId: 'ep2',
  assets: [
    { ...assets[0], variants: [{ id: 'gala', label: 'Gala', appliesToEpisodeIds: ['ep3'] }] },
    { id: 'hall', type: 'scene', name: 'Hall', state: 'done' },
  ],
  storyboards: [],
  episodes: [
    episode('ep1', 0, { title: 'Setup' }),
    episode('ep2', 1, { title: 'Planned', plan: { requiredAssetIds: ['hero', 'hall'], requiredVariantIds: ['gala'] } }),
    episode('ep3', 2, { title: 'Later' }),
  ],
})
const plannedOnlyHandoff = buildEpisodeProductionHandoff(plannedOnlyHandoffDoc, plannedOnlyHandoffDoc.episodes![1])
check(
  'suggests planned asset and variant repairs before storyboards exist',
  plannedOnlyHandoff.suggestions.some((item) => item.kind === 'generate_asset_ref_image' && item.assetId === 'hall') &&
    plannedOnlyHandoff.suggestions.some((item) => item.kind === 'add_variant_episode_scope' && item.assetId === 'hero' && item.variantId === 'gala' && item.scopeKind === 'episode' && !item.storyboardId) &&
    plannedOnlyHandoff.suggestions.some((item) => item.kind === 'generate_variant_ref_image' && item.assetId === 'hero' && item.variantId === 'gala' && !item.disabledReason),
  JSON.stringify(plannedOnlyHandoff.suggestions),
)

const emptyNextEpisodeHandoffDoc = doc({
  currentEpisodeId: 'ep2',
  assets: handoffAssets,
  storyboards: [],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      productionRecap: 'Hero stayed in Battle look after the chase.',
      storyboards: [storyboard('ep1-shot', 0, [{ assetId: 'hero', variantId: 'battle' }, { assetId: 'prop' }])],
    }),
    episode('ep2', 1, { title: 'Gala' }),
  ],
})
const emptyNextEpisodeHandoff = buildEpisodeProductionHandoff(emptyNextEpisodeHandoffDoc, emptyNextEpisodeHandoffDoc.episodes![1])
const carriedHeroCue = emptyNextEpisodeHandoff.sharedAssets.find((cue) => cue.assetId === 'hero')
check(
  'carries prior episode cast cues into empty next episode handoff',
  !!carriedHeroCue?.carryForward && carriedHeroCue.label === 'Hero-Battle' && !!carriedHeroCue.detail?.includes('E1') && emptyNextEpisodeHandoff.suggestions.length === 0,
  JSON.stringify(emptyNextEpisodeHandoff),
)

const stateRegressionHandoffDoc = doc({
  currentEpisodeId: 'ep2',
  assets: handoffAssets,
  storyboards: [storyboard('ep2-main-hero', 0, [{ assetId: 'hero' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      productionRecap: 'Hero stayed wounded after the chase.',
      storyboards: [storyboard('ep1-battle-hero', 0, [{ assetId: 'hero', variantId: 'battle' }])],
    }),
    episode('ep2', 1, { title: 'Gala' }),
  ],
})
const stateRegressionHandoff = buildEpisodeProductionHandoff(stateRegressionHandoffDoc, stateRegressionHandoffDoc.episodes![1])
const heroStateSuggestion = stateRegressionHandoff.suggestions.find((item) => item.kind === 'create_episode_variant' && item.assetId === 'hero')
check('turns state regression into specific handoff suggestion', !!heroStateSuggestion?.detail.includes('当前集仍用主形象') && !!heroStateSuggestion.variantPrompt?.includes('Hero-Battle'), JSON.stringify(heroStateSuggestion))
const stateRegressionBlockers = episodeProductionContinuityBlockers(stateRegressionHandoffDoc, stateRegressionHandoffDoc.episodes![1])
const stateRegressionBlockerError = formatEpisodeProductionContinuityError(stateRegressionHandoffDoc.episodes![1], stateRegressionBlockers, { suggestions: stateRegressionHandoff.suggestions })
check(
  'blocks series production on unresolved cross-episode state regression',
  stateRegressionBlockers.some((item) => item.code === 'asset_state_regressed_to_main') && stateRegressionBlockerError.includes('E2') && stateRegressionBlockerError.includes('handoff') && stateRegressionBlockerError.includes('create-variant:hero:ep2'),
  JSON.stringify({ stateRegressionBlockers, stateRegressionBlockerError }),
)

const episodePlanBlockerDoc = doc({
  currentEpisodeId: 'ep1',
  assets: [
    {
      ...assets[0],
      variants: [{ id: 'gala', label: 'Gala', refImageId: 'hero-gala', appliesToEpisodeIds: ['ep2'] }],
    },
    { id: 'hall', type: 'scene', name: 'Hall', refImageId: 'hall-main', state: 'done' },
  ],
  storyboards: [storyboard('ep1-plan-shot', 0, [{ assetId: 'hero' }])],
  episodes: [
    episode('ep1', 0, { title: 'Pilot', plan: { requiredAssetIds: ['hero', 'hall'], requiredVariantIds: ['gala'] } }),
    episode('ep2', 1, { title: 'Gala' }),
  ],
})
const episodePlanBlockers = episodeProductionContinuityBlockers(episodePlanBlockerDoc, episodePlanBlockerDoc.episodes![0])
const episodePlanHandoff = buildEpisodeProductionHandoff(episodePlanBlockerDoc, episodePlanBlockerDoc.episodes![0])
const episodePlanBlockerError = formatEpisodeProductionContinuityError(episodePlanBlockerDoc.episodes![0], episodePlanBlockers, { suggestions: episodePlanHandoff.suggestions })
check(
  'blocks production on unresolved episode plan asset and variant scope requirements',
  episodePlanBlockers.some((item) => item.code === 'episode_plan_missing_asset' && item.assetId === 'hall') &&
    episodePlanBlockers.some((item) => item.code === 'episode_plan_variant_scope_mismatch' && item.variantId === 'gala') &&
    episodePlanBlockerError.includes('E1') &&
    episodePlanBlockerError.includes('variant-scope:hero:gala:ep1:episode'),
  JSON.stringify({ episodePlanBlockers, episodePlanBlockerError }),
)

const mainResetHandoffDoc = doc({
  currentEpisodeId: 'ep3',
  assets: handoffAssets,
  storyboards: [storyboard('ep3-main-hero', 0, [{ assetId: 'hero' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      productionRecap: 'Hero stayed wounded after the chase.',
      storyboards: [storyboard('ep1-battle-hero', 0, [{ assetId: 'hero', variantId: 'battle' }])],
    }),
    episode('ep2', 1, {
      title: 'Recovery',
      productionRecap: 'Hero recovered to the default look.',
      storyboards: [storyboard('ep2-main-hero', 0, [{ assetId: 'hero' }])],
    }),
    episode('ep3', 2, { title: 'Aftermath' }),
  ],
})
const mainResetHandoff = buildEpisodeProductionHandoff(mainResetHandoffDoc, mainResetHandoffDoc.episodes![2])
const mainResetSuggestion = mainResetHandoff.suggestions.find((item) => item.kind === 'create_episode_variant' && item.assetId === 'hero')
check(
  'handoff stops carrying older variants after a main-image reset',
  !!mainResetSuggestion &&
    mainResetSuggestion.label === '新建并应用「Hero」本集形态' &&
    !mainResetSuggestion.detail.includes('当前集仍用主形象') &&
    !mainResetSuggestion.variantPrompt?.includes('Hero-Battle'),
  JSON.stringify(mainResetSuggestion),
)

const variantSwitchHandoffDoc = doc({
  currentEpisodeId: 'ep2',
  assets: [{
    ...assets[0],
    variants: [
      { id: 'battle', label: 'Battle', refImageId: 'hero-battle' },
      { id: 'gala', label: 'Gala', refImageId: 'hero-gala' },
    ],
  }],
  storyboards: [storyboard('ep2-gala-hero', 0, [{ assetId: 'hero', variantId: 'gala' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      productionRecap: 'Hero stayed wounded after the chase.',
      storyboards: [storyboard('ep1-battle-hero', 0, [{ assetId: 'hero', variantId: 'battle' }])],
    }),
    episode('ep2', 1, { title: 'Gala' }),
  ],
})
const variantSwitchHandoff = buildEpisodeProductionHandoff(variantSwitchHandoffDoc, variantSwitchHandoffDoc.episodes![1])
const variantSwitchSuggestion = variantSwitchHandoff.suggestions.find((item) => item.kind === 'add_variant_episode_scope' && item.variantId === 'gala')
check(
  'suggests confirming unscoped cross-episode variant switches',
  !!variantSwitchSuggestion?.detail.includes('上一相关剧集') && !!variantSwitchSuggestion.detail.includes('Hero-Battle'),
  JSON.stringify(variantSwitchHandoff.suggestions),
)

const sceneScopedHandoffDoc = doc({
  currentEpisodeId: 'ep2',
  assets: [{
    ...assets[0],
    variants: [{ id: 'mask', label: 'Masked', refImageId: 'hero-mask', appliesToSceneIds: ['banquet'] }],
  }],
  storyboards: [
    storyboard('ep2-banquet-hero', 0, [{ assetId: 'hero', variantId: 'mask' }], { sceneId: 'banquet' }),
    storyboard('ep2-street-hero', 1, [{ assetId: 'hero', variantId: 'mask' }], { sceneId: 'street' }),
  ],
  episodes: [
    episode('ep1', 0, { title: 'Banquet', storyboards: [storyboard('ep1-banquet-hero', 0, [{ assetId: 'hero', variantId: 'mask' }], { sceneId: 'banquet' })] }),
    episode('ep2', 1, { title: 'Street' }),
  ],
})
const sceneScopedHandoff = buildEpisodeProductionHandoff(sceneScopedHandoffDoc, sceneScopedHandoffDoc.episodes![1])
const sceneScopeSuggestion = sceneScopedHandoff.suggestions.find((item) => item.kind === 'add_variant_episode_scope' && item.variantId === 'mask')
check(
  'handoff suggestions preserve scene scope for scoped variant fixes',
  sceneScopeSuggestion?.scopeKind === 'scene' && sceneScopeSuggestion.sceneId === 'street' && sceneScopeSuggestion.storyboardId === 'ep2-street-hero',
  JSON.stringify(sceneScopedHandoff.suggestions),
)

const variantSwitchAfterMainResetHandoffDoc = doc({
  currentEpisodeId: 'ep3',
  assets: variantSwitchHandoffDoc.assets,
  storyboards: [storyboard('ep3-gala-hero', 0, [{ assetId: 'hero', variantId: 'gala' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      storyboards: [storyboard('ep1-battle-hero', 0, [{ assetId: 'hero', variantId: 'battle' }])],
    }),
    episode('ep2', 1, {
      title: 'Recovery',
      storyboards: [storyboard('ep2-main-hero', 0, [{ assetId: 'hero' }])],
    }),
    episode('ep3', 2, { title: 'Aftermath' }),
  ],
})
const variantSwitchAfterMainResetHandoff = buildEpisodeProductionHandoff(variantSwitchAfterMainResetHandoffDoc, variantSwitchAfterMainResetHandoffDoc.episodes![2])
check(
  'handoff does not compare unscoped variant against older variant after main reset',
  !variantSwitchAfterMainResetHandoff.suggestions.some((item) => item.kind === 'add_variant_episode_scope' && item.variantId === 'gala'),
  JSON.stringify(variantSwitchAfterMainResetHandoff.suggestions),
)

const variantSwitchAfterSameVariantHandoffDoc = doc({
  currentEpisodeId: 'ep3',
  assets: variantSwitchHandoffDoc.assets,
  storyboards: [storyboard('ep3-gala-hero', 0, [{ assetId: 'hero', variantId: 'gala' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      storyboards: [storyboard('ep1-battle-hero', 0, [{ assetId: 'hero', variantId: 'battle' }])],
    }),
    episode('ep2', 1, {
      title: 'Gala',
      storyboards: [storyboard('ep2-gala-hero', 0, [{ assetId: 'hero', variantId: 'gala' }])],
    }),
    episode('ep3', 2, { title: 'Aftermath' }),
  ],
})
const variantSwitchAfterSameVariantHandoff = buildEpisodeProductionHandoff(variantSwitchAfterSameVariantHandoffDoc, variantSwitchAfterSameVariantHandoffDoc.episodes![2])
check(
  'handoff does not skip same prior variant to compare older variants',
  !variantSwitchAfterSameVariantHandoff.suggestions.some((item) => item.kind === 'add_variant_episode_scope' && item.variantId === 'gala'),
  JSON.stringify(variantSwitchAfterSameVariantHandoff.suggestions),
)

if (failures) {
  console.error(`\nepisodeProduction selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nepisodeProduction selftest: ALL PASSED')
