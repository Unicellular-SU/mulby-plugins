import { create } from 'zustand'
import type { Board, Card, CardKind, Edge, ProjectDoc, Viewport, GroupTemplate, Annotation } from '../types'
import { CARD_DEFAULT_SIZE, SCHEMA_VERSION } from '../types'
import { uid } from '../util'
import { canConnect } from '../services/connectionPolicy'
import { toast } from './toastStore'

const HISTORY_LIMIT = 100

interface BoardSnap {
  boardId: string
  cards: Record<string, Card>
  edges: Record<string, Edge>
}

function defaultTitle(kind: CardKind): string {
  switch (kind) {
    case 'image': return 'AI 图片'
    case 'video': return 'AI 视频'
    case 'text': return 'AI 文本'
    case 'audio': return 'AI 音频'
    case 'source': return '素材'
    case 'group': return '分组'
    case 'note': return '便签'
  }
}

export function createDefaultBoard(name = '画布 1'): Board {
  return { id: uid('board'), name, cards: {}, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }
}

export function createDefaultProject(name = '未命名工程'): ProjectDoc {
  const board = createDefaultBoard()
  const now = Date.now()
  return {
    id: uid('proj'),
    name,
    boards: [board],
    activeBoardId: board.id,
    globalModelId: null,
    style: '',
    defaultImageModel: null,
    defaultTextModel: null,
    concurrency: 4,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION
  }
}

function activeBoardOf(p: ProjectDoc): Board {
  return p.boards.find((b) => b.id === p.activeBoardId) ?? p.boards[0]
}

function withActiveBoard(p: ProjectDoc, fn: (b: Board) => Board): ProjectDoc {
  const boards = p.boards.map((b) => (b.id === p.activeBoardId ? fn(b) : b))
  return { ...p, boards, updatedAt: Date.now() }
}

// 卡片 id 全局唯一：异步写入（生成/媒体处理完成时）按 id 定位「真正拥有该卡的画布」，
// 而非当前活动画布——否则在生成途中切换画布会把结果写到错的画布上（跨板串卡 bug）。
function withBoardOfCard(p: ProjectDoc, cardId: string, fn: (b: Board) => Board): ProjectDoc {
  const owner = p.boards.find((b) => b.cards[cardId])
  if (!owner) return p
  const boards = p.boards.map((b) => (b.id === owner.id ? fn(b) : b))
  return { ...p, boards, updatedAt: Date.now() }
}

// 递归收集某组的所有后代（含嵌套组的后代）
function getDescendants(groupId: string, cards: Record<string, Card>): string[] {
  const out: string[] = []
  for (const c of Object.values(cards)) {
    if (c.parentId === groupId) {
      out.push(c.id)
      if (c.kind === 'group') out.push(...getDescendants(c.id, cards))
    }
  }
  return out
}
// 把 nodeId 设为 target 的子是否会成环（target 在 nodeId 的子树内）
function wouldCycle(nodeId: string, target: string | null, cards: Record<string, Card>): boolean {
  let cur = target
  while (cur) {
    if (cur === nodeId) return true
    cur = cards[cur]?.parentId ?? null
  }
  return false
}

interface GraphState {
  project: ProjectDoc
  selectedIds: string[]
  past: BoardSnap[]
  future: BoardSnap[]

  // 选择器（便捷）
  getActiveBoard: () => Board
  getCard: (id: string) => Card | undefined
  boardIdOfCard: (id: string) => string | undefined

  // 历史
  pushHistory: () => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean

  // 工程
  replaceProject: (p: ProjectDoc) => void
  renameProject: (name: string) => void
  setGlobalModel: (modelId: string | null) => void
  setStyle: (style: string) => void
  setStylePack: (id: string | undefined) => void
  setDefaultModel: (kind: 'image' | 'text' | 'pano' | 'control', id: string | null) => void
  setDirectorScene: (s: import('../types').DirectorScene | null) => void
  setConcurrency: (n: number) => void

  // 画布(board)
  addBoard: () => void
  setActiveBoard: (id: string) => void
  renameBoard: (id: string, name: string) => void
  removeBoard: (id: string) => void

  // 视口
  setViewport: (vp: Viewport) => void

  // 卡片
  addCard: (kind: CardKind, world: { x: number; y: number }, partial?: Partial<Card>, boardId?: string) => string
  updateCard: (id: string, patch: Partial<Card>) => void
  removeCards: (ids: string[]) => void
  moveCardsBy: (ids: string[], dx: number, dy: number) => void
  groupSelection: () => void
  applyParamsTo: (ids: string[], params: Record<string, unknown>) => void
  setParent: (ids: string[], parentId: string | null) => void
  insertTemplate: (tpl: GroupTemplate, world: { x: number; y: number }) => void

