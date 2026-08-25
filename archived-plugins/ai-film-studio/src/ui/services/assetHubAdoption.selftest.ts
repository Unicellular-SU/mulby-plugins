import {
  adoptionTargetLabel,
  filterAdoptions,
  listAdoptionsByMedia,
  normalizeAdoptionRecord,
  purposeBeforeFromMeta,
  sameAdoptionTarget,
  supersedeMatchingAdoptions,
  type AssetHubAdoptionRecord,
} from './assetHubAdoption'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  OK ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

const projectTarget = {
  kind: 'projectAsset' as const,
  projectId: 'p1',
  assetId: 'a_hero',
  variantId: 'v-gala',
}

const libraryTarget = {
  kind: 'libraryEntity' as const,
  entityId: 'el_hero',
  libraryVariantId: 'lv-gala',
  view: 'front',
}

const base = normalizeAdoptionRecord({
  sourceSurface: 'canvas',
  sourceProjectId: 'canvas-1',
  sourceProjectName: '角色精修',
  sourceNodeId: 'n1',
  sourceNodeTitle: '角色设定图',
  sourcePort: 'image',
  sourceItemIndex: 0,
  mediaAssetId: 'img-1',
  prompt: 'formal makeup',
  model: 'flux',
  purposeBefore: 'candidate',
  target: projectTarget,
  action: 'overwrite',
}, 1000)

check('normalize fills id/state/appliedAt', !!base.id && base.state === 'applied' && base.appliedAt === 1000, JSON.stringify(base))
check('normalize keeps canvas lineage fields', base.sourceNodeId === 'n1' && base.sourcePort === 'image' && base.mediaAssetId === 'img-1', JSON.stringify(base))
check('purposeBeforeFromMeta reads candidate', purposeBeforeFromMeta({ purpose: 'candidate' }) === 'candidate')
check('purposeBeforeFromMeta ignores unknown', purposeBeforeFromMeta({ purpose: 'draft' }) === undefined)

check('sameAdoptionTarget matches project variant', sameAdoptionTarget(projectTarget, { ...projectTarget }))
check('sameAdoptionTarget distinguishes variant', !sameAdoptionTarget(projectTarget, { ...projectTarget, variantId: undefined }))
check('sameAdoptionTarget matches library view', sameAdoptionTarget(libraryTarget, { ...libraryTarget }))
check('sameAdoptionTarget distinguishes library view', !sameAdoptionTarget(libraryTarget, { ...libraryTarget, view: 'side' }))
check('adoptionTargetLabel for project variant', adoptionTargetLabel(projectTarget).includes('形态'))
check('adoptionTargetLabel for library entity', adoptionTargetLabel({ kind: 'libraryEntity', entityId: 'el_hero' }).includes('身份资产'))

const older: AssetHubAdoptionRecord = { ...base, id: 'adopt_old', createdAt: 500, appliedAt: 500 }
const next = normalizeAdoptionRecord({
  ...base,
  id: 'adopt_new',
  action: 'overwrite',
}, 2000)
const superseded = supersedeMatchingAdoptions([older, { ...older, id: 'adopt_other', mediaAssetId: 'img-2' }], next)
check(
  'supersede marks same media+target applied record',
  superseded.find((item) => item.id === 'adopt_old')?.state === 'superseded',
  JSON.stringify(superseded),
)
check(
  'supersede keeps different media applied',
  superseded.find((item) => item.id === 'adopt_other')?.state === 'applied',
  JSON.stringify(superseded),
)

const mixed: AssetHubAdoptionRecord[] = [
  { ...base, id: 'a1', createdAt: 3, state: 'applied', purposeBefore: 'candidate' },
  { ...base, id: 'a2', createdAt: 2, state: 'superseded', purposeBefore: 'candidate' },
  { ...base, id: 'a3', createdAt: 1, state: 'applied', purposeBefore: 'approved', mediaAssetId: 'img-9' },
  { ...base, id: 'a4', createdAt: 4, state: 'rejected', purposeBefore: 'experiment' },
]
check('listAdoptionsByMedia sorts newest first', listAdoptionsByMedia(mixed, 'img-1').map((item) => item.id).join() === 'a4,a1,a2')
check('filter applied only', filterAdoptions(mixed, 'applied').every((item) => item.state === 'applied'))
check('filter candidate includes experiment purpose', filterAdoptions(mixed, 'candidate').map((item) => item.id).sort().join() === 'a1,a2,a4')
check('filter superseded only', filterAdoptions(mixed, 'superseded').map((item) => item.id).join() === 'a2')

if (failures) {
  console.error(`assetHubAdoption selftest failed: ${failures} checks`)
  process.exit(1)
}
console.log('assetHubAdoption selftest passed')
