import { buildEpisodeProductionHandoff, buildEpisodeProductionRecap, currentEpisodeUsesCastRef, episodeComposeReadiness, episodeProductionContinuityBlockers, episodeSeriesQueueState, formatEpisodeProductionContinuityError, hasEpisodeProductionState, invalidateEpisodeProduction, invalidateEpisodesUsingAsset, invalidateEpisodesUsingCastRef, invalidateProductionScope, missingReferencedVariantImages, pendingEpisodesForSeries, productionScopeForStoryboard, productionScopeForTrack, projectDocForProductionScope, setStoryboardCastVariantForScope, syncCastRefsToLedger } from './episodeProduction'
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

// —— 承接（台账版）：进入本集时每个资产处于什么形态，以及缺哪些图 ——
const handoffAssets: Asset[] = [
  {
    ...assets[0],
    elementId: 'el-hero',
    libraryLink: { entityId: 'el-hero', entityVersion: 2, syncPolicy: 'snapshot', variantMap: { gala: 'lib-gala', battle: 'lib-battle' } },
    variants: [
      { id: 'gala', label: 'Gala', libraryVariantId: 'lib-gala', variantKind: 'makeup' },
      { id: 'battle', label: 'Battle', libraryVariantId: 'lib-battle', variantKind: 'injury', refImageId: 'hero-battle' },
    ],
  },
  { id: 'prop', type: 'prop', name: 'Key', refImageId: 'key-main', state: 'done' },
]
const handoffDoc = doc({
  currentEpisodeId: 'ep2',
  assets: handoffAssets,
  storyboards: [storyboard('ep2-shot', 0, [{ assetId: 'hero', variantId: 'battle' }, { assetId: 'prop' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      productionRecap: 'Hero stayed in Battle look after the chase.',
      storyboards: [
        {
          ...storyboard('ep1-shot', 0, [{ assetId: 'hero', variantId: 'battle' }, { assetId: 'prop' }]),
          stateChanges: [{ assetId: 'hero', toVariantId: 'battle', reason: '追车戏受伤' }],
        },
      ],
    }),
    episode('ep2', 1, { title: 'Gala' }),
    episode('ep3', 2, { title: 'Aftermath', storyboards: [storyboard('ep3-shot', 0, [{ assetId: 'hero', variantId: 'battle' }])] }),
  ],
})
const handoff = buildEpisodeProductionHandoff(handoffDoc, handoffDoc.episodes![1])
const heroCue = handoff.carriedState.find((cue) => cue.assetId === 'hero')
check('builds cross-episode handoff recaps from prior produced episodes', handoff.recaps.length === 1 && handoff.recaps[0].episodeId === 'ep1' && handoff.recaps[0].recap.includes('Battle'), JSON.stringify(handoff.recaps))
check('carried state reports the inherited appearance', heroCue?.variantId === 'battle' && heroCue.label === 'Hero-Battle', JSON.stringify(heroCue))
check('carried state explains where the look came from', heroCue?.reason === '追车戏受伤' && heroCue.sinceEpisodeIndex === 0 && heroCue.sinceStoryboardIndex === 0, JSON.stringify(heroCue))
check('carried state covers every tracked asset', handoff.carriedState.map((cue) => cue.assetId).sort().join(',') === 'hero,prop', JSON.stringify(handoff.carriedState.map((c) => c.assetId)))
check('handoff no longer emits scope suggestions', handoff.suggestions.every((item) => item.kind === 'generate_asset_ref_image' || item.kind === 'generate_variant_ref_image'), JSON.stringify(handoff.suggestions.map((s) => s.kind)))

// 首次出场且没有主图 → 补图建议
const missingRefDoc = doc({
  currentEpisodeId: 'ep1',
  assets: [{ id: 'newcomer', type: 'role', name: 'Newcomer', state: 'idle' }],
  storyboards: [storyboard('ep1-newcomer', 0, [{ assetId: 'newcomer' }])],
  episodes: [episode('ep1', 0, { title: 'Debut' })],
})
const missingRefHandoff = buildEpisodeProductionHandoff(missingRefDoc, missingRefDoc.episodes![0])
check(
  'first appearance without a main image yields a generate suggestion',
  missingRefHandoff.suggestions.some((item) => item.kind === 'generate_asset_ref_image' && item.assetId === 'newcomer'),
  JSON.stringify(missingRefHandoff.suggestions),
)

// 承接的形态缺图，且主图也没有 → 建议被禁用并说明先后顺序
const variantRefDoc = doc({
  currentEpisodeId: 'ep2',
  assets: [{ id: 'hero', type: 'role', name: 'Hero', state: 'idle', variants: [{ id: 'gala', label: 'Gala' }] }],
  storyboards: [],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      storyboards: [
        {
          ...storyboard('ep1-shot', 0, [{ assetId: 'hero', variantId: 'gala' }]),
          stateChanges: [{ assetId: 'hero', toVariantId: 'gala', reason: '换上礼服' }],
        },
      ],
    }),
    episode('ep2', 1, { title: 'Next' }),
  ],
})
const variantRefHandoff = buildEpisodeProductionHandoff(variantRefDoc, variantRefDoc.episodes![1])
const variantSuggestion = variantRefHandoff.suggestions.find((item) => item.kind === 'generate_variant_ref_image')
check('carried variant without an image yields a suggestion', !!variantSuggestion && variantSuggestion.variantId === 'gala', JSON.stringify(variantRefHandoff.suggestions))
check('variant image suggestion waits for the main image', variantSuggestion?.disabledReason === '先生成主参考图，再派生形态图。', JSON.stringify(variantSuggestion))

