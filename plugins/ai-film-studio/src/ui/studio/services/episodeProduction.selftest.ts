import { invalidateEpisodeProduction, missingReferencedVariantImages, pendingEpisodesForSeries } from './episodeProduction'
import type { Asset, Episode, ProjectDoc, ProjectMeta, Storyboard } from '../../domain/types'

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

const assets: Asset[] = [
  {
    id: 'hero',
    type: 'role',
    name: 'Hero',
    refImageId: 'hero-main',
    state: 'done',
    variants: [
      { id: 'gala', label: 'Gala' },
      { id: 'battle', label: 'Battle', refImageId: 'hero-battle' },
    ],
  },
  { id: 'voice', type: 'audio', name: 'Voice', state: 'idle', variants: [{ id: 'radio', label: 'Radio' }] },
]

const missing = missingReferencedVariantImages(
  doc({
    assets,
    storyboards: [
      storyboard('s1', 0, [{ assetId: 'hero', variantId: 'gala' }]),
      storyboard('s2', 1, [{ assetId: 'hero', variantId: 'gala' }, { assetId: 'hero', variantId: 'battle' }, { assetId: 'voice', variantId: 'radio' }]),
      storyboard('s3', 2, [{ assetId: 'missing', variantId: 'ghost' }, { assetId: 'hero' }]),
    ],
  }),
)
check('collects only referenced missing variant images', missing.length === 1 && missing[0]?.assetId === 'hero' && missing[0]?.variantId === 'gala', JSON.stringify(missing))

const planned = doc({
  currentEpisodeId: 'ep1',
  storyboards: [storyboard('current', 0, [])],
  episodes: [
    episode('ep1', 0, { storyboards: [] }),
    episode('ep2', 1, { storyboards: [storyboard('ep2-shot', 0, [])], filmPath: 'done.mp4' }),
    episode('ep3', 2, { storyboards: [] }),
    episode('ep4', 3, { storyboards: [storyboard('ep4-shot', 0, [])], filmError: 'failed' }),
  ],
})
const pending = pendingEpisodesForSeries(planned)
check('series production uses current flat storyboards and skips completed episodes', pending.map((item) => item.id).join(',') === 'ep1,ep4', JSON.stringify(pending.map((item) => item.id)))

const produced = episode('done', 0, { status: 'done', filmPath: 'film.mp4', filmError: 'old error', producedAt: 123, updatedAt: 10 })
const changed = invalidateEpisodeProduction(produced)
check('invalidates produced episode state', changed && produced.status === 'planned' && !produced.filmPath && !produced.filmError && !produced.producedAt && produced.updatedAt >= 10, JSON.stringify(produced))

const untouched = episode('draft', 1, { status: 'draft' })
check('leaves untouched episode unchanged', !invalidateEpisodeProduction(untouched), JSON.stringify(untouched))

if (failures) {
  console.error(`\nepisodeProduction selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nepisodeProduction selftest: ALL PASSED')
