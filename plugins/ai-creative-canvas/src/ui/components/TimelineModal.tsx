import { useEffect, useState } from 'react'
import { X, Film, Loader2, ChevronLeft, ChevronRight, Scissors } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { Select } from './Select'
import { composeTimeline, ensureFfmpeg, probeDuration, toFileUrl, type FilmTransition } from '../services/mediaVideo'
import { toast } from '../store/toastStore'
import type { Card } from '../types'

const ASPECT_WH: Record<string, [number, number]> = {
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [1024, 1024],
  '4:3': [1024, 768],
  '3:4': [768, 1024]
}

interface Clip {
  id: string
  title: string
  path: string
  dur: number
  inSec: number
  outSec: number
}

export function TimelineModal() {
  const show = useUi((s) => s.showTimeline)
  if (!show) return null
  return <Inner />
}

function Inner() {
  const board = useGraph((s) => s.getActiveBoard())
  const selectedIds = useGraph((s) => s.selectedIds)
  const [clips, setClips] = useState<Clip[]>([])
  const [audioCard] = useState(() => selectedIds.map((id) => board.cards[id]).find((c) => c && c.kind === 'audio' && c.assetLocalPath))
  const [sel, setSel] = useState(0)
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
      const out: Clip[] = []
      for (const v of vids) {
        const dur = (await probeDuration(v.assetLocalPath!)) || 5
        out.push({ id: v.id, title: v.title || '片段', path: v.assetLocalPath!, dur, inSec: 0, outSec: dur })
      }
      if (alive) {
        setClips(out)
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        audioPath: audioCard?.assetLocalPath || undefined,
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
      <div data-interactive onClick={(e) => e.stopPropagation()} className="ace-dialog ace-anim-scale w-[720px] max-w-full max-h-[88vh] flex flex-col text-neutral-800 dark:text-neutral-200">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Film size={16} className="text-emerald-500" /> 时间线编辑
          </div>
          <button onClick={close} className="opacity-60 hover:opacity-100">
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
              {/* 视觉轨道：视频轨 */}
              <div className="text-[11px] opacity-50">视频轨（点击片段编辑，宽度 ∝ 裁剪后时长）</div>
              <div className="flex gap-1 h-12 rounded-lg p-1 bg-black/5 dark:bg-white/5">
                {clips.map((c, i) => (
                  <button
                    key={c.id + i}
                    onClick={() => setSel(i)}
                    style={{ flexGrow: len(c), flexBasis: 0, borderColor: 'var(--ace-border)', background: 'var(--surface-2)' }}
                    className={`min-w-[48px] rounded-md px-1 overflow-hidden text-left text-[10px] leading-tight border ${i === sel ? 'ring-2 ring-emerald-500' : ''}`}
                    title={`${c.title} · ${len(c).toFixed(1)}s`}
                  >
                    <div className="font-medium truncate">{c.title}</div>
                    <div className="opacity-60 tabular-nums">{len(c).toFixed(1)}s</div>
                  </button>
                ))}
              </div>
              {audioCard && <div className="flex items-center gap-1 h-7 rounded-lg px-2 bg-emerald-500/10 text-[10px] text-emerald-600 dark:text-emerald-400">🎵 音频轨：{audioCard.title || '背景音'}</div>}

              {/* 选中片段裁剪 */}
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
                  <div className="text-[10px] opacity-50">原长 {cur.dur.toFixed(1)}s · 裁剪后 {len(cur).toFixed(1)}s</div>
                </div>
              )}

              {/* 选项 */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs opacity-60 shrink-0">转场</span>
                  <Select className="flex-1" value={transition} onChange={(v) => setTransition(v as FilmTransition)} options={[{ value: 'none', label: '硬切' }, { value: 'xfade', label: '交叉淡化' }, { value: 'fade', label: '整片淡入淡出' }]} />
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
                保留片段原声{audioCard ? '（与音频轨混合）' : ''}
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
