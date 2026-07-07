import type { Asset, AssetImage, AssetVariant, Clip, Episode, ProjectDoc, Storyboard, VideoTrack } from '../domain/types'
import { loadIndex, loadProject, newId } from '../domain/persistence'
import { castRefsForStoryboard } from '../domain/castRefs'
import type { ElementKind, ElementMediaRef, ElementRef, ElementVariant } from '../store/assetStore'
import { loadBoards, loadRegistry, storageUsage, type AssetRecord, type Board } from './assetRegistry'

const PLUGIN_ID = 'ai-film-studio'
const KEY_ELEMENTS = 'elements:library'
const KEY_CANVAS_INDEX = 'projects:index'
const KEY_SNAPSHOTS = 'snapshots'
const canvasProjectKey = (id: string) => `project:${id}`

export type LibraryEntityKind = 'character' | 'scene' | 'prop' | 'voice'
export type MediaRefRole = 'primary' | 'front' | 'side' | 'back' | 'concept' | 'reference' | 'audio'
export type LibraryVariantKind = 'age' | 'outfit' | 'makeup' | 'injury' | 'state' | 'time' | 'weather' | 'custom'

export interface MediaRef {
  mediaAssetId?: string
  assetId?: string
  localPath?: string
  url?: string
  role: MediaRefRole
  label?: string
  createdAt: number
}

export interface LibraryVariant {
  id: string
  label: string
  kind?: LibraryVariantKind
  desc?: string
  prompt?: string
  parentVariantId?: string
  mediaRefs?: MediaRef[]
  tags?: string[]
  createdAt: number
  updatedAt: number
}

export interface LibraryEntity {
  id: string
  kind: LibraryEntityKind
  name: string
  aliases?: string[]
  identity?: string
  description?: string
  prompt?: string
  tags?: string[]
  mediaRefs?: MediaRef[]
  variants?: LibraryVariant[]
  voiceRef?: MediaRef
  lora?: { provider?: string; ref: string; weight?: number }
  version: number
  archived?: boolean
  createdAt: number
  updatedAt: number
  legacyElement?: ElementRef
}

export interface AssetHubProjectUsage {
  projectId: string
  projectName: string
  assetIds: string[]
  assetNames: string[]
  episodeLabels?: string[]
  appearanceLabels?: string[]
}

export interface AssetHubCanvasUsage {
  projectId: string
  projectName: string
  nodeIds: string[]
  nodeTitles: string[]
}

export interface AssetHubSnapshotUsage {
  snapshotId: string
  snapshotName: string
  projectId?: string
  nodeIds: string[]
  nodeTitles: string[]
}

export interface IdentityAssetUsage {
  entityId: string
  projectCount: number
  assetCount: number
  canvasProjectCount: number
  canvasNodeCount: number
  snapshotCount: number
  projects: AssetHubProjectUsage[]
  canvasProjects: AssetHubCanvasUsage[]
  snapshots: AssetHubSnapshotUsage[]
}

export interface AssetHubLibraryEntityMediaUsage {
  entityId: string
  entityName: string
  roles: string[]
}

export interface MediaAssetUsage {
  mediaKey: string
  projectCount: number
  projectAssetCount: number
  storyboardCount: number
  libraryEntityCount: number
  canvasProjectCount: number
  canvasNodeCount: number
  snapshotCount: number
  projects: AssetHubProjectUsage[]
  libraryEntities: AssetHubLibraryEntityMediaUsage[]
  canvasProjects: AssetHubCanvasUsage[]
  snapshots: AssetHubSnapshotUsage[]
}

export interface AssetHubSnapshot {
  mediaAssets: AssetRecord[]
  boards: Board[]
  storageUsage: { count: number; bytes: number }
  elements: ElementRef[]
  entities: LibraryEntity[]
  usageByEntity: Record<string, IdentityAssetUsage>
  usageByMedia: Record<string, MediaAssetUsage>
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, PLUGIN_ID)
    return (v as T) ?? null
  } catch {
    return null
  }
}

function now(): number {
  return Date.now()
}

function mediaRefFromAssetId(assetId: string | undefined, role: MediaRefRole, label?: string): MediaRef | undefined {
  if (!assetId) return undefined
  return { assetId, role, label, createdAt: now() }
}

function mediaRefFromElementRef(ref: ElementMediaRef | undefined): MediaRef | undefined {
  if (!ref?.assetId) return undefined
  return { assetId: ref.assetId, role: ref.role, label: ref.label, createdAt: ref.createdAt || now() }
}

function legacyMediaRefs(
  explicitRefs: ElementMediaRef[] | undefined,
  views?: { front?: string; side?: string; back?: string },
  refAssetIds?: string[],
): Array<MediaRef | undefined> {
  const explicitAssetIds = new Set((explicitRefs ?? []).map((ref) => ref.assetId).filter(Boolean))
  return [
    mediaRefFromAssetId(views?.front, 'front', 'front'),
    mediaRefFromAssetId(views?.side, 'side', 'side'),
    mediaRefFromAssetId(views?.back, 'back', 'back'),
    ...(refAssetIds ?? []).filter((assetId) => !explicitAssetIds.has(assetId)).map((assetId, index) => mediaRefFromAssetId(assetId, index === 0 ? 'primary' : 'reference')),
  ]
}

