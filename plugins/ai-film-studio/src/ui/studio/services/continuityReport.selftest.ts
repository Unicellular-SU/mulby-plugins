import { buildContinuityReport, variantScopePatchForUse } from './continuityReport'
import type { Asset, AssetVariant, Episode, NovelChapter, ProjectDoc, ProjectMeta, Storyboard } from '../../domain/types'
import type { LibraryEntity } from '../../services/assetHub'

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

function libraryEntity(patch: Partial<LibraryEntity>): LibraryEntity {
  return {
    id: 'el-hero',
    kind: 'character',
    name: 'Hero Entity',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}

const hero: Asset = {
  id: 'hero',
  type: 'role',
  name: 'Hero',
  refImageId: 'hero-main',
  state: 'done',
  variants: [{ id: 'v-gala', label: 'Gala', variantKind: 'makeup', appliesToEpisodeIds: ['ep1'] }],
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
check('flags variant outside episode scope', !!ep2?.issues.some((issue) => issue.code === 'variant_out_of_episode_scope' && issue.variantKind === 'makeup'), JSON.stringify(ep2?.issues))
check('flags missing variant ref image', !!ep2?.issues.some((issue) => issue.code === 'missing_ref_image' && issue.variantKind === 'makeup'), JSON.stringify(ep2?.issues))
check('records cast use as not applying to episode', ep2?.castUses[0]?.appliesToEpisode === false && ep2.castUses[0]?.variantKind === 'makeup', JSON.stringify(ep2?.castUses))

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
check(
  'duplicate alias issues expose removable alias metadata',
  duplicateAliasReport.issues.some((issue) => issue.code === 'duplicate_asset_alias' && issue.assetId === 'hero' && issue.conflictLabel === 'Captain' && issue.conflictSource === 'alias' && issue.relatedAssetIds?.includes('captain-role')) &&
    duplicateAliasReport.issues.some((issue) => issue.code === 'duplicate_asset_alias' && issue.assetId === 'captain-role' && issue.conflictSource === 'name'),
  JSON.stringify(duplicateAliasReport.issues),
)
check('does not flag alias collisions across asset types', !duplicateAliasReport.issues.some((issue) => issue.assetId === 'captain-prop'), JSON.stringify(duplicateAliasReport.issues))

const crossEpisodeDuplicateCandidateReport = buildContinuityReport(
  doc({
    assets: [
      { ...hero, aliases: ['Captain'] },
      { id: 'captain-role', type: 'role', name: 'Captain', refImageId: 'captain-img', state: 'done' },
    ],
    currentEpisodeId: 'ep1',
    episodes: [
      episode('ep1', 0),
      episode('ep2', 1, { storyboards: [storyboard('sb-ep2-captain', 0, [{ assetId: 'captain-role' }])] }),
    ],
    storyboards: [storyboard('sb-ep1-hero', 0, [{ assetId: 'hero' }])],
  }),
)
check(
  'flags cross-episode project assets that share a name or alias as merge candidates',
  crossEpisodeDuplicateCandidateReport.issues.some((issue) => issue.code === 'cross_episode_duplicate_project_asset_candidate' && issue.assetId === 'hero' && issue.relatedAssetIds?.includes('captain-role')),
  JSON.stringify(crossEpisodeDuplicateCandidateReport.issues),
)

const linkedCrossEpisodeDuplicateCandidateReport = buildContinuityReport(
  doc({
    assets: [
      { ...hero, aliases: ['Captain'], libraryLink: { entityId: 'el-hero', syncPolicy: 'snapshot' } },
      { id: 'captain-role', type: 'role', name: 'Captain', refImageId: 'captain-img', state: 'done', libraryLink: { entityId: 'el-hero', syncPolicy: 'snapshot' } },
    ],
    currentEpisodeId: 'ep1',
    episodes: [
      episode('ep1', 0),
      episode('ep2', 1, { storyboards: [storyboard('sb-ep2-captain-linked', 0, [{ assetId: 'captain-role' }])] }),
    ],
    storyboards: [storyboard('sb-ep1-hero-linked', 0, [{ assetId: 'hero' }])],
  }),
)
check(
  'does not flag cross-episode project duplicates already linked to the same identity',
  !linkedCrossEpisodeDuplicateCandidateReport.issues.some((issue) => issue.code === 'cross_episode_duplicate_project_asset_candidate'),
  JSON.stringify(linkedCrossEpisodeDuplicateCandidateReport.issues),
)

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

const missingPlannedEpisodesReport = buildContinuityReport(
  doc({
    currentEpisodeId: 'ep1',
    seriesBible: { plannedEpisodeCount: 3, continuityRules: [] },
    episodes: [episode('ep1', 0)],
  }),
)
check('flags missing planned episodes when series bible exceeds episode list', missingPlannedEpisodesReport.issues.some((issue) => issue.code === 'series_planned_episodes_missing'), JSON.stringify(missingPlannedEpisodesReport.issues))

const completePlannedEpisodesReport = buildContinuityReport(
  doc({
    currentEpisodeId: 'ep1',
    seriesBible: { plannedEpisodeCount: 2, continuityRules: [] },
    episodes: [episode('ep1', 0), episode('ep2', 1)],
  }),
)
check('does not flag planned episode count when episodes are created', !completePlannedEpisodesReport.issues.some((issue) => issue.code === 'series_planned_episodes_missing'), JSON.stringify(completePlannedEpisodesReport.issues))

const plannedCoverageReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, variants: [{ id: 'v-gala', label: 'Gala', refImageId: 'gala-img' }] }],
    currentEpisodeId: 'ep1',
    storyboards: [storyboard('uses-hero-main', 0, [{ assetId: 'hero' }])],
    episodes: [episode('ep1', 0, { plan: { requiredAssetIds: ['hero'], requiredVariantIds: ['v-gala'] } })],
  }),
)
check('does not flag planned asset when used by episode storyboards', !plannedCoverageReport.issues.some((issue) => issue.code === 'episode_plan_missing_asset'), JSON.stringify(plannedCoverageReport.issues))
check(
  'flags planned variant when not bound by episode storyboards',
  plannedCoverageReport.issues.some((issue) => issue.code === 'episode_plan_missing_variant' && issue.assetId === 'hero' && issue.variantId === 'v-gala' && issue.candidateVariantLabels?.includes('Gala')),
  JSON.stringify(plannedCoverageReport.issues),
)
check(
  'does not flag planned variant parent asset when already required',
  !plannedCoverageReport.issues.some((issue) => issue.code === 'episode_plan_variant_asset_missing'),
  JSON.stringify(plannedCoverageReport.issues),
)

const plannedVariantWithoutAssetReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, variants: [{ id: 'v-gala', label: 'Gala', refImageId: 'gala-img' }] }],
    currentEpisodeId: 'ep1',
    episodes: [episode('ep1', 0, { plan: { requiredVariantIds: ['v-gala'] } })],
  }),
)
check(
  'flags planned variants whose parent asset is not planned',
  plannedVariantWithoutAssetReport.issues.some((issue) => issue.code === 'episode_plan_variant_asset_missing' && issue.assetId === 'hero' && issue.variantId === 'v-gala'),
  JSON.stringify(plannedVariantWithoutAssetReport.issues),
)

const plannedVariantScopeMismatchReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, variants: [{ id: 'v-gala', label: 'Gala', refImageId: 'gala-img', appliesToEpisodeIds: ['ep2'] }] }],
    currentEpisodeId: 'ep1',
    episodes: [
      episode('ep1', 0, { plan: { requiredAssetIds: ['hero'], requiredVariantIds: ['v-gala'] } }),
      episode('ep2', 1),
    ],
  }),
)
check(
  'flags planned variants whose episode scope excludes the planned episode before storyboards exist',
  plannedVariantScopeMismatchReport.issues.some((issue) => issue.code === 'episode_plan_variant_scope_mismatch' && issue.assetId === 'hero' && issue.variantId === 'v-gala' && issue.scopeKind === 'episode'),
  JSON.stringify(plannedVariantScopeMismatchReport.issues),
)

const plannedVariantBoundReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, variants: [{ id: 'v-gala', label: 'Gala', refImageId: 'gala-img' }] }],
    currentEpisodeId: 'ep1',
    storyboards: [storyboard('uses-gala', 0, [{ assetId: 'hero', variantId: 'v-gala' }])],
    episodes: [episode('ep1', 0, { plan: { requiredAssetIds: ['hero'], requiredVariantIds: ['v-gala'] } })],
  }),
)
check(
  'does not flag planned variant when bound by episode storyboards',
  !plannedVariantBoundReport.issues.some((issue) => issue.code === 'episode_plan_missing_asset' || issue.code === 'episode_plan_missing_variant'),
  JSON.stringify(plannedVariantBoundReport.issues),
)

const missingPlannedAssetReport = buildContinuityReport(
  doc({
    assets: [
      { id: 'hero', type: 'role', name: 'Hero', refImageId: 'hero-img', state: 'done' },
      { id: 'hall', type: 'scene', name: 'Hall', refImageId: 'hall-img', state: 'done' },
    ],
    currentEpisodeId: 'ep1',
    storyboards: [storyboard('uses-hero-only', 0, [{ assetId: 'hero' }])],
    episodes: [episode('ep1', 0, { plan: { requiredAssetIds: ['hall'] } })],
  }),
)
check('flags planned asset when not used by episode storyboards', missingPlannedAssetReport.issues.some((issue) => issue.code === 'episode_plan_missing_asset' && issue.assetId === 'hall'), JSON.stringify(missingPlannedAssetReport.issues))

const invalidPlanRefsReport = buildContinuityReport(
  doc({
    assets: [hero],
    currentEpisodeId: 'ep1',
    episodes: [episode('ep1', 0, { plan: { requiredAssetIds: ['deleted-asset'], requiredVariantIds: ['deleted-variant'] } })],
  }),
)
check('flags invalid planned asset references', invalidPlanRefsReport.issues.some((issue) => issue.code === 'episode_plan_invalid_asset' && issue.assetId === 'deleted-asset'), JSON.stringify(invalidPlanRefsReport.issues))
check('flags invalid planned variant references', invalidPlanRefsReport.issues.some((issue) => issue.code === 'episode_plan_invalid_variant' && issue.variantId === 'deleted-variant'), JSON.stringify(invalidPlanRefsReport.issues))

const plannedBeforeStoryboardReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, variants: [{ id: 'v-gala', label: 'Gala', refImageId: 'gala-img' }] }],
    currentEpisodeId: 'ep1',
    episodes: [episode('ep1', 0, { plan: { requiredAssetIds: ['hero'], requiredVariantIds: ['v-gala'] } })],
  }),
)
check(
  'does not flag missing planned requirements before storyboards exist',
  !plannedBeforeStoryboardReport.issues.some((issue) => issue.code === 'episode_plan_missing_asset' || issue.code === 'episode_plan_missing_variant'),
  JSON.stringify(plannedBeforeStoryboardReport.issues),
)

