import { buildEpisodeProductionHandoff, buildEpisodeProductionRecap, currentEpisodeUsesCastRef, episodeSeriesQueueState, hasEpisodeProductionState, invalidateEpisodeProduction, invalidateEpisodesUsingAsset, invalidateEpisodesUsingCastRef, missingReferencedVariantImages, pendingEpisodesForSeries } from './episodeProduction'
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
    episode('ep4', 3, { storyboards: [storyboard('ep4-shot', 0, [])], filmError: 'failed' }),
    episode('ep5', 4, { storyboards: [storyboard('ep5-shot', 0, [])], seriesSkip: true }),
  ],
})
const pending = pendingEpisodesForSeries(planned)
check('series production uses current flat storyboards and skips completed, failed, or held episodes', pending.map((item) => item.id).join(',') === 'ep1', JSON.stringify(pending.map((item) => item.id)))
check('classifies failed episodes as held for explicit retry', episodeSeriesQueueState(planned, planned.episodes![3]) === 'failed', episodeSeriesQueueState(planned, planned.episodes![3]))
check('skips manually held episodes from series production', episodeSeriesQueueState(planned, planned.episodes![4]) === 'skipped' && !pendingEpisodesForSeries(planned).some((item) => item.id === 'ep5'), JSON.stringify(pendingEpisodesForSeries(planned).map((item) => item.id)))
planned.episodes![4].seriesSkip = false
check('restoring a held episode returns it to the series queue', pendingEpisodesForSeries(planned).map((item) => item.id).join(',') === 'ep1,ep5', JSON.stringify(pendingEpisodesForSeries(planned).map((item) => item.id)))
const resetFailedEpisode = invalidateEpisodeProduction(planned.episodes![3])
check('resetting a failed episode returns it to the series queue', resetFailedEpisode && pendingEpisodesForSeries(planned).map((item) => item.id).join(',') === 'ep1,ep4,ep5', JSON.stringify(pendingEpisodesForSeries(planned).map((item) => item.id)))
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
    episode('ep2', 1, { title: 'Gala' }),
    episode('ep3', 2, {
      title: 'Aftermath',
      storyboards: [storyboard('ep3-shot', 0, [{ assetId: 'hero', variantId: 'gala' }, { assetId: 'prop' }])],
    }),
  ],
})
const handoff = buildEpisodeProductionHandoff(handoffDoc, handoffDoc.episodes![1])
const heroCue = handoff.sharedAssets.find((cue) => cue.assetId === 'hero')
check('builds cross-episode handoff recaps from prior produced episodes', handoff.recaps.length === 1 && handoff.recaps[0].episodeId === 'ep1' && handoff.recaps[0].recap.includes('Battle'), JSON.stringify(handoff.recaps))
check('builds shared asset handoff cues for current episode refs', !!heroCue && heroCue.label === 'Hero-Gala' && heroCue.appearances.map((item) => item.episodeId).join(',') === 'ep1,ep3', JSON.stringify(heroCue))
check('suggests handoff fixes for scoped and missing variant refs', handoff.suggestions.some((item) => item.kind === 'add_variant_episode_scope' && item.variantId === 'gala') && handoff.suggestions.some((item) => item.kind === 'generate_variant_ref_image' && item.variantId === 'gala'), JSON.stringify(handoff.suggestions))
check('suggests creating an episode-specific variant for reused main refs', handoff.suggestions.some((item) => item.kind === 'create_episode_variant' && item.assetId === 'prop'), JSON.stringify(handoff.suggestions))
const propVariantSuggestion = handoff.suggestions.find((item) => item.kind === 'create_episode_variant' && item.assetId === 'prop')
check('seeds episode variant prompt from previous appearance', !!propVariantSuggestion?.autoRepairable && propVariantSuggestion.variantLabel === 'E2 Gala形态' && !!propVariantSuggestion.variantPrompt?.includes('E1') && propVariantSuggestion.variantPrompt.includes('Key'), JSON.stringify(propVariantSuggestion))

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
