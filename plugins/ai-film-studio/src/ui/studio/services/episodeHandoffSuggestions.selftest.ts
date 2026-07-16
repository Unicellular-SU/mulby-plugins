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
  variants: [
    { id: 'cloak', label: 'Cloak', libraryVariantId: 'lib-cloak', variantKind: 'outfit', appliesToEpisodeIds: ['ep1'] },
  ],
}

const heroLineage = { libraryEntityId: 'el-hero', libraryEntityVersion: 3, librarySyncPolicy: 'snapshot' as const }
const cloakLineage = { ...heroLineage, libraryVariantId: 'lib-cloak', variantKind: 'outfit' as const }

const sharedDoc = doc({
  currentEpisodeId: 'ep2',
  assets: [hero],
  storyboards: [storyboard('ep2-main-hero', 0, [{ assetId: 'hero' }])],
  episodes: [
    episode('ep1', 0, { title: 'Setup', storyboards: [storyboard('ep1-cloak-hero', 0, [{ assetId: 'hero', variantId: 'cloak' }])] }),
    episode('ep2', 1, { title: 'Reveal' }),
  ],
})
const targetEpisode = sharedDoc.episodes![1]
let nextVariant = 1

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
  updateAssetVariant: (assetId: string, variantId: string, patch: Partial<AssetVariant>) => {
    const variant = findVariant(sharedDoc, assetId, variantId)
    if (variant) Object.assign(variant, patch)
  },
  addAssetVariant: (assetId: string, init?: { label?: string; desc?: string; prompt?: string }) => {
    const asset = sharedDoc.assets.find((item) => item.id === assetId)
    if (!asset) return ''
    const id = `variant-${nextVariant++}`
    asset.variants = [...(asset.variants ?? []), { id, label: init?.label ?? id, desc: init?.desc, prompt: init?.prompt, state: 'idle' }]
    return id
  },
  setStoryboardCastVariant: (storyboardId: string, assetId: string, variantId: string | undefined) => {
    const storyboard = [...sharedDoc.storyboards, ...(sharedDoc.episodes ?? []).flatMap((item) => item.storyboards)].find((item) => item.id === storyboardId)
    if (!storyboard) return
    storyboard.castRefs = (storyboard.castRefs ?? []).map((ref) => (ref.assetId === assetId ? { ...ref, variantId } : ref))
  },
}

const generatedMain = await applyEpisodeHandoffSuggestion(targetEpisode, {
  id: 'asset-main',
  kind: 'generate_asset_ref_image',
  assetId: 'hero',
  label: 'Generate Hero',
  detail: 'missing main image',
  ...heroLineage,
}, actions)
check(
  'generates planned asset main image',
  generatedMain.applied === true &&
    sharedDoc.assets[0].refImageId === 'generated-hero' &&
    generatedMain.libraryEntityId === 'el-hero' &&
    generatedMain.libraryEntityVersion === 3 &&
    generatedMain.librarySyncPolicy === 'snapshot',
  JSON.stringify({ generatedMain, asset: sharedDoc.assets[0] }),
)

const scopedVariant = await applyEpisodeHandoffSuggestion(targetEpisode, {
  id: 'scope-cloak',
  kind: 'add_variant_episode_scope',
  assetId: 'hero',
  variantId: 'cloak',
  scopeKind: 'episode',
  label: 'Scope Cloak',
  detail: 'missing episode scope',
  ...cloakLineage,
}, actions)
check(
  'adds planned variant episode scope',
  scopedVariant.applied === true &&
    findVariant(sharedDoc, 'hero', 'cloak')?.appliesToEpisodeIds?.includes('ep2') === true &&
    scopedVariant.variantKind === 'outfit' &&
    scopedVariant.libraryEntityId === 'el-hero' &&
    scopedVariant.libraryVariantId === 'lib-cloak',
  JSON.stringify({ scopedVariant, variant: findVariant(sharedDoc, 'hero', 'cloak') }),
)

const generatedVariant = await applyEpisodeHandoffSuggestion(targetEpisode, {
  id: 'variant-ref',
  kind: 'generate_variant_ref_image',
  assetId: 'hero',
  variantId: 'cloak',
  label: 'Generate Cloak',
  detail: 'missing variant image',
  ...cloakLineage,
}, actions)
check(
  'generates planned variant reference image',
  generatedVariant.applied === true &&
    findVariant(sharedDoc, 'hero', 'cloak')?.refImageId === 'generated-hero-cloak' &&
    generatedVariant.variantKind === 'outfit' &&
    generatedVariant.libraryEntityId === 'el-hero' &&
    generatedVariant.libraryVariantId === 'lib-cloak',
  JSON.stringify({ generatedVariant, variant: findVariant(sharedDoc, 'hero', 'cloak') }),
)

const createdVariant = await applyEpisodeHandoffSuggestion(targetEpisode, {
  id: 'create-episode-variant',
  kind: 'create_episode_variant',
  assetId: 'hero',
  label: 'Create Reveal',
  detail: 'main image reused after prior state',
  variantLabel: 'Reveal makeup',
  variantPrompt: 'Hero with reveal makeup',
  ...heroLineage,
}, actions)
const newVariant = sharedDoc.assets[0].variants?.find((variant) => variant.id === createdVariant.variantId)
check(
  'creates episode variant and binds current storyboards',
  createdVariant.applied === true &&
    !!newVariant &&
    createdVariant.libraryEntityId === 'el-hero' &&
    createdVariant.librarySyncPolicy === 'snapshot' &&
    !createdVariant.libraryVariantId &&
    newVariant.appliesToEpisodeIds?.includes('ep2') === true &&
    sharedDoc.storyboards[0].castRefs?.some((ref) => ref.assetId === 'hero' && ref.variantId === newVariant.id) === true,
  JSON.stringify({ createdVariant, newVariant, storyboard: sharedDoc.storyboards[0] }),
)

if (failures) {
  console.error(`\nepisodeHandoffSuggestions selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nepisodeHandoffSuggestions selftest: ALL PASSED')
