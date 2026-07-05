import { buildContinuityReport } from './continuityReport'
import type { Asset, Episode, NovelChapter, ProjectDoc, ProjectMeta, Storyboard } from '../../domain/types'

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

function chapter(id: string, index: number): NovelChapter {
  return { id, index, title: `Chapter ${index + 1}`, text: `chapter ${index + 1}` }
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

const hero: Asset = {
  id: 'hero',
  type: 'role',
  name: 'Hero',
  refImageId: 'hero-main',
  state: 'done',
  variants: [{ id: 'v-gala', label: 'Gala', appliesToEpisodeIds: ['ep1'] }],
}

const scoped = doc({
  assets: [hero],
  currentEpisodeId: 'ep1',
  episodes: [
    episode('ep1', 0),
    episode('ep2', 1, { storyboards: [storyboard('sb2', 0, [{ assetId: 'hero', variantId: 'v-gala' }])] }),
  ],
})

const scopedReport = buildContinuityReport(scoped)
const ep2 = scopedReport.episodes.find((item) => item.id === 'ep2')
check('flags variant outside episode scope', !!ep2?.issues.some((issue) => issue.code === 'variant_out_of_episode_scope'), JSON.stringify(ep2?.issues))
check('flags missing variant ref image', !!ep2?.issues.some((issue) => issue.code === 'missing_ref_image'), JSON.stringify(ep2?.issues))
check('records cast use as not applying to episode', ep2?.castUses[0]?.appliesToEpisode === false, JSON.stringify(ep2?.castUses))

const duplicateAssetReport = buildContinuityReport(
  doc({
    assets: [
      hero,
      { id: 'hero-copy', type: 'role', name: ' hero ', refImageId: 'hero-copy-img', state: 'done' },
      { id: 'hero-prop', type: 'prop', name: 'Hero', refImageId: 'hero-prop-img', state: 'done' },
    ],
  }),
)
check('flags duplicate asset names by type', duplicateAssetReport.issues.filter((issue) => issue.code === 'duplicate_asset_name').length === 2, JSON.stringify(duplicateAssetReport.issues))

const duplicateAliasReport = buildContinuityReport(
  doc({
    assets: [
      { ...hero, aliases: ['Captain'] },
      { id: 'captain-role', type: 'role', name: ' captain ', refImageId: 'captain-img', state: 'done' },
      { id: 'captain-prop', type: 'prop', name: 'Captain', refImageId: 'captain-prop-img', state: 'done' },
    ],
  }),
)
check('flags duplicate asset aliases by type', duplicateAliasReport.issues.filter((issue) => issue.code === 'duplicate_asset_alias').length === 2, JSON.stringify(duplicateAliasReport.issues))
check('does not flag alias collisions across asset types', !duplicateAliasReport.issues.some((issue) => issue.assetId === 'captain-prop'), JSON.stringify(duplicateAliasReport.issues))

const sceneReuseReport = buildContinuityReport(
  doc({
    assets: [{ id: 'hall', type: 'scene', name: 'Hall', refImageId: 'hall-img', state: 'done' }],
    currentEpisodeId: 'ep1',
    storyboards: [
      { ...storyboard('hall-1', 0, [{ assetId: 'hall' }]), sceneId: 'hallway' },
      { ...storyboard('hall-2', 1, []), sceneId: 'hallway' },
    ],
    episodes: [episode('ep1', 0)],
  }),
)
check('flags missing scene asset in reused scene group', !!sceneReuseReport.issues.some((issue) => issue.code === 'scene_group_missing_asset' && issue.storyboardId === 'hall-2'), JSON.stringify(sceneReuseReport.issues))

const sceneMismatchReport = buildContinuityReport(
  doc({
    assets: [
      { id: 'hall', type: 'scene', name: 'Hall', refImageId: 'hall-img', state: 'done' },
      { id: 'lobby', type: 'scene', name: 'Lobby', refImageId: 'lobby-img', state: 'done' },
    ],
    currentEpisodeId: 'ep1',
    storyboards: [
      { ...storyboard('hall-1', 0, [{ assetId: 'hall' }]), sceneId: 'same-space' },
      { ...storyboard('hall-2', 1, [{ assetId: 'lobby' }]), sceneId: 'same-space' },
    ],
    episodes: [episode('ep1', 0)],
  }),
)
check('flags mixed scene assets in reused scene group', sceneMismatchReport.issues.filter((issue) => issue.code === 'scene_group_asset_mismatch').length === 2, JSON.stringify(sceneMismatchReport.issues))

const sceneVariantMismatchReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, variants: [{ id: 'v-gala', label: 'Gala', refImageId: 'gala-img' }] }],
    currentEpisodeId: 'ep1',
    storyboards: [
      { ...storyboard('hero-main', 0, [{ assetId: 'hero' }]), sceneId: 'same-room' },
      { ...storyboard('hero-gala', 1, [{ assetId: 'hero', variantId: 'v-gala' }]), sceneId: 'same-room' },
    ],
    episodes: [episode('ep1', 0)],
  }),
)
check(
  'flags mixed role variants in reused scene group',
  sceneVariantMismatchReport.issues.filter((issue) => issue.code === 'scene_group_variant_mismatch' && issue.assetId === 'hero').length === 2,
  JSON.stringify(sceneVariantMismatchReport.issues),
)
check(
  'includes scene id for scene variant mismatch fixes',
  sceneVariantMismatchReport.issues.some((issue) => issue.code === 'scene_group_variant_mismatch' && issue.sceneId === 'same-room' && issue.storyboardId === 'hero-gala' && issue.variantId === 'v-gala'),
  JSON.stringify(sceneVariantMismatchReport.issues),
)

