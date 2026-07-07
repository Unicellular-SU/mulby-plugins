import { applyCanvasOutputToElement, type ElementRef } from './assetStore'

let failures = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

const base: ElementRef = {
  id: 'el-hero',
  kind: 'character',
  name: 'Hero',
  refAssetIds: [],
  createdAt: 1,
  updatedAt: 1,
}

const concept = applyCanvasOutputToElement(base, 'concept-img', {
  kind: 'libraryEntity',
  entityId: 'el-hero',
  view: 'concept',
})
check(
  'canvas identity save keeps concept role',
  concept.mediaRefs?.some((ref) => ref.assetId === 'concept-img' && ref.role === 'concept') === true &&
    concept.refAssetIds[0] === 'concept-img',
  JSON.stringify(concept),
)

const primary = applyCanvasOutputToElement(concept, 'primary-img', {
  kind: 'libraryEntity',
  entityId: 'el-hero',
  view: 'primary',
})
check(
  'canvas identity save replaces primary role without dropping concept',
  primary.mediaRefs?.some((ref) => ref.assetId === 'primary-img' && ref.role === 'primary') === true &&
    primary.mediaRefs?.some((ref) => ref.assetId === 'concept-img' && ref.role === 'concept') === true &&
    primary.refAssetIds[0] === 'primary-img',
  JSON.stringify(primary),
)

const front = applyCanvasOutputToElement(primary, 'front-img', {
  kind: 'libraryEntity',
  entityId: 'el-hero',
  view: 'front',
})
check(
  'canvas identity save keeps front view and media role',
  front.views?.front === 'front-img' &&
    front.mediaRefs?.some((ref) => ref.assetId === 'front-img' && ref.role === 'front') === true,
  JSON.stringify(front),
)

const variantRef = applyCanvasOutputToElement(base, 'cloak-ref', {
  kind: 'libraryEntity',
  entityId: 'el-hero',
  libraryVariantId: 'cloak',
  variantLabel: 'Cloak',
  view: 'reference',
})
const variant = variantRef.appearanceVariants?.[0]
check(
  'canvas variant save keeps reference role',
  variant?.id === 'cloak' &&
    variant.label === 'Cloak' &&
    variant.mediaRefs?.some((ref) => ref.assetId === 'cloak-ref' && ref.role === 'reference') === true &&
    variant.refAssetIds?.[0] === 'cloak-ref',
  JSON.stringify(variantRef),
)

if (failures) {
  console.error(`\nassetStore selftest: ${failures} FAILED`)
  process.exit(1)
}
console.log('\nassetStore selftest: ALL PASSED')
