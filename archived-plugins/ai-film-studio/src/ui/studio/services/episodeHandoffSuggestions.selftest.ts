import type { Asset, AssetVariant, Episode, ProjectDoc, ProjectMeta, Storyboard, StoryboardCastRef } from '../../domain/types'
import { applyEpisodeHandoffSuggestion } from './episodeHandoffSuggestions'

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

function storyboard(id: string, index: number, castRefs: StoryboardCastRef[], patch: Partial<Storyboard> = {}): Storyboard {
  return {
    id,
    index,
    track: 'main',
    videoDesc: `shot ${index + 1}`,
    duration: 4,
    associateAssetIds: castRefs.map((ref) => ref.assetId),
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

function findVariant(d: ProjectDoc, assetId: string, variantId: string): AssetVariant | undefined {
  return d.assets.find((asset) => asset.id === assetId)?.variants?.find((variant) => variant.id === variantId)
}

const hero: Asset = {
  id: 'hero',
  type: 'role',
  name: 'Hero',
  elementId: 'el-hero',
  libraryLink: { entityId: 'el-hero', entityVersion: 3, syncPolicy: 'snapshot', variantMap: { cloak: 'lib-cloak' } },
  state: 'idle',
  variants: [{ id: 'cloak', label: 'Cloak', libraryVariantId: 'lib-cloak', variantKind: 'outfit' }],
}

const sharedDoc = doc({
  currentEpisodeId: 'ep2',
  assets: [hero],
  storyboards: [storyboard('ep2-main-hero', 0, [{ assetId: 'hero' }])],
  episodes: [
    episode('ep1', 0, {
      title: 'Setup',
      storyboards: [
        storyboard('ep1-cloak-hero', 0, [{ assetId: 'hero', variantId: 'cloak' }], {
          stateChanges: [{ assetId: 'hero', toVariantId: 'cloak', reason: '披上斗篷' }],
        }),
      ],
    }),
    episode('ep2', 1, { title: 'Reveal' }),
  ],
})

const actions = {
  getDoc: () => sharedDoc,
  generateAsset: async (assetId: string) => {
    const asset = sharedDoc.assets.find((item) => item.id === assetId)
    if (asset) asset.refImageId = `generated-${assetId}`
  },
  generateAssetVariant: async (assetId: string, variantId: string) => {
    const variant = findVariant(sharedDoc, assetId, variantId)
    if (variant) {
      variant.refImageId = `generated-${assetId}-${variantId}`
      variant.state = 'done' as const
    }
  },
}

const generatedMain = await applyEpisodeHandoffSuggestion(
  { id: 'asset-main', kind: 'generate_asset_ref_image', assetId: 'hero', label: 'Generate Hero', detail: 'missing main image' },
  actions,
)
check(
  'generates the missing main reference image',
  generatedMain.applied === true && sharedDoc.assets[0].refImageId === 'generated-hero',
  JSON.stringify({ generatedMain, asset: sharedDoc.assets[0] }),
)

const generatedVariant = await applyEpisodeHandoffSuggestion(
  { id: 'variant-ref', kind: 'generate_variant_ref_image', assetId: 'hero', variantId: 'cloak', label: 'Generate Cloak', detail: 'missing variant image' },
  actions,
)
check(
  'generates the carried variant reference image',
  generatedVariant.applied === true && findVariant(sharedDoc, 'hero', 'cloak')?.refImageId === 'generated-hero-cloak',
  JSON.stringify({ generatedVariant, variant: findVariant(sharedDoc, 'hero', 'cloak') }),
)

const disabled = await applyEpisodeHandoffSuggestion(
  { id: 'blocked', kind: 'generate_variant_ref_image', assetId: 'hero', variantId: 'cloak', label: 'x', detail: 'x', disabledReason: '先生成主参考图，再派生形态图。' },
  actions,
)
check('respects disabledReason', disabled.skipped === true && disabled.reason === '先生成主参考图，再派生形态图。', JSON.stringify(disabled))

const unknownAsset = await applyEpisodeHandoffSuggestion(
  { id: 'gone', kind: 'generate_asset_ref_image', assetId: 'ghost', label: 'x', detail: 'x' },
  actions,
)
check('skips suggestions for deleted assets', unknownAsset.skipped === true && unknownAsset.reason === '资产已不存在', JSON.stringify(unknownAsset))

const unknownVariant = await applyEpisodeHandoffSuggestion(
  { id: 'gone-variant', kind: 'generate_variant_ref_image', assetId: 'hero', variantId: 'ghost', label: 'x', detail: 'x' },
  actions,
)
check('skips suggestions for deleted variants', unknownVariant.skipped === true && unknownVariant.reason === '形态已不存在', JSON.stringify(unknownVariant))

if (failures) {
  console.error(`\nepisodeHandoffSuggestions selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nepisodeHandoffSuggestions selftest: ALL PASSED')
