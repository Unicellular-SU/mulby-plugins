/**
 * 素材库 + 角色/场景 Elements 库（全局，跨工程复用）。
 * - 素材：多模态（图片/视频/音频），由 assetRegistry 提供索引、上传、GC。
 * - Elements：角色/场景定义一次、跨工程复用（LTX Elements 式），存 `elements:library`。
 */
import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  loadRegistry,
  loadBoards,
  backfillFromProjects,
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

export type ElementKind = 'character' | 'scene'

export interface ElementRef {
  id: string
  kind: ElementKind
  name: string
  description?: string
  prompt?: string
  /** 参考图：附件库 assetId（直接绑定到画布节点的 image 输出） */
  refAssetIds: string[]
  tags?: string[]
  createdAt: number
  updatedAt: number
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
      backfillFromProjects(), // 回填生成素材 + 返回完整注册表
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
    const [assets, usage] = await Promise.all([backfillFromProjects(), storageUsage()])
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
      saved = {
        id: `el_${nanoid(8)}`,
        kind: el.kind,
        name: el.name,
        description: el.description,
        prompt: el.prompt,
        refAssetIds: el.refAssetIds || [],
        tags: el.tags,
        createdAt: ts,
        updatedAt: ts,
      }
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
}))