function dedupeMediaRefs(refs: Array<MediaRef | undefined>): MediaRef[] | undefined {
  const out: MediaRef[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (!ref) continue
    const key = `${ref.role}:${ref.mediaAssetId ?? ref.assetId ?? ref.localPath ?? ref.url ?? ''}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out.length ? out : undefined
}

function elementKindToEntityKind(kind: ElementKind): LibraryEntityKind {
  return kind === 'scene' ? 'scene' : kind === 'prop' ? 'prop' : 'character'
}

function assetTypeToEntityKind(type: Asset['type']): LibraryEntityKind {
  if (type === 'scene') return 'scene'
  if (type === 'prop' || type === 'clip') return 'prop'
  if (type === 'audio') return 'voice'
  return 'character'
}

function entityKindToAssetType(kind: LibraryEntityKind): Asset['type'] {
  if (kind === 'scene') return 'scene'
  if (kind === 'prop') return 'prop'
  if (kind === 'voice') return 'audio'
  return 'role'
}

function primaryRef(refs: MediaRef[] | undefined, roles: MediaRefRole[] = ['front', 'primary', 'reference', 'concept']): MediaRef | undefined {
  if (!refs?.length) return undefined
  for (const role of roles) {
    const ref = refs.find((item) => item.role === role && (item.assetId || item.localPath || item.url))
    if (ref) return ref
  }
  return refs.find((item) => item.assetId || item.localPath || item.url)
}

function elementVariantToLibraryVariant(variant: ElementVariant): LibraryVariant {
  const ts = now()
  const mediaRefs = dedupeMediaRefs([
    ...(variant.mediaRefs ?? []).map(mediaRefFromElementRef),
    ...legacyMediaRefs(variant.mediaRefs, variant.views, variant.refAssetIds),
  ])
  return {
    id: variant.id || variant.label || newId('lv_'),
    label: variant.label || variant.id || '未命名形态',
    kind: variant.kind,
    desc: variant.appearance,
    prompt: variant.prompt,
    parentVariantId: variant.parentVariantId,
    mediaRefs,
    tags: variant.tags,
    createdAt: ts,
    updatedAt: ts,
  }
}

export function elementToLibraryEntity(element: ElementRef): LibraryEntity {
  const ts = element.updatedAt || element.createdAt || now()
  const mediaRefs = dedupeMediaRefs([
    ...(element.mediaRefs ?? []).map(mediaRefFromElementRef),
    ...legacyMediaRefs(element.mediaRefs, element.views, element.refAssetIds),
  ])
  return {
    id: element.id,
    kind: elementKindToEntityKind(element.kind),
    name: element.name,
    aliases: element.aliases,
    identity: element.identity,
    description: element.description,
    prompt: element.prompt,
    tags: element.tags,
    mediaRefs,
    variants: element.appearanceVariants?.map(elementVariantToLibraryVariant),
    voiceRef: mediaRefFromAssetId(element.voiceId, 'audio', 'voice'),
    lora: element.lora,
    version: element.version ?? 1,
    archived: element.archived,
    createdAt: element.createdAt,
    updatedAt: ts,
    legacyElement: element,
  }
}

export function libraryEntityToElement(entity: LibraryEntity): ElementRef {
  const front = entity.mediaRefs?.find((ref) => ref.role === 'front')?.assetId
  const side = entity.mediaRefs?.find((ref) => ref.role === 'side')?.assetId
  const back = entity.mediaRefs?.find((ref) => ref.role === 'back')?.assetId
  const refs = [...new Set((entity.mediaRefs ?? []).map((ref) => ref.assetId).filter((assetId): assetId is string => !!assetId))]
  return {
    id: entity.id,
    kind: entity.kind === 'scene' ? 'scene' : entity.kind === 'prop' ? 'prop' : 'character',
    name: entity.name,
    aliases: entity.aliases,
    description: entity.description,
    prompt: entity.prompt,
    refAssetIds: refs,
    tags: entity.tags,
    version: entity.version,
    archived: entity.archived,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    identity: entity.identity,
    views: front || side || back ? { front, side, back } : undefined,
    mediaRefs: entity.mediaRefs?.map((ref) => ({ assetId: ref.assetId, role: ref.role, label: ref.label, createdAt: ref.createdAt })),
    voiceId: entity.voiceRef?.assetId ?? entity.legacyElement?.voiceId,
    lora: entity.lora,
    appearanceVariants: entity.variants?.map((variant) => ({
      id: variant.id,
      label: variant.label,
      kind: variant.kind,
      appearance: variant.desc,
      prompt: variant.prompt,
      parentVariantId: variant.parentVariantId,
      views: {
        front: variant.mediaRefs?.find((ref) => ref.role === 'front')?.assetId,
        side: variant.mediaRefs?.find((ref) => ref.role === 'side')?.assetId,
        back: variant.mediaRefs?.find((ref) => ref.role === 'back')?.assetId,
      },
      mediaRefs: variant.mediaRefs?.map((ref) => ({ assetId: ref.assetId, role: ref.role, label: ref.label, createdAt: ref.createdAt })),
      refAssetIds: [...new Set((variant.mediaRefs ?? []).map((ref) => ref.assetId).filter((assetId): assetId is string => !!assetId))],
      tags: variant.tags,
    })),
  }
}

function mediaRefsToAssetImages(refs: MediaRef[] | undefined): { images?: AssetImage[]; currentImageId?: string; refImageId?: string } {
  const imageRefs = (refs ?? []).filter((ref) => !!ref.assetId)
  const images = imageRefs.map((ref): AssetImage => ({ id: newId('ai_'), refImageId: ref.assetId as string, createdAt: ref.createdAt || now(), state: 'done' }))
  const selectedRef = primaryRef(refs)
  const selected = selectedRef?.assetId ? images.find((image) => image.refImageId === selectedRef.assetId) : images[0]
  return {
    images: images.length ? images : undefined,
    currentImageId: selected?.id,
    refImageId: selected?.refImageId,
  }
}

function libraryVariantToAssetVariant(variant: LibraryVariant): AssetVariant {
  const selected = primaryRef(variant.mediaRefs)
  return {
    id: variant.id,
    libraryVariantId: variant.id,
    label: variant.label,
    variantKind: variant.kind,
    desc: variant.desc,
    prompt: variant.prompt,
    refImageId: selected?.assetId,
    parentVariantId: variant.parentVariantId,
    tags: variant.tags,
    state: selected?.assetId ? 'done' : 'idle',
  }
}

export function createProjectAssetFromEntity(entity: LibraryEntity, kind?: Asset['type']): Asset {
  const type = kind ?? entityKindToAssetType(entity.kind)
  const media = mediaRefsToAssetImages(entity.mediaRefs)
  const variants = entity.variants?.map(libraryVariantToAssetVariant)
  const variantMap = variants?.reduce<Record<string, string>>((acc, variant) => {
    if (variant.libraryVariantId) acc[variant.id] = variant.libraryVariantId
    return acc
  }, {})
  const asset: Asset = {
    id: newId('a_'),
    type,
    name: entity.name,
    aliases: entity.aliases,
    prompt: entity.prompt,
    desc: entity.description,
    refImageId: media.refImageId,
    images: media.images,
    currentImageId: media.currentImageId,
    elementId: entity.id,
    libraryLink: {
      entityId: entity.id,
      entityVersion: entity.version,
      syncPolicy: 'snapshot',
      variantMap: variantMap && Object.keys(variantMap).length ? variantMap : undefined,
      lastSyncedAt: now(),
    },
    variants,
    lora: entity.lora,
    state: media.refImageId ? 'done' : 'idle',
  }
  if (entity.kind === 'voice') {
    const voice = entity.voiceRef ?? primaryRef(entity.mediaRefs, ['audio', 'primary'])
    asset.audioFilePath = voice?.localPath
    asset.audioUrl = voice?.url
    asset.state = voice?.localPath || voice?.url ? 'done' : asset.state
  } else if (type === 'role' && entity.voiceRef?.assetId) {
    asset.voiceAssetId = entity.voiceRef.assetId
    asset.audioBindState = 'done'
  }
  return asset
}

function assetVariantToLibraryVariant(variant: AssetVariant): LibraryVariant {
  const ts = now()
  return {
    id: variant.libraryVariantId ?? variant.id,
    label: variant.label,
    kind: variant.variantKind,
    desc: variant.desc,
    prompt: variant.prompt,
    parentVariantId: variant.parentVariantId,
    tags: variant.tags,
    mediaRefs: dedupeMediaRefs([mediaRefFromAssetId(variant.refImageId, 'primary')]),
    createdAt: ts,
    updatedAt: ts,
  }
}

function existingMediaRefFor(assetId: string | undefined, refs: MediaRef[] | undefined): MediaRef | undefined {
  if (!assetId) return undefined
  return refs?.find((ref) => ref.assetId === assetId)
}

function projectImageMediaRef(assetId: string | undefined, role: MediaRefRole, existingRefs?: MediaRef[]): MediaRef | undefined {
  if (!assetId) return undefined
  const existing = existingMediaRefFor(assetId, existingRefs)
  return { assetId, role: existing?.role ?? role, label: existing?.label, createdAt: existing?.createdAt ?? now() }
}

function assetMediaRefs(asset: Asset, existingRefs?: MediaRef[]): MediaRef[] | undefined {
  const refs = [
    ...(asset.images ?? []).map((image) => projectImageMediaRef(image.refImageId, image.id === asset.currentImageId ? 'primary' : 'reference', existingRefs)),
    projectImageMediaRef(asset.refImageId, 'primary', existingRefs),
  ]
  if (asset.type === 'audio') refs.push({ role: 'audio', localPath: asset.audioFilePath, url: asset.audioUrl, createdAt: now() })
  return dedupeMediaRefs(refs)
}

export function promoteProjectAssetToEntity(asset: Asset, existing?: LibraryEntity): LibraryEntity {
  const ts = now()
  const mediaRefs = assetMediaRefs(asset, existing?.mediaRefs)
  return {
    id: existing?.id ?? asset.elementId ?? newId('el_'),
    kind: existing?.kind ?? assetTypeToEntityKind(asset.type),
    name: asset.name,
    aliases: asset.aliases,
    description: asset.desc,
    prompt: asset.prompt,
    mediaRefs,
    variants: asset.variants?.map(assetVariantToLibraryVariant),
    voiceRef:
      asset.type === 'audio'
        ? { role: 'audio', localPath: asset.audioFilePath, url: asset.audioUrl, createdAt: ts }
        : asset.type === 'role' && asset.voiceAssetId
          ? mediaRefFromAssetId(asset.voiceAssetId, 'audio', 'voice')
          : existing?.voiceRef,
    lora: asset.lora ?? existing?.lora,
    version: (existing?.version ?? 0) + 1,
    archived: existing?.archived,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    legacyElement: existing?.legacyElement,
  }
}

export interface CanvasPortValue {
  assetId?: string
  localPath?: string
  url?: string
  items?: CanvasPortValue[]
  meta?: Record<string, unknown>
}
interface CanvasNode {
  id?: string
  data?: {
    kind?: string
    title?: string
    params?: Record<string, unknown>
    outputs?: Record<string, CanvasPortValue>
  }
}
interface CanvasProject {
  id?: string
  name?: string
  nodes?: CanvasNode[]
}
interface CanvasSnapshot {
  id?: string
  projectId?: string
  name?: string
  nodes?: CanvasNode[]
}

export interface CanvasProjectAssetMediaUsage {
  projectId: string
  projectName: string
  assetId: string
  assetName: string
}

function lineageString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function canvasLineageProjectId(port: CanvasPortValue): string {
  return lineageString(port.meta?.projectId)
}

function projectAssetUsageName(asset: Asset, variantId: string): string | null {
  if (!variantId) return asset.name
  const variant = asset.variants?.find((item) => item.id === variantId)
  return variant ? `${asset.name} / ${variant.label}` : null
}

type EpisodeUsageSource = Pick<Episode, 'index' | 'title'>

function episodeUsagePrefix(episode: EpisodeUsageSource | undefined): string {
  if (!episode) return ''
  const index = Number.isFinite(episode.index) ? `E${episode.index + 1}` : ''
  const title = episode.title?.trim()
  return [index, title].filter(Boolean).join(' ')
}

export function projectEpisodeUsageLabel(label: string, episode?: EpisodeUsageSource): string {
  const prefix = episodeUsagePrefix(episode)
  return prefix ? `${prefix} · ${label}` : label
}

function variantEpisodeScopeLabel(variant: AssetVariant, episodesById: ReadonlyMap<string, EpisodeUsageSource>): string {
  const labels = [
    ...new Set(
      (variant.appliesToEpisodeIds ?? [])
        .map((episodeId) => episodeUsagePrefix(episodesById.get(episodeId)))
        .filter(Boolean),
    ),
  ]
  return labels.length ? `（${labels.join('、')}）` : ''
}

export function projectVariantMediaUsageLabel(assetName: string, variant: AssetVariant, episodesById: ReadonlyMap<string, EpisodeUsageSource> = new Map()): string {
  const scope = variantEpisodeScopeLabel(variant, episodesById)
  return `${assetName} / ${variant.label}${scope}`
}

export function projectImageFlowMediaUsageLabel(doc: ProjectDoc, flowId: string, kind: 'output' | 'reference' = 'output'): string {
  const normalizedFlowId = lineageString(flowId)
  const base = `精修流 ${normalizedFlowId || '未命名'}${kind === 'reference' ? ' 参考' : ''}`
  if (!normalizedFlowId) return base
  const asset = doc.assets?.find((item) => lineageString(item.flowId) === normalizedFlowId)
  if (asset) return `${asset.name} · ${base}`
  const episodesById = new Map((doc.episodes ?? []).map((episode) => [episode.id, episode]))
  const currentEpisode = doc.currentEpisodeId ? episodesById.get(doc.currentEpisodeId) : undefined
  const entry = collectEpisodeStoryboards(doc, episodesById, currentEpisode).find(({ storyboard }) => lineageString(storyboard.flowId) === normalizedFlowId)
  return entry ? projectEpisodeUsageLabel(`分镜 #${entry.storyboard.index + 1} ${base}`, entry.episode) : base
}

export function projectAssetIdentityEpisodeLabels(doc: ProjectDoc, assetId: string): string[] {
  const episodesById = new Map((doc.episodes ?? []).map((episode) => [episode.id, episode]))
  const currentEpisode = doc.currentEpisodeId ? episodesById.get(doc.currentEpisodeId) : undefined
  const labels = new Set<string>()
  for (const { storyboard, episode } of collectEpisodeStoryboards(doc, episodesById, currentEpisode)) {
    if (!castRefsForStoryboard(storyboard).some((ref) => ref.assetId === assetId)) continue
    const label = episodeUsagePrefix(episode)
    if (label) labels.add(label)
  }
  return [...labels]
}

export function projectAssetIdentityAppearanceLabels(doc: ProjectDoc, asset: Asset): string[] {
  const episodesById = new Map((doc.episodes ?? []).map((episode) => [episode.id, episode]))
  const currentEpisode = doc.currentEpisodeId ? episodesById.get(doc.currentEpisodeId) : undefined
  const labels = new Set<string>()
  for (const { storyboard, episode } of collectEpisodeStoryboards(doc, episodesById, currentEpisode)) {
    for (const ref of castRefsForStoryboard(storyboard)) {
      if (ref.assetId !== asset.id) continue
      const variantLabel = ref.variantId
        ? asset.variants?.find((variant) => variant.id === ref.variantId)?.label ?? ref.variantId
        : '主形象'
      labels.add(projectEpisodeUsageLabel(variantLabel, episode))
    }
  }
  return [...labels]
}

export function resolveCanvasProjectAssetMediaUsage(port: CanvasPortValue, project: ProjectDoc | undefined): CanvasProjectAssetMediaUsage | null {
  const projectId = canvasLineageProjectId(port)
  const projectAssetId = lineageString(port.meta?.projectAssetId)
  if (!projectId || !projectAssetId || !project || project.meta.id !== projectId) return null
  const purpose = lineageString(port.meta?.purpose)
  if (purpose && purpose !== 'approved') return null
  const asset = project.assets?.find((item) => item.id === projectAssetId)
  if (!asset) return null
  const assetName = projectAssetUsageName(asset, lineageString(port.meta?.projectVariantId))
  if (!assetName) return null
  return { projectId, projectName: project.meta.name, assetId: asset.id, assetName }
}

export function projectAssetIdentityEntityId(asset: Asset): string {
  if (asset.libraryLink?.syncPolicy === 'forked') return ''
  return lineageString(asset.libraryLink?.entityId) || lineageString(asset.elementId)
}

export function projectAssetIdentityUsageEntityId(doc: ProjectDoc, asset: Asset, usageByEntity?: Record<string, IdentityAssetUsage>): string {
  const linkedEntityId = projectAssetIdentityEntityId(asset)
  if (linkedEntityId) return linkedEntityId
  if (asset.libraryLink?.syncPolicy === 'forked' || !usageByEntity) return ''
  for (const usage of Object.values(usageByEntity)) {
    if (usage.projects.some((project) => project.projectId === doc.meta.id && project.assetIds.includes(asset.id))) return usage.entityId
  }
  return ''
}

export function projectAssetIdentityUsageFromHub(doc: ProjectDoc, asset: Asset, usageByEntity?: Record<string, IdentityAssetUsage>): IdentityAssetUsage | undefined {
  const entityId = projectAssetIdentityUsageEntityId(doc, asset, usageByEntity)
  return entityId ? usageByEntity?.[entityId] : undefined
}

function emptyUsage(entityId: string): IdentityAssetUsage {
  return { entityId, projectCount: 0, assetCount: 0, canvasProjectCount: 0, canvasNodeCount: 0, snapshotCount: 0, projects: [], canvasProjects: [], snapshots: [] }
}

function mediaKey(ref: { assetId?: string; localPath?: string; url?: string } | undefined): string {
  return ref?.assetId || ref?.localPath || ref?.url || ''
}

function emptyMediaUsage(mediaKey: string): MediaAssetUsage {
  return { mediaKey, projectCount: 0, projectAssetCount: 0, storyboardCount: 0, libraryEntityCount: 0, canvasProjectCount: 0, canvasNodeCount: 0, snapshotCount: 0, projects: [], libraryEntities: [], canvasProjects: [], snapshots: [] }
}

function usageFor(map: Record<string, IdentityAssetUsage>, entityId: string): IdentityAssetUsage {
  map[entityId] ??= emptyUsage(entityId)
  return map[entityId]
}

function mediaUsageFor(map: Record<string, MediaAssetUsage>, key: string): MediaAssetUsage {
  map[key] ??= emptyMediaUsage(key)
  return map[key]
}

function addStudioUsage(
  map: Record<string, IdentityAssetUsage>,
  entityId: string,
  projectId: string,
  projectName: string,
  assetId: string,
  assetName: string,
  episodeLabels: string[] = [],
  appearanceLabels: string[] = [],
): void {
  const usage = usageFor(map, entityId)
  let project = usage.projects.find((item) => item.projectId === projectId)
  if (!project) {
    project = { projectId, projectName, assetIds: [], assetNames: [] }
    usage.projects.push(project)
  }
  if (!project.assetIds.includes(assetId)) {
    project.assetIds.push(assetId)
    project.assetNames.push(assetName)
    usage.assetCount += 1
  }
  if (episodeLabels.length) project.episodeLabels = [...new Set([...(project.episodeLabels ?? []), ...episodeLabels])]
  if (appearanceLabels.length) project.appearanceLabels = [...new Set([...(project.appearanceLabels ?? []), ...appearanceLabels])]
  usage.projectCount = usage.projects.length
}

function addMediaProjectAssetUsage(map: Record<string, MediaAssetUsage>, key: string, projectId: string, projectName: string, assetId: string, assetName: string): void {
  if (!key) return
  const usage = mediaUsageFor(map, key)
  let project = usage.projects.find((item) => item.projectId === projectId)
  if (!project) {
    project = { projectId, projectName, assetIds: [], assetNames: [] }
    usage.projects.push(project)
  }
  if (!project.assetIds.includes(assetId)) {
    project.assetIds.push(assetId)
    project.assetNames.push(assetName)
    usage.projectAssetCount += 1
  }
  usage.projectCount = usage.projects.length
}

function addMediaStoryboardUsage(map: Record<string, MediaAssetUsage>, key: string, projectId: string, projectName: string, storyboardId: string, label: string): void {
  if (!key) return
  const usage = mediaUsageFor(map, key)
  let project = usage.projects.find((item) => item.projectId === projectId)
  if (!project) {
    project = { projectId, projectName, assetIds: [], assetNames: [] }
    usage.projects.push(project)
  }
  if (!project.assetIds.includes(storyboardId)) {
    project.assetIds.push(storyboardId)
    project.assetNames.push(label)
    usage.storyboardCount += 1
  }
  usage.projectCount = usage.projects.length
}

function addMediaLibraryEntityUsage(map: Record<string, MediaAssetUsage>, key: string, entityId: string, entityName: string, role: string): void {
  if (!key) return
  const usage = mediaUsageFor(map, key)
  let entity = usage.libraryEntities.find((item) => item.entityId === entityId)
  if (!entity) {
    entity = { entityId, entityName, roles: [] }
    usage.libraryEntities.push(entity)
  }
  if (role && !entity.roles.includes(role)) entity.roles.push(role)
  usage.libraryEntityCount = usage.libraryEntities.length
}

function addMediaCanvasUsage(map: Record<string, MediaAssetUsage>, key: string, projectId: string, projectName: string, node: CanvasNode): void {
  if (!key) return
  const usage = mediaUsageFor(map, key)
  let project = usage.canvasProjects.find((item) => item.projectId === projectId)
  if (!project) {
    project = { projectId, projectName, nodeIds: [], nodeTitles: [] }
    usage.canvasProjects.push(project)
  }
  const nodeId = node.id ?? ''
  if (nodeId && project.nodeIds.includes(nodeId)) return
  if (nodeId) project.nodeIds.push(nodeId)
  project.nodeTitles.push(node.data?.title ?? node.data?.kind ?? '未命名节点')
  usage.canvasProjectCount = usage.canvasProjects.length
  usage.canvasNodeCount += 1
}

function addMediaSnapshotUsage(map: Record<string, MediaAssetUsage>, key: string, snapshot: CanvasSnapshot, node: CanvasNode): void {
  if (!key) return
  const usage = mediaUsageFor(map, key)
  let item = usage.snapshots.find((entry) => entry.snapshotId === snapshot.id)
  if (!item) {
    item = { snapshotId: snapshot.id ?? '', snapshotName: snapshot.name ?? '未命名快照', projectId: snapshot.projectId, nodeIds: [], nodeTitles: [] }
    usage.snapshots.push(item)
  }
  const nodeId = node.id ?? ''
  if (nodeId && item.nodeIds.includes(nodeId)) return
  if (nodeId) item.nodeIds.push(nodeId)
  item.nodeTitles.push(node.data?.title ?? node.data?.kind ?? '未命名节点')
  usage.snapshotCount = usage.snapshots.length
}

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function entityLookup(elements: ElementRef[]): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const element of elements) {
    lookup.set(`id:${element.id}`, element.id)
    if (element.charId) lookup.set(`char:${normalizeKey(element.charId)}`, element.id)
    lookup.set(`name:${element.kind}:${normalizeKey(element.name)}`, element.id)
  }
  return lookup
}

