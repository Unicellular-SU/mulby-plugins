import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { X, Scissors, Loader2 } from 'lucide-react'
import { useEscClose } from '../hooks'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { ensureFfmpeg, timelineThumbs } from '../services/mediaVideo'
import { runVideoTool } from '../services/mediaOps'
import { toFileUrl } from '../services/media'

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const x = Math.floor(s % 60)
  return `${m}:${x.toString().padStart(2, '0')}`
}

export function VideoTrimModal() {
  const id = useUi((s) => s.trimCardId)
  useEscClose(() => useUi.getState().setTrimCardId(null), !!id)
  if (!id) return null
  return <Inner cardId={id} />
}

function Inner({ cardId }: { cardId: string }) {
  const card = useGraph((s) => s.getActiveBoard().cards[cardId])
  const vref = useRef<HTMLVideoElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const drag = useRef<'in' | 'out' | 'seek' | null>(null)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [dur, setDur] = useState(0)
  const [inSec, setInSec] = useState(0)
  const [outSec, setOutSec] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [loading, setLoading] = useState(true)

  const close = () => useUi.getState().setTrimCardId(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const path = useGraph.getState().getActiveBoard().cards[cardId]?.assetLocalPath
      if (!path) {
        close()
        return
      }
      const ok = await ensureFfmpeg()
      if (!ok) {
        close()
        return
      }
      const res = await timelineThumbs(useGraph.getState().project.id, path, 12)
      if (!alive) return
      setThumbs(res.thumbs)
      const d = res.duration || vref.current?.duration || 0
      setDur(d)
      setOutSec(d)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId])

  // 播放限定在所选区间：起点之外开播则跳到 in；播到 out 即停。并让播放头实时跟随。
  useEffect(() => {
    const v = vref.current
    if (!v) return
    const onPlay = () => {
      if (outSec > inSec && (v.currentTime < inSec || v.currentTime >= outSec - 0.03)) v.currentTime = inSec
    }
    const onTime = () => {
      setPlayhead(v.currentTime)
      if (!v.paused && outSec > inSec && v.currentTime >= outSec - 0.03) {
        v.pause()
        v.currentTime = outSec
        setPlayhead(outSec)
      }
    }
    v.addEventListener('play', onPlay)
    v.addEventListener('timeupdate', onTime)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('timeupdate', onTime)
    }
  }, [inSec, outSec])

  if (!card) return null

  const seek = (sec: number) => {
    const v = vref.current
    if (v) v.currentTime = sec
    setPlayhead(sec)
  }
  const fracToSec = (clientX: number): number => {
    const el = stripRef.current
    if (!el || !dur) return 0
    const r = el.getBoundingClientRect()
    return Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur))
  }
  const apply = (mode: 'in' | 'out' | 'seek', sec: number) => {
    if (mode === 'in') {
      const s = Math.max(0, Math.min(sec, outSec - 0.1))
      setInSec(s)
      seek(s)
    } else if (mode === 'out') {
      const s = Math.min(dur, Math.max(sec, inSec + 0.1))
      setOutSec(s)
      seek(s)
    } else {
      seek(sec)
    }
  }
  const onDown = (mode: 'in' | 'out' | 'seek') => (e: RPointerEvent) => {
    e.stopPropagation()
    drag.current = mode
    apply(mode, fracToSec(e.clientX))
    const move = (ev: PointerEvent) => {
      if (drag.current) apply(drag.current, fracToSec(ev.clientX))
    }
    const up = () => {
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const pct = (s: number) => (dur ? (s / dur) * 100 : 0)
  const confirm = () => {
    close()
    void runVideoTool(cardId, 'clip', { start: Math.round(inSec * 100) / 100, end: Math.round(outSec * 100) / 100 })
  }

  const srcUrl = card.assetUrl || (card.assetLocalPath ? toFileUrl(card.assetLocalPath) : '')

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-6" onClick={close}>
      <div data-interactive onClick={(e) => e.stopPropagation()} className="ace-dialog ace-anim-scale w-[680px] max-w-full flex flex-col text-neutral-800 dark:text-neutral-200">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 font-semibold">
            <Scissors size={16} className="text-indigo-500" /> 裁剪视频片段
          </div>
          <button onClick={close} className="opacity-60 hover:opacity-100">
            <X size={18} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <video ref={vref} src={srcUrl} className="w-full max-h-[44vh] rounded-lg bg-black object-contain" controls />
          {loading ? (
            <div className="h-16 grid place-items-center text-sm opacity-60">
              <span className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin" /> 正在生成时间轴…
              </span>
            </div>
          ) : (
            <div className="select-none">
              <div
                ref={stripRef}
                className="relative flex h-14 rounded-lg overflow-hidden border cursor-pointer"
                style={{ borderColor: 'var(--ace-border)' }}
                onPointerDown={onDown('seek')}
              >
                {thumbs.map((t, i) => (
                  <img key={i} src={toFileUrl(t)} draggable={false} className="h-full flex-1 object-cover pointer-events-none" alt="" />
                ))}
                <div className="absolute inset-y-0 left-0 bg-black/55 pointer-events-none" style={{ width: `${pct(inSec)}%` }} />
                <div className="absolute inset-y-0 right-0 bg-black/55 pointer-events-none" style={{ width: `${100 - pct(outSec)}%` }} />
                <div className="absolute inset-y-0 border-2 border-indigo-400 pointer-events-none" style={{ left: `${pct(inSec)}%`, right: `${100 - pct(outSec)}%` }} />
                <div onPointerDown={onDown('in')} className="absolute inset-y-0 w-2 -ml-1 bg-indigo-500 cursor-ew-resize rounded" style={{ left: `${pct(inSec)}%` }} title="起点" />
                <div onPointerDown={onDown('out')} className="absolute inset-y-0 w-2 -ml-1 bg-indigo-500 cursor-ew-resize rounded" style={{ left: `${pct(outSec)}%` }} title="终点" />
                <div className="absolute inset-y-0 w-0.5 bg-white pointer-events-none" style={{ left: `${pct(playhead)}%` }} />
              </div>
              <div className="flex items-center justify-between text-xs mt-2 tabular-nums opacity-80">
                <span>起 {fmt(inSec)}</span>
                <span>选区 {fmt(Math.max(0, outSec - inSec))}</span>
                <span>止 {fmt(outSec)}</span>
              </div>
            </div>
          )}
          <button
            onClick={confirm}
            disabled={loading || outSec - inSec < 0.1}
            className="mt-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium disabled:opacity-60"
          >
            <Scissors size={15} /> 裁剪为新卡（{fmt(Math.max(0, outSec - inSec))}）
          </button>
        </div>
      </div>
    </div>
  )
}
