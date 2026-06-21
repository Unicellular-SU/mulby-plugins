import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type DragEvent as RDragEvent, type MouseEvent as RMouseEvent } from 'react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { CardView } from './CardView'
import { GroupView } from './GroupView'
import { EdgeLayer } from './EdgeLayer'
import { GridLayer } from './GridLayer'
import { CanvasControls } from './CanvasControls'
import { Minimap } from './Minimap'
import { SelectionBox, type ScreenRect } from './SelectionBox'
import { ConnectMenu } from './ConnectMenu'
import { NodeEditor } from './NodeEditor'
import { Lightbox } from './Lightbox'
import { BatchActions } from './BatchActions'
import { ContextMenu } from '../components/ContextMenu'
import type { CardKind } from '../types'
import { isCardInsideGroup } from '../types'
import { fitToCards, rectsIntersect, screenToWorld, zoomAt } from './viewport'
import { importFiles } from '../services/importMedia'
import { stageEl } from './stageEl'

type Interaction =
  | { mode: 'idle' }
  | { mode: 'pan'; lastX: number; lastY: number }
  | { mode: 'drag'; ids: string[]; lastX: number; lastY: number; moved: boolean }
  | { mode: 'marquee'; startSX: number; startSY: number; curSX: number; curSY: number; additive: boolean; baseSel: string[] }

const DRAG_THRESHOLD = 3

