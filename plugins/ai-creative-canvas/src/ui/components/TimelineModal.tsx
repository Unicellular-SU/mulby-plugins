import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { X, Film, Loader2, ChevronLeft, ChevronRight, Scissors, Music, Plus, Trash2 } from 'lucide-react'
import { useEscClose } from '../hooks'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { Select } from './Select'
import { composeTimeline, ensureFfmpeg, probeDuration, timelineThumbs, toFileUrl, type FilmTransition } from '../services/mediaVideo'
import { toast } from '../store/toastStore'
import type { Card } from '../types'

const ASPECT_WH: Record<string, [number, number]> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [1024, 1024],
  '4:3': [1024, 768],
  '3:4': [768, 1024]
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

interface Clip {
  id: string
  title: string
  path: string
  dur: number
  inSec: number
  outSec: number
  thumbs?: string[] // 缩略图条（本地路径）
}
interface ATrack {
  id: string
  title: string
  path: string
  volume: number // 0~2
  offset: number // 秒
}

export function TimelineModal() {
  const show = useUi((s) => s.showTimeline)
  useEscClose(() => useUi.getState().setShowTimeline(false), show)
  if (!show) return null
  return <Inner />
}

function Inner() {
  const board = useGraph((s) => s.getActiveBoard())
  const selectedIds = useGraph((s) => s.selectedIds)
  // 选中的音频卡池（可加入为多条音轨）
  const [audioPool] = useState(() =>
    selectedIds.map((id) => board.cards[id]).filter((c): c is Card => !!c && c.kind === 'audio' && !!c.assetLocalPath)
  )
  const [clips, setClips] = useState<Clip[]>([])
  const [gaps, setGaps] = useState<number[]>([]) // 逐间隔转场时长（位置语义，长度 = clips.length-1）
  const [aTracks, setATracks] = useState<ATrack[]>(() => audioPool.map((c) => ({ id: c.id, title: c.title || '音频', path: c.assetLocalPath!, volume: 1, offset: 0 })))
  const [sel, setSel] = useState(0)
  const dragCleanup = useRef<null | (() => void)>(null) // 当前拖拽裁剪的清理器（卸载时调用，防监听泄漏）
  const [transition, setTransition] = useState<FilmTransition>('none')
  const [resolution, setResolution] = useState('follow')
  const [fps, setFps] = useState(24)
  const [keepAudio, setKeepAudio] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const close = () => {
    if (!busy) useUi.getState().setShowTimeline(false)
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      const vids = selectedIds
        .map((id) => board.cards[id])
        .filter((c): c is Card => !!c && c.kind === 'video' && !!c.assetLocalPath)
        .sort((a, b) => (Math.abs(a.y - b.y) > 40 ? a.y - b.y : a.x - b.x))
      if (!vids.length) {
        setLoading(false)
        return
      }
      const ok = await ensureFfmpeg()
      if (!ok || !alive) {
        setLoading(false)
        return
      }
      const projectId = useGraph.getState().project.id
      const out: Clip[] = []
      for (const v of vids) {
        const dur = (await probeDuration(v.assetLocalPath!)) || 5
        out.push({ id: v.id, title: v.title || '片段', path: v.assetLocalPath!, dur, inSec: 0, outSec: dur })
      }
      if (!alive) return
      setClips(out)
      setGaps(Array(Math.max(0, out.length - 1)).fill(0.5))
      setLoading(false)
      // 缩略图条：逐段惰性生成（不阻塞主交互）；按 id 回填，避免期间重排错位
      out.forEach((c) => {
        void timelineThumbs(projectId, c.path, 8)
          .then((r) => { if (alive) setClips((cs) => cs.map((x) => (x.id === c.id ? { ...x, thumbs: r.thumbs } : x))) })
          .catch(() => {})
      })
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 卸载时若仍在拖拽裁剪，清掉残留的 window 监听
  useEffect(() => () => dragCleanup.current?.(), [])

  const upd = (i: number, patch: Partial<Clip>) => setClips((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const move = (i: number, dir: number) => {
    const j = i + dir
    if (j < 0 || j >= clips.length) return
    setClips((cs) => {
      const a = [...cs]
      const t = a[i]
      a[i] = a[j]
      a[j] = t
      return a
    })
    setSel(j)
  }
  const len = (c: Clip) => Math.max(0.1, c.outSec - c.inSec)
  const totalDur = clips.reduce((s, c) => s + len(c), 0)
  const cur = clips[sel]

  // 轨道上拖拽裁剪：拖片段左/右边缘 → 改 in/out（按拖拽起点的像素↔秒换算，避免布局回流抖动）
  const startTrim = (i: number, edge: 'in' | 'out') => (e: RPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setSel(i) // 拖边缘同时选中该片段，精调面板跟随
    const clipEl = (e.currentTarget as HTMLElement).parentElement
    if (!clipEl) return
    const c0 = clips[i]
    const pxPerSec = clipEl.getBoundingClientRect().width / Math.max(0.1, c0.outSec - c0.inSec)
    const startX = e.clientX
    const startIn = c0.inSec
    const startOut = c0.outSec
    const moveEv = (ev: PointerEvent) => {
      const dSec = (ev.clientX - startX) / pxPerSec
      if (edge === 'in') upd(i, { inSec: clamp(startIn + dSec, 0, startOut - 0.1) })
      else upd(i, { outSec: clamp(startOut + dSec, startIn + 0.1, c0.dur) })
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', moveEv)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      window.removeEventListener('blur', cleanup)
      dragCleanup.current = null
    }
    dragCleanup.current = cleanup
    window.addEventListener('pointermove', moveEv)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    window.addEventListener('blur', cleanup)
  }

  const addTrack = () => {
    const used = new Set(aTracks.map((t) => t.id))
    const next = audioPool.find((c) => !used.has(c.id))
    if (next) setATracks((ts) => [...ts, { id: next.id, title: next.title || '音频', path: next.assetLocalPath!, volume: 1, offset: 0 }])
  }
  const updTrack = (id: string, patch: Partial<ATrack>) => setATracks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const delTrack = (id: string) => setATracks((ts) => ts.filter((t) => t.id !== id))
  const canAddTrack = aTracks.length < audioPool.length

  const run = async () => {
    if (!clips.length) return
    setBusy(true)
    setProgress(0)
    let w = 1280
    let h = 720
    if (resolution === 'follow') {
      const a = String(board.cards[clips[0].id]?.params?.aspect || '16:9')
      ;[w, h] = ASPECT_WH[a] || [1280, 720]
    } else {
      const [pw, ph] = resolution.split('x').map(Number)
      w = pw
      h = ph
    }
    try {
      const projectId = useGraph.getState().project.id
      const outp = await composeTimeline(projectId, {
        clips: clips.map((c) => ({ path: c.path, inSec: c.inSec, outSec: c.outSec, dur: c.dur })),
        audioTracks: aTracks.map((t) => ({ path: t.path, volume: t.volume, offset: Math.min(t.offset, totalDur) })), // offset 钳到总时长内，避免超出被 -shortest 整轨静音
        transitionDurs: gaps, // 每个间隔的转场时长（位置语义）
        width: w,
        height: h,
        fps,
        transition,
        useClipAudio: keepAudio,
        onProgress: setProgress
      })
      const vids = clips.map((c) => board.cards[c.id]).filter(Boolean) as Card[]
      const minX = Math.min(...vids.map((c) => c.x))
      const maxX = Math.max(...vids.map((c) => c.x + c.w))
      const maxBottom = Math.max(...vids.map((c) => c.y + c.h))
      const id = useGraph.getState().addCard('video', { x: (minX + maxX) / 2, y: maxBottom + 220 }, {
        title: '时间线成片',
        status: 'done',
        assetUrl: toFileUrl(outp),
        assetLocalPath: outp,
        mime: 'video/mp4'
      }, board.id)
      useGraph.getState().setSelection([id])
      toast('时间线已导出', 'success')
      useUi.getState().setShowTimeline(false)
    } catch (e: any) {
      toast('导出失败：' + (e?.message || String(e)), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-6" onClick={close}>
      <div data-interactive onClick={(e) => e.stopPropagation()} className="ace-dialog ace-anim-scale w-[760px] max-w-full max-h-[88vh] flex flex-col text-neutral-800 dark:text-neutral-200">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Film size={16} className="text-emerald-500" /> 时间线编辑
          </div>
          <button onClick={close} title="关闭 (Esc)" className="opacity-60 hover:opacity-100">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-auto ace-scroll">
          {loading ? (
            <div className="h-24 grid place-items-center text-sm opacity-60">
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> 正在读取片段时长…
              </span>
            </div>
          ) : !clips.length ? (
            <div className="text-amber-500 text-xs py-6 text-center">请先选择至少 1 张已生成的视频卡片。</div>
          ) : (
            <>
              {/* 视频轨：缩略图条 + 边缘拖拽裁剪 */}
              <div className="text-[11px] opacity-50">视频轨（拖片段左右边缘裁剪 · 宽度 ∝ 裁剪后时长 · 点选编辑）</div>
              <div className="flex gap-1 h-16 rounded-lg p-1 bg-black/5 dark:bg-white/5">
                {clips.map((c, i) => (
                  <div
                    key={c.id}
                    onPointerDown={() => setSel(i)}
                    style={{ flexGrow: len(c), flexBasis: 0, borderColor: 'var(--ace-border)' }}
                    className={`relative min-w-[56px] rounded-md overflow-hidden border cursor-pointer ${i === sel ? 'ring-2 ring-emerald-500' : ''}`}
                    title={`${c.title} · ${len(c).toFixed(1)}s`}
                  >
                    {/* 缩略图条 */}
                    <div className="absolute inset-0 flex" style={{ background: 'var(--surface-2)' }}>
                      {c.thumbs?.map((t, k) => <img key={k} src={toFileUrl(t)} alt="" draggable={false} className="h-full flex-1 min-w-0 object-cover opacity-80" />)}
                    </div>
                    {/* 文字浮层 */}
                    <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-black/45 text-white text-[10px] leading-tight">
                      <span className="truncate">{c.title}</span> <span className="tabular-nums opacity-80">{len(c).toFixed(1)}s</span>
                    </div>
                    {/* 拖拽裁剪手柄 */}
                    <div onPointerDown={startTrim(i, 'in')} title="拖动设起点" className="absolute left-0 inset-y-0 w-1.5 bg-emerald-500/80 hover:bg-emerald-400 cursor-ew-resize" />
                    <div onPointerDown={startTrim(i, 'out')} title="拖动设终点" className="absolute right-0 inset-y-0 w-1.5 bg-emerald-500/80 hover:bg-emerald-400 cursor-ew-resize" />
                  </div>
                ))}
              </div>

              {/* 音轨（多条，可加/删 + 音量/偏移） */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] opacity-50 flex items-center gap-1"><Music size={12} /> 音轨（{aTracks.length}）</span>
                {canAddTrack && (
                  <button onClick={addTrack} className="text-[11px] flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20">
                    <Plus size={11} /> 加音轨
                  </button>
                )}
              </div>
              {aTracks.map((t) => (
                <div key={t.id} className="rounded-lg px-2 py-1.5 flex items-center gap-2 bg-emerald-500/10 text-[11px]">
                  <span className="truncate w-20 shrink-0 text-emerald-700 dark:text-emerald-300">{t.title}</span>
                  <span className="opacity-50 shrink-0">音量</span>
                  <input type="range" min={0} max={2} step={0.05} value={t.volume} onChange={(e) => updTrack(t.id, { volume: Number(e.target.value) })} className="w-20" />
                  <span className="w-9 text-right tabular-nums opacity-70">{Math.round(t.volume * 100)}%</span>
                  <span className="opacity-50 shrink-0">起始</span>
                  <input type="range" min={0} max={Math.max(1, Math.ceil(totalDur))} step={0.1} value={t.offset} onChange={(e) => updTrack(t.id, { offset: Number(e.target.value) })} className="flex-1 min-w-[40px]" />
                  <span className="w-10 text-right tabular-nums opacity-70">{t.offset.toFixed(1)}s</span>
                  <button onClick={() => delTrack(t.id)} title="移除音轨" className="opacity-50 hover:opacity-100 shrink-0"><Trash2 size={12} /></button>
                </div>
              ))}

              {/* 选中片段：精调裁剪 + 排序 + 与上一段转场时长 */}
              {cur && (
                <div className="rounded-lg border p-3 flex flex-col gap-2" style={{ borderColor: 'var(--ace-border)' }}>
                  <div className="flex items-center gap-2 text-xs">
                    <Scissors size={13} className="text-emerald-500" />
                    <span className="font-medium truncate flex-1">{cur.title}</span>
                    <button onClick={() => move(sel, -1)} disabled={sel === 0} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" title="前移">
                      <ChevronLeft size={14} />
                    </button>
                    <button onClick={() => move(sel, 1)} disabled={sel === clips.length - 1} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30" title="后移">
                      <ChevronRight size={14} />
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-[11px]">
                    <span className="w-8 opacity-60 shrink-0">起点</span>
                    <input type="range" min={0} max={cur.dur} step={0.1} value={cur.inSec} onChange={(e) => upd(sel, { inSec: Math.min(Number(e.target.value), cur.outSec - 0.1) })} className="flex-1" />
                    <span className="w-10 text-right tabular-nums">{cur.inSec.toFixed(1)}s</span>
                  </label>
                  <label className="flex items-center gap-2 text-[11px]">
                    <span className="w-8 opacity-60 shrink-0">终点</span>
                    <input type="range" min={0} max={cur.dur} step={0.1} value={cur.outSec} onChange={(e) => upd(sel, { outSec: Math.max(Number(e.target.value), cur.inSec + 0.1) })} className="flex-1" />
                    <span className="w-10 text-right tabular-nums">{cur.outSec.toFixed(1)}s</span>
                  </label>
                  {transition === 'xfade' && sel >= 1 && (
                    <label className="flex items-center gap-2 text-[11px]">
                      <span className="w-16 opacity-60 shrink-0">转场时长</span>
                      <input type="range" min={0.2} max={2} step={0.1} value={gaps[sel - 1] ?? 0.5} onChange={(e) => setGaps((g) => g.map((x, k) => (k === sel - 1 ? Number(e.target.value) : x)))} className="flex-1" />
                      <span className="w-10 text-right tabular-nums">{(gaps[sel - 1] ?? 0.5).toFixed(1)}s</span>
                    </label>
                  )}
                  <div className="text-[10px] opacity-50">原长 {cur.dur.toFixed(1)}s · 裁剪后 {len(cur).toFixed(1)}s</div>
                </div>
              )}

              {/* 选项 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs opacity-60 shrink-0">转场</span>
                  <Select className="flex-1" value={transition} onChange={(v) => setTransition(v as FilmTransition)} options={[{ value: 'none', label: '硬切' }, { value: 'xfade', label: '交叉淡化（可逐段调时长）' }, { value: 'fade', label: '整片淡入淡出' }]} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs opacity-60 shrink-0">帧率</span>
                  <Select className="flex-1" value={String(fps)} onChange={(v) => setFps(Number(v))} options={[{ value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }]} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 text-xs opacity-60 shrink-0">分辨率</span>
                <Select className="flex-1" value={resolution} onChange={setResolution} options={[{ value: 'follow', label: '跟随首段比例' }, { value: '1280x720', label: '1280×720 (16:9)' }, { value: '1920x1080', label: '1920×1080 (16:9)' }, { value: '720x1280', label: '720×1280 (9:16)' }, { value: '1080x1920', label: '1080×1920 (9:16)' }]} />
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
                保留片段原声{aTracks.length ? '（与音轨混合）' : ''}
              </label>

              {busy && (
                <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[11px] opacity-60">共 {clips.length} 段 · 总时长 {totalDur.toFixed(1)}s</span>
                <button onClick={run} disabled={busy} className="ml-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-60">
                  {busy ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> 导出中… {Math.round(progress * 100)}%
                    </>
                  ) : (
                    <>
                      <Film size={15} /> 导出成片
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