function entityKindFromNode(kind: string | undefined): ElementKind | undefined {
  if (kind === 'character') return 'character'
  if (kind === 'scene') return 'scene'
  if (kind === 'prop') return 'prop'
  return undefined
}

export function canvasPortIdentityEntityId(port: CanvasPortValue, lookup: Map<string, string> = new Map()): string {
  const libraryEntityId = lineageString(port.meta?.libraryEntityId)
  if (libraryEntityId) return lookup.get(`id:${libraryEntityId}`) ?? libraryEntityId
  const charId = normalizeKey(port.meta?.charId)
  return charId ? lookup.get(`char:${charId}`) ?? lookup.get(`id:${charId}`) ?? '' : ''
}

export function resolveCanvasIdentityEntityUsage(port: CanvasPortValue, lookup: Map<string, string> = new Map()): string {
  const purpose = lineageString(port.meta?.purpose)
  if (purpose && purpose !== 'approved') return ''
  return canvasPortIdentityEntityId(port, lookup)
}

function collectPortValues(value: CanvasPortValue | undefined, out: CanvasPortValue[]): void {
  if (!value) return
  out.push(value)
  for (const item of value.items ?? []) collectPortValues(item, out)
}

function referencedEntityIds(node: CanvasNode, lookup: Map<string, string>): string[] {
  const ids = new Set<string>()
  const params = node.data?.params ?? {}
  const nodeKind = entityKindFromNode(node.data?.kind)
  const name = normalizeKey(params.name ?? node.data?.title)
  if (nodeKind && name) {
    const matched = lookup.get(`name:${nodeKind}:${name}`)
    if (matched) ids.add(matched)
  }
  const ports: CanvasPortValue[] = []
  for (const output of Object.values(node.data?.outputs ?? {})) collectPortValues(output, ports)
  for (const port of ports) {
    const purpose = lineageString(port.meta?.purpose)
    if (purpose && purpose !== 'approved') continue
    const metaEntityId = resolveCanvasIdentityEntityUsage(port, lookup)
    if (metaEntityId) ids.add(metaEntityId)
    const metaName = normalizeKey(port.meta?.name)
    const metaKind = typeof port.meta?.kind === 'string' ? entityKindFromNode(port.meta.kind) : nodeKind
    if (metaName && metaKind) {
      const matched = lookup.get(`name:${metaKind}:${metaName}`)
      if (matched) ids.add(matched)
    }
  }
  return [...ids]
}

