import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type DragEvent as RDragEvent, type MouseEvent as RMouseEvent } from 'react'
import { Sparkles } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useInteraction } from '../store/interactionStore'
import { useUi } from '../store/uiStore'
import { useDialog } from '../store/dialogStore'
import { CardView } from './CardView'
import { CardPlaceholder } from './CardPlaceholder'
import { GroupView } from './GroupView'
import { EdgeLayer } from './EdgeLayer'
import { GridLayer } from './GridLayer'
import { CanvasControls } from './CanvasControls'
import { Minimap } from './Minimap'
import { SelectionBox, type ScreenRect } from './SelectionBox'
import { ConnectMenu } from './ConnectMenu'
import { NodeEditor } from './NodeEditor'
import { FloatingToolbar } from './FloatingToolbar'
import { AnnotationLayer } from './AnnotationLayer'
import { AnnotationDrawOverlay } from './AnnotationDrawOverlay'
import { AnnotationToolbar } from './AnnotationToolbar'
import { Lightbox } from './Lightbox'
import { BatchActions } from './BatchActions'
import { MultiConnectHandle } from './MultiConnectHandle'
import { GuideLayer } from './GuideLayer'
import { computeSnap, computeSnapBox } from './snapping'
import { ContextMenu } from '../components/ContextMenu'
import type { CardKind } from '../types'
import { isCardInsideGroup } from '../types'
import { fitToCards, rectsIntersect, screenToWorld, worldViewRect, zoomAt } from './viewport'
import { buildGridIndex, type RectItem } from './spatialIndex'
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
  const zoomTimer = useRef<number | null>(null)
  const lastInteractEnd = useRef(0) // 最近一次平移/框选/拖动结束的事件时间戳——抑制其后误触双击建卡

  const [cursor, setCursor] = useState<'default' | 'grab' | 'grabbing'>('default')
  const [marquee, setMarquee] = useState<ScreenRect | null>(null)

  const board = useGraph((s) => s.getActiveBoard())
  const selectedIds = useGraph((s) => s.selectedIds)
  const stageSize = useUi((s) => s.stageSize)
  const showGrid = useUi((s) => s.showGrid)
  const showMinimap = useUi((s) => s.showMinimap)
  const connectTemp = useUi((s) => s.connectTemp)
  const vp = board.viewport
  const selSet = new Set(selectedIds)
  const cards = board.cards
  const edges = board.edges

  // 虚拟化阈值用卡片数判定（避免与空间索引互相依赖）。
  const VIRTUALIZE_THRESHOLD = 200
  const LOD_ZOOM = 0.4
  const cardCount = Object.keys(cards).length
  const virtualize = cardCount > VIRTUALIZE_THRESHOLD && stageSize.w > 0 && stageSize.h > 0
  // 拖动期冻结派生集合：moveCardsBy 每帧换 cards 引用，否则大画布上每帧 O(N) 重建索引/隐藏集。
  // 拖的是选中卡(force 渲染)，冻结的略旧裁剪框不影响其显示；松手 commitTick++ 触发一次按最终位置重建。
  // 仅在虚拟化(大画布)时冻结——小画布保持原行为，零风险。
  const [commitTick, setCommitTick] = useState(0)
  const resizing = useInteraction((s) => s.resizing) // CardView/GroupView resize 期间为 true
  // 冻结覆盖 drag 与 resize 两种连续交互：resize 也高频改 cards(w/h)，不冻结会每帧 O(N) 重建索引
  const frozen = virtualize && (inter.current.mode === 'drag' || resizing)

  // 折叠组隐藏成员集合：仅卡片变化时重算（平移因 cards 引用稳定而命中缓存；拖动期冻结）
  const hiddenRef = useRef<Set<string>>(new Set())
  const hiddenMembers = useMemo(() => {
    if (frozen) return hiddenRef.current
    const hidden = new Set<string>()
    const hideDesc = (gid: string) => {
      for (const c of Object.values(cards)) if (c.parentId === gid) { hidden.add(c.id); if (c.kind === 'group') hideDesc(c.id) }
    }
    for (const c of Object.values(cards)) if (c.kind === 'group' && c.params?.collapsed) hideDesc(c.id)
    hiddenRef.current = hidden
    return hidden
  }, [cards, commitTick, frozen])

  // 关联高亮集合（上下游端卡）：仅连线或选择变化时重算（拖动期 edges/selectedIds 稳定，天然不重算）
  const relatedIds = useMemo(() => {
    const r = new Set<string>()
    if (selectedIds.length) {
      const sel = new Set(selectedIds)
      for (const e of Object.values(edges)) {
        if (sel.has(e.source)) r.add(e.target)
        if (sel.has(e.target)) r.add(e.source)
      }
    }
    return r
  }, [edges, selectedIds])

  // 空间索引：卡片/连线网格，仅在卡片/连线变化时重建（平移命中缓存；拖动期冻结）。查询为 O(可见格)。
  const cardIndexRef = useRef<ReturnType<typeof buildGridIndex> | null>(null)
  const cardIndex = useMemo(() => {
    if (frozen && cardIndexRef.current) return cardIndexRef.current
    cardIndexRef.current = buildGridIndex(Object.values(cards).map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h })))
    return cardIndexRef.current
  }, [cards, commitTick, frozen])
  const edgeIndexRef = useRef<ReturnType<typeof buildGridIndex> | null>(null)
  const edgeIndex = useMemo(() => {
    if (frozen && edgeIndexRef.current) return edgeIndexRef.current
    const items: RectItem[] = []
    for (const e of Object.values(edges)) {
      const s = cards[e.source]
      const t = cards[e.target]
      if (!s || !t) continue
      const ax = s.x + s.w, ay = s.y + s.h / 2, bx = t.x, by = t.y + t.h / 2
      items.push({ id: e.id, x: Math.min(ax, bx) - 2, y: Math.min(ay, by) - 2, w: Math.abs(bx - ax) + 4, h: Math.abs(by - ay) + 4 })
    }
    edgeIndexRef.current = buildGridIndex(items)
    return edgeIndexRef.current
  }, [cards, edges, commitTick, frozen])

  // 万级虚拟化：超阈值时用空间索引取可见卡片/连线（选中卡恒含，保浮条/编辑器/手柄锚点）；
  // 极低缩放走 LOD 占位块（轻量色块，省 img/video/事件富层）。阈值以下保持原行为（零风险）。
  // marquee/全选/连接均遍历 store 而非 DOM，剔除不影响选择与命中。
  const viewRect = virtualize ? worldViewRect(vp, stageSize.w, stageSize.h, 600) : null
  const lod = virtualize && vp.zoom < LOD_ZOOM

  // 少量选择时强制渲染选中卡（即便滚出视野，保浮条/编辑器/手柄锚点稳妥）；
  // 但全选(海量选择)时不强制，否则会把全量都渲染出来——浮条/编辑器本就用世界坐标而非 DOM，无碍。
  const forceSelected = selectedIds.length > 0 && selectedIds.length <= 64
  let visibleCardIds: string[]
  if (viewRect) {
    const set = new Set<string>()
    for (const id of cardIndex.query(viewRect)) {
      const c = cards[id]
      if (c && rectsIntersect(viewRect, { x: c.x, y: c.y, w: c.w, h: c.h })) set.add(id)
    }
    if (forceSelected) for (const id of selectedIds) if (cards[id]) set.add(id)
    // 拖动期把被拖卡补入：冻结索引按拖动前位置分桶，>64 选择(forceSelected=false)时移入视口的卡会漏渲
    const itNow = inter.current
    if (itNow.mode === 'drag') for (const id of itNow.ids) if (cards[id]) set.add(id)
    visibleCardIds = [...set]
  } else {
    visibleCardIds = Object.keys(cards)
  }
  const visibleEdgeIds = viewRect ? edgeIndex.query(viewRect) : null

  const getRect = () => stageRef.current?.getBoundingClientRect() ?? new DOMRect()

  // 交互期降级：直接写 DOM data 属性（不触发 React 重渲），CSS 据此关阴影/过渡/卡片指针事件
  const setInteracting = (mode: string | null) => {
    const el = stageRef.current
    if (!el) return
    if (mode) el.dataset.interacting = mode
    else delete el.dataset.interacting
  }

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
    // 从卡片拖出的产物 → 新建素材/视频源卡
    const assetJson = e.dataTransfer?.getData('application/x-ace-asset')
    if (assetJson) {
      try {
        const a = JSON.parse(assetJson)
        const newKind: CardKind = a.kind === 'video' ? 'video' : 'source'
        useGraph.getState().addCard(newKind, world, { title: a.title || '素材', status: 'done', assetUrl: a.url, assetLocalPath: a.localPath, mime: a.mime })
      } catch {
        /* ignore */
      }
      return
    }
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
      let wdx = dragAcc.current.dx / cur.zoom
      let wdy = dragAcc.current.dy / cur.zoom
      const b = g.getActiveBoard()
      const ids = inter.current.ids
      const dragged = new Set(ids)
      const snapGrid = useUi.getState().snapGrid
      let snap: ReturnType<typeof computeSnap> | null = null
      if (ids.length > 1) {
        // 多选：用整体包围盒吸附（拖动前的盒）
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const id of ids) {
          const c = b.cards[id]
          if (!c) continue
          minX = Math.min(minX, c.x); minY = Math.min(minY, c.y)
          maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h)
        }
        if (isFinite(minX)) snap = computeSnapBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, wdx, wdy, b.cards, dragged, cur.zoom, snapGrid)
      } else {
        const primary = b.cards[ids[0]]
        if (primary) snap = computeSnap(primary, wdx, wdy, b.cards, dragged, cur.zoom, snapGrid)
      }
      if (snap) {
        wdx = snap.dx
        wdy = snap.dy
        useUi.getState().setGuides(snap.vx.length || snap.hy.length ? { vx: snap.vx, hy: snap.hy } : null)
      }
      g.moveCardsBy(ids, wdx, wdy)
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
      setInteracting('pan')
      try { stageRef.current?.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      e.preventDefault()
      return
    }
    if (e.button !== 0) return
    const additive = e.shiftKey || e.metaKey || e.ctrlKey // shift / ctrl / cmd 多选

    const cardEl = target.closest('[data-card-id]') as HTMLElement | null
    if (cardEl) {
      const id = cardEl.dataset.cardId as string
      if (additive) {
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
      if (!additive) g.clearSelection()
      inter.current = {
        mode: 'marquee',
        startSX: sx,
        startSY: sy,
        curSX: sx,
        curSY: sy,
        additive,
        baseSel: additive ? [...g.selectedIds] : []
      }
      setMarquee({ x: sx, y: sy, w: 0, h: 0 })
      setInteracting('marquee')
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
        setInteracting('drag')
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
    if (it.mode !== 'idle') lastInteractEnd.current = e.timeStamp // 记录真实交互结束时刻
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
    if (it.mode === 'drag' && it.moved) setCommitTick((t) => t + 1) // 解冻派生集合，按最终位置重建一次
    useUi.getState().setGuides(null)
    setInteracting(null)
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
      const c = useGraph.getState().getActiveBoard().cards[cardEl.dataset.cardId as string]
      if (c?.assetUrl && (c.meta as any)?.pano) {
        useUi.getState().setPanoCardId(c.id) // 全景卡 → 360 环视
      } else if (c?.assetUrl && (c.kind === 'image' || c.kind === 'source')) {
        useUi.getState().setMaskCardId(c.id) // 双击图片节点 → 局部编辑页面
      } else if (c?.assetUrl && c.kind === 'video') {
        useUi.getState().setPreview({ url: c.assetUrl, kind: 'video' }) // 视频仍为放大预览
      }
      return
    }
    // 空格/中键平移中，或刚结束平移/框选/拖动（松手后的误触双击）→ 不在空白处新建文本卡
    if (spaceRef.current || e.timeStamp - lastInteractEnd.current < 300) return
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
      el.dataset.interacting = 'zoom'
      if (zoomTimer.current != null) clearTimeout(zoomTimer.current)
      zoomTimer.current = window.setTimeout(() => {
        if (inter.current.mode === 'idle' && stageRef.current) delete stageRef.current.dataset.interacting
        zoomTimer.current = null
      }, 220)
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
      // 任意全屏模态/对话框打开时，画布全局快捷键全部让位（防 Del/Ctrl+A/V 误伤背后选中的卡片）。
      if (useUi.getState().anyModalOpen() || useDialog.getState().current) return
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
      } else if (mod && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        g.groupSelection()
      } else if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        useUi.getState().setShowSearch(true) // Ctrl/Cmd+F 搜索卡片
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
      data-zoom-low={vp.zoom < 0.5 ? 'true' : undefined}
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
      <EdgeLayer board={board} temp={connectTemp} selected={selSet} cull={viewRect} edgeIds={visibleEdgeIds} />
      <div
        className="absolute top-0 left-0"
        style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, transformOrigin: '0 0', willChange: 'transform' }}
      >
        {/* 组层（在卡片层之下）：仅可见集中的组 */}
        {visibleCardIds.map((id) => {
          const c = cards[id]
          if (!c || c.kind !== 'group' || hiddenMembers.has(id)) return null
          return <GroupView key={c.id} card={c} selected={selSet.has(c.id)} />
        })}
        {/* 卡片层：低缩放走 LOD 占位块；选中卡始终完整渲染以保编辑能力 */}
        {visibleCardIds.map((id) => {
          const c = cards[id]
          if (!c || c.kind === 'group' || hiddenMembers.has(id)) return null
          if (lod && !selSet.has(id)) return <CardPlaceholder key={c.id} card={c} selected={false} />
          return <CardView key={c.id} card={c} selected={selSet.has(c.id)} related={relatedIds.has(c.id) && !selSet.has(c.id)} />
        })}
        <AnnotationLayer annotations={board.annotations || []} />
      </div>
      <AnnotationDrawOverlay />
      <SelectionBox rect={marquee} />
      <GuideLayer />
      {showMinimap && <Minimap />}
      <CanvasControls onFit={doFit} />
      <AnnotationToolbar />
      <ConnectMenu />
      <NodeEditor />
      <FloatingToolbar />
      <BatchActions />
      <MultiConnectHandle />
      <Lightbox />
      <ContextMenu />
      {Object.keys(board.cards).length === 0 && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="ace-glass ace-anim-fade pointer-events-auto px-6 py-5 text-center max-w-xs">
            <Sparkles size={26} className="mx-auto text-indigo-400 mb-2" />
            <div className="text-base font-medium mb-1">空白画布</div>
            <div className="text-xs opacity-60 mb-3">从这里开始创作</div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => {
                  const sz = useUi.getState().stageSize
                  const v = useGraph.getState().getActiveBoard().viewport
                  useGraph.getState().addCard('text', screenToWorld(sz.w / 2, sz.h / 2, v))
                }}
                className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs"
              >
                新建文本卡
              </button>
              <button onClick={() => useUi.getState().setShowTemplates(true)} className="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs">
                打开模板
              </button>
            </div>
            <div className="text-[11px] opacity-40 mt-3">双击空白新建 · 拖图片进来导入 · 滚轮缩放 · 空格拖拽平移</div>
          </div>
        </div>
      )}
    </div>
  )
}
