import { useState } from 'react'
import { X, Clapperboard, Loader2, Plus, Trash2, ChevronUp, ChevronDown, Download, MapPin, Rows3 } from 'lucide-react'
import { useEscClose } from '../hooks'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { generateShots, materializeStoryboardShots, saveStoryboardDoc, getRowsTotalDurationSeconds } from '../services/storyboard'
import {
  appendStoryboardShot,
  createStoryboardDoc,
  emptyStoryboardDoc,
  moveStoryboardShot,
  readStoryboardDoc,
  removeStoryboardShot,
  storyboardImageState,
  updateStoryboardShot,
  type StoryboardStageState
} from '../services/storyboardV2'
import type { StoryboardDocV2, StoryboardShotV2 } from '../types'
import { focusCard } from '../focusCard'

import { toast, type ToastType } from '../store/toastStore'
function notify(m: string, t?: string) {
  toast(m, (t as ToastType) || 'info')
}

export function StoryboardModal() {
  const cardId = useUi((s) => s.storyboardCardId)
  useEscClose(() => useUi.getState().setStoryboardCardId(null), !!cardId)
  if (!cardId) return null
  return <Inner cardId={cardId} />
}

function Inner({ cardId }: { cardId: string }) {
  const card = useGraph((s) => s.getActiveBoard().cards[cardId])
  const board = useGraph((s) => s.getActiveBoard())
  const [doc, setDoc] = useState<StoryboardDocV2>(() => card ? readStoryboardDoc(card) || emptyStoryboardDoc(card) : (null as never))
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())

  if (!card) {
    useUi.getState().setStoryboardCardId(null)
    return null
  }
  const shots = doc.shots
  const src = (card.text && card.text.trim()) || (card.prompt && card.prompt.trim()) || ''
  const persist = (next: StoryboardDocV2) => saveStoryboardDoc(cardId, next)
  const close = () => {
    persist(doc)
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
      const next = createStoryboardDoc(card, res, doc)
      setDoc(next)
      setSel(new Set())
      persist(next)
    } catch (e: any) {
      notify('分镜失败：' + (e?.message || String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }
  const upd = (shotId: string, patch: Partial<StoryboardShotV2>) => setDoc((current) => updateStoryboardShot(current, shotId, patch))
  const del = (shotId: string) => {
    setDoc((current) => removeStoryboardShot(current, shotId))
    setSel(new Set())
  }
  const move = (shotId: string, dir: -1 | 1) => {
    setDoc((current) => moveStoryboardShot(current, shotId, dir))
    setSel(new Set())
  }
  const add = () => setDoc((current) => appendStoryboardShot(current))
  const materialize = () => {
    const result = materializeStoryboardShots(cardId, doc)
    if (!result) return
    setDoc(result.doc)
    notify(`已同步 ${result.cardIds.length} 个镜头（新建 ${result.created}，更新 ${result.updated}）`, 'success')
    useUi.getState().setStoryboardCardId(null)
  }
  const materializeSel = () => {
    if (!sel.size) return
    const result = materializeStoryboardShots(cardId, doc, sel)
    if (!result) return
    setDoc(result.doc)
    notify(`已同步选中 ${result.cardIds.length} 镜（新建 ${result.created}，更新 ${result.updated}）`, 'success')
    useUi.getState().setStoryboardCardId(null)
  }
  const toggle = (shotId: string) =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(shotId)) n.delete(shotId)
      else n.add(shotId)
      return n
    })
  const allSel = shots.length > 0 && sel.size === shots.length
  const toggleAll = () => setSel(allSel ? new Set() : new Set(shots.map((shot) => shot.id)))
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
  const stateLabel: Record<StoryboardStageState, string> = {
    unmaterialized: '未落地',
    synced: '待生成',
    stale: '输入已变',
    running: '生成中',
    error: '失败',
    done: '已完成'
  }
  const stateClass: Record<StoryboardStageState, string> = {
    unmaterialized: 'opacity-45',
    synced: 'text-indigo-500',
    stale: 'text-amber-600 dark:text-amber-300',
    running: 'text-blue-500',
    error: 'text-red-500',
    done: 'text-emerald-600 dark:text-emerald-300'
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-6" onClick={close}>
      <div
        data-interactive
        onClick={(e) => e.stopPropagation()}
        className="ace-dialog ace-anim-scale w-[920px] max-w-full max-h-[86vh] flex flex-col text-neutral-800 dark:text-neutral-200"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Clapperboard size={16} className="text-indigo-500" /> 分镜脚本 · 镜头表
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                persist(doc)
                useUi.getState().openStoryboardShot(doc.id, doc.shots[0]?.id || null)
              }}
              className="px-2 py-1 rounded-md text-xs flex items-center gap-1 opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
              title="在完整故事板工作区中编辑"
            ><Rows3 size={13} /> 工作区</button>
            <button onClick={close} className="opacity-60 hover:opacity-100">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto ace-noscroll p-3">
          {shots.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-sm opacity-80">
              <div>从该文本卡的内容生成可编辑的镜头表（图片提示词 / 视频提示词分离）。</div>
              <div className="flex items-center gap-2">
                <button onClick={add} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15">
                  <Plus size={15} /> 手动添加镜头
                </button>
                <button onClick={gen} disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white disabled:opacity-60">
                  {busy ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> 生成中…
                    </>
                  ) : (
                    <>
                      <Clapperboard size={15} /> AI 生成分镜
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left opacity-60">
                  <th className="w-6 px-1 py-1"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                  <th className="w-8 px-1 py-1">#</th>
                  <th className="w-16 px-1">景别</th>
                  <th className="w-12 px-1">时长</th>
                  <th className="w-20 px-1">图片状态</th>
                  <th className="px-1">画面 / 图片提示词</th>
                  <th className="px-1">视频提示词</th>
                  <th className="w-24 px-1">对白</th>
                  <th className="w-14 px-1" />
                </tr>
              </thead>
              <tbody>
                {shots.map((sh, i) => {
                  const imageState = storyboardImageState(doc, sh, board)
                  const linkedCard = sh.imageCardId ? board.cards[sh.imageCardId] : undefined
                  return (
                  <tr key={sh.id} className="border-t align-top" style={{ borderColor: 'var(--ace-border)' }}>
                    <td className="px-1 py-1"><input type="checkbox" checked={sel.has(sh.id)} onChange={() => toggle(sh.id)} /></td>
                    <td className="px-1 py-1 font-medium">{sh.shotNumber ?? i + 1}</td>
                    <td className="px-1 py-1">
                      <input value={sh.shotSize || ''} onChange={(e) => upd(sh.id, { shotSize: e.target.value })} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <input value={sh.duration ?? ''} onChange={(e) => upd(sh.id, { duration: Number(e.target.value) || undefined })} className={cell} />
                    </td>
                    <td className="px-1 py-1">
                      <div className={`flex items-center gap-1 whitespace-nowrap ${stateClass[imageState]}`}>
                        <span>{stateLabel[imageState]}</span>
                        {linkedCard && (
                          <button
                            type="button"
                            onClick={() => { useUi.getState().setStoryboardCardId(null); focusCard(board.id, linkedCard.id) }}
                            className="rounded p-0.5 hover:bg-black/5 dark:hover:bg-white/10"
                            title="定位到画布卡片"
                          ><MapPin size={11} /></button>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <textarea rows={2} value={sh.imagePrompt ?? sh.desc} onChange={(e) => upd(sh.id, { imagePrompt: e.target.value })} className={`${cell} resize-y ace-noscroll`} />
                    </td>
                    <td className="px-1 py-1">
                      <textarea rows={2} value={sh.videoPrompt || ''} onChange={(e) => upd(sh.id, { videoPrompt: e.target.value })} className={`${cell} resize-y ace-noscroll`} />
                    </td>
                    <td className="px-1 py-1">
                      <textarea rows={2} value={sh.dialogue || ''} onChange={(e) => upd(sh.id, { dialogue: e.target.value })} className={`${cell} resize-y ace-noscroll`} />
                    </td>
                    <td className="px-1 py-1">
                      <div className="flex items-center gap-0.5">
                        <button onClick={() => move(sh.id, -1)} className="p-0.5 opacity-60 hover:opacity-100" title="上移"><ChevronUp size={13} /></button>
                        <button onClick={() => move(sh.id, 1)} className="p-0.5 opacity-60 hover:opacity-100" title="下移"><ChevronDown size={13} /></button>
                        <button onClick={() => del(sh.id)} className="p-0.5 text-red-500 opacity-70 hover:opacity-100" title="删除"><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
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
                <Clapperboard size={15} /> 同步选中（{sel.size}）
              </button>
            )}
            <button onClick={materialize} className={`${sel.size ? '' : 'ml-auto'} flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium`}>
              <Clapperboard size={15} /> 同步 / 落地全部（{shots.length}）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
