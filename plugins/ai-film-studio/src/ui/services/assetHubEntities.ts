/**
 * 资产中心 V2 · 身份实体正式持久层（P6）。
 * - 主存储：`assetHub:entities:v2`（LibraryEntity[]）
 * - 兼容层：继续双写 `elements:library`（ElementRef[]）
 * 本文件不依赖 assetHub 转换函数，避免循环引用；迁移编排在 assetHub.loadAssetHub / assetStore。
 */
import type { ElementRef } from '../store/assetStore'
import type { LibraryEntity } from './assetHub'

const PLUGIN_ID = 'ai-film-studio'
export const KEY_ENTITIES_V2 = 'assetHub:entities:v2'
export const KEY_ELEMENTS_LIBRARY = 'elements:library'

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

/** 落盘前去掉运行时兼容字段，避免把 Element 快照嵌进 V2。 */
export function persistableLibraryEntity(entity: LibraryEntity): LibraryEntity {
  const { legacyElement: _legacy, ...rest } = entity
  return {
    ...rest,
    aliases: rest.aliases?.length ? [...rest.aliases] : undefined,
    tags: rest.tags?.length ? [...rest.tags] : undefined,
    mediaRefs: rest.mediaRefs?.length ? rest.mediaRefs.map((ref) => ({ ...ref })) : undefined,
    variants: rest.variants?.length
      ? rest.variants.map((variant) => ({
          ...variant,
          mediaRefs: variant.mediaRefs?.length ? variant.mediaRefs.map((ref) => ({ ...ref })) : undefined,
          tags: variant.tags?.length ? [...variant.tags] : undefined,
        }))
      : undefined,
    voiceRef: rest.voiceRef ? { ...rest.voiceRef } : undefined,
    lora: rest.lora ? { ...rest.lora } : undefined,
  }
}

export function normalizeLibraryEntity(raw: unknown): LibraryEntity | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Partial<LibraryEntity>
  if (typeof item.id !== 'string' || !item.id.trim()) return null
  if (typeof item.name !== 'string' || !item.name.trim()) return null
  const kind = item.kind === 'scene' || item.kind === 'prop' || item.kind === 'voice' ? item.kind : 'character'
  const createdAt = typeof item.createdAt === 'number' ? item.createdAt : Date.now()
  const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : createdAt
  return persistableLibraryEntity({
    id: item.id.trim(),
    kind,
    name: item.name.trim(),
    aliases: Array.isArray(item.aliases) ? item.aliases.filter((alias): alias is string => typeof alias === 'string') : undefined,
    identity: typeof item.identity === 'string' ? item.identity : undefined,
    description: typeof item.description === 'string' ? item.description : undefined,
    prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    mediaRefs: Array.isArray(item.mediaRefs) ? (item.mediaRefs as LibraryEntity['mediaRefs']) : undefined,
    variants: Array.isArray(item.variants) ? (item.variants as LibraryEntity['variants']) : undefined,
    voiceRef: item.voiceRef && typeof item.voiceRef === 'object' ? item.voiceRef : undefined,
    lora: item.lora && typeof item.lora === 'object' ? item.lora : undefined,
    version: typeof item.version === 'number' && item.version > 0 ? item.version : 1,
    archived: !!item.archived,
    createdAt,
    updatedAt,
  })
}

export function mergeEntitiesPreferV2(v2: LibraryEntity[], fromElements: LibraryEntity[]): LibraryEntity[] {
  if (v2.length) return v2.map(persistableLibraryEntity)
  return fromElements.map(persistableLibraryEntity)
}

export async function readEntitiesV2Raw(): Promise<LibraryEntity[]> {
  const raw = await kvGet<unknown[]>(KEY_ENTITIES_V2)
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeLibraryEntity).filter((item): item is LibraryEntity => !!item)
}

export async function readElementsLibraryRaw(): Promise<ElementRef[]> {
  const raw = await kvGet<ElementRef[]>(KEY_ELEMENTS_LIBRARY)
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is ElementRef => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string')
}

/** 以 LibraryEntity 为权威写入，并双写兼容 Element 库。 */
export async function saveLibraryEntities(entities: LibraryEntity[], elements: ElementRef[]): Promise<void> {
  const next = entities.map(persistableLibraryEntity)
  await Promise.all([kvSet(KEY_ENTITIES_V2, next), kvSet(KEY_ELEMENTS_LIBRARY, elements)])
}