async function loadCanvasProjects(): Promise<CanvasProject[]> {
  const index = (await kvGet<Array<{ id: string; name?: string }>>(KEY_CANVAS_INDEX)) ?? []
  const projects: CanvasProject[] = []
  for (const card of index) {
    if (!card?.id) continue
    const project = await kvGet<CanvasProject>(canvasProjectKey(card.id))
    if (project) projects.push({ ...project, id: card.id, name: project.name ?? card.name })
  }
  return projects
}

function addCanvasUsage(map: Record<string, IdentityAssetUsage>, entityId: string, projectId: string, projectName: string, node: CanvasNode): void {
  const usage = usageFor(map, entityId)
  let project = usage.canvasProjects.find((item) => item.projectId === projectId)
  if (!project) {
    project = { projectId, projectName, nodeIds: [], nodeTitles: [] }
    usage.canvasProjects.push(project)
  }
  const nodeId = node.id ?? ''
  if (nodeId && project.nodeIds.includes(nodeId)) return
  if (nodeId) project.nodeIds.push(nodeId)
  project.nodeTitles.push(node.data?.title ?? node.data?.kind ?? '未命名节点')
  usage.canvasProjectCount = usage.canvasProjects.length
  usage.canvasNodeCount += 1
}

function addSnapshotUsage(map: Record<string, IdentityAssetUsage>, entityId: string, snapshot: CanvasSnapshot, node: CanvasNode): void {
  const usage = usageFor(map, entityId)
  let item = usage.snapshots.find((entry) => entry.snapshotId === snapshot.id)
  if (!item) {
    item = { snapshotId: snapshot.id ?? '', snapshotName: snapshot.name ?? '未命名快照', projectId: snapshot.projectId, nodeIds: [], nodeTitles: [] }
    usage.snapshots.push(item)
  }
  const nodeId = node.id ?? ''
  if (nodeId && item.nodeIds.includes(nodeId)) return
  if (nodeId) item.nodeIds.push(nodeId)
  item.nodeTitles.push(node.data?.title ?? node.data?.kind ?? '未命名节点')
  usage.snapshotCount = usage.snapshots.length
}

