import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Z } from '../zlayers'
import { Sparkles, Film, Grid2x2, Boxes, Compass, LayoutTemplate, Link2, Copy, ClipboardPaste, AlignCenter, Download, Trash2, Plus } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { generateCard, generateSelected, canGenerate } from '../services/generate'
import { shotToVideo } from '../services/storyboard'
import { saveGroupAsTemplate } from '../services/templates'
import { screenToWorld } from '../canvas/viewport'
import { stageEl } from '../canvas/stageEl'
import type { Card, CardKind } from '../types'
import { toast } from '../store/toastStore'
import { promptDialog } from '../store/dialogStore'
import { runCollage } from '../services/mediaOps'

type Item = { label: string; onClick: () => void; danger?: boolean } | { sep: true } | { header: string }

// 按关键词给菜单项配 lucide 图标（无需逐项声明）
function iconFor(label: string): typeof Sparkles | null {
  if (label.includes('全景')) return Compass
  if (label.includes('生成')) return Sparkles
  if (label.includes('转视频') || label.includes('合成') || label.includes('视频')) return Film
  if (label.includes('拼贴')) return Grid2x2
  if (label.includes('编组')) return Boxes
  if (label.includes('模板')) return LayoutTemplate
  if (label.includes('连到')) return Link2
  if (label.includes('粘贴')) return ClipboardPaste
  if (label.includes('提取') || label.includes('副本') || label.includes('复制')) return Copy
  if (label.includes('对齐') || label.includes('分布') || label.includes('居中')) return AlignCenter
  if (label.includes('导出')) return Download
  if (label.includes('删除')) return Trash2
  if (label.includes('新建')) return Plus
  return null
}

