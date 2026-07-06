import type { Asset } from '../domain/types'
import type { ElementRef } from '../store/assetStore'
import { createProjectAssetFromEntity, elementToLibraryEntity, promoteProjectAssetToEntity } from './assetHub'

let failures = 0
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  OK ${name}`)
  else {
    failures++
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`)
  }
}

const element: ElementRef = {
  id: 'el_hero',
  kind: 'character',
  name: '女主',
  description: '冷静的调查记者',
  prompt: 'consistent face, sharp eyes',
  refAssetIds: ['base-img'],
  tags: ['lead'],
  identity: 'oval face, mole under left eye',
  views: { front: 'front-img', side: 'side-img' },
  appearanceVariants: [{
    id: 'gala',
    label: '晚宴妆',
    appearance: 'black dress, formal makeup',
    prompt: 'formal makeup and black dress',
    views: { front: 'gala-front' },
  }],
  createdAt: 1,
  updatedAt: 2,
}

const entity = elementToLibraryEntity(element)
check('maps ElementRef to LibraryEntity kind and identity', entity.kind === 'character' && entity.identity === element.identity, JSON.stringify(entity))
check('maps element views to media refs', !!entity.mediaRefs?.some((ref) => ref.role === 'front' && ref.assetId === 'front-img'), JSON.stringify(entity.mediaRefs))
check('maps appearance variants to library variants', entity.variants?.[0]?.id === 'gala' && entity.variants[0].mediaRefs?.[0]?.assetId === 'gala-front', JSON.stringify(entity.variants))

const projectAsset = createProjectAssetFromEntity(entity)
check('creates project asset snapshot from entity', projectAsset.type === 'role' && projectAsset.elementId === 'el_hero' && projectAsset.refImageId === 'front-img', JSON.stringify(projectAsset))
check('creates project asset image history from entity refs', (projectAsset.images ?? []).some((image) => image.refImageId === 'side-img'), JSON.stringify(projectAsset.images))
check('creates project asset variants from entity variants', projectAsset.variants?.[0]?.refImageId === 'gala-front', JSON.stringify(projectAsset.variants))

const scopedAsset: Asset = {
  id: 'a_hero',
  type: 'role',
  name: '女主',
  aliases: ['记者'],
  desc: '项目内描述',
  prompt: 'project prompt',
  refImageId: 'project-front',
  elementId: 'el_hero',
  state: 'done',
  variants: [{
    id: 'injured',
    label: '受伤',
    desc: 'forehead bandage',
    refImageId: 'injured-img',
    appliesToEpisodeIds: ['ep2'],
    appliesToSceneIds: ['hospital'],
  }],
}
const promoted = promoteProjectAssetToEntity(scopedAsset, entity)
check('promotes project asset back to existing entity id', promoted.id === 'el_hero' && promoted.version === 2, JSON.stringify(promoted))
check('promoted entity keeps reusable variant fields and drops project scopes', promoted.variants?.[0]?.id === 'injured' && !('appliesToEpisodeIds' in promoted.variants[0]), JSON.stringify(promoted.variants))
check('promoted entity carries aliases and primary image', promoted.aliases?.[0] === '记者' && !!promoted.mediaRefs?.some((ref) => ref.assetId === 'project-front'), JSON.stringify(promoted))

if (failures) {
  console.error(`\nassetHub selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nassetHub selftest: ALL PASSED')
