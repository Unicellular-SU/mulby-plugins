/**
 * Toonflow 式重构 · 阶段2b：结构化项目 store（zustand），建立在 domain/persistence 之上。
 *
 * 管理：项目列表(cards) + 当前打开的项目文档(doc) + 各实体增删改 + 防抖落盘。
 * 实体二进制（图/视频）仍存现有资产库；这里只存结构与 assetId 引用。
 * 不兼容老节点图（独立 studio:* 命名空间）。
 */
import { create } from 'zustand'
import * as P from '../domain/persistence'
import type { Asset, Clip, ProjectCard, ProjectDoc, ProjectMeta, Script, Storyboard } from '../domain/types'
import { generateAssetImage, generateKeyframeImage, generateClipVideo } from '../studio/services/generate'

let saveTimer: ReturnType<typeof setTimeout> | null = null

interface ProjectState {
  cards: ProjectCard[]
  doc: ProjectDoc | null
  loading: boolean
  dirty: boolean

  init: () => Promise<void>
  refreshCards: () => Promise<void>
  createProject: (meta: Pick<ProjectMeta, 'name'> & Partial<ProjectMeta>) => Promise<string>
  openProject: (id: string) => Promise<void>
  closeProject: () => Promise<void>
  deleteProject: (id: string) => Promise<void>
  flush: () => Promise<void>

  /** 通用：克隆当前 doc → 应用变更 → 落盘（防抖） */
  mutate: (fn: (doc: ProjectDoc) => void) => void
  updateMeta: (patch: Partial<ProjectMeta>) => void

  // 实体便捷增删改（基于 mutate）
  upsertScript: (s: Partial<Script> & { content: string }) => string
  removeScript: (id: string) => void
  upsertAsset: (a: Partial<Asset> & { type: Asset['type']; name: string }) => string
  removeAsset: (id: string) => void
  upsertStoryboard: (s: Partial<Storyboard> & { videoDesc: string }) => string
  removeStoryboard: (id: string) => void
  reorderStoryboards: (orderedIds: string[]) => void
  upsertClip: (c: Partial<Clip> & { storyboardId: string }) => string

  // 生成（接现有图像引擎 + 项目画风 Skill）
  generateAsset: (id: string) => Promise<void>
  generateKeyframe: (storyboardId: string) => Promise<void>
  generateClip: (storyboardId: string) => Promise<void>
}

/** 改某资产/分镜的 state+error（异步生成进度回写，按 id 查最新避免覆盖并发编辑） */
function setAssetState(get: () => ProjectState, id: string, patch: Partial<Asset>) {
  get().mutate((d) => {
    const a = d.assets.find((x) => x.id === id)
    if (a) Object.assign(a, patch)
  })
}
function setStoryboardState(get: () => ProjectState, id: string, patch: Partial<Storyboard>) {
  get().mutate((d) => {
    const s = d.storyboards.find((x) => x.id === id)
    if (s) Object.assign(s, patch)
  })
}