const NEW_LABEL: Record<string, string> = { text: '文本', image: '图片', pano: '360 全景', video: '视频', audio: '音频', source: '素材', note: '便签' }

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
    const m = window.mulby
    if (!m?.dialog || !c.assetLocalPath) return
    const ext = c.assetLocalPath.split('.').pop() || 'png'
    try {
      const dest = await m.dialog.showSaveDialog({ defaultPath: `${c.title}.${ext}`, filters: [{ name: '文件', extensions: [ext] }] })
      if (dest) {
        await m.filesystem.copy(c.assetLocalPath, dest)
        toast('已导出：' + dest, 'success')
      }
    } catch {
      toast('导出失败', 'error')
    }
  }
  // 批量导出：选一次目录，把多选卡片的媒体逐个 copy 过去（文件名 = 标题_序号.ext，去文件系统非法字符）
  const exportMany = async (cs: Card[]) => {
    const m = window.mulby
    if (!m?.dialog) return
    const withMedia = cs.filter((c) => c.assetLocalPath)
    if (!withMedia.length) return
    try {
      const picked = await m.dialog.showOpenDialog({ title: '选择导出目录', properties: ['openDirectory'] })
      const dir = Array.isArray(picked) ? picked[0] : undefined
      if (!dir) return
      let ok = 0
      for (let i = 0; i < withMedia.length; i++) {
        const c = withMedia[i]
        const path = c.assetLocalPath as string
        const ext = path.split('.').pop() || 'png'
        const base = (c.title || 'card').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40)
        try {
          await m.filesystem.copy(path, `${dir}/${base}_${i + 1}.${ext}`)
          ok++
        } catch {
          /* 单个失败不阻断其余 */
        }
      }
      toast(`已导出 ${ok}/${withMedia.length} 到目录`, ok ? 'success' : 'error')
    } catch {
      toast('批量导出失败', 'error')
    }
  }

  // 选中若干卡 → 新建一个下游节点并把它们全部连进去
  const connectToNew = (kind: CardKind) => {
    const src = cards.filter((c) => c.kind !== 'group')
    if (!src.length) return
    const maxX = Math.max(...src.map((c) => c.x + c.w))
    const minY = Math.min(...src.map((c) => c.y))
    const maxY = Math.max(...src.map((c) => c.y + c.h))
    g.createConnectedNode(kind, { x: maxX + 220, y: (minY + maxY) / 2 }, src.map((c) => c.id))
  }

  const items: Item[] = []
  const genTargets = cards.filter((c) => canGenerate(c.kind) && c.status !== 'running' && c.status !== 'queued')
  const clips = cards.filter((c) => c.kind === 'video' && c.assetLocalPath)
  const nonGroup = cards.filter((c) => c.kind !== 'group')

  if (ctx.cardId) {
    if (genTargets.length >= 2) items.push({ label: `生成选中（${genTargets.length}）`, onClick: () => run(() => generateSelected()) })
    else if (genTargets.length === 1) items.push({ label: '生成', onClick: () => run(() => void generateCard(genTargets[0].id)) })
    if (cards.length === 1 && cards[0].kind === 'image' && cards[0].assetLocalPath) items.push({ label: '转视频（以此为首帧）', onClick: () => run(() => shotToVideo(cards[0].id)) })
    if (cards.length === 1 && (cards[0].kind === 'image' || cards[0].kind === 'pano' || cards[0].kind === 'source' || cards[0].kind === 'video') && cards[0].assetUrl)
      items.push({
        label: '提取为素材卡',
        onClick: () =>
          run(() => {
            const c = cards[0]
            const newKind = c.kind === 'video' ? 'video' : 'source'
            g.addCard(newKind, { x: c.x + c.w + 160, y: c.y + c.h / 2 }, { title: c.title || '素材', status: 'done', assetUrl: c.assetUrl, assetLocalPath: c.assetLocalPath, mime: c.mime })
          })
      })
    // 手动导入的等距柱状全景（素材/图片卡）→ 一键转独立全景卡，获得 360 环视与接缝/天地修复。
    // 生成中不给转（流式预览也有 assetUrl，且多图/比例语义未定）；非图片资产（如 PDF 素材）不给转
    if (
      cards.length === 1 &&
      (cards[0].kind === 'image' || cards[0].kind === 'source') &&
      cards[0].assetUrl &&
      cards[0].status !== 'running' &&
      cards[0].status !== 'queued' &&
      (!cards[0].mime || cards[0].mime.startsWith('image'))
    )
      items.push({
        label: '转为 360 全景卡',
        onClick: () =>
          run(() => {
            g.pushHistory()
            g.updateCard(cards[0].id, { kind: 'pano', meta: { ...cards[0].meta, pano: true } })
          })
      })
    if (clips.length >= 2) items.push({ label: `合成成片（${clips.length}）`, onClick: () => run(() => useUi.getState().setShowCompose(true)) })
    if (clips.length >= 1) items.push({ label: `时间线编辑（${clips.length}）`, onClick: () => run(() => useUi.getState().setShowTimeline(true)) })
    const imgCards = cards.filter((c) => (c.kind === 'image' || c.kind === 'pano' || c.kind === 'source') && c.assetUrl)
    if (imgCards.length >= 2) items.push({ label: `拼贴合成（${imgCards.length}）`, onClick: () => run(() => void runCollage(imgCards.map((c) => c.id))) })
    if (cards.length >= 1) items.push({ label: '编组', onClick: () => run(() => g.groupSelection()) })
    if (cards.length === 1 && cards[0].kind === 'group')
      items.push({
        label: '保存为模板',
        onClick: () =>
          run(() => {
            void promptDialog({ title: '保存为模板', message: '模板名称', defaultValue: cards[0].title }).then((n) => {
              if (n) void saveGroupAsTemplate(cards[0].id, n, board).then((t) => toast(t ? '已保存模板' : '保存失败', t ? 'success' : 'error'))
            })
          })
      })
    if (nonGroup.length >= 1) {
      items.push({ header: '连接到新节点' })
      items.push({ label: '↳ 连到新文本节点', onClick: () => run(() => connectToNew('text')) })
      items.push({ label: '↳ 连到新图片节点', onClick: () => run(() => connectToNew('image')) })
      items.push({ label: '↳ 连到新全景节点', onClick: () => run(() => connectToNew('pano')) })
      items.push({ label: '↳ 连到新视频节点', onClick: () => run(() => connectToNew('video')) })
    }
    if (cards.length >= 2) {
      items.push({ header: '对齐 / 分布' })
      items.push({ label: '左对齐', onClick: () => run(() => align('left')) })
      items.push({ label: '顶对齐', onClick: () => run(() => align('top')) })
      items.push({ label: '水平居中', onClick: () => run(() => align('centerH')) })
      items.push({ label: '垂直居中', onClick: () => run(() => align('middleV')) })
      if (cards.length >= 3) {
        items.push({ label: '横向分布', onClick: () => run(() => distribute('h')) })
        items.push({ label: '纵向分布', onClick: () => run(() => distribute('v')) })
      }
    }
    const genSel = cards.filter((c) => canGenerate(c.kind))
    if (genSel.length === 1) items.push({ label: '复制参数', onClick: () => run(() => useUi.getState().setParamClipboard({ ...(genSel[0].params || {}) })) })
    const pclip = useUi.getState().paramClipboard
    if (pclip && genSel.length >= 1) items.push({ label: `粘贴参数（${genSel.length}）`, onClick: () => run(() => g.applyParamsTo(genSel.map((c) => c.id), pclip)) })
    items.push({ sep: true })
    items.push({ label: '复制副本', onClick: () => run(() => { g.copySelection(); g.paste(40, 40) }) })
    if (cards.length === 1 && cards[0].assetLocalPath) items.push({ label: '导出', onClick: () => run(() => void exportCard(cards[0])) })
    else if (nonGroup.filter((c) => c.assetLocalPath).length >= 2) {
      const mediaCards = nonGroup.filter((c) => c.assetLocalPath)
      items.push({ label: `导出所选（${mediaCards.length}）`, onClick: () => run(() => void exportMany(mediaCards)) })
    }
    items.push({ label: '删除', danger: true, onClick: () => run(() => g.removeCards(sel)) })
  } else {
    const rect = stageEl.current?.getBoundingClientRect()
    const world = screenToWorld(ctx.x - (rect?.left || 0), ctx.y - (rect?.top || 0), board.viewport)
    ;(['text', 'image', 'pano', 'video', 'audio', 'source', 'note'] as CardKind[]).forEach((k) => {
      items.push({ label: '新建' + NEW_LABEL[k], onClick: () => run(() => g.addCard(k, world)) })
    })
    if (g.clipboard?.cards.length) {
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
      className={`ace-menu ace-anim-pop fixed ${Z.contextMenu} py-1 text-sm text-neutral-800 dark:text-neutral-200`}
      style={{ left, top, width: W }}
    >
      {items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="my-1 h-px bg-black/10 dark:bg-white/10" />
        if ('header' in it) return <div key={i} className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wide opacity-40">{it.header}</div>
        const Icon = iconFor(it.label)
        return (
          <button
            key={i}
            onClick={it.onClick}
            className={`w-full flex items-center gap-2 text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 ${it.danger ? 'text-red-500' : ''}`}
          >
            {Icon && <Icon size={14} className="opacity-60 shrink-0" />}
            <span className="flex-1">{it.label}</span>
          </button>
        )
      })}
    </div>,
    document.body
  )
}
