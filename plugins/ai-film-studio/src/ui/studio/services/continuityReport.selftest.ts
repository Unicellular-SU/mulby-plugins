import { buildContinuityReport } from './continuityReport'
import type { Asset, Episode, NovelChapter, ProjectDoc, ProjectMeta, Storyboard } from '../../domain/types'

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

const hero: Asset = {
  id: 'hero',
  type: 'role',
  name: 'Hero',
  refImageId: 'hero-main',
  state: 'done',
  variants: [{ id: 'v-gala', label: 'Gala', appliesToEpisodeIds: ['ep1'] }],
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
check('flags variant outside episode scope', !!ep2?.issues.some((issue) => issue.code === 'variant_out_of_episode_scope'), JSON.stringify(ep2?.issues))
check('flags missing variant ref image', !!ep2?.issues.some((issue) => issue.code === 'missing_ref_image'), JSON.stringify(ep2?.issues))
check('records cast use as not applying to episode', ep2?.castUses[0]?.appliesToEpisode === false, JSON.stringify(ep2?.castUses))

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
