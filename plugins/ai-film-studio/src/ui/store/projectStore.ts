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
import { generateAssetImage, generateDerivativeImage, generateKeyframeImage, generateClipVideo, loadImageBase64, clipLastFrameDataUrl } from '../studio/services/generate'
import { polishAssetPrompt } from '../studio/services/polish'
import { runFlowImage } from '../studio/services/imageFlow'
import { synthVoiceSample, matchRoleVoices } from '../studio/services/audio'
import { maybeSummarize, getMemoryConfig, recallContext } from '../studio/agent/memory'
import { deleteAsset } from '../services/assets'
import { runAgentPipeline, buildToolLoopSystem } from '../studio/agent/agent'
import { runToolLoop } from '../studio/agent/runtime'
import { makeAgentTools } from '../studio/agent/agentTools'
import { abortText } from '../services/textEngine'
import { useGraphStore } from './graphStore'
import { useAgentDeployStore } from './agentDeployStore'
import { splitNovelChapters, extractEvents } from '../studio/services/novel'
import { composeProject } from '../studio/services/compose'
import { syncTracksFromStoryboards, selectedClipId } from '../studio/services/track'
import { generateTrackVideoPrompt } from '../studio/services/videoPrompt'

export interface FilmState {
  state: 'idle' | 'composing' | 'done' | 'failed'
  path?: string
  text?: string
  error?: string
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let agentAbort: AbortController | null = null // 工具循环 Agent 的中断句柄（§6.1.1 per-run）

export interface ProjectState {
  cards: ProjectCard[]
  doc: ProjectDoc | null
  loading: boolean
  dirty: boolean
  agentBusy: boolean
  agentStage?: string
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
  moveStoryboard: (id: string, delta: number) => void
  upsertClip: (c: Partial<Clip> & { storyboardId: string }) => string

  // 时间线 · 视频段/轨道（§5.1/§5.2/§5.4）
  syncTracks: () => void
  selectClip: (trackId: string, clipId: string) => void
  deleteClip: (trackId: string, clipId: string) => void
  updateTrackDuration: (trackId: string, sec: number | undefined) => void
  updateTrackPrompt: (trackId: string, prompt: string) => void
  generateTrackPrompt: (trackId: string) => Promise<void>
  generateAllTrackPrompts: () => Promise<void>

  // 资产润色（两段式）+ 衍生（§3.1/§3.2）
  polishAsset: (id: string) => Promise<void>
  polishAllAssets: () => Promise<void>
  addDerivative: (parentId: string, init?: { name?: string; desc?: string }) => string
  generateDerivative: (childId: string) => Promise<void>
  // 一资产多图历史（§3.3）
  selectAssetImage: (assetId: string, imageId: string) => void
  deleteAssetImage: (assetId: string, imageId: string) => Promise<void>
  // 关键帧多参考图精修（§4.4 imageFlow）
  refineKeyframe: (storyboardId: string, refAssetIds: string[], prompt: string) => Promise<void>
  // 音色库 + 角色↔音色（§3.4）
  addVoice: (init?: { name?: string; voice?: string; desc?: string }) => string
  synthVoice: (audioAssetId: string, text?: string) => Promise<void>
  bindRoleVoice: (roleId: string, voiceAssetId: string | undefined) => void
  autoBindVoices: () => Promise<void>

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
  extractChapterEvents: (chapterId: string) => Promise<void>
  extractAllEvents: () => Promise<void>

