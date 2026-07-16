import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject, type PointerEvent as RPointerEvent } from 'react'
import {
  X, Film, Loader2, Undo2, Redo2, Eye, EyeOff, Trash2, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Scissors, Gauge, Crop, Palette, Music, Download, Plus,
  Play, Pause, SkipBack, SkipForward, Maximize, PanelBottomClose, PanelBottomOpen, Type,
  Captions, Stamp, Sticker, Grid2x2, Square, RectangleHorizontal, Timer, PictureInPicture2, Settings2, type LucideIcon
} from 'lucide-react'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { useStudio } from '../store/studioStore'
import { ensureFfmpeg, probeDuration, probeResolution, timelineThumbs } from '../services/mediaVideo'
import { toFileUrl } from '../services/media'
import { stackToPreview, type PreviewOverlay } from '../services/videoEdit/preview'
import { loadWaveform } from '../services/audioWaveform'
import { OP_KIND_LABEL, type EditOp, type EditStack, type OpKind, type TrimParams, type SpeedParams, type AudioParams, type OverlayParams } from '../services/videoEdit/types'
import { Z } from '../zlayers'
import { fmt, IconBtn, TBtn, ToolTile, ToolSection } from './studioControls'
import { ParamPanel } from './studioPanels'

const KIND_ICON: Record<OpKind, typeof Scissors> = {
  trim: Scissors, speed: Gauge, transform: Crop, color: Palette, overlay: Plus, audio: Music, export: Download
}

