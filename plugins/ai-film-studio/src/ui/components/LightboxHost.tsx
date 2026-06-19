import { useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ListVideo, Wand2, Loader2 } from 'lucide-react'
import { useUiStore, type LightboxItem } from '../store/uiStore'
import { useGraphStore } from '../store/graphStore'
import { useMediaUrl, type MediaRef } from '../services/mediaUrl'

/**
 * 应用级 Lightbox（统一窗口）：节点预览 / Inspector / 素材库 / 结果查看器 都开这一个。
 * - 看大图、带控件播视频、左右切换 + 键盘导航；多视频「连看」自动顺播。
 * - 带节点上下文(nodeId+port+index)的图片：展示标题/提示词/元信息 + 可「对话改图 / 重新生成」，
 *   并实时读取该节点产物（改完即时更新，无需重开）。
 */
export default function LightboxHost() {
  const lb = useUiStore((s) => s.lightbox)
  const close = useUiStore((s) => s.closeLightbox)
  const nav = useUiStore((s) => s.lightboxNav)
  const editItem = useGraphStore((s) => s.editNodeImageItem)
  const regenItem = useGraphStore((s) => s.regenNodeImageItem)
  const [autoplay, setAutoplay] = useState(true) // 连看：视频播完自动切下一个
  const [editPrompt, setEditPrompt] = useState('')
  const [busy, setBusy] = useState(false)

  const ctx: LightboxItem | undefined = lb ? lb.items[lb.index] : undefined
  // 实时读取该产物（改图/重生成后即时反映）；无节点上下文则用打开时的快照 ref
  const node = useGraphStore((s) => (ctx?.nodeId ? s.nodes.find((n) => n.id === ctx.nodeId) : undefined))

  useEffect(() => {
    if (!lb) return
    const onKey = (e: KeyboardEvent) => {
      if (busy) return
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') nav(-1)
      else if (e.key === 'ArrowRight') nav(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lb, close, nav, busy])

  // 切换图片时清空改图输入框
  useEffect(() => {
    setEditPrompt('')
  }, [lb?.index])

  if (!lb || !ctx) return null
  const multi = lb.items.length > 1
  const hasVideo = lb.items.some((it) => it.type === 'video')

  // live 产物（节点上下文存在时）→ ref/meta 取最新；否则用快照
  const out = node && ctx.port ? node.data.outputs?.[ctx.port] : undefined
  const live = out ? (out.items && ctx.index != null ? out.items[ctx.index] : ctx.index === 0 ? out : undefined) : undefined
  const ref = (live as MediaRef | undefined) || ctx.ref
  const meta = (live?.meta as Record<string, unknown> | undefined) || ctx.meta
  const title = ctx.title || node?.data.title
  const promptText = ctx.prompt || str(meta?.prompt) || str(meta?.description)
  const chips = metaChips(meta)
  const canEdit = ctx.type === 'image' && !!ctx.nodeId && !!ctx.port && ctx.index != null
  const showInfo = !!title || chips.length > 0 || !!promptText || canEdit

  const onVideoEnded = () => {
    if (autoplay && multi && lb.index < lb.items.length - 1) nav(1)
  }
  const doEdit = async () => {
    if (!canEdit || !editPrompt.trim() || busy) return
    setBusy(true)
    try {
      await editItem(ctx.nodeId!, ctx.port!, ctx.index!, editPrompt.trim())
      setEditPrompt('')
    } finally {
      setBusy(false)
    }
  }
  const doRegen = async () => {
    if (!canEdit || busy) return
    setBusy(true)
    try {
      await regenItem(ctx.nodeId!, ctx.port!, ctx.index!)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="afs-lbhost" onClick={busy ? undefined : close}>
      <button className="afs-lbhost__close" onClick={close} disabled={busy} title="关闭 (Esc)">
        <X size={20} />
      </button>
      {multi && hasVideo && (
        <button
          className={`afs-lbhost__toggle${autoplay ? ' is-on' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            setAutoplay((v) => !v)
          }}
          title={autoplay ? '连看中：视频播完自动放下一段（点击关闭）' : '开启连看：按顺序连续播放所有片段'}
        >
          <ListVideo size={15} /> {autoplay ? '连看中' : '连看'}
        </button>
      )}
      {multi && (
        <>
          <button className="afs-lbhost__nav afs-lbhost__nav--prev" onClick={(e) => { e.stopPropagation(); nav(-1) }} title="上一个 (←)">
            <ChevronLeft size={30} />
          </button>
          <button className="afs-lbhost__nav afs-lbhost__nav--next" onClick={(e) => { e.stopPropagation(); nav(1) }} title="下一个 (→)">
            <ChevronRight size={30} />
          </button>
        </>
      )}
      <div className="afs-lbhost__stage" onClick={(e) => e.stopPropagation()}>
        <div className="afs-lbhost__frame">
          <LightboxMedia key={`${lb.index}-${ref.assetId || ref.url || ''}`} refv={ref} type={ctx.type} autoplay={autoplay} onEnded={onVideoEnded} />
          {busy && (
            <div className="afs-lbhost__busy">
              <Loader2 size={30} className="afs-spin" />
              <span>生成中…</span>
            </div>
          )}
        </div>
        {showInfo && (
          <div className="afs-lbhost__info">
            {title && <div className="afs-lbhost__info-title">{title}</div>}
            {chips.length > 0 && (
              <div className="afs-lbhost__info-chips">
                {chips.map((c, i) => (
                  <span className="afs-chip" key={i}>
                    {c}
                  </span>
                ))}
              </div>
            )}
            {promptText && <div className="afs-lbhost__info-prompt">提示词：{promptText}</div>}
            {canEdit && (
              <div className="afs-lbhost__edit">
                <button className="afs-btn afs-btn--mini" disabled={busy} onClick={doRegen} title="按当前上游/参考图重新生成这一张">
                  重新生成
                </button>
                <Wand2 size={14} />
                <input
                  className="afs-field__input"
                  placeholder="描述如何修改这张图（img2img）…"
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doEdit()
                  }}
                  disabled={busy}
                />
                <button className="afs-btn afs-btn--mini" disabled={!editPrompt.trim() || busy} onClick={doEdit}>
                  {busy ? <Loader2 size={13} className="afs-spin" /> : '修改'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {multi && (
        <div className="afs-lbhost__count">
          {lb.index + 1} / {lb.items.length}
        </div>
      )}
    </div>
  )
}

function LightboxMedia({ refv, type, autoplay, onEnded }: { refv: MediaRef; type: 'image' | 'video'; autoplay: boolean; onEnded: () => void }) {
  const url = useMediaUrl(refv)
  if (!url) return <div className="afs-lbhost__loading">加载中…</div>
  return type === 'video' ? (
    <video className="afs-lbhost__media" src={url} controls autoPlay playsInline loop={!autoplay} onEnded={autoplay ? onEnded : undefined} />
  ) : (
    <img className="afs-lbhost__media" src={url} alt="" />
  )
}

const str = (x: unknown): string => (typeof x === 'string' ? x : '')

/** 从 meta 取展示用的小标签：名称/镜头/视角/变体/类型 */
function metaChips(meta?: Record<string, unknown>): string[] {
  if (!meta) return []
  const out: string[] = []
  const push = (label: string, v: unknown) => {
    if (typeof v === 'string' && v) out.push(`${label}${v}`)
  }
  push('', meta.name)
  push('镜 ', meta.shot)
  push('视角 ', meta.view)
  push('形态 ', meta.variantId)
  if (meta.kind === 'character') out.push('角色')
  else if (meta.kind === 'scene') out.push('场景')
  return out
}
