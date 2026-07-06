import type { Asset, ProjectDoc } from '../domain/types'
import type { ElementRef } from '../store/assetStore'
import { canvasPortIdentityEntityId, createProjectAssetFromEntity, elementToLibraryEntity, libraryEntityToElement, projectAssetIdentityAppearanceLabels, projectAssetIdentityEntityId, projectAssetIdentityEpisodeLabels, projectEpisodeUsageLabel, projectImageFlowMediaUsageLabel, projectVariantMediaUsageLabel, promoteProjectAssetToEntity, resolveCanvasIdentityEntityUsage, resolveCanvasProjectAssetMediaUsage } from './assetHub'

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
  aliases: ['阿瑶', '王记者'],
  description: '冷静的调查记者',
  prompt: 'consistent face, sharp eyes',
  refAssetIds: ['base-img'],
  tags: ['lead'],
  archived: true,
  identity: 'oval face, mole under left eye',
  views: { front: 'front-img', side: 'side-img' },
  voiceId: 'voice-global',
  appearanceVariants: [{
    id: 'gala',
    label: '晚宴妆',
    kind: 'makeup',
    appearance: 'black dress, formal makeup',
    prompt: 'formal makeup and black dress',
    views: { front: 'gala-front' },
    tags: ['formal'],
  }],
  createdAt: 1,
  updatedAt: 2,
}

const entity = elementToLibraryEntity(element)
check('maps ElementRef to LibraryEntity kind and identity', entity.kind === 'character' && entity.identity === element.identity, JSON.stringify(entity))
check('maps ElementRef archive state to LibraryEntity', entity.archived === true, JSON.stringify(entity))
check('maps element views to media refs', !!entity.mediaRefs?.some((ref) => ref.role === 'front' && ref.assetId === 'front-img'), JSON.stringify(entity.mediaRefs))
check('maps appearance variants to library variants', entity.variants?.[0]?.id === 'gala' && entity.variants[0].mediaRefs?.[0]?.assetId === 'gala-front', JSON.stringify(entity.variants))
check('maps element voice id to library voice ref', entity.voiceRef?.role === 'audio' && entity.voiceRef.assetId === 'voice-global', JSON.stringify(entity.voiceRef))

const projectAsset = createProjectAssetFromEntity(entity)
check('creates project asset snapshot from entity', projectAsset.type === 'role' && projectAsset.elementId === 'el_hero' && projectAsset.refImageId === 'front-img', JSON.stringify(projectAsset))
check('creates project asset aliases and library link', projectAsset.aliases?.includes('阿瑶') === true && projectAsset.libraryLink?.entityId === 'el_hero' && projectAsset.libraryLink.syncPolicy === 'snapshot', JSON.stringify(projectAsset))
check('creates project asset image history from entity refs', (projectAsset.images ?? []).some((image) => image.refImageId === 'side-img'), JSON.stringify(projectAsset.images))
check('creates project asset variants from entity variants', projectAsset.variants?.[0]?.refImageId === 'gala-front' && projectAsset.variants[0].libraryVariantId === 'gala' && projectAsset.variants[0].variantKind === 'makeup', JSON.stringify(projectAsset.variants))
check('maps project variant ids back to library variant ids', projectAsset.libraryLink?.variantMap?.gala === 'gala', JSON.stringify(projectAsset.libraryLink))
check('creates project role voice binding from entity voice ref', projectAsset.voiceAssetId === 'voice-global' && projectAsset.audioBindState === 'done', JSON.stringify(projectAsset))

