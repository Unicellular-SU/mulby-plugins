/**
 * 资产中心 V2 · 身份库集合（P5）。
 * 用独立 KV 隔离同名角色/场景/道具，不改 ProjectDoc 持久化结构。
 */
import { newId } from '../domain/persistence'

const PLUGIN_ID = 'ai-film-studio'
export const KEY_COLLECTIONS = 'assetHub:collections'
export const KEY_PROJECT_COLLECTION_SETTINGS = 'assetHub:projectCollections'

export type AssetHubCollectionKind = 'series' | 'client' | 'style' | 'personal' | 'archive'

export interface AssetHubCollection {
  id: string
  name: string
  kind: AssetHubCollectionKind
  entityIds: string[]
  mediaBoardIds?: string[]
  createdAt: number
  updatedAt: number
}

/** 项目默认集合偏好（不写入 ProjectDoc，独立 KV）。 */
export interface ProjectAssetHubSettings {
  collectionIds?: string[]
  importPolicy?: 'snapshot'
  syncPolicy?: 'manual'
}

export type AssetHubCollectionInput = Partial<Omit<AssetHubCollection, 'id' | 'createdAt' | 'updatedAt'>> & {
  id?: string
  name: string
  kind?: AssetHubCollectionKind
  entityIds?: string[]
}

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const v = await window.mulby?.storage?.get(key, PLUGIN_ID)
    return (v as T) ?? null
  } catch {
    return null
  }
}

async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await window.mulby?.storage?.set(key, value, PLUGIN_ID)
  } catch {
    // 浏览器调试态无 storage
  }
}

export const COLLECTION_KIND_LABELS: Record<AssetHubCollectionKind, string> = {
  series: '系列',
  client: '客户',
  style: '风格',
  personal: '个人',
  archive: '归档包',
}

