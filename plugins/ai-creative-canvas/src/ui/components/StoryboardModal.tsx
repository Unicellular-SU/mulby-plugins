import { useState } from 'react'
import { X, Clapperboard, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Download } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { generateShots, materializeShots, getRowsTotalDurationSeconds } from '../services/storyboard'
import type { Shot } from '../types'

import { toast, type ToastType } from '../store/toastStore'
function notify(m: string, t?: string) {
  toast(m, (t as ToastType) || 'info')
}

export function StoryboardModal() {
  const cardId = useUi((s) => s.storyboardCardId)
  if (!cardId) return null
  return <Inner cardId={cardId} />
}

function Inner({ cardId }: { cardId: string }) {
  const card = useGraph((s) => s.getActiveBoard().cards[cardId])
  const [shots, setShots] = useState<Shot[]>(() => ((card?.meta as any)?.shots as Shot[]) || [])
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set())

  if (!card) {
    useUi.getState().setStoryboardCardId(null)
    return null
  }
  const src = (card.text && card.text.trim()) || (card.prompt && card.prompt.trim()) || ''
  const persist = (next: Shot[]) => useGraph.getState().updateCard(cardId, { meta: { ...(card.meta || {}), shots: next } })
  const close = () => {
    persist(shots)
    useUi.getState().setStoryboardCardId(null)
  }

  const gen = async () => {
    if (!src) {
      notify('该卡片没有可用文本（先写故事/剧本或先生成文本）', 'error')
      return
    }
    setBusy(true)
    try {
      const count = Number(card.params?.shotCount) || 0
      const res = await generateShots(src, card.modelId || useGraph.getState().project.defaultTextModel || null, count)
      setShots(res)
      setSel(new Set())
      persist(res)
    } catch (e: any) {
      notify('分镜失败：' + (e?.message || String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }
  const upd = (i: number, patch: Partial<Shot>) => setShots((s) => s.map((sh, idx) => (idx === i ? { ...sh, ...patch } : sh)))
  const del = (i: number) => {
    setShots((s) => s.filter((_, idx) => idx !== i))
    setSel(new Set())
  }
  const move = (i: number, dir: number) => {
    setShots((s) => {
      const j = i + dir
      if (j < 0 || j >= s.length) return s
      const c = [...s]
      const t = c[i]
      c[i] = c[j]
      c[j] = t
      return c
    })
    setSel(new Set())
  }
  const add = () => setShots((s) => [...s, { desc: '', imagePrompt: '', shotSize: '中景', duration: 5 }])
  const materialize = () => {
    persist(shots)
    materializeShots(cardId, shots)
    useUi.getState().setStoryboardCardId(null)
  }
  const materializeSel = () => {
    const sub = shots.filter((_, i) => sel.has(i))
    if (!sub.length) return
    persist(shots)
    materializeShots(cardId, sub)
    useUi.getState().setStoryboardCardId(null)
  }
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  const allSel = shots.length > 0 && sel.size === shots.length
  const toggleAll = () => setSel(allSel ? new Set() : new Set(shots.map((_, i) => i)))
  const totalDur = getRowsTotalDurationSeconds(shots)
  const exportCsv = () => {
    const headers = ['镜号', '景别', '场景', '角色', '情绪', '画面描述', '图片提示词', '视频提示词', '对白', '音效', '时长(秒)']
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const rows = shots.map((sh, i) =>
      [sh.shotNumber ?? i + 1, sh.shotSize, sh.scene, sh.character, sh.emotion, sh.desc, sh.imagePrompt, sh.videoPrompt, sh.dialogue, sh.sfx, sh.duration].map(esc).join(',')
    )
    const csv = '﻿' + [headers.join(','), ...rows].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${card.title || '分镜'}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const cell = 'w-full bg-black/5 dark:bg-white/10 rounded px-1 py-0.5 outline-none'

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-6" onClick={close}>
      <div
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale w-[760px] max-w-full max-h-[86vh] flex flex-col text-neutral-800 dark:text-neutral-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Clapperboard size={16} className="text-indigo-500" /> 分镜脚本 · 镜头表
          </div>
          <button onClick={close} className="opacity-60 hover:opacity-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto ace-noscroll p-3">
          {shots.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-sm opacity-80">
              <div>从该文本卡的内容生成可编辑的镜头表（图片提示词 / 视频提示词分离）。</div>
              <button onClick={gen} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-60">
                {busy ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> 生成中…
                  </>
                ) : (
                  <>
                    <Clapperboard size={15} /> 生成分镜
                  </>
                )}
              </button>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left opacity-60">
                  <th className="w-6 px-1 py-1"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                  <th className="w-8 px-1 py-1">#</th>
                  <th className="w-16 px-1">景别</th>
                  <th className="w-12 px-1">时长</th>
                  <th className="px-1">画面 / 图片提示词</th>
                  <th className="px-1">视频提示词</th>
                  <th className="w-24 px-1">对白</th>
                  <th className="w-14 px-1" />
                </tr>
              </thead>
              <tbody>
                {shots.map((sh, i) => (
                  <tr key={i} className="border-t align-top" style={{ borderColor: 'var(--ace-border)' }}>
                    <td className="px-1 py-1"><input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} /></td>
                    <td className="px-1 py-1 font-medium">{sh.shotNumber ?? i + 1}</td>
                    <td className="px-1 py-1">
                      <input value={sh.shotSize || ''} onChange={(e) => upd(i, { shotSize: e.target.value })} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={sh.duration ?? ''} onChange={(e) => upd(i, { duration: Number(e.target.value) || undefined })} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <textarea rows={2} value={sh.imagePrompt ?? sh.desc} onChange={(e) => upd(i, { imagePrompt: e.target.value })} className={`${cell} resize-y ace-noscroll`} />
                    </td>
                    <td className="px-1 py-1">
                      <textarea rows={2} value={sh.videoPrompt || ''} onChange={(e) => upd(i, { videoPrompt: e.target.value })} className={`${cell} resize-y ace-noscroll`} />
                    </td>
                    <td className="px-1 py-1">
                      <textarea rows={2} value={sh.dialogue || ''} onChange={(e) => upd(i, { dialogue: e.target.value })} className={`${cell} resize-y ace-noscroll`} />
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => move(i, -1)} className="p-0.5 opacity-60 hover:opacity-100" title="上移"><ChevronUp size={13} /></button>
                        <button onClick={() => move(i, 1)} className="p-0.5 opacity-60 hover:opacity-100" title="下移"><ChevronDown size={13} /></button>
                        <button onClick={() => del(i)} className="p-0.5 text-red-500 opacity-70 hover:opacity-100" title="删除"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {shots.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 border-t flex-wrap" style={{ borderColor: 'var(--ace-border)' }}>
            <button onClick={add} className="flex items-center gap-1 text-sm px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10">
              <Plus size={14} /> 添加镜头
            </button>
            <button onClick={gen} disabled={busy} className="flex items-center gap-1 text-sm px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Clapperboard size={14} />} 重新生成
            </button>
            <button onClick={exportCsv} className="flex items-center gap-1 text-sm px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10">
              <Download size={14} /> CSV
            </button>
            <span className="text-[11px] opacity-60 ml-1 whitespace-nowrap">
              共 {shots.length} 镜 · 总时长 {totalDur}s{sel.size ? ` · 选中 ${sel.size}` : ''}
            </span>
            {sel.size > 0 && (
              <button onClick={materializeSel} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-sm font-medium">
                <Clapperboard size={15} /> 落地选中（{sel.size}）
              </button>
            )}
            <button onClick={materialize} className={`${sel.size ? '' : 'ml-auto'} flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium`}>
              <Clapperboard size={15} /> 落地全部（{shots.length}）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