// 空白新集：从上一集结束状态承接
const emptyEpisodeHandoff = buildEpisodeProductionHandoff(handoffDoc, handoffDoc.episodes![2])
check(
  'an episode with no shots still carries the previous state forward',
  emptyEpisodeHandoff.carriedState.find((cue) => cue.assetId === 'hero')?.variantId === 'battle',
  JSON.stringify(emptyEpisodeHandoff.carriedState),
)

// syncCastRefsToLedger：未声明变更点的 castRef 回落到继承形态
const driftDoc = doc({
  currentEpisodeId: 'ep1',
  assets: [{ id: 'hero', type: 'role', name: 'Hero', refImageId: 'hero-main', state: 'done', variants: [{ id: 'gala', label: 'Gala', refImageId: 'g' }] }],
  storyboards: [
    { ...storyboard('s1', 0, [{ assetId: 'hero', variantId: 'gala' }]), stateChanges: [{ assetId: 'hero', toVariantId: 'gala', reason: '换装' }] },
    storyboard('s2', 1, [{ assetId: 'hero' }]),
  ],
  episodes: [episode('ep1', 0, { title: 'One' })],
})
const synced = syncCastRefsToLedger(driftDoc)
check('syncCastRefsToLedger backfills inherited variants', synced === 1 && driftDoc.storyboards[1].castRefs?.[0].variantId === 'gala', JSON.stringify(driftDoc.storyboards.map((s) => s.castRefs)))
check('syncCastRefsToLedger leaves declared change points alone', driftDoc.storyboards[0].castRefs?.[0].variantId === 'gala', JSON.stringify(driftDoc.storyboards[0]))

// —— 阻断门：只有缺图/悬空引用会拦住整季生产，形态告警不会 ——
const blockerDoc = doc({
  currentEpisodeId: 'ep1',
  assets: [
    { id: 'hero', type: 'role', name: 'Hero', state: 'idle', variants: [{ id: 'gala', label: 'Gala', refImageId: 'g' }] },
    { id: 'prop', type: 'prop', name: 'Key', refImageId: 'key', state: 'done' },
  ],
  storyboards: [storyboard('s1', 0, [{ assetId: 'hero' }, { assetId: 'prop' }]), storyboard('s2', 1, [{ assetId: 'hero', variantId: 'gala' }])],
  episodes: [episode('ep1', 0, { title: 'One' })],
})
const blockers = episodeProductionContinuityBlockers(blockerDoc, blockerDoc.episodes![0])
check('only missing images block production', blockers.length === 1 && blockers[0].code === 'missing_ref_image' && blockers[0].assetId === 'hero', JSON.stringify(blockers.map((b) => b.code)))
check(
  'undeclared appearance change does not block production',
  !blockers.some((issue) => issue.code === 'unexplained_appearance_change'),
  JSON.stringify(blockers.map((b) => b.code)),
)
const blockerMessage = formatEpisodeProductionContinuityError(blockerDoc.episodes![0], blockers, {
  suggestions: buildEpisodeProductionHandoff(blockerDoc, blockerDoc.episodes![0]).suggestions,
})
check('blocking error names the episode and lists suggestions', blockerMessage.includes('E1「One」') && blockerMessage.includes('可先处理以下建议'), blockerMessage)

if (failures) {
  console.error(`\nepisodeProduction selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nepisodeProduction selftest: ALL PASSED')