export async function loadIdentityAssetUsages(elements: ElementRef[]): Promise<Record<string, IdentityAssetUsage>> {
  const usages: Record<string, IdentityAssetUsage> = {}
  const lookup = entityLookup(elements)
  const cards = await loadIndex()
  for (const card of cards) {
    const doc = await loadProject(card.id)
    if (!doc) continue
    for (const asset of doc.assets ?? []) {
      const entityId = projectAssetIdentityEntityId(asset)
      if (!entityId) continue
      addStudioUsage(
        usages,
        entityId,
        doc.meta.id,
        doc.meta.name,
        asset.id,
        asset.name,
        projectAssetIdentityEpisodeLabels(doc, asset.id),
        projectAssetIdentityAppearanceLabels(doc, asset),
      )
    }
  }
  for (const project of await loadCanvasProjects()) {
    const projectId = project.id ?? ''
    const projectName = project.name ?? '未命名画布'
    for (const node of project.nodes ?? []) {
      for (const entityId of referencedEntityIds(node, lookup)) addCanvasUsage(usages, entityId, projectId, projectName, node)
    }
  }
  const snapshots = (await kvGet<CanvasSnapshot[]>(KEY_SNAPSHOTS)) ?? []
  for (const snapshot of snapshots) {
    for (const node of snapshot.nodes ?? []) {
      for (const entityId of referencedEntityIds(node, lookup)) addSnapshotUsage(usages, entityId, snapshot, node)
    }
  }
  return usages
}