export function CanvasStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const inter = useRef<Interaction>({ mode: 'idle' })
  const spaceRef = useRef(false)
  const panAcc = useRef({ dx: 0, dy: 0 })
  const dragAcc = useRef({ dx: 0, dy: 0 })
  const rafId = useRef<number | null>(null)

  const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing'>('default')
  const [marquee, setMarquee] = useState<ScreenRect | null>(null)

  const board = useGraph((s) => s.getActiveBoard())
  const selectedIds = useGraph((s) => s.selectedIds)
  const showGrid = useUi((s) => s.showGrid)
  const showMinimap = useUi((s) => s.showMinimap)
  const connectTemp = useUi((s) => s.connectTemp)
  const vp = board.viewport
  const selSet = new Set(selectedIds)
  const hiddenMembers = new Set<string>()
  const hideDesc = (gid: string) => {
    for (const c of Object.values(board.cards)) if (c.parentId === gid) { hiddenMembers.add(c.id); if (c.kind === 'group') hideDesc(c.id) }
  }
  for (const c of Object.values(board.cards)) if (c.kind === 'group' && c.params?.collapsed) hideDesc(c.id)

  const getRect = () => stageRef.current?.getBoundingClientRect() ?? new DOMRect()

  const doFit = () => {
    const rect = getRect()
    const g = useGraph.getState()
    const b = g.getActiveBoard()
    g.setViewport(fitToCards(Object.values(b.cards), rect.width, rect.height))
  }

  const onDrop = (e: RDragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const rect = getRect()
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, useGraph.getState().getActiveBoard().viewport)
    // 从左侧拖组件 → 新建对应卡片
    const kind = e.dataTransfer?.getData('application/x-ace-kind')
    if (kind) {
      useGraph.getState().addCard(kind as CardKind, world)
      return
    }
    const files = e.dataTransfer?.files
    if (files && files.length) void importFiles(files, world)
  }

  const flush = () => {
    rafId.current = null
    const g = useGraph.getState()
    const cur = g.getActiveBoard().viewport
    if (panAcc.current.dx || panAcc.current.dy) {
      g.setViewport({ ...cur, x: cur.x + panAcc.current.dx, y: cur.y + panAcc.current.dy })
      panAcc.current = { dx: 0, dy: 0 }
    }
    if ((dragAcc.current.dx || dragAcc.current.dy) && inter.current.mode === 'drag') {
      g.moveCardsBy(inter.current.ids, dragAcc.current.dx / cur.zoom, dragAcc.current.dy / cur.zoom)
      dragAcc.current = { dx: 0, dy: 0 }
    }
  }
  const schedule = () => {
    if (rafId.current == null) rafId.current = requestAnimationFrame(flush)
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-interactive]')) return // 让卡片内的交互元素自行处理
    const rect = getRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const g = useGraph.getState()

    // 中键 / 空格 → 平移
    if (e.button === 1 || spaceRef.current) {
      inter.current = { mode: 'pan', lastX: e.clientX, lastY: e.clientY }
      setCursor('grabbing')
      try { stageRef.current?.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return

    const cardEl = target.closest('[data-card-id]') as HTMLElement | null
    if (cardEl) {
      const id = cardEl.dataset.cardId as string
      if (e.shiftKey) {
        g.toggleSelect(id, true)
        inter.current = { mode: 'idle' }
        return
      }
      const sel = g.selectedIds
      const baseIds = sel.includes(id) ? sel : [id]
      if (!sel.includes(id)) g.setSelection([id])
      // 拖动时带上后代（含嵌套组），按 parentId 递归
      const board0 = g.getActiveBoard()
      const idSet = new Set(baseIds)
      const addDesc = (nodeId: string) => {
        for (const c of Object.values(board0.cards)) if (c.parentId === nodeId) { idSet.add(c.id); addDesc(c.id) }
      }
      for (const bid of baseIds) addDesc(bid)
      inter.current = { mode: 'drag', ids: [...idSet], lastX: e.clientX, lastY: e.clientY, moved: false }
      try { stageRef.current?.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    } else {
      if (!e.shiftKey) g.clearSelection()
      inter.current = {
        mode: 'marquee',
        startSX: sx,
        startSY: sy,
        curSX: sx,
        curSY: sy,
        additive: e.shiftKey,
        baseSel: e.shiftKey ? [...g.selectedIds] : []
      }
      setMarquee({ x: sx, y: sy, w: 0, h: 0 })
      try { stageRef.current?.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const it = inter.current
    if (it.mode === 'idle') return
    if (it.mode === 'pan') {
      panAcc.current.dx += e.clientX - it.lastX
      panAcc.current.dy += e.clientY - it.lastY
      it.lastX = e.clientX
      it.lastY = e.clientY
      schedule()
    } else if (it.mode === 'drag') {
      const ddx = e.clientX - it.lastX
      const ddy = e.clientY - it.lastY
      it.lastX = e.clientX
      it.lastY = e.clientY
      if (!it.moved && Math.hypot(ddx, ddy) >= DRAG_THRESHOLD) {
        useGraph.getState().pushHistory()
        it.moved = true
      }
      if (it.moved) {
        dragAcc.current.dx += ddx
        dragAcc.current.dy += ddy
        schedule()
      }
    } else if (it.mode === 'marquee') {
      const rect = getRect()
      it.curSX = e.clientX - rect.left
      it.curSY = e.clientY - rect.top
      setMarquee({
        x: Math.min(it.startSX, it.curSX),
        y: Math.min(it.startSY, it.curSY),
        w: Math.abs(it.curSX - it.startSX),
        h: Math.abs(it.curSY - it.startSY)
      })
    }
  }

  const endInteraction = (e: RPointerEvent<HTMLDivElement>) => {
    const it = inter.current
    // 强制结算挂起的拖动位移（rAF flush 可能晚于松手），再算归属
    if (rafId.current != null) {
      cancelAnimationFrame(rafId.current)
      flush()
    }
    if (it.mode === 'marquee') {
      const g = useGraph.getState()
      const board2 = g.getActiveBoard()
      const v = board2.viewport
      const a = screenToWorld(it.startSX, it.startSY, v)
      const b = screenToWorld(it.curSX, it.curSY, v)
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
      if (r.w >= 2 || r.h >= 2) {
        const hit = Object.values(board2.cards)
          .filter((c) => !hiddenMembers.has(c.id) && rectsIntersect(r, { x: c.x, y: c.y, w: c.w, h: c.h }))
          .map((c) => c.id)
        g.setSelection(it.additive ? Array.from(new Set([...it.baseSel, ...hit])) : hit)
      }
      setMarquee(null)
    } else if (it.mode === 'drag' && it.moved) {
      // 拖动结束：重算被拖卡片/组的归属（整体落入最深的组→入组；都不在→离组）。折进本次移动的历史。
      const g = useGraph.getState()
      const board2 = g.getActiveBoard()
      const groups = Object.values(board2.cards).filter((c) => c.kind === 'group')
      const dragged = new Set(it.ids)
      const ops: Array<[string, string | null]> = []
      for (const id of it.ids) {
        const card = board2.cards[id]
        if (!card) continue
        // 父也被一起拖动 → 随父移动，保持原归属，不被外层组"抢走"
        if (card.parentId && dragged.has(card.parentId)) continue
        const cand = groups
          .filter((gp) => gp.id !== id && !dragged.has(gp.id) && isCardInsideGroup(card, gp))
          .sort((a, b) => a.w * a.h - b.w * b.h)
        const newParent = cand.length ? cand[0].id : null
        if (card.parentId !== newParent) ops.push([id, newParent])
      }
      if (ops.length) {
        useGraph.setState((s) => ({
          project: {
            ...s.project,
            updatedAt: Date.now(),
            boards: s.project.boards.map((b) => {
              if (b.id !== s.project.activeBoardId) return b
              const cards = { ...b.cards }
              for (const [id, p] of ops) if (cards[id]) cards[id] = { ...cards[id], parentId: p }
              return { ...b, cards }
            })
          }
        }))
      }
    }
    inter.current = { mode: 'idle' }
    setCursor(spaceRef.current ? 'grab' : 'default')
    try { stageRef.current?.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }

  const onDoubleClick = (e: RPointerEvent<HTMLDivElement>) => {
    // 注意：拖动用了 setPointerCapture(stage)，会把 click/dblclick 的 target 重定向到舞台，
    // 故不能用 e.target 判断；改用 elementFromPoint 取光标下真正的元素。
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    if (el?.closest('[data-interactive]')) return
    const cardEl = el?.closest('[data-card-id]') as HTMLElement | null
    if (cardEl) {
      // 双击有内容的节点 → 放大预览
      const c = useGraph.getState().getActiveBoard().cards[cardEl.dataset.cardId as string]
      if (c?.assetUrl && (c.kind === 'image' || c.kind === 'source' || c.kind === 'video')) {
        useUi.getState().setPreview({ url: c.assetUrl, kind: c.kind === 'video' ? 'video' : 'image' })
      }
      return
    }
    // 双击空白 → 新建文本卡
    const rect = getRect()
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, useGraph.getState().getActiveBoard().viewport)
    useGraph.getState().addCard('text', world)
  }

  const onContextMenu = (e: RMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    if (el?.closest('[data-interactive]')) {
      useUi.getState().setCtxMenu(null)
      return
    }
    const cardEl = el?.closest('[data-card-id]') as HTMLElement | null
    const cardId = cardEl?.dataset.cardId || null
    if (cardId && !useGraph.getState().selectedIds.includes(cardId)) useGraph.getState().setSelection([cardId])
    useUi.getState().setCtxMenu({ x: e.clientX, y: e.clientY, cardId })
  }

  // 原生 wheel（非 passive，便于 preventDefault）→ 朝光标缩放
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement)?.closest?.('[data-interactive]')) return // 让面板/工具条内部滚动，不缩放画布
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.0015)
      const g = useGraph.getState()
      g.setViewport(zoomAt(g.getActiveBoard().viewport, sx, sy, factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // 上报舞台尺寸（供左侧添加卡片定位到视图中心）
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    stageEl.current = el
    const update = () => useUi.getState().setStageSize(el.clientWidth, el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      ro.disconnect()
      stageEl.current = null
    }
  }, [])

  // 粘贴图片/文件 → 导入素材
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const tag = (el?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || el?.isContentEditable) return
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const f = items[i].getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length === 0) return
      const ss = useUi.getState().stageSize
      const world = screenToWorld(ss.w / 2, ss.h / 2, useGraph.getState().getActiveBoard().viewport)
      void importFiles(files, world)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // 键盘快捷键
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null
      const tag = (el?.tagName || '').toLowerCase()
      return tag === 'input' || tag === 'textarea' || !!el?.isContentEditable
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping()) {
        spaceRef.current = true
        if (inter.current.mode === 'idle') setCursor('grab')
        e.preventDefault()
        return
      }
      if (isTyping()) return
      const g = useGraph.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) g.redo()
        else g.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        g.redo()
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        g.setSelection(Object.keys(g.getActiveBoard().cards))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (g.selectedIds.length) {
          e.preventDefault()
          g.removeCards(g.selectedIds)
        }
      } else if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        g.copySelection()
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        g.paste(28, 28)
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        g.copySelection()
        g.paste(28, 28)
      } else if (e.key.toLowerCase() === 'f') {
        doFit()
      } else if (e.key.toLowerCase() === 'm') {
        useUi.getState().toggleMinimap()
      } else if (e.key === 'Escape') {
        g.clearSelection()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false
        if (inter.current.mode !== 'pan') setCursor('default')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={stageRef}
      className="ace-stage relative w-full h-full overflow-hidden"
      style={{ cursor, touchAction: 'none', userSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {showGrid && <GridLayer viewport={vp} />}
      <EdgeLayer board={board} temp={connectTemp} />
      <div
        className="absolute top-0 left-0"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0' }}
      >
        {Object.values(board.cards)
          .filter((c) => c.kind === 'group' && !hiddenMembers.has(c.id))
          .map((c) => (
            <GroupView key={c.id} card={c} selected={selSet.has(c.id)} />
          ))}
        {Object.values(board.cards)
          .filter((c) => c.kind !== 'group' && !hiddenMembers.has(c.id))
          .map((c) => (
            <CardView key={c.id} card={c} selected={selSet.has(c.id)} />
          ))}
      </div>
      <SelectionBox rect={marquee} />
      {showMinimap && <Minimap />}
      <CanvasControls onFit={doFit} />
      <ConnectMenu />
      <NodeEditor />
      <BatchActions />
      <Lightbox />
      <ContextMenu />
      {Object.keys(board.cards).length === 0 && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center opacity-40 text-sm">
            <div className="text-base font-medium mb-1">空白画布</div>
            双击空白处新建文本卡 · 左侧添加卡片 · 滚轮缩放 · 空格拖拽平移
          </div>
        </div>
      )}
    </div>
  )
}
