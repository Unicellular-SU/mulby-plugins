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
import { generateAssetImage, generateKeyframeImage, generateClipVideo, loadImageBase64, clipLastFrameDataUrl } from '../studio/services/generate'
import { runAgentPlan } from '../studio/agent/agent'
import { splitNovelChapters } from '../studio/services/novel'
import { composeProject } from '../studio/services/compose'

export interface FilmState {
  state: 'idle' | 'composing' | 'done' | 'failed'
  path?: string
  text?: string
  error?: string
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

interface ProjectState {
  cards: ProjectCard[]
  doc: ProjectDoc | null
  loading: boolean
  dirty: boolean
  agentBusy: boolean
  film: FilmState

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
  // 批量「一键生成」（顺序执行，跳过已完成；batch 显示当前进度标签）
  batch: { running: boolean; label?: string }
  generateAllAssets: () => Promise<void>
  generateAllKeyframes: () => Promise<void>
  generateAllClips: () => Promise<void>
  /** 一键成片：资产 → 关键帧 → 视频 → 合成 一条龙 */
  autoProduce: () => Promise<void>

  // 小说导入（长文 → 章节，供 Agent 改编）
  importNovel: (text: string) => void
  clearNovel: () => void

  // 制片 Agent（结构化方案：一句话/故事 → 剧本+资产+分镜）
  runAgent: (userText: string) => Promise<void>

  // 时间线 → ffmpeg 合成成片
  compose: () => Promise<void>
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
  agentBusy: false,
  film: { state: 'idle' },
  batch: { running: false },

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
      // 连贯性：承接镜头取「上一镜（按 index）关键帧」作 img2img 主参考
      let chainBase: { base64: string; mime: string } | null = null
      if (sb.chainFromPrev) {
        const ordered = [...doc.storyboards].sort((a, b) => a.index - b.index)
        const i = ordered.findIndex((s) => s.id === storyboardId)
        const prev = i > 0 ? ordered[i - 1] : undefined
        if (prev?.keyframeImageId) chainBase = await loadImageBase64(prev.keyframeImageId)
      }
      const keyframeImageId = await generateKeyframeImage(sb, doc.assets, doc.meta, chainBase)
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
      // 顺接：承接片段取「上一镜选用片段的真实尾帧」作首帧，无缝衔接
      let firstFrameUrl: string | undefined
      if (sb.chainFromPrev) {
        const ordered = [...doc.storyboards].sort((a, b) => a.index - b.index)
        const i = ordered.findIndex((s) => s.id === storyboardId)
        const prev = i > 0 ? ordered[i - 1] : undefined
        const pt = prev ? doc.track.find((t) => t.storyboardId === prev.id) : undefined
        const prevClip = pt
          ? doc.clips.find((c) => c.id === (pt.selectClipId || pt.clipIds[0]))
          : prev
            ? doc.clips.find((c) => c.storyboardId === prev.id && c.state === 'done')
            : undefined
        firstFrameUrl = await clipLastFrameDataUrl(prevClip?.videoFilePath)
      }
      const r = await generateClipVideo(sb, doc.meta, firstFrameUrl)
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

  importNovel: (text) =>
    get().mutate((d) => {
      d.novel = splitNovelChapters(text).map((c, i) => ({ id: P.newId('ch_'), index: i, title: c.title, text: c.text }))
    }),
  clearNovel: () => get().mutate((d) => (d.novel = [])),