function collectEpisodeStoryboards(doc: ProjectDoc, episodesById: Map<string, Episode>, currentEpisode: Episode | undefined): Array<{ storyboard: Storyboard; episode?: Episode }> {
  const sources: Array<{ storyboard: Storyboard; episode?: Episode }> = [
    ...(doc.storyboards ?? []).map((storyboard) => ({
      storyboard,
      episode: currentEpisode ?? (storyboard.episodeId ? episodesById.get(storyboard.episodeId) : undefined),
    })),
    ...(doc.episodes ?? []).flatMap((episode) => (episode.storyboards ?? []).map((storyboard) => ({ storyboard, episode }))),
  ]
  const seen = new Set<string>()
  return sources.filter(({ storyboard }) => {
    if (seen.has(storyboard.id)) return false
    seen.add(storyboard.id)
    return true
  })
}

function collectEpisodeClips(doc: ProjectDoc, currentEpisode: Episode | undefined): Array<{ clip: Clip; episode?: Episode }> {
  const sources: Array<{ clip: Clip; episode?: Episode }> = [
    ...(doc.clips ?? []).map((clip) => ({ clip, episode: currentEpisode })),
    ...(doc.episodes ?? []).flatMap((episode) => (episode.clips ?? []).map((clip) => ({ clip, episode }))),
  ]
  const seen = new Set<string>()
  return sources.filter(({ clip }) => {
    if (seen.has(clip.id)) return false
    seen.add(clip.id)
    return true
  })
}

