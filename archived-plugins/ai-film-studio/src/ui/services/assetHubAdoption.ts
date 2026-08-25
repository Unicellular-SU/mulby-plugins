/**
 * 资产中心 V2 · 画布/工作流采纳记录（P3）。
 * 独立 KV 索引，不参与 GC / usage 引用计数；只解释“某张图为何进入项目或身份库”。
 */
import { newId } from '../domain/persistence'

const PLUGIN_ID = 'ai-film-studio'
export const KEY_ADOPTIONS = 'assetHub:adoptions'

export type AssetHubAdoptionPurpose = 'candidate' | 'experiment' | 'approved'
export type AssetHubAdoptionAction = 'save' | 'overwrite' | 'link-only'
export type AssetHubAdoptionState = 'applied' | 'rejected' | 'superseded'

export type AssetHubAdoptionTarget =
  | {
      kind: 'projectAsset'
      projectId: string
      assetId: string
      variantId?: string
      libraryEntityId?: string
      libraryVariantId?: string
    }
  | {
      kind: 'libraryEntity'
      entityId: string
      libraryVariantId?: string
      view?: string
    }

export interface AssetHubAdoptionRecord {
  id: string
  sourceSurface: 'canvas' | 'studio'
  sourceProjectId?: string
  sourceProjectName?: string
  sourceNodeId?: string
  sourceNodeTitle?: string
  sourcePort?: string
  sourceItemIndex?: number
  mediaAssetId?: string
  localPath?: string
  url?: string
  prompt?: string
  model?: string
  purposeBefore?: AssetHubAdoptionPurpose
  target: AssetHubAdoptionTarget
  action: AssetHubAdoptionAction
  state: AssetHubAdoptionState
  createdAt: number
  appliedAt?: number
}

export type AssetHubAdoptionInput = Omit<AssetHubAdoptionRecord, 'id' | 'createdAt' | 'appliedAt' | 'state'> & {
  id?: string
  state?: AssetHubAdoptionState
  createdAt?: number
  appliedAt?: number
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

function normalizePurpose(value: unknown): AssetHubAdoptionPurpose | undefined {
  if (value === 'candidate' || value === 'experiment' || value === 'approved') return value
  return undefined
}

function isProjectTarget(target: AssetHubAdoptionTarget): target is Extract<AssetHubAdoptionTarget, { kind: 'projectAsset' }> {
  return target.kind === 'projectAsset'
}

function isLibraryTarget(target: AssetHubAdoptionTarget): target is Extract<AssetHubAdoptionTarget, { kind: 'libraryEntity' }> {
  return target.kind === 'libraryEntity'
}

/** 纯函数：规范化一条采纳记录，补齐 id / 时间 / 默认 state。 */
export function normalizeAdoptionRecord(input: AssetHubAdoptionInput, now = Date.now()): AssetHubAdoptionRecord {
  const state = input.state ?? 'applied'
  return {
    id: input.id?.trim() || newId('adopt_'),
    sourceSurface: input.sourceSurface,
    sourceProjectId: input.sourceProjectId?.trim() || undefined,
    sourceProjectName: input.sourceProjectName?.trim() || undefined,
    sourceNodeId: input.sourceNodeId?.trim() || undefined,
    sourceNodeTitle: input.sourceNodeTitle?.trim() || undefined,
    sourcePort: input.sourcePort?.trim() || undefined,
    sourceItemIndex: typeof input.sourceItemIndex === 'number' && Number.isFinite(input.sourceItemIndex) ? input.sourceItemIndex : undefined,
    mediaAssetId: input.mediaAssetId?.trim() || undefined,
    localPath: input.localPath?.trim() || undefined,
    url: input.url?.trim() || undefined,
    prompt: input.prompt?.trim() || undefined,
    model: input.model?.trim() || undefined,
    purposeBefore: normalizePurpose(input.purposeBefore),
    target: input.target,
    action: input.action,
    state,
    createdAt: input.createdAt ?? now,
    appliedAt: input.appliedAt ?? (state === 'applied' ? now : undefined),
  }
}

/** 当同一媒体再次被采纳到同一目标时，把旧 applied 记录标为 superseded。 */
export function supersedeMatchingAdoptions(records: AssetHubAdoptionRecord[], next: AssetHubAdoptionRecord): AssetHubAdoptionRecord[] {
  return records.map((record) => {
    if (record.id === next.id || record.state !== 'applied') return record
    if (!sameAdoptionTarget(record.target, next.target)) return record
    if ((record.mediaAssetId || '') !== (next.mediaAssetId || '')) return record
    return { ...record, state: 'superseded' as const }
  })
}

export function sameAdoptionTarget(a: AssetHubAdoptionTarget, b: AssetHubAdoptionTarget): boolean {
  if (a.kind !== b.kind) return false
  if (isProjectTarget(a) && isProjectTarget(b)) {
    return a.projectId === b.projectId && a.assetId === b.assetId && (a.variantId || '') === (b.variantId || '')
  }
  if (isLibraryTarget(a) && isLibraryTarget(b)) {
    return a.entityId === b.entityId && (a.libraryVariantId || '') === (b.libraryVariantId || '') && (a.view || '') === (b.view || '')
  }
  return false
}

export function adoptionTargetLabel(target: AssetHubAdoptionTarget): string {
  if (isProjectTarget(target)) {
    return target.variantId ? `项目资产 ${target.assetId} / 形态 ${target.variantId}` : `项目资产 ${target.assetId}`
  }
  const view = target.view ? ` · ${target.view}` : ''
  return target.libraryVariantId ? `身份资产 ${target.entityId} / 形态 ${target.libraryVariantId}${view}` : `身份资产 ${target.entityId}${view}`
}

export function listAdoptionsByMedia(records: AssetHubAdoptionRecord[], mediaAssetId: string): AssetHubAdoptionRecord[] {
  const key = mediaAssetId.trim()
  if (!key) return []
  return records.filter((record) => record.mediaAssetId === key).sort((a, b) => b.createdAt - a.createdAt)
}

export function filterAdoptions(
  records: AssetHubAdoptionRecord[],
  filter: 'all' | 'applied' | 'superseded' | 'rejected' | 'candidate' = 'all',
): AssetHubAdoptionRecord[] {
  const sorted = [...records].sort((a, b) => b.createdAt - a.createdAt)
  if (filter === 'all') return sorted
  if (filter === 'candidate') return sorted.filter((record) => record.purposeBefore === 'candidate' || record.purposeBefore === 'experiment')
  return sorted.filter((record) => record.state === filter)
}

export async function loadAdoptions(): Promise<AssetHubAdoptionRecord[]> {
  const raw = await kvGet<AssetHubAdoptionRecord[]>(KEY_ADOPTIONS)
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is AssetHubAdoptionRecord => !!item && typeof item === 'object' && typeof item.id === 'string' && !!item.target)
    .map((item) => normalizeAdoptionRecord(item, item.createdAt))
}

export async function appendAdoptionRecord(input: AssetHubAdoptionInput): Promise<AssetHubAdoptionRecord> {
  const next = normalizeAdoptionRecord(input)
  const existing = await loadAdoptions()
  const updated = supersedeMatchingAdoptions(existing, next)
  await kvSet(KEY_ADOPTIONS, [next, ...updated.filter((record) => record.id !== next.id)])
  return next
}

export function purposeBeforeFromMeta(meta: Record<string, unknown> | undefined): AssetHubAdoptionPurpose | undefined {
  return normalizePurpose(meta?.purpose)
}