  runAgent: async (userText) => {
    const doc0 = get().doc
    if (!doc0 || !userText.trim() || get().agentBusy) return
    const now = Date.now()
    get().mutate((d) => d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'user', content: userText, createTime: now }))
    set({ agentBusy: true })
    try {
      const plan = await runAgentPlan(get().doc!, userText)
      get().mutate((d) => {
        // 剧本：覆盖首个或新建
        if (plan.script?.content) {
          const name = plan.script.name || `剧本 ${d.scripts.length + 1}`
          if (d.scripts.length) d.scripts[0] = { ...d.scripts[0], name, content: plan.script.content, updatedAt: Date.now() }
          else d.scripts.push({ id: P.newId('s_'), name, content: plan.script.content, createdAt: Date.now(), updatedAt: Date.now() })
        }
        // 资产：按 名+类型 去重（已存在则补描述）
        const nameToId = new Map(d.assets.map((a) => [a.name, a.id]))
        for (const a of plan.assets ?? []) {
          if (!a?.name || !a.type) continue
          const ex = d.assets.find((x) => x.name === a.name && x.type === a.type)
          if (ex) {
            ex.desc = a.desc ?? ex.desc
            ex.prompt = a.prompt ?? ex.prompt
          } else {
            const id = P.newId('a_')
            d.assets.push({ id, type: a.type, name: a.name, desc: a.desc, prompt: a.prompt, state: 'idle' })
            nameToId.set(a.name, id)
          }
        }
        // 分镜：追加（cast 名 → 资产 id）
        for (const sb of plan.storyboards ?? []) {
          if (!sb?.videoDesc) continue
          const cast = (sb.cast ?? []).map((n) => nameToId.get(n)).filter((x): x is string => !!x)
          d.storyboards.push({
            id: P.newId('sb_'),
            index: d.storyboards.length,
            track: '默认',
            videoDesc: sb.videoDesc,
            prompt: sb.prompt,
            duration: typeof sb.duration === 'number' ? sb.duration : 5,
            associateAssetIds: cast,
            shouldGenerateImage: true,
            chainFromPrev: sb.chainFromPrev === true,
            state: 'idle',
          })
        }
        d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'assistant', content: plan.reply, createTime: Date.now() })
      })
      // 用户明确要求出图/成片 → 应用方案后自动一键成片（后台执行，不阻塞对话）
      if (plan.autoGenerate) void get().autoProduce()
    } catch (e) {
      get().mutate((d) =>
        d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'assistant', content: '出错：' + (e instanceof Error ? e.message : String(e)), createTime: Date.now() })
      )
    } finally {
      set({ agentBusy: false })
      await get().flush()
    }
  },

  generateAllAssets: async () => {
    if (get().batch.running || !get().doc) return
    const ids = get().doc!.assets.filter((a) => !a.refImageId).map((a) => a.id)
    set({ batch: { running: true, label: `生成资产 0/${ids.length}` } })
    try {
      for (let i = 0; i < ids.length; i++) {
        set({ batch: { running: true, label: `生成资产 ${i + 1}/${ids.length}` } })
        await get().generateAsset(ids[i])
      }
    } finally {
      set({ batch: { running: false } })
    }
  },

  generateAllKeyframes: async () => {
    if (get().batch.running || !get().doc) return
    // 按 index 顺序生成：承接镜头能拿到刚生成的上一镜关键帧（链式连贯）
    const ids = [...get().doc!.storyboards]
      .sort((a, b) => a.index - b.index)
      .filter((s) => !s.keyframeImageId)
      .map((s) => s.id)
    set({ batch: { running: true, label: `生成关键帧 0/${ids.length}` } })
    try {
      for (let i = 0; i < ids.length; i++) {
        set({ batch: { running: true, label: `生成关键帧 ${i + 1}/${ids.length}` } })
        await get().generateKeyframe(ids[i])
      }
    } finally {
      set({ batch: { running: false } })
    }
  },

  generateAllClips: async () => {
    if (get().batch.running || !get().doc) return
    // 按 index 顺序：承接片段能拿到刚生成的上一片段尾帧（顺接无缝）
    const ids = [...get().doc!.storyboards]
      .sort((a, b) => a.index - b.index)
      .filter((s) => s.keyframeImageId && !get().doc!.clips.some((c) => c.storyboardId === s.id && c.state === 'done'))
      .map((s) => s.id)
    set({ batch: { running: true, label: `生成视频 0/${ids.length}` } })
    try {
      for (let i = 0; i < ids.length; i++) {
        set({ batch: { running: true, label: `生成视频 ${i + 1}/${ids.length}` } })
        await get().generateClip(ids[i])
      }
    } finally {
      set({ batch: { running: false } })
    }
  },

  autoProduce: async () => {
    // 各子步骤自管 batch/film 标志；这里只做顺序编排（守卫避免重入）
    if (get().batch.running || get().film.state === 'composing' || !get().doc) return
    await get().generateAllAssets()
    await get().generateAllKeyframes()
    await get().generateAllClips()
    if (get().doc!.storyboards.some((s) => get().doc!.clips.some((c) => c.storyboardId === s.id && c.state === 'done'))) {
      await get().compose()
    }
  },

  compose: async () => {
    const doc = get().doc
    if (!doc || get().film.state === 'composing') return
    set({ film: { state: 'composing', text: '开始合成…' } })
    try {
      const path = await composeProject(doc, (text, percent) => set({ film: { state: 'composing', text: percent != null ? `${text} ${percent}%` : text } }))
      set({ film: { state: 'done', path } })
    } catch (e) {
      set({ film: { state: 'failed', error: e instanceof Error ? e.message : String(e) } })
    }
  },
}))
