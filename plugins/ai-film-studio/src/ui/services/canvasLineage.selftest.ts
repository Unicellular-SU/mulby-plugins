import { markCanvasPortValueAsLibraryEntity, markCanvasPortValueAsProjectAsset, type CanvasLineagePortValue } from './canvasLineage'

let failures = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

const identityMarked: CanvasLineagePortValue = {
  type: 'image',
  assetId: 'img-1',
  meta: {
    mediaAssetId: 'img-1',
    libraryEntityId: 'el-hero',
    libraryVariantId: 'lv-gala',
    variantId: 'lv-gala',
    variantLabel: 'Gala',
    view: 'front',
    purpose: 'approved',
  },
}

const unlinkedProject = markCanvasPortValueAsProjectAsset(identityMarked, 'img-1', {
  projectId: 'p1',
  projectAssetId: 'hero-local',
})

check('marks canvas output as project asset', unlinkedProject.changed && unlinkedProject.value.meta?.projectAssetId === 'hero-local', JSON.stringify(unlinkedProject))
check(
  'clears stale identity lineage when project target is unlinked',
  !unlinkedProject.value.meta?.libraryEntityId &&
    !unlinkedProject.value.meta?.libraryVariantId &&
    !unlinkedProject.value.meta?.variantId &&
    !unlinkedProject.value.meta?.variantLabel,
  JSON.stringify(unlinkedProject.value.meta),
)

const linkedProject = markCanvasPortValueAsProjectAsset(identityMarked, 'img-1', {
  projectId: 'p1',
  projectAssetId: 'hero-linked',
  projectVariantId: 'gala-local',
  libraryEntityId: 'el-hero',
  libraryVariantId: 'lv-gala',
})

check(
  'keeps explicit identity lineage for linked project target',
  linkedProject.value.meta?.projectAssetId === 'hero-linked' &&
    linkedProject.value.meta?.projectVariantId === 'gala-local' &&
    linkedProject.value.meta?.libraryEntityId === 'el-hero' &&
    linkedProject.value.meta?.libraryVariantId === 'lv-gala' &&
    linkedProject.value.meta?.variantId === 'lv-gala',
  JSON.stringify(linkedProject.value.meta),
)

const projectMarked: CanvasLineagePortValue = {
  type: 'image',
  assetId: 'img-2',
  meta: {
    mediaAssetId: 'img-2',
    projectId: 'p1',
    projectAssetId: 'hero-local',
    projectVariantId: 'cloak-local',
    purpose: 'approved',
  },
}
const identityTarget = markCanvasPortValueAsLibraryEntity(projectMarked, 'img-2', {
  libraryEntityId: 'el-hero',
  libraryVariantId: 'lv-cloak',
  variantLabel: 'Cloak',
  view: 'side',
})

check(
  'clears stale project lineage when output is saved to identity',
  identityTarget.changed &&
    identityTarget.value.meta?.libraryEntityId === 'el-hero' &&
    identityTarget.value.meta?.libraryVariantId === 'lv-cloak' &&
    identityTarget.value.meta?.variantLabel === 'Cloak' &&
    !identityTarget.value.meta?.projectId &&
    !identityTarget.value.meta?.projectAssetId &&
    !identityTarget.value.meta?.projectVariantId,
  JSON.stringify(identityTarget.value.meta),
)

const fanout: CanvasLineagePortValue = {
  type: 'image',
  assetId: 'img-a',
  items: [
    { type: 'image', assetId: 'img-a', meta: { libraryEntityId: 'old-a' } },
    { type: 'image', assetId: 'img-b', meta: { libraryEntityId: 'old-b' } },
  ],
  meta: { libraryEntityId: 'old-a' },
}
const fanoutUpdate = markCanvasPortValueAsProjectAsset(fanout, 'img-b', { projectAssetId: 'hero-b' }, 1)

check(
  'updates only selected fanout item',
  fanoutUpdate.changed &&
    fanoutUpdate.value.items?.[0]?.meta?.libraryEntityId === 'old-a' &&
    fanoutUpdate.value.items?.[1]?.meta?.projectAssetId === 'hero-b' &&
    !fanoutUpdate.value.items?.[1]?.meta?.libraryEntityId &&
    fanoutUpdate.value.meta?.libraryEntityId === 'old-a',
  JSON.stringify(fanoutUpdate.value),
)

const missing = markCanvasPortValueAsProjectAsset(fanout, 'missing', { projectAssetId: 'hero-missing' })
check('returns unchanged when target asset is absent', !missing.changed && missing.value === fanout, JSON.stringify(missing.value))

if (failures) {
  console.error(`\ncanvasLineage selftest: ${failures} FAILED`)
  process.exit(1)
}
console.log('\ncanvasLineage selftest: ALL PASSED')
