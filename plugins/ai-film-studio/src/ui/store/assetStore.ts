/**
 * 素材库 + 角色/场景 Elements 库（全局，跨工程复用）。
 * - 素材：多模态（图片/视频/音频），由 assetRegistry 提供索引、上传、GC。
 * - Elements：角色/场景定义一次、跨工程复用（LTX Elements 式），存 `elements:library`。
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import { releaseAsset } from '../services/assets'
import {
  loadRegistry,
  loadBoards,
  backfillAll,
  importAssetFile,
  removeAssetRecord,
  gcOrphans,
  storageUsage,
  createBoard as svcCreateBoard,
  renameBoard as svcRenameBoard,
  deleteBoard as svcDeleteBoard,
  setAssetBoard as svcSetAssetBoard,
  type AssetRecord,
  type Board,
} from '../services/assetRegistry'

const PLUGIN_ID = 'ai-film-studio'
const KEY_ELEMENTS = 'elements:library'

export type ElementKind = 'character' | 'scene' | 'prop'

/** M27：时期/形态变体（角色少年/暮年、场景时段、物品状态）。views 存各角度 assetId。 */
export interface ElementVariant {
  id: string
  label: string
  kind?: 'age' | 'outfit' | 'makeup' | 'injury' | 'state' | 'time' | 'weather' | 'custom'
  stageKey?: string
  appliesTo?: string[]
  appearance?: string
  prompt?: string
  parentVariantId?: string
  views?: { front?: string; side?: string; back?: string }
  refAssetIds?: string[]
  tags?: string[]
  voiceId?: string
}

export interface ElementRef {
  id: string
  kind: ElementKind
  name: string
  aliases?: string[]
  description?: string
  prompt?: string
  /** 参考图：附件库 assetId（直接绑定到画布节点的 image 输出） */
  refAssetIds: string[]
  tags?: string[]
  version?: number
  archived?: boolean
  createdAt: number
  updatedAt: number
  // —— P1-5 身份资产（全部可选，向后兼容；charId 缺省=id，复用同一主键命名空间） ——
  charId?: string
  /** 多角度视图：存 assetId（非 url/base64），缺省回退 refAssetIds */
  views?: { front?: string; side?: string; back?: string }
  voiceId?: string
  variants?: { id: string; label: string; assetId: string; tags?: string[] }[]
  lora?: { provider?: string; ref: string; weight?: number }
  // —— M27（新增独立字段，不复用上面扁平 variants，避免破坏旧持久化记录） ——
  identity?: string // 跨期不变身份（age-neutral）
  appearanceVariants?: ElementVariant[] // 时期/形态变体（富结构）
}

export type CanvasOutputViewRole = 'primary' | 'front' | 'side' | 'back' | 'concept' | 'reference'
export interface CanvasOutputPromotionItem {
  assetId?: string
  meta?: Record<string, unknown>
}
export interface CanvasOutputPromotionTarget {
  kind: 'libraryEntity'
  entityId: string
  libraryVariantId?: string
  variantLabel?: string
  view: CanvasOutputViewRole
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
    // 忽略
  }
}

const isElementViewRole = (view: CanvasOutputViewRole): view is 'front' | 'side' | 'back' =>
  view === 'front' || view === 'side' || view === 'back'

function prependUnique(ids: string[] | undefined, assetId: string): string[] {
  return [assetId, ...(ids ?? []).filter((id) => id && id !== assetId)]
}

function applyCanvasOutputToElement(el: ElementRef, assetId: string, target: CanvasOutputPromotionTarget): ElementRef {
  const next: ElementRef = { ...el, refAssetIds: [...(el.refAssetIds ?? [])], updatedAt: Date.now(), version: (el.version ?? 1) + 1 }
  if (!target.libraryVariantId) {
    if (isElementViewRole(target.view)) {
      next.views = { ...(next.views ?? {}), [target.view]: assetId }
    } else {
      next.refAssetIds = prependUnique(next.refAssetIds, assetId)
    }
    return next
  }
  const variants = [...(next.appearanceVariants ?? [])]
  let idx = variants.findIndex((variant) => variant.id === target.libraryVariantId)
  if (idx < 0) {
    variants.push({ id: target.libraryVariantId, label: target.variantLabel || target.libraryVariantId })
    idx = variants.length - 1
  }
  const variant = { ...variants[idx] }
  if (isElementViewRole(target.view)) {
    variant.views = { ...(variant.views ?? {}), [target.view]: assetId }
  } else {
    variant.refAssetIds = prependUnique(variant.refAssetIds, assetId)
  }
  variants[idx] = variant
  next.appearanceVariants = variants
  return next
}

interface AssetState {
  assets: AssetRecord[]
  boards: Board[]
  elements: ElementRef[]
  usage: { count: number; bytes: number }
  loaded: boolean
  busy: boolean

