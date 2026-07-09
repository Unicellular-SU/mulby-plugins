import type { Asset, Episode } from '../domain/types'
import type { LibraryEntity } from './assetHub'
import {
  assetHubAdoptionTargetForCanvasOutput,
  assetHubEntityVersionStatus,
  assetHubProjectAssetDiff,
  assetHubSelectedFieldDiffs,
  assetHubSyncImpactSummary,
  assetHubVariantScopeSummary,
} from './assetHubDomain'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  OK ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

const entity: LibraryEntity = {
  id: 'el_hero',
  kind: 'character',
  name: '女主',
  aliases: ['阿瑶', '王记者'],
  description: '冷静的调查记者',
  prompt: 'consistent face',
  mediaRefs: [
    { assetId: 'front-v3', role: 'front', createdAt: 3 },
    { assetId: 'concept-1', role: 'concept', createdAt: 1 },
  ],
  variants: [
    { id: 'lv-gala', label: '晚宴妆', kind: 'makeup', createdAt: 1, updatedAt: 1 },
    { id: 'lv-injury', label: '战损', kind: 'injury', createdAt: 1, updatedAt: 1 },
  ],
  voiceRef: { assetId: 'voice-1', role: 'audio', createdAt: 1 },
  lora: { ref: 'hero-lora' },
  version: 5,
  createdAt: 1,
  updatedAt: 2,
}

const snapshotAsset: Asset = {
  id: 'a_hero',
  type: 'role',
  name: '女主',
  aliases: ['王记者', '阿瑶'],
  desc: '冷静的调查记者',
  prompt: 'consistent face',
  refImageId: 'front-v3',
  elementId: 'el_hero',
  libraryLink: { entityId: 'el_hero', entityVersion: 3, syncPolicy: 'snapshot', variantMap: { 'v-gala': 'lv-gala' } },
  variants: [
    { id: 'v-gala', libraryVariantId: 'lv-gala', label: '晚宴妆', variantKind: 'makeup', appliesToEpisodeIds: ['ep5'] },
    { id: 'v-local', label: '雨夜湿发', variantKind: 'state' },
  ],
  voiceAssetId: 'voice-1',
  lora: { ref: 'hero-lora' },
  state: 'done',
}

// —— assetHubEntityVersionStatus ——
const outdated = assetHubEntityVersionStatus(snapshotAsset, entity)
check('version status detects snapshot link with newer entity version', outdated.state === 'snapshot' && outdated.hasNewerVersion && outdated.canSync, JSON.stringify(outdated))
check('version status labels include 快照 and 有新版', outdated.labels.includes('快照') && outdated.labels.includes('有新版'), JSON.stringify(outdated.labels))

const current = assetHubEntityVersionStatus({ ...snapshotAsset, libraryLink: { ...snapshotAsset.libraryLink!, entityVersion: 5 } }, entity)
check('version status is quiet when snapshot matches entity version', !current.hasNewerVersion && !current.canSync, JSON.stringify(current))

const forked = assetHubEntityVersionStatus({ ...snapshotAsset, libraryLink: { ...snapshotAsset.libraryLink!, syncPolicy: 'forked' } }, entity)
check('forked link never suggests sync', forked.state === 'forked' && !forked.hasNewerVersion && !forked.canSync && forked.labels.includes('已分叉'), JSON.stringify(forked))

const archived = assetHubEntityVersionStatus(snapshotAsset, { ...entity, archived: true })
check('archived entity blocks sync and shows 已归档', archived.archived && !archived.canSync && archived.labels.includes('已归档'), JSON.stringify(archived))

const legacy = assetHubEntityVersionStatus({ ...snapshotAsset, libraryLink: undefined }, entity)
check('elementId-only link reports legacy state', legacy.state === 'legacy' && legacy.labels.includes('旧链接'), JSON.stringify(legacy))

const missing = assetHubEntityVersionStatus(snapshotAsset, null)
check('null entity marks link as missing in hub', missing.entityMissing && !missing.canSync, JSON.stringify(missing))