function collectEpisodeTracks(doc: ProjectDoc, currentEpisode: Episode | undefined): Array<{ track: VideoTrack; episode?: Episode }> {
  const sources: Array<{ track: VideoTrack; episode?: Episode }> = [
    ...(doc.track ?? []).map((track) => ({ track, episode: currentEpisode })),
    ...(doc.episodes ?? []).flatMap((episode) => (episode.track ?? []).map((track) => ({ track, episode }))),
  ]
  const seen = new Set<string>()
  return sources.filter(({ track }) => {
    if (seen.has(track.id)) return false
    seen.add(track.id)
    return true
  })
}

export async function loadMediaAssetUsages(entities: LibraryEntity[]): Promise<Record<string, MediaAssetUsage>> {
  const usages: Record<string, MediaAssetUsage> = {}
  const cards = await loadIndex()
  const projectDocs = new Map<string, ProjectDoc>()
  for (const card of cards) {
    const doc = await loadProject(card.id)
    if (!doc) continue
    const episodesById = new Map((doc.episodes ?? []).map((episode) => [episode.id, episode]))
    const currentEpisode = doc.currentEpisodeId ? episodesById.get(doc.currentEpisodeId) : undefined
    projectDocs.set(card.id, doc)
    projectDocs.set(doc.meta.id, doc)
    for (const asset of doc.assets ?? []) {
      addMediaProjectAssetUsage(usages, mediaKey({ assetId: asset.refImageId }), doc.meta.id, doc.meta.name, asset.id, asset.name)
      for (const image of asset.images ?? []) addMediaProjectAssetUsage(usages, mediaKey({ assetId: image.refImageId }), doc.meta.id, doc.meta.name, asset.id, asset.name)
      for (const variant of asset.variants ?? []) addMediaProjectAssetUsage(usages, mediaKey({ assetId: variant.refImageId }), doc.meta.id, doc.meta.name, asset.id, projectVariantMediaUsageLabel(asset.name, variant, episodesById))
      addMediaProjectAssetUsage(usages, mediaKey({ localPath: asset.audioFilePath, url: asset.audioUrl }), doc.meta.id, doc.meta.name, asset.id, asset.name)
    }
    const storyboards = collectEpisodeStoryboards(doc, episodesById, currentEpisode)
    for (const { storyboard, episode } of storyboards) {
      addMediaStoryboardUsage(usages, mediaKey({ assetId: storyboard.keyframeImageId }), doc.meta.id, doc.meta.name, storyboard.id, projectEpisodeUsageLabel(`分镜 #${storyboard.index + 1}`, episode))
    }
    const clips = collectEpisodeClips(doc, currentEpisode)
    for (const { clip, episode } of clips) {
      addMediaStoryboardUsage(usages, mediaKey({ localPath: clip.videoFilePath, url: clip.videoUrl }), doc.meta.id, doc.meta.name, clip.id, projectEpisodeUsageLabel(`视频片段 ${clip.id}`, episode))
      addMediaStoryboardUsage(usages, mediaKey({ assetId: clip.posterImageId }), doc.meta.id, doc.meta.name, clip.id, projectEpisodeUsageLabel(`视频片段 ${clip.id} 首帧`, episode))
    }
    const tracks = collectEpisodeTracks(doc, currentEpisode)
    for (const { track, episode } of tracks) {
      addMediaStoryboardUsage(usages, mediaKey({ assetId: track.audioClipId }), doc.meta.id, doc.meta.name, track.id, projectEpisodeUsageLabel(`轨道音频 ${track.id}`, episode))
    }
    for (const [flowId, flow] of Object.entries(doc.imageFlows ?? {})) {
      const outputLabel = projectImageFlowMediaUsageLabel(doc, flowId)
      const referenceLabel = projectImageFlowMediaUsageLabel(doc, flowId, 'reference')
      for (const node of flow?.nodes ?? []) {
        addMediaStoryboardUsage(usages, mediaKey({ assetId: node.assetId }), doc.meta.id, doc.meta.name, node.id, outputLabel)
        for (const referenceId of node.references ?? []) addMediaStoryboardUsage(usages, mediaKey({ assetId: referenceId }), doc.meta.id, doc.meta.name, node.id, referenceLabel)
      }
    }
  }

  for (const entity of entities) {
    for (const ref of entity.mediaRefs ?? []) addMediaLibraryEntityUsage(usages, mediaKey(ref), entity.id, entity.name, ref.label ?? ref.role)
    for (const variant of entity.variants ?? []) {
      for (const ref of variant.mediaRefs ?? []) addMediaLibraryEntityUsage(usages, mediaKey(ref), entity.id, entity.name, `${variant.label}/${ref.label ?? ref.role}`)
    }
    if (entity.voiceRef) addMediaLibraryEntityUsage(usages, mediaKey(entity.voiceRef), entity.id, entity.name, entity.voiceRef.label ?? entity.voiceRef.role)
  }

  for (const project of await loadCanvasProjects()) {
    const projectId = project.id ?? ''
    const projectName = project.name ?? '未命名画布'
    for (const node of project.nodes ?? []) {
      const ports: CanvasPortValue[] = []
      for (const output of Object.values(node.data?.outputs ?? {})) collectPortValues(output, ports)
      for (const port of ports) {
        const key = mediaKey(port)
        addMediaCanvasUsage(usages, key, projectId, projectName, node)
        const projectUsage = resolveCanvasProjectAssetMediaUsage(port, projectDocs.get(canvasLineageProjectId(port)))
        if (projectUsage) {
          addMediaProjectAssetUsage(usages, key, projectUsage.projectId, projectUsage.projectName, projectUsage.assetId, projectUsage.assetName)
        }
      }
    }
  }
  const snapshots = (await kvGet<CanvasSnapshot[]>(KEY_SNAPSHOTS)) ?? []
  for (const snapshot of snapshots) {
    for (const node of snapshot.nodes ?? []) {
      const ports: CanvasPortValue[] = []
      for (const output of Object.values(node.data?.outputs ?? {})) collectPortValues(output, ports)
      for (const port of ports) {
        const key = mediaKey(port)
        addMediaSnapshotUsage(usages, key, snapshot, node)
        const projectUsage = resolveCanvasProjectAssetMediaUsage(port, projectDocs.get(canvasLineageProjectId(port)))
        if (projectUsage) {
          addMediaProjectAssetUsage(usages, key, projectUsage.projectId, projectUsage.projectName, projectUsage.assetId, projectUsage.assetName)
        }
      }
    }
  }
  return usages
}

export async function loadAssetHub(): Promise<AssetHubSnapshot> {
  const [mediaAssets, boards, usage, elements] = await Promise.all([
    loadRegistry(),
    loadBoards(),
    storageUsage(),
    kvGet<ElementRef[]>(KEY_ELEMENTS),
  ])
  const normalizedElements = Array.isArray(elements) ? elements : []
  const entities = normalizedElements.map(elementToLibraryEntity)
  const usageByEntity = await loadIdentityAssetUsages(normalizedElements)
  const usageByMedia = await loadMediaAssetUsages(entities)
  return { mediaAssets, boards, storageUsage: usage, elements: normalizedElements, entities, usageByEntity, usageByMedia }
}
