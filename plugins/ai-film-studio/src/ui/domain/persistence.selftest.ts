import { loadProject, recoverInterruptedGenerationState } from './persistence'
import type { Episode, ProjectDoc, ProjectMeta, Storyboard } from './types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

function meta(): ProjectMeta {
  return { id: 'p1', name: 'interrupted', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 }
}

function storyboard(id: string, index: number, patch: Partial<Storyboard> = {}): Storyboard {
  return {
    id,
    index,
    track: 'main',
    videoDesc: `shot ${index + 1}`,
    duration: 4,
    associateAssetIds: [],
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

const doc: ProjectDoc = {
  meta: meta(),
  currentEpisodeId: 'ep1',
  novel: [{ id: 'ch1', index: 0, title: 'Chapter', text: 'text', eventState: 'generating' }],
  scripts: [],
  assets: [
    {
      id: 'hero',
      type: 'role',
      name: 'Hero',
      state: 'generating',
      promptState: 'polishing',
      images: [{ id: 'img1', refImageId: 'asset-img', createdAt: 0, state: 'generating' }],
      variants: [{ id: 'gala', label: 'Gala', state: 'generating' }],
    },
    {
      id: 'kept-error',
      type: 'prop',
      name: 'Key',
      state: 'generating',
      error: 'provider timeout',
      promptState: 'polishing',
      promptError: 'old polish error',
    },
  ],
  storyboards: [storyboard('flat-sb', 0, { state: 'generating' })],
  clips: [{ id: 'flat-clip', storyboardId: 'flat-sb', durationSec: 4, state: 'generating' }],
  track: [{ id: 'flat-track', storyboardIds: ['flat-sb'], clipIds: ['flat-clip'], order: 0, promptState: 'generating' }],
  memory: [],
  episodes: [
    episode('ep1', 0, { status: 'generating' }),
    episode('ep2', 1, {
      status: 'generating',
      filmError: 'old film error',
      storyboards: [storyboard('ep2-sb', 0, { state: 'generating' })],
      clips: [{ id: 'ep2-clip', storyboardId: 'ep2-sb', durationSec: 4, state: 'generating' }],
      track: [{ id: 'ep2-track', storyboardIds: ['ep2-sb'], clipIds: ['ep2-clip'], order: 0, promptState: 'generating', promptError: 'old prompt error' }],
    }),
  ],
}

const changed = recoverInterruptedGenerationState(doc, 42)
const episodes = doc.episodes ?? []
check('reports interrupted state recovery', changed, 'expected recovery to change the doc')
check('recovers interrupted novel event extraction', doc.novel[0].eventState === 'failed', String(doc.novel[0].eventState))
check('recovers interrupted asset generation', doc.assets[0].state === 'failed' && !!doc.assets[0].error, JSON.stringify(doc.assets[0]))
check('recovers interrupted asset prompt polish', doc.assets[0].promptState === 'failed' && !!doc.assets[0].promptError, JSON.stringify(doc.assets[0]))
check('recovers interrupted asset image and variant generation', doc.assets[0].images?.[0]?.state === 'failed' && doc.assets[0].variants?.[0]?.state === 'failed', JSON.stringify(doc.assets[0]))
check('keeps existing generation and prompt errors', doc.assets[1].error === 'provider timeout' && doc.assets[1].promptError === 'old polish error', JSON.stringify(doc.assets[1]))
check('recovers flat storyboard, clip, and track prompt state', doc.storyboards[0].state === 'failed' && doc.clips[0].state === 'failed' && doc.track[0].promptState === 'failed', JSON.stringify({ storyboards: doc.storyboards, clips: doc.clips, track: doc.track }))
check('recovers episode production state to retryable planned', episodes[0]?.status === 'planned' && !!episodes[0].filmError && episodes[0].updatedAt === 42, JSON.stringify(episodes[0]))
check('recovers non-current episode work without overwriting film errors', episodes[1]?.status === 'planned' && episodes[1].filmError === 'old film error' && episodes[1].storyboards[0].state === 'failed' && episodes[1].clips[0].state === 'failed', JSON.stringify(episodes[1]))
check('keeps existing track prompt errors', episodes[1]?.track[0].promptError === 'old prompt error', JSON.stringify(episodes[1]?.track[0]))
check('is idempotent after recovery', !recoverInterruptedGenerationState(doc, 99), 'second recovery should not change the doc')

const legacyProject: ProjectDoc = {
  meta: meta(),
  currentEpisodeId: 'ep1',
  novel: [],
  scripts: [],
  assets: [],
  storyboards: [storyboard('flat-sb', 0)],
  clips: [],
  track: [{ id: 'flat-track', storyboardIds: ['flat-sb'], clipIds: 'bad-clip-list', selectClipId: 7, order: 'late' } as unknown as ProjectDoc['track'][number]],
  memory: [],
  episodes: [
    episode('ep1', 0, { storyboards: [], track: [] }),
    episode('ep2', 1, {
      storyboards: [storyboard('ep2-second', 1), storyboard('ep2-first', 0)],
      track: [
        { id: 'stale-track', storyboardIds: ['deleted-sb'], clipIds: [], order: 0 },
        { id: 'existing-track', storyboardIds: ['ep2-second'], clipIds: 'bad-clip-list', selectClipId: 12, order: 'late' } as unknown as Episode['track'][number],
      ],
    }),
  ],
}

;(globalThis as unknown as { window: { mulby: unknown } }).window = {
  mulby: {
    storage: {
      get: async () => legacyProject,
    },
  },
}
const normalizedProject = await loadProject('legacy')
const normalizedEp2 = normalizedProject?.episodes?.find((episode) => episode.id === 'ep2')
check('normalizes missing flat tracks while loading legacy projects', normalizedProject?.track.length === 1 && normalizedProject.track[0].storyboardIds.join(',') === 'flat-sb', JSON.stringify(normalizedProject?.track))
check('sanitizes malformed flat track fields while loading legacy projects', Array.isArray(normalizedProject?.track[0]?.clipIds) && normalizedProject.track[0].clipIds.length === 0 && normalizedProject.track[0].selectClipId === undefined && normalizedProject.track[0].order === 0, JSON.stringify(normalizedProject?.track[0]))
check(
  'normalizes non-current episode tracks while loading legacy projects',
  normalizedEp2?.track.length === 2 &&
    normalizedEp2.track[0].storyboardIds.join(',') === 'ep2-first' &&
    normalizedEp2.track[1].storyboardIds.join(',') === 'ep2-second' &&
    !normalizedEp2.track.some((track) => track.storyboardIds.includes('deleted-sb')),
  JSON.stringify(normalizedEp2?.track),
)
check('sanitizes malformed non-current episode track fields while loading legacy projects', Array.isArray(normalizedEp2?.track[1]?.clipIds) && normalizedEp2.track[1].clipIds.length === 0 && normalizedEp2.track[1].selectClipId === undefined && normalizedEp2.track[1].order === 1, JSON.stringify(normalizedEp2?.track[1]))

if (failures) {
  console.error(`\npersistence selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\npersistence selftest: ALL PASSED')
