// 剪辑工作台会话态：EditStack + undo/redo + 选中 op + busy/progress + AbortController
// 设计依据：docs/ai-creative-canvas-video-editor.md §3.0(撤销栈/取消) / §5(交互流) / §6(持久化)

import { create } from 'zustand'
import { useGraph } from './graphStore'
import { useTask } from './taskStore'
import { toast } from './toastStore'
import { toFileUrl } from '../services/media'
import { saveToLocal } from '../services/saveLocal'
import { exportStudio } from '../services/videoEdit/run'
import { createOp, type EditOp, type EditStack, type OpKind, type ExportParams, type OverlayParams, type EditRecipe } from '../services/videoEdit/types'
import type { OverlayInput } from '../services/videoEdit/compile'

function clone(s: EditStack): EditStack {
  return JSON.parse(JSON.stringify(s))
}

// 插入 op 时保持 export 永远在尾；同 kind 的 export 替换而非追加
function insertOp(ops: EditOp[], op: EditOp): EditOp[] {
  if (op.kind === 'export') {
    const rest = ops.filter((o) => o.kind !== 'export')
    return [...rest, op]
  }
  const expIdx = ops.findIndex((o) => o.kind === 'export')
  if (expIdx < 0) return [...ops, op]
  return [...ops.slice(0, expIdx), op, ...ops.slice(expIdx)]
}

function mimeKindFor(format: ExportParams['format']): { kind: 'video' | 'source'; mime: string } {
  switch (format) {
    case 'gif':
      return { kind: 'source', mime: 'image/gif' }
    case 'webp':
      return { kind: 'source', mime: 'image/webp' }
    case 'webm':
      return { kind: 'video', mime: 'video/webm' }
    default:
      return { kind: 'video', mime: 'video/mp4' }
  }
}

interface StudioState {
  cardId: string | null
  stack: EditStack | null
  selectedOpId: string | null
  busy: boolean
  progress: number
  abort: AbortController | null
  // undo/redo
  history: EditStack[]
  cursor: number

  open: (cardId: string, base: { duration: number; w: number; h: number; rotation?: 0 | 90 | 180 | 270 }, recipe?: EditRecipe | null) => void
  close: () => void
  setBase: (base: Partial<Pick<EditStack, 'baseDuration' | 'baseW' | 'baseH' | 'baseRotation' | 'needsNormalize'>>) => void

  addOp: (kind: OpKind, params?: Record<string, unknown>) => void
  updateOp: (id: string, patch: Record<string, unknown>) => void // 提交进历史
  updateOpLive: (id: string, patch: Record<string, unknown>) => void // 拖拽中：不入历史
  commitLive: () => void // 松手：把当前 live 态压入历史
  toggleOp: (id: string) => void
  removeOp: (id: string) => void
  moveOp: (id: string, dir: -1 | 1) => void
  selectOp: (id: string | null) => void

  canUndo: () => boolean
  canRedo: () => boolean
  undo: () => void
  redo: () => void

  exportStack: (saveLocal?: boolean) => Promise<void>
  cancel: () => void
}