export function normalizeCollection(input: AssetHubCollectionInput, now = Date.now()): AssetHubCollection {
  const entityIds = [...new Set((input.entityIds ?? []).map((id) => id.trim()).filter(Boolean))]
  const mediaBoardIds = [...new Set((input.mediaBoardIds ?? []).map((id) => id.trim()).filter(Boolean))]
  return {
    id: input.id?.trim() || newId('col_'),
    name: input.name.trim() || '未命名集合',
    kind: input.kind ?? 'series',
    entityIds,
    mediaBoardIds: mediaBoardIds.length ? mediaBoardIds : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

export function collectionContainsEntity(collection: AssetHubCollection, entityId: string): boolean {
  return collection.entityIds.includes(entityId)
}

export function addEntityToCollection(collection: AssetHubCollection, entityId: string, now = Date.now()): AssetHubCollection {
  const id = entityId.trim()
  if (!id || collection.entityIds.includes(id)) return collection
  return { ...collection, entityIds: [...collection.entityIds, id], updatedAt: now }
}

export function removeEntityFromCollection(collection: AssetHubCollection, entityId: string, now = Date.now()): AssetHubCollection {
  const next = collection.entityIds.filter((id) => id !== entityId)
  if (next.length === collection.entityIds.length) return collection
  return { ...collection, entityIds: next, updatedAt: now }
}

/** 导入/搜索时优先返回项目默认集合内的身份，再回退到其余未归档身份。 */
export function prioritizeEntitiesByCollections<T extends { id: string; archived?: boolean }>(
  entities: T[],
  collections: AssetHubCollection[],
  preferredCollectionIds: string[] | undefined,
): T[] {
  const preferred = new Set(
    (preferredCollectionIds ?? [])
      .flatMap((collectionId) => collections.find((collection) => collection.id === collectionId)?.entityIds ?? []),
  )
  const active = entities.filter((entity) => !entity.archived)
  if (!preferred.size) return active
  const inPreferred = active.filter((entity) => preferred.has(entity.id))
  const others = active.filter((entity) => !preferred.has(entity.id))
  return [...inPreferred, ...others]
}

export function filterEntitiesByCollection<T extends { id: string }>(
  entities: T[],
  collections: AssetHubCollection[],
  collectionId: string | 'all',
): T[] {
  if (collectionId === 'all') return entities
  const collection = collections.find((item) => item.id === collectionId)
  if (!collection) return []
  const ids = new Set(collection.entityIds)
  return entities.filter((entity) => ids.has(entity.id))
}

export async function loadCollections(): Promise<AssetHubCollection[]> {
  const raw = await kvGet<AssetHubCollection[]>(KEY_COLLECTIONS)
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is AssetHubCollection => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string')
    .map((item) => ({
      ...normalizeCollection(item, item.createdAt),
      createdAt: item.createdAt || Date.now(),
      updatedAt: item.updatedAt || item.createdAt || Date.now(),
    }))
}

export async function saveCollections(collections: AssetHubCollection[]): Promise<void> {
  await kvSet(KEY_COLLECTIONS, collections)
}

export async function upsertCollection(input: AssetHubCollectionInput): Promise<AssetHubCollection> {
  const collections = await loadCollections()
  const now = Date.now()
  const existingIndex = input.id ? collections.findIndex((item) => item.id === input.id) : -1
  if (existingIndex >= 0) {
    const current = collections[existingIndex]
    const next = {
      ...current,
      name: input.name.trim() || current.name,
      kind: input.kind ?? current.kind,
      entityIds: input.entityIds ? [...new Set(input.entityIds.map((id) => id.trim()).filter(Boolean))] : current.entityIds,
      mediaBoardIds: input.mediaBoardIds
        ? [...new Set(input.mediaBoardIds.map((id) => id.trim()).filter(Boolean))]
        : current.mediaBoardIds,
      updatedAt: now,
    }
    collections[existingIndex] = next
    await saveCollections(collections)
    return next
  }
  const created = normalizeCollection(input, now)
  await saveCollections([created, ...collections])
  return created
}

export async function deleteCollection(collectionId: string): Promise<boolean> {
  const collections = await loadCollections()
  const next = collections.filter((item) => item.id !== collectionId)
  if (next.length === collections.length) return false
  await saveCollections(next)
  const settings = await loadAllProjectCollectionSettings()
  let changed = false
  for (const [projectId, value] of Object.entries(settings)) {
    const filtered = (value.collectionIds ?? []).filter((id) => id !== collectionId)
    if (filtered.length !== (value.collectionIds ?? []).length) {
      settings[projectId] = { ...value, collectionIds: filtered.length ? filtered : undefined }
      changed = true
    }
  }
  if (changed) await kvSet(KEY_PROJECT_COLLECTION_SETTINGS, settings)
  return true
}

export async function loadAllProjectCollectionSettings(): Promise<Record<string, ProjectAssetHubSettings>> {
  const raw = await kvGet<Record<string, ProjectAssetHubSettings>>(KEY_PROJECT_COLLECTION_SETTINGS)
  return raw && typeof raw === 'object' ? raw : {}
}

export async function loadProjectCollectionSettings(projectId: string): Promise<ProjectAssetHubSettings> {
  if (!projectId) return {}
  const all = await loadAllProjectCollectionSettings()
  return all[projectId] ?? {}
}

export async function saveProjectCollectionSettings(projectId: string, settings: ProjectAssetHubSettings): Promise<void> {
  if (!projectId) return
  const all = await loadAllProjectCollectionSettings()
  all[projectId] = {
    collectionIds: settings.collectionIds?.length ? [...new Set(settings.collectionIds)] : undefined,
    importPolicy: settings.importPolicy ?? 'snapshot',
    syncPolicy: settings.syncPolicy ?? 'manual',
  }
  await kvSet(KEY_PROJECT_COLLECTION_SETTINGS, all)
}

/** 画布/编辑器保存身份后，把实体写入当前项目的默认集合（若已配置）。 */
export async function addEntityToProjectDefaultCollections(projectId: string | undefined, entityId: string): Promise<string[]> {
  const id = entityId.trim()
  if (!projectId || !id) return []
  const settings = await loadProjectCollectionSettings(projectId)
  const preferredIds = settings.collectionIds ?? []
  if (!preferredIds.length) return []
  const collections = await loadCollections()
  const touched: string[] = []
  let changed = false
  const next = collections.map((collection) => {
    if (!preferredIds.includes(collection.id) || collection.entityIds.includes(id)) return collection
    changed = true
    touched.push(collection.id)
    return addEntityToCollection(collection, id)
  })
  if (changed) await saveCollections(next)
  return touched
}
