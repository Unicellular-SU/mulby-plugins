import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  X, Film, Loader2, Undo2, Redo2, Eye, EyeOff, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Scissors, Gauge, Crop, Palette, Music, Download, Plus, FlipHorizontal2, FlipVertical2,
  Play, Pause, SkipBack, SkipForward, Maximize, PanelBottomClose, PanelBottomOpen, Type
} from 'lucide-react'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { useStudio } from '../store/studioStore'
import { Select } from './Select'
import { ensureFfmpeg, probeDuration, timelineThumbs } from '../services/mediaVideo'
import { toFileUrl } from '../services/media'
import { stackToPreview, type PreviewOverlay } from '../services/videoEdit/preview'
import { PLATFORM_PRESETS } from '../services/videoEdit/exportPresets'
import { loadWaveform } from '../services/audioWaveform'
import { useProviders } from '../store/providerStore'
import { runTts } from '../services/providers/engine'
import { toast } from '../store/toastStore'
import { OP_KIND_LABEL, type EditOp, type EditStack, type OpKind, type TrimParams, type SpeedParams, type TransformParams, type ColorParams, type AudioParams, type ExportParams, type OverlayParams, type SubtitleCue } from '../services/videoEdit/types'
import { base64ToArrayBuffer } from '../util'
import { Z } from '../zlayers'

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const x = Math.floor(s % 60)
  return `${m}:${x.toString().padStart(2, '0')}`
}

const KIND_ICON: Record<OpKind, typeof Scissors> = {
  trim: Scissors, speed: Gauge, transform: Crop, color: Palette, overlay: Plus, audio: Music, export: Download
}

const RES_OPTIONS = [
  { value: 'follow', label: '跟随原视频' },
  { value: '1280x720', label: '720p 横屏 (16:9)' },
  { value: '1920x1080', label: '1080p 横屏 (16:9)' },
  { value: '720x1280', label: '竖屏 720×1280 (9:16)' },
  { value: '1080x1920', label: '竖屏 1080×1920 (9:16)' },
  { value: '1080x1080', label: '方屏 1080×1080 (1:1)' }
]

const COLOR_PRESETS: { id: string; label: string; params: Partial<ColorParams> }[] = [
  { id: 'warm', label: '暖阳', params: { temp: 35, saturation: 1.15, contrast: 1.05 } },
  { id: 'cool', label: '冷调', params: { temp: -35, saturation: 1.05, contrast: 1.02 } },
  { id: 'cine', label: '电影', params: { contrast: 1.15, saturation: 0.9, vignette: 0.4 } },
  { id: 'vintage', label: '复古', params: { saturation: 0.75, temp: 20, grain: 12, vignette: 0.5 } },
  { id: 'film', label: '老电影', params: { saturation: 0.6, contrast: 1.1, temp: 15, grain: 18, vignette: 0.5 } },
  { id: 'cyber', label: '赛博', params: { saturation: 1.4, contrast: 1.15, temp: -30, hue: 10 } },
  { id: 'bw', label: '黑白', params: { saturation: 0 } }
]