function scheduleSave(get: () => ProjectState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void get().flush()
  }, 700)
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  cards: [],
  doc: null,
  loading: false,
  dirty: false,

  init: async () => {
    set({ loading: true })
    const cards = await P.loadIndex()
    const currentId = await P.getCurrentId()
    let doc: ProjectDoc | null = null
    if (currentId) doc = await P.loadProject(currentId)
    set({ cards, doc, loading: false })
  },

  refreshCards: async () => set({ cards: await P.loadIndex() }),

  createProject: async (meta) => {
    const doc = P.emptyProjectDoc(meta)
    await P.saveProject(doc)
    await P.setCurrentId(doc.meta.id)
    set({ doc })
    await get().refreshCards()
    return doc.meta.id
  },

  openProject: async (id) => {
    await get().flush()
    const doc = await P.loadProject(id)
    if (!doc) return
    await P.setCurrentId(id)
    set({ doc, dirty: false })
  },

  closeProject: async () => {
    await get().flush()
    await P.setCurrentId(null)
    set({ doc: null })
  },

  deleteProject: async (id) => {
    await P.deleteProject(id)
    const cur = get().doc
    if (cur?.meta.id === id) set({ doc: null })
    await get().refreshCards()
  },

  flush: async () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const doc = get().doc
    if (doc && get().dirty) {
      await P.saveProject(doc)
      set({ dirty: false })
      await get().refreshCards()
    }
  },

  mutate: (fn) => {
    const cur = get().doc
    if (!cur) return
    const next = structuredClone(cur) as ProjectDoc
    fn(next)
    next.meta.updatedAt = Date.now()
    set({ doc: next, dirty: true })
    scheduleSave(get)
  },

  updateMeta: (patch) => get().mutate((d) => Object.assign(d.meta, patch)),

  upsertScript: (s) => {
    const id = s.id ?? P.newId('s_')
    const now = Date.now()
    get().mutate((d) => {
      const i = d.scripts.findIndex((x) => x.id === id)
      const base: Script = d.scripts[i] ?? { id, name: s.name ?? '剧本', content: '', createdAt: now, updatedAt: now }
      const merged: Script = { ...base, ...s, id, content: s.content, updatedAt: now }
      if (i >= 0) d.scripts[i] = merged
      else d.scripts.push(merged)
    })
    return id
  },
  removeScript: (id) => get().mutate((d) => (d.scripts = d.scripts.filter((x) => x.id !== id))),

  upsertAsset: (a) => {
    const id = a.id ?? P.newId('a_')
    get().mutate((d) => {
      const i = d.assets.findIndex((x) => x.id === id)
      const base: Asset = d.assets[i] ?? { id, type: a.type, name: a.name, state: 'idle' }
      const merged: Asset = { ...base, ...a, id }
      if (i >= 0) d.assets[i] = merged
      else d.assets.push(merged)
    })
    return id
  },
  removeAsset: (id) => get().mutate((d) => (d.assets = d.assets.filter((x) => x.id !== id && x.parentAssetId !== id))),

  upsertStoryboard: (s) => {
    const id = s.id ?? P.newId('sb_')
    get().mutate((d) => {
      const i = d.storyboards.findIndex((x) => x.id === id)
      const base: Storyboard = d.storyboards[i] ?? {
        id,
        index: d.storyboards.length,
        track: s.track ?? '默认',
        videoDesc: s.videoDesc,
        duration: s.duration ?? 5,
        associateAssetIds: s.associateAssetIds ?? [],
        shouldGenerateImage: s.shouldGenerateImage ?? true,
        state: 'idle',
      }
      const merged: Storyboard = { ...base, ...s, id }
      if (i >= 0) d.storyboards[i] = merged
      else d.storyboards.push(merged)
    })
    return id
  },
  removeStoryboard: (id) =>
    get().mutate((d) => {
      d.storyboards = d.storyboards.filter((x) => x.id !== id)
      d.clips = d.clips.filter((c) => c.storyboardId !== id)
      d.track = d.track.filter((t) => t.storyboardId !== id)
    }),
  reorderStoryboards: (orderedIds) =>
    get().mutate((d) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i]))
      d.storyboards.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
      d.storyboards.forEach((s, i) => (s.index = i))
    }),

  upsertClip: (c) => {
    const id = c.id ?? P.newId('c_')
    get().mutate((d) => {
      const i = d.clips.findIndex((x) => x.id === id)
      const base: Clip = d.clips[i] ?? { id, storyboardId: c.storyboardId, durationSec: c.durationSec ?? 5, state: 'idle' }
      const merged: Clip = { ...base, ...c, id }
      if (i >= 0) d.clips[i] = merged
      else d.clips.push(merged)
    })
    return id
  },

  generateAsset: async (id) => {
    const doc = get().doc
    const asset = doc?.assets.find((a) => a.id === id)
    if (!doc || !asset) return
    setAssetState(get, id, { state: 'generating', error: undefined })
    try {
      const refImageId = await generateAssetImage(asset, doc.meta)
      setAssetState(get, id, { refImageId, state: 'done' })
    } catch (e) {
      setAssetState(get, id, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  generateKeyframe: async (storyboardId) => {
    const doc = get().doc
    const sb = doc?.storyboards.find((s) => s.id === storyboardId)
    if (!doc || !sb) return
    setStoryboardState(get, storyboardId, { state: 'generating', error: undefined })
    try {
      const keyframeImageId = await generateKeyframeImage(sb, doc.assets, doc.meta)
      setStoryboardState(get, storyboardId, { keyframeImageId, state: 'done' })
    } catch (e) {
      setStoryboardState(get, storyboardId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  generateClip: async (storyboardId) => {
    const doc = get().doc
    const sb = doc?.storyboards.find((s) => s.id === storyboardId)
    if (!doc || !sb) return
    // 为该分镜建/取片段，置生成中
    const clipId = get().upsertClip({ storyboardId, state: 'generating', error: undefined, durationSec: sb.duration || 5 })
    const setClip = (patch: Partial<Clip>) =>
      get().mutate((d) => {
        const c = d.clips.find((x) => x.id === clipId)
        if (c) Object.assign(c, patch)
      })
    try {
      const r = await generateClipVideo(sb, doc.meta)
      setClip({ videoUrl: r.url, videoFilePath: r.localPath, durationSec: r.durationSec, state: 'done' })
      // 同步进时间线
      get().mutate((d) => {
        const t = d.track.find((x) => x.storyboardId === storyboardId)
        if (t) {
          if (!t.clipIds.includes(clipId)) t.clipIds.push(clipId)
          t.selectClipId = clipId
        } else d.track.push({ id: P.newId('t_'), storyboardId, clipIds: [clipId], selectClipId: clipId })
      })
    } catch (e) {
      setClip({ state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
