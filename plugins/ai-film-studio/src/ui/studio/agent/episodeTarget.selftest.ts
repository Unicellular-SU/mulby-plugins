import { parseEpisodeOrdinal, resolveAgentEpisodeTarget } from './episodeTarget'
import type { Episode, ProjectDoc, ProjectMeta } from '../../domain/types'

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

function episode(id: string, index: number, title: string): Episode {
  return { id, index, title, scripts: [], storyboards: [], clips: [], track: [], createdAt: 0, updatedAt: 0 }
}

const doc: ProjectDoc = {
  meta: meta(),
  novel: [],
  scripts: [],
  assets: [],
  storyboards: [],
  clips: [],
  track: [],
  memory: [],
  currentEpisodeId: 'ep1',
  episodes: [episode('ep1', 0, 'Pilot'), episode('ep2', 1, 'Second'), episode('ep3', 2, 'Finale')],
}

check('parses Arabic ordinals', parseEpisodeOrdinal('12') === 12, String(parseEpisodeOrdinal('12')))
check('parses Chinese ordinals', parseEpisodeOrdinal('二十一') === 21, String(parseEpisodeOrdinal('二十一')))
check('resolves Chinese episode target', resolveAgentEpisodeTarget(doc, '请重写第2集剧本')?.episode.id === 'ep2', JSON.stringify(resolveAgentEpisodeTarget(doc, '请重写第2集剧本')))
check('resolves Chinese numeral target', resolveAgentEpisodeTarget(doc, '补一下第三集分镜')?.episode.id === 'ep3', JSON.stringify(resolveAgentEpisodeTarget(doc, '补一下第三集分镜')))
check('resolves E-prefixed target', resolveAgentEpisodeTarget(doc, 'E02 生成资产')?.episode.id === 'ep2', JSON.stringify(resolveAgentEpisodeTarget(doc, 'E02 生成资产')))
check('resolves episode-prefixed target', resolveAgentEpisodeTarget(doc, 'episode 3 needs storyboards')?.episode.id === 'ep3', JSON.stringify(resolveAgentEpisodeTarget(doc, 'episode 3 needs storyboards')))
check('resolves unique title target', resolveAgentEpisodeTarget(doc, '重写 Second 的剧本')?.episode.id === 'ep2', JSON.stringify(resolveAgentEpisodeTarget(doc, '重写 Second 的剧本')))
check('does not treat episode counts as target episodes', !resolveAgentEpisodeTarget(doc, '生成 3 集短剧'), JSON.stringify(resolveAgentEpisodeTarget(doc, '生成 3 集短剧')))

if (failures) {
  console.error(`\nepisodeTarget selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nepisodeTarget selftest: ALL PASSED')
