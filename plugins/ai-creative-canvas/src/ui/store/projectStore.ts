import { create } from 'zustand'
import type { ProjectDoc } from '../types'
import { useGraph, createDefaultProject } from './graphStore'
import { resumeInflightVideos, abortAllInflightVideos } from '../services/generate'
import { uid } from '../util'
import {
  type ProjectMeta,
  loadRegistry,
  saveRegistry,
  migrateLegacyIfNeeded,
  loadProject,
  saveProject,
  deleteProjectStorage,
  loadRecovery,
  clearRecovery,
  seedMainBaseline,
  metaOf,
  migrateProject
} from '../services/persistence'
import { pruneProjectMediaOnDisk, removeProjectMediaOnDisk, saveBase64, toFileUrl } from '../services/media'
import {
  collectCardsMediaPaths,
  collectProjectMedia,
  collectProjectMediaPaths,
  auditProjectMediaAvailability,
  rewriteProjectMediaPaths,
  type RestoredProjectMedia
} from '../services/projectMedia'
import { confirmDialog } from './dialogStore'
import { toast } from './toastStore'
import {
  collectDirectorSceneAssetIds,
  decodeDirectorSceneBase64,
  encodeDirectorSceneBytes,
  remapDirectorSceneAssetIds
} from '../canvas/directorSceneExchange'

const MEDIA_EXPORT_CAP = 200 * 1024 * 1024 // 含媒体导出的 base64 总量上限（~150MB 实际），超限拒绝以免撑爆内存
const fsApi = () => window.mulby?.filesystem