// ---------- 通用控件 ----------
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[11px]">
      <span className="w-16 shrink-0 opacity-60">{label}</span>
      {children}
    </label>
  )
}
function SliderRow({ label, value, min, max, step, suffix, onLive, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string
  onLive: (v: number) => void; onCommit: () => void
}) {
  return (
    <Row label={label}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="flex-1 min-w-[60px]"
      />
      <span className="w-12 text-right tabular-nums opacity-70">{value.toFixed(step < 1 ? 2 : 0)}{suffix || ''}</span>
    </Row>
  )
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

export function VideoStudioModal() {
  const id = useUi((s) => s.studioCardId)
  if (!id) return null
  return <Inner cardId={id} />
}

function Inner({ cardId }: { cardId: string }) {
  const stack = useStudio((s) => s.stack)
  const selectedOpId = useStudio((s) => s.selectedOpId)
  const busy = useStudio((s) => s.busy)
  const progress = useStudio((s) => s.progress)
  const vref = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [vrect, setVrect] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [playhead, setPlayhead] = useState(0)
  const [saveLocal, setSaveLocal] = useState(false)
  const [waveform, setWaveform] = useState<number[] | null>(null)
  const [playing, setPlaying] = useState(false)
  const [tlOpen, setTlOpen] = useState(true)

  // 播放状态跟随 <video> 的 play/pause 事件（驱动 TransportBar 图标）
  useEffect(() => {
    const v = vref.current
    if (!v) return
    const on = () => setPlaying(!v.paused)
    v.addEventListener('play', on)
    v.addEventListener('pause', on)
    return () => { v.removeEventListener('play', on); v.removeEventListener('pause', on) }
  }, [])
  const fullscreen = () => { const s = stageRef.current; if (s) { if (document.fullscreenElement) void document.exitFullscreen(); else void s.requestFullscreen?.() } }

  const card = useGraph((s) => s.getActiveBoard().cards[cardId])
  const close = () => {
    if (useStudio.getState().busy) return
    useStudio.getState().close()
    useUi.getState().setStudioCardId(null)
  }

  // 挂载：打开会话 → ensureFfmpeg → 可中止 probeDuration → 缩略图条
  useEffect(() => {
    const ac = new AbortController()
    let alive = true
    void (async () => {
      const c = useGraph.getState().getActiveBoard().cards[cardId]
      const recipe = (c?.meta as any)?.editRecipe || null
      useStudio.getState().open(cardId, { duration: 0, w: 16, h: 9 }, recipe)
      const ok = await ensureFfmpeg()
      if (!ok || !alive) {
        if (alive) close()
        return
      }
      const path = c?.assetLocalPath
      const dur = path ? (await probeDuration(path, ac.signal)) || 0 : 0
      if (!alive) return
      useStudio.getState().setBase({ baseDuration: dur })
      setReady(true)
      if (path) {
        const projectId = useGraph.getState().project.id
        timelineThumbs(projectId, path, 12).then((r) => { if (alive) setThumbs(r.thumbs) }).catch(() => {})
        const wurl = c?.assetUrl || toFileUrl(path)
        loadWaveform(wurl, 240).then((w) => { if (alive) setWaveform(w) }).catch(() => {})
      }
    })()
    return () => {
      alive = false
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId])

  // 模态键盘：capture 相位 + stopImmediatePropagation —— 杜绝与画布全局键 / useEscClose 冒泡竞争
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || !!el?.isContentEditable
      // Esc 分层：退全屏 → 取消选中 → 关闭（先吞事件，避免浏览器退全屏同时触发关闭）
      if (e.key === 'Escape') {
        if (document.fullscreenElement) { void document.exitFullscreen(); e.stopImmediatePropagation(); return }
        if (useStudio.getState().selectedOpId) { useStudio.getState().selectOp(null); e.stopImmediatePropagation(); return }
        e.stopImmediatePropagation()
        close()
        return
      }
      if (typing) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const v = vref.current
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); useStudio.getState().undo() }
      else if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) { e.preventDefault(); e.stopImmediatePropagation(); useStudio.getState().redo() }
      else if (e.code === 'Space') { e.preventDefault(); e.stopImmediatePropagation(); if (v) { v.paused ? void v.play() : v.pause() } }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); if (v) v.currentTime = Math.max(0, v.currentTime - 1 / 30) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); if (v) v.currentTime = v.currentTime + 1 / 30 }
      else if (e.key === 'Home') { e.preventDefault(); e.stopImmediatePropagation(); if (v) v.currentTime = 0 }
      else if (e.key === 'End') { e.preventDefault(); e.stopImmediatePropagation(); if (v) v.currentTime = v.duration || 0 }
      else if (k === 'f') { e.stopImmediatePropagation(); fullscreen() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && useStudio.getState().selectedOpId) {
        const id = useStudio.getState().selectedOpId!
        const op = useStudio.getState().stack?.ops.find((o) => o.id === id)
        if (op && op.kind !== 'export') { e.stopImmediatePropagation(); useStudio.getState().removeOp(id) }
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pv = stackToPreview(stack)

  // 同步 playbackRate
  useEffect(() => {
    if (vref.current) vref.current.playbackRate = pv.playbackRate || 1
  }, [pv.playbackRate])

  // 量出 <video> 在舞台内的实际渲染矩形 —— 叠加层精确贴合视频帧（消除信箱黑边导致的预览/导出错位）
  const measure = useCallback(() => {
    const v = vref.current
    const s = stageRef.current
    if (!v || !s) return
    const vr = v.getBoundingClientRect()
    const sr = s.getBoundingClientRect()
    if (vr.width < 2 || vr.height < 2) return
    setVrect({ left: vr.left - sr.left, top: vr.top - sr.top, width: vr.width, height: vr.height })
  }, [])
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(() => measure())
    if (vref.current) ro.observe(vref.current)
    if (stageRef.current) ro.observe(stageRef.current)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [measure])
  // 旋转/翻转改变包围盒 → 下一帧重量
  useEffect(() => {
    const id = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(id)
  }, [pv.transform, measure])

  // 播放头跟随 + trim 保留段跳过删除段
  useEffect(() => {
    const v = vref.current
    if (!v) return
    const onTime = () => {
      setPlayhead(v.currentTime)
      const keeps = pv.keeps
      if (keeps && !v.paused) {
        const inKeep = keeps.some((k) => v.currentTime >= k.in - 0.02 && v.currentTime <= k.out + 0.02)
        if (!inKeep) {
          const next = keeps.find((k) => k.in > v.currentTime)
          if (next) v.currentTime = next.in
          else { v.currentTime = keeps[0].in; v.pause() }
        }
      }
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [pv.keeps])

  if (!card) return null
  const srcUrl = card.assetUrl || (card.assetLocalPath ? toFileUrl(card.assetLocalPath) : '')
  const dur = stack?.baseDuration || 0
  const selectedOp = stack?.ops.find((o) => o.id === selectedOpId) || null

  const onMeta = () => {
    const v = vref.current
    if (v?.videoWidth) useStudio.getState().setBase({ baseW: v.videoWidth, baseH: v.videoHeight })
  }

  // 可添加的大类（singleton：已存在则禁用；export 恒在，不在此）
  const present = new Set((stack?.ops || []).map((o) => o.kind))
  const ADDABLE: { kind: OpKind; label: string }[] = [
    { kind: 'trim', label: '裁切' },
    { kind: 'speed', label: '变速' },
    { kind: 'transform', label: '几何' },
    { kind: 'color', label: '调色' },
    { kind: 'audio', label: '音频' }
  ]
  const addOp = (kind: OpKind) => {
    if (kind === 'trim') useStudio.getState().addOp('trim', { segments: [{ in: 0, out: dur || 1, keep: true }] } as never)
    else useStudio.getState().addOp(kind)
  }
  const addOverlay = (sub: string) => {
    const presets: Record<string, Record<string, unknown>> = {
      text: { sub: 'text', rect: { x: 0.1, y: 0.78, w: 0.8, h: 0.12 }, text: '在此输入文字', style: { align: 'center' } },
      watermark: { sub: 'watermark', rect: { x: 0.66, y: 0.05, w: 0.3, h: 0.08 }, text: '水印', style: { align: 'left' } },
      sticker: { sub: 'sticker', rect: { x: 0.42, y: 0.42, w: 0.16, h: 0.16 }, text: '⭐' },
      mosaic: { sub: 'mosaic', rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 }, blurKind: 'mosaic', pixelSize: 14 },
      pip: { sub: 'pip', rect: { x: 0.62, y: 0.62, w: 0.32, h: 0.32 } },
      subtitle: { sub: 'subtitle', rect: { x: 0.1, y: 0.82, w: 0.8, h: 0.12 }, cues: [], style: { align: 'center' } },
      frame: { sub: 'frame', rect: { x: 0, y: 0, w: 1, h: 1 }, style: { color: '#ffffff', widthPct: 0.03, radiusPct: 0 } },
      progress: { sub: 'progress', rect: { x: 0, y: 0.97, w: 1, h: 0.02 }, style: { color: '#ff2d55', heightPct: 0.014 } },
      timecode: { sub: 'timecode', rect: { x: 0.82, y: 0.04, w: 0.15, h: 0.07 }, style: { color: '#ffffff' } }
    }
    useStudio.getState().addOp('overlay', presets[sub] as never)
  }

  const startAt = pv.keeps?.[0]?.in ?? 0
  const OVERLAY_ADD = [{ s: 'text', l: '文字' }, { s: 'subtitle', l: '字幕' }, { s: 'watermark', l: '水印' }, { s: 'sticker', l: '贴纸' }, { s: 'mosaic', l: '打码' }, { s: 'frame', l: '边框' }, { s: 'progress', l: '进度条' }, { s: 'timecode', l: '时间码' }, { s: 'pip', l: '画中画' }]
  const splitAtPlayhead = () => {
    const g = useStudio.getState()
    const st = g.stack
    if (!st) return
    let trim = st.ops.find((o) => o.kind === 'trim')
    if (!trim) { g.addOp('trim', { segments: [{ in: 0, out: dur || 1, keep: true }] } as never); trim = useStudio.getState().stack?.ops.find((o) => o.kind === 'trim') }
    if (!trim) return
    const segs = (trim.params as TrimParams).segments || []
    const idx = segs.findIndex((s) => playhead > s.in + 0.05 && playhead < s.out - 0.05)
    if (idx < 0) return
    const s = segs[idx]
    const next = [...segs]
    next.splice(idx, 1, { in: s.in, out: playhead, keep: s.keep }, { in: playhead, out: s.out, keep: s.keep })
    g.updateOp(trim.id, { segments: next })
  }

  return (
    <div className={`fixed inset-0 ${Z.modal} bg-black/60 flex items-center justify-center p-4`} onClick={close}>
      <div data-interactive onClick={(e) => e.stopPropagation()} className="ace-dialog ace-anim-scale flex flex-col text-neutral-800 dark:text-neutral-200" style={{ width: 'min(1320px, 95vw)', height: '90vh' }}>
        {/* TopToolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <Film size={16} className="text-pink-500" />
          <span className="font-semibold text-sm">剪辑工作台</span>
          <span className="text-[11px] opacity-50 truncate max-w-[40%]">· {card.title}</span>
          <div className="ml-auto flex items-center gap-1">
            <IconBtn icon={Undo2} title="撤销 (Ctrl+Z)" disabled={!useStudio.getState().canUndo()} onClick={() => useStudio.getState().undo()} />
            <IconBtn icon={Redo2} title="重做 (Ctrl+Y)" disabled={!useStudio.getState().canRedo()} onClick={() => useStudio.getState().redo()} />
            <IconBtn icon={tlOpen ? PanelBottomClose : PanelBottomOpen} title="折叠/展开时间轴" onClick={() => setTlOpen((v) => !v)} />
            <IconBtn icon={X} title="关闭 (Esc)" onClick={close} />
          </div>
        </div>

        {/* 中部：预览(含 Transport) + 检查器 */}
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 flex flex-col p-3 gap-2 border-r" style={{ borderColor: 'var(--ace-border)' }}>
            <div ref={stageRef} className="relative flex-1 min-h-0 grid place-items-center bg-black rounded-lg overflow-hidden">
              <video ref={vref} src={srcUrl} onLoadedMetadata={() => { onMeta(); measure() }} className="max-h-full max-w-full object-contain" style={{ filter: pv.filter, transform: pv.transform, clipPath: pv.clipPath }} />
              <OverlayLayer overlays={pv.overlays} playhead={playhead} dur={dur} baseH={stack?.baseH || 720} vrect={vrect} />
              {!pv.exact && <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-amber-500/90 text-white text-[10px] pointer-events-none">近似预览 · 导出更准</div>}
            </div>
            <TransportBar vref={vref} dur={dur} playhead={playhead} playing={playing} startAt={startAt} onFullscreen={fullscreen} />
          </div>

          {/* 检查器 Inspector */}
          <div className="w-[320px] shrink-0 flex flex-col">
            <div className="flex flex-wrap gap-1 p-2 border-b" style={{ borderColor: 'var(--ace-border)' }}>
              {ADDABLE.map((a) => (
                <button key={a.kind} disabled={present.has(a.kind)} onClick={() => addOp(a.kind)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed">
                  <Plus size={11} /> {a.label}
                </button>
              ))}
              {OVERLAY_ADD.map((o) => (
                <button key={o.s} onClick={() => addOverlay(o.s)} className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-pink-500/10 text-pink-600 dark:text-pink-300 hover:bg-pink-500/20">
                  <Plus size={11} /> {o.l}
                </button>
              ))}
            </div>
            <div className="max-h-[24%] overflow-auto ace-scroll p-2 flex flex-col gap-1 border-b" style={{ borderColor: 'var(--ace-border)' }}>
              {stack?.ops.map((op, i) => {
                const Icon = KIND_ICON[op.kind]
                const sel = op.id === selectedOpId
                return (
                  <div key={op.id} onClick={() => useStudio.getState().selectOp(op.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-[11px] ${sel ? 'bg-pink-500/15 ring-1 ring-pink-500/40' : 'hover:bg-black/5 dark:hover:bg-white/10'} ${op.enabled ? '' : 'opacity-45'}`}>
                    <Icon size={13} className="shrink-0 text-pink-500" />
                    <span className="flex-1 truncate">{op.label || OP_KIND_LABEL[op.kind]}</span>
                    {op.kind !== 'export' && (
                      <>
                        <button title="上移" onClick={(e) => { e.stopPropagation(); useStudio.getState().moveOp(op.id, -1) }} className="opacity-50 hover:opacity-100" disabled={i === 0}><ChevronUp size={12} /></button>
                        <button title="下移" onClick={(e) => { e.stopPropagation(); useStudio.getState().moveOp(op.id, 1) }} className="opacity-50 hover:opacity-100"><ChevronDown size={12} /></button>
                        <button title={op.enabled ? '停用' : '启用'} onClick={(e) => { e.stopPropagation(); useStudio.getState().toggleOp(op.id) }} className="opacity-60 hover:opacity-100">{op.enabled ? <Eye size={12} /> : <EyeOff size={12} />}</button>
                        <button title="删除" onClick={(e) => { e.stopPropagation(); useStudio.getState().removeOp(op.id) }} className="opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex-1 min-h-0 overflow-auto ace-scroll p-3">
              {selectedOp ? <ParamPanel op={selectedOp} dur={dur} playhead={playhead} /> : <div className="text-[11px] opacity-40 text-center py-8">从上方添加或选择一个操作<br />也可点时间轴上的块编辑</div>}
            </div>
          </div>
        </div>

        {/* 底部：时间轴（可折叠）*/}
        {tlOpen && (
          <StudioTimeline stack={stack} thumbs={thumbs} waveform={waveform} dur={dur} playhead={playhead} ready={ready}
            selectedOpId={selectedOpId} onSeek={(t) => { if (vref.current) vref.current.currentTime = t; setPlayhead(t) }}
            onSelect={(id) => useStudio.getState().selectOp(id)} onSplit={splitAtPlayhead} />
        )}

        {/* BottomBar：导出 */}
        <div className="flex items-center gap-3 px-4 py-2 border-t" style={{ borderColor: 'var(--ace-border)' }}>
          {busy && (
            <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <div className="h-full bg-pink-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {!busy && <span className="text-[11px] opacity-50">{ready ? '编辑就绪 · 导出生成新卡片' : '正在读取视频…'}</span>}
          {!busy && !tlOpen && <button onClick={() => setTlOpen(true)} className="text-[11px] flex items-center gap-1 opacity-70 hover:opacity-100"><PanelBottomOpen size={13} /> 展开时间轴</button>}
          <div className="ml-auto flex items-center gap-2">
            {!busy && (
              <label className="flex items-center gap-1 text-[11px] opacity-70 cursor-pointer select-none">
                <input type="checkbox" checked={saveLocal} onChange={(e) => setSaveLocal(e.target.checked)} /> 并保存到本地
              </label>
            )}
            {busy && <button onClick={() => useStudio.getState().cancel()} className="px-3 py-1.5 rounded-lg text-xs bg-black/5 dark:bg-white/10 hover:bg-black/10">取消</button>}
            <button onClick={() => void useStudio.getState().exportStack(saveLocal)} disabled={!ready || busy}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-pink-600 hover:bg-pink-700 text-white text-sm font-medium disabled:opacity-50">
              {busy ? <><Loader2 size={15} className="animate-spin" /> 导出中 {Math.round(progress * 100)}%</> : <><Download size={15} /> 导出新卡</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- 叠加层（精确贴合视频帧；非字幕 overlay 受 range 时间窗门控）----------
function OverlayLayer({ overlays, playhead, dur, baseH, vrect }: {
  overlays: PreviewOverlay[]; playhead: number; dur: number; baseH: number
  vrect: { left: number; top: number; width: number; height: number } | null
}) {
  return (
    <div className="absolute pointer-events-none" style={vrect ? { left: vrect.left, top: vrect.top, width: vrect.width, height: vrect.height } : { inset: 0 }}>
      {overlays.map((o) => {
        const st = (o.style || {}) as Record<string, unknown>
        // 非字幕 overlay 若设了时间窗，移播放头出窗即不显示（range/playhead 同为源时间基，直接比较）
        if (o.sub !== 'subtitle' && o.range && (playhead < o.range.start || playhead > o.range.end)) return null
        if (o.sub === 'mosaic') {
          return <div key={o.id} className="absolute pointer-events-none rounded-sm border-2 border-dashed border-amber-300/80 bg-black/30 backdrop-blur-sm grid place-items-center text-[9px] text-amber-200"
            style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, width: `${o.width * 100}%`, height: '20%' }}>打码区</div>
        }
        if (o.sub === 'pip') {
          return <div key={o.id} className="absolute pointer-events-none rounded border-2 border-pink-400/80 bg-pink-500/20 grid place-items-center text-[9px] text-pink-100"
            style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, width: `${o.width * 100}%`, aspectRatio: '16/9' }}>画中画</div>
        }
        if (o.sub === 'frame') {
          const fs = st
          return <div key={o.id} className="absolute inset-0 pointer-events-none" style={{ border: `${Math.max(2, (Number(fs.widthPct) || 0.03) * 60)}px solid ${String(fs.color || '#fff')}`, borderRadius: `${(Number(fs.radiusPct) || 0) * 200}px` }} />
        }
        if (o.sub === 'timecode') {
          return <div key={o.id} className="absolute pointer-events-none px-1.5 py-0.5 rounded bg-black/45 tabular-nums" style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, color: String(st.color || '#fff'), fontSize: 'clamp(8px, 2vw, 18px)' }}>{fmt(playhead)}</div>
        }
        if (o.sub === 'progress') {
          return <div key={o.id} className="absolute left-0 right-0 pointer-events-none" style={{ top: `${o.top * 100}%`, height: `${Math.max(2, (Number(st.heightPct) || 0.014) * 200)}px`, background: 'rgba(255,255,255,0.2)' }}>
            <div style={{ width: `${dur ? (playhead / dur) * 100 : 0}%`, height: '100%', background: String(st.color || '#ff2d55') }} />
          </div>
        }
        if (o.sub === 'subtitle') {
          const cue = o.cues?.find((c) => playhead >= c.start && playhead <= c.end)
          if (!cue) return null
          const exFont = Number(st.fontSize) || baseH * 0.06
          const pxFont = vrect ? exFont * (vrect.height / baseH) : 16
          return <div key={o.id} className="absolute pointer-events-none text-center"
            style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, width: `${o.width * 100}%`, padding: pxFont * 0.32, boxSizing: 'border-box', lineHeight: 1.28, color: String(st.color || '#fff'), fontSize: pxFont, textShadow: '0 1px 3px rgba(0,0,0,.95)', whiteSpace: 'pre-wrap' }}>{cue.text}</div>
        }
        const exFont = Number(st.fontSize) || baseH * (o.sub === 'sticker' ? 0.16 : 0.06)
        const pxFont = vrect ? exFont * (vrect.height / baseH) : 16
        return (
          <div key={o.id} className="absolute pointer-events-none"
            style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, width: `${o.width * 100}%`, padding: pxFont * 0.32, boxSizing: 'border-box', lineHeight: 1.28, textAlign: st.align === 'center' ? 'center' : 'left', color: String(st.color || '#fff'), fontWeight: st.bold ? 700 : 500, fontSize: pxFont, textShadow: st.stroke === false ? 'none' : '0 1px 2px rgba(0,0,0,.9)', opacity: o.sub === 'watermark' ? 0.7 : 1, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
            {o.text || (o.sub === 'sticker' ? '⭐' : '文字')}
          </div>
        )
      })}
    </div>
  )
}

// ---------- 自定义播放控制条 ----------
function TBtn({ icon: Icon, title, onClick }: { icon: typeof Play; title: string; onClick: () => void }) {
  return <button onClick={onClick} title={title} className="w-7 h-7 grid place-items-center rounded hover:bg-white/15 text-white/85"><Icon size={15} /></button>
}
function TransportBar({ vref, dur, playhead, playing, startAt, onFullscreen }: {
  vref: RefObject<HTMLVideoElement>; dur: number; playhead: number; playing: boolean; startAt: number; onFullscreen: () => void
}) {
  const seek = (t: number) => { const el = vref.current; if (el) el.currentTime = Math.max(0, Math.min(dur || el.duration || 0, t)) }
  const toggle = () => { const el = vref.current; if (el) { el.paused ? void el.play() : el.pause() } }
  return (
    <div className="flex items-center gap-0.5 px-3 h-10 rounded-lg bg-neutral-900/90 text-white shrink-0">
      <TBtn icon={SkipBack} title="回起点 (Home)" onClick={() => seek(startAt)} />
      <TBtn icon={ChevronLeft} title="上一帧 (←)" onClick={() => seek(playhead - 1 / 30)} />
      <button onClick={toggle} title="播放/暂停 (空格)" className="w-9 h-9 grid place-items-center rounded-full bg-white text-neutral-900 hover:bg-white/90 mx-0.5">
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <TBtn icon={ChevronRight} title="下一帧 (→)" onClick={() => seek(playhead + 1 / 30)} />
      <TBtn icon={SkipForward} title="到结尾 (End)" onClick={() => seek(dur)} />
      <span className="ml-2 text-xs tabular-nums text-white/75">{fmt(playhead)} <span className="text-white/40">/ {fmt(dur)}</span></span>
      <div className="ml-auto"><TBtn icon={Maximize} title="全屏 (F)" onClick={onFullscreen} /></div>
    </div>
  )
}

// ---------- 底部多轨时间轴 ----------
const TL_KIND_LABEL: Record<string, string> = { text: '文字', watermark: '水印', sticker: '贴纸', mosaic: '打码', pip: '画中画', progress: '进度条', timecode: '时间码', frame: '边框' }
function StudioTimeline({ stack, thumbs, waveform, dur, playhead, ready, selectedOpId, onSeek, onSelect, onSplit }: {
  stack: EditStack | null; thumbs: string[]; waveform: number[] | null; dur: number; playhead: number; ready: boolean
  selectedOpId: string | null; onSeek: (t: number) => void; onSelect: (id: string) => void; onSplit: () => void
}) {
  const pct = (t: number) => (dur ? (t / dur) * 100 : 0)
  // 以「被点击的内容区」自身矩形换算时间（内容区在 96px 轨道头之后，不能用整行宽度）
  const seekFromContent = (clientX: number, el: HTMLElement) => {
    if (!dur) return
    const r = el.getBoundingClientRect()
    onSeek(Math.min(dur, Math.max(0, ((clientX - r.left) / r.width) * dur)))
  }
  const ops = stack?.ops.filter((o) => o.enabled) || []
  const keeps = ((ops.find((o) => o.kind === 'trim')?.params as TrimParams | undefined)?.segments || []).filter((s) => s.keep !== false && s.out > s.in)
  const overlayBlocks = ops.filter((o) => o.kind === 'overlay' && (o.params as OverlayParams).sub !== 'subtitle' && (o.params as OverlayParams).range)
    .map((o) => ({ id: o.id, p: o.params as OverlayParams }))
  const subtitleOp = ops.find((o) => o.kind === 'overlay' && (o.params as OverlayParams).sub === 'subtitle')
  const cues = (subtitleOp?.params as OverlayParams | undefined)?.cues || []
  const muteRanges = (ops.find((o) => o.kind === 'audio')?.params as AudioParams | undefined)?.muteRanges || []
  // 时间标尺刻度（约每 60px 一个）
  const ticks: number[] = []
  if (dur > 0) { const step = dur <= 12 ? 1 : dur <= 40 ? 5 : dur <= 120 ? 10 : 30; for (let t = 0; t <= dur + 0.01; t += step) ticks.push(t) }

  const Lane = ({ icon: Icon, label, children, onClick }: { icon: typeof Film; label: string; children: ReactNode; onClick?: () => void }) => (
    <div className="flex h-10 border-t" style={{ borderColor: 'var(--ace-border)' }}>
      <div className="w-24 shrink-0 flex items-center gap-1 px-2 text-[10px] opacity-70 border-r" style={{ borderColor: 'var(--ace-border)', background: 'var(--surface-2)' }}><Icon size={11} /> {label}</div>
      <div className="relative flex-1 min-w-0 cursor-pointer" onPointerDown={(e) => { onClick?.(); seekFromContent(e.clientX, e.currentTarget) }}>{children}</div>
    </div>
  )

  return (
    <div className="flex flex-col" style={{ background: 'var(--ace-surface)' }}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-2 h-8 border-t" style={{ borderColor: 'var(--ace-border)' }}>
        <button onClick={onSplit} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-pink-500/15 text-pink-600 dark:text-pink-300 hover:bg-pink-500/25"><Scissors size={11} /> 播放头切分</button>
        <span className="text-[10px] opacity-40 ml-auto tabular-nums">源时间基 · {fmt(playhead)} / {fmt(dur)}</span>
      </div>
      {/* 标尺 */}
      <div className="flex border-t" style={{ borderColor: 'var(--ace-border)' }}>
        <div className="w-24 shrink-0 border-r" style={{ borderColor: 'var(--ace-border)', background: 'var(--surface-2)' }} />
        <div className="relative flex-1 min-w-0 h-5 cursor-pointer" onPointerDown={(e) => seekFromContent(e.clientX, e.currentTarget)}>
          {ticks.map((t, i) => (
            <div key={i} className="absolute top-0 bottom-0 border-l border-black/10 dark:border-white/10" style={{ left: `${pct(t)}%` }}>
              <span className="absolute top-0 left-0.5 text-[9px] opacity-50 tabular-nums">{fmt(t)}</span>
            </div>
          ))}
        </div>
      </div>
      {/* 轨道区（统一播放头覆盖） */}
      <div className="relative">
        {/* 主视频轨 */}
        <Lane icon={Film} label="主视频">
          <div className="absolute inset-0 flex overflow-hidden">
            {thumbs.length ? thumbs.map((t, i) => <img key={i} src={toFileUrl(t)} draggable={false} className="h-full flex-1 object-cover pointer-events-none opacity-90" alt="" />)
              : <div className="flex-1 grid place-items-center text-[9px] opacity-30">{ready ? '' : '读取中…'}</div>}
          </div>
          {keeps.length > 0 && dur > 0 && (() => {
            const segs: ReactNode[] = []
            let prev = 0
            for (const k of keeps) { if (k.in > prev) segs.push(<div key={`g${prev}`} className="absolute inset-y-0 bg-black/55 pointer-events-none" style={{ left: `${pct(prev)}%`, width: `${pct(k.in - prev)}%` }} />); prev = k.out }
            if (prev < dur) segs.push(<div key="ge" className="absolute inset-y-0 bg-black/55 pointer-events-none" style={{ left: `${pct(prev)}%`, right: 0 }} />)
            return segs
          })()}
        </Lane>
        {/* 叠加轨 */}
        {overlayBlocks.length > 0 && (
          <Lane icon={Type} label="叠加">
            {overlayBlocks.map((b) => {
              const r = b.p.range!
              return <div key={b.id} onPointerDown={(e) => { e.stopPropagation(); onSelect(b.id) }}
                className={`absolute top-1 bottom-1 rounded px-1 flex items-center text-[9px] text-white truncate cursor-pointer ${selectedOpId === b.id ? 'ring-2 ring-white' : ''}`}
                style={{ left: `${pct(r.start)}%`, width: `${Math.max(2, pct(r.end - r.start))}%`, background: 'rgba(236,72,153,0.85)' }}>
                {b.p.sub === 'text' ? (b.p.text || '文字') : TL_KIND_LABEL[b.p.sub] || b.p.sub}
              </div>
            })}
          </Lane>
        )}
        {/* 字幕轨 */}
        {subtitleOp && (
          <Lane icon={Type} label="字幕" onClick={() => onSelect(subtitleOp.id)}>
            {cues.map((c, i) => <div key={i} className="absolute top-1.5 bottom-1.5 rounded-sm bg-indigo-500/80 pointer-events-none" style={{ left: `${pct(c.start)}%`, width: `${Math.max(1.5, pct(c.end - c.start))}%` }} title={c.text} />)}
          </Lane>
        )}
        {/* 音频轨 */}
        <Lane icon={Music} label="音频">
          {waveform && waveform.length > 0 ? (
            <div className="absolute inset-0 flex items-center gap-px px-px">
              {waveform.map((p, i) => <div key={i} className="flex-1 bg-emerald-500/60 rounded-sm" style={{ height: `${Math.max(3, p * 90)}%` }} />)}
            </div>
          ) : <div className="absolute inset-0 grid place-items-center text-[9px] opacity-30">无音频波形</div>}
          {muteRanges.map((m, i) => <div key={i} className="absolute inset-y-0 bg-rose-500/35 border-x border-rose-400/60 pointer-events-none" style={{ left: `${pct(m.start)}%`, width: `${pct(m.end - m.start)}%` }} />)}
        </Lane>
        {/* 贯穿播放头 */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-pink-500 pointer-events-none z-10" style={{ left: `calc(6rem + (100% - 6rem) * ${dur ? playhead / dur : 0})` }} />
      </div>
    </div>
  )
}

function IconBtn({ icon: Icon, title, onClick, disabled }: { icon: typeof X; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} className="w-7 h-7 grid place-items-center rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30">
      <Icon size={15} />
    </button>
  )
}

// ---------- 参数面板（按 op 类型）----------
function ParamPanel({ op, dur, playhead }: { op: EditOp; dur: number; playhead: number }) {
  const live = (patch: Record<string, unknown>) => useStudio.getState().updateOpLive(op.id, patch)
  const commit = () => useStudio.getState().commitLive()
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)

  if (op.kind === 'trim') return <TrimPanel op={op} params={op.params as TrimParams} dur={dur} playhead={playhead} />
  if (op.kind === 'overlay') return <OverlayPanel op={op} params={op.params as OverlayParams} dur={dur} playhead={playhead} />
  if (op.kind === 'speed') {
    const p = op.params as SpeedParams
    return (
      <div className="flex flex-col gap-2.5">
        <SliderRow label="倍率" value={p.rate} min={0.25} max={4} step={0.05} suffix="×" onLive={(v) => live({ rate: v })} onCommit={commit} />
        {p.rate < 1 && <Toggle label="平滑慢动作（补帧，较慢）" checked={!!p.smoothSlowmo} onChange={(v) => set({ smoothSlowmo: v })} />}
        <Toggle label="倒放" checked={p.reverse} onChange={(v) => set({ reverse: v })} />
        <Toggle label="保持音调（变速不变调）" checked={p.pitchCompensate !== false} onChange={(v) => set({ pitchCompensate: v })} />
        <Toggle label="回旋 Boomerang（正放→倒放，去音轨）" checked={!!p.boomerang} onChange={(v) => set({ boomerang: v })} />
        <SliderRow label="片尾冻结" value={p.freezeEnd ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ freezeEnd: v })} onCommit={commit} />
        <SliderRow label="运动残影" value={p.motionTrail ?? 0} min={0} max={6} step={1} onLive={(v) => live({ motionTrail: v })} onCommit={commit} />
      </div>
    )
  }
  if (op.kind === 'transform') {
    const p = op.params as TransformParams
    const cropOn = !!p.crop
    return (
      <div className="flex flex-col gap-2.5">
        <Row label="旋转">
          <div className="flex gap-1">
            {[0, 90, 180, 270].map((d) => (
              <button key={d} onClick={() => set({ rotate: d })} className={`px-2 py-1 rounded text-[11px] ${(p.rotate || 0) === d ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>{d}°</button>
            ))}
          </div>
        </Row>
        <Row label="翻转">
          <div className="flex gap-1">
            <button onClick={() => set({ hflip: !p.hflip })} className={`p-1.5 rounded ${p.hflip ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}><FlipHorizontal2 size={13} /></button>
            <button onClick={() => set({ vflip: !p.vflip })} className={`p-1.5 rounded ${p.vflip ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}><FlipVertical2 size={13} /></button>
          </div>
        </Row>
        <Toggle label="裁剪画面" checked={cropOn} onChange={(v) => set({ crop: v ? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } : undefined })} />
        {cropOn && p.crop && (
          <>
            <SliderRow label="左 X" value={p.crop.x} min={0} max={0.9} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, x: v, w: Math.min(p.crop!.w, 1 - v) } })} onCommit={commit} />
            <SliderRow label="上 Y" value={p.crop.y} min={0} max={0.9} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, y: v, h: Math.min(p.crop!.h, 1 - v) } })} onCommit={commit} />
            <SliderRow label="宽" value={p.crop.w} min={0.1} max={1} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, w: Math.min(v, 1 - p.crop!.x) } })} onCommit={commit} />
            <SliderRow label="高" value={p.crop.h} min={0.1} max={1} step={0.01} onLive={(v) => live({ crop: { ...p.crop!, h: Math.min(v, 1 - p.crop!.y) } })} onCommit={commit} />
          </>
        )}
        <Row label="画幅">
          <Select className="flex-1" value={p.outW && p.outH ? `${p.outW}x${p.outH}:${p.fit || 'contain'}` : 'none'}
            onChange={(v) => {
              if (v === 'none') return set({ outW: undefined, outH: undefined })
              const [wh, fit] = v.split(':')
              const [w, h] = wh.split('x').map(Number)
              set({ outW: w, outH: h, fit: fit as TransformParams['fit'] })
            }}
            options={[
              { value: 'none', label: '不改画幅' },
              { value: '720x1280:blur-pad', label: '竖屏 9:16 · 模糊填充' },
              { value: '720x1280:contain', label: '竖屏 9:16 · 黑边' },
              { value: '1280x720:blur-pad', label: '横屏 16:9 · 模糊填充' },
              { value: '1080x1080:cover', label: '方屏 1:1 · 裁满' }
            ]} />
        </Row>
        <SliderRow label="像素化" value={p.pixelate ?? 1} min={1} max={30} step={1} onLive={(v) => live({ pixelate: v })} onCommit={commit} />
        <Row label="镜像">
          <Select className="flex-1" value={p.mirror || 'none'} onChange={(v) => set({ mirror: v as TransformParams['mirror'] })}
            options={[{ value: 'none', label: '无' }, { value: 'h', label: '左右镜像（万花筒）' }, { value: 'v', label: '上下镜像' }]} />
        </Row>
        <SliderRow label="镜头抖动" value={p.shake ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ shake: v })} onCommit={commit} />
        <SliderRow label="故障 Glitch" value={p.glitch ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ glitch: v })} onCommit={commit} />
        <Toggle label="画面去抖稳定" checked={!!p.deshake} onChange={(v) => set({ deshake: v })} />
      </div>
    )
  }
  if (op.kind === 'color') {
    const p = op.params as ColorParams
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1 pb-1">
          {COLOR_PRESETS.map((pr) => (
            <button key={pr.id} onClick={() => set({ ...pr.params, preset: pr.id })} className={`px-2 py-0.5 rounded text-[10px] ${p.preset === pr.id ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10 hover:bg-black/10'}`}>{pr.label}</button>
          ))}
          <button onClick={() => set({ brightness: 0, contrast: 1, saturation: 1, gamma: 1, temp: 0, hue: 0, sharpen: 0, denoise: 0, vignette: 0, grain: 0, preset: undefined })} className="px-2 py-0.5 rounded text-[10px] bg-black/5 dark:bg-white/10">重置</button>
        </div>
        <SliderRow label="亮度" value={p.brightness ?? 0} min={-0.5} max={0.5} step={0.02} onLive={(v) => live({ brightness: v })} onCommit={commit} />
        <SliderRow label="对比度" value={p.contrast ?? 1} min={0.5} max={2} step={0.02} onLive={(v) => live({ contrast: v })} onCommit={commit} />
        <SliderRow label="饱和度" value={p.saturation ?? 1} min={0} max={3} step={0.02} onLive={(v) => live({ saturation: v })} onCommit={commit} />
        <SliderRow label="伽马" value={p.gamma ?? 1} min={0.3} max={2.5} step={0.02} onLive={(v) => live({ gamma: v })} onCommit={commit} />
        <SliderRow label="色温" value={p.temp ?? 0} min={-100} max={100} step={1} onLive={(v) => live({ temp: v })} onCommit={commit} />
        <SliderRow label="色相" value={p.hue ?? 0} min={-180} max={180} step={1} suffix="°" onLive={(v) => live({ hue: v })} onCommit={commit} />
        <SliderRow label="锐化" value={p.sharpen ?? 0} min={0} max={3} step={0.1} onLive={(v) => live({ sharpen: v })} onCommit={commit} />
        <SliderRow label="降噪" value={p.denoise ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ denoise: v })} onCommit={commit} />
        <SliderRow label="暗角" value={p.vignette ?? 0} min={0} max={1} step={0.05} onLive={(v) => live({ vignette: v })} onCommit={commit} />
        <SliderRow label="颗粒" value={p.grain ?? 0} min={0} max={40} step={1} onLive={(v) => live({ grain: v })} onCommit={commit} />
        <Toggle label="反相 negate" checked={!!p.invert} onChange={(v) => set({ invert: v })} />
        <Row label="LUT">
          <button onClick={async () => {
            const m = (window as any).mulby
            try {
              const paths = await m?.dialog?.showOpenDialog({ title: '选择 3D LUT', filters: [{ name: 'LUT', extensions: ['cube', '3dl'] }], properties: ['openFile'] })
              if (paths?.[0]) set({ lutPath: paths[0] })
            } catch { /* ignore */ }
          }} className="px-2 py-1 rounded text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10 truncate flex-1 text-left">
            {p.lutPath ? '已选：' + p.lutPath.split(/[\\/]/).pop() : '选择 .cube…'}
          </button>
          {p.lutPath && <button onClick={() => set({ lutPath: undefined })} className="px-1.5 py-1 rounded text-[10px] bg-black/5 dark:bg-white/10">清除</button>}
        </Row>
      </div>
    )
  }
  if (op.kind === 'audio') {
    const p = op.params as AudioParams
    const ranges = p.muteRanges || []
    return (
      <div className="flex flex-col gap-2.5">
        <SliderRow label="音量" value={p.gainDb ?? 0} min={-30} max={12} step={1} suffix="dB" onLive={(v) => live({ gainDb: v })} onCommit={commit} />
        <SliderRow label="淡入" value={p.fadeIn ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ fadeIn: v })} onCommit={commit} />
        <SliderRow label="淡出" value={p.fadeOut ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ fadeOut: v })} onCommit={commit} />
        <Toggle label="响度归一（loudnorm）" checked={!!p.loudnorm} onChange={(v) => set({ loudnorm: v })} />
        <Toggle label="人声降噪" checked={!!p.denoise} onChange={(v) => set({ denoise: v })} />
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] opacity-60">区间静音（{ranges.length}）</span>
          <button onClick={() => set({ muteRanges: [...ranges, { start: Math.min(playhead, dur - 0.5), end: Math.min(playhead + 2, dur) }] })}
            className="text-[11px] flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 hover:bg-rose-500/25">
            <Plus size={11} /> 在播放头加
          </button>
        </div>
        {ranges.map((r, i) => (
          <div key={i} className="rounded-md border p-2 flex flex-col gap-1" style={{ borderColor: 'var(--ace-border)' }}>
            <div className="flex items-center text-[11px]">
              <span className="opacity-50">静音 #{i + 1}</span>
              <span className="ml-2 tabular-nums opacity-60">{fmt(r.start)}–{fmt(r.end)}</span>
              <button onClick={() => set({ muteRanges: ranges.filter((_, k) => k !== i) })} className="ml-auto opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
            </div>
            <SliderRow label="起" value={r.start} min={0} max={dur} step={0.1} suffix="s"
              onLive={(v) => live({ muteRanges: ranges.map((x, k) => (k === i ? { start: Math.min(v, x.end - 0.1), end: x.end } : x)) })} onCommit={commit} />
            <SliderRow label="止" value={r.end} min={0} max={dur} step={0.1} suffix="s"
              onLive={(v) => live({ muteRanges: ranges.map((x, k) => (k === i ? { start: x.start, end: Math.max(v, x.start + 0.1) } : x)) })} onCommit={commit} />
          </div>
        ))}
        <AudioBgmEditor op={op} p={p} />
      </div>
    )
  }
  if (op.kind === 'export') {
    const p = op.params as ExportParams
    const resVal = p.outW && p.outH ? `${p.outW}x${p.outH}` : 'follow'
    return (
      <div className="flex flex-col gap-2.5">
        <Row label="平台预设">
          <Select className="flex-1" value={p.platform || 'none'} onChange={(v) => {
            if (v === 'none') return set({ platform: undefined })
            const pr = PLATFORM_PRESETS.find((x) => x.id === v)
            if (pr) set({ platform: pr.id, outW: pr.w, outH: pr.h, fps: pr.fps, crf: pr.crf, fit: pr.fit })
          }} options={[{ value: 'none', label: '自定义' }, ...PLATFORM_PRESETS.map((pr) => ({ value: pr.id, label: pr.label, hint: pr.ratio }))]} />
        </Row>
        <Row label="格式">
          <Select className="flex-1" value={p.format} onChange={(v) => set({ format: v })} options={[
            { value: 'mp4', label: 'MP4 (H.264)' }, { value: 'webm', label: 'WebM (VP9)' }, { value: 'gif', label: 'GIF 动图' }, { value: 'webp', label: 'WebP 动图' }
          ]} />
        </Row>
        <Row label="分辨率">
          <Select className="flex-1" value={resVal} onChange={(v) => {
            if (v === 'follow') return set({ outW: undefined, outH: undefined, platform: undefined })
            const [w, h] = v.split('x').map(Number)
            set({ outW: w, outH: h, platform: undefined })
          }} options={RES_OPTIONS.map((r) => ({ value: r.value, label: r.label }))} />
        </Row>
        {(p.format === 'mp4' || p.format === 'webm') && (
          <SliderRow label="画质 CRF" value={p.crf ?? 23} min={16} max={34} step={1} onLive={(v) => live({ crf: v })} onCommit={commit} />
        )}
        <Row label="帧率">
          <Select className="flex-1" value={String(p.fps || 'src')} onChange={(v) => set({ fps: v === 'src' ? undefined : Number(v) })} options={[
            { value: 'src', label: '跟随原视频' }, { value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '12', label: '12 fps（动图）' }
          ]} />
        </Row>
        <SliderRow label="淡入" value={p.fadeIn ?? 0} min={0} max={3} step={0.1} suffix="s" onLive={(v) => live({ fadeIn: v })} onCommit={commit} />
        <SliderRow label="淡出" value={p.fadeOut ?? 0} min={0} max={3} step={0.1} suffix="s" onLive={(v) => live({ fadeOut: v })} onCommit={commit} />
        <div className="text-[10px] opacity-50 leading-relaxed">导出为画布上的一张新卡片，源卡保留；编辑配方写入卡片可二次编辑。</div>
      </div>
    )
  }
  return null
}