export const useStudio = create<StudioState>((set, get) => {
  const HISTORY_MAX = 100 // 历史上限：每份是整栈深克隆，长会话防内存膨胀

  // 把新 stack 提交进历史（截断 redo 尾），并设为当前
  const commit = (next: EditStack) => {
    const { history, cursor } = get()
    const trimmed = history.slice(0, cursor + 1)
    trimmed.push(clone(next))
    // 超过上限则从头丢弃最旧快照（cursor 恒指向新压入的末项）
    const capped = trimmed.length > HISTORY_MAX ? trimmed.slice(trimmed.length - HISTORY_MAX) : trimmed
    set({ stack: next, history: capped, cursor: capped.length - 1 })
  }

  return {
    cardId: null,
    stack: null,
    selectedOpId: null,
    busy: false,
    progress: 0,
    abort: null,
    history: [],
    cursor: -1,

    open: (cardId, base, recipe) => {
      const ops: EditOp[] = recipe?.ops ? JSON.parse(JSON.stringify(recipe.ops)) : []
      if (!ops.some((o) => o.kind === 'export')) ops.push(createOp('export')) // 栈尾恒有一个导出 op
      const stack: EditStack = {
        ops,
        version: 1,
        baseDuration: base.duration,
        baseW: base.w,
        baseH: base.h,
        baseRotation: base.rotation
      }
      set({ cardId, stack, selectedOpId: stack.ops[0]?.id || null, history: [clone(stack)], cursor: 0, progress: 0, busy: false })
    },

    close: () => {
      const { busy } = get()
      if (busy) return
      set({ cardId: null, stack: null, selectedOpId: null, history: [], cursor: -1, progress: 0 })
    },

    setBase: (base) => {
      const { stack } = get()
      if (!stack) return
      set({ stack: { ...stack, ...base } })
    },

    addOp: (kind, params) => {
      const { stack } = get()
      if (!stack) return
      const op = createOp(kind, params as never)
      commit({ ...stack, ops: insertOp(stack.ops, op) })
      set({ selectedOpId: op.id })
    },

    updateOp: (id, patch) => {
      const { stack } = get()
      if (!stack) return
      commit({ ...stack, ops: stack.ops.map((o) => (o.id === id ? ({ ...o, params: { ...o.params, ...patch } } as EditOp) : o)) })
    },

    updateOpLive: (id, patch) => {
      const { stack } = get()
      if (!stack) return
      set({ stack: { ...stack, ops: stack.ops.map((o) => (o.id === id ? ({ ...o, params: { ...o.params, ...patch } } as EditOp) : o)) } })
    },

    commitLive: () => {
      const { stack, history, cursor } = get()
      if (!stack) return
      // 与当前历史顶比较：点击滑块未拖动 / Tab 路过滑块的 keyup 也会触发 onCommit，
      // 此时 stack 未变，不应压入重复 undo 步（否则 Ctrl+Z 表现为「按了没反应」，还撑大历史）。
      if (cursor >= 0 && history[cursor] && JSON.stringify(history[cursor]) === JSON.stringify(stack)) return
      commit(stack)
    },

    toggleOp: (id) => {
      const { stack } = get()
      if (!stack) return
      commit({ ...stack, ops: stack.ops.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o)) })
    },

    removeOp: (id) => {
      const { stack, selectedOpId } = get()
      if (!stack) return
      commit({ ...stack, ops: stack.ops.filter((o) => o.id !== id) })
      if (selectedOpId === id) set({ selectedOpId: null })
    },

    moveOp: (id, dir) => {
      const { stack } = get()
      if (!stack) return
      const ops = [...stack.ops]
      const i = ops.findIndex((o) => o.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ops.length) return
      if (ops[i].kind === 'export' || ops[j].kind === 'export') return // export 锁尾，不参与重排
      ;[ops[i], ops[j]] = [ops[j], ops[i]]
      commit({ ...stack, ops })
    },

    selectOp: (id) => set({ selectedOpId: id }),

    canUndo: () => get().cursor > 0,
    canRedo: () => get().cursor < get().history.length - 1,
    undo: () => {
      const { cursor, history } = get()
      if (cursor <= 0) return
      const c = cursor - 1
      set({ cursor: c, stack: clone(history[c]) })
    },
    redo: () => {
      const { cursor, history } = get()
      if (cursor >= history.length - 1) return
      const c = cursor + 1
      set({ cursor: c, stack: clone(history[c]) })
    },

    exportStack: async (saveLocal?: boolean) => {
      const { cardId, stack, busy } = get()
      if (!cardId || !stack || busy) return
      const g = useGraph.getState()
      const board = g.getActiveBoard()
      const src = board.cards[cardId]
      if (!src?.assetLocalPath) {
        toast('请对本地视频文件使用', 'error')
        return
      }
      const boardId = g.boardIdOfCard(cardId)
      const projectId = g.project.id
      const inPath = src.assetLocalPath
      const expOp = stack.ops.find((o) => o.kind === 'export' && o.enabled)
      const format = ((expOp?.params as ExportParams)?.format || 'mp4') as ExportParams['format']
      const { kind, mime } = mimeKindFor(format)

      // 解析 PiP 子画面：把 overlay(pip) 的源视频卡 → 本地路径，作为视频输入交给编译器
      const pipResolved: Record<string, OverlayInput> = {}
      for (const op of stack.ops) {
        if (op.kind !== 'overlay' || !op.enabled) continue
        const pp = op.params as OverlayParams
        if (pp.sub !== 'pip' || !pp.pipCardId) continue
        const c = board.cards[pp.pipCardId]
        if (!c?.assetLocalPath) {
          toast(`画中画源「${c?.title || '已删除'}」不可用，请重新指定或移除该层`, 'error')
          return
        }
        pipResolved[op.id] = { kind: 'video', path: c.assetLocalPath }
      }

      const abort = new AbortController()
      set({ busy: true, progress: 0, abort })
      useTask.getState().inc()
      try {
        const { finalOut } = await exportStudio(
          stack,
          { inPath, projectId, overlayResolved: pipResolved },
          { signal: abort.signal, onProgress: (p) => set({ progress: p }) }
        )
        const recipe: EditRecipe = { ops: stack.ops, version: 1, baseDuration: stack.baseDuration }
        const id = g.addCard('video', { x: src.x + src.w + 200, y: src.y + src.h / 2 }, { title: `${src.title} · 剪辑`, status: 'done', refIds: [src.id] }, boardId)
        const kindFix = kind // gif/webp 落 source 卡，mp4/webm 落 video 卡
        g.updateCard(id, {
          kind: kindFix,
          assetUrl: toFileUrl(finalOut),
          assetLocalPath: finalOut,
          mime,
          meta: { editRecipe: recipe, sourcePath: inPath, recipeSource: src.id }
        })
        g.setSelection([id])
        toast('已导出剪辑成片', 'success')
        if (saveLocal) await saveToLocal(finalOut, `${src.title}·剪辑`)
        set({ busy: false, abort: null })
        get().close()
      } catch (e: any) {
        if (e?.name === 'AbortError') toast('已取消导出', 'info')
        else toast('导出失败：' + (e?.message || String(e)), 'error')
        set({ busy: false, abort: null })
      } finally {
        useTask.getState().dec()
      }
    },

    cancel: () => {
      get().abort?.abort()
    }
  }
})
