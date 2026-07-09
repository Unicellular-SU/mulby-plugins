import {
  addEntityToCollection,
  collectionContainsEntity,
  filterEntitiesByCollection,
  normalizeCollection,
  prioritizeEntitiesByCollections,
  removeEntityFromCollection,
  type AssetHubCollection,
} from './assetHubCollections'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  OK ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

const series = normalizeCollection({
  id: 'col_series',
  name: '短剧A角色包',
  kind: 'series',
  entityIds: ['el_hero', 'el_villain'],
}, 1000)

check('normalize keeps collection id/name/kind', series.id === 'col_series' && series.name === '短剧A角色包' && series.kind === 'series', JSON.stringify(series))
check('collectionContainsEntity finds member', collectionContainsEntity(series, 'el_hero'))
check('collectionContainsEntity rejects outsider', !collectionContainsEntity(series, 'el_extra'))

const withExtra = addEntityToCollection(series, 'el_extra', 2000)
check('addEntityToCollection appends and bumps updatedAt', withExtra.entityIds.includes('el_extra') && withExtra.updatedAt === 2000, JSON.stringify(withExtra))
check('addEntityToCollection is idempotent', addEntityToCollection(withExtra, 'el_extra', 3000) === withExtra)

const removed = removeEntityFromCollection(withExtra, 'el_villain', 4000)
check('removeEntityFromCollection drops member', !removed.entityIds.includes('el_villain') && removed.updatedAt === 4000, JSON.stringify(removed))

const entities = [
  { id: 'el_extra', name: '路人' },
  { id: 'el_hero', name: '女主' },
  { id: 'el_villain', name: '反派', archived: true },
  { id: 'el_side', name: '配角' },
]
const collections: AssetHubCollection[] = [
  series,
  normalizeCollection({ id: 'col_style', name: '赛博风', kind: 'style', entityIds: ['el_side'] }, 1),
]

const prioritized = prioritizeEntitiesByCollections(entities, collections, ['col_series'])
check(
  'prioritizeEntitiesByCollections puts preferred first and skips archived',
  prioritized.map((item) => item.id).join() === 'el_hero,el_extra,el_side',
  JSON.stringify(prioritized),
)

const filtered = filterEntitiesByCollection(entities, collections, 'col_style')
check('filterEntitiesByCollection scopes to one pack', filtered.map((item) => item.id).join() === 'el_side', JSON.stringify(filtered))
check('filterEntitiesByCollection all returns original', filterEntitiesByCollection(entities, collections, 'all').length === entities.length)

const alreadyIn = addEntityToCollection(series, 'el_hero', 5000)
check('addEntityToCollection no-op when already member', alreadyIn === series)

if (failures) {
  console.error(`assetHubCollections selftest failed: ${failures} checks`)
  process.exit(1)
}
console.log('assetHubCollections selftest passed')