const linkedAssetReport = buildContinuityReport(
  doc({
    assets: [
      {
        ...hero,
        id: 'hero-a',
        name: 'Hero A',
        libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot' },
      },
      {
        ...hero,
        id: 'hero-b',
        name: 'Hero B',
        libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot' },
      },
    ],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-hero', name: 'Global Hero', version: 3, archived: true })] },
)
check(
  'flags archived linked library entities',
  linkedAssetReport.issues.filter((issue) => issue.code === 'library_entity_archived' && issue.libraryEntityId === 'el-hero').length === 2,
  JSON.stringify(linkedAssetReport.issues),
)
check(
  'does not suggest syncing archived linked library entities',
  !linkedAssetReport.issues.some((issue) => issue.code === 'library_entity_version_outdated' && issue.libraryEntityId === 'el-hero'),
  JSON.stringify(linkedAssetReport.issues),
)
check(
  'flags duplicate project assets imported from the same library entity',
  linkedAssetReport.issues.filter((issue) => issue.code === 'duplicate_library_entity_project_assets' && issue.libraryEntityId === 'el-hero' && issue.relatedAssetIds?.length === 1).length === 2,
  JSON.stringify(linkedAssetReport.issues),
)

const outdatedLinkedEntityReport = buildContinuityReport(
  doc({
    assets: [
      {
        ...hero,
        id: 'hero-outdated',
        name: 'Hero Outdated',
        libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot' },
      },
    ],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-hero', name: 'Global Hero', version: 3 })] },
)
check(
  'flags outdated linked library entity versions',
  outdatedLinkedEntityReport.issues.some((issue) => issue.code === 'library_entity_version_outdated' && issue.assetId === 'hero-outdated' && issue.entityVersion === 1 && issue.currentEntityVersion === 3),
  JSON.stringify(outdatedLinkedEntityReport.issues),
)

const forkedLinkedEntityReport = buildContinuityReport(
  doc({
    assets: [
      {
        ...hero,
        id: 'hero-forked',
        name: 'Hero Forked',
        elementId: 'el-hero',
        libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'forked' },
      },
      {
        ...hero,
        id: 'hero-active',
        name: 'Hero Active',
        libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot' },
      },
    ],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-hero', name: 'Global Hero', version: 3 })] },
)
check(
  'does not treat forked library links as active continuity links',
  !forkedLinkedEntityReport.issues.some((issue) => issue.assetId === 'hero-forked' && (issue.code === 'library_entity_version_outdated' || issue.code === 'library_entity_missing' || issue.code === 'library_entity_archived' || issue.code === 'duplicate_library_entity_project_assets')) &&
    !forkedLinkedEntityReport.issues.some((issue) => issue.code === 'duplicate_library_entity_project_assets' && issue.relatedAssetIds?.includes('hero-forked')),
  JSON.stringify(forkedLinkedEntityReport.issues),
)

const missingLinkedEntityReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, libraryLink: { entityId: 'deleted-entity', entityVersion: 1, syncPolicy: 'snapshot' } }],
  }),
  { libraryEntities: [] },
)
check('flags missing linked library entities when asset hub snapshot is available', missingLinkedEntityReport.issues.some((issue) => issue.code === 'library_entity_missing' && issue.libraryEntityId === 'deleted-entity'), JSON.stringify(missingLinkedEntityReport.issues))

const noHubSnapshotReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, libraryLink: { entityId: 'not-loaded-yet', entityVersion: 1, syncPolicy: 'snapshot' } }],
  }),
)
check('does not flag missing linked library entities before asset hub snapshot is loaded', !noHubSnapshotReport.issues.some((issue) => issue.code === 'library_entity_missing'), JSON.stringify(noHubSnapshotReport.issues))

const linkedAliasConflictReport = buildContinuityReport(
  doc({
    assets: [{ ...hero, aliases: ['Captain'], libraryLink: { entityId: 'el-hero', entityVersion: 1, syncPolicy: 'snapshot' } }],
  }),
  {
    libraryEntities: [
      libraryEntity({ id: 'el-hero', name: 'Hero', aliases: ['Lead'] }),
      libraryEntity({ id: 'el-captain', name: 'Captain', aliases: ['Commander'] }),
    ],
  },
)
check(
  'flags linked project assets whose aliases match another library identity',
  linkedAliasConflictReport.issues.some((issue) => issue.code === 'library_entity_alias_conflict' && issue.assetId === 'hero' && issue.libraryEntityId === 'el-hero' && issue.candidateLibraryEntityIds?.includes('el-captain')),
  JSON.stringify(linkedAliasConflictReport.issues),
)