// 触发浏览器下载一段 JSON
function downloadJson(filename: string, obj: unknown): void {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const safeName = (n?: string) => (n || 'project').replace(/[^\w.\-]+/g, '_')
const extOfPath = (p: string) => (p.split('.').pop() || 'bin').toLowerCase()
const formatSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`

interface PackedProjectMedia {
  b64: string
  ext: string
  mime: string | null
}

interface PackedProjectAttachment {
  dataBase64: string
  mimeType: string
}

interface ProjectMediaEnvelope {
  __ac?: string
  version?: number
  doc?: ProjectDoc
  media?: Record<string, PackedProjectMedia>
  mediaIndex?: Record<string, string>
  attachments?: Record<string, PackedProjectAttachment>
}

async function collectLiveReferences(items: ProjectMeta[]): Promise<{ paths: string[]; attachmentIds: string[] }> {
  const paths = new Set<string>()
  const attachmentIds = new Set<string>()
  const graph = useGraph.getState()
  const addDoc = (doc: ProjectDoc | null | undefined) => {
    if (!doc) return
    for (const path of collectProjectMediaPaths(doc, { includeDerived: true })) paths.add(path)
    if (doc.director) for (const id of collectDirectorSceneAssetIds(doc.director)) attachmentIds.add(id)
  }

  for (const item of items) {
    addDoc(item.id === graph.project.id ? graph.project : await loadProject(item.id))
    addDoc((await loadRecovery(item.id))?.doc)
  }
  for (const history of Object.values(graph.boardHistories)) {
    for (const snap of [...history.past, ...history.future]) {
      for (const path of collectCardsMediaPaths(Object.values(snap.cards), { includeDerived: true })) paths.add(path)
    }
  }
  for (const path of collectCardsMediaPaths(graph.clipboard.cards, { includeDerived: true })) paths.add(path)
  return { paths: [...paths], attachmentIds: [...attachmentIds] }
}

async function pruneDirectorAttachments(keepIds: string[]): Promise<number> {
  const store = window.mulby?.storage?.attachment
  if (!store?.list || !store?.remove) return 0
  const keep = new Set(keepIds)
  const known = new Map<string, { id: string }>()
  for (const prefix of ['glb_', 'director-env_', 'director-asset_']) {
    try {
      for (const item of await store.list(prefix)) known.set(item.id, item)
    } catch {
      /* 某一前缀列举失败不阻断其它前缀 */
    }
  }
  let removed = 0
  for (const id of known.keys()) {
    if (keep.has(id)) continue
    try { if (await store.remove(id)) removed++ } catch { /* best-effort */ }
  }
  return removed
}

// 记录"刚载入/新建/导入"的工程引用：App 的保存订阅据此跳过这次（非用户编辑引发的）变更，
// 避免载入/切换后立刻又把未改动的工程全量写一遍（尤其恢复快照）。任何真实编辑都会产生新引用→照常保存。
let lastLoaded: ProjectDoc | null = null
export function isLoadedRef(p: ProjectDoc): boolean {
  return p === lastLoaded
}
function applyLoaded(pid: string, doc: ProjectDoc) {
  lastLoaded = doc
  useGraph.getState().replaceProject(doc) // 同步触发订阅——此时 lastLoaded 已就位
  seedMainBaseline(pid, doc)
}

// 重开时把上次遗留的"进行中/排队"重置为闲置（任务已不在内存，避免卡死转圈）；补 parentId 默认。
// 例外：带持久化 taskId 的视频卡保留 running，由 resumeInflightVideos 断点续跑其轮询。
function sanitizeDoc(doc: ProjectDoc): ProjectDoc {
  for (const b of doc.boards)
    for (const c of Object.values(b.cards)) {
      if ((c as { parentId?: unknown }).parentId === undefined) (c as { parentId: string | null }).parentId = null
      if (c.status === 'running' || c.status === 'queued') {
        const task = (c.meta as { task?: { taskId?: unknown; provider?: unknown } })?.task
        if (c.kind === 'video' && task?.taskId && task?.provider) {
          c.status = 'running'
          if (!c.progress) c.progress = 0.5
        } else {
          c.status = 'idle'
          c.progress = 0
        }
      }
    }
  return doc
}

// 载入指定工程到 graphStore（含恢复快照询问）。name 用注册表元信息（注册表为工程名权威源）。
async function loadIntoGraph(pid: string, name?: string): Promise<void> {
  abortAllInflightVideos() // 切走前中止上一个工程的在途视频续跑，避免其完成回调落到新工程被丢弃
  let doc = (await loadProject(pid)) || (() => {
    const d = createDefaultProject(name || '未命名工程')
    d.id = pid
    return d
  })()
  if (name) doc = { ...doc, name }
  const rec = await loadRecovery(pid)
  let recovered = false
  if (rec?.doc) {
    const useRec = await confirmDialog({
      title: '恢复未保存的改动',
      message: '检测到该工程上次可能未正常保存的编辑，是否恢复到最近状态？',
      confirmLabel: '恢复',
      cancelLabel: '用已保存版本'
    })
    if (useRec) {
      doc = name ? { ...rec.doc, name } : rec.doc
      recovered = true
    } else {
      await clearRecovery(pid) // 用户选「用已保存版本」→ 丢弃快照
    }
  }
  if (doc.id !== pid) doc = { ...doc, id: pid } // 强制 doc.id 与注册表键一致——自动保存按 doc.id 键控（App.tsx），不容分叉
  sanitizeDoc(doc)
  await auditProjectMediaAvailability(doc)
  if (recovered) {
    // 恢复内容必须先全量写回主存、成功后才能删恢复快照：applyLoaded 会按本 doc 播种增量基线，
    // 若不先落盘，所有画布被判「未改动」而永不重写分片——磁盘主存仍是崩溃前旧数据，
    // 快照又已删除，下次重开即静默丢回旧版本。
    if (await saveProject(pid, doc)) await clearRecovery(pid)
    else toast('恢复内容写回主存失败，已保留恢复快照（重开工程可再次恢复）', 'error')
  }
  applyLoaded(pid, doc)
  void resumeInflightVideos() // 断点续跑：重开/切换后继续在途视频任务的轮询
}

interface ProjectState {
  items: ProjectMeta[]
  activeId: string | null
  ready: boolean
  init: () => Promise<void>
  newProject: (name?: string) => Promise<void>
  switchProject: (id: string) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  duplicateProject: (id: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  cleanupProjectMedia: (id: string) => Promise<void>
  exportProject: (id: string) => Promise<void>
  exportProjectWithMedia: (id: string) => Promise<void>
  importProject: (raw: unknown) => Promise<void>
  syncActiveMeta: (doc: ProjectDoc) => void
  flushSave: () => Promise<void>
}

export const useProject = create<ProjectState>((set, get) => ({
  items: [],
  activeId: null,
  ready: false,

  init: async () => {
    if (get().ready) return
    let reg = await migrateLegacyIfNeeded()
    if (!reg) reg = await loadRegistry()
    if (!reg || !reg.items.length) {
      const doc = createDefaultProject()
      await saveProject(doc.id, doc)
      reg = { activeId: doc.id, items: [metaOf(doc)] }
      await saveRegistry(reg)
    }
    const activeId = reg.activeId && reg.items.some((i) => i.id === reg!.activeId) ? reg.activeId : reg.items[0].id
    set({ items: reg.items, activeId, ready: true })
    const meta = reg.items.find((i) => i.id === activeId)
    await loadIntoGraph(activeId, meta?.name)
  },

  flushSave: async () => {
    const { activeId } = get()
    if (!activeId) return
    const doc = useGraph.getState().project
    await saveProject(activeId, doc)
    get().syncActiveMeta(doc)
  },

  syncActiveMeta: (doc) => {
    const { activeId, items } = get()
    if (!activeId) return
    const m = metaOf(doc)
    // 工程名以注册表为权威：若元信息里已有名字且与 doc 不同，仍以 doc.name 同步（顶栏改名即时反映）
    const next = items.some((it) => it.id === activeId)
      ? items.map((it) => (it.id === activeId ? { ...m } : it))
      : [...items, m]
    set({ items: next })
    void saveRegistry({ activeId, items: next })
  },

  newProject: async (name) => {
    await get().flushSave()
    const doc = createDefaultProject(name || `未命名工程 ${get().items.length + 1}`)
    await saveProject(doc.id, doc)
    const items = [...get().items, metaOf(doc)]
    set({ items, activeId: doc.id })
    await saveRegistry({ activeId: doc.id, items })
    sanitizeDoc(doc)
    applyLoaded(doc.id, doc)
  },

  switchProject: async (id) => {
    const { activeId, items } = get()
    if (id === activeId || !items.some((i) => i.id === id)) return
    await get().flushSave()
    if (activeId) await clearRecovery(activeId)
    set({ activeId: id })
    await saveRegistry({ activeId: id, items: get().items })
    const meta = get().items.find((i) => i.id === id)
    await loadIntoGraph(id, meta?.name)
  },

  renameProject: async (id, name) => {
    const trimmed = name.trim() || '未命名工程'
    const items = get().items.map((it) => (it.id === id ? { ...it, name: trimmed, updatedAt: Date.now() } : it))
    set({ items })
    await saveRegistry({ activeId: get().activeId, items })
    if (id === get().activeId) useGraph.getState().renameProject(trimmed)
  },

  duplicateProject: async (id) => {
    const src = id === get().activeId ? useGraph.getState().project : await loadProject(id)
    if (!src) {
      toast('复制失败：工程不存在', 'error')
      return
    }
    const now = Date.now()
    // 深拷贝 boards（含 cards/edges/annotations）——浅展开会让副本与原工程共享 board 对象引用，
    // 触发增量保存 baseline 误判（同引用=未改）。结构化克隆一次性切断共享。
    const copy: ProjectDoc = {
      ...src,
      id: uid('proj'),
      name: src.name + ' 副本',
      createdAt: now,
      updatedAt: now,
      boards: src.boards.map((b) => structuredClone(b))
    }
    await saveProject(copy.id, copy)
    const items = [...get().items, metaOf(copy)]
    set({ items })
    await saveRegistry({ activeId: get().activeId, items })
    toast('已复制工程', 'success')
  },

  deleteProject: async (id) => {
    const { items, activeId } = get()
    if (items.length <= 1) {
      const ok = await confirmDialog({ title: '清空工程', message: '这是唯一的工程，删除将清空为一个新的空工程。确定？', confirmLabel: '清空', cancelLabel: '取消' })
      if (!ok) return
      await deleteProjectStorage(id)
      void removeProjectMediaOnDisk(id) // 唯一工程被清空：无副本可引用，直接清盘
      const doc = createDefaultProject()
      await saveProject(doc.id, doc)
      const next = [metaOf(doc)]
      set({ items: next, activeId: doc.id })
      await saveRegistry({ activeId: doc.id, items: next })
      sanitizeDoc(doc)
      applyLoaded(doc.id, doc)
      void pruneDirectorAttachments([])
      return
    }
    const ok = await confirmDialog({ title: '删除工程', message: '将永久删除该工程及其所有画布/卡片（不可恢复）。确定？', confirmLabel: '删除', cancelLabel: '取消' })
    if (!ok) return
    const next = items.filter((i) => i.id !== id)
    if (id === activeId) {
      const target = next[0].id
      set({ items: next, activeId: target })
      await saveRegistry({ activeId: target, items: next })
      await deleteProjectStorage(id)
      const meta = next.find((i) => i.id === target)
      await loadIntoGraph(target, meta?.name)
    } else {
      set({ items: next })
      await saveRegistry({ activeId, items: next })
      await deleteProjectStorage(id)
    }
    // 引用感知清理：删除工程拥有的目录中，只回收未被副本/恢复快照/当前历史继续引用的文件。
    void (async () => {
      try {
        const refs = await collectLiveReferences(next)
        await pruneProjectMediaOnDisk(id, refs.paths, 0)
        await pruneDirectorAttachments(refs.attachmentIds)
      } catch {
        /* best-effort */
      }
    })()
    toast('工程已删除', 'success')
  },

  cleanupProjectMedia: async (id) => {
    if (!get().items.some((item) => item.id === id)) return
    if (id === get().activeId) await get().flushSave()
    const refs = await collectLiveReferences(get().items)
    // 全局扫描才能回收已删除原工程遗留、但曾被复制工程共享的旧目录。
    const result = await pruneProjectMediaOnDisk(id, refs.paths, 5 * 60_000, true)
    const removedAttachments = await pruneDirectorAttachments(refs.attachmentIds)
    if (!result.ok) {
      toast('媒体清理失败：' + (result.error || '宿主清理接口不可用'), 'error')
      return
    }
    const deferred = result.recent ? `，${result.recent} 个新文件暂缓清理` : ''
    toast(`已清理 ${result.removed} 个媒体文件和 ${removedAttachments} 个导演附件，释放 ${formatSize(result.reclaimedBytes)}${deferred}`, 'success')
  },

  exportProject: async (id) => {
    const doc = id === get().activeId ? useGraph.getState().project : await loadProject(id)
    if (!doc) {
      toast('导出失败：工程不存在', 'error')
      return
    }
    try {
      downloadJson(`${safeName(doc.name)}.acproj.json`, doc)
      toast('已导出（不含本地媒体文件，仅同机可恢复）', 'success')
    } catch (e: any) {
      toast('导出失败：' + (e?.message || String(e)), 'error')
    }
  },

  exportProjectWithMedia: async (id) => {
    const doc = id === get().activeId ? useGraph.getState().project : await loadProject(id)
    if (!doc) {
      toast('导出失败：工程不存在', 'error')
      return
    }
    try {
      // 主产物、节点素材、多结果、剪辑配方、导演 take 与附件统一去重后写入 v3 信封。
      const media: Record<string, PackedProjectMedia> = {}
      const mediaIndex: Record<string, string> = {}
      const attachments: Record<string, PackedProjectAttachment> = {}
      let total = 0
      let unread = 0
      for (const entry of collectProjectMedia(doc)) {
        try {
          const b64 = (await fsApi()?.readFile?.(entry.path, 'base64')) as string
          if (typeof b64 !== 'string' || !b64) throw new Error('empty media')
          total += b64.length
          if (total > MEDIA_EXPORT_CAP) {
            toast(`工程媒体过大（>${Math.round(MEDIA_EXPORT_CAP / 1024 / 1024)}MB），无法打包导出；请改用「导出 JSON」在同机恢复`, 'error')
            return
          }
          media[entry.id] = { b64, ext: extOfPath(entry.path), mime: entry.mime }
          mediaIndex[entry.path] = entry.id
        } catch {
          unread++
        }
      }
      let attachmentUnread = 0
      const attachmentStore = window.mulby?.storage?.attachment
      for (const attachmentId of doc.director ? collectDirectorSceneAssetIds(doc.director) : []) {
        try {
          const raw = await attachmentStore?.get?.(attachmentId)
          if (!raw) throw new Error('missing attachment')
          const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
          const dataBase64 = encodeDirectorSceneBytes(bytes)
          total += dataBase64.length
          if (total > MEDIA_EXPORT_CAP) {
            toast(`工程媒体过大（>${Math.round(MEDIA_EXPORT_CAP / 1024 / 1024)}MB），无法打包导出；请改用「导出 JSON」在同机恢复`, 'error')
            return
          }
          attachments[attachmentId] = {
            dataBase64,
            mimeType: await attachmentStore?.getType?.(attachmentId) || 'application/octet-stream'
          }
        } catch {
          attachmentUnread++
        }
      }
      downloadJson(`${safeName(doc.name)}.acmedia.json`, { __ac: 'project-with-media', version: 3, doc, media, mediaIndex, attachments })
      const n = Object.keys(media).length
      const attachmentCount = Object.keys(attachments).length
      const failedCount = unread + attachmentUnread
      const failed = failedCount ? `，${failedCount} 个资源无法读取` : ''
      toast(`已导出 ${n} 个媒体文件、${attachmentCount} 个导演附件（约 ${Math.round(total / 1024 / 1024)}MB，可跨机恢复）${failed}`, failedCount ? 'warning' : 'success')
    } catch (e: any) {
      toast('导出失败：' + (e?.message || String(e)), 'error')
    }
  },

  importProject: async (raw) => {
    // 兼容两种文件：含媒体信封 { __ac:'project-with-media', doc, media } 与裸 ProjectDoc
    const env = raw as ProjectMediaEnvelope
    const withMedia = env?.__ac === 'project-with-media' && env.doc && Array.isArray(env.doc.boards)
    const doc0 = (withMedia ? env.doc : raw) as ProjectDoc
    if (!doc0 || typeof doc0 !== 'object' || !Array.isArray(doc0.boards)) {
      toast('导入失败：不是有效的工程文件', 'error')
      return
    }
    await get().flushSave()
    const now = Date.now()
    const sourceDoc = structuredClone(doc0)
    const createdAttachmentIds: string[] = []
    let restoredAttachments = 0
    let missingAttachments = 0
    if (withMedia && sourceDoc.director) {
      const packed = env.attachments || {}
      const attachmentStore = window.mulby?.storage?.attachment
      const idMap = new Map<string, string>()
      for (const oldId of collectDirectorSceneAssetIds(sourceDoc.director)) {
        const attachment = packed[oldId]
        if (!attachment?.dataBase64) {
          try {
            if (await attachmentStore?.get?.(oldId)) continue // 旧包/同机导入：原附件仍可共享
          } catch { /* 继续按缺失处理 */ }
          missingAttachments++
          continue
        }
        try {
          const nextId = uid('director-asset')
          const result = await attachmentStore?.put?.(nextId, decodeDirectorSceneBase64(attachment.dataBase64), attachment.mimeType)
          const ok = result === true || !!(result && (result as { ok?: boolean }).ok)
          if (!ok) throw new Error('attachment write failed')
          createdAttachmentIds.push(nextId)
          idMap.set(oldId, nextId)
          restoredAttachments++
        } catch {
          try {
            if (await attachmentStore?.get?.(oldId)) continue
          } catch { /* 继续按缺失处理 */ }
          missingAttachments++
        }
      }
      sourceDoc.director = remapDirectorSceneAssetIds(sourceDoc.director, idMap)
    }
    const doc = migrateProject({ ...sourceDoc, id: uid('proj'), createdAt: sourceDoc.createdAt || now, updatedAt: now, name: sourceDoc.name || '导入的工程' })

    // 含媒体：每个物理文件只写回一次，再统一重写主产物、节点素材与历史结果中的全部引用。
    // v1 旧信封按 card id 恢复主产物；裸 JSON/缺包文件保留旧路径并显式标注缺失引用。
    const media = withMedia ? env.media || {} : {}
    let restored = 0
    const restoredByOldPath = new Map<string, RestoredProjectMedia>()
    if (withMedia && Number(env.version || 0) >= 2 && env.mediaIndex) {
      const expectedPaths = new Set(collectProjectMedia(doc).map((entry) => entry.path))
      const savedByMediaId = new Map<string, RestoredProjectMedia>()
      for (const [oldPath, mediaId] of Object.entries(env.mediaIndex)) {
        const m = media[mediaId]
        if (!expectedPaths.has(oldPath) || !m?.b64) continue
        let replacement = savedByMediaId.get(mediaId)
        if (!replacement) {
          try {
            const saved = await saveBase64(doc.id, `import_${mediaId}`, m.b64, m.ext || 'bin')
            replacement = { path: saved.path, url: saved.url, mime: m.mime }
            savedByMediaId.set(mediaId, replacement)
            restored++
          } catch {
            continue
          }
        }
        restoredByOldPath.set(oldPath, replacement)
      }
    } else if (withMedia) {
      for (const board of doc.boards) {
        for (const card of Object.values(board.cards)) {
          if (!card.assetLocalPath) continue
          const m = media[card.id]
          if (!m?.b64) continue
          try {
            const saved = await saveBase64(doc.id, card.id, m.b64, m.ext || 'bin')
            restoredByOldPath.set(card.assetLocalPath, { path: saved.path, url: toFileUrl(saved.path), mime: m.mime })
            restored++
          } catch {
            /* 写回失败由统一重写器标为缺失 */
          }
        }
      }
    }
    rewriteProjectMediaPaths(doc, restoredByOldPath, false)
    const availability = await auditProjectMediaAvailability(doc)
    const missing = availability.missingReferences

    const savedOk = await saveProject(doc.id, doc)
    if (!savedOk) {
      for (const attachmentId of createdAttachmentIds) {
        try { await window.mulby?.storage?.attachment?.remove?.(attachmentId) } catch { /* best-effort */ }
      }
      void removeProjectMediaOnDisk(doc.id)
      toast('导入失败：工程无法写入本地存储', 'error')
      return
    }
    const items = [...get().items, metaOf(doc)]
    set({ items, activeId: doc.id })
    await saveRegistry({ activeId: doc.id, items })
    sanitizeDoc(doc)
    applyLoaded(doc.id, doc)
    if (restored || missing || restoredAttachments || missingAttachments) {
      const missingTotal = missing + missingAttachments
      toast(
        `已导入工程（媒体文件 ${restored}，导演附件 ${restoredAttachments}${missingTotal ? `，缺失引用 ${missingTotal}` : ''}）`,
        missingTotal ? 'warning' : 'success'
      )
    } else {
      toast('已导入工程', 'success')
    }
  }
}))
