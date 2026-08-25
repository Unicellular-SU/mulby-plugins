import {
  KEY_ELEMENTS_LIBRARY,
  KEY_ENTITIES_V2,
  mergeEntitiesPreferV2,
  normalizeLibraryEntity,
  persistableLibraryEntity,
} from './assetHubEntities'
import type { LibraryEntity } from './assetHub'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  OK ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

check('KEY_ENTITIES_V2 is assetHub:entities:v2', KEY_ENTITIES_V2 === 'assetHub:entities:v2')
check('KEY_ELEMENTS_LIBRARY remains elements:library', KEY_ELEMENTS_LIBRARY === 'elements:library')

const entity: LibraryEntity = {
  id: 'el_hero',
  kind: 'character',
  name: '女主',
  aliases: ['阿青'],
  description: '主角',
  prompt: 'portrait',
  mediaRefs: [{ assetId: 'img_1', role: 'primary', createdAt: 1 }],
  variants: [{ id: 'v1', label: '晚宴妆', kind: 'makeup', createdAt: 1, updatedAt: 1, mediaRefs: [{ assetId: 'img_2', role: 'primary', createdAt: 2 }] }],
  version: 3,
  archived: false,
  createdAt: 10,
  updatedAt: 20,
  legacyElement: {
    id: 'el_hero',
    kind: 'character',
    name: '女主',
    refAssetIds: ['img_1'],
    createdAt: 10,
    updatedAt: 20,
  },
}

const persisted = persistableLibraryEntity(entity)
check('persistableLibraryEntity strips legacyElement', persisted.legacyElement === undefined, JSON.stringify(persisted))
check('persistableLibraryEntity keeps identity fields', persisted.id === 'el_hero' && persisted.version === 3 && persisted.variants?.[0]?.label === '晚宴妆')

const normalized = normalizeLibraryEntity({
  id: ' el_scene ',
  kind: 'scene',
  name: ' 咖啡馆 ',
  version: 0,
  archived: 1,
  createdAt: 5,
})
check(
  'normalizeLibraryEntity trims and defaults version',
  !!normalized && normalized.id === 'el_scene' && normalized.name === '咖啡馆' && normalized.version === 1 && normalized.archived === true,
  JSON.stringify(normalized),
)
check('normalizeLibraryEntity rejects missing name', normalizeLibraryEntity({ id: 'x' }) === null)

const fromElements: LibraryEntity[] = [
  {
    id: 'el_legacy',
    kind: 'prop',
    name: '旧道具',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]
check('mergeEntitiesPreferV2 uses v2 when present', mergeEntitiesPreferV2([persisted], fromElements)[0]?.id === 'el_hero')
check('mergeEntitiesPreferV2 falls back to elements', mergeEntitiesPreferV2([], fromElements)[0]?.id === 'el_legacy')

if (failures) {
  console.error(`assetHubEntities selftest failed: ${failures} checks`)
  process.exit(1)
}
console.log('assetHubEntities selftest passed')
