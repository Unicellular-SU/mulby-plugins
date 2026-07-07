import { applyCanvasOutputToElement, setElementPrimaryReference, setElementVariantPrimaryReference, type ElementRef } from './assetStore'

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

const editedPrimary = setElementPrimaryReference(
  {
    refAssetIds: ['old-primary', 'concept-img'],
    mediaRefs: [
      { assetId: 'concept-img', role: 'concept', createdAt: 1 },
      { assetId: 'old-primary', role: 'primary', createdAt: 2 },
      { assetId: 'pose-ref', role: 'reference', createdAt: 3 },
    ],
  },
  'new-primary',
)
check(
  'manual identity reference edit replaces primary media role',
  editedPrimary.refAssetIds[0] === 'new-primary' &&
    editedPrimary.mediaRefs?.some((ref) => ref.assetId === 'new-primary' && ref.role === 'primary') === true &&
    editedPrimary.mediaRefs?.some((ref) => ref.assetId === 'old-primary' && ref.role === 'primary') !== true &&
    editedPrimary.mediaRefs?.some((ref) => ref.assetId === 'concept-img' && ref.role === 'concept') === true &&
    editedPrimary.mediaRefs?.some((ref) => ref.assetId === 'pose-ref' && ref.role === 'reference') === true,
  JSON.stringify(editedPrimary),
)

const clearedPrimary = setElementPrimaryReference(editedPrimary, undefined)
check(
  'manual identity reference clear only removes primary media role',
  clearedPrimary.refAssetIds.length === 0 &&
    clearedPrimary.mediaRefs?.some((ref) => ref.role === 'primary') !== true &&
    clearedPrimary.mediaRefs?.some((ref) => ref.assetId === 'concept-img' && ref.role === 'concept') === true,
  JSON.stringify(clearedPrimary),
)

const editedVariantPrimary = setElementVariantPrimaryReference(
  {
    refAssetIds: ['old-gala', 'gala-ref'],
    mediaRefs: [
      { assetId: 'old-gala', role: 'primary', createdAt: 1 },
      { assetId: 'gala-ref', role: 'reference', createdAt: 2 },
      { assetId: 'gala-concept', role: 'concept', createdAt: 3 },
    ],
  },
  'new-gala',
)
check(
  'manual variant reference edit replaces primary media role',
  editedVariantPrimary.refAssetIds[0] === 'new-gala' &&
    editedVariantPrimary.mediaRefs?.some((ref) => ref.assetId === 'new-gala' && ref.role === 'primary') === true &&
    editedVariantPrimary.mediaRefs?.some((ref) => ref.assetId === 'old-gala' && ref.role === 'primary') !== true &&
    editedVariantPrimary.mediaRefs?.some((ref) => ref.assetId === 'gala-ref' && ref.role === 'reference') === true &&
    editedVariantPrimary.mediaRefs?.some((ref) => ref.assetId === 'gala-concept' && ref.role === 'concept') === true,
  JSON.stringify(editedVariantPrimary),
)

const clearedVariantPrimary = setElementVariantPrimaryReference(editedVariantPrimary, undefined)
check(
  'manual variant reference clear only removes primary media role',
  clearedVariantPrimary.refAssetIds.length === 0 &&
    clearedVariantPrimary.mediaRefs?.some((ref) => ref.role === 'primary') !== true &&
    clearedVariantPrimary.mediaRefs?.some((ref) => ref.assetId === 'gala-ref' && ref.role === 'reference') === true,
  JSON.stringify(clearedVariantPrimary),
)

if (failures) {
  console.error(`\nassetStore selftest: ${failures} FAILED`)
  process.exit(1)
}
console.log('\nassetStore selftest: ALL PASSED')
