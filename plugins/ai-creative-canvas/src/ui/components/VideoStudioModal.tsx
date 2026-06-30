import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  X, Film, Loader2, Undo2, Redo2, Eye, EyeOff, Trash2, ChevronUp, ChevronDown,
  Scissors, Gauge, Crop, Palette, Music, Download, Plus, FlipHorizontal2, FlipVertical2
} from 'lucide-react'
import { useEscClose } from '../hooks'
import { useUi } from '../store/uiStore'
import { useGraph } from '../store/graphStore'
import { useStudio } from '../store/studioStore'
import { Select } from './Select'
import { ensureFfmpeg, probeDuration, timelineThumbs } from '../services/mediaVideo'
import { toFileUrl } from '../services/media'
import { stackToPreview } from '../services/videoEdit/preview'
import { PLATFORM_PRESETS } from '../services/videoEdit/exportPresets'
import { OP_KIND_LABEL, type EditOp, type OpKind, type TrimParams, type SpeedParams, type TransformParams, type ColorParams, type AudioParams, type ExportParams, type OverlayParams } from '../services/videoEdit/types'
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
  const [ready, setReady] = useState(false)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [playhead, setPlayhead] = useState(0)
  const [saveLocal, setSaveLocal] = useState(false)

  const card = useGraph((s) => s.getActiveBoard().cards[cardId])
  const close = () => {
    if (useStudio.getState().busy) return
    useStudio.getState().close()
    useUi.getState().setStudioCardId(null)
  }
  useEscClose(close)

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
      }
    })()
    return () => {
      alive = false
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId])

  // Ctrl+Z / Ctrl+Y（Shift+Z 也作重做）撤销重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); useStudio.getState().undo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); useStudio.getState().redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const pv = stackToPreview(stack)

  // 同步 playbackRate
  useEffect(() => {
    if (vref.current) vref.current.playbackRate = pv.playbackRate || 1
  }, [pv.playbackRate])

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
      mosaic: { sub: 'mosaic', rect: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 }, blurKind: 'mosaic', pixelSize: 14 }
    }
    useStudio.getState().addOp('overlay', presets[sub] as never)
  }

  return (
    <div className={`fixed inset-0 ${Z.modal} bg-black/60 flex items-center justify-center p-4`} onClick={close}>
      <div data-interactive onClick={(e) => e.stopPropagation()} className="ace-dialog ace-anim-scale w-[1080px] max-w-full h-[88vh] flex flex-col text-neutral-800 dark:text-neutral-200">
        {/* 头部 */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--ace-border)' }}>
          <Film size={16} className="text-pink-500" />
          <span className="font-semibold text-sm">剪辑工作台</span>
          <span className="text-[11px] opacity-50 truncate">· {card.title}</span>
          <div className="ml-auto flex items-center gap-1">
            <IconBtn icon={Undo2} title="撤销 (Ctrl+Z)" disabled={!useStudio.getState().canUndo()} onClick={() => useStudio.getState().undo()} />
            <IconBtn icon={Redo2} title="重做 (Ctrl+Y)" disabled={!useStudio.getState().canRedo()} onClick={() => useStudio.getState().redo()} />
            <IconBtn icon={X} title="关闭 (Esc)" onClick={close} />
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* 左：预览 + 时间轴 */}
          <div className="flex-1 min-w-0 flex flex-col p-3 gap-2 border-r" style={{ borderColor: 'var(--ace-border)' }}>
            <div className="relative flex-1 min-h-0 grid place-items-center bg-black rounded-lg overflow-hidden">
              <div className="relative max-h-full max-w-full" style={{ clipPath: pv.clipPath }}>
                <video ref={vref} src={srcUrl} onLoadedMetadata={onMeta} controls className="max-h-[52vh] max-w-full object-contain" style={{ filter: pv.filter, transform: pv.transform }} />
              </div>
              {/* 叠加 DOM 近似 */}
              {pv.overlays.map((o) => {
                const st = (o.style || {}) as Record<string, unknown>
                if (o.sub === 'mosaic') {
                  return <div key={o.id} className="absolute pointer-events-none rounded-sm border-2 border-dashed border-amber-300/80 bg-black/30 backdrop-blur-sm grid place-items-center text-[9px] text-amber-200"
                    style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, width: `${o.width * 100}%`, height: '20%' }}>打码区</div>
                }
                return (
                  <div key={o.id} className="absolute pointer-events-none leading-tight"
                    style={{ left: `${o.left * 100}%`, top: `${o.top * 100}%`, width: `${o.width * 100}%`, textAlign: st.align === 'center' ? 'center' : 'left', color: String(st.color || '#fff'), fontWeight: st.bold ? 700 : 500, fontSize: 'clamp(8px, 2.4vw, 22px)', textShadow: st.stroke === false ? 'none' : '0 1px 2px rgba(0,0,0,.9)', opacity: o.sub === 'watermark' ? 0.7 : 1 }}>
                    {o.text || (o.sub === 'sticker' ? '⭐' : '文字')}
                  </div>
                )
              })}
              {!pv.exact && (
                <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-amber-500/90 text-white text-[10px]">近似预览 · 导出更准</div>
              )}
            </div>
            {/* 缩略图时间轴 */}
            <div className="relative h-12 rounded-md overflow-hidden border flex select-none" style={{ borderColor: 'var(--ace-border)' }}
              onPointerDown={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const t = Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur))
                if (vref.current) vref.current.currentTime = t
                setPlayhead(t)
              }}>
              {thumbs.length ? thumbs.map((t, i) => <img key={i} src={toFileUrl(t)} draggable={false} className="h-full flex-1 object-cover pointer-events-none" alt="" />)
                : <div className="flex-1 grid place-items-center text-[10px] opacity-40">{ready ? '无缩略图' : '读取中…'}</div>}
              {/* 删除段灰罩 */}
              {pv.keeps && dur > 0 && (() => {
                const segs: ReactNode[] = []
                let prev = 0
                for (const k of pv.keeps) {
                  if (k.in > prev) segs.push(<div key={`g${prev}`} className="absolute inset-y-0 bg-black/55 pointer-events-none" style={{ left: `${(prev / dur) * 100}%`, width: `${((k.in - prev) / dur) * 100}%` }} />)
                  prev = k.out
                }
                if (prev < dur) segs.push(<div key="gend" className="absolute inset-y-0 bg-black/55 pointer-events-none" style={{ left: `${(prev / dur) * 100}%`, right: 0 }} />)
                return segs
              })()}
              <div className="absolute inset-y-0 w-0.5 bg-pink-500 pointer-events-none" style={{ left: `${dur ? (playhead / dur) * 100 : 0}%` }} />
            </div>
            <div className="flex items-center justify-between text-[11px] tabular-nums opacity-60">
              <span>{fmt(playhead)} / {fmt(dur)}</span>
              <span>原始 {stack?.baseW}×{stack?.baseH}</span>
            </div>
          </div>

          {/* 右：操作栈 + 参数面板 */}
          <div className="w-[340px] shrink-0 flex flex-col">
            {/* 添加大类 */}
            <div className="flex flex-wrap gap-1 p-2 border-b" style={{ borderColor: 'var(--ace-border)' }}>
              {ADDABLE.map((a) => (
                <button key={a.kind} disabled={present.has(a.kind)} onClick={() => addOp(a.kind)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed">
                  <Plus size={11} /> {a.label}
                </button>
              ))}
              {[{ s: 'text', l: '文字' }, { s: 'watermark', l: '水印' }, { s: 'sticker', l: '贴纸' }, { s: 'mosaic', l: '打码' }].map((o) => (
                <button key={o.s} onClick={() => addOverlay(o.s)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] bg-pink-500/10 text-pink-600 dark:text-pink-300 hover:bg-pink-500/20">
                  <Plus size={11} /> {o.l}
                </button>
              ))}
            </div>
            {/* 操作栈 */}
            <div className="max-h-[26%] overflow-auto ace-scroll p-2 flex flex-col gap-1 border-b" style={{ borderColor: 'var(--ace-border)' }}>
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
            {/* 参数面板 */}
            <div className="flex-1 min-h-0 overflow-auto ace-scroll p-3">
              {selectedOp ? <ParamPanel op={selectedOp} dur={dur} playhead={playhead} /> : <div className="text-[11px] opacity-40 text-center py-8">从上方选择或添加一个操作</div>}
            </div>
          </div>
        </div>

        {/* 底部：导出 */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-t" style={{ borderColor: 'var(--ace-border)' }}>
          {busy && (
            <div className="flex-1 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <div className="h-full bg-pink-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          {!busy && <span className="text-[11px] opacity-50">{ready ? '编辑就绪 · 导出生成新卡片' : '正在读取视频…'}</span>}
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
  if (op.kind === 'overlay') return <OverlayPanel op={op} params={op.params as OverlayParams} dur={dur} />
  if (op.kind === 'speed') {
    const p = op.params as SpeedParams
    return (
      <div className="flex flex-col gap-2.5">
        <SliderRow label="倍率" value={p.rate} min={0.25} max={4} step={0.05} suffix="×" onLive={(v) => live({ rate: v })} onCommit={commit} />
        <Toggle label="倒放" checked={p.reverse} onChange={(v) => set({ reverse: v })} />
        <Toggle label="保持音调（变速不变调）" checked={p.pitchCompensate !== false} onChange={(v) => set({ pitchCompensate: v })} />
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
      </div>
    )
  }
  if (op.kind === 'audio') {
    const p = op.params as AudioParams
    return (
      <div className="flex flex-col gap-2.5">
        <SliderRow label="音量" value={p.gainDb ?? 0} min={-30} max={12} step={1} suffix="dB" onLive={(v) => live({ gainDb: v })} onCommit={commit} />
        <SliderRow label="淡入" value={p.fadeIn ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ fadeIn: v })} onCommit={commit} />
        <SliderRow label="淡出" value={p.fadeOut ?? 0} min={0} max={5} step={0.1} suffix="s" onLive={(v) => live({ fadeOut: v })} onCommit={commit} />
        <Toggle label="响度归一（loudnorm）" checked={!!p.loudnorm} onChange={(v) => set({ loudnorm: v })} />
        <Toggle label="人声降噪" checked={!!p.denoise} onChange={(v) => set({ denoise: v })} />
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
        <div className="text-[10px] opacity-50 leading-relaxed">导出为画布上的一张新卡片，源卡保留；编辑配方写入卡片可二次编辑。</div>
      </div>
    )
  }
  return null
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

// ---- overlay 叠加编辑（文字/水印/贴纸/打码）----
function OverlayPanel({ op, params, dur }: { op: EditOp; params: OverlayParams; dur: number }) {
  const p = params
  const live = (patch: Record<string, unknown>) => useStudio.getState().updateOpLive(op.id, patch)
  const commit = () => useStudio.getState().commitLive()
  const set = (patch: Record<string, unknown>) => useStudio.getState().updateOp(op.id, patch)
  const setRect = (patch: Partial<OverlayParams['rect']>) => live({ rect: { ...p.rect, ...patch } })
  const setStyle = (patch: Record<string, unknown>) => set({ style: { ...(p.style || {}), ...patch } })
  const style = (p.style || {}) as Record<string, unknown>
  const isText = p.sub === 'text' || p.sub === 'watermark' || p.sub === 'sticker'
  const rangeOn = !!p.range

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-[11px] font-medium opacity-70">{p.sub === 'mosaic' ? '局部打码' : p.sub === 'watermark' ? '水印' : p.sub === 'sticker' ? '贴纸/Emoji' : '文字'}</div>
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
