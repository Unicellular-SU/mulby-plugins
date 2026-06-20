import { create } from 'zustand'
import type { Board, Card, CardKind, Edge, ProjectDoc, Viewport } from '../types'
import { CARD_DEFAULT_SIZE, SCHEMA_VERSION } from '../types'
import { uid } from '../util'

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

interface GraphState {
  project: ProjectDoc
  selectedIds: string[]
  past: BoardSnap[]
  future: BoardSnap[]

  // 选择器（便捷）
  getActiveBoard: () => Board

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
  setDefaultModel: (kind: 'image' | 'text', id: string | null) => void
  setConcurrency: (n: number) => void

  // 画布(board)
  addBoard: () => void
  setActiveBoard: (id: string) => void
  renameBoard: (id: string, name: string) => void
  removeBoard: (id: string) => void

  // 视口
  setViewport: (vp: Viewport) => void

  // 卡片
  addCard: (kind: CardKind, world: { x: number; y: number }, partial?: Partial<Card>) => string
  updateCard: (id: string, patch: Partial<Card>) => void
  removeCards: (ids: string[]) => void
  moveCardsBy: (ids: string[], dx: number, dy: number) => void
  groupSelection: () => void

  // 连线
  addEdgeBetween: (source: string, target: string) => void
  removeEdge: (id: string) => void

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
  setStylePack: (stylePackId) => set((s) => ({ project: { ...s.project, stylePackId, updatedAt: Date.now() } })),
  setDefaultModel: (kind, id) =>
    set((s) => ({ project: { ...s.project, [kind === 'image' ? 'defaultImageModel' : 'defaultTextModel']: id, updatedAt: Date.now() } })),
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

  addCard: (kind, world, partial) => {
    get().pushHistory()
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
      ...partial
    }
    set((s) => ({
      project: withActiveBoard(s.project, (b) => ({ ...b, cards: { ...b.cards, [card.id]: card } })),
      selectedIds: [card.id]
    }))
    return card.id
  },

  groupSelection: () => {
    const s = get()
    const board = activeBoardOf(s.project)
    const ids = s.selectedIds.filter((id) => board.cards[id] && board.cards[id].kind !== 'group')
    if (ids.length === 0) return
    const cs = ids.map((id) => board.cards[id])
    const PAD = 28
    const HEAD = 36
    const minX = Math.min(...cs.map((c) => c.x)) - PAD
    const minY = Math.min(...cs.map((c) => c.y)) - PAD - HEAD
    const maxX = Math.max(...cs.map((c) => c.x + c.w)) + PAD
    const maxY = Math.max(...cs.map((c) => c.y + c.h)) + PAD
    get().addCard('group', { x: 0, y: 0 }, {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      title: '分组',
      params: { color: '#6366f1', collapsed: false, members: ids }
    })
  },

  updateCard: (id, patch) =>
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cur = b.cards[id]
        if (!cur) return b
        return { ...b, cards: { ...b.cards, [id]: { ...cur, ...patch } } }
      })
    })),

  removeCards: (ids) => {
    if (ids.length === 0) return
    get().pushHistory()
    const idSet = new Set(ids)
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        for (const id of ids) delete cards[id]
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
    const idSet = new Set(ids)
    set((s) => ({
      project: withActiveBoard(s.project, (b) => {
        const cards = { ...b.cards }
        for (const id of ids) {
          const c = cards[id]
          if (c) cards[id] = { ...c, x: c.x + dx, y: c.y + dy }
        }
        void idSet
        return { ...b, cards }
      })
    }))
  },

  addEdgeBetween: (source, target) => {
    if (source === target) return
    const b = activeBoardOf(get().project)
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
    const added: Record<string, Card> = {}
    const newIds: string[] = []
    for (const c of clip) {
      const id = uid('card')
      added[id] = { ...c, id, x: c.x + dx, y: c.y + dy }
      newIds.push(id)
    }
    set((s) => ({
      project: withActiveBoard(s.project, (b) => ({ ...b, cards: { ...b.cards, ...added } })),
      selectedIds: newIds,
      clipboard: Object.values(added).map((c) => ({ ...c })) // 级联粘贴：下次再偏移
    }))
  }
}))
