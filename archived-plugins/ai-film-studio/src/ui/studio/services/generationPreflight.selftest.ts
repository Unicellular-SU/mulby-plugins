import { preflightClipGeneration } from './generationPreflight'
import type { Asset, Storyboard } from '../../domain/types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

const binaries = new Map<string, { bytes: Uint8Array; mime: string }>()

;(globalThis as unknown as { window: unknown }).window = {
  mulby: {
    storage: {
      attachment: {
        get: async (id: string) => binaries.get(id)?.bytes,
        getType: async (id: string) => binaries.get(id)?.mime,
      },
      get: async () => undefined,
    },
  },
}

function putAssetBinary(id: string) {
  binaries.set(id, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })
}

function storyboard(patch: Partial<Storyboard> = {}): Storyboard {
  return {
    id: 'sb1',
    index: 0,
    track: 'main',
    videoDesc: 'shot',
    duration: 4,
    associateAssetIds: [],
    shouldGenerateImage: true,
    keyframeImageId: 'keyframe',
    state: 'idle',
    ...patch,
  }
}

const hero: Asset = {
  id: 'hero',
  type: 'role',
  name: 'Hero',
  refImageId: 'hero-main',
  state: 'done',
  variants: [
    { id: 'gala', label: 'Gala', refImageId: 'hero-gala' },
    { id: 'battle', label: 'Battle' },
  ],
}

putAssetBinary('keyframe')
putAssetBinary('hero-main')
putAssetBinary('hero-gala')

const missingVariantRef = await preflightClipGeneration(
  storyboard({ castRefs: [{ assetId: 'hero', variantId: 'battle' }] }),
  [storyboard({ castRefs: [{ assetId: 'hero', variantId: 'battle' }] })],
  [hero],
  { supportsReferenceImages: false },
)

check(
  'unsupported video provider still blocks missing variant reference image',
  missingVariantRef.errors.some((issue) => issue.code === 'missing_cast_ref_image'),
  JSON.stringify(missingVariantRef),
)
check(
  'unsupported video provider keeps reference-image warning',
  missingVariantRef.warnings.some((issue) => issue.code === 'video_provider_ignores_cast_refs'),
  JSON.stringify(missingVariantRef),
)

const validUnsupportedProvider = await preflightClipGeneration(
  storyboard({ castRefs: [{ assetId: 'hero', variantId: 'gala' }] }),
  [storyboard({ castRefs: [{ assetId: 'hero', variantId: 'gala' }] })],
  [hero],
  { supportsReferenceImages: false },
)

check('valid variant reference passes on unsupported provider', validUnsupportedProvider.errors.length === 0, JSON.stringify(validUnsupportedProvider))
check(
  'valid unsupported provider still warns about ignored reference images',
  validUnsupportedProvider.warnings.some((issue) => issue.code === 'video_provider_ignores_cast_refs'),
  JSON.stringify(validUnsupportedProvider),
)

const missingBinary = await preflightClipGeneration(
  storyboard({ castRefs: [{ assetId: 'hero' }] }),
  [storyboard({ castRefs: [{ assetId: 'hero' }] })],
  [{ ...hero, refImageId: 'missing-binary' }],
  { supportsReferenceImages: true },
)

check(
  'supported video provider blocks missing reference binary',
  missingBinary.errors.some((issue) => issue.code === 'missing_cast_ref_binary'),
  JSON.stringify(missingBinary),
)

if (failures) {
  console.error(`\ngenerationPreflight selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\ngenerationPreflight selftest: ALL PASSED')
