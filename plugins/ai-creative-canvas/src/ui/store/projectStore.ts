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
import { confirmDialog } from './dialogStore'
import { toast } from './toastStore'

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
  if (rec?.doc) {
    const useRec = await confirmDialog({
      title: '恢复未保存的改动',
      message: '检测到该工程上次可能未正常保存的编辑，是否恢复到最近状态？',
      confirmLabel: '恢复',
      cancelLabel: '用已保存版本'
    })
    if (useRec) doc = name ? { ...rec.doc, name } : rec.doc
    await clearRecovery(pid)
  }
  if (doc.id !== pid) doc = { ...doc, id: pid } // 强制 doc.id 与注册表键一致——自动保存按 doc.id 键控（App.tsx），不容分叉
  sanitizeDoc(doc)
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
  exportProject: (id: string) => Promise<void>
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
      const doc = createDefaultProject()
      await saveProject(doc.id, doc)
      const next = [metaOf(doc)]
      set({ items: next, activeId: doc.id })
      await saveRegistry({ activeId: doc.id, items: next })
      sanitizeDoc(doc)
      applyLoaded(doc.id, doc)
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
    toast('工程已删除', 'success')
  },

  exportProject: async (id) => {
    const doc = id === get().activeId ? useGraph.getState().project : await loadProject(id)
    if (!doc) {
      toast('导出失败：工程不存在', 'error')
      return
    }
    try {
      const json = JSON.stringify(doc, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(doc.name || 'project').replace(/[^\w.\-]+/g, '_')}.acproj.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('已导出（不含本地媒体文件）', 'success')
    } catch (e: any) {
      toast('导出失败：' + (e?.message || String(e)), 'error')
    }
  },

  importProject: async (raw) => {
    const doc0 = raw as ProjectDoc
    if (!doc0 || typeof doc0 !== 'object' || !Array.isArray(doc0.boards)) {
      toast('导入失败：不是有效的工程文件', 'error')
      return
    }
    await get().flushSave()
    const now = Date.now()
    const doc = migrateProject({ ...doc0, id: uid('proj'), createdAt: doc0.createdAt || now, updatedAt: now, name: doc0.name || '导入的工程' })
    await saveProject(doc.id, doc)
    const items = [...get().items, metaOf(doc)]
    set({ items, activeId: doc.id })
    await saveRegistry({ activeId: doc.id, items })
    sanitizeDoc(doc)
    applyLoaded(doc.id, doc)
    toast('已导入工程', 'success')
  }
}))