  load: () => Promise<void>
  refresh: () => Promise<void>
  upload: (files: { name: string; mime: string; base64: string }[]) => Promise<void>
  removeAsset: (id: string) => Promise<void>
  runGc: () => Promise<{ removed: number; freedBytes: number }>
  // 合集（Boards）
  createBoard: (name: string) => Promise<void>
  renameBoard: (id: string, name: string) => Promise<void>
  deleteBoard: (id: string) => Promise<void>
  moveAsset: (recordId: string, boardId?: string) => Promise<void>

  saveElement: (el: Partial<ElementRef> & { kind: ElementKind; name: string }) => Promise<ElementRef>
  removeElement: (id: string) => Promise<void>
  /** P3：把画布输出显式发布到身份资产；必须由调用方传入明确目标，不从 meta 自动猜测写回。 */
  promoteCanvasOutputs: (items: CanvasOutputPromotionItem[], target: CanvasOutputPromotionTarget) => Promise<number>
}

export const useAssetStore = create<AssetState>((set, get) => ({
  assets: [],
  boards: [],
  elements: [],
  usage: { count: 0, bytes: 0 },
  loaded: false,
  busy: false,

  load: async () => {
    const [assets, elements, usage, boards] = await Promise.all([
      backfillAll(), // 回填画布工程 + 工作流项目生成素材 + 返回完整注册表
      kvGet<ElementRef[]>(KEY_ELEMENTS),
      storageUsage(),
      loadBoards(),
    ])
    set({ assets, boards, elements: Array.isArray(elements) ? elements : [], usage, loaded: true })
  },

  createBoard: async (name) => {
    await svcCreateBoard(name)
    set({ boards: await loadBoards() })
  },
  renameBoard: async (id, name) => {
    await svcRenameBoard(id, name)
    set({ boards: await loadBoards() })
  },
  deleteBoard: async (id) => {
    await svcDeleteBoard(id)
    set({ boards: await loadBoards(), assets: await loadRegistry() })
  },
  moveAsset: async (recordId, boardId) => {
    await svcSetAssetBoard(recordId, boardId)
    set({ assets: await loadRegistry() })
  },

  refresh: async () => {
    const [assets, usage] = await Promise.all([backfillAll(), storageUsage()])
    set({ assets, usage })
  },

  upload: async (files) => {
    set({ busy: true })
    try {
      for (const f of files) await importAssetFile(f)
      set({ assets: await loadRegistry(), usage: await storageUsage() })
    } finally {
      set({ busy: false })
    }
  },

  removeAsset: async (id) => {
    await removeAssetRecord(id)
    set({ assets: await loadRegistry(), usage: await storageUsage() })
  },

  runGc: async () => {
    set({ busy: true })
    try {
      const r = await gcOrphans()
      // 精准 revoke：只释放被 GC 掉的孤儿在内存缓存里的 blob/字节（绝不整体 clearAssetCache，否则会 blank 在屏媒体）
      for (const id of r.removedIds) releaseAsset(id)
      set({ assets: await loadRegistry(), usage: await storageUsage() })
      return r
    } finally {
      set({ busy: false })
    }
  },

  saveElement: async (el) => {
    const list = get().elements.slice()
    const ts = Date.now()
    let saved: ElementRef
    const idx = el.id ? list.findIndex((e) => e.id === el.id) : -1
    if (idx >= 0) {
      saved = { ...list[idx], ...el, updatedAt: ts } as ElementRef
      list[idx] = saved
    } else {
      // M22a/M27：新建分支改为整体展开，杜绝丢字段（旧版只拷贝子集，丢 charId/views/voiceId/lora/identity/appearanceVariants）
      saved = {
        ...el,
        id: el.id ?? `el_${nanoid(8)}`,
        refAssetIds: el.refAssetIds || [],
        createdAt: ts,
        updatedAt: ts,
      } as ElementRef
      list.push(saved)
    }
    set({ elements: list })
    await kvSet(KEY_ELEMENTS, list)
    return saved
  },

  removeElement: async (id) => {
    const list = get().elements.filter((e) => e.id !== id)
    set({ elements: list })
    await kvSet(KEY_ELEMENTS, list)
  },

  promoteCanvasOutputs: async (items, target) => {
    const list = get().elements.slice()
    let changed = 0
    const idx = list.findIndex((el) => el.id === target.entityId)
    if (target.kind !== 'libraryEntity' || idx < 0) return 0
    if (list[idx].archived) {
      window.mulby?.notification?.show(`「${list[idx].name}」已归档，恢复后才能保存画布输出`, 'warning')
      return 0
    }
    let nextElement = list[idx]
    for (const it of items) {
      const assetId = it.assetId
      if (!assetId) continue
      nextElement = applyCanvasOutputToElement(nextElement, assetId, target)
      changed++
    }
    if (changed) {
      list[idx] = nextElement
      set({ elements: list })
      await kvSet(KEY_ELEMENTS, list)
    }
    return changed
  },
}))