const unlinked = assetHubEntityVersionStatus({ id: 'a_x', type: 'role', name: '路人', state: 'idle' })
check('asset without link reports unlinked', unlinked.state === 'unlinked' && unlinked.labels.length === 0, JSON.stringify(unlinked))

// —— assetHubProjectAssetDiff ——
const noDiff = assetHubProjectAssetDiff(
  { ...snapshotAsset, variants: [{ id: 'v-gala', libraryVariantId: 'lv-gala', label: '晚宴妆' }, { id: 'v-injury', libraryVariantId: 'lv-injury', label: '战损' }] },
  entity,
)
check('identical snapshot has no field diff', noDiff.length === 0, JSON.stringify(noDiff))

const drifted = assetHubProjectAssetDiff(
  {
    ...snapshotAsset,
    name: '女主（旧名）',
    aliases: ['阿瑶'],
    prompt: 'old prompt',
    refImageId: 'front-v1',
    voiceAssetId: 'voice-old',
    lora: { ref: 'hero-lora-v0' },
  },
  entity,
)
const driftedFields = drifted.map((diff) => diff.field)
check(
  'diff reports name/aliases/prompt/primaryImage/voice/lora drift',
  ['name', 'aliases', 'prompt', 'primaryImage', 'voice', 'lora'].every((field) => driftedFields.includes(field as (typeof drifted)[number]['field'])),
  JSON.stringify(driftedFields),
)
check('diff keeps unchanged description out', !driftedFields.includes('description'), JSON.stringify(driftedFields))

const variantDiff = assetHubProjectAssetDiff(snapshotAsset, entity).find((diff) => diff.field === 'variants')
check(
  'variant diff separates local-only and not-imported variants',
  !!variantDiff && variantDiff.projectValue.includes('雨夜湿发（项目专属）') && variantDiff.entityValue.includes('战损（未导入）'),
  JSON.stringify(variantDiff),
)

const aliasOrderOnly = assetHubProjectAssetDiff(
  { ...snapshotAsset, aliases: ['阿瑶', '王记者'], variants: [{ id: 'v-gala', libraryVariantId: 'lv-gala', label: '晚宴妆' }, { id: 'v-injury', libraryVariantId: 'lv-injury', label: '战损' }] },
  entity,
)
check('alias order difference is not a diff', !aliasOrderOnly.some((diff) => diff.field === 'aliases'), JSON.stringify(aliasOrderOnly))

const selectedOnly = assetHubSelectedFieldDiffs(drifted, ['name', 'prompt'])
check('selected field diffs keep only chosen fields', selectedOnly.map((diff) => diff.field).join() === 'name,prompt', JSON.stringify(selectedOnly))

const impactDoc = {
  meta: { id: 'p1', name: '短剧A' },
  assets: [snapshotAsset],
  episodes: [
    {
      id: 'ep5',
      index: 4,
      title: '晚宴',
      plan: { requiredAssetIds: ['a_hero'], requiredVariantIds: ['v-gala'] },
      storyboards: [{ id: 'sb1', index: 0, associateAssetIds: ['a_hero'], castRefs: [{ assetId: 'a_hero', variantId: 'v-gala' }] }],
    },
  ],
  storyboards: [],
} as never
const impact = assetHubSyncImpactSummary(impactDoc, 'a_hero')
check('sync impact lists episode and storyboard usage', impact.episodeLabels.includes('E5 晚宴') && impact.storyboardCount === 1 && impact.planEpisodeLabels.includes('E5 晚宴'), JSON.stringify(impact))
check('sync impact summary is readable', impact.summary.includes('出场剧集') && impact.summary.includes('分镜引用'), impact.summary)

// —— assetHubAdoptionTargetForCanvasOutput ——
const doc = {
  meta: { id: 'p1', name: '短剧A' },
  assets: [snapshotAsset],
} as never