  // 制片 Agent（结构化方案：一句话/故事 → 剧本+资产+分镜）
  runAgent: (userText: string) => Promise<void>
  /** 实验：原生工具循环 Agent（§6.1，依赖 R1；jsonMode 管线仍为默认兜底） */
  runAgentToolLoop: (userText: string) => Promise<void>
  /** 中断进行中的 Agent（管线 runText 与工具循环均尽力中断） */
  abortAgent: () => void

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
/** 资产生成成功：把新图作为一条历史候选追加（§3.3），并设为当前选定图（refImageId 同步） */
function pushAssetImage(get: () => ProjectState, id: string, refImageId: string, extra?: Partial<Asset>) {
  get().mutate((d) => {
    const a = d.assets.find((x) => x.id === id)
    if (!a) return
    const img = { id: P.newId('ai_'), refImageId, createdAt: Date.now(), state: 'done' as const }
    a.images = [...(a.images ?? []), img]
    a.currentImageId = img.id
    a.refImageId = refImageId
    a.state = 'done'
    a.error = undefined
    if (extra) Object.assign(a, extra)
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
    if (doc) get().syncTracks() // 旧项目惰性补齐视频段
  },

  refreshCards: async () => set({ cards: await P.loadIndex() }),

  createProject: async (meta) => {
    await get().flush() // 先落盘当前 dirty 项目 + 清掉待触发的 saveTimer，避免替换 doc 后丢失/存错
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
    get().syncTracks() // 惰性补齐视频段
  },

  closeProject: async () => {
    await get().flush()
    await P.setCurrentId(null)
    set({ doc: null })
  },

  deleteProject: async (id) => {
    await get().flush() // 先落盘 + 清 saveTimer，避免 stale timer 把当前 doc 存错
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
      syncTracksFromStoryboards(d) // 新分镜惰性补一个段
    })
    return id
  },
  removeStoryboard: (id) =>
    get().mutate((d) => {
      d.storyboards = d.storyboards.filter((x) => x.id !== id)
      d.clips = d.clips.filter((c) => c.storyboardId !== id)
      // 删除后重排 index 保持连续：否则 index 出现空洞，新建分镜会与现有撞 index → 排序/承接取错相邻镜
      d.storyboards.sort((a, b) => a.index - b.index).forEach((s, i) => (s.index = i))
      syncTracksFromStoryboards(d) // 段内去该分镜 + 空段删除 + order 重排
    }),
  reorderStoryboards: (orderedIds) =>
    get().mutate((d) => {
      const pos = new Map(orderedIds.map((id, i) => [id, i]))
      d.storyboards.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0))
      d.storyboards.forEach((s, i) => (s.index = i))
      syncTracksFromStoryboards(d) // 段顺序跟随分镜 index
    }),
  moveStoryboard: (id, delta) =>
    get().mutate((d) => {
      const ordered = [...d.storyboards].sort((a, b) => a.index - b.index)
      const i = ordered.findIndex((s) => s.id === id)
      const j = i + delta
      if (i < 0 || j < 0 || j >= ordered.length) return
      ;[ordered[i], ordered[j]] = [ordered[j], ordered[i]]
      ordered.forEach((s, k) => (s.index = k))
      d.storyboards = ordered
      syncTracksFromStoryboards(d)
    }),

  syncTracks: () => get().mutate((d) => syncTracksFromStoryboards(d)),
  selectClip: (trackId, clipId) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t && t.clipIds.includes(clipId)) t.selectClipId = clipId
    }),
  deleteClip: (trackId, clipId) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t) {
        t.clipIds = t.clipIds.filter((c) => c !== clipId)
        if (t.selectClipId === clipId) t.selectClipId = t.clipIds[0]
      }
      d.clips = d.clips.filter((c) => c.id !== clipId)
    }),
  updateTrackDuration: (trackId, sec) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t) t.duration = sec && sec > 0 ? sec : undefined
    }),
  updateTrackPrompt: (trackId, prompt) =>
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t) {
        t.prompt = prompt
        t.promptState = 'done'
      }
    }),
  generateTrackPrompt: async (trackId) => {
    const doc = get().doc
    const track = doc?.track.find((t) => t.id === trackId)
    if (!doc || !track) return
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === trackId)
      if (t) {
        t.promptState = 'generating'
        t.promptError = undefined
      }
    })
    try {
      const prompt = await generateTrackVideoPrompt(track, doc)
      get().mutate((d) => {
        const t = d.track.find((x) => x.id === trackId)
        if (t) {
          t.prompt = prompt
          t.promptState = 'done'
        }
      })
    } catch (e) {
      get().mutate((d) => {
        const t = d.track.find((x) => x.id === trackId)
        if (t) {
          t.promptState = 'failed'
          t.promptError = e instanceof Error ? e.message : String(e)
        }
      })
    }
  },
  generateAllTrackPrompts: async () => {
    if (get().batch.running || !get().doc) return
    const ids = [...get().doc!.track].sort((a, b) => a.order - b.order).filter((t) => t.storyboardIds.length && !t.prompt).map((t) => t.id)
    set({ batch: { running: true, label: `生成段提示词 0/${ids.length}` } })
    try {
      for (let i = 0; i < ids.length; i++) {
        set({ batch: { running: true, label: `生成段提示词 ${i + 1}/${ids.length}` } })
        await get().generateTrackPrompt(ids[i])
      }
    } finally {
      set({ batch: { running: false } })
    }
  },

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

  polishAsset: async (id) => {
    const doc = get().doc
    const asset = doc?.assets.find((a) => a.id === id)
    if (!doc || !asset || asset.type === 'audio' || asset.type === 'clip') return
    setAssetState(get, id, { promptState: 'polishing', promptError: undefined })
    try {
      const prompt = await polishAssetPrompt(asset, doc.meta)
      setAssetState(get, id, { prompt, promptState: 'done' })
    } catch (e) {
      setAssetState(get, id, { promptState: 'failed', promptError: e instanceof Error ? e.message : String(e) })
    }
  },
  polishAllAssets: async () => {
    if (get().batch.running || !get().doc) return
    const ids = get().doc!.assets.filter((a) => (a.type === 'role' || a.type === 'scene' || a.type === 'prop') && !a.prompt).map((a) => a.id)
    set({ batch: { running: true, label: `润色提示词 0/${ids.length}` } })
    try {
      for (let i = 0; i < ids.length; i++) {
        set({ batch: { running: true, label: `润色提示词 ${i + 1}/${ids.length}` } })
        await get().polishAsset(ids[i])
      }
    } finally {
      set({ batch: { running: false } })
    }
  },
  addDerivative: (parentId, init) => {
    const parent = get().doc?.assets.find((a) => a.id === parentId)
    if (!parent) return ''
    const n = (get().doc?.assets.filter((a) => a.parentAssetId === parentId).length ?? 0) + 1
    return get().upsertAsset({ type: parent.type, name: init?.name || `${parent.name}·变体${n}`, desc: init?.desc, parentAssetId: parentId })
  },
  generateDerivative: async (childId) => {
    const doc = get().doc
    const child = doc?.assets.find((a) => a.id === childId)
    const parent = child?.parentAssetId ? doc?.assets.find((a) => a.id === child.parentAssetId) : undefined
    if (!doc || !child || !parent) return
    setAssetState(get, childId, { state: 'generating', error: undefined })
    try {
      const refImageId = await generateDerivativeImage(child, parent, doc.meta)
      pushAssetImage(get, childId, refImageId, { derivedFromImageId: parent.refImageId })
    } catch (e) {
      setAssetState(get, childId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
  selectAssetImage: (assetId, imageId) =>
    get().mutate((d) => {
      const a = d.assets.find((x) => x.id === assetId)
      const img = a?.images?.find((i) => i.id === imageId)
      if (a && img) {
        a.currentImageId = imageId
        a.refImageId = img.refImageId
      }
    }),
  deleteAssetImage: async (assetId, imageId) => {
    const a = get().doc?.assets.find((x) => x.id === assetId)
    const img = a?.images?.find((i) => i.id === imageId)
    if (img) {
      try {
        await deleteAsset(img.refImageId)
      } catch {
        // 附件可能已不存在，忽略
      }
    }
    get().mutate((d) => {
      const x = d.assets.find((y) => y.id === assetId)
      if (!x?.images) return
      x.images = x.images.filter((i) => i.id !== imageId)
      if (x.currentImageId === imageId) {
        const last = x.images[x.images.length - 1]
        x.currentImageId = last?.id
        x.refImageId = last?.refImageId
      }
    })
  },
  refineKeyframe: async (storyboardId, refAssetIds, prompt) => {
    const doc = get().doc
    const sb = doc?.storyboards.find((s) => s.id === storyboardId)
    if (!doc || !sb) return
    setStoryboardState(get, storyboardId, { state: 'generating', error: undefined })
    try {
      const keyframeImageId = await runFlowImage(refAssetIds, prompt, doc.meta)
      setStoryboardState(get, storyboardId, { keyframeImageId, state: 'done' })
    } catch (e) {
      setStoryboardState(get, storyboardId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  addVoice: (init) => get().upsertAsset({ type: 'audio', name: init?.name || '音色', voice: init?.voice, desc: init?.desc }),
  synthVoice: async (audioAssetId, text) => {
    const a = get().doc?.assets.find((x) => x.id === audioAssetId)
    if (!a) return
    setAssetState(get, audioAssetId, { state: 'generating', error: undefined })
    try {
      const r = await synthVoiceSample(text || `你好，我是${a.name}。`, a.voice || '')
      setAssetState(get, audioAssetId, { audioFilePath: r.path, audioUrl: r.base64 ? `data:${r.mime};base64,${r.base64}` : undefined, state: 'done' })
    } catch (e) {
      setAssetState(get, audioAssetId, { state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },
  bindRoleVoice: (roleId, voiceAssetId) =>
    get().mutate((d) => {
      const r = d.assets.find((a) => a.id === roleId)
      if (r) {
        r.voiceAssetId = voiceAssetId
        r.audioBindState = voiceAssetId ? 'done' : 'idle'
      }
    }),
  autoBindVoices: async () => {
    const doc = get().doc
    if (!doc) return
    const roles = doc.assets.filter((a) => a.type === 'role')
    const voices = doc.assets.filter((a) => a.type === 'audio')
    if (!roles.length || !voices.length) return
    set({ batch: { running: true, label: 'AI 配音匹配…' } })
    try {
      const map = await matchRoleVoices(
        roles.map((r) => ({ id: r.id, name: r.name, desc: r.desc })),
        voices.map((v) => ({ id: v.id, name: v.name, desc: v.desc }))
      )
      get().mutate((d) => {
        for (const m of map) {
          const r = d.assets.find((a) => a.id === m.roleId && a.type === 'role')
          if (r && d.assets.some((a) => a.id === m.voiceAssetId && a.type === 'audio')) {
            r.voiceAssetId = m.voiceAssetId
            r.audioBindState = 'done'
          }
        }
      })
    } finally {
      set({ batch: { running: false } })
    }
  },

  generateAsset: async (id) => {
    const doc = get().doc
    const asset = doc?.assets.find((a) => a.id === id)
    if (!doc || !asset) return
    setAssetState(get, id, { state: 'generating', error: undefined })
    try {
      const refImageId = await generateAssetImage(asset, doc.meta)
      pushAssetImage(get, id, refImageId)
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
    const doc0 = get().doc
    const sb = doc0?.storyboards.find((s) => s.id === storyboardId)
    if (!doc0 || !sb) return
    // 确保该分镜有段（1 分镜=1 段惰性补齐），再取段
    get().syncTracks()
    const doc = get().doc!
    const track = doc.track.find((t) => t.storyboardIds.includes(storyboardId))
    if (!track) return
    // 一镜多生选优（§5.2）：重试「失败」候选则就地覆盖（不堆孤儿），否则新建候选并自动选中
    const last = track.clipIds.length ? doc.clips.find((c) => c.id === track.clipIds[track.clipIds.length - 1]) : undefined
    if (last?.state === 'generating') return // 防重入
    const reuse = last?.state === 'failed' ? last : undefined
    const clipId = get().upsertClip({
      id: reuse?.id,
      storyboardId,
      trackId: track.id,
      state: 'generating',
      error: undefined,
      durationSec: track.duration ?? sb.duration ?? 5,
      createdAt: Date.now(),
    })
    get().mutate((d) => {
      const t = d.track.find((x) => x.id === track.id)
      if (t) {
        if (!t.clipIds.includes(clipId)) t.clipIds.push(clipId)
        t.selectClipId = clipId
      }
    })
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
        const pt = prev ? doc.track.find((t) => t.storyboardIds.includes(prev.id)) : undefined
        const selId = pt ? selectedClipId(pt) : undefined
        const prevClip = selId
          ? doc.clips.find((c) => c.id === selId)
          : prev
            ? doc.clips.find((c) => c.storyboardId === prev.id && c.state === 'done')
            : undefined
        firstFrameUrl = await clipLastFrameDataUrl(prevClip?.videoFilePath)
      }
      const r = await generateClipVideo(sb, doc.meta, { firstFrameUrl, durationSec: track.duration, promptOverride: track.prompt })
      setClip({ videoUrl: r.url, videoFilePath: r.localPath, durationSec: r.durationSec, state: 'done' })
    } catch (e) {
      setClip({ state: 'failed', error: e instanceof Error ? e.message : String(e) })
    }
  },

  importNovel: (text) =>
    get().mutate((d) => {
      d.novel = splitNovelChapters(text).map((c, i) => ({ id: P.newId('ch_'), index: i, title: c.title, text: c.text }))
    }),
  clearNovel: () => get().mutate((d) => (d.novel = [])),

  extractChapterEvents: async (chapterId) => {
    const ch = get().doc?.novel.find((c) => c.id === chapterId)
    if (!ch) return
    get().mutate((d) => {
      const c = d.novel.find((x) => x.id === chapterId)
      if (c) c.eventState = 'generating'
    })
    try {
      const event = await extractEvents(ch.text)
      get().mutate((d) => {
        const c = d.novel.find((x) => x.id === chapterId)
        if (c) {
          c.event = event
          c.eventState = 'done'
        }
      })
    } catch {
      get().mutate((d) => {
        const c = d.novel.find((x) => x.id === chapterId)
        if (c) c.eventState = 'failed'
      })
    }
  },

  extractAllEvents: async () => {
    if (get().batch.running || !get().doc) return
    const ids = get().doc!.novel.filter((c) => !c.event).map((c) => c.id)
    set({ batch: { running: true, label: `提取事件 0/${ids.length}` } })
    try {
      for (let i = 0; i < ids.length; i++) {
        set({ batch: { running: true, label: `提取事件 ${i + 1}/${ids.length}` } })
        await get().extractChapterEvents(ids[i])
      }
    } finally {
      set({ batch: { running: false } })
    }
  },

  runAgent: async (userText) => {
    const doc0 = get().doc
    if (!doc0 || !userText.trim() || get().agentBusy) return
    const now = Date.now()
    get().mutate((d) => d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'user', content: userText, createTime: now }))
    set({ agentBusy: true, agentStage: undefined })
    try {
      const plan = await runAgentPipeline(get().doc!, userText, (label) => set({ agentStage: label }))
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
        // 分镜：replaceIndex(1-based) 命中则就地替换（关键帧失效），否则追加（cast 名 → 资产 id）
        for (const sb of plan.storyboards ?? []) {
          if (!sb?.videoDesc) continue
          const cast = (sb.cast ?? []).map((n) => nameToId.get(n)).filter((x): x is string => !!x)
          const ri = typeof sb.replaceIndex === 'number' && sb.replaceIndex > 0 ? sb.replaceIndex - 1 : -1
          const target = ri >= 0 ? d.storyboards.find((s) => s.index === ri) : undefined
          if (target) {
            target.videoDesc = sb.videoDesc
            if (sb.prompt != null) target.prompt = sb.prompt
            if (typeof sb.duration === 'number') target.duration = sb.duration
            if (sb.cast) target.associateAssetIds = cast
            if (typeof sb.chainFromPrev === 'boolean') target.chainFromPrev = sb.chainFromPrev
            target.keyframeImageId = undefined // 内容变了 → 关键帧失效，待重生
            target.state = 'idle'
            target.error = undefined
            continue
          }
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
        syncTracksFromStoryboards(d) // Agent 新增分镜 → 惰性补齐视频段
        d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'assistant', content: plan.reply, createTime: Date.now() })
      })
      // 用户明确要求出图/成片 → 应用方案后自动一键成片（后台执行，不阻塞对话）
      if (plan.autoGenerate) void get().autoProduce()
    } catch (e) {
      get().mutate((d) =>
        d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role: 'assistant', content: '出错：' + (e instanceof Error ? e.message : String(e)), createTime: Date.now() })
      )
    } finally {
      set({ agentBusy: false, agentStage: undefined })
      const d = get().doc
      if (d) await maybeSummarize(d, get().mutate, await getMemoryConfig()) // §6.6 长会话压缩
      await get().flush()
    }
  },

  runAgentToolLoop: async (userText) => {
    const doc0 = get().doc
    if (!doc0 || !userText.trim() || get().agentBusy) return
    const deploy = useAgentDeployStore.getState().resolve('decision') // §6.3 按 Agent 选模型/温度
    const model = deploy.model || useGraphStore.getState().selectedModel
    const push = (role: string, content: string) => get().mutate((d) => d.memory.push({ id: P.newId('m_'), agent: 'productionAgent', role, content, createTime: Date.now() }))
    if (!model) {
      push('assistant', '未配置文本模型（请在「模型」里选择）')
      return
    }
    push('user', userText)
    const controller = new AbortController()
    agentAbort = controller
    set({ agentBusy: true, agentStage: '工具调用…' })
    try {
      const cfg = await getMemoryConfig()
      const reply = await runToolLoop({
        model,
        system: buildToolLoopSystem(get().doc!, recallContext(get().doc!, userText, cfg)),
        user: userText,
        tools: makeAgentTools(get),
        params: deploy.params,
        signal: controller.signal,
        onToolCall: (name) => set({ agentStage: `调用 ${name}…` }),
        onToolResult: (name) => set({ agentStage: `${name} 完成` }),
      })
      push('assistant', reply)
      const d = get().doc
      if (d) await maybeSummarize(d, get().mutate, cfg)
    } catch (e) {
      push('assistant', '出错：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      agentAbort = null
      set({ agentBusy: false, agentStage: undefined })
      await get().flush()
    }
  },

  abortAgent: () => {
    abortText() // 兜底中断管线进行中的 runText
    agentAbort?.abort()
    agentAbort = null
    set({ agentBusy: false, agentStage: undefined })
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
    // 重新取 doc 并守卫：generation 期间用户若关/删项目，doc 可能已为 null（避免 null.storyboards 崩溃）
    const d = get().doc
    if (d && d.storyboards.some((s) => d.clips.some((c) => c.storyboardId === s.id && c.state === 'done'))) {
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
