import type { Asset, AssetImage, AssetVariant } from '../domain/types'
import { loadIndex, loadProject, newId } from '../domain/persistence'
import type { ElementKind, ElementRef, ElementVariant } from '../store/assetStore'
import { loadBoards, loadRegistry, type AssetRecord, type Board } from './assetRegistry'

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

export interface AssetHubSnapshot {
  mediaAssets: AssetRecord[]
  boards: Board[]
  elements: ElementRef[]
  entities: LibraryEntity[]
  usageByEntity: Record<string, IdentityAssetUsage>
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
    mediaRefFromAssetId(variant.views?.front, 'front', 'front'),
    mediaRefFromAssetId(variant.views?.side, 'side', 'side'),
    mediaRefFromAssetId(variant.views?.back, 'back', 'back'),
    ...(variant.refAssetIds ?? []).map((assetId, index) => mediaRefFromAssetId(assetId, index === 0 ? 'primary' : 'reference')),
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
    mediaRefFromAssetId(element.views?.front, 'front', 'front'),
    mediaRefFromAssetId(element.views?.side, 'side', 'side'),
    mediaRefFromAssetId(element.views?.back, 'back', 'back'),
    ...(element.refAssetIds ?? []).map((assetId, index) => mediaRefFromAssetId(assetId, index === 0 ? 'primary' : 'reference')),
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
    lora: element.lora,
    version: element.version ?? 1,
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
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    identity: entity.identity,
    views: front || side || back ? { front, side, back } : undefined,
    voiceId: entity.legacyElement?.voiceId ?? entity.voiceRef?.assetId,
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
    state: media.refImageId ? 'done' : 'idle',
  }
  if (entity.kind === 'voice') {
    const voice = entity.voiceRef ?? primaryRef(entity.mediaRefs, ['audio', 'primary'])
    asset.audioFilePath = voice?.localPath
    asset.audioUrl = voice?.url
    asset.state = voice?.localPath || voice?.url ? 'done' : asset.state
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
    voiceRef: asset.type === 'audio' ? { role: 'audio', localPath: asset.audioFilePath, url: asset.audioUrl, createdAt: ts } : existing?.voiceRef,
    lora: existing?.lora,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? ts,
    updatedAt: ts,
    legacyElement: existing?.legacyElement,
  }
}

interface CanvasPortValue {
  assetId?: string
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

function emptyUsage(entityId: string): IdentityAssetUsage {
  return { entityId, projectCount: 0, assetCount: 0, canvasProjectCount: 0, canvasNodeCount: 0, snapshotCount: 0, projects: [], canvasProjects: [], snapshots: [] }
}

function usageFor(map: Record<string, IdentityAssetUsage>, entityId: string): IdentityAssetUsage {
  map[entityId] ??= emptyUsage(entityId)
  return map[entityId]
}

function addStudioUsage(map: Record<string, IdentityAssetUsage>, entityId: string, projectId: string, projectName: string, assetId: string, assetName: string): void {
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
  usage.projectCount = usage.projects.length
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
    const charId = normalizeKey(port.meta?.charId)
    if (charId) {
      const matched = lookup.get(`char:${charId}`) ?? lookup.get(`id:${charId}`)
      if (matched) ids.add(matched)
    }
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
      if (!asset.elementId) continue
      addStudioUsage(usages, asset.elementId, doc.meta.id, doc.meta.name, asset.id, asset.name)
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

export async function loadAssetHub(): Promise<AssetHubSnapshot> {
  const [mediaAssets, boards, elements] = await Promise.all([
    loadRegistry(),
    loadBoards(),
    kvGet<ElementRef[]>(KEY_ELEMENTS),
  ])
  const normalizedElements = Array.isArray(elements) ? elements : []
  const entities = normalizedElements.map(elementToLibraryEntity)
  const usageByEntity = await loadIdentityAssetUsages(normalizedElements)
  return { mediaAssets, boards, elements: normalizedElements, entities, usageByEntity }
}