const unlinkedLibraryMatchReport = buildContinuityReport(
  doc({
    assets: [{ id: 'local-hero', type: 'role', name: 'Captain', refImageId: 'captain-img', state: 'done' }],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-captain', name: 'Captain' })] },
)
check(
  'flags unlinked project assets that match an asset-center identity',
  unlinkedLibraryMatchReport.issues.some((issue) => issue.code === 'asset_matches_unlinked_library_entity' && issue.assetId === 'local-hero' && issue.candidateLibraryEntityLabels?.includes('Captain')),
  JSON.stringify(unlinkedLibraryMatchReport.issues),
)

const rejectedLibraryMatchReport = buildContinuityReport(
  doc({
    assets: [{ id: 'local-hero', type: 'role', name: 'Captain', refImageId: 'captain-img', state: 'done', rejectedLibraryEntityIds: ['el-captain'] }],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-captain', name: 'Captain' })] },
)
check(
  'does not flag rejected asset-center identity candidates',
  !rejectedLibraryMatchReport.issues.some((issue) => issue.code === 'asset_matches_unlinked_library_entity' || issue.code === 'library_entity_alias_conflict'),
  JSON.stringify(rejectedLibraryMatchReport.issues),
)

const forkedRejectedLibraryMatchReport = buildContinuityReport(
  doc({
    assets: [{
      id: 'forked-captain',
      type: 'role',
      name: 'Captain',
      elementId: 'el-captain',
      refImageId: 'captain-img',
      state: 'done',
      libraryLink: { entityId: 'el-captain', entityVersion: 1, syncPolicy: 'forked' },
      rejectedLibraryEntityIds: ['el-captain'],
    }],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-captain', name: 'Captain', version: 3 })] },
)
check(
  'does not re-suggest rejected forked asset-center identity candidates',
  !forkedRejectedLibraryMatchReport.issues.some((issue) => issue.code === 'asset_matches_unlinked_library_entity' || issue.code === 'library_entity_alias_conflict' || issue.code === 'library_entity_version_outdated'),
  JSON.stringify(forkedRejectedLibraryMatchReport.issues),
)

const archivedCandidateMatchReport = buildContinuityReport(
  doc({
    assets: [{ id: 'archived-name', type: 'role', name: 'Archived Hero', refImageId: 'archived-img', state: 'done' }],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-archived', name: 'Archived Hero', archived: true })] },
)
check(
  'does not suggest archived identities as merge candidates',
  !archivedCandidateMatchReport.issues.some((issue) => issue.code === 'asset_matches_unlinked_library_entity'),
  JSON.stringify(archivedCandidateMatchReport.issues),
)

const crossTypeLibraryMatchReport = buildContinuityReport(
  doc({
    assets: [{ id: 'hero-prop', type: 'prop', name: 'Hero', refImageId: 'hero-prop-img', state: 'done' }],
  }),
  { libraryEntities: [libraryEntity({ id: 'el-hero', kind: 'character', name: 'Hero' })] },
)
check(
  'does not match project assets to different asset-center identity kinds',
  !crossTypeLibraryMatchReport.issues.some((issue) => issue.code === 'asset_matches_unlinked_library_entity' || issue.code === 'library_entity_alias_conflict'),
  JSON.stringify(crossTypeLibraryMatchReport.issues),
)

const episodeVariantCoverageReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [
        { id: 'v-gala', label: 'Gala', variantKind: 'makeup', appliesToEpisodeIds: ['ep1'], refImageId: 'gala-img' },
        { id: 'v-battle', label: 'Battle', variantKind: 'injury', appliesToEpisodeIds: ['ep2'], refImageId: 'battle-img' },
      ],
    }],
    currentEpisodeId: 'ep1',
    storyboards: [storyboard('main-use', 0, [{ assetId: 'hero' }])],
    episodes: [episode('ep1', 0)],
  }),
)
const availableVariantIssue = episodeVariantCoverageReport.issues.find((issue) => issue.code === 'episode_variant_available')
check(
  'flags main asset use when episode scoped variant exists',
  availableVariantIssue?.variantId === 'v-gala' && availableVariantIssue.variantKind === 'makeup' && availableVariantIssue.candidateVariantIds?.[0] === 'v-gala' && availableVariantIssue.candidateVariantKinds?.[0] === 'makeup' && availableVariantIssue.storyboardId === 'main-use',
  JSON.stringify(episodeVariantCoverageReport.issues),
)

const multiVariantCoverageReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [
        { id: 'v-gala', label: 'Gala', variantKind: 'makeup', appliesToEpisodeIds: ['ep1'], refImageId: 'gala-img' },
        { id: 'v-mask', label: 'Masked', variantKind: 'outfit', appliesToEpisodeIds: ['ep1'], refImageId: 'mask-img' },
      ],
    }],
    currentEpisodeId: 'ep1',
    storyboards: [storyboard('main-use-multiple', 0, [{ assetId: 'hero' }])],
    episodes: [episode('ep1', 0)],
  }),
)
const multiVariantIssue = multiVariantCoverageReport.issues.find((issue) => issue.code === 'episode_variant_available')
check(
  'lists candidate variants when multiple scoped variants apply',
  !multiVariantIssue?.variantId &&
    multiVariantIssue?.candidateVariantIds?.includes('v-gala') === true &&
    multiVariantIssue?.candidateVariantIds?.includes('v-mask') === true &&
    multiVariantIssue?.candidateVariantLabels?.includes('Masked') === true &&
    multiVariantIssue?.candidateVariantKinds?.includes('makeup') === true &&
    multiVariantIssue?.candidateVariantKinds?.includes('outfit') === true,
  JSON.stringify(multiVariantCoverageReport.issues),
)

const sceneVariantCoverageReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [{ id: 'v-mask', label: 'Masked', variantKind: 'outfit', appliesToSceneIds: ['banquet'], refImageId: 'mask-img' }],
    }],
    currentEpisodeId: 'ep1',
    storyboards: [{ ...storyboard('scene-main-use', 0, [{ assetId: 'hero' }]), sceneId: 'banquet' }],
    episodes: [episode('ep1', 0)],
  }),
)
check(
  'flags main asset use when scene scoped variant applies',
  sceneVariantCoverageReport.issues.some((issue) => issue.code === 'episode_variant_available' && issue.variantId === 'v-mask' && issue.variantKind === 'outfit' && issue.sceneId === 'banquet'),
  JSON.stringify(sceneVariantCoverageReport.issues),
)

const sceneVariantScopeReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [{ id: 'v-mask', label: 'Masked', variantKind: 'outfit', appliesToSceneIds: ['banquet'], refImageId: 'mask-img' }],
    }],
    currentEpisodeId: 'ep1',
    storyboards: [{ ...storyboard('wrong-scene-use', 0, [{ assetId: 'hero', variantId: 'v-mask' }]), sceneId: 'street' }],
    episodes: [episode('ep1', 0)],
  }),
)
check(
  'flags variant use outside scene scope',
  sceneVariantScopeReport.issues.some((issue) => issue.code === 'variant_out_of_episode_scope' && issue.variantKind === 'outfit' && issue.scopeKind === 'scene' && issue.storyboardId === 'wrong-scene-use'),
  JSON.stringify(sceneVariantScopeReport.issues),
)

const sceneScopePatch = variantScopePatchForUse(
  { id: 'v-mask', label: 'Masked', appliesToSceneIds: ['banquet'] } satisfies AssetVariant,
  episode('ep2', 1),
  { ...storyboard('street-use', 0, []), sceneId: 'street' },
)
check('builds scene scope patch for reused scoped variants', sceneScopePatch?.appliesToSceneIds?.join(',') === 'banquet,street', JSON.stringify(sceneScopePatch))

const storyboardScopePatch = variantScopePatchForUse(
  { id: 'v-close', label: 'Closeup', appliesToStoryboardIds: ['sb-prev'] } satisfies AssetVariant,
  episode('ep2', 1),
  storyboard('sb-current', 0, []),
)
check('builds storyboard scope patch for reused scoped variants', storyboardScopePatch?.appliesToStoryboardIds?.join(',') === 'sb-prev,sb-current', JSON.stringify(storyboardScopePatch))

const stateRegressionReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [{ id: 'v-battle', label: 'Battle', variantKind: 'injury', refImageId: 'battle-img', appliesToEpisodeIds: ['ep1'] }],
    }],
    currentEpisodeId: 'ep2',
    storyboards: [storyboard('main-after-variant', 0, [{ assetId: 'hero' }])],
    episodes: [
      episode('ep1', 0, { storyboards: [storyboard('battle-use', 0, [{ assetId: 'hero', variantId: 'v-battle' }])] }),
      episode('ep2', 1),
    ],
  }),
)
check('flags cross-episode state regression to main asset', !!stateRegressionReport.issues.some((issue) => issue.code === 'asset_state_regressed_to_main' && issue.storyboardId === 'main-after-variant' && issue.variantKind === 'injury' && issue.previousVariantKind === 'injury'), JSON.stringify(stateRegressionReport.issues))

const variantSwitchReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [
        { id: 'v-battle', label: 'Battle', variantKind: 'injury', refImageId: 'battle-img' },
        { id: 'v-gala', label: 'Gala', variantKind: 'makeup', refImageId: 'gala-img' },
      ],
    }],
    currentEpisodeId: 'ep2',
    storyboards: [storyboard('gala-after-battle', 0, [{ assetId: 'hero', variantId: 'v-gala' }])],
    episodes: [
      episode('ep1', 0, { storyboards: [storyboard('battle-use', 0, [{ assetId: 'hero', variantId: 'v-battle' }])] }),
      episode('ep2', 1),
    ],
  }),
)
check(
  'flags cross-episode switch to unscoped variant',
  variantSwitchReport.issues.some((issue) => issue.code === 'asset_state_changed_variant' && issue.storyboardId === 'gala-after-battle' && issue.variantId === 'v-gala' && issue.variantKind === 'makeup' && issue.previousVariantId === 'v-battle' && issue.previousVariantKind === 'injury'),
  JSON.stringify(variantSwitchReport.issues),
)

const scopedVariantSwitchReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [
        { id: 'v-battle', label: 'Battle', refImageId: 'battle-img', appliesToEpisodeIds: ['ep1'] },
        { id: 'v-gala', label: 'Gala', refImageId: 'gala-img', appliesToEpisodeIds: ['ep2'] },
      ],
    }],
    currentEpisodeId: 'ep2',
    storyboards: [storyboard('scoped-gala-after-battle', 0, [{ assetId: 'hero', variantId: 'v-gala' }])],
    episodes: [
      episode('ep1', 0, { storyboards: [storyboard('battle-use', 0, [{ assetId: 'hero', variantId: 'v-battle' }])] }),
      episode('ep2', 1),
    ],
  }),
)
check(
  'does not flag scoped cross-episode variant switch',
  !scopedVariantSwitchReport.issues.some((issue) => issue.code === 'asset_state_changed_variant'),
  JSON.stringify(scopedVariantSwitchReport.issues),
)

const variantSwitchAfterMainResetReport = buildContinuityReport(
  doc({
    assets: [{
      ...hero,
      variants: [
        { id: 'v-battle', label: 'Battle', refImageId: 'battle-img' },
        { id: 'v-gala', label: 'Gala', refImageId: 'gala-img' },
      ],
    }],
    currentEpisodeId: 'ep3',
    storyboards: [storyboard('gala-after-main-reset', 0, [{ assetId: 'hero', variantId: 'v-gala' }])],
    episodes: [
      episode('ep1', 0, { storyboards: [storyboard('battle-use', 0, [{ assetId: 'hero', variantId: 'v-battle' }])] }),
      episode('ep2', 1, { storyboards: [storyboard('main-reset', 0, [{ assetId: 'hero' }])] }),
      episode('ep3', 2),
    ],
  }),
)
check(
  'does not compare new variant against older variant after main reset',
  variantSwitchAfterMainResetReport.issues.some((issue) => issue.code === 'asset_state_regressed_to_main' && issue.storyboardId === 'main-reset') &&
    !variantSwitchAfterMainResetReport.issues.some((issue) => issue.code === 'asset_state_changed_variant' && issue.storyboardId === 'gala-after-main-reset'),
  JSON.stringify(variantSwitchAfterMainResetReport.issues),
)

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