// 左侧工具条（PS 风）：全局工具（单例）+ 叠加工具（多实例）+ 导出
const GLOBAL_TOOLS: { kind: OpKind; label: string; icon: LucideIcon }[] = [
  { kind: 'trim', label: '裁切', icon: Scissors },
  { kind: 'speed', label: '变速', icon: Gauge },
  { kind: 'transform', label: '几何', icon: Crop },
  { kind: 'color', label: '调色', icon: Palette },
  { kind: 'audio', label: '音频', icon: Music }
]
const OVERLAY_TOOLS: { sub: string; label: string; icon: LucideIcon }[] = [
  { sub: 'text', label: '文字', icon: Type },
  { sub: 'subtitle', label: '字幕', icon: Captions },
  { sub: 'watermark', label: '水印', icon: Stamp },
  { sub: 'sticker', label: '贴纸', icon: Sticker },
  { sub: 'mosaic', label: '打码', icon: Grid2x2 },
  { sub: 'frame', label: '边框', icon: Square },
  { sub: 'progress', label: '进度条', icon: RectangleHorizontal },
  { sub: 'timecode', label: '时间码', icon: Timer },
  { sub: 'pip', label: '画中画', icon: PictureInPicture2 }
]
const OVERLAY_PRESETS: Record<string, Record<string, unknown>> = {
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
      // 用 ffmpeg+sharp 探测真实分辨率并在 ready 前落定：<video> 无法解码（HEVC 等）时 onLoadedMetadata 不触发，
      // baseW 会恒为占位 16，导致导出叠加 PNG 缩成几像素。探测失败则退回 onLoadedMetadata 路径（可解码源）。
      if (path) {
        const res = await probeResolution(useGraph.getState().project.id, path, ac.signal)
        if (!alive) return
        if (res) useStudio.getState().setBase({ baseW: res.width, baseH: res.height })
      }
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

  const startAt = pv.keeps?.[0]?.in ?? 0
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

        {/* 中部：功能面板 + 预览(含 Transport) + 检查器 */}
        <div className="flex-1 min-h-0 flex">
          <ToolPanel stack={stack} selectedOp={selectedOp} />
          <div className="flex-1 min-w-0 flex flex-col p-3 gap-2 border-r" style={{ borderColor: 'var(--ace-border)' }}>
            <div ref={stageRef} className="relative flex-1 min-h-0 grid place-items-center bg-black rounded-lg overflow-hidden">
              <video ref={vref} src={srcUrl} onLoadedMetadata={() => { onMeta(); measure() }} className="max-h-full max-w-full object-contain" style={{ filter: pv.filter, transform: pv.transform, clipPath: pv.clipPath }} />
              <OverlayLayer overlays={pv.overlays} playhead={playhead} dur={dur} baseH={stack?.baseH || 720} vrect={vrect} />
              {!pv.exact && <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-amber-500/90 text-white text-[10px] pointer-events-none">近似预览 · 导出更准</div>}
            </div>
            <TransportBar vref={vref} dur={dur} playhead={playhead} playing={playing} startAt={startAt} onFullscreen={fullscreen} />
          </div>

          {/* 检查器 Inspector：图层(操作栈) + 参数面板 */}
          <div className="w-[320px] shrink-0 flex flex-col">
            <div className="px-3 py-1.5 text-[10px] font-medium opacity-50 border-b flex items-center gap-1" style={{ borderColor: 'var(--ace-border)' }}>
              图层 <span className="opacity-60">· 左侧面板添加</span>
            </div>
            <div className="max-h-[26%] overflow-auto ace-scroll p-2 flex flex-col gap-1 border-b" style={{ borderColor: 'var(--ace-border)' }}>
              {!stack?.ops.length && <div className="text-[11px] opacity-40 text-center py-3">从左侧面板添加操作</div>}
              {stack?.ops.map((op, i) => {
                const Icon = KIND_ICON[op.kind]
                const sel = op.id === selectedOpId
                return (
                  <div key={op.id} onClick={() => useStudio.getState().selectOp(op.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-[11px] ${sel ? 'bg-pink-500/15 ring-1 ring-pink-500/40' : 'hover:bg-black/5 dark:hover:bg-white/10'} ${op.enabled ? '' : 'opacity-45'}`}>
                    <Icon size={13} className="shrink-0 text-pink-500" />
                    <span className="flex-1 truncate">{OP_KIND_LABEL[op.kind]}</span>
                    {op.kind !== 'export' && (
                      <>
                        {/* 上/下移仅对 overlay 有意义：单例大类(trim/speed/color…)编译顺序被 OP_KIND_ORDER 钉死、reduceStack 每类只取最后启用项，重排看不到变化 */}
                        {op.kind === 'overlay' && (
                          <>
                            <button title="上移" onClick={(e) => { e.stopPropagation(); useStudio.getState().moveOp(op.id, -1) }} className="opacity-50 hover:opacity-100" disabled={i === 0}><ChevronUp size={12} /></button>
                            <button title="下移" onClick={(e) => { e.stopPropagation(); useStudio.getState().moveOp(op.id, 1) }} className="opacity-50 hover:opacity-100"><ChevronDown size={12} /></button>
                          </>
                        )}
                        <button title={op.enabled ? '停用' : '启用'} onClick={(e) => { e.stopPropagation(); useStudio.getState().toggleOp(op.id) }} className="opacity-60 hover:opacity-100">{op.enabled ? <Eye size={12} /> : <EyeOff size={12} />}</button>
                        <button title="删除" onClick={(e) => { e.stopPropagation(); useStudio.getState().removeOp(op.id) }} className="opacity-50 hover:opacity-100"><Trash2 size={12} /></button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex-1 min-h-0 overflow-auto ace-scroll p-3">
              {selectedOp ? <ParamPanel op={selectedOp} dur={dur} playhead={playhead} /> : <div className="text-[11px] opacity-40 text-center py-8">从左侧工具条添加操作<br />或点图层 / 时间轴上的块编辑</div>}
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
            style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, width: `${o.width * 100}%`, height: `${o.height * 100}%` }}>打码区</div>
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
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  // 以「被点击的内容区」自身矩形换算时间（内容区在 96px 轨道头之后，不能用整行宽度）
  const seekFromContent = (clientX: number, el: HTMLElement) => {
    if (!dur) return
    onSeek(clamp(((clientX - el.getBoundingClientRect().left) / el.getBoundingClientRect().width) * dur, 0, dur))
  }
  // 播放头 scrub：按下即定位、拖动持续定位
  const startScrub = (e: RPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    seekFromContent(e.clientX, el)
    const move = (ev: PointerEvent) => seekFromContent(ev.clientX, el)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  // 拖时间块：像素位移换秒 → apply 改时间窗（updateOpLive），松手 commit
  const dragBlock = (e: RPointerEvent<HTMLDivElement>, apply: (dSec: number) => void) => {
    e.stopPropagation()
    const lane = (e.currentTarget as HTMLElement).closest('[data-lane]') as HTMLElement | null
    const pxPerSec = (lane?.getBoundingClientRect().width || 1) / (dur || 1)
    const startX = e.clientX
    const move = (ev: PointerEvent) => apply((ev.clientX - startX) / pxPerSec)
    const up = () => { useStudio.getState().commitLive(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  const ops = stack?.ops.filter((o) => o.enabled) || []
  const trimSegs = (ops.find((o) => o.kind === 'trim')?.params as TrimParams | undefined)?.segments || []
  const keeps = trimSegs.filter((s) => s.keep !== false && s.out > s.in)
  const spd = ops.find((o) => o.kind === 'speed')?.params as SpeedParams | undefined
  // 源时间基是否等于输出（无删段、无变速）→ 决定输出基块(字幕/静音)能否直接在轴上拖
  const srcEqOut = !trimSegs.some((s) => s.keep === false) && !(spd && ((spd.rate ?? 1) !== 1 || spd.reverse || spd.boomerang || (spd.freezeEnd ?? 0) > 0))
  const overlayBlocks = ops.filter((o) => o.kind === 'overlay' && (o.params as OverlayParams).sub !== 'subtitle' && (o.params as OverlayParams).range)
    .map((o) => ({ id: o.id, p: o.params as OverlayParams }))
  const subtitleOp = ops.find((o) => o.kind === 'overlay' && (o.params as OverlayParams).sub === 'subtitle')
  const cues = (subtitleOp?.params as OverlayParams | undefined)?.cues || []
  const audioOp = ops.find((o) => o.kind === 'audio')
  const muteRanges = (audioOp?.params as AudioParams | undefined)?.muteRanges || []
  const ticks: number[] = []
  if (dur > 0) { const step = dur <= 12 ? 1 : dur <= 40 ? 5 : dur <= 120 ? 10 : 30; for (let t = 0; t <= dur + 0.01; t += step) ticks.push(t) }

  const rangeDrag = (r: { start: number; end: number }, mode: 'move' | 'in' | 'out', d: number) => {
    const len = r.end - r.start
    if (mode === 'move') { const s = clamp(r.start + d, 0, dur - len); return { start: s, end: s + len } }
    if (mode === 'in') return { start: clamp(r.start + d, 0, r.end - 0.1), end: r.end }
    return { start: r.start, end: clamp(r.end + d, r.start + 0.1, dur) }
  }
  const dragOverlay = (id: string, r: { start: number; end: number }, mode: 'move' | 'in' | 'out') => (e: RPointerEvent<HTMLDivElement>) => {
    onSelect(id)
    dragBlock(e, (d) => useStudio.getState().updateOpLive(id, { range: rangeDrag(r, mode, d) }))
  }
  const dragMute = (i: number, mode: 'move' | 'in' | 'out') => (e: RPointerEvent<HTMLDivElement>) => {
    if (!audioOp) return
    dragBlock(e, (d) => useStudio.getState().updateOpLive(audioOp.id, { muteRanges: muteRanges.map((x, k) => (k === i ? rangeDrag(x, mode, d) : x)) }))
  }

  const Lane = ({ icon: Icon, label, children, onClick }: { icon: typeof Film; label: string; children: ReactNode; onClick?: () => void }) => (
    <div className="flex h-11 border-t" style={{ borderColor: 'var(--ace-border)' }}>
      <div className="w-24 shrink-0 flex items-center gap-1 px-2 text-[10px] opacity-70 border-r" style={{ borderColor: 'var(--ace-border)', background: 'var(--surface-2)' }}><Icon size={11} /> {label}</div>
      <div data-lane className="relative flex-1 min-w-0 cursor-pointer" onPointerDown={(e) => { onClick?.(); startScrub(e) }}>{children}</div>
    </div>
  )
  // 带左右把手的可拖时间块
  const Block = ({ left, width, color, ring, label, onBody, onIn, onOut }: {
    left: number; width: number; color: string; ring?: boolean; label?: string
    onBody: (e: RPointerEvent<HTMLDivElement>) => void; onIn: (e: RPointerEvent<HTMLDivElement>) => void; onOut: (e: RPointerEvent<HTMLDivElement>) => void
  }) => (
    <div onPointerDown={onBody}
      className={`absolute top-1 bottom-1 rounded flex items-center overflow-hidden text-[9px] text-white cursor-grab active:cursor-grabbing ${ring ? 'ring-2 ring-white' : ''}`}
      style={{ left: `${left}%`, width: `${Math.max(1.5, width)}%`, background: color }}>
      <div onPointerDown={onIn} className="absolute left-0 inset-y-0 w-1.5 bg-white/40 hover:bg-white/80 cursor-ew-resize" />
      <span className="px-2 truncate flex-1 select-none pointer-events-none">{label}</span>
      <div onPointerDown={onOut} className="absolute right-0 inset-y-0 w-1.5 bg-white/40 hover:bg-white/80 cursor-ew-resize" />
    </div>
  )

  return (
    <div className="flex flex-col" style={{ background: 'var(--ace-surface)' }}>
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-2 h-8 border-t" style={{ borderColor: 'var(--ace-border)' }}>
        <button onClick={onSplit} className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-pink-500/15 text-pink-600 dark:text-pink-300 hover:bg-pink-500/25"><Scissors size={11} /> 播放头切分</button>
        {!srcEqOut && <span className="text-[10px] text-amber-500">变速/裁切下，字幕·静音块请在检查器编辑</span>}
        <span className="text-[10px] opacity-40 ml-auto tabular-nums">拖块改时间 · {fmt(playhead)} / {fmt(dur)}</span>
      </div>
      {/* 标尺 */}
      <div className="flex border-t" style={{ borderColor: 'var(--ace-border)' }}>
        <div className="w-24 shrink-0 border-r" style={{ borderColor: 'var(--ace-border)', background: 'var(--surface-2)' }} />
        <div data-lane className="relative flex-1 min-w-0 h-5 cursor-pointer" onPointerDown={startScrub}>
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
        {/* 叠加轨（可拖：移动/拖边改时间窗，源时间基始终正确） */}
        {overlayBlocks.length > 0 && (
          <Lane icon={Type} label="叠加">
            {overlayBlocks.map((b) => {
              const r = b.p.range!
              return <Block key={b.id} left={pct(r.start)} width={pct(r.end - r.start)} color="rgba(236,72,153,0.9)" ring={selectedOpId === b.id}
                label={b.p.sub === 'text' ? (b.p.text || '文字') : TL_KIND_LABEL[b.p.sub] || b.p.sub}
                onBody={dragOverlay(b.id, r, 'move')} onIn={dragOverlay(b.id, r, 'in')} onOut={dragOverlay(b.id, r, 'out')} />
            })}
          </Lane>
        )}
        {/* 字幕轨（只读展示，编辑在检查器） */}
        {subtitleOp && (
          <Lane icon={Captions} label="字幕" onClick={() => onSelect(subtitleOp.id)}>
            {cues.map((c, i) => <div key={i} className="absolute top-1.5 bottom-1.5 rounded-sm bg-indigo-500/80 pointer-events-none" style={{ left: `${pct(c.start)}%`, width: `${Math.max(1.5, pct(c.end - c.start))}%` }} title={c.text} />)}
          </Lane>
        )}
        {/* 音频轨（静音块 源≡输出 时可拖） */}
        <Lane icon={Music} label="音频">
          {waveform && waveform.length > 0 ? (
            <div className="absolute inset-0 flex items-center gap-px px-px pointer-events-none">
              {waveform.map((p, i) => <div key={i} className="flex-1 bg-emerald-500/55 rounded-sm" style={{ height: `${Math.max(3, p * 90)}%` }} />)}
            </div>
          ) : <div className="absolute inset-0 grid place-items-center text-[9px] opacity-30 pointer-events-none">无音频波形</div>}
          {muteRanges.map((m, i) => srcEqOut
            ? <Block key={i} left={pct(m.start)} width={pct(m.end - m.start)} color="rgba(244,63,94,0.55)" label="静音" onBody={dragMute(i, 'move')} onIn={dragMute(i, 'in')} onOut={dragMute(i, 'out')} />
            : <div key={i} className="absolute inset-y-0 bg-rose-500/30 border-x border-rose-400/50 pointer-events-none opacity-60" style={{ left: `${pct(m.start)}%`, width: `${pct(m.end - m.start)}%` }} />)}
        </Lane>
        {/* 贯穿播放头 */}
        <div className="absolute top-0 bottom-0 w-0.5 bg-pink-500 pointer-events-none z-10" style={{ left: `calc(6rem + (100% - 6rem) * ${dur ? playhead / dur : 0})` }} />
      </div>
    </div>
  )
}

// ---------- 左侧功能面板（CapCut/剪映 风：图标+文字，分组）----------
function ToolPanel({ stack, selectedOp }: { stack: EditStack | null; selectedOp: EditOp | null }) {
  const addGlobal = (kind: OpKind) => {
    const ex = stack?.ops.find((o) => o.kind === kind)
    if (ex) useStudio.getState().selectOp(ex.id)
    else if (kind === 'trim') useStudio.getState().addOp('trim', { segments: [{ in: 0, out: stack?.baseDuration || 1, keep: true }] } as never)
    else useStudio.getState().addOp(kind)
  }
  const addOverlay = (sub: string) => useStudio.getState().addOp('overlay', OVERLAY_PRESETS[sub] as never)
  const selSub = selectedOp?.kind === 'overlay' ? (selectedOp.params as OverlayParams).sub : null
  const present = new Set((stack?.ops || []).map((o) => o.kind))
  return (
    <div className="w-[132px] shrink-0 border-r flex flex-col overflow-y-auto ace-scroll pb-2" style={{ borderColor: 'var(--ace-border)', background: 'var(--surface-2)' }}>
      <ToolSection title="基础编辑">
        {GLOBAL_TOOLS.map((t) => <ToolTile key={t.kind} icon={t.icon} label={t.label} active={selectedOp?.kind === t.kind} dot={present.has(t.kind)} onClick={() => addGlobal(t.kind)} />)}
      </ToolSection>
      <ToolSection title="叠加元素">
        {OVERLAY_TOOLS.map((t) => <ToolTile key={t.sub} icon={t.icon} label={t.label} active={selSub === t.sub} onClick={() => addOverlay(t.sub)} />)}
      </ToolSection>
      <div className="mt-auto">
        <ToolSection title="输出"><ToolTile icon={Settings2} label="导出" active={selectedOp?.kind === 'export'} onClick={() => addGlobal('export')} /></ToolSection>
      </div>
    </div>
  )
}