// ---- 字幕：cue 序列编辑 + .srt 导入 ----
function srtTime(t: string): number {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000 : 0
}
function parseSrt(text: string): SubtitleCue[] {
  const cues: SubtitleCue[] = []
  const blocks = text.replace(/\r/g, '').split(/\n\n+/)
  for (const b of blocks) {
    const lines = b.split('\n').filter((l) => l.trim() !== '')
    const tl = lines.find((l) => l.includes('-->'))
    if (!tl) continue
    const [a, b2] = tl.split('-->')
    const start = srtTime(a.trim())
    const end = srtTime(b2.trim())
    const txt = lines.slice(lines.indexOf(tl) + 1).join('\n').trim()
    if (txt && end > start) cues.push({ start, end, text: txt })
  }
  return cues
}

function SubtitlePanel({ op, params, dur, playhead }: { op: EditOp; params: OverlayParams; dur: number; playhead: number }) {
  const cues = params.cues || []
  const style = (params.style || {}) as Record<string, unknown>
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)
  const setCues = (c: SubtitleCue[]) => set({ cues: c })
  const setStyle = (patch: Record<string, unknown>) => set({ style: { ...style, ...patch } })

  const addCue = () => {
    const start = Math.min(playhead, dur - 0.5)
    setCues([...cues, { start, end: Math.min(start + 2, dur), text: '字幕内容' }].sort((a, b) => a.start - b.start))
  }
  const importSrt = async () => {
    const m = (window as any).mulby
    try {
      const paths = await m?.dialog?.showOpenDialog({ title: '导入 .srt 字幕', filters: [{ name: '字幕', extensions: ['srt', 'vtt', 'txt'] }], properties: ['openFile'] })
      if (!paths?.[0]) return
      const b64 = await m.filesystem.readFile(paths[0], 'base64')
      const buf = base64ToArrayBuffer(b64)
      let text = new TextDecoder('utf-8').decode(buf)
      if (text.includes('�')) { try { text = new TextDecoder('gbk').decode(buf) } catch { /* keep utf-8 */ } }
      const parsed = parseSrt(text)
      if (parsed.length) { setCues(parsed); toast(`已导入 ${parsed.length} 条字幕`, 'success') }
      else toast('未解析到字幕', 'error')
    } catch { toast('导入失败', 'error') }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <button onClick={addCue} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-pink-500/15 text-pink-600 dark:text-pink-300 hover:bg-pink-500/25"><Plus size={11} /> 在播放头加</button>
        <button onClick={importSrt} className="px-2 py-1 rounded text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10">导入 .srt</button>
        <span className="text-[10px] opacity-50 ml-auto">{cues.length} 条</span>
      </div>
      <div className="flex items-center gap-2">
        <Row label="字号">
          <input type="range" min={16} max={120} step={2} value={Number(style.fontSize) || 44} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} className="flex-1" />
        </Row>
        <input type="color" value={String(style.color || '#ffffff')} onChange={(e) => setStyle({ color: e.target.value })} className="w-7 h-6 rounded" />
      </div>
      <SliderRow label="垂直位置" value={params.rect.y} min={0} max={0.95} step={0.01} onLive={(v) => useStudio.getState().updateOpLive(op.id, { rect: { ...params.rect, y: v } })} onCommit={() => useStudio.getState().commitLive()} />
      <div className="flex flex-col gap-1.5 max-h-[40vh] overflow-auto ace-scroll">
        {cues.map((c, i) => {
          const active = playhead >= c.start && playhead <= c.end
          return (
            <div key={i} className={`rounded-md border p-1.5 flex flex-col gap-1 ${active ? 'ring-1 ring-pink-500' : ''}`} style={{ borderColor: 'var(--ace-border)' }}>
              <div className="flex items-center gap-1 text-[10px]">
                <span className="tabular-nums opacity-60">{fmt(c.start)}–{fmt(c.end)}</span>
                <button onClick={() => setCues(cues.filter((_, k) => k !== i))} className="ml-auto opacity-50 hover:opacity-100"><Trash2 size={11} /></button>
              </div>
              <input value={c.text} onChange={(e) => setCues(cues.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} className="rounded px-1.5 py-0.5 text-xs bg-black/5 dark:bg-white/10 outline-none" />
              <div className="flex items-center gap-1">
                <input type="number" step={0.1} value={c.start.toFixed(1)} onChange={(e) => setCues(cues.map((x, k) => (k === i ? { ...x, start: Math.max(0, Math.min(Number(e.target.value), x.end - 0.1)) } : x)))} className="w-16 rounded px-1 py-0.5 text-[10px] bg-black/5 dark:bg-white/10 outline-none tabular-nums" />
                <span className="text-[10px] opacity-40">→</span>
                <input type="number" step={0.1} value={c.end.toFixed(1)} onChange={(e) => setCues(cues.map((x, k) => (k === i ? { ...x, end: Math.min(dur, Math.max(Number(e.target.value), x.start + 0.1)) } : x)))} className="w-16 rounded px-1 py-0.5 text-[10px] bg-black/5 dark:bg-white/10 outline-none tabular-nums" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- trim 多段编辑 ----
function TrimPanel({ op, params, dur, playhead }: { op: EditOp; params: TrimParams; dur: number; playhead: number }) {
  const segs = params.segments || []
  const set = (segments: TrimParams['segments']) => useStudio.getState().updateOp(op.id, { segments })
  const splitAtPlayhead = () => {
    const t = playhead
    const idx = segs.findIndex((s) => t > s.in + 0.05 && t < s.out - 0.05)
    if (idx < 0) return
    const s = segs[idx]
    const next = [...segs]
    next.splice(idx, 1, { in: s.in, out: t, keep: s.keep }, { in: t, out: s.out, keep: s.keep })
    set(next)
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button onClick={splitAtPlayhead} className="flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-pink-500/15 text-pink-600 dark:text-pink-300 hover:bg-pink-500/25">
          <Scissors size={12} /> 在播放头切一刀
        </button>
        <button onClick={() => set([...segs, { in: 0, out: dur || 1, keep: true }])} className="px-2 py-1 rounded text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10"><Plus size={11} className="inline" /> 片段</button>
      </div>
      {segs.map((s, i) => (
        <div key={i} className="rounded-md border p-2 flex flex-col gap-1.5" style={{ borderColor: 'var(--ace-border)' }}>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="opacity-50">#{i + 1}</span>
            <button onClick={() => set(segs.map((x, k) => (k === i ? { ...x, keep: !x.keep } : x)))}
              className={`px-1.5 py-0.5 rounded text-[10px] ${s.keep ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300' : 'bg-rose-500/20 text-rose-600 dark:text-rose-300'}`}>
              {s.keep ? '保留' : '删除'}
            </button>
            <span className="tabular-nums opacity-60">{fmt(s.in)}–{fmt(s.out)} · {(s.out - s.in).toFixed(1)}s</span>
            <button onClick={() => set(segs.filter((_, k) => k !== i))} className="ml-auto opacity-50 hover:opacity-100" disabled={segs.length <= 1}><Trash2 size={12} /></button>
          </div>
          <SliderRow label="起" value={s.in} min={0} max={dur} step={0.1} suffix="s"
            onLive={(v) => useStudio.getState().updateOpLive(op.id, { segments: segs.map((x, k) => (k === i ? { ...x, in: Math.min(v, x.out - 0.1) } : x)) })}
            onCommit={() => useStudio.getState().commitLive()} />
          <SliderRow label="止" value={s.out} min={0} max={dur} step={0.1} suffix="s"
            onLive={(v) => useStudio.getState().updateOpLive(op.id, { segments: segs.map((x, k) => (k === i ? { ...x, out: Math.max(v, x.in + 0.1) } : x)) })}
            onCommit={() => useStudio.getState().commitLive()} />
        </div>
      ))}
      <div className="text-[10px] opacity-50">保留段按顺序拼接为成片；删除段被剔除。</div>
    </div>
  )
}

// ---- 配乐 / AI 旁白 ----
function AudioBgmEditor({ op, p }: { op: EditOp; p: AudioParams }) {
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)
  const board = useGraph((s) => s.getActiveBoard())
  const selfId = useUi((s) => s.studioCardId)
  const audioCards = Object.values(board.cards).filter((c) => c.kind === 'audio' && !!c.assetLocalPath && c.id !== selfId)
  const [ttsText, setTtsText] = useState('')
  const [ttsBusy, setTtsBusy] = useState(false)
  const bgm = p.bgm

  const pickCard = (id: string) => {
    const c = board.cards[id]
    if (c?.assetLocalPath) set({ bgm: { path: c.assetLocalPath, source: 'card', cardId: id, volume: 0.6, offset: 0, mode: 'mix' } })
  }
  const genTts = async () => {
    if (!ttsText.trim()) return
    const cfg = useProviders.getState().activeFor('audio')
    if (!cfg) { toast('请先在 Provider 设置里配置音频 / TTS 服务', 'error'); return }
    setTtsBusy(true)
    try {
      const key = await useProviders.getState().getKey(cfg.id)
      const r = await runTts(cfg, key, ttsText.trim())
      set({ bgm: { path: r.path, source: 'tts', text: ttsText.trim(), volume: 1, offset: 0, mode: 'mix' } })
      toast('配音已生成', 'success')
    } catch (e: any) {
      toast('配音失败：' + (e?.message || String(e)), 'error')
    } finally {
      setTtsBusy(false)
    }
  }

  return (
    <div className="rounded-md border p-2 flex flex-col gap-2 mt-1" style={{ borderColor: 'var(--ace-border)' }}>
      <span className="text-[11px] font-medium opacity-70 flex items-center gap-1"><Music size={12} /> 配乐 / 旁白</span>
      {bgm ? (
        <>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="truncate flex-1">{bgm.source === 'tts' ? '🎙 ' + (bgm.text || 'AI 配音') : '🎵 ' + (board.cards[bgm.cardId || '']?.title || '音频卡')}</span>
            <button onClick={() => set({ bgm: undefined })} className="opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
          </div>
          <Row label="关系">
            <Select className="flex-1" value={bgm.mode} onChange={(v) => set({ bgm: { ...bgm, mode: v as 'mix' | 'replace' | 'duck' } })}
              options={[{ value: 'mix', label: '混音（叠在原声上）' }, { value: 'replace', label: '替换原声' }, { value: 'duck', label: '闪避（说话时压低）' }]} />
          </Row>
          <SliderRow label="音量" value={bgm.volume ?? 1} min={0} max={2} step={0.05} onLive={(v) => useStudio.getState().updateOpLive(op.id, { bgm: { ...bgm, volume: v } })} onCommit={() => useStudio.getState().commitLive()} />
          <SliderRow label="延迟" value={bgm.offset ?? 0} min={0} max={10} step={0.1} suffix="s" onLive={(v) => useStudio.getState().updateOpLive(op.id, { bgm: { ...bgm, offset: v } })} onCommit={() => useStudio.getState().commitLive()} />
        </>
      ) : (
        <>
          {audioCards.length > 0 && (
            <Row label="选音频卡">
              <Select className="flex-1" value="" placeholder="画布上的音频卡" onChange={pickCard} options={audioCards.map((c) => ({ value: c.id, label: c.title || '音频' }))} />
            </Row>
          )}
          <div className="flex flex-col gap-1">
            <textarea value={ttsText} onChange={(e) => setTtsText(e.target.value)} rows={2} placeholder="AI 配音文案…" className="rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10 outline-none resize-none" />
            <button onClick={genTts} disabled={ttsBusy || !ttsText.trim()} className="self-start flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-amber-500/15 text-amber-600 dark:text-amber-300 hover:bg-amber-500/25 disabled:opacity-40">
              {ttsBusy ? <Loader2 size={11} className="animate-spin" /> : <Music size={11} />} 生成 AI 配音
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---- overlay 叠加编辑（文字/水印/贴纸/打码）----
function OverlayPanel({ op, params, dur, playhead }: { op: EditOp; params: OverlayParams; dur: number; playhead: number }) {
  const p = params
  if (p.sub === 'subtitle') return <SubtitlePanel op={op} params={p} dur={dur} playhead={playhead} />
  const live = (patch: Record<string, unknown>) => useStudio.getState().updateOpLive(op.id, patch)
  const commit = () => useStudio.getState().commitLive()
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)
  const setRect = (patch: Partial<OverlayParams['rect']>) => live({ rect: { ...p.rect, ...patch } })
  const setStyle = (patch: Record<string, unknown>) => set({ style: { ...(p.style || {}), ...patch } })
  const style = (p.style || {}) as Record<string, unknown>
  const isText = p.sub === 'text' || p.sub === 'watermark' || p.sub === 'sticker'
  const rangeOn = !!p.range
  const board = useGraph((s) => s.getActiveBoard())
  const selfId = useUi((s) => s.studioCardId)
  const videoCards = Object.values(board.cards).filter((c) => c.kind === 'video' && !!c.assetLocalPath && c.id !== selfId)

  if (p.sub === 'timecode') {
    const ts = (p.style || {}) as Record<string, unknown>
    return (
      <div className="flex flex-col gap-2.5">
        <div className="text-[11px] font-medium opacity-70">时间码</div>
        <Row label="颜色"><input type="color" value={String(ts.color || '#ffffff')} onChange={(e) => set({ style: { ...ts, color: e.target.value } })} className="w-8 h-6 rounded" /></Row>
        <SliderRow label="位置 X" value={p.rect.x} min={0} max={1} step={0.01} onLive={(v) => live({ rect: { ...p.rect, x: Math.min(v, 1 - p.rect.w) } })} onCommit={commit} />
        <SliderRow label="位置 Y" value={p.rect.y} min={0} max={1} step={0.01} onLive={(v) => live({ rect: { ...p.rect, y: Math.min(v, 1 - p.rect.h) } })} onCommit={commit} />
        <div className="text-[10px] opacity-50">显示从 0 开始的运行时间（M:SS），随播放推进。</div>
      </div>
    )
  }
  if (p.sub === 'progress') {
    const ps = (p.style || {}) as Record<string, unknown>
    return (
      <div className="flex flex-col gap-2.5">
        <div className="text-[11px] font-medium opacity-70">播放进度条</div>
        <Row label="颜色"><input type="color" value={String(ps.color || '#ff2d55')} onChange={(e) => set({ style: { ...ps, color: e.target.value } })} className="w-8 h-6 rounded" /></Row>
        <SliderRow label="粗细" value={Number(ps.heightPct) || 0.014} min={0.004} max={0.05} step={0.002} onLive={(v) => live({ style: { ...ps, heightPct: v } })} onCommit={commit} />
        <SliderRow label="垂直位置" value={p.rect.y} min={0} max={0.98} step={0.01} onLive={(v) => live({ rect: { ...p.rect, y: v } })} onCommit={commit} />
      </div>
    )
  }
  if (p.sub === 'frame') {
    const fs = (p.style || {}) as Record<string, unknown>
    const setFs = (patch: Record<string, unknown>) => set({ style: { ...fs, ...patch } })
    return (
      <div className="flex flex-col gap-2.5">
        <div className="text-[11px] font-medium opacity-70">相框 / 边框</div>
        <Row label="颜色">
          <input type="color" value={String(fs.color || '#ffffff')} onChange={(e) => setFs({ color: e.target.value })} className="w-8 h-6 rounded" />
        </Row>
        <SliderRow label="粗细" value={Number(fs.widthPct) || 0.03} min={0.005} max={0.12} step={0.005} onLive={(v) => live({ style: { ...fs, widthPct: v } })} onCommit={commit} />
        <SliderRow label="圆角" value={Number(fs.radiusPct) || 0} min={0} max={0.2} step={0.01} onLive={(v) => live({ style: { ...fs, radiusPct: v } })} onCommit={commit} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11px] font-medium opacity-70">{p.sub === 'mosaic' ? '局部打码' : p.sub === 'pip' ? '画中画 PiP' : p.sub === 'watermark' ? '水印' : p.sub === 'sticker' ? '贴纸/Emoji' : '文字'}</div>
      {p.sub === 'pip' && (
        <>
          <Row label="来源">
            <Select className="flex-1" value={p.pipCardId || ''} onChange={(v) => set({ pipCardId: v })} placeholder="选择画布上的视频卡"
              options={videoCards.map((c) => ({ value: c.id, label: c.title || '视频' }))} />
          </Row>
          <SliderRow label="大小" value={p.rect.w} min={0.1} max={0.6} step={0.01} onLive={(v) => setRect({ w: Math.min(v, 1 - p.rect.x), h: Math.min(v, 1 - p.rect.y) })} onCommit={commit} />
          {!videoCards.length && <div className="text-[10px] text-amber-500">画布上需另有视频卡作为子画面来源。</div>}
        </>
      )}
      {isText && (
        <>
          <Row label="内容">
            <input value={p.text || ''} onChange={(e) => set({ text: e.target.value })} className="flex-1 rounded px-2 py-1 text-xs bg-black/5 dark:bg-white/10 outline-none" placeholder="文字…" />
          </Row>
          <Row label="字号">
            <input type="range" min={12} max={160} step={2} value={Number(style.fontSize) || 48} onChange={(e) => setStyle({ fontSize: Number(e.target.value) })} className="flex-1" />
            <span className="w-10 text-right tabular-nums opacity-70">{Number(style.fontSize) || 48}</span>
          </Row>
          <Row label="颜色">
            <input type="color" value={String(style.color || '#ffffff')} onChange={(e) => setStyle({ color: e.target.value })} className="w-8 h-6 rounded" />
            <Toggle label="居中" checked={style.align === 'center'} onChange={(v) => setStyle({ align: v ? 'center' : 'left' })} />
            <Toggle label="描边" checked={style.stroke !== false} onChange={(v) => setStyle({ stroke: v })} />
          </Row>
        </>
      )}
      {p.sub === 'mosaic' && (
        <>
          <Row label="方式">
            <div className="flex gap-1">
              <button onClick={() => set({ blurKind: 'mosaic' })} className={`px-2 py-0.5 rounded text-[10px] ${p.blurKind !== 'blur' ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>马赛克</button>
              <button onClick={() => set({ blurKind: 'blur' })} className={`px-2 py-0.5 rounded text-[10px] ${p.blurKind === 'blur' ? 'bg-pink-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>模糊</button>
            </div>
          </Row>
          <SliderRow label="强度" value={p.pixelSize || 14} min={4} max={40} step={1} onLive={(v) => live({ pixelSize: v })} onCommit={commit} />
          <SliderRow label="宽" value={p.rect.w} min={0.05} max={1} step={0.01} onLive={(v) => setRect({ w: Math.min(v, 1 - p.rect.x) })} onCommit={commit} />
          <SliderRow label="高" value={p.rect.h} min={0.05} max={1} step={0.01} onLive={(v) => setRect({ h: Math.min(v, 1 - p.rect.y) })} onCommit={commit} />
        </>
      )}
      <SliderRow label="位置 X" value={p.rect.x} min={0} max={1} step={0.01} onLive={(v) => setRect({ x: Math.min(v, 1 - p.rect.w) })} onCommit={commit} />
      <SliderRow label="位置 Y" value={p.rect.y} min={0} max={1} step={0.01} onLive={(v) => setRect({ y: Math.min(v, 1 - p.rect.h) })} onCommit={commit} />
      {isText && <SliderRow label="盒宽" value={p.rect.w} min={0.1} max={1} step={0.01} onLive={(v) => setRect({ w: Math.min(v, 1 - p.rect.x) })} onCommit={commit} />}
      <Toggle label="限定时间段（默认全程）" checked={rangeOn} onChange={(v) => set({ range: v ? { start: 0, end: Math.min(3, dur || 3) } : undefined })} />
      {rangeOn && p.range && (
        <>
          <SliderRow label="起" value={p.range.start} min={0} max={dur} step={0.1} suffix="s" onLive={(v) => live({ range: { start: Math.min(v, p.range!.end - 0.1), end: p.range!.end } })} onCommit={commit} />
          <SliderRow label="止" value={p.range.end} min={0} max={dur} step={0.1} suffix="s" onLive={(v) => live({ range: { start: p.range!.start, end: Math.max(v, p.range!.start + 0.1) } })} onCommit={commit} />
        </>
      )}
    </div>
  )
}
