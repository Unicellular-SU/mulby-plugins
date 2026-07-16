import { removeVariantScopeReferences } from './variantScopes'
import type { ProjectDoc, ProjectMeta } from './types'

let failures = 0

function check(name: string, condition: boolean, detail: string) {
  if (condition) console.log(`  OK ${name}`)
  else {
    failures += 1
    console.error(`  FAIL ${name}: ${detail}`)
  }
}

function meta(): ProjectMeta {
  return { id: 'p1', name: 'scopes', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 0, updatedAt: 0 }
}

function doc(): ProjectDoc {
  return {
    meta: meta(),
    novel: [],
    scripts: [],
    assets: [{
      id: 'hero',
      type: 'role',
      name: 'Hero',
      state: 'done',
      variants: [
        { id: 'gala', label: 'Gala', appliesToEpisodeIds: ['ep1', 'ep2'], appliesToStoryboardIds: ['sb1', 'sb2'], appliesToSceneIds: ['banquet'] },
        { id: 'mask', label: 'Mask', appliesToEpisodeIds: ['ep1'], appliesToStoryboardIds: ['sb1'] },
      ],
    }],
    storyboards: [],
    clips: [],
    track: [],
    memory: [],
  }
}

const project = doc()
const changed = removeVariantScopeReferences(project, { episodeIds: ['ep1'], storyboardIds: ['sb1'] })
const variants = project.assets[0].variants ?? []
check('removes deleted episode and storyboard ids from variant scopes', changed === 4 && variants[0].appliesToEpisodeIds?.join(',') === 'ep2' && variants[0].appliesToStoryboardIds?.join(',') === 'sb2', JSON.stringify(variants[0]))
check('preserves unrelated scene scopes', variants[0].appliesToSceneIds?.join(',') === 'banquet', JSON.stringify(variants[0]))
check('clears empty scope fields after deleted references are removed', variants[1].appliesToEpisodeIds === undefined && variants[1].appliesToStoryboardIds === undefined, JSON.stringify(variants[1]))
check('is a no-op when no referenced scope ids are removed', removeVariantScopeReferences(project, { episodeIds: ['missing'], storyboardIds: ['ghost'] }) === 0, JSON.stringify(project.assets[0].variants))

if (failures) {
  console.error(`\nvariantScopes selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nvariantScopes selftest: ALL PASSED')