const projectVariantTarget = assetHubAdoptionTargetForCanvasOutput(
  { assetId: 'img-1', meta: { projectId: 'p1', projectAssetId: 'a_hero', projectVariantId: 'v-gala' } },
  doc,
  [entity],
)
check(
  'canvas output resolves project variant target first',
  projectVariantTarget?.kind === 'project-variant' && projectVariantTarget.assetId === 'a_hero' && projectVariantTarget.variantId === 'v-gala',
  JSON.stringify(projectVariantTarget),
)

const projectAssetTarget = assetHubAdoptionTargetForCanvasOutput({ assetId: 'img-1', meta: { projectAssetId: 'a_hero' } }, doc, [entity])
check('canvas output resolves project asset target without projectId', projectAssetTarget?.kind === 'project-asset' && projectAssetTarget.label === '女主', JSON.stringify(projectAssetTarget))

const libraryVariantTarget = assetHubAdoptionTargetForCanvasOutput(
  { assetId: 'img-2', meta: { libraryEntityId: 'el_hero', libraryVariantId: 'lv-gala', view: 'front' } },
  null,
  [entity],
)
check(
  'canvas output resolves library variant target with view',
  libraryVariantTarget?.kind === 'library-variant' && libraryVariantTarget.libraryVariantId === 'lv-gala' && libraryVariantTarget.view === 'front',
  JSON.stringify(libraryVariantTarget),
)

const archivedTarget = assetHubAdoptionTargetForCanvasOutput({ assetId: 'img-2', meta: { libraryEntityId: 'el_hero' } }, null, [{ ...entity, archived: true }])
check('archived entity is not an adoption target', archivedTarget === null, JSON.stringify(archivedTarget))

const staleTarget = assetHubAdoptionTargetForCanvasOutput({ assetId: 'img-3', meta: { projectAssetId: 'a_gone', libraryEntityId: 'el_hero' } }, doc, [entity])
check('stale project target falls back to library target', staleTarget?.kind === 'library-entity' && staleTarget.entityId === 'el_hero', JSON.stringify(staleTarget))

const noTarget = assetHubAdoptionTargetForCanvasOutput({ assetId: 'img-4', meta: { purpose: 'candidate' } }, doc, [entity])
check('candidate without lineage has no adoption target', noTarget === null, JSON.stringify(noTarget))

// —— assetHubVariantScopeSummary ——
const episodes: Episode[] = [
  { id: 'ep5', index: 4, title: '晚宴', status: 'planned' } as Episode,
  { id: 'ep6', index: 5, title: '追凶', status: 'planned' } as Episode,
]

const scoped = assetHubVariantScopeSummary(snapshotAsset, snapshotAsset.variants![0], episodes)
check('variant scope summary resolves episode labels', scoped.scoped && scoped.episodeLabels.join() === 'E5 晚宴', JSON.stringify(scoped))
check('variant scope summary label is readable', scoped.label === '女主 / 晚宴妆：适用：E5 晚宴', scoped.label)

const global = assetHubVariantScopeSummary(snapshotAsset, snapshotAsset.variants![1], episodes)
check('unscoped variant is 全剧通用', !global.scoped && global.label.endsWith('全剧通用'), global.label)

const mixed = assetHubVariantScopeSummary(
  snapshotAsset,
  { id: 'v-m', label: '混合', appliesToEpisodeIds: ['ep5', 'ep-gone'], appliesToSceneIds: ['s1'], appliesToStoryboardIds: ['sb1', 'sb2'] },
  episodes,
)
check(
  'variant scope summary counts unknown episodes, scenes and storyboards',
  mixed.unknownEpisodeCount === 1 && mixed.sceneCount === 1 && mixed.storyboardCount === 2 && mixed.label.includes('1 个未知剧集'),
  JSON.stringify(mixed),
)

if (failures) {
  console.error(`assetHubDomain selftest failed: ${failures} checks`)
  process.exit(1)
}
console.log('assetHubDomain selftest passed')
