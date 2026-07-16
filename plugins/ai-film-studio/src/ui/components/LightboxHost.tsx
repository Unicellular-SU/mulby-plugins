import { memo, useCallback, useEffect, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ListVideo, Wand2, Loader2, RotateCcw, Send } from 'lucide-react'
import { useUiStore, type LightboxItem } from '../store/uiStore'
import { useGraphStore } from '../store/graphStore'
import { useMediaUrl, type MediaRef } from '../services/mediaUrl'
import IconButton from './ui/IconButton'
import Button from './ui/Button'

/**
 * 应用级 Lightbox（统一窗口）：节点预览 / Inspector / 素材库 / 结果查看器 都开这一个。
 * - 看大图、带控件播视频、左右切换 + 键盘导航；多视频「连看」自动顺播。
 * - 带节点上下文(nodeId+port+index)的图片：展示标题/提示词/元信息 + 可「对话改图 / 重新生成」，实时反映改图结果。
 * 性能：① 只窄订阅该产物的 live 引用（生成期改 status/stream 不触发重渲染）；
 *       ② 改图输入框下沉为独立子组件（打字只重渲染输入条，不动大图/订阅）；③ 大图组件 memo 化。
 */
export default function LightboxHost() {
  const lb = useUiStore((s) => s.lightbox)
  const close = useUiStore((s) => s.closeLightbox)
  const nav = useUiStore((s) => s.lightboxNav)
  const editItem = useGraphStore((s) => s.editNodeImageItem)
  const regenItem = useGraphStore((s) => s.regenNodeImageItem)
  const [autoplay, setAutoplay] = useState(true)
  const [busy, setBusy] = useState(false)

  const ctx: LightboxItem | undefined = lb ? lb.items[lb.index] : undefined
  // 窄订阅：只取该产物 live 引用。patchNode 改 status/stream 时 outputs 引用不变 → Object.is 命中 → 不重渲染大图。
  const liveRef = useGraphStore((s) => {
    if (!ctx?.nodeId || !ctx.port || ctx.index == null) return undefined
    const n = s.nodes.find((nn) => nn.id === ctx.nodeId)
    const out = n?.data.outputs?.[ctx.port]
    if (!out) return undefined
    return (out.items && out.items[ctx.index]) || (ctx.index === 0 ? out : undefined)
  })

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

  const multi = !!lb && lb.items.length > 1
  const lbIndex = lb?.index ?? 0
  const total = lb?.items.length ?? 0
  const onVideoEnded = useCallback(() => {
    if (autoplay && multi && lbIndex < total - 1) nav(1)
  }, [autoplay, multi, lbIndex, total, nav])

  if (!lb || !ctx) return null
  const hasVideo = lb.items.some((it) => it.type === 'video')
  const ref = (liveRef as MediaRef | undefined) || ctx.ref
  const meta = (liveRef?.meta as Record<string, unknown> | undefined) || ctx.meta
  const title = ctx.title
  const promptText = ctx.prompt || str(meta?.prompt) || str(meta?.description)
  const chips = metaChips(meta)
  const canEdit = ctx.type === 'image' && !!ctx.nodeId && !!ctx.port && ctx.index != null
  const showInfo = !!title || chips.length > 0 || !!promptText || canEdit

  const doEdit = async (p: string): Promise<boolean> => {
    if (!canEdit || !p.trim() || busy) return false
    setBusy(true)
    try {
      await editItem(ctx.nodeId!, ctx.port!, ctx.index!, p.trim())
      return true
    } catch {
      return false
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
    <div className="afs-lbx" onClick={busy ? undefined : close}>
      <IconButton
        className="afs-lbx__close"
        variant="onmedia"
        size="md"
        icon={<X size={20} />}
        aria-label="关闭 (Esc)"
        title="关闭 (Esc)"
        onClick={close}
        disabled={busy}
      />
      {multi && hasVideo && (
        <button
          type="button"
          className={`afs-lbx__toggle${autoplay ? ' is-on' : ''}`}
          aria-pressed={autoplay}
          onClick={(e) => {
            e.stopPropagation()
            setAutoplay((v) => !v)
          }}
          title={autoplay ? '连看中：视频播完自动放下一段（点击关闭）' : '开启连看：按顺序连续播放所有片段'}
        >
          <ListVideo size={15} aria-hidden /> {autoplay ? '连看中' : '连看'}
        </button>
      )}
      {multi && (
        <>
          <IconButton
            className="afs-lbx__nav afs-lbx__nav--prev"
            variant="onmedia"
            size="md"
            icon={<ChevronLeft size={28} />}
            aria-label="上一个 (←)"
            title="上一个 (←)"
            onClick={(e) => { e.stopPropagation(); nav(-1) }}
          />
          <IconButton
            className="afs-lbx__nav afs-lbx__nav--next"
            variant="onmedia"
            size="md"
            icon={<ChevronRight size={28} />}
            aria-label="下一个 (→)"
            title="下一个 (→)"
            onClick={(e) => { e.stopPropagation(); nav(1) }}
          />
        </>
      )}
      <div className="afs-lbx__stage" onClick={(e) => e.stopPropagation()}>
        <div className="afs-lbx__frame">
          <LightboxMedia key={`${lb.index}-${ref.assetId || ref.url || ''}`} refv={ref} type={ctx.type} autoplay={autoplay} onEnded={onVideoEnded} />
          {busy && (
            <div className="afs-lbx__busy" role="status" aria-live="polite">
              <Loader2 size={30} className="afs-spin" aria-hidden />
              <span>生成中…</span>
            </div>
          )}
        </div>
        {showInfo && (
          <div className="afs-lbx__info">
            {(title || chips.length > 0) && (
              <div className="afs-lbx__info-head">
                {title && <span className="afs-lbx__info-title">{title}</span>}
                {chips.map((c, i) => (
                  <span className="afs-lbx__chip" key={i}>
                    {c}
                  </span>
                ))}
              </div>
            )}
            {promptText && (
              <div className="afs-lbx__prompt">
                <span className="afs-lbx__prompt-label">提示词</span>
                {promptText}
              </div>
            )}
            {canEdit && <LightboxEditBar busy={busy} onSend={doEdit} onRegen={doRegen} />}
          </div>
        )}
      </div>
      {multi && (
        <div className="afs-lbx__count" aria-live="polite">
          {lb.index + 1} / {lb.items.length}
        </div>
      )}
    </div>
  )
}

/** 改图输入条（独立子组件，prompt 局部 state）：打字只重渲染本组件，不波及大图/订阅，杜绝输入卡顿。 */
function LightboxEditBar({ busy, onSend, onRegen }: { busy: boolean; onSend: (p: string) => Promise<boolean>; onRegen: () => void }) {
  const [prompt, setPrompt] = useState('')
  const send = async () => {
    const p = prompt.trim()
    if (!p || busy) return
    const ok = await onSend(p)
    if (ok) setPrompt('')
  }
  return (
    <div className="afs-lbx__edit">
      <Button
        variant="secondary"
        size="sm"
        leadingIcon={RotateCcw}
        disabled={busy}
        onClick={onRegen}
        title="按当前上游/参考图重新生成这一张"
      >
        重新生成
      </Button>
      <div className="afs-lbx__chatbar">
        <Wand2 size={14} aria-hidden className="afs-lbx__chatbar-icon" />
        <input
          placeholder="对话修改这张图，如「换成夜晚」「加件红外套」…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void send()
          }}
          disabled={busy}
          aria-label="对话修改这张图"
        />
        <IconButton
          className="afs-glow afs-lbx__send"
          size="sm"
          icon={busy ? <Loader2 size={14} className="afs-spin" /> : <Send size={14} />}
          aria-label="发送修改 (Enter)"
          title="发送修改 (Enter)"
          disabled={!prompt.trim() || busy}
          onClick={() => void send()}
        />
      </div>
    </div>
  )
}

/** 大图/视频，memo 化：父组件因 busy/nav 重渲染时，引用未变则不重渲染、不重新解码。 */
const LightboxMedia = memo(function LightboxMedia({
  refv,
  type,
  autoplay,
  onEnded,
}: {
  refv: MediaRef
  type: 'image' | 'video'
  autoplay: boolean
  onEnded: () => void
}) {
  const url = useMediaUrl(refv)
  if (!url) return <div className="afs-lbx__loading">加载中…</div>
  return type === 'video' ? (
    <video className="afs-lbx__media" src={url} controls autoPlay playsInline loop={!autoplay} onEnded={autoplay ? onEnded : undefined} />
  ) : (
    <img className="afs-lbx__media" src={url} alt="" />
  )
})

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
