import { type PointerEvent as ReactPointerEvent } from 'react'
import { Image as ImageIcon, Video, Type, Music, Package, Loader2, AlertCircle } from 'lucide-react'
import { useGraph } from '../store/graphStore'
import { useUi } from '../store/uiStore'
import { screenToWorld } from './viewport'
import { stageEl } from './stageEl'
import type { Card, CardKind } from '../types'

const KIND_META: Record<CardKind, { icon: typeof ImageIcon; accent: string }> = {
  image: { icon: ImageIcon, accent: '#6366f1' },
  video: { icon: Video, accent: '#ec4899' },
  text: { icon: Type, accent: '#10b981' },
  audio: { icon: Music, accent: '#f59e0b' }
  ,
  source: { icon: Package, accent: '#64748b' },
  group: { icon: Package, accent: '#64748b' }
}

export function CardView({ card, selected }: { card: Card; selected: boolean }) {
  const updateCard = useGraph((s) => s.updateCard)
  const meta = KIND_META[card.kind]
  const Icon = meta.icon

  // 媒体加载后把卡片高度调整为媒体真实比例（按当前宽度），每个 assetUrl 只调一次
  const fitAspect = (w: number, h: number) => {
    if (!w || !h) return
    if (card.meta && (card.meta as any).fittedFor === card.assetUrl) return
    const newH = Math.max(90, Math.min(620, Math.round(card.w * (h / w))))
    updateCard(card.id, { h: newH, meta: { ...card.meta, fittedFor: card.assetUrl } })
  }

  // 从端口拖出连线：window 级监听，最稳，不依赖合成事件 / 指针捕获 / 事件委托
  const startConnect = (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const sourceId = card.id
    const move = (ev: PointerEvent) => {
      const rect = stageEl.current?.getBoundingClientRect()
      if (!rect) return
      const b = useGraph.getState().getActiveBoard()
      const src = b.cards[sourceId]
      if (!src) return
      const w = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top, b.viewport)
      useUi.getState().setConnectTemp({ x1: src.x + src.w, y1: src.y + src.h / 2, x2: w.x, y2: w.y })
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      useUi.getState().setConnectTemp(null)
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
          useUi.getState().setConnectMenu({ sx, sy, wx: w.x, wy: w.y, sourceId })
        }
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const isImg = (card.kind === 'image' || card.kind === 'source') && !!card.assetUrl
  const isVid = card.kind === 'video' && !!card.assetUrl
  const isAud = card.kind === 'audio' && !!card.assetUrl
  const isTxt = card.kind === 'text' && !!card.text

  return (
    <div
      data-card-id={card.id}
      className={`ace-card group absolute rounded-xl ${selected ? 'ring-2 z-10' : ''}`}
      style={{
        left: card.x,
        top: card.y,
        width: card.w,
        height: card.h,
        ['--tw-ring-color' as any]: meta.accent
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (card.assetUrl && (card.kind === 'image' || card.kind === 'source' || card.kind === 'video')) {
          useUi.getState().setPreview({ url: card.assetUrl, kind: card.kind === 'video' ? 'video' : 'image' })
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
          <video
            src={card.assetUrl as string}
            muted
            playsInline
            onLoadedMetadata={(e) => fitAspect(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            className="w-full h-full object-cover"
          />
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

      {/* 连线端口：右侧中央、半露出，悬停/选中时显示，便于拖出引用 */}
      <div
        title="从这里拖到另一张卡片以建立引用"
        onPointerDown={startConnect}
        className={`absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white dark:border-neutral-900 cursor-crosshair z-30 shadow transition-opacity ${
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        style={{ background: meta.accent }}
      />
    </div>
  )
}
