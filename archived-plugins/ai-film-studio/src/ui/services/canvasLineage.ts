export interface CanvasLineageMeta {
  mediaAssetId?: string
  libraryEntityId?: string
  libraryVariantId?: string
  projectId?: string
  projectAssetId?: string
  projectVariantId?: string
  view?: string
  purpose?: 'experiment' | 'candidate' | 'approved'
  variantId?: string
  variantLabel?: string
  [key: string]: unknown
}

export interface CanvasLineagePortValue {
  type?: unknown
  assetId?: string
  items?: CanvasLineagePortValue[]
  meta?: CanvasLineageMeta & Record<string, unknown>
}

export interface ProjectAssetLineageTarget {
  projectId?: string
  projectAssetId: string
  projectVariantId?: string
  libraryEntityId?: string
  libraryVariantId?: string
}

export interface LibraryEntityLineageTarget {
  libraryEntityId: string
  libraryVariantId?: string
  variantLabel?: string
  view?: string
}

function projectAssetMeta(item: CanvasLineagePortValue, target: ProjectAssetLineageTarget): CanvasLineageMeta {
  const {
    libraryEntityId: _libraryEntityId,
    libraryVariantId: _libraryVariantId,
    projectAssetId: _projectAssetId,
    projectVariantId: _projectVariantId,
    variantId: _variantId,
    variantLabel: _variantLabel,
    ...base
  } = item.meta ?? {}
  const existingProjectId = typeof base.projectId === 'string' ? base.projectId : undefined
  const projectId = target.projectId ?? existingProjectId
  return {
    ...base,
    mediaAssetId: typeof base.mediaAssetId === 'string' ? base.mediaAssetId : item.assetId,
    ...(projectId ? { projectId } : {}),
    projectAssetId: target.projectAssetId,
    ...(target.projectVariantId ? { projectVariantId: target.projectVariantId } : {}),
    ...(target.libraryEntityId ? { libraryEntityId: target.libraryEntityId } : {}),
    ...(target.libraryVariantId ? { libraryVariantId: target.libraryVariantId, variantId: target.libraryVariantId } : {}),
    purpose: 'approved',
  }
}

function libraryEntityMeta(item: CanvasLineagePortValue, target: LibraryEntityLineageTarget): CanvasLineageMeta {
  const {
    projectId: _projectId,
    projectAssetId: _projectAssetId,
    projectVariantId: _projectVariantId,
    variantId: _variantId,
    variantLabel: _variantLabel,
    ...base
  } = item.meta ?? {}
  return {
    ...base,
    mediaAssetId: typeof base.mediaAssetId === 'string' ? base.mediaAssetId : item.assetId,
    libraryEntityId: target.libraryEntityId,
    ...(target.libraryVariantId ? { libraryVariantId: target.libraryVariantId, variantId: target.libraryVariantId } : {}),
    ...(target.libraryVariantId && target.variantLabel ? { variantLabel: target.variantLabel } : {}),
    ...(target.view ? { view: target.view } : {}),
    purpose: 'approved',
  }
}

function updatePortItem<T extends CanvasLineagePortValue>(
  value: T,
  assetId: string,
  itemIndex: number | undefined,
  metaFor: (item: CanvasLineagePortValue) => CanvasLineageMeta,
): { value: T; changed: boolean } {
  if (value.items?.length) {
    const idx = typeof itemIndex === 'number' ? itemIndex : value.items.findIndex((item) => item.assetId === assetId)
    const item = value.items[idx]
    if (!item || item.assetId !== assetId) return { value, changed: false }
    const nextItem = { ...item, meta: metaFor(item) }
    const items = value.items.map((entry, index) => (index === idx ? nextItem : entry))
    return {
      value: (idx === 0 ? { ...value, items, meta: nextItem.meta } : { ...value, items }) as T,
      changed: true,
    }
  }
  if (value.assetId !== assetId) return { value, changed: false }
  return { value: { ...value, meta: metaFor(value) } as T, changed: true }
}

export function markCanvasPortValueAsProjectAsset<T extends CanvasLineagePortValue>(
  value: T,
  assetId: string,
  target: ProjectAssetLineageTarget,
  itemIndex?: number,
): { value: T; changed: boolean } {
  return updatePortItem(value, assetId, itemIndex, (item) => projectAssetMeta(item, target))
}

export function markCanvasPortValueAsLibraryEntity<T extends CanvasLineagePortValue>(
  value: T,
  assetId: string,
  target: LibraryEntityLineageTarget,
  itemIndex?: number,
): { value: T; changed: boolean } {
  return updatePortItem(value, assetId, itemIndex, (item) => libraryEntityMeta(item, target))
}