const unusedAssetReport = buildContinuityReport(
  doc({
    assets: [
      { id: 'hero', type: 'role', name: 'Hero', refImageId: 'hero-img', state: 'done' },
      { id: 'unused', type: 'role', name: 'Unused Role', refImageId: 'unused-img', state: 'done' },
    ],
    currentEpisodeId: 'ep1',
    storyboards: [storyboard('uses-hero', 0, [{ assetId: 'hero' }])],
    episodes: [episode('ep1', 0)],
  }),
)
check('flags project assets unused by any storyboard', !!unusedAssetReport.issues.some((issue) => issue.code === 'unused_project_asset' && issue.assetId === 'unused'), JSON.stringify(unusedAssetReport.issues))

const emptyStoryboardAssetReport = buildContinuityReport(
  doc({
    assets: [{ id: 'planned', type: 'role', name: 'Planned Role', refImageId: 'planned-img', state: 'done' }],
    currentEpisodeId: 'ep1',
    episodes: [episode('ep1', 0)],
  }),
)
check('does not flag unused assets before storyboards exist', !emptyStoryboardAssetReport.issues.some((issue) => issue.code === 'unused_project_asset'), JSON.stringify(emptyStoryboardAssetReport.issues))

const episodeVariantCoverageReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [
        { id: 'v-gala', label: 'Gala', appliesToEpisodeIds: ['ep1'], refImageId: 'gala-img' },
        { id: 'v-battle', label: 'Battle', appliesToEpisodeIds: ['ep2'], refImageId: 'battle-img' },
      ],
    }],
    currentEpisodeId: 'ep1',
    storyboards: [storyboard('main-use', 0, [{ assetId: 'hero' }])],
    episodes: [episode('ep1', 0)],
  }),
)
const availableVariantIssue = episodeVariantCoverageReport.issues.find((issue) => issue.code === 'episode_variant_available')
check('flags main asset use when episode scoped variant exists', availableVariantIssue?.variantId === 'v-gala' && availableVariantIssue.storyboardId === 'main-use', JSON.stringify(episodeVariantCoverageReport.issues))

const stateRegressionReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [{ id: 'v-battle', label: 'Battle', refImageId: 'battle-img', appliesToEpisodeIds: ['ep1'] }],
    }],
    currentEpisodeId: 'ep2',
    storyboards: [storyboard('main-after-variant', 0, [{ assetId: 'hero' }])],
    episodes: [
      episode('ep1', 0, { storyboards: [storyboard('battle-use', 0, [{ assetId: 'hero', variantId: 'v-battle' }])] }),
      episode('ep2', 1),
    ],
  }),
)
check('flags cross-episode state regression to main asset', !!stateRegressionReport.issues.some((issue) => issue.code === 'asset_state_regressed_to_main' && issue.storyboardId === 'main-after-variant'), JSON.stringify(stateRegressionReport.issues))

const chapters = [chapter('c1', 0), chapter('c2', 1), chapter('c3', 2)]
const chapterReport = buildContinuityReport(
  doc({
    novel: chapters,
    currentEpisodeId: 'ep1',
    episodes: [
      episode('ep1', 0, { novelChapterIds: ['c1', 'c2'] }),
      episode('ep2', 1, { novelChapterIds: ['c2', 'missing'] }),
    ],
  })
)
check('flags duplicated chapter assignment per affected episode', chapterReport.issues.filter((issue) => issue.code === 'duplicated_chapter_assignment').length === 2, JSON.stringify(chapterReport.issues))
check('flags invalid episode chapter reference', !!chapterReport.episodes.find((item) => item.id === 'ep2')?.issues.some((issue) => issue.code === 'invalid_episode_chapter'), JSON.stringify(chapterReport.episodes))
check('flags unassigned imported chapter', !!chapterReport.issues.some((issue) => issue.code === 'unassigned_chapter'), JSON.stringify(chapterReport.issues))

const currentMirrorReport = buildContinuityReport(
  doc({
    assets: [{ id: 'prop', type: 'prop', name: 'Key', refImageId: 'key-img', state: 'done' }],
    storyboards: [storyboard('current-shot', 0, [{ assetId: 'prop' }])],
    currentEpisodeId: 'ep1',
    episodes: [episode('ep1', 0, { storyboards: [] })],
  })
)
check('current episode uses flat storyboard mirror', currentMirrorReport.episodes[0]?.storyboards === 1, JSON.stringify(currentMirrorReport.episodes[0]))
check('valid main asset ref has no issues', currentMirrorReport.issues.length === 0, JSON.stringify(currentMirrorReport.issues))

if (failures) {
  console.error(`\ncontinuityReport selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\ncontinuityReport selftest: ALL PASSED')
