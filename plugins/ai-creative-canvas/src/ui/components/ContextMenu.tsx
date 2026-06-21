import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { generateCard, generateSelected, canGenerate } from '../services/generate'
import { shotToVideo } from '../services/storyboard'
import { saveGroupAsTemplate } from '../services/templates'
import { screenToWorld } from '../canvas/viewport'
import { stageEl } from '../canvas/stageEl'
import type { Card, CardKind } from '../types'

type Item = { label: string; onClick: () => void; danger?: boolean } | { sep: true }

const NEW_LABEL: Record<string, string> = { text: '文本', image: '图片', video: '视频', audio: '音频', source: '素材' }

export function ContextMenu() {
  const ctx = useUi((s) => s.ctxMenu)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ctx) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) useUi.getState().setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.getState().setCtxMenu(null)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctx])

  if (!ctx) return null
  const g = useGraph.getState()
  const board = g.getActiveBoard()
  const sel = g.selectedIds
  const cards = sel.map((id) => board.cards[id]).filter(Boolean) as Card[]
  const close = () => useUi.getState().setCtxMenu(null)
  const run = (fn: () => void) => {
    fn()
    close()
  }

  const applyPos = (updates: Record<string, { x?: number; y?: number }>) => {
    g.pushHistory()
    for (const [id, p] of Object.entries(updates)) g.updateCard(id, p)
  }
  const align = (mode: 'left' | 'top' | 'centerH' | 'middleV') => {
    if (cards.length < 2) return
    const minX = Math.min(...cards.map((c) => c.x))
    const maxXr = Math.max(...cards.map((c) => c.x + c.w))
    const minY = Math.min(...cards.map((c) => c.y))
    const maxYb = Math.max(...cards.map((c) => c.y + c.h))
    const cx = (minX + maxXr) / 2
    const cy = (minY + maxYb) / 2
    const up: Record<string, { x?: number; y?: number }> = {}
    for (const c of cards) {
      if (mode === 'left') up[c.id] = { x: Math.round(minX) }
      else if (mode === 'top') up[c.id] = { y: Math.round(minY) }
      else if (mode === 'centerH') up[c.id] = { x: Math.round(cx - c.w / 2) }
      else up[c.id] = { y: Math.round(cy - c.h / 2) }
    }
    applyPos(up)
  }
  const distribute = (dir: 'h' | 'v') => {
    const cs = [...cards]
    if (cs.length < 3) return
    const up: Record<string, { x?: number; y?: number }> = {}
    if (dir === 'h') {
      cs.sort((a, b) => a.x - b.x)
      const step = (cs[cs.length - 1].x - cs[0].x) / (cs.length - 1)
      cs.forEach((c, i) => (up[c.id] = { x: Math.round(cs[0].x + step * i) }))
    } else {
      cs.sort((a, b) => a.y - b.y)
      const step = (cs[cs.length - 1].y - cs[0].y) / (cs.length - 1)
      cs.forEach((c, i) => (up[c.id] = { y: Math.round(cs[0].y + step * i) }))
    }
    applyPos(up)
  }
  const exportCard = async (c: Card) => {
    const m = (window as any).mulby
    if (!m?.dialog || !c.assetLocalPath) return
    const ext = c.assetLocalPath.split('.').pop() || 'png'
    try {
      const dest = await m.dialog.showSaveDialog({ defaultPath: `${c.title}.${ext}`, filters: [{ name: '文件', extensions: [ext] }] })
      if (dest) {
        await m.filesystem.copy(c.assetLocalPath, dest)
        m.notification?.show?.('已导出：' + dest, 'success')
      }
    } catch {
      m.notification?.show?.('导出失败', 'error')
    }
  }

  // 选中若干卡 → 新建一个下游节点并把它们全部连进去
  const connectToNew = (kind: CardKind) => {
    const src = cards.filter((c) => c.kind !== 'group')
    if (!src.length) return
    const maxX = Math.max(...src.map((c) => c.x + c.w))
    const minY = Math.min(...src.map((c) => c.y))
    const maxY = Math.max(...src.map((c) => c.y + c.h))
    const nid = g.addCard(kind, { x: maxX + 220, y: (minY + maxY) / 2 })
    for (const c of src) g.addEdgeBetween(c.id, nid)
    g.setSelection([nid])
  }

  const items: Item[] = []
  const genTargets = cards.filter((c) => canGenerate(c.kind) && c.status !== 'running' && c.status !== 'queued')
  const clips = cards.filter((c) => c.kind === 'video' && c.assetLocalPath)
  const nonGroup = cards.filter((c) => c.kind !== 'group')

  if (ctx.cardId) {
    if (genTargets.length >= 2) items.push({ label: `生成选中（${genTargets.length}）`, onClick: () => run(() => generateSelected()) })
    else if (genTargets.length === 1) items.push({ label: '生成', onClick: () => run(() => void generateCard(genTargets[0].id)) })
    if (cards.length === 1 && cards[0].kind === 'image' && cards[0].assetLocalPath) items.push({ label: '转视频（以此为首帧）', onClick: () => run(() => shotToVideo(cards[0].id)) })
    if (clips.length >= 2) items.push({ label: `合成成片（${clips.length}）`, onClick: () => run(() => useUi.getState().setShowCompose(true)) })
    if (cards.length >= 1) items.push({ label: '编组', onClick: () => run(() => g.groupSelection()) })
    if (cards.length === 1 && cards[0].kind === 'group')
      items.push({
        label: '保存为模板',
        onClick: () =>
          run(() => {
            const n = prompt('模板名称:', cards[0].title)
            if (n) void saveGroupAsTemplate(cards[0].id, n, board).then((t) => (window as any).mulby?.notification?.show?.(t ? '已保存模板' : '保存失败', t ? 'success' : 'error'))
          })
      })
    if (nonGroup.length >= 1) {
      items.push({ sep: true })
      items.push({ label: '↳ 连到新文本节点', onClick: () => run(() => connectToNew('text')) })
      items.push({ label: '↳ 连到新图片节点', onClick: () => run(() => connectToNew('image')) })
      items.push({ label: '↳ 连到新视频节点', onClick: () => run(() => connectToNew('video')) })
    }
    if (cards.length >= 2) {
      items.push({ sep: true })
      items.push({ label: '左对齐', onClick: () => run(() => align('left')) })
      items.push({ label: '顶对齐', onClick: () => run(() => align('top')) })
      items.push({ label: '水平居中', onClick: () => run(() => align('centerH')) })
      items.push({ label: '垂直居中', onClick: () => run(() => align('middleV')) })
      if (cards.length >= 3) {
        items.push({ label: '横向分布', onClick: () => run(() => distribute('h')) })
        items.push({ label: '纵向分布', onClick: () => run(() => distribute('v')) })
      }
    }
    items.push({ sep: true })
    items.push({ label: '复制副本', onClick: () => run(() => { g.copySelection(); g.paste(40, 40) }) })
    if (cards.length === 1 && cards[0].assetLocalPath) items.push({ label: '导出', onClick: () => run(() => void exportCard(cards[0])) })
    items.push({ label: '删除', danger: true, onClick: () => run(() => g.removeCards(sel)) })
  } else {
    const rect = stageEl.current?.getBoundingClientRect()
    const world = screenToWorld(ctx.x - (rect?.left || 0), ctx.y - (rect?.top || 0), board.viewport)
    ;(['text', 'image', 'video', 'audio', 'source'] as CardKind[]).forEach((k) => {
      items.push({ label: '新建' + NEW_LABEL[k], onClick: () => run(() => g.addCard(k, world)) })
    })
    if (g.clipboard && g.clipboard.length) {
      items.push({ sep: true })
      items.push({ label: '粘贴', onClick: () => run(() => g.paste(40, 40)) })
    }
  }

  const W = 184
  const estH = items.length * 30 + 8
  const left = Math.max(8, Math.min(ctx.x, window.innerWidth - W - 8))
  const top = Math.max(8, Math.min(ctx.y, window.innerHeight - estH - 8))

  return createPortal(
    <div
      ref={ref}
      data-interactive
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="fixed z-[90] rounded-lg border bg-white dark:bg-neutral-900 shadow-xl py-1 text-sm text-neutral-800 dark:text-neutral-200"
      style={{ left, top, width: W, borderColor: 'var(--ace-border)' }}
    >
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={i} className="my-1 h-px bg-black/10 dark:bg-white/10" />
        ) : (
          <button
            key={i}
            onClick={it.onClick}
            className={`w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 ${it.danger ? 'text-red-500' : ''}`}
          >
            {it.label}
          </button>
        )
      )}
    </div>,
    document.body
  )
}