const scopedAsset: Asset = {
  id: 'a_hero',
  type: 'role',
  name: '女主',
  aliases: ['记者'],
  desc: '项目内描述',
  prompt: 'project prompt',
  refImageId: 'project-front',
  elementId: 'el_hero',
  voiceAssetId: 'voice-project',
  audioBindState: 'done',
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

check('promoted entity carries role voice binding', promoted.voiceRef?.role === 'audio' && promoted.voiceRef.assetId === 'voice-project', JSON.stringify(promoted.voiceRef))

const savedElement = libraryEntityToElement(promoted)
check('maps promoted entity back to ElementRef with aliases', savedElement.aliases?.[0] === '记者' && savedElement.refAssetIds.includes('project-front'), JSON.stringify(savedElement))
check('maps promoted entity version back to ElementRef', savedElement.version === 2, JSON.stringify(savedElement))
check('maps promoted entity archive state back to ElementRef', savedElement.archived === true, JSON.stringify(savedElement))
check('maps promoted entity voice ref back to ElementRef', savedElement.voiceId === 'voice-project', JSON.stringify(savedElement))
check('maps promoted variants back to appearance variants', savedElement.appearanceVariants?.[0]?.id === 'injured' && savedElement.appearanceVariants[0].refAssetIds?.[0] === 'injured-img', JSON.stringify(savedElement.appearanceVariants))
check('uses library link as project asset identity usage source', projectAssetIdentityEntityId({ ...scopedAsset, elementId: 'legacy-id', libraryLink: { entityId: 'linked-id', syncPolicy: 'snapshot' } }) === 'linked-id')
check('falls back to legacy element id for project asset identity usage', projectAssetIdentityEntityId({ ...scopedAsset, elementId: 'legacy-id', libraryLink: undefined }) === 'legacy-id')
check('ignores blank project asset identity ids', projectAssetIdentityEntityId({ ...scopedAsset, elementId: ' ', libraryLink: { entityId: ' ', syncPolicy: 'snapshot' } }) === '')
check('ignores forked project asset identity usage source', projectAssetIdentityEntityId({ ...scopedAsset, elementId: 'legacy-id', libraryLink: { entityId: 'linked-id', syncPolicy: 'forked' } }) === '')
const canvasLookup = new Map([['id:el_hero', 'el_hero'], ['char:hero-code', 'el_hero']])
check('uses explicit canvas library entity lineage', canvasPortIdentityEntityId({ meta: { libraryEntityId: 'el_hero', charId: 'other-code' } }, canvasLookup) === 'el_hero')
check('falls back to canvas char id lineage', canvasPortIdentityEntityId({ meta: { charId: 'hero-code' } }, canvasLookup) === 'el_hero')
check('keeps unknown explicit canvas library entity lineage', canvasPortIdentityEntityId({ meta: { libraryEntityId: 'missing-entity' } }, canvasLookup) === 'missing-entity')
check('counts approved canvas identity lineage as entity usage', resolveCanvasIdentityEntityUsage({ meta: { libraryEntityId: 'el_hero', purpose: 'approved' } }, canvasLookup) === 'el_hero')
check('keeps legacy canvas identity lineage without purpose', resolveCanvasIdentityEntityUsage({ meta: { libraryEntityId: 'el_hero' } }, canvasLookup) === 'el_hero')
check('ignores unapproved canvas identity lineage', resolveCanvasIdentityEntityUsage({ meta: { libraryEntityId: 'el_hero', purpose: 'candidate' } }, canvasLookup) === '')

const lineageProject = {
  meta: { id: 'p_series', name: '悬疑短剧' },
  assets: [{
    id: 'a_hero',
    type: 'role',
    name: '女主',
    state: 'done',
    variants: [{ id: 'gala', label: '晚宴妆', state: 'done', refImageId: 'gala-img' }],
  }],
} as ProjectDoc
const lineageBase = resolveCanvasProjectAssetMediaUsage(
  { assetId: 'hero-img', meta: { projectId: 'p_series', projectAssetId: 'a_hero', purpose: 'approved' } },
  lineageProject
)
check('resolves canvas project asset lineage', lineageBase?.projectName === '悬疑短剧' && lineageBase.assetName === '女主', JSON.stringify(lineageBase))
const lineageVariant = resolveCanvasProjectAssetMediaUsage(
  { assetId: 'gala-img', meta: { projectId: 'p_series', projectAssetId: 'a_hero', projectVariantId: 'gala', purpose: 'approved' } },
  lineageProject
)
check('resolves canvas project variant lineage', lineageVariant?.assetName === '女主 / 晚宴妆', JSON.stringify(lineageVariant))
check('formats episode media usage labels', projectEpisodeUsageLabel('分镜 #2', { index: 2, title: '晚宴追凶' }) === 'E3 晚宴追凶 · 分镜 #2')
check(
  'formats scoped variant media usage labels',
  projectVariantMediaUsageLabel('女主', { id: 'injured', label: '战损妆', refImageId: 'injured-img', appliesToEpisodeIds: ['ep3'], state: 'done' }, new Map([['ep3', { index: 2, title: '雨夜' }]])) === '女主 / 战损妆（E3 雨夜）'
)
const flowUsageProject = {
  meta: { id: 'p_flow', name: '精修短剧', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 1, updatedAt: 1 },
  novel: [],
  scripts: [],
  assets: [{ id: 'a_room', type: 'scene', name: '客厅', state: 'done', flowId: 'flow-asset' }],
  storyboards: [],
  clips: [],
  track: [],
  memory: [],
  currentEpisodeId: 'ep2',
  episodes: [{
    id: 'ep2',
    index: 1,
    title: '雨夜',
    scripts: [],
    storyboards: [{
      id: 'sb-flow',
      episodeId: 'ep2',
      index: 2,
      track: 'A',
      videoDesc: '女主回到客厅',
      duration: 5,
      associateAssetIds: ['a_room'],
      shouldGenerateImage: true,
      flowId: 'flow-storyboard',
      state: 'done',
    }],
    clips: [],
    track: [],
    createdAt: 1,
    updatedAt: 1,
  }],
} as ProjectDoc
check('formats asset image flow media usage labels', projectImageFlowMediaUsageLabel(flowUsageProject, 'flow-asset') === '客厅 · 精修流 flow-asset')
check('formats storyboard image flow media usage labels', projectImageFlowMediaUsageLabel(flowUsageProject, 'flow-storyboard', 'reference') === 'E2 雨夜 · 分镜 #3 精修流 flow-storyboard 参考')
check('keeps fallback image flow media usage labels', projectImageFlowMediaUsageLabel(flowUsageProject, 'missing-flow') === '精修流 missing-flow')
const identityEpisodeProject = {
  meta: { id: 'p_series', name: '多集短剧', artStyle: 'cinematic', videoRatio: '16:9', createdAt: 1, updatedAt: 1 },
  novel: [],
  scripts: [],
  assets: [scopedAsset],
  storyboards: [],
  clips: [],
  track: [],
  memory: [],
  currentEpisodeId: 'ep1',
  episodes: [
    {
      id: 'ep1',
      index: 0,
      title: '开局',
      scripts: [],
      storyboards: [{
        id: 'sb1',
        episodeId: 'ep1',
        index: 0,
        track: 'A',
        videoDesc: '女主登场',
        duration: 5,
        associateAssetIds: ['a_hero'],
        shouldGenerateImage: true,
        state: 'done',
      }],
      clips: [],
      track: [],
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'ep2',
      index: 1,
      title: '雨夜',
      scripts: [],
      storyboards: [{
        id: 'sb2',
        episodeId: 'ep2',
        index: 0,
        track: 'A',
        videoDesc: '女主受伤',
        duration: 5,
        associateAssetIds: [],
        castRefs: [{ assetId: 'a_hero', variantId: 'injured' }],
        shouldGenerateImage: true,
        state: 'done',
      }],
      clips: [],
      track: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ],
} as ProjectDoc
check('lists identity project episode appearances', projectAssetIdentityEpisodeLabels(identityEpisodeProject, 'a_hero').join('、') === 'E1 开局、E2 雨夜')
check('lists identity project appearance variants by episode', projectAssetIdentityAppearanceLabels(identityEpisodeProject, scopedAsset).join('、') === 'E1 开局 · 主形象、E2 雨夜 · 受伤')
const candidateLineage = resolveCanvasProjectAssetMediaUsage(
  { assetId: 'candidate-img', meta: { projectId: 'p_series', projectAssetId: 'a_hero', purpose: 'candidate' } },
  lineageProject
)
check('ignores unapproved canvas project lineage', candidateLineage === null, JSON.stringify(candidateLineage))
const missingVariantLineage = resolveCanvasProjectAssetMediaUsage(
  { assetId: 'old-img', meta: { projectId: 'p_series', projectAssetId: 'a_hero', projectVariantId: 'missing', purpose: 'approved' } },
  lineageProject
)
check('ignores missing project variant lineage', missingVariantLineage === null, JSON.stringify(missingVariantLineage))

if (failures) {
  console.error(`\nassetHub selftest: ${failures} FAILED`)
  process.exit(1)
}

console.log('\nassetHub selftest: ALL PASSED')