  // 连线
  addEdgeBetween: (source: string, target: string) => void
  connectAll: (sourceIds: string[], target: string) => void
  createConnectedNode: (kind: CardKind, world: { x: number; y: number }, sourceIds: string[]) => string
  removeEdge: (id: string) => void

  // 标注
  addAnnotation: (a: Annotation) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void

  // 选择
  setSelection: (ids: string[]) => void
  toggleSelect: (id: string, additive: boolean) => void
  clearSelection: () => void

  // 剪贴板
  clipboard: Card[]
  copySelection: () => void
  paste: (dx: number, dy: number) => void
}

export const useGraph = create<GraphState>((set, get) => ({
  project: createDefaultProject(),
  selectedIds: [],
  past: [],
  future: [],
  clipboard: [],

  getActiveBoard: () => activeBoardOf(get().project),
  getCard: (id) => {
    for (const b of get().project.boards) {
      const c = b.cards[id]
      if (c) return c
    }
    return undefined
  },
  boardIdOfCard: (id) => get().project.boards.find((b) => b.cards[id])?.id,

  pushHistory: () => {
    const b = activeBoardOf(get().project)
    const snap: BoardSnap = { boardId: b.id, cards: b.cards, edges: b.edges }
    set((s) => ({ past: [...s.past, snap].slice(-HISTORY_LIMIT), future: [] }))
  },

  undo: () => {
    const { past, project } = get()
    if (past.length === 0) return
    const snap = past[past.length - 1]
    const cur = activeBoardOf(project)
    const curSnap: BoardSnap = { boardId: cur.id, cards: cur.cards, edges: cur.edges }
    const boards = project.boards.map((b) =>
      b.id === snap.boardId ? { ...b, cards: snap.cards, edges: snap.edges } : b
    )
    set((s) => ({
      project: { ...project, boards, activeBoardId: snap.boardId, updatedAt: Date.now() },
      past: s.past.slice(0, -1),
      future: [curSnap, ...s.future].slice(0, HISTORY_LIMIT),
      selectedIds: []
    }))
  },

  redo: () => {
    const { future, project } = get()
    if (future.length === 0) return
    const snap = future[0]
    const cur = activeBoardOf(project)
    const curSnap: BoardSnap = { boardId: cur.id, cards: cur.cards, edges: cur.edges }
    const boards = project.boards.map((b) =>
      b.id === snap.boardId ? { ...b, cards: snap.cards, edges: snap.edges } : b
    )
    set((s) => ({
      project: { ...project, boards, activeBoardId: snap.boardId, updatedAt: Date.now() },
      past: [...s.past, curSnap].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
      selectedIds: []
    }))
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  replaceProject: (p) => set({ project: p, selectedIds: [], past: [], future: [] }),
  renameProject: (name) => set((s) => ({ project: { ...s.project, name, updatedAt: Date.now() } })),
  setGlobalModel: (modelId) => set((s) => ({ project: { ...s.project, globalModelId: modelId, updatedAt: Date.now() } })),
  setStyle: (style) => set((s) => ({ project: { ...s.project, style, updatedAt: Date.now() } })),
  setStylePack: (stylePackId) => set((s) => ({ project: withActiveBoard(s.project, (b) => ({ ...b, stylePackId })) })),
  setDefaultModel: (kind, id) =>
    set((s) => ({
      project: {
        ...s.project,
        [kind === 'image' ? 'defaultImageModel' : kind === 'pano' ? 'defaultPanoModel' : kind === 'control' ? 'defaultControlModel' : 'defaultTextModel']: id,
        updatedAt: Date.now()
      }
    })),
  setDirectorScene: (s2) => set((s) => ({ project: { ...s.project, director: s2, updatedAt: Date.now() } })),
  setConcurrency: (concurrency) => set((s) => ({ project: { ...s.project, concurrency, updatedAt: Date.now() } })),

  addBoard: () => {
    const board = createDefaultBoard(`画布 ${get().project.boards.length + 1}`)
    set((s) => ({
      project: { ...s.project, boards: [...s.project.boards, board], activeBoardId: board.id, updatedAt: Date.now() },
      selectedIds: [],
      past: [],
      future: []
    }))
  },
  setActiveBoard: (id) =>
    set((s) => ({ project: { ...s.project, activeBoardId: id }, selectedIds: [], past: [], future: [] })),
  renameBoard: (id, name) =>
    set((s) => ({
      project: { ...s.project, boards: s.project.boards.map((b) => (b.id === id ? { ...b, name } : b)), updatedAt: Date.now() }
    })),
  removeBoard: (id) =>
    set((s) => {
      if (s.project.boards.length <= 1) return s
      const boards = s.project.boards.filter((b) => b.id !== id)
      const activeBoardId = s.project.activeBoardId === id ? boards[0].id : s.project.activeBoardId
      return { project: { ...s.project, boards, activeBoardId, updatedAt: Date.now() }, selectedIds: [], past: [], future: [] }
    }),

  setViewport: (vp) => set((s) => ({ project: withActiveBoard(s.project, (b) => ({ ...b, viewport: vp })) })),

  addCard: (kind, world, partial, boardId) => {
    const proj = get().project
    const targetId = boardId ?? proj.activeBoardId
    const target = proj.boards.find((b) => b.id === targetId) ?? activeBoardOf(proj)
    const isActive = target.id === proj.activeBoardId
    // 历史快照取「目标画布」（异步媒体处理完成可能写非活动画布）
    set((s) => ({ past: [...s.past, { boardId: target.id, cards: target.cards, edges: target.edges }].slice(-HISTORY_LIMIT), future: [] }))
    const size = CARD_DEFAULT_SIZE[kind]
    const card: Card = {
      id: uid('card'),
      kind,
      x: Math.round(world.x - size.w / 2),
      y: Math.round(world.y - size.h / 2),
      w: size.w,
      h: size.h,
      title: defaultTitle(kind),
      prompt: '',
      modelId: null,
      providerId: null,
      params: {},
      status: 'idle',
      progress: 0,
      error: null,
      assetUrl: null,
      assetLocalPath: null,
      attachmentId: null,
      mime: null,
      text: null,
      refIds: [],
      assets: [],
      meta: {},
      parentId: null,
      ...partial
    }
    set((s) => ({
      project: {
        ...s.project,
        updatedAt: Date.now(),
        boards: s.project.boards.map((b) => (b.id === target.id ? { ...b, cards: { ...b.cards, [card.id]: card } } : b))
      },
      // 仅当写入活动画布时才改选中（避免选中一张当前看不见的卡）
      selectedIds: isActive ? [card.id] : s.selectedIds
    }))
    return card.id
  },

  groupSelection: () => {
    const board = activeBoardOf(get().project)
    const ids = get().selectedIds.filter((id) => !!board.cards[id]) // 允许把已有组也编入（嵌套）
    if (ids.length === 0) return
    const cs = ids.map((id) => board.cards[id])
    const PAD = 28
    const HEAD = 36
    const minX = Math.min(...cs.map((c) => c.x)) - PAD
    const minY = Math.min(...cs.map((c) => c.y)) - PAD - HEAD
    const maxX = Math.max(...cs.map((c) => c.x + c.w)) + PAD
    const maxY = Math.max(...cs.map((c) => c.y + c.h)) + PAD
    // 若新组完全落在某个已存在组内 → 自动嵌套（取最深的）
    let nestParent: string | null = null
    let bestArea = Infinity
    for (const c of Object.values(board.cards)) {
      if (c.kind !== 'group' || ids.includes(c.id)) continue
      if (minX >= c.x && minY >= c.y && maxX <= c.x + c.w && maxY <= c.y + c.h && c.w * c.h < bestArea) {
        bestArea = c.w * c.h
        nestParent = c.id
      }
    }
    const groupId = uid('card')
    get().pushHistory()
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        cards[groupId] = {
          id: groupId, kind: 'group', x: minX, y: minY, w: maxX - minX, h: maxY - minY,
          title: '分组', prompt: '', modelId: null, providerId: null,
          params: { color: '#6366f1', collapsed: false }, status: 'idle', progress: 0, error: null,
          assetUrl: null, assetLocalPath: null, attachmentId: null, mime: null, text: null,
          refIds: [], assets: [], meta: {}, parentId: nestParent
        }
        for (const id of ids) cards[id] = { ...cards[id], parentId: groupId }
        return { ...b, cards }
      }),
      selectedIds: [groupId]
    }))
  },

  setParent: (ids, parentId) => {
    if (ids.length === 0) return
    const cards0 = activeBoardOf(get().project).cards
    const valid = ids.filter((id) => cards0[id] && !wouldCycle(id, parentId, cards0))
    if (valid.length === 0) return
    get().pushHistory()
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        for (const id of valid) if (cards[id]) cards[id] = { ...cards[id], parentId }
        return { ...b, cards }
      })
    }))
  },

  insertTemplate: (tpl, world) => {
    get().pushHistory()
    const idMap = new Map<string, string>()
    const groupId = uid('card')
    for (const m of tpl.members) idMap.set(m.localId, uid('card'))
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        cards[groupId] = {
          id: groupId, kind: 'group', x: Math.round(world.x), y: Math.round(world.y), w: tpl.group.w, h: tpl.group.h,
          title: tpl.group.title, prompt: '', modelId: null, providerId: null,
          params: { ...tpl.group.params, collapsed: false }, status: 'idle', progress: 0, error: null,
          assetUrl: null, assetLocalPath: null, attachmentId: null, mime: null, text: null,
          refIds: [], assets: [], meta: {}, parentId: null
        }
        for (const m of tpl.members) {
          const nid = idMap.get(m.localId) as string
          const pid = m.parentLocalId ? (idMap.get(m.parentLocalId) ?? groupId) : groupId
          cards[nid] = {
            ...m.card,
            id: nid,
            parentId: pid,
            x: Math.round(world.x + m.card.x),
            y: Math.round(world.y + m.card.y),
            assetUrl: null, assetLocalPath: null, attachmentId: null,
            status: 'idle', progress: 0, error: null
          }
        }
        const edges = { ...b.edges }
        for (const e of tpl.edges) {
          const sid = idMap.get(e.source)
          const tid = idMap.get(e.target)
          if (sid && tid) {
            let eid = uid('edge')
            while (edges[eid]) eid = uid('edge')
            edges[eid] = { id: eid, source: sid, target: tid, kind: e.kind }
          }
        }
        return { ...b, cards, edges }
      }),
      selectedIds: [groupId]
    }))
  },

  updateCard: (id, patch) =>
    set((s) => ({
      // 按 id 定位拥有该卡的画布（异步生成途中切换画布也写对地方）
      project: withBoardOfCard(s.project, id, (b) => {
        const cur = b.cards[id]
        if (!cur) return b
        return { ...b, cards: { ...b.cards, [id]: { ...cur, ...patch } } }
      })
    })),

  applyParamsTo: (ids, params) => {
    if (ids.length === 0) return
    get().pushHistory()
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        for (const id of ids) {
          const c = cards[id]
          if (c) cards[id] = { ...c, params: { ...c.params, ...params } }
        }
        return { ...b, cards }
      })
    }))
  },

  removeCards: (ids) => {
    if (ids.length === 0) return
    get().pushHistory()
    const idSet = new Set(ids)
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        // 记录被删卡的父，删除后把其直接子上提到（仍存在的）祖先，保留嵌套层级
        const parentOf = new Map<string, string | null>()
        for (const id of ids) {
          const c = cards[id]
          if (c) parentOf.set(id, c.parentId)
          delete cards[id]
        }
        const resolveParent = (p: string | null): string | null => {
          let cur = p
          while (cur && parentOf.has(cur)) cur = parentOf.get(cur) ?? null
          return cur
        }
        for (const k of Object.keys(cards)) {
          const p = cards[k].parentId
          if (p && parentOf.has(p)) cards[k] = { ...cards[k], parentId: resolveParent(p) }
        }
        const edges: Record<string, Edge> = {}
        for (const [eid, e] of Object.entries(b.edges)) {
          if (!idSet.has(e.source) && !idSet.has(e.target)) edges[eid] = e
        }
        return { ...b, cards, edges }
      }),
      selectedIds: s.selectedIds.filter((id) => !idSet.has(id))
    }))
  },

  moveCardsBy: (ids, dx, dy) => {
    if (ids.length === 0 || (dx === 0 && dy === 0)) return
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        const toMove = new Set(ids)
        for (const id of ids) for (const d of getDescendants(id, b.cards)) toMove.add(d)
        for (const id of toMove) {
          const c = cards[id]
          if (c) cards[id] = { ...c, x: Math.round(c.x + dx), y: Math.round(c.y + dy) }
        }
        return { ...b, cards }
      })
    }))
  },

  addEdgeBetween: (source, target) => {
    if (source === target) return
    const b = activeBoardOf(get().project)
    const s = b.cards[source]
    const t = b.cards[target]
    if (!s || !t) return
    const v = canConnect(s, t)
    if (!v.ok) {
      toast(v.reason || '无法连接', 'warning')
      return
    }
    const dup = Object.values(b.edges).some((e) => e.source === source && e.target === target)
    if (dup) return
    get().pushHistory()
    const edge: Edge = { id: uid('edge'), source, target, kind: 'ref' }
    set((s) => ({
      project: withActiveBoard(s.project, (bd) => ({ ...bd, edges: { ...bd.edges, [edge.id]: edge } }))
    }))
  },

  removeEdge: (id) => {
    get().pushHistory()
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const edges = { ...b.edges }
        delete edges[id]
        return { ...b, edges }
      })
    }))
  },

  // 标注（不入撤销栈——BoardSnap 不含 annotations；删除/清空即可逆操作）
  addAnnotation: (a) => set((s) => ({ project: withActiveBoard(s.project, (b) => ({ ...b, annotations: [...(b.annotations || []), a] })) })),
  removeAnnotation: (id) => set((s) => ({ project: withActiveBoard(s.project, (b) => ({ ...b, annotations: (b.annotations || []).filter((x) => x.id !== id) })) })),
  clearAnnotations: () => set((s) => ({ project: withActiveBoard(s.project, (b) => ({ ...b, annotations: [] })) })),

  connectAll: (sourceIds, target) => {
    const b = activeBoardOf(get().project)
    if (!b.cards[target]) return
    const toAdd = sourceIds.filter(
      (sid) =>
        sid !== target &&
        b.cards[sid] &&
        canConnect(b.cards[sid], b.cards[target]).ok &&
        !Object.values(b.edges).some((e) => e.source === sid && e.target === target)
    )
    if (toAdd.length === 0) return
    get().pushHistory()
    set((s) => ({
      project: withActiveBoard(s.project, (bd) => {
        const edges = { ...bd.edges }
        for (const sid of toAdd) {
          const id = uid('edge')
          edges[id] = { id, source: sid, target, kind: 'ref' }
        }
        return { ...bd, edges }
      })
    }))
  },

  createConnectedNode: (kind, world, sourceIds) => {
    const size = CARD_DEFAULT_SIZE[kind]
    const id = uid('card')
    get().pushHistory()
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const card: Card = {
          id, kind, x: Math.round(world.x - size.w / 2), y: Math.round(world.y - size.h / 2), w: size.w, h: size.h,
          title: defaultTitle(kind), prompt: '', modelId: null, providerId: null, params: {}, status: 'idle', progress: 0,
          error: null, assetUrl: null, assetLocalPath: null, attachmentId: null, mime: null, text: null, refIds: [], assets: [], meta: {}, parentId: null
        }
        const cards = { ...b.cards, [id]: card }
        const edges = { ...b.edges }
        for (const sid of sourceIds) {
          if (sid === id || !cards[sid]) continue
          if (Object.values(edges).some((e) => e.source === sid && e.target === id)) continue
          const eid = uid('edge')
          edges[eid] = { id: eid, source: sid, target: id, kind: 'ref' }
        }
        return { ...b, cards, edges }
      }),
      selectedIds: [id]
    }))
    return id
  },

  setSelection: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id, additive) =>
    set((s) => {
      if (!additive) return { selectedIds: [id] }
      return s.selectedIds.includes(id)
        ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
        : { selectedIds: [...s.selectedIds, id] }
    }),
  clearSelection: () => set({ selectedIds: [] }),

  copySelection: () => {
    const b = activeBoardOf(get().project)
    const cards = get()
      .selectedIds.map((id) => b.cards[id])
      .filter(Boolean)
      .map((c) => ({ ...c }))
    set({ clipboard: cards })
  },

  paste: (dx, dy) => {
    const clip = get().clipboard
    if (clip.length === 0) return
    get().pushHistory()
    const idMap = new Map<string, string>()
    for (const c of clip) idMap.set(c.id, uid('card'))
    const added: Record<string, Card> = {}
    const newIds: string[] = []
    for (const c of clip) {
      const id = idMap.get(c.id) as string
      const pid = c.parentId ? (idMap.get(c.parentId) ?? null) : null // 保留剪贴板内的父子关系，外部父置空
      added[id] = { ...c, id, x: c.x + dx, y: c.y + dy, parentId: pid }
      newIds.push(id)
    }
    set((s) => ({
      project: withActiveBoard(s.project, (b) => ({ ...b, cards: { ...b.cards, ...added } })),
      selectedIds: newIds,
      clipboard: Object.values(added).map((c) => ({ ...c })) // 级联粘贴：下次再偏移
    }))
  }
}))
