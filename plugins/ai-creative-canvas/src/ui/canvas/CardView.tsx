import { memo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Image as ImageIcon, Video, Type, Music, Package, StickyNote, Play, Pause, Volume2, VolumeX, Camera, Loader2, AlertCircle, ArrowUpRight } from 'lucide-react'
import { captureFrame } from '../services/mediaOps'
import { invalidTargetIds } from '../services/connectionPolicy'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { screenToWorld } from './viewport'
import { stageEl } from './stageEl'
import { KIND_ACCENT, type Card, type CardKind } from '../types'

const KIND_ICON: Record<CardKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  text: Type,
  audio: Music,
  source: Package,
  group: Package,
  note: StickyNote
}

const NOTE_COLORS = ['#fef9c3', '#fde68a', '#fecaca', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#ffffff']

const fmtTime = (s: number) => {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// 卡内视频播放器：中央播放钮 + 悬停底部控制条（播放/静音/可拖拽进度/时间）
function VideoCardPlayer({ card, onFit }: { card: Card; onFit: (w: number, h: number) => void }) {
  const vref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [prog, setProg] = useState(0)
  const [dur, setDur] = useState(0)

  const toggle = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    const v = vref.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPlaying(true)
    } else {
      v.pause()
      setPlaying(false)
    }
  }
  const seek = (clientX: number, el: HTMLElement) => {
    const v = vref.current
    if (!v || !v.duration) return
    const r = el.getBoundingClientRect()
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    v.currentTime = p * v.duration
    setProg(p)
  }

  return (
    <div className="relative w-full h-full bg-neutral-900">
      <video
        ref={vref}
        src={card.assetUrl as string}
        muted={muted}
        playsInline
        loop
        preload="metadata"
        onLoadedMetadata={(e) => {
          onFit(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
          setDur(e.currentTarget.duration)
          // 轻微 seek 强制首帧解码渲染，避免加载完成前的黑屏 poster
          try {
            e.currentTarget.currentTime = Math.min(0.1, (e.currentTarget.duration || 1) / 100)
          } catch {
            /* ignore */
          }
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget
          if (v.duration) setProg(v.currentTime / v.duration)
        }}
        onEnded={() => setPlaying(false)}
        className="w-full h-full object-cover"
      />
      {!playing && (
        <button
          data-interactive
          onClick={toggle}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 grid place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
          title="播放"
        >
          <Play size={18} />
        </button>
      )}
      <div
        data-interactive
        className="absolute bottom-0 inset-x-0 px-2 py-1 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <button onClick={toggle} className="text-white shrink-0" title={playing ? '暂停' : '播放'}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className="flex-1 h-1.5 rounded-full bg-white/30 cursor-pointer relative" onPointerDown={(e) => { e.stopPropagation(); seek(e.clientX, e.currentTarget) }}>
          <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${Math.round(prog * 100)}%` }} />
        </div>
        <span className="text-[10px] text-white tabular-nums shrink-0">
          {fmtTime(prog * dur)}/{fmtTime(dur)}
        </span>
        <button onClick={(e) => { e.stopPropagation(); void captureFrame(card.id, vref.current?.currentTime || 0) }} className="text-white shrink-0" title="截取当前帧为图片">
          <Camera size={14} />
        </button>
        <button onClick={(e) => { e.stopPropagation(); setMuted((m) => !m) }} className="text-white shrink-0" title={muted ? '取消静音' : '静音'}>
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        </button>
      </div>
    </div>
  )
}

// memo：平移时父级每帧重渲，但本卡 props（card 引用/selected/related）不变即可跳过。
// CardView 仅订阅 updateCard（稳定 action）与 connInvalidIds（连线拖拽期才变），均不随视口变化。
function CardViewImpl({ card, selected, related }: { card: Card; selected: boolean; related?: boolean }) {
  const updateCard = useGraph((s) => s.updateCard)
  const meta = { icon: KIND_ICON[card.kind], accent: KIND_ACCENT[card.kind] }
  const Icon = meta.icon
  const [editing, setEditing] = useState(false)
  const connInvalid = useUi((s) => s.connInvalidIds)
  const dimmed = !!connInvalid && connInvalid.has(card.id)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [resizeBubble, setResizeBubble] = useState<{ w: number; h: number } | null>(null)

  // 媒体加载后把卡片高度调整为媒体真实比例（按当前宽度），每个 assetUrl 只调一次
  const fitAspect = (w: number, h: number) => {
    if (!w || !h) return
    setDims({ w, h })
    if (card.meta && (card.meta as any).fittedFor === card.assetUrl) return
    const newH = Math.max(90, Math.min(620, Math.round(card.w * (h / w))))
    updateCard(card.id, { h: newH, meta: { ...card.meta, fittedFor: card.assetUrl } })
  }

  // 从端口拖出连线：window 级监听，最稳，不依赖合成事件 / 指针捕获 / 事件委托
  const startConnect = (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    const pid = e.pointerId
    try { handle.setPointerCapture(pid) } catch { /* ignore */ }
    const sourceId = card.id
    useUi.getState().setConnInvalid(invalidTargetIds(sourceId, useGraph.getState().getActiveBoard().cards))
    const move = (ev: PointerEvent) => {
      const rect = stageEl.current?.getBoundingClientRect()
      if (!rect) return
      const b = useGraph.getState().getActiveBoard()
      const src = b.cards[sourceId]
      if (!src) return
      const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top, b.viewport)
      useUi.getState().setConnectTemp({ x1: src.x + src.w, y1: src.y + src.h / 2, x2: w.x, y2: w.y })
    }
    const cleanup = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', cancel)
      handle.removeEventListener('lostpointercapture', cancel)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onCtx)
      try { handle.releasePointerCapture(pid) } catch { /* ignore */ }
      useUi.getState().setConnectTemp(null)
      useUi.getState().setConnInvalid(null)
    }
    // 指针捕获：拖出窗口仍收事件；lostpointercapture(真正丢指针)/Esc/右键 都收尾，
    // 避免「线粘住鼠标」。不用 window blur 兜底——它会在切窗/输入法夺焦等正常场景误取消拖拽。
    const cancel = () => cleanup()
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cleanup() }
    const onCtx = (ev: Event) => { ev.preventDefault(); cleanup() }
    const up = (ev: PointerEvent) => {
      cleanup()
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null
      const tc = el?.closest('[data-card-id]') as HTMLElement | null
      const targetId = tc?.dataset.cardId
      if (targetId && targetId !== sourceId) {
        useGraph.getState().addEdgeBetween(sourceId, targetId)
      } else if (!targetId) {
        // 落在空白处 → 在落点弹出菜单，新建一个节点并连接
        const rect = stageEl.current?.getBoundingClientRect()
        if (rect) {
          const sx = ev.clientX - rect.left
          const sy = ev.clientY - rect.top
          const b = useGraph.getState().getActiveBoard()
          const w = screenToWorld(sx, sy, b.viewport)
          useUi.getState().setConnectMenu({ sx, sy, wx: w.x, wy: w.y, sourceIds: [sourceId] })
        }
      }
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', cancel)
    handle.addEventListener('lostpointercapture', cancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onCtx)
  }

  // 手动缩放卡片（右下角手柄）；标记 fittedFor 避免媒体加载后又被自动比例覆盖
  const startCardResize = (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    const pid = e.pointerId
    try { handle.setPointerCapture(pid) } catch { /* ignore */ }
    const move = (ev: PointerEvent) => {
      const rect = stageEl.current?.getBoundingClientRect()
      if (!rect) return
      const b = useGraph.getState().getActiveBoard()
      const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top, b.viewport)
      const nw = Math.max(120, Math.round(w.x - card.x))
      const nh = Math.max(80, Math.round(w.y - card.y))
      updateCard(card.id, { w: nw, h: nh, meta: { ...card.meta, fittedFor: card.assetUrl } })
      setResizeBubble({ w: nw, h: nh })
    }
    // 松手 / 指针被打断(lostpointercapture) / Esc / 右键 都收尾——避免缩放卡死跟随鼠标
    const cleanup = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', cleanup)
      handle.removeEventListener('pointercancel', cleanup)
      handle.removeEventListener('lostpointercapture', cleanup)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('contextmenu', onCtx)
      try { handle.releasePointerCapture(pid) } catch { /* ignore */ }
      setResizeBubble(null)
    }
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cleanup() }
    const onCtx = (ev: Event) => { ev.preventDefault(); cleanup() }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', cleanup)
    handle.addEventListener('pointercancel', cleanup)
    handle.addEventListener('lostpointercapture', cleanup)
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onCtx)
  }

  const isImg = (card.kind === 'image' || card.kind === 'source') && !!card.assetUrl
  const isVid = card.kind === 'video' && !!card.assetUrl
  const isAud = card.kind === 'audio' && !!card.assetUrl
  const isTxt = card.kind === 'text' && !!card.text

  // 本次多结果（meta.results）：卡上堆叠展示 + 角标切换主图
  const results = ((card.meta as any)?.results as Array<{ url: string; localPath: string; mime: string }>) || []
  const multi = results.length > 1
  const curIdx = multi ? Math.max(0, results.findIndex((r) => r.url === card.assetUrl)) : 0
  const cycleResult = () => {
    if (!multi) return
    const n = results[(curIdx + 1) % results.length]
    updateCard(card.id, { assetUrl: n.url, assetLocalPath: n.localPath, mime: n.mime, meta: { ...card.meta, fittedFor: undefined } })
  }

  // 便签卡：彩色便利贴，双击就地编辑，悬停/选中显示换色
  if (card.kind === 'note') {
    const noteColor = ((card.params as any)?.noteColor as string) || '#fef9c3'
    return (
      <div
        data-card-id={card.id}
        className={`ace-card group absolute rounded-xl ${selected ? 'ring-2 z-10' : ''} ${dimmed ? 'opacity-30 saturate-50' : ''}`}
        style={{ left: card.x, top: card.y, width: card.w, height: card.h, ['--tw-ring-color' as any]: meta.accent }}
      >
        <div className="absolute inset-0 rounded-xl overflow-hidden" style={{ background: noteColor, color: '#1f2937', boxShadow: 'var(--shadow-card)' }}>
          {editing ? (
            <textarea
              data-interactive
              autoFocus
              defaultValue={card.text || ''}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                updateCard(card.id, { text: e.target.value })
                setEditing(false)
              }}
              className="w-full h-full p-2.5 bg-transparent outline-none resize-none text-[13px] leading-relaxed"
              placeholder="输入便签内容…"
            />
          ) : (
            <div
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(true)
              }}
              className="w-full h-full p-2.5 text-[13px] leading-relaxed whitespace-pre-wrap overflow-auto ace-scroll"
            >
              {card.text || <span className="opacity-40">双击编辑便签</span>}
            </div>
          )}
        </div>
        <div data-interactive className={`absolute -top-2.5 left-2 flex items-center gap-1 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              onClick={(e) => {
                e.stopPropagation()
                updateCard(card.id, { params: { ...card.params, noteColor: c } })
              }}
              className="w-3.5 h-3.5 rounded-full border border-black/10 shadow"
              style={{ background: c }}
              title="便签颜色"
            />
          ))}
        </div>
        <div
          data-interactive
          onPointerDown={startCardResize}
          title="拖拽缩放"
          className={`absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize z-30 transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          style={{ borderRight: `2px solid ${meta.accent}`, borderBottom: `2px solid ${meta.accent}`, borderBottomRightRadius: 10 }}
        />
      </div>
    )
  }

  return (
    <div
      data-card-id={card.id}
      className={`ace-card group absolute rounded-xl ${selected ? 'ring-2 z-10' : ''}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        ['--tw-ring-color' as any]: meta.accent,
        boxShadow: related ? `0 0 0 2px ${meta.accent}66, 0 0 14px ${meta.accent}33` : undefined
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if ((card.meta as any)?.pano && card.assetUrl) {
          useUi.getState().setPanoCardId(card.id) // 全景卡 → 360 环视
        } else if ((card.kind === 'image' || card.kind === 'source') && card.assetUrl) {
          useUi.getState().setMaskCardId(card.id) // 双击图片节点 → 进入局部编辑页面
        } else if (card.kind === 'video' && card.assetUrl) {
          useUi.getState().setPreview({ url: card.assetUrl, kind: 'video' })
        }
      }}
    >
      {(() => {
        const shot = (card.meta as any)?.shot
        const t = (card.title || '').trim()
        const custom = !!t && !['AI 图片', 'AI 视频', 'AI 文本', 'AI 音频', '素材', '分组'].includes(t)
        if (!shot && !custom) return null
        return (
          <div className="absolute top-1 left-1 z-20 max-w-[88%] truncate px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] leading-none pointer-events-none">
            {t}
            {shot?.duration ? ` · ${shot.duration}s` : ''}
          </div>
        )
      })()}
      {(card.meta as any)?.pano && (
        <div className="absolute top-1 right-1 z-20 flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-600/85 text-white text-[10px] leading-none pointer-events-none">
          360°
        </div>
      )}
      {/* 多结果堆叠背板（露出右下角，暗示有多张） */}
      {isImg && multi && (
        <>
          <div className="absolute inset-0 rounded-xl border bg-white dark:bg-neutral-900 translate-x-1.5 translate-y-1.5" style={{ borderColor: 'var(--ace-border)' }} />
          <div className="absolute inset-0 rounded-xl border bg-white dark:bg-neutral-900 translate-x-3 translate-y-3" style={{ borderColor: 'var(--ace-border)' }} />
        </>
      )}
      {/* 内容层：承载边框、圆角与裁剪；无标题栏 */}
      <div
        className="absolute inset-0 rounded-xl overflow-hidden border bg-white dark:bg-neutral-900"
        style={{ borderColor: selected ? meta.accent : 'var(--ace-border)' }}
      >
        {isImg ? (
          <img
            src={card.assetUrl as string}
            draggable={false}
            onLoad={(e) => fitAspect(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            className="w-full h-full object-cover"
            alt=""
          />
        ) : isVid ? (
          <VideoCardPlayer card={card} onFit={fitAspect} />
        ) : isAud ? (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 p-3">
            <Music size={22} style={{ color: meta.accent }} />
            <audio src={card.assetUrl as string} controls data-interactive className="w-full" />
          </div>
        ) : isTxt ? (
          <div className="w-full h-full overflow-auto p-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ace-scroll">
            {card.text}
          </div>
        ) : (
          <div className="w-full h-full grid place-items-center p-3 text-center">
            <div className="flex flex-col items-center gap-2 opacity-60">
              <Icon size={24} style={{ color: meta.accent }} />
              {card.prompt && <span className="text-xs line-clamp-3">{card.prompt}</span>}
            </div>
          </div>
        )}
      </div>

      {/* 文本/占位卡的小类型角标（媒体卡保持干净，不显示） */}
      {isTxt && (
        <div className="absolute top-1.5 left-1.5 w-5 h-5 grid place-items-center rounded-md bg-white/85 dark:bg-neutral-800/85 shadow-sm z-20">
          <Icon size={12} style={{ color: meta.accent }} />
        </div>
      )}

      {/* 多结果切换角标 */}
      {multi && card.status !== 'running' && card.status !== 'queued' && (
        <button
          data-interactive
          onClick={cycleResult}
          title="切换本次生成的其它结果"
          className="absolute top-1.5 right-1.5 z-20 px-1.5 h-5 grid place-items-center rounded-md bg-black/60 text-white text-[10px] leading-none hover:bg-black/80"
        >
          {curIdx + 1}/{results.length}
        </button>
      )}

      {/* 状态覆盖 */}
      {(card.status === 'running' || card.status === 'queued') && (
        <div className="absolute top-1.5 right-1.5 w-6 h-6 grid place-items-center rounded-full bg-black/55 text-white z-20">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
      {card.status === 'running' && (
        <div
          className="absolute bottom-0 left-0 h-1 z-20"
          style={{ width: `${Math.round((card.progress || 0) * 100)}%`, background: meta.accent }}
        />
      )}
      {card.status === 'error' && (
        <div className="absolute bottom-0 inset-x-0 px-2 py-1 text-[11px] bg-red-500/90 text-white flex items-center gap-1 rounded-b-xl z-20">
          <AlertCircle size={12} className="shrink-0" />
          <span className="truncate">{card.error || '生成失败'}</span>
        </div>
      )}

      {/* 拖出产物为素材卡：左侧中央，悬停/选中显示 */}
      {(isImg || isVid) && (
        <div
          data-interactive
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-ace-asset', JSON.stringify({ url: card.assetUrl, localPath: card.assetLocalPath, mime: card.mime, title: card.title, kind: card.kind }))
            e.dataTransfer.effectAllowed = 'copy'
          }}
          title="拖出为素材卡（可作其它节点的输入）"
          className={`absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-5 grid place-items-center rounded-full border-2 border-white dark:border-neutral-900 bg-neutral-500 text-white cursor-grab z-30 shadow transition-opacity ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <ArrowUpRight size={11} />
        </div>
      )}

      {/* 连线端口：右侧中央、半露出，悬停/选中时显示，便于拖出引用 */}
      <div
        title="从这里拖到另一张卡片以建立引用"
        onPointerDown={startConnect}
        className={`absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white dark:border-neutral-900 cursor-crosshair z-30 shadow transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ background: meta.accent }}
      />

      {/* 媒体尺寸（图片，悬停显示） */}
      {dims && isImg && (
        <div className="absolute bottom-1.5 left-1.5 z-20 px-1.5 py-0.5 rounded bg-black/55 text-white text-[9px] leading-none tabular-nums opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          {dims.w}×{dims.h}
        </div>
      )}
      {/* 缩放手柄：右下角圆点，悬停/选中显示；拖动时显尺寸气泡 */}
      <div
        data-interactive
        onPointerDown={startCardResize}
        title="拖拽缩放卡片"
        className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white dark:border-neutral-900 cursor-nwse-resize z-30 shadow transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ background: meta.accent }}
      />
      {resizeBubble && (
        <div className="absolute -top-6 right-0 z-40 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] leading-none tabular-nums pointer-events-none">
          {resizeBubble.w}×{resizeBubble.h}
        </div>
      )}
    </div>
  )
}

export const CardView = memo(CardViewImpl)
